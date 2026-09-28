import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaiementDto } from './dto/create-paiement.dto';

const TYPES_PAIEMENT = [
  'FRAIS_DEPOT',
  'FRAIS_INSCRIPTION',
  'ECHEANCE_BOURSE',
] as const;

type TypePaiementValue = (typeof TYPES_PAIEMENT)[number];

@Injectable()
export class PaiementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreatePaiementDto) {
    const demandeBourseId = this.optionalString(createDto.demandeBourseId);
    const inscriptionId = this.optionalString(createDto.inscriptionId);
    const echeanceId = this.optionalString(createDto.echeanceId);
    const elementDossierId = this.optionalString(createDto.elementDossierId);
    const typePaiement = this.parseTypePaiement(createDto.typePaiement);
    const montant = this.montant(createDto.montant);

    const elementDossier = elementDossierId
      ? await this.prisma.elementDossier.findUnique({
          where: { id: elementDossierId },
          select: { id: true, demandeBourseId: true, inscriptionId: true },
        })
      : null;
    if (elementDossierId && !elementDossier) {
      throw new NotFoundException('Obligation de dossier introuvable');
    }
    const resolvedDemandeBourseId =
      demandeBourseId ?? elementDossier?.demandeBourseId;
    const resolvedInscriptionId =
      inscriptionId ?? elementDossier?.inscriptionId;

    if (
      (resolvedDemandeBourseId && resolvedInscriptionId) ||
      (!resolvedDemandeBourseId && !resolvedInscriptionId)
    ) {
      throw new BadRequestException(
        'Un seul dossier doit etre renseigne: demandeBourseId ou inscriptionId',
      );
    }

    const dossier = resolvedDemandeBourseId
      ? await this.getDemandeDossier(resolvedDemandeBourseId)
      : await this.getInscriptionDossier(resolvedInscriptionId as string);
    if (
      elementDossier &&
      ((resolvedDemandeBourseId &&
        elementDossier.demandeBourseId !== resolvedDemandeBourseId) ||
        (resolvedInscriptionId &&
          elementDossier.inscriptionId !== resolvedInscriptionId))
    ) {
      throw new BadRequestException(
        'Cette obligation ne correspond pas au dossier',
      );
    }

    if (typePaiement === 'ECHEANCE_BOURSE' && !echeanceId) {
      throw new BadRequestException(
        'echeanceId est obligatoire pour un paiement echeance bourse',
      );
    }
    if (echeanceId && !dossier.typeBourseId) {
      throw new BadRequestException(
        'Une echeance ne peut etre utilisee que pour un dossier avec bourse',
      );
    }
    if (echeanceId) {
      const echeance = await this.prisma.echeanceBourse.findUnique({
        where: { id: echeanceId },
        select: { typeBourseId: true },
      });
      if (!echeance) {
        throw new NotFoundException('Echeance de bourse introuvable');
      }
      if (echeance.typeBourseId !== dossier.typeBourseId) {
        throw new BadRequestException(
          'Cette echeance ne correspond pas au type de bourse du dossier',
        );
      }
    }

