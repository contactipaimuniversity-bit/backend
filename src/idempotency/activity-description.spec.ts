import { describeActivity } from './activity-description';

describe('describeActivity', () => {
  it('labels creations by their business resource', () => {
    expect(describeActivity('POST', '/demandes-bourse')).toEqual({
      action: 'Création · demande de bourse',
      ressource: 'demande de bourse',
    });
  });

  it('labels decisions and access changes clearly', () => {
    expect(describeActivity('PATCH', '/demandes-bourse/:id/decision').action).toBe(
      'Mise à jour d’une décision de bourse',
    );
    expect(describeActivity('PATCH', '/utilisateurs/:id/acces').action).toBe(
      'Modification des accès utilisateur',
    );
  });

  it('labels deletion and restoration actions', () => {
    expect(describeActivity('DELETE', '/corbeille/:id').action).toBe(
      'Suppression · élément de corbeille',
    );
    expect(describeActivity('POST', '/corbeille/:id/restaurer').action).toBe(
      'Restauration · élément de corbeille',
    );
  });
});