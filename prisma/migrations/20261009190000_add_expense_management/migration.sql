-- CreateEnum
CREATE TYPE "StatutDepense" AS ENUM ('BROUILLON', 'SOUMISE', 'VALIDATION_FINALE', 'VALIDEE', 'RECEPTIONNEE', 'FACTUREE', 'PAYEE_PARTIELLEMENT', 'PAYEE', 'REJETEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "TypePieceDepense" AS ENUM ('LETTRE_DEMANDE', 'DEVIS', 'BON_LIVRAISON', 'FACTURE', 'PREUVE_PAIEMENT', 'AUTRE');

-- CreateEnum
CREATE TYPE "ModeDecaissement" AS ENUM ('ESPECES', 'MOBILE_MONEY', 'VIREMENT', 'CHEQUE');

-- CreateTable
CREATE TABLE "parametres_finance" (
    "id" TEXT NOT NULL,
    "seuilDoubleValidation" DECIMAL(12,2) NOT NULL DEFAULT 500000,
    "budgetBloquant" BOOLEAN NOT NULL DEFAULT true,
    "separationPaiement" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "parametres_finance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories_depense" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "livraisonRequise" BOOLEAN NOT NULL DEFAULT true,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categories_depense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fournisseurs" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "email" TEXT,
    "adresse" TEXT,
    "identifiantFiscal" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "fournisseurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercices_budgetaires" (
    "id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "dateDebut" TIMESTAMP(3) NOT NULL,
    "dateFin" TIMESTAMP(3) NOT NULL,
    "cloture" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "exercices_budgetaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lignes_budget" (
    "id" TEXT NOT NULL,
    "exerciceId" TEXT NOT NULL,
    "categorieId" TEXT NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "lignes_budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequences_numero" (
    "cle" TEXT NOT NULL,
    "valeur" INTEGER NOT NULL,

    CONSTRAINT "sequences_numero_pkey" PRIMARY KEY ("cle")
);

-- CreateTable
CREATE TABLE "depenses" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "objet" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "categorieId" TEXT NOT NULL,
    "fournisseurId" TEXT,
    "exerciceId" TEXT,
    "montant" DECIMAL(12,2) NOT NULL,
    "statut" "StatutDepense" NOT NULL DEFAULT 'BROUILLON',
    "niveauxRequis" INTEGER NOT NULL DEFAULT 1,
    "horsBudget" BOOLEAN NOT NULL DEFAULT false,
    "initiateurId" TEXT NOT NULL,
    "initiateurNom" TEXT NOT NULL,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateSoumission" TIMESTAMP(3),
    "validation1ParId" TEXT,
    "validation1ParNom" TEXT,
    "dateValidation1" TIMESTAMP(3),
    "validation2ParId" TEXT,
    "validation2ParNom" TEXT,
    "dateValidation2" TIMESTAMP(3),
    "motifRejet" TEXT,
    "motifAnnulation" TEXT,
    "numeroBonCommande" TEXT,
    "dateBonCommande" TIMESTAMP(3),
    "numeroBonLivraison" TEXT,
    "dateReception" TIMESTAMP(3),
    "receptionParId" TEXT,
    "receptionParNom" TEXT,
    "receptionConforme" BOOLEAN,
    "receptionCommentaire" TEXT,
    "numeroFacture" TEXT,
    "dateFacture" TIMESTAMP(3),
    "montantFacture" DECIMAL(12,2),
    "factureParId" TEXT,
    "factureParNom" TEXT,

    CONSTRAINT "depenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depense_lignes" (
    "id" TEXT NOT NULL,
    "depenseId" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "quantite" DECIMAL(12,2) NOT NULL,
    "prixUnitaire" DECIMAL(12,2) NOT NULL,
    "ordre" INTEGER NOT NULL,

    CONSTRAINT "depense_lignes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depense_pieces" (
    "id" TEXT NOT NULL,
    "depenseId" TEXT NOT NULL,
    "type" "TypePieceDepense" NOT NULL,
    "nom" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "typeRessource" TEXT NOT NULL,
    "taille" INTEGER NOT NULL,
    "ajouteParId" TEXT NOT NULL,
    "ajouteParNom" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depense_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decaissements" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "depenseId" TEXT NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,
    "mode" "ModeDecaissement" NOT NULL,
    "reference" TEXT,
    "datePaiement" TIMESTAMP(3) NOT NULL,
    "payeParId" TEXT NOT NULL,
    "payeParNom" TEXT NOT NULL,
    "dateSaisie" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decaissements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depense_historique" (
    "id" TEXT NOT NULL,
    "depenseId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "statut" "StatutDepense" NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "utilisateurNom" TEXT NOT NULL,
    "commentaire" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depense_historique_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_depense_nom_key" ON "categories_depense"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "fournisseurs_nom_key" ON "fournisseurs"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "exercices_budgetaires_libelle_key" ON "exercices_budgetaires"("libelle");

-- CreateIndex
CREATE UNIQUE INDEX "lignes_budget_exerciceId_categorieId_key" ON "lignes_budget"("exerciceId", "categorieId");

-- CreateIndex
CREATE UNIQUE INDEX "depenses_numero_key" ON "depenses"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "depenses_numeroBonCommande_key" ON "depenses"("numeroBonCommande");

-- CreateIndex
CREATE INDEX "depenses_statut_idx" ON "depenses"("statut");

-- CreateIndex
CREATE INDEX "depenses_initiateurId_idx" ON "depenses"("initiateurId");

-- CreateIndex
CREATE INDEX "depenses_exerciceId_categorieId_idx" ON "depenses"("exerciceId", "categorieId");

-- CreateIndex
CREATE INDEX "depense_pieces_depenseId_idx" ON "depense_pieces"("depenseId");

-- CreateIndex
CREATE UNIQUE INDEX "decaissements_numero_key" ON "decaissements"("numero");

-- CreateIndex
CREATE INDEX "decaissements_depenseId_idx" ON "decaissements"("depenseId");

-- CreateIndex
CREATE INDEX "decaissements_datePaiement_idx" ON "decaissements"("datePaiement");

-- CreateIndex
CREATE INDEX "depense_historique_depenseId_date_idx" ON "depense_historique"("depenseId", "date");

-- AddForeignKey
ALTER TABLE "lignes_budget" ADD CONSTRAINT "lignes_budget_exerciceId_fkey" FOREIGN KEY ("exerciceId") REFERENCES "exercices_budgetaires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_budget" ADD CONSTRAINT "lignes_budget_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "categories_depense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depenses" ADD CONSTRAINT "depenses_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "categories_depense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depenses" ADD CONSTRAINT "depenses_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "fournisseurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depenses" ADD CONSTRAINT "depenses_exerciceId_fkey" FOREIGN KEY ("exerciceId") REFERENCES "exercices_budgetaires"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depense_lignes" ADD CONSTRAINT "depense_lignes_depenseId_fkey" FOREIGN KEY ("depenseId") REFERENCES "depenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depense_pieces" ADD CONSTRAINT "depense_pieces_depenseId_fkey" FOREIGN KEY ("depenseId") REFERENCES "depenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decaissements" ADD CONSTRAINT "decaissements_depenseId_fkey" FOREIGN KEY ("depenseId") REFERENCES "depenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depense_historique" ADD CONSTRAINT "depense_historique_depenseId_fkey" FOREIGN KEY ("depenseId") REFERENCES "depenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
