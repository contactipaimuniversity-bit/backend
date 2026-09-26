export class UpdatePersonneDto {
  nom?: string;
  prenom?: string;
  telephone?: string | null;
  quartier?: string | null;
  dateNaissance?: string | null;
  lieuNaissance?: string | null;
  tuteurNom?: string | null;
  tuteurPrenom?: string | null;
  tuteurTelephone?: string | null;
}
