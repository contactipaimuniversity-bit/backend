import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { type Acteur, peut } from '../common/acteur';
import { PrismaService } from '../prisma/prisma.service';

// Seuls les encaissements se remettent à la chargée des finances : les reports
// ne déplacent pas d'argent, remboursements et annulations le rendent.
export const TYPES_ENCAISSEMENT = [
  'FRAIS_DEPOT',
  'FRAIS_INSCRIPTION',
  'ECHEANCE_BOURSE',
  'MENSUALITE',
  'FRAIS_ANNEXE',
] as const;
export const STATUTS_REMISE = ['EN_ATTENTE', 'VALIDE', 'NON_RECU'] as const;
type StatutRemise = (typeof STATUTS_REMISE)[number];
const MODES = ['ESPECES', 'MOBILE_MONEY', 'VIREMENT', 'CHEQUE'] as const;

type Filtres = {
  du?: string;
  au?: string;
  caissier?: string;
  mode?: string;
  statut?: string;
  type?: string;
  q?: string;
};

const jour = (valeur: string | undefined, fin: boolean) => {
  if (!valeur) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur))
    throw new BadRequestException(
      'Date invalide (format attendu : AAAA-MM-JJ)',
    );
  // Journée entière, heure du Congo (UTC+1).
  return new Date(`${valeur}T${fin ? '23:59:59.999' : '00:00:00.000'}+01:00`);
};

const montant = (valeur: unknown) => Math.round(Number(valeur) * 100) / 100;

@Injectable()
export class RemisesService {
  constructor(private readonly prisma: PrismaService) {}

