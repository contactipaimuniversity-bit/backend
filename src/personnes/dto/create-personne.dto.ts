export class CreatePersonneDto {
  nom!: string;
  prenom!: string;
  telephone?: string;
  quartier?: string;
  dateNaissance?: string;
  lieuNaissance?: string;
  tuteurNom?: string;
  tuteurPrenom?: string;
  tuteurTelephone?: string;
}
