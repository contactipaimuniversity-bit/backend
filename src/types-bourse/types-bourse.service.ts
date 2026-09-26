import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEcheanceDto } from './dto/create-echeance.dto';
import { CreateTypeBourseDto } from './dto/create-type-bourse.dto';
import { UpdateTypeBourseDto } from './dto/update-type-bourse.dto';

@Injectable()
export class TypesBourseService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const types = await this.prisma.typeBourse.findMany({
      include: { echeances: { orderBy: { ordre: 'asc' } } },
      orderBy: { nom: 'asc' },
    });

    return types.map((type) => this.withScheduleMetadata(type));
  }

  async create(createDto: CreateTypeBourseDto) {
    const nom = this.requiredString(createDto.nom, 'nom');
    const fraisInscription = this.requiredDecimal(
      createDto.fraisInscription,
      'fraisInscription',
    );
    const tauxReduction = this.decimal(
      createDto.tauxReduction,
      'tauxReduction',
      true,
    );

    await this.ensureNameAvailable(nom);

    const type = await this.prisma.typeBourse.create({
      data: { nom, fraisInscription, tauxReduction },
      include: { echeances: { orderBy: { ordre: 'asc' } } },
    });

    return this.withScheduleMetadata(type);
  }

  async update(id: string, updateDto: UpdateTypeBourseDto) {
    await this.ensureExists(id);
    const data: {
      nom?: string;
      fraisInscription?: string;
      tauxReduction?: string | null;
    } = {};

    if (updateDto.nom !== undefined) {
      const nom = this.requiredString(updateDto.nom, 'nom');
      await this.ensureNameAvailable(nom, id);
      data.nom = nom;
    }
    if (updateDto.fraisInscription !== undefined) {
      data.fraisInscription = this.requiredDecimal(
        updateDto.fraisInscription,
        'fraisInscription',
      );
    }
    if (updateDto.tauxReduction !== undefined) {
      data.tauxReduction = this.decimal(
        updateDto.tauxReduction,
        'tauxReduction',
        true,
      );
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Aucune information a modifier');
    }

    const type = await this.prisma.typeBourse.update({
      where: { id },
      data,
      include: { echeances: { orderBy: { ordre: 'asc' } } },
    });

    return this.withScheduleMetadata(type);
  }

  async findEcheances(typeBourseId: string) {
    const type = await this.prisma.typeBourse.findUnique({
      where: { id: typeBourseId },
      include: { echeances: { orderBy: { ordre: 'asc' } } },
    });

    if (!type) {
      throw new NotFoundException('Type de bourse introuvable');
    }

    return this.withScheduleMetadata(type);
  }

  async addEcheance(typeBourseId: string, createDto: CreateEcheanceDto) {
    const type = await this.prisma.typeBourse.findUnique({
      where: { id: typeBourseId },
      include: { echeances: true },
    });

    if (!type) {
      throw new NotFoundException('Type de bourse introuvable');
    }

    const libelle = this.requiredString(createDto.libelle, 'libelle');
    const ordre = this.positiveInteger(createDto.ordre, 'ordre');
    const expected = this.expectedScheduleCount(type.nom);

    if (expected !== null && ordre > expected) {
      throw new BadRequestException(
        `${type.nom} accepte au maximum ${expected} echeances`,
      );
    }
    if (expected !== null && type.echeances.length >= expected) {
      throw new BadRequestException(
        `${type.nom} est deja configure avec ${expected} echeances`,
      );
    }

    const montantAttendu = this.decimal(
      createDto.montantAttendu,
      'montantAttendu',
      true,
    );
      const dateEcheance = this.optionalDate(
        createDto.dateEcheance,
        'dateEcheance',
      );

    try {
      const echeance = await this.prisma.echeanceBourse.create({
        data: {
          typeBourseId,
          libelle,
          ordre,
          montantAttendu,
            dateEcheance,
        },
      });

      return echeance;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `L'ordre ${ordre} est deja utilise pour ce type de bourse`,
        );
      }
      throw error;
    }
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
  private async ensureExists(id: string): Promise<void> {
    const type = await this.prisma.typeBourse.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!type) {
      throw new NotFoundException('Type de bourse introuvable');
    }
  }

  private async ensureNameAvailable(nom: string, currentId?: string) {
    const existing = await this.prisma.typeBourse.findFirst({
      where: {
        nom: { equals: nom, mode: 'insensitive' },
        ...(currentId ? { NOT: { id: currentId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Ce nom de type de bourse existe deja');
    }
  }

  private withScheduleMetadata<
    T extends { nom: string; echeances: unknown[] },
  >(type: T) {
    return {
      ...type,
      echeancesAttendues: this.expectedScheduleCount(type.nom),
      echeancesConfigurees: type.echeances.length,
    };
  }

  private expectedScheduleCount(nom: string): number | null {
    const normalized = nom.trim().toLowerCase();
    if (normalized === 'excellence') {
      return 3;
    }
    if (normalized === 'premium') {
      return 10;
    }
    return null;
  }

  private requiredString(value: string | undefined, field: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException(`${field} est obligatoire`);
    }
    return normalized;
  }

  private positiveInteger(value: number | undefined, field: string): number {
    if (value === undefined || !Number.isInteger(value) || value < 1) {
      throw new BadRequestException(`${field} doit etre un entier positif`);
    }
    return value;
  }

  private requiredDecimal(
    value: string | number | null | undefined,
    field: string,
  ): string {
    const decimal = this.decimal(value, field, false);
    if (decimal === null) {
      throw new BadRequestException(`${field} est obligatoire`);
    }
    return decimal;
  }

  private decimal(
    value: string | number | null | undefined,
    field: string,
    nullable: boolean,
  ): string | null {
    if (value === null || value === undefined || value === '') {
      if (nullable) {
        return null;
      }
      throw new BadRequestException(`${field} est obligatoire`);
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new BadRequestException(`${field} doit etre un montant positif`);
    }

    if (field === 'tauxReduction' && parsed > 100) {
      throw new BadRequestException('tauxReduction doit etre compris entre 0 et 100');
    }

    if (!/^\d+(\.\d{1,2})?$/.test(String(value))) {
      throw new BadRequestException(`${field} doit avoir au maximum 2 decimales`);
    }

    return parsed.toFixed(2);
  }
}
