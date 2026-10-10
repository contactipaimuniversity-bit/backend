import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { logDeniedAccess } from '../../audit/denied-access';
import { PrismaService } from '../../prisma/prisma.service';
import { HttpAuthenticatedRequest } from '../authenticated-request';

// Réservé aux routes sans permission déléguable (utilisateurs, corbeille, audit).
// Les routes ouvertes par permission sont contrôlées par JwtAuthGuard.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<HttpAuthenticatedRequest>();

    if (request.user?.role !== 'admin') {
      if (request.user)
        await logDeniedAccess(
          this.prisma,
          request,
          request.user,
          'Réservé aux administrateurs',
        );
      throw new ForbiddenException('Acces reserve aux administrateurs');
    }

    return true;
  }
}
