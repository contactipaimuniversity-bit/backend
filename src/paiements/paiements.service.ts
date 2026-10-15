import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseDateOrder } from '../common/date-order';
import type { SaisieLocale } from '../common/saisie-locale';
import { AnnulerPaiementDto } from './dto/annuler-paiement.dto';
import { CreatePaiementDto } from './dto/create-paiement.dto';
import {
  numeroRecu,
  parseModePaiement,
  verrouillerDossier,
} from './encaissement';
import {
  RembourserTropPercuDto,
  ReporterTropPercuDto,
} from './dto/trop-percu.dto';

const TYPES_PAIEMENT = [
  'FRAIS_DEPOT',
  'FRAIS_INSCRIPTION',
  'ECHEANCE_BOURSE',
] as const;

type TypePaiementValue = (typeof TYPES_PAIEMENT)[number];
type Transaction = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

@Injectable()
export class PaiementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    createDto: CreatePaiementDto,
    saisie: SaisieLocale = {},
    auteur: string | null = null,
  ) {
    // Paiement saisi hors ligne et déjà reçu : on le renvoie tel quel, sans
    // jamais l'encaisser une seconde fois.
    if (saisie.id) {
      const dejaRecu = await this.prisma.paiement.findUnique({
        where: { id: saisie.id },
        include: { echeance: true, elementDossier: true },
      });
      if (dejaRecu) return dejaRecu;
    }
    const demandeBourseId = this.optionalString(createDto.demandeBourseId);
    const inscriptionId = this.optionalString(createDto.inscriptionId);
    const echeanceId = this.optionalString(createDto.echeanceId);
    const elementDossierId = this.optionalString(createDto.elementDossierId);
    const typePaiement = this.parseTypePaiement(createDto.typePaiement);
    const montant = this.montant(createDto.montant);
    const modePaiement = parseModePaiement(createDto.modePaiement);

    const elementDossier = elementDossierId
      ? await this.prisma.elementDossier.findUnique({
          where: { id: elementDossierId },
          select: {
            id: true,
            demandeBourseId: true,
            inscriptionId: true,
            montantAttendu: true,
          },
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

    if (typePaiement === 'FRAIS_DEPOT' && resolvedInscriptionId) {
      throw new BadRequestException(
        'Une inscription ne peut pas recevoir de frais de dépôt',
      );
    }
    if (typePaiement === 'ECHEANCE_BOURSE' && !echeanceId) {
      throw new BadRequestException(
        'echeanceId est obligatoire pour un paiement echeance bourse',
      );
    }
    if (echeanceId && typePaiement !== 'ECHEANCE_BOURSE') {
      throw new BadRequestException(
        'Une echeance ne peut etre reglee que par un paiement echeance bourse',
      );
    }
    if (echeanceId && elementDossierId) {
      throw new BadRequestException(
        'Un paiement concerne une echeance ou une obligation du dossier, pas les deux',
      );
    }
    if (echeanceId && !dossier.typeBourseId) {
      throw new BadRequestException(
        'Une echeance ne peut etre utilisee que pour un dossier avec bourse',
      );
    }
    const echeance = echeanceId
      ? await this.prisma.echeanceBourse.findUnique({
          where: { id: echeanceId },
          select: { id: true, typeBourseId: true, montantAttendu: true },
        })
      : null;
    if (echeanceId) {
      if (!echeance) {
        throw new NotFoundException('Echeance de bourse introuvable');
      }
      if (echeance.typeBourseId !== dossier.typeBourseId) {
        throw new BadRequestException(
          'Cette echeance ne correspond pas au type de bourse du dossier',
        );
      }
    }

    // Contrôle du reste à payer, numéro de reçu et enregistrement : un seul bloc.
    return this.prisma.$transaction(async (transaction) => {
      await verrouillerDossier(
        transaction,
        dossier.id,
        echeance ? dossier.demandeBourseId : null,
      );
      if (elementDossier)
        await this.ensureWithinRemaining(
          elementDossier,
          Number(montant),
          transaction,
        );
      if (echeance)
        await this.ensureEcheanceWithinRemaining(
          transaction,
          echeance,
          dossier,
          Number(montant),
        );
      return transaction.paiement.create({
        data: {
          demandeBourseId: resolvedDemandeBourseId,
          inscriptionId: resolvedInscriptionId,
          echeanceId,
          elementDossierId,
          montant,
          typePaiement,
          modePaiement,
          saisiParNom: auteur,
          numeroRecu: await numeroRecu(transaction),
          ...(saisie.id ? { id: saisie.id } : {}),
          ...(saisie.date ? { datePaiement: saisie.date } : {}),
        },
        include: { echeance: true, elementDossier: true },
      });
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

  // Sans recherche : tout le journal. Avec q : les opérations dont le numéro de
  // reçu ou le nom de la personne correspond (recherche rapide de l'en-tête).
  async findAll(rawDateOrder?: string, rawQuery?: string, rawLimit?: string) {
    const ordreDate = parseDateOrder(rawDateOrder);
    const q = rawQuery?.trim().slice(0, 80);
    const personne = (texte: string): Prisma.PersonneWhereInput => ({
      OR: [
        { nom: { contains: texte, mode: 'insensitive' } },
        { prenom: { contains: texte, mode: 'insensitive' } },
      ],
    });
    const where: Prisma.PaiementWhereInput | undefined = q
      ? {
          OR: [
            { numeroRecu: { contains: q, mode: 'insensitive' } },
            { demandeBourse: { personne: personne(q) } },
            { inscription: { personne: personne(q) } },
          ],
        }
      : undefined;
    const limit = q
      ? Math.min(Math.max(Number.parseInt(rawLimit ?? '', 10) || 10, 1), 50)
      : undefined;
    const payments = await this.prisma.paiement.findMany({
      where,
      take: limit,
      include: {
        demandeBourse: { include: { personne: true } },
        inscription: { include: { personne: true } },
        elementDossier: { include: { elementRequis: true } },
        echeance: true,
        annulation: { select: { id: true } },
      },
      orderBy: [{ datePaiement: ordreDate }, { id: ordreDate }],
    });
    return payments.map((payment) => this.transaction(payment));
  }

  private transaction(payment: {
    id: string;
    montant: unknown;
    datePaiement: Date;
    typePaiement: string;
    motif: string | null;
    saisiParNom: string | null;
    modePaiement: string | null;
    numeroRecu: string | null;
    demandeBourseId: string | null;
    inscriptionId: string | null;
    echeanceId: string | null;
    annulePaiementId: string | null;
    annulation?: { id: string } | null;
    demandeBourse: { filiereSouhaitee: string; personne: unknown } | null;
    inscription: { filiere: string; personne: unknown } | null;
    elementDossier: { elementRequis: { nom: string } } | null;
    echeance: { libelle: string } | null;
  }) {
    return {
      id: payment.id,
      montant: payment.montant,
      datePaiement: payment.datePaiement,
      typePaiement: payment.typePaiement,
      motif: payment.motif,
      saisiParNom: payment.saisiParNom,
      modePaiement: payment.modePaiement ?? 'ESPECES',
      numeroRecu: payment.numeroRecu,
      dossierId: payment.demandeBourseId ?? payment.inscriptionId,
      dossierType: payment.demandeBourseId ? 'demande-bourse' : 'inscription',
      dossier: payment.demandeBourse
        ? `Demande · ${payment.demandeBourse.filiereSouhaitee}`
        : `Inscription · ${payment.inscription?.filiere ?? '-'}`,
      personne:
        payment.demandeBourse?.personne ?? payment.inscription?.personne,
      obligation: payment.elementDossier?.elementRequis.nom ?? null,
      echeance: payment.echeance?.libelle ?? null,
      affecte: payment.elementDossier !== null || payment.echeanceId !== null,
      annule: Boolean(payment.annulation),
      annulePaiementId: payment.annulePaiementId,
    };
  }

  // ---------- Annulation ----------
  // Un encaissement saisi par erreur ne s'efface pas : une ligne négative,
  // signée et motivée, le neutralise sur la même obligation ou la même échéance.

  async annuler(id: string, dto: Partial<AnnulerPaiementDto>, auteur: string) {
    const motif = dto.motif?.trim() ?? '';
    if (motif.length < 5 || motif.length > 300)
      throw new BadRequestException(
        "Le motif de l'annulation doit contenir entre 5 et 300 caractères",
      );
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const paiement = await transaction.paiement.findUnique({
          where: { id },
          include: { annulation: { select: { id: true } } },
        });
        if (!paiement) throw new NotFoundException('Paiement introuvable');
        await verrouillerDossier(
          transaction,
          paiement.demandeBourseId ?? paiement.inscriptionId,
        );
        if (
          !TYPES_PAIEMENT.includes(paiement.typePaiement as TypePaiementValue)
        )
          throw new BadRequestException(
            "Seul un encaissement s'annule : un report, un remboursement ou une annulation ne s'annule pas",
          );
        if (paiement.annulation)
          throw new ConflictException('Ce paiement est déjà annulé');
        const montant = Number(paiement.montant);
        if (paiement.elementDossierId) {
          const encaisse = await transaction.paiement.aggregate({
            where: { elementDossierId: paiement.elementDossierId },
            _sum: { montant: true },
          });
          if (this.roundMoney(Number(encaisse._sum.montant ?? 0) - montant) < 0)
            throw new BadRequestException(
              'Une partie de ce paiement a déjà été reportée ou remboursée : il ne peut plus être annulé',
            );
        }
        const annulation = await transaction.paiement.create({
          data: {
            demandeBourseId: paiement.demandeBourseId,
            inscriptionId: paiement.inscriptionId,
            echeanceId: paiement.echeanceId,
            elementDossierId: paiement.elementDossierId,
            montant: (-montant).toFixed(2),
            typePaiement: 'ANNULATION',
            // L'argent ressort par où il était entré.
            modePaiement: paiement.modePaiement,
            motif,
            saisiParNom: auteur,
            annulePaiementId: paiement.id,
          },
          include: {
            demandeBourse: { include: { personne: true } },
            inscription: { include: { personne: true } },
            elementDossier: { include: { elementRequis: true } },
            echeance: true,
          },
        });
        return this.transaction(annulation);
      });
    } catch (failure) {
      // Deux annulations simultanées : la base n'en accepte qu'une par paiement.
      if ((failure as { code?: string }).code === 'P2002')
        throw new ConflictException('Ce paiement est déjà annulé');
      throw failure;
    }
  }

  // ---------- Trop-perçu ----------
  // Une obligation peut avoir reçu plus que son montant (niveau corrigé après
  // paiement, par exemple). L'excédent se reporte sur une autre obligation du
  // même dossier, ou se rembourse. Rien n'est modifié ni effacé : chaque geste
  // ajoute ses propres lignes, signées et datées.

  private async obligationAvecTropPercu(
    transaction: Transaction,
    elementDossierId: string | undefined,
  ) {
    const obligation = elementDossierId
      ? await transaction.elementDossier.findUnique({
          where: { id: elementDossierId },
          include: {
            elementRequis: { select: { nom: true } },
            paiements: { select: { montant: true } },
          },
        })
      : null;
    if (!obligation)
      throw new NotFoundException('Obligation de dossier introuvable');
    const paye = obligation.paiements.reduce(
      (total, paiement) => total + Number(paiement.montant),
      0,
    );
    const attendu = Number(obligation.montantAttendu ?? 0);
    return {
      obligation,
      reste: this.roundMoney(Math.max(0, attendu - paye)),
      tropPercu: this.roundMoney(Math.max(0, paye - attendu)),
    };
  }

  private montantDansTropPercu(
    value: string | number | undefined,
    tropPercu: number,
    nom: string,
  ) {
    if (tropPercu <= 0)
      throw new BadRequestException(
        `« ${nom} » n'a aucun trop-perçu : il n'y a rien à reporter ni à rembourser`,
      );
    const montant = Number(this.montant(value));
    if (montant > tropPercu)
      throw new BadRequestException(
        `Le montant dépasse le trop-perçu de « ${nom} » (${tropPercu} F)`,
      );
    return montant;
  }

  async reporterTropPercu(dto: Partial<ReporterTropPercuDto>, auteur: string) {
    return this.prisma.$transaction(async (transaction) => {
      await this.verrouillerObligation(transaction, dto.elementDossierId);
      const source = await this.obligationAvecTropPercu(
        transaction,
        dto.elementDossierId,
      );
      const cible = await this.obligationAvecTropPercu(
        transaction,
        dto.cibleElementDossierId,
      );
      const nomSource = source.obligation.elementRequis.nom;
      const nomCible = cible.obligation.elementRequis.nom;
      if (
        cible.obligation.id === source.obligation.id ||
        cible.obligation.demandeBourseId !==
          source.obligation.demandeBourseId ||
        cible.obligation.inscriptionId !== source.obligation.inscriptionId
      )
        throw new BadRequestException(
          'Le report se fait vers une autre obligation du même dossier',
        );
      const montant = this.montantDansTropPercu(
        dto.montant,
        source.tropPercu,
        nomSource,
      );
      if (montant > cible.reste)
        throw new BadRequestException(
          cible.reste > 0
            ? `« ${nomCible} » n'attend plus que ${cible.reste} F : reportez au plus ce montant`
            : `« ${nomCible} » est déjà soldée : choisissez une obligation qui a un reste à payer`,
        );
      const dossier = {
        demandeBourseId: source.obligation.demandeBourseId,
        inscriptionId: source.obligation.inscriptionId,
        typePaiement: 'REPORT' as const,
        saisiParNom: auteur,
      };
      await transaction.paiement.createMany({
        data: [
          {
            ...dossier,
            elementDossierId: source.obligation.id,
            montant: (-montant).toFixed(2),
            motif: `Trop-perçu reporté vers « ${nomCible} »`,
          },
          {
            ...dossier,
            elementDossierId: cible.obligation.id,
            montant: montant.toFixed(2),
            motif: `Trop-perçu reporté depuis « ${nomSource} »`,
          },
        ],
      });
      return { montant: montant.toFixed(2), de: nomSource, vers: nomCible };
    });
  }

  async rembourserTropPercu(
    dto: Partial<RembourserTropPercuDto>,
    auteur: string,
  ) {
    const motif = dto.motif?.trim() ?? '';
    if (motif.length < 5 || motif.length > 300)
      throw new BadRequestException(
        'Le motif du remboursement doit contenir entre 5 et 300 caractères',
      );
    const modePaiement = parseModePaiement(dto.modePaiement);
    return this.prisma.$transaction(async (transaction) => {
      await this.verrouillerObligation(transaction, dto.elementDossierId);
      const source = await this.obligationAvecTropPercu(
        transaction,
        dto.elementDossierId,
      );
      const montant = this.montantDansTropPercu(
        dto.montant,
        source.tropPercu,
        source.obligation.elementRequis.nom,
      );
      const remboursement = await transaction.paiement.create({
        data: {
          demandeBourseId: source.obligation.demandeBourseId,
          inscriptionId: source.obligation.inscriptionId,
          elementDossierId: source.obligation.id,
          montant: (-montant).toFixed(2),
          typePaiement: 'REMBOURSEMENT',
          modePaiement,
          numeroRecu: await numeroRecu(transaction),
          motif,
          saisiParNom: auteur,
        },
        include: {
          demandeBourse: { include: { personne: true } },
          inscription: { include: { personne: true } },
          elementDossier: { include: { elementRequis: true } },
          echeance: true,
        },
      });
      return this.transaction(remboursement);
    });
  }

  async findUnassigned() {
    const payments = await this.prisma.paiement.findMany({
      where: {
        elementDossierId: null,
        echeanceId: null,
        // Les régularisations (report, remboursement) ne sont pas à affecter.
        typePaiement: { in: [...TYPES_PAIEMENT] },
        annulation: { is: null },
      },
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
        echeanceId: true,
        demandeBourseId: true,
        inscriptionId: true,
        annulation: { select: { id: true } },
      },
    });
    if (!payment) throw new NotFoundException('Paiement introuvable');
    if (payment.annulation)
      throw new ConflictException(
        'Ce paiement est annulé et ne peut plus être affecté',
      );
    if (payment.elementDossierId) {
      throw new ConflictException('Ce paiement est deja affecte');
    }
    if (payment.echeanceId) {
      throw new BadRequestException(
        'Ce paiement regle une echeance de bourse et ne peut pas etre affecte a une obligation',
      );
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
    const result = await this.prisma.$transaction(async (transaction) => {
      await verrouillerDossier(
        transaction,
        payment.demandeBourseId ?? payment.inscriptionId,
      );
      await this.ensureWithinRemaining(
        obligation,
        Number(payment.montant),
        transaction,
      );
      return transaction.paiement.updateMany({
        where: { id: paymentId, elementDossierId: null },
        data: { elementDossierId },
      });
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

  private async verrouillerObligation(
    transaction: Transaction,
    elementDossierId: string | undefined,
  ) {
    if (!elementDossierId) return;
    const obligation = await transaction.elementDossier.findUnique({
      where: { id: elementDossierId },
      select: { demandeBourseId: true, inscriptionId: true },
    });
    await verrouillerDossier(
      transaction,
      obligation?.demandeBourseId ?? obligation?.inscriptionId,
    );
  }

  // Une échéance de bourse ne reçoit pas plus que son montant, que le
  // versement soit fait sur la demande ou sur l'inscription qui en découle.
  private async ensureEcheanceWithinRemaining(
    transaction: Transaction,
    echeance: { id: string; montantAttendu: unknown },
    dossier: { id: string; demandeBourseId: string | null },
    montant: number,
  ): Promise<void> {
    if (
      echeance.montantAttendu === null ||
      echeance.montantAttendu === undefined
    )
      return;
    const paye = await transaction.paiement.aggregate({
      where: {
        echeanceId: echeance.id,
        ...(dossier.demandeBourseId
          ? {
              OR: [
                { demandeBourseId: dossier.demandeBourseId },
                { inscription: { demandeBourseId: dossier.demandeBourseId } },
              ],
            }
          : { inscriptionId: dossier.id }),
      },
      _sum: { montant: true },
    });
    const reste = this.roundMoney(
      Number(echeance.montantAttendu) - Number(paye._sum.montant ?? 0),
    );
    if (montant > reste)
      throw new BadRequestException(
        reste > 0
          ? `Le paiement depasse le montant restant de cette echeance (${reste} F)`
          : 'Cette echeance est deja soldee',
      );
  }

  private async ensureWithinRemaining(
    obligation: { id: string; montantAttendu: unknown },
    montant: number,
    client: Transaction | PrismaService = this.prisma,
  ): Promise<void> {
    if (!obligation.montantAttendu) {
      throw new BadRequestException(
        'Cette obligation ne possède pas de montant attendu',
      );
    }
    const allocated = await client.paiement.aggregate({
      where: { elementDossierId: obligation.id },
      _sum: { montant: true },
    });
    const remaining = this.roundMoney(
      Number(obligation.montantAttendu) - Number(allocated._sum.montant ?? 0),
    );
    if (montant > remaining) {
      throw new BadRequestException(
        'Le paiement depasse le montant restant de cette obligation',
      );
    }
  }

  private async getDemandeDossier(id: string) {
    const demande = await this.prisma.demandeBourse.findUnique({
      where: { id },
      select: { id: true, typeBourseId: true },
    });
    if (!demande) {
      throw new NotFoundException('Demande de bourse introuvable');
    }
    return { ...demande, demandeBourseId: demande.id as string | null };
  }

  private async getInscriptionDossier(id: string) {
    const inscription = await this.prisma.inscription.findUnique({
      where: { id },
      select: {
        id: true,
        demandeBourseId: true,
        demandeBourse: { select: { typeBourseId: true } },
      },
    });
    if (!inscription) {
      throw new NotFoundException('Inscription introuvable');
    }
    return {
      id: inscription.id,
      demandeBourseId: inscription.demandeBourseId,
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
    const normalized = String(value).trim().replace(',', '.');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('montant doit etre strictement positif');
    }
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
      throw new BadRequestException(
        'montant doit avoir au maximum 2 decimales',
      );
    }
    if (parsed > 99_999_999.99) {
      throw new BadRequestException('montant depasse la limite autorisee');
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
