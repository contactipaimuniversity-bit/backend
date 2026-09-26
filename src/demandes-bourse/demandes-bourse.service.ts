import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDemandeBourseDto } from './dto/create-demande-bourse.dto';
import { SearchDemandesBourseDto } from './dto/search-demandes-bourse.dto';
import { UpdateDecisionDto } from './dto/update-decision.dto';
import { UpdateElementDossierDto } from './dto/update-element-dossier.dto';
import { UpdateEntretienDto } from './dto/update-entretien.dto';

const NIVEAUX = ['PREMIERE_ANNEE', 'DEUXIEME_ANNEE'] as const;
const STATUTS_DEMANDE = [
  'EN_ATTENTE',
  'ENTRETIEN_PROGRAMME',
  'EN_DELIBERATION',
  'ACCEPTEE',
  'REFUSEE',
] as const;
const STATUTS_ELEMENT = [
  'ATTENDU',
  'FOURNI',
  'MANQUANT',
  'SUBSTITUE',
] as const;

type NiveauValue = (typeof NIVEAUX)[number];
type StatutDemandeValue = (typeof STATUTS_DEMANDE)[number];
type StatutElementValue = (typeof STATUTS_ELEMENT)[number];

@Injectable()
export class DemandesBourseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateDemandeBourseDto) {
    const personneId = this.requiredString(createDto.personneId, 'personneId');
    const niveauDemande = this.parseValue(
      createDto.niveauDemande,
      NIVEAUX,
      'niveauDemande',
    );
    const filiereSouhaitee = this.requiredString(
      createDto.filiereSouhaitee,
      'filiereSouhaitee',
    );

    const personne = await this.prisma.personne.findUnique({
      where: { id: personneId },
      select: { id: true },
    });
    if (!personne) {
      throw new NotFoundException('Personne introuvable');
    }

