import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { resolveEntityLabels } from '../audit/entity-labels';
import { Acteur, peut } from '../common/acteur';
import {
  assurerTousLesEcheanciers,
  retardsScolarite,
  resteTotalScolarite,
} from '../frais-scolarite/frais-scolarite.situation';
import { PrismaService } from '../prisma/prisma.service';
import { PeriodeRapportDto } from './dto/periode-rapport.dto';

@Injectable()
export class RapportsService {
  constructor(private readonly prisma: PrismaService) {}

  async recouvrement(query: {
    type?: string;
    statut?: string;
    anneeScolaire?: string;
    q?: string;
    page?: string;
    limit?: string;
  }) {
    await assurerTousLesEcheanciers(this.prisma);
    const [demandes, inscriptions, annees] = await Promise.all([
      this.prisma.demandeBourse.findMany({
        select: {
          id: true,
          dateDepot: true,
          statut: true,
          niveauDemande: true,
          filiereSouhaitee: true,
          personne: {
            select: {
              nom: true,
              prenom: true,
              telephone: true,
              matricule: true,
            },
          },
          inscriptions: {
            select: {
              anneeScolaire: true,
              paiements: {
                where: { echeanceId: { not: null } },
                select: { montant: true, typePaiement: true },
              },
            },
            orderBy: { dateInscription: 'desc' },
          },
          typeBourse: {
            select: { echeances: { select: { montantAttendu: true } } },
          },
          elementsDossier: {
            select: {
              montantAttendu: true,
              paiements: {
                select: { montant: true, typePaiement: true },
              },
            },
          },
          paiements: {
            where: { elementDossierId: null },
            select: { montant: true, typePaiement: true },
          },
        },
      }),
      this.prisma.inscription.findMany({
        select: {
          id: true,
          dateInscription: true,
          statut: true,
          anneeScolaire: true,
          niveau: true,
          filiere: true,
          lignesScolarite: { select: { montant: true } },
          personne: {
            select: {
              nom: true,
              prenom: true,
              telephone: true,
              matricule: true,
            },
          },
          elementsDossier: {
            select: {
              montantAttendu: true,
              paiements: {
                select: { montant: true, typePaiement: true },
              },
            },
          },
          paiements: {
            where: { elementDossierId: null, echeanceId: null },
            select: { montant: true, typePaiement: true },
          },
        },
      }),
      this.prisma.inscription.findMany({
        select: { anneeScolaire: true },
        distinct: ['anneeScolaire'],
        orderBy: { anneeScolaire: 'desc' },
      }),
    ]);

    type PaiementRecouvrement = { montant: unknown; typePaiement: string };
    const preparer = (
      type: 'BOURSE' | 'INSCRIPTION',
      dossier: {
        id: string;
        date: Date;
        statutDossier: string;
        anneeScolaire: string | null;
        niveau: string;
        filiere: string;
        montantsAttendusSupplementaires?: unknown[];
        paiementsSupplementaires?: PaiementRecouvrement[];
        personne: {
          nom: string;
          prenom: string;
          telephone: string | null;
          matricule: string | null;
        };
        elementsDossier: Array<{
          montantAttendu: unknown;
          paiements: PaiementRecouvrement[];
        }>;
        paiements: PaiementRecouvrement[];
      },
    ) => {
      const paiementsElements = dossier.elementsDossier.flatMap(
        (element) => element.paiements,
      );
      const tousPaiements = [...paiementsElements, ...dossier.paiements];
      const montantAttendu = this.roundMoney(
        dossier.elementsDossier.reduce(
          (total, element) => total + Number(element.montantAttendu ?? 0),
          0,
        ) +
          (dossier.montantsAttendusSupplementaires ?? []).reduce<number>(
            (total, montant) => total + Number(montant ?? 0),
            0,
          ),
      );
      const paiements = dossier.paiementsSupplementaires ?? [];
      const montantPaye = this.roundMoney(
        [...tousPaiements, ...paiements].reduce(
          (total, paiement) => total + Number(paiement.montant),
          0,
        ),
      );
      const encaisse = this.roundMoney(
        [...tousPaiements, ...paiements]
          .filter((paiement) => paiement.typePaiement !== 'REPORT')
          .reduce((total, paiement) => total + Number(paiement.montant), 0),
      );
      const resteAPayer = this.roundMoney(
        Math.max(0, montantAttendu - montantPaye),
      );
      const etat =
        resteAPayer === 0 ? 'PAYE' : montantPaye > 0 ? 'DETTE' : 'IMPAYE';
      return {
        id: dossier.id,
        type,
        date: dossier.date,
        statutDossier: dossier.statutDossier,
        anneeScolaire: dossier.anneeScolaire,
        niveau: dossier.niveau,
        filiere: dossier.filiere,
        personne: dossier.personne,
        montantAttendu: this.money(montantAttendu),
        montantPaye: this.money(montantPaye),
        encaisse: this.money(encaisse),
        resteAPayer: this.money(resteAPayer),
        etat,
      };
    };

    const lignes = [
      ...demandes.map((demande) =>
        preparer('BOURSE', {
          id: demande.id,
          date: demande.dateDepot,
          statutDossier: demande.statut,
          anneeScolaire: demande.inscriptions[0]?.anneeScolaire ?? null,
          niveau: demande.niveauDemande,
          filiere: demande.filiereSouhaitee,
          personne: demande.personne,
          elementsDossier: demande.elementsDossier,
          paiements: demande.paiements,
          montantsAttendusSupplementaires:
            demande.statut === 'ACCEPTEE'
              ? (demande.typeBourse?.echeances ?? []).map(
                  (echeance) => echeance.montantAttendu,
                )
              : [],
          paiementsSupplementaires: demande.inscriptions.flatMap(
            (inscription) => inscription.paiements,
          ),
        }),
      ),
      ...inscriptions.map((inscription) =>
        preparer('INSCRIPTION', {
          id: inscription.id,
          date: inscription.dateInscription,
          statutDossier: inscription.statut,
          anneeScolaire: inscription.anneeScolaire,
          niveau: inscription.niveau,
          filiere: inscription.filiere,
          // Les mois et frais annexes dus ; leurs versements sont dans « paiements ».
          montantsAttendusSupplementaires: inscription.lignesScolarite.map(
            (ligne) => ligne.montant,
          ),
          personne: inscription.personne,
          elementsDossier: inscription.elementsDossier,
          paiements: inscription.paiements,
        }),
      ),
    ];

    const texte = query.q?.trim().toLocaleLowerCase('fr-FR');
    const type =
      query.type === 'BOURSE' || query.type === 'INSCRIPTION'
        ? query.type
        : null;
    const statut = ['PAYE', 'DETTE', 'IMPAYE'].includes(query.statut ?? '')
      ? query.statut
      : null;
    const filtres = lignes
      .filter(
        (ligne) =>
          Number(ligne.montantAttendu) > 0 || Number(ligne.montantPaye) !== 0,
      )
      .filter((ligne) => !type || ligne.type === type)
      .filter((ligne) => !statut || ligne.etat === statut)
      .filter(
        (ligne) =>
          !query.anneeScolaire || ligne.anneeScolaire === query.anneeScolaire,
      )
      .filter(
        (ligne) =>
          !texte ||
          [
            ligne.personne.nom,
            ligne.personne.prenom,
            ligne.personne.telephone,
            ligne.personne.matricule,
            ligne.filiere,
            ligne.niveau,
          ]
            .filter(Boolean)
            .some((valeur) =>
              valeur!.toLocaleLowerCase('fr-FR').includes(texte),
            ),
      )
      .sort((a, b) => a.personne.nom.localeCompare(b.personne.nom, 'fr'));

    const somme = (
      liste: typeof filtres,
      cle: 'montantAttendu' | 'montantPaye' | 'encaisse' | 'resteAPayer',
    ) =>
      this.money(liste.reduce((total, ligne) => total + Number(ligne[cle]), 0));
    const resume = (liste: typeof filtres) => ({
      dossiers: liste.length,
      attendu: somme(liste, 'montantAttendu'),
      paye: somme(liste, 'montantPaye'),
      encaisse: somme(liste, 'encaisse'),
      resteAPayer: somme(liste, 'resteAPayer'),
    });
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    return {
      data: filtres.slice((page - 1) * limit, page * limit),
      meta: {
        page,
        limit,
        total: filtres.length,
        totalPages: Math.max(1, Math.ceil(filtres.length / limit)),
      },
      totaux: resume(filtres),
      parType: {
        bourses: resume(filtres.filter((ligne) => ligne.type === 'BOURSE')),
        inscriptions: resume(
          filtres.filter((ligne) => ligne.type === 'INSCRIPTION'),
        ),
      },
      anneesScolaires: annees.map((annee) => annee.anneeScolaire),
    };
  }

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