    return this.prisma.paiement.create({
      data: {
        demandeBourseId: resolvedDemandeBourseId,
        inscriptionId: resolvedInscriptionId,
        echeanceId,
        elementDossierId,
        montant,
        typePaiement,
      },
      include: { echeance: true, elementDossier: true },
    });
  }

  async findByDemandeBourse(id: string) {
    await this.getDemandeDossier(id);
    return this.prisma.paiement.findMany({
      where: { demandeBourseId: id },
      include: { echeance: true, elementDossier: true },
      orderBy: { datePaiement: 'desc' },
    });
  }

  async findByInscription(id: string) {
    await this.getInscriptionDossier(id);
    return this.prisma.paiement.findMany({
      where: { inscriptionId: id },
      include: { echeance: true, elementDossier: true },
      orderBy: { datePaiement: 'desc' },
    });
  }

  async findAll() {
    const payments = await this.prisma.paiement.findMany({
      include: {
        demandeBourse: { include: { personne: true } },
        inscription: { include: { personne: true } },
        elementDossier: { include: { elementRequis: true } },
        echeance: true,
      },
      orderBy: { datePaiement: 'desc' },
    });
    return payments.map((payment) => ({
      id: payment.id,
      montant: payment.montant,
      datePaiement: payment.datePaiement,
      typePaiement: payment.typePaiement,
      dossierId: payment.demandeBourseId ?? payment.inscriptionId,
      dossierType: payment.demandeBourseId ? 'demande-bourse' : 'inscription',
      dossier: payment.demandeBourse
        ? `Demande · ${payment.demandeBourse.filiereSouhaitee}`
        : `Inscription · ${payment.inscription?.filiere ?? '-'}`,
      personne: payment.demandeBourse?.personne ?? payment.inscription?.personne,
      obligation: payment.elementDossier?.elementRequis.nom ?? null,
      echeance: payment.echeance?.libelle ?? null,
      affecte: payment.elementDossier !== null,
    }));
  }

  async findUnassigned() {
    const payments = await this.prisma.paiement.findMany({
      where: { elementDossierId: null },
      include: {
        demandeBourse: { include: { personne: true } },
        inscription: { include: { personne: true } },
      },
      orderBy: { datePaiement: 'desc' },
    });
    return payments.map((payment) => ({
      id: payment.id,
      montant: payment.montant,
      datePaiement: payment.datePaiement,
      typePaiement: payment.typePaiement,
      dossierId: payment.demandeBourseId ?? payment.inscriptionId,
      dossierType: payment.demandeBourseId ? 'demande-bourse' : 'inscription',
      personne:
        payment.demandeBourse?.personne ?? payment.inscription?.personne,
    }));
  }

  async assignToElement(paymentId: string, elementDossierId: string) {
    const payment = await this.prisma.paiement.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        montant: true,
        elementDossierId: true,
        demandeBourseId: true,
        inscriptionId: true,
      },
    });
    if (!payment) throw new NotFoundException('Paiement introuvable');
    if (payment.elementDossierId) {
      throw new ConflictException('Ce paiement est deja affecte');
    }

    const obligation = await this.prisma.elementDossier.findUnique({
      where: { id: elementDossierId },
      select: {
        id: true,
        demandeBourseId: true,
        inscriptionId: true,
        montantAttendu: true,
      },
    });
    if (!obligation)
      throw new NotFoundException('Obligation de dossier introuvable');
    if (
      obligation.demandeBourseId !== payment.demandeBourseId ||
      obligation.inscriptionId !== payment.inscriptionId
    ) {
      throw new BadRequestException(
        'Cette obligation ne correspond pas au dossier du paiement',
      );
    }
    if (!obligation.montantAttendu) {
      throw new BadRequestException(
        'Cette obligation ne possède pas de montant attendu',
      );
    }

    const allocated = await this.prisma.paiement.aggregate({
      where: { elementDossierId },
      _sum: { montant: true },
    });
    const remaining =
      Number(obligation.montantAttendu) - Number(allocated._sum.montant ?? 0);
    if (Number(payment.montant) > remaining) {
      throw new BadRequestException(
        'Le paiement depasse le montant restant de cette obligation',
      );
    }

    const result = await this.prisma.paiement.updateMany({
      where: { id: paymentId, elementDossierId: null },
      data: { elementDossierId },
    });
    if (result.count !== 1)
      throw new ConflictException('Ce paiement a deja ete affecte');
    return this.prisma.paiement.findUnique({
      where: { id: paymentId },
      include: {
        echeance: true,
        elementDossier: { include: { elementRequis: true } },
      },
    });
  }

  async solde(dossierType: string, dossierId: string) {
    const normalizedType = dossierType.trim().toLowerCase();
    const dossier =
      normalizedType === 'demande-bourse' || normalizedType === 'demandebourse'
        ? await this.getDemandeDossier(dossierId)
        : normalizedType === 'inscription'
          ? await this.getInscriptionDossier(dossierId)
          : null;

    if (!dossier) {
      throw new BadRequestException(
        'dossierType doit etre demande-bourse ou inscription',
      );
    }

    const obligations = await this.prisma.elementDossier.findMany({
      where:
        normalizedType === 'inscription'
          ? { inscriptionId: dossierId }
          : { demandeBourseId: dossierId },
      select: { montantAttendu: true },
    });
    const echeances = dossier.typeBourseId
      ? await this.prisma.echeanceBourse.findMany({
          where: { typeBourseId: dossier.typeBourseId },
          select: { montantAttendu: true },
        })
      : [];
    const paiements = await this.prisma.paiement.findMany({
      where:
        normalizedType === 'inscription'
          ? { inscriptionId: dossierId }
          : { demandeBourseId: dossierId },
      select: { montant: true },
    });

    const montantAttenduCumule = this.roundMoney(
      obligations.reduce(
        (total, obligation) =>
          total +
          (obligation.montantAttendu ? Number(obligation.montantAttendu) : 0),
        0,
      ) +
        echeances.reduce(
          (total, echeance) =>
            total +
            (echeance.montantAttendu ? Number(echeance.montantAttendu) : 0),
          0,
        ),
    );
    const montantPayeCumule = this.roundMoney(
      paiements.reduce(
        (total, paiement) => total + Number(paiement.montant),
        0,
      ),
    );

    return {
      dossierType:
        normalizedType === 'inscription' ? 'inscription' : 'demande-bourse',
      dossierId,
      montantAttenduCumule: montantAttenduCumule.toFixed(2),
      montantPayeCumule: montantPayeCumule.toFixed(2),
      resteAPayer: this.roundMoney(
        montantAttenduCumule - montantPayeCumule,
      ).toFixed(2),
    };
  }

  private async getDemandeDossier(id: string) {
    const demande = await this.prisma.demandeBourse.findUnique({
      where: { id },
      select: { id: true, typeBourseId: true },
    });
    if (!demande) {
      throw new NotFoundException('Demande de bourse introuvable');
    }
    return demande;
  }

  private async getInscriptionDossier(id: string) {
    const inscription = await this.prisma.inscription.findUnique({
      where: { id },
      select: {
        id: true,
        demandeBourse: { select: { typeBourseId: true } },
      },
    });
    if (!inscription) {
      throw new NotFoundException('Inscription introuvable');
    }
    return {
      id: inscription.id,
      typeBourseId: inscription.demandeBourse?.typeBourseId ?? null,
    };
  }

  private parseTypePaiement(value: string | undefined): TypePaiementValue {
    const normalized = value?.trim().toUpperCase();
    if (
      !normalized ||
      !TYPES_PAIEMENT.includes(normalized as TypePaiementValue)
    ) {
      throw new BadRequestException(
        `typePaiement doit etre parmi: ${TYPES_PAIEMENT.join(', ')}`,
      );
    }
    return normalized as TypePaiementValue;
  }

  private montant(value: string | number | undefined): string {
    if (value === undefined || value === null || value === '') {
      throw new BadRequestException('montant est obligatoire');
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('montant doit etre strictement positif');
    }
    if (!/^\d+(\.\d{1,2})?$/.test(String(value))) {
      throw new BadRequestException(
        'montant doit avoir au maximum 2 decimales',
      );
    }
    return parsed.toFixed(2);
  }

  private optionalString(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    const normalized = value.trim();
    return normalized || null;
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
