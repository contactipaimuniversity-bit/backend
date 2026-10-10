import {
  Acteur,
  actionsPossibles,
  blocageAnnulation,
  blocageFacture,
  blocagePaiement,
  blocageReception,
  blocageValidation,
  DepenseCircuit,
  niveauxRequis,
  parseMontant,
} from './depenses.rules';

const acteur = (id: string, ...permissions: string[]): Acteur => ({
  id,
  nom: id,
  role: 'employe',
  permissions,
});

const depense = (overrides: Partial<DepenseCircuit> = {}): DepenseCircuit => ({
  statut: 'SOUMISE',
  niveauxRequis: 1,
  initiateurId: 'initiateur',
  validation1ParId: null,
  validation2ParId: null,
  montant: '100000.00',
  montantFacture: null,
  livraisonRequise: true,
  totalPaye: 0,
  ...overrides,
});

describe('règles du circuit de dépense', () => {
  it('exige deux validations à partir du seuil ou hors budget', () => {
    expect(niveauxRequis(499_999, 500_000, false)).toBe(1);
    expect(niveauxRequis(500_000, 500_000, false)).toBe(2);
    expect(niveauxRequis(1_000, 500_000, true)).toBe(2);
  });

  it('interdit de valider sa propre dépense, même à un administrateur', () => {
    const admin: Acteur = { ...acteur('initiateur'), role: 'admin' };
    expect(blocageValidation(depense(), admin)).toMatch(/initiée/);
    expect(
      blocageValidation(depense(), acteur('autre', 'edit:expense-approval')),
    ).toBeNull();
  });

  it('réserve chaque niveau de validation au rôle correspondant', () => {
    expect(
      blocageValidation(
        depense(),
        acteur('autre', 'edit:expense-final-approval'),
      ),
    ).toMatch(/ne vous est pas attribuée/);
    expect(
      blocageValidation(
        depense({ statut: 'VALIDATION_FINALE', validation1ParId: 'v1' }),
        acteur('v2', 'edit:expense-approval'),
      ),
    ).toMatch(/finale/);
  });

  it('impose une seconde personne pour la validation finale', () => {
    const enFinale = depense({
      statut: 'VALIDATION_FINALE',
      niveauxRequis: 2,
      validation1ParId: 'v1',
    });
    expect(
      blocageValidation(enFinale, acteur('v1', 'edit:expense-final-approval')),
    ).toMatch(/autre personne/);
    expect(
      blocageValidation(enFinale, acteur('v2', 'edit:expense-final-approval')),
    ).toBeNull();
  });

  it('exige la livraison avant la facture quand la catégorie le prévoit', () => {
    const comptable = acteur('comptable', 'edit:expense-payment');
    expect(blocageFacture(depense({ statut: 'VALIDEE' }), comptable)).toMatch(
      /livraison/,
    );
    expect(
      blocageFacture(depense({ statut: 'RECEPTIONNEE' }), comptable),
    ).toBeNull();
    expect(
      blocageFacture(
        depense({ statut: 'VALIDEE', livraisonRequise: false }),
        comptable,
      ),
    ).toBeNull();
  });

  it('laisse le demandeur ou le service exécutant constater la livraison', () => {
    const validee = depense({ statut: 'VALIDEE' });
    expect(blocageReception(validee, acteur('initiateur'))).toBeNull();
    expect(blocageReception(validee, acteur('tiers'))).not.toBeNull();
    expect(
      blocageReception(
        depense({ statut: 'VALIDEE', livraisonRequise: false }),
        acteur('initiateur'),
      ),
    ).toMatch(/livraison/);
  });

  it('sépare celui qui paie de ceux qui ont demandé et validé', () => {
    const facturee = depense({ statut: 'FACTUREE', validation1ParId: 'v1' });
    const strict = { separationPaiement: true };
    expect(
      blocagePaiement(
        facturee,
        acteur('initiateur', 'edit:expense-payment'),
        strict,
      ),
    ).toMatch(/initiée/);
    expect(
      blocagePaiement(facturee, acteur('v1', 'edit:expense-payment'), strict),
    ).toMatch(/validée/);
    expect(
      blocagePaiement(facturee, acteur('v1', 'edit:expense-payment'), {
        separationPaiement: false,
      }),
    ).toBeNull();
    expect(
      blocagePaiement(
        depense({ statut: 'VALIDEE' }),
        acteur('caissier', 'edit:expense-payment'),
        strict,
      ),
    ).toMatch(/facturée/);
  });

  it("n'annule plus une dépense déjà payée, et réserve l'annulation après validation aux valideurs", () => {
    const valideur = acteur('v1', 'edit:expense-approval');
    expect(
      blocageAnnulation(
        depense({ statut: 'PAYEE_PARTIELLEMENT', totalPaye: 10 }),
        valideur,
      ),
    ).toMatch(/payée/);
    expect(
      blocageAnnulation(depense({ statut: 'VALIDEE' }), acteur('initiateur')),
    ).toMatch(/valideur/);
    expect(
      blocageAnnulation(depense({ statut: 'VALIDEE' }), valideur),
    ).toBeNull();
    expect(blocageAnnulation(depense(), acteur('initiateur'))).toBeNull();
  });

  it("ne propose à l'écran que les actions réellement permises", () => {
    const actions = actionsPossibles(
      depense({ statut: 'BROUILLON' }),
      acteur('initiateur', 'edit:expenses'),
      { separationPaiement: true },
    );
    expect(actions).toMatchObject({
      modifier: true,
      soumettre: true,
      valider: false,
      payer: false,
      annuler: true,
    });
  });

  it('refuse les montants nuls, négatifs ou trop précis', () => {
    expect(parseMontant('12 500,50', 'Montant')).toBe(12500.5);
    expect(() => parseMontant('0', 'Montant')).toThrow();
    expect(() => parseMontant('-5', 'Montant')).toThrow();
    expect(() => parseMontant('1.234', 'Montant')).toThrow();
  });
});