    return this.prisma.$transaction(async (transaction) => {
      const catalogue = await transaction.elementRequis.findMany({
        where: {
          contexte: { in: ['BOURSE', 'TOUS'] },
          niveauApplicable:
            niveauDemande === 'PREMIERE_ANNEE'
              ? { in: ['PREMIERE_ANNEE', 'TOUS'] }
              : { in: ['DEUXIEME_ANNEE_PLUS', 'TOUS'] },
        },
      });

      const demande = await transaction.demandeBourse.create({
        data: {
          personneId,
          niveauDemande,
          filiereSouhaitee,
          filiereSecondaireSouhaitee: this.optionalString(
            createDto.filiereSecondaireSouhaitee,
          ),
          ecoleOrigine: this.optionalString(createDto.ecoleOrigine),
          elementsDossier: {
            create: catalogue.map((element) => ({
              elementRequisId: element.id,
              montantAttendu: element.montantAttendu,
            })),
          },
        },
        include: this.detailInclude(),
      });

      return demande;
    });
  }

  async findAll(search: SearchDemandesBourseDto) {
    const page = this.parsePagination(search.page, 1);
    const limit = this.parsePagination(search.limit, 20, 100);
    const query = search.q?.trim();
    const where: {
      statut?: StatutDemandeValue;
      niveauDemande?: NiveauValue;
      OR?: Array<Record<string, unknown>>;
    } = {};

    if (search.statut) {
      where.statut = this.parseValue(
        search.statut,
        STATUTS_DEMANDE,
        'statut',
      );
    }
    if (search.niveauDemande) {
      where.niveauDemande = this.parseValue(
        search.niveauDemande,
        NIVEAUX,
        'niveauDemande',
      );
    }

    if (query) {
      where.OR = [
        { filiereSouhaitee: { contains: query, mode: 'insensitive' } },
        { ecoleOrigine: { contains: query, mode: 'insensitive' } },
        { personne: { nom: { contains: query, mode: 'insensitive' } } },
        { personne: { prenom: { contains: query, mode: 'insensitive' } } },
        { personne: { telephone: { contains: query, mode: 'insensitive' } } },
      ];
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.demandeBourse.count({ where }),
      this.prisma.demandeBourse.findMany({
        where,
        include: {
          personne: true,
          typeBourse: true,
        },
        orderBy: { dateDepot: 'desc' },
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
    const demande = await this.prisma.demandeBourse.findUnique({
      where: { id },
      include: this.detailInclude(),
    });

    if (!demande) {
      throw new NotFoundException('Demande de bourse introuvable');
    }

    return demande;
  }

  async updateEntretien(id: string, updateDto: UpdateEntretienDto) {
    await this.ensureExists(id);
    const data: { dateEntretien?: Date | null; equipeEntretien?: string | null } =
      {};

    if (updateDto.dateEntretien !== undefined) {
      data.dateEntretien = this.optionalDate(
        updateDto.dateEntretien,
        'dateEntretien',
      );
    }
    if (updateDto.equipeEntretien !== undefined) {
      data.equipeEntretien = this.optionalString(updateDto.equipeEntretien);
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Aucune information a modifier');
    }

    if (data.dateEntretien || data.equipeEntretien) {
      data.dateEntretien = data.dateEntretien ?? new Date();
    }

    return this.prisma.demandeBourse.update({
      where: { id },
      data: {
        ...data,
        statut: 'ENTRETIEN_PROGRAMME',
      },
      include: this.detailInclude(),
    });
  }

  async updateDecision(id: string, updateDto: UpdateDecisionDto) {
    await this.ensureExists(id);
    const statut = this.parseValue(
      updateDto.statut,
      ['EN_DELIBERATION', 'ACCEPTEE', 'REFUSEE'] as const,
      'statut',
    );
    const typeBourseId = this.optionalString(updateDto.typeBourseId);
    if (statut === 'ACCEPTEE' && !typeBourseId) {
      throw new BadRequestException(
        'typeBourseId est obligatoire pour accepter une demande',
      );
    }
    if (typeBourseId) {
      const typeBourse = await this.prisma.typeBourse.findUnique({
        where: { id: typeBourseId },
        select: { id: true },
      });
      if (!typeBourse) {
        throw new NotFoundException('Type de bourse introuvable');
      }
    }

    return this.prisma.demandeBourse.update({
      where: { id },
      data: {
        ...(typeBourseId !== null ? { typeBourseId } : {}),
        statut,
        dateDecision:
          statut === 'ACCEPTEE' || statut === 'REFUSEE' ? new Date() : null,
      },
      include: this.detailInclude(),
    });
  }

  async findElements(id: string) {
    await this.ensureExists(id);

    return this.prisma.elementDossier.findMany({
      where: { demandeBourseId: id },
      include: {
        elementRequis: { include: { elementSubstitut: true } },
        elementSubstitutUtilise: true,
      },
      orderBy: { elementRequis: { nom: 'asc' } },
    });
  }

  async findFinance(id: string) {
    const demande = await this.prisma.demandeBourse.findUnique({
      where: { id },
      select: {
        id: true,
        elementsDossier: {
          include: {
            elementRequis: true,
            paiements: { orderBy: { datePaiement: 'desc' } },
          },
          orderBy: { elementRequis: { nom: 'asc' } },
        },
        paiements: {
          where: { elementDossierId: null },
          include: { echeance: true },
          orderBy: { datePaiement: 'desc' },
        },
      },
    });
    if (!demande) {
      throw new NotFoundException('Demande de bourse introuvable');
    }
    const obligations = demande.elementsDossier.map((element) => {
      const montantAttendu = Number(element.montantAttendu ?? 0);
      const montantPaye = element.paiements.reduce(
        (total, paiement) => total + Number(paiement.montant),
        0,
      );
      return {
        id: element.id,
        nom: element.elementRequis.nom,
        categorie: element.elementRequis.categorie,
        statut: element.statut,
        montantAttendu: this.money(montantAttendu),
        montantPaye: this.money(montantPaye),
        resteAPayer: this.money(Math.max(0, montantAttendu - montantPaye)),
        paiements: element.paiements,
      };
    });
    const paiementsNonAffectes = demande.paiements;
    const montantPayeNonAffecte = paiementsNonAffectes.reduce(
      (total, paiement) => total + Number(paiement.montant),
      0,
    );
    return {
      demandeId: id,
      obligations,
      paiementsNonAffectes,
      montantPayeNonAffecte: this.money(montantPayeNonAffecte),
      totalAttendu: this.money(
        obligations.reduce((total, item) => total + Number(item.montantAttendu), 0),
      ),
      totalPaye: this.money(
        obligations.reduce((total, item) => total + Number(item.montantPaye), 0) +
          montantPayeNonAffecte,
      ),
    };
  }

  async updateElement(
    demandeId: string,
    elementRequisId: string,
    updateDto: UpdateElementDossierDto,
  ) {
    const statut = this.parseValue(
      updateDto.statut,
      STATUTS_ELEMENT,
      'statut',
    );
    const element = await this.prisma.elementDossier.findFirst({
      where: { demandeBourseId: demandeId, elementRequisId },
      include: { elementRequis: true },
    });

    if (!element) {
      throw new NotFoundException('Element de dossier introuvable');
    }

    let elementSubstitutUtiliseId: string | null = null;
    if (statut === 'SUBSTITUE') {
      const substituteId = this.requiredString(
        updateDto.elementSubstitutUtiliseId,
        'elementSubstitutUtiliseId',
      );
      if (element.elementRequis.elementSubstitutId !== substituteId) {
        throw new BadRequestException(
          'Le substitut fourni ne correspond pas au catalogue',
        );
      }
      elementSubstitutUtiliseId = substituteId;
    }

    return this.prisma.elementDossier.update({
      where: { id: element.id },
      data: {
        statut,
        dateFourniture:
          statut === 'FOURNI' || statut === 'SUBSTITUE' ? new Date() : null,
        elementSubstitutUtiliseId,
      },
      include: {
        elementRequis: { include: { elementSubstitut: true } },
        elementSubstitutUtilise: true,
      },
    });
  }

  private detailInclude() {
    return {
      personne: true,
      typeBourse: true,
      elementsDossier: {
        include: {
          elementRequis: { include: { elementSubstitut: true } },
          elementSubstitutUtilise: true,
        },
        orderBy: { elementRequis: { nom: 'asc' as const } },
      },
      paiements: {
        include: { echeance: true },
        orderBy: { datePaiement: 'desc' as const },
      },
    } as const;
  }

  private async ensureExists(id: string): Promise<void> {
    const exists = await this.prisma.demandeBourse.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Demande de bourse introuvable');
    }
  }

  private parseValue<const T extends readonly string[]>(
    value: string | undefined,
    allowed: T,
    field: string,
  ): T[number] {
    const normalized = value?.trim().toUpperCase();
    if (!normalized || !allowed.includes(normalized as T[number])) {
      throw new BadRequestException(
        `${field} doit etre parmi: ${allowed.join(', ')}`,
      );
    }
    return normalized as T[number];
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

  private money(value: number): string {
    return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
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
