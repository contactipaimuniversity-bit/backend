-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TypePaiement" ADD VALUE 'MENSUALITE';
ALTER TYPE "TypePaiement" ADD VALUE 'FRAIS_ANNEXE';

-- AlterTable
ALTER TABLE "inscriptions" ADD COLUMN     "bourseRetireeLe" TIMESTAMP(3),
ADD COLUMN     "echeancierPersonnalise" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reductionIndividuelle" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "paiements" ADD COLUMN     "ligneScolariteId" TEXT;

-- AlterTable
ALTER TABLE "types_bourse" ADD COLUMN     "modeScolarite" TEXT NOT NULL DEFAULT 'REDUCTION',
ADD COLUMN     "moyenneMinimale" DECIMAL(4,2) DEFAULT 12,
ADD COLUMN     "reductionSurInscription" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verificationMoyenne" TEXT NOT NULL DEFAULT 'SEMESTRE';

-- CreateTable
CREATE TABLE "mois_scolarite" (
    "id" TEXT NOT NULL,
    "anneeScolaire" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL,
    "libelle" TEXT NOT NULL,
    "dateLimite" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mois_scolarite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarifs_scolarite" (
    "id" TEXT NOT NULL,
    "niveau" TEXT NOT NULL,
    "filiereId" TEXT,
    "montantMensuel" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "tarifs_scolarite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "frais_annexes" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "montant" DECIMAL(10,2) NOT NULL,
    "anneeScolaire" TEXT NOT NULL,
    "cible" TEXT NOT NULL DEFAULT 'GROUPE',
    "niveau" TEXT,
    "filiereId" TEXT,
    "dateLimite" TIMESTAMP(3),
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "frais_annexes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lignes_scolarite" (
    "id" TEXT NOT NULL,
    "inscriptionId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MENSUALITE',
    "ordre" INTEGER NOT NULL,
    "libelle" TEXT NOT NULL,
    "dateLimite" TIMESTAMP(3),
    "montant" DECIMAL(10,2) NOT NULL,
    "fraisAnnexeId" TEXT,

    CONSTRAINT "lignes_scolarite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions_bourse" (
    "id" TEXT NOT NULL,
    "inscriptionId" TEXT NOT NULL,
    "deliberationId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "motif" TEXT,
    "parNom" TEXT NOT NULL,
    "le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_bourse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mois_scolarite_anneeScolaire_ordre_key" ON "mois_scolarite"("anneeScolaire", "ordre");

-- CreateIndex
CREATE UNIQUE INDEX "tarifs_scolarite_niveau_filiereId_key" ON "tarifs_scolarite"("niveau", "filiereId");

-- CreateIndex
CREATE INDEX "lignes_scolarite_inscriptionId_type_idx" ON "lignes_scolarite"("inscriptionId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "lignes_scolarite_inscriptionId_fraisAnnexeId_key" ON "lignes_scolarite"("inscriptionId", "fraisAnnexeId");

-- CreateIndex
CREATE UNIQUE INDEX "decisions_bourse_inscriptionId_deliberationId_key" ON "decisions_bourse"("inscriptionId", "deliberationId");

-- AddForeignKey
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_ligneScolariteId_fkey" FOREIGN KEY ("ligneScolariteId") REFERENCES "lignes_scolarite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifs_scolarite" ADD CONSTRAINT "tarifs_scolarite_filiereId_fkey" FOREIGN KEY ("filiereId") REFERENCES "filieres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "frais_annexes" ADD CONSTRAINT "frais_annexes_filiereId_fkey" FOREIGN KEY ("filiereId") REFERENCES "filieres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_scolarite" ADD CONSTRAINT "lignes_scolarite_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "inscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_scolarite" ADD CONSTRAINT "lignes_scolarite_fraisAnnexeId_fkey" FOREIGN KEY ("fraisAnnexeId") REFERENCES "frais_annexes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions_bourse" ADD CONSTRAINT "decisions_bourse_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "inscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions_bourse" ADD CONSTRAINT "decisions_bourse_deliberationId_fkey" FOREIGN KEY ("deliberationId") REFERENCES "deliberations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tarifs de départ, modifiables à l'écran : 30 000 F en L1, 35 000 F en L2.
INSERT INTO "tarifs_scolarite" ("id", "niveau", "montantMensuel")
SELECT v.id, v.niveau, v.montant FROM (VALUES ('tarif-defaut-l1', 'L1', 30000.00), ('tarif-defaut-l2', 'L2', 35000.00)) AS v(id, niveau, montant)
WHERE EXISTS (SELECT 1 FROM "niveaux" n WHERE n."code" = v.niveau);
