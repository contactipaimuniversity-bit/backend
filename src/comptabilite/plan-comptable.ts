// Plan comptable de départ, inspiré du SYSCOHADA et limité aux comptes utiles à
// un établissement d'enseignement. Il se complète depuis l'écran Comptabilité.
export const PLAN_COMPTABLE: Array<[string, string]> = [
  ['101', 'Capital social'],
  ['121', 'Report à nouveau'],
  ['131', "Résultat net de l'exercice"],
  ['162', 'Emprunts auprès des établissements de crédit'],
  ['213', 'Logiciels'],
  ['231', 'Bâtiments'],
  ['241', 'Matériel et outillage'],
  ['244', 'Matériel et mobilier de bureau'],
  ['245', 'Matériel de transport'],
  ['284', 'Amortissements du matériel'],
  ['401', 'Fournisseurs'],
  ['411', 'Étudiants et clients'],
  ['421', 'Personnel, avances et acomptes'],
  ['422', 'Personnel, rémunérations dues'],
  ['431', 'Sécurité sociale (CNSS)'],
  ['441', 'État, impôt sur les bénéfices'],
  ['447', 'État, impôts retenus à la source'],
  ['471', "Comptes d'attente"],
  ['521', 'Banques'],
  ['552', 'Monnaie électronique (mobile money)'],
  ['571', 'Caisse'],
  ['585', 'Virements de fonds'],
  ['604', 'Achats de matières et fournitures'],
  ['6047', 'Fournitures de bureau'],
  ['605', 'Eau, électricité et autres achats non stockés'],
  ['6056', 'Petit matériel et outillage'],
  ['618', 'Frais de transport et de mission'],
  ['622', 'Locations et charges locatives'],
  ['624', 'Entretien, réparations et maintenance'],
  ['625', "Primes d'assurance"],
  ['627', 'Publicité, publications et relations publiques'],
  ['628', 'Frais de télécommunications'],
  ['631', 'Frais bancaires'],
  ['632', "Honoraires et rémunérations d'intermédiaires"],
  ['638', 'Autres charges externes'],
  ['641', 'Impôts et taxes'],
  ['658', 'Charges diverses'],
  ['661', 'Rémunérations du personnel'],
  ['664', 'Charges sociales'],
  ['671', 'Intérêts des emprunts'],
  ['681', 'Dotations aux amortissements'],
  ['7061', 'Frais de dépôt de dossier'],
  ['7062', "Frais d'inscription"],
  ['7063', 'Frais de scolarité'],
  ['707', 'Produits accessoires'],
  ['718', "Autres produits d'exploitation"],
  ['758', 'Produits divers'],
];

export const JOURNAUX: Record<string, string> = {
  CA: 'Caisse',
  BQ: 'Banque',
  MM: 'Mobile money',
  AC: 'Achats',
  PA: 'Paie',
  OD: 'Opérations diverses',
};

// Compte de trésorerie et journal selon le mode de règlement.
export function tresorerie(mode: string | null | undefined) {
  if (mode === 'VIREMENT' || mode === 'CHEQUE')
    return { compte: '521', journal: 'BQ' };
  if (mode === 'MOBILE_MONEY') return { compte: '552', journal: 'MM' };
  return { compte: '571', journal: 'CA' };
}

export const COMPTE_PRODUIT: Record<string, string> = {
  FRAIS_DEPOT: '7061',
  FRAIS_INSCRIPTION: '7062',
  ECHEANCE_BOURSE: '7063',
};

// Compte de charge proposé pour les catégories de dépense créées par défaut.
const CHARGES_PAR_CATEGORIE: Array<[RegExp, string]> = [
  [/fourniture/i, '6047'],
  [/p[ée]dagogique/i, '604'],
  [/mat[ée]riel|[ée]quipement/i, '6056'],
  [/entretien|r[ée]paration/i, '624'],
  [/prestation|honoraire/i, '632'],
  [/loyer|locati/i, '622'],
  [/\beau\b|[ée]lectricit[ée]|internet/i, '605'],
  [/salaire/i, '661'],
  [/transport|mission/i, '618'],
  [/communication|publicit[ée]/i, '627'],
  [/imp[oô]t|taxe/i, '641'],
];

export function compteDeCharge(categorie: {
  nom: string;
  compteNumero: string | null;
}): string {
  return (
    categorie.compteNumero ??
    CHARGES_PAR_CATEGORIE.find(([motif]) => motif.test(categorie.nom))?.[1] ??
    '658'
  );
}

export type LigneSaisie = {
  compte: string;
  debit: number;
  credit: number;
  libelle?: string | null;
};

const centimes = (value: number) => Math.round(value * 100);

// Une écriture est équilibrée, et chaque ligne est soit au débit, soit au crédit.
export function controleEcriture(lignes: LigneSaisie[]): string | null {
  if (lignes.length < 2) return 'Une écriture comporte au moins deux lignes';
  for (const ligne of lignes) {
    if (ligne.debit < 0 || ligne.credit < 0)
      return 'Un montant ne peut pas être négatif';
    if (ligne.debit > 0 === ligne.credit > 0)
      return `La ligne du compte ${ligne.compte} doit porter un montant, au débit ou au crédit, pas les deux`;
  }
  const debit = lignes.reduce(
    (total, ligne) => total + centimes(ligne.debit),
    0,
  );
  const credit = lignes.reduce(
    (total, ligne) => total + centimes(ligne.credit),
    0,
  );
  if (debit !== credit)
    return `Écriture déséquilibrée : ${(debit / 100).toLocaleString('fr-FR')} au débit pour ${(credit / 100).toLocaleString('fr-FR')} au crédit`;
  return null;
}

// Regroupe les lignes d'un même compte et d'un même sens.
export function regrouper(lignes: LigneSaisie[]): LigneSaisie[] {
  const groupes = new Map<string, LigneSaisie>();
  for (const ligne of lignes) {
    if (ligne.debit === 0 && ligne.credit === 0) continue;
    const cle = `${ligne.compte}:${ligne.debit > 0 ? 'D' : 'C'}`;
    const groupe = groupes.get(cle) ?? {
      compte: ligne.compte,
      debit: 0,
      credit: 0,
      libelle: ligne.libelle,
    };
    groupe.debit += ligne.debit;
    groupe.credit += ligne.credit;
    groupes.set(cle, groupe);
  }
  return [...groupes.values()];
}
