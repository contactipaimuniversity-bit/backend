import type { Prisma } from '../../generated/prisma/client';
import { verrouillerDossier } from '../paiements/encaissement';
import type { PrismaService } from '../prisma/prisma.service';
import {
  arrondir,
  avecExceptions,
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

type Mois = { anneeScolaire: string; libelle: string; dateLimite: Date };
type Tarif = {
  niveau: string;
  filiereId: string | null;
  montantMensuel: Prisma.Decimal;
};

const enNombre = (valeur: Prisma.Decimal | null) =>
  valeur === null ? null : Number(valeur);

// Ce que l'étudiant devrait payer d'après le paramétrage du moment et ses exceptions.
function cibleDe(inscription: InscriptionSync, mois: Mois[], tarifs: Tarif[]) {
  const bourse = bourseDe(inscription);
  const cible = planCible({
    mois: mois.filter(
      (item) => item.anneeScolaire === inscription.anneeScolaire,
    ),
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
      tauxReduction: enNombre(bourse.tauxReduction),
      echeances: bourse.echeances.map((echeance) => ({
        libelle: echeance.libelle,
        dateEcheance: echeance.dateEcheance,
        montantAttendu: enNombre(echeance.montantAttendu),
      })),
    },
    reductionIndividuelle: enNombre(inscription.reductionIndividuelle),
  });
  return avecExceptions(
    cible,
    new Map(
      inscription.exceptionsScolarite.flatMap((exception) =>
        exception.mois
          ? [
              [
                exception.mois,
                { mode: exception.mode, valeur: enNombre(exception.valeur) },
              ] as const,
            ]
          : [],
      ),
    ),
  );
}

const inclureSync = {
  ...inclureBourse,
  exceptionsScolarite: {
    where: { mois: { not: null } },
    select: { mois: true, mode: true, valeur: true },
  },
  lignesScolarite: {
    where: { type: 'MENSUALITE' },
    select: {
      id: true,
      libelle: true,
      dateLimite: true,
      ordre: true,
      montant: true,
    },
  },
} satisfies Prisma.InscriptionInclude;

type InscriptionSync = Prisma.InscriptionGetPayload<{
  include: typeof inclureSync;
}>;

// Les échéanciers qui ne correspondent plus au paramétrage, avec ce qu'il faut
// y changer. Les échéanciers retouchés à la main ne sont jamais touchés, et sans
// calendrier ni tarif on ne retire rien.
async function changementsDe(client: Client, ids?: string[]) {
  // Lectures l'une après l'autre : dans une transaction, elles partagent une connexion.
  const inscriptions = await client.inscription.findMany({
    where: {
      statut: { not: 'ABANDONNEE' },
      echeancierPersonnalise: false,
      ...(ids ? { id: { in: ids } } : {}),
    },
    include: inclureSync,
  });
  if (!inscriptions.length) return [];
  const mois = await client.moisScolarite.findMany({
    orderBy: { ordre: 'asc' },
  });
  const tarifs = await client.tarifScolarite.findMany();
  const verses = await client.paiement.groupBy({
    by: ['inscriptionId'],
    where: {
      typePaiement: 'MENSUALITE',
      annulation: { is: null },
      ...(ids ? { inscriptionId: { in: ids } } : {}),
    },
    _sum: { montant: true },
  });
  const verseDe = new Map(
    verses.map((item) => [item.inscriptionId, Number(item._sum.montant ?? 0)]),
  );
  return inscriptions.flatMap((inscription) => {
    const cible = cibleDe(inscription, mois, tarifs);
    if (!cible.length) return [];
    const plan = fusionnerPlan(
      inscription.lignesScolarite.map((ligne) => ({
        ...ligne,
        montant: Number(ligne.montant),
      })),
      verseDe.get(inscription.id) ?? 0,
      cible,
      inscription.bourseRetireeLe,
    );
    return plan.change ? [{ inscription, plan }] : [];
  });
}

