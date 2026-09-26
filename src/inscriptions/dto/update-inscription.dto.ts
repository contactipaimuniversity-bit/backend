export class UpdateInscriptionDto {
  anneeScolaire?: string;
  niveau?: string;
  filiere?: string;
  viaBourse?: boolean;
  demandeBourseId?: string | null;
  statut?: string;
}
