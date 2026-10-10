CREATE TABLE "prospect_relances" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "utilisateurId" TEXT,
    "utilisateurNom" TEXT NOT NULL,
    "commentaire" TEXT NOT NULL,
    "intention" TEXT,
    "statutRelance" "StatutRelance" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateProchaineRelance" TIMESTAMP(3),

    CONSTRAINT "prospect_relances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prospect_relances_prospectId_date_idx"
ON "prospect_relances"("prospectId", "date");

ALTER TABLE "prospect_relances"
ADD CONSTRAINT "prospect_relances_prospectId_fkey"
FOREIGN KEY ("prospectId") REFERENCES "prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prospect_relances"
ADD CONSTRAINT "prospect_relances_utilisateurId_fkey"
FOREIGN KEY ("utilisateurId") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;