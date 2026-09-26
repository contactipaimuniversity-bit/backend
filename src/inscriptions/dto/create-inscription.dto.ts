export class CreateInscriptionDto {
  personneId!: string;
  anneeScolaire!: string;
  niveau!: string;
  filiere!: string;
  viaBourse?: boolean;
  demandeBourseId?: string;
  confirmerDemandeEnCours?: boolean;
}
