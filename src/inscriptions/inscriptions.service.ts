import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { $Enums } from '../../generated/prisma/client';
import { normaliser } from '../academique/academique.rules';
import { niveauxApplicables, niveauxConnus } from '../academique/niveaux';
import { PrismaService } from '../prisma/prisma.service';
import {
  nomUtilisateur,
  numeroRecu,
  parseModePaiement,
} from '../paiements/encaissement';
import { CreateInscriptionDto } from './dto/create-inscription.dto';
import { SearchInscriptionsDto } from './dto/search-inscriptions.dto';
import { UpdateInscriptionElementDto } from './dto/update-inscription-element.dto';
import { UpdateInscriptionDto } from './dto/update-inscription.dto';
import {
  requiredDeletionReason,
  toTrashSnapshot,
} from '../corbeille/corbeille.utils';
import { parseDateOrder } from '../common/date-order';
import { refuserSuppressionScolarite } from '../common/scolarite-guard';

const STATUTS_INSCRIPTION = ['EN_COURS', 'COMPLETE', 'ABANDONNEE'] as const;
const STATUTS_ELEMENT = ['ATTENDU', 'FOURNI', 'MANQUANT', 'SUBSTITUE'] as const;

type StatutInscriptionValue = (typeof STATUTS_INSCRIPTION)[number];
type StatutElementValue = (typeof STATUTS_ELEMENT)[number];

