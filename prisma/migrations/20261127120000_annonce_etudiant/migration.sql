-- AlterTable
ALTER TABLE "annonces" ADD COLUMN     "personneId" TEXT;

-- CreateIndex
CREATE INDEX "annonces_personneId_idx" ON "annonces"("personneId");
