CREATE TYPE "StatutCandidaturePersonnel" AS ENUM ('DEPOSE', 'ENTRETIEN_PROGRAMME', 'ENTRETIEN_REALISE', 'RETENU', 'REFUSE');
CREATE TYPE "StatutElementPersonnel" AS ENUM ('ATTENDU', 'FOURNI', 'MANQUANT');

CREATE TABLE "candidatures_personnel" (
  "id" TEXT NOT NULL,
  "nom" TEXT NOT NULL,
  "prenom" TEXT NOT NULL,
  "dateNaissance" TIMESTAMP(3),
  "diplome" TEXT NOT NULL,
  "fonction" TEXT NOT NULL,
  "quartier" TEXT,
  "statut" "StatutCandidaturePersonnel" NOT NULL DEFAULT 'DEPOSE',
  "dateEntretien" TIMESTAMP(3),
  "equipeEntretien" TEXT,
  "remarques" TEXT,
  "dateDepot" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "candidatures_personnel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "elements_personnel" (
  "id" TEXT NOT NULL,
  "candidaturePersonnelId" TEXT NOT NULL,
  "nom" TEXT NOT NULL,
  "obligatoire" BOOLEAN NOT NULL DEFAULT true,
  "statut" "StatutElementPersonnel" NOT NULL DEFAULT 'ATTENDU',
  "dateFourniture" TIMESTAMP(3),
  CONSTRAINT "elements_personnel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "elements_personnel_candidaturePersonnelId_fkey" FOREIGN KEY ("candidaturePersonnelId") REFERENCES "candidatures_personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);