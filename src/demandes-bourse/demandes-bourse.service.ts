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
import { requiredDeletionReason, toTrashSnapshot } from '../corbeille/corbeille.utils';

const NIVEAUX = ['PREMIERE_ANNEE', 'DEUXIEME_ANNEE'] as const;
const STATUTS_DEMANDE = [
  'EN_ATTENTE',
  'ENTRETIEN_PROGRAMME',
  'EN_DELIBERATION',
  'ACCEPTEE',
  'REFUSEE',
] as const;
const STATUTS_ELEMENT = ['ATTENDU', 'FOURNI', 'MANQUANT', 'SUBSTITUE'] as const;

type NiveauValue = (typeof NIVEAUX)[number];
type StatutDemandeValue = (typeof STATUTS_DEMANDE)[number];
type StatutElementValue = (typeof STATUTS_ELEMENT)[number];

@Injectable()
export class DemandesBourseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateDemandeBourseDto, creeParId: string) {
    const nouvellePersonne = createDto.nouvellePersonne;
    if (nouvellePersonne && createDto.personneId) {
      throw new BadRequestException(
        'Choisissez une personne existante ou renseignez une nouvelle personne',
      );
    }
    const personneId = nouvellePersonne
      ? null
      : this.requiredString(createDto.personneId, 'personneId');
    const nomNouvellePersonne = nouvellePersonne
      ? this.requiredString(nouvellePersonne.nom, 'nom')
      : null;
    const prenomNouvellePersonne = nouvellePersonne
      ? this.requiredString(nouvellePersonne.prenom, 'prenom')
      : null;
    const niveauDemande = this.parseValue(
      createDto.niveauDemande,
      NIVEAUX,
      'niveauDemande',
    );
    const filiereSouhaitee = this.requiredString(
      createDto.filiereSouhaitee,
      'filiereSouhaitee',
    );