  // Échéances dépassées et non soldées, d'après l'échéancier de chaque étudiant.
  async paiementsEnRetard() {
    const retards = await retardsScolarite(this.prisma);
    const personnes = await this.prisma.inscription.findMany({
      where: { id: { in: retards.map((retard) => retard.inscriptionId) } },
      select: { id: true, personne: true },
    });
    const personneDe = new Map(
      personnes.map((item) => [item.id, item.personne]),
    );
    const groupes = new Map<
      string,
      {
        libelle: string;
        dateEcheance: Date | null;
        regime: string;
        attendu: number;
        paye: number;
        dossiers: Array<{
          inscriptionId: string;
          personne: unknown;
          montantPaye: string;
          resteAPayer: string;
        }>;
      }
    >();
    for (const retard of retards)
      for (const ligne of retard.echues) {
        const regime = retard.regime.split(' · ')[0];
        const cle = `${ligne.libelle}|${ligne.dateLimite?.getTime()}|${regime}`;
        const groupe = groupes.get(cle) ?? {
          libelle: ligne.libelle,
          dateEcheance: ligne.dateLimite,
          regime,
          attendu: 0,
          paye: 0,
          dossiers: [],
        };
        groupe.attendu += ligne.montant;
        groupe.paye += ligne.paye;
        groupe.dossiers.push({
          inscriptionId: retard.inscriptionId,
          personne: personneDe.get(retard.inscriptionId),
          montantPaye: this.money(ligne.paye),
          resteAPayer: this.money(ligne.reste),
        });
        groupes.set(cle, groupe);
      }
    const echeances = [...groupes.values()]
      .sort(
        (first, second) =>
          (first.dateEcheance?.getTime() ?? 0) -
          (second.dateEcheance?.getTime() ?? 0),
      )
      .map((groupe) => ({
        echeance: {
          libelle: groupe.libelle,
          dateEcheance: groupe.dateEcheance,
          typeBourse: { nom: groupe.regime },
        },
        montantAttendu: this.money(groupe.attendu),
        montantPaye: this.money(groupe.paye),
        resteAPayer: this.money(groupe.attendu - groupe.paye),
        dossiers: groupe.dossiers,
      }));
    return { total: echeances.length, echeances };
  }

