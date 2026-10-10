import { PrismaService } from '../prisma/prisma.service';
import { ProspectsService } from './prospects.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('ProspectsService.createRelance', () => {
  it('stores the note and updates the prospect status in one transaction', async () => {
    const relance = { id: 'relance-id', commentaire: 'Rappeler en novembre' };
    const prospectUpdateMock = jest.fn().mockResolvedValue({});
    const transaction = {
      prospect: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'prospect-id',
          statutRelance: 'A_RELANCER',
        }),
        update: prospectUpdateMock,
      },
      utilisateur: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-id',
          nom: 'Diallo',
          prenom: 'Awa',
        }),
      },
      prospectRelance: {
        create: jest.fn().mockResolvedValue(relance),
      },
    };
    const transactionMock = jest.fn(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const prisma = {
      $transaction: transactionMock,
    } as unknown as PrismaService;
    const service = new ProspectsService(prisma);

    await expect(
      service.createRelance(
        'prospect-id',
        {
          commentaire: 'Rappeler en novembre',
          intention: 'Intéressé pour la prochaine rentrée',
          statutRelance: 'RELANCE',
          dateProchaineRelance: '2026-11-01',
        },
        'user-id',
      ),
    ).resolves.toBe(relance);

    expect(transaction.prospectRelance.create).toHaveBeenCalledWith({
      data: {
        prospectId: 'prospect-id',
        utilisateurId: 'user-id',
        utilisateurNom: 'Awa Diallo',
        commentaire: 'Rappeler en novembre',
        intention: 'Intéressé pour la prochaine rentrée',
        statutRelance: 'RELANCE',
        dateProchaineRelance: new Date('2026-11-01'),
      },
    });
    expect(prospectUpdateMock).toHaveBeenCalledWith({
      where: { id: 'prospect-id' },
      data: {
        statutRelance: 'RELANCE',
        intention: 'Intéressé pour la prochaine rentrée',
      },
    });
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty note before starting a transaction', async () => {
    const transactionMock = jest.fn();
    const prisma = {
      $transaction: transactionMock,
    } as unknown as PrismaService;
    const service = new ProspectsService(prisma);

    await expect(
      service.createRelance('prospect-id', { commentaire: '  ' }, 'user-id'),
    ).rejects.toThrow('commentaire est obligatoire');
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
