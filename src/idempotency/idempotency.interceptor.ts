import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  CallHandler,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { catchError, from, mergeMap, of, throwError } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

type AuthenticatedRequest = Request & {
  user?: { sub?: string };
  idempotentReplay?: boolean;
};

const STALE_RESERVATION_MS = 2 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private lastPurgeAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const key = request.get('idempotency-key');
    const userId = request.user?.sub;
    if (request.method !== 'POST' || !key) return next.handle();
    if (!userId)
      throw new BadRequestException(
        'Une session authentifiée est requise pour cette clé.',
      );

    const requestHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? null))
      .digest('hex');
    const response = http.getResponse<Response>();

    return from(this.reserve(userId, key, requestHash)).pipe(
      mergeMap(({ record, isNew }) => {
        if (record.responseStatus !== null && record.responseBody !== null) {
          // Réponse rejouée : l'opération a déjà été journalisée la première fois.
          request.idempotentReplay = true;
          response.status(record.responseStatus);
          return of(JSON.parse(record.responseBody) as unknown);
        }
        if (!isNew)
          throw new ConflictException(
            'La demande est déjà en cours. Réessayez dans un instant.',
          );

        return next.handle().pipe(
          catchError((error: unknown) => {
            void this.prisma.idempotencyRecord
              .delete({ where: { id: record.id } })
              .catch(() => undefined);
            return throwError(() => error);
          }),
          mergeMap(async (body: unknown) => {
            await this.prisma.idempotencyRecord.update({
              where: { id: record.id },
              data: {
                responseBody: JSON.stringify(body ?? null),
                responseStatus: response.statusCode,
                completedAt: new Date(),
              },
            });
            return body;
          }),
        );
      }),
    );
  }

  private async purgeExpired() {
    if (Date.now() - this.lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.lastPurgeAt = Date.now();
    await this.prisma.idempotencyRecord
      .deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
      })
      .catch(() => undefined);
  }

  private async reserve(userId: string, key: string, requestHash: string) {
    await this.purgeExpired();
    let record = await this.prisma.idempotencyRecord.findUnique({
      where: { userId_key: { userId, key } },
    });
    let isNew = false;
    if (!record) {
      try {
        record = await this.prisma.idempotencyRecord.create({
          data: { userId, key, requestHash },
        });
        isNew = true;
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        record = await this.prisma.idempotencyRecord.findUnique({
          where: { userId_key: { userId, key } },
        });
      }
    }
    if (!record)
      throw new ConflictException(
        'La demande est déjà en cours. Réessayez dans un instant.',
      );
    // Une réservation jamais terminée (serveur interrompu en cours de
    // traitement) est reprise au lieu de bloquer la clé indéfiniment.
    if (
      !isNew &&
      record.completedAt === null &&
      Date.now() - record.createdAt.getTime() > STALE_RESERVATION_MS
    ) {
      const now = new Date();
      const taken = await this.prisma.idempotencyRecord.updateMany({
        where: {
          id: record.id,
          completedAt: null,
          createdAt: record.createdAt,
        },
        data: { requestHash, createdAt: now },
      });
      if (taken.count === 1) {
        record = { ...record, requestHash, createdAt: now };
        isNew = true;
      }
    }
    if (record.requestHash !== requestHash)
      throw new ConflictException(
        'Cette clé de synchronisation a déjà été utilisée pour une autre donnée.',
      );
    return { record, isNew };
  }
}
