export class UpdateCandidaturePersonnelDto {
  nom?: string;
  prenom?: string;
  dateNaissance?: string | null;
  diplome?: string;
  fonction?: string;
  quartier?: string | null;
  statut?: string;
  dateEntretien?: string | null;
  equipeEntretien?: string | null;
  remarques?: string | null;
}
