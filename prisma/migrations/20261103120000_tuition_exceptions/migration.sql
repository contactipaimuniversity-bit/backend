-- CreateTable
CREATE TABLE "exceptions_scolarite" (
    "id" TEXT NOT NULL,
    "inscriptionId" TEXT NOT NULL,
    "mois" TEXT,
    "elementDossierId" TEXT,
    "mode" TEXT NOT NULL,
    "valeur" DECIMAL(10,2),
    "montantInitial" DECIMAL(10,2) NOT NULL,
    "motif" TEXT NOT NULL,
    "parNom" TEXT NOT NULL,
    "le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exceptions_scolarite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exceptions_scolarite_elementDossierId_key" ON "exceptions_scolarite"("elementDossierId");

-- CreateIndex
CREATE UNIQUE INDEX "exceptions_scolarite_inscriptionId_mois_key" ON "exceptions_scolarite"("inscriptionId", "mois");

-- AddForeignKey
ALTER TABLE "exceptions_scolarite" ADD CONSTRAINT "exceptions_scolarite_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "inscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptions_scolarite" ADD CONSTRAINT "exceptions_scolarite_elementDossierId_fkey" FOREIGN KEY ("elementDossierId") REFERENCES "elements_dossier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

