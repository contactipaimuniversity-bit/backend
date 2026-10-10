import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CloudinaryService } from '../fichiers/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';
import { chiffrer, LONGUEUR_MIN_PHRASE } from './chiffrement';
import { sauvegarder, testerRestauration } from './sauvegarde.core';

const VERIFICATION_MS = 10 * 60 * 1000;

@Injectable()
export class SauvegardesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Sauvegardes');
  private minuteur: NodeJS.Timeout | null = null;
  private enCours = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ---------- Réglages (variables d'environnement) ----------

  private get dossier() {
    return resolve(process.env.BACKUP_DIR ?? join(process.cwd(), 'backups'));
  }

  private get heure() {
    const heure = Number(process.env.BACKUP_HEURE ?? 2);
    return Number.isInteger(heure) && heure >= 0 && heure <= 23 ? heure : 2;
  }

  private get retention() {
    const retention = Number(process.env.BACKUP_RETENTION ?? 30);
    return Number.isInteger(retention) && retention >= 3 ? retention : 30;
  }

  private get automatique() {
    return process.env.BACKUP_AUTO !== 'false';
  }

  // Phrase secrète de chiffrement : sans elle, aucune copie ne quitte le serveur.
  private get phraseSecrete() {
    const phrase = process.env.BACKUP_ENCRYPTION_KEY ?? '';
    return phrase.length >= LONGUEUR_MIN_PHRASE ? phrase : null;
  }

  private get copieExterneActive() {
    return (
      process.env.BACKUP_OFFSITE !== 'false' && this.phraseSecrete !== null
    );
  }

  private get url() {
    const url = process.env.DATABASE_URL;
    if (!url)
      throw new ServiceUnavailableException(
        'Adresse de la base de données non configurée',
      );
    return url;
  }

  // ---------- Planification ----------

  onModuleInit() {
    if (!this.automatique) return;
    this.minuteur = setInterval(
      () => void this.sauvegardeDuJour(),
      VERIFICATION_MS,
    );
    // Le minuteur ne doit pas empêcher l'arrêt du serveur.
    this.minuteur.unref();
  }

  onModuleDestroy() {
    if (this.minuteur) clearInterval(this.minuteur);
  }

  // Une sauvegarde automatique par jour, dès que l'heure prévue est passée.
  private async sauvegardeDuJour() {
    const maintenant = new Date();
    if (maintenant.getHours() < this.heure) return;
    const debutJour = new Date(maintenant);
    debutJour.setHours(0, 0, 0, 0);
    try {
      const dejaFaite = await this.prisma.sauvegarde.count({
        where: { statut: 'REUSSIE', date: { gte: debutJour } },
      });
      if (!dejaFaite) await this.creer('AUTO', 'Sauvegarde automatique');
    } catch (error) {
      this.logger.error(
        `Sauvegarde automatique impossible : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ---------- Opérations ----------

  async creer(declenchement: 'AUTO' | 'MANUEL', auteur: string) {
    if (this.enCours)
      throw new ConflictException('Une sauvegarde est déjà en cours');
    this.enCours = true;
    const debut = Date.now();
    const horodatage = new Date()
      .toISOString()
      .replace(/[:T]/g, '-')
      .slice(0, 19);
    const fichier = `ipaim-${horodatage}.sauvegarde.gz`;
    try {
      await mkdir(this.dossier, { recursive: true });
      const chemin = join(this.dossier, fichier);
      const entete = await sauvegarder(this.url, chemin);
      const taille = (await stat(chemin)).size;
      const sauvegarde = await this.prisma.sauvegarde.create({
        data: {
          fichier,
          taille,
          tables: entete.tables.length,
          lignes: entete.tables.reduce(
            (total, table) => total + table.lignes,
            0,
          ),
          dureeMs: Date.now() - debut,
          declenchement,
          statut: 'REUSSIE',
          creeParNom: auteur,
        },
      });
      await this.rotation();
      return await this.copierHorsServeur(sauvegarde.id, chemin, fichier);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.sauvegarde
        .create({
          data: {
            fichier,
            dureeMs: Date.now() - debut,
            declenchement,
            statut: 'ECHEC',
            erreur: message.slice(0, 500),
            creeParNom: auteur,
          },
        })
        .catch(() => undefined);
      throw new ServiceUnavailableException(
        `La sauvegarde a échoué : ${message}`,
      );
    } finally {
      this.enCours = false;
    }
  }

  // Dépose une copie chiffrée de la sauvegarde chez l'hébergeur de fichiers.
  // Un échec est consigné sans remettre en cause la sauvegarde locale.
  private async copierHorsServeur(id: string, chemin: string, fichier: string) {
    const phrase = this.phraseSecrete;
    if (!this.copieExterneActive || !phrase)
      return this.prisma.sauvegarde.findUniqueOrThrow({ where: { id } });
    try {
      const reference = await this.cloudinary.envoyerBrut(
        chiffrer(await readFile(chemin), phrase),
        `${fichier}.chiffre`,
        'ipaim/sauvegardes',
      );
      return await this.prisma.sauvegarde.update({
        where: { id },
        data: {
          copieExterneLe: new Date(),
          copieExterneRef: reference,
          copieExterneErreur: null,
        },
      });
    } catch (error) {
      return this.prisma.sauvegarde.update({
        where: { id },
        data: {
          copieExterneErreur: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 300),
        },
      });
    }
  }

  // Relance le dépôt externe d'une sauvegarde encore présente sur le serveur.
  async recopier(id: string) {
    if (!this.copieExterneActive)
      throw new ServiceUnavailableException(
        `La copie externe n'est pas configurée : définissez BACKUP_ENCRYPTION_KEY (au moins ${LONGUEUR_MIN_PHRASE} caractères)`,
      );
    const { sauvegarde, chemin } = await this.fichierDe(id);
    return this.copierHorsServeur(id, chemin, sauvegarde.fichier);
  }

  // Ne conserve que les fichiers les plus récents.
  private async rotation() {
    const fichiers = (await readdir(this.dossier))
      .filter((nom) => nom.endsWith('.sauvegarde.gz'))
      .sort()
      .reverse();
    for (const ancien of fichiers.slice(this.retention))
      await unlink(join(this.dossier, ancien)).catch(() => undefined);
  }

  async lister() {
    const sauvegardes = await this.prisma.sauvegarde.findMany({
      orderBy: { date: 'desc' },
      take: 100,
    });
    const derniere = sauvegardes.find(
      (sauvegarde) => sauvegarde.statut === 'REUSSIE',
    );
    const dernierTest = sauvegardes.find((sauvegarde) => sauvegarde.dateTest);
    return {
      reglages: {
        dossier: this.dossier,
        automatique: this.automatique,
        heure: this.heure,
        retention: this.retention,
        copieExterne: this.copieExterneActive,
      },
      derniereReussie: derniere?.date ?? null,
      // Au-delà de 36 heures sans sauvegarde réussie, l'écran alerte.
      enRetard:
        !derniere || Date.now() - derniere.date.getTime() > 36 * 3_600_000,
      dernierTest: dernierTest
        ? { date: dernierTest.dateTest, resultat: dernierTest.resultatTest }
        : null,
      sauvegardes: sauvegardes.map((sauvegarde) => ({
        ...sauvegarde,
        disponible: existsSync(join(this.dossier, sauvegarde.fichier)),
      })),
    };
  }

  private async fichierDe(id: string) {
    const sauvegarde = await this.prisma.sauvegarde.findUnique({
      where: { id },
    });
    if (!sauvegarde) throw new NotFoundException('Sauvegarde introuvable');
    const chemin = join(this.dossier, sauvegarde.fichier);
    if (sauvegarde.statut !== 'REUSSIE' || !existsSync(chemin))
      throw new NotFoundException(
        "Le fichier de cette sauvegarde n'est plus disponible sur le serveur",
      );
    return { sauvegarde, chemin };
  }

  async telecharger(id: string) {
    return this.fichierDe(id);
  }

  // Restaure le fichier dans une base jetable et vérifie que tout y est.
  async tester(id: string) {
    const { sauvegarde, chemin } = await this.fichierDe(id);
    let resultat: string;
    let reussi = false;
    try {
      const bilan = await testerRestauration(
        this.url,
        chemin,
        join(process.cwd(), 'prisma', 'migrations'),
      );
      reussi = bilan.ecarts.length === 0;
      resultat = reussi
        ? `Restauration réussie : ${bilan.lignes.toLocaleString('fr-FR')} lignes dans ${bilan.tables} tables, identiques à la sauvegarde`
        : `Écarts constatés : ${bilan.ecarts.slice(0, 5).join(' · ')}`;
    } catch (error) {
      resultat = `Restauration impossible : ${error instanceof Error ? error.message : String(error)}`;
    }
    await this.prisma.sauvegarde.update({
      where: { id: sauvegarde.id },
      data: { dateTest: new Date(), resultatTest: resultat.slice(0, 500) },
    });
    return { reussi, resultat };
  }
}
