-- CreateTable
CREATE TABLE "futurs_etudiants" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "sexe" TEXT NOT NULL,
    "dateNaissance" TIMESTAMP(3) NOT NULL,
    "telephone" TEXT,
    "ecole" TEXT NOT NULL,
    "classe" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "tuteurNom" TEXT NOT NULL,
    "tuteurPrenom" TEXT NOT NULL,
    "tuteurTelephone" TEXT NOT NULL,
    "filiereSouhaitee" TEXT NOT NULL,
    "dateEnregistrement" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origine" TEXT,
    "contacte" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "futurs_etudiants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "futurs_etudiants_dateEnregistrement_idx" ON "futurs_etudiants"("dateEnregistrement");

-- CreateIndex
CREATE INDEX "futurs_etudiants_filiereSouhaitee_idx" ON "futurs_etudiants"("filiereSouhaitee");
