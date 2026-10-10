-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN     "anonyme" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "notes" ADD COLUMN     "numeroAnonymat" INTEGER;

-- AlterTable
ALTER TABLE "sauvegardes" ADD COLUMN     "copieExterneErreur" TEXT,
ADD COLUMN     "copieExterneLe" TIMESTAMP(3),
ADD COLUMN     "copieExterneRef" TEXT;
