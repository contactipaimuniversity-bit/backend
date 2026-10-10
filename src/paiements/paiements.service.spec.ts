import { PrismaService } from '../prisma/prisma.service';
import { PaiementsService } from './paiements.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

function buildService(alreadyPaid: string | null = null) {
  const createMock = jest.fn().mockResolvedValue({ id: 'paiement-id' });
  const prisma = {
    elementDossier: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'element-id',
        demandeBourseId: null,
        inscriptionId: 'inscription-id',
        montantAttendu: '30000.00',
      }),
    },
    inscription: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'inscription-id', demandeBourse: null }),
    },
    paiement: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { montant: alreadyPaid } }),
      create: createMock,
    },
  } as unknown as PrismaService;
  return { service: new PaiementsService(prisma), createMock };
}

describe('PaiementsService.create', () => {
  it('accepts a partial payment within the remaining amount', async () => {
    const { service, createMock } = buildService('10000.00');

    await service.create({
      elementDossierId: 'element-id',
      montant: '20000,00',
      typePaiement: 'FRAIS_INSCRIPTION',
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inscriptionId: 'inscription-id',
          elementDossierId: 'element-id',
          montant: '20000.00',
        }) as unknown,
      }),
    );
  });

  it('rejects a payment above the remaining amount of the obligation', async () => {
    const { service, createMock } = buildService('10000.00');

    await expect(
      service.create({
        elementDossierId: 'element-id',
        montant: '20000.01',
        typePaiement: 'FRAIS_INSCRIPTION',
      }),
    ).rejects.toThrow('depasse le montant restant');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects a deposit fee on an enrollment', async () => {
    const { service, createMock } = buildService();

    await expect(
      service.create({
        inscriptionId: 'inscription-id',
        montant: 5000,
        typePaiement: 'FRAIS_DEPOT',
      }),
    ).rejects.toThrow('frais de dépôt');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects an amount above the storable limit', async () => {
    const { service } = buildService();

    await expect(
      service.create({
        inscriptionId: 'inscription-id',
        montant: '100000000',
        typePaiement: 'FRAIS_INSCRIPTION',
      }),
    ).rejects.toThrow('limite');
  });
});
