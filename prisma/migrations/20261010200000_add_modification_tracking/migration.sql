-- AlterTable
ALTER TABLE "candidatures_personnel" ADD COLUMN     "modifieLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "demandes_bourse" ADD COLUMN     "modifieLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "elements_dossier" ADD COLUMN     "modifieLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "inscriptions" ADD COLUMN     "modifieLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "paiements" ADD COLUMN     "enregistreLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "personnes" ADD COLUMN     "modifieLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "prospect_relances" ADD COLUMN     "enregistreLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "prospects" ADD COLUMN     "modifieLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "demandes_bourse_modifieLe_idx" ON "demandes_bourse"("modifieLe");

-- CreateIndex
CREATE INDEX "elements_dossier_modifieLe_idx" ON "elements_dossier"("modifieLe");

-- CreateIndex
CREATE INDEX "inscriptions_modifieLe_idx" ON "inscriptions"("modifieLe");

-- CreateIndex
CREATE INDEX "paiements_enregistreLe_idx" ON "paiements"("enregistreLe");

-- CreateIndex
CREATE INDEX "personnes_modifieLe_idx" ON "personnes"("modifieLe");

-- CreateIndex
CREATE INDEX "prospect_relances_enregistreLe_idx" ON "prospect_relances"("enregistreLe");

-- CreateIndex
CREATE INDEX "prospects_modifieLe_idx" ON "prospects"("modifieLe");
