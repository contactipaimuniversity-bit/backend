export class UpdateElementRequisDto {
  nom?: string;
  categorie?: string;
  contexte?: string;
  niveauApplicable?: string;
  obligatoire?: boolean;
  montantAttendu?: string | number | null;
  elementSubstitutId?: string | null;
}
