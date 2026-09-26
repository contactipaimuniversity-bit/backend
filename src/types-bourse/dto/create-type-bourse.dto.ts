export class CreateTypeBourseDto {
  nom!: string;
  fraisInscription!: string | number;
  tauxReduction?: string | number | null;
}
