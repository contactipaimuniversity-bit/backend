import {
  chevauche,
  classer,
  mention,
  normaliser,
  ReglesNotes,
  resultatAnnuel,
  resultatMatiere,
  resultatSemestre,
  resultatUE,
} from './academique.rules';

const regles: ReglesNotes = {
  poidsControleContinu: 40,
  moyenneValidation: 10,
  noteEliminatoire: null,
  compensationSemestre: true,
  compensationAnnuelle: true,
  creditsPassage: 45,
};

const note = (type: string, valeur: number | null, bareme = 20) => ({
  type,
  bareme,
  valeur,
  absent: false,
});

describe('calcul des résultats', () => {
  it('pondère contrôle continu et examen', () => {
    const resultat = resultatMatiere(
      [note('CONTROLE', 12), note('CONTROLE', 16), note('EXAMEN', 10)],
      regles,
    );
    // CC 14 × 40 % + examen 10 × 60 %
    expect(resultat).toMatchObject({
      controle: 14,
      examen: 10,
      moyenne: 11.6,
      complet: true,
    });
  });

  it('ramène toutes les notes sur 20 et compte une absence comme zéro', () => {
    expect(resultatMatiere([note('EXAMEN', 30, 40)], regles).moyenne).toBe(15);
    expect(
      resultatMatiere(
        [{ type: 'EXAMEN', bareme: 20, valeur: null, absent: true }],
        regles,
      ).moyenne,
    ).toBe(0);
  });

  it('reste incomplet tant qu’une note attendue manque', () => {
    const resultat = resultatMatiere(
      [note('CONTROLE', 12), note('EXAMEN', null)],
      regles,
    );
    expect(resultat).toMatchObject({ moyenne: null, complet: false });
    expect(resultatMatiere([], regles).complet).toBe(false);
  });

  it('ne retient le rattrapage que s’il améliore la note d’examen', () => {
    const base = [note('CONTROLE', 10), note('EXAMEN', 6)];
    expect(
      resultatMatiere([...base, note('RATTRAPAGE', 12)], regles).moyenne,
    ).toBe(11.2);
    expect(
      resultatMatiere([...base, note('RATTRAPAGE', 4)], regles).moyenne,
    ).toBe(7.6);
    // Un étudiant qui n'a pas passé le rattrapage garde sa note.
    expect(
      resultatMatiere([...base, note('RATTRAPAGE', null)], regles),
    ).toMatchObject({ moyenne: 7.6, complet: true });
  });

  it('calcule l’unité avec les coefficients et applique la note éliminatoire', () => {
    const matieres = [
      { coefficient: 3, moyenne: 14 },
      { coefficient: 1, moyenne: 4 },
    ];
    expect(resultatUE(matieres, regles)).toMatchObject({
      moyenne: 11.5,
      validee: true,
    });
    expect(
      resultatUE(matieres, { ...regles, noteEliminatoire: 5 }),
    ).toMatchObject({ validee: false, eliminatoire: true });
  });

  it('compense les unités dans le semestre quand la moyenne suffit', () => {
    const ues = [
      { credits: 20, moyenne: 13, validee: true, eliminatoire: false },
      { credits: 10, moyenne: 8, validee: false, eliminatoire: false },
    ];
    expect(resultatSemestre(ues, regles)).toMatchObject({
      moyenne: 11.33,
      creditsAcquis: 30,
      valide: true,
    });
    expect(
      resultatSemestre(ues, { ...regles, compensationSemestre: false }),
    ).toMatchObject({ creditsAcquis: 20, valide: false });
  });

  it('n’accorde que les crédits des unités validées sous la moyenne', () => {
    const resultat = resultatSemestre(
      [
        { credits: 20, moyenne: 10.5, validee: true, eliminatoire: false },
        { credits: 10, moyenne: 6, validee: false, eliminatoire: false },
      ],
      regles,
    );
    expect(resultat).toMatchObject({
      moyenne: 9,
      creditsAcquis: 20,
      valide: false,
    });
  });

  it('décide du passage : admis, admis avec dettes ou ajourné', () => {
    const semestre = (moyenne: number, creditsAcquis: number) => ({
      moyenne,
      creditsAcquis,
      creditsTotal: 30,
      eliminatoire: false,
    });
    expect(
      resultatAnnuel([semestre(12, 30), semestre(9, 20)], regles, false),
    ).toMatchObject({ moyenne: 10.5, creditsAcquis: 60, decision: 'ADMIS' });
    expect(
      resultatAnnuel([semestre(11, 30), semestre(7, 15)], regles, false),
    ).toMatchObject({ creditsAcquis: 45, decision: 'ADMIS_AVEC_DETTES' });
    expect(
      resultatAnnuel([semestre(8, 20), semestre(7, 15)], regles, false)
        .decision,
    ).toBe('AJOURNE');
    // En dernière année, pas de passage avec dettes.
    expect(
      resultatAnnuel([semestre(11, 30), semestre(7, 15)], regles, true)
        .decision,
    ).toBe('AJOURNE');
  });

  it('attribue les mentions et classe les ex æquo au même rang', () => {
    expect(mention(9.99, 10)).toBeNull();
    expect(mention(10, 10)).toBe('Passable');
    expect(mention(14.5, 10)).toBe('Bien');
    expect(
      classer([
        { moyenne: 12 },
        { moyenne: 15 },
        { moyenne: 12 },
        { moyenne: null },
      ]).map((item) => item.rang),
    ).toEqual([2, 1, 2, null]);
  });

  it('détecte les chevauchements d’horaires et rapproche les filières saisies à la main', () => {
    expect(chevauche({ debut: 480, fin: 600 }, { debut: 540, fin: 660 })).toBe(
      true,
    );
    expect(chevauche({ debut: 480, fin: 600 }, { debut: 600, fin: 720 })).toBe(
      false,
    );
    expect(normaliser('  Génie-Logiciel ')).toBe(normaliser('genie logiciel'));
  });
});
