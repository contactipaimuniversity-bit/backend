-- CreateTable
CREATE TABLE "comptes_etudiants" (
    "id" TEXT NOT NULL,
    "personneId" TEXT NOT NULL,
    "motDePasse" TEXT,
    "codeActivation" TEXT,
    "codeExpireLe" TIMESTAMP(3),
    "codeCreeParNom" TEXT,
    "codeCreeLe" TIMESTAMP(3),
    "activeLe" TIMESTAMP(3),
    "derniereConnexion" TIMESTAMP(3),
    "echecs" INTEGER NOT NULL DEFAULT 0,
    "bloqueJusqua" TIMESTAMP(3),
    "versionJeton" INTEGER NOT NULL DEFAULT 0,
    "desactiveLe" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comptes_etudiants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comptes_etudiants_personneId_key" ON "comptes_etudiants"("personneId");

-- AddForeignKey
ALTER TABLE "comptes_etudiants" ADD CONSTRAINT "comptes_etudiants_personneId_fkey" FOREIGN KEY ("personneId") REFERENCES "personnes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
