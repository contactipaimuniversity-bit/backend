import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProspectDto } from './dto/create-prospect.dto';
import { CreateThemeDto } from './dto/create-theme.dto';
import { SearchProspectsDto } from './dto/search-prospects.dto';
import { UpdateProspectDto } from './dto/update-prospect.dto';

const STATUTS_RELANCE = [
  'A_RELANCER',
  'RELANCE',
  'CONVERTI',
  'ABANDONNE',
] as const;

type StatutRelanceValue = (typeof STATUTS_RELANCE)[number];

@Injectable()
export class ProspectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateProspectDto, creeParId: string) {
    const statutRelance = this.parseStatut(
      createDto.statutRelance || 'A_RELANCER',
    );
    const telephone = this.optionalString(createDto.telephone);
    const nom = this.optionalString(createDto.nom);
    const prenom = this.optionalString(createDto.prenom);

    const prospect = await this.prisma.$transaction(async (transaction) => {
      let personne;

      if (createDto.personneId) {
        personne = await transaction.personne.findUnique({
          where: { id: createDto.personneId },
        });

        if (!personne) {
          throw new NotFoundException('Personne introuvable');
        }
      } else {
        if (!nom || !prenom) {
          throw new BadRequestException(
            'nom et prenom sont obligatoires si personneId est absent',
          );
        }

        personne = telephone
          ? await transaction.personne.findFirst({
              where: { telephone },
            })
          : await transaction.personne.findFirst({
              where: {
                nom: { equals: nom, mode: 'insensitive' },
                prenom: { equals: prenom, mode: 'insensitive' },
              },
            });

        if (!personne) {
          personne = await transaction.personne.create({
            data: {
              nom,
              prenom,
              telephone,
              quartier: this.optionalString(createDto.quartier),
              dateNaissance: this.optionalDate(
                createDto.dateNaissance,
                'dateNaissance',
              ),
              lieuNaissance: this.optionalString(createDto.lieuNaissance),
              tuteurNom: this.optionalString(createDto.tuteurNom),
              tuteurPrenom: this.optionalString(createDto.tuteurPrenom),
              tuteurTelephone: this.optionalString(createDto.tuteurTelephone),
              creePar: { connect: { id: creeParId } },
            },
          });
        }
      }

      const existingProspect = await transaction.prospect.findUnique({
        where: { personneId: personne.id },
      });

      if (existingProspect) {
        throw new ConflictException('Cette personne est deja un prospect');
      }

      return transaction.prospect.create({
        data: {
          personneId: personne.id,
          filiereSouhaitee: this.optionalString(createDto.filiereSouhaitee),
          intention: this.optionalString(createDto.intention),
          statutRelance,
        },
        include: {
          personne: true,
          themes: true,
        },
      });
    });

