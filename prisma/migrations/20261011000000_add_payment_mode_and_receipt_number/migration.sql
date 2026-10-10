-- AlterTable
ALTER TABLE "paiements" ADD COLUMN     "modePaiement" TEXT,
ADD COLUMN     "numeroRecu" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "paiements_numeroRecu_key" ON "paiements"("numeroRecu");

-- Les encaissements et remboursements déjà enregistrés reçoivent leur numéro
-- de reçu, dans l'ordre où le serveur les a reçus ; la suite reprend ensuite.
WITH numerotes AS (
  SELECT id,
         EXTRACT(YEAR FROM "enregistreLe")::int AS annee,
         ROW_NUMBER() OVER (
           PARTITION BY EXTRACT(YEAR FROM "enregistreLe")
           ORDER BY "enregistreLe", id
         ) AS rang
  FROM "paiements"
  WHERE "typePaiement"::text IN ('FRAIS_DEPOT', 'FRAIS_INSCRIPTION', 'ECHEANCE_BOURSE', 'REMBOURSEMENT')
)
UPDATE "paiements" p
SET "numeroRecu" = 'RC-' || n.annee || '-' || LPAD(n.rang::text, 6, '0')
FROM numerotes n
WHERE p.id = n.id;

INSERT INTO "sequences_numero" ("cle", "valeur")
SELECT 'RC-' || EXTRACT(YEAR FROM "enregistreLe")::int, COUNT(*)
FROM "paiements"
WHERE "numeroRecu" IS NOT NULL
GROUP BY EXTRACT(YEAR FROM "enregistreLe")::int
ON CONFLICT ("cle") DO UPDATE SET "valeur" = EXCLUDED."valeur";
