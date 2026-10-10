/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';

// Chaîne complète : scolarité, notes, délibérations, personnel, paie,
// comptabilité, archivage et sauvegarde, avec leurs interconnexions.
// Lancement : npm run test:gestion (crée puis supprime une base jetable).
const databaseUrl = process.env.E2E_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

type Body = Record<string, any>;

suite('Gestion académique, RH, paie et comptabilité (e2e)', () => {
  let app: INestApplication<App>;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const pdf = Buffer.from('%PDF-1.4 test');
  const dossierSauvegardes = mkdtempSync(join(tmpdir(), 'ipaim-e2e-'));

  const maintenant = new Date();
  const annee = maintenant.getUTCFullYear();
  const jour = maintenant.toISOString().slice(0, 10);
  const debutMois = `${jour.slice(0, 8)}01`;
  const libelleAnnee = `${annee}-${annee + 1}`;

  const api = (user: string) => {
    const server = app.getHttpServer();
    const auth = (test: request.Test) =>
      test.set('Authorization', `Bearer ${tokens[user]}`);
    return {
      get: (path: string) => auth(request(server).get(path)),
      post: (path: string, body?: Body) =>
        auth(request(server).post(path)).send(body ?? {}),
      patch: (path: string, body: Body) =>
        auth(request(server).patch(path)).send(body),
      put: (path: string, body: Body) =>
        auth(request(server).put(path)).send(body),
      delete: (path: string, body?: Body) =>
        auth(request(server).delete(path)).send(body ?? {}),
      upload: (path: string, fields: Record<string, string>) => {
        let test = auth(request(server).post(path));
        for (const [key, value] of Object.entries(fields))
          test = test.field(key, value);
        return test.attach('fichier', pdf, {
          filename: 'piece.pdf',
          contentType: 'application/pdf',
        });
      },
    };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'e2e-secret';
    process.env.BACKUP_AUTO = 'false';
    process.env.BACKUP_DIR = dossierSauvegardes;
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { JwtService } = require('@nestjs/jwt');
    const { AppModule } = require('../src/app.module');
    const { CloudinaryService } = require('../src/fichiers/cloudinary.service');
    const { PrismaService } = require('../src/prisma/prisma.service');
    /* eslint-enable @typescript-eslint/no-require-imports */

    let uploads = 0;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CloudinaryService)
      .useValue({
        verifier: (file: unknown, label: string) => {
          if (!file) throw new Error(`${label} manquant`);
          return file;
        },
        envoyer: () =>
          Promise.resolve({
            url: `https://example.test/${++uploads}.pdf`,
            publicId: `test/${uploads}`,
            typeRessource: 'image',
            taille: pdf.length,
            nom: 'piece.pdf',
          }),
        supprimer: () => Promise.resolve(),
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);
    const droits = (...zones: string[]) =>
      zones.flatMap((zone) => [`view:${zone}`, `edit:${zone}`]);
    const users: Record<string, { role?: string; permissions: string[] }> = {
      scolarite: {
        permissions: droits(
          'academics',
          'teaching',
          'grades',
          'deliberations',
          'enrollments',
          'references',
          'payments',
          'academic-stats',
        ),
      },
      // Enseignant : séances et notes de ses propres cours uniquement.
      prof: { permissions: droits('teaching', 'grades') },
      rh: { permissions: droits('hr') },
      rh2: { permissions: droits('hr') },
      paie: { permissions: droits('payroll', 'payroll-approval') },
      valideurPaie: { permissions: droits('payroll', 'payroll-approval') },
      comptable: { permissions: droits('accounting') },
      gestionnaire: { permissions: droits('finance-settings') },
      admin: { role: 'admin', permissions: [] },
    };
    for (const [nom, { role, permissions }] of Object.entries(users)) {
      const user = await prisma.utilisateur.create({
        data: {
          nom,
          email: `${nom}@e2e.test`,
          motDePasse: 'x',
          role: role ?? 'employe',
          permissions,
        },
      });
      ids[nom] = user.id;
      tokens[nom] = await jwt.signAsync({ sub: user.id, nom });
    }
  });

  afterAll(async () => {
    await app?.close();
    rmSync(dossierSauvegardes, { recursive: true, force: true });
  });

  // ---------- Personnel ----------

  it('embauche le personnel, avec contrats et règles de congé', async () => {
    const enseignant = await api('rh')
      .post('/rh/employes', {
        nom: 'Mabiala',
        prenom: 'Paul',
        categorie: 'ENSEIGNANT_VACATAIRE',
        fonction: 'Enseignant de mathématiques',
        dateEmbauche: '2020-01-01',
      })
      .expect(201);
    ids.enseignant = enseignant.body.id;
    expect(enseignant.body.matricule).toBe('EMP-0001');
    // Le compte du professeur est rattaché à sa fiche : il ne verra que ses cours.
    await api('rh')
      .patch(`/rh/employes/${ids.enseignant}`, { utilisateurId: ids.prof })
      .expect(200);
    // Un contrat de vacation précise son taux horaire.
    await api('rh')
      .post(`/rh/employes/${ids.enseignant}/contrats`, {
        type: 'VACATION',
        dateDebut: '2020-01-01',
      })
      .expect(400);
    await api('rh')
      .post(`/rh/employes/${ids.enseignant}/contrats`, {
        type: 'VACATION',
        dateDebut: '2020-01-01',
        tauxHoraire: 5000,
      })
      .expect(201);

    const secretaire = await api('rh')
      .post('/rh/employes', {
        nom: 'Ngoma',
        prenom: 'Alice',
        categorie: 'ADMINISTRATIF',
        fonction: 'Secrétaire',
        dateEmbauche: '2020-01-01',
      })
      .expect(201);
    ids.secretaire = secretaire.body.id;
    await api('rh')
      .patch(`/rh/employes/${ids.secretaire}`, { utilisateurId: ids.rh })
      .expect(200);
    // Un CDD a obligatoirement une date de fin.
    await api('rh')
      .post(`/rh/employes/${ids.secretaire}/contrats`, {
        type: 'CDD',
        dateDebut: '2020-01-01',
        salaireBase: 260000,
      })
      .expect(400);
    const contrat = await api('rh')
      .post(`/rh/employes/${ids.secretaire}/contrats`, {
        type: 'CDI',
        dateDebut: '2020-01-01',
        salaireBase: 260000,
      })
      .expect(201);
    expect(contrat.body.contrats).toHaveLength(1);

    // Congé d'un jour, un mercredi à venir.
    const mercredi = new Date(maintenant);
    mercredi.setUTCDate(
      mercredi.getUTCDate() + ((10 - mercredi.getUTCDay()) % 7) + 7,
    );
    const dateConge = mercredi.toISOString().slice(0, 10);
    const demande = await api('rh')
      .post(`/rh/employes/${ids.secretaire}/conges`, {
        type: 'ANNUEL',
        dateDebut: dateConge,
        dateFin: dateConge,
      })
      .expect(201);
    const conge = demande.body.conges[0];
    expect(conge).toMatchObject({ statut: 'DEMANDE', jours: 1 });
    // Un second congé sur la même période est refusé.
    await api('rh')
      .post(`/rh/employes/${ids.secretaire}/conges`, {
        type: 'PERMISSION',
        dateDebut: dateConge,
        dateFin: dateConge,
        motif: 'Rendez-vous',
      })
      .expect(409);
    // Personne ne s'accorde son propre congé.
    await api('rh')
      .post(`/rh/conges/${conge.id}/decision`, { approuve: true })
      .expect(403);
    const decide = await api('rh2')
      .post(`/rh/conges/${conge.id}/decision`, { approuve: true })
      .expect(201);
    expect(decide.body.soldeConges.pris).toBe(1);

    // Deux jours d'absence injustifiée ce mois-ci : ils seront retenus sur la paie.
    await api('rh')
      .post(`/rh/employes/${ids.secretaire}/absences`, {
        date: debutMois,
        jours: 2,
      })
      .expect(201);
  });

  // ---------- Structure académique ----------

  it('monte la structure : année, filière, classe, maquette', async () => {
    const anneeAcademique = await api('scolarite')
      .post('/academique/annees', {
        libelle: libelleAnnee,
        dateDebut: `${annee}-01-01`,
        dateFin: `${annee + 1}-12-31`,
      })
      .expect(201);
    ids.annee = anneeAcademique.body.id;
    await api('scolarite')
      .post('/academique/annees', {
        libelle: '2026-2028',
        dateDebut: '2026-09-01',
        dateFin: '2027-07-31',
      })
      .expect(400);
    const filiere = await api('scolarite')
      .post('/academique/filieres', { code: 'info', nom: 'Informatique' })
      .expect(201);
    ids.filiere = filiere.body.id;
    expect(filiere.body.code).toBe('INFO');

    const unite = (semestre: number, code: string, credits: number) =>
      api('scolarite')
        .post('/academique/unites', {
          filiereId: ids.filiere,
          niveau: 'L1',
          semestre,
          code,
          nom: `Unité ${code}`,
          credits,
        })
        .expect(201);
    const matiere = (ueId: string, code: string, coefficient: number) =>
      api('scolarite')
        .post('/academique/matieres', {
          ueId,
          code,
          nom: `Matière ${code}`,
          coefficient,
          volumeHoraire: 30,
        })
        .expect(201);
    const ue1 = await unite(1, 'UE1', 20);
    const ue2 = await unite(1, 'UE2', 10);
    const ue3 = await unite(2, 'UE3', 30);
    await matiere(ue1.body.id, 'MATH', 3);
    await matiere(ue1.body.id, 'ALGO', 1);
    await matiere(ue2.body.id, 'ANG', 1);
    await matiere(ue3.body.id, 'PROJ', 1);
    const maquette = await api('scolarite').get(
      `/academique/maquette?filiereId=${ids.filiere}&niveau=L1`,
    );
    expect(maquette.body.credits).toEqual([
      { semestre: 1, total: 30 },
      { semestre: 2, total: 30 },
    ]);

    const classe = await api('scolarite')
      .post('/academique/classes', {
        anneeAcademiqueId: ids.annee,
        filiereId: ids.filiere,
        niveau: 'L1',
      })
      .expect(201);
    ids.classe = classe.body.id;
    // Un enseignant ne modifie pas la structure.
    await api('prof')
      .post('/academique/filieres', { code: 'X1', nom: 'Interdit' })
      .expect(403);
  });

  it('inscrit, encaisse et affecte les étudiants en classe', async () => {
    await api('scolarite')
      .post('/elements-requis', {
        nom: "Frais d'inscription",
        categorie: 'FRAIS',
        contexte: 'INSCRIPTION_DIRECTE',
        niveauApplicable: 'PREMIERE_ANNEE',
        montantAttendu: 50000,
      })
      .expect(201);
    for (const [cle, nom, filiere] of [
      ['a', 'Akouala', 'Informatique'],
      ['b', 'Bemba', ' informatique '],
      ['c', 'Compaore', 'INFO'],
    ]) {
      const inscription = await api('scolarite')
        .post('/inscriptions', {
          nouvellePersonne: { nom, prenom: 'Etu' },
          anneeScolaire: libelleAnnee,
          niveau: 'L1',
          filiere,
        })
        .expect(201);
      ids[cle] = inscription.body.id;
    }
    // L'étudiant A règle ses frais : la comptabilité le constatera toute seule.
    const finance = await api('scolarite').get(
      `/inscriptions/${ids.a}/finance`,
    );
    await api('scolarite')
      .post('/paiements', {
        inscriptionId: ids.a,
        elementDossierId: finance.body.obligations[0].id,
        montant: 50000,
        typePaiement: 'FRAIS_INSCRIPTION',
      })
      .expect(201);

    // Les filières saisies à la main sont rapprochées de la filière de la classe.
    const candidats = await api('scolarite').get(
      `/academique/classes/${ids.classe}/candidats`,
    );
    expect(candidats.body).toHaveLength(3);
    expect(candidats.body.every((item: Body) => item.correspond)).toBe(true);
    await api('scolarite')
      .post(`/academique/classes/${ids.classe}/affectations`, {
        inscriptionIds: [ids.a, ids.b, ids.c],
      })
      .expect(201);
    const classe = await api('scolarite').get(
      `/academique/classes/${ids.classe}`,
    );
    expect(
      classe.body.inscriptions.map((item: Body) => item.personne.matricule),
    ).toEqual([
      expect.stringMatching(/^\d{2}INFO000\d$/),
      expect.stringMatching(/^\d{2}INFO000\d$/),
      expect.stringMatching(/^\d{2}INFO000\d$/),
    ]);
    // Déjà en classe : une seconde affectation est refusée.
    await api('scolarite')
      .post(`/academique/classes/${ids.classe}/affectations`, {
        inscriptionIds: [ids.a],
      })
      .expect(409);
    // Un étudiant en classe ne se supprime plus.
    await api('scolarite')
      .delete(`/inscriptions/${ids.c}`, { motif: 'Tentative de suppression' })
      .expect(409);
  });

  it('affecte les cours et détecte les conflits d’emploi du temps', async () => {
    const cours = await api('scolarite').get(
      `/academique/cours?classeId=${ids.classe}`,
    );
    expect(cours.body).toHaveLength(4);
    for (const item of cours.body as Body[]) ids[item.matiere.code] = item.id;
    // Le projet du second semestre reste sans enseignant attitré.
    for (const code of ['MATH', 'ALGO', 'ANG'])
      await api('scolarite')
        .patch(`/academique/cours/${ids[code]}`, {
          enseignantId: ids.enseignant,
        })
        .expect(200);
    // La secrétaire n'est pas enseignante.
    await api('scolarite')
      .patch(`/academique/cours/${ids.PROJ}`, { enseignantId: ids.secretaire })
      .expect(400);

    const salle = await api('scolarite')
      .post('/academique/salles', { nom: 'Salle A', capacite: 40 })
      .expect(201);
    const creneau = (code: string, heureDebut: string, heureFin: string) =>
      api('scolarite').post('/academique/creneaux', {
        coursId: ids[code],
        jour: 1,
        heureDebut,
        heureFin,
        salleId: salle.body.id,
      });
    await creneau('MATH', '08:00', '10:00').expect(201);
    const conflit = await creneau('ALGO', '09:00', '11:00').expect(409);
    expect(conflit.body.message).toMatch(/a déjà/);
    await creneau('ALGO', '10:00', '12:00').expect(201);
    await creneau('ANG', '12:00', '11:00').expect(400);

    // L'enseignant ne voit que ses trois cours.
    const mesCours = await api('prof').get('/academique/cours');
    expect(mesCours.body).toHaveLength(3);
  });

  it('tient le cahier de textes et suit l’assiduité', async () => {
    const seance = (user: string, code: string, date: string) =>
      api(user).post('/scolarite/seances', {
        coursId: ids[code],
        date,
        heureDebut: '08:00',
        dureeMinutes: 120,
        contenu: 'Chapitre 1 : ensembles et applications',
        absents: [{ inscriptionId: ids.c }],
      });
    const demain = new Date(maintenant.getTime() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await seance('prof', 'MATH', demain).expect(400);
    await seance('prof', 'MATH', jour).expect(201);
    await seance('prof', 'MATH', jour).expect(409);
    // Un cours qui n'est pas le sien lui est fermé.
    await seance('prof', 'PROJ', jour).expect(403);
    // Sans enseignant affecté, pas de séance.
    await seance('scolarite', 'PROJ', jour).expect(400);
    // Sans contenu, pas de séance : le cahier de textes est obligatoire.
    await api('prof')
      .post('/scolarite/seances', {
        coursId: ids.ALGO,
        date: jour,
        heureDebut: '10:00',
        dureeMinutes: 60,
        contenu: '',
      })
      .expect(400);

    const assiduite = await api('scolarite').get(
      `/scolarite/assiduite/${ids.classe}`,
    );
    expect(assiduite.body.heuresTenues).toBe(2);
    const etudiantC = assiduite.body.etudiants.find(
      (item: Body) => item.inscriptionId === ids.c,
    );
    expect(etudiantC).toMatchObject({
      heuresInjustifiees: 2,
      taux: 100,
      alerte: true,
    });
  });

  // ---------- Notes et délibérations ----------

  const evaluation = async (user: string, code: string, type: string) => {
    const created = await api(user)
      .post('/notes/evaluations', {
        coursId: ids[code],
        type,
        libelle: `${type} ${code}`,
      })
      .expect(201);
    return created.body.id as string;
  };
  const noter = (user: string, id: string, a: number, b: number, c: number) =>
    api(user).put(`/notes/evaluations/${id}/notes`, {
      notes: [
        { inscriptionId: ids.a, valeur: a },
        { inscriptionId: ids.b, valeur: b },
        { inscriptionId: ids.c, valeur: c },
      ],
    });

  it('saisit les notes, les verrouille et délibère le premier semestre', async () => {
    const controle = await evaluation('prof', 'MATH', 'CONTROLE');
    const examen = await evaluation('prof', 'MATH', 'EXAMEN');
    // Un seul examen par matière, et pas de rattrapage avant l'examen validé.
    await api('prof')
      .post('/notes/evaluations', {
        coursId: ids.MATH,
        type: 'EXAMEN',
        libelle: 'Second examen',
      })
      .expect(409);
    await api('prof')
      .post('/notes/evaluations', {
        coursId: ids.MATH,
        type: 'RATTRAPAGE',
        libelle: 'Rattrapage',
      })
      .expect(409);
    await noter('prof', controle, 16, 10, 6).expect(200);
    // Une note ne dépasse pas le barème.
    await noter('prof', examen, 21, 8, 4).expect(400);
    await api('prof')
      .put(`/notes/evaluations/${examen}/notes`, {
        notes: [
          { inscriptionId: ids.a, valeur: 14 },
          { inscriptionId: ids.b, valeur: 8 },
        ],
      })
      .expect(200);
    // L'enseignant saisit, il ne valide pas.
    await api('prof')
      .post(`/notes/evaluations/${controle}/valider`)
      .expect(403);
    await api('scolarite')
      .post(`/notes/evaluations/${controle}/valider`)
      .expect(201);
    // Validation refusée tant qu'une note manque.
    const manque = await api('scolarite')
      .post(`/notes/evaluations/${examen}/valider`)
      .expect(409);
    expect(manque.body.message).toMatch(/Note manquante pour 1 étudiant/);
    await noter('prof', examen, 14, 8, 4).expect(200);
    await api('scolarite')
      .post(`/notes/evaluations/${examen}/valider`)
      .expect(201);
    // Une fois validées, les notes sont verrouillées.
    await noter('prof', examen, 20, 20, 20).expect(409);

    const grille = await api('prof').get(`/notes/cours/${ids.MATH}`);
    expect(grille.body.etudiants.map((item: Body) => item.moyenne)).toEqual([
      14.8, 8.8, 4.8,
    ]);

    // Délibération impossible tant que tout n'est pas noté et validé.
    const tropTot = await api('scolarite')
      .post(`/deliberations/classes/${ids.classe}/semestres/1/cloturer`, {
        president: 'Pr Okemba',
      })
      .expect(409);
    expect(tropTot.body.message).toMatch(/aucune évaluation/);

    for (const [code, a, b, c] of [
      ['ALGO', 12, 14, 5],
      ['ANG', 15, 9, 8],
    ] as const) {
      const id = await evaluation('scolarite', code, 'EXAMEN');
      await noter('scolarite', id, a, b, c).expect(200);
      await api('scolarite')
        .post(`/notes/evaluations/${id}/valider`)
        .expect(201);
    }

    const cloture = await api('scolarite')
      .post(`/deliberations/classes/${ids.classe}/semestres/1/cloturer`, {
        president: 'Pr Okemba',
        membres: 'M. Mabiala, Mme Ngoma',
      })
      .expect(201);
    const resultat = (cle: string) =>
      cloture.body.resultats.find(
        (item: Body) => item.inscriptionId === ids[cle],
      );
    expect(resultat('a')).toMatchObject({
      moyenne: 14.4,
      creditsAcquis: 30,
      rang: 1,
      mention: 'Bien',
      decision: 'VALIDE',
    });
    // Sous la moyenne : seuls les crédits de l'unité validée sont acquis.
    expect(resultat('b')).toMatchObject({
      moyenne: 9.73,
      creditsAcquis: 20,
      rang: 2,
      decision: 'NON_VALIDE',
    });
    expect(resultat('c')).toMatchObject({ creditsAcquis: 0, rang: 3 });
    expect(cloture.body.synthese).toMatchObject({ effectif: 3, reussis: 1 });

    // Semestre délibéré : plus aucune évaluation ni note.
    await api('prof')
      .post('/notes/evaluations', {
        coursId: ids.MATH,
        type: 'CONTROLE',
        libelle: 'Trop tard',
      })
      .expect(409);
  });

  it('retient le bulletin d’un étudiant qui n’a pas soldé sa scolarité', async () => {
    await api('scolarite')
      .patch('/academique/parametres', { blocageImpayes: true })
      .expect(200);
    const bulletin = await api('scolarite')
      .get(`/deliberations/bulletins/${ids.a}/1`)
      .expect(200);
    expect(bulletin.body.resultat.detail.unites).toHaveLength(2);
    expect(bulletin.body.absences).toEqual({ total: 0, injustifiees: 0 });
    const retenu = await api('scolarite')
      .get(`/deliberations/bulletins/${ids.b}/1`)
      .expect(403);
    expect(retenu.body.message).toMatch(/Bulletin retenu : 50.000 F/);
    const tous = await api('scolarite').get(
      `/deliberations/classes/${ids.classe}/semestres/1/bulletins`,
    );
    expect(tous.body.filter((item: Body) => item.retenu)).toHaveLength(2);
  });

  it('délibère l’année, décide du passage et prépare les réinscriptions', async () => {
    const projet = await evaluation('scolarite', 'PROJ', 'EXAMEN');
    await noter('scolarite', projet, 12, 13, 6).expect(200);
    await api('scolarite')
      .post(`/notes/evaluations/${projet}/valider`)
      .expect(201);
    // Copies anonymes : le correcteur ne voit que des numéros, la table reste à la scolarité.
    const anonyme = await evaluation('scolarite', 'PROJ', 'RATTRAPAGE');
    await api('prof')
      .post(`/notes/evaluations/${anonyme}/anonymat`)
      .expect(403);
    await api('scolarite')
      .post(`/notes/evaluations/${anonyme}/anonymat`)
      .expect(201);
    await noter('scolarite', anonyme, 10, 10, 10).expect(409);
    const copies = await api('scolarite').get(
      `/notes/evaluations/${anonyme}/copies`,
    );
    expect(copies.body.copies).toHaveLength(3);
    expect(JSON.stringify(copies.body)).not.toMatch(/Akouala|inscriptionId/);
    const table = await api('scolarite').get(
      `/notes/evaluations/${anonyme}/correspondance`,
    );
    const numeroDeC = table.body.lignes.find(
      (ligne: Body) => ligne.nom === 'Compaore',
    ).numero;
    await api('scolarite')
      .put(`/notes/evaluations/${anonyme}/copies`, {
        notes: [{ numero: 999, valeur: 10 }],
      })
      .expect(400);
    await api('scolarite')
      .put(`/notes/evaluations/${anonyme}/copies`, {
        notes: [{ numero: numeroDeC, valeur: 5 }],
      })
      .expect(200);
    // Tant que l'anonymat n'est pas levé, la grille ne montre pas la note.
    const masquee = await api('scolarite').get(`/notes/cours/${ids.PROJ}`);
    const noteDeC = masquee.body.etudiants
      .find((item: Body) => item.inscriptionId === ids.c)
      .notes.find((item: Body) => item.evaluationId === anonyme);
    expect(noteDeC).toMatchObject({ valeur: null, masquee: true });
    // La validation lève l'anonymat ; un rattrapage moins bon ne change pas la moyenne.
    await api('scolarite')
      .post(`/notes/evaluations/${anonyme}/valider`)
      .expect(201);
    const levee = await api('scolarite').get(`/notes/cours/${ids.PROJ}`);
    expect(
      levee.body.etudiants.find((item: Body) => item.inscriptionId === ids.c),
    ).toMatchObject({ rattrapage: 5, moyenne: 6 });

    const cloturer = (semestre: number) =>
      api('scolarite').post(
        `/deliberations/classes/${ids.classe}/semestres/${semestre}/cloturer`,
        { president: 'Pr Okemba' },
      );
    // L'annuelle attend la clôture des deux semestres.
    await cloturer(0).expect(409);
    await cloturer(2).expect(201);
    await api('scolarite')
      .patch('/academique/parametres', { compensationAnnuelle: false })
      .expect(200);
    const annuelle = await cloturer(0).expect(201);
    const decision = (cle: string) =>
      annuelle.body.resultats.find(
        (item: Body) => item.inscriptionId === ids[cle],
      ).decision;
    expect([decision('a'), decision('b'), decision('c')]).toEqual([
      'ADMIS',
      'ADMIS_AVEC_DETTES',
      'AJOURNE',
    ]);
    // Un semestre ne se rouvre pas sous une délibération annuelle clôturée.
    await api('scolarite')
      .post(`/deliberations/classes/${ids.classe}/semestres/1/rouvrir`, {
        motif: 'Erreur de saisie à corriger',
      })
      .expect(409);

    // Le passage exige que l'année suivante soit ouverte.
    const tous = { inscriptionIds: [ids.a, ids.b, ids.c] };
    await api('scolarite')
      .post(`/deliberations/classes/${ids.classe}/reinscriptions`, tous)
      .expect(409);
    await api('scolarite')
      .post('/academique/annees', {
        libelle: `${annee + 1}-${annee + 2}`,
        dateDebut: `${annee + 1}-09-01`,
        dateFin: `${annee + 2}-08-31`,
      })
      .expect(201);
    const passage = await api('scolarite').get(
      `/deliberations/classes/${ids.classe}/passage`,
    );
    expect(
      passage.body.etudiants.map((item: Body) => item.niveauSuivant),
    ).toEqual(['L2', 'L2', 'L1']);
    const reinscriptions = await api('scolarite')
      .post(`/deliberations/classes/${ids.classe}/reinscriptions`, tous)
      .expect(201);
    expect(reinscriptions.body).toMatchObject({ creees: 3, ignorees: [] });
    // Relancer ne crée pas de doublon.
    const encore = await api('scolarite')
      .post(`/deliberations/classes/${ids.classe}/reinscriptions`, tous)
      .expect(201);
    expect(encore.body.creees).toBe(0);
  });

  // ---------- Paie ----------

  it('calcule la paie à partir des contrats, des heures de cours et des absences', async () => {
    const mois = maintenant.getUTCMonth() + 1;
    const periode = await api('paie')
      .post('/paie/periodes', { annee, mois })
      .expect(201);
    ids.periode = periode.body.id;
    await api('paie').post('/paie/periodes', { annee, mois }).expect(409);
    const bulletin = (employe: string) =>
      periode.body.bulletins.find(
        (item: Body) => item.employeId === ids[employe],
      );
    // 260 000 moins deux jours d'absence ; CNSS salariale de 4 %.
    expect(bulletin('secretaire')).toMatchObject({
      brut: '240000',
      totalRetenues: '9600',
      net: '230400',
      chargesPatronales: '48672',
    });
    // Vacataire : deux heures de cours déclarées au cahier de textes.
    expect(bulletin('enseignant')).toMatchObject({
      heuresVacation: '2',
      brut: '10000',
      net: '9600',
    });
    expect(periode.body.totaux).toMatchObject({
      brut: 250000,
      net: 240000,
      coutTotal: 300700,
    });

    // Une avance saisie à la main diminue le net, puis est retirée.
    const avance = await api('paie')
      .patch(`/paie/bulletins/${bulletin('secretaire').id}`, {
        ajustements: { AVANCE: 30000 },
      })
      .expect(200);
    expect(avance.body.totaux.net).toBe(210000);
    await api('paie')
      .patch(`/paie/bulletins/${bulletin('secretaire').id}`, {
        ajustements: { INCONNUE: 5 },
      })
      .expect(400);
    await api('paie')
      .patch(`/paie/bulletins/${bulletin('secretaire').id}`, {
        ajustements: {},
      })
      .expect(200);

    // Celui qui prépare ne valide pas.
    const soi = await api('paie')
      .post(`/paie/periodes/${ids.periode}/valider`)
      .expect(403);
    expect(soi.body.message).toMatch(/préparé cette paie/);
    await api('rh').post(`/paie/periodes/${ids.periode}/valider`).expect(403);
    const validee = await api('valideurPaie')
      .post(`/paie/periodes/${ids.periode}/valider`)
      .expect(201);
    expect(validee.body.statut).toBe('VALIDEE');
  });

  it('fige les heures et les absences d’un mois dont la paie est validée', async () => {
    await api('prof')
      .post('/scolarite/seances', {
        coursId: ids.ALGO,
        date: jour,
        heureDebut: '10:00',
        dureeMinutes: 120,
        contenu: 'Introduction aux algorithmes',
      })
      .expect(409);
    await api('rh')
      .post(`/rh/employes/${ids.secretaire}/absences`, { date: jour, jours: 1 })
      .expect(409);
    await api('paie')
      .post(`/paie/periodes/${ids.periode}/recalculer`)
      .expect(409);
  });

  // ---------- Comptabilité ----------

  const ecritures = async () =>
    (await api('comptable').get('/comptabilite/journal?limit=100')).body
      .data as Body[];

  it('génère les écritures depuis la gestion, sans doublon, et suit une réouverture', async () => {
    const premieres = await ecritures();
    const encaissement = premieres.find(
      (item) => item.sourceType === 'PAIEMENT',
    )!;
    expect(
      encaissement.lignes.map((ligne: Body) => [
        ligne.compte.numero,
        Number(ligne.debit),
        Number(ligne.credit),
      ]),
    ).toEqual([
      ['571', 50000, 0],
      ['7062', 0, 50000],
    ]);
    expect(premieres.filter((item) => item.sourceType === 'PAIE')).toHaveLength(
      1,
    );
    // Une seconde consultation ne recrée rien.
    expect(await ecritures()).toHaveLength(premieres.length);

    // Paie rouverte : son écriture est contre-passée, pas effacée.
    await api('valideurPaie')
      .post(`/paie/periodes/${ids.periode}/rouvrir`, {
        motif: 'Vérification avant versement',
      })
      .expect(201);
    const apres = await ecritures();
    expect(apres.filter((item) => item.sourceType === 'EXTOURNE')).toHaveLength(
      1,
    );
    expect(
      apres.find((item) => item.sourceType === 'PAIE')!.extourneParId,
    ).toBeTruthy();

    await api('valideurPaie')
      .post(`/paie/periodes/${ids.periode}/valider`)
      .expect(201);
    await api('paie')
      .post(`/paie/periodes/${ids.periode}/payer`, {
        datePaiement: jour,
        modePaiement: 'VIREMENT',
      })
      .expect(201);
    // Une paie versée ne se rouvre plus.
    await api('valideurPaie')
      .post(`/paie/periodes/${ids.periode}/rouvrir`, {
        motif: 'Tentative après versement',
      })
      .expect(409);

    const balance = await api('comptable').get('/comptabilite/balance');
    expect(balance.body.totaux.debit).toBe(balance.body.totaux.credit);
    const etats = await api('comptable').get('/comptabilite/etats');
    expect(etats.body.resultat).toMatchObject({
      totalProduits: 50000,
      totalCharges: 300700,
      resultat: -250700,
    });
    expect(etats.body.tresorerie).toMatchObject({
      caisse: 50000,
      banque: -240000,
      dettesPersonnel: 0,
      dettesSociales: 60700,
    });
    expect(etats.body.bilan.totalActif).toBe(etats.body.bilan.totalPassif);

    const grandLivre = await api('comptable').get(
      '/comptabilite/grand-livre?compte=661',
    );
    expect(grandLivre.body.solde).toBe(250000);
  });

  it('encadre les écritures manuelles : équilibre, validation, extourne', async () => {
    const saisie = (credit: number) =>
      api('comptable').post('/comptabilite/ecritures', {
        journal: 'OD',
        date: jour,
        libelle: 'Don reçu en espèces',
        lignes: [
          { compte: '571', debit: 1000 },
          { compte: '758', credit },
        ],
      });
    const desequilibre = await saisie(900).expect(400);
    expect(desequilibre.body.message).toMatch(/déséquilibrée/);
    const brouillon = await saisie(1000).expect(201);
    expect(brouillon.body.statut).toBe('BROUILLON');
    // Un brouillon ne compte pas dans les états.
    const avant = await api('comptable').get('/comptabilite/etats');
    expect(avant.body.tresorerie.caisse).toBe(50000);
    await api('comptable')
      .post(`/comptabilite/ecritures/${brouillon.body.id}/valider`)
      .expect(201);
    // Validée, elle est définitive : ni suppression, ni modification.
    await api('comptable')
      .delete(`/comptabilite/ecritures/${brouillon.body.id}`)
      .expect(409);
    await api('comptable')
      .post(`/comptabilite/ecritures/${brouillon.body.id}/extourner`, {
        motif: 'Saisie en double',
      })
      .expect(201);
    const apres = await api('comptable').get('/comptabilite/etats');
    expect(apres.body.tresorerie.caisse).toBe(50000);
    // Une écriture issue de la gestion ne se contre-passe pas à la main.
    const automatique = (await ecritures()).find(
      (item) => item.sourceType === 'PAIEMENT',
    )!;
    await api('comptable')
      .post(`/comptabilite/ecritures/${automatique.id}/extourner`, {
        motif: 'Tentative manuelle',
      })
      .expect(403);
    await api('rh').get('/comptabilite/journal').expect(403);
  });

  it('impute la paie sur le budget de sa catégorie', async () => {
    const categories = await api('rh').get('/finances/categories');
    const salaires = (categories.body as Body[]).find((item) =>
      /Salaires/.test(item.nom),
    )!;
    await api('rh')
      .patch('/rh/parametres', { categoriePaieId: salaires.id })
      .expect(200);
    await api('gestionnaire')
      .post('/finances/exercices', {
        libelle: String(annee),
        dateDebut: `${annee}-01-01`,
        dateFin: `${annee}-12-31`,
      })
      .expect(201);
    const budget = await api('gestionnaire').get('/finances/budget');
    const ligne = (budget.body.lignes as Body[]).find(
      (item) => item.categorieId === salaires.id,
    );
    expect(ligne).toMatchObject({ paye: '300700.00', engage: '0.00' });
    // Les encaissements de l'exercice apparaissent en face des dépenses.
    expect(budget.body.totaux.recettes).toBe('50000.00');
  });

  // ---------- Statistiques, archivage, clôture ----------

  it('produit les statistiques académiques', async () => {
    const stats = await api('scolarite').get(
      `/deliberations/statistiques?anneeId=${ids.annee}`,
    );
    expect(stats.body.effectifs).toMatchObject({
      inscrits: 3,
      actifs: 3,
      enClasse: 3,
    });
    expect(stats.body.effectifs.parFiliere).toEqual([
      { libelle: 'Informatique', total: 3 },
    ]);
    expect(stats.body.reussite[0].annuel).toMatchObject({
      effectif: 3,
      reussis: 2,
      taux: 66.7,
      admisAvecDettes: 1,
      ajournes: 1,
    });
    expect(stats.body.enseignement).toMatchObject({
      cours: 4,
      coursSansEnseignant: 1,
      heuresPrevues: 120,
      heuresFaites: 2,
    });
    expect(stats.body.evolution).toHaveLength(2);
    await api('rh').get('/deliberations/statistiques').expect(403);
  });

  it('archive les pièces numérisées selon les droits du dossier', async () => {
    const ajout = await api('scolarite')
      .upload(`/documents/INSCRIPTION/${ids.a}`, {
        categorie: 'Acte de naissance',
      })
      .expect(201);
    expect(ajout.body).toHaveLength(1);
    await api('comptable').get(`/documents/INSCRIPTION/${ids.a}`).expect(403);
    await api('scolarite')
      .upload(`/documents/EMPLOYE/${ids.secretaire}`, { categorie: 'Contrat' })
      .expect(403);
    await api('rh')
      .upload(`/documents/EMPLOYE/${ids.secretaire}`, { categorie: 'Contrat' })
      .expect(201);
    // Le retrait d'une pièce archivée est motivé.
    await api('scolarite').delete(`/documents/${ajout.body[0].id}`).expect(400);
    const retrait = await api('scolarite')
      .delete(`/documents/${ajout.body[0].id}`, {
        motif: 'Mauvais document numérisé',
      })
      .expect(200);
    expect(retrait.body).toHaveLength(0);
  });

  it('clôture l’année académique et la rend définitive', async () => {
    await api('scolarite')
      .patch(`/academique/annees/${ids.annee}`, { statut: 'CLOTUREE' })
      .expect(200);
    await api('scolarite')
      .post('/academique/creneaux', {
        coursId: ids.ANG,
        jour: 3,
        heureDebut: '08:00',
        heureFin: '10:00',
      })
      .expect(409);
    await api('scolarite')
      .post(`/deliberations/classes/${ids.classe}/semestres/0/rouvrir`, {
        motif: 'Tentative après clôture',
      })
      .expect(409);
  });

  // ---------- Sauvegarde ----------

  it('sauvegarde la base et vérifie qu’elle se restaure à l’identique', async () => {
    await api('comptable').post('/sauvegardes').expect(403);
    const sauvegarde = await api('admin').post('/sauvegardes').expect(201);
    expect(sauvegarde.body).toMatchObject({
      statut: 'REUSSIE',
      declenchement: 'MANUEL',
    });
    expect(sauvegarde.body.lignes).toBeGreaterThan(100);
    const test = await api('admin')
      .post(`/sauvegardes/${sauvegarde.body.id}/test`)
      .expect(201);
    expect(test.body.resultat).toMatch(/Restauration réussie/);
    expect(test.body.reussi).toBe(true);
    const liste = await api('admin').get('/sauvegardes');
    expect(liste.body).toMatchObject({ enRetard: false });
    expect(liste.body.sauvegardes[0]).toMatchObject({ disponible: true });
    expect(liste.body.dernierTest.resultat).toMatch(/Restauration réussie/);
    const fichier = await api('admin')
      .get(`/sauvegardes/${sauvegarde.body.id}/fichier`)
      .expect(200);
    expect(fichier.headers['content-type']).toMatch(/gzip/);
  });
});
