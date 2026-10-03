CREATE TABLE "corbeille" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "supprimeParId" TEXT,
    "supprimeParNom" TEXT NOT NULL,
    "dateSuppression" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "donnees" JSONB NOT NULL,

    CONSTRAINT "corbeille_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "corbeille_dateSuppression_idx" ON "corbeille"("dateSuppression");
CREATE INDEX "corbeille_type_idx" ON "corbeille"("type");