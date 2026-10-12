import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CloudinaryService } from '../fichiers/cloudinary.service';
import type { FichierRecu } from '../fichiers/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';
import { refuserSuppressionScolarite } from '../common/scolarite-guard';
import { CreatePersonneDto } from './dto/create-personne.dto';
import { SearchPersonnesDto } from './dto/search-personnes.dto';
import { UpdatePersonneDto } from './dto/update-personne.dto';
import {
  requiredDeletionReason,
  toTrashSnapshot,
} from '../corbeille/corbeille.utils';
import { parseDateOrder } from '../common/date-order';

@Injectable()
export class PersonnesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async create(
    createDto: CreatePersonneDto,
    creeParId: string,
    dateSaisie?: Date,
  ) {
    const nom = this.requiredString(createDto.nom, 'nom');
    const prenom = this.requiredString(createDto.prenom, 'prenom');

    return this.prisma.personne.create({
      data: {
        nom,
        prenom,
        telephone: this.optionalString(createDto.telephone),
        quartier: this.optionalString(createDto.quartier),
        dateNaissance: this.optionalDate(
          createDto.dateNaissance,
          'dateNaissance',
        ),
        lieuNaissance: this.optionalString(createDto.lieuNaissance),
        sexe: this.sexe(createDto.sexe),
        tuteurNom: this.optionalString(createDto.tuteurNom),
        tuteurPrenom: this.optionalString(createDto.tuteurPrenom),
        tuteurTelephone: this.optionalString(createDto.tuteurTelephone),
        creePar: { connect: { id: creeParId } },
        ...(dateSaisie ? { dateEnregistrement: dateSaisie } : {}),
      },
    });
  }

  async findAll(search: SearchPersonnesDto) {
    const page = this.parsePagination(search.page, 1);
    const limit = this.parsePagination(search.limit, 20, 100);
    const query = this.optionalString(search.q);
    const nom = this.optionalString(search.nom);
    const telephone = this.optionalString(search.telephone);
    const quartier = this.optionalString(search.quartier);
    const ordreDate = parseDateOrder(search.ordreDate);

    const where: {
      OR?: Array<Record<string, unknown>>;
      telephone?: { contains: string; mode: 'insensitive' };
      quartier?: { contains: string; mode: 'insensitive' };
    } = {};
    if (nom) {
      where.OR = [
        { nom: { contains: nom, mode: 'insensitive' } },
        { prenom: { contains: nom, mode: 'insensitive' } },
      ];
    }
    if (query) {
      where.OR = [
        { nom: { contains: query, mode: 'insensitive' } },
        { prenom: { contains: query, mode: 'insensitive' } },
        { telephone: { contains: query, mode: 'insensitive' } },
        { quartier: { contains: query, mode: 'insensitive' } },
        { matricule: { contains: query, mode: 'insensitive' } },
      ];
    }
    if (telephone) {
      where.telephone = { contains: telephone, mode: 'insensitive' };
    }
    if (quartier) {
      where.quartier = { contains: quartier, mode: 'insensitive' };
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.personne.count({ where }),
      this.prisma.personne.findMany({
        where,
        orderBy: [{ dateEnregistrement: ordreDate }, { id: ordreDate }],
        select: this.personneSelect(),
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private parsePagination(
    value: string | undefined,
    fallback: number,
    maximum = 1000,
  ): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(
        'Les paramètres de pagination sont invalides',
      );
    }
    return Math.min(parsed, maximum);
  }

  async findOne(id: string) {
    const personne = await this.prisma.personne.findUnique({
      where: { id },
      include: {
        prospect: {
          include: {
            themes: { orderBy: { date: 'asc' } },
          },
        },
        demandesBourse: {
          include: { typeBourse: true },
          orderBy: { dateDepot: 'desc' },
        },
        inscriptions: {
          orderBy: { dateInscription: 'desc' },
        },
      },
    });

    if (!personne) {
      throw new NotFoundException('Personne introuvable');
    }

    return personne;
  }

  async update(id: string, updateDto: UpdatePersonneDto) {
    await this.ensureExists(id);

    const data: Record<string, unknown> = {};

    if (updateDto.nom !== undefined) {
      data.nom = this.requiredString(updateDto.nom, 'nom');
    }
    if (updateDto.prenom !== undefined) {
      data.prenom = this.requiredString(updateDto.prenom, 'prenom');
    }
    if (updateDto.telephone !== undefined) {
      data.telephone = this.optionalString(updateDto.telephone);
    }
    if (updateDto.quartier !== undefined) {
      data.quartier = this.optionalString(updateDto.quartier);
    }
    if (updateDto.dateNaissance !== undefined) {
      data.dateNaissance = this.optionalDate(
        updateDto.dateNaissance,
        'dateNaissance',
      );
    }
    if (updateDto.lieuNaissance !== undefined) {
      data.lieuNaissance = this.optionalString(updateDto.lieuNaissance);
    }
    if (updateDto.sexe !== undefined) data.sexe = this.sexe(updateDto.sexe);
    if (updateDto.tuteurNom !== undefined) {
      data.tuteurNom = this.optionalString(updateDto.tuteurNom);
    }
    if (updateDto.tuteurPrenom !== undefined) {
      data.tuteurPrenom = this.optionalString(updateDto.tuteurPrenom);
    }
    if (updateDto.tuteurTelephone !== undefined) {
      data.tuteurTelephone = this.optionalString(updateDto.tuteurTelephone);
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Aucune information a modifier');
    }

    return this.prisma.personne.update({
      where: { id },
      data,
    });
  }

  // La photo est facultative : une personne sans photo reste un dossier valide.
  async definirPhoto(id: string, fichier: FichierRecu | undefined) {
    const personne = await this.prisma.personne.findUnique({
      where: { id },
      select: { photoPublicId: true },
    });
    if (!personne) throw new NotFoundException('Personne introuvable');
    const recu = this.cloudinary.verifier(fichier, 'Photo');
    if (!recu.mimetype.startsWith('image/'))
      throw new BadRequestException(
        'Photo : seules les images JPG, PNG ou WEBP sont acceptées',
      );
    const heberge = await this.cloudinary.envoyer(recu, `ipaim/photos/${id}`);
    const resultat = await this.prisma.personne.update({
      where: { id },
      data: { photoUrl: heberge.url, photoPublicId: heberge.publicId },
      select: this.personneSelect(),
    });
    if (personne.photoPublicId)
      void this.cloudinary.supprimer(personne.photoPublicId, 'image');
    return resultat;
  }

  async lirePhoto(id: string) {
    const personne = await this.prisma.personne.findUnique({
      where: { id },
      select: { photoUrl: true, photoPublicId: true },
    });
    if (!personne?.photoUrl || !personne.photoPublicId)
      throw new NotFoundException('Aucune photo pour cette personne');
    const format = /\.(jpe?g|png|webp)$/i.exec(personne.photoUrl)?.[1] ?? 'jpg';
    return this.cloudinary.telechargerImage(
      personne.photoPublicId,
      format.toLowerCase(),
    );
  }

  async retirerPhoto(id: string) {
    const personne = await this.prisma.personne.findUnique({
      where: { id },
      select: { photoPublicId: true },
    });
    if (!personne) throw new NotFoundException('Personne introuvable');
    const resultat = await this.prisma.personne.update({
      where: { id },
      data: { photoUrl: null, photoPublicId: null },
      select: this.personneSelect(),
    });
    if (personne.photoPublicId)
      void this.cloudinary.supprimer(personne.photoPublicId, 'image');
    return resultat;
  }

  async remove(id: string, rawReason: string, deletedById: string) {
    const motif = requiredDeletionReason(rawReason);
    return this.prisma.$transaction(async (transaction) => {
      const personne = await transaction.personne.findUnique({ where: { id } });
      if (!personne) throw new NotFoundException('Personne introuvable');

      const prospect = await transaction.prospect.findUnique({
        where: { personneId: id },
        include: { themes: true, relances: true },
      });
      const demandes = await transaction.demandeBourse.findMany({
        where: { personneId: id },
        include: {
          typeBourse: { include: { echeances: true } },
          elementsDossier: {
            include: {
              elementRequis: true,
              elementSubstitutUtilise: true,
              paiements: { include: { echeance: true } },
            },
          },
        },
      });
      const demandeIds = demandes.map((demande) => demande.id);
      await refuserSuppressionScolarite(transaction, {
        OR: [{ personneId: id }, { demandeBourseId: { in: demandeIds } }],
      });
      const inscriptions = await transaction.inscription.findMany({
        where: {
          OR: [{ personneId: id }, { demandeBourseId: { in: demandeIds } }],
        },
        include: {
          demandeBourse: { include: { typeBourse: true } },
          elementsDossier: {
            include: {
              elementRequis: true,
              elementSubstitutUtilise: true,
              paiements: { include: { echeance: true } },
            },
          },
        },
      });
      const inscriptionIds = inscriptions.map((inscription) => inscription.id);
      const elements = await transaction.elementDossier.findMany({
        where: {
          OR: [
            { demandeBourseId: { in: demandeIds } },
            { inscriptionId: { in: inscriptionIds } },
          ],
        },
        include: {
          elementRequis: true,
          elementSubstitutUtilise: true,
          paiements: { include: { echeance: true } },
        },
      });
      const elementIds = elements.map((element) => element.id);
      const paiements = await transaction.paiement.findMany({
        where: {
          OR: [
            { demandeBourseId: { in: demandeIds } },
            { inscriptionId: { in: inscriptionIds } },
            { elementDossierId: { in: elementIds } },
          ],
        },
        include: {
          echeance: true,
          elementDossier: { include: { elementRequis: true } },
        },
      });
      const author = await transaction.utilisateur.findUnique({
        where: { id: deletedById },
        select: { id: true, nom: true, prenom: true },
      });

      await transaction.elementCorbeille.create({
        data: {
          type: 'PERSONNE',
          entiteId: id,
          libelle: `${personne.prenom} ${personne.nom}`,
          motif,
          supprimeParId: author?.id ?? deletedById,
          supprimeParNom:
            [author?.prenom, author?.nom].filter(Boolean).join(' ') ||
            'Utilisateur inconnu',
          donnees: toTrashSnapshot({
            personne,
            prospect,
            demandesBourse: demandes,
            inscriptions,
            elementsDossier: elements,
            paiements,
          }),
        },
      });

      await transaction.paiement.deleteMany({
        where: {
          OR: [
            { demandeBourseId: { in: demandeIds } },
            { inscriptionId: { in: inscriptionIds } },
            { elementDossierId: { in: elementIds } },
          ],
        },
      });
      await transaction.elementDossier.deleteMany({
        where: {
          OR: [
            { demandeBourseId: { in: demandeIds } },
            { inscriptionId: { in: inscriptionIds } },
          ],
        },
      });
      await transaction.inscription.deleteMany({
        where: { id: { in: inscriptionIds } },
      });
      await transaction.demandeBourse.deleteMany({
        where: { id: { in: demandeIds } },
      });
      if (prospect) {
        await transaction.themeDiscussion.deleteMany({
          where: { prospectId: prospect.id },
        });
        await transaction.prospect.delete({ where: { id: prospect.id } });
      }
      await transaction.personne.delete({ where: { id } });
      return { id };
    });
  }

  async historique(id: string) {
    const personne = await this.prisma.personne.findUnique({
      where: { id },
      select: {
        id: true,
        nom: true,
        prenom: true,
        telephone: true,
        quartier: true,
        dateNaissance: true,
        lieuNaissance: true,
        sexe: true,
        matricule: true,
        tuteurNom: true,
        tuteurPrenom: true,
        tuteurTelephone: true,
        dateEnregistrement: true,
        prospect: {
          include: {
            themes: { orderBy: { date: 'asc' } },
          },
        },
        demandesBourse: {
          include: { typeBourse: true },
          orderBy: { dateDepot: 'asc' },
        },
        inscriptions: {
          orderBy: { dateInscription: 'asc' },
        },
      },
    });

    if (!personne) {
      throw new NotFoundException('Personne introuvable');
    }

    return {
      personne: {
        id: personne.id,
        nom: personne.nom,
        prenom: personne.prenom,
        telephone: personne.telephone,
        quartier: personne.quartier,
        dateNaissance: personne.dateNaissance,
        lieuNaissance: personne.lieuNaissance,
        tuteurNom: personne.tuteurNom,
        tuteurPrenom: personne.tuteurPrenom,
        tuteurTelephone: personne.tuteurTelephone,
        dateEnregistrement: personne.dateEnregistrement,
      },
      parcours: {
        prospect: personne.prospect,
        demandesBourse: personne.demandesBourse,
        inscriptions: personne.inscriptions,
      },
    };
  }

  private async ensureExists(id: string): Promise<void> {
    const exists = await this.prisma.personne.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('Personne introuvable');
    }
  }

  // Même nom et même prénom, sans tenir compte de la casse. Quand la date de
  // naissance ou le téléphone sont connus des deux côtés, l'un des deux doit
  // concorder : deux homonymes nés à des dates différentes ne sont pas signalés.
  async doublons(criteres: {
    nom?: string;
    prenom?: string;
    dateNaissance?: string;
    telephone?: string;
    exclure?: string;
  }) {
    const nom = criteres.nom?.trim();
    const prenom = criteres.prenom?.trim();
    if (!nom || !prenom) return [];
    const telephone = criteres.telephone?.replace(/\s/g, '') || null;
    const naissance = new Date(criteres.dateNaissance ?? '');
    const jour = Number.isNaN(naissance.getTime())
      ? null
      : new Date(naissance.toISOString().slice(0, 10));
    const candidats = await this.prisma.personne.findMany({
      where: {
        nom: { equals: nom, mode: 'insensitive' },
        prenom: { equals: prenom, mode: 'insensitive' },
        ...(criteres.exclure ? { id: { not: criteres.exclure } } : {}),
      },
      select: {
        id: true,
        nom: true,
        prenom: true,
        dateNaissance: true,
        telephone: true,
        matricule: true,
        quartier: true,
      },
      orderBy: { dateEnregistrement: 'desc' },
      take: 20,
    });
    return candidats
      .filter((candidat) => {
        const memeJour =
          jour && candidat.dateNaissance
            ? candidat.dateNaissance.toISOString().slice(0, 10) ===
              jour.toISOString().slice(0, 10)
            : null;
        const memeTelephone =
          telephone && candidat.telephone
            ? candidat.telephone.replace(/\s/g, '') === telephone
            : null;
        // Rien de comparable : l'homonymie seule suffit à avertir.
        if (memeJour === null && memeTelephone === null) return true;
        return memeJour === true || memeTelephone === true;
      })
      .slice(0, 5);
  }

  private requiredString(value: string | undefined, field: string): string {
    const normalized = value?.trim();

    if (!normalized) {
      throw new BadRequestException(`${field} est obligatoire`);
    }

    return normalized;
  }

  private sexe(value: string | null | undefined): string | null {
    return value === 'M' || value === 'F' ? value : null;
  }

  private optionalString(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const normalized = value.trim();
    return normalized || null;
  }

  private optionalDate(
    value: string | null | undefined,
    field: string,
  ): Date | null {
    if (value === null || value === undefined || value.trim() === '') {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} doit etre une date valide`);
    }

    return date;
  }

  private personneSelect() {
    return {
      id: true,
      nom: true,
      prenom: true,
      telephone: true,
      quartier: true,
      dateNaissance: true,
      lieuNaissance: true,
      sexe: true,
      matricule: true,
      tuteurNom: true,
      tuteurPrenom: true,
      tuteurTelephone: true,
      dateEnregistrement: true,
      photoUrl: true,
      // Version de la fiche : contrôle des modifications préparées hors ligne.
      modifieLe: true,
    } as const;
  }
}
