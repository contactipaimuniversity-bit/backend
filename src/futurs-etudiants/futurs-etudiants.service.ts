import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { meta, pagination } from '../common/saisie';
import { PrismaService } from '../prisma/prisma.service';

type Body = Record<string, unknown>;

export const CLASSES_LYCEE = ['Terminale', 'Première', 'Seconde', 'Autre'];

// Freins aux envois en rafale : par adresse d'origine, puis pour tout le site.
// Une classe entière sur le même Wi-Fi partage une seule adresse : la limite
// laisse passer un groupe, pas une rafale automatique.
const ENVOIS_PAR_ADRESSE = 40;
const FENETRE_MS = 10 * 60 * 1000;
const ENVOIS_PAR_JOUR = 3000;
const JOUR_MS = 24 * 60 * 60 * 1000;

// Lettres (accents compris), espaces, apostrophes, points et traits d'union.
const NOM = /^[\p{L}][\p{L}\s'’.-]*$/u;
const LIBELLE = /^[\p{L}\p{N}][\p{L}\p{N}\s'’.,()/&°-]*$/u;

// Lycéens qui se signalent par le formulaire public. Ces fiches sont
// informatives : elles ne touchent ni aux personnes ni aux dossiers.
@Injectable()
export class FutursEtudiantsService {
  // Horodatage des derniers envois de chaque adresse d'origine.
  private readonly envois = new Map<string, number[]>();

  constructor(private readonly prisma: PrismaService) {}

  // ---------- Formulaire public ----------

  options() {
    return { classes: CLASSES_LYCEE };
  }

  private texte(
    value: unknown,
    libelle: string,
    motif: RegExp,
    min: number,
    max: number,
  ) {
    // Espaces resserrés, caractères de contrôle retirés.
    const texte = (typeof value === 'string' ? value : '')
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (texte.length < min || texte.length > max)
      throw new BadRequestException(
        `${libelle} doit compter entre ${min} et ${max} caractères`,
      );
    if (!motif.test(texte))
      throw new BadRequestException(
        `${libelle} contient des caractères non autorisés`,
      );
    return texte;
  }

  private telephone(value: unknown, libelle: string) {
    const saisie = typeof value === 'string' ? value : '';
    const chiffres = saisie.replace(/[\s().-]/g, '');
    if (!/^\+?\d{8,15}$/.test(chiffres))
      throw new BadRequestException(
        `${libelle} doit compter entre 8 et 15 chiffres`,
      );
    return chiffres;
  }

  private naissance(value: unknown) {
    const date = new Date(typeof value === 'string' ? value : '');
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(date.getTime())
    )
      throw new BadRequestException('La date de naissance est invalide');
    const age = (Date.now() - date.getTime()) / (365.25 * JOUR_MS);
    if (age < 12 || age > 45)
      throw new BadRequestException(
        'La date de naissance ne correspond pas à un élève',
      );
    return date;
  }

  // Refuse l'envoi quand une même origine, ou le site entier, en fait trop.
  private async freiner(origine: string) {
    const maintenant = Date.now();
    const recents = (this.envois.get(origine) ?? []).filter(
      (instant) => maintenant - instant < FENETRE_MS,
    );
    if (recents.length >= ENVOIS_PAR_ADRESSE)
      throw new HttpException(
        'Trop d’envois depuis cet appareil : réessayez dans quelques minutes',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    recents.push(maintenant);
    this.envois.set(origine, recents);
    // La mémoire ne garde pas indéfiniment les origines devenues inactives.
    if (this.envois.size > 5000)
      for (const [cle, instants] of this.envois)
        if (instants.every((instant) => maintenant - instant >= FENETRE_MS))
          this.envois.delete(cle);
    const duJour = await this.prisma.futurEtudiant.count({
      where: { dateEnregistrement: { gte: new Date(maintenant - JOUR_MS) } },
    });
    if (duJour >= ENVOIS_PAR_JOUR)
      throw new HttpException(
        'Le formulaire est momentanément fermé : réessayez plus tard',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  async enregistrer(body: Body, adresse: string) {
    const origine = createHash('sha256')
      .update(adresse || 'inconnue')
      .digest('hex')
      .slice(0, 24);
    await this.freiner(origine);
    // Champ invisible pour un humain : rempli, l'envoi vient d'un robot. On
    // répond comme si tout allait bien, sans rien enregistrer.
    if (typeof body.site === 'string' && body.site.trim())
      return { enregistre: true };

    // Saisie libre : l'élève décrit la filière qui l'attire avec ses mots.
    const filiereSouhaitee = this.texte(
      body.filiereSouhaitee,
      'La filière souhaitée',
      LIBELLE,
      2,
      120,
    );
    const classe = this.texte(body.classe, 'La classe', LIBELLE, 2, 30);
    if (!CLASSES_LYCEE.includes(classe))
      throw new BadRequestException("La classe choisie n'existe pas");
    if (body.sexe !== 'M' && body.sexe !== 'F')
      throw new BadRequestException('Le sexe est à préciser');
    const donnees = {
      nom: this.texte(body.nom, 'Le nom', NOM, 2, 60).toUpperCase(),
      prenom: this.texte(body.prenom, 'Le prénom', NOM, 2, 60),
      sexe: body.sexe,
      dateNaissance: this.naissance(body.dateNaissance),
      telephone:
        typeof body.telephone === 'string' && body.telephone.trim()
          ? this.telephone(body.telephone, 'Ton numéro')
          : null,
      ecole: this.texte(body.ecole, "L'établissement", LIBELLE, 2, 120),
      classe,
      serie: this.texte(body.serie, 'La série', LIBELLE, 1, 30),
      tuteurNom: this.texte(
        body.tuteurNom,
        'Le nom du tuteur',
        NOM,
        2,
        60,
      ).toUpperCase(),
      tuteurPrenom: this.texte(
        body.tuteurPrenom,
        'Le prénom du tuteur',
        NOM,
        2,
        60,
      ),
      tuteurTelephone: this.telephone(
        body.tuteurTelephone,
        'Le numéro du tuteur',
      ),
      filiereSouhaitee,
      origine,
    };
    // Un même élève qui renvoie le formulaire met sa fiche à jour : pas de doublon.
    const existant = await this.prisma.futurEtudiant.findFirst({
      where: {
        nom: { equals: donnees.nom, mode: 'insensitive' },
        prenom: { equals: donnees.prenom, mode: 'insensitive' },
        dateNaissance: donnees.dateNaissance,
        tuteurTelephone: donnees.tuteurTelephone,
      },
      select: { id: true },
    });
    if (existant)
      await this.prisma.futurEtudiant.update({
        where: { id: existant.id },
        data: donnees,
      });
    else await this.prisma.futurEtudiant.create({ data: donnees });
    // Rien d'autre ne sort : le formulaire public ne révèle aucune donnée.
    return { enregistre: true };
  }

  // ---------- Administration ----------

  async liste(query: {
    q?: string;
    filiere?: string;
    contacte?: string;
    page?: string;
    limit?: string;
  }) {
    const { page, limit, skip } = pagination(query, 50);
    const termes = (query.q ?? '').trim().split(/\s+/).filter(Boolean);
    const where = {
      // Saisie libre : « informatique » et « Informatique » sont la même filière.
      ...(query.filiere
        ? {
            filiereSouhaitee: {
              equals: query.filiere,
              mode: 'insensitive' as const,
            },
          }
        : {}),
      ...(query.contacte === 'oui'
        ? { contacte: true }
        : query.contacte === 'non'
          ? { contacte: false }
          : {}),
      AND: termes.slice(0, 4).map((terme) => ({
        OR: [
          'nom',
          'prenom',
          'ecole',
          'tuteurNom',
          'tuteurTelephone',
          'telephone',
        ].map((champ) => ({
          [champ]: { contains: terme, mode: 'insensitive' as const },
        })),
      })),
    };
    const [total, data] = await Promise.all([
      this.prisma.futurEtudiant.count({ where }),
      this.prisma.futurEtudiant.findMany({
        where,
        omit: { origine: true },
        orderBy: { dateEnregistrement: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return { data, meta: meta(page, limit, total) };
  }

  async synthese() {
    const depuis = new Date(Date.now() - 7 * JOUR_MS);
    const [total, semaine, aContacter, parFiliere, parEcole, parSexe] =
      await Promise.all([
        this.prisma.futurEtudiant.count(),
        this.prisma.futurEtudiant.count({
          where: { dateEnregistrement: { gte: depuis } },
        }),
        this.prisma.futurEtudiant.count({ where: { contacte: false } }),
        this.prisma.futurEtudiant.groupBy({
          by: ['filiereSouhaitee'],
          _count: { _all: true },
        }),
        this.prisma.futurEtudiant.groupBy({
          by: ['ecole'],
          _count: { _all: true },
        }),
        this.prisma.futurEtudiant.groupBy({
          by: ['sexe'],
          _count: { _all: true },
        }),
      ]);
    const classer = <T extends { _count: { _all: number } }>(liste: T[]) =>
      [...liste].sort((a, b) => b._count._all - a._count._all);
    return {
      total,
      semaine,
      aContacter,
      filles: parSexe.find((item) => item.sexe === 'F')?._count._all ?? 0,
      parFiliere: this.regrouper(
        classer(parFiliere).map((item) => ({
          filiere: item.filiereSouhaitee,
          total: item._count._all,
        })),
      ),
      ecoles: parEcole.length,
      parEcole: classer(parEcole)
        .slice(0, 8)
        .map((item) => ({ ecole: item.ecole, total: item._count._all })),
    };
  }

  // Les filières sont saisies librement : les écritures qui ne diffèrent que
  // par les majuscules sont comptées ensemble, sous la plus fréquente.
  private regrouper(liste: Array<{ filiere: string; total: number }>) {
    const groupes = new Map<string, { filiere: string; total: number }>();
    for (const item of liste) {
      const cle = item.filiere.toLocaleLowerCase('fr');
      const groupe = groupes.get(cle);
      if (groupe) groupe.total += item.total;
      else groupes.set(cle, { ...item });
    }
    return [...groupes.values()].sort((a, b) => b.total - a.total);
  }

  private async exiger(id: string) {
    const fiche = await this.prisma.futurEtudiant.findUnique({ where: { id } });
    if (!fiche) throw new NotFoundException('Fiche introuvable');
    return fiche;
  }

  async marquerContacte(id: string, body: Body) {
    await this.exiger(id);
    return this.prisma.futurEtudiant.update({
      where: { id },
      data: { contacte: body.contacte === true },
      omit: { origine: true },
    });
  }

  async supprimer(id: string) {
    await this.exiger(id);
    await this.prisma.futurEtudiant.delete({ where: { id } });
    return { supprime: true };
  }
}
