-- AlterTable
ALTER TABLE "filieres" ADD COLUMN     "poleId" TEXT;

-- CreateTable
CREATE TABLE "poles" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "poles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "poles_nom_key" ON "poles"("nom");

-- AddForeignKey
ALTER TABLE "filieres" ADD CONSTRAINT "filieres_poleId_fkey" FOREIGN KEY ("poleId") REFERENCES "poles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
