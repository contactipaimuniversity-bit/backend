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
import { describeActivity } from './activity-description';

type AuthenticatedRequest = Request & { user?: { sub?: string; nom?: string; prenom?: string } };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const key = request.get('idempotency-key');
    const userId = request.user?.sub;
    if (request.method !== 'POST' || !key) {
      if (!userId || ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return next.handle();
      return next.handle().pipe(
        mergeMap(async (body: unknown) => {
          await this.recordActivity(request, body);
          return body;
        }),
      );
    }
    if (!userId) throw new BadRequestException('Une session authentifiée est requise pour cette clé.');

    const requestHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? null))
      .digest('hex');
    const response = http.getResponse<Response>();

    return from(this.reserve(userId, key, requestHash)).pipe(
      mergeMap(({ record, isNew }) => {
        if (record.responseStatus !== null && record.responseBody !== null) {
          response.status(record.responseStatus);
          return of(JSON.parse(record.responseBody) as unknown);
        }
        if (!isNew)
          throw new ConflictException('La demande est déjà en cours. Réessayez dans un instant.');

        return next.handle().pipe(
          catchError((error: unknown) => {
            void this.prisma.idempotencyRecord.delete({ where: { id: record.id } }).catch(() => undefined);
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
            await this.recordActivity(request, body);
            return body;
          }),
        );
      }),
    );
  }

  private async recordActivity(request: AuthenticatedRequest, body: unknown) {
    const userId = request.user?.sub;
    if (!userId) return;
    const routePath = typeof request.route?.path === 'string' ? request.route.path : request.path;
    const route = `${request.baseUrl}${routePath}`;
    const { action, ressource } = describeActivity(request.method, route);
    const response = body && typeof body === 'object' && !Array.isArray(body)
      ? body as { id?: unknown }
      : null;
    const parameterId = request.params?.id;
    const entiteId = typeof response?.id === 'string'
      ? response.id
      : typeof parameterId === 'string'
        ? parameterId
        : null;
    const utilisateurNom = [request.user?.prenom, request.user?.nom].filter(Boolean).join(' ') || userId;
    try {
      await this.prisma.journalActivite.create({
        data: { utilisateurId: userId, utilisateurNom, action, ressource, entiteId },
      });
    } catch {
      // Activity logging must never turn a successful business operation into an error.
    }
  }

  private async reserve(userId: string, key: string, requestHash: string) {
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
    if (!record) throw new ConflictException('La demande est déjà en cours. Réessayez dans un instant.');
    if (record.requestHash !== requestHash)
      throw new ConflictException('Cette clé de synchronisation a déjà été utilisée pour une autre donnée.');
    return { record, isNew };
  }
}