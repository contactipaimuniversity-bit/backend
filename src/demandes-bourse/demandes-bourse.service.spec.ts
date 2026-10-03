import { PrismaService } from '../prisma/prisma.service';
import { DemandesBourseService } from './demandes-bourse.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('DemandesBourseService.create', () => {
  it('rejects an invalid initial payment before creating any records', async () => {
    const transaction = {
      elementRequis: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'frais-id', nom: 'Frais', montantAttendu: 10000, elementSubstitutId: null },
        ]),
      },
      personne: { create: jest.fn() },
      demandeBourse: { create: jest.fn() },
      paiement: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    } as unknown as PrismaService;
    const service = new DemandesBourseService(prisma);

    await expect(service.create({
      nouvellePersonne: { nom: 'Diallo', prenom: 'Awa' },
      niveauDemande: 'PREMIERE_ANNEE',
      filiereSouhaitee: 'Informatique',
      preparation: {
        montant: '7O00',
        typePaiement: 'FRAIS_DEPOT',
        elementId: 'frais-id',
      },
    }, 'agent-id')).rejects.toThrow('nombre positif');

    expect(transaction.personne.create).not.toHaveBeenCalled();
    expect(transaction.demandeBourse.create).not.toHaveBeenCalled();
    expect(transaction.paiement.create).not.toHaveBeenCalled();
  });
});