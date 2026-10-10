-- CreateTable
CREATE TABLE "impressions" (
    "id" TEXT NOT NULL,
    "typeDocument" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "dossierType" TEXT,
    "dossierId" TEXT,
    "libelle" TEXT NOT NULL,
    "reference" TEXT,
    "utilisateurId" TEXT NOT NULL,
    "utilisateurNom" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "impressions_date_idx" ON "impressions"("date");

-- CreateIndex
CREATE INDEX "impressions_utilisateurId_date_idx" ON "impressions"("utilisateurId", "date");

-- CreateIndex
CREATE INDEX "impressions_dossierId_idx" ON "impressions"("dossierId");
