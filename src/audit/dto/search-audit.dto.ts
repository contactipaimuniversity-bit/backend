export class SearchAuditDto {
  q?: string;
  utilisateurId?: string;
  ressource?: string;
  methode?: string;
  entiteId?: string;
  resultat?: string;
  dateDebut?: string;
  dateFin?: string;
  page?: string;
  limit?: string;
  // Flux : types voulus (action, echec, navigation, clic), curseur et écran.
  types?: string;
  avant?: string;
  page_?: string;
}
