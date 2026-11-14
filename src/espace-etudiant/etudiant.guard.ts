import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

// Jeton d'un étudiant : distinct de celui du personnel (champ typ), il n'ouvre
// que les routes /etudiant/moi, et seulement sur ses propres données.
export type JetonEtudiant = {
  sub: string;
  typ: 'etudiant';
  personneId: string;
  v: number;
};

export type EtudiantConnecte = { compteId: string; personneId: string };

export type RequeteEtudiant = Request & { etudiant: EtudiantConnecte };

export const SESSION_EXPIREE =
  'Votre session a expiré. Reconnectez-vous à votre espace étudiant.';

@Injectable()
export class EtudiantGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { etudiant?: EtudiantConnecte }>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token)
      throw new UnauthorizedException(SESSION_EXPIREE);

    let payload: JetonEtudiant;
    try {
      payload = await this.jwtService.verifyAsync<JetonEtudiant>(token);
    } catch {
      throw new UnauthorizedException(SESSION_EXPIREE);
    }
    if (payload.typ !== 'etudiant')
      throw new UnauthorizedException(SESSION_EXPIREE);

    const compte = await this.prisma.compteEtudiant.findUnique({
      where: { id: payload.sub },
      select: {
        personneId: true,
        versionJeton: true,
        desactiveLe: true,
        motDePasse: true,
      },
    });
    if (
      !compte ||
      compte.desactiveLe ||
      !compte.motDePasse ||
      compte.versionJeton !== payload.v ||
      compte.personneId !== payload.personneId
    )
      throw new UnauthorizedException(SESSION_EXPIREE);

    request.etudiant = { compteId: payload.sub, personneId: compte.personneId };
    return true;
  }
}
