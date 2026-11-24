-- Diapositives du carrousel de la vitrine publique, gérées par l'administration.
CREATE TABLE "diapositives_vitrine" (
    "id" TEXT NOT NULL,
    "surtitre" TEXT,
    "titre" TEXT NOT NULL,
    "texte" TEXT,
    "boutonLibelle" TEXT,
    "boutonLien" TEXT,
    "imagePublicId" TEXT,
    "imageUrl" TEXT,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeParNom" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diapositives_vitrine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "diapositives_vitrine_actif_ordre_idx" ON "diapositives_vitrine"("actif", "ordre");
