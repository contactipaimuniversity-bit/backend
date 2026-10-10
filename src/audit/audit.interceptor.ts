import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { catchError, from, mergeMap, throwError } from 'rxjs';
import { toTrashSnapshot } from '../corbeille/corbeille.utils';
import { describeActivity } from '../idempotency/activity-description';
import { PrismaService } from '../prisma/prisma.service';
import { diffForAudit, sanitizeForAudit } from './audit.utils';

type AuditedRequest = Request & {
  user?: { sub?: string; nom?: string; prenom?: string };
  // Posé par l'intercepteur d'idempotence quand la réponse est rejouée.
  idempotentReplay?: boolean;
};

type FindUnique = (args: { where: { id: string } }) => Promise<unknown>;

// Journalise toute écriture (réussie ou refusée) avec ses valeurs, et l'état
// avant/après quand la route modifie un enregistrement identifiable.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<AuditedRequest>();
    const method = request.method.toUpperCase();
    if (
      ['GET', 'HEAD', 'OPTIONS'].includes(method) ||
      request.path.startsWith('/audit') ||
      // L'historique des impressions a sa propre page.
      request.path.startsWith('/impressions')
    )
      return next.handle();

    const startedAt = Date.now();
    const response = http.getResponse<Response>();
    return from(this.loadBefore(request)).pipe(
      mergeMap((before) =>
        next.handle().pipe(
          mergeMap(async (body: unknown) => {
            if (!request.idempotentReplay)
              await this.record(request, {
                statutHttp: response.statusCode,
                dureeMs: Date.now() - startedAt,
                body,
                before,
              });
            return body;
          }),
          catchError((error: unknown) =>
            from(
              this.record(request, {
                statutHttp:
                  error instanceof HttpException ? error.getStatus() : 500,
                dureeMs: Date.now() - startedAt,
                erreur: this.errorMessage(error),
                before,
              }),
            ).pipe(mergeMap(() => throwError(() => error))),
          ),
        ),
      ),
    );
  }

  private routeOf(request: AuditedRequest) {
    const matched = request.route as { path?: unknown } | undefined;
    const routePath =
      typeof matched?.path === 'string' ? matched.path : request.path;
    return `${request.baseUrl}${routePath}`;
  }

  // Enregistrement visé par la route, lu avant l'exécution pour pouvoir
  // montrer les anciennes valeurs.
  private async loadBefore(request: AuditedRequest): Promise<unknown> {
    if (!['PATCH', 'PUT', 'DELETE'].includes(request.method.toUpperCase()))
      return null;
    const delegates: Array<[RegExp, { findUnique: unknown }]> = [
      [/^\/demandes-bourse\/[^/]+(\/decision)?$/, this.prisma.demandeBourse],
      [/^\/inscriptions\/[^/]+$/, this.prisma.inscription],
      [/^\/personnes\/[^/]+$/, this.prisma.personne],
      [/^\/prospects\/[^/]+$/, this.prisma.prospect],
      [/^\/candidatures-personnel\/[^/]+$/, this.prisma.candidaturePersonnel],
      [/^\/types-bourse\/[^/]+$/, this.prisma.typeBourse],
      [/^\/elements-requis\/[^/]+$/, this.prisma.elementRequis],
      [/^\/utilisateurs\/postes\/[^/]+$/, this.prisma.poste],
      [/^\/utilisateurs\/[^/]+(\/acces)?$/, this.prisma.utilisateur],
      [/^\/paiements\/[^/]+\/affectation$/, this.prisma.paiement],
      [/^\/corbeille\/[^/]+$/, this.prisma.elementCorbeille],
      [/^\/academique\/poles\/[^/]+$/, this.prisma.pole],
      [/^\/academique\/filieres\/[^/]+$/, this.prisma.filiere],
      [/^\/depenses\/[^/]+$/, this.prisma.depense],
      [/^\/finances\/categories\/[^/]+$/, this.prisma.categorieDepense],
      [/^\/finances\/fournisseurs\/[^/]+$/, this.prisma.fournisseur],
      [/^\/finances\/exercices\/[^/]+$/, this.prisma.exerciceBudgetaire],
    ];
    const path = request.path.replace(/\/$/, '');
    const delegate = delegates.find(([pattern]) => pattern.test(path))?.[1];
    const id =
      path === '/utilisateurs/me' ? request.user?.sub : request.params?.id;
    if (!delegate || typeof id !== 'string') return null;
    try {
      const before: unknown = await (delegate.findUnique as FindUnique).call(
        delegate,
        { where: { id } },
      );
      // Le contenu archivé de la corbeille est volumineux et déjà conservé.
      if (before && path.startsWith('/corbeille/'))
        return { ...before, donnees: undefined };
      return before;
    } catch {
      return null;
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const payload = error.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : (payload as { message?: string | string[] }).message;
      return (
        Array.isArray(message) ? message.join(', ') : (message ?? '')
      ).slice(0, 500);
    }
    return 'Erreur interne du serveur';
  }

  private async record(
    request: AuditedRequest,
    result: {
      statutHttp: number;
      dureeMs: number;
      body?: unknown;
      before?: unknown;
      erreur?: string;
    },
  ) {
    const method = request.method.toUpperCase();
    const isLogin = request.path === '/auth/login';
    const responseBody =
      result.body && typeof result.body === 'object'
        ? (result.body as Record<string, unknown>)
        : null;
    const loginUser = isLogin
      ? (responseBody?.utilisateur as
          { id?: string; nom?: string; prenom?: string | null } | undefined)
      : undefined;
    const requestBody = (request.body ?? null) as Record<
      string,
      unknown
    > | null;
    const utilisateurId = request.user?.sub ?? loginUser?.id ?? 'anonyme';
    const identity = request.user ?? loginUser;
    const utilisateurNom =
      [identity?.prenom, identity?.nom].filter(Boolean).join(' ') ||
      (isLogin && typeof requestBody?.email === 'string'
        ? requestBody.email.slice(0, 120)
        : utilisateurId);
    // Sans utilisateur identifié, seules les tentatives de connexion comptent.
    if (utilisateurId === 'anonyme' && !isLogin) return;

    const failed = result.statutHttp >= 400;
    const described = isLogin
      ? {
          action: failed ? 'Échec de connexion' : 'Connexion',
          ressource: 'session',
        }
      : describeActivity(method, this.routeOf(request));
    const parameterId = request.params?.id;
    const entiteId =
      !isLogin && typeof responseBody?.id === 'string'
        ? responseBody.id
        : typeof parameterId === 'string'
          ? parameterId
          : null;
    const modifications = failed
      ? []
      : method === 'DELETE'
        ? []
        : diffForAudit(result.before, result.body);

    try {
      await this.prisma.journalActivite.create({
        data: {
          utilisateurId,
          utilisateurNom,
          action:
            failed && !isLogin
              ? `Refusé · ${described.action}`
              : described.action,
          ressource: described.ressource,
          entiteId,
          methode: method,
          chemin: request.originalUrl.split('?')[0].slice(0, 300),
          statutHttp: result.statutHttp,
          dureeMs: result.dureeMs,
          ip: (request.ip ?? '').slice(0, 64) || null,
          navigateur: (request.get('user-agent') ?? '').slice(0, 300) || null,
          erreur: result.erreur || null,
          donnees: toTrashSnapshot({
            envoye: sanitizeForAudit(requestBody),
            ...(method === 'DELETE' && result.before
              ? { supprime: sanitizeForAudit(result.before) }
              : {}),
          }),
          modifications: toTrashSnapshot(modifications),
        },
      });
    } catch {
      // La journalisation ne doit jamais faire échouer l'opération métier.
    }
  }
}
