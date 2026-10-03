CREATE TABLE "postes" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "postes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "postes_nom_key" ON "postes"("nom");

ALTER TABLE "utilisateurs"
ADD COLUMN "posteId" TEXT,
ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "utilisateurs"
ADD CONSTRAINT "utilisateurs_posteId_fkey"
FOREIGN KEY ("posteId") REFERENCES "postes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "utilisateurs"
SET "permissions" = ARRAY[
    'view:dashboard', 'edit:dashboard',
    'view:scholarships', 'edit:scholarships',
    'view:enrollments', 'edit:enrollments',
    'view:certificates', 'edit:certificates',
    'view:payments', 'edit:payments',
    'view:prospects', 'edit:prospects',
    'view:people', 'edit:people',
    'view:recruiting', 'edit:recruiting',
    'view:references', 'edit:references',
    'view:sync', 'edit:sync',
    'view:reports', 'edit:reports'
]::TEXT[]
WHERE "role" <> 'admin';