-- La rubrique « Vue d'ensemble » se détaille carte par carte et bloc par bloc, et
-- « Résumé de la journée » devient une rubrique à part. Personne ne perd ce qu'il
-- voyait : l'ancien droit donne tout le détail, et « Mon travail du jour », jusqu'ici
-- ouvert à tous, reste attribué à chacun.
UPDATE "utilisateurs" SET "permissions" = ARRAY(
  SELECT DISTINCT droit FROM unnest(
    array_remove(array_remove("permissions", 'view:dashboard'), 'edit:dashboard')
    || ARRAY['view:dashboard-my-work']
    || CASE WHEN 'view:dashboard' = ANY("permissions") THEN ARRAY[
      'view:daily-summary', 'view:dashboard-followups', 'view:dashboard-interviews',
      'view:dashboard-incomplete', 'view:dashboard-unpaid', 'view:dashboard-trend',
      'view:dashboard-prospects', 'view:dashboard-applications', 'view:dashboard-applications-open',
      'view:dashboard-people', 'view:dashboard-enrollments', 'view:dashboard-collected',
      'view:dashboard-receivables', 'view:dashboard-scholarship-types',
      'view:dashboard-recent-applications', 'view:dashboard-recent-enrollments',
      'view:dashboard-incomplete-note'
    ] ELSE ARRAY[]::text[] END
  ) AS droit
);

UPDATE "postes" SET "permissions" = ARRAY(
  SELECT DISTINCT droit FROM unnest(
    array_remove(array_remove("permissions", 'view:dashboard'), 'edit:dashboard')
    || ARRAY['view:dashboard-my-work']
    || CASE WHEN 'view:dashboard' = ANY("permissions") THEN ARRAY[
      'view:daily-summary', 'view:dashboard-followups', 'view:dashboard-interviews',
      'view:dashboard-incomplete', 'view:dashboard-unpaid', 'view:dashboard-trend',
      'view:dashboard-prospects', 'view:dashboard-applications', 'view:dashboard-applications-open',
      'view:dashboard-people', 'view:dashboard-enrollments', 'view:dashboard-collected',
      'view:dashboard-receivables', 'view:dashboard-scholarship-types',
      'view:dashboard-recent-applications', 'view:dashboard-recent-enrollments',
      'view:dashboard-incomplete-note'
    ] ELSE ARRAY[]::text[] END
  ) AS droit
);
