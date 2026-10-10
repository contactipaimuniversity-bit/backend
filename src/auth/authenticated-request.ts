import { Request } from 'express';

export type JwtAccessPayload = {
  sub: string;
  email?: string;
  nom?: string;
  prenom?: string;
  role?: string;
  posteId?: string | null;
  permissions?: string[];
};

export type AuthenticatedUser = JwtAccessPayload & {
  role: string;
  permissions: string[];
};

export type HttpAuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
};

// Requête d'une route protégée par JwtAuthGuard : l'utilisateur est garanti.
export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};
