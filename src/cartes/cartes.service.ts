import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Acteur } from '../common/acteur';
import { PrismaService } from '../prisma/prisma.service';

// Le QR code d'une carte : un préfixe propre à l'IPAIM et un jeton de 24
// caractères (120 bits tirés au hasard). Tout autre code est écarté d'emblée.
export const PREFIXE_CARTE = 'IPAIM:C1:';
const FORMAT_CARTE = /^IPAIM:C1:[A-Z2-7]{24}$/;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function nouveauJeton(): string {
  const octets = randomBytes(15);
  let bits = '';
  for (const octet of octets) bits += octet.toString(2).padStart(8, '0');
  let jeton = '';
  for (let index = 0; index < bits.length; index += 5)
    jeton += BASE32[Number.parseInt(bits.slice(index, index + 5), 2)];
  return `${PREFIXE_CARTE}${jeton}`;
}

const PERSONNE = {
  select: {
    id: true,
    nom: true,
    prenom: true,
    sexe: true,
    matricule: true,
    dateNaissance: true,
    photoUrl: true,
  },
} as const;

const INSCRIPTION = {
  personne: PERSONNE,
  classe: {
    select: {
      niveau: true,
      groupe: true,
      filiere: { select: { nom: true } },
      anneeAcademique: { select: { libelle: true, dateFin: true } },
    },
  },
  filiereRef: { select: { nom: true } },
} as const;

@Injectable()
export class CartesService {
  constructor(private readonly prisma: PrismaService) {}

  // Fin de validité : la fin de l'année académique, ou à défaut le 30 septembre
  // de la seconde année du libellé (« 2026-2027 » → 30/09/2027).
  private async validite(anneeScolaire: string, fin?: Date | null) {
    if (fin) return fin;
    const annee = await this.prisma.anneeAcademique.findUnique({
      where: { libelle: anneeScolaire },
      select: { dateFin: true },
    });
    if (annee) return annee.dateFin;
    const seconde = anneeScolaire.match(/^\d{4}-(\d{4})$/)?.[1];
    if (!seconde)
      throw new BadRequestException(
        `L'année scolaire « ${anneeScolaire} » ne permet pas de dater la validité de la carte`,
      );
    return new Date(Date.UTC(Number(seconde), 8, 30, 22, 59, 59));
  }

  // Éditer les cartes d'une ou plusieurs inscriptions. Une carte encore valable
  // est réimprimée telle quelle ; « renouveler » la remplace (carte perdue).
  async generer(
    body: { inscriptionIds?: unknown; renouveler?: unknown },
    acteur: Acteur,
  ) {
    const ids = Array.isArray(body.inscriptionIds)
      ? [...new Set(body.inscriptionIds.filter((id) => typeof id === 'string'))]
      : [];
    if (!ids.length || ids.length > 200)
      throw new BadRequestException(
        'Indiquez entre 1 et 200 inscriptions pour lesquelles éditer une carte',
      );
    const renouveler = body.renouveler === true;
    const inscriptions = await this.prisma.inscription.findMany({
      where: { id: { in: ids } },
      include: INSCRIPTION,
    });
    if (inscriptions.length !== ids.length)
      throw new NotFoundException('Inscription introuvable');
    const sansMatricule = inscriptions.filter(
      (item) => !item.personne.matricule,
    );
    if (sansMatricule.length)
      throw new ConflictException(
        `Pas encore de matricule pour ${sansMatricule.map((item) => `${item.personne.prenom} ${item.personne.nom}`).join(', ')} : affectez d'abord l'étudiant à une classe`,
      );
    const abandons = inscriptions.filter(
      (item) => item.statut === 'ABANDONNEE',
    );
    if (abandons.length)
      throw new ConflictException(
        `Inscription abandonnée : pas de carte pour ${abandons.map((item) => `${item.personne.prenom} ${item.personne.nom}`).join(', ')}`,
      );

    const maintenant = new Date();
    const cartes: Array<Record<string, unknown>> = [];
    for (const inscription of inscriptions) {
      const valableJusquau = await this.validite(
        inscription.anneeScolaire,
        inscription.classe?.anneeAcademique.dateFin,
      );
      const carte = await this.prisma.$transaction(async (transaction) => {
        const existante = await transaction.carteEtudiant.findFirst({
          where: { inscriptionId: inscription.id, active: true },
          orderBy: { creeLe: 'desc' },
        });
        if (existante && !renouveler && existante.valableJusquau > maintenant)
          return existante;
        if (existante)
          await transaction.carteEtudiant.updateMany({
            where: { inscriptionId: inscription.id, active: true },
            data: {
              active: false,
              desactiveeLe: maintenant,
              motifDesactivation: 'Remplacée par une nouvelle carte',
            },
          });
        return transaction.carteEtudiant.create({
          data: {
            inscriptionId: inscription.id,
            jeton: nouveauJeton(),
            valableJusquau,
            creeParNom: acteur.nom,
          },
        });
      });
      cartes.push({
        carteId: carte.id,
        jeton: carte.jeton,
        valableJusquau: carte.valableJusquau,
        inscriptionId: inscription.id,
        personne: inscription.personne,
        annee:
          inscription.classe?.anneeAcademique.libelle ??
          inscription.anneeScolaire,
        filiere:
          inscription.classe?.filiere.nom ??
          inscription.filiereRef?.nom ??
          inscription.filiere,
        niveau: inscription.classe?.niveau ?? inscription.niveau,
      });
    }
    return cartes;
  }

