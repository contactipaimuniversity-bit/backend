import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCandidaturePersonnelDto } from './dto/create-candidature-personnel.dto';
import { SearchCandidaturesPersonnelDto } from './dto/search-candidatures-personnel.dto';
import { UpdateCandidaturePersonnelDto } from './dto/update-candidature-personnel.dto';
import { UpdateElementPersonnelDto } from './dto/update-element-personnel.dto';

const STATUTS = ['DEPOSE', 'ENTRETIEN_PROGRAMME', 'ENTRETIEN_REALISE', 'RETENU', 'REFUSE'] as const;
const ELEMENT_STATUTS = ['ATTENDU', 'FOURNI', 'MANQUANT'] as const;
type Statut = (typeof STATUTS)[number];
type ElementStatut = (typeof ELEMENT_STATUTS)[number];

@Injectable()
export class CandidaturesPersonnelService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCandidaturePersonnelDto) {
    const nom = this.required(dto.nom, 'nom');
    const prenom = this.required(dto.prenom, 'prenom');
    const diplome = this.required(dto.diplome, 'diplome');
    const fonction = this.required(dto.fonction, 'fonction');
    const dateNaissance = this.date(dto.dateNaissance);
    const elements = (dto.elements ?? []).map((item) => this.required(item, 'element'));
    return this.prisma.candidaturePersonnel.create({
      data: {
        nom,
        prenom,
        diplome,
        fonction,
        quartier: this.optional(dto.quartier),
        dateNaissance,
        elementsDossier: {
          create: elements.map((nomElement) => ({ nom: nomElement })),
        },
      },
      include: { elementsDossier: true },
    });
  }

  async findAll(search: SearchCandidaturesPersonnelDto) {
    const page = this.pagination(search.page, 1);
    const limit = this.pagination(search.limit, 20, 100);
    const query = this.optional(search.q);
    const where: { statut?: Statut; OR?: Array<Record<string, unknown>> } = {};
    if (search.statut) where.statut = this.parse(search.statut, STATUTS, 'statut');
    if (query) {
      where.OR = [
        { nom: { contains: query, mode: 'insensitive' } },
        { prenom: { contains: query, mode: 'insensitive' } },
        { diplome: { contains: query, mode: 'insensitive' } },
        { fonction: { contains: query, mode: 'insensitive' } },
        { quartier: { contains: query, mode: 'insensitive' } },
      ];
    }
    const [total, data] = await this.prisma.$transaction([
      this.prisma.candidaturePersonnel.count({ where }),
      this.prisma.candidaturePersonnel.findMany({
        where,
        include: { elementsDossier: true },
        orderBy: { dateDepot: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async update(id: string, dto: UpdateCandidaturePersonnelDto) {
    await this.exists(id);
    const statut = dto.statut ? this.parse(dto.statut, STATUTS, 'statut') : undefined;
    const dateEntretien = dto.dateEntretien === undefined ? undefined : this.date(dto.dateEntretien);
    const dateNaissance = dto.dateNaissance === undefined ? undefined : this.date(dto.dateNaissance);
    return this.prisma.candidaturePersonnel.update({
      where: { id },
      data: {
        nom: dto.nom === undefined ? undefined : this.required(dto.nom, 'nom'),
        prenom: dto.prenom === undefined ? undefined : this.required(dto.prenom, 'prenom'),
        diplome: dto.diplome === undefined ? undefined : this.required(dto.diplome, 'diplome'),
        fonction: dto.fonction === undefined ? undefined : this.required(dto.fonction, 'fonction'),
        quartier: dto.quartier === undefined ? undefined : this.optional(dto.quartier),
        dateNaissance,
        statut,
        dateEntretien,
        equipeEntretien: dto.equipeEntretien === undefined ? undefined : this.optional(dto.equipeEntretien),
        remarques: dto.remarques === undefined ? undefined : this.optional(dto.remarques),
      },
      include: { elementsDossier: true },
    });
  }

  async updateElement(id: string, elementId: string, dto: UpdateElementPersonnelDto) {
    await this.exists(id);
    const statut = this.parse(dto.statut, ELEMENT_STATUTS, 'statut') as ElementStatut;
    const element = await this.prisma.elementPersonnel.findFirst({ where: { id: elementId, candidaturePersonnelId: id } });
    if (!element) throw new NotFoundException('Element du dossier personnel introuvable');
    return this.prisma.elementPersonnel.update({
      where: { id: elementId },
      data: { statut, dateFourniture: statut === 'FOURNI' ? new Date() : null },
    });
  }

  private async exists(id: string) {
    const item = await this.prisma.candidaturePersonnel.findUnique({ where: { id }, select: { id: true } });
    if (!item) throw new NotFoundException('Candidature personnel introuvable');
  }

  private required(value: string | undefined, field: string) {
    const normalized = value?.trim();
    if (!normalized) throw new BadRequestException(`${field} est obligatoire`);
    return normalized;
  }

  private optional(value: string | null | undefined) {
    if (value === null || value === undefined) return null;
    const normalized = value.trim();
    return normalized || null;
  }

  private date(value: string | null | undefined) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('date invalide');
    return parsed;
  }

  private pagination(value: string | undefined, fallback: number, maximum = 1000) {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException('Paramètres de pagination invalides');
    return Math.min(parsed, maximum);
  }

  private parse<const T extends readonly string[]>(value: string, values: T, field: string): T[number] {
    const normalized = value.trim().toUpperCase();
    if (!values.includes(normalized as T[number])) throw new BadRequestException(`${field} invalide`);
    return normalized as T[number];
  }
}