async function appliquerChangements(
  client: Client,
  changements: Awaited<ReturnType<typeof changementsDe>>,
) {
  const supprimees = changements.flatMap(({ plan }) => plan.supprimees);
  if (supprimees.length)
    await client.ligneScolarite.deleteMany({
      where: { id: { in: supprimees } },
    });
  for (const { plan } of changements)
    for (const ligne of plan.modifiees)
      await client.ligneScolarite.update({
        where: { id: ligne.id },
        data: {
          montant: ligne.montant.toFixed(2),
          dateLimite: ligne.dateLimite,
        },
      });
  const nouvelles = changements.flatMap(({ inscription, plan }) => {
    const dernierOrdre = Math.max(
      0,
      ...inscription.lignesScolarite.map((ligne) => ligne.ordre),
    );
    return plan.nouvelles.map((ligne, index) => ({
      inscriptionId: inscription.id,
      type: 'MENSUALITE',
      ordre: dernierOrdre + index + 1,
      libelle: ligne.libelle,
      dateLimite: ligne.dateLimite,
      montant: arrondir(ligne.montant).toFixed(2),
    }));
  });
  if (nouvelles.length)
    await client.ligneScolarite.createMany({ data: nouvelles });
  // Un échéancier tout neuf reçoit aussi les frais annexes de son groupe.
  for (const { inscription } of changements)
    if (!inscription.lignesScolarite.length)
      await ajouterAnnexesDuGroupe(client, inscription);
}

// Un seul recalcul à la fois : deux lectures simultanées ne doublent pas les mois.
const VERROU_ECHEANCIERS = 'echeanciers-scolarite';

// Met les échéanciers d'accord avec le paramétrage, dans une transaction ouverte.
export async function recalculerEcheanciers(client: Client, ids?: string[]) {
  await verrouillerDossier(client, VERROU_ECHEANCIERS);
  const changements = await changementsDe(client, ids);
  await appliquerChangements(client, changements);
  return changements.length;
}

export const recalculerEcheancier = (client: Client, inscriptionId: string) =>
  recalculerEcheanciers(client, [inscriptionId]);

// Le paramétrage s'applique tout seul : à chaque enregistrement et à chaque
// lecture. Rien n'est écrit quand tout est déjà à jour.
export async function synchroniserEcheanciers(
  prisma: PrismaService,
  ids?: string[],
) {
  const aFaire = await changementsDe(prisma, ids);
  if (!aFaire.length) return 0;
  return prisma.$transaction(
    (transaction) =>
      recalculerEcheanciers(
        transaction,
        aFaire.map(({ inscription }) => inscription.id),
      ),
    { maxWait: 15_000, timeout: 60_000 },
  );
}

export const assurerEcheancier = (
  prisma: PrismaService,
  inscriptionId: string,
) => synchroniserEcheanciers(prisma, [inscriptionId]);

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
      exceptionsScolarite: true,
      elementsDossier: {
        where: { montantAttendu: { not: null } },
        include: {
          elementRequis: { select: { nom: true } },
          paiements: { select: { montant: true } },
        },
        orderBy: { elementRequis: { nom: 'asc' } },
      },
    },
  });
  if (!inscription) return null;
  const exceptionDe = (
    exception: (typeof inscription.exceptionsScolarite)[number] | undefined,
  ) =>
    exception
      ? {
          id: exception.id,
          mode: exception.mode,
          valeur: enNombre(exception.valeur),
          montantInitial: Number(exception.montantInitial),
          motif: exception.motif,
          parNom: exception.parNom,
          le: exception.le,
        }
      : null;
  const exceptionDuMois = (libelle: string) =>
    exceptionDe(
      inscription.exceptionsScolarite.find((item) => item.mois === libelle),
    );
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
  ).map((ligne) => ({ ...ligne, exception: exceptionDuMois(ligne.libelle) }));
  const fraisInscription = inscription.elementsDossier.map((element) => {
    const montant = Number(element.montantAttendu);
    const paye = arrondir(
      element.paiements.reduce(
        (total, paiement) => total + Number(paiement.montant),
        0,
      ),
    );
    return {
      id: element.id,
      libelle: element.elementRequis.nom,
      montant,
      paye,
      reste: arrondir(Math.max(0, montant - paye)),
      exception: exceptionDe(
        inscription.exceptionsScolarite.find(
          (item) => item.elementDossierId === element.id,
        ),
      ),
    };
  });
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
    fraisInscription,
    // Versé au-delà de tous les mois (un mois retiré après paiement, par exemple).
    tropPercu: arrondir(
      Math.max(0, verse - somme(mensualites.map((ligne) => ligne.montant))),
    ),
    resteMensualites: somme(mensualites.map((ligne) => ligne.reste)),
    resteAnnexes: somme(annexes.map((ligne) => ligne.reste)),
    resteTotal: somme([...mensualites, ...annexes].map((ligne) => ligne.reste)),
  };
}

