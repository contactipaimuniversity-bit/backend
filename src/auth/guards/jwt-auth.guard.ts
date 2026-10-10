import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { logDeniedAccess } from '../../audit/denied-access';
import { PrismaService } from '../../prisma/prisma.service';
import { requiredPermissionForRequest } from '../access-control';
import {
  AuthenticatedUser,
  HttpAuthenticatedRequest,
  JwtAccessPayload,
} from '../authenticated-request';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<HttpAuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Token Bearer requis');
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<JwtAccessPayload>(token);
      const utilisateur = await this.prisma.utilisateur.findUnique({
        where: { id: payload.sub },
        select: { role: true, permissions: true },
      });
      if (!utilisateur)
        throw new UnauthorizedException('Utilisateur introuvable');
      request.user = {
        ...payload,
        role: utilisateur.role,
        permissions: utilisateur.permissions,
      } satisfies AuthenticatedUser;
      if (utilisateur.role !== 'admin') {
        const required = requiredPermissionForRequest(
          request.path,
          request.method,
        );
        if (
          required &&
          !required.some((permission) =>
            utilisateur.permissions.includes(permission),
          )
        ) {
          await logDeniedAccess(
            this.prisma,
            request,
            payload,
            'Fonctionnalité non attribuée',
          );
          throw new ForbiddenException(
            'Cette fonctionnalité ne vous est pas attribuée',
          );
        }
      }
      return true;
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof UnauthorizedException
      )
        throw error;
      throw new UnauthorizedException('Token invalide ou expire');
    }
  }
}
