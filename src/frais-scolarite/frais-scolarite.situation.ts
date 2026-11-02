import type { Prisma } from '../../generated/prisma/client';
import { verrouillerDossier } from '../paiements/encaissement';
import type { PrismaService } from '../prisma/prisma.service';
import {
  arrondir,
  fusionnerPlan,
  planCible,
  regimeDe,
  repartir,
  tarifDe,
} from './frais-scolarite.rules';

type Client = Prisma.TransactionClient;

// Échéancier d'un étudiant : partagé par la caisse, les rapports et les bulletins.

const inclureBourse = {
  demandeBourse: {
    select: {
      statut: true,
      typeBourse: { include: { echeances: { orderBy: { ordre: 'asc' } } } },
    },
  },
} satisfies Prisma.InscriptionInclude;

type InscriptionBourse = Prisma.InscriptionGetPayload<{
  include: typeof inclureBourse;
}>;

// La bourse ne compte qu'acceptée, et tant qu'elle n'a pas été retirée.
function bourseDe(inscription: InscriptionBourse) {
  const demande = inscription.demandeBourse;
  if (inscription.bourseRetireeLe || demande?.statut !== 'ACCEPTEE')
    return null;
  return demande.typeBourse;
}

// Ce qu'on a versé sur les mois : un paiement annulé ne compte plus.
export async function verseMensualites(client: Client, inscriptionId: string) {
  const total = await client.paiement.aggregate({
    where: {
      inscriptionId,
      typePaiement: 'MENSUALITE',
      annulation: { is: null },
    },
    _sum: { montant: true },
  });
  return Number(total._sum.montant ?? 0);
}

async function cibleDe(client: Client, inscription: InscriptionBourse) {
  const [mois, tarifs] = await Promise.all([
    client.moisScolarite.findMany({
      where: { anneeScolaire: inscription.anneeScolaire },
      orderBy: { ordre: 'asc' },
    }),
    client.tarifScolarite.findMany({ where: { niveau: inscription.niveau } }),
  ]);
  const bourse = bourseDe(inscription);
  return planCible({
    mois,
    tarif: tarifDe(
      tarifs.map((tarif) => ({
        niveau: tarif.niveau,
        filiereId: tarif.filiereId,
        montantMensuel: Number(tarif.montantMensuel),
      })),
      inscription.niveau,
      inscription.filiereId,
    ),
    bourse: bourse && {
      nom: bourse.nom,
      modeScolarite: bourse.modeScolarite,
      tauxReduction:
        bourse.tauxReduction === null ? null : Number(bourse.tauxReduction),
      echeances: bourse.echeances.map((echeance) => ({
        libelle: echeance.libelle,
        dateEcheance: echeance.dateEcheance,
        montantAttendu:
          echeance.montantAttendu === null
            ? null
            : Number(echeance.montantAttendu),
      })),
    },
    reductionIndividuelle:
      inscription.reductionIndividuelle === null
        ? null
        : Number(inscription.reductionIndividuelle),
  });
}

// Frais annexes du groupe de l'étudiant, s'ils ne sont pas déjà sur son échéancier.
async function ajouterAnnexesDuGroupe(
  client: Client,
  inscription: {
    id: string;
    anneeScolaire: string;
    niveau: string;
    filiereId: string | null;
  },
) {
  const annexes = await client.fraisAnnexe.findMany({
    where: {
      actif: true,
      cible: 'GROUPE',
      anneeScolaire: inscription.anneeScolaire,
      OR: [{ niveau: null }, { niveau: inscription.niveau }],
      AND: [
        { OR: [{ filiereId: null }, { filiereId: inscription.filiereId }] },
      ],
    },
  });
  if (!annexes.length) return;
  await client.ligneScolarite.createMany({
    data: annexes.map((annexe, index) => ({
      inscriptionId: inscription.id,
      type: 'ANNEXE',
      ordre: index + 1,
      libelle: annexe.nom,
      dateLimite: annexe.dateLimite,
      montant: annexe.montant,
      fraisAnnexeId: annexe.id,
    })),
    skipDuplicates: true,
  });
}

