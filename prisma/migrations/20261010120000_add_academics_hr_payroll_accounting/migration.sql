-- AlterTable
ALTER TABLE "categories_depense" ADD COLUMN     "compteNumero" TEXT;

-- AlterTable
ALTER TABLE "inscriptions" ADD COLUMN     "classeId" TEXT;

-- AlterTable
ALTER TABLE "personnes" ADD COLUMN     "matricule" TEXT,
ADD COLUMN     "sexe" TEXT;

-- CreateTable
CREATE TABLE "parametres_academiques" (
    "id" TEXT NOT NULL,
    "poidsControleContinu" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "moyenneValidation" DECIMAL(4,2) NOT NULL DEFAULT 10,
    "noteEliminatoire" DECIMAL(4,2),
    "compensationSemestre" BOOLEAN NOT NULL DEFAULT true,
    "compensationAnnuelle" BOOLEAN NOT NULL DEFAULT true,
    "creditsPassage" INTEGER NOT NULL DEFAULT 45,
    "seuilAbsences" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "blocageImpayes" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "parametres_academiques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annees_academiques" (
    "id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "dateDebut" TIMESTAMP(3) NOT NULL,
    "dateFin" TIMESTAMP(3) NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'EN_COURS',

    CONSTRAINT "annees_academiques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filieres" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "filieres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salles" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "capacite" INTEGER,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "salles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" TEXT NOT NULL,
    "anneeAcademiqueId" TEXT NOT NULL,
    "filiereId" TEXT NOT NULL,
    "niveau" TEXT NOT NULL,
    "groupe" TEXT NOT NULL DEFAULT 'A',
    "capacite" INTEGER,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unites_enseignement" (
    "id" TEXT NOT NULL,
    "filiereId" TEXT NOT NULL,
    "niveau" TEXT NOT NULL,
    "semestre" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "unites_enseignement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matieres" (
    "id" TEXT NOT NULL,
    "ueId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "coefficient" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "volumeHoraire" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "matieres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cours" (
    "id" TEXT NOT NULL,
    "classeId" TEXT NOT NULL,
    "matiereId" TEXT NOT NULL,
    "enseignantId" TEXT,

    CONSTRAINT "cours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creneaux" (
    "id" TEXT NOT NULL,
    "coursId" TEXT NOT NULL,
    "jour" INTEGER NOT NULL,
    "heureDebut" TEXT NOT NULL,
    "heureFin" TEXT NOT NULL,
    "salleId" TEXT,

    CONSTRAINT "creneaux_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seances_cours" (
    "id" TEXT NOT NULL,
    "coursId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "heureDebut" TEXT NOT NULL,
    "dureeMinutes" INTEGER NOT NULL,
    "contenu" TEXT NOT NULL,
    "enseignantId" TEXT,
    "saisieParId" TEXT NOT NULL,
    "saisieParNom" TEXT NOT NULL,
    "dateSaisie" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seances_cours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absences_etudiants" (
    "id" TEXT NOT NULL,
    "seanceId" TEXT NOT NULL,
    "inscriptionId" TEXT NOT NULL,
    "justifiee" BOOLEAN NOT NULL DEFAULT false,
    "motif" TEXT,

    CONSTRAINT "absences_etudiants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL,
    "coursId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "bareme" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "salleId" TEXT,
    "surveillant" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'OUVERTE',
    "valideParId" TEXT,
    "valideParNom" TEXT,
    "dateValidation" TIMESTAMP(3),
    "creeParNom" TEXT NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "inscriptionId" TEXT NOT NULL,
    "valeur" DECIMAL(5,2),
    "absent" BOOLEAN NOT NULL DEFAULT false,
    "saisieParNom" TEXT NOT NULL,
    "dateSaisie" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliberations" (
    "id" TEXT NOT NULL,
    "classeId" TEXT NOT NULL,
    "semestre" INTEGER NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'OUVERTE',
    "president" TEXT,
    "membres" TEXT,
    "observations" TEXT,
    "ouverteParNom" TEXT NOT NULL,
    "dateOuverture" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clotureParId" TEXT,
    "clotureParNom" TEXT,
    "dateCloture" TIMESTAMP(3),

    CONSTRAINT "deliberations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultats_deliberation" (
    "id" TEXT NOT NULL,
    "deliberationId" TEXT NOT NULL,
    "inscriptionId" TEXT NOT NULL,
    "moyenne" DECIMAL(5,2),
    "creditsAcquis" INTEGER NOT NULL,
    "creditsTotal" INTEGER NOT NULL,
    "rang" INTEGER,
    "mention" TEXT,
    "decision" TEXT NOT NULL,
    "detail" JSONB NOT NULL,

    CONSTRAINT "resultats_deliberation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametres_rh" (
    "id" TEXT NOT NULL,
    "joursCongeAnnuel" INTEGER NOT NULL DEFAULT 26,
    "joursOuvresMois" INTEGER NOT NULL DEFAULT 26,
    "categoriePaieId" TEXT,

    CONSTRAINT "parametres_rh_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employes" (
    "id" TEXT NOT NULL,
    "matricule" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "sexe" TEXT,
    "dateNaissance" TIMESTAMP(3),
    "telephone" TEXT,
    "email" TEXT,
    "adresse" TEXT,
    "categorie" TEXT NOT NULL,
    "fonction" TEXT NOT NULL,
    "service" TEXT,
    "dateEmbauche" TIMESTAMP(3) NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'ACTIF',
    "dateSortie" TIMESTAMP(3),
    "motifSortie" TEXT,
    "numeroCnss" TEXT,
    "modePaiement" TEXT NOT NULL DEFAULT 'ESPECES',
    "coordonneesPaiement" TEXT,
    "candidatureId" TEXT,
    "utilisateurId" TEXT,

    CONSTRAINT "employes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contrats" (
    "id" TEXT NOT NULL,
    "employeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dateDebut" TIMESTAMP(3) NOT NULL,
    "dateFin" TIMESTAMP(3),
    "salaireBase" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tauxHoraire" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "statut" TEXT NOT NULL DEFAULT 'ACTIF',
    "motifFin" TEXT,
    "creeParNom" TEXT NOT NULL,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contrats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conges" (
    "id" TEXT NOT NULL,
    "employeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dateDebut" TIMESTAMP(3) NOT NULL,
    "dateFin" TIMESTAMP(3) NOT NULL,
    "jours" INTEGER NOT NULL,
    "motif" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'DEMANDE',
    "demandeParId" TEXT NOT NULL,
    "demandeParNom" TEXT NOT NULL,
    "dateDemande" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decideParId" TEXT,
    "decideParNom" TEXT,
    "dateDecision" TIMESTAMP(3),
    "commentaireDecision" TEXT,

    CONSTRAINT "conges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absences_personnel" (
    "id" TEXT NOT NULL,
    "employeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "jours" DECIMAL(4,2) NOT NULL,
    "justifiee" BOOLEAN NOT NULL DEFAULT false,
    "motif" TEXT,
    "saisieParNom" TEXT NOT NULL,
    "dateSaisie" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absences_personnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubriques_paie" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "valeur" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "plafond" DECIMAL(14,2),
    "appliqueATous" BOOLEAN NOT NULL DEFAULT false,
    "compteNumero" TEXT,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "rubriques_paie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employe_rubriques" (
    "id" TEXT NOT NULL,
    "employeId" TEXT NOT NULL,
    "rubriqueId" TEXT NOT NULL,
    "valeur" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "employe_rubriques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periodes_paie" (
    "id" TEXT NOT NULL,
    "annee" INTEGER NOT NULL,
    "mois" INTEGER NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'OUVERTE',
    "prepareParId" TEXT NOT NULL,
    "prepareParNom" TEXT NOT NULL,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valideParId" TEXT,
    "valideParNom" TEXT,
    "dateValidation" TIMESTAMP(3),
    "payeParId" TEXT,
    "payeParNom" TEXT,
    "datePaiement" TIMESTAMP(3),
    "modePaiement" TEXT,

    CONSTRAINT "periodes_paie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulletins_paie" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "periodeId" TEXT NOT NULL,
    "employeId" TEXT NOT NULL,
    "categorie" TEXT NOT NULL,
    "fonction" TEXT NOT NULL,
    "salaireBase" DECIMAL(12,2) NOT NULL,
    "heuresVacation" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "tauxHoraire" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "joursAbsence" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "brut" DECIMAL(12,2) NOT NULL,
    "totalRetenues" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "chargesPatronales" DECIMAL(12,2) NOT NULL,
    "lignes" JSONB NOT NULL,
    "ajustements" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "bulletins_paie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comptes_comptables" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "classe" INTEGER NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "comptes_comptables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecritures_comptables" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "journal" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "libelle" TEXT NOT NULL,
    "reference" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "exerciceId" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'VALIDEE',
    "extourneParId" TEXT,
    "creeParId" TEXT,
    "creeParNom" TEXT NOT NULL,
    "dateSaisie" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valideParNom" TEXT,

    CONSTRAINT "ecritures_comptables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lignes_ecriture" (
    "id" TEXT NOT NULL,
    "ecritureId" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "libelle" TEXT,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "lignes_ecriture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents_archives" (
    "id" TEXT NOT NULL,
    "cibleType" TEXT NOT NULL,
    "cibleId" TEXT NOT NULL,
    "elementDossierId" TEXT,
    "categorie" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "typeRessource" TEXT NOT NULL,
    "taille" INTEGER NOT NULL,
    "ajouteParId" TEXT NOT NULL,
    "ajouteParNom" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_archives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sauvegardes" (
    "id" TEXT NOT NULL,
    "fichier" TEXT NOT NULL,
    "taille" INTEGER NOT NULL DEFAULT 0,
    "tables" INTEGER NOT NULL DEFAULT 0,
    "lignes" INTEGER NOT NULL DEFAULT 0,
    "dureeMs" INTEGER NOT NULL DEFAULT 0,
    "declenchement" TEXT NOT NULL,
    "statut" TEXT NOT NULL,
    "erreur" TEXT,
    "dateTest" TIMESTAMP(3),
    "resultatTest" TEXT,
    "creeParNom" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sauvegardes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "annees_academiques_libelle_key" ON "annees_academiques"("libelle");

-- CreateIndex
CREATE UNIQUE INDEX "filieres_code_key" ON "filieres"("code");

-- CreateIndex
CREATE UNIQUE INDEX "filieres_nom_key" ON "filieres"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "salles_nom_key" ON "salles"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "classes_anneeAcademiqueId_filiereId_niveau_groupe_key" ON "classes"("anneeAcademiqueId", "filiereId", "niveau", "groupe");

-- CreateIndex
CREATE UNIQUE INDEX "unites_enseignement_filiereId_niveau_code_key" ON "unites_enseignement"("filiereId", "niveau", "code");

-- CreateIndex
CREATE UNIQUE INDEX "matieres_ueId_code_key" ON "matieres"("ueId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cours_classeId_matiereId_key" ON "cours"("classeId", "matiereId");

-- CreateIndex
CREATE INDEX "creneaux_coursId_idx" ON "creneaux"("coursId");

-- CreateIndex
CREATE INDEX "seances_cours_coursId_date_idx" ON "seances_cours"("coursId", "date");

-- CreateIndex
CREATE INDEX "seances_cours_enseignantId_date_idx" ON "seances_cours"("enseignantId", "date");

-- CreateIndex
CREATE INDEX "absences_etudiants_inscriptionId_idx" ON "absences_etudiants"("inscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "absences_etudiants_seanceId_inscriptionId_key" ON "absences_etudiants"("seanceId", "inscriptionId");

-- CreateIndex
CREATE INDEX "evaluations_coursId_idx" ON "evaluations"("coursId");

-- CreateIndex
CREATE INDEX "notes_inscriptionId_idx" ON "notes"("inscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "notes_evaluationId_inscriptionId_key" ON "notes"("evaluationId", "inscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "deliberations_classeId_semestre_key" ON "deliberations"("classeId", "semestre");

-- CreateIndex
CREATE INDEX "resultats_deliberation_inscriptionId_idx" ON "resultats_deliberation"("inscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "resultats_deliberation_deliberationId_inscriptionId_key" ON "resultats_deliberation"("deliberationId", "inscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "employes_matricule_key" ON "employes"("matricule");

-- CreateIndex
CREATE UNIQUE INDEX "employes_candidatureId_key" ON "employes"("candidatureId");

-- CreateIndex
CREATE UNIQUE INDEX "employes_utilisateurId_key" ON "employes"("utilisateurId");

-- CreateIndex
CREATE INDEX "contrats_employeId_idx" ON "contrats"("employeId");

-- CreateIndex
CREATE INDEX "conges_employeId_dateDebut_idx" ON "conges"("employeId", "dateDebut");

-- CreateIndex
CREATE INDEX "absences_personnel_employeId_date_idx" ON "absences_personnel"("employeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "rubriques_paie_code_key" ON "rubriques_paie"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employe_rubriques_employeId_rubriqueId_key" ON "employe_rubriques"("employeId", "rubriqueId");

-- CreateIndex
CREATE UNIQUE INDEX "periodes_paie_annee_mois_key" ON "periodes_paie"("annee", "mois");

-- CreateIndex
CREATE UNIQUE INDEX "bulletins_paie_numero_key" ON "bulletins_paie"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "bulletins_paie_periodeId_employeId_key" ON "bulletins_paie"("periodeId", "employeId");

-- CreateIndex
CREATE UNIQUE INDEX "comptes_comptables_numero_key" ON "comptes_comptables"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "ecritures_comptables_numero_key" ON "ecritures_comptables"("numero");

-- CreateIndex
CREATE INDEX "ecritures_comptables_date_idx" ON "ecritures_comptables"("date");

-- CreateIndex
CREATE INDEX "ecritures_comptables_journal_date_idx" ON "ecritures_comptables"("journal", "date");

-- CreateIndex
CREATE INDEX "ecritures_comptables_sourceType_sourceId_idx" ON "ecritures_comptables"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "lignes_ecriture_ecritureId_idx" ON "lignes_ecriture"("ecritureId");

-- CreateIndex
CREATE INDEX "lignes_ecriture_compteId_idx" ON "lignes_ecriture"("compteId");

-- CreateIndex
CREATE INDEX "documents_archives_cibleType_cibleId_idx" ON "documents_archives"("cibleType", "cibleId");

-- CreateIndex
CREATE INDEX "documents_archives_elementDossierId_idx" ON "documents_archives"("elementDossierId");

-- CreateIndex
CREATE INDEX "sauvegardes_date_idx" ON "sauvegardes"("date");

-- CreateIndex
CREATE UNIQUE INDEX "personnes_matricule_key" ON "personnes"("matricule");

-- AddForeignKey
ALTER TABLE "inscriptions" ADD CONSTRAINT "inscriptions_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_anneeAcademiqueId_fkey" FOREIGN KEY ("anneeAcademiqueId") REFERENCES "annees_academiques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_filiereId_fkey" FOREIGN KEY ("filiereId") REFERENCES "filieres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unites_enseignement" ADD CONSTRAINT "unites_enseignement_filiereId_fkey" FOREIGN KEY ("filiereId") REFERENCES "filieres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matieres" ADD CONSTRAINT "matieres_ueId_fkey" FOREIGN KEY ("ueId") REFERENCES "unites_enseignement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cours" ADD CONSTRAINT "cours_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cours" ADD CONSTRAINT "cours_matiereId_fkey" FOREIGN KEY ("matiereId") REFERENCES "matieres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cours" ADD CONSTRAINT "cours_enseignantId_fkey" FOREIGN KEY ("enseignantId") REFERENCES "employes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creneaux" ADD CONSTRAINT "creneaux_coursId_fkey" FOREIGN KEY ("coursId") REFERENCES "cours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creneaux" ADD CONSTRAINT "creneaux_salleId_fkey" FOREIGN KEY ("salleId") REFERENCES "salles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seances_cours" ADD CONSTRAINT "seances_cours_coursId_fkey" FOREIGN KEY ("coursId") REFERENCES "cours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seances_cours" ADD CONSTRAINT "seances_cours_enseignantId_fkey" FOREIGN KEY ("enseignantId") REFERENCES "employes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences_etudiants" ADD CONSTRAINT "absences_etudiants_seanceId_fkey" FOREIGN KEY ("seanceId") REFERENCES "seances_cours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences_etudiants" ADD CONSTRAINT "absences_etudiants_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "inscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_coursId_fkey" FOREIGN KEY ("coursId") REFERENCES "cours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_salleId_fkey" FOREIGN KEY ("salleId") REFERENCES "salles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "inscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliberations" ADD CONSTRAINT "deliberations_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultats_deliberation" ADD CONSTRAINT "resultats_deliberation_deliberationId_fkey" FOREIGN KEY ("deliberationId") REFERENCES "deliberations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultats_deliberation" ADD CONSTRAINT "resultats_deliberation_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "inscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrats" ADD CONSTRAINT "contrats_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "employes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conges" ADD CONSTRAINT "conges_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "employes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences_personnel" ADD CONSTRAINT "absences_personnel_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "employes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employe_rubriques" ADD CONSTRAINT "employe_rubriques_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "employes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employe_rubriques" ADD CONSTRAINT "employe_rubriques_rubriqueId_fkey" FOREIGN KEY ("rubriqueId") REFERENCES "rubriques_paie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletins_paie" ADD CONSTRAINT "bulletins_paie_periodeId_fkey" FOREIGN KEY ("periodeId") REFERENCES "periodes_paie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletins_paie" ADD CONSTRAINT "bulletins_paie_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "employes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_ecriture" ADD CONSTRAINT "lignes_ecriture_ecritureId_fkey" FOREIGN KEY ("ecritureId") REFERENCES "ecritures_comptables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_ecriture" ADD CONSTRAINT "lignes_ecriture_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes_comptables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