@Injectable()
export class InscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  // dateSaisie : heure réelle d'une saisie faite hors ligne (sinon, maintenant).
  async create(
    createDto: CreateInscriptionDto,
    creeParId: string,
    dateSaisie?: Date,
  ) {
    const nouvellePersonne = createDto.nouvellePersonne;
    const viaBourse = createDto.viaBourse === true;
    if (nouvellePersonne && (createDto.personneId || viaBourse)) {
      throw new BadRequestException(
        'Une inscription via bourse doit utiliser la personne de la demande liée',
      );
    }
    const personneId = nouvellePersonne
      ? null
      : this.optionalString(createDto.personneId);
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
    const niveau = await this.parseNiveau(createDto.niveau);
    const { filiere, filiereId } = await this.resoudreFiliere(
      createDto.filiere,
      createDto.filiereId,
    );
    const applicables = await this.niveauApplicable(niveau);
    const demandeBourseId = this.optionalString(createDto.demandeBourseId);

    if (!nouvellePersonne && !viaBourse && !personneId) {
      throw new BadRequestException(
        'personneId est obligatoire pour une inscription directe',
      );
    }
    if (personneId && !viaBourse) await this.ensurePersonne(personneId);
    const personneBourseId = await this.ensureBourseCoherence(
      personneId,
      viaBourse,
      demandeBourseId,
      createDto.confirmerDemandeEnCours === true,
    );

    return this.prisma.$transaction(async (transaction) => {
      const catalogue = await transaction.elementRequis.findMany({
        where: {
          contexte: { in: ['INSCRIPTION_DIRECTE', 'TOUS'] },
          niveauApplicable: applicables,
        },
      });
      const statuses = createDto.preparation?.statuses ?? {};
      const dossierElements = catalogue.map((element) => {
        const requestedStatus = statuses[element.id];
        if (
          requestedStatus !== undefined &&
          typeof requestedStatus !== 'string'
        ) {
          throw new BadRequestException('Le statut d une pièce est invalide');
        }
        const statut =
          requestedStatus === undefined
            ? 'ATTENDU'
            : this.parseElementStatut(requestedStatus);
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
            statut === 'FOURNI' || statut === 'SUBSTITUE'
              ? (dateSaisie ?? new Date())
              : null,
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
                lieuNaissance: this.optionalString(
                  nouvellePersonne.lieuNaissance,
                ),
                tuteurNom: this.optionalString(nouvellePersonne.tuteurNom),
                tuteurPrenom: this.optionalString(
                  nouvellePersonne.tuteurPrenom,
                ),
                tuteurTelephone: this.optionalString(
                  nouvellePersonne.tuteurTelephone,
                ),
                creeParId,
                ...(dateSaisie ? { dateEnregistrement: dateSaisie } : {}),
              },
              select: { id: true },
            })
          ).id
        : viaBourse
          ? personneBourseId!
          : personneId!;
      const inscription = await transaction.inscription.create({
        data: {
          personneId: resolvedPersonneId,
          anneeScolaire,
          niveau,
          filiere,
          filiereId,
          viaBourse,
          demandeBourseId,
          elementsDossier: {
            create: dossierElements,
          },
          ...(dateSaisie ? { dateInscription: dateSaisie } : {}),
        },
        include: this.detailInclude(),
      });
      if (preparationPayment) {
        const element = inscription.elementsDossier.find(
          (item) => item.elementRequisId === preparationPayment.elementId,
        );
        if (!element) {
          throw new BadRequestException(
            'La pièce choisie ne fait pas partie du dossier',
          );
        }
        await transaction.paiement.create({
          data: {
            inscriptionId: inscription.id,
            elementDossierId: element.id,
            montant: preparationPayment.montant,
            typePaiement: preparationPayment.typePaiement,
            modePaiement: parseModePaiement(
              createDto.preparation?.modePaiement,
            ),
            saisiParNom: await nomUtilisateur(transaction, creeParId),
            numeroRecu: await numeroRecu(transaction),
            ...(dateSaisie ? { datePaiement: dateSaisie } : {}),
          },
        });
        return transaction.inscription.findUnique({
          where: { id: inscription.id },
          include: this.detailInclude(),
        });
      }
      return inscription;
    });
  }

  private prepareInitialPayment(
    preparation: CreateInscriptionDto['preparation'],
    catalogue: Array<{ id: string; montantAttendu: unknown }>,
  ) {
    const rawAmount = preparation?.montant;
    const value =
      rawAmount === undefined || rawAmount === null
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
    if (
      !element ||
      element.montantAttendu === null ||
      element.montantAttendu === undefined
    ) {
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
    if (typePaiement !== 'FRAIS_INSCRIPTION') {
      throw new BadRequestException(
        "Une inscription ne peut être réglée qu'en frais d'inscription",
      );
    }
    return {
      elementId,
      montant: amount.toFixed(2),
      typePaiement: 'FRAIS_INSCRIPTION' as const,
    };
  }

  async findAll(search: SearchInscriptionsDto) {
    const page = this.parsePagination(search.page, 1);
    const limit = this.parsePagination(search.limit, 20, 100);
    const ordreDate = parseDateOrder(search.ordreDate);
    const query = this.optionalString(search.q);
    const where: {
      anneeScolaire?: { contains: string; mode: 'insensitive' };
      niveau?: { contains: string; mode: 'insensitive' };
      statut?: StatutInscriptionValue;
      demandeBourse?: { is: { typeBourseId: string } };
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
    if (search.typeBourseId) {
      where.demandeBourse = { is: { typeBourseId: search.typeBourseId } };
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
          elementsDossier: {
            select: {
              statut: true,
              montantAttendu: true,
              paiements: { select: { montant: true } },
              elementRequis: { select: { nom: true } },
            },
          },
        },
        orderBy: [{ dateInscription: ordreDate }, { id: ordreDate }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map((inscription) => ({
        ...inscription,
        elementsManquants: inscription.elementsDossier
          .filter(
            (element) =>
              element.statut !== 'FOURNI' && element.statut !== 'SUBSTITUE',
          )
          .map((element) => element.elementRequis.nom),
        obligationsImpayees: inscription.elementsDossier.flatMap((element) => {
          if (element.montantAttendu === null) return [];
          const reste =
            Number(element.montantAttendu) -
            element.paiements.reduce(
              (total, paiement) => total + Number(paiement.montant),
              0,
            );
          return reste > 0
            ? [{ nom: element.elementRequis.nom, reste: this.money(reste) }]
            : [];
        }),
        dossierComplet: inscription.elementsDossier.every((element) => {
          const documentComplet =
            element.statut === 'FOURNI' || element.statut === 'SUBSTITUE';
          const reste =
            element.montantAttendu === null
              ? 0
              : Number(element.montantAttendu) -
                element.paiements.reduce(
                  (total, paiement) => total + Number(paiement.montant),
                  0,
                );
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

  async remove(id: string, rawReason: string, deletedById: string) {
    const motif = requiredDeletionReason(rawReason);
    return this.prisma.$transaction(async (transaction) => {
      await refuserSuppressionScolarite(transaction, { id });
      const inscription = await transaction.inscription.findUnique({
        where: { id },
        include: {
          personne: true,
          demandeBourse: {
            include: { typeBourse: { include: { echeances: true } } },
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
      if (!inscription) {
        throw new NotFoundException('Inscription introuvable');
      }

      const elements = await transaction.elementDossier.findMany({
        where: { inscriptionId: id },
        select: { id: true },
      });
      const author = await transaction.utilisateur.findUnique({
        where: { id: deletedById },
        select: { id: true, nom: true, prenom: true },
      });
      await transaction.elementCorbeille.create({
        data: {
          type: 'INSCRIPTION',
          entiteId: id,
          libelle: `${inscription.personne.prenom} ${inscription.personne.nom} · ${inscription.filiere} · ${inscription.anneeScolaire}`,
          motif,
          supprimeParId: author?.id ?? deletedById,
          supprimeParNom:
            [author?.prenom, author?.nom].filter(Boolean).join(' ') ||
            'Utilisateur inconnu',
          donnees: toTrashSnapshot(inscription),
        },
      });
      await transaction.paiement.deleteMany({
        where: {
          OR: [
            { inscriptionId: id },
            { elementDossierId: { in: elements.map((element) => element.id) } },
          ],
        },
      });
      await transaction.elementDossier.deleteMany({
        where: { inscriptionId: id },
      });
      await transaction.inscription.delete({ where: { id } });
      return { id };
    });
  }

  async update(id: string, updateDto: UpdateInscriptionDto) {
    const current = await this.findCurrent(id);
    const data: {
      anneeScolaire?: string;
      niveau?: string;
      filiere?: string;
      filiereId?: string | null;
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
      data.niveau = await this.parseNiveau(updateDto.niveau);
    }
    if (updateDto.filiere !== undefined || updateDto.filiereId) {
      const lien = await this.resoudreFiliere(
        updateDto.filiere,
        updateDto.filiereId,
      );
      // Un étudiant déjà en classe garde la filière de sa classe.
      if (current.classe && lien.filiereId !== current.classe.filiereId)
        throw new ConflictException(
          "Cet étudiant est déjà affecté à une classe : retirez-le d'abord de la classe pour changer sa filière",
        );
      data.filiere = lien.filiere;
      data.filiereId = lien.filiereId;
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

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Aucune information a modifier');
    }

    // Le lien avec la bourse n'est revalidé que s'il change : une demande déjà
    // confirmée à la création ne doit pas bloquer les autres modifications.
    if (
      viaBourse !== current.viaBourse ||
      demandeBourseId !== current.demandeBourseId
    ) {
      await this.ensureBourseCoherence(
        current.personneId,
        viaBourse,
        demandeBourseId,
        updateDto.confirmerDemandeEnCours === true,
      );
    }

    const inscription = await this.prisma.inscription.update({
      where: { id },
      data,
      include: this.detailInclude(),
    });
    // Un changement de niveau change les frais dus.
    if (data.niveau && data.niveau !== current.niveau) {
      await this.ensureElementsForDossier(id);
      return this.findOne(id);
    }
    return inscription;
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
        paiements: {
          where: { elementDossierId: null, echeanceId: null },
          select: { montant: true },
        },
      },
    });
    if (!inscription) throw new NotFoundException('Inscription introuvable');
    const obligations = inscription.elementsDossier.map((element) => {
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
      };
    });
    const montantPayeNonAffecte = inscription.paiements.reduce(
      (total, paiement) => total + Number(paiement.montant),
      0,
    );
    return {
      demandeId: id,
      obligations,
      montantPayeNonAffecte: this.money(montantPayeNonAffecte),
      totalAttendu: this.money(
        obligations.reduce(
          (total, obligation) => total + Number(obligation.montantAttendu),
          0,
        ),
      ),
      totalPaye: this.money(
        obligations.reduce(
          (total, obligation) => total + Number(obligation.montantPaye),
          0,
        ) + montantPayeNonAffecte,
      ),
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
        niveauApplicable: await this.niveauApplicable(inscription.niveau),
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
    await this.retirerFraisHorsNiveau(id, inscription.niveau);
  }

  // Un dossier ne doit que les frais de son niveau. Un frais d'un autre niveau
  // peut y rester (ancien frais unique devenu « L1 », niveau corrigé après
  // coup) : on le retire, et ce qui a déjà été payé dessus est reporté sur le
  // frais du bon niveau.
  private async retirerFraisHorsNiveau(id: string, niveau: string) {
    const niveaux = (await this.niveauApplicable(niveau)).in;
    const frais = await this.prisma.elementDossier.findMany({
      where: {
        inscriptionId: id,
        elementRequis: { categorie: 'FRAIS', contexte: 'INSCRIPTION_DIRECTE' },
      },
      include: { elementRequis: { select: { niveauApplicable: true } } },
    });
    const horsNiveau = frais.filter(
      (element) => !niveaux.includes(element.elementRequis.niveauApplicable),
    );
    if (!horsNiveau.length) return;
    const duNiveau = frais.filter((element) => !horsNiveau.includes(element));
    // Sans frais unique où le reporter, le versement redevient « non affecté » :
    // il reste compté sur le dossier. S'il dépasse le nouveau frais, l'excédent
    // apparaît comme un trop-perçu à reporter ou à rembourser.
    const cible = duNiveau.length === 1 ? duNiveau[0] : null;
    const horsNiveauIds = horsNiveau.map((element) => element.id);
    await this.prisma.$transaction([
      this.prisma.paiement.updateMany({
        where: { elementDossierId: { in: horsNiveauIds } },
        data: { elementDossierId: cible?.id ?? null },
      }),
      this.prisma.elementDossier.deleteMany({
        where: { id: { in: horsNiveauIds } },
      }),
    ]);
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

  // Pièces et frais du niveau, d'après son rang dans le cycle.
  private async niveauApplicable(niveau: string): Promise<{
    in: $Enums.NiveauApplicable[];
  }> {
    const niveaux = await niveauxConnus(this.prisma);
    const rang = niveaux.find((item) => item.code === niveau)?.rang ?? 2;
    return { in: niveauxApplicables(rang) };
  }

  // Le niveau doit exister dans le référentiel (L1, L2, L3, M1…).
  private async parseNiveau(value: string): Promise<string> {
    const normalized = this.requiredString(value, 'niveau')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    const niveaux = (await niveauxConnus(this.prisma)).filter(
      (niveau) => niveau.actif,
    );
    const alias: Record<string, string> = {
      '1': 'L1',
      PREMIERE_ANNEE: 'L1',
      '2': 'L2',
      DEUXIEME_ANNEE: 'L2',
    };
    const code = alias[normalized] ?? normalized;
    const niveau = niveaux.find((item) => item.code.toUpperCase() === code);
    if (!niveau)
      throw new BadRequestException(
        `niveau doit etre parmi : ${niveaux.map((item) => item.code).join(', ')}`,
      );
    return niveau.code;
  }

  // Rattache l'inscription à une filière du référentiel : par son identifiant,
  // sinon par son nom ou son code, sans tenir compte de la casse ni des accents.
  // Une filière inconnue reste un texte libre, à rapprocher plus tard.
  private async resoudreFiliere(
    texte: string | undefined,
    filiereId: string | null | undefined,
  ): Promise<{ filiere: string; filiereId: string | null }> {
    if (filiereId) {
      const filiere = await this.prisma.filiere.findUnique({
        where: { id: filiereId },
      });
      if (!filiere) throw new NotFoundException('Filière introuvable');
      return { filiere: filiere.nom, filiereId: filiere.id };
    }
    const saisie = this.requiredString(texte, 'filiere').replace(/\s+/g, ' ');
    const cible = normaliser(saisie);
    const filieres = await this.prisma.filiere.findMany();
    const trouvee = filieres.find(
      (filiere) =>
        normaliser(filiere.nom) === cible || normaliser(filiere.code) === cible,
    );
    return trouvee
      ? { filiere: trouvee.nom, filiereId: trouvee.id }
      : { filiere: saisie, filiereId: null };
  }

  private async ensureBourseCoherence(
    personneId: string | null,
    viaBourse: boolean,
    demandeBourseId: string | null,
    confirmerDemandeEnCours = false,
  ): Promise<string | null> {
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
    if (!demandeBourseId) return null;
    if (demandeBourseId) {
      const demande = await this.prisma.demandeBourse.findUnique({
        where: { id: demandeBourseId },
        select: { personneId: true, statut: true },
      });
      if (!demande) {
        throw new NotFoundException('Demande de bourse introuvable');
      }
      if (personneId && demande.personneId !== personneId) {
        throw new BadRequestException(
          'La demande de bourse ne concerne pas cette personne',
        );
      }
      if (demande.statut !== 'ACCEPTEE' && !confirmerDemandeEnCours) {
        throw new ConflictException(
          'La demande de bourse est encore en attente de décision. Confirmation requise.',
        );
      }
      return demande.personneId;
    }
    return null;
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
        niveau: true,
        viaBourse: true,
        demandeBourseId: true,
        classe: { select: { filiereId: true } },
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

  private optionalDate(
    value: string | null | undefined,
    field: string,
  ): Date | null {
    if (value === null || value === undefined || value.trim() === '')
      return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} doit etre une date valide`);
    }
    return date;
  }

  private money(value: number): string {
    return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
  }
}
