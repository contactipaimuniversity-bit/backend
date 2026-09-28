import { CreatePersonneDto } from '../../personnes/dto/create-personne.dto';

export class CreateInscriptionDto {
  personneId?: string;
  nouvellePersonne?: CreatePersonneDto;
  anneeScolaire!: string;
  niveau!: string;
  filiere!: string;
  viaBourse?: boolean;
  demandeBourseId?: string;
  confirmerDemandeEnCours?: boolean;
}
