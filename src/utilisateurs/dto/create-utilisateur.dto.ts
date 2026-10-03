export class CreateUtilisateurDto {
  nom!: string;
  email!: string;
  motDePasse!: string;
  role?: string;
  posteId?: string | null;
  permissions?: string[];
}
