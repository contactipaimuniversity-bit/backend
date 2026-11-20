-- CreateTable
CREATE TABLE "annonces" (
    "id" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "importance" TEXT NOT NULL DEFAULT 'NORMALE',
    "epinglee" BOOLEAN NOT NULL DEFAULT false,
    "filiereId" TEXT,
    "niveau" TEXT,
    "classeId" TEXT,
    "publieeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expireLe" TIMESTAMP(3),
    "creeParId" TEXT,
    "creeParNom" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annonces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "annonces_publieeLe_idx" ON "annonces"("publieeLe");
