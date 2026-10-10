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
      ['ANG', 15, 9, 12],
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
    expect(resultat('c')).toMatchObject({ creditsAcquis: 10, rang: 3 });
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

  // ---------- Crédits, redoublement, documents, calendrier ----------

  it('suit les crédits à rattraper et délivre les documents de fin d’année', async () => {
    // B passe avec une unité à repasser ; C, ajourné, garde celle qu'il a validée.
    const dettes = await api('scolarite')
      .get('/deliberations/dettes')
      .expect(200);
    expect(dettes.body.dettes).toHaveLength(1);
    const dette = dettes.body.dettes[0];
    expect(dette).toMatchObject({
      code: 'UE2',
      credits: 10,
      statut: 'DETTE',
      niveau: 'L1',
      filiere: 'Informatique',
      personne: { nom: 'Bemba' },
    });
    const passage = await api('scolarite').get(
      `/deliberations/classes/${ids.classe}/passage`,
    );
    expect(
      passage.body.etudiants.map((item: Body) => [
        item.creditsARattraper,
        item.creditsConserves,
      ]),
    ).toEqual([
      [0, 0],
      [10, 0],
      [0, 10],
    ]);

    const rattraper = (user: string, note: number) =>
      api(user).post(`/deliberations/dettes/${dette.id}/rattrapage`, {
        date: jour,
        session: 'Session de septembre',
        notes: [{ code: 'ANG', note }],
      });
    await rattraper('prof', 15).expect(403);
    // Une note moins bonne que l'ancienne ne change rien : la dette reste due.
    const rate = await rattraper('scolarite', 8).expect(201);
    expect(rate.body).toMatchObject({ statut: 'DETTE' });
    expect(rate.body.tentatives).toHaveLength(1);
    const acquise = await rattraper('scolarite', 13).expect(201);
    expect(acquise.body).toMatchObject({
      statut: 'ACQUISE',
      mode: 'RATTRAPAGE',
    });
    expect(Number(acquise.body.moyenne)).toBe(13);
    await rattraper('scolarite', 14).expect(409);
    const restantes = await api('scolarite').get('/deliberations/dettes');
    expect(restantes.body.dettes).toHaveLength(0);
    const rattrapees = await api('scolarite').get(
      '/deliberations/dettes?statut=RATTRAPEES',
    );
    expect(rattrapees.body.dettes).toHaveLength(1);
    // Un rattrapage passé s'appuie sur la délibération : elle ne se rouvre plus.
    const rouverte = await api('scolarite')
      .post(`/deliberations/classes/${ids.classe}/semestres/0/rouvrir`, {
        motif: 'Tentative après rattrapage',
      })
      .expect(409);
    expect(rouverte.body.message).toMatch(/rattrapage/);

    // Relevé annuel : les deux semestres, le résultat, et ce qui reste dû.
    const releve = await api('scolarite')
      .get(`/deliberations/releves/${ids.a}`)
      .expect(200);
    expect(releve.body).toMatchObject({
      finDeCycle: false,
      diplomable: false,
      dettes: [],
      effectif: 3,
      resultat: { decision: 'ADMIS', creditsAcquis: 60 },
    });
    expect(releve.body.semestres).toHaveLength(2);
    expect(releve.body.semestres[0].unites[0]).toMatchObject({
      code: 'UE1',
      statut: 'ACQUISE',
    });
    // Scolarité non soldée : le relevé est retenu comme le bulletin.
    await api('scolarite').get(`/deliberations/releves/${ids.b}`).expect(403);
    const tous = await api('scolarite').get(
      `/deliberations/classes/${ids.classe}/releves`,
    );
    expect(tous.body.filter((item: Body) => item.retenu)).toHaveLength(2);
  });

  it('date les maquettes par année et dispense le redoublant des unités acquises', async () => {
    const annees = await api('scolarite').get('/academique/annees');
    ids.annee2 = annees.body.find(
      (item: Body) => item.libelle === `${annee + 1}-${annee + 2}`,
    ).id;
    // La nouvelle année est repartie des maquettes de la précédente.
    const maquette = (anneeId: string) =>
      api('scolarite').get(
        `/academique/maquette?filiereId=${ids.filiere}&niveau=L1&anneeId=${anneeId}`,
      );
    const suivante = await maquette(ids.annee2);
    expect(suivante.body.unites).toHaveLength(3);
    const ue1 = suivante.body.unites.find((item: Body) => item.code === 'UE1');
    expect(ue1.matieres).toHaveLength(2);
    // La modifier ne touche pas celle de l'année d'avant.
    await api('scolarite')
      .patch(`/academique/unites/${ue1.id}`, { nom: 'Unité UE1 revue' })
      .expect(200);
    const origine = await maquette(ids.annee);
    expect(
      origine.body.unites.find((item: Body) => item.code === 'UE1').nom,
    ).toBe('Unité UE1');

    const classe = await api('scolarite')
      .post('/academique/classes', {
        anneeAcademiqueId: ids.annee2,
        filiereId: ids.filiere,
        niveau: 'L1',
      })
      .expect(201);
    ids.classe2 = classe.body.id;
    // C redouble : sa réinscription porte déjà la filière du référentiel.
    const candidats = await api('scolarite').get(
      `/academique/classes/${ids.classe2}/candidats`,
    );
    expect(candidats.body).toHaveLength(1);
    expect(candidats.body[0]).toMatchObject({
      correspond: true,
      personne: { nom: 'Compaore' },
    });
    ids.c2 = candidats.body[0].id;
    await api('scolarite')
      .post(`/academique/classes/${ids.classe2}/affectations`, {
        inscriptionIds: [ids.c2],
      })
      .expect(201);
    const cours = await api('scolarite').get(
      `/academique/cours?classeId=${ids.classe2}`,
    );
    for (const item of cours.body) ids[`${item.matiere.code}2`] = item.id;

    // L'unité d'anglais est acquise depuis l'an dernier : rien à noter pour lui.
    const anglais = await api('scolarite').get(`/notes/cours/${ids.ANG2}`);
    expect(anglais.body.etudiants[0].dispense).toBe(true);
    const maths = await api('scolarite').get(`/notes/cours/${ids.MATH2}`);
    expect(maths.body.etudiants[0].dispense).toBe(false);
    const examen = async (code: string, valeur?: number) => {
      const created = await api('scolarite')
        .post('/notes/evaluations', {
          coursId: ids[`${code}2`],
          type: 'EXAMEN',
          libelle: `Examen ${code}`,
        })
        .expect(201);
      if (valeur !== undefined)
        await api('scolarite')
          .put(`/notes/evaluations/${created.body.id}/notes`, {
            notes: [{ inscriptionId: ids.c2, valeur }],
          })
          .expect(200);
      await api('scolarite')
        .post(`/notes/evaluations/${created.body.id}/valider`)
        .expect(201);
    };
    await examen('MATH', 14);
    await examen('ALGO', 10);
    // Validée sans note : le seul étudiant de la classe en est dispensé.
    await examen('ANG');
    const semestre = await api('scolarite')
      .get(`/deliberations/classes/${ids.classe2}/semestres/1`)
      .expect(200);
    expect(semestre.body.problemes).toEqual([]);
    const ligne = semestre.body.resultats[0];
    expect(
      ligne.detail.unites.find((item: Body) => item.code === 'UE2'),
    ).toMatchObject({ validee: true, acquise: libelleAnnee, moyenne: 12 });
    expect(ligne).toMatchObject({
      decision: 'VALIDE',
      creditsAcquis: 30,
      moyenne: 12.67,
    });
  });

  it('tient le calendrier des épreuves et refuse les conflits', async () => {
    const salles = await api('scolarite').get('/academique/salles');
    const date = `${annee + 1}-11-10`;
    const epreuve = (libelle: string, heureDebut?: string, heureFin?: string) =>
      api('scolarite').post('/notes/evaluations', {
        coursId: ids.PROJ2,
        type: 'CONTROLE',
        libelle,
        date,
        heureDebut,
        heureFin,
        salleId: salles.body[0].id,
        surveillant: 'M. Mabiala',
      });
    await epreuve('Devoir 1', '08:00', '10:00').expect(201);
    // Une heure sans l'autre ne veut rien dire.
    await epreuve('Devoir bancal', '08:00').expect(400);
    const conflit = await epreuve('Devoir 2', '09:00', '11:00').expect(409);
    expect(conflit.body.message).toMatch(/La classe a déjà « Devoir 1 »/);
    const second = await epreuve('Devoir 2', '10:00', '12:00').expect(201);
    // Déplacer une épreuve repasse par le même contrôle.
    await api('scolarite')
      .patch(`/notes/evaluations/${second.body.id}`, { heureDebut: '09:30' })
      .expect(409);
    const calendrier = await api('scolarite')
      .get(`/notes/calendrier?anneeId=${ids.annee2}`)
      .expect(200);
    expect(calendrier.body.sansDate).toBe(3);
    expect(
      calendrier.body.epreuves.map((item: Body) => [
        item.libelle,
        item.heureDebut,
        item.salle,
        item.conflits.length,
      ]),
    ).toEqual([
      ['Devoir 1', '08:00', 'Salle A', 0],
      ['Devoir 2', '10:00', 'Salle A', 0],
    ]);
    await api('rh').get('/notes/calendrier').expect(403);
  });

  it('ouvre de nouveaux niveaux, copie et importe des maquettes, rapproche les filières', async () => {
    const niveaux = await api('scolarite').get('/academique/niveaux');
    expect(niveaux.body.map((item: Body) => item.code)).toEqual(['L1', 'L2']);
    const troisieme = {
      code: 'l3',
      libelle: 'Troisième année',
      cycle: 'Licence',
      rang: 3,
      diplome: 'Licence',
    };
    await api('prof').post('/academique/niveaux', troisieme).expect(403);
    const l3 = await api('scolarite')
      .post('/academique/niveaux', troisieme)
      .expect(201);
    expect(l3.body.code).toBe('L3');
    // Deux niveaux ne partagent pas le même rang d'un cycle.
    await api('scolarite')
      .post('/academique/niveaux', { ...troisieme, code: 'LX' })
      .expect(409);

    // Le nouveau niveau s'inscrit ; un niveau inconnu est refusé.
    const inscrire = (niveau: string, filiere: string) =>
      api('scolarite').post('/inscriptions', {
        nouvellePersonne: { nom: `Etudiant ${niveau}`, prenom: 'Test' },
        anneeScolaire: `${annee + 1}-${annee + 2}`,
        niveau,
        filiere,
      });
    await inscrire('M9', 'Informatique').expect(400);
    const liee = await inscrire('L3', ' informatique ').expect(201);
    expect(liee.body).toMatchObject({
      niveau: 'L3',
      filiere: 'Informatique',
      filiereId: ids.filiere,
    });
    // Une faute de frappe reste un texte libre, proposé au rapprochement.
    const fautive = await inscrire('L3', 'Informatiqe').expect(201);
    expect(fautive.body.filiereId).toBeNull();
    const aRapprocher = await api('scolarite').get(
      '/academique/filieres/rapprochement',
    );
    expect(aRapprocher.body).toEqual([
      {
        texte: 'Informatiqe',
        inscriptions: 1,
        suggestion: { id: ids.filiere, nom: 'Informatique' },
      },
    ]);
    const rapprochement = await api('scolarite')
      .post('/academique/filieres/rapprochement', {
        texte: 'Informatiqe',
        filiereId: ids.filiere,
      })
      .expect(201);
    expect(rapprochement.body.rapprochees).toBe(1);
    const reste = await api('scolarite').get(
      '/academique/filieres/rapprochement',
    );
    expect(reste.body).toEqual([]);

    // Une filière courte s'arrête avant la fin du cycle.
    const courte = await api('scolarite')
      .patch(`/academique/filieres/${ids.filiere}`, { niveauFinal: 'L2' })
      .expect(200);
    expect(courte.body.niveauFinal).toBe('L2');
    await api('scolarite')
      .patch(`/academique/filieres/${ids.filiere}`, { niveauFinal: 'Z9' })
      .expect(400);

    // Tronc commun : une unité copiée vers une autre filière, sur deux niveaux.
    const reseaux = await api('scolarite')
      .post('/academique/filieres', { code: 'RES', nom: 'Réseaux' })
      .expect(201);
    const copier = () =>
      api('scolarite')
        .post('/academique/maquette/copier', {
          source: {
            anneeId: ids.annee2,
            filiereId: ids.filiere,
            niveau: 'L1',
          },
          cibles: [
            { filiereId: reseaux.body.id, niveau: 'L1' },
            { filiereId: reseaux.body.id, niveau: 'L3' },
          ],
          unites: ['UE1'],
        })
        .expect(201);
    expect((await copier()).body).toMatchObject({
      maquettes: 2,
      unites: 2,
      matieres: 4,
    });
    // Recopier n'écrase ni ne double rien.
    expect((await copier()).body).toMatchObject({
      unites: 0,
      matieres: 0,
      dejaPresentes: 2,
    });

    const importer = (lignes: Body[]) =>
      api('scolarite').post('/academique/maquette/importer', {
        anneeAcademiqueId: ids.annee2,
        filiereId: reseaux.body.id,
        niveau: 'L2',
        lignes,
      });
    const unite = {
      semestre: 1,
      codeUnite: 'UEA',
      nomUnite: 'Bases des réseaux',
      credits: 30,
    };
    const refuse = await importer([
      { ...unite, codeMatiere: 'M1', nomMatiere: 'Matière 1' },
      { ...unite, codeUnite: 'UEB', semestre: 3 },
    ]).expect(400);
    expect(refuse.body.message).toMatch(/^Ligne 2/);
    const importe = await importer([
      {
        ...unite,
        codeMatiere: 'M1',
        nomMatiere: 'Matière 1',
        coefficient: '2,5',
        volumeHoraire: 40,
      },
      { codeUnite: 'UEA', codeMatiere: 'M2', nomMatiere: 'Matière 2' },
    ]).expect(201);
    expect(importe.body).toMatchObject({ unites: 1, matieres: 2 });
    const maquettes = await api('scolarite').get(
      `/academique/maquettes?anneeId=${ids.annee2}`,
    );
    expect(maquettes.body.maquettes).toEqual(
      expect.arrayContaining([
        { filiereId: reseaux.body.id, niveau: 'L2', unites: 1, credits: 30 },
        { filiereId: reseaux.body.id, niveau: 'L3', unites: 1, credits: 20 },
      ]),
    );
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
    expect(stats.body.effectifs.parPole).toEqual([
      { libelle: 'Sans pôle', total: 3 },
    ]);
    expect(stats.body.reussiteParPole).toEqual([
      { pole: 'Sans pôle', effectif: 3, reussis: 2, taux: 66.7 },
    ]);
    // La dette de l'année a été rattrapée.
    expect(stats.body.dettes).toEqual({ etudiants: 0, unites: 0, credits: 0 });
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

  // ---------- Saisies faites hors ligne ----------

  it('reprend l’heure et l’identifiant d’une saisie faite hors ligne', async () => {
    const saisie = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const demande = await api('admin')
      .post('/demandes-bourse', {
        nouvellePersonne: { nom: 'Horsligne', prenom: 'Etu' },
        niveauDemande: 'PREMIERE_ANNEE',
        filiereSouhaitee: 'Informatique',
      })
      .set('X-Saisie-Le', saisie)
      .expect(201);
    expect(demande.body.dateDepot).toBe(saisie);

    // Deux versements identiques saisis hors ligne : deux paiements distincts.
    const versement = {
      demandeBourseId: demande.body.id,
      montant: 5000,
      typePaiement: 'FRAIS_DEPOT',
    };
    const premier = '0b5f6c1e-8a0d-4c8e-9d57-3f1a2b4c5d6e';
    const second = '7c9e2d3f-1b4a-4e6f-8a7b-9c0d1e2f3a4b';
    for (const identifiant of [premier, second]) {
      const paiement = await api('admin')
        .post('/paiements', versement)
        .set('X-Saisie-Le', saisie)
        .set('X-Identifiant-Local', identifiant)
        .expect(201);
      // Le reçu remis hors ligne garde sa référence et sa date.
      expect(paiement.body).toMatchObject({
        id: identifiant,
        datePaiement: saisie,
      });
    }
    // Un renvoi du même enregistrement ne l'encaisse pas une seconde fois.
    await api('admin')
      .post('/paiements', versement)
      .set('X-Identifiant-Local', premier)
      .expect(201);
    const paiements = await api('admin').get(
      `/demandes-bourse/${demande.body.id}/paiements`,
    );
    expect(paiements.body).toHaveLength(2);

    // Une date invraisemblable est ignorée : le serveur garde son heure.
    const futur = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const enLigne = await api('admin')
      .post('/paiements', versement)
      .set('X-Saisie-Le', futur)
      .expect(201);
    expect(enLigne.body.datePaiement).not.toBe(futur);
  });

  it('refuse une modification hors ligne sur une fiche changée entre-temps', async () => {
    const personne = await api('admin')
      .post('/personnes', {
        nom: 'Conflit',
        prenom: 'Test',
        dateNaissance: '2005-03-04',
        telephone: '07 00 00 00 99',
      })
      .expect(201);
    const id = personne.body.id as string;
    // La version connue de l'appareil figure dans les listes qu'il télécharge.
    const liste = await api('admin').get('/personnes?q=Conflit');
    const connue = liste.body.data[0].modifieLe as string;
    expect(connue).toBeTruthy();

    // Un collègue modifie la fiche en ligne.
    const collegue = await api('admin')
      .patch(`/personnes/${id}`, { quartier: 'Centre' })
      .expect(200);
    await api('admin')
      .patch(`/personnes/${id}`, { quartier: 'Hors ligne' })
      .set('X-Version-Connue', connue)
      .expect(409);
    // À partir de la version à jour, la modification passe.
    await api('admin')
      .patch(`/personnes/${id}`, { quartier: 'Hors ligne' })
      .set('X-Version-Connue', collegue.body.modifieLe)
      .expect(200);
  });

  it('signale les personnes semblables sans confondre les homonymes', async () => {
    const doublons = (query: string) =>
      api('admin').get(`/personnes/doublons?nom=conflit&prenom=TEST${query}`);
    const semblable = await doublons('&dateNaissance=2005-03-04');
    expect(semblable.body).toHaveLength(1);
    // Même nom, autre date de naissance et autre téléphone : un homonyme.
    const homonyme = await doublons(
      '&dateNaissance=2001-01-01&telephone=0611111111',
    );
    expect(homonyme.body).toHaveLength(0);
    // Le téléphone seul suffit à rapprocher, espaces ignorés.
    expect((await doublons('&telephone=0700000099')).body).toHaveLength(1);
    expect(
      (await doublons(`&exclure=${semblable.body[0].id}`)).body,
    ).toHaveLength(0);
    // Un agent sans accès aux personnes ni aux dossiers n'interroge pas ce fichier.
    await api('rh').get('/personnes/doublons?nom=a&prenom=b').expect(403);
  });

  it('indique les dossiers modifiés depuis le dernier téléchargement', async () => {
    const complet = await api('admin').get('/synchronisation/changements');
    expect(complet.body.complet).toBe(true);

    const depuis = complet.body.horodatage as string;
    const calme = await api('admin').get(
      `/synchronisation/changements?depuis=${encodeURIComponent(depuis)}`,
    );
    expect(calme.body).toMatchObject({ complet: false, inscriptions: [] });

    // Un paiement suffit à signaler son dossier, même daté d'une saisie passée.
    const finance = await api('admin').get(`/inscriptions/${ids.b}/finance`);
    await api('admin')
      .post('/paiements', {
        inscriptionId: ids.b,
        elementDossierId: finance.body.obligations[0].id,
        montant: 1000,
        typePaiement: 'FRAIS_INSCRIPTION',
      })
      .set('X-Saisie-Le', new Date(Date.now() - 86_400_000).toISOString())
      .expect(201);
    const apres = await api('admin').get(
      `/synchronisation/changements?depuis=${encodeURIComponent(depuis)}`,
    );
    expect(apres.body.inscriptions).toEqual([ids.b]);
    // Sans droit sur les dossiers, la liste reste vide.
    const rh = await api('rh').get(
      `/synchronisation/changements?depuis=${encodeURIComponent(depuis)}`,
    );
    expect(rh.body.inscriptions).toEqual([]);
  });

  it('annule un paiement saisi par erreur sans rien effacer', async () => {
    const finance = async () =>
      (await api('admin').get(`/inscriptions/${ids.b}/finance`)).body
        .obligations[0] as Body;
    const avant = await finance();
    const paiement = await api('admin')
      .post('/paiements', {
        inscriptionId: ids.b,
        elementDossierId: avant.id,
        montant: 2000,
        typePaiement: 'FRAIS_INSCRIPTION',
      })
      .expect(201);
    const annulation = `/paiements/${paiement.body.id}/annulation`;

    // Encaisser ne donne pas le droit d'annuler, et un motif est exigé.
    await api('scolarite')
      .post(annulation, { motif: 'Mauvais étudiant' })
      .expect(403);
    await api('admin').post(annulation, { motif: 'non' }).expect(400);

    const annule = await api('admin')
      .post(annulation, { motif: 'Saisi sur le mauvais étudiant' })
      .expect(201);
    expect(annule.body).toMatchObject({
      typePaiement: 'ANNULATION',
      annulePaiementId: paiement.body.id,
      motif: 'Saisi sur le mauvais étudiant',
    });
    expect(Number(annule.body.montant)).toBe(-2000);
    // Une seule annulation par paiement, et une annulation ne s'annule pas.
    await api('admin')
      .post(annulation, { motif: 'Seconde tentative' })
      .expect(409);
    await api('admin')
      .post(`/paiements/${annule.body.id}/annulation`, {
        motif: 'Annuler une annulation',
      })
      .expect(400);

    // Le reste à payer revient à sa valeur, le journal garde les deux lignes.
    expect((await finance()).resteAPayer).toBe(avant.resteAPayer);
    const journal = (await api('admin').get('/paiements')).body as Body[];
    expect(journal.find((item) => item.id === paiement.body.id)).toMatchObject({
      annule: true,
    });

    // La comptabilité contre-passe l'encaissement sur le même produit.
    const reference = (annule.body.id as string).slice(0, 8).toUpperCase();
    const ecriture = (
      await api('comptable').get('/comptabilite/journal?limit=100')
    ).body.data.find((item: Body) => item.reference === reference) as Body;
    expect(
      ecriture.lignes.map((ligne: Body) => [
        ligne.compte.numero,
        Number(ligne.debit),
        Number(ligne.credit),
      ]),
    ).toEqual([
      ['7062', 2000, 0],
      ['571', 0, 2000],
    ]);
  });

  it('encaisse avec un mode de paiement, un caissier et un numéro de reçu suivi', async () => {
    const obligation = (
      await api('admin').get(`/inscriptions/${ids.b}/finance`)
    ).body.obligations[0] as Body;
    const verser = (modePaiement?: string) =>
      api('scolarite').post('/paiements', {
        inscriptionId: ids.b,
        elementDossierId: obligation.id,
        montant: 500,
        typePaiement: 'FRAIS_INSCRIPTION',
        modePaiement,
      });
    await verser('TROC').expect(400);
    const mobile = await verser('MOBILE_MONEY').expect(201);
    const especes = await verser().expect(201);

    const journal = (await api('admin').get('/paiements')).body as Body[];
    const ligne = (id: string) => journal.find((item) => item.id === id)!;
    expect(ligne(mobile.body.id)).toMatchObject({
      modePaiement: 'MOBILE_MONEY',
      saisiParNom: 'scolarite',
    });
    expect(ligne(especes.body.id).modePaiement).toBe('ESPECES');
    // Deux reçus consécutifs portent deux numéros qui se suivent.
    const rang = (id: string) =>
      Number((ligne(id).numeroRecu as string).split('-').pop());
    expect(ligne(mobile.body.id).numeroRecu).toMatch(/^RC-\d{4}-\d{6}$/);
    expect(rang(especes.body.id)).toBe(rang(mobile.body.id) + 1);

    // Le mobile money n'entre pas dans la caisse.
    const reference = (mobile.body.id as string).slice(0, 8).toUpperCase();
    const ecriture = (
      await api('comptable').get('/comptabilite/journal?limit=100')
    ).body.data.find((item: Body) => item.reference === reference) as Body;
    expect(ecriture.journal).toBe('MM');
    expect(ecriture.lignes[0].compte.numero).toBe('552');

    // Deux versements simultanés ne dépassent jamais le reste à payer.
    const reste = Number(
      (await api('admin').get(`/inscriptions/${ids.b}/finance`)).body
        .obligations[0].resteAPayer,
    );
    const simultanes = await Promise.all(
      [1, 2].map(() =>
        api('admin').post('/paiements', {
          inscriptionId: ids.b,
          elementDossierId: obligation.id,
          montant: reste,
          typePaiement: 'FRAIS_INSCRIPTION',
        }),
      ),
    );
    expect(simultanes.map((reponse) => reponse.status).sort()).toEqual([
      201, 400,
    ]);
  });

  it('ferme un exercice sans y laisser entrer d’écriture après coup', async () => {
    const demande = await api('admin')
      .post('/demandes-bourse', {
        nouvellePersonne: { nom: 'Cloture', prenom: 'Etu' },
        niveauDemande: 'PREMIERE_ANNEE',
        filiereSouhaitee: 'Informatique',
      })
      .expect(201);
    const verser = async (montant: number) =>
      (
        (
          await api('admin')
            .post('/paiements', {
              demandeBourseId: demande.body.id,
              montant,
              typePaiement: 'FRAIS_DEPOT',
            })
            .expect(201)
        ).body.id as string
      )
        .slice(0, 8)
        .toUpperCase();
    const ecritureDe = async (reference: string) =>
      (
        await api('comptable').get('/comptabilite/journal?limit=100')
      ).body.data.find((item: Body) => item.reference === reference) as Body;
    const exercice = (
      (await api('gestionnaire').get('/finances/exercices')).body as Body[]
    ).find(
      (item) =>
        new Date(item.dateDebut) <= new Date() &&
        new Date(item.dateFin) >= new Date(),
    )!;

    // Encaissé avant la clôture, pas encore passé en comptabilité : la clôture l'y fait entrer.
    const avant = await verser(700);
    await api('gestionnaire')
      .patch(`/finances/exercices/${exercice.id}`, { cloture: true })
      .expect(200);
    const dansExercice = await ecritureDe(avant);
    expect(dansExercice.libelle).not.toContain('exercice clôturé');
    expect(dansExercice.exerciceId).toBe(exercice.id);

    // Encaissé après : l'écriture existe, mais plus dans l'exercice fermé.
    const apres = await ecritureDe(await verser(800));
    expect(apres.libelle).toContain('exercice clôturé');
    expect(apres.exerciceId).toBeNull();

    await api('gestionnaire')
      .patch(`/finances/exercices/${exercice.id}`, { cloture: false })
      .expect(200);
  });

  it('organise les filières en pôles, sans rien figer', async () => {
    const pole = await api('scolarite')
      .post('/academique/poles', { nom: 'Pôle Santé', description: 'Essai' })
      .expect(201);
    await api('scolarite')
      .post('/academique/poles', { nom: 'pôle santé' })
      .expect(409);
    const filiere = await api('scolarite')
      .post('/academique/filieres', {
        code: 'SI',
        nom: 'Soins infirmiers',
        poleId: pole.body.id,
      })
      .expect(201);
    expect(filiere.body.pole.nom).toBe('Pôle Santé');
    await api('scolarite')
      .post('/academique/filieres', {
        code: 'XX',
        nom: 'Sans pôle',
        poleId: 'inconnu',
      })
      .expect(404);
    // Sans droit sur la structure, on ne touche à rien.
    await api('rh').post('/academique/poles', { nom: 'Interdit' }).expect(403);

    // L'organisation de départ se charge une fois, puis ne recrée rien.
    const premier = await api('scolarite')
      .post('/academique/poles/structure-type', {})
      .expect(201);
    expect(premier.body.poles).toBe(4);
    const second = await api('scolarite')
      .post('/academique/poles/structure-type', {})
      .expect(201);
    expect(second.body).toEqual({ poles: 0, filieres: 0, rattachees: 0 });
    const poles = (await api('scolarite').get('/academique/poles'))
      .body as Body[];
    const industriel = poles.find((item) => item.nom === 'Pôle Industriel')!;
    expect(industriel.filieres).toHaveLength(7);
    expect(
      poles.reduce((total, item) => total + item.filieres.length, 0),
    ).toBeGreaterThanOrEqual(33);

    // Tout reste modifiable : renommer un pôle, déplacer ou détacher une filière.
    await api('scolarite')
      .patch(`/academique/poles/${pole.body.id}`, {
        nom: 'Pôle Santé et Social',
      })
      .expect(200);
    const deplacee = await api('scolarite')
      .patch(`/academique/filieres/${filiere.body.id}`, {
        poleId: industriel.id,
      })
      .expect(200);
    expect(deplacee.body.pole.nom).toBe('Pôle Industriel');
    const detachee = await api('scolarite')
      .patch(`/academique/filieres/${filiere.body.id}`, { poleId: null })
      .expect(200);
    expect(detachee.body.pole).toBeNull();
  });
});
