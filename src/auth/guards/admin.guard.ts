import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { requiredPermissionForRequest } from '../access-control';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (request.user?.role !== 'admin') {
      const required = requiredPermissionForRequest(request.path, request.method);
      if (required?.some((permission) => request.user?.permissions?.includes(permission))) return true;
      throw new ForbiddenException('Acces reserve aux administrateurs');
    }

    return true;
  }
}