// Crée l'échéancier à la première lecture : l'inscription et le paramétrage
// peuvent arriver dans n'importe quel ordre.
export async function assurerEcheancier(
  prisma: PrismaService,
  inscriptionId: string,
) {
  const dejaFait = await prisma.ligneScolarite.count({
    where: { inscriptionId, type: 'MENSUALITE' },
  });
  if (dejaFait) return;
  await prisma.$transaction(async (transaction) => {
    await verrouillerDossier(transaction, inscriptionId);
    const inscription = await transaction.inscription.findUnique({
      where: { id: inscriptionId },
      include: inclureBourse,
    });
    if (!inscription || inscription.echeancierPersonnalise) return;
    const existantes = await transaction.ligneScolarite.count({
      where: { inscriptionId, type: 'MENSUALITE' },
    });
    if (existantes) return;
    const cible = await cibleDe(transaction, inscription);
    await transaction.ligneScolarite.createMany({
      data: cible.map((ligne, index) => ({
        inscriptionId,
        type: 'MENSUALITE',
        ordre: index + 1,
        libelle: ligne.libelle,
        dateLimite: ligne.dateLimite,
        montant: arrondir(ligne.montant).toFixed(2),
      })),
    });
    await ajouterAnnexesDuGroupe(transaction, inscription);
  });
}

// Refait les mois d'après le paramétrage, sans toucher à ce qui est déjà payé.
export async function recalculerEcheancier(
  client: Client,
  inscriptionId: string,
  aPartirDe: Date | null = null,
) {
  await verrouillerDossier(client, inscriptionId);
  const inscription = await client.inscription.findUnique({
    where: { id: inscriptionId },
    include: inclureBourse,
  });
  if (!inscription) return;
  const lignes = await client.ligneScolarite.findMany({
    where: { inscriptionId, type: 'MENSUALITE' },
  });
  const { conservees, nouvelles } = fusionnerPlan(
    lignes.map((ligne) => ({
      id: ligne.id,
      libelle: ligne.libelle,
      dateLimite: ligne.dateLimite,
      ordre: ligne.ordre,
      montant: Number(ligne.montant),
    })),
    await verseMensualites(client, inscriptionId),
    await cibleDe(client, inscription),
    aPartirDe,
  );
  await client.ligneScolarite.deleteMany({
    where: {
      inscriptionId,
      type: 'MENSUALITE',
      id: { notIn: conservees.map((ligne) => ligne.id) },
    },
  });
  const dernierOrdre = Math.max(0, ...conservees.map((ligne) => ligne.ordre));
  await client.ligneScolarite.createMany({
    data: nouvelles.map((ligne, index) => ({
      inscriptionId,
      type: 'MENSUALITE',
      ordre: dernierOrdre + index + 1,
      libelle: ligne.libelle,
      dateLimite: ligne.dateLimite,
      montant: arrondir(ligne.montant).toFixed(2),
    })),
  });
}

export async function appliquerAnnexeAuGroupe(
  client: Client,
  annexe: {
    anneeScolaire: string;
    niveau: string | null;
    filiereId: string | null;
  },
) {
  const inscriptions = await client.inscription.findMany({
    where: {
      anneeScolaire: annexe.anneeScolaire,
      statut: { not: 'ABANDONNEE' },
      ...(annexe.niveau ? { niveau: annexe.niveau } : {}),
      ...(annexe.filiereId ? { filiereId: annexe.filiereId } : {}),
    },
    select: { id: true, anneeScolaire: true, niveau: true, filiereId: true },
  });
  for (const inscription of inscriptions)
    await ajouterAnnexesDuGroupe(client, inscription);
  return inscriptions.length;
}

