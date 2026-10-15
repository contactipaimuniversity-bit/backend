// Informations du dossier modifiables après le dépôt (l'identité se corrige sur la personne).
export class UpdateDemandeBourseDto {
  niveauDemande?: string;
  filiereSouhaitee?: string;
  filiereSecondaireSouhaitee?: string | null;
  ecoleOrigine?: string | null;
}
