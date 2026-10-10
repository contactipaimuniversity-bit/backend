import { PrismaService } from '../prisma/prisma.service';
import { ElementsRequisService } from './elements-requis.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('ElementsRequisService.findAll', () => {
  it('includes exact L2, L2-plus, and shared reference entries', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      elementRequis: { findMany },
    } as unknown as PrismaService;
    const service = new ElementsRequisService(prisma);

    await service.findAll({
      contexte: 'INSCRIPTION_DIRECTE',
      niveauApplicable: 'DEUXIEME_ANNEE',
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        contexte: { in: ['INSCRIPTION_DIRECTE', 'TOUS'] },
        niveauApplicable: {
          in: ['DEUXIEME_ANNEE', 'DEUXIEME_ANNEE_PLUS', 'TOUS'],
        },
      },
      include: { elementSubstitut: true },
      orderBy: [{ categorie: 'asc' }, { nom: 'asc' }],
    });
  });
});

describe('ElementsRequisService.remove', () => {
  it('refuses to delete an element already copied into dossier records', async () => {
    const deleteElement = jest.fn();
    const transaction = {
      elementRequis: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'element-id',
          _count: {
            elementsDossier: 1,
            utiliseCommeSubstitutDans: 0,
            substituePour: 0,
          },
        }),
        delete: deleteElement,
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new ElementsRequisService(prisma);

    await expect(service.remove('element-id')).rejects.toThrow('déjà utilisé');
    expect(deleteElement).not.toHaveBeenCalled();
  });

  it('deletes an unused element reference', async () => {
    const deleted = { id: 'element-id' };
    const deleteElement = jest.fn().mockResolvedValue(deleted);
    const transaction = {
      elementRequis: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'element-id',
          _count: {
            elementsDossier: 0,
            utiliseCommeSubstitutDans: 0,
            substituePour: 0,
          },
        }),
        delete: deleteElement,
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new ElementsRequisService(prisma);

    await expect(service.remove('element-id')).resolves.toBe(deleted);
    expect(deleteElement).toHaveBeenCalledWith({ where: { id: 'element-id' } });
  });
});
