/*
  Warnings:

  - A unique constraint covering the columns `[typeBourseId,ordre]` on the table `echeances_bourse` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "echeances_bourse_typeBourseId_ordre_key" ON "echeances_bourse"("typeBourseId", "ordre");
