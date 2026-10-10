export class CreatePersonneDto {
  nom!: string;
  prenom!: string;
  telephone?: string;
  quartier?: string;
  dateNaissance?: string;
  lieuNaissance?: string;
  sexe?: string | null;
  tuteurNom?: string;
  tuteurPrenom?: string;
  tuteurTelephone?: string;
}
