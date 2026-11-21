import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { situationScolarite } from '../frais-scolarite/frais-scolarite.situation';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsPushService } from './notifications-push.service';

// Rythme de vérification : un cours est rappelé entre 12 et 17 minutes avant.
const INTERVALLE_MS = 5 * 60 * 1000;
const COURS_AVANT_MIN = 17;
const COURS_APRES_MIN = 10;
// Les rappels de paiement : une vérification par heure, en journée seulement.
const PAIEMENT_INTERVALLE_MS = 60 * 60 * 1000;
const PAIEMENT_HEURE_MIN = 8;
const PAIEMENT_HEURE_MAX = 20;
const PAIEMENT_JOURS = 7;
// Paiements reçus : vérifiés chaque minute, pour une notification presque immédiate.
const RECUS_INTERVALLE_MS = 60 * 1000;
// Au démarrage, seuls les paiements de la dernière heure sont pris en compte
// (pas de rafale de notifications pour l'historique après un déploiement).
const RECUS_RATTRAPAGE_MS = 60 * 60 * 1000;
const ENCAISSEMENTS = [
  'MENSUALITE',
  'FRAIS_ANNEXE',
  'FRAIS_INSCRIPTION',
  'ECHEANCE_BOURSE',
  'FRAIS_DEPOT',
] as const;
const NATURES: Record<string, string> = {
  MENSUALITE: 'Scolarité',
  FRAIS_ANNEXE: 'Frais annexe',
  FRAIS_INSCRIPTION: "Frais d'inscription",
  ECHEANCE_BOURSE: 'Échéance de bourse',
  FRAIS_DEPOT: 'Frais de dépôt',
};
// Les traces de rappels envoyés ne servent plus après quelques semaines.
const CONSERVATION_JOURS = 60;

type Local = { date: string; jour: number; minutes: number; heure: number };

