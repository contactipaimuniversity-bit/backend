import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { requiredPermissionForRequest } from '../access-control';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization as string | undefined;
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Token Bearer requis');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      const utilisateur = await this.prisma.utilisateur.findUnique({
        where: { id: payload.sub },
        select: { role: true, permissions: true },
      });
      if (!utilisateur) throw new UnauthorizedException('Utilisateur introuvable');
      request.user = { ...payload, ...utilisateur };
      if (utilisateur.role !== 'admin') {
        const required = requiredPermissionForRequest(request.path, request.method);
        if (required && !required.some((permission) => utilisateur.permissions.includes(permission))) {
          throw new ForbiddenException('Cette fonctionnalité ne vous est pas attribuée');
        }
      }
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Token invalide ou expire');
    }
  }
}
