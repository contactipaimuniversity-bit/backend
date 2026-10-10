import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

export function requiredDeletionReason(value: string | undefined) {
  const reason = value?.trim();
  if (!reason || reason.length < 5) {
    throw new BadRequestException(
      'Le motif de suppression doit contenir au moins 5 caractères',
    );
  }
  if (reason.length > 500) {
    throw new BadRequestException(
      'Le motif de suppression ne peut dépasser 500 caractères',
    );
  }
  return reason;
}

export function toTrashSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// Auteur d'une suppression, tel qu'il est affiché dans la corbeille.
export async function trashAuthor(
  transaction: Prisma.TransactionClient,
  userId: string,
) {
  const author = await transaction.utilisateur.findUnique({
    where: { id: userId },
    select: { id: true, nom: true, prenom: true },
  });
  return {
    supprimeParId: author?.id ?? null,
    supprimeParNom:
      [author?.prenom, author?.nom].filter(Boolean).join(' ') ||
      'Utilisateur inconnu',
  };
}
