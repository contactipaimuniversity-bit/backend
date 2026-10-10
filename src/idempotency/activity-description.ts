const resources: Array<[string, string]> = [
  ['/demandes-bourse', 'demande de bourse'],
  ['/inscriptions', 'inscription'],
  ['/candidatures-personnel', 'dossier de recrutement'],
  ['/prospects', 'prospect'],
  ['/personnes', 'fiche personne'],
  ['/paiements', 'paiement'],
  ['/types-bourse', 'type de bourse'],
  ['/elements-requis', 'élément de référentiel'],
  ['/utilisateurs/postes', 'poste métier'],
  ['/utilisateurs', 'utilisateur'],
  ['/corbeille', 'élément de corbeille'],
  ['/depenses', 'dépense'],
  ['/finances/budget', 'budget'],
  ['/finances', 'paramétrage financier'],
  ['/academique', 'structure académique'],
  ['/scolarite', 'séance de cours'],
  ['/notes', 'notes'],
  ['/deliberations', 'délibération'],
  ['/rh', 'dossier du personnel'],
  ['/paie', 'paie'],
  ['/comptabilite', 'écriture comptable'],
  ['/documents', 'pièce archivée'],
  ['/sauvegardes', 'sauvegarde'],
];

// Étapes du circuit de dépense : l'intitulé dit ce qui a été décidé.
const depenseSteps: Array<[string, string]> = [
  ['/soumettre', 'Soumission'],
  ['/valider', 'Validation'],
  ['/rejeter', 'Rejet'],
  ['/reprendre', 'Reprise pour correction'],
  ['/annuler', 'Annulation'],
  ['/reception', 'Réception de livraison'],
  ['/facture', 'Enregistrement de facture'],
  ['/decaissements', 'Paiement'],
  ['/pieces', 'Ajout de pièce'],
];

// Actions marquantes des autres modules : on nomme la décision, pas la requête.
const generalSteps: Array<[string, string]> = [
  ['/valider', 'Validation'],
  ['/anonymat', 'Mise sous anonymat'],
  ['/copies', 'Saisie de notes anonymes'],
  ['/rouvrir', 'Réouverture'],
  ['/cloturer', 'Clôture'],
  ['/payer', 'Versement'],
  ['/extourner', 'Extourne'],
  ['/affectations', 'Affectation en classe'],
  ['/reinscriptions', 'Réinscription'],
  ['/sortie', 'Sortie des effectifs'],
  ['/reintegration', 'Réintégration'],
  ['/contrats', 'Nouveau contrat'],
  ['/fin', 'Fin de contrat'],
  ['/conges', 'Demande de congé'],
  ['/decision', 'Décision sur un congé'],
  ['/annulation', 'Annulation'],
  ['/absences', 'Absence'],
  ['/recalculer', 'Recalcul'],
  ['/importer', 'Import'],
  ['/test', 'Test de restauration'],
];

export function describeActivity(method: string, route: string) {
  const normalizedRoute = route.split('?')[0].toLocaleLowerCase();
  const resource =
    resources.find(
      ([prefix]) =>
        normalizedRoute === prefix || normalizedRoute.startsWith(`${prefix}/`),
    )?.[1] ?? 'donnée de gestion';

  if (normalizedRoute.endsWith('/restaurer'))
    return { action: `Restauration · ${resource}`, ressource: resource };
  if (normalizedRoute.endsWith('/acces'))
    return {
      action: 'Modification des accès utilisateur',
      ressource: 'accès utilisateur',
    };
  if (normalizedRoute.includes('/elements/'))
    return {
      action: `Mise à jour d’une pièce · ${resource}`,
      ressource: resource,
    };
  if (normalizedRoute.endsWith('/decision') && resource === 'demande de bourse')
    return {
      action: 'Mise à jour d’une décision de bourse',
      ressource: resource,
    };

  const action = generalSteps.find(([suffix]) =>
    normalizedRoute.endsWith(suffix),
  );
  if (action && resource !== 'dépense')
    return { action: `${action[1]} · ${resource}`, ressource: resource };

  const etape = depenseSteps.find(([suffix]) =>
    normalizedRoute.endsWith(suffix),
  );
  if (resource === 'dépense' && etape)
    return { action: `${etape[1]} · dépense`, ressource: resource };

  const verb =
    method.toUpperCase() === 'POST'
      ? 'Création'
      : method.toUpperCase() === 'DELETE'
        ? 'Suppression'
        : 'Modification';
  return { action: `${verb} · ${resource}`, ressource: resource };
}
