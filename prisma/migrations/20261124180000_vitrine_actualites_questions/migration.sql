-- Actualités et questions fréquentes de la vitrine, gérées par l'administration.
CREATE TABLE "actualites_vitrine" (
    "id" TEXT NOT NULL,
    "categorie" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "resume" TEXT NOT NULL,
    "contenu" TEXT,
    "datePublication" TIMESTAMP(3) NOT NULL,
    "imagePublicId" TEXT,
    "imageUrl" TEXT,
    "lienLibelle" TEXT,
    "lien" TEXT,
    "aLaUne" BOOLEAN NOT NULL DEFAULT false,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeParNom" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "actualites_vitrine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "actualites_vitrine_actif_datePublication_idx" ON "actualites_vitrine"("actif", "datePublication");

CREATE TABLE "questions_vitrine" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "reponse" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_vitrine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "questions_vitrine_actif_ordre_idx" ON "questions_vitrine"("actif", "ordre");

-- Contenu de départ, pour n'avoir plus qu'à ajouter les images.
-- Le carrousel n'est rempli que s'il est encore vide.
INSERT INTO "diapositives_vitrine" ("id", "surtitre", "titre", "texte", "boutonLibelle", "boutonLien", "ordre", "actif", "creeParNom", "modifieLe")
SELECT gen_random_uuid()::text, v.surtitre, v.titre, v.texte, v.bouton, v.lien, v.ordre, true, 'Contenu initial', CURRENT_TIMESTAMP
FROM (VALUES
  ('Admissions 2026-2027 ouvertes', 'Construisez votre avenir professionnel au Congo', 'Des BTS et des Licences tournés vers l''emploi, dans le numérique, la gestion, le droit et l''industrie.', 'Trouver ma filière', '/site#formations', 1),
  ('Financement des études', 'Jusqu''à 100 000 FCFA de bourse, et 30 % de frais en moins', 'Une bourse locale sur trois ans et une réduction appliquée à toute inscription pour l''année 2026-2027.', 'Financer mes études', '/site#financement', 2),
  ('Services numériques', 'Toute votre scolarité dans votre téléphone', 'Carte d''étudiant, notes, emploi du temps et paiements, consultables à tout moment depuis l''application IPAIM.', 'Ouvrir l''espace étudiant', '/etudiant', 3)
) AS v(surtitre, titre, texte, bouton, lien, ordre)
WHERE NOT EXISTS (SELECT 1 FROM "diapositives_vitrine");

INSERT INTO "actualites_vitrine" ("id", "categorie", "titre", "resume", "datePublication", "aLaUne", "creeParNom", "modifieLe")
SELECT gen_random_uuid()::text, v.categorie, v.titre, v.resume, v.jour::timestamp, v.une, 'Contenu initial', CURRENT_TIMESTAMP
FROM (VALUES
  ('Scolarité', 'Matricules : les retraits continuent à la scolarité', 'Les étudiants inscrits qui n''ont pas encore leur matricule sont invités à passer au service de la scolarité, où il leur est remis.', '2026-11-19', true),
  ('Services numériques', 'Lancement de l''application étudiante IPAIM', 'Notes, emploi du temps, carte d''étudiant et paiements sont désormais consultables sur smartphone. Les codes d''accès sont remis par la scolarité.', '2026-11-14', false),
  ('Partenariats', 'Un parcours pour poursuivre ses études en France', 'Les étudiants qui valident deux années à l''IPAIM peuvent désormais prolonger leur cursus en France.', '2026-11-14', false),
  ('Vie académique', 'Premiers cours de l''année 2026-2027', 'Les cours de la nouvelle promotion ont commencé à Brazzaville. Les inscrits de cette année bénéficient d''une réduction de 30 % sur ses frais de scolarité.', '2026-11-10', false),
  ('Vie du campus', 'Débat étudiant : faire carrière sans quitter le pays', 'Les étudiants ont confronté leurs points de vue sur les perspectives professionnelles qu''offre le Congo aux jeunes diplômés.', '2026-11-04', false),
  ('Recrutement', 'Appel à candidatures : enseignant en droit', 'L''université a recherché un enseignant pour sa filière Droit. Les dossiers étaient attendus jusqu''au 2 novembre 2026.', '2026-10-27', false),
  ('Financement', 'Dépôt des dossiers de bourse à Pointe-Noire', 'À compter du 1er novembre, les bacheliers de Pointe-Noire peuvent déposer leur demande de bourse sans se déplacer à Brazzaville.', '2026-10-23', false),
  ('Vie du campus', 'Parole d''étudiante : une première année boursière', 'Une étudiante de Licence 1, lauréate de la bourse locale, raconte ses premières semaines à l''IPAIM.', '2026-10-17', false),
  ('Institution', 'Deux responsables au service des étudiants', 'Yindoula Axel Mauriel pilote la direction académique ; Dylanh Missiandot, la direction administrative.', '2026-10-09', false),
  ('Vie académique', 'Nouvelle date de rentrée : le 2 novembre', 'Prévue initialement le 12 octobre, la rentrée académique a été déplacée au lundi 2 novembre 2026.', '2026-10-07', false),
  ('Formations', 'Pourquoi choisir la logistique et le transport', 'Gestion des stocks, transit, commerce international : une filière qui répond aux besoins des ports et des entreprises.', '2026-10-02', false),
  ('Vie du campus', 'L''université engagée pour Octobre Rose', 'Étudiants et personnel se sont mobilisés pour sensibiliser au dépistage du cancer du sein.', '2026-10-01', false),
  ('Vie du campus', 'Une ambassadrice récompensée pour son engagement', 'Mberi Ange Sephora reçoit 30 000 FCFA pour avoir fait connaître l''université autour d''elle.', '2026-09-26', false),
  ('Recrutement', 'L''équipe commerciale s''agrandit', 'Vingt commerciaux et apporteurs d''affaires ont été recherchés pour accompagner les futurs étudiants. Recrutement clos le 12 septembre.', '2026-08-25', false),
  ('Formations', 'Développeur web et mobile : un métier qui recrute', 'Sites, applications, services en ligne : un tour d''horizon d''une filière très demandée par les entreprises.', '2026-08-19', false)
) AS v(categorie, titre, resume, jour, une);

INSERT INTO "questions_vitrine" ("id", "question", "reponse", "ordre", "modifieLe")
SELECT gen_random_uuid()::text, v.question, v.reponse, v.ordre, CURRENT_TIMESTAMP
FROM (VALUES
  ('Quel diplôme faut-il pour entrer à l''IPAIM ?', 'Un baccalauréat, quelle que soit sa série : général, technique ou professionnel. Votre éligibilité est confirmée lors de l''entretien.', 1),
  ('Combien coûte une demande de bourse ?', 'Le traitement du dossier coûte 10 000 FCFA. La pré-inscription en ligne, elle, est entièrement gratuite.', 2),
  ('Mon baccalauréat date de plusieurs années : est-ce un obstacle ?', 'Pas nécessairement. Contactez le service d''information au +242 06 400 04 71 : il étudie chaque situation selon l''année d''obtention et la filière visée.', 3),
  ('Je vis à Pointe-Noire : dois-je venir à Brazzaville ?', 'Non. Depuis le 1er novembre 2026, les dossiers de bourse sont reçus à Pointe-Noire. Le service d''information vous indique le lieu de dépôt.', 4),
  ('La filière Logistique et transport est-elle proposée ?', 'Oui, en BTS comme en Licence, au sein du pôle management.', 5),
  ('Comment connaître les frais de scolarité de ma filière ?', 'Le service d''information vous communique le détail par filière, par téléphone ou à l''accueil du campus.', 6)
) AS v(question, reponse, ordre);
