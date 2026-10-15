import { requiredPermissionForRequest } from './access-control';

describe('requiredPermissionForRequest', () => {
  it('uses the dashboard permission for its summary endpoint', () => {
    expect(requiredPermissionForRequest('/rapports/synthese', 'GET')).toEqual([
      'view:dashboard',
    ]);
  });

  it('uses dashboard access for the daily recap endpoint', () => {
    expect(
      requiredPermissionForRequest('/rapports/activite-journee', 'GET'),
    ).toEqual(['view:dashboard']);
  });

  it('allows certificate access to read dossier records without edit access', () => {
    expect(requiredPermissionForRequest('/inscriptions/123', 'GET')).toEqual([
      'view:enrollments',
      'view:certificates',
    ]);
    expect(requiredPermissionForRequest('/inscriptions/123', 'PATCH')).toEqual([
      'edit:enrollments',
    ]);
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
});
