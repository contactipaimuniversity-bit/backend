ALTER TABLE "journal_activite"
ADD COLUMN "methode" TEXT,
ADD COLUMN "chemin" TEXT,
ADD COLUMN "statutHttp" INTEGER,
ADD COLUMN "dureeMs" INTEGER,
ADD COLUMN "ip" TEXT,
ADD COLUMN "navigateur" TEXT,
ADD COLUMN "erreur" TEXT,
ADD COLUMN "donnees" JSONB,
ADD COLUMN "modifications" JSONB;

CREATE INDEX "journal_activite_ressource_date_idx" ON "journal_activite"("ressource", "date");

CREATE TABLE "journal_navigation" (
    "id" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "utilisateurNom" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "debut" TIMESTAMP(3) NOT NULL,
    "dureeMs" INTEGER NOT NULL,

    CONSTRAINT "journal_navigation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "journal_navigation_debut_idx" ON "journal_navigation"("debut");
CREATE INDEX "journal_navigation_utilisateurId_debut_idx" ON "journal_navigation"("utilisateurId", "debut");
