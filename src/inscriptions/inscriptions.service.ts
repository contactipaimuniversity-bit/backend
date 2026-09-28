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
const STATUTS_ELEMENT = ['ATTENDU', 'FOURNI', 'MANQUANT', 'SUBSTITUE'] as const;

type StatutInscriptionValue = (typeof STATUTS_INSCRIPTION)[number];
type StatutElementValue = (typeof STATUTS_ELEMENT)[number];

@Injectable()
export class InscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateInscriptionDto, creeParId: string) {
    const nouvellePersonne = createDto.nouvellePersonne;
    const viaBourse = createDto.viaBourse === true;
    if (nouvellePersonne && (createDto.personneId || viaBourse)) {
      throw new BadRequestException(
        'Une inscription via bourse doit utiliser la personne de la demande liée',
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
    const anneeScolaire = this.requiredString(
      createDto.anneeScolaire,
      'anneeScolaire',
    );
    const niveau = this.requiredString(createDto.niveau, 'niveau');
    const filiere = this.requiredString(createDto.filiere, 'filiere');
    const demandeBourseId = this.optionalString(createDto.demandeBourseId);

    if (personneId) await this.ensurePersonne(personneId);
    await this.ensureBourseCoherence(
      personneId ?? '',
      viaBourse,
      demandeBourseId,
      createDto.confirmerDemandeEnCours === true,
    );

    return this.prisma.$transaction(async (transaction) => {
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
      const catalogue = await transaction.elementRequis.findMany({
        where: {
          contexte: { in: ['INSCRIPTION_DIRECTE', 'TOUS'] },
          niveauApplicable: this.niveauApplicable(niveau),
        },
      });

      return transaction.inscription.create({
        data: {
          personneId: resolvedPersonneId,
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
          elementsDossier: { select: { statut: true, montantAttendu: true, paiements: { select: { montant: true } }, elementRequis: { select: { nom: true } } } },
        },
        orderBy: { dateInscription: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map((inscription) => ({
        ...inscription,
        elementsManquants: inscription.elementsDossier
          .filter((element) => element.statut !== 'FOURNI' && element.statut !== 'SUBSTITUE')
          .map((element) => element.elementRequis.nom),
        obligationsImpayees: inscription.elementsDossier.flatMap((element) => {
          if (element.montantAttendu === null) return [];
          const reste = Number(element.montantAttendu) - element.paiements.reduce((total, paiement) => total + Number(paiement.montant), 0);
          return reste > 0 ? [{ nom: element.elementRequis.nom, reste: reste.toFixed(2) }] : [];
        }),
        dossierComplet: inscription.elementsDossier.every((element) => {
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
    await this.ensureElementsForDossier(id);
    return this.prisma.elementDossier.findMany({
      where: { inscriptionId: id },
      include: {
        elementRequis: { include: { elementSubstitut: true } },
        elementSubstitutUtilise: true,
        paiements: { select: { montant: true } },
      },
      orderBy: { elementRequis: { nom: 'asc' } },
    });
  }

  async findFinance(id: string) {
    await this.ensureExists(id);
    await this.ensureElementsForDossier(id);
    const inscription = await this.prisma.inscription.findUnique({
      where: { id },
      select: {
        id: true,
        elementsDossier: {
          include: { elementRequis: true, paiements: true },
          orderBy: { elementRequis: { nom: 'asc' } },
        },
        paiements: { where: { elementDossierId: null }, select: { montant: true } },
      },
    });
    if (!inscription) throw new NotFoundException('Inscription introuvable');
    const obligations = inscription.elementsDossier.map((element) => {
      const montantAttendu = Number(element.montantAttendu ?? 0);
      const montantPaye = element.paiements.reduce((total, paiement) => total + Number(paiement.montant), 0);
      return {
        id: element.id,
        nom: element.elementRequis.nom,
        categorie: element.elementRequis.categorie,
        statut: element.statut,
        montantAttendu: this.money(montantAttendu),
        montantPaye: this.money(montantPaye),
        resteAPayer: this.money(Math.max(0, montantAttendu - montantPaye)),
      };
    });
    const montantPayeNonAffecte = inscription.paiements.reduce((total, paiement) => total + Number(paiement.montant), 0);
    return {
      demandeId: id,
      obligations,
      montantPayeNonAffecte: this.money(montantPayeNonAffecte),
      totalAttendu: this.money(obligations.reduce((total, obligation) => total + Number(obligation.montantAttendu), 0)),
      totalPaye: this.money(obligations.reduce((total, obligation) => total + Number(obligation.montantPaye), 0) + montantPayeNonAffecte),
    };
  }

  private async ensureElementsForDossier(id: string) {
    const inscription = await this.prisma.inscription.findUnique({
      where: { id },
      select: { niveau: true },
    });
    if (!inscription) return;
    const catalogue = await this.prisma.elementRequis.findMany({
      where: {
        contexte: { in: ['INSCRIPTION_DIRECTE', 'TOUS'] },
        niveauApplicable: this.niveauApplicable(inscription.niveau),
      },
      select: { id: true, montantAttendu: true },
    });
    if (!catalogue.length) return;
    await this.prisma.elementDossier.createMany({
      data: catalogue.map((element) => ({
        inscriptionId: id,
        elementRequisId: element.id,
        montantAttendu: element.montantAttendu,
      })),
      skipDuplicates: true,
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

  private optionalDate(value: string | null | undefined, field: string): Date | null {
    if (value === null || value === undefined || value.trim() === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} doit etre une date valide`);
    }
    return date;
  }

  private money(value: number): string {
    return value.toFixed(2);
  }
}
