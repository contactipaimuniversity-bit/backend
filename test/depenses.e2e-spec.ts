/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

// Circuit complet d'une dépense sur une base dédiée. Le test ne tourne que si
// E2E_DATABASE_URL désigne une base vide et migrée : il y écrit des données.
// Lancement : npm run test:depenses (crée puis supprime une base jetable).
const databaseUrl = process.env.E2E_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

type Body = Record<string, any>;

suite('Circuit de dépense (e2e)', () => {
  let app: INestApplication<App>;
  const tokens: Record<string, string> = {};
  const pdf = Buffer.from('%PDF-1.4 test');

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
      upload: (path: string, fields: Record<string, string>, file = true) => {
        let test = auth(request(server).post(path));
        for (const [key, value] of Object.entries(fields))
          test = test.field(key, value);
        return file
          ? test.attach('fichier', pdf, {
              filename: 'piece.pdf',
              contentType: 'application/pdf',
            })
          : test;
      },
    };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'e2e-secret';
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
    const users: Record<string, string[]> = {
      demandeur: ['view:expenses', 'edit:expenses'],
      autreDemandeur: ['view:expenses', 'edit:expenses'],
      // Possède les deux niveaux : sert à vérifier qu'il ne peut pas enchaîner.
      valideur1: [
        'view:expense-approval',
        'edit:expense-approval',
        'view:expense-final-approval',
        'edit:expense-final-approval',
        'view:expense-payment',
        'edit:expense-payment',
      ],
      valideur2: ['view:expense-final-approval', 'edit:expense-final-approval'],
      comptable: ['view:expense-payment', 'edit:expense-payment'],
      gestionnaire: ['view:finance-settings', 'edit:finance-settings'],
      // Demande et valide : ne doit jamais se voir proposer ses propres demandes.
      chefService: [
        'view:expenses',
        'edit:expenses',
        'view:expense-approval',
        'edit:expense-approval',
      ],
    };
    for (const [nom, permissions] of Object.entries(users)) {
      const user = await prisma.utilisateur.create({
        data: {
          nom,
          email: `${nom}@e2e.test`,
          motDePasse: 'x',
          role: 'employe',
          permissions,
        },
      });
      tokens[nom] = await jwt.signAsync({ sub: user.id, nom });
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  let categorieId: string;
  let fournisseurId: string;
  let depenseId: string;

  const demande = (prixUnitaire: string) => ({
    objet: 'Achat de chaises',
    justification: 'Équiper la nouvelle salle de cours du bâtiment B',
    categorieId,
    fournisseurId,
    lignes: [
      { designation: 'Chaise', quantite: '20', prixUnitaire },
      { designation: 'Livraison', quantite: '1', prixUnitaire: '100000' },
    ],
  });

  it('prépare les règles, un exercice et un budget', async () => {
    const regles = await api('gestionnaire').get('/finances/parametres');
    expect(regles.body).toMatchObject({
      seuilDoubleValidation: '500000',
      budgetBloquant: true,
      separationPaiement: true,
    });
    const categories = await api('demandeur').get('/finances/categories');
    categorieId = (categories.body as Body[]).find(
      (item) => item.livraisonRequise,
    )!.id;

    await api('demandeur')
      .patch('/finances/parametres', { budgetBloquant: false })
      .expect(403);

    const annee = new Date().getFullYear();
    const exercice = await api('gestionnaire')
      .post('/finances/exercices', {
        libelle: String(annee),
        dateDebut: `${annee}-01-01`,
        dateFin: `${annee}-12-31`,
      })
      .expect(201);
    await api('gestionnaire')
      .post('/finances/exercices', {
        libelle: 'Chevauchement',
        dateDebut: `${annee}-06-01`,
        dateFin: `${annee + 1}-05-31`,
      })
      .expect(409);
    await api('gestionnaire')
      .put('/finances/budget', {
        exerciceId: exercice.body.id,
        categorieId,
        montant: '1000000',
      })
      .expect(200);

    const fournisseur = await api('demandeur')
      .post('/finances/fournisseurs', { nom: 'Mobilier Pro' })
      .expect(201);
    fournisseurId = fournisseur.body.id;
  });

  it('refuse la soumission sans lettre de demande ni devis', async () => {
    const created = await api('demandeur')
      .post('/depenses', demande('25000'))
      .expect(201);
    depenseId = created.body.id;
    expect(created.body).toMatchObject({
      statut: 'BROUILLON',
      montant: '600000',
    });
    expect(created.body.numero).toMatch(/^DA-\d{4}-0001$/);

    const refus = await api('demandeur')
      .post(`/depenses/${depenseId}/soumettre`)
      .expect(400);
    expect(refus.body.message).toMatch(/lettre de demande/);

    await api('demandeur')
      .upload(`/depenses/${depenseId}/pieces`, { type: 'LETTRE_DEMANDE' })
      .expect(201);
    await api('demandeur')
      .upload(`/depenses/${depenseId}/pieces`, { type: 'DEVIS' })
      .expect(201);
  });

  it('cache la demande aux autres demandeurs et la réserve à son auteur', async () => {
    await api('autreDemandeur').get(`/depenses/${depenseId}`).expect(403);
    await api('autreDemandeur')
      .post(`/depenses/${depenseId}/soumettre`)
      .expect(403);
    const liste = await api('autreDemandeur').get('/depenses');
    expect(liste.body.data).toHaveLength(0);
  });

  it('exige une double validation au-delà du seuil, par deux personnes', async () => {
    const soumise = await api('demandeur')
      .post(`/depenses/${depenseId}/soumettre`)
      .expect(201);
    expect(soumise.body).toMatchObject({ statut: 'SOUMISE', niveauxRequis: 2 });

    // Une demande soumise est figée.
    await api('demandeur')
      .patch(`/depenses/${depenseId}`, demande('1'))
      .expect(409);
    // Ni le demandeur ni un simple comptable ne valident.
    await api('demandeur').post(`/depenses/${depenseId}/valider`).expect(403);
    await api('comptable').post(`/depenses/${depenseId}/valider`).expect(403);
    // La validation finale n'intervient pas avant la première.
    await api('valideur2').post(`/depenses/${depenseId}/valider`).expect(403);

    const premiere = await api('valideur1')
      .post(`/depenses/${depenseId}/valider`)
      .expect(201);
    expect(premiere.body.statut).toBe('VALIDATION_FINALE');
    expect(premiere.body.numeroBonCommande).toBeNull();

    const meme = await api('valideur1')
      .post(`/depenses/${depenseId}/valider`)
      .expect(403);
    expect(meme.body.message).toMatch(/autre personne/);

    const finale = await api('valideur2')
      .post(`/depenses/${depenseId}/valider`)
      .expect(201);
    expect(finale.body.statut).toBe('VALIDEE');
    expect(finale.body.numeroBonCommande).toMatch(/^BC-\d{4}-0001$/);
  });

  it('bloque une demande qui dépasse le budget restant', async () => {
    // 1 000 000 de budget, 600 000 engagés : 500 000 de plus ne passent pas.
    const seconde = await api('autreDemandeur')
      .post('/depenses', demande('20000'))
      .expect(201);
    const id = seconde.body.id as string;
    await api('autreDemandeur')
      .upload(`/depenses/${id}/pieces`, { type: 'LETTRE_DEMANDE' })
      .expect(201);
    await api('autreDemandeur')
      .upload(`/depenses/${id}/pieces`, { type: 'DEVIS' })
      .expect(201);
    const refus = await api('autreDemandeur')
      .post(`/depenses/${id}/soumettre`)
      .expect(400);
    expect(refus.body.message).toMatch(/Budget insuffisant/);

    // Sous le seuil et dans le budget : une seule validation, puis rejet motivé.
    await api('autreDemandeur')
      .patch(`/depenses/${id}`, {
        ...demande('5000'),
        lignes: [
          { designation: 'Chaise', quantite: '20', prixUnitaire: '5000' },
        ],
      })
      .expect(200);
    const soumise = await api('autreDemandeur')
      .post(`/depenses/${id}/soumettre`)
      .expect(201);
    expect(soumise.body.niveauxRequis).toBe(1);
    await api('valideur1').post(`/depenses/${id}/rejeter`, {}).expect(400);
    const rejetee = await api('valideur1')
      .post(`/depenses/${id}/rejeter`, {
        motif: 'Devis trop ancien, à refaire',
      })
      .expect(201);
    expect(rejetee.body.statut).toBe('REJETEE');
    const reprise = await api('autreDemandeur')
      .post(`/depenses/${id}/reprendre`)
      .expect(201);
    expect(reprise.body).toMatchObject({
      statut: 'BROUILLON',
      validation1ParId: null,
    });
    const annulee = await api('autreDemandeur')
      .post(`/depenses/${id}/annuler`, { motif: 'Besoin finalement abandonné' })
      .expect(201);
    expect(annulee.body.statut).toBe('ANNULEE');
  });

  it('enchaîne livraison, facture et paiement sans jamais dépasser', async () => {
    const path = `/depenses/${depenseId}`;
    // Pas de facture tant que la livraison n'est pas constatée.
    const tropTot = await api('comptable')
      .upload(`${path}/facture`, {
        numeroFacture: 'F-1',
        dateFacture: new Date().toISOString(),
        montantFacture: '600000',
      })
      .expect(403);
    expect(tropTot.body.message).toMatch(/livraison/);

    // Livraison non conforme : consignée, la dépense n'avance pas.
    const refusee = await api('demandeur')
      .upload(`${path}/reception`, {
        numeroBonLivraison: 'BL-1',
        dateReception: new Date().toISOString(),
        conforme: 'false',
        commentaire: 'Cinq chaises cassées à la livraison',
      })
      .expect(201);
    expect(refusee.body).toMatchObject({
      statut: 'VALIDEE',
      receptionConforme: false,
    });
    const recue = await api('comptable')
      .upload(`${path}/reception`, {
        numeroBonLivraison: 'BL-2',
        dateReception: new Date().toISOString(),
        conforme: 'true',
      })
      .expect(201);
    expect(recue.body.statut).toBe('RECEPTIONNEE');

    // La facture ne dépasse pas le montant validé.
    await api('comptable')
      .upload(`${path}/facture`, {
        numeroFacture: 'F-1',
        dateFacture: new Date().toISOString(),
        montantFacture: '700000',
      })
      .expect(400);
    const facturee = await api('comptable')
      .upload(`${path}/facture`, {
        numeroFacture: 'F-1',
        dateFacture: new Date().toISOString(),
        montantFacture: '580000',
      })
      .expect(201);
    expect(facturee.body).toMatchObject({
      statut: 'FACTUREE',
      resteAPayer: '580000.00',
    });

    const paiement = (montant: string, mode = 'ESPECES', reference = '') => ({
      montant,
      mode,
      reference,
      datePaiement: new Date().toISOString(),
    });
    // Un valideur de la dépense ne la paie pas, même s'il a le rôle de payeur.
    const juge = await api('valideur1')
      .upload(`${path}/decaissements`, paiement('100000'), false)
      .expect(403);
    expect(juge.body.message).toMatch(/validée/);
    // Un virement sans référence est refusé.
    await api('comptable')
      .upload(`${path}/decaissements`, paiement('100000', 'VIREMENT'), false)
      .expect(400);

    const partiel = await api('comptable')
      .upload(`${path}/decaissements`, paiement('300000'), false)
      .expect(201);
    expect(partiel.body.statut).toBe('PAYEE_PARTIELLEMENT');
    await api('comptable')
      .upload(`${path}/decaissements`, paiement('300000'), false)
      .expect(400);
    const solde = await api('comptable')
      .upload(
        `${path}/decaissements`,
        paiement('280000', 'VIREMENT', 'VIR-889'),
      )
      .expect(201);
    expect(solde.body).toMatchObject({
      statut: 'PAYEE',
      totalPaye: '580000.00',
      resteAPayer: '0.00',
    });
    expect(solde.body.decaissements).toHaveLength(2);
    expect(solde.body.decaissements[1].numero).toMatch(/^DEC-\d{4}-0002$/);
    expect(solde.body.historique.length).toBeGreaterThanOrEqual(8);

    // Une dépense payée ne s'annule plus.
    await api('valideur2')
      .post(`${path}/annuler`, { motif: 'Tentative après paiement' })
      .expect(403);
  });

  it('reflète la dépense dans le suivi budgétaire', async () => {
    const budget = await api('gestionnaire').get('/finances/budget');
    const ligne = (budget.body.lignes as Body[]).find(
      (item) => item.categorieId === categorieId,
    );
    expect(ligne).toMatchObject({
      budget: '1000000.00',
      reserve: '0.00',
      engage: '0.00',
      paye: '580000.00',
      disponible: '420000.00',
      taux: 58,
    });
    // Le budget ne descend pas sous ce qui est déjà consommé.
    await api('gestionnaire')
      .put('/finances/budget', {
        exerciceId: budget.body.exercice.id,
        categorieId,
        montant: '500000',
      })
      .expect(409);
  });

  it('ne compte pas ses propres demandes parmi celles à valider', async () => {
    const created = await api('chefService')
      .post('/depenses', demande('1'))
      .expect(201);
    const path = `/depenses/${created.body.id}`;
    await api('chefService')
      .upload(`${path}/pieces`, { type: 'LETTRE_DEMANDE' })
      .expect(201);
    await api('chefService')
      .upload(`${path}/pieces`, { type: 'DEVIS' })
      .expect(201);
    const brouillon = await api('chefService').get('/depenses/compteurs');
    expect(brouillon.body).toMatchObject({ brouillons: 1, aValider: 0 });

    await api('chefService').post(`${path}/soumettre`).expect(201);
    // Son propre état de besoin n'apparaît pas dans son travail à faire...
    const chef = await api('chefService').get('/depenses/compteurs');
    expect(chef.body).toMatchObject({ brouillons: 0, aValider: 0 });
    await api('chefService').post(`${path}/valider`).expect(403);
    // ... mais bien dans celui d'un autre valideur.
    const autre = await api('valideur1').get('/depenses/compteurs');
    expect(autre.body.aValider).toBe(1);
  });
});
