import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Acteur } from '../common/acteur';
import { isUniqueConstraintViolation } from '../common/prisma-errors';
import {
  meta,
  pagination,
  parseDate,
  parseNombre,
  roundMoney,
  texteOptionnel,
  texteRequis,
} from '../common/saisie';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMPTE_PRODUIT,
  compteDeCharge,
  controleEcriture,
  JOURNAUX,
  LigneSaisie,
  PLAN_COMPTABLE,
  regrouper,
  tresorerie,
} from './plan-comptable';

type Body = Record<string, unknown>;
type Transaction = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
type LignePaieStockee = {
  code: string;
  type: string;
  montant: number;
  compteNumero: string | null;
};

const SYSTEME = 'Écriture automatique';
// Les écritures automatiques se génèrent une seule fois, même si deux écrans les demandent ensemble.
const VERROU_SYNCHRONISATION = 4711001;

@Injectable()
export class ComptabiliteService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Plan comptable ----------

  async comptes() {
    if ((await this.prisma.compteComptable.count()) === 0)
      await this.prisma.compteComptable.createMany({
        data: PLAN_COMPTABLE.map(([numero, libelle]) => ({
          numero,
          libelle,
          classe: Number(numero[0]),
        })),
        skipDuplicates: true,
      });
    return this.prisma.compteComptable.findMany({ orderBy: { numero: 'asc' } });
  }

  async createCompte(body: Body) {
    const numero = texteRequis(body.numero, 'Le numéro de compte', 2, 10);
    if (!/^[1-8]\d{1,9}$/.test(numero))
      throw new BadRequestException(
        'Un numéro de compte commence par un chiffre de 1 à 8 et ne contient que des chiffres',
      );
    await this.comptes();
    try {
      return await this.prisma.compteComptable.create({
        data: {
          numero,
          libelle: texteRequis(body.libelle, 'Le libellé du compte', 2, 160),
          classe: Number(numero[0]),
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException('Ce compte existe déjà');
      throw error;
    }
  }

  async updateCompte(id: string, body: Body) {
    const compte = await this.prisma.compteComptable.findUnique({
      where: { id },
    });
    if (!compte) throw new NotFoundException('Compte introuvable');
    return this.prisma.compteComptable.update({
      where: { id },
      data: {
        ...(body.libelle !== undefined
          ? {
              libelle: texteRequis(
                body.libelle,
                'Le libellé du compte',
                2,
                160,
              ),
            }
          : {}),
        ...(body.actif !== undefined ? { actif: body.actif === true } : {}),
      },
    });
  }

  // ---------- Enregistrement ----------

  private async enregistrer(
    transaction: Transaction,
    ecriture: {
      journal: string;
      date: Date;
      libelle: string;
      reference?: string | null;
      sourceType: string;
      sourceId?: string | null;
      statut?: string;
      creeParId?: string | null;
      creeParNom: string;
      lignes: LigneSaisie[];
    },
  ) {
    const lignes = ecriture.lignes
      .map((ligne) => ({
        ...ligne,
        debit: roundMoney(ligne.debit),
        credit: roundMoney(ligne.credit),
      }))
      .filter((ligne) => ligne.debit !== 0 || ligne.credit !== 0);
    const erreur = controleEcriture(lignes);
    if (erreur) throw new BadRequestException(erreur);
    const comptes = await transaction.compteComptable.findMany({
      where: { numero: { in: lignes.map((ligne) => ligne.compte) } },
    });
    const parNumero = new Map(comptes.map((compte) => [compte.numero, compte]));
    for (const ligne of lignes)
      if (!parNumero.has(ligne.compte))
        throw new BadRequestException(
          `Le compte ${ligne.compte} n'existe pas dans le plan comptable`,
        );
    const exerciceDe = (jour: Date) =>
      transaction.exerciceBudgetaire.findFirst({
        where: { dateDebut: { lte: jour }, dateFin: { gte: jour } },
      });
    let date = ecriture.date;
    let libelle = ecriture.libelle;
    let exercice = await exerciceDe(date);
    // Un exercice clôturé ne reçoit plus rien : une opération automatique qui
    // y tombe s'inscrit au jour de sa prise en compte, avec sa date d'origine.
    if (exercice?.cloture && ecriture.sourceType !== 'MANUELLE') {
      libelle = `${libelle} (opération du ${date.toLocaleDateString('fr-FR')}, exercice clôturé)`;
      date = new Date();
      exercice = await exerciceDe(date);
      // Clôturé avant son terme : l'écriture reste hors exercice.
      if (exercice?.cloture) exercice = null;
    }
    const cle = `EC-${date.getUTCFullYear()}`;
    const sequence = await transaction.sequenceNumero.upsert({
      where: { cle },
      create: { cle, valeur: 1 },
      update: { valeur: { increment: 1 } },
    });
    return transaction.ecritureComptable.create({
      data: {
        numero: `${cle}-${String(sequence.valeur).padStart(6, '0')}`,
        journal: ecriture.journal,
        date,
        libelle: libelle.slice(0, 200),
        reference: ecriture.reference ?? null,
        sourceType: ecriture.sourceType,
        sourceId: ecriture.sourceId ?? null,
        exerciceId: exercice?.id ?? null,
        statut: ecriture.statut ?? 'VALIDEE',
        creeParId: ecriture.creeParId ?? null,
        creeParNom: ecriture.creeParNom,
        lignes: {
          create: lignes.map((ligne) => ({
            compteId: parNumero.get(ligne.compte)!.id,
            libelle: ligne.libelle ?? null,
            debit: ligne.debit,
            credit: ligne.credit,
          })),
        },
      },
    });
  }

  // Annule une écriture par une écriture inverse : rien ne s'efface en comptabilité.
  private async extourner(
    transaction: Transaction,
    ecritureId: string,
    motif: string,
    auteur: string,
  ) {
    const origine = await transaction.ecritureComptable.findUniqueOrThrow({
      where: { id: ecritureId },
      include: { lignes: { include: { compte: true } } },
    });
    const extourne = await this.enregistrer(transaction, {
      journal: origine.journal,
      date: new Date(),
      libelle: `Extourne ${origine.numero} · ${motif}`,
      reference: origine.reference,
      sourceType: 'EXTOURNE',
      sourceId: origine.id,
      creeParNom: auteur,
      lignes: origine.lignes.map((ligne) => ({
        compte: ligne.compte.numero,
        debit: Number(ligne.credit),
        credit: Number(ligne.debit),
        libelle: ligne.libelle,
      })),
    });
    await transaction.ecritureComptable.update({
      where: { id: origine.id },
      data: { extourneParId: extourne.id },
    });
    return extourne;
  }

  // ---------- Écritures automatiques ----------

  // Rapproche la comptabilité de la gestion : chaque encaissement, facture,
  // décaissement et paie validée reçoit son écriture, une seule fois.
  async synchroniser() {
    await this.comptes();
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${VERROU_SYNCHRONISATION})`;
        const actives = await transaction.ecritureComptable.findMany({
          where: {
            extourneParId: null,
            sourceType: {
              in: [
                'PAIEMENT',
                'FACTURE_DEPENSE',
                'DECAISSEMENT',
                'PAIE',
                'PAIE_PAIEMENT',
              ],
            },
          },
          select: { id: true, sourceType: true, sourceId: true },
        });
        const existe = new Set(
          actives.map(
            (ecriture) => `${ecriture.sourceType}:${ecriture.sourceId}`,
          ),
        );
        let creees = 0;
        let extournees = 0;

        // 1. Encaissements des étudiants : la caisse reçoit, le produit est constaté.
        const paiements = await transaction.paiement.findMany({
          include: {
            demandeBourse: { include: { personne: true } },
            inscription: { include: { personne: true } },
          },
        });
        const paiementsConnus = new Map(
          paiements.map((paiement) => [paiement.id, paiement]),
        );
        // Ce qui avait été encaissé sur chaque obligation : un remboursement
        // diminue ce produit-là, pas un produit deviné d'après le dossier.
        const produitParObligation = new Map<string, string>();
        for (const paiement of paiements)
          if (
            paiement.elementDossierId &&
            paiement.typePaiement in COMPTE_PRODUIT
          )
            produitParObligation.set(
              paiement.elementDossierId,
              paiement.typePaiement,
            );
        for (const paiement of paiements) {
          if (existe.has(`PAIEMENT:${paiement.id}`)) continue;
          // Un report déplace un versement entre deux obligations : la caisse ne bouge pas.
          if (paiement.typePaiement === 'REPORT') continue;
          const personne =
            paiement.demandeBourse?.personne ?? paiement.inscription?.personne;
          // Un remboursement sort de la caisse et annule d'autant le produit constaté.
          const rembourse = paiement.typePaiement === 'REMBOURSEMENT';
          // Une annulation contre-passe l'encaissement saisi par erreur, sur le même produit.
          const annule = paiement.typePaiement === 'ANNULATION';
          const sortie = rembourse || annule;
          const origine = paiementsConnus.get(paiement.annulePaiementId ?? '');
          const montant = Math.abs(Number(paiement.montant));
          const produit =
            COMPTE_PRODUIT[
              annule && origine
                ? origine.typePaiement
                : sortie
                  ? (produitParObligation.get(
                      paiement.elementDossierId ?? '',
                    ) ??
                    (paiement.demandeBourseId
                      ? 'FRAIS_DEPOT'
                      : 'FRAIS_INSCRIPTION'))
                  : paiement.typePaiement
            ] ?? '707';
          // Espèces, banque ou mobile money : le compte suit le mode du paiement.
          const { compte: caisse, journal } = tresorerie(
            (annule ? origine?.modePaiement : paiement.modePaiement) ??
              'ESPECES',
          );
          await this.enregistrer(transaction, {
            journal,
            date: paiement.datePaiement,
            libelle:
              `${annule ? "Annulation d'encaissement" : rembourse ? 'Remboursement' : 'Encaissement'} ${personne ? `${personne.prenom} ${personne.nom}` : ''}`.trim(),
            reference: paiement.id.slice(0, 8).toUpperCase(),
            sourceType: 'PAIEMENT',
            sourceId: paiement.id,
            creeParNom: SYSTEME,
            lignes: sortie
              ? [
                  { compte: produit, debit: montant, credit: 0 },
                  { compte: caisse, debit: 0, credit: montant },
                ]
              : [
                  { compte: caisse, debit: montant, credit: 0 },
                  { compte: produit, debit: 0, credit: montant },
                ],
          });
          creees += 1;
        }

        // 2. Factures des dépenses : la charge est constatée, la dette fournisseur naît.
        const depenses = await transaction.depense.findMany({
          where: { numeroFacture: { not: null } },
          include: { categorie: true, fournisseur: true, decaissements: true },
        });
        const facturees = new Map(
          depenses
            .filter((depense) =>
              ['FACTUREE', 'PAYEE_PARTIELLEMENT', 'PAYEE'].includes(
                depense.statut,
              ),
            )
            .map((depense) => [depense.id, depense]),
        );
        for (const depense of facturees.values()) {
          if (!existe.has(`FACTURE_DEPENSE:${depense.id}`)) {
            const montant = Number(depense.montantFacture ?? depense.montant);
            await this.enregistrer(transaction, {
              journal: 'AC',
              date: depense.dateFacture ?? new Date(),
              libelle: `Facture ${depense.numeroFacture} · ${depense.fournisseur?.nom ?? depense.objet}`,
              reference: depense.numero,
              sourceType: 'FACTURE_DEPENSE',
              sourceId: depense.id,
              creeParNom: SYSTEME,
              lignes: [
                {
                  compte: compteDeCharge(depense.categorie),
                  debit: montant,
                  credit: 0,
                },
                { compte: '401', debit: 0, credit: montant },
              ],
            });
            creees += 1;
          }
          // 3. Décaissements : la dette s'éteint, la trésorerie diminue.
          for (const decaissement of depense.decaissements) {
            if (existe.has(`DECAISSEMENT:${decaissement.id}`)) continue;
            const montant = Number(decaissement.montant);
            const { compte, journal } = tresorerie(decaissement.mode);
            await this.enregistrer(transaction, {
              journal,
              date: decaissement.datePaiement,
              libelle: `Règlement ${depense.fournisseur?.nom ?? depense.objet}`,
              reference: decaissement.numero,
              sourceType: 'DECAISSEMENT',
              sourceId: decaissement.id,
              creeParNom: SYSTEME,
              lignes: [
                { compte: '401', debit: montant, credit: 0 },
                { compte, debit: 0, credit: montant },
              ],
            });
            creees += 1;
          }
        }

        // 4. Paie validée : charges de personnel et dettes envers le personnel et les organismes.
        const periodes = await transaction.periodePaie.findMany({
          where: { statut: { in: ['VALIDEE', 'PAYEE'] } },
          include: { bulletins: true },
        });
        const periodesValidees = new Set(periodes.map((periode) => periode.id));
        for (const periode of periodes) {
          const mois = `${String(periode.mois).padStart(2, '0')}/${periode.annee}`;
          const net = periode.bulletins.reduce(
            (total, bulletin) => total + Number(bulletin.net),
            0,
          );
          if (!existe.has(`PAIE:${periode.id}`)) {
            const lignes: LigneSaisie[] = [];
            for (const bulletin of periode.bulletins) {
              lignes.push({
                compte: '661',
                debit: Number(bulletin.brut),
                credit: 0,
              });
              lignes.push({
                compte: '422',
                debit: 0,
                credit: Number(bulletin.net),
              });
              for (const ligne of bulletin.lignes as LignePaieStockee[]) {
                if (ligne.type === 'RETENUE')
                  lignes.push({
                    compte: ligne.compteNumero ?? '421',
                    debit: 0,
                    credit: ligne.montant,
                  });
                if (ligne.type === 'PATRONALE') {
                  lignes.push({
                    compte: '664',
                    debit: ligne.montant,
                    credit: 0,
                  });
                  lignes.push({
                    compte: ligne.compteNumero ?? '431',
                    debit: 0,
                    credit: ligne.montant,
                  });
                }
              }
            }
            await this.enregistrer(transaction, {
              journal: 'PA',
              date: new Date(Date.UTC(periode.annee, periode.mois, 0, 12)),
              libelle: `Paie du mois ${mois}`,
              reference: `PAIE-${periode.annee}-${String(periode.mois).padStart(2, '0')}`,
              sourceType: 'PAIE',
              sourceId: periode.id,
              creeParNom: SYSTEME,
              lignes: regrouper(lignes),
            });
            creees += 1;
          }
          // 5. Versement des salaires.
          if (
            periode.statut === 'PAYEE' &&
            net > 0 &&
            !existe.has(`PAIE_PAIEMENT:${periode.id}`)
          ) {
            const { compte, journal } = tresorerie(periode.modePaiement);
            await this.enregistrer(transaction, {
              journal,
              date: periode.datePaiement ?? new Date(),
              libelle: `Versement des salaires ${mois}`,
              reference: `PAIE-${periode.annee}-${String(periode.mois).padStart(2, '0')}`,
              sourceType: 'PAIE_PAIEMENT',
              sourceId: periode.id,
              creeParNom: SYSTEME,
              lignes: [
                { compte: '422', debit: net, credit: 0 },
                { compte, debit: 0, credit: net },
              ],
            });
            creees += 1;
          }
        }

        // 6. Opérations disparues ou annulées côté gestion : leur écriture est contre-passée.
        for (const ecriture of actives) {
          const disparue =
            (ecriture.sourceType === 'PAIEMENT' &&
              !paiementsConnus.has(ecriture.sourceId ?? '')) ||
            (ecriture.sourceType === 'FACTURE_DEPENSE' &&
              !facturees.has(ecriture.sourceId ?? '')) ||
            (ecriture.sourceType === 'PAIE' &&
              !periodesValidees.has(ecriture.sourceId ?? ''));
          if (!disparue) continue;
          await this.extourner(
            transaction,
            ecriture.id,
            ecriture.sourceType === 'PAIEMENT'
              ? 'paiement supprimé'
              : ecriture.sourceType === 'PAIE'
                ? 'paie rouverte'
                : 'dépense annulée',
            SYSTEME,
          );
          extournees += 1;
        }
        return { creees, extournees };
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }

  // ---------- Écritures manuelles ----------

  private lignesSaisies(body: Body): LigneSaisie[] {
    if (!Array.isArray(body.lignes))
      throw new BadRequestException('Aucune ligne transmise');
    return (body.lignes as Body[]).map((ligne) => ({
      compte: texteRequis(ligne?.compte, 'Le compte', 2, 10),
      debit: ligne?.debit ? parseNombre(ligne.debit, 'Le débit') : 0,
      credit: ligne?.credit ? parseNombre(ligne.credit, 'Le crédit') : 0,
      libelle: texteOptionnel(ligne?.libelle, 160),
    }));
  }

  private async refuserExerciceClos(date: Date) {
    const exercice = await this.prisma.exerciceBudgetaire.findFirst({
      where: { dateDebut: { lte: date }, dateFin: { gte: date } },
    });
    if (exercice?.cloture)
      throw new ConflictException(
        `L'exercice ${exercice.libelle} est clôturé : plus aucune écriture n'y est possible`,
      );
  }

  async createEcriture(body: Body, acteur: Acteur) {
    await this.comptes();
    const journal = texteRequis(body.journal, 'Le journal');
    if (!JOURNAUX[journal]) throw new BadRequestException('Journal inconnu');
    const date = parseDate(body.date, "La date de l'écriture");
    await this.refuserExerciceClos(date);
    const lignes = this.lignesSaisies(body);
    const ecriture = await this.prisma.$transaction((transaction) =>
      this.enregistrer(transaction, {
        journal,
        date,
        libelle: texteRequis(body.libelle, 'Le libellé', 3, 200),
        reference: texteOptionnel(body.reference, 60),
        sourceType: 'MANUELLE',
        // Une écriture saisie à la main reste un brouillon jusqu'à sa validation.
        statut: 'BROUILLON',
        creeParId: acteur.id,
        creeParNom: acteur.nom,
        lignes,
      }),
    );
    return this.ecriture(ecriture.id);
  }

  async ecriture(id: string) {
    const ecriture = await this.prisma.ecritureComptable.findUnique({
      where: { id },
      include: {
        lignes: { include: { compte: true }, orderBy: { debit: 'desc' } },
      },
    });
    if (!ecriture) throw new NotFoundException('Écriture introuvable');
    return ecriture;
  }

  private async brouillon(id: string) {
    const ecriture = await this.ecriture(id);
    if (ecriture.statut !== 'BROUILLON')
      throw new ConflictException(
        'Une écriture validée est définitive : elle se corrige par une extourne',
      );
    return ecriture;
  }

  async removeEcriture(id: string) {
    await this.brouillon(id);
    await this.prisma.ecritureComptable.delete({ where: { id } });
    return { supprime: true };
  }

  async validerEcriture(id: string, acteur: Acteur) {
    const ecriture = await this.brouillon(id);
    await this.refuserExerciceClos(ecriture.date);
    await this.prisma.ecritureComptable.update({
      where: { id },
      data: { statut: 'VALIDEE', valideParNom: acteur.nom },
    });
    return this.ecriture(id);
  }

  async extournerEcriture(id: string, body: Body, acteur: Acteur) {
    const ecriture = await this.ecriture(id);
    const motif = texteRequis(body.motif, "Le motif de l'extourne", 5, 120);
    if (ecriture.statut !== 'VALIDEE')
      throw new ConflictException(
        'Un brouillon se supprime ; seule une écriture validée se contre-passe',
      );
    if (ecriture.extourneParId)
      throw new ConflictException('Cette écriture est déjà contre-passée');
    // Une écriture automatique suit l'opération de gestion dont elle provient.
    if (ecriture.sourceType !== 'MANUELLE')
      throw new ForbiddenException(
        "Cette écriture vient de la gestion : annulez l'opération d'origine, la comptabilité suivra",
      );
    await this.refuserExerciceClos(new Date());
    await this.prisma.$transaction((transaction) =>
      this.extourner(transaction, id, motif, acteur.nom),
    );
    return this.ecriture(id);
  }

  // ---------- Consultation ----------

  private periode(query: { du?: string; au?: string; exerciceId?: string }) {
    const du = new Date(query.du ?? '');
    const au = new Date(query.au ?? '');
    return {
      ...(query.exerciceId ? { exerciceId: query.exerciceId } : {}),
      ...(!Number.isNaN(du.getTime()) || !Number.isNaN(au.getTime())
        ? {
            date: {
              ...(!Number.isNaN(du.getTime()) ? { gte: du } : {}),
              ...(!Number.isNaN(au.getTime()) ? { lte: au } : {}),
            },
          }
        : {}),
    };
  }

  async journal(query: {
    journal?: string;
    statut?: string;
    q?: string;
    du?: string;
    au?: string;
    exerciceId?: string;
    page?: string;
    limit?: string;
  }) {
    await this.synchroniser();
    const { page, limit, skip } = pagination(query, 30);
    const q = query.q?.trim();
    const where = {
      ...this.periode(query),
      ...(query.journal ? { journal: query.journal } : {}),
      ...(query.statut ? { statut: query.statut } : {}),
      ...(q
        ? {
            OR: [
              { libelle: { contains: q, mode: 'insensitive' as const } },
              { numero: { contains: q, mode: 'insensitive' as const } },
              { reference: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.ecritureComptable.count({ where }),
      this.prisma.ecritureComptable.findMany({
        where,
        include: {
          lignes: { include: { compte: true }, orderBy: { debit: 'desc' } },
        },
        orderBy: [{ date: 'desc' }, { numero: 'desc' }],
        skip,
        take: limit,
      }),
    ]);
    return { data, meta: meta(page, limit, total), journaux: JOURNAUX };
  }

  // Totaux par compte sur la période ; seules les écritures validées comptent.
  private async totaux(
    query: { du?: string; au?: string; exerciceId?: string },
    avant?: Date,
  ) {
    const lignes = await this.prisma.ligneEcriture.groupBy({
      by: ['compteId'],
      where: {
        ecriture: {
          statut: 'VALIDEE',
          ...(avant ? { date: { lt: avant } } : this.periode(query)),
        },
      },
      _sum: { debit: true, credit: true },
    });
    return new Map(
      lignes.map((ligne) => [
        ligne.compteId,
        {
          debit: Number(ligne._sum.debit ?? 0),
          credit: Number(ligne._sum.credit ?? 0),
        },
      ]),
    );
  }

  async balance(query: { du?: string; au?: string; exerciceId?: string }) {
    await this.synchroniser();
    const [comptes, totaux] = await Promise.all([
      this.comptes(),
      this.totaux(query),
    ]);
    const lignes = comptes
      .filter((compte) => totaux.has(compte.id))
      .map((compte) => {
        const { debit, credit } = totaux.get(compte.id)!;
        const solde = roundMoney(debit - credit);
        return {
          compteId: compte.id,
          numero: compte.numero,
          libelle: compte.libelle,
          classe: compte.classe,
          debit: roundMoney(debit),
          credit: roundMoney(credit),
          soldeDebiteur: solde > 0 ? solde : 0,
          soldeCrediteur: solde < 0 ? -solde : 0,
        };
      });
    const somme = (
      cle: 'debit' | 'credit' | 'soldeDebiteur' | 'soldeCrediteur',
    ) => roundMoney(lignes.reduce((total, ligne) => total + ligne[cle], 0));
    return {
      lignes,
      totaux: {
        debit: somme('debit'),
        credit: somme('credit'),
        soldeDebiteur: somme('soldeDebiteur'),
        soldeCrediteur: somme('soldeCrediteur'),
      },
    };
  }

  async grandLivre(query: { compte?: string; du?: string; au?: string }) {
    await this.synchroniser();
    const compte = await this.prisma.compteComptable.findUnique({
      where: { numero: query.compte ?? '' },
    });
    if (!compte) throw new NotFoundException('Compte introuvable');
    const du = new Date(query.du ?? '');
    // Solde à l'ouverture de la période consultée.
    const report = Number.isNaN(du.getTime())
      ? { debit: 0, credit: 0 }
      : ((await this.totaux({}, du)).get(compte.id) ?? { debit: 0, credit: 0 });
    const lignes = await this.prisma.ligneEcriture.findMany({
      where: {
        compteId: compte.id,
        ecriture: { statut: 'VALIDEE', ...this.periode(query) },
      },
      include: { ecriture: true },
      orderBy: [{ ecriture: { date: 'asc' } }, { ecriture: { numero: 'asc' } }],
      take: 2000,
    });
    let solde = roundMoney(report.debit - report.credit);
    return {
      compte,
      report: solde,
      lignes: lignes.map((ligne) => {
        solde = roundMoney(solde + Number(ligne.debit) - Number(ligne.credit));
        return {
          id: ligne.id,
          date: ligne.ecriture.date,
          numero: ligne.ecriture.numero,
          journal: ligne.ecriture.journal,
          libelle: ligne.libelle ?? ligne.ecriture.libelle,
          reference: ligne.ecriture.reference,
          debit: Number(ligne.debit),
          credit: Number(ligne.credit),
          solde,
        };
      }),
      solde,
    };
  }

  // Compte de résultat et bilan simplifié.
  async etats(query: { du?: string; au?: string; exerciceId?: string }) {
    const { lignes } = await this.balance(query);
    const solde = (ligne: (typeof lignes)[number]) =>
      ligne.soldeDebiteur - ligne.soldeCrediteur;
    const charges = lignes
      .filter((ligne) => ligne.classe === 6)
      .map((ligne) => ({
        numero: ligne.numero,
        libelle: ligne.libelle,
        montant: solde(ligne),
      }));
    const produits = lignes
      .filter((ligne) => ligne.classe === 7)
      .map((ligne) => ({
        numero: ligne.numero,
        libelle: ligne.libelle,
        montant: -solde(ligne),
      }));
    const total = (liste: Array<{ montant: number }>) =>
      roundMoney(liste.reduce((somme, item) => somme + item.montant, 0));
    const resultat = roundMoney(total(produits) - total(charges));
    const bilan = lignes.filter((ligne) => ligne.classe <= 5);
    const actif = bilan
      .filter((ligne) => solde(ligne) > 0)
      .map((ligne) => ({
        numero: ligne.numero,
        libelle: ligne.libelle,
        montant: solde(ligne),
      }));
    const passif = bilan
      .filter((ligne) => solde(ligne) < 0)
      .map((ligne) => ({
        numero: ligne.numero,
        libelle: ligne.libelle,
        montant: -solde(ligne),
      }));
    const compteSolde = (numero: string) => {
      const ligne = lignes.find((item) => item.numero === numero);
      return ligne ? solde(ligne) : 0;
    };
    return {
      resultat: {
        charges,
        produits,
        totalCharges: total(charges),
        totalProduits: total(produits),
        resultat,
      },
      bilan: {
        actif,
        passif,
        totalActif: total(actif),
        // Le résultat de la période équilibre le bilan.
        totalPassif: roundMoney(total(passif) + resultat),
        resultat,
      },
      tresorerie: {
        caisse: compteSolde('571'),
        banque: compteSolde('521'),
        mobileMoney: compteSolde('552'),
        dettesFournisseurs: -compteSolde('401'),
        dettesPersonnel: -compteSolde('422'),
        dettesSociales: -(compteSolde('431') + compteSolde('447')),
      },
    };
  }
}
