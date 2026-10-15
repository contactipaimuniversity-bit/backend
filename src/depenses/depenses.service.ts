import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CloudinaryService, FichierRecu } from '../fichiers/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  Acteur,
  actionsPossibles,
  blocageAnnulation,
  blocageFacture,
  blocagePaiement,
  blocageReception,
  blocageValidation,
  DepenseCircuit,
  estDansLeFutur,
  exiger,
  niveauxRequis,
  parseDate,
  parseMontant,
  peut,
  ReglesFinance,
  roundMoney,
  STATUTS_A_EXECUTER,
  texteOptionnel,
  texteRequis,
  voitTout,
} from './depenses.rules';
import { FinancesService } from './finances.service';

type Transaction = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

type StatutDepense =
  | 'BROUILLON'
  | 'SOUMISE'
  | 'VALIDATION_FINALE'
  | 'VALIDEE'
  | 'RECEPTIONNEE'
  | 'FACTUREE'
  | 'PAYEE_PARTIELLEMENT'
  | 'PAYEE'
  | 'REJETEE'
  | 'ANNULEE';

type TypePiece =
  | 'LETTRE_DEMANDE'
  | 'DEVIS'
  | 'BON_LIVRAISON'
  | 'FACTURE'
  | 'PREUVE_PAIEMENT'
  | 'AUTRE';

const STATUTS: StatutDepense[] = [
  'BROUILLON',
  'SOUMISE',
  'VALIDATION_FINALE',
  'VALIDEE',
  'RECEPTIONNEE',
  'FACTUREE',
  'PAYEE_PARTIELLEMENT',
  'PAYEE',
  'REJETEE',
  'ANNULEE',
];
const PIECES_DEMANDE: TypePiece[] = ['LETTRE_DEMANDE', 'DEVIS', 'AUTRE'];
const MODES = ['ESPECES', 'MOBILE_MONEY', 'VIREMENT', 'CHEQUE'] as const;

const DETAIL = {
  categorie: true,
  fournisseur: true,
  exercice: true,
  lignes: { orderBy: { ordre: 'asc' as const } },
  pieces: { orderBy: { date: 'asc' as const } },
  decaissements: { orderBy: { dateSaisie: 'asc' as const } },
  historique: { orderBy: { date: 'asc' as const } },
};

const RESUME = {
  categorie: true,
  fournisseur: true,
  decaissements: { select: { montant: true } },
};

type DepenseResume = {
  statut: string;
  niveauxRequis: number;
  initiateurId: string;
  validation1ParId: string | null;
  validation2ParId: string | null;
  montant: unknown;
  montantFacture: unknown;
  categorie: { livraisonRequise: boolean };
  decaissements: Array<{ montant: unknown }>;
};

export type DepenseBody = {
  objet?: unknown;
  justification?: unknown;
  categorieId?: unknown;
  fournisseurId?: unknown;
  lignes?: unknown;
};

