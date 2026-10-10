// Calcul des résultats, sans accès à la base : matière, unité d'enseignement,
// semestre, année. Toutes les moyennes sont sur 20, arrondies au centième.

export const NIVEAUX = ['L1', 'L2'] as const;
export const SEMESTRES = [1, 2] as const;
export const TYPES_EVALUATION = ['CONTROLE', 'EXAMEN', 'RATTRAPAGE'] as const;

export type ReglesNotes = {
  // Part du contrôle continu, en pourcentage.
  poidsControleContinu: number;
  moyenneValidation: number;
  noteEliminatoire: number | null;
  compensationSemestre: boolean;
  compensationAnnuelle: boolean;
  creditsPassage: number;
};

export type NoteEvaluation = {
  type: string;
  bareme: number;
  // null : note non saisie.
  valeur: number | null;
  absent: boolean;
};

export type ResultatMatiere = {
  controle: number | null;
  examen: number | null;
  rattrapage: number | null;
  moyenne: number | null;
  // Faux tant qu'une note attendue manque ou qu'aucune évaluation n'existe.
  complet: boolean;
};

export const arrondi = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const moyenneSimple = (values: number[]) =>
  values.length
    ? arrondi(values.reduce((total, value) => total + value, 0) / values.length)
    : null;

// Une absence à une évaluation vaut zéro ; une note est ramenée sur 20.
function surVingt(note: NoteEvaluation): number | null {
  if (note.absent) return 0;
  if (note.valeur === null) return null;
  return note.bareme > 0 ? (note.valeur / note.bareme) * 20 : null;
}

export function resultatMatiere(
  notes: NoteEvaluation[],
  regles: Pick<ReglesNotes, 'poidsControleContinu'>,
): ResultatMatiere {
  const de = (type: string) => notes.filter((note) => note.type === type);
  const valeurs = (liste: NoteEvaluation[]) =>
    liste.map(surVingt).filter((value): value is number => value !== null);
  const controles = de('CONTROLE');
  const examens = de('EXAMEN');
  const controle = moyenneSimple(valeurs(controles));
  const examen = moyenneSimple(valeurs(examens));
  // Le rattrapage n'est noté que pour ceux qui l'ont passé.
  const rattrapage = moyenneSimple(valeurs(de('RATTRAPAGE')));
  const manque = [...controles, ...examens].some(
    (note) => surVingt(note) === null,
  );
  // Le rattrapage remplace l'examen seulement s'il est meilleur.
  const examenRetenu =
    rattrapage !== null ? Math.max(examen ?? 0, rattrapage) : examen;
  const poids = regles.poidsControleContinu / 100;
  const moyenne =
    controle !== null && examenRetenu !== null
      ? arrondi(controle * poids + examenRetenu * (1 - poids))
      : (examenRetenu ?? controle);
  return {
    controle,
    examen,
    rattrapage,
    moyenne: manque ? null : moyenne,
    complet: !manque && moyenne !== null,
  };
}

export type MatiereUE = { coefficient: number; moyenne: number | null };

export type ResultatUE = {
  moyenne: number | null;
  validee: boolean;
  eliminatoire: boolean;
};

export function resultatUE(
  matieres: MatiereUE[],
  regles: Pick<ReglesNotes, 'moyenneValidation' | 'noteEliminatoire'>,
): ResultatUE {
  const complet =
    matieres.length > 0 &&
    matieres.every((matiere) => matiere.moyenne !== null);
  const coefficients = matieres.reduce(
    (total, matiere) => total + matiere.coefficient,
    0,
  );
  const moyenne =
    complet && coefficients > 0
      ? arrondi(
          matieres.reduce(
            (total, matiere) => total + matiere.moyenne! * matiere.coefficient,
            0,
          ) / coefficients,
        )
      : null;
  const eliminatoire =
    regles.noteEliminatoire !== null &&
    matieres.some(
      (matiere) =>
        matiere.moyenne !== null && matiere.moyenne < regles.noteEliminatoire!,
    );
  return {
    moyenne,
    eliminatoire,
    validee:
      moyenne !== null && moyenne >= regles.moyenneValidation && !eliminatoire,
  };
}

export type UESemestre = ResultatUE & { credits: number };

export type ResultatSemestre = {
  moyenne: number | null;
  creditsAcquis: number;
  creditsTotal: number;
  valide: boolean;
  eliminatoire: boolean;
  complet: boolean;
};

