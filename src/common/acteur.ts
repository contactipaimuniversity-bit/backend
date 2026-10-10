import type { AuthenticatedRequest } from '../auth/authenticated-request';

// L'utilisateur qui agit : sert aux droits, à la séparation des tâches et à la signature des opérations.
export type Acteur = {
  id: string;
  nom: string;
  role: string;
  permissions: string[];
};

export function acteurDe(request: AuthenticatedRequest): Acteur {
  const { sub, nom, prenom, email, role, permissions } = request.user;
  return {
    id: sub,
    nom: [prenom, nom].filter(Boolean).join(' ') || email || sub,
    role,
    permissions,
  };
}

export function peut(acteur: Acteur, permission: string): boolean {
  return acteur.role === 'admin' || acteur.permissions.includes(permission);
}
