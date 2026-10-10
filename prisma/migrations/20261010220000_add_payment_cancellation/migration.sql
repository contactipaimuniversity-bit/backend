-- AlterEnum
ALTER TYPE "TypePaiement" ADD VALUE 'ANNULATION';

-- AlterTable
ALTER TABLE "paiements" ADD COLUMN     "annulePaiementId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "paiements_annulePaiementId_key" ON "paiements"("annulePaiementId");

-- AddForeignKey
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_annulePaiementId_fkey" FOREIGN KEY ("annulePaiementId") REFERENCES "paiements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
