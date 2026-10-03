export const ACCESS_AREAS = [
  'dashboard',
  'scholarships',
  'enrollments',
  'certificates',
  'payments',
  'prospects',
  'people',
  'recruiting',
  'references',
  'sync',
  'reports',
] as const;

export type AccessArea = (typeof ACCESS_AREAS)[number];
export type AccessPermission = `view:${AccessArea}` | `edit:${AccessArea}`;

export function isAccessPermission(value: string): value is AccessPermission {
  return ACCESS_AREAS.some(
    (area) => value === `view:${area}` || value === `edit:${area}`,
  );
}

export function requiredPermissionForRequest(
  path: string,
  method: string,
): AccessPermission[] | null {
  const normalizedPath = path.split('?')[0].replace(/\/$/, '') || '/';
  const isRead = method.toUpperCase() === 'GET';
  if (normalizedPath === '/rapports/synthese') return ['view:dashboard'];
  if (isRead && /^\/(demandes-bourse|inscriptions)\/[^/]+\/paiements$/.test(normalizedPath))
    return ['view:payments'];
  if (isRead && /^\/(demandes-bourse|inscriptions)\/[^/]+\/(finance|elements)$/.test(normalizedPath)) {
    const area = normalizedPath.startsWith('/demandes-bourse/') ? 'scholarships' : 'enrollments';
    return [`view:${area}`, 'view:certificates', 'view:payments'];
  }
  if (isRead && ['/types-bourse', '/elements-requis'].some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)))
    return ['view:references', 'view:enrollments', 'view:scholarships'];

  const routes: Array<[string, AccessArea]> = [
    ['/demandes-bourse', 'scholarships'],
    ['/inscriptions', 'enrollments'],
    ['/certificats', 'certificates'],
    ['/paiements', 'payments'],
    ['/prospects', 'prospects'],
    ['/personnes', 'people'],
    ['/candidatures-personnel', 'recruiting'],
    ['/types-bourse', 'references'],
    ['/elements-requis', 'references'],
    ['/rapports', 'reports'],
  ];
  const route = routes.find(
    ([prefix]) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
  );
  if (!route) return null;
  const permission = `${isRead ? 'view' : 'edit'}:${route[1]}` as AccessPermission;
  if (isRead && ['scholarships', 'enrollments'].includes(route[1]))
    return [permission, 'view:certificates'];
  return [permission];
}