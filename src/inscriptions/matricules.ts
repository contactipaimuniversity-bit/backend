import type { PrismaService } from '../prisma/prisma.service';

// Le matricule est donné à l'étudiant dès que ses frais d'inscription sont
// entièrement payés (une exonération compte comme payée), une fois pour toutes :
// une annulation ou un abandon ne le retirent pas. Format : année d'entrée
// sur deux chiffres, code de la filière, numéro d'ordre de l'année.

const RESTE_TOLERE = 0.005;

type Candidat = {
  id: string;
  personneId: string;
  anneeScolaire: string;
  filiereRef: { code: string } | null;
  elementsDossier: Array<{
    montantAttendu: unknown;
    paiements: Array<{ montant: unknown }>;
  }>;
};

export function fraisInscriptionPayes(
  inscription: Pick<Candidat, 'elementsDossier'>,
) {
  const frais = inscription.elementsDossier;
  return (
    frais.length > 0 &&
    frais.every(
      (element) =>
        element.paiements.reduce(
          (total, paiement) => total + Number(paiement.montant),
          0,
        ) >=
        Number(element.montantAttendu) - RESTE_TOLERE,
    )
  );
}

export const prefixeMatricule = (anneeScolaire: string) =>
  anneeScolaire.slice(2, 4);

// Sans liste, tous les dossiers en attente de matricule sont examinés : les
// étudiants qui avaient déjà payé avant cette règle reçoivent le leur aussi.
export async function attribuerMatricules(
  prisma: PrismaService,
  inscriptionIds?: string[],
) {
  const candidats: Candidat[] = await prisma.inscription.findMany({
    where: {
      statut: { not: 'ABANDONNEE' },
      filiereId: { not: null },
      personne: { matricule: null },
      ...(inscriptionIds ? { id: { in: inscriptionIds } } : {}),
    },
    select: {
      id: true,
      personneId: true,
      anneeScolaire: true,
      filiereRef: { select: { code: true } },
      elementsDossier: {
        where: {
          montantAttendu: { not: null },
          elementRequis: { categorie: 'FRAIS' },
        },
        select: {
          montantAttendu: true,
          paiements: { select: { montant: true } },
        },
      },
    },
    orderBy: { dateInscription: 'asc' },
  });
  let attribues = 0;
  for (const inscription of candidats.filter(fraisInscriptionPayes)) {
    if (!inscription.filiereRef) continue;
    const debut = prefixeMatricule(inscription.anneeScolaire);
    const code = inscription.filiereRef.code;
    attribues += await prisma.$transaction(async (transaction) => {
      // Une seule attribution à la fois pour une personne.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`matricule-${inscription.personneId}`}))`;
      const personne = await transaction.personne.findUnique({
        where: { id: inscription.personneId },
        select: { matricule: true },
      });
      if (!personne || personne.matricule) return 0;
      const cle = `ETU-${debut}`;
      const sequence = await transaction.sequenceNumero.upsert({
        where: { cle },
        create: { cle, valeur: 1 },
        update: { valeur: { increment: 1 } },
      });
      await transaction.personne.update({
        where: { id: inscription.personneId },
        data: {
          matricule: `${debut}${code}${String(sequence.valeur).padStart(4, '0')}`,
        },
      });
      return 1;
    });
  }
  return attribues;
}