export function resultatSemestre(
  ues: UESemestre[],
  regles: Pick<ReglesNotes, 'moyenneValidation' | 'compensationSemestre'>,
): ResultatSemestre {
  const creditsTotal = ues.reduce((total, ue) => total + ue.credits, 0);
  const complet = ues.length > 0 && ues.every((ue) => ue.moyenne !== null);
  const eliminatoire = ues.some((ue) => ue.eliminatoire);
  const moyenne =
    complet && creditsTotal > 0
      ? arrondi(
          ues.reduce((total, ue) => total + ue.moyenne! * ue.credits, 0) /
            creditsTotal,
        )
      : null;
  // Compensation : une moyenne générale suffisante valide toutes les unités,
  // sauf si une note éliminatoire s'y oppose.
  const compense =
    regles.compensationSemestre &&
    moyenne !== null &&
    moyenne >= regles.moyenneValidation &&
    !eliminatoire;
  const creditsAcquis = compense
    ? creditsTotal
    : ues.reduce((total, ue) => total + (ue.validee ? ue.credits : 0), 0);
  return {
    moyenne,
    creditsAcquis,
    creditsTotal,
    valide: complet && creditsAcquis === creditsTotal,
    eliminatoire,
    complet,
  };
}

export type DecisionAnnuelle = 'ADMIS' | 'ADMIS_AVEC_DETTES' | 'AJOURNE';

export function resultatAnnuel(
  semestres: Array<
    Pick<
      ResultatSemestre,
      'moyenne' | 'creditsAcquis' | 'creditsTotal' | 'eliminatoire'
    >
  >,
  regles: Pick<
    ReglesNotes,
    'moyenneValidation' | 'compensationAnnuelle' | 'creditsPassage'
  >,
  // En dernière année, tous les crédits sont exigés pour obtenir le diplôme.
  dernierNiveau: boolean,
): {
  moyenne: number | null;
  creditsAcquis: number;
  creditsTotal: number;
  decision: DecisionAnnuelle;
} {
  const creditsTotal = semestres.reduce(
    (total, semestre) => total + semestre.creditsTotal,
    0,
  );
  const complet = semestres.every((semestre) => semestre.moyenne !== null);
  const moyenne =
    complet && creditsTotal > 0
      ? arrondi(
          semestres.reduce(
            (total, semestre) =>
              total + semestre.moyenne! * semestre.creditsTotal,
            0,
          ) / creditsTotal,
        )
      : null;
  const compense =
    regles.compensationAnnuelle &&
    moyenne !== null &&
    moyenne >= regles.moyenneValidation &&
    !semestres.some((semestre) => semestre.eliminatoire);
  const creditsAcquis = compense
    ? creditsTotal
    : semestres.reduce((total, semestre) => total + semestre.creditsAcquis, 0);
  const decision: DecisionAnnuelle =
    creditsAcquis === creditsTotal && creditsTotal > 0
      ? 'ADMIS'
      : !dernierNiveau && creditsAcquis >= regles.creditsPassage
        ? 'ADMIS_AVEC_DETTES'
        : 'AJOURNE';
  return { moyenne, creditsAcquis, creditsTotal, decision };
}

export function mention(
  moyenne: number | null,
  moyenneValidation: number,
): string | null {
  if (moyenne === null || moyenne < moyenneValidation) return null;
  if (moyenne >= 16) return 'Très bien';
  if (moyenne >= 14) return 'Bien';
  if (moyenne >= 12) return 'Assez bien';
  return 'Passable';
}

// Classement par moyenne décroissante ; les ex æquo partagent le même rang.
export function classer<T extends { moyenne: number | null }>(
  resultats: T[],
): Array<T & { rang: number | null }> {
  const moyennes = resultats
    .map((resultat) => resultat.moyenne)
    .filter((value): value is number => value !== null)
    .sort((a, b) => b - a);
  return resultats.map((resultat) => ({
    ...resultat,
    rang:
      resultat.moyenne === null ? null : moyennes.indexOf(resultat.moyenne) + 1,
  }));
}

// Deux plages horaires du même jour se chevauchent-elles ?
export function chevauche(
  a: { debut: number; fin: number },
  b: { debut: number; fin: number },
): boolean {
  return a.debut < b.fin && b.debut < a.fin;
}

// Texte comparé sans casse, accents ni espaces superflus (rapprochement des filières saisies à la main).
export function normaliser(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
