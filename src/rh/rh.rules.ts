// Règles RH et calcul de la paie, sans accès à la base.

export const CATEGORIES_EMPLOYE = [
  'ENSEIGNANT_PERMANENT',
  'ENSEIGNANT_VACATAIRE',
  'ADMINISTRATIF',
  'TECHNIQUE',
] as const;
export const TYPES_CONTRAT = ['CDI', 'CDD', 'VACATION', 'STAGE'] as const;
export const TYPES_CONGE = [
  'ANNUEL',
  'MALADIE',
  'MATERNITE',
  'PERMISSION',
  'SANS_SOLDE',
] as const;
// Séance créée par l'émargement, en attendant que le cahier de textes soit rempli.
export const CAHIER_A_COMPLETER = 'Cahier de textes à compléter';

// Rythme de paiement des heures d'un enseignant payé à la séance.
export const PERIODICITES_PAIE = [
  'MENSUEL',
  'BIMESTRIEL',
  'TRIMESTRIEL',
  'SEMESTRIEL',
] as const;
const MOIS_PAR_ECHEANCE: Record<string, number> = {
  MENSUEL: 1,
  BIMESTRIEL: 2,
  TRIMESTRIEL: 3,
};

// Les heures d'un contrat sont-elles à verser dans la paie de ce mois ?
// Le rythme se compte depuis le début du contrat ; son dernier mois solde
// toujours le compte. Le paiement par semestre ne tombe jamais tout seul :
// la RH le déclenche quand le semestre est terminé.
export function echeanceDue(
  contrat: { periodicitePaie: string; dateDebut: Date; dateFin: Date | null },
  annee: number,
  mois: number,
): boolean {
  const fin = contrat.dateFin;
  if (fin && fin.getUTCFullYear() === annee && fin.getUTCMonth() + 1 === mois)
    return true;
  const rythme = MOIS_PAR_ECHEANCE[contrat.periodicitePaie];
  if (!rythme) return false;
  const ecoules =
    (annee - contrat.dateDebut.getUTCFullYear()) * 12 +
    (mois - 1 - contrat.dateDebut.getUTCMonth());
  return ecoules >= 0 && (ecoules + 1) % rythme === 0;
}

// Taux horaire d'un tarif négocié « tel montant pour telle durée ».
export function tauxHoraireDuTarif(montant: number, minutes: number): number {
  return Math.round(((montant * 60) / minutes) * 100) / 100;
}

export const MODES_PAIEMENT = ['ESPECES', 'VIREMENT', 'MOBILE_MONEY'] as const;
export const TYPES_RUBRIQUE = ['GAIN', 'RETENUE', 'PATRONALE'] as const;
export const MODES_RUBRIQUE = [
  'FIXE',
  'POURCENTAGE_BASE',
  'POURCENTAGE_BRUT',
  'VARIABLE',
] as const;

const JOUR_MS = 24 * 60 * 60 * 1000;

const jourUTC = (date: Date) =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

// Jours de congé entre deux dates incluses, dimanches non comptés.
export function joursDeConge(debut: Date, fin: Date): number {
  let jours = 0;
  for (let jour = jourUTC(debut); jour <= jourUTC(fin); jour += JOUR_MS)
    if (new Date(jour).getUTCDay() !== 0) jours += 1;
  return jours;
}

// Nombre de jours calendaires communs à deux périodes (bornes incluses).
export function joursCommuns(
  debutA: Date,
  finA: Date | null,
  debutB: Date,
  finB: Date,
): number {
  const debut = Math.max(jourUTC(debutA), jourUTC(debutB));
  const fin = Math.min(finA ? jourUTC(finA) : Infinity, jourUTC(finB));
  return fin < debut ? 0 : Math.round((fin - debut) / JOUR_MS) + 1;
}

export function bornesDuMois(annee: number, mois: number) {
  return {
    debut: new Date(Date.UTC(annee, mois - 1, 1)),
    fin: new Date(Date.UTC(annee, mois, 0, 23, 59, 59, 999)),
    jours: new Date(Date.UTC(annee, mois, 0)).getUTCDate(),
  };
}

// Même jour, n mois plus tard (le 31 janvier + 1 mois = le 28 ou 29 février).
function plusMois(date: Date, n: number): Date {
  const annee = date.getUTCFullYear();
  const mois = date.getUTCMonth() + n;
  const dernier = new Date(Date.UTC(annee, mois + 1, 0)).getUTCDate();
  return new Date(Date.UTC(annee, mois, Math.min(date.getUTCDate(), dernier)));
}

