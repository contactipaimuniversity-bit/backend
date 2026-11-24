-- La vitrine parle de « l'université » et non plus du « campus ».
UPDATE "actualites_vitrine"
SET "categorie" = REPLACE("categorie", 'du campus', 'de l''université'),
    "titre"     = REPLACE("titre", 'du campus', 'de l''université'),
    "resume"    = REPLACE("resume", 'du campus', 'de l''université')
WHERE "categorie" ILIKE '%campus%' OR "titre" ILIKE '%campus%' OR "resume" ILIKE '%campus%';

UPDATE "questions_vitrine"
SET "question" = REPLACE("question", 'du campus', 'de l''université'),
    "reponse"  = REPLACE("reponse", 'du campus', 'de l''université')
WHERE "question" ILIKE '%campus%' OR "reponse" ILIKE '%campus%';
