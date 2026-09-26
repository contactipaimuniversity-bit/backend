-- CreateEnum
CREATE TYPE "StatutRelance" AS ENUM ('A_RELANCER', 'RELANCE', 'CONVERTI', 'ABANDONNE');

-- CreateEnum
CREATE TYPE "NiveauDemande" AS ENUM ('PREMIERE_ANNEE', 'DEUXIEME_ANNEE');

-- CreateEnum
CREATE TYPE "StatutDemandeBourse" AS ENUM ('EN_ATTENTE', 'ENTRETIEN_PROGRAMME', 'EN_DELIBERATION', 'ACCEPTEE', 'REFUSEE');

-- CreateEnum
CREATE TYPE "StatutInscription" AS ENUM ('EN_COURS', 'COMPLETE', 'ABANDONNEE');

-- CreateEnum
CREATE TYPE "CategorieElement" AS ENUM ('DOCUMENT', 'FOURNITURE', 'FRAIS');

-- CreateEnum
CREATE TYPE "ContexteElement" AS ENUM ('BOURSE', 'INSCRIPTION_DIRECTE', 'TOUS');

-- CreateEnum
CREATE TYPE "NiveauApplicable" AS ENUM ('PREMIERE_ANNEE', 'DEUXIEME_ANNEE_PLUS', 'TOUS');

-- CreateEnum
CREATE TYPE "StatutElementDossier" AS ENUM ('ATTENDU', 'FOURNI', 'MANQUANT', 'SUBSTITUE');

-- CreateEnum
CREATE TYPE "TypePaiement" AS ENUM ('FRAIS_DEPOT', 'FRAIS_INSCRIPTION', 'ECHEANCE_BOURSE');

