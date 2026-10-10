import { Request } from 'express';
import { describeActivity } from '../idempotency/activity-description';
import { PrismaService } from '../prisma/prisma.service';

// Les refus d'accès sont décidés par les guards, avant les intercepteurs :
// ils sont journalisés ici pour apparaître dans l'audit.
export async function logDeniedAccess(
  prisma: PrismaService,
  request: Request,
  user: { sub: string; nom?: string; prenom?: string },
  reason: string,
): Promise<void> {
  const { ressource } = describeActivity(request.method, request.path);
  try {
    await prisma.journalActivite.create({
      data: {
        utilisateurId: user.sub,
        utilisateurNom:
          [user.prenom, user.nom].filter(Boolean).join(' ') || user.sub,
        action: 'Accès refusé',
        ressource,
        methode: request.method.toUpperCase(),
        chemin: request.originalUrl.split('?')[0].slice(0, 300),
        statutHttp: 403,
        ip: (request.ip ?? '').slice(0, 64) || null,
        navigateur: (request.get('user-agent') ?? '').slice(0, 300) || null,
        erreur: reason,
      },
    });
  } catch {
    // La journalisation ne doit jamais masquer le refus lui-même.
  }
}