// Fin de contrat à un ou deux jours d'un mois rond (« du 25 octobre au
// 25 novembre ») : ces jours restants ne font pas un mois de plus.
const JOURS_DE_TOLERANCE = 2;

type ContratSalaire = {
  dateDebut: Date;
  dateFin: Date | null;
  salaireBase: number;
};

/**
 * Salaire fixe dû dans la paie d'un mois. Chaque mois de contrat, compté depuis
 * son premier jour (du 26 octobre au 25 novembre, par exemple), est payé en
 * entier, sans tenir compte du nombre de jours du mois calendaire, dans la paie
 * du mois où il se termine. Des contrats qui se suivent sans interruption
 * (renouvellement, avenant) gardent le même rythme. Seul un dernier mois
 * entamé, quand le contrat s'arrête en cours de mois, est payé au prorata.
 */
export function salaireFixeDuMois(
  contrats: ContratSalaire[],
  annee: number,
  mois: number,
): number {
  const { debut, fin } = bornesDuMois(annee, mois);
  const tries = [...contrats].sort(
    (a, b) => a.dateDebut.getTime() - b.dateDebut.getTime(),
  );
  // Suites de contrats sans interruption : le lendemain de la fin de l'un, l'autre commence.
  const suites: ContratSalaire[][] = [];
  for (const contrat of tries) {
    const suite = suites.at(-1);
    const dernier = suite?.at(-1);
    const continu =
      dernier &&
      (dernier.dateFin === null ||
        jourUTC(contrat.dateDebut) <= jourUTC(dernier.dateFin) + JOUR_MS);
    if (suite && continu) suite.push(contrat);
    else suites.push([contrat]);
  }
  let montant = 0;
  for (const suite of suites) {
    const depart = suite[0].dateDebut;
    const arret = suite.reduce<Date | null>(
      (plusTard, contrat) =>
        contrat.dateFin === null || plusTard === null
          ? null
          : contrat.dateFin > plusTard
            ? contrat.dateFin
            : plusTard,
      suite[0].dateFin,
    );
    for (let k = 0; ; k += 1) {
      const cycleDebut = plusMois(depart, k);
      if (cycleDebut > fin) break;
      if (arret && jourUTC(cycleDebut) > jourUTC(arret)) break;
      const cycleFin = new Date(jourUTC(plusMois(depart, k + 1)) - JOUR_MS);
      const tronque = arret !== null && jourUTC(arret) < jourUTC(cycleFin);
      const finEffective = tronque ? arret : cycleFin;
      // Payé dans la paie du mois où ce mois de contrat se termine.
      if (
        jourUTC(finEffective) < jourUTC(debut) ||
        jourUTC(finEffective) > jourUTC(fin)
      )
        continue;
      const joursCycle = joursCommuns(
        cycleDebut,
        cycleFin,
        cycleDebut,
        cycleFin,
      );
      if (
        tronque &&
        k > 0 &&
        joursCommuns(cycleDebut, finEffective, cycleDebut, finEffective) <=
          JOURS_DE_TOLERANCE
      )
        continue;
      for (const contrat of suite)
        montant +=
          (contrat.salaireBase *
            joursCommuns(
              contrat.dateDebut,
              contrat.dateFin,
              cycleDebut,
              finEffective,
            )) /
          joursCycle;
    }
  }
  return Math.round(montant * 100) / 100;
}

// Congés annuels acquis depuis le début de l'année (ou l'embauche) : un douzième par mois entamé.
export function congesAcquis(
  dateEmbauche: Date,
  aujourdhui: Date,
  joursParAn: number,
): number {
  const debutAnnee = new Date(Date.UTC(aujourdhui.getUTCFullYear(), 0, 1));
  const debut = dateEmbauche > debutAnnee ? dateEmbauche : debutAnnee;
  if (debut > aujourdhui) return 0;
  const mois =
    (aujourdhui.getUTCFullYear() - debut.getUTCFullYear()) * 12 +
    aujourdhui.getUTCMonth() -
    debut.getUTCMonth() +
    1;
  return Math.floor(((joursParAn * Math.min(12, mois)) / 12) * 2) / 2;
}

export type RubriqueCalcul = {
  code: string;
  libelle: string;
  type: string;
  mode: string;
  // Valeur retenue pour l'employé (la sienne si elle existe, sinon celle de la rubrique).
  valeur: number;
  plafond: number | null;
  compteNumero: string | null;
  ordre: number;
};

