import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { $Enums } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInscriptionDto } from './dto/create-inscription.dto';
import { SearchInscriptionsDto } from './dto/search-inscriptions.dto';
import { UpdateInscriptionElementDto } from './dto/update-inscription-element.dto';
import { UpdateInscriptionDto } from './dto/update-inscription.dto';

const STATUTS_INSCRIPTION = ['EN_COURS', 'COMPLETE', 'ABANDONNEE'] as const;
const STATUTS_ELEMENT = [
  'ATTENDU',
  'FOURNI',
  'MANQUANT',
  'SUBSTITUE',
] as const;

type StatutInscriptionValue = (typeof STATUTS_INSCRIPTION)[number];
type StatutElementValue = (typeof STATUTS_ELEMENT)[number];

@Injectable()
export class InscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateInscriptionDto) {
    const personneId = this.requiredString(createDto.personneId, 'personneId');
    const anneeScolaire = this.requiredString(
      createDto.anneeScolaire,
      'anneeScolaire',
    );
    const niveau = this.requiredString(createDto.niveau, 'niveau');
    const filiere = this.requiredString(createDto.filiere, 'filiere');
    const viaBourse = createDto.viaBourse === true;
    const demandeBourseId = this.optionalString(createDto.demandeBourseId);

    await this.ensurePersonne(personneId);
    await this.ensureBourseCoherence(
      personneId,
      viaBourse,
      demandeBourseId,
      createDto.confirmerDemandeEnCours === true,
    );

