-- AlterTable
ALTER TABLE "comptes_etudiants" ADD COLUMN     "rappelsCours" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rappelsPaiement" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "rappels_envoyes" (
    "cle" TEXT NOT NULL,
    "envoyeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rappels_envoyes_pkey" PRIMARY KEY ("cle")
);

-- CreateIndex
CREATE INDEX "rappels_envoyes_envoyeLe_idx" ON "rappels_envoyes"("envoyeLe");
