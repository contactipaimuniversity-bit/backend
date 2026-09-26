export class CreateEcheanceDto {
  libelle!: string;
  ordre!: number;
  dateEcheance?: string | null;
  montantAttendu?: string | number | null;
}
