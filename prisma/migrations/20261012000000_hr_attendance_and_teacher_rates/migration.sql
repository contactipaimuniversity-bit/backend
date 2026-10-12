-- AlterTable
ALTER TABLE "contrats" ADD COLUMN     "periodicitePaie" TEXT NOT NULL DEFAULT 'MENSUEL',
ADD COLUMN     "tarifMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "tarifMontant" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "parametres_rh" ADD COLUMN     "heureArrivee" TEXT NOT NULL DEFAULT '08:00',
ADD COLUMN     "heureDepart" TEXT NOT NULL DEFAULT '16:00',
ADD COLUMN     "toleranceRetard" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "periodes_paie" ADD COLUMN     "echeancesAvancees" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "seances_cours" ADD COLUMN     "horsCreneau" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "periodePaieId" TEXT;

-- CreateTable
CREATE TABLE "absences_enseignants" (
    "id" TEXT NOT NULL,
    "coursId" TEXT NOT NULL,
    "enseignantId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "heureDebut" TEXT NOT NULL,
    "dureeMinutes" INTEGER NOT NULL,
    "justifiee" BOOLEAN NOT NULL DEFAULT false,
    "motif" TEXT,
    "saisieParNom" TEXT NOT NULL,
    "dateSaisie" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absences_enseignants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pointages_personnel" (
    "id" TEXT NOT NULL,
    "employeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "heureArrivee" TEXT,
    "heureDepart" TEXT,
    "observation" TEXT,
    "saisieParNom" TEXT NOT NULL,
    "dateSaisie" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pointages_personnel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "absences_enseignants_enseignantId_date_idx" ON "absences_enseignants"("enseignantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "absences_enseignants_coursId_date_heureDebut_key" ON "absences_enseignants"("coursId", "date", "heureDebut");

-- CreateIndex
CREATE INDEX "pointages_personnel_date_idx" ON "pointages_personnel"("date");

-- CreateIndex
CREATE UNIQUE INDEX "pointages_personnel_employeId_date_key" ON "pointages_personnel"("employeId", "date");

-- CreateIndex
CREATE INDEX "seances_cours_periodePaieId_idx" ON "seances_cours"("periodePaieId");

-- AddForeignKey
ALTER TABLE "absences_enseignants" ADD CONSTRAINT "absences_enseignants_coursId_fkey" FOREIGN KEY ("coursId") REFERENCES "cours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences_enseignants" ADD CONSTRAINT "absences_enseignants_enseignantId_fkey" FOREIGN KEY ("enseignantId") REFERENCES "employes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pointages_personnel" ADD CONSTRAINT "pointages_personnel_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "employes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Les contrats existants gardent leur taux horaire comme tarif « pour 1 heure ».
UPDATE "contrats" SET "tarifMontant" = "tauxHoraire" WHERE "tauxHoraire" > 0;

-- Les heures déjà réglées par une paie validée sont marquées comme payées.
UPDATE "seances_cours" AS s
SET "periodePaieId" = p."id"
FROM "periodes_paie" AS p
JOIN "bulletins_paie" AS b ON b."periodeId" = p."id"
WHERE p."statut" <> 'OUVERTE'
  AND b."employeId" = s."enseignantId"
  AND b."heuresVacation" > 0
  AND EXTRACT(YEAR FROM s."date") = p."annee"
  AND EXTRACT(MONTH FROM s."date") = p."mois";