@Injectable()
export class DepensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finances: FinancesService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ---------- Lecture ----------

  private circuit(depense: DepenseResume): DepenseCircuit {
    return {
      statut: depense.statut,
      niveauxRequis: depense.niveauxRequis,
      initiateurId: depense.initiateurId,
      validation1ParId: depense.validation1ParId,
      validation2ParId: depense.validation2ParId,
      montant: depense.montant,
      montantFacture: depense.montantFacture,
      livraisonRequise: depense.categorie.livraisonRequise,
      totalPaye: roundMoney(
        depense.decaissements.reduce(
          (total, item) => total + Number(item.montant),
          0,
        ),
      ),
    };
  }

  private presenter<T extends DepenseResume>(
    depense: T,
    acteur: Acteur,
    regles: ReglesFinance,
  ) {
    const circuit = this.circuit(depense);
    const aPayer = Number(depense.montantFacture ?? depense.montant);
    return {
      ...depense,
      totalPaye: circuit.totalPaye.toFixed(2),
      resteAPayer: roundMoney(Math.max(0, aPayer - circuit.totalPaye)).toFixed(
        2,
      ),
      actions: actionsPossibles(circuit, acteur, regles),
    };
  }

  async findAll(
    acteur: Acteur,
    query: {
      vue?: string;
      statut?: string;
      q?: string;
      page?: string;
      limit?: string;
    },
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const statut = STATUTS.find((item) => item === query.statut);
    const q = query.q?.trim();
    const where = {
      // Sans rôle de contrôle, on ne voit que ses propres demandes.
      ...(query.vue === 'mes' || !voitTout(acteur)
        ? { initiateurId: acteur.id }
        : {}),
      ...(statut ? { statut } : {}),
      ...(q
        ? {
            OR: [
              { numero: { contains: q, mode: 'insensitive' as const } },
              { objet: { contains: q, mode: 'insensitive' as const } },
              { initiateurNom: { contains: q, mode: 'insensitive' as const } },
              {
                fournisseur: {
                  nom: { contains: q, mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
    };
    const [total, depenses, regles] = await Promise.all([
      this.prisma.depense.count({ where }),
      this.prisma.depense.findMany({
        where,
        include: RESUME,
        orderBy: [{ dateCreation: 'desc' }, { numero: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.finances.regles(),
    ]);
    return {
      data: depenses.map((depense) => this.presenter(depense, acteur, regles)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  // File d'attente du valideur : uniquement les niveaux qui lui sont attribués.
  async aValider(acteur: Acteur) {
    const statuts: StatutDepense[] = [
      ...(peut(acteur, 'view:expense-approval') ? ['SOUMISE' as const] : []),
      ...(peut(acteur, 'view:expense-final-approval')
        ? ['VALIDATION_FINALE' as const]
        : []),
    ];
    const [depenses, regles] = await Promise.all([
      this.prisma.depense.findMany({
        where: { statut: { in: statuts } },
        include: RESUME,
        orderBy: { dateSoumission: 'asc' },
      }),
      this.finances.regles(),
    ]);
    return depenses.map((depense) => this.presenter(depense, acteur, regles));
  }

  async aExecuter(acteur: Acteur) {
    const [depenses, regles] = await Promise.all([
      this.prisma.depense.findMany({
        where: { statut: { in: [...STATUTS_A_EXECUTER] } },
        include: RESUME,
        orderBy: { dateBonCommande: 'asc' },
      }),
      this.finances.regles(),
    ]);
    return depenses.map((depense) => this.presenter(depense, acteur, regles));
  }

  async compteurs(acteur: Acteur) {
    // « mine » : ses propres demandes ; « others » : celles des autres, seules
    // qu'on puisse valider (personne ne valide ce qu'il a initié).
    const count = (statuts: StatutDepense[], scope?: 'mine' | 'others') =>
      this.prisma.depense.count({
        where: {
          statut: { in: statuts },
          ...(scope === 'mine' ? { initiateurId: acteur.id } : {}),
          ...(scope === 'others' ? { initiateurId: { not: acteur.id } } : {}),
        },
      });
    const [brouillons, rejetees, validation1, validation2, aExecuter] =
      await Promise.all([
        count(['BROUILLON'], 'mine'),
        count(['REJETEE'], 'mine'),
        peut(acteur, 'view:expense-approval')
          ? count(['SOUMISE'], 'others')
          : 0,
        peut(acteur, 'view:expense-final-approval')
          ? count(['VALIDATION_FINALE'], 'others')
          : 0,
        peut(acteur, 'view:expense-payment')
          ? count([...STATUTS_A_EXECUTER])
          : 0,
      ]);
    return {
      brouillons,
      rejetees,
      aValider: validation1 + validation2,
      aExecuter,
    };
  }

  private async charger(id: string, acteur: Acteur) {
    const depense = await this.prisma.depense.findUnique({
      where: { id },
      include: DETAIL,
    });
    if (!depense) throw new NotFoundException('Dépense introuvable');
    if (depense.initiateurId !== acteur.id && !voitTout(acteur))
      throw new ForbiddenException(
        'Cette dépense ne fait pas partie de vos demandes',
      );
    return depense;
  }

  async findOne(id: string, acteur: Acteur) {
    const [depense, regles] = await Promise.all([
      this.charger(id, acteur),
      this.finances.regles(),
    ]);
    const budget = depense.exerciceId
      ? await this.finances.disponible(
          depense.exerciceId,
          depense.categorieId,
          this.prisma,
          depense.id,
        )
      : null;
    return {
      ...this.presenter(depense, acteur, regles),
      // Budget restant de la catégorie avant cette dépense : aide à la décision.
      budget: budget
        ? {
            budget: budget.budget.toFixed(2),
            disponibleAvant: budget.disponible.toFixed(2),
          }
        : null,
    };
  }

  // ---------- Outils ----------

  private async numero(
    transaction: Transaction,
    prefixe: 'DA' | 'BC' | 'DEC',
  ): Promise<string> {
    const cle = `${prefixe}-${new Date().getFullYear()}`;
    const sequence = await transaction.sequenceNumero.upsert({
      where: { cle },
      create: { cle, valeur: 1 },
      update: { valeur: { increment: 1 } },
    });
    return `${cle}-${String(sequence.valeur).padStart(4, '0')}`;
  }

  private tracer(
    transaction: Transaction,
    depenseId: string,
    action: string,
    statut: StatutDepense,
    acteur: Acteur,
    commentaire?: string | null,
  ) {
    return transaction.depenseHistorique.create({
      data: {
        depenseId,
        action,
        statut,
        utilisateurId: acteur.id,
        utilisateurNom: acteur.nom,
        commentaire: commentaire || null,
      },
    });
  }

  // Change l'état seulement si la dépense est toujours à l'étape attendue :
  // deux personnes ne peuvent pas statuer en même temps.
  private async transition(
    transaction: Transaction,
    id: string,
    depuis: StatutDepense[],
    data: Record<string, unknown>,
  ) {
    const result = await transaction.depense.updateMany({
      where: { id, statut: { in: depuis } },
      data,
    });
    if (result.count !== 1)
      throw new ConflictException(
        "Cette dépense vient d'être traitée par quelqu'un d'autre : actualisez la page",
      );
  }

  private async contenu(body: DepenseBody) {
    const objet = texteRequis(body.objet, "L'objet de la dépense", 3, 200);
    const justification = texteRequis(
      body.justification,
      "L'utilité de la dépense",
      10,
      1000,
    );
    const categorieId = texteRequis(body.categorieId, 'La catégorie');
    const fournisseurId =
      typeof body.fournisseurId === 'string' && body.fournisseurId.trim()
        ? body.fournisseurId.trim()
        : null;
    const [categorie, fournisseur] = await Promise.all([
      this.prisma.categorieDepense.findUnique({ where: { id: categorieId } }),
      fournisseurId
        ? this.prisma.fournisseur.findUnique({ where: { id: fournisseurId } })
        : null,
    ]);
    if (!categorie?.actif)
      throw new BadRequestException('Catégorie de dépense indisponible');
    if (fournisseurId && !fournisseur?.actif)
      throw new BadRequestException('Fournisseur indisponible');

    if (!Array.isArray(body.lignes) || body.lignes.length === 0)
      throw new BadRequestException('Ajoutez au moins une ligne à la demande');
    if (body.lignes.length > 50)
      throw new BadRequestException('Une demande est limitée à 50 lignes');
    const lignes = (body.lignes as Array<Record<string, unknown>>).map(
      (ligne, index) => ({
        designation: texteRequis(
          ligne?.designation,
          `Ligne ${index + 1} · désignation`,
          2,
          200,
        ),
        quantite: parseMontant(
          ligne?.quantite,
          `Ligne ${index + 1} · quantité`,
        ),
        prixUnitaire: parseMontant(
          ligne?.prixUnitaire,
          `Ligne ${index + 1} · prix unitaire`,
        ),
        ordre: index + 1,
      }),
    );
    const montant = roundMoney(
      lignes.reduce(
        (total, ligne) => total + ligne.quantite * ligne.prixUnitaire,
        0,
      ),
    );
    if (montant > 9_999_999_999.99)
      throw new BadRequestException('Le montant dépasse la limite autorisée');
    return {
      objet,
      justification,
      categorieId,
      fournisseurId,
      montant: montant.toFixed(2),
      lignes: lignes.map((ligne) => ({
        ...ligne,
        quantite: ligne.quantite.toFixed(2),
        prixUnitaire: ligne.prixUnitaire.toFixed(2),
      })),
    };
  }

  // ---------- Demande ----------

  async create(body: DepenseBody, acteur: Acteur) {
    const { lignes, ...contenu } = await this.contenu(body);
    const id = await this.prisma.$transaction(async (transaction) => {
      const depense = await transaction.depense.create({
        data: {
          ...contenu,
          numero: await this.numero(transaction, 'DA'),
          initiateurId: acteur.id,
          initiateurNom: acteur.nom,
          lignes: { create: lignes },
        },
      });
      await this.tracer(
        transaction,
        depense.id,
        'Création de la demande',
        'BROUILLON',
        acteur,
      );
      return depense.id;
    });
    return this.findOne(id, acteur);
  }

  private async brouillonDe(id: string, acteur: Acteur) {
    const depense = await this.charger(id, acteur);
    if (depense.initiateurId !== acteur.id)
      throw new ForbiddenException(
        'Seul le demandeur peut modifier sa demande',
      );
    if (depense.statut !== 'BROUILLON')
      throw new ConflictException("Une demande soumise n'est plus modifiable");
    return depense;
  }

  async update(id: string, body: DepenseBody, acteur: Acteur) {
    await this.brouillonDe(id, acteur);
    const { lignes, ...contenu } = await this.contenu(body);
    await this.prisma.$transaction(async (transaction) => {
      await this.transition(transaction, id, ['BROUILLON'], contenu);
      await transaction.depenseLigne.deleteMany({ where: { depenseId: id } });
      await transaction.depenseLigne.createMany({
        data: lignes.map((ligne) => ({ ...ligne, depenseId: id })),
      });
    });
    return this.findOne(id, acteur);
  }

  async addPiece(
    id: string,
    type: unknown,
    fichier: FichierRecu | undefined,
    acteur: Acteur,
  ) {
    const depense = await this.brouillonDe(id, acteur);
    const typePiece = PIECES_DEMANDE.find((item) => item === type);
    if (!typePiece)
      throw new BadRequestException(
        'Type de pièce attendu : lettre de demande, devis ou autre',
      );
    const verifie = this.cloudinary.verifier(fichier, 'Pièce jointe');
    const heberge = await this.cloudinary.envoyer(
      verifie,
      `ipaim/depenses/${depense.numero}`,
    );
    // Une seule lettre et un seul devis : le nouveau fichier remplace l'ancien.
    const remplacees =
      typePiece === 'AUTRE'
        ? []
        : depense.pieces.filter((piece) => piece.type === typePiece);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.depensePiece.deleteMany({
        where: { id: { in: remplacees.map((piece) => piece.id) } },
      });
      await transaction.depensePiece.create({
        data: {
          depenseId: id,
          type: typePiece,
          ...heberge,
          ajouteParId: acteur.id,
          ajouteParNom: acteur.nom,
        },
      });
    });
    for (const piece of remplacees)
      void this.cloudinary.supprimer(piece.publicId, piece.typeRessource);
    return this.findOne(id, acteur);
  }

  async removePiece(id: string, pieceId: string, acteur: Acteur) {
    const depense = await this.brouillonDe(id, acteur);
    const piece = depense.pieces.find((item) => item.id === pieceId);
    if (!piece) throw new NotFoundException('Pièce introuvable');
    await this.prisma.depensePiece.delete({ where: { id: pieceId } });
    void this.cloudinary.supprimer(piece.publicId, piece.typeRessource);
    return this.findOne(id, acteur);
  }

  async soumettre(id: string, acteur: Acteur) {
    const depense = await this.brouillonDe(id, acteur);
    if (!depense.fournisseurId)
      throw new BadRequestException(
        'Indiquez le fournisseur ou le bénéficiaire avant de soumettre',
      );
    for (const [type, libelle] of [
      ['LETTRE_DEMANDE', "la lettre de demande d'achat"],
      ['DEVIS', 'le devis'],
    ] as const)
      if (!depense.pieces.some((piece) => piece.type === type))
        throw new BadRequestException(
          `Joignez ${libelle} avant de soumettre la demande`,
        );
    if (!depense.categorie.actif)
      throw new BadRequestException('Catégorie de dépense indisponible');

    const regles = await this.finances.regles();
    const montant = Number(depense.montant);
    await this.prisma.$transaction(async (transaction) => {
      const exercice = await this.finances.exerciceOuvert(
        new Date(),
        transaction,
      );
      if (!exercice)
        throw new BadRequestException(
          'Aucun exercice budgétaire ouvert ne couvre la date du jour : la direction financière doit en ouvrir un',
        );
      const { budget, disponible } = await this.finances.disponible(
        exercice.id,
        depense.categorieId,
        transaction,
        id,
      );
      const horsBudget = montant > disponible;
      if (horsBudget && regles.budgetBloquant)
        throw new BadRequestException(
          budget === 0
            ? `Aucun budget n'est prévu pour « ${depense.categorie.nom} » sur l'exercice ${exercice.libelle}`
            : `Budget insuffisant pour « ${depense.categorie.nom} » : ${Math.max(0, disponible).toLocaleString('fr-FR')} F disponibles pour une demande de ${montant.toLocaleString('fr-FR')} F`,
        );
      const niveaux = niveauxRequis(
        montant,
        regles.seuilDoubleValidation,
        horsBudget,
      );
      await this.transition(transaction, id, ['BROUILLON'], {
        statut: 'SOUMISE',
        exerciceId: exercice.id,
        horsBudget,
        niveauxRequis: niveaux,
        dateSoumission: new Date(),
        motifRejet: null,
      });
      await this.tracer(
        transaction,
        id,
        'Soumission pour validation',
        'SOUMISE',
        acteur,
        [
          niveaux === 2 ? 'Double validation exigée' : null,
          horsBudget ? 'Dépassement du budget de la catégorie' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      );
    });
    return this.findOne(id, acteur);
  }

  // ---------- Validation ----------

  async valider(id: string, commentaire: unknown, acteur: Acteur) {
    const depense = await this.charger(id, acteur);
    exiger(blocageValidation(this.circuit(depense), acteur));
    const note = texteOptionnel(commentaire);
    const maintenant = new Date();
    await this.prisma.$transaction(async (transaction) => {
      if (depense.exercice?.cloture)
        throw new ConflictException(
          "L'exercice de cette dépense est clôturé : elle doit être annulée puis représentée",
        );
      const premier = depense.statut === 'SOUMISE';
      const finale = !premier || depense.niveauxRequis === 1;
      const statut: StatutDepense = finale ? 'VALIDEE' : 'VALIDATION_FINALE';
      await this.transition(transaction, id, [depense.statut], {
        statut,
        ...(premier
          ? {
              validation1ParId: acteur.id,
              validation1ParNom: acteur.nom,
              dateValidation1: maintenant,
            }
          : {
              validation2ParId: acteur.id,
              validation2ParNom: acteur.nom,
              dateValidation2: maintenant,
            }),
        // La validation finale engage la dépense : le bon de commande est émis.
        ...(finale
          ? {
              numeroBonCommande: await this.numero(transaction, 'BC'),
              dateBonCommande: maintenant,
            }
          : {}),
      });
      await this.tracer(
        transaction,
        id,
        premier
          ? finale
            ? 'Validation · bon de commande émis'
            : 'Première validation'
          : 'Validation finale · bon de commande émis',
        statut,
        acteur,
        note,
      );
    });
    return this.findOne(id, acteur);
  }

  async rejeter(id: string, motif: unknown, acteur: Acteur) {
    const depense = await this.charger(id, acteur);
    exiger(blocageValidation(this.circuit(depense), acteur));
    const motifRejet = texteRequis(motif, 'Le motif du rejet', 10, 500);
    await this.prisma.$transaction(async (transaction) => {
      await this.transition(transaction, id, [depense.statut], {
        statut: 'REJETEE',
        motifRejet,
      });
      await this.tracer(
        transaction,
        id,
        'Rejet de la demande',
        'REJETEE',
        acteur,
        motifRejet,
      );
    });
    return this.findOne(id, acteur);
  }

  // Une demande rejetée repart en brouillon : elle sera corrigée puis revalidée
  // depuis le début, les validations précédentes ne valent plus.
  async reprendre(id: string, acteur: Acteur) {
    const depense = await this.charger(id, acteur);
    if (depense.initiateurId !== acteur.id)
      throw new ForbiddenException(
        'Seul le demandeur peut reprendre sa demande',
      );
    await this.prisma.$transaction(async (transaction) => {
      await this.transition(transaction, id, ['REJETEE'], {
        statut: 'BROUILLON',
        exerciceId: null,
        horsBudget: false,
        niveauxRequis: 1,
        dateSoumission: null,
        validation1ParId: null,
        validation1ParNom: null,
        dateValidation1: null,
        validation2ParId: null,
        validation2ParNom: null,
        dateValidation2: null,
      });
      await this.tracer(
        transaction,
        id,
        'Reprise pour correction',
        'BROUILLON',
        acteur,
      );
    });
    return this.findOne(id, acteur);
  }

  async annuler(id: string, motif: unknown, acteur: Acteur) {
    const depense = await this.charger(id, acteur);
    exiger(blocageAnnulation(this.circuit(depense), acteur));
    const motifAnnulation = texteRequis(
      motif,
      "Le motif de l'annulation",
      10,
      500,
    );
    await this.prisma.$transaction(async (transaction) => {
      await this.transition(transaction, id, [depense.statut], {
        statut: 'ANNULEE',
        motifAnnulation,
      });
      await this.tracer(
        transaction,
        id,
        'Annulation',
        'ANNULEE',
        acteur,
        motifAnnulation,
      );
    });
    return this.findOne(id, acteur);
  }

  // ---------- Exécution ----------

  async reception(
    id: string,
    body: Record<string, unknown>,
    fichier: FichierRecu | undefined,
    acteur: Acteur,
  ) {
    const depense = await this.charger(id, acteur);
    exiger(blocageReception(this.circuit(depense), acteur));
    const numeroBonLivraison = texteRequis(
      body.numeroBonLivraison,
      'Le numéro du bon de livraison',
      1,
      80,
    );
    const dateReception = parseDate(body.dateReception, 'La date de réception');
    if (estDansLeFutur(dateReception))
      throw new BadRequestException(
        'La date de réception ne peut pas être dans le futur',
      );
    const conforme = String(body.conforme) === 'true';
    const commentaire = conforme
      ? texteOptionnel(body.commentaire)
      : texteRequis(body.commentaire, 'Les réserves sur la livraison', 10, 500);
    const heberge = await this.cloudinary.envoyer(
      this.cloudinary.verifier(fichier, 'Bon de livraison'),
      `ipaim/depenses/${depense.numero}`,
    );
    await this.prisma.$transaction(async (transaction) => {
      // Une livraison non conforme est consignée, mais la dépense n'avance pas.
      const statut: StatutDepense = conforme ? 'RECEPTIONNEE' : 'VALIDEE';
      await this.transition(
        transaction,
        id,
        ['VALIDEE'],
        conforme
          ? {
              statut,
              numeroBonLivraison,
              dateReception,
              receptionParId: acteur.id,
              receptionParNom: acteur.nom,
              receptionConforme: true,
              receptionCommentaire: commentaire,
            }
          : { receptionConforme: false, receptionCommentaire: commentaire },
      );
      await transaction.depensePiece.create({
        data: {
          depenseId: id,
          type: 'BON_LIVRAISON',
          ...heberge,
          ajouteParId: acteur.id,
          ajouteParNom: acteur.nom,
        },
      });
      await this.tracer(
        transaction,
        id,
        conforme
          ? `Réception conforme · BL ${numeroBonLivraison}`
          : `Livraison refusée (non conforme) · BL ${numeroBonLivraison}`,
        statut,
        acteur,
        commentaire,
      );
    });
    return this.findOne(id, acteur);
  }

  async facture(
    id: string,
    body: Record<string, unknown>,
    fichier: FichierRecu | undefined,
    acteur: Acteur,
  ) {
    const depense = await this.charger(id, acteur);
    exiger(blocageFacture(this.circuit(depense), acteur));
    const numeroFacture = texteRequis(
      body.numeroFacture,
      'Le numéro de la facture',
      1,
      80,
    );
    const dateFacture = parseDate(body.dateFacture, 'La date de la facture');
    if (estDansLeFutur(dateFacture))
      throw new BadRequestException(
        'La date de la facture ne peut pas être dans le futur',
      );
    const montantFacture = parseMontant(
      body.montantFacture,
      'Le montant de la facture',
    );
    // On ne paie jamais plus que ce qui a été validé et commandé.
    if (montantFacture > Number(depense.montant))
      throw new BadRequestException(
        `La facture dépasse le montant validé (${Number(depense.montant).toLocaleString('fr-FR')} F) : une nouvelle demande est nécessaire pour le complément`,
      );
    const doublon = await this.prisma.depense.findFirst({
      where: {
        id: { not: id },
        fournisseurId: depense.fournisseurId,
        numeroFacture: { equals: numeroFacture, mode: 'insensitive' },
        statut: { not: 'ANNULEE' },
      },
      select: { numero: true },
    });
    if (doublon)
      throw new ConflictException(
        `Cette facture du fournisseur est déjà enregistrée sur la dépense ${doublon.numero}`,
      );
    const heberge = await this.cloudinary.envoyer(
      this.cloudinary.verifier(fichier, 'Facture'),
      `ipaim/depenses/${depense.numero}`,
    );
    await this.prisma.$transaction(async (transaction) => {
      await this.transition(transaction, id, [depense.statut], {
        statut: 'FACTUREE',
        numeroFacture,
        dateFacture,
        montantFacture: montantFacture.toFixed(2),
        factureParId: acteur.id,
        factureParNom: acteur.nom,
      });
      await transaction.depensePiece.create({
        data: {
          depenseId: id,
          type: 'FACTURE',
          ...heberge,
          ajouteParId: acteur.id,
          ajouteParNom: acteur.nom,
        },
      });
      await this.tracer(
        transaction,
        id,
        `Facture ${numeroFacture} enregistrée · ${montantFacture.toLocaleString('fr-FR')} F`,
        'FACTUREE',
        acteur,
      );
    });
    return this.findOne(id, acteur);
  }

  async decaisser(
    id: string,
    body: Record<string, unknown>,
    fichier: FichierRecu | undefined,
    acteur: Acteur,
  ) {
    const depense = await this.charger(id, acteur);
    const regles = await this.finances.regles();
    const circuit = this.circuit(depense);
    exiger(blocagePaiement(circuit, acteur, regles));
    const montant = parseMontant(body.montant, 'Le montant payé');
    const reste = roundMoney(
      Number(depense.montantFacture ?? depense.montant) - circuit.totalPaye,
    );
    if (montant > reste)
      throw new BadRequestException(
        `Le paiement dépasse le reste à payer (${reste.toLocaleString('fr-FR')} F)`,
      );
    const mode = MODES.find((item) => item === body.mode);
    if (!mode)
      throw new BadRequestException(
        'Mode de paiement attendu : espèces, mobile money, virement ou chèque',
      );
    const reference =
      mode === 'ESPECES'
        ? texteOptionnel(body.reference, 120)
        : texteRequis(
            body.reference,
            'La référence du paiement (n° de transaction, de virement ou de chèque)',
            2,
            120,
          );
    const datePaiement = parseDate(body.datePaiement, 'La date du paiement');
    if (estDansLeFutur(datePaiement))
      throw new BadRequestException(
        'La date du paiement ne peut pas être dans le futur',
      );
    // La preuve (reçu, bordereau) est facultative mais conservée si fournie.
    const heberge = fichier?.buffer?.length
      ? await this.cloudinary.envoyer(
          this.cloudinary.verifier(fichier, 'Preuve de paiement'),
          `ipaim/depenses/${depense.numero}`,
        )
      : null;
    await this.prisma.$transaction(async (transaction) => {
      const solde = roundMoney(reste - montant) === 0;
      const statut: StatutDepense = solde ? 'PAYEE' : 'PAYEE_PARTIELLEMENT';
      await this.transition(transaction, id, [depense.statut], { statut });
      // Recalcul sous verrou : deux caissiers ne peuvent pas payer deux fois.
      const dejaPaye = await transaction.decaissement.aggregate({
        where: { depenseId: id },
        _sum: { montant: true },
      });
      if (roundMoney(Number(dejaPaye._sum.montant ?? 0)) !== circuit.totalPaye)
        throw new ConflictException(
          "Un paiement vient d'être enregistré sur cette dépense : actualisez la page",
        );
      const numero = await this.numero(transaction, 'DEC');
      await transaction.decaissement.create({
        data: {
          numero,
          depenseId: id,
          montant: montant.toFixed(2),
          mode,
          reference,
          datePaiement,
          payeParId: acteur.id,
          payeParNom: acteur.nom,
        },
      });
      if (heberge)
        await transaction.depensePiece.create({
          data: {
            depenseId: id,
            type: 'PREUVE_PAIEMENT',
            ...heberge,
            ajouteParId: acteur.id,
            ajouteParNom: acteur.nom,
          },
        });
      await this.tracer(
        transaction,
        id,
        `${solde ? 'Paiement soldé' : 'Paiement partiel'} · ${numero} · ${montant.toLocaleString('fr-FR')} F`,
        statut,
        acteur,
        reference,
      );
    });
    return this.findOne(id, acteur);
  }
}
