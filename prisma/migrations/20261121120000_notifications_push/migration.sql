-- AlterTable
ALTER TABLE "annonces" ADD COLUMN     "notifieeLe" TIMESTAMP(3);

-- Les annonces déjà publiées ne déclenchent pas de notification au déploiement.
UPDATE "annonces" SET "notifieeLe" = CURRENT_TIMESTAMP WHERE "publieeLe" <= CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "abonnements_push" (
    "id" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "appareil" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abonnements_push_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "abonnements_push_endpoint_key" ON "abonnements_push"("endpoint");

-- CreateIndex
CREATE INDEX "abonnements_push_compteId_idx" ON "abonnements_push"("compteId");

-- AddForeignKey
ALTER TABLE "abonnements_push" ADD CONSTRAINT "abonnements_push_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes_etudiants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
