import {
  compteDeCharge,
  controleEcriture,
  regrouper,
  tresorerie,
} from './plan-comptable';

describe('règles comptables', () => {
  it('refuse une écriture déséquilibrée ou incomplète', () => {
    expect(
      controleEcriture([
        { compte: '571', debit: 1000, credit: 0 },
        { compte: '7062', debit: 0, credit: 1000 },
      ]),
    ).toBeNull();
    expect(
      controleEcriture([
        { compte: '571', debit: 1000, credit: 0 },
        { compte: '7062', debit: 0, credit: 900 },
      ]),
    ).toMatch(/déséquilibrée/);
    expect(
      controleEcriture([{ compte: '571', debit: 1000, credit: 0 }]),
    ).toMatch(/deux lignes/);
    expect(
      controleEcriture([
        { compte: '571', debit: 1000, credit: 1000 },
        { compte: '7062', debit: 0, credit: 0 },
      ]),
    ).toMatch(/pas les deux/);
  });

  it('équilibre au centime près, sans erreur d’arrondi', () => {
    expect(
      controleEcriture([
        { compte: '661', debit: 0.1, credit: 0 },
        { compte: '661', debit: 0.2, credit: 0 },
        { compte: '422', debit: 0, credit: 0.3 },
      ]),
    ).toBeNull();
  });

  it('regroupe les lignes d’un même compte et d’un même sens', () => {
    expect(
      regrouper([
        { compte: '661', debit: 100, credit: 0 },
        { compte: '661', debit: 50, credit: 0 },
        { compte: '431', debit: 0, credit: 6 },
        { compte: '431', debit: 0, credit: 0 },
      ]),
    ).toEqual([
      { compte: '661', debit: 150, credit: 0, libelle: undefined },
      { compte: '431', debit: 0, credit: 6, libelle: undefined },
    ]);
  });

  it('choisit le compte de trésorerie selon le mode de règlement', () => {
    expect(tresorerie('ESPECES')).toEqual({ compte: '571', journal: 'CA' });
    expect(tresorerie('CHEQUE')).toEqual({ compte: '521', journal: 'BQ' });
    expect(tresorerie('MOBILE_MONEY')).toEqual({
      compte: '552',
      journal: 'MM',
    });
  });

  it('propose un compte de charge par catégorie, sauf choix explicite', () => {
    expect(
      compteDeCharge({ nom: 'Fournitures de bureau', compteNumero: null }),
    ).toBe('6047');
    expect(
      compteDeCharge({ nom: 'Loyer et charges locatives', compteNumero: null }),
    ).toBe('622');
    expect(compteDeCharge({ nom: 'Inclassable', compteNumero: null })).toBe(
      '658',
    );
    expect(
      compteDeCharge({ nom: 'Fournitures de bureau', compteNumero: '604' }),
    ).toBe('604');
  });
});