const minutesDe = (heure: string) => {
  const [h, m] = heure.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const montant = (valeur: number) =>
  `${Math.round(valeur).toLocaleString('fr-FR')} F`;

// Rappels automatiques poussés sur le téléphone des étudiants abonnés :
// le cours qui commence dans un quart d'heure, l'échéance de paiement qui
// arrive dans une semaine (puis la veille). Chaque rappel ne part qu'une fois.
@Injectable()
export class RappelsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RappelsService.name);
  // L'heure de l'école (les créneaux sont saisis en heure locale).
  private readonly fuseau = process.env.FUSEAU_HORAIRE || 'Africa/Brazzaville';
  private minuterie?: NodeJS.Timeout;
  private minuterieRecus?: NodeJS.Timeout;
  private dernierPaiement = 0;
  private enCours = false;
  private recusEnCours = false;
  private readonly demarrage = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: NotificationsPushService,
  ) {}

  onModuleInit() {
    this.minuterie = setInterval(() => void this.verifier(), INTERVALLE_MS);
    this.minuterie.unref();
    setTimeout(() => void this.verifier(), 20_000).unref();
    this.minuterieRecus = setInterval(
      () => void this.paiementsRecus(),
      RECUS_INTERVALLE_MS,
    );
    this.minuterieRecus.unref();
  }

  onModuleDestroy() {
    if (this.minuterie) clearInterval(this.minuterie);
    if (this.minuterieRecus) clearInterval(this.minuterieRecus);
  }

  /**
   * « Paiement reçu » : dès qu'un encaissement est enregistré sur l'inscription
   * d'un étudiant abonné (caisse, inscription, synchronisation hors ligne), une
   * notification part sur son téléphone, avec le reste à payer.
   */
  async paiementsRecus() {
    if (!this.push.actif || this.recusEnCours) return;
    this.recusEnCours = true;
    try {
      const depuis = new Date(
        Math.max(
          Date.now() - 2 * 86_400_000,
          this.demarrage - RECUS_RATTRAPAGE_MS,
        ),
      );
      const paiements = await this.prisma.paiement.findMany({
        where: {
          enregistreLe: { gte: depuis },
          typePaiement: { in: [...ENCAISSEMENTS] },
          montant: { gt: 0 },
          // Un encaissement annulé entre-temps ne s'annonce pas.
          annulation: { is: null },
          inscription: {
            personne: {
              compteEtudiant: {
                desactiveLe: null,
                abonnementsPush: { some: {} },
              },
            },
          },
        },
        include: {
          ligneScolarite: { select: { libelle: true } },
          elementDossier: {
            select: { elementRequis: { select: { nom: true } } },
          },
          inscription: {
            select: {
              id: true,
              personne: {
                select: {
                  compteEtudiant: {
                    select: { abonnementsPush: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { enregistreLe: 'asc' },
        take: 50,
      });
      for (const paiement of paiements) {
        const appareils =
          paiement.inscription?.personne.compteEtudiant?.abonnementsPush ?? [];
        if (!paiement.inscription || !appareils.length) continue;
        if (!(await this.reserver(`recu:${paiement.id}`))) continue;
        const situation = await situationScolarite(
          this.prisma,
          paiement.inscription.id,
        );
        const reste = situation
          ? situation.resteTotal +
            situation.fraisInscription.reduce(
              (total, ligne) => total + ligne.reste,
              0,
            )
          : null;
        const objet =
          paiement.ligneScolarite?.libelle ??
          paiement.elementDossier?.elementRequis.nom ??
          NATURES[paiement.typePaiement] ??
          'Paiement';
        await this.push.envoyer(appareils, {
          title: `Paiement reçu · ${montant(Number(paiement.montant))}`,
          body: [
            objet,
            paiement.numeroRecu ? `Reçu ${paiement.numeroRecu}` : null,
            reste === null
              ? null
              : reste > 0
                ? `Reste à payer : ${montant(reste)}`
                : 'Tout est réglé pour cette année.',
          ]
            .filter(Boolean)
            .join(' · '),
          url: `/etudiant/paiements?recu=${paiement.id}`,
          tag: `recu-${paiement.id}`,
        });
        this.logger.log(
          `Paiement reçu (${paiement.numeroRecu ?? paiement.id}) notifié à ${appareils.length} appareil(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Notification des paiements reçus impossible',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.recusEnCours = false;
    }
  }

  /** Date, jour (1 = lundi) et heure dans le fuseau de l'école. */
  maintenantLocal(instant = new Date()): Local {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: this.fuseau,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      })
        .formatToParts(instant)
        .map((part) => [part.type, part.value]),
    );
    const jours = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const heure = Number(parts.hour);
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      jour: jours.indexOf(parts.weekday) + 1,
      minutes: heure * 60 + Number(parts.minute),
      heure,
    };
  }

  async verifier(instant = new Date(), forcerPaiements = false) {
    if (!this.push.actif || this.enCours) return;
    this.enCours = true;
    try {
      const local = this.maintenantLocal(instant);
      await this.rappelsCours(local);
      const enJournee =
        local.heure >= PAIEMENT_HEURE_MIN && local.heure < PAIEMENT_HEURE_MAX;
      if (
        forcerPaiements ||
        (enJournee &&
          instant.getTime() - this.dernierPaiement >= PAIEMENT_INTERVALLE_MS)
      ) {
        this.dernierPaiement = instant.getTime();
        await this.rappelsPaiement(local);
        await this.prisma.rappelEnvoye.deleteMany({
          where: {
            envoyeLe: {
              lt: new Date(Date.now() - CONSERVATION_JOURS * 86_400_000),
            },
          },
        });
      }
    } catch (error) {
      this.logger.error(
        'Vérification des rappels impossible',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.enCours = false;
    }
  }

  // Marque le rappel comme envoyé ; faux s'il l'était déjà.
  private async reserver(cle: string) {
    const { count } = await this.prisma.rappelEnvoye.createMany({
      data: [{ cle }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  // Abonnements des étudiants qui veulent ce type de rappel, avec leur inscription de l'année.
  private async abonnes(type: 'cours' | 'paiement') {
    return this.prisma.abonnementPush.findMany({
      where: {
        compte: {
          desactiveLe: null,
          motDePasse: { not: null },
          ...(type === 'cours'
            ? { rappelsCours: true }
            : { rappelsPaiement: true }),
        },
      },
      include: {
        compte: {
          select: {
            personne: {
              select: {
                inscriptions: {
                  where: { statut: { not: 'ABANDONNEE' } },
                  orderBy: { dateInscription: 'desc' },
                  take: 1,
                  select: { id: true, classeId: true },
                },
              },
            },
          },
        },
      },
    });
  }

  private async rappelsCours(local: Local) {
    const abonnes = await this.abonnes('cours');
    const classes = new Set(
      abonnes.flatMap((abonnement) => {
        const classeId = abonnement.compte.personne.inscriptions[0]?.classeId;
        return classeId ? [classeId] : [];
      }),
    );
    if (!classes.size) return;
    const jourMinuit = new Date(`${local.date}T00:00:00.000Z`);
    const creneaux = await this.prisma.creneau.findMany({
      where: {
        jour: local.jour,
        cours: {
          classeId: { in: [...classes] },
          classe: {
            anneeAcademique: {
              statut: { not: 'CLOTUREE' },
              dateDebut: { lte: jourMinuit },
              dateFin: { gte: jourMinuit },
            },
          },
        },
      },
      include: {
        salle: { select: { nom: true } },
        cours: {
          select: {
            id: true,
            classeId: true,
            matiere: { select: { nom: true } },
            // Enseignant déjà signalé absent sur ce créneau : pas de rappel.
            absencesEnseignant: {
              where: { date: jourMinuit },
              select: { heureDebut: true },
            },
          },
        },
      },
    });
    for (const creneau of creneaux) {
      const dans = minutesDe(creneau.heureDebut) - local.minutes;
      if (dans < COURS_APRES_MIN || dans > COURS_AVANT_MIN) continue;
      if (
        creneau.cours.absencesEnseignant.some(
          (absence) => absence.heureDebut === creneau.heureDebut,
        )
      )
        continue;
      if (!(await this.reserver(`cours:${creneau.id}:${local.date}`))) continue;
      const destinataires = abonnes.filter(
        (abonnement) =>
          abonnement.compte.personne.inscriptions[0]?.classeId ===
          creneau.cours.classeId,
      );
      await this.push.envoyer(destinataires, {
        title: `${creneau.cours.matiere.nom} · dans ${dans} min`,
        body: `Début à ${creneau.heureDebut}${creneau.salle ? ` · ${creneau.salle.nom}` : ''}`,
        url: '/etudiant/cours',
        tag: `cours-${creneau.id}`,
      });
      this.logger.log(
        `Rappel de cours « ${creneau.cours.matiere.nom} » envoyé à ${destinataires.length} appareil(s)`,
      );
    }
  }

  private async rappelsPaiement(local: Local) {
    const abonnes = await this.abonnes('paiement');
    const parInscription = new Map<string, typeof abonnes>();
    for (const abonnement of abonnes) {
      const inscriptionId = abonnement.compte.personne.inscriptions[0]?.id;
      if (!inscriptionId) continue;
      parInscription.set(inscriptionId, [
        ...(parInscription.get(inscriptionId) ?? []),
        abonnement,
      ]);
    }
    const aujourdhui = Date.parse(`${local.date}T00:00:00.000Z`);
    for (const [inscriptionId, appareils] of parInscription) {
      const situation = await situationScolarite(this.prisma, inscriptionId);
      if (!situation) continue;
      for (const ligne of [...situation.mensualites, ...situation.annexes]) {
        if (!ligne.dateLimite || ligne.reste <= 0) continue;
        const limite = this.maintenantLocal(ligne.dateLimite).date;
        const jours = Math.round(
          (Date.parse(`${limite}T00:00:00.000Z`) - aujourdhui) / 86_400_000,
        );
        if (jours < 0 || jours > PAIEMENT_JOURS) continue;
        // Une semaine avant, puis la veille (ou le jour même).
        const etape = jours <= 1 ? 'J1' : 'J7';
        if (!(await this.reserver(`paiement:${ligne.id}:${etape}`))) continue;
        const quand =
          jours === 0
            ? "aujourd'hui"
            : jours === 1
              ? 'demain'
              : `avant le ${new Intl.DateTimeFormat('fr-FR', { timeZone: this.fuseau, day: 'numeric', month: 'long' }).format(ligne.dateLimite)}`;
        await this.push.envoyer(appareils, {
          title: `Paiement à venir · ${ligne.libelle}`,
          body: `${montant(ligne.reste)} à régler ${quand}.`,
          url: '/etudiant/paiements',
          tag: `paiement-${ligne.id}`,
        });
        this.logger.log(
          `Rappel de paiement « ${ligne.libelle} » (${etape}) envoyé à ${appareils.length} appareil(s)`,
        );
      }
    }
  }
}
