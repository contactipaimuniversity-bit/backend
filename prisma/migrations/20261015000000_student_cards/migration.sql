-- CreateTable
CREATE TABLE "cartes_etudiant" (
    "id" TEXT NOT NULL,
    "inscriptionId" TEXT NOT NULL,
    "jeton" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "valableJusquau" TIMESTAMP(3) NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeParNom" TEXT NOT NULL,
    "desactiveeLe" TIMESTAMP(3),
    "motifDesactivation" TEXT,

    CONSTRAINT "cartes_etudiant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cartes_etudiant_jeton_key" ON "cartes_etudiant"("jeton");

-- CreateIndex
CREATE INDEX "cartes_etudiant_inscriptionId_idx" ON "cartes_etudiant"("inscriptionId");

-- AddForeignKey
ALTER TABLE "cartes_etudiant" ADD CONSTRAINT "cartes_etudiant_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "inscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
