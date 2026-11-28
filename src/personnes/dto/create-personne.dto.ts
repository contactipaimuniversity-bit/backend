export class CreatePersonneDto {
  nom!: string;
  prenom!: string;
  telephone?: string;
  quartier?: string;
  ville?: string;
  dateNaissance?: string;
  lieuNaissance?: string;
  sexe?: string | null;
  tuteurNom?: string;
  tuteurPrenom?: string;
  tuteurTelephone?: string;
}
