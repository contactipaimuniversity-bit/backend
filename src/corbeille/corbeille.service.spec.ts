import { PrismaService } from '../prisma/prisma.service';
import { CorbeilleService } from './corbeille.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('CorbeilleService', () => {
  it('restores the archived record before removing its trash entry', async () => {
    const transaction = {
      elementCorbeille: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'trash-id',
          type: 'UTILISATEUR',
          donnees: {
            id: 'user-id',
            nom: 'Admin',
            prenom: 'Awa',
            email: 'awa@example.test',
            role: 'admin',
            motDePasse: 'stored-hash',
          },
        }),
        delete: jest.fn().mockResolvedValue({ id: 'trash-id' }),
      },
      utilisateur: { create: jest.fn().mockResolvedValue({ id: 'user-id' }) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    } as unknown as PrismaService;
    const service = new CorbeilleService(prisma);

    await expect(service.restore('trash-id')).resolves.toEqual({
      id: 'trash-id',
      restaure: true,
    });
    expect(transaction.utilisateur.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ motDePasse: 'stored-hash' }),
    });
    expect(transaction.elementCorbeille.delete).toHaveBeenCalledWith({ where: { id: 'trash-id' } });
  });

  it('does not expose an archived account password hash in details', async () => {
    const entry = {
      id: 'trash-id',
      type: 'UTILISATEUR',
      donnees: { id: 'user-id', nom: 'Admin', motDePasse: 'stored-hash' },
    };
    const prisma = {
      elementCorbeille: { findUnique: jest.fn().mockResolvedValue(entry) },
    } as unknown as PrismaService;
    const service = new CorbeilleService(prisma);

    const result = await service.findOne('trash-id');
    expect(result.donnees).toEqual({ id: 'user-id', nom: 'Admin' });
    expect(result.donnees).not.toHaveProperty('motDePasse');
  });
});