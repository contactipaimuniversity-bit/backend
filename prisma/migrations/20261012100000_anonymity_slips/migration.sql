-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN     "anonymatLeveLe" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notes" ADD COLUMN     "codeAnonymat" TEXT;

-- AlterTable
ALTER TABLE "parametres_academiques" ADD COLUMN     "anonymatObligatoire" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "notes_evaluationId_codeAnonymat_key" ON "notes"("evaluationId", "codeAnonymat");

-- Les épreuves déjà anonymes gardent leurs numéros, repris comme codes de fiche.
UPDATE "notes" SET "codeAnonymat" = 'IPAIM-' || "numeroAnonymat"::text || 'A' WHERE "numeroAnonymat" IS NOT NULL;

-- Une épreuve anonyme déjà validée a eu son anonymat levé ce jour-là.
UPDATE "evaluations" SET "anonymatLeveLe" = "dateValidation" WHERE "anonyme" = true AND "dateValidation" IS NOT NULL;
