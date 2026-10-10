import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  requiredDeletionReason,
  toTrashSnapshot,
  trashAuthor,
} from '../corbeille/corbeille.utils';
import { PrismaService } from '../prisma/prisma.service';
import { CreateElementRequisDto } from './dto/create-element-requis.dto';
import { SearchElementsRequisDto } from './dto/search-elements-requis.dto';
import { UpdateElementRequisDto } from './dto/update-element-requis.dto';

const CATEGORIES = ['DOCUMENT', 'FOURNITURE', 'FRAIS'] as const;
const CONTEXTES = ['BOURSE', 'INSCRIPTION_DIRECTE', 'TOUS'] as const;
const NIVEAUX = [
  'PREMIERE_ANNEE',
  'DEUXIEME_ANNEE',
  'DEUXIEME_ANNEE_PLUS',
  'TOUS',
] as const;

type CategorieValue = (typeof CATEGORIES)[number];
type ContexteValue = (typeof CONTEXTES)[number];
type NiveauValue = (typeof NIVEAUX)[number];

@Injectable()
export class ElementsRequisService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(search: SearchElementsRequisDto) {
    const where: {
      contexte?: ContexteValue | { in: ContexteValue[] };
      niveauApplicable?: NiveauValue | { in: NiveauValue[] };
      categorie?: CategorieValue;
    } = {};

    if (search.contexte) {
      const contexte = this.parseValue(search.contexte, CONTEXTES, 'contexte');
      where.contexte =
        contexte === 'TOUS' ? contexte : { in: [contexte, 'TOUS'] };
    }
    if (search.niveauApplicable) {
      const niveauApplicable = this.parseValue(
        search.niveauApplicable,
        NIVEAUX,
        'niveauApplicable',
      );
      where.niveauApplicable =
        niveauApplicable === 'TOUS'
          ? niveauApplicable
          : niveauApplicable === 'DEUXIEME_ANNEE'
            ? { in: ['DEUXIEME_ANNEE', 'DEUXIEME_ANNEE_PLUS', 'TOUS'] }
            : { in: [niveauApplicable, 'TOUS'] };
    }
    if (search.categorie) {
      where.categorie = this.parseValue(
        search.categorie,
        CATEGORIES,
        'categorie',
      );
    }

