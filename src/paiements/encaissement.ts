import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Transaction = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export const MODES_PAIEMENT = [
  'ESPECES',
  'MOBILE_MONEY',
  'VIREMENT',
  'CHEQUE',
] as const;
export type ModePaiement = (typeof MODES_PAIEMENT)[number];

// Sans précision, un encaissement est en espèces.
export function parseModePaiement(value: unknown): ModePaiement {
  if (value === undefined || value === null || value === '') return 'ESPECES';
  const normalise = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const mode = MODES_PAIEMENT.find((item) => item === normalise);
  if (!mode)
    throw new BadRequestException(
      `modePaiement doit etre parmi: ${MODES_PAIEMENT.join(', ')}`,
    );
  return mode;
}

// Numéro de reçu : une suite sans trou par année, prise dans la transaction
// du paiement pour qu'un échec ne consomme aucun numéro.
export async function numeroRecu(transaction: Transaction, date = new Date()) {
  const cle = `RC-${date.getUTCFullYear()}`;
  const sequence = await transaction.sequenceNumero.upsert({
    where: { cle },
    create: { cle, valeur: 1 },
    update: { valeur: { increment: 1 } },
  });
  return `${cle}-${String(sequence.valeur).padStart(6, '0')}`;
}

// Deux opérations sur le même dossier passent l'une après l'autre : le
// contrôle du reste à payer et l'enregistrement forment un seul bloc.
export async function verrouillerDossier(
  transaction: Transaction,
  ...cles: Array<string | null | undefined>
) {
  for (const cle of new Set(cles))
    if (cle)
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cle}))`;
}

export async function nomUtilisateur(transaction: Transaction, id: string) {
  const utilisateur = await transaction.utilisateur.findUnique({
    where: { id },
    select: { nom: true, prenom: true },
  });
  return utilisateur
    ? [utilisateur.prenom, utilisateur.nom].filter(Boolean).join(' ')
    : null;
}
