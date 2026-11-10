-- AlterTable
ALTER TABLE "seances_cours" ADD COLUMN     "heureArrivee" TEXT,
ADD COLUMN     "heureDepart" TEXT;

-- CreateTable
CREATE TABLE "retards_etudiants" (
    "id" TEXT NOT NULL,
    "seanceId" TEXT NOT NULL,
    "inscriptionId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,

    CONSTRAINT "retards_etudiants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "retards_etudiants_inscriptionId_idx" ON "retards_etudiants"("inscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "retards_etudiants_seanceId_inscriptionId_key" ON "retards_etudiants"("seanceId", "inscriptionId");

-- AddForeignKey
ALTER TABLE "retards_etudiants" ADD CONSTRAINT "retards_etudiants_seanceId_fkey" FOREIGN KEY ("seanceId") REFERENCES "seances_cours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retards_etudiants" ADD CONSTRAINT "retards_etudiants_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "inscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
