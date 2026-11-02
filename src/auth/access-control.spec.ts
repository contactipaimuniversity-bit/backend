import { requiredPermissionForRequest } from './access-control';

describe('requiredPermissionForRequest', () => {
  it('opens the dashboard figures to any of their cards', () => {
    const required = requiredPermissionForRequest('/rapports/synthese', 'GET');
    expect(required).toContain('view:dashboard-collected');
    expect(required).toContain('view:dashboard-recent-enrollments');
    expect(required).not.toContain('view:daily-summary');
    expect(requiredPermissionForRequest('/rapports/a-faire', 'GET')).toContain(
      'view:dashboard-unpaid',
    );
  });

  it('gives the daily recap its own right', () => {
    expect(
      requiredPermissionForRequest('/rapports/activite-journee', 'GET'),
    ).toEqual(['view:daily-summary']);
  });

  it('allows certificate access to read dossier records without edit access', () => {
    expect(requiredPermissionForRequest('/inscriptions/123', 'GET')).toEqual([
      'view:enrollments',
      'view:certificates',
      'view:payments',
    ]);
    expect(requiredPermissionForRequest('/inscriptions/123', 'PATCH')).toEqual([
      'edit:enrollments',
    ]);
  });

  it('lets the cash desk find the dossier to collect without editing it', () => {
    for (const path of ['/inscriptions', '/demandes-bourse', '/inscriptions/1'])
      expect(requiredPermissionForRequest(path, 'GET')).toContain(
        'view:payments',
      );
    expect(requiredPermissionForRequest('/inscriptions', 'POST')).toEqual([
      'edit:enrollments',
    ]);
    expect(
      requiredPermissionForRequest('/demandes-bourse/1', 'DELETE'),
    ).toEqual(['edit:scholarships']);
  });

  it('opens the scholars list to those who see the scholarship files', () => {
    expect(
      requiredPermissionForRequest('/demandes-bourse/boursiers', 'GET'),
    ).toEqual(['view:scholarships', 'view:certificates', 'view:payments']);
  });

  it('opens the enrollment balances to the certificate desk', () => {
    expect(requiredPermissionForRequest('/inscriptions/soldes', 'GET')).toEqual(
      ['view:enrollments', 'view:certificates', 'view:payments'],
    );
  });

  it('opens the session profile to every signed-in user', () => {
    expect(requiredPermissionForRequest('/auth/me', 'GET')).toBeNull();
  });

  it('requires a dedicated permission to cancel a payment', () => {
    expect(
      requiredPermissionForRequest('/paiements/123/annulation', 'POST'),
    ).toEqual(['edit:payment-cancellation']);
    expect(
      requiredPermissionForRequest('/paiements/123/affectation', 'PATCH'),
    ).toEqual(['edit:payments']);
  });

  it('does not apply module permissions to similarly prefixed routes', () => {
    expect(
      requiredPermissionForRequest('/personnes-archive', 'GET'),
    ).toBeNull();
  });

  it('keeps payment reads scoped to payment endpoints and dossier finance data', () => {
    expect(
      requiredPermissionForRequest('/demandes-bourse/123/paiements', 'GET'),
    ).toEqual(['view:payments']);
    expect(
      requiredPermissionForRequest('/inscriptions/123/finance', 'GET'),
    ).toEqual(['view:enrollments', 'view:certificates', 'view:payments']);
  });

  it('requires prospect permissions for follow-up history and writes', () => {
    expect(
      requiredPermissionForRequest('/prospects/123/relances', 'GET'),
    ).toEqual(['view:prospects']);
    expect(
      requiredPermissionForRequest('/prospects/123/relances', 'POST'),
    ).toEqual(['edit:prospects']);
  });

  it('lets dossier agents read the people list and scholarship types they need', () => {
    const guichet = [
      'view:people',
      'view:scholarships',
      'view:enrollments',
      'view:payments',
    ];
    expect(requiredPermissionForRequest('/personnes', 'GET')).toEqual(guichet);
    // La fiche unique d'une personne s'ouvre depuis la caisse comme depuis un dossier.
    expect(requiredPermissionForRequest('/personnes/123', 'GET')).toEqual(
      guichet,
    );
    expect(
      requiredPermissionForRequest('/personnes/123/historique', 'GET'),
    ).toEqual(guichet);
    expect(requiredPermissionForRequest('/personnes/123', 'PATCH')).toEqual([
      'edit:people',
    ]);
    expect(
      requiredPermissionForRequest('/personnes/123/photo', 'POST'),
    ).toEqual(['edit:people', 'edit:scholarships', 'edit:enrollments']);
    expect(requiredPermissionForRequest('/types-bourse', 'GET')).toContain(
      'view:payments',
    );
    expect(requiredPermissionForRequest('/types-bourse', 'POST')).toEqual([
      'edit:references',
    ]);
  });

  it('gives each step of the expense workflow to its own role', () => {
    expect(requiredPermissionForRequest('/depenses', 'POST')).toEqual([
      'edit:expenses',
    ]);
    expect(
      requiredPermissionForRequest('/depenses/123/valider', 'POST'),
    ).toEqual(['edit:expense-approval', 'edit:expense-final-approval']);
    expect(
      requiredPermissionForRequest('/depenses/123/decaissements', 'POST'),
    ).toEqual(['edit:expense-payment']);
    expect(requiredPermissionForRequest('/depenses/123', 'GET')).toContain(
      'view:expense-payment',
    );
  });

  it('reserves financial settings to their owners, except supplier creation', () => {
    expect(requiredPermissionForRequest('/finances/budget', 'PUT')).toEqual([
      'edit:finance-settings',
    ]);
    expect(
      requiredPermissionForRequest('/finances/fournisseurs', 'POST'),
    ).toEqual(['edit:finance-settings', 'edit:expenses']);
    expect(
      requiredPermissionForRequest('/finances/fournisseurs/123', 'PATCH'),
    ).toEqual(['edit:finance-settings']);
  });

  it('reserves the cash handover validation to its own right', () => {
    expect(requiredPermissionForRequest('/paiements/remises', 'GET')).toEqual([
      'view:payment-validation',
    ]);
    expect(requiredPermissionForRequest('/paiements/remises', 'POST')).toEqual([
      'edit:payment-validation',
    ]);
    expect(
      requiredPermissionForRequest('/paiements/remises/compteur', 'GET'),
    ).toEqual(['view:payment-validation']);
    // Encaisser ne donne pas le droit de valider.
    expect(requiredPermissionForRequest('/paiements', 'POST')).toEqual([
      'edit:payments',
    ]);
  });

  it('lets the entrance staff scan cards without editing them', () => {
    expect(requiredPermissionForRequest('/cartes/scan', 'GET')).toEqual([
      'view:card-scan',
      'view:enrollments',
      'view:academics',
    ]);
    expect(requiredPermissionForRequest('/cartes', 'POST')).toEqual([
      'edit:enrollments',
      'edit:academics',
    ]);
    expect(requiredPermissionForRequest('/cartes', 'GET')).not.toContain(
      'view:card-scan',
    );
    expect(
      requiredPermissionForRequest('/cartes/abc/desactivation', 'POST'),
    ).toEqual(['edit:enrollments', 'edit:academics']);
    expect(
      requiredPermissionForRequest('/personnes/123/photo', 'GET'),
    ).toContain('view:card-scan');
  });

  it('shows late payments to payment and report users', () => {
    expect(
      requiredPermissionForRequest('/rapports/paiements-en-retard', 'GET'),
    ).toEqual(['view:reports', 'view:payments']);
  });

  it('shows the student receivables report to accounting, report, or payment users', () => {
    expect(
      requiredPermissionForRequest('/rapports/recouvrement', 'GET'),
    ).toEqual(['view:accounting', 'view:reports', 'view:payments']);
  });
});
