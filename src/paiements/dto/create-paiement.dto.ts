export class CreatePaiementDto {
  demandeBourseId?: string;
  inscriptionId?: string;
  montant!: string | number;
  typePaiement!: string;
  echeanceId?: string | null;
  elementDossierId?: string | null;
}
