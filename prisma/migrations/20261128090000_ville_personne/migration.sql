-- Ville de résidence, à côté du quartier.
ALTER TABLE "personnes" ADD COLUMN "ville" TEXT;

-- Les fiches dont le quartier est « Pointe-Noire » : c'est la ville.
UPDATE "personnes"
SET "ville" = 'POINTE-NOIRE'
WHERE upper(trim("quartier")) IN ('POINTE-NOIRE', 'POINTE NOIRE');
