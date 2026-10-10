export class UpdateInscriptionDto {
  anneeScolaire?: string;
  niveau?: string;
  filiere?: string;
  filiereId?: string;
  viaBourse?: boolean;
  demandeBourseId?: string | null;
  statut?: string;
  confirmerDemandeEnCours?: boolean;
}
