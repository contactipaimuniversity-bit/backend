import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Acteur } from '../common/acteur';
import {
  CloudinaryService,
  type FichierRecu,
} from '../fichiers/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';

type Corps = Record<string, unknown>;

const DOSSIER_IMAGES = 'ipaim/vitrine';
const TYPES_IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
// Les formulaires envoyés avec une image arrivent en texte : « true », « 3 »...
const vrai = (valeur: unknown) => valeur === true || valeur === 'true';

// Le carrousel de la vitrine publique : l'administration choisit les images
// et les textes ; le site n'en montre que les diapositives actives, dans l'ordre.
@Injectable()
export class VitrineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private texte(
    valeur: unknown,
    libelle: string,
    max: number,
    requis = false,
  ): string | null {
    const texte = typeof valeur === 'string' ? valeur.trim() : '';
    if (!texte) {
      if (requis) throw new BadRequestException(`${libelle} est obligatoire`);
      return null;
    }
    if (texte.length > max)
      throw new BadRequestException(
        `${libelle} ne doit pas dépasser ${max} caractères`,
      );
    return texte;
  }

  // Un lien de bouton : une page du site (/...), une ancre (#...) ou une adresse web.
  private lien(valeur: unknown): string | null {
    const lien = this.texte(valeur, 'Le lien du bouton', 300);
    if (!lien) return null;
    if (!/^(\/(?!\/)|#|https?:\/\/)/i.test(lien))
      throw new BadRequestException(
        'Le lien du bouton doit commencer par /, # ou https://',
      );
    return lien;
  }

  private verifierImage(fichier: FichierRecu | undefined) {
    if (!fichier) return undefined;
    const verifie = this.cloudinary.verifier(fichier, "L'image");
    if (!TYPES_IMAGE.includes(verifie.mimetype))
      throw new BadRequestException(
        "L'image doit être au format JPG, PNG ou WEBP",
      );
    return verifie;
  }

  private champs(body: Corps, creation: boolean) {
    const data: Record<string, unknown> = {};
    if (creation || body.titre !== undefined)
      data.titre = this.texte(body.titre, 'Le titre', 120, true);
    if (creation || body.surtitre !== undefined)
      data.surtitre = this.texte(body.surtitre, 'Le surtitre', 80);
    if (creation || body.texte !== undefined)
      data.texte = this.texte(body.texte, 'Le texte', 400);
    if (creation || body.boutonLibelle !== undefined)
      data.boutonLibelle = this.texte(
        body.boutonLibelle,
        'Le libellé du bouton',
        40,
      );
    if (creation || body.boutonLien !== undefined)
      data.boutonLien = this.lien(body.boutonLien);
    if (body.actif !== undefined) data.actif = vrai(body.actif);
    if (data.boutonLibelle && data.boutonLien === null)
      throw new BadRequestException('Indiquez le lien du bouton');
    return data;
  }

  // Ce que voit le public : l'image passe par le serveur (la diffusion directe
  // des images peut être fermée sur le compte d'hébergement).
  private publique(diapositive: {
    id: string;
    surtitre: string | null;
    titre: string;
    texte: string | null;
    boutonLibelle: string | null;
    boutonLien: string | null;
    imagePublicId: string | null;
    modifieLe: Date;
  }) {
    return {
      id: diapositive.id,
      surtitre: diapositive.surtitre,
      titre: diapositive.titre,
      texte: diapositive.texte,
      boutonLibelle: diapositive.boutonLibelle,
      boutonLien: diapositive.boutonLien,
      image: diapositive.imagePublicId
        ? `/vitrine/diapositives/${diapositive.id}/image?v=${diapositive.modifieLe.getTime()}`
        : null,
    };
  }

  async publiques() {
    const diapositives = await this.prisma.diapositiveVitrine.findMany({
      where: { actif: true },
      orderBy: [{ ordre: 'asc' }, { creeLe: 'asc' }],
    });
    return diapositives.map((item) => this.publique(item));
  }

  async liste() {
    const diapositives = await this.prisma.diapositiveVitrine.findMany({
      orderBy: [{ ordre: 'asc' }, { creeLe: 'asc' }],
    });
    return diapositives.map((item) => ({
      ...item,
      image: this.publique(item).image,
    }));
  }

  async creer(body: Corps, fichier: FichierRecu | undefined, acteur: Acteur) {
    const data = this.champs(body, true);
    const image = this.verifierImage(fichier);
    if (!image)
      throw new BadRequestException("Choisissez l'image de la diapositive");
    const heberge = await this.cloudinary.envoyer(image, DOSSIER_IMAGES);
    const dernier = await this.prisma.diapositiveVitrine.aggregate({
      _max: { ordre: true },
    });
    await this.prisma.diapositiveVitrine.create({
      data: {
        ...(data as { titre: string }),
        imagePublicId: heberge.publicId,
        imageUrl: heberge.url,
        ordre: (dernier._max.ordre ?? 0) + 1,
        creeParNom: acteur.nom,
      },
    });
    return this.liste();
  }

  private async existante(id: string) {
    const diapositive = await this.prisma.diapositiveVitrine.findUnique({
      where: { id },
    });
    if (!diapositive) throw new NotFoundException('Diapositive introuvable');
    return diapositive;
  }

  async modifier(id: string, body: Corps, fichier: FichierRecu | undefined) {
    const avant = await this.existante(id);
    const data = this.champs(body, false);
    const image = this.verifierImage(fichier);
    if (image) {
      const heberge = await this.cloudinary.envoyer(image, DOSSIER_IMAGES);
      data.imagePublicId = heberge.publicId;
      data.imageUrl = heberge.url;
    }
    await this.prisma.diapositiveVitrine.update({ where: { id }, data });
    if (image && avant.imagePublicId)
      void this.cloudinary.supprimer(avant.imagePublicId, 'image');
    return this.liste();
  }

  async supprimer(id: string) {
    const avant = await this.existante(id);
    await this.prisma.diapositiveVitrine.delete({ where: { id } });
    if (avant.imagePublicId)
      void this.cloudinary.supprimer(avant.imagePublicId, 'image');
    return this.liste();
  }

  // Nouvel ordre d'affichage : la liste complète des identifiants, dans l'ordre voulu.
  async ordonner(body: Corps) {
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((item): item is string => typeof item === 'string')
      : [];
    const existantes = await this.prisma.diapositiveVitrine.findMany({
      select: { id: true },
    });
    if (
      ids.length !== existantes.length ||
      !existantes.every((item) => ids.includes(item.id))
    )
      throw new BadRequestException(
        "L'ordre doit reprendre toutes les diapositives",
      );
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.diapositiveVitrine.update({
          where: { id },
          data: { ordre: index + 1 },
        }),
      ),
    );
    return this.liste();
  }

  async lireImage(id: string) {
    const diapositive = await this.prisma.diapositiveVitrine.findUnique({
      where: { id },
      select: { imagePublicId: true, imageUrl: true, actif: true },
    });
    if (!diapositive?.imagePublicId || !diapositive.imageUrl)
      throw new NotFoundException('Image introuvable');
    const format =
      /\.(jpe?g|png|webp)$/i.exec(diapositive.imageUrl)?.[1] ?? 'jpg';
    return this.cloudinary.telechargerImage(
      diapositive.imagePublicId,
      format.toLowerCase(),
    );
  }

  // ---------- Actualités ----------

  private jour(valeur: unknown, requis: boolean): Date | undefined {
    if (valeur === undefined || valeur === null || valeur === '') {
      if (requis)
        throw new BadRequestException('La date de publication est obligatoire');
      return undefined;
    }
    const texte = typeof valeur === 'string' ? valeur.slice(0, 10) : '';
    const date = new Date(`${texte}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texte) || Number.isNaN(date.getTime()))
      throw new BadRequestException('La date de publication est invalide');
    return date;
  }

  private champsActualite(body: Corps, creation: boolean) {
    const data: Record<string, unknown> = {};
    if (creation || body.titre !== undefined)
      data.titre = this.texte(body.titre, 'Le titre', 140, true);
    if (creation || body.categorie !== undefined)
      data.categorie = this.texte(body.categorie, 'La catégorie', 40, true);
    if (creation || body.resume !== undefined)
      data.resume = this.texte(body.resume, 'Le résumé', 320, true);
    if (creation || body.contenu !== undefined)
      data.contenu = this.texte(body.contenu, 'Le texte complet', 6000);
    const date = this.jour(body.datePublication, creation);
    if (date) data.datePublication = date;
    if (creation || body.lienLibelle !== undefined)
      data.lienLibelle = this.texte(body.lienLibelle, 'Le libellé du lien', 40);
    if (creation || body.lien !== undefined) data.lien = this.lien(body.lien);
    if (data.lienLibelle && data.lien === null)
      throw new BadRequestException('Indiquez le lien');
    if (body.aLaUne !== undefined) data.aLaUne = vrai(body.aLaUne);
    if (body.actif !== undefined) data.actif = vrai(body.actif);
    return data;
  }

  private actualitePublique(item: {
    id: string;
    categorie: string;
    titre: string;
    resume: string;
    contenu: string | null;
    datePublication: Date;
    imagePublicId: string | null;
    lienLibelle: string | null;
    lien: string | null;
    aLaUne: boolean;
    modifieLe: Date;
  }) {
    return {
      id: item.id,
      categorie: item.categorie,
      titre: item.titre,
      resume: item.resume,
      contenu: item.contenu,
      datePublication: item.datePublication,
      lienLibelle: item.lienLibelle,
      lien: item.lien,
      aLaUne: item.aLaUne,
      image: item.imagePublicId
        ? `/vitrine/actualites/${item.id}/image?v=${item.modifieLe.getTime()}`
        : null,
    };
  }

  // Les plus récentes d'abord ; celle « à la une » passe en tête.
  async actualitesPubliques() {
    const liste = await this.prisma.actualiteVitrine.findMany({
      where: { actif: true },
      orderBy: [
        { aLaUne: 'desc' },
        { datePublication: 'desc' },
        { creeLe: 'desc' },
      ],
    });
    return liste.map((item) => this.actualitePublique(item));
  }

  async actualites() {
    const liste = await this.prisma.actualiteVitrine.findMany({
      orderBy: [{ datePublication: 'desc' }, { creeLe: 'desc' }],
    });
    return liste.map((item) => ({
      ...item,
      image: this.actualitePublique(item).image,
    }));
  }

  private async actualiteExistante(id: string) {
    const item = await this.prisma.actualiteVitrine.findUnique({
      where: { id },
    });
    if (!item) throw new NotFoundException('Actualité introuvable');
    return item;
  }

  // Une seule actualité « à la une » à la fois.
  private async uneSeule(id: string, data: Record<string, unknown>) {
    if (data.aLaUne === true)
      await this.prisma.actualiteVitrine.updateMany({
        where: { aLaUne: true, id: { not: id } },
        data: { aLaUne: false },
      });
  }

  async creerActualite(
    body: Corps,
    fichier: FichierRecu | undefined,
    acteur: Acteur,
  ) {
    const data = this.champsActualite(body, true);
    const image = this.verifierImage(fichier);
    const heberge = image
      ? await this.cloudinary.envoyer(image, `${DOSSIER_IMAGES}/actualites`)
      : null;
    const cree = await this.prisma.actualiteVitrine.create({
      data: {
        ...(data as {
          titre: string;
          categorie: string;
          resume: string;
          datePublication: Date;
        }),
        imagePublicId: heberge?.publicId ?? null,
        imageUrl: heberge?.url ?? null,
        creeParNom: acteur.nom,
      },
    });
    await this.uneSeule(cree.id, data);
    return this.actualites();
  }

  async modifierActualite(
    id: string,
    body: Corps,
    fichier: FichierRecu | undefined,
  ) {
    const avant = await this.actualiteExistante(id);
    const data = this.champsActualite(body, false);
    const image = this.verifierImage(fichier);
    if (image) {
      const heberge = await this.cloudinary.envoyer(
        image,
        `${DOSSIER_IMAGES}/actualites`,
      );
      data.imagePublicId = heberge.publicId;
      data.imageUrl = heberge.url;
    } else if (vrai(body.retirerImage)) {
      data.imagePublicId = null;
      data.imageUrl = null;
    }
    await this.prisma.actualiteVitrine.update({ where: { id }, data });
    await this.uneSeule(id, data);
    if ((image || vrai(body.retirerImage)) && avant.imagePublicId)
      void this.cloudinary.supprimer(avant.imagePublicId, 'image');
    return this.actualites();
  }

  async supprimerActualite(id: string) {
    const avant = await this.actualiteExistante(id);
    await this.prisma.actualiteVitrine.delete({ where: { id } });
    if (avant.imagePublicId)
      void this.cloudinary.supprimer(avant.imagePublicId, 'image');
    return this.actualites();
  }

  async lireImageActualite(id: string) {
    const item = await this.prisma.actualiteVitrine.findUnique({
      where: { id },
      select: { imagePublicId: true, imageUrl: true },
    });
    if (!item?.imagePublicId || !item.imageUrl)
      throw new NotFoundException('Image introuvable');
    const format = /\.(jpe?g|png|webp)$/i.exec(item.imageUrl)?.[1] ?? 'jpg';
    return this.cloudinary.telechargerImage(
      item.imagePublicId,
      format.toLowerCase(),
    );
  }

  // ---------- Questions fréquentes ----------

  private champsQuestion(body: Corps, creation: boolean) {
    const data: Record<string, unknown> = {};
    if (creation || body.question !== undefined)
      data.question = this.texte(body.question, 'La question', 200, true);
    if (creation || body.reponse !== undefined)
      data.reponse = this.texte(body.reponse, 'La réponse', 1500, true);
    if (body.actif !== undefined) data.actif = vrai(body.actif);
    return data;
  }

  async questionsPubliques() {
    return this.prisma.questionVitrine.findMany({
      where: { actif: true },
      orderBy: [{ ordre: 'asc' }, { creeLe: 'asc' }],
      select: { id: true, question: true, reponse: true },
    });
  }

  async questions() {
    return this.prisma.questionVitrine.findMany({
      orderBy: [{ ordre: 'asc' }, { creeLe: 'asc' }],
    });
  }

  async creerQuestion(body: Corps) {
    const data = this.champsQuestion(body, true);
    const dernier = await this.prisma.questionVitrine.aggregate({
      _max: { ordre: true },
    });
    await this.prisma.questionVitrine.create({
      data: {
        ...(data as { question: string; reponse: string }),
        ordre: (dernier._max.ordre ?? 0) + 1,
      },
    });
    return this.questions();
  }

  async modifierQuestion(id: string, body: Corps) {
    const existe = await this.prisma.questionVitrine.findUnique({
      where: { id },
    });
    if (!existe) throw new NotFoundException('Question introuvable');
    await this.prisma.questionVitrine.update({
      where: { id },
      data: this.champsQuestion(body, false),
    });
    return this.questions();
  }

  async supprimerQuestion(id: string) {
    const existe = await this.prisma.questionVitrine.findUnique({
      where: { id },
    });
    if (!existe) throw new NotFoundException('Question introuvable');
    await this.prisma.questionVitrine.delete({ where: { id } });
    return this.questions();
  }

  async ordonnerQuestions(body: Corps) {
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((item): item is string => typeof item === 'string')
      : [];
    const existantes = await this.prisma.questionVitrine.findMany({
      select: { id: true },
    });
    if (
      ids.length !== existantes.length ||
      !existantes.every((item) => ids.includes(item.id))
    )
      throw new BadRequestException(
        "L'ordre doit reprendre toutes les questions",
      );
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.questionVitrine.update({
          where: { id },
          data: { ordre: index + 1 },
        }),
      ),
    );
    return this.questions();
  }
}
