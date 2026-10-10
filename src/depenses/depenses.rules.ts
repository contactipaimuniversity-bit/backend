import { Acteur, peut } from '../common/acteur';

export type { Acteur } from '../common/acteur';
export { peut } from '../common/acteur';
export {
  estDansLeFutur,
  exiger,
  parseDate,
  parseMontant,
  roundMoney,
  saisie,
  texteOptionnel,
  texteRequis,
} from '../common/saisie';

// Règles du circuit de dépense, sans accès à la base : elles servent à la fois
// à refuser une action côté serveur et à dire à l'écran ce qui est possible.

export type DepenseCircuit = {
  statut: string;
  niveauxRequis: number;
  initiateurId: string;
  validation1ParId: string | null;
  validation2ParId: string | null;
  montant: unknown;
  montantFacture: unknown;
  livraisonRequise: boolean;
  totalPaye: number;
};

export type ReglesFinance = {
  seuilDoubleValidation: number;
  budgetBloquant: boolean;
  separationPaiement: boolean;
};

// Une dépense soumise réserve déjà son budget, pour ne pas le promettre deux fois.
export const STATUTS_RESERVES = ['SOUMISE', 'VALIDATION_FINALE'] as const;
export const STATUTS_ENGAGES = [
  'VALIDEE',
  'RECEPTIONNEE',
  'FACTUREE',
  'PAYEE_PARTIELLEMENT',
  'PAYEE',
] as const;
export const STATUTS_A_EXECUTER = [
  'VALIDEE',
  'RECEPTIONNEE',
  'FACTUREE',
  'PAYEE_PARTIELLEMENT',
] as const;

// Peut consulter toutes les dépenses, pas seulement celles qu'il a initiées.
export function voitTout(acteur: Acteur): boolean {
  return [
    'view:expense-approval',
    'view:expense-final-approval',
    'view:expense-payment',
    'view:finance-settings',
  ].some((permission) => peut(acteur, permission));
}

export function niveauxRequis(
  montant: number,
  seuilDoubleValidation: number,
  horsBudget: boolean,
): 1 | 2 {
  return horsBudget || montant >= seuilDoubleValidation ? 2 : 1;
}

// Montant qui pèse sur le budget : la facture une fois connue, sinon la demande.
export function montantRetenu(depense: {
  montant: unknown;
  montantFacture: unknown;
}): number {
  return Number(depense.montantFacture ?? depense.montant);
}

// Raison pour laquelle l'acteur ne peut pas statuer sur la dépense, ou null.
export function blocageValidation(
  depense: DepenseCircuit,
  acteur: Acteur,
): string | null {
  if (depense.statut === 'SOUMISE') {
    if (!peut(acteur, 'edit:expense-approval'))
      return 'La validation des dépenses ne vous est pas attribuée';
    if (depense.initiateurId === acteur.id)
      return 'Vous ne pouvez pas valider une dépense que vous avez initiée';
    return null;
  }
  if (depense.statut === 'VALIDATION_FINALE') {
    if (!peut(acteur, 'edit:expense-final-approval'))
      return 'La validation finale des dépenses ne vous est pas attribuée';
    if (depense.initiateurId === acteur.id)
      return 'Vous ne pouvez pas valider une dépense que vous avez initiée';
    if (depense.validation1ParId === acteur.id)
      return 'La seconde validation doit être faite par une autre personne que la première';
    return null;
  }
  return "Cette dépense n'est pas en attente de validation";
}

export function blocageReception(
  depense: DepenseCircuit,
  acteur: Acteur,
): string | null {
  if (!depense.livraisonRequise)
    return 'Cette catégorie de dépense ne donne pas lieu à une livraison';
  if (depense.statut !== 'VALIDEE')
    return "La réception n'est possible que sur une dépense validée";
  if (
    depense.initiateurId !== acteur.id &&
    !peut(acteur, 'edit:expense-payment')
  )
    return "Seuls le demandeur ou le service chargé de l'exécution constatent la livraison";
  return null;
}

