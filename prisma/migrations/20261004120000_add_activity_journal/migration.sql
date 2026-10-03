CREATE TABLE "journal_activite" (
    "id" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "utilisateurNom" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ressource" TEXT NOT NULL,
    "entiteId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_activite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "journal_activite_date_idx" ON "journal_activite"("date");
CREATE INDEX "journal_activite_utilisateurId_date_idx" ON "journal_activite"("utilisateurId", "date");