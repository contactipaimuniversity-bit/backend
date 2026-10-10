import { PrismaService } from '../prisma/prisma.service';
import { PaiementsService } from './paiements.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

function buildService(alreadyPaid: string | null = null) {
  const createMock = jest.fn().mockResolvedValue({ id: 'paiement-id' });
  const prisma: PrismaService = {
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
    sequenceNumero: { upsert: jest.fn().mockResolvedValue({ valeur: 7 }) },
    $executeRaw: jest.fn(),
    $transaction: (run: (client: unknown) => unknown) => run(prisma),
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
          modePaiement: 'ESPECES',
          numeroRecu: `RC-${new Date().getUTCFullYear()}-000007`,
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

  it('rejects an unknown payment mode', async () => {
    const { service, createMock } = buildService();

    await expect(
      service.create({
        elementDossierId: 'element-id',
        montant: 1000,
        typePaiement: 'FRAIS_INSCRIPTION',
        modePaiement: 'TROC',
      }),
    ).rejects.toThrow('modePaiement');
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

function buildCancelService(
  paiement: Record<string, unknown> | null,
  encaisse = '30000.00',
) {
  const createMock = jest.fn().mockImplementation(({ data }) => ({
    id: 'annulation-id',
    datePaiement: new Date(),
    demandeBourse: null,
    inscription: { filiere: 'Informatique', personne: null },
    elementDossier: null,
    echeance: null,
    ...(data as Record<string, unknown>),
  }));
  const transaction = {
    paiement: {
      findUnique: jest.fn().mockResolvedValue(paiement),
      aggregate: jest.fn().mockResolvedValue({ _sum: { montant: encaisse } }),
      create: createMock,
    },
    $executeRaw: jest.fn(),
  };
  const prisma = {
    $transaction: (run: (client: typeof transaction) => unknown) =>
      run(transaction),
  } as unknown as PrismaService;
  return { service: new PaiementsService(prisma), createMock };
}

const encaissement = {
  id: 'paiement-id',
  demandeBourseId: null,
  inscriptionId: 'inscription-id',
  echeanceId: null,
  elementDossierId: 'element-id',
  montant: '30000.00',
  typePaiement: 'FRAIS_INSCRIPTION',
  annulation: null,
};

describe('PaiementsService.annuler', () => {
  it('neutralises the payment with a signed negative line on the same obligation', async () => {
    const { service, createMock } = buildCancelService(encaissement);

    const result = await service.annuler(
      'paiement-id',
      { motif: 'Saisi sur le mauvais étudiant' },
      'Awa Koné',
    );

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          montant: '-30000.00',
          typePaiement: 'ANNULATION',
          elementDossierId: 'element-id',
          annulePaiementId: 'paiement-id',
          saisiParNom: 'Awa Koné',
        }) as unknown,
      }),
    );
    expect(result.annulePaiementId).toBe('paiement-id');
  });

  it('requires a reason', async () => {
    const { service, createMock } = buildCancelService(encaissement);

    await expect(
      service.annuler('paiement-id', { motif: ' no ' }, 'Awa Koné'),
    ).rejects.toThrow('motif');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('refuses to cancel the same payment twice', async () => {
    const { service, createMock } = buildCancelService({
      ...encaissement,
      annulation: { id: 'annulation-id' },
    });

    await expect(
      service.annuler('paiement-id', { motif: 'Erreur de saisie' }, 'Awa Koné'),
    ).rejects.toThrow('déjà annulé');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('refuses to cancel a refund, a carry-over or a cancellation', async () => {
    const { service, createMock } = buildCancelService({
      ...encaissement,
      typePaiement: 'REMBOURSEMENT',
    });

    await expect(
      service.annuler('paiement-id', { motif: 'Erreur de saisie' }, 'Awa Koné'),
    ).rejects.toThrow('Seul un encaissement');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('refuses when part of the payment was already refunded or carried over', async () => {
    const { service, createMock } = buildCancelService(
      encaissement,
      '20000.00',
    );

    await expect(
      service.annuler('paiement-id', { motif: 'Erreur de saisie' }, 'Awa Koné'),
    ).rejects.toThrow('reportée ou remboursée');
    expect(createMock).not.toHaveBeenCalled();
  });
});
