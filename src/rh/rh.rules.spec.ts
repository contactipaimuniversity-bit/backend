import {
  bornesDuMois,
  calculerBulletin,
  congesAcquis,
  EntreePaie,
  joursCommuns,
  joursDeConge,
  RubriqueCalcul,
} from './rh.rules';

const jour = (texte: string) => new Date(`${texte}T00:00:00Z`);

const rubrique = (partial: Partial<RubriqueCalcul>): RubriqueCalcul => ({
  code: 'X',
  libelle: 'X',
  type: 'GAIN',
  mode: 'FIXE',
  valeur: 0,
  plafond: null,
  compteNumero: null,
  ordre: 0,
  ...partial,
});

const entree = (partial: Partial<EntreePaie> = {}): EntreePaie => ({
  salaireBase: 260_000,
  prorata: 1,
  tauxHoraire: 0,
  heuresVacation: 0,
  joursAbsence: 0,
  joursOuvresMois: 26,
  rubriques: [],
  ajustements: {},
  ...partial,
});

describe('règles RH et paie', () => {
  it('compte les jours de congé sans les dimanches', () => {
    // Du lundi 5 au dimanche 11 octobre 2026 : six jours.
    expect(joursDeConge(jour('2026-10-05'), jour('2026-10-11'))).toBe(6);
    expect(joursDeConge(jour('2026-10-10'), jour('2026-10-10'))).toBe(1);
  });

  it('calcule la part du mois couverte par un contrat', () => {
    const mois = bornesDuMois(2026, 10);
    expect(mois.jours).toBe(31);
    expect(joursCommuns(jour('2026-10-16'), null, mois.debut, mois.fin)).toBe(
      16,
    );
    expect(
      joursCommuns(
        jour('2026-09-01'),
        jour('2026-10-10'),
        mois.debut,
        mois.fin,
      ),
    ).toBe(10);
    expect(joursCommuns(jour('2026-11-01'), null, mois.debut, mois.fin)).toBe(
      0,
    );
  });

  it('acquiert les congés annuels au prorata des mois travaillés', () => {
    expect(congesAcquis(jour('2020-01-01'), jour('2026-06-15'), 26)).toBe(13);
    expect(congesAcquis(jour('2026-05-10'), jour('2026-06-15'), 26)).toBe(4);
    expect(congesAcquis(jour('2026-08-01'), jour('2026-06-15'), 26)).toBe(0);
  });

  it('calcule brut, retenues, net et charges patronales', () => {
    const bulletin = calculerBulletin(
      entree({
        rubriques: [
          rubrique({ code: 'TRANSPORT', valeur: 20_000 }),
          rubrique({
            code: 'CNSS',
            type: 'RETENUE',
            mode: 'POURCENTAGE_BRUT',
            valeur: 4,
          }),
          rubrique({ code: 'AVANCE', type: 'RETENUE', mode: 'VARIABLE' }),
          rubrique({
            code: 'CNSS_PAT',
            type: 'PATRONALE',
            mode: 'POURCENTAGE_BRUT',
            valeur: 10,
          }),
        ],
        ajustements: { AVANCE: 50_000 },
      }),
    );
    expect(bulletin).toMatchObject({
      brut: 280_000,
      totalRetenues: 11_200 + 50_000,
      net: 218_800,
      chargesPatronales: 28_000,
    });
  });

  it('plafonne l’assiette des cotisations', () => {
    const bulletin = calculerBulletin(
      entree({
        salaireBase: 2_000_000,
        rubriques: [
          rubrique({
            code: 'CNSS',
            type: 'RETENUE',
            mode: 'POURCENTAGE_BRUT',
            valeur: 4,
            plafond: 1_200_000,
          }),
        ],
      }),
    );
    expect(bulletin.totalRetenues).toBe(48_000);
  });

  it('retient les absences non rémunérées et proratise un mois incomplet', () => {
    expect(calculerBulletin(entree({ joursAbsence: 2 })).brut).toBe(240_000);
    expect(calculerBulletin(entree({ prorata: 0.5 })).brut).toBe(130_000);
    // Une absence ne peut pas rendre le salaire négatif.
    expect(calculerBulletin(entree({ joursAbsence: 40 })).brut).toBe(0);
  });

  it('paie un vacataire sur ses heures de cours', () => {
    const bulletin = calculerBulletin(
      entree({ salaireBase: 0, tauxHoraire: 5_000, heuresVacation: 12.5 }),
    );
    expect(bulletin).toMatchObject({ brut: 62_500, net: 62_500 });
    expect(bulletin.lignes[0]).toMatchObject({ code: 'VACATION', base: 12.5 });
  });
});
