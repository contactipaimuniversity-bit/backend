import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { resolveEntityLabels } from '../audit/entity-labels';
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
          select: {
            montant: true,
            demandeBourseId: true,
            inscription: { select: { demandeBourseId: true } },
          },
        },
      },
      orderBy: { dateEcheance: 'asc' },
    });
    // Chaque boursier accepté doit l'échéance : le retard se calcule par dossier.
    const boursiers = await this.prisma.demandeBourse.findMany({
      where: {
        statut: 'ACCEPTEE',
        typeBourseId: {
          in: [...new Set(echeances.map((echeance) => echeance.typeBourseId))],
        },
      },
      select: { id: true, typeBourseId: true, personne: true },
    });

    const retards = echeances
      .map((echeance) => {
        const { paiements, ...echeanceSansPaiements } = echeance;
        const montantAttendu = Number(echeance.montantAttendu ?? 0);
        const payeParDemande = new Map<string, number>();
        for (const paiement of paiements) {
          const demandeId =
            paiement.demandeBourseId ?? paiement.inscription?.demandeBourseId;
          if (!demandeId) continue;
          payeParDemande.set(
            demandeId,
            (payeParDemande.get(demandeId) ?? 0) + Number(paiement.montant),
          );
        }
        const concernes = boursiers.filter(
          (demande) => demande.typeBourseId === echeance.typeBourseId,
        );
        const dossiers = concernes.flatMap((demande) => {
          const paye = payeParDemande.get(demande.id) ?? 0;
          const reste = this.roundMoney(montantAttendu - paye);
          return reste > 0
            ? [
                {
                  demandeBourseId: demande.id,
                  personne: demande.personne,
                  montantPaye: this.money(paye),
                  resteAPayer: this.money(reste),
                },
              ]
            : [];
        });
        const montantPaye = concernes.reduce(
          (total, demande) =>
            total +
            Math.min(montantAttendu, payeParDemande.get(demande.id) ?? 0),
          0,
        );

        return {
          echeance: echeanceSansPaiements,
          montantAttendu: this.money(montantAttendu * concernes.length),
          montantPaye: this.money(montantPaye),
          resteAPayer: this.money(
            dossiers.reduce(
              (total, dossier) => total + Number(dossier.resteAPayer),
              0,
            ),
          ),
          dossiers,
        };
      })
      .filter((retard) => Number(retard.resteAPayer) > 0);

    return { total: retards.length, echeances: retards };
  }

  async synthese() {
    const [
      prospectsActifs,
      demandesEnCours,
      inscriptions,
      paiements,
      demandesDates,
      inscriptionsDates,
      obligations,
    ] = await Promise.all([
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
        select: {
          montantAttendu: true,
          demandeBourseId: true,
          inscriptionId: true,
          paiements: { select: { montant: true } },
        },
      }),
    ]);

    const resteBourses = obligations
      .filter((element) => element.demandeBourseId)
      .reduce(
        (total, element) =>
          total +
          Math.max(
            0,
            Number(element.montantAttendu ?? 0) -
              element.paiements.reduce(
                (sum, payment) => sum + Number(payment.montant),
                0,
              ),
          ),
        0,
      );
    const resteInscriptions = obligations
      .filter((element) => element.inscriptionId)
      .reduce(
        (total, element) =>
          total +
          Math.max(
            0,
            Number(element.montantAttendu ?? 0) -
              element.paiements.reduce(
                (sum, payment) => sum + Number(payment.montant),
                0,
              ),
          ),
        0,
      );
    const now = new Date();
    const tendance = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1),
      );
      const next = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
      );
      const inMonth = (value: Date) => value >= date && value < next;
      return {
        label: new Intl.DateTimeFormat('fr-FR', {
          month: 'short',
          timeZone: 'UTC',
        }).format(date),
        demandes: demandesDates.filter((item) => inMonth(item.dateDepot))
          .length,
        inscriptions: inscriptionsDates.filter((item) =>
          inMonth(item.dateInscription),
        ).length,
      };
    });

    const inscriptionsParType = new Map<
      string,
      {
        typeBourseId: string | null;
        typeBourse: string;
        total: number;
        inscrits: number;
        acceptesEnAttente: number;
      }
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
      inscriptions.flatMap((inscription) =>
        inscription.demandeBourseId ? [inscription.demandeBourseId] : [],
      ),
    );
    const demandesAcceptees = await this.prisma.demandeBourse.findMany({
      where: { statut: 'ACCEPTEE', typeBourseId: { not: null } },
      select: {
        id: true,
        typeBourseId: true,
        typeBourse: { select: { id: true, nom: true } },
      },
    });
    for (const demande of demandesAcceptees) {
      if (demandesDejaInscrites.has(demande.id) || !demande.typeBourse)
        continue;
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

    // Effectif = personnes distinctes : quelqu'un qui a une demande de bourse puis
    // une inscription (ou plusieurs dossiers) n'est compté qu'une seule fois.
    const effectifsTotal = await this.prisma.personne.count({
      where: {
        OR: [{ demandesBourse: { some: {} } }, { inscriptions: { some: {} } }],
      },
    });

    return {
      prospectsActifs,
      demandesEnCours,
      demandesTotal: demandesDates.length,
      effectifsTotal,
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

  // Liste de travail de l'accueil : ce qui demande une action aujourd'hui.
  async aFaire() {
    const LIMIT = 5;
    const now = new Date();
    const debutJour = new Date(now);
    debutJour.setHours(0, 0, 0, 0);
    const finJour = new Date(debutJour);
    finJour.setDate(finJour.getDate() + 1);
    const finSemaine = new Date(debutJour);
    finSemaine.setDate(finSemaine.getDate() + 7);
    const manquant: Prisma.ElementDossierWhereInput = {
      statut: { in: ['ATTENDU', 'MANQUANT'] },
    };
    const elementsManquants = { some: manquant };

    const [prospects, entretiens, demandes, inscriptions, obligations] =
      await Promise.all([
        this.prisma.prospect.findMany({
          where: { statutRelance: { in: ['A_RELANCER', 'RELANCE'] } },
          include: {
            personne: true,
            relances: { orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1 },
          },
        }),
        this.prisma.demandeBourse.findMany({
          where: {
            statut: 'ENTRETIEN_PROGRAMME',
            dateEntretien: { gte: debutJour, lt: finSemaine },
          },
          include: { personne: true },
          orderBy: { dateEntretien: 'asc' },
        }),
        this.prisma.demandeBourse.findMany({
          where: {
            statut: { not: 'REFUSEE' },
            elementsDossier: elementsManquants,
          },
          select: {
            id: true,
            dateDepot: true,
            personne: true,
            _count: {
              select: { elementsDossier: { where: manquant } },
            },
          },
          orderBy: { dateDepot: 'asc' },
        }),
        this.prisma.inscription.findMany({
          where: { statut: 'EN_COURS', elementsDossier: elementsManquants },
          select: {
            id: true,
            dateInscription: true,
            personne: true,
            _count: {
              select: { elementsDossier: { where: manquant } },
            },
          },
          orderBy: { dateInscription: 'asc' },
        }),
        this.prisma.elementDossier.findMany({
          where: { montantAttendu: { not: null } },
          select: {
            montantAttendu: true,
            paiements: { select: { montant: true } },
            demandeBourse: {
              select: { id: true, statut: true, personne: true },
            },
            inscription: { select: { id: true, statut: true, personne: true } },
          },
        }),
      ]);

    // Un prospect est à relancer s'il n'a jamais été relancé ou si la date de
    // rappel convenue lors du dernier échange est arrivée.
    const relances = prospects
      .map((prospect) => {
        const derniere = prospect.relances[0];
        const rappel = derniere?.dateProchaineRelance ?? null;
        return { prospect, derniere, rappel };
      })
      .filter(({ prospect, rappel }) =>
        rappel ? rappel < finJour : prospect.statutRelance === 'A_RELANCER',
      )
      .sort(
        (first, second) =>
          (
            first.rappel ?? first.prospect.personne.dateEnregistrement
          ).getTime() -
          (
            second.rappel ?? second.prospect.personne.dateEnregistrement
          ).getTime(),
      );

    const incomplets = [
      ...demandes.map((demande) => ({
        dossierType: 'demande-bourse' as const,
        dossierId: demande.id,
        personne: demande.personne,
        date: demande.dateDepot,
        manquants: demande._count.elementsDossier,
      })),
      ...inscriptions.map((inscription) => ({
        dossierType: 'inscription' as const,
        dossierId: inscription.id,
        personne: inscription.personne,
        date: inscription.dateInscription,
        manquants: inscription._count.elementsDossier,
      })),
    ].sort((first, second) => first.date.getTime() - second.date.getTime());

    const restes = new Map<
      string,
      {
        dossierType: 'demande-bourse' | 'inscription';
        dossierId: string;
        personne: (typeof demandes)[number]['personne'];
        reste: number;
      }
    >();
    for (const obligation of obligations) {
      const dossier = obligation.demandeBourse ?? obligation.inscription;
      if (!dossier) continue;
      if (dossier.statut === 'REFUSEE' || dossier.statut === 'ABANDONNEE')
        continue;
      const reste =
        Number(obligation.montantAttendu ?? 0) -
        obligation.paiements.reduce(
          (total, paiement) => total + Number(paiement.montant),
          0,
        );
      if (reste <= 0) continue;
      const existing = restes.get(dossier.id);
      if (existing) existing.reste += reste;
      else
        restes.set(dossier.id, {
          dossierType: obligation.demandeBourse
            ? 'demande-bourse'
            : 'inscription',
          dossierId: dossier.id,
          personne: dossier.personne,
          reste,
        });
    }
    const impayes = [...restes.values()].sort(
      (first, second) => second.reste - first.reste,
    );

    return {
      relances: {
        total: relances.length,
        items: relances
          .slice(0, LIMIT)
          .map(({ prospect, derniere, rappel }) => ({
            id: prospect.id,
            personne: prospect.personne,
            filiere: prospect.filiereSouhaitee,
            rappel,
            dernierEchange: derniere?.date ?? null,
          })),
      },
      entretiens: {
        total: entretiens.length,
        items: entretiens.slice(0, LIMIT).map((demande) => ({
          dossierType: 'demande-bourse' as const,
          dossierId: demande.id,
          personne: demande.personne,
          date: demande.dateEntretien,
          equipe: demande.equipeEntretien,
        })),
      },
      incomplets: {
        total: incomplets.length,
        items: incomplets.slice(0, LIMIT),
      },
      impayes: {
        total: impayes.length,
        montant: this.money(
          impayes.reduce((total, item) => total + item.reste, 0),
        ),
        items: impayes
          .slice(0, LIMIT)
          .map((item) => ({ ...item, reste: this.money(item.reste) })),
      },
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
    const report = await this.activitePeriode({
      dateDebut: date,
      dateFin: date,
    });
    const debut = this.parseDate(date, 'date');
    const finExclusive = new Date(debut);
    finExclusive.setUTCDate(finExclusive.getUTCDate() + 1);
    const interval = { gte: debut, lt: finExclusive };
    const [journal, candidatures] = await Promise.all([
      this.prisma.journalActivite.findMany({
        // Les tentatives refusées relèvent de l'audit, pas du récapitulatif.
        where: {
          date: interval,
          OR: [{ statutHttp: null }, { statutHttp: { lt: 400 } }],
        },
        orderBy: { date: 'desc' },
      }),
      this.prisma.candidaturePersonnel.findMany({
        where: { dateDepot: interval },
        select: {
          id: true,
          nom: true,
          prenom: true,
          fonction: true,
          dateDepot: true,
        },
        orderBy: { dateDepot: 'desc' },
      }),
    ]);

    const loggedCreations = new Set(
      journal
        .filter((event) => event.action.startsWith('Création ·'))
        .flatMap((event) => (event.entiteId ? [event.entiteId] : [])),
    );
    type DailyActivity = {
      id: string;
      date: Date | string;
      action: string;
      detail: string;
      utilisateur: string | null;
      categorie: string;
      montant?: string;
      // Détail de l'opération : valeurs modifiées, saisies ou supprimées.
      modifications?: unknown;
      valeurs?: unknown;
      supprime?: unknown;
      dossier?: { type: 'demande-bourse' | 'inscription'; id: string } | null;
    };
    const cibles = await resolveEntityLabels(this.prisma, journal);
    const activities: DailyActivity[] = journal.map((event) => {
      const donnees =
        event.donnees && typeof event.donnees === 'object'
          ? (event.donnees as { envoye?: unknown; supprime?: unknown })
          : null;
      const dossier = event.chemin?.match(
        /^\/(demandes-bourse|inscriptions)\/([0-9a-f-]{36})/,
      );
      return {
        id: event.id,
        date: event.date,
        action: event.action,
        // Le nom de la personne ou du dossier concerné plutôt qu'un identifiant.
        detail:
          cibles.get(event) ??
          (event.entiteId
            ? `${event.ressource} · ${event.entiteId.slice(0, 8)}`
            : event.ressource),
        utilisateur: event.utilisateurNom,
        categorie: event.ressource,
        modifications: event.modifications ?? [],
        valeurs: donnees?.envoye ?? null,
        supprime: donnees?.supprime ?? null,
        dossier:
          dossier && event.methode !== 'DELETE'
            ? {
                type:
                  dossier[1] === 'demandes-bourse'
                    ? 'demande-bourse'
                    : 'inscription',
                id: dossier[2],
              }
            : null,
      };
    });
    // Un dossier créé puis modifié le même jour compte pour un seul élément.
    const elements = new Map<string, Set<string>>();
    const trackElement = (categorie: string, key: string) => {
      if (!elements.has(categorie)) elements.set(categorie, new Set());
      elements.get(categorie)!.add(key);
    };
    for (const event of journal)
      trackElement(event.ressource, event.entiteId ?? event.id);
    const addCreation = (event: {
      id: string;
      date: Date | string;
      action: string;
      detail: string;
      categorie: string;
      montant?: string;
    }) => {
      if (loggedCreations.has(event.id)) return;
      trackElement(event.categorie, event.id);
      activities.push({
        ...event,
        id: `${event.categorie}:${event.id}`,
        utilisateur: null,
      });
    };

    for (const item of report.paiements)
      addCreation({
        id: item.id,
        date: item.date,
        action:
          item.type === 'REMBOURSEMENT'
            ? 'Remboursement'
            : item.type === 'ANNULATION'
              ? 'Paiement annulé'
              : item.type === 'REPORT'
                ? 'Report de trop-perçu'
                : 'Paiement enregistré',
        detail:
          `${item.personne?.prenom ?? ''} ${item.personne?.nom ?? ''} · ${item.dossier} · ${item.type}`.trim(),
        categorie: 'paiement',
        montant: item.montant,
      });
    for (const item of report.demandes)
      addCreation({
        id: item.id,
        date: item.date,
        action: 'Demande de bourse créée',
        detail: `${item.personne.prenom} ${item.personne.nom} · ${item.filiere}`,
        categorie: 'demande de bourse',
      });
    for (const item of report.inscriptions)
      addCreation({
        id: item.id,
        date: item.date,
        action: 'Inscription créée',
        detail: `${item.personne.prenom} ${item.personne.nom} · ${item.filiere}`,
        categorie: 'inscription',
      });
    for (const item of report.prospects)
      addCreation({
        id: item.id,
        date: item.date,
        action: 'Prospect créé',
        detail: `${item.personne.prenom} ${item.personne.nom}${item.filiere ? ` · ${item.filiere}` : ''}`,
        categorie: 'prospect',
      });
    for (const item of candidatures)
      addCreation({
        id: item.id,
        date: item.dateDepot,
        action: 'Candidature de recrutement déposée',
        detail: `${item.prenom} ${item.nom} · ${item.fonction}`,
        categorie: 'dossier de recrutement',
      });

    activities.sort(
      (first, second) =>
        new Date(second.date).getTime() - new Date(first.date).getTime(),
    );
    const parCategorie = activities.reduce<Record<string, number>>(
      (counts, activity) => {
        counts[activity.categorie] = (counts[activity.categorie] ?? 0) + 1;
        return counts;
      },
      {},
    );
    return {
      date,
      total: activities.length,
      parCategorie,
      elementsParCategorie: Object.fromEntries(
        [...elements].map(([categorie, keys]) => [categorie, keys.size]),
      ),
      activites: activities,
    };
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
