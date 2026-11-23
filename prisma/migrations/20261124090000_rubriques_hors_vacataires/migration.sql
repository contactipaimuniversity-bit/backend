-- Rubriques générales réservées aux salariés : les vacataires, payés à la
-- séance, n'ont ni cotisations ni primes fixes. Les rubriques saisies chaque
-- mois (avance, prime exceptionnelle, impôt...) restent possibles pour tous.
ALTER TABLE "rubriques_paie" ADD COLUMN "exclutVacataires" BOOLEAN NOT NULL DEFAULT false;

UPDATE "rubriques_paie" SET "exclutVacataires" = true
WHERE "appliqueATous" AND "mode" <> 'VARIABLE';
