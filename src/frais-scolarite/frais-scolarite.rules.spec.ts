import {
  avecExceptions,
  fusionnerPlan,
  montantApresException,
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
  id: libelle,
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
    ligne('Octobre', '2026-10-05', 1, 30000),
    ligne('Novembre', '2026-11-05', 2, 30000),
    ligne('Décembre', '2026-12-05', 3, 30000),
  ];
  const cible = mois.map((item) => ({ ...item, montant: 35000 }));

  it('puts every month at the price of the settings, even one already paid', () => {
    const plan = fusionnerPlan(lignes, cible);
    expect(plan.modifiees.map((item) => [item.id, item.montant])).toEqual([
      ['Octobre', 35000],
      ['Novembre', 35000],
      ['Décembre', 35000],
    ]);
  });

  it('settles the first month with a 35 000 payment once the price is right', () => {
    // Cas réel : échéancier resté à 30 000, l'étudiant verse 35 000.
    const avant = repartir(lignes, 35000);
    expect(avant.map((item) => item.paye)).toEqual([30000, 5000, 0]);
    const plan = fusionnerPlan(lignes, cible);
    const apres = repartir(
      lignes.map((item) => ({
        ...item,
        montant:
          plan.modifiees.find((modif) => modif.id === item.id)?.montant ??
          item.montant,
      })),
      35000,
    );
    expect(apres.map((item) => [item.paye, item.reste])).toEqual([
      [35000, 0],
      [0, 35000],
      [0, 35000],
    ]);
  });

  it('writes nothing when the plan already matches the settings', () => {
    expect(
      fusionnerPlan(
        lignes,
        mois.map((item) => ({ ...item, montant: 30000 })),
      ).change,
    ).toBe(false);
  });

  it('follows a new calendar: removed months go, new ones come, dates move', () => {
    const plan = fusionnerPlan(lignes, [
      { libelle: 'Novembre', dateLimite: date('2026-11-10'), montant: 30000 },
      { libelle: 'Janvier', dateLimite: date('2027-01-05'), montant: 30000 },
    ]);
    expect(plan.supprimees).toEqual(['Octobre', 'Décembre']);
    expect(plan.modifiees).toEqual([
      { id: 'Novembre', montant: 30000, dateLimite: date('2026-11-10') },
    ]);
    expect(plan.nouvelles.map((item) => item.libelle)).toEqual(['Janvier']);
  });

  it('keeps the months already due when a scholarship is withdrawn', () => {
    const plan = fusionnerPlan(lignes, cible, date('2026-11-20'));
    expect(plan.conservees.map((item) => item.libelle)).toEqual([
      'Octobre',
      'Novembre',
    ]);
    expect(plan.modifiees.map((item) => item.id)).toEqual(['Décembre']);
  });

  it('removes a duplicated month', () => {
    const plan = fusionnerPlan(
      [...lignes, { ...ligne('Octobre', '2026-10-05', 4, 30000), id: 'bis' }],
      mois.map((item) => ({ ...item, montant: 30000 })),
    );
    expect(plan.supprimees).toEqual(['bis']);
  });
});

describe('exceptions', () => {
  it('exempts, reduces or fixes the amount of a line', () => {
    expect(
      montantApresException(30000, { mode: 'EXONERATION', valeur: null }),
    ).toBe(0);
    expect(
      montantApresException(30000, { mode: 'POURCENTAGE', valeur: 50 }),
    ).toBe(15000);
    expect(
      montantApresException(30000, { mode: 'MONTANT', valeur: 20000 }),
    ).toBe(20000);
  });

  it('applies to the month it names, on top of the scholarship', () => {
    const cible = avecExceptions(
      mois.map((item) => ({ ...item, montant: 15000 })),
      new Map([['Novembre', { mode: 'POURCENTAGE', valeur: 50 }]]),
    );
    expect(cible.map((item) => item.montant)).toEqual([15000, 7500, 15000]);
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
