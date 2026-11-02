// Règles de calcul de la scolarité : sans base de données, donc testables seules.

export type LigneCible = {
  libelle: string;
  dateLimite: Date | null;
  montant: number;
};

type Bourse = {
  nom: string;
  modeScolarite: string;
  tauxReduction: number | null;
  echeances: Array<{
    libelle: string;
    dateEcheance: Date | null;
    montantAttendu: number | null;
  }>;
};

export const arrondir = (montant: number) => Math.round(montant * 100) / 100;

const reduit = (montant: number, taux: number | null) =>
  arrondir(montant * (1 - (taux ?? 0) / 100));

// Le tarif de la filière s'il existe, sinon celui du niveau.
export function tarifDe(
  tarifs: Array<{
    niveau: string;
    filiereId: string | null;
    montantMensuel: number;
  }>,
  niveau: string,
  filiereId: string | null,
): number | null {
  const duNiveau = tarifs.filter((tarif) => tarif.niveau === niveau);
  const propre = filiereId
    ? duNiveau.find((tarif) => tarif.filiereId === filiereId)
    : undefined;
  const parDefaut = duNiveau.find((tarif) => tarif.filiereId === null);
  return (propre ?? parDefaut)?.montantMensuel ?? null;
}

// Ce que l'étudiant doit payer : les mois de l'année, éventuellement réduits,
// ou seulement les échéances de sa bourse (sans montant : le tarif normal).
export function planCible(entree: {
  mois: Array<{ libelle: string; dateLimite: Date }>;
  tarif: number | null;
  bourse: Bourse | null;
  reductionIndividuelle: number | null;
}): LigneCible[] {
  const { mois, tarif, bourse, reductionIndividuelle } = entree;
  if (bourse?.modeScolarite === 'MOIS_FIXES') {
    return bourse.echeances.flatMap((echeance) => {
      const base = echeance.montantAttendu ?? tarif;
      if (base === null) return [];
      return [
        {
          libelle: echeance.libelle,
          dateLimite: echeance.dateEcheance,
          montant: reduit(base, reductionIndividuelle),
        },
      ];
    });
  }
  if (tarif === null) return [];
  const taux = reductionIndividuelle ?? bourse?.tauxReduction ?? null;
  return mois.map((item) => ({
    libelle: item.libelle,
    dateLimite: item.dateLimite,
    montant: reduit(tarif, taux),
  }));
}

export function regimeDe(entree: {
  bourse: { nom: string } | null;
  reductionIndividuelle: number | null;
  bourseRetiree: boolean;
  personnalise: boolean;
}): string {
  const base = entree.bourse
    ? `Bourse ${entree.bourse.nom.replace(/^bourse\s+/i, '')}`
    : entree.bourseRetiree
      ? 'Tarif normal (bourse retirée)'
      : 'Inscription directe · tarif normal';
  const details = [
    entree.reductionIndividuelle !== null
      ? `réduction individuelle de ${entree.reductionIndividuelle} %`
      : null,
    entree.personnalise ? 'échéancier personnalisé' : null,
  ].filter(Boolean);
  return details.length ? `${base} · ${details.join(', ')}` : base;
}

type LigneMois = { dateLimite: Date | null; ordre: number; montant: number };

export const ordreDesMois = (first: LigneMois, second: LigneMois) =>
  (first.dateLimite?.getTime() ?? Infinity) -
    (second.dateLimite?.getTime() ?? Infinity) || first.ordre - second.ordre;

// Le versé solde les mois du plus ancien au plus récent.
export function repartir<T extends LigneMois>(lignes: T[], verse: number) {
  let disponible = Math.max(0, verse);
  return [...lignes].sort(ordreDesMois).map((ligne) => {
    const paye = arrondir(Math.min(ligne.montant, disponible));
    disponible = arrondir(disponible - paye);
    return { ...ligne, paye, reste: arrondir(ligne.montant - paye) };
  });
}

// Nouveau plan d'un étudiant : ce qui est déjà payé, même en partie, ne change
// jamais. À partir d'une date (retrait de bourse), les mois déjà échus restent aussi.
export function fusionnerPlan<T extends LigneMois & { libelle: string }>(
  lignes: T[],
  verse: number,
  cible: LigneCible[],
  aPartirDe: Date | null = null,
) {
  const conservees = repartir(lignes, verse).filter(
    (ligne) =>
      ligne.paye > 0 ||
      (aPartirDe !== null &&
        ligne.dateLimite !== null &&
        ligne.dateLimite < aPartirDe),
  );
  const libelles = new Set(conservees.map((ligne) => ligne.libelle));
  const nouvelles = cible.filter(
    (ligne) =>
      !libelles.has(ligne.libelle) &&
      (aPartirDe === null ||
        ligne.dateLimite === null ||
        ligne.dateLimite >= aPartirDe),
  );
  return { conservees, nouvelles };
}