// Toutes les situations d'un coup, pour les rapports : une poignée de requêtes,
// quel que soit le nombre d'étudiants (les rapports s'ouvrent à chaque accueil).
async function toutesLesSituations(prisma: PrismaService) {
  await assurerTousLesEcheanciers(prisma);
  const [lignes, verses, inscriptions] = await Promise.all([
    prisma.ligneScolarite.findMany({
      where: { inscription: { statut: { not: 'ABANDONNEE' } } },
      select: {
        id: true,
        inscriptionId: true,
        type: true,
        libelle: true,
        dateLimite: true,
        ordre: true,
        montant: true,
        paiements: { select: { montant: true } },
      },
    }),
    prisma.paiement.groupBy({
      by: ['inscriptionId'],
      where: { typePaiement: 'MENSUALITE', annulation: { is: null } },
      _sum: { montant: true },
    }),
    prisma.inscription.findMany({
      where: { statut: { not: 'ABANDONNEE' }, lignesScolarite: { some: {} } },
      select: {
        id: true,
        reductionIndividuelle: true,
        echeancierPersonnalise: true,
        bourseRetireeLe: true,
        demandeBourse: {
          select: { statut: true, typeBourse: { select: { nom: true } } },
        },
      },
    }),
  ]);
  const verseDe = new Map(
    verses.map((item) => [item.inscriptionId, Number(item._sum.montant ?? 0)]),
  );
  return inscriptions.map((inscription) => {
    const siennes = lignes.filter(
      (ligne) => ligne.inscriptionId === inscription.id,
    );
    const mensualites = repartir(
      siennes
        .filter((ligne) => ligne.type === 'MENSUALITE')
        .map((ligne) => ({
          libelle: ligne.libelle,
          dateLimite: ligne.dateLimite,
          ordre: ligne.ordre,
          montant: Number(ligne.montant),
        })),
      verseDe.get(inscription.id) ?? 0,
    );
    const annexes = siennes
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
          libelle: ligne.libelle,
          dateLimite: ligne.dateLimite,
          ordre: ligne.ordre,
          montant,
          paye,
          reste: arrondir(Math.max(0, montant - paye)),
        };
      });
    const toutes = [...mensualites, ...annexes];
    const demande = inscription.demandeBourse;
    const bourse =
      !inscription.bourseRetireeLe && demande?.statut === 'ACCEPTEE'
        ? demande.typeBourse
        : null;
    return {
      inscriptionId: inscription.id,
      regime: regimeDe({
        bourse,
        reductionIndividuelle:
          inscription.reductionIndividuelle === null
            ? null
            : Number(inscription.reductionIndividuelle),
        bourseRetiree: inscription.bourseRetireeLe !== null,
        personnalise: inscription.echeancierPersonnalise,
      }),
      lignes: toutes,
      resteTotal: arrondir(
        toutes.reduce((total, ligne) => total + ligne.reste, 0),
      ),
    };
  });
}

// Ce qui est échu et non soldé, pour tous les étudiants.
export async function retardsScolarite(
  prisma: PrismaService,
  maintenant = new Date(),
) {
  return (await toutesLesSituations(prisma)).flatMap((situation) => {
    const echues = situation.lignes.filter(
      (ligne) =>
        ligne.reste > 0 &&
        ligne.dateLimite !== null &&
        ligne.dateLimite < maintenant,
    );
    return echues.length
      ? [
          {
            inscriptionId: situation.inscriptionId,
            regime: situation.regime,
            echues,
            resteEchu: arrondir(
              echues.reduce((total, ligne) => total + ligne.reste, 0),
            ),
            resteTotal: situation.resteTotal,
          },
        ]
      : [];
  });
}

// Tous les échéanciers d'accord avec le paramétrage, avant un rapport.
export async function assurerTousLesEcheanciers(prisma: PrismaService) {
  await synchroniserEcheanciers(prisma);
}

// Reste à recouvrer sur toute la scolarité (bourses et inscriptions ont le leur).
export async function resteTotalScolarite(prisma: PrismaService) {
  return arrondir(
    (await toutesLesSituations(prisma)).reduce(
      (total, situation) => total + situation.resteTotal,
      0,
    ),
  );
}
