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
      include: {
        elementSubstitut: true,
        _count: { select: { elementsDossier: true } },
      },
      orderBy: [{ categorie: 'asc' }, { nom: 'asc' }],
    });
  });
});

describe('ElementsRequisService.remove', () => {
  const setup = () => {
    const transaction = {
      elementRequis: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'element-id',
          nom: 'FRAIS INSCRIPTION',
          elementsDossier: [
            { id: 'dossier-element', paiements: [{ id: 'paiement-id' }] },
          ],
          substituePour: [],
          utiliseCommeSubstitutDans: [],
        }),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      utilisateur: { findUnique: jest.fn().mockResolvedValue(null) },
      elementCorbeille: { create: jest.fn() },
      paiement: { updateMany: jest.fn() },
      elementDossier: { deleteMany: jest.fn(), updateMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    return { transaction, service: new ElementsRequisService(prisma) };
  };

  it('requires a reason before moving an element to the trash', async () => {
    const { transaction, service } = setup();

    await expect(service.remove('element-id', 'non', 'user')).rejects.toThrow(
      'motif',
    );
    expect(transaction.elementRequis.delete).not.toHaveBeenCalled();
  });

  it('archives a used element, removes it from dossiers and keeps its payments unassigned', async () => {
    const { transaction, service } = setup();

    await expect(
      service.remove('element-id', 'Doublon du frais L2', 'user'),
    ).resolves.toEqual({ id: 'element-id', dossiersConcernes: 1 });

    expect(transaction.elementCorbeille.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'ELEMENT_REQUIS',
        libelle: 'FRAIS INSCRIPTION',
        motif: 'Doublon du frais L2',
        donnees: expect.objectContaining({
          elementsDossier: [
            { id: 'dossier-element', paiementIds: ['paiement-id'] },
          ],
        }),
      }),
    });
    expect(transaction.paiement.updateMany).toHaveBeenCalledWith({
      where: { elementDossierId: { in: ['dossier-element'] } },
      data: { elementDossierId: null },
    });
    expect(transaction.elementDossier.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['dossier-element'] } },
    });
    expect(transaction.elementRequis.delete).toHaveBeenCalledWith({
      where: { id: 'element-id' },
    });
  });
});
