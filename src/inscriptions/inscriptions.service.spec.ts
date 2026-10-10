import { PrismaService } from '../prisma/prisma.service';
import { InscriptionsService } from './inscriptions.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('InscriptionsService.create', () => {
  it('rejects an invalid initial payment before creating any records', async () => {
    const transaction = {
      elementRequis: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'frais-id',
            nom: 'Frais',
            montantAttendu: 10000,
            elementSubstitutId: null,
          },
        ]),
      },
      personne: { create: jest.fn() },
      inscription: { create: jest.fn() },
      paiement: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new InscriptionsService(prisma);

    await expect(
      service.create(
        {
          nouvellePersonne: { nom: 'Diallo', prenom: 'Awa' },
          anneeScolaire: '2026-2027',
          niveau: 'Première année',
          filiere: 'Informatique',
          preparation: {
            montant: '7O00',
            typePaiement: 'FRAIS_DEPOT',
            elementId: 'frais-id',
          },
        },
        'agent-id',
      ),
    ).rejects.toThrow('nombre positif');

    expect(transaction.elementRequis.findMany).toHaveBeenCalledWith({
      where: {
        contexte: { in: ['INSCRIPTION_DIRECTE', 'TOUS'] },
        niveauApplicable: { in: ['PREMIERE_ANNEE', 'TOUS'] },
      },
    });
    expect(transaction.personne.create).not.toHaveBeenCalled();
    expect(transaction.inscription.create).not.toHaveBeenCalled();
    expect(transaction.paiement.create).not.toHaveBeenCalled();
  });

  it('rejects a deposit payment type on an enrollment', async () => {
    const transaction = {
      elementRequis: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'fee-id', nom: 'Frais L1', montantAttendu: 30000 },
          ]),
      },
      personne: { create: jest.fn() },
      inscription: { create: jest.fn() },
      paiement: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new InscriptionsService(prisma);

    await expect(
      service.create(
        {
          nouvellePersonne: { nom: 'Diallo', prenom: 'Awa' },
          anneeScolaire: '2026-2027',
          niveau: 'L1',
          filiere: 'Informatique',
          preparation: {
            montant: '5000',
            typePaiement: 'FRAIS_DEPOT',
            elementId: 'fee-id',
          },
        },
        'agent-id',
      ),
    ).rejects.toThrow(
      "Une inscription ne peut être réglée qu'en frais d'inscription",
    );
    expect(transaction.personne.create).not.toHaveBeenCalled();
    expect(transaction.inscription.create).not.toHaveBeenCalled();
    expect(transaction.paiement.create).not.toHaveBeenCalled();
  });

  it('derives the person from the scholarship dossier and uses the exact L2 catalog', async () => {
    const transaction = {
      elementRequis: { findMany: jest.fn().mockResolvedValue([]) },
      inscription: {
        create: jest.fn().mockResolvedValue({ id: 'enrollment-id' }),
      },
    };
    const prisma = {
      demandeBourse: {
        findUnique: jest.fn().mockResolvedValue({
          personneId: 'person-from-dossier',
          statut: 'ACCEPTEE',
        }),
      },
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new InscriptionsService(prisma);

    await service.create(
      {
        anneeScolaire: '2026-2027',
        niveau: 'L2',
        filiere: 'Informatique',
        viaBourse: true,
        demandeBourseId: 'scholarship-id',
      },
      'agent-id',
    );

    expect(transaction.elementRequis.findMany).toHaveBeenCalledWith({
      where: {
        contexte: { in: ['INSCRIPTION_DIRECTE', 'TOUS'] },
        niveauApplicable: {
          in: ['DEUXIEME_ANNEE', 'DEUXIEME_ANNEE_PLUS', 'TOUS'],
        },
      },
    });
    expect(transaction.inscription.create).toHaveBeenCalledTimes(1);
    const [[createCall]] = transaction.inscription.create.mock.calls as [
      [
        {
          data: {
            personneId: string;
            viaBourse: boolean;
            demandeBourseId: string;
            niveau: string;
          };
        },
      ],
    ];
    expect(createCall.data).toMatchObject({
      personneId: 'person-from-dossier',
      viaBourse: true,
      demandeBourseId: 'scholarship-id',
      niveau: 'L2',
    });
  });

  it('rejects enrollment levels other than L1 or L2', async () => {
    const transactionMock = jest.fn();
    const prisma = {
      $transaction: transactionMock,
    } as unknown as PrismaService;
    const service = new InscriptionsService(prisma);

    await expect(
      service.create(
        {
          nouvellePersonne: { nom: 'Diallo', prenom: 'Awa' },
          anneeScolaire: '2026-2027',
          niveau: 'Troisième année',
          filiere: 'Informatique',
        },
        'agent-id',
      ),
    ).rejects.toThrow('niveau doit etre L1 ou L2');
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe('InscriptionsService.update', () => {
  it('updates the status of an enrollment linked to a pending scholarship request', async () => {
    const updateMock = jest.fn().mockResolvedValue({ id: 'inscription-id' });
    const demandeFindUnique = jest.fn();
    const prisma = {
      inscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'inscription-id',
          personneId: 'personne-id',
          viaBourse: true,
          demandeBourseId: 'demande-id',
        }),
        update: updateMock,
      },
      demandeBourse: { findUnique: demandeFindUnique },
    } as unknown as PrismaService;
    const service = new InscriptionsService(prisma);

    await service.update('inscription-id', { statut: 'COMPLETE' });

    expect(demandeFindUnique).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { statut: 'COMPLETE' } }),
    );
  });
});