export function blocageFacture(
  depense: DepenseCircuit,
  acteur: Acteur,
): string | null {
  if (!peut(acteur, 'edit:expense-payment'))
    return "L'exécution des dépenses ne vous est pas attribuée";
  if (depense.livraisonRequise && depense.statut === 'VALIDEE')
    return 'La livraison doit être constatée avant d’enregistrer la facture';
  const attendu = depense.livraisonRequise ? 'RECEPTIONNEE' : 'VALIDEE';
  if (depense.statut !== attendu)
    return 'La facture ne peut pas être enregistrée à cette étape';
  return null;
}

export function blocagePaiement(
  depense: DepenseCircuit,
  acteur: Acteur,
  regles: Pick<ReglesFinance, 'separationPaiement'>,
): string | null {
  if (!peut(acteur, 'edit:expense-payment'))
    return "L'exécution des dépenses ne vous est pas attribuée";
  if (!['FACTUREE', 'PAYEE_PARTIELLEMENT'].includes(depense.statut))
    return 'Seule une dépense facturée peut être payée';
  if (depense.initiateurId === acteur.id)
    return 'Vous ne pouvez pas payer une dépense que vous avez initiée';
  if (
    regles.separationPaiement &&
    [depense.validation1ParId, depense.validation2ParId].includes(acteur.id)
  )
    return 'Vous ne pouvez pas payer une dépense que vous avez validée';
  return null;
}

export function blocageAnnulation(
  depense: DepenseCircuit,
  acteur: Acteur,
): string | null {
  if (depense.totalPaye > 0)
    return 'Une dépense déjà payée, même en partie, ne peut plus être annulée';
  if (
    ['BROUILLON', 'SOUMISE', 'VALIDATION_FINALE', 'REJETEE'].includes(
      depense.statut,
    )
  ) {
    return depense.initiateurId === acteur.id ||
      peut(acteur, 'edit:expense-approval') ||
      peut(acteur, 'edit:expense-final-approval')
      ? null
      : 'Seuls le demandeur ou un valideur peuvent annuler cette dépense';
  }
  if (['VALIDEE', 'RECEPTIONNEE', 'FACTUREE'].includes(depense.statut)) {
    // Un bon de commande est émis : l'annulation relève d'un valideur.
    return peut(acteur, 'edit:expense-approval') ||
      peut(acteur, 'edit:expense-final-approval')
      ? null
      : 'Une dépense déjà validée ne peut être annulée que par un valideur';
  }
  return 'Cette dépense ne peut plus être annulée';
}

// Ce que l'acteur peut faire maintenant : l'écran n'affiche que ces actions.
export function actionsPossibles(
  depense: DepenseCircuit,
  acteur: Acteur,
  regles: Pick<ReglesFinance, 'separationPaiement'>,
) {
  const estInitiateur = depense.initiateurId === acteur.id;
  const enValidation = ['SOUMISE', 'VALIDATION_FINALE'].includes(
    depense.statut,
  );
  const blocageValider = enValidation
    ? blocageValidation(depense, acteur)
    : null;
  return {
    modifier: estInitiateur && depense.statut === 'BROUILLON',
    soumettre: estInitiateur && depense.statut === 'BROUILLON',
    reprendre: estInitiateur && depense.statut === 'REJETEE',
    valider: enValidation && blocageValider === null,
    blocageValidation: blocageValider,
    receptionner: blocageReception(depense, acteur) === null,
    facturer: blocageFacture(depense, acteur) === null,
    payer: blocagePaiement(depense, acteur, regles) === null,
    blocagePaiement: ['FACTUREE', 'PAYEE_PARTIELLEMENT'].includes(
      depense.statut,
    )
      ? blocagePaiement(depense, acteur, regles)
      : null,
    annuler: blocageAnnulation(depense, acteur) === null,
  };
}
