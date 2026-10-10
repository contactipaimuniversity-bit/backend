-- DropIndex
DROP INDEX "unites_enseignement_filiereId_niveau_code_key";

-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN     "heureDebut" TEXT,
ADD COLUMN     "heureFin" TEXT;

-- AlterTable
ALTER TABLE "filieres" ADD COLUMN     "niveauFinal" TEXT;

-- AlterTable
ALTER TABLE "inscriptions" ADD COLUMN     "filiereId" TEXT;

-- AlterTable
ALTER TABLE "unites_enseignement" ADD COLUMN     "anneeAcademiqueId" TEXT;

-- CreateTable
CREATE TABLE "niveaux" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "cycle" TEXT NOT NULL DEFAULT 'Licence',
    "rang" INTEGER NOT NULL,
    "diplome" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "niveaux_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credits_ue" (
    "id" TEXT NOT NULL,
    "personneId" TEXT NOT NULL,
    "inscriptionId" TEXT NOT NULL,
    "deliberationId" TEXT NOT NULL,
    "filiereId" TEXT NOT NULL,
    "niveau" TEXT NOT NULL,
    "annee" TEXT NOT NULL,
    "semestre" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "moyenne" DECIMAL(5,2),
    "statut" TEXT NOT NULL,
    "mode" TEXT,
    "matieres" JSONB NOT NULL,
    "tentatives" JSONB NOT NULL DEFAULT '[]',
    "dateAcquisition" TIMESTAMP(3),

    CONSTRAINT "credits_ue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "niveaux_code_key" ON "niveaux"("code");

-- CreateIndex
CREATE UNIQUE INDEX "niveaux_cycle_rang_key" ON "niveaux"("cycle", "rang");

-- CreateIndex
CREATE INDEX "credits_ue_personneId_filiereId_niveau_idx" ON "credits_ue"("personneId", "filiereId", "niveau");

-- CreateIndex
CREATE INDEX "credits_ue_statut_idx" ON "credits_ue"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "credits_ue_deliberationId_inscriptionId_code_key" ON "credits_ue"("deliberationId", "inscriptionId", "code");

-- CreateIndex
CREATE INDEX "inscriptions_filiereId_idx" ON "inscriptions"("filiereId");

-- CreateIndex
CREATE INDEX "unites_enseignement_filiereId_niveau_idx" ON "unites_enseignement"("filiereId", "niveau");

-- CreateIndex
CREATE UNIQUE INDEX "unites_enseignement_anneeAcademiqueId_filiereId_niveau_code_key" ON "unites_enseignement"("anneeAcademiqueId", "filiereId", "niveau", "code");

-- AddForeignKey
ALTER TABLE "inscriptions" ADD CONSTRAINT "inscriptions_filiereId_fkey" FOREIGN KEY ("filiereId") REFERENCES "filieres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unites_enseignement" ADD CONSTRAINT "unites_enseignement_anneeAcademiqueId_fkey" FOREIGN KEY ("anneeAcademiqueId") REFERENCES "annees_academiques"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits_ue" ADD CONSTRAINT "credits_ue_personneId_fkey" FOREIGN KEY ("personneId") REFERENCES "personnes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits_ue" ADD CONSTRAINT "credits_ue_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "inscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits_ue" ADD CONSTRAINT "credits_ue_deliberationId_fkey" FOREIGN KEY ("deliberationId") REFERENCES "deliberations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise : chaque maquette existante est rattachée à une année. L'original va
-- à l'année la plus récente qui l'utilise (ou à l'année courante) ; les autres
-- années qui l'enseignent en reçoivent une copie, et leurs cours la suivent.
DO $$
DECLARE
  defaut TEXT;
  u RECORD;
  y RECORD;
  m RECORD;
  principale TEXT;
  nouvelle TEXT;
  copie TEXT;
BEGIN
  SELECT id INTO defaut FROM "annees_academiques"
   ORDER BY (statut <> 'CLOTUREE') DESC, "dateDebut" DESC LIMIT 1;
  FOR u IN SELECT * FROM "unites_enseignement" WHERE "anneeAcademiqueId" IS NULL LOOP
    principale := NULL;
    FOR y IN
      SELECT a.id FROM "annees_academiques" a
       WHERE a.id = defaut OR EXISTS (
         SELECT 1 FROM "matieres" mt
           JOIN "cours" c ON c."matiereId" = mt.id
           JOIN "classes" cl ON cl.id = c."classeId"
          WHERE mt."ueId" = u.id AND cl."anneeAcademiqueId" = a.id)
       ORDER BY a."dateDebut" DESC
    LOOP
      IF principale IS NULL THEN
        principale := y.id;
      ELSE
        nouvelle := gen_random_uuid()::text;
        INSERT INTO "unites_enseignement" (id, "anneeAcademiqueId", "filiereId", niveau, semestre, code, nom, credits, ordre)
        VALUES (nouvelle, y.id, u."filiereId", u.niveau, u.semestre, u.code, u.nom, u.credits, u.ordre);
        FOR m IN SELECT * FROM "matieres" WHERE "ueId" = u.id LOOP
          copie := gen_random_uuid()::text;
          INSERT INTO "matieres" (id, "ueId", code, nom, coefficient, "volumeHoraire", actif)
          VALUES (copie, nouvelle, m.code, m.nom, m.coefficient, m."volumeHoraire", m.actif);
          UPDATE "cours" SET "matiereId" = copie
           WHERE "matiereId" = m.id
             AND "classeId" IN (SELECT id FROM "classes" WHERE "anneeAcademiqueId" = y.id);
        END LOOP;
      END IF;
    END LOOP;
    -- Sans aucune année ouverte, la maquette attend : la première année créée l'adopte.
    UPDATE "unites_enseignement" SET "anneeAcademiqueId" = principale WHERE id = u.id;
  END LOOP;
END $$;

-- Reprise : les inscriptions dont la filière saisie est exactement le nom ou le
-- code d'une filière du référentiel y sont rattachées.
UPDATE "inscriptions" i SET "filiereId" = f.id
  FROM "filieres" f
 WHERE i."filiereId" IS NULL
   AND (lower(btrim(i.filiere)) = lower(f.nom) OR lower(btrim(i.filiere)) = lower(f.code));
