export class UpdateProspectDto {
  filiereSouhaitee?: string | null;
  intention?: string | null;
  sourceConnaissance?: string | null;
  statutRelance?: string;
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