    if (personneId) {
      const personne = await this.prisma.personne.findUnique({
        where: { id: personneId },
        select: { id: true },
      });
      if (!personne) {
        throw new NotFoundException('Personne introuvable');
      }
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
      const statuses = createDto.preparation?.statuses ?? {};
      const dossierElements = catalogue.map((element) => {
        const requestedStatus = statuses[element.id];
        if (requestedStatus !== undefined && typeof requestedStatus !== 'string') {
          throw new BadRequestException('Le statut d une pièce est invalide');
        }
        const statut = requestedStatus === undefined
          ? 'ATTENDU'
          : this.parseValue(requestedStatus, STATUTS_ELEMENT, 'statut');
        if (statut === 'SUBSTITUE' && !element.elementSubstitutId) {
          throw new BadRequestException(
            `Aucun substitut n'est configure pour ${element.nom}`,
          );
        }
        return {
          elementRequisId: element.id,
          montantAttendu: element.montantAttendu,
          statut,
          dateFourniture:
            statut === 'FOURNI' || statut === 'SUBSTITUE' ? new Date() : null,
          elementSubstitutUtiliseId:
            statut === 'SUBSTITUE' ? element.elementSubstitutId : null,
        };
      });
      const preparationPayment = this.prepareInitialPayment(
        createDto.preparation,
        catalogue,
      );
      const resolvedPersonneId = nouvellePersonne
        ? (
            await transaction.personne.create({
              data: {
                nom: nomNouvellePersonne!,
                prenom: prenomNouvellePersonne!,
                telephone: this.optionalString(nouvellePersonne.telephone),
                quartier: this.optionalString(nouvellePersonne.quartier),
                dateNaissance: this.optionalDate(
                  nouvellePersonne.dateNaissance,
                  'dateNaissance',
                ),
                lieuNaissance: this.optionalString(nouvellePersonne.lieuNaissance),
                tuteurNom: this.optionalString(nouvellePersonne.tuteurNom),
                tuteurPrenom: this.optionalString(nouvellePersonne.tuteurPrenom),
                tuteurTelephone: this.optionalString(nouvellePersonne.tuteurTelephone),
                creeParId,
              },
              select: { id: true },
            })
          ).id
        : personneId!;
      const demande = await transaction.demandeBourse.create({
        data: {
          personneId: resolvedPersonneId,
          niveauDemande,
          filiereSouhaitee,
          filiereSecondaireSouhaitee: this.optionalString(
            createDto.filiereSecondaireSouhaitee,
          ),
          ecoleOrigine: this.optionalString(createDto.ecoleOrigine),
          elementsDossier: {
            create: dossierElements,
          },
        },
        include: this.detailInclude(),
      });

      if (preparationPayment) {
        const element = demande.elementsDossier.find(
          (item) => item.elementRequisId === preparationPayment.elementId,
        );
        if (!element) {
          throw new BadRequestException(
            'La pièce choisie ne fait pas partie du dossier',
          );
        }
        await transaction.paiement.create({
          data: {
            demandeBourseId: demande.id,
            elementDossierId: element.id,
            montant: preparationPayment.montant,
            typePaiement: preparationPayment.typePaiement,
          },
        });
        return transaction.demandeBourse.findUnique({
          where: { id: demande.id },
          include: this.detailInclude(),
        });
      }
      return demande;
    });
  }

  private prepareInitialPayment(
    preparation: CreateDemandeBourseDto['preparation'],
    catalogue: Array<{ id: string; montantAttendu: unknown }>,
  ) {
    const rawAmount = preparation?.montant;
    const value = rawAmount === undefined || rawAmount === null
      ? ''
      : String(rawAmount).trim().replace(',', '.');
    if (!value) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
      throw new BadRequestException(
        'Le montant doit être un nombre positif avec au maximum deux décimales',
      );
    }
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Le montant doit être strictement positif');
    }
    if (amount > 99_999_999.99) {
      throw new BadRequestException('Le montant dépasse la limite autorisée');
    }
    const elementId = this.requiredString(preparation?.elementId, 'elementId');
    const element = catalogue.find((item) => item.id === elementId);
    if (!element || element.montantAttendu === null || element.montantAttendu === undefined) {
      throw new BadRequestException(
        'Choisissez une obligation financière valide pour ce paiement',
      );
    }
    const expectedAmount = Number(element.montantAttendu);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      throw new BadRequestException(
        'Cette obligation ne possède pas de montant attendu valide',
      );
    }
    if (amount > expectedAmount) {
      throw new BadRequestException(
        'Le paiement dépasse le montant attendu de cette obligation',
      );
    }
    const typePaiement = preparation?.typePaiement?.trim().toUpperCase();
    if (typePaiement !== 'FRAIS_DEPOT' && typePaiement !== 'FRAIS_INSCRIPTION') {
      throw new BadRequestException('Le type de paiement est invalide');
    }
    return {
      elementId,
      montant: amount.toFixed(2),
      typePaiement: typePaiement as 'FRAIS_DEPOT' | 'FRAIS_INSCRIPTION',
    };
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
      where.statut = this.parseValue(search.statut, STATUTS_DEMANDE, 'statut');
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
          elementsDossier: { select: { statut: true, montantAttendu: true, paiements: { select: { montant: true } }, elementRequis: { select: { nom: true } } } },
        },
        orderBy: { dateDepot: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map((demande) => ({
        ...demande,
        elementsManquants: demande.elementsDossier
          .filter((element) => element.statut !== 'FOURNI' && element.statut !== 'SUBSTITUE')
          .map((element) => element.elementRequis.nom),
        obligationsImpayees: demande.elementsDossier.flatMap((element) => {
          if (element.montantAttendu === null) return [];
          const reste = Number(element.montantAttendu) - element.paiements.reduce((total, paiement) => total + Number(paiement.montant), 0);
          return reste > 0 ? [{ nom: element.elementRequis.nom, reste: this.money(reste) }] : [];
        }),
        dossierComplet: demande.elementsDossier.every((element) => {
          const documentComplet = element.statut === 'FOURNI' || element.statut === 'SUBSTITUE';
          const reste = element.montantAttendu === null ? 0 : Number(element.montantAttendu) - element.paiements.reduce((total, paiement) => total + Number(paiement.montant), 0);
          return documentComplet && reste <= 0;
        }),
      })),
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
    const demande = await this.prisma.demandeBourse.findUnique({
      where: { id },
      include: this.detailInclude(),
    });

    if (!demande) {
      throw new NotFoundException('Demande de bourse introuvable');
    }

    return demande;
  }

  async remove(id: string, rawReason: string, deletedById: string) {
    const motif = requiredDeletionReason(rawReason);
    return this.prisma.$transaction(async (transaction) => {
      const demande = await transaction.demandeBourse.findUnique({
        where: { id },
        include: {
          personne: true,
          typeBourse: { include: { echeances: true } },
          inscriptions: {
            include: {
              personne: true,
              elementsDossier: {
                include: {
                  elementRequis: true,
                  elementSubstitutUtilise: true,
                  paiements: { include: { echeance: true } },
                },
              },
              paiements: { include: { echeance: true } },
            },
          },
          elementsDossier: {
            include: {
              elementRequis: true,
              elementSubstitutUtilise: true,
              paiements: { include: { echeance: true } },
            },
          },
          paiements: {
            include: {
              echeance: true,
              elementDossier: { include: { elementRequis: true } },
            },
          },
        },
      });
      if (!demande) {
        throw new NotFoundException('Demande de bourse introuvable');
      }

      const inscriptionIds = (
        await transaction.inscription.findMany({
          where: { demandeBourseId: id },
          select: { id: true },
        })
      ).map((inscription) => inscription.id);
      const dossiers = await transaction.elementDossier.findMany({
        where: {
          OR: [{ demandeBourseId: id }, { inscriptionId: { in: inscriptionIds } }],
        },
        select: { id: true },
      });
      const elementIds = dossiers.map((element) => element.id);

      const author = await transaction.utilisateur.findUnique({
        where: { id: deletedById },
        select: { id: true, nom: true, prenom: true },
      });
      await transaction.elementCorbeille.create({
        data: {
          type: 'DEMANDE_BOURSE',
          entiteId: id,
          libelle: `${demande.personne.prenom} ${demande.personne.nom} · ${demande.filiereSouhaitee}`,
          motif,
          supprimeParId: author?.id ?? deletedById,
          supprimeParNom: [author?.prenom, author?.nom].filter(Boolean).join(' ') || 'Utilisateur inconnu',
          donnees: toTrashSnapshot(demande),
        },
      });

      await transaction.paiement.deleteMany({
        where: {
          OR: [
            { demandeBourseId: id },
            { inscriptionId: { in: inscriptionIds } },
            { elementDossierId: { in: elementIds } },
          ],
        },
      });
      await transaction.elementDossier.deleteMany({
        where: {
          OR: [{ demandeBourseId: id }, { inscriptionId: { in: inscriptionIds } }],
        },
      });
      await transaction.inscription.deleteMany({
        where: { id: { in: inscriptionIds } },
      });
      await transaction.demandeBourse.delete({ where: { id } });
      return { id };
    });
  }

  async updateEntretien(id: string, updateDto: UpdateEntretienDto) {
    await this.ensureExists(id);
    const data: {
      dateEntretien?: Date | null;
      equipeEntretien?: string | null;
    } = {};

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
        paiements: { select: { montant: true } },
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
        obligations.reduce(
          (total, item) => total + Number(item.montantAttendu),
          0,
        ),
      ),
      totalPaye: this.money(
        obligations.reduce(
          (total, item) => total + Number(item.montantPaye),
          0,
        ) + montantPayeNonAffecte,
      ),
    };
  }

  async updateElement(
    demandeId: string,
    elementRequisId: string,
    updateDto: UpdateElementDossierDto,
  ) {
    const statut = this.parseValue(updateDto.statut, STATUTS_ELEMENT, 'statut');
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
      inscriptions: {
        select: { id: true, filiere: true, anneeScolaire: true },
        orderBy: { dateInscription: 'desc' as const },
      },
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
