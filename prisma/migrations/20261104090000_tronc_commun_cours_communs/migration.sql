-- AlterTable
ALTER TABLE "creneaux" ADD COLUMN     "regroupement" TEXT;

-- AlterTable
ALTER TABLE "filieres" ADD COLUMN     "troncCommun" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "creneaux_regroupement_idx" ON "creneaux"("regroupement");