export type EntreePaie = {
  salaireBase: number;
  // Part du mois couverte par le contrat (1 pour un mois complet).
  prorata: number;
  tauxHoraire: number;
  heuresVacation: number;
  joursAbsence: number;
  joursOuvresMois: number;
  rubriques: RubriqueCalcul[];
  // Montants saisis pour les rubriques variables.
  ajustements: Record<string, number>;
};

export type LignePaie = {
  code: string;
  libelle: string;
  type: string;
  base: number | null;
  taux: number | null;
  montant: number;
  compteNumero: string | null;
};

// Les montants sont en francs entiers.
const franc = (value: number) => Math.round(value);

export function calculerBulletin(entree: EntreePaie) {
  const lignes: LignePaie[] = [];
  const salaireBase = franc(entree.salaireBase * entree.prorata);
  if (salaireBase > 0)
    lignes.push({
      code: 'BASE',
      libelle:
        entree.prorata < 1
          ? `Salaire de base (${Math.round(entree.prorata * 100)} % du mois)`
          : 'Salaire de base',
      type: 'GAIN',
      base: null,
      taux: null,
      montant: salaireBase,
      compteNumero: null,
    });
  const vacation = franc(entree.heuresVacation * entree.tauxHoraire);
  if (vacation > 0)
    lignes.push({
      code: 'VACATION',
      libelle: 'Heures de cours effectuées',
      type: 'GAIN',
      base: entree.heuresVacation,
      taux: entree.tauxHoraire,
      montant: vacation,
      compteNumero: null,
    });
  // Une absence non rémunérée ne peut pas coûter plus que le salaire de base.
  const absence = Math.min(
    salaireBase,
    entree.joursOuvresMois > 0
      ? franc(
          (entree.salaireBase / entree.joursOuvresMois) * entree.joursAbsence,
        )
      : 0,
  );
  if (absence > 0)
    lignes.push({
      code: 'ABSENCE',
      libelle: 'Absences non rémunérées',
      type: 'GAIN',
      base: entree.joursAbsence,
      taux: franc(entree.salaireBase / entree.joursOuvresMois),
      montant: -absence,
      compteNumero: null,
    });

  const rubriques = [...entree.rubriques].sort(
    (a, b) => a.ordre - b.ordre || a.code.localeCompare(b.code),
  );
  const remuneration = salaireBase + vacation - absence;
  const montant = (rubrique: RubriqueCalcul, brut: number) => {
    if (rubrique.mode === 'FIXE')
      return { base: null, taux: null, montant: franc(rubrique.valeur) };
    if (rubrique.mode === 'VARIABLE')
      return {
        base: null,
        taux: null,
        montant: franc(entree.ajustements[rubrique.code] ?? rubrique.valeur),
      };
    // Pour un gain, le brut n'est pas encore connu : le pourcentage porte sur la rémunération de base.
    const assiette =
      rubrique.mode === 'POURCENTAGE_BASE' || rubrique.type === 'GAIN'
        ? rubrique.mode === 'POURCENTAGE_BASE'
          ? salaireBase
          : remuneration
        : brut;
    const base =
      rubrique.plafond === null
        ? assiette
        : Math.min(assiette, rubrique.plafond);
    return {
      base,
      taux: rubrique.valeur,
      montant: franc((base * rubrique.valeur) / 100),
    };
  };
  const ajouter = (type: string, brut: number) => {
    for (const rubrique of rubriques.filter((item) => item.type === type)) {
      const calcul = montant(rubrique, brut);
      if (calcul.montant === 0) continue;
      lignes.push({
        code: rubrique.code,
        libelle: rubrique.libelle,
        type,
        ...calcul,
        compteNumero: rubrique.compteNumero,
      });
    }
  };
  ajouter('GAIN', 0);
  const total = (type: string) =>
    lignes
      .filter((ligne) => ligne.type === type)
      .reduce((somme, ligne) => somme + ligne.montant, 0);
  const brut = Math.max(0, total('GAIN'));
  ajouter('RETENUE', brut);
  ajouter('PATRONALE', brut);
  const totalRetenues = total('RETENUE');
  return {
    lignes,
    salaireBase,
    brut,
    totalRetenues,
    net: brut - totalRetenues,
    chargesPatronales: total('PATRONALE'),
  };
}
