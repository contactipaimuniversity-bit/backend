import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Acteur, peut } from '../common/acteur';
import { choix, texteRequis } from '../common/saisie';
import { CloudinaryService, FichierRecu } from '../fichiers/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';

const CIBLES = [
  'PERSONNE',
  'DEMANDE_BOURSE',
  'INSCRIPTION',
  'EMPLOYE',
] as const;
type Cible = (typeof CIBLES)[number];
type Body = Record<string, unknown>;

// Pièces numérisées des dossiers (étudiants et personnel).
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // Les pièces d'un dossier suivent les droits de ce dossier.
  private exigerAcces(cible: Cible, acteur: Acteur, mode: 'view' | 'edit') {
    const zones =
      cible === 'EMPLOYE'
        ? ['hr']
        : cible === 'DEMANDE_BOURSE'
          ? ['scholarships']
          : cible === 'INSCRIPTION'
            ? ['enrollments', 'academics']
            : ['people', 'scholarships', 'enrollments'];
    const autorise = zones.some(
      (zone) =>
        peut(acteur, `${mode}:${zone}`) ||
        (mode === 'view' && zone !== 'hr' && peut(acteur, 'view:certificates')),
    );
    if (!autorise)
      throw new ForbiddenException(
        'Les pièces de ce dossier ne vous sont pas accessibles',
      );
  }

  private async exigerCible(cible: Cible, id: string) {
    const existe =
      cible === 'EMPLOYE'
        ? await this.prisma.employe.count({ where: { id } })
        : cible === 'DEMANDE_BOURSE'
          ? await this.prisma.demandeBourse.count({ where: { id } })
          : cible === 'INSCRIPTION'
            ? await this.prisma.inscription.count({ where: { id } })
            : await this.prisma.personne.count({ where: { id } });
    if (!existe) throw new NotFoundException('Dossier introuvable');
  }

  async lister(rawCible: string, id: string, acteur: Acteur) {
    const cible = choix(rawCible, CIBLES, 'Le type de dossier');
    this.exigerAcces(cible, acteur, 'view');
    return this.prisma.documentArchive.findMany({
      where: { cibleType: cible, cibleId: id },
      orderBy: { date: 'desc' },
    });
  }

  async ajouter(
    rawCible: string,
    id: string,
    body: Body,
    fichier: FichierRecu | undefined,
    acteur: Acteur,
  ) {
    const cible = choix(rawCible, CIBLES, 'Le type de dossier');
    this.exigerAcces(cible, acteur, 'edit');
    await this.exigerCible(cible, id);
    const categorie = texteRequis(
      body.categorie,
      'La nature de la pièce',
      2,
      120,
    );
    const elementDossierId =
      typeof body.elementDossierId === 'string' && body.elementDossierId
        ? body.elementDossierId
        : null;
    if (elementDossierId) {
      // La pièce numérisée doit appartenir au dossier auquel on la rattache.
      const element = await this.prisma.elementDossier.findUnique({
        where: { id: elementDossierId },
      });
      const attendu =
        cible === 'DEMANDE_BOURSE'
          ? element?.demandeBourseId
          : cible === 'INSCRIPTION'
            ? element?.inscriptionId
            : null;
      if (!element || attendu !== id)
        throw new BadRequestException(
          'Cette pièce ne fait pas partie de ce dossier',
        );
    }
    const heberge = await this.cloudinary.envoyer(
      this.cloudinary.verifier(fichier, 'Pièce numérisée'),
      `ipaim/archives/${cible.toLowerCase()}/${id}`,
    );
    await this.prisma.documentArchive.create({
      data: {
        cibleType: cible,
        cibleId: id,
        elementDossierId,
        categorie,
        ...heberge,
        ajouteParId: acteur.id,
        ajouteParNom: acteur.nom,
      },
    });
    return this.lister(cible, id, acteur);
  }

  // Le retrait d'une pièce archivée est motivé ; le motif reste dans le journal d'audit.
  async retirer(documentId: string, body: Body, acteur: Acteur) {
    const document = await this.prisma.documentArchive.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException('Pièce introuvable');
    const cible = document.cibleType as Cible;
    this.exigerAcces(cible, acteur, 'edit');
    texteRequis(body.motif, 'Le motif du retrait', 5, 300);
    await this.prisma.documentArchive.delete({ where: { id: documentId } });
    void this.cloudinary.supprimer(document.publicId, document.typeRessource);
    return this.lister(cible, document.cibleId, acteur);
  }
}
