import { CreatePersonneDto } from '../../personnes/dto/create-personne.dto';

export class CreateInscriptionDto {
  personneId?: string;
  nouvellePersonne?: CreatePersonneDto;
  anneeScolaire!: string;
  niveau!: string;
  filiere!: string;
  // Filière du référentiel ; à défaut, le texte saisi est rapproché par son nom.
  filiereId?: string;
  viaBourse?: boolean;
  demandeBourseId?: string;
  confirmerDemandeEnCours?: boolean;
  preparation?: {
    statuses?: Record<string, string>;
    montant?: string | number;
    typePaiement?: string;
    modePaiement?: string;
    elementId?: string;
  };
}
