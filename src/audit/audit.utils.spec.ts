import { diffForAudit, sanitizeForAudit } from './audit.utils';

describe('audit utils', () => {
  it('masks secrets at any depth', () => {
    expect(
      sanitizeForAudit({
        email: 'a@b.c',
        motDePasse: 'secret',
        nested: { nouveauMotDePasse: 'x', access_token: 'y' },
      }),
    ).toEqual({
      email: 'a@b.c',
      motDePasse: '•••',
      nested: { nouveauMotDePasse: '•••', access_token: '•••' },
    });
  });

  it('lists only the scalar fields that changed', () => {
    expect(
      diffForAudit(
        { id: '1', statut: 'EN_ATTENTE', typeBourseId: null, filiere: 'Info' },
        {
          id: '1',
          statut: 'ACCEPTEE',
          typeBourseId: 't1',
          filiere: 'Info',
          personne: { nom: 'Diallo' },
        },
      ),
    ).toEqual([
      { champ: 'statut', avant: 'EN_ATTENTE', apres: 'ACCEPTEE' },
      { champ: 'typeBourseId', avant: null, apres: 't1' },
    ]);
  });

  it('compares dates and decimals by value', () => {
    const date = new Date('2026-10-09T10:00:00.000Z');
    expect(
      diffForAudit(
        { dateEntretien: date, montant: { toJSON: () => '100.00' } },
        { dateEntretien: date.toISOString(), montant: '100.00' },
      ),
    ).toEqual([]);
  });
});
