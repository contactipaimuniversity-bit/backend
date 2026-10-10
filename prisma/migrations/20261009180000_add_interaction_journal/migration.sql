CREATE TABLE "journal_interactions" (
    "id" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "utilisateurNom" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "element" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "contexte" TEXT,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_interactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "journal_interactions_date_idx" ON "journal_interactions"("date");
CREATE INDEX "journal_interactions_utilisateurId_date_idx" ON "journal_interactions"("utilisateurId", "date");
