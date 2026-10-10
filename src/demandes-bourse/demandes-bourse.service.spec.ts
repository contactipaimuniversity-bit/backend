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
          {
            id: 'frais-id',
            nom: 'Frais',
            montantAttendu: 10000,
            elementSubstitutId: null,
          },
        ]),
      },
      personne: { create: jest.fn() },
      demandeBourse: { create: jest.fn() },
      paiement: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new DemandesBourseService(prisma);

    await expect(
      service.create(
        {
          nouvellePersonne: { nom: 'Diallo', prenom: 'Awa' },
          niveauDemande: 'PREMIERE_ANNEE',
          filiereSouhaitee: 'Informatique',
          preparation: {
            montant: '7O00',
            typePaiement: 'FRAIS_DEPOT',
            elementId: 'frais-id',
          },
        },
        'agent-id',
      ),
    ).rejects.toThrow('nombre positif');

    expect(transaction.personne.create).not.toHaveBeenCalled();
    expect(transaction.demandeBourse.create).not.toHaveBeenCalled();
    expect(transaction.paiement.create).not.toHaveBeenCalled();
  });
});

describe('DemandesBourseService.updateEntretien', () => {
  function buildService(current: {
    statut: string;
    dateEntretien: Date | null;
  }) {
    const updateMock = jest.fn().mockResolvedValue({ id: 'demande-id' });
    const prisma = {
      demandeBourse: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: updateMock,
      },
    } as unknown as PrismaService;
    return { service: new DemandesBourseService(prisma), updateMock };
  }

  it('keeps the scheduled date when only the team changes', async () => {
    const { service, updateMock } = buildService({
      statut: 'ENTRETIEN_PROGRAMME',
      dateEntretien: new Date('2026-11-02T09:00:00.000Z'),
    });

    await service.updateEntretien('demande-id', { equipeEntretien: 'Jury B' });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { equipeEntretien: 'Jury B', statut: 'ENTRETIEN_PROGRAMME' },
      }),
    );
  });

  it('refuses to reschedule an interview once the decision is made', async () => {
    const { service, updateMock } = buildService({
      statut: 'ACCEPTEE',
      dateEntretien: null,
    });

    await expect(
      service.updateEntretien('demande-id', {
        dateEntretien: '2026-11-02T09:00',
      }),
    ).rejects.toThrow('après la décision');
    expect(updateMock).not.toHaveBeenCalled();
  });
});
