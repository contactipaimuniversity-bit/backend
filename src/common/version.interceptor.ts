import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { from, mergeMap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

// Une modification préparée hors ligne porte la version de la fiche que
// l'appareil connaissait (en-tête X-Version-Connue). Si la fiche a changé
// depuis, on refuse plutôt que d'écraser le travail d'un collègue : la
// personne reprendra sa modification en ligne, sur la fiche à jour.
const FICHES =
  /^\/(personnes|prospects|demandes-bourse|inscriptions|candidatures-personnel)\/([^/]+)\/?$/;

@Injectable()
export class VersionInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    const connue = new Date(request.get('x-version-connue') ?? '');
    const fiche = request.path.match(FICHES);
    if (request.method !== 'PATCH' || !fiche || Number.isNaN(connue.getTime()))
      return next.handle();

    return from(this.modifieLe(fiche[1], fiche[2])).pipe(
      mergeMap((modifieLe) => {
        if (modifieLe && modifieLe.getTime() > connue.getTime())
          throw new ConflictException(
            'Cette fiche a été modifiée par quelqu’un d’autre pendant que vous étiez hors ligne. Votre modification n’a pas été appliquée : reprenez-la maintenant que vous êtes connecté.',
          );
        return next.handle();
      }),
    );
  }

  private async modifieLe(ressource: string, id: string) {
    const where = { where: { id }, select: { modifieLe: true } };
    const fiche =
      ressource === 'personnes'
        ? await this.prisma.personne.findUnique(where)
        : ressource === 'prospects'
          ? await this.prisma.prospect.findUnique(where)
          : ressource === 'demandes-bourse'
            ? await this.prisma.demandeBourse.findUnique(where)
            : ressource === 'inscriptions'
              ? await this.prisma.inscription.findUnique(where)
              : await this.prisma.candidaturePersonnel.findUnique(where);
    return fiche?.modifieLe;
  }
}
