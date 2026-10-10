UPDATE "elements_requis"
SET "nom" = 'Frais d''inscription L1',
    "niveauApplicable" = 'PREMIERE_ANNEE',
    "montantAttendu" = 30000.00
WHERE "contexte" = 'INSCRIPTION_DIRECTE'
  AND "categorie" = 'FRAIS'
  AND "nom" = 'Frais d''inscription';

INSERT INTO "elements_requis" (
    "id",
    "nom",
    "categorie",
    "contexte",
    "niveauApplicable",
    "obligatoire",
    "montantAttendu"
)
SELECT
    gen_random_uuid()::text,
    'Frais d''inscription L2',
    'FRAIS',
    'INSCRIPTION_DIRECTE',
    'DEUXIEME_ANNEE',
    TRUE,
    35000.00
WHERE NOT EXISTS (
    SELECT 1
    FROM "elements_requis"
    WHERE "contexte" = 'INSCRIPTION_DIRECTE'
      AND "nom" = 'Frais d''inscription L2'
);