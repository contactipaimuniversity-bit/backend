import { PrismaService } from '../prisma/prisma.service';
import { TypesBourseService } from './types-bourse.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('TypesBourseService.remove', () => {
  it('refuses to delete a scholarship type linked to applications', async () => {
    const deleteType = jest.fn();
    const deleteSchedules = jest.fn();
    const transaction = {
      typeBourse: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'type-id',
          demandesBourse: [{ id: 'application-id' }],
          echeances: [],
        }),
        delete: deleteType,
      },
      echeanceBourse: { deleteMany: deleteSchedules },
      paiement: { count: jest.fn().mockResolvedValue(0) },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new TypesBourseService(prisma);

    await expect(service.remove('type-id')).rejects.toThrow('déjà lié');
    expect(deleteSchedules).not.toHaveBeenCalled();
    expect(deleteType).not.toHaveBeenCalled();
  });

  it('deletes unused schedule entries before deleting an unused scholarship type', async () => {
    const deleted = { id: 'type-id' };
    const deleteType = jest.fn().mockResolvedValue(deleted);
    const deleteSchedules = jest.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      typeBourse: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'type-id',
          demandesBourse: [],
          echeances: [{ id: 'schedule-id' }],
        }),
        delete: deleteType,
      },
      echeanceBourse: { deleteMany: deleteSchedules },
      paiement: { count: jest.fn().mockResolvedValue(0) },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new TypesBourseService(prisma);

    await expect(service.remove('type-id')).resolves.toBe(deleted);
    expect(deleteSchedules).toHaveBeenCalledWith({
      where: { typeBourseId: 'type-id' },
    });
    expect(deleteType).toHaveBeenCalledWith({ where: { id: 'type-id' } });
  });
});
