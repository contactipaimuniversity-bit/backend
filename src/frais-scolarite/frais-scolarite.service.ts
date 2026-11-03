import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { niveauxConnus } from '../academique/niveaux';
import { isUniqueConstraintViolation } from '../common/prisma-errors';
import { verrouillerDossier } from '../paiements/encaissement';
import { PrismaService } from '../prisma/prisma.service';
import {
  arrondir,
  MODES_EXCEPTION,
  montantApresException,
  repartir,
} from './frais-scolarite.rules';
import {
  appliquerAnnexeAuGroupe,
  recalculerEcheancier,
  situationScolarite,
  synchroniserEcheanciers,
  verseMensualites,
} from './frais-scolarite.situation';

type Body = Record<string, unknown>;
type Client = Prisma.TransactionClient;

const MODES_BOURSE = ['REDUCTION', 'MOIS_FIXES'];
const VERIFICATIONS = ['SEMESTRE', 'ANNEE'];

const texte = (value: unknown, champ: string, max = 120) => {
  const valeur = typeof value === 'string' ? value.trim() : '';
  if (!valeur || valeur.length > max)
    throw new BadRequestException(`${champ} est obligatoire`);
  return valeur;
};

const saisie = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

const montantValide = (value: unknown, champ: string) => {
  const valeur = Number(saisie(value).replace(',', '.'));
  if (saisie(value).trim() === '' || !Number.isFinite(valeur) || valeur < 0)
    throw new BadRequestException(`${champ} doit être un montant positif`);
  if (valeur > 99_999_999.99)
    throw new BadRequestException(`${champ} dépasse la limite autorisée`);
  return arrondir(valeur);
};

const pourcentage = (value: unknown, champ: string) => {
  const valeur = Number(saisie(value).replace(',', '.'));
  if (!Number.isFinite(valeur) || valeur < 0 || valeur > 100)
    throw new BadRequestException(`${champ} doit être compris entre 0 et 100`);
  return arrondir(valeur);
};

const dateOuNull = (value: unknown, champ: string) => {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(saisie(value));
  if (Number.isNaN(date.getTime()))
    throw new BadRequestException(`${champ} doit être une date valide`);
  return date;
};

const dateRequise = (value: unknown, champ: string) => {
  const date = dateOuNull(value, champ);
  if (!date) throw new BadRequestException(`${champ} est obligatoire`);
  return date;
};

const liste = (value: unknown, champ: string) => {
  if (!Array.isArray(value))
    throw new BadRequestException(`${champ} doit être une liste`);
  return value as Body[];
};

