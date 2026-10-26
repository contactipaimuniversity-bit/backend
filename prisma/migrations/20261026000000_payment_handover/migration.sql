-- AlterTable
ALTER TABLE "paiements" ADD COLUMN     "remiseMotif" TEXT,
ADD COLUMN     "remiseTraiteeLe" TIMESTAMP(3),
ADD COLUMN     "remiseTraiteeParId" TEXT,
ADD COLUMN     "remiseTraiteeParNom" TEXT,
ADD COLUMN     "saisiParId" TEXT,
ADD COLUMN     "statutRemise" TEXT NOT NULL DEFAULT 'EN_ATTENTE';

-- CreateIndex
CREATE INDEX "paiements_statutRemise_datePaiement_idx" ON "paiements"("statutRemise", "datePaiement");