  async synthese() {
    const resteScolarite = await resteTotalScolarite(this.prisma);
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
      resteScolarite: this.money(resteScolarite),
      totalResteARecouvrer: this.money(
        resteBourses + resteInscriptions + resteScolarite,
      ),
      tendance,
    };
  }

  // Vue d'ensemble d'un utilisateur : uniquement les cartes attribuées à son poste.
  async syntheseVisible(acteur: Acteur) {
    const voit = (zone: string) => peut(acteur, `view:dashboard-${zone}`);
    const personne = { select: { nom: true, prenom: true } };
    const [synthese, dernieresDemandes, dernieresInscriptions] =
      await Promise.all([
        this.synthese(),
        voit('recent-applications')
          ? this.prisma.demandeBourse.findMany({
              take: 5,
              orderBy: { dateDepot: 'desc' },
              select: {
                id: true,
                filiereSouhaitee: true,
                statut: true,
                dateDepot: true,
                personne,
              },
            })
          : undefined,
        voit('recent-enrollments')
          ? this.prisma.inscription.findMany({
              take: 4,
              orderBy: { dateInscription: 'desc' },
              select: {
                id: true,
                filiere: true,
                anneeScolaire: true,
                dateInscription: true,
                personne,
              },
            })
          : undefined,
      ]);
    return {
      ...(voit('trend') ? { tendance: synthese.tendance } : {}),
      ...(voit('prospects')
        ? { prospectsActifs: synthese.prospectsActifs }
        : {}),
      ...(voit('applications')
        ? { demandesTotal: synthese.demandesTotal }
        : {}),
      ...(voit('applications-open')
        ? { demandesEnCours: synthese.demandesEnCours }
        : {}),
      ...(voit('people') ? { effectifsTotal: synthese.effectifsTotal } : {}),
      ...(voit('enrollments')
        ? { inscriptionsTotal: synthese.inscriptionsTotal }
        : {}),
      ...(voit('collected') ? { totalEncaisse: synthese.totalEncaisse } : {}),
      ...(voit('receivables')
        ? {
            resteBourses: synthese.resteBourses,
            resteInscriptions: synthese.resteInscriptions,
            resteScolarite: synthese.resteScolarite,
            totalResteARecouvrer: synthese.totalResteARecouvrer,
          }
        : {}),
      ...(voit('scholarship-types')
        ? { inscriptionsParType: synthese.inscriptionsParType }
        : {}),
      ...(dernieresDemandes ? { dernieresDemandes } : {}),
      ...(dernieresInscriptions ? { dernieresInscriptions } : {}),
    };
  }

  async aFaireVisible(acteur: Acteur) {
    const voit = (zone: string) => peut(acteur, `view:dashboard-${zone}`);
    const { relances, entretiens, incomplets, impayes } = await this.aFaire();
    return {
      ...(voit('followups') ? { relances } : {}),
      ...(voit('interviews') ? { entretiens } : {}),
      ...(voit('incomplete') ? { incomplets } : {}),
      ...(voit('unpaid') ? { impayes } : {}),
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
    const retardsMois = await retardsScolarite(this.prisma);
    if (retardsMois.length) {
      const personnes = await this.prisma.inscription.findMany({
        where: { id: { in: retardsMois.map((item) => item.inscriptionId) } },
        select: { id: true, personne: true },
      });
      for (const retard of retardsMois) {
        const personne = personnes.find(
          (item) => item.id === retard.inscriptionId,
        )?.personne;
        if (!personne) continue;
        const existing = restes.get(retard.inscriptionId);
        if (existing) existing.reste += retard.resteEchu;
        else
          restes.set(retard.inscriptionId, {
            dossierType: 'inscription',
            dossierId: retard.inscriptionId,
            personne,
            reste: retard.resteEchu,
          });
      }
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