-- CreateTable
CREATE TABLE "utilisateurs" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "motDePasse" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "utilisateurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personnes" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "telephone" TEXT,
    "quartier" TEXT,
    "dateNaissance" TIMESTAMP(3),
    "lieuNaissance" TEXT,
    "tuteurNom" TEXT,
    "tuteurPrenom" TEXT,
    "tuteurTelephone" TEXT,
    "dateEnregistrement" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeParId" TEXT,

    CONSTRAINT "personnes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospects" (
    "id" TEXT NOT NULL,
    "personneId" TEXT NOT NULL,
    "filiereSouhaitee" TEXT,
    "intention" TEXT,
    "statutRelance" "StatutRelance" NOT NULL DEFAULT 'A_RELANCER',

    CONSTRAINT "prospects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "themes_discussion" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "themes_discussion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "types_bourse" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "fraisInscription" DECIMAL(10,2) NOT NULL,
    "tauxReduction" DECIMAL(5,2),

    CONSTRAINT "types_bourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "echeances_bourse" (
    "id" TEXT NOT NULL,
    "typeBourseId" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL,
    "montantAttendu" DECIMAL(10,2),

    CONSTRAINT "echeances_bourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demandes_bourse" (
    "id" TEXT NOT NULL,
    "personneId" TEXT NOT NULL,
    "niveauDemande" "NiveauDemande" NOT NULL,
    "filiereSouhaitee" TEXT NOT NULL,
    "ecoleOrigine" TEXT,
    "dateDepot" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateEntretien" TIMESTAMP(3),
    "equipeEntretien" TEXT,
    "dateDecision" TIMESTAMP(3),
    "typeBourseId" TEXT,
    "statut" "StatutDemandeBourse" NOT NULL DEFAULT 'EN_ATTENTE',

    CONSTRAINT "demandes_bourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inscriptions" (
    "id" TEXT NOT NULL,
    "personneId" TEXT NOT NULL,
    "anneeScolaire" TEXT NOT NULL,
    "niveau" TEXT NOT NULL,
    "filiere" TEXT NOT NULL,
    "viaBourse" BOOLEAN NOT NULL DEFAULT false,
    "demandeBourseId" TEXT,
    "dateInscription" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statut" "StatutInscription" NOT NULL DEFAULT 'EN_COURS',

    CONSTRAINT "inscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elements_requis" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "categorie" "CategorieElement" NOT NULL,
    "contexte" "ContexteElement" NOT NULL,
    "niveauApplicable" "NiveauApplicable" NOT NULL,
    "obligatoire" BOOLEAN NOT NULL DEFAULT true,
    "elementSubstitutId" TEXT,

    CONSTRAINT "elements_requis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elements_dossier" (
    "id" TEXT NOT NULL,
    "demandeBourseId" TEXT,
    "inscriptionId" TEXT,
    "elementRequisId" TEXT NOT NULL,
    "statut" "StatutElementDossier" NOT NULL DEFAULT 'ATTENDU',
    "dateFourniture" TIMESTAMP(3),
    "elementSubstitutUtiliseId" TEXT,

    CONSTRAINT "elements_dossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paiements" (
    "id" TEXT NOT NULL,
    "demandeBourseId" TEXT,
    "inscriptionId" TEXT,
    "echeanceId" TEXT,
    "montant" DECIMAL(10,2) NOT NULL,
    "datePaiement" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "typePaiement" "TypePaiement" NOT NULL,

    CONSTRAINT "paiements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "utilisateurs_email_key" ON "utilisateurs"("email");

-- CreateIndex
CREATE UNIQUE INDEX "prospects_personneId_key" ON "prospects"("personneId");

-- CreateIndex
CREATE UNIQUE INDEX "types_bourse_nom_key" ON "types_bourse"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "elements_dossier_demandeBourseId_elementRequisId_key" ON "elements_dossier"("demandeBourseId", "elementRequisId");

-- CreateIndex
CREATE UNIQUE INDEX "elements_dossier_inscriptionId_elementRequisId_key" ON "elements_dossier"("inscriptionId", "elementRequisId");

-- AddForeignKey
ALTER TABLE "personnes" ADD CONSTRAINT "personnes_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_personneId_fkey" FOREIGN KEY ("personneId") REFERENCES "personnes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "themes_discussion" ADD CONSTRAINT "themes_discussion_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "prospects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "echeances_bourse" ADD CONSTRAINT "echeances_bourse_typeBourseId_fkey" FOREIGN KEY ("typeBourseId") REFERENCES "types_bourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demandes_bourse" ADD CONSTRAINT "demandes_bourse_personneId_fkey" FOREIGN KEY ("personneId") REFERENCES "personnes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demandes_bourse" ADD CONSTRAINT "demandes_bourse_typeBourseId_fkey" FOREIGN KEY ("typeBourseId") REFERENCES "types_bourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscriptions" ADD CONSTRAINT "inscriptions_personneId_fkey" FOREIGN KEY ("personneId") REFERENCES "personnes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscriptions" ADD CONSTRAINT "inscriptions_demandeBourseId_fkey" FOREIGN KEY ("demandeBourseId") REFERENCES "demandes_bourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elements_requis" ADD CONSTRAINT "elements_requis_elementSubstitutId_fkey" FOREIGN KEY ("elementSubstitutId") REFERENCES "elements_requis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elements_dossier" ADD CONSTRAINT "elements_dossier_demandeBourseId_fkey" FOREIGN KEY ("demandeBourseId") REFERENCES "demandes_bourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elements_dossier" ADD CONSTRAINT "elements_dossier_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "inscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elements_dossier" ADD CONSTRAINT "elements_dossier_elementRequisId_fkey" FOREIGN KEY ("elementRequisId") REFERENCES "elements_requis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elements_dossier" ADD CONSTRAINT "elements_dossier_elementSubstitutUtiliseId_fkey" FOREIGN KEY ("elementSubstitutUtiliseId") REFERENCES "elements_requis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_demandeBourseId_fkey" FOREIGN KEY ("demandeBourseId") REFERENCES "demandes_bourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "inscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_echeanceId_fkey" FOREIGN KEY ("echeanceId") REFERENCES "echeances_bourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