@Injectable()
export class FraisScolariteService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Paramétrage ----------

  async parametres(rawAnnee?: string) {
    const [annees, niveaux, filieres, tarifs, bourses, aConfirmer] =
      await Promise.all([
        this.prisma.anneeAcademique.findMany({
          select: {
            libelle: true,
            dateDebut: true,
            dateFin: true,
            statut: true,
          },
          orderBy: { dateDebut: 'desc' },
        }),
        niveauxConnus(this.prisma),
        this.prisma.filiere.findMany({
          where: { actif: true },
          select: { id: true, code: true, nom: true },
          orderBy: { nom: 'asc' },
        }),
        this.prisma.tarifScolarite.findMany(),
        this.prisma.typeBourse.findMany({
          include: {
            echeances: { orderBy: { ordre: 'asc' } },
            _count: { select: { demandesBourse: true } },
          },
          orderBy: { nom: 'asc' },
        }),
        this.boursesAConfirmer(),
      ]);
    const annee =
      rawAnnee?.trim() ||
      annees.find((item) => item.statut === 'EN_COURS')?.libelle ||
      annees[0]?.libelle ||
      '';
    const [mois, annexes] = await Promise.all([
      this.prisma.moisScolarite.findMany({
        where: { anneeScolaire: annee },
        orderBy: { ordre: 'asc' },
      }),
      this.prisma.fraisAnnexe.findMany({
        where: { anneeScolaire: annee },
        include: { filiere: { select: { nom: true } } },
        orderBy: [{ actif: 'desc' }, { nom: 'asc' }],
      }),
    ]);
    return {
      annee,
      annees,
      niveaux: niveaux.filter((niveau) => niveau.actif),
      filieres,
      mois,
      tarifs,
      bourses,
      annexes,
      aConfirmer: aConfirmer.length,
    };
  }

  async enregistrerCalendrier(body: Body) {
    const anneeScolaire = texte(body.anneeScolaire, "L'année scolaire");
    const mois = liste(body.mois, 'Les mois').map((item, index) => ({
      anneeScolaire,
      ordre: index + 1,
      libelle: texte(item.libelle, 'Le nom du mois'),
      dateLimite: dateRequise(item.dateLimite, 'La date limite'),
    }));
    const libelles = new Set(mois.map((item) => item.libelle.toLowerCase()));
    if (libelles.size !== mois.length)
      throw new BadRequestException('Deux mois portent le même nom');
    await this.prisma.$transaction([
      this.prisma.moisScolarite.deleteMany({ where: { anneeScolaire } }),
      this.prisma.moisScolarite.createMany({ data: mois }),
    ]);
    await synchroniserEcheanciers(this.prisma);
    return this.parametres(anneeScolaire);
  }

  // Une case vide retire le tarif : la filière reprend le prix de son niveau.
  async enregistrerTarifs(body: Body) {
    const tarifs = liste(body.tarifs, 'Les tarifs').flatMap((item) => {
      if (item.montantMensuel === null || item.montantMensuel === '') return [];
      return [
        {
          niveau: texte(item.niveau, 'Le niveau'),
          filiereId:
            typeof item.filiereId === 'string' && item.filiereId
              ? item.filiereId
              : null,
          montantMensuel: montantValide(
            item.montantMensuel,
            'Le tarif',
          ).toFixed(2),
        },
      ];
    });
    await this.prisma.$transaction([
      this.prisma.tarifScolarite.deleteMany(),
      this.prisma.tarifScolarite.createMany({ data: tarifs }),
    ]);
    await synchroniserEcheanciers(this.prisma);
    return this.prisma.tarifScolarite.findMany();
  }

  private lireBourse(body: Body) {
    const modeScolarite = texte(body.modeScolarite, 'Le mode');
    if (!MODES_BOURSE.includes(modeScolarite))
      throw new BadRequestException('Mode de bourse inconnu');
    const verificationMoyenne =
      typeof body.verificationMoyenne === 'string'
        ? body.verificationMoyenne
        : 'SEMESTRE';
    if (!VERIFICATIONS.includes(verificationMoyenne))
      throw new BadRequestException('Moment de vérification inconnu');
    const moyenneVide =
      body.moyenneMinimale === null || body.moyenneMinimale === '';
    const moyenneMinimale = moyenneVide
      ? null
      : Number(String(body.moyenneMinimale).replace(',', '.'));
    if (
      moyenneMinimale !== null &&
      (!Number.isFinite(moyenneMinimale) ||
        moyenneMinimale < 0 ||
        moyenneMinimale > 20)
    )
      throw new BadRequestException(
        'La moyenne à conserver doit être comprise entre 0 et 20',
      );
    const echeances = liste(body.echeances ?? [], 'Les échéances').map(
      (item, index) => ({
        ordre: index + 1,
        libelle: texte(item.libelle, "Le nom de l'échéance"),
        dateEcheance: dateRequise(item.dateEcheance, "La date de l'échéance"),
        montantAttendu:
          item.montantAttendu === null || item.montantAttendu === ''
            ? null
            : montantValide(
                item.montantAttendu,
                "Le montant de l'échéance",
              ).toFixed(2),
      }),
    );
    if (modeScolarite === 'MOIS_FIXES' && !echeances.length)
      throw new BadRequestException(
        'Indiquez au moins une échéance pour cette bourse',
      );
    return {
      nom: texte(body.nom, 'Le nom de la bourse'),
      modeScolarite,
      tauxReduction:
        body.tauxReduction === null || body.tauxReduction === ''
          ? null
          : pourcentage(body.tauxReduction, 'La réduction').toFixed(2),
      reductionSurInscription: body.reductionSurInscription === true,
      moyenneMinimale,
      verificationMoyenne,
      echeances,
    };
  }

  async creerBourse(body: Body) {
    const { echeances, ...data } = this.lireBourse(body);
    try {
      return await this.prisma.typeBourse.create({
        data: {
          ...data,
          fraisInscription: 0,
          echeances: { create: echeances },
        },
        include: { echeances: { orderBy: { ordre: 'asc' } } },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException('Cette bourse existe déjà');
      throw error;
    }
  }

  async modifierBourse(id: string, body: Body) {
    const { echeances, ...data } = this.lireBourse(body);
    try {
      const bourse = await this.prisma.$transaction(async (transaction) => {
        const type = await transaction.typeBourse.findUnique({ where: { id } });
        if (!type) throw new NotFoundException('Bourse introuvable');
        await transaction.typeBourse.update({ where: { id }, data });
        // Une échéance déjà encaissée par l'ancien système garde son historique.
        const encaissees = await transaction.echeanceBourse.findMany({
          where: { typeBourseId: id, paiements: { some: {} } },
          select: { ordre: true },
        });
        await transaction.echeanceBourse.deleteMany({
          where: { typeBourseId: id, paiements: { none: {} } },
        });
        const dernierOrdre = Math.max(
          0,
          ...encaissees.map((item) => item.ordre),
        );
        await transaction.echeanceBourse.createMany({
          data: echeances.map((echeance, index) => ({
            ...echeance,
            typeBourseId: id,
            ordre: dernierOrdre + index + 1,
          })),
        });
        return transaction.typeBourse.findUniqueOrThrow({
          where: { id },
          include: { echeances: { orderBy: { ordre: 'asc' } } },
        });
      });
      await synchroniserEcheanciers(this.prisma);
      return bourse;
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException('Cette bourse existe déjà');
      throw error;
    }
  }

  private lireAnnexe(body: Body) {
    const cible = body.cible === 'A_LA_DEMANDE' ? 'A_LA_DEMANDE' : 'GROUPE';
    return {
      nom: texte(body.nom, 'Le nom du frais'),
      montant: montantValide(body.montant, 'Le montant').toFixed(2),
      anneeScolaire: texte(body.anneeScolaire, "L'année scolaire"),
      cible,
      niveau:
        cible === 'GROUPE' && typeof body.niveau === 'string' && body.niveau
          ? body.niveau
          : null,
      filiereId:
        cible === 'GROUPE' &&
        typeof body.filiereId === 'string' &&
        body.filiereId
          ? body.filiereId
          : null,
      dateLimite: dateOuNull(body.dateLimite, 'La date limite'),
    };
  }

  async creerAnnexe(body: Body) {
    const data = this.lireAnnexe(body);
    return this.prisma.$transaction(async (transaction) => {
      const annexe = await transaction.fraisAnnexe.create({ data });
      const etudiants =
        data.cible === 'GROUPE'
          ? await appliquerAnnexeAuGroupe(transaction, annexe)
          : 0;
      return { ...annexe, etudiants };
    });
  }

  // Le nouveau montant vaut pour ceux qui n'ont encore rien payé dessus.
  async modifierAnnexe(id: string, body: Body) {
    const data = this.lireAnnexe(body);
    return this.prisma.$transaction(async (transaction) => {
      const existant = await transaction.fraisAnnexe.findUnique({
        where: { id },
      });
      if (!existant) throw new NotFoundException('Frais annexe introuvable');
      const annexe = await transaction.fraisAnnexe.update({
        where: { id },
        data,
      });
      await transaction.ligneScolarite.updateMany({
        where: { fraisAnnexeId: id, paiements: { none: {} } },
        data: {
          libelle: annexe.nom,
          montant: annexe.montant,
          dateLimite: annexe.dateLimite,
        },
      });
      const etudiants =
        annexe.cible === 'GROUPE' && annexe.actif
          ? await appliquerAnnexeAuGroupe(transaction, annexe)
          : 0;
      return { ...annexe, etudiants };
    });
  }

  // Retiré : plus personne ne le doit, sauf ceux qui ont déjà commencé à le payer.
  async activerAnnexe(id: string, body: Body) {
    const actif = body.actif === true;
    return this.prisma.$transaction(async (transaction) => {
      const existant = await transaction.fraisAnnexe.findUnique({
        where: { id },
      });
      if (!existant) throw new NotFoundException('Frais annexe introuvable');
      const annexe = await transaction.fraisAnnexe.update({
        where: { id },
        data: { actif },
      });
      if (!actif)
        await transaction.ligneScolarite.deleteMany({
          where: { fraisAnnexeId: id, paiements: { none: {} } },
        });
      else if (annexe.cible === 'GROUPE')
        await appliquerAnnexeAuGroupe(transaction, annexe);
      return annexe;
    });
  }

  // Refait les mois non payés des étudiants, sauf les échéanciers retouchés à la main.
  async appliquer(body: Body) {
    const anneeScolaire = texte(body.anneeScolaire, "L'année scolaire");
    const misAJour = await synchroniserEcheanciers(this.prisma);
    const personnalises = await this.prisma.inscription.count({
      where: {
        anneeScolaire,
        statut: { not: 'ABANDONNEE' },
        echeancierPersonnalise: true,
      },
    });
    return { misAJour, personnalises };
  }

  // ---------- Conservation de la bourse ----------

  async boursesAConfirmer() {
    const resultats = await this.prisma.resultatDeliberation.findMany({
      where: {
        moyenne: { not: null },
        deliberation: { statut: 'CLOTUREE' },
        inscription: {
          bourseRetireeLe: null,
          demandeBourse: {
            statut: 'ACCEPTEE',
            typeBourse: { moyenneMinimale: { not: null } },
          },
        },
      },
      select: {
        moyenne: true,
        deliberationId: true,
        inscriptionId: true,
        deliberation: {
          select: {
            semestre: true,
            dateCloture: true,
            classe: {
              select: {
                niveau: true,
                groupe: true,
                filiere: { select: { code: true } },
              },
            },
          },
        },
        inscription: {
          select: {
            personne: { select: { nom: true, prenom: true, matricule: true } },
            decisionsBourse: { select: { deliberationId: true } },
            demandeBourse: {
              select: {
                typeBourse: {
                  select: {
                    nom: true,
                    moyenneMinimale: true,
                    verificationMoyenne: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    return resultats.flatMap((resultat) => {
      const type = resultat.inscription.demandeBourse?.typeBourse;
      if (!type || type.moyenneMinimale === null) return [];
      const annuelle = resultat.deliberation.semestre === 0;
      if (annuelle !== (type.verificationMoyenne === 'ANNEE')) return [];
      if (Number(resultat.moyenne) >= Number(type.moyenneMinimale)) return [];
      if (
        resultat.inscription.decisionsBourse.some(
          (decision) => decision.deliberationId === resultat.deliberationId,
        )
      )
        return [];
      return [
        {
          inscriptionId: resultat.inscriptionId,
          deliberationId: resultat.deliberationId,
          personne: resultat.inscription.personne,
          bourse: type.nom,
          moyenne: Number(resultat.moyenne),
          moyenneMinimale: Number(type.moyenneMinimale),
          periode: annuelle
            ? 'Année'
            : `Semestre ${resultat.deliberation.semestre}`,
          classe: `${resultat.deliberation.classe.filiere.code} ${resultat.deliberation.classe.niveau} ${resultat.deliberation.classe.groupe}`,
          dateCloture: resultat.deliberation.dateCloture,
        },
      ];
    });
  }

  async deciderBourse(body: Body, auteur: string) {
    const inscriptionId = texte(body.inscriptionId, "L'inscription");
    const deliberationId = texte(body.deliberationId, 'La délibération');
    const decision = body.decision === 'RETIREE' ? 'RETIREE' : 'MAINTENUE';
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.decisionBourse.create({
          data: {
            inscriptionId,
            deliberationId,
            decision,
            motif:
              typeof body.motif === 'string' ? body.motif.trim() || null : null,
            parNom: auteur,
          },
        });
        if (decision === 'RETIREE') {
          const maintenant = new Date();
          await transaction.inscription.update({
            where: { id: inscriptionId },
            data: { bourseRetireeLe: maintenant },
          });
          await recalculerEcheancier(transaction, inscriptionId);
        }
        return { inscriptionId, decision };
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException('Une décision a déjà été prise');
      throw error;
    }
  }

  // ---------- Échéancier d'un étudiant ----------

  async situation(id: string) {
    const situation = await situationScolarite(this.prisma, id);
    if (!situation) throw new NotFoundException('Inscription introuvable');
    const deja = situation.annexes.map((ligne) => ligne.fraisAnnexeId);
    const annexesDisponibles = await this.prisma.fraisAnnexe.findMany({
      where: {
        actif: true,
        anneeScolaire: situation.anneeScolaire,
        id: { notIn: deja.filter((item): item is string => Boolean(item)) },
      },
      select: { id: true, nom: true, montant: true },
      orderBy: { nom: 'asc' },
    });
    return { ...situation, annexesDisponibles };
  }

  private async exigerInscription(id: string) {
    const existe = await this.prisma.inscription.count({ where: { id } });
    if (!existe) throw new NotFoundException('Inscription introuvable');
  }

  async accorderReduction(id: string, body: Body) {
    await this.exigerInscription(id);
    const taux =
      body.taux === null || body.taux === ''
        ? null
        : pourcentage(body.taux, 'La réduction');
    await this.prisma.$transaction(async (transaction) => {
      await transaction.inscription.update({
        where: { id },
        data: {
          reductionIndividuelle: taux === null ? null : taux.toFixed(2),
          echeancierPersonnalise: false,
        },
      });
      await recalculerEcheancier(transaction, id);
    });
    return this.situation(id);
  }

  // Ne payer que les N premiers mois : la scolarité déjà réglée reste acquise.
  async limiterMois(id: string, body: Body) {
    await this.situation(id);
    const nombre = Number(body.nombre);
    if (!Number.isInteger(nombre) || nombre < 1)
      throw new BadRequestException('Indiquez un nombre de mois valide');
    await this.prisma.$transaction(async (transaction) => {
      await verrouillerDossier(transaction, id);
      const lignes = await transaction.ligneScolarite.findMany({
        where: { inscriptionId: id, type: 'MENSUALITE' },
      });
      const reparties = repartir(
        lignes.map((ligne) => ({
          id: ligne.id,
          dateLimite: ligne.dateLimite,
          ordre: ligne.ordre,
          montant: Number(ligne.montant),
        })),
        await verseMensualites(transaction, id),
      );
      const payes = reparties.filter((ligne) => ligne.paye > 0).length;
      if (nombre < payes)
        throw new BadRequestException(
          `${payes} mois ont déjà reçu un paiement : gardez-en au moins ${payes}`,
        );
      await transaction.ligneScolarite.deleteMany({
        where: {
          id: { in: reparties.slice(nombre).map((ligne) => ligne.id) },
        },
      });
      await transaction.inscription.update({
        where: { id },
        data: { echeancierPersonnalise: true },
      });
    });
    return this.situation(id);
  }

  async ajouterLigne(id: string, body: Body) {
    await this.exigerInscription(id);
    const libelle = texte(body.libelle, 'Le nom');
    const montant = montantValide(body.montant, 'Le montant').toFixed(2);
    const dateLimite = dateOuNull(body.dateLimite, 'La date limite');
    await this.prisma.$transaction(async (transaction) => {
      const dernier = await transaction.ligneScolarite.aggregate({
        where: { inscriptionId: id, type: 'MENSUALITE' },
        _max: { ordre: true },
      });
      await transaction.ligneScolarite.create({
        data: {
          inscriptionId: id,
          type: 'MENSUALITE',
          ordre: (dernier._max.ordre ?? 0) + 1,
          libelle,
          montant,
          dateLimite,
        },
      });
      await transaction.inscription.update({
        where: { id },
        data: { echeancierPersonnalise: true },
      });
    });
    return this.situation(id);
  }

  private async ligneDe(id: string, ligneId: string) {
    const ligne = await this.prisma.ligneScolarite.findFirst({
      where: { id: ligneId, inscriptionId: id },
      include: { paiements: { select: { montant: true } } },
    });
    if (!ligne) throw new NotFoundException('Ligne introuvable');
    return ligne;
  }

  // Le total dû ne peut pas passer sous ce que l'étudiant a déjà versé.
  private async verifierTotal(
    id: string,
    ligneId: string,
    nouveauMontant: number,
  ) {
    const [autres, verse] = await Promise.all([
      this.prisma.ligneScolarite.aggregate({
        where: {
          inscriptionId: id,
          type: 'MENSUALITE',
          id: { not: ligneId },
        },
        _sum: { montant: true },
      }),
      verseMensualites(this.prisma, id),
    ]);
    if (Number(autres._sum.montant ?? 0) + nouveauMontant < verse)
      throw new BadRequestException(
        `L'étudiant a déjà versé ${verse} F : le total des mois ne peut pas être inférieur`,
      );
  }

  async modifierLigne(id: string, ligneId: string, body: Body) {
    const ligne = await this.ligneDe(id, ligneId);
    const montant = montantValide(body.montant, 'Le montant');
    if (ligne.type === 'MENSUALITE')
      await this.verifierTotal(id, ligneId, montant);
    else {
      const paye = ligne.paiements.reduce(
        (total, paiement) => total + Number(paiement.montant),
        0,
      );
      if (montant < paye)
        throw new BadRequestException(
          `${paye} F ont déjà été payés sur ce frais`,
        );
    }
    await this.prisma.$transaction([
      this.prisma.ligneScolarite.update({
        where: { id: ligneId },
        data: {
          libelle: texte(body.libelle, 'Le nom'),
          montant: montant.toFixed(2),
          dateLimite: dateOuNull(body.dateLimite, 'La date limite'),
        },
      }),
      ...(ligne.type === 'MENSUALITE'
        ? [
            this.prisma.inscription.update({
              where: { id },
              data: { echeancierPersonnalise: true },
            }),
          ]
        : []),
    ]);
    return this.situation(id);
  }

  async retirerLigne(id: string, ligneId: string) {
    const ligne = await this.ligneDe(id, ligneId);
    if (ligne.paiements.length)
      throw new BadRequestException(
        'Ce frais a déjà reçu un paiement : annulez-le d’abord',
      );
    if (ligne.type === 'MENSUALITE') await this.verifierTotal(id, ligneId, 0);
    await this.prisma.$transaction([
      this.prisma.ligneScolarite.delete({ where: { id: ligneId } }),
      ...(ligne.type === 'MENSUALITE'
        ? [
            this.prisma.inscription.update({
              where: { id },
              data: { echeancierPersonnalise: true },
            }),
          ]
        : []),
    ]);
    return this.situation(id);
  }

  // Revient au paramétrage général, en gardant ce qui est déjà payé.
  async reinitialiser(id: string) {
    await this.exigerInscription(id);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.inscription.update({
        where: { id },
        data: { echeancierPersonnalise: false, reductionIndividuelle: null },
      });
      await recalculerEcheancier(transaction, id);
    });
    return this.situation(id);
  }

  async retablirBourse(id: string) {
    await this.exigerInscription(id);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.inscription.update({
        where: { id },
        data: { bourseRetireeLe: null },
      });
      await recalculerEcheancier(transaction, id);
    });
    return this.situation(id);
  }

  async ajouterAnnexe(id: string, body: Body) {
    await this.exigerInscription(id);
    const annexe = await this.prisma.fraisAnnexe.findFirst({
      where: { id: texte(body.fraisAnnexeId, 'Le frais'), actif: true },
    });
    if (!annexe) throw new NotFoundException('Frais annexe introuvable');
    try {
      await this.prisma.ligneScolarite.create({
        data: {
          inscriptionId: id,
          type: 'ANNEXE',
          ordre: 1,
          libelle: annexe.nom,
          dateLimite: annexe.dateLimite,
          montant: annexe.montant,
          fraisAnnexeId: annexe.id,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException('Ce frais est déjà sur le dossier');
      throw error;
    }
    return this.situation(id);
  }

  // ---------- Exceptions ----------

  private lireException(body: Body) {
    const mode = texte(body.mode, 'Le type d’exception');
    if (!MODES_EXCEPTION.includes(mode))
      throw new BadRequestException('Type d’exception inconnu');
    const valeur =
      mode === 'POURCENTAGE'
        ? pourcentage(body.valeur, 'La réduction')
        : mode === 'MONTANT'
          ? montantValide(body.valeur, 'Le montant')
          : null;
    if (mode === 'POURCENTAGE' && !valeur)
      throw new BadRequestException('Indiquez une réduction supérieure à 0 %');
    return { mode, valeur, motif: texte(body.motif, 'Le motif', 300) };
  }

  // Sur un mois (désigné par son nom) ou sur un frais d'inscription du dossier.
  async accorderException(id: string, body: Body, auteur: string) {
    const exception = this.lireException(body);
    const elementDossierId =
      typeof body.elementDossierId === 'string' ? body.elementDossierId : '';
    const cible = elementDossierId
      ? await this.fraisInscriptionDe(id, elementDossierId)
      : await this.moisDe(id, texte(body.mois, 'Le mois'));
    if (cible.exception)
      throw new ConflictException(
        'Cette ligne a déjà une exception : retirez-la d’abord',
      );
    if (cible.paye > 0 && cible.reste === 0)
      throw new BadRequestException('Cette ligne est déjà entièrement payée');
    const montant = montantApresException(cible.montant, exception);
    if (montant > cible.montant)
      throw new BadRequestException(
        `Le montant fixé dépasse ce qui est dû (${cible.montant} F)`,
      );
    if (montant < cible.paye)
      throw new BadRequestException(
        `${cible.paye} F ont déjà été versés sur cette ligne : le montant ne peut pas descendre en dessous`,
      );
    try {
      await this.prisma.$transaction(async (transaction) => {
        await verrouillerDossier(transaction, id);
        await transaction.exceptionScolarite.create({
          data: {
            inscriptionId: id,
            mois: elementDossierId ? null : cible.libelle,
            elementDossierId: elementDossierId || null,
            mode: exception.mode,
            valeur:
              exception.valeur === null ? null : exception.valeur.toFixed(2),
            montantInitial: cible.montant.toFixed(2),
            motif: exception.motif,
            parNom: auteur,
          },
        });
        await this.appliquerMontant(transaction, id, cible, montant);
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException(
          'Cette ligne a déjà une exception : retirez-la d’abord',
        );
      throw error;
    }
    return this.situation(id);
  }

  // On revient au montant d'avant, tant que rien n'a été payé sur la ligne.
  async retirerException(id: string, exceptionId: string) {
    const exception = await this.prisma.exceptionScolarite.findFirst({
      where: { id: exceptionId, inscriptionId: id },
    });
    if (!exception) throw new NotFoundException('Exception introuvable');
    const cible = exception.elementDossierId
      ? await this.fraisInscriptionDe(id, exception.elementDossierId)
      : await this.moisDe(id, exception.mois ?? '', false);
    if (cible.paye > 0)
      throw new BadRequestException(
        'Un paiement a déjà été reçu sur cette ligne : l’exception ne peut plus être retirée',
      );
    await this.prisma.$transaction(async (transaction) => {
      await verrouillerDossier(transaction, id);
      await transaction.exceptionScolarite.delete({
        where: { id: exceptionId },
      });
      await this.appliquerMontant(
        transaction,
        id,
        cible,
        Number(exception.montantInitial),
      );
    });
    return this.situation(id);
  }

  private async moisDe(id: string, libelle: string, obligatoire = true) {
    const situation = await this.situation(id);
    const ligne = situation.mensualites.find(
      (item) => item.libelle === libelle,
    );
    if (!ligne && obligatoire) throw new NotFoundException('Mois introuvable');
    return {
      type: 'MOIS' as const,
      id: ligne?.id ?? null,
      libelle,
      montant: ligne?.montant ?? 0,
      paye: ligne?.paye ?? 0,
      reste: ligne?.reste ?? 0,
      exception: ligne?.exception ?? null,
      personnalise: situation.personnalise,
    };
  }

  private async fraisInscriptionDe(id: string, elementDossierId: string) {
    const situation = await this.situation(id);
    const frais = situation.fraisInscription.find(
      (item) => item.id === elementDossierId,
    );
    if (!frais) throw new NotFoundException('Frais introuvable');
    return {
      type: 'FRAIS' as const,
      ...frais,
      personnalise: situation.personnalise,
    };
  }

  // Un échéancier qui suit le paramétrage est recalculé (l'exception y est prise
  // en compte) ; un échéancier personnalisé et les frais d'inscription sont
  // modifiés directement.
  private async appliquerMontant(
    transaction: Client,
    id: string,
    cible: { type: 'MOIS' | 'FRAIS'; id: string | null; personnalise: boolean },
    montant: number,
  ) {
    if (cible.type === 'FRAIS') {
      if (cible.id)
        await transaction.elementDossier.update({
          where: { id: cible.id },
          data: { montantAttendu: montant.toFixed(2) },
        });
    } else if (!cible.personnalise) await recalculerEcheancier(transaction, id);
    else if (cible.id)
      await transaction.ligneScolarite.update({
        where: { id: cible.id },
        data: { montant: montant.toFixed(2) },
      });
  }
}
