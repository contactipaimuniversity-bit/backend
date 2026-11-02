// Le détail de la Vue d'ensemble : chaque poste reçoit les cartes et blocs choisis.
const DASHBOARD_FIGURE_AREAS = [
  'dashboard-trend',
  'dashboard-prospects',
  'dashboard-applications',
  'dashboard-applications-open',
  'dashboard-people',
  'dashboard-enrollments',
  'dashboard-collected',
  'dashboard-receivables',
  'dashboard-scholarship-types',
  'dashboard-recent-applications',
  'dashboard-recent-enrollments',
] as const;
const DASHBOARD_WORKLIST_AREAS = [
  'dashboard-followups',
  'dashboard-interviews',
  'dashboard-incomplete',
  'dashboard-unpaid',
] as const;

export const ACCESS_AREAS = [
  ...DASHBOARD_FIGURE_AREAS,
  ...DASHBOARD_WORKLIST_AREAS,
  'dashboard-my-work',
  'dashboard-incomplete-note',
  'daily-summary',
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
  'card-scan',
  'payment-validation',
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
  // Le service ne renvoie ensuite que les cartes attribuées à l'utilisateur.
  if (normalizedPath === '/rapports/synthese')
    return DASHBOARD_FIGURE_AREAS.map((area) => `view:${area}` as const);
  if (normalizedPath === '/rapports/a-faire')
    return DASHBOARD_WORKLIST_AREAS.map((area) => `view:${area}` as const);
  if (normalizedPath === '/rapports/activite-journee')
    return ['view:daily-summary'];
  if (isRead && normalizedPath === '/rapports/paiements-en-retard')
    return ['view:reports', 'view:payments'];
  if (isRead && normalizedPath === '/rapports/recouvrement')
    return ['view:accounting', 'view:reports', 'view:payments'];
  // La liste des personnes sert à choisir le candidat d'un nouveau dossier ;
  // la fiche d'une personne réunit ses dossiers et ce qu'elle a payé, au guichet.
  if (
    isRead &&
    (normalizedPath === '/personnes' ||
      /^\/personnes\/[^/]+(\/historique)?$/.test(normalizedPath)) &&
    normalizedPath !== '/personnes/doublons'
  )
    return [
      'view:people',
      'view:scholarships',
      'view:enrollments',
      'view:payments',
    ];
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
    if (isRead)
      return [
        'view:people',
        'view:scholarships',
        'view:enrollments',
        'view:payments',
        // L'agent d'accueil compare la photo au porteur de la carte.
        'view:card-scan',
      ];
    return ['edit:people', 'edit:scholarships', 'edit:enrollments'];
  }
  if (
    isRead &&
    /^\/(demandes-bourse|inscriptions)\/[^/]+\/paiements$/.test(normalizedPath)
  )
    return ['view:payments'];
  // Valider la remise des encaissements : rôle de la chargée des finances.
  if (
    normalizedPath === '/paiements/remises' ||
    normalizedPath === '/paiements/remises/compteur'
  )
    return isRead ? ['view:payment-validation'] : ['edit:payment-validation'];
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
  // Cartes d'étudiant : la scolarité les édite ; elle et les agents d'accueil les scannent.
  if (normalizedPath === '/cartes/scan')
    return isRead
      ? ['view:card-scan', 'view:enrollments', 'view:academics']
      : ['edit:academics'];
  if (normalizedPath === '/cartes' || normalizedPath.startsWith('/cartes/'))
    return isRead
      ? ['view:enrollments', 'view:academics']
      : ['edit:enrollments', 'edit:academics'];
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
    return /\/(valider|rouvrir|anonymat|absents)$/.test(normalizedPath)
      ? ['edit:deliberations']
      : ['edit:grades'];
  }
  if (normalizedPath === '/deliberations/statistiques')
    return ['view:academic-stats', 'view:deliberations', 'view:academics'];
  if (sous('/deliberations'))
    return isRead
      ? ['view:deliberations', 'view:academics']
      : ['edit:deliberations'];
  // L'émargement des enseignants se tient à la scolarité comme à la RH.
  if (sous('/rh/pointage/enseignants'))
    return isRead
      ? ['view:hr', 'view:teaching', 'view:academics']
      : ['edit:hr', 'edit:teaching'];
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
    // Les lycéens du formulaire public se suivent avec les prospects.
    ['/futurs-etudiants', 'prospects'],
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
  // La caisse choisit dans ces listes le dossier à encaisser.
  if (isRead && ['scholarships', 'enrollments'].includes(route[1]))
    return [permission, 'view:certificates', 'view:payments'];
  return [permission];
}
