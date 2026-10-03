import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PeriodeRapportDto } from './dto/periode-rapport.dto';

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
    const [prospectsActifs, demandesEnCours, inscriptions, paiements, demandesDates, inscriptionsDates, obligations] =
      await Promise.all([
        this.prisma.prospect.count({
          where: { statutRelance: { in: ['A_RELANCER', 'RELANCE'] } },
        }),
        this.prisma.demandeBourse.count({
          where: {
            statut: {
              in: ['EN_ATTENTE', 'ENTRETIEN_PROGRAMME', 'EN_DELIBERATION'],
            },
          },
        }),
        this.prisma.inscription.findMany({
          select: {
            id: true,
            demandeBourseId: true,
            demandeBourse: {
              select: { typeBourse: { select: { id: true, nom: true } } },
            },
          },
        }),
        this.prisma.paiement.aggregate({ _sum: { montant: true } }),
        this.prisma.demandeBourse.findMany({ select: { dateDepot: true } }),
        this.prisma.inscription.findMany({ select: { dateInscription: true } }),
        this.prisma.elementDossier.findMany({
          select: { montantAttendu: true, demandeBourseId: true, inscriptionId: true, paiements: { select: { montant: true } } },
        }),
      ]);

    const resteBourses = obligations
      .filter((element) => element.demandeBourseId)
      .reduce((total, element) => total + Math.max(0, Number(element.montantAttendu ?? 0) - element.paiements.reduce((sum, payment) => sum + Number(payment.montant), 0)), 0);
    const resteInscriptions = obligations
      .filter((element) => element.inscriptionId)
      .reduce((total, element) => total + Math.max(0, Number(element.montantAttendu ?? 0) - element.paiements.reduce((sum, payment) => sum + Number(payment.montant), 0)), 0);
    const now = new Date();
    const tendance = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
      const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
      const inMonth = (value: Date) => value >= date && value < next;
      return {
        label: new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' }).format(date),
        demandes: demandesDates.filter((item) => inMonth(item.dateDepot)).length,
        inscriptions: inscriptionsDates.filter((item) => inMonth(item.dateInscription)).length,
      };
    });

    const inscriptionsParType = new Map<
      string,
      { typeBourseId: string | null; typeBourse: string; total: number; inscrits: number; acceptesEnAttente: number }
    >();

    for (const inscription of inscriptions) {
      const typeBourse = inscription.demandeBourse?.typeBourse;
      const key = typeBourse?.id ?? 'DIRECTE';
      const existing = inscriptionsParType.get(key);
      if (existing) {
        existing.total += 1;
        existing.inscrits += 1;
      } else {
        inscriptionsParType.set(key, {
          typeBourseId: typeBourse?.id ?? null,
          typeBourse: typeBourse?.nom ?? 'INSCRIPTION_DIRECTE',
          total: 1,
          inscrits: 1,
          acceptesEnAttente: 0,
        });
      }
    }

    const demandesDejaInscrites = new Set(
      inscriptions.flatMap((inscription) => inscription.demandeBourseId ? [inscription.demandeBourseId] : []),
    );
    const demandesAcceptees = await this.prisma.demandeBourse.findMany({
      where: { statut: 'ACCEPTEE', typeBourseId: { not: null } },
      select: { id: true, typeBourseId: true, typeBourse: { select: { id: true, nom: true } } },
    });
    for (const demande of demandesAcceptees) {
      if (demandesDejaInscrites.has(demande.id) || !demande.typeBourse) continue;
      const existing = inscriptionsParType.get(demande.typeBourse.id);
      if (existing) {
        existing.acceptesEnAttente += 1;
      } else {
        inscriptionsParType.set(demande.typeBourse.id, {
          typeBourseId: demande.typeBourse.id,
          typeBourse: demande.typeBourse.nom,
          total: 0,
          inscrits: 0,
          acceptesEnAttente: 1,
        });
      }
    }

    return {
      prospectsActifs,
      demandesEnCours,
      demandesTotal: demandesDates.length,
      effectifsTotal: demandesDates.length + inscriptions.length,
      inscriptionsTotal: inscriptions.length,
      inscriptionsParType: Array.from(inscriptionsParType.values()).sort(
        (first, second) => first.typeBourse.localeCompare(second.typeBourse),
      ),
      totalEncaisse: this.money(Number(paiements._sum.montant ?? 0)),
      resteBourses: this.money(resteBourses),
      resteInscriptions: this.money(resteInscriptions),
      totalResteARecouvrer: this.money(resteBourses + resteInscriptions),
      tendance,
    };
  }

  async activitePeriode(periode: PeriodeRapportDto) {
    const debut = this.parseDate(periode.dateDebut, 'dateDebut');
    const fin = this.parseDate(periode.dateFin, 'dateFin');
    if (fin < debut)
      throw new BadRequestException(
        'La date de fin doit suivre la date de debut',
      );
    const finExclusive = new Date(fin);
    finExclusive.setUTCDate(finExclusive.getUTCDate() + 1);
    const interval = { gte: debut, lt: finExclusive };

    const [paiements, demandes, inscriptions, prospects] = await Promise.all([
      this.prisma.paiement.findMany({
        where: { datePaiement: interval },
        include: {
          demandeBourse: { include: { personne: true } },
          inscription: { include: { personne: true } },
        },
        orderBy: { datePaiement: 'asc' },
      }),
      this.prisma.demandeBourse.findMany({
        where: { dateDepot: interval },
        include: { personne: true },
        orderBy: { dateDepot: 'asc' },
      }),
      this.prisma.inscription.findMany({
        where: { dateInscription: interval },
        include: { personne: true },
        orderBy: { dateInscription: 'asc' },
      }),
      this.prisma.prospect.findMany({
        where: { personne: { is: { dateEnregistrement: interval } } },
        include: { personne: true },
        orderBy: { personne: { dateEnregistrement: 'asc' } },
      }),
    ]);

    return {
      periode: { dateDebut: periode.dateDebut, dateFin: periode.dateFin },
      synthese: {
        nombrePaiements: paiements.length,
        montantEncaisse: this.money(
          paiements.reduce((sum, item) => sum + Number(item.montant), 0),
        ),
        nouvellesDemandes: demandes.length,
        nouvellesInscriptions: inscriptions.length,
        nouveauxProspects: prospects.length,
      },
      paiements: paiements.map((item) => ({
        id: item.id,
        date: item.datePaiement,
        personne: item.demandeBourse?.personne ?? item.inscription?.personne,
        type: item.typePaiement,
        dossier: item.demandeBourseId ? 'Demande de bourse' : 'Inscription',
        montant: this.money(Number(item.montant)),
      })),
      demandes: demandes.map((item) => ({
        id: item.id,
        date: item.dateDepot,
        personne: item.personne,
        filiere: item.filiereSouhaitee,
        statut: item.statut,
      })),
      inscriptions: inscriptions.map((item) => ({
        id: item.id,
        date: item.dateInscription,
        personne: item.personne,
        filiere: item.filiere,
        statut: item.statut,
      })),
      prospects: prospects.map((item) => ({
        id: item.id,
        date: item.personne.dateEnregistrement,
        personne: item.personne,
        filiere: item.filiereSouhaitee,
        statut: item.statutRelance,
      })),
    };
  }

  async activiteJournee(date: string) {
    const report = await this.activitePeriode({ dateDebut: date, dateFin: date });
    const debut = this.parseDate(date, 'date');
    const finExclusive = new Date(debut);
    finExclusive.setUTCDate(finExclusive.getUTCDate() + 1);
    const interval = { gte: debut, lt: finExclusive };
    const [journal, candidatures] = await Promise.all([
      this.prisma.journalActivite.findMany({
        where: { date: interval },
        orderBy: { date: 'desc' },
      }),
      this.prisma.candidaturePersonnel.findMany({
        where: { dateDepot: interval },
        select: { id: true, nom: true, prenom: true, fonction: true, dateDepot: true },
        orderBy: { dateDepot: 'desc' },
      }),
    ]);

    const loggedCreations = new Set(
      journal.filter((event) => event.action.startsWith('Création ·')).flatMap((event) => event.entiteId ? [event.entiteId] : []),
    );
    type DailyActivity = {
      id: string;
      date: Date | string;
      action: string;
      detail: string;
      utilisateur: string | null;
      categorie: string;
      montant?: string;
    };
    const activities: DailyActivity[] = journal.map((event) => ({
      id: event.id,
      date: event.date,
      action: event.action,
      detail: event.entiteId ? `${event.ressource} · ${event.entiteId.slice(0, 8)}` : event.ressource,
      utilisateur: event.utilisateurNom,
      categorie: event.ressource,
    }));
    const addCreation = (event: {
      id: string;
      date: Date | string;
      action: string;
      detail: string;
      categorie: string;
      montant?: string;
    }) => {
      if (loggedCreations.has(event.id)) return;
      activities.push({ ...event, id: `${event.categorie}:${event.id}`, utilisateur: null });
    };

    for (const item of report.paiements) addCreation({
      id: item.id,
      date: item.date,
      action: 'Paiement enregistré',
      detail: `${item.personne?.prenom ?? ''} ${item.personne?.nom ?? ''} · ${item.dossier} · ${item.type}`.trim(),
      categorie: 'Paiement',
      montant: item.montant,
    });
    for (const item of report.demandes) addCreation({
      id: item.id,
      date: item.date,
      action: 'Demande de bourse créée',
      detail: `${item.personne.prenom} ${item.personne.nom} · ${item.filiere}`,
      categorie: 'Demande de bourse',
    });
    for (const item of report.inscriptions) addCreation({
      id: item.id,
      date: item.date,
      action: 'Inscription créée',
      detail: `${item.personne.prenom} ${item.personne.nom} · ${item.filiere}`,
      categorie: 'Inscription',
    });
    for (const item of report.prospects) addCreation({
      id: item.id,
      date: item.date,
      action: 'Prospect créé',
      detail: `${item.personne.prenom} ${item.personne.nom}${item.filiere ? ` · ${item.filiere}` : ''}`,
      categorie: 'Prospect',
    });
    for (const item of candidatures) addCreation({
      id: item.id,
      date: item.dateDepot,
      action: 'Candidature de recrutement déposée',
      detail: `${item.prenom} ${item.nom} · ${item.fonction}`,
      categorie: 'Recrutement',
    });

    activities.sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime());
    const parCategorie = activities.reduce<Record<string, number>>((counts, activity) => {
      counts[activity.categorie] = (counts[activity.categorie] ?? 0) + 1;
      return counts;
    }, {});
    return { date, total: activities.length, parCategorie, activites: activities };
  }

  private parseDate(value: string | undefined, field: string): Date {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${field} doit etre au format AAAA-MM-JJ`);
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(`${field} est invalide`);
    }
    return parsed;
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private money(value: number): string {
    return this.roundMoney(value).toFixed(2);
  }
}
