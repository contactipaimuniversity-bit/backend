export const ACCESS_AREAS = [
  'dashboard',
  'scholarships',
  'enrollments',
  'certificates',
  'payments',
  'payment-cancellation',
  'prospects',
  'people',
  'recruiting',
  'references',
  'sync',
  'reports',
  'expenses',
  'expense-approval',
  'expense-final-approval',
  'expense-payment',
  'finance-settings',
  'academics',
  'teaching',
  'grades',
  'deliberations',
  'academic-stats',
  'hr',
  'payroll',
  'payroll-approval',
  'accounting',
] as const;

// Tous les acteurs du circuit de dépense lisent les mêmes données ; le service
// restreint ensuite un simple demandeur à ses propres demandes.
const EXPENSE_READERS: AccessPermission[] = [
  'view:expenses',
  'view:expense-approval',
  'view:expense-final-approval',
  'view:expense-payment',
  'view:finance-settings',
];

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
  if (normalizedPath === '/rapports/a-faire') return ['view:dashboard'];
  if (normalizedPath === '/rapports/activite-journee')
    return ['view:dashboard'];
  if (isRead && normalizedPath === '/rapports/paiements-en-retard')
    return ['view:reports', 'view:payments'];
  // La liste des personnes sert à choisir le candidat d'un nouveau dossier.
  if (isRead && normalizedPath === '/personnes')
    return ['view:people', 'view:scholarships', 'view:enrollments'];
  // Avant de créer une personne, tout formulaire vérifie qu'elle n'existe pas déjà.
  if (isRead && normalizedPath === '/personnes/doublons')
    return [
      'view:people',
      'view:scholarships',
      'view:enrollments',
      'view:prospects',
    ];
  // La photo se joint et se consulte depuis le formulaire ou la fiche d'un dossier.
  if (/^\/personnes\/[^/]+\/photo$/.test(normalizedPath)) {
    const mode = isRead ? 'view' : 'edit';
    return [`${mode}:people`, `${mode}:scholarships`, `${mode}:enrollments`];
  }
  if (
    isRead &&
    /^\/(demandes-bourse|inscriptions)\/[^/]+\/paiements$/.test(normalizedPath)
  )
    return ['view:payments'];
  // Annuler un encaissement est un droit à part : encaisser ne suffit pas.
  if (!isRead && /^\/paiements\/[^/]+\/annulation$/.test(normalizedPath))
    return ['edit:payment-cancellation'];
  if (
    isRead &&
    /^\/(demandes-bourse|inscriptions)\/[^/]+\/(finance|elements)$/.test(
      normalizedPath,
    )
  ) {
    const area = normalizedPath.startsWith('/demandes-bourse/')
      ? 'scholarships'
      : 'enrollments';
    return [`view:${area}`, 'view:certificates', 'view:payments'];
  }
  if (
    isRead &&
    ['/types-bourse', '/elements-requis'].some(
      (prefix) =>
        normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
    )
  )
    return [
      'view:references',
      'view:enrollments',
      'view:scholarships',
      'view:payments',
    ];

  if (
    normalizedPath === '/depenses' ||
    normalizedPath.startsWith('/depenses/')
  ) {
    if (isRead) return EXPENSE_READERS;
    // Chaque étape du circuit appartient à un rôle distinct ; le service
    // vérifie en plus le niveau de validation et la séparation des tâches.
    if (/\/(valider|rejeter)$/.test(normalizedPath))
      return ['edit:expense-approval', 'edit:expense-final-approval'];
    if (/\/(facture|decaissements)$/.test(normalizedPath))
      return ['edit:expense-payment'];
    if (/\/reception$/.test(normalizedPath))
      return ['edit:expenses', 'edit:expense-payment'];
    if (/\/annuler$/.test(normalizedPath))
      return [
        'edit:expenses',
        'edit:expense-approval',
        'edit:expense-final-approval',
      ];
    return ['edit:expenses'];
  }
  const sous = (prefix: string) =>
    normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  // Académique : la structure se règle par la scolarité, les séances et les
  // notes par les enseignants, la validation et les délibérations par le jury.
  // Filières et niveaux servent aussi aux formulaires d'inscription et de bourse.
  if (
    isRead &&
    ['/academique/filieres', '/academique/niveaux'].includes(normalizedPath)
  )
    return [
      'view:academics',
      'view:teaching',
      'view:grades',
      'view:deliberations',
      'view:enrollments',
      'view:scholarships',
    ];
  if (sous('/academique'))
    return isRead
      ? [
          'view:academics',
          'view:teaching',
          'view:grades',
          'view:deliberations',
          'view:academic-stats',
        ]
      : ['edit:academics'];
  if (sous('/scolarite'))
    return isRead
      ? ['view:teaching', 'view:academics', 'view:deliberations']
      : ['edit:teaching'];
  if (sous('/notes')) {
    if (isRead) return ['view:grades', 'view:deliberations', 'view:academics'];
    return /\/(valider|rouvrir|anonymat)$/.test(normalizedPath)
      ? ['edit:deliberations']
      : ['edit:grades'];
  }
  if (normalizedPath === '/deliberations/statistiques')
    return ['view:academic-stats', 'view:deliberations', 'view:academics'];
  if (sous('/deliberations'))
    return isRead
      ? ['view:deliberations', 'view:academics']
      : ['edit:deliberations'];
  // Personnel et paie : préparer et valider la paie sont deux rôles distincts.
  if (sous('/rh')) {
    if (!isRead) return ['edit:hr'];
    // La liste du personnel sert aussi à affecter les enseignants aux cours.
    return normalizedPath === '/rh/employes'
      ? ['view:hr', 'view:payroll', 'view:academics', 'view:teaching']
      : ['view:hr', 'view:payroll', 'view:payroll-approval'];
  }
  if (sous('/paie')) {
    if (isRead) return ['view:payroll', 'view:payroll-approval'];
    return /\/(valider|rouvrir)$/.test(normalizedPath)
      ? ['edit:payroll-approval']
      : ['edit:payroll'];
  }
  if (sous('/comptabilite'))
    return [isRead ? 'view:accounting' : 'edit:accounting'];
  if (isRead && normalizedPath === '/candidatures-personnel')
    return ['view:recruiting', 'view:hr'];

  if (normalizedPath.startsWith('/finances/')) {
    if (isRead)
      return [...EXPENSE_READERS, 'view:hr', 'view:payroll', 'view:accounting'];
    // Un demandeur peut enregistrer le fournisseur de son devis.
    if (
      method.toUpperCase() === 'POST' &&
      normalizedPath === '/finances/fournisseurs'
    )
      return ['edit:finance-settings', 'edit:expenses'];
    return ['edit:finance-settings'];
  }

  const routes: Array<[string, AccessArea]> = [
    ['/demandes-bourse', 'scholarships'],
    ['/inscriptions', 'enrollments'],
    ['/paiements', 'payments'],
    ['/prospects', 'prospects'],
    ['/personnes', 'people'],
    ['/candidatures-personnel', 'recruiting'],
    ['/types-bourse', 'references'],
    ['/elements-requis', 'references'],
    ['/rapports', 'reports'],
  ];
  const route = routes.find(
    ([prefix]) =>
      normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
  );
  if (!route) return null;
  const permission =
    `${isRead ? 'view' : 'edit'}:${route[1]}` as AccessPermission;
  if (isRead && ['scholarships', 'enrollments'].includes(route[1]))
    return [permission, 'view:certificates'];
  return [permission];
}
