export class CreateCandidaturePersonnelDto {
  nom!: string;
  prenom!: string;
  dateNaissance?: string;
  diplome!: string;
  fonction!: string;
  quartier?: string;
  elements?: string[];
}
