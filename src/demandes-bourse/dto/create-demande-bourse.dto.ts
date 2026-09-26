export class CreateDemandeBourseDto {
  personneId!: string;
  niveauDemande!: string;
  filiereSouhaitee!: string;
  filiereSecondaireSouhaitee?: string;
  ecoleOrigine?: string;
}
