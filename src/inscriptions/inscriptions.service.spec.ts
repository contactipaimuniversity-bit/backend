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
          { id: 'frais-id', nom: 'Frais', montantAttendu: 10000, elementSubstitutId: null },
        ]),
      },
      personne: { create: jest.fn() },
      inscription: { create: jest.fn() },
      paiement: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    } as unknown as PrismaService;
    const service = new InscriptionsService(prisma);

    await expect(service.create({
      nouvellePersonne: { nom: 'Diallo', prenom: 'Awa' },
      anneeScolaire: '2026-2027',
      niveau: 'Première année',
      filiere: 'Informatique',
      preparation: {
        montant: '7O00',
        typePaiement: 'FRAIS_DEPOT',
        elementId: 'frais-id',
      },
    }, 'agent-id')).rejects.toThrow('nombre positif');

    expect(transaction.personne.create).not.toHaveBeenCalled();
    expect(transaction.inscription.create).not.toHaveBeenCalled();
    expect(transaction.paiement.create).not.toHaveBeenCalled();
  });
});