    return this.prisma.$transaction(async (transaction) => {
      const catalogue = await transaction.elementRequis.findMany({
        where: {
          contexte: { in: ['INSCRIPTION_DIRECTE', 'TOUS'] },
          niveauApplicable: this.niveauApplicable(niveau),
        },
      });

      return transaction.inscription.create({
        data: {
          personneId,
          anneeScolaire,
          niveau,
          filiere,
          viaBourse,
          demandeBourseId,
          elementsDossier: {
            create: catalogue.map((element) => ({
              elementRequisId: element.id,
              montantAttendu: element.montantAttendu,
            })),
          },
        },
        include: this.detailInclude(),
      });
    });
  }

  async findAll(search: SearchInscriptionsDto) {
    const page = this.parsePagination(search.page, 1);
    const limit = this.parsePagination(search.limit, 20, 100);
    const query = this.optionalString(search.q);
    const where: {
      anneeScolaire?: { contains: string; mode: 'insensitive' };
      niveau?: { contains: string; mode: 'insensitive' };
      statut?: StatutInscriptionValue;
      OR?: Array<Record<string, unknown>>;
    } = {};

    const anneeScolaire = this.optionalString(search.anneeScolaire);
    const niveau = this.optionalString(search.niveau);
    if (anneeScolaire) {
      where.anneeScolaire = { contains: anneeScolaire, mode: 'insensitive' };
    }
    if (niveau) {
      where.niveau = { contains: niveau, mode: 'insensitive' };
    }
    if (search.statut) {
      where.statut = this.parseStatut(search.statut);
    }

    if (query) {
      where.OR = [
        { filiere: { contains: query, mode: 'insensitive' } },
        { niveau: { contains: query, mode: 'insensitive' } },
        { anneeScolaire: { contains: query, mode: 'insensitive' } },
        { personne: { nom: { contains: query, mode: 'insensitive' } } },
        { personne: { prenom: { contains: query, mode: 'insensitive' } } },
        { personne: { telephone: { contains: query, mode: 'insensitive' } } },
      ];
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.inscription.count({ where }),
      this.prisma.inscription.findMany({
        where,
        include: {
          personne: true,
          demandeBourse: true,
        },
        orderBy: { dateInscription: 'desc' },
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
    const inscription = await this.prisma.inscription.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!inscription) {
      throw new NotFoundException('Inscription introuvable');
    }
    return inscription;
  }

  async update(id: string, updateDto: UpdateInscriptionDto) {
    const current = await this.findCurrent(id);
    const data: {
      anneeScolaire?: string;
      niveau?: string;
      filiere?: string;
      viaBourse?: boolean;
      demandeBourseId?: string | null;
      statut?: StatutInscriptionValue;
    } = {};

    const viaBourse = updateDto.viaBourse ?? current.viaBourse;
    const demandeBourseId =
      updateDto.demandeBourseId !== undefined
        ? this.optionalString(updateDto.demandeBourseId)
        : current.demandeBourseId;

    if (updateDto.anneeScolaire !== undefined) {
      data.anneeScolaire = this.requiredString(
        updateDto.anneeScolaire,
        'anneeScolaire',
      );
    }
    if (updateDto.niveau !== undefined) {
      data.niveau = this.requiredString(updateDto.niveau, 'niveau');
    }
    if (updateDto.filiere !== undefined) {
      data.filiere = this.requiredString(updateDto.filiere, 'filiere');
    }
    if (updateDto.viaBourse !== undefined) {
      data.viaBourse = updateDto.viaBourse;
    }
    if (updateDto.demandeBourseId !== undefined) {
      data.demandeBourseId = demandeBourseId;
    }
    if (updateDto.statut !== undefined) {
      data.statut = this.parseStatut(updateDto.statut);
    }

    await this.ensureBourseCoherence(
      current.personneId,
      viaBourse,
      demandeBourseId,
    );

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Aucune information a modifier');
    }

    return this.prisma.inscription.update({
      where: { id },
      data,
      include: this.detailInclude(),
    });
  }

  async findElements(id: string) {
    await this.ensureExists(id);
    return this.prisma.elementDossier.findMany({
      where: { inscriptionId: id },
      include: {
        elementRequis: { include: { elementSubstitut: true } },
        elementSubstitutUtilise: true,
      },
      orderBy: { elementRequis: { nom: 'asc' } },
    });
  }

  async updateElement(
    inscriptionId: string,
    elementRequisId: string,
    updateDto: UpdateInscriptionElementDto,
  ) {
    const statut = this.parseElementStatut(updateDto.statut);
    const element = await this.prisma.elementDossier.findFirst({
      where: { inscriptionId, elementRequisId },
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
      demandeBourse: true,
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

  private niveauApplicable(niveau: string): {
    in: $Enums.NiveauApplicable[];
  } {
    const normalized = niveau.trim().toUpperCase();
    return normalized.includes('PREMIERE') || normalized.includes('1')
      ? { in: ['PREMIERE_ANNEE', 'TOUS'] }
      : { in: ['DEUXIEME_ANNEE_PLUS', 'TOUS'] };
  }

  private async ensureBourseCoherence(
    personneId: string,
    viaBourse: boolean,
    demandeBourseId: string | null,
    confirmerDemandeEnCours = false,
  ): Promise<void> {
    if (viaBourse && !demandeBourseId) {
      throw new BadRequestException(
        'demandeBourseId est obligatoire si viaBourse vaut true',
      );
    }
    if (!viaBourse && demandeBourseId) {
      throw new BadRequestException(
        'demandeBourseId doit etre absent si viaBourse vaut false',
      );
    }
    if (demandeBourseId) {
      const demande = await this.prisma.demandeBourse.findUnique({
        where: { id: demandeBourseId },
        select: { personneId: true, statut: true },
      });
      if (!demande) {
        throw new NotFoundException('Demande de bourse introuvable');
      }
      if (demande.personneId !== personneId) {
        throw new BadRequestException(
          'La demande de bourse ne concerne pas cette personne',
        );
      }
      if (demande.statut !== 'ACCEPTEE' && !confirmerDemandeEnCours) {
        throw new ConflictException(
          'La demande de bourse est encore en attente de décision. Confirmation requise.',
        );
      }
    }
  }

  private async ensurePersonne(id: string): Promise<void> {
    const personne = await this.prisma.personne.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!personne) {
      throw new NotFoundException('Personne introuvable');
    }
  }

  private async findCurrent(id: string) {
    const inscription = await this.prisma.inscription.findUnique({
      where: { id },
      select: {
        id: true,
        personneId: true,
        viaBourse: true,
        demandeBourseId: true,
      },
    });
    if (!inscription) {
      throw new NotFoundException('Inscription introuvable');
    }
    return inscription;
  }

  private async ensureExists(id: string): Promise<void> {
    await this.findCurrent(id);
  }

  private parseStatut(value: string): StatutInscriptionValue {
    const normalized = value.trim().toUpperCase();
    if (!STATUTS_INSCRIPTION.includes(normalized as StatutInscriptionValue)) {
      throw new BadRequestException(
        `statut doit etre parmi: ${STATUTS_INSCRIPTION.join(', ')}`,
      );
    }
    return normalized as StatutInscriptionValue;
  }

  private parseElementStatut(value: string | undefined): StatutElementValue {
    const normalized = value?.trim().toUpperCase();
    if (!STATUTS_ELEMENT.includes(normalized as StatutElementValue)) {
      throw new BadRequestException(
        `statut doit etre parmi: ${STATUTS_ELEMENT.join(', ')}`,
      );
    }
    return normalized as StatutElementValue;
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
}
