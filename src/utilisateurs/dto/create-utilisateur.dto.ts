export class CreateUtilisateurDto {
  nom!: string;
  prenom?: string | null;
  email!: string;
  motDePasse!: string;
  role?: string;
  posteId?: string | null;
  permissions?: string[];
}
