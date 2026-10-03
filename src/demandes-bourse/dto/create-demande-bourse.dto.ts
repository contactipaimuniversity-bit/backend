import { CreatePersonneDto } from '../../personnes/dto/create-personne.dto';

export class CreateDemandeBourseDto {
  personneId?: string;
  nouvellePersonne?: CreatePersonneDto;
  niveauDemande!: string;
  filiereSouhaitee!: string;
  filiereSecondaireSouhaitee?: string;
  ecoleOrigine?: string;
  preparation?: {
    statuses?: Record<string, string>;
    montant?: string | number;
    typePaiement?: string;
    elementId?: string;
  };
}
