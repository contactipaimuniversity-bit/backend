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