  // Ce qu'affiche le contrôle quand on scanne une carte. Un code étranger est
  // refusé ; une carte connue renvoie toujours l'étudiant, avec son verdict.
  async scanner(rawCode: string | undefined) {
    const code = (rawCode ?? '').trim().toUpperCase();
    if (!FORMAT_CARTE.test(code))
      throw new BadRequestException(
        "Ce code n'est pas une carte d'étudiant IPAIM",
      );
    const carte = await this.prisma.carteEtudiant.findUnique({
      where: { jeton: code },
      include: {
        inscription: {
          include: {
            ...INSCRIPTION,
            elementsDossier: {
              where: { montantAttendu: { not: null } },
              select: {
                montantAttendu: true,
                paiements: { select: { montant: true } },
              },
            },
            absences: { where: { justifiee: false }, select: { id: true } },
          },
        },
      },
    });
    if (!carte)
      throw new NotFoundException(
        'Carte inconnue : elle ne figure pas dans le registre des cartes IPAIM',
      );
    const { inscription } = carte;
    const resteDu = inscription.elementsDossier.reduce((total, element) => {
      const paye = element.paiements.reduce(
        (somme, paiement) => somme + Number(paiement.montant),
        0,
      );
      return total + Math.max(0, Number(element.montantAttendu) - paye);
    }, 0);
    const verdict = !carte.active
      ? 'DESACTIVEE'
      : carte.valableJusquau < new Date()
        ? 'EXPIREE'
        : inscription.statut === 'ABANDONNEE'
          ? 'INSCRIPTION_ABANDONNEE'
          : 'VALIDE';
    return {
      verdict,
      carte: {
        id: carte.id,
        creeLe: carte.creeLe,
        valableJusquau: carte.valableJusquau,
        desactiveeLe: carte.desactiveeLe,
        motifDesactivation: carte.motifDesactivation,
      },
      personne: inscription.personne,
      inscription: {
        id: inscription.id,
        statut: inscription.statut,
        anneeScolaire: inscription.anneeScolaire,
        niveau: inscription.classe?.niveau ?? inscription.niveau,
        filiere:
          inscription.classe?.filiere.nom ??
          inscription.filiereRef?.nom ??
          inscription.filiere,
        classe: inscription.classe
          ? `${inscription.classe.filiere.nom} ${inscription.classe.niveau} ${inscription.classe.groupe}`
          : null,
      },
      resteDu,
      absencesNonJustifiees: inscription.absences.length,
    };
  }

  async liste(inscriptionId: string | undefined) {
    if (!inscriptionId) throw new BadRequestException("Indiquez l'inscription");
    return this.prisma.carteEtudiant.findMany({
      where: { inscriptionId },
      select: {
        id: true,
        active: true,
        valableJusquau: true,
        creeLe: true,
        creeParNom: true,
        desactiveeLe: true,
        motifDesactivation: true,
      },
      orderBy: { creeLe: 'desc' },
    });
  }

  // Carte perdue, volée ou confisquée : elle ne passe plus au contrôle.
  async desactiver(id: string, body: { motif?: unknown }) {
    const motif = typeof body.motif === 'string' ? body.motif.trim() : '';
    if (motif.length < 3)
      throw new BadRequestException('Indiquez le motif de la désactivation');
    const carte = await this.prisma.carteEtudiant.findUnique({
      where: { id },
      select: { active: true },
    });
    if (!carte) throw new NotFoundException('Carte introuvable');
    if (!carte.active)
      throw new ConflictException('Cette carte est déjà désactivée');
    return this.prisma.carteEtudiant.update({
      where: { id },
      data: {
        active: false,
        desactiveeLe: new Date(),
        motifDesactivation: motif.slice(0, 300),
      },
      select: { id: true, active: true, desactiveeLe: true },
    });
  }
}