// Tout ce que doit un étudiant, avec ce qui est réglé mois par mois.
export async function situationScolarite(
  prisma: PrismaService,
  inscriptionId: string,
) {
  await assurerEcheancier(prisma, inscriptionId);
  const inscription = await prisma.inscription.findUnique({
    where: { id: inscriptionId },
    include: {
      ...inclureBourse,
      lignesScolarite: {
        include: { paiements: { select: { montant: true } } },
        orderBy: { ordre: 'asc' },
      },
    },
  });
  if (!inscription) return null;
  const verse = await verseMensualites(prisma, inscriptionId);
  const mensualites = repartir(
    inscription.lignesScolarite
      .filter((ligne) => ligne.type === 'MENSUALITE')
      .map((ligne) => ({
        id: ligne.id,
        libelle: ligne.libelle,
        dateLimite: ligne.dateLimite,
        ordre: ligne.ordre,
        montant: Number(ligne.montant),
      })),
    verse,
  );
  const annexes = inscription.lignesScolarite
    .filter((ligne) => ligne.type === 'ANNEXE')
    .map((ligne) => {
      const montant = Number(ligne.montant);
      const paye = arrondir(
        ligne.paiements.reduce(
          (total, paiement) => total + Number(paiement.montant),
          0,
        ),
      );
      return {
        id: ligne.id,
        libelle: ligne.libelle,
        dateLimite: ligne.dateLimite,
        ordre: ligne.ordre,
        montant,
        paye,
        reste: arrondir(Math.max(0, montant - paye)),
        fraisAnnexeId: ligne.fraisAnnexeId,
      };
    });
  const somme = (valeurs: number[]) =>
    arrondir(valeurs.reduce((total, valeur) => total + valeur, 0));
  const bourse = bourseDe(inscription);
  return {
    inscriptionId,
    anneeScolaire: inscription.anneeScolaire,
    regime: regimeDe({
      bourse,
      reductionIndividuelle:
        inscription.reductionIndividuelle === null
          ? null
          : Number(inscription.reductionIndividuelle),
      bourseRetiree: inscription.bourseRetireeLe !== null,
      personnalise: inscription.echeancierPersonnalise,
    }),
    reductionIndividuelle:
      inscription.reductionIndividuelle === null
        ? null
        : Number(inscription.reductionIndividuelle),
    personnalise: inscription.echeancierPersonnalise,
    bourseRetiree: inscription.bourseRetireeLe !== null,
    mensualites,
    annexes,
    resteMensualites: somme(mensualites.map((ligne) => ligne.reste)),
    resteAnnexes: somme(annexes.map((ligne) => ligne.reste)),
    resteTotal: somme([...mensualites, ...annexes].map((ligne) => ligne.reste)),
  };
}

// Ce qui est échu et non soldé, pour un étudiant ou pour tous.
export async function retardsScolarite(
  prisma: PrismaService,
  maintenant = new Date(),
) {
  await assurerTousLesEcheanciers(prisma);
  const inscriptions = await prisma.inscription.findMany({
    where: {
      statut: { not: 'ABANDONNEE' },
      lignesScolarite: { some: {} },
    },
    select: { id: true },
  });
  const retards: Array<{
    inscriptionId: string;
    regime: string;
    echues: Array<{
      libelle: string;
      dateLimite: Date | null;
      montant: number;
      paye: number;
      reste: number;
    }>;
    resteEchu: number;
    resteTotal: number;
  }> = [];
  for (const { id } of inscriptions) {
    const situation = await situationScolarite(prisma, id);
    if (!situation) continue;
    const echues = [...situation.mensualites, ...situation.annexes].filter(
      (ligne) =>
        ligne.reste > 0 &&
        ligne.dateLimite !== null &&
        ligne.dateLimite < maintenant,
    );
    if (echues.length)
      retards.push({
        inscriptionId: id,
        regime: situation.regime,
        echues,
        resteEchu: arrondir(
          echues.reduce((total, ligne) => total + ligne.reste, 0),
        ),
        resteTotal: situation.resteTotal,
      });
  }
  return retards;
}

export async function assurerTousLesEcheanciers(prisma: PrismaService) {
  const sansLignes = await prisma.inscription.findMany({
    where: {
      statut: { not: 'ABANDONNEE' },
      echeancierPersonnalise: false,
      lignesScolarite: { none: { type: 'MENSUALITE' } },
    },
    select: { id: true },
  });
  for (const { id } of sansLignes) await assurerEcheancier(prisma, id);
}

// Reste à recouvrer sur toute la scolarité (bourses et inscriptions ont le leur).
export async function resteTotalScolarite(prisma: PrismaService) {
  await assurerTousLesEcheanciers(prisma);
  const inscriptions = await prisma.inscription.findMany({
    where: { statut: { not: 'ABANDONNEE' }, lignesScolarite: { some: {} } },
    select: { id: true },
  });
  let total = 0;
  for (const { id } of inscriptions) {
    const situation = await situationScolarite(prisma, id);
    total += situation?.resteTotal ?? 0;
  }
  return arrondir(total);
}