    return this.prisma.elementRequis.findMany({
      where,
      include: {
        elementSubstitut: true,
        // Nombre de dossiers concernés, annoncé avant une mise à la corbeille.
        _count: { select: { elementsDossier: true } },
      },
      orderBy: [{ categorie: 'asc' }, { nom: 'asc' }],
    });
  }

  async create(createDto: CreateElementRequisDto) {
    const nom = this.requiredString(createDto.nom, 'nom');
    const categorie = this.parseValue(
      createDto.categorie,
      CATEGORIES,
      'categorie',
    );
    const contexte = this.parseValue(createDto.contexte, CONTEXTES, 'contexte');
    const niveauApplicable = this.parseValue(
      createDto.niveauApplicable,
      NIVEAUX,
      'niveauApplicable',
    );
    const elementSubstitutId = this.optionalString(
      createDto.elementSubstitutId,
    );
    const montantAttendu = this.optionalDecimal(createDto.montantAttendu);

    await this.ensureSubstituteIsValid(undefined, elementSubstitutId);

    return this.prisma.elementRequis.create({
      data: {
        nom,
        categorie,
        contexte,
        niveauApplicable,
        obligatoire: createDto.obligatoire ?? true,
        elementSubstitutId,
        montantAttendu,
      },
      include: { elementSubstitut: true },
    });
  }

  async update(id: string, updateDto: UpdateElementRequisDto) {
    await this.ensureExists(id);
    const data: {
      nom?: string;
      categorie?: CategorieValue;
      contexte?: ContexteValue;
      niveauApplicable?: NiveauValue;
      obligatoire?: boolean;
      elementSubstitutId?: string | null;
      montantAttendu?: string | null;
    } = {};

    if (updateDto.nom !== undefined) {
      data.nom = this.requiredString(updateDto.nom, 'nom');
    }
    if (updateDto.categorie !== undefined) {
      data.categorie = this.parseValue(
        updateDto.categorie,
        CATEGORIES,
        'categorie',
      );
    }
    if (updateDto.contexte !== undefined) {
      data.contexte = this.parseValue(
        updateDto.contexte,
        CONTEXTES,
        'contexte',
      );
    }
    if (updateDto.niveauApplicable !== undefined) {
      data.niveauApplicable = this.parseValue(
        updateDto.niveauApplicable,
        NIVEAUX,
        'niveauApplicable',
      );
    }
    if (updateDto.obligatoire !== undefined) {
      data.obligatoire = updateDto.obligatoire;
    }
    if (updateDto.elementSubstitutId !== undefined) {
      data.elementSubstitutId = this.optionalString(
        updateDto.elementSubstitutId,
      );
      await this.ensureSubstituteIsValid(id, data.elementSubstitutId);
    }
    if (updateDto.montantAttendu !== undefined) {
      data.montantAttendu = this.optionalDecimal(updateDto.montantAttendu);
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Aucune information a modifier');
    }

    return this.prisma.elementRequis.update({
      where: { id },
      data,
      include: { elementSubstitut: true },
    });
  }

  // Mise à la corbeille, même pour un élément déjà utilisé : il est retiré des
  // dossiers, et ce qui avait été payé dessus reste sur le dossier, non affecté.
  async remove(id: string, rawReason: string | undefined, deletedById: string) {
    const motif = requiredDeletionReason(rawReason);
    return this.prisma.$transaction(async (transaction) => {
      const element = await transaction.elementRequis.findUnique({
        where: { id },
        include: {
          elementsDossier: { include: { paiements: { select: { id: true } } } },
          substituePour: { select: { id: true } },
          utiliseCommeSubstitutDans: { select: { id: true } },
        },
      });
      if (!element) {
        throw new NotFoundException('Element requis introuvable');
      }
      const {
        elementsDossier,
        substituePour,
        utiliseCommeSubstitutDans,
        ...elementRequis
      } = element;
      const elementDossierIds = elementsDossier.map((item) => item.id);

      await transaction.elementCorbeille.create({
        data: {
          type: 'ELEMENT_REQUIS',
          entiteId: id,
          libelle: element.nom,
          motif,
          ...(await trashAuthor(transaction, deletedById)),
          donnees: toTrashSnapshot({
            elementRequis,
            elementsDossier: elementsDossier.map(({ paiements, ...item }) => ({
              ...item,
              paiementIds: paiements.map((paiement) => paiement.id),
            })),
            substituePourIds: substituePour.map((item) => item.id),
            substitutUtiliseDansIds: utiliseCommeSubstitutDans.map(
              (item) => item.id,
            ),
          }),
        },
      });

      await transaction.paiement.updateMany({
        where: { elementDossierId: { in: elementDossierIds } },
        data: { elementDossierId: null },
      });
      await transaction.elementDossier.deleteMany({
        where: { id: { in: elementDossierIds } },
      });
      // Une pièce remplacée par cet élément redevient simplement attendue.
      await transaction.elementDossier.updateMany({
        where: { elementSubstitutUtiliseId: id },
        data: { elementSubstitutUtiliseId: null, statut: 'ATTENDU' },
      });
      await transaction.elementRequis.updateMany({
        where: { elementSubstitutId: id },
        data: { elementSubstitutId: null },
      });
      await transaction.elementRequis.delete({ where: { id } });
      return { id, dossiersConcernes: elementDossierIds.length };
    });
  }

  private async ensureExists(id: string): Promise<void> {
    const element = await this.prisma.elementRequis.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!element) {
      throw new NotFoundException('Element requis introuvable');
    }
  }

  private async ensureSubstituteIsValid(
    currentId: string | undefined,
    substituteId: string | null,
  ): Promise<void> {
    if (!substituteId) {
      return;
    }
    if (currentId && currentId === substituteId) {
      throw new BadRequestException(
        'Un element ne peut pas etre son propre substitut',
      );
    }

    const substitute = await this.prisma.elementRequis.findUnique({
      where: { id: substituteId },
      select: { id: true },
    });
    if (!substitute) {
      throw new NotFoundException('Element substitut introuvable');
    }
  }

  private parseValue<const T extends readonly string[]>(
    value: string | undefined,
    allowed: T,
    field: string,
  ): T[number] {
    const normalized = value?.trim().toUpperCase();
    if (!normalized || !allowed.includes(normalized)) {
      throw new BadRequestException(
        `${field} doit etre parmi: ${allowed.join(', ')}`,
      );
    }
    return normalized;
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

  private optionalDecimal(
    value: string | number | null | undefined,
  ): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new BadRequestException('montantAttendu doit etre positif');
    }
    if (!/^\d+(\.\d{1,2})?$/.test(String(value))) {
      throw new BadRequestException(
        'montantAttendu doit avoir au maximum 2 decimales',
      );
    }
    return parsed.toFixed(2);
  }
}
