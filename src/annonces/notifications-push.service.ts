import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

type Body = Record<string, unknown>;

// Les annonces programmées partent au plus tard à ce rythme (si le serveur est éveillé).
const INTERVALLE_MS = 5 * 60 * 1000;
const DUREE_VIE_S = 3 * 24 * 60 * 60;

type Cible = {
  filiereId: string | null;
  niveau: string | null;
  classeId: string | null;
};

const texte = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

// Notifications push de l'espace étudiant : abonnement des téléphones et envoi
// des annonces, y compris application fermée (Web Push, clés VAPID).
@Injectable()
export class NotificationsPushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsPushService.name);
  private actif = false;
  private minuterie?: NodeJS.Timeout;
  private enCours: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const publique = process.env.VAPID_PUBLIC_KEY;
    const privee = process.env.VAPID_PRIVATE_KEY;
    if (!publique || !privee) {
      this.logger.warn(
        'Notifications push désactivées : VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY ne sont pas définies.',
      );
      return;
    }
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'https://ipaim-admin.vercel.app',
      publique,
      privee,
    );
    this.actif = true;
    this.minuterie = setInterval(() => void this.diffuser(), INTERVALLE_MS);
    this.minuterie.unref();
    // Rattrape les annonces programmées échues pendant que le serveur dormait.
    setTimeout(() => void this.diffuser(), 10_000).unref();
  }

  onModuleDestroy() {
    if (this.minuterie) clearInterval(this.minuterie);
  }

  cle() {
    return { cle: this.actif ? process.env.VAPID_PUBLIC_KEY : null };
  }

  async abonner(compteId: string, body: Body, appareil?: string) {
    if (!this.actif)
      throw new ServiceUnavailableException(
        'Les notifications ne sont pas encore disponibles.',
      );
    const endpoint = texte(body.endpoint);
    const keys = (body.keys ?? {}) as Body;
    const p256dh = texte(keys.p256dh);
    const auth = texte(keys.auth);
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth)
      throw new BadRequestException('Abonnement aux notifications invalide');
    // Un même téléphone passé à un autre compte change de propriétaire.
    await this.prisma.abonnementPush.upsert({
      where: { endpoint },
      create: {
        compteId,
        endpoint,
        p256dh,
        auth,
        appareil: appareil?.slice(0, 200),
      },
      update: { compteId, p256dh, auth, appareil: appareil?.slice(0, 200) },
    });
    return { abonne: true };
  }

  async desabonner(compteId: string, body: Body) {
    const endpoint = texte(body.endpoint);
    if (endpoint)
      await this.prisma.abonnementPush.deleteMany({
        where: { compteId, endpoint },
      });
    return { abonne: false };
  }

  async etat(compteId: string, endpoint: string) {
    const existe = endpoint
      ? await this.prisma.abonnementPush.count({
          where: { compteId, endpoint },
        })
      : 0;
    return { disponible: this.actif, abonne: existe > 0 };
  }

  // Notification d'essai, envoyée au seul téléphone qui la demande.
  async essai(compteId: string, body: Body) {
    const endpoint = texte(body.endpoint);
    const abonnement = await this.prisma.abonnementPush.findFirst({
      where: { compteId, endpoint },
    });
    if (!abonnement)
      throw new BadRequestException(
        "Ce téléphone n'est pas abonné aux notifications",
      );
    await this.envoyer([abonnement], {
      title: 'IPAIM Étudiant',
      body: 'Les notifications sont activées : tu recevras ici les annonces de l’administration.',
      url: '/etudiant/annonces',
      tag: 'essai',
    });
    return { envoye: true };
  }

  /** Envoie les annonces publiées qui n'ont pas encore été notifiées. */
  diffuser(): Promise<void> {
    if (!this.actif) return Promise.resolve();
    // Une seule diffusion à la fois : un appel pendant l'envoi attend la même.
    this.enCours ??= this.diffuserMaintenant().finally(() => {
      this.enCours = null;
    });
    return this.enCours;
  }

  private async diffuserMaintenant() {
    const maintenant = new Date();
    const annonces = await this.prisma.annonce.findMany({
      where: {
        notifieeLe: null,
        publieeLe: { lte: maintenant },
        OR: [{ expireLe: null }, { expireLe: { gt: maintenant } }],
      },
      orderBy: { publieeLe: 'asc' },
      take: 20,
    });
    for (const annonce of annonces) {
      // Marquée d'abord : même deux serveurs en parallèle n'envoient qu'une fois.
      const pris = await this.prisma.annonce.updateMany({
        where: { id: annonce.id, notifieeLe: null },
        data: { notifieeLe: new Date() },
      });
      if (!pris.count) continue;
      try {
        const abonnements = await this.abonnementsPour(annonce);
        await this.envoyer(abonnements, {
          title:
            annonce.importance === 'IMPORTANTE'
              ? `Important · ${annonce.titre}`
              : annonce.titre,
          body:
            annonce.contenu.length > 180
              ? `${annonce.contenu.slice(0, 177)}…`
              : annonce.contenu,
          url: '/etudiant/annonces',
          tag: `annonce-${annonce.id}`,
        });
        this.logger.log(
          `Annonce « ${annonce.titre} » notifiée à ${abonnements.length} appareil(s)`,
        );
      } catch (error) {
        this.logger.error(
          `Notification de l'annonce ${annonce.id} impossible`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  // Les téléphones des étudiants concernés : compte actif, et inscription de
  // l'année qui correspond à la cible de l'annonce.
  private async abonnementsPour(cible: Cible) {
    const abonnements = await this.prisma.abonnementPush.findMany({
      where: { compte: { desactiveLe: null, motDePasse: { not: null } } },
      include: {
        compte: {
          select: {
            personne: {
              select: {
                inscriptions: {
                  where: { statut: { not: 'ABANDONNEE' } },
                  orderBy: { dateInscription: 'desc' },
                  take: 1,
                  select: {
                    niveau: true,
                    filiereId: true,
                    classeId: true,
                    classe: { select: { niveau: true, filiereId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const ciblee = cible.filiereId || cible.niveau || cible.classeId;
    return abonnements.filter((abonnement) => {
      if (!ciblee) return true;
      const inscription = abonnement.compte.personne.inscriptions[0];
      if (!inscription) return false;
      const filiereId =
        inscription.filiereId ?? inscription.classe?.filiereId ?? null;
      const niveau = inscription.classe?.niveau ?? inscription.niveau;
      return (
        (!cible.filiereId || cible.filiereId === filiereId) &&
        (!cible.niveau || cible.niveau === niveau) &&
        (!cible.classeId || cible.classeId === inscription.classeId)
      );
    });
  }

  private async envoyer(
    abonnements: Array<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>,
    message: { title: string; body: string; url: string; tag: string },
  ) {
    const charge = JSON.stringify(message);
    const expires: string[] = [];
    await Promise.all(
      abonnements.map(async (abonnement) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: abonnement.endpoint,
              keys: { p256dh: abonnement.p256dh, auth: abonnement.auth },
            },
            charge,
            { TTL: DUREE_VIE_S, urgency: 'normal' },
          );
        } catch (error) {
          const statut = (error as { statusCode?: number }).statusCode;
          // Abonnement révoqué ou expiré (téléphone changé, autorisation retirée).
          if (statut === 404 || statut === 410) expires.push(abonnement.id);
          else
            this.logger.warn(
              `Envoi push refusé (${statut ?? 'erreur réseau'}) pour un appareil`,
            );
        }
      }),
    );
    if (expires.length)
      await this.prisma.abonnementPush.deleteMany({
        where: { id: { in: expires } },
      });
  }
}
