import { PrismaService } from '../prisma/prisma.service';
import { RapportsService } from './rapports.service';

describe('suivi du recouvrement', () => {
  const personne = {
    nom: 'Koffi',
    prenom: 'Ama',
    telephone: null,
    matricule: 'ETU-001',
  };
  const dossierBourse = {
    id: 'bourse-1',
    dateDepot: new Date('2026-01-10'),
    statut: 'ACCEPTEE',
    niveauDemande: 'PREMIERE_ANNEE',
    filiereSouhaitee: 'Comptabilité',
    personne,
    inscriptions: [
      {
        anneeScolaire: '2026-2027',
        paiements: [{ montant: '5.00', typePaiement: 'ECHEANCE_BOURSE' }],
      },
    ],
    typeBourse: { echeances: [{ montantAttendu: '50.00' }] },
    elementsDossier: [
      {
        montantAttendu: '100.00',
        paiements: [
          { montant: '30.00', typePaiement: 'FRAIS_DEPOT' },
          { montant: '-5.00', typePaiement: 'REMBOURSEMENT' },
        ],
      },
    ],
    paiements: [{ montant: '10.00', typePaiement: 'FRAIS_DEPOT' }],
  };
  const inscription = {
    id: 'inscription-1',
    dateInscription: new Date('2026-09-01'),
    statut: 'EN_COURS',
    anneeScolaire: '2026-2027',
    niveau: 'L1',
    filiere: 'Comptabilité',
    personne,
    elementsDossier: [
      {
        montantAttendu: '80.00',
        paiements: [{ montant: '20.00', typePaiement: 'REPORT' }],
      },
    ],
    paiements: [{ montant: '10.00', typePaiement: 'FRAIS_INSCRIPTION' }],
  };

  let service: RapportsService;

  beforeEach(() => {
    const prisma = {
      demandeBourse: { findMany: jest.fn().mockResolvedValue([dossierBourse]) },
      inscription: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([inscription])
          .mockResolvedValueOnce([{ anneeScolaire: '2026-2027' }]),
      },
    };
    service = new RapportsService(prisma as unknown as PrismaService);
  });

  it('sépare les encaissements des paiements affectés et calcule les dettes', async () => {
    const result = await service.recouvrement({});

    expect(result.totaux).toEqual({
      dossiers: 2,
      attendu: '230.00',
      paye: '70.00',
      encaisse: '50.00',
      resteAPayer: '160.00',
    });
    expect(result.parType.bourses).toMatchObject({
      dossiers: 1,
      paye: '40.00',
      encaisse: '40.00',
      resteAPayer: '110.00',
    });
    expect(result.parType.inscriptions).toMatchObject({
      dossiers: 1,
      paye: '30.00',
      encaisse: '10.00',
      resteAPayer: '50.00',
    });
    expect(result.data.find((row) => row.type === 'INSCRIPTION')?.etat).toBe(
      'DETTE',
    );
  });

  it('filtre par type, année scolaire, situation et texte, sans casser les totaux', async () => {
    const result = await service.recouvrement({
      type: 'INSCRIPTION',
      anneeScolaire: '2026-2027',
      statut: 'DETTE',
      q: 'etu-001',
    });

    expect(result.meta.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      id: 'inscription-1',
      type: 'INSCRIPTION',
      etat: 'DETTE',
    });
    expect(result.totaux).toMatchObject({
      dossiers: 1,
      encaisse: '10.00',
      resteAPayer: '50.00',
    });
  });
});
