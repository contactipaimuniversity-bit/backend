import {
  fusionnerPlan,
  planCible,
  regimeDe,
  repartir,
  tarifDe,
} from './frais-scolarite.rules';

const date = (jour: string) => new Date(`${jour}T00:00:00.000Z`);
const mois = [
  { libelle: 'Octobre', dateLimite: date('2026-10-05') },
  { libelle: 'Novembre', dateLimite: date('2026-11-05') },
  { libelle: 'Décembre', dateLimite: date('2026-12-05') },
];
const ligne = (
  libelle: string,
  jour: string,
  ordre: number,
  montant: number,
) => ({
  libelle,
  dateLimite: date(jour),
  ordre,
  montant,
});

describe('tarifDe', () => {
  const tarifs = [
    { niveau: 'L1', filiereId: null, montantMensuel: 30000 },
    { niveau: 'L1', filiereId: 'info', montantMensuel: 35000 },
  ];

  it('prefers the price of the programme, then the price of the level', () => {
    expect(tarifDe(tarifs, 'L1', 'info')).toBe(35000);
    expect(tarifDe(tarifs, 'L1', 'droit')).toBe(30000);
    expect(tarifDe(tarifs, 'L1', null)).toBe(30000);
    expect(tarifDe(tarifs, 'M1', 'info')).toBeNull();
  });
});

describe('planCible', () => {
  const base = {
    mois,
    tarif: 30000,
    bourse: null,
    reductionIndividuelle: null,
  };

  it('charges every month at the normal price for a direct enrolment', () => {
    expect(planCible(base).map((item) => item.montant)).toEqual([
      30000, 30000, 30000,
    ]);
  });

  it('applies the scholarship reduction, or the individual one instead', () => {
    const bourse = {
      nom: 'Excellence',
      modeScolarite: 'REDUCTION',
      tauxReduction: 50,
      echeances: [],
    };
    expect(planCible({ ...base, bourse })[0].montant).toBe(15000);
    expect(
      planCible({ ...base, bourse, reductionIndividuelle: 20 })[0].montant,
    ).toBe(24000);
  });

  it('charges only the fixed instalments, at the normal price when none is set', () => {
    const plan = planCible({
      ...base,
      bourse: {
        nom: 'Excellence',
        modeScolarite: 'MOIS_FIXES',
        tauxReduction: null,
        echeances: [
          {
            libelle: 'Tranche 1',
            dateEcheance: date('2026-10-15'),
            montantAttendu: 50000,
          },
          {
            libelle: 'Tranche 2',
            dateEcheance: date('2027-01-15'),
            montantAttendu: null,
          },
        ],
      },
    });
    expect(plan.map((item) => [item.libelle, item.montant])).toEqual([
      ['Tranche 1', 50000],
      ['Tranche 2', 30000],
    ]);
  });

  it('produces nothing without a price', () => {
    expect(planCible({ ...base, tarif: null })).toEqual([]);
  });
});

describe('repartir', () => {
  it('settles the oldest month first, whatever the entry order', () => {
    const lignes = [
      ligne('Novembre', '2026-11-05', 2, 30000),
      ligne('Octobre', '2026-10-05', 1, 30000),
    ];
    expect(
      repartir(lignes, 40000).map((item) => [
        item.libelle,
        item.paye,
        item.reste,
      ]),
    ).toEqual([
      ['Octobre', 30000, 0],
      ['Novembre', 10000, 20000],
    ]);
  });

  it('ignores a negative total', () => {
    expect(
      repartir([ligne('Octobre', '2026-10-05', 1, 30000)], -5)[0].paye,
    ).toBe(0);
  });
});

describe('fusionnerPlan', () => {
  const lignes = [
    ligne('Octobre', '2026-10-05', 1, 15000),
    ligne('Novembre', '2026-11-05', 2, 15000),
    ligne('Décembre', '2026-12-05', 3, 15000),
  ];
  const cible = mois.map((item) => ({ ...item, montant: 30000 }));

  it('never changes a month already paid, even in part', () => {
    const { conservees, nouvelles } = fusionnerPlan(lignes, 20000, cible);
    expect(conservees.map((item) => item.libelle)).toEqual([
      'Octobre',
      'Novembre',
    ]);
    expect(nouvelles.map((item) => [item.libelle, item.montant])).toEqual([
      ['Décembre', 30000],
    ]);
  });

  it('keeps the months already due when a scholarship is withdrawn', () => {
    const { conservees, nouvelles } = fusionnerPlan(
      lignes,
      0,
      cible,
      date('2026-11-20'),
    );
    expect(conservees.map((item) => item.montant)).toEqual([15000, 15000]);
    expect(nouvelles.map((item) => item.libelle)).toEqual(['Décembre']);
  });
});

describe('regimeDe', () => {
  it('names the situation shown on the receipt', () => {
    const base = {
      bourse: null,
      reductionIndividuelle: null,
      bourseRetiree: false,
      personnalise: false,
    };
    expect(regimeDe(base)).toBe('Inscription directe · tarif normal');
    expect(regimeDe({ ...base, bourse: { nom: 'Bourse excellence' } })).toBe(
      'Bourse excellence',
    );
    expect(regimeDe({ ...base, bourseRetiree: true })).toBe(
      'Tarif normal (bourse retirée)',
    );
    expect(regimeDe({ ...base, reductionIndividuelle: 20 })).toContain(
      'réduction individuelle de 20 %',
    );
  });
});
