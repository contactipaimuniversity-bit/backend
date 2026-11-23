-- Chaque rubrique choisit les catégories d'employés qu'elle concerne d'office,
-- à la place de « tous / salariés seulement / sur attribution ».
ALTER TABLE "rubriques_paie" ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "rubriques_paie"
SET "categories" = ARRAY['ENSEIGNANT_PERMANENT', 'ADMINISTRATIF', 'TECHNIQUE']
WHERE "appliqueATous" AND "exclutVacataires";

UPDATE "rubriques_paie"
SET "categories" = ARRAY['ENSEIGNANT_PERMANENT', 'ENSEIGNANT_VACATAIRE', 'ADMINISTRATIF', 'TECHNIQUE']
WHERE "appliqueATous" AND NOT "exclutVacataires";

ALTER TABLE "rubriques_paie" DROP COLUMN "appliqueATous",
DROP COLUMN "exclutVacataires";