  private where(filtres: Filtres): Prisma.PaiementWhereInput {
    const du = jour(filtres.du, false);
    const au = jour(filtres.au, true);
    const statut = STATUTS_REMISE.find((item) => item === filtres.statut);
    const type = TYPES_ENCAISSEMENT.find((item) => item === filtres.type);
    const mode = MODES.find((item) => item === filtres.mode);
    const q = filtres.q?.trim().slice(0, 80);
    const personne = (texte: string): Prisma.PersonneWhereInput => ({
      OR: [
        { nom: { contains: texte, mode: 'insensitive' } },
        { prenom: { contains: texte, mode: 'insensitive' } },
      ],
    });
    return {
      typePaiement: type ?? { in: [...TYPES_ENCAISSEMENT] },
      ...(du || au ? { datePaiement: { gte: du, lte: au } } : {}),
      ...(statut ? { statutRemise: statut } : {}),
      // Un paiement saisi sans mode est compté en espèces, comme en comptabilité.
      ...(mode === 'ESPECES'
        ? { OR: [{ modePaiement: 'ESPECES' }, { modePaiement: null }] }
        : mode
          ? { modePaiement: mode }
          : {}),
      ...(filtres.caissier
        ? {
            saisiParNom:
              filtres.caissier === '(inconnu)' ? null : filtres.caissier,
          }
        : {}),
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { numeroRecu: { contains: q, mode: 'insensitive' } },
                  { demandeBourse: { personne: personne(q) } },
                  { inscription: { personne: personne(q) } },
                ],
              },
            ],
          }
        : {}),
    };
  }

  // Les encaissements d'une période, avec leur synthèse et le détail par
  // caissier, jour et mode : ce que chacun doit remettre.
  async liste(filtres: Filtres) {
    const paiements = await this.prisma.paiement.findMany({
      where: this.where(filtres),
      include: {
        demandeBourse: {
          select: {
            personne: { select: { nom: true, prenom: true, matricule: true } },
          },
        },
        inscription: {
          select: {
            personne: { select: { nom: true, prenom: true, matricule: true } },
          },
        },
        elementDossier: {
          select: { elementRequis: { select: { nom: true } } },
        },
        echeance: { select: { libelle: true } },
        annulation: { select: { id: true } },
      },
      orderBy: [{ datePaiement: 'desc' }, { enregistreLe: 'desc' }],
      take: 1000,
    });
    const lignes = paiements.map((paiement) => ({
      id: paiement.id,
      numeroRecu: paiement.numeroRecu,
      datePaiement: paiement.datePaiement,
      montant: montant(paiement.montant),
      typePaiement: paiement.typePaiement,
      modePaiement: paiement.modePaiement ?? 'ESPECES',
      caissier: paiement.saisiParNom,
      personne:
        paiement.demandeBourse?.personne ??
        paiement.inscription?.personne ??
        null,
      dossier: paiement.demandeBourseId ? 'Demande de bourse' : 'Inscription',
      objet:
        paiement.elementDossier?.elementRequis.nom ??
        paiement.echeance?.libelle ??
        null,
      // Un encaissement annulé a été rendu : il n'est plus à remettre.
      annule: Boolean(paiement.annulation),
      statutRemise: paiement.statutRemise as StatutRemise,
      remiseTraiteeLe: paiement.remiseTraiteeLe,
      remiseTraiteeParNom: paiement.remiseTraiteeParNom,
      remiseMotif: paiement.remiseMotif,
    }));
    const actives = lignes.filter((ligne) => !ligne.annule);
    const total = (statut?: StatutRemise) => {
      const choix = actives.filter(
        (ligne) => !statut || ligne.statutRemise === statut,
      );
      return {
        nombre: choix.length,
        montant: montant(
          choix.reduce((somme, ligne) => somme + ligne.montant, 0),
        ),
      };
    };
    const groupes = new Map<
      string,
      {
        caissier: string | null;
        jour: string;
        mode: string;
        total: number;
        valide: number;
        enAttente: number;
        nonRecu: number;
        nombre: number;
      }
    >();
    for (const ligne of actives) {
      const date = new Date(ligne.datePaiement.getTime() + 3600_000)
        .toISOString()
        .slice(0, 10);
      const cle = `${ligne.caissier ?? ''}|${date}|${ligne.modePaiement}`;
      const groupe = groupes.get(cle) ?? {
        caissier: ligne.caissier,
        jour: date,
        mode: ligne.modePaiement,
        total: 0,
        valide: 0,
        enAttente: 0,
        nonRecu: 0,
        nombre: 0,
      };
      groupe.total += ligne.montant;
      groupe.nombre += 1;
      if (ligne.statutRemise === 'VALIDE') groupe.valide += ligne.montant;
      else if (ligne.statutRemise === 'NON_RECU')
        groupe.nonRecu += ligne.montant;
      else groupe.enAttente += ligne.montant;
      groupes.set(cle, groupe);
    }
    const caissiers = await this.prisma.paiement.findMany({
      where: { typePaiement: { in: [...TYPES_ENCAISSEMENT] } },
      distinct: ['saisiParNom'],
      select: { saisiParNom: true },
    });
    return {
      lignes,
      tronque: paiements.length === 1000,
      synthese: {
        total: total(),
        valide: total('VALIDE'),
        enAttente: total('EN_ATTENTE'),
        nonRecu: total('NON_RECU'),
      },
      parCaissier: [...groupes.values()].sort(
        (a, b) =>
          b.jour.localeCompare(a.jour) ||
          (a.caissier ?? '').localeCompare(b.caissier ?? ''),
      ),
      caissiers: caissiers
        .map((item) => item.saisiParNom ?? '(inconnu)')
        .sort(),
    };
  }

  async compteur() {
    const enAttente = await this.prisma.paiement.aggregate({
      where: {
        typePaiement: { in: [...TYPES_ENCAISSEMENT] },
        statutRemise: 'EN_ATTENTE',
        annulation: null,
      },
      _count: true,
      _sum: { montant: true },
    });
    return {
      enAttente: enAttente._count,
      montant: montant(enAttente._sum.montant ?? 0),
    };
  }

  // Valider (argent reçu), signaler non reçu, ou remettre en attente, en lot.
  async traiter(
    body: { ids?: unknown; statut?: unknown; motif?: unknown },
    acteur: Acteur,
  ) {
    if (!peut(acteur, 'edit:payment-validation'))
      throw new ForbiddenException(
        'La validation des encaissements ne vous est pas attribuée',
      );
    const ids = Array.isArray(body.ids)
      ? [
          ...new Set(
            body.ids.filter((id): id is string => typeof id === 'string'),
          ),
        ]
      : [];
    if (!ids.length || ids.length > 500)
      throw new BadRequestException(
        'Sélectionnez entre 1 et 500 encaissements',
      );
    const statut = STATUTS_REMISE.find((item) => item === body.statut);
    if (!statut) throw new BadRequestException('Statut de remise invalide');
    const motif =
      typeof body.motif === 'string' ? body.motif.trim().slice(0, 300) : '';
    // Un manque ou un retour en arrière s'explique toujours.
    if (statut !== 'VALIDE' && motif.length < 3)
      throw new BadRequestException(
        statut === 'NON_RECU'
          ? 'Indiquez ce qui manque (ex. « 20 000 F non remis par la caisse »)'
          : 'Indiquez pourquoi la validation est annulée',
      );

    return this.prisma.$transaction(async (transaction) => {
      const paiements = await transaction.paiement.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          numeroRecu: true,
          typePaiement: true,
          saisiParId: true,
          saisiParNom: true,
          statutRemise: true,
          annulation: { select: { id: true } },
        },
      });
      if (paiements.length !== ids.length)
        throw new BadRequestException('Encaissement introuvable');
      const refus = (raison: string, liste: typeof paiements) => {
        if (liste.length)
          throw new ConflictException(
            `${raison} : ${liste.map((item) => item.numeroRecu ?? item.id.slice(0, 8)).join(', ')}`,
          );
      };
      refus(
        "Ce n'est pas un encaissement",
        paiements.filter(
          (item) =>
            !(TYPES_ENCAISSEMENT as readonly string[]).includes(
              item.typePaiement,
            ),
        ),
      );
      refus(
        'Encaissement annulé, plus rien à remettre',
        paiements.filter((item) => item.annulation),
      );
      // Séparation des tâches : celle qui encaisse ne valide pas sa propre caisse.
      refus(
        'Vous ne pouvez pas valider vos propres encaissements',
        paiements.filter((item) =>
          item.saisiParId
            ? item.saisiParId === acteur.id
            : item.saisiParNom === acteur.nom,
        ),
      );
      const resultat = await transaction.paiement.updateMany({
        where: { id: { in: ids } },
        data: {
          statutRemise: statut,
          remiseTraiteeLe: statut === 'EN_ATTENTE' ? null : new Date(),
          remiseTraiteeParId: statut === 'EN_ATTENTE' ? null : acteur.id,
          remiseTraiteeParNom: statut === 'EN_ATTENTE' ? null : acteur.nom,
          remiseMotif: motif || null,
        },
      });
      return { traites: resultat.count, statut };
    });
  }
}
