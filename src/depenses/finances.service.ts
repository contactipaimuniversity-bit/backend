import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUniqueConstraintViolation } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { ComptabiliteService } from '../comptabilite/comptabilite.service';
import {
  montantRetenu,
  parseDate,
  ReglesFinance,
  roundMoney,
  saisie,
  STATUTS_ENGAGES,
  STATUTS_RESERVES,
  texteOptionnel,
  texteRequis,
} from './depenses.rules';

const PARAMETRES_ID = 'finance';

// Catégories proposées à la première utilisation ; l'établissement les adapte.
const CATEGORIES_INITIALES: Array<[string, boolean]> = [
  ['Fournitures de bureau', true],
  ['Matériel et équipement', true],
  ['Matériel pédagogique', true],
  ['Entretien et réparations', true],
  ['Prestations de service', true],
  ['Loyer et charges locatives', false],
  ['Eau, électricité et internet', false],
  ['Salaires et honoraires', false],
  ['Transport et missions', false],
  ['Communication et publicité', false],
  ['Impôts et taxes', false],
];

type Transaction = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
type Client = PrismaService | Transaction;

@Injectable()
export class FinancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comptabilite: ComptabiliteService,
  ) {}

  private money(value: number): string {
    return roundMoney(value).toFixed(2);
  }

  // ---------- Règles ----------

  async parametres() {
    const existing = await this.prisma.parametresFinance.findUnique({
      where: { id: PARAMETRES_ID },
    });
    if (existing) return existing;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.parametresFinance.create({
          data: { id: PARAMETRES_ID },
        });
        if ((await transaction.categorieDepense.count()) === 0)
          await transaction.categorieDepense.createMany({
            data: CATEGORIES_INITIALES.map(([nom, livraisonRequise]) => ({
              nom,
              livraisonRequise,
            })),
          });
        return created;
      });
    } catch (error) {
      // Deux premières lectures simultanées : l'autre a créé la ligne.
      if (!isUniqueConstraintViolation(error)) throw error;
      return this.prisma.parametresFinance.findUniqueOrThrow({
        where: { id: PARAMETRES_ID },
      });
    }
  }

  async regles(): Promise<ReglesFinance> {
    const parametres = await this.parametres();
    return {
      seuilDoubleValidation: Number(parametres.seuilDoubleValidation),
      budgetBloquant: parametres.budgetBloquant,
      separationPaiement: parametres.separationPaiement,
    };
  }

  async updateParametres(body: {
    seuilDoubleValidation?: unknown;
    budgetBloquant?: unknown;
    separationPaiement?: unknown;
  }) {
    await this.parametres();
    const data: {
      seuilDoubleValidation?: string;
      budgetBloquant?: boolean;
      separationPaiement?: boolean;
    } = {};
    if (body.seuilDoubleValidation !== undefined) {
      const seuil = Number(
        saisie(body.seuilDoubleValidation).replace(/\s/g, '').replace(',', '.'),
      );
      if (
        !saisie(body.seuilDoubleValidation).trim() ||
        !Number.isFinite(seuil) ||
        seuil < 0 ||
        seuil > 9_999_999_999
      )
        throw new BadRequestException(
          'Le seuil de double validation doit être un montant positif ou nul',
        );
      data.seuilDoubleValidation = this.money(seuil);
    }
    if (body.budgetBloquant !== undefined)
      data.budgetBloquant = body.budgetBloquant === true;
    if (body.separationPaiement !== undefined)
      data.separationPaiement = body.separationPaiement === true;
    return this.prisma.parametresFinance.update({
      where: { id: PARAMETRES_ID },
      data,
    });
  }

  // ---------- Catégories ----------

  async categories() {
    await this.parametres();
    return this.prisma.categorieDepense.findMany({ orderBy: { nom: 'asc' } });
  }

  async createCategorie(body: { nom?: unknown; livraisonRequise?: unknown }) {
    try {
      return await this.prisma.categorieDepense.create({
        data: {
          nom: texteRequis(body.nom, 'Le nom de la catégorie', 2, 120),
          livraisonRequise: body.livraisonRequise !== false,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException('Cette catégorie existe déjà');
      throw error;
    }
  }

  async updateCategorie(
    id: string,
    body: {
      nom?: unknown;
      livraisonRequise?: unknown;
      actif?: unknown;
      compteNumero?: unknown;
    },
  ) {
    const categorie = await this.prisma.categorieDepense.findUnique({
      where: { id },
    });
    if (!categorie) throw new NotFoundException('Catégorie introuvable');
    try {
      return await this.prisma.categorieDepense.update({
        where: { id },
        data: {
          ...(body.nom !== undefined
            ? { nom: texteRequis(body.nom, 'Le nom de la catégorie', 2, 120) }
            : {}),
          ...(body.livraisonRequise !== undefined
            ? { livraisonRequise: body.livraisonRequise === true }
            : {}),
          ...(body.compteNumero !== undefined
            ? { compteNumero: texteOptionnel(body.compteNumero, 12) }
            : {}),
          ...(body.actif !== undefined ? { actif: body.actif === true } : {}),
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException('Cette catégorie existe déjà');
      throw error;
    }
  }

  // ---------- Fournisseurs ----------

  fournisseurs() {
    return this.prisma.fournisseur.findMany({ orderBy: { nom: 'asc' } });
  }

  private fournisseurData(body: Record<string, unknown>) {
    return {
      nom: texteRequis(body.nom, 'Le nom du fournisseur', 2, 160),
      telephone: texteOptionnel(body.telephone, 40),
      email: texteOptionnel(body.email, 160),
      adresse: texteOptionnel(body.adresse, 300),
      identifiantFiscal: texteOptionnel(body.identifiantFiscal, 80),
    };
  }

  async createFournisseur(body: Record<string, unknown>) {
    try {
      return await this.prisma.fournisseur.create({
        data: this.fournisseurData(body),
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException('Ce fournisseur existe déjà');
      throw error;
    }
  }

  async updateFournisseur(id: string, body: Record<string, unknown>) {
    const fournisseur = await this.prisma.fournisseur.findUnique({
      where: { id },
    });
    if (!fournisseur) throw new NotFoundException('Fournisseur introuvable');
    try {
      return await this.prisma.fournisseur.update({
        where: { id },
        data: {
          ...(body.nom !== undefined ? this.fournisseurData(body) : {}),
          ...(body.actif !== undefined ? { actif: body.actif === true } : {}),
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException('Ce fournisseur existe déjà');
      throw error;
    }
  }

  // ---------- Exercices ----------

  exercices() {
    return this.prisma.exerciceBudgetaire.findMany({
      orderBy: { dateDebut: 'desc' },
    });
  }

  // Exercice ouvert qui couvre la date : c'est lui qui porte la dépense.
  exerciceOuvert(date: Date, client: Client = this.prisma) {
    return client.exerciceBudgetaire.findFirst({
      where: {
        cloture: false,
        dateDebut: { lte: date },
        dateFin: { gte: date },
      },
    });
  }

  async createExercice(body: {
    libelle?: unknown;
    dateDebut?: unknown;
    dateFin?: unknown;
  }) {
    const libelle = texteRequis(
      body.libelle,
      "Le libellé de l'exercice",
      2,
      60,
    );
    const dateDebut = parseDate(body.dateDebut, 'La date de début');
    const dateFin = parseDate(body.dateFin, 'La date de fin');
    // L'écran envoie les bornes du jour à l'heure locale de l'établissement ;
    // une date seule (sans heure) couvre la journée entière en UTC.
    if (!String(body.dateFin).includes('T'))
      dateFin.setUTCHours(23, 59, 59, 999);
    if (dateFin <= dateDebut)
      throw new BadRequestException(
        'La date de fin doit suivre la date de début',
      );
    const chevauchement = await this.prisma.exerciceBudgetaire.findFirst({
      where: { dateDebut: { lte: dateFin }, dateFin: { gte: dateDebut } },
    });
    if (chevauchement)
      throw new ConflictException(
        `Cette période chevauche l'exercice « ${chevauchement.libelle} »`,
      );
    try {
      return await this.prisma.exerciceBudgetaire.create({
        data: { libelle, dateDebut, dateFin },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException('Un exercice porte déjà ce libellé');
      throw error;
    }
  }

  async updateExercice(id: string, body: { cloture?: unknown }) {
    const exercice = await this.prisma.exerciceBudgetaire.findUnique({
      where: { id },
    });
    if (!exercice) throw new NotFoundException('Exercice introuvable');
    const cloture = body.cloture === true;
    if (cloture) {
      // On ne ferme pas un exercice qui porte encore des dépenses en cours.
      const enCours = await this.prisma.depense.count({
        where: {
          exerciceId: id,
          statut: {
            in: [
              'SOUMISE',
              'VALIDATION_FINALE',
              'VALIDEE',
              'RECEPTIONNEE',
              'FACTUREE',
              'PAYEE_PARTIELLEMENT',
            ],
          },
        },
      });
      if (enCours > 0)
        throw new ConflictException(
          `${enCours} dépense(s) de cet exercice sont encore en cours : terminez-les ou annulez-les avant la clôture`,
        );
      // Les opérations pas encore passées en comptabilité y entrent avant la fermeture.
      await this.comptabilite.synchroniser();
    }
    return this.prisma.exerciceBudgetaire.update({
      where: { id },
      data: { cloture },
    });
  }

  // ---------- Budget ----------

  // Consommation d'une catégorie sur un exercice, hors dépense en cours de calcul.
  async consommation(
    exerciceId: string,
    categorieId: string,
    client: Client = this.prisma,
    sansDepenseId?: string,
  ) {
    const depenses = await client.depense.findMany({
      where: {
        exerciceId,
        categorieId,
        statut: { in: [...STATUTS_RESERVES, ...STATUTS_ENGAGES] },
        ...(sansDepenseId ? { id: { not: sansDepenseId } } : {}),
      },
      select: {
        statut: true,
        montant: true,
        montantFacture: true,
        decaissements: { select: { montant: true } },
      },
    });
    let reserve = 0;
    let engage = 0;
    let paye = 0;
    for (const depense of depenses) {
      const retenu = montantRetenu(depense);
      const decaisse = depense.decaissements.reduce(
        (total, item) => total + Number(item.montant),
        0,
      );
      if ((STATUTS_RESERVES as readonly string[]).includes(depense.statut))
        reserve += retenu;
      else {
        paye += decaisse;
        engage += Math.max(0, retenu - decaisse);
      }
    }
    // La paie validée pèse sur la catégorie budgétaire qui lui est rattachée.
    const parametresRH = await client.parametresRH.findUnique({
      where: { id: 'rh' },
    });
    if (parametresRH?.categoriePaieId === categorieId) {
      const exercice = await client.exerciceBudgetaire.findUnique({
        where: { id: exerciceId },
      });
      const periodes = exercice
        ? await client.periodePaie.findMany({
            where: { statut: { in: ['VALIDEE', 'PAYEE'] } },
            include: {
              bulletins: { select: { brut: true, chargesPatronales: true } },
            },
          })
        : [];
      for (const periode of periodes) {
        const finDuMois = new Date(
          Date.UTC(periode.annee, periode.mois, 0, 12),
        );
        if (finDuMois < exercice!.dateDebut || finDuMois > exercice!.dateFin)
          continue;
        const cout = periode.bulletins.reduce(
          (total, bulletin) =>
            total + Number(bulletin.brut) + Number(bulletin.chargesPatronales),
          0,
        );
        if (periode.statut === 'PAYEE') paye += cout;
        else engage += cout;
      }
    }
    return {
      reserve: roundMoney(reserve),
      engage: roundMoney(engage),
      paye: roundMoney(paye),
      total: roundMoney(reserve + engage + paye),
    };
  }

  async disponible(
    exerciceId: string,
    categorieId: string,
    client: Client = this.prisma,
    sansDepenseId?: string,
  ) {
    const ligne = await client.ligneBudget.findUnique({
      where: { exerciceId_categorieId: { exerciceId, categorieId } },
    });
    const budget = Number(ligne?.montant ?? 0);
    const consommation = await this.consommation(
      exerciceId,
      categorieId,
      client,
      sansDepenseId,
    );
    return {
      budget,
      disponible: roundMoney(budget - consommation.total),
    };
  }

  async budget(exerciceId?: string) {
    await this.parametres();
    const exercices = await this.exercices();
    const exercice =
      exercices.find((item) => item.id === exerciceId) ??
      (await this.exerciceOuvert(new Date())) ??
      exercices[0] ??
      null;
    if (!exercice)
      return { exercice: null, exercices, lignes: [], totaux: null };

    const [categories, lignesBudget, recettes] = await Promise.all([
      this.prisma.categorieDepense.findMany({ orderBy: { nom: 'asc' } }),
      this.prisma.ligneBudget.findMany({ where: { exerciceId: exercice.id } }),
      this.prisma.paiement.aggregate({
        where: {
          datePaiement: { gte: exercice.dateDebut, lte: exercice.dateFin },
        },
        _sum: { montant: true },
      }),
    ]);
    const lignes = (
      await Promise.all(
        categories.map(async (categorie) => {
          const budget = Number(
            lignesBudget.find((ligne) => ligne.categorieId === categorie.id)
              ?.montant ?? 0,
          );
          const consommation = await this.consommation(
            exercice.id,
            categorie.id,
          );
          return {
            categorieId: categorie.id,
            categorie: categorie.nom,
            actif: categorie.actif,
            budget: this.money(budget),
            reserve: this.money(consommation.reserve),
            engage: this.money(consommation.engage),
            paye: this.money(consommation.paye),
            disponible: this.money(budget - consommation.total),
            taux:
              budget > 0
                ? Math.round((consommation.total / budget) * 100)
                : null,
          };
        }),
      )
    )
      // Une catégorie désactivée ne reste visible que si elle porte des montants.
      .filter(
        (ligne) =>
          ligne.actif ||
          Number(ligne.budget) > 0 ||
          Number(ligne.budget) - Number(ligne.disponible) > 0,
      );
    const somme = (
      key: 'budget' | 'reserve' | 'engage' | 'paye' | 'disponible',
    ) => lignes.reduce((total, ligne) => total + Number(ligne[key]), 0);
    const totalRecettes = Number(recettes._sum.montant ?? 0);
    return {
      exercice,
      exercices,
      lignes,
      totaux: {
        budget: this.money(somme('budget')),
        reserve: this.money(somme('reserve')),
        engage: this.money(somme('engage')),
        paye: this.money(somme('paye')),
        disponible: this.money(somme('disponible')),
        recettes: this.money(totalRecettes),
        // Trésorerie de l'exercice : encaissements moins décaissements.
        solde: this.money(totalRecettes - somme('paye')),
      },
    };
  }

  async setBudget(body: {
    exerciceId?: unknown;
    categorieId?: unknown;
    montant?: unknown;
  }) {
    const exerciceId = texteRequis(body.exerciceId, "L'exercice");
    const categorieId = texteRequis(body.categorieId, 'La catégorie');
    const montant = Number(
      saisie(body.montant).replace(/\s/g, '').replace(',', '.'),
    );
    if (
      !saisie(body.montant).trim() ||
      !Number.isFinite(montant) ||
      montant < 0 ||
      montant > 9_999_999_999
    )
      throw new BadRequestException(
        'Le budget doit être un montant positif ou nul',
      );
    const [exercice, categorie] = await Promise.all([
      this.prisma.exerciceBudgetaire.findUnique({ where: { id: exerciceId } }),
      this.prisma.categorieDepense.findUnique({ where: { id: categorieId } }),
    ]);
    if (!exercice) throw new NotFoundException('Exercice introuvable');
    if (!categorie) throw new NotFoundException('Catégorie introuvable');
    if (exercice.cloture)
      throw new ConflictException(
        "Le budget d'un exercice clôturé ne peut plus être modifié",
      );
    const consommation = await this.consommation(exerciceId, categorieId);
    if (montant < consommation.total)
      throw new ConflictException(
        `Le budget ne peut pas descendre sous les ${consommation.total.toLocaleString('fr-FR')} F déjà réservés, engagés ou payés`,
      );
    return this.prisma.ligneBudget.upsert({
      where: { exerciceId_categorieId: { exerciceId, categorieId } },
      create: { exerciceId, categorieId, montant: this.money(montant) },
      update: { montant: this.money(montant) },
    });
  }
}
