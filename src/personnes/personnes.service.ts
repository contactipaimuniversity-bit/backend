import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePersonneDto } from './dto/create-personne.dto';
import { SearchPersonnesDto } from './dto/search-personnes.dto';
import { UpdatePersonneDto } from './dto/update-personne.dto';
import { requiredDeletionReason, toTrashSnapshot } from '../corbeille/corbeille.utils';

@Injectable()
export class PersonnesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreatePersonneDto, creeParId: string) {
    const nom = this.requiredString(createDto.nom, 'nom');
    const prenom = this.requiredString(createDto.prenom, 'prenom');

    return this.prisma.personne.create({
      data: {
        nom,
        prenom,
        telephone: this.optionalString(createDto.telephone),
        quartier: this.optionalString(createDto.quartier),
        dateNaissance: this.optionalDate(createDto.dateNaissance, 'dateNaissance'),
        lieuNaissance: this.optionalString(createDto.lieuNaissance),
        tuteurNom: this.optionalString(createDto.tuteurNom),
        tuteurPrenom: this.optionalString(createDto.tuteurPrenom),
        tuteurTelephone: this.optionalString(createDto.tuteurTelephone),
        creePar: { connect: { id: creeParId } },
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
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
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
      throw new BadRequestException('Les paramètres de pagination sont invalides');
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

  async remove(id: string, rawReason: string, deletedById: string) {
    const motif = requiredDeletionReason(rawReason);
    return this.prisma.$transaction(async (transaction) => {
      const personne = await transaction.personne.findUnique({ where: { id } });
      if (!personne) throw new NotFoundException('Personne introuvable');

      const prospect = await transaction.prospect.findUnique({
        where: { personneId: id },
        include: { themes: true },
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
      const inscriptions = await transaction.inscription.findMany({
        where: {
          OR: [
            { personneId: id },
            { demandeBourseId: { in: demandeIds } },
          ],
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
        include: { echeance: true, elementDossier: { include: { elementRequis: true } } },
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
          supprimeParNom: [author?.prenom, author?.nom].filter(Boolean).join(' ') || 'Utilisateur inconnu',
          donnees: toTrashSnapshot({ personne, prospect, demandesBourse: demandes, inscriptions, elementsDossier: elements, paiements }),
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
      await transaction.inscription.deleteMany({ where: { id: { in: inscriptionIds } } });
      await transaction.demandeBourse.deleteMany({ where: { id: { in: demandeIds } } });
      if (prospect) {
        await transaction.themeDiscussion.deleteMany({ where: { prospectId: prospect.id } });
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

  private requiredString(value: string | undefined, field: string): string {
    const normalized = value?.trim();

    if (!normalized) {
      throw new BadRequestException(`${field} est obligatoire`);
    }

    return normalized;
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
      tuteurNom: true,
      tuteurPrenom: true,
      tuteurTelephone: true,
      dateEnregistrement: true,
    } as const;
  }
}
