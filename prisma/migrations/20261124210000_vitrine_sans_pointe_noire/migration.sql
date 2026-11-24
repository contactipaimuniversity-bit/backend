-- Pointe-Noire n'est plus annoncée sur la vitrine : on retire l'actualité et la
-- question de départ qui en parlaient, seulement si elles n'ont pas été modifiées.
DELETE FROM "actualites_vitrine"
WHERE "creeParNom" = 'Contenu initial'
  AND "titre" = 'Dépôt des dossiers de bourse à Pointe-Noire';

DELETE FROM "questions_vitrine"
WHERE "question" = 'Je vis à Pointe-Noire : dois-je venir à Brazzaville ?'
  AND "reponse" LIKE 'Non. Depuis le 1er novembre 2026, les dossiers de bourse sont reçus à Pointe-Noire.%';
