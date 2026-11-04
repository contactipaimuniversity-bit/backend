-- CreateTable
CREATE TABLE "historique_classes" (
    "id" TEXT NOT NULL,
    "inscriptionId" TEXT NOT NULL,
    "classeId" TEXT NOT NULL,
    "du" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "au" TIMESTAMP(3),
    "motif" TEXT,
    "parNom" TEXT,

    CONSTRAINT "historique_classes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historique_classes_inscriptionId_idx" ON "historique_classes"("inscriptionId");

-- CreateIndex
CREATE INDEX "historique_classes_classeId_idx" ON "historique_classes"("classeId");

-- AddForeignKey
ALTER TABLE "historique_classes" ADD CONSTRAINT "historique_classes_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "inscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historique_classes" ADD CONSTRAINT "historique_classes_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Les étudiants déjà en classe : leur passage commence à leur inscription.
INSERT INTO "historique_classes" ("id", "inscriptionId", "classeId", "du")
SELECT gen_random_uuid()::text, i."id", i."classeId", i."dateInscription"
FROM "inscriptions" i
WHERE i."classeId" IS NOT NULL;
