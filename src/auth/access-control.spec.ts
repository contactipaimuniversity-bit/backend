import { requiredPermissionForRequest } from './access-control';

describe('requiredPermissionForRequest', () => {
  it('uses the dashboard permission for its summary endpoint', () => {
    expect(requiredPermissionForRequest('/rapports/synthese', 'GET')).toEqual([
      'view:dashboard',
    ]);
  });

  it('uses dashboard access for the daily recap endpoint', () => {
    expect(requiredPermissionForRequest('/rapports/activite-journee', 'GET')).toEqual([
      'view:dashboard',
    ]);
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

  it('does not apply module permissions to similarly prefixed routes', () => {
    expect(requiredPermissionForRequest('/personnes-archive', 'GET')).toBeNull();
  });

  it('keeps payment reads scoped to payment endpoints and dossier finance data', () => {
    expect(requiredPermissionForRequest('/demandes-bourse/123/paiements', 'GET')).toEqual([
      'view:payments',
    ]);
    expect(requiredPermissionForRequest('/inscriptions/123/finance', 'GET')).toEqual([
      'view:enrollments',
      'view:certificates',
      'view:payments',
    ]);
  });
});