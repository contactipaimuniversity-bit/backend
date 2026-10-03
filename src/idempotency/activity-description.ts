const resources: Array<[string, string]> = [
  ['/demandes-bourse', 'demande de bourse'],
  ['/inscriptions', 'inscription'],
  ['/candidatures-personnel', 'dossier de recrutement'],
  ['/prospects', 'prospect'],
  ['/personnes', 'fiche personne'],
  ['/paiements', 'paiement'],
  ['/types-bourse', 'type de bourse'],
  ['/elements-requis', 'élément de référentiel'],
  ['/utilisateurs/postes', 'poste métier'],
  ['/utilisateurs', 'utilisateur'],
  ['/corbeille', 'élément de corbeille'],
];

export function describeActivity(method: string, route: string) {
  const normalizedRoute = route.split('?')[0].toLocaleLowerCase();
  const resource = resources.find(([prefix]) =>
    normalizedRoute === prefix || normalizedRoute.startsWith(`${prefix}/`),
  )?.[1] ?? 'donnée de gestion';

  if (normalizedRoute.endsWith('/restaurer'))
    return { action: `Restauration · ${resource}`, ressource: resource };
  if (normalizedRoute.endsWith('/acces'))
    return { action: 'Modification des accès utilisateur', ressource: 'accès utilisateur' };
  if (normalizedRoute.includes('/elements/'))
    return { action: `Mise à jour d’une pièce · ${resource}`, ressource: resource };
  if (normalizedRoute.endsWith('/decision'))
    return { action: 'Mise à jour d’une décision de bourse', ressource: resource };

  const verb = method.toUpperCase() === 'POST'
    ? 'Création'
    : method.toUpperCase() === 'DELETE'
      ? 'Suppression'
      : 'Modification';
  return { action: `${verb} · ${resource}`, ressource: resource };
}