    return prospect;
  }

  async findAll(search: SearchProspectsDto) {
    const page = this.parsePagination(search.page, 1);
    const limit = this.parsePagination(search.limit, 20, 100);
    const query = this.optionalString(search.q);
    const where: {
      statutRelance?: StatutRelanceValue;
      OR?: Array<Record<string, unknown>>;
    } = {};

    if (search.statutRelance) {
      where.statutRelance = this.parseStatut(search.statutRelance);
    }
    if (query) {
      where.OR = [
        { filiereSouhaitee: { contains: query, mode: 'insensitive' } },
        { intention: { contains: query, mode: 'insensitive' } },
        { personne: { nom: { contains: query, mode: 'insensitive' } } },
        { personne: { prenom: { contains: query, mode: 'insensitive' } } },
        { personne: { telephone: { contains: query, mode: 'insensitive' } } },
      ];
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.prospect.count({ where }),
      this.prisma.prospect.findMany({
        where,
        include: { personne: true, themes: true },
        orderBy: [{ personne: { nom: 'asc' } }, { personne: { prenom: 'asc' } }],
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

  findToRelance() {
    return this.prisma.prospect.findMany({
      where: { statutRelance: 'A_RELANCER' },
      include: { personne: true, themes: true },
      orderBy: [
        { intention: { sort: 'asc', nulls: 'last' } },
        { personne: { nom: 'asc' } },
        { personne: { prenom: 'asc' } },
      ],
    });
  }

  async findOne(id: string) {
    const prospect = await this.prisma.prospect.findUnique({
      where: { id },
      include: {
        personne: true,
        themes: { orderBy: { date: 'asc' } },
      },
    });

    if (!prospect) {
      throw new NotFoundException('Prospect introuvable');
    }

    return prospect;
  }

  async update(id: string, updateDto: UpdateProspectDto) {
    const data: {
      filiereSouhaitee?: string | null;
      intention?: string | null;
      statutRelance?: StatutRelanceValue;
    } = {};
    const personneData: Record<string, unknown> = {};

    if (updateDto.filiereSouhaitee !== undefined) {
      data.filiereSouhaitee = this.optionalString(updateDto.filiereSouhaitee);
    }
    if (updateDto.intention !== undefined) {
      data.intention = this.optionalString(updateDto.intention);
    }
    if (updateDto.statutRelance !== undefined) {
      data.statutRelance = this.parseStatut(updateDto.statutRelance);
    }
    if (updateDto.nom !== undefined) {
      personneData.nom = this.requiredString(updateDto.nom, 'nom');
    }
    if (updateDto.prenom !== undefined) {
      personneData.prenom = this.requiredString(updateDto.prenom, 'prenom');
    }
    if (updateDto.telephone !== undefined) {
      personneData.telephone = this.optionalString(updateDto.telephone);
    }
    if (updateDto.quartier !== undefined) {
      personneData.quartier = this.optionalString(updateDto.quartier);
    }
    if (updateDto.dateNaissance !== undefined) {
      personneData.dateNaissance = this.optionalDate(updateDto.dateNaissance, 'dateNaissance');
    }
    if (updateDto.lieuNaissance !== undefined) {
      personneData.lieuNaissance = this.optionalString(updateDto.lieuNaissance);
    }
    if (updateDto.tuteurNom !== undefined) {
      personneData.tuteurNom = this.optionalString(updateDto.tuteurNom);
    }
    if (updateDto.tuteurPrenom !== undefined) {
      personneData.tuteurPrenom = this.optionalString(updateDto.tuteurPrenom);
    }
    if (updateDto.tuteurTelephone !== undefined) {
      personneData.tuteurTelephone = this.optionalString(updateDto.tuteurTelephone);
    }

    if (Object.keys(data).length === 0 && Object.keys(personneData).length === 0) {
      throw new BadRequestException('Aucune information a modifier');
    }

    return this.prisma.$transaction(async (transaction) => {
      const prospect = await transaction.prospect.findUnique({
        where: { id },
        select: { id: true, personneId: true },
      });
      if (!prospect) {
        throw new NotFoundException('Prospect introuvable');
      }
      if (Object.keys(personneData).length > 0) {
        await transaction.personne.update({
          where: { id: prospect.personneId },
          data: personneData,
        });
      }
      if (Object.keys(data).length > 0) {
        await transaction.prospect.update({ where: { id }, data });
      }
      return transaction.prospect.findUnique({
        where: { id },
        include: { personne: true, themes: true },
      });
    });
  }

  async addTheme(id: string, createDto: CreateThemeDto) {
    await this.ensureExists(id);
    const theme = this.requiredString(createDto.theme, 'theme');

    return this.prisma.themeDiscussion.create({
      data: {
        prospectId: id,
        theme,
      },
    });
  }

  async findThemes(id: string) {
    await this.ensureExists(id);

    return this.prisma.themeDiscussion.findMany({
      where: { prospectId: id },
      orderBy: { date: 'asc' },
    });
  }

  private async ensureExists(id: string): Promise<void> {
    const exists = await this.prisma.prospect.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('Prospect introuvable');
    }
  }

  private parseStatut(value: string): StatutRelanceValue {
    const normalized = value.trim().toUpperCase();

    if (!STATUTS_RELANCE.includes(normalized as StatutRelanceValue)) {
      throw new BadRequestException(
        `statutRelance doit etre parmi: ${STATUTS_RELANCE.join(', ')}`,
      );
    }

    return normalized as StatutRelanceValue;
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
}
