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
}
