-- Track expected amounts on reusable catalog obligations and their dossier snapshots.
ALTER TABLE "elements_requis" ADD COLUMN "montantAttendu" DECIMAL(10,2);
ALTER TABLE "elements_dossier" ADD COLUMN "montantAttendu" DECIMAL(10,2);

-- Allow a payment to be allocated to a concrete dossier obligation.
ALTER TABLE "paiements" ADD COLUMN "elementDossierId" TEXT;
CREATE INDEX "paiements_elementDossierId_idx" ON "paiements"("elementDossierId");
ALTER TABLE "paiements"
ADD CONSTRAINT "paiements_elementDossierId_fkey"
FOREIGN KEY ("elementDossierId") REFERENCES "elements_dossier"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the configurable deposit obligation for existing installations.
INSERT INTO "elements_requis"
	("id", "nom", "categorie", "contexte", "niveauApplicable", "obligatoire", "montantAttendu")
SELECT gen_random_uuid(), 'Frais de depot de dossier', 'FRAIS', 'BOURSE', 'TOUS', true, 10000.00
WHERE NOT EXISTS (
	SELECT 1 FROM "elements_requis"
	WHERE "nom" = 'Frais de depot de dossier' AND "contexte" = 'BOURSE'
);
