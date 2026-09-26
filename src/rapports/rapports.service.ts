import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RapportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dossiersIncomplets() {
    const [demandes, inscriptions] = await Promise.all([
      this.prisma.demandeBourse.findMany({
        where: {
          elementsDossier: {
            some: { statut: { in: ['ATTENDU', 'MANQUANT'] } },
          },
        },
        include: {
          personne: true,
          elementsDossier: {
            where: { statut: { in: ['ATTENDU', 'MANQUANT'] } },
            include: { elementRequis: true },
          },
        },
        orderBy: { dateDepot: 'asc' },
      }),
      this.prisma.inscription.findMany({
        where: {
          elementsDossier: {
            some: { statut: { in: ['ATTENDU', 'MANQUANT'] } },
          },
        },
        include: {
          personne: true,
          elementsDossier: {
            where: { statut: { in: ['ATTENDU', 'MANQUANT'] } },
            include: { elementRequis: true },
          },
        },
        orderBy: { dateInscription: 'asc' },
      }),
    ]);

    return {
      total: demandes.length + inscriptions.length,
      dossiers: [
        ...demandes.map((demande) => ({
          dossierType: 'demande-bourse',
          dossierId: demande.id,
          personne: demande.personne,
          dossier: demande,
          elementsManquants: demande.elementsDossier,
        })),
        ...inscriptions.map((inscription) => ({
          dossierType: 'inscription',
          dossierId: inscription.id,
          personne: inscription.personne,
          dossier: inscription,
          elementsManquants: inscription.elementsDossier,
        })),
      ],
    };
  }

  async paiementsEnRetard() {
    const now = new Date();
    const echeances = await this.prisma.echeanceBourse.findMany({
      where: {
        dateEcheance: { lt: now },
        montantAttendu: { not: null },
      },
      include: {
        typeBourse: true,
        paiements: {
          include: { demandeBourse: true, inscription: true },
        },
      },
      orderBy: { dateEcheance: 'asc' },
    });

    const retards = echeances
      .map((echeance) => {
        const montantAttendu = Number(echeance.montantAttendu ?? 0);
        const montantPaye = echeance.paiements.reduce(
          (total, paiement) => total + Number(paiement.montant),
          0,
        );
        const resteAPayer = this.roundMoney(montantAttendu - montantPaye);

        return {
          echeance,
          montantAttendu: this.money(montantAttendu),
          montantPaye: this.money(montantPaye),
          resteAPayer: this.money(resteAPayer),
          dossiers: echeance.paiements.map((paiement) => ({
            demandeBourseId: paiement.demandeBourseId,
            inscriptionId: paiement.inscriptionId,
          })),
        };
      })
      .filter((retard) => Number(retard.resteAPayer) > 0);

    return { total: retards.length, echeances: retards };
  }

  async synthese() {
    const [prospectsActifs, demandesEnCours, inscriptions, paiements] =
      await Promise.all([
        this.prisma.prospect.count({
          where: { statutRelance: { in: ['A_RELANCER', 'RELANCE'] } },
        }),
        this.prisma.demandeBourse.count({
          where: {
            statut: { in: ['EN_ATTENTE', 'ENTRETIEN_PROGRAMME', 'EN_DELIBERATION'] },
          },
        }),
        this.prisma.inscription.findMany({
          select: {
            id: true,
            demandeBourse: {
              select: { typeBourse: { select: { id: true, nom: true } } },
            },
          },
        }),
        this.prisma.paiement.aggregate({ _sum: { montant: true } }),
      ]);

    const inscriptionsParType = new Map<
      string,
      { typeBourseId: string | null; typeBourse: string; total: number }
    >();

    for (const inscription of inscriptions) {
      const typeBourse = inscription.demandeBourse?.typeBourse;
      const key = typeBourse?.id ?? 'DIRECTE';
      const existing = inscriptionsParType.get(key);
      if (existing) {
        existing.total += 1;
      } else {
        inscriptionsParType.set(key, {
          typeBourseId: typeBourse?.id ?? null,
          typeBourse: typeBourse?.nom ?? 'INSCRIPTION_DIRECTE',
          total: 1,
        });
      }
    }

    return {
      prospectsActifs,
      demandesEnCours,
      inscriptionsTotal: inscriptions.length,
      inscriptionsParType: Array.from(inscriptionsParType.values()).sort(
        (first, second) => first.typeBourse.localeCompare(second.typeBourse),
      ),
      totalEncaisse: this.money(Number(paiements._sum.montant ?? 0)),
    };
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private money(value: number): string {
    return this.roundMoney(value).toFixed(2);
  }
}
