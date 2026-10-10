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
  choix,
  dateOptionnelle,
  estDansLeFutur,
  meta,
  pagination,
  parseDate,
  parseEntier,
  parseNombre,
  texteOptionnel,
  texteRequis,
} from '../common/saisie';
import { PrismaService } from '../prisma/prisma.service';
import {
  CATEGORIES_EMPLOYE,
  congesAcquis,
  joursDeConge,
  MODES_PAIEMENT,
  TYPES_CONGE,
  TYPES_CONTRAT,
} from './rh.rules';

const PARAMETRES_ID = 'rh';
const JOUR_MS = 24 * 60 * 60 * 1000;
type Body = Record<string, unknown>;

@Injectable()
export class RhService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Paramètres ----------

  parametres() {
    return this.prisma.parametresRH.upsert({
      where: { id: PARAMETRES_ID },
      create: { id: PARAMETRES_ID },
      update: {},
    });
  }

  async updateParametres(body: Body) {
    await this.parametres();
    const data: Record<string, unknown> = {};
    if (body.joursCongeAnnuel !== undefined)
      data.joursCongeAnnuel = parseEntier(
        body.joursCongeAnnuel,
        'Les jours de congé annuel',
        0,
        60,
      );
    if (body.joursOuvresMois !== undefined)
      data.joursOuvresMois = parseEntier(
        body.joursOuvresMois,
        'Les jours ouvrés du mois',
        20,
        31,
      );
    if (body.categoriePaieId !== undefined) {
      const id =
        typeof body.categoriePaieId === 'string' && body.categoriePaieId
          ? body.categoriePaieId
          : null;
      if (
        id &&
        !(await this.prisma.categorieDepense.findUnique({ where: { id } }))
      )
        throw new BadRequestException('Catégorie budgétaire introuvable');
      data.categoriePaieId = id;
    }
    return this.prisma.parametresRH.update({
      where: { id: PARAMETRES_ID },
      data,
    });
  }

  // ---------- Employés ----------

  private employeData(body: Body, creation: boolean) {
    const data: Record<string, unknown> = {};
    const texte = (cle: string, libelle: string, min: number, max: number) => {
      if (creation || body[cle] !== undefined)
        data[cle] = texteRequis(body[cle], libelle, min, max);
    };
    const optionnel = (cle: string, max: number) => {
      if (body[cle] !== undefined) data[cle] = texteOptionnel(body[cle], max);
    };
    texte('nom', 'Le nom', 1, 120);
    texte('prenom', 'Le prénom', 1, 120);
    texte('fonction', 'La fonction', 2, 160);
    if (creation || body.categorie !== undefined)
      data.categorie = choix(
        body.categorie,
        CATEGORIES_EMPLOYE,
        'La catégorie',
      );
    if (creation || body.dateEmbauche !== undefined) {
      const dateEmbauche = parseDate(body.dateEmbauche, "La date d'embauche");
      if (estDansLeFutur(new Date(dateEmbauche.getTime() - 90 * JOUR_MS)))
        throw new BadRequestException(
          "La date d'embauche est trop éloignée dans le futur",
        );
      data.dateEmbauche = dateEmbauche;
    }
    if (body.sexe !== undefined)
      data.sexe = body.sexe ? choix(body.sexe, ['M', 'F'], 'Le sexe') : null;
    if (body.dateNaissance !== undefined)
      data.dateNaissance = dateOptionnelle(
        body.dateNaissance,
        'La date de naissance',
      );
    if (body.modePaiement !== undefined)
      data.modePaiement = choix(
        body.modePaiement,
        MODES_PAIEMENT,
        'Le mode de paiement',
      );
    optionnel('telephone', 40);
    optionnel('email', 160);
    optionnel('adresse', 300);
    optionnel('service', 120);
    optionnel('numeroCnss', 60);
    optionnel('coordonneesPaiement', 160);
    return data;
  }

  private async matricule(
    transaction: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  ) {
    const sequence = await transaction.sequenceNumero.upsert({
      where: { cle: 'EMP' },
      create: { cle: 'EMP', valeur: 1 },
      update: { valeur: { increment: 1 } },
    });
    return `EMP-${String(sequence.valeur).padStart(4, '0')}`;
  }

  async createEmploye(body: Body) {
    const data = this.employeData(body, true);
    const candidatureId =
      typeof body.candidatureId === 'string' && body.candidatureId
        ? body.candidatureId
        : null;
    if (candidatureId) {
      // Un dossier de recrutement n'aboutit à une embauche que s'il a été retenu.
      const candidature = await this.prisma.candidaturePersonnel.findUnique({
        where: { id: candidatureId },
      });
      if (!candidature)
        throw new NotFoundException('Dossier de recrutement introuvable');
      if (candidature.statut !== 'RETENU')
        throw new ConflictException(
          'Seul un candidat retenu peut être embauché',
        );
    }
    try {
      return await this.prisma.$transaction(async (transaction) =>
        transaction.employe.create({
          data: {
            ...(data as {
              nom: string;
              prenom: string;
              fonction: string;
              categorie: string;
              dateEmbauche: Date;
            }),
            candidatureId,
            matricule: await this.matricule(transaction),
          },
        }),
      );
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException(
          'Ce dossier de recrutement a déjà donné lieu à une embauche',
        );
      throw error;
    }
  }

  async updateEmploye(id: string, body: Body) {
    await this.exiger(id);
    const data = this.employeData(body, false);
    if (body.utilisateurId !== undefined) {
      const utilisateurId =
        typeof body.utilisateurId === 'string' && body.utilisateurId
          ? body.utilisateurId
          : null;
      if (
        utilisateurId &&
        !(await this.prisma.utilisateur.findUnique({
          where: { id: utilisateurId },
        }))
      )
        throw new BadRequestException('Compte utilisateur introuvable');
      data.utilisateurId = utilisateurId;
    }
    try {
      return await this.prisma.employe.update({ where: { id }, data });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException(
          'Ce compte utilisateur est déjà lié à un autre employé',
        );
      throw error;
    }
  }

  private async exiger(id: string) {
    const employe = await this.prisma.employe.findUnique({ where: { id } });
    if (!employe) throw new NotFoundException('Employé introuvable');
    return employe;
  }

  async employes(query: {
    q?: string;
    categorie?: string;
    statut?: string;
    page?: string;
    limit?: string;
  }) {
    const { page, limit, skip } = pagination(query, 50);
    const q = query.q?.trim();
    const where = {
      ...(query.categorie === 'ENSEIGNANT'
        ? { categorie: { startsWith: 'ENSEIGNANT' } }
        : query.categorie
          ? { categorie: query.categorie }
          : {}),
      ...(query.statut ? { statut: query.statut } : {}),
      ...(q
        ? {
            OR: ['nom', 'prenom', 'matricule', 'fonction', 'service'].map(
              (champ) => ({
                [champ]: { contains: q, mode: 'insensitive' as const },
              }),
            ),
          }
        : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.employe.count({ where }),
      this.prisma.employe.findMany({
        where,
        include: {
          contrats: { where: { statut: 'ACTIF' }, take: 1 },
        },
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
        skip,
        take: limit,
      }),
    ]);
    return { data, meta: meta(page, limit, total) };
  }

  async employe(id: string) {
    const employe = await this.prisma.employe.findUnique({
      where: { id },
      include: {
        contrats: { orderBy: { dateDebut: 'desc' } },
        conges: { orderBy: { dateDebut: 'desc' }, take: 50 },
        absences: { orderBy: { date: 'desc' }, take: 50 },
        rubriques: { include: { rubrique: true } },
        bulletins: {
          include: { periode: true },
          orderBy: { numero: 'desc' },
          take: 12,
        },
        cours: {
          where: {
            classe: { anneeAcademique: { statut: { not: 'CLOTUREE' } } },
          },
          include: { matiere: true, classe: { include: { filiere: true } } },
        },
      },
    });
    if (!employe) throw new NotFoundException('Employé introuvable');
    const utilisateur = employe.utilisateurId
      ? await this.prisma.utilisateur.findUnique({
          where: { id: employe.utilisateurId },
          select: { id: true, nom: true, prenom: true, email: true },
        })
      : null;
    return {
      ...employe,
      utilisateur,
      soldeConges: await this.soldeConges(employe),
    };
  }

  // Sortie des effectifs : le contrat en cours se termine et l'employé ne peut plus être payé ensuite.
  async sortie(id: string, body: Body) {
    const employe = await this.exiger(id);
    if (employe.statut === 'SORTI')
      throw new ConflictException('Cet employé est déjà sorti des effectifs');
    const dateSortie = parseDate(body.dateSortie, 'La date de sortie');
    if (dateSortie < employe.dateEmbauche)
      throw new BadRequestException(
        "La date de sortie précède la date d'embauche",
      );
    const motifSortie = texteRequis(
      body.motif,
      'Le motif de la sortie',
      5,
      300,
    );
    await this.prisma.$transaction([
      this.prisma.contrat.updateMany({
        where: { employeId: id, statut: 'ACTIF' },
        data: { statut: 'TERMINE', dateFin: dateSortie, motifFin: motifSortie },
      }),
      this.prisma.employe.update({
        where: { id },
        data: { statut: 'SORTI', dateSortie, motifSortie },
      }),
    ]);
    return this.employe(id);
  }

  async reintegrer(id: string) {
    const employe = await this.exiger(id);
    if (employe.statut !== 'SORTI')
      throw new ConflictException("Cet employé n'est pas sorti des effectifs");
    await this.prisma.employe.update({
      where: { id },
      data: { statut: 'ACTIF', dateSortie: null, motifSortie: null },
    });
    return this.employe(id);
  }

  // ---------- Contrats ----------

  async createContrat(employeId: string, body: Body, acteur: Acteur) {
    const employe = await this.exiger(employeId);
    if (employe.statut === 'SORTI')
      throw new ConflictException(
        "Cet employé est sorti des effectifs : réintégrez-le avant d'établir un contrat",
      );
    const type = choix(body.type, TYPES_CONTRAT, 'Le type de contrat');
    const dateDebut = parseDate(body.dateDebut, 'La date de début');
    const dateFin = dateOptionnelle(body.dateFin, 'La date de fin');
    if (dateDebut < employe.dateEmbauche)
      throw new BadRequestException(
        "Le contrat ne peut pas commencer avant la date d'embauche",
      );
    if (['CDD', 'STAGE'].includes(type) && !dateFin)
      throw new BadRequestException(
        'Un CDD ou un stage a obligatoirement une date de fin',
      );
    if (dateFin && dateFin <= dateDebut)
      throw new BadRequestException(
        'La date de fin doit suivre la date de début',
      );
    const salaireBase = parseNombre(
      body.salaireBase ?? 0,
      'Le salaire de base',
    );
    const tauxHoraire = parseNombre(body.tauxHoraire ?? 0, 'Le taux horaire');
    if (type === 'VACATION' && tauxHoraire <= 0)
      throw new BadRequestException(
        'Un contrat de vacation précise le taux horaire',
      );
    if (type !== 'VACATION' && type !== 'STAGE' && salaireBase <= 0)
      throw new BadRequestException(
        'Un CDI ou un CDD précise le salaire de base mensuel',
      );
    await this.prisma.$transaction(async (transaction) => {
      // Un seul contrat actif : le nouveau met fin au précédent la veille.
      const precedent = await transaction.contrat.findFirst({
        where: { employeId, statut: 'ACTIF' },
      });
      if (precedent) {
        if (dateDebut <= precedent.dateDebut)
          throw new ConflictException(
            'Le nouveau contrat doit commencer après le début du contrat en cours',
          );
        await transaction.contrat.update({
          where: { id: precedent.id },
          data: {
            statut: 'TERMINE',
            dateFin: new Date(dateDebut.getTime() - JOUR_MS),
            motifFin: 'Remplacé par un nouveau contrat',
          },
        });
      }
      await transaction.contrat.create({
        data: {
          employeId,
          type,
          dateDebut,
          dateFin,
          salaireBase,
          tauxHoraire,
          creeParNom: acteur.nom,
        },
      });
    });
    return this.employe(employeId);
  }

  async terminerContrat(id: string, body: Body) {
    const contrat = await this.prisma.contrat.findUnique({ where: { id } });
    if (!contrat) throw new NotFoundException('Contrat introuvable');
    if (contrat.statut !== 'ACTIF')
      throw new ConflictException('Ce contrat est déjà terminé');
    const dateFin = parseDate(body.dateFin, 'La date de fin');
    if (dateFin < contrat.dateDebut)
      throw new BadRequestException(
        'La date de fin précède le début du contrat',
      );
    await this.prisma.contrat.update({
      where: { id },
      data: {
        statut: 'TERMINE',
        dateFin,
        motifFin: texteRequis(body.motif, 'Le motif de fin de contrat', 5, 300),
      },
    });
    return this.employe(contrat.employeId);
  }

  // ---------- Congés ----------

  private async soldeConges(employe: { id: string; dateEmbauche: Date }) {
    const parametres = await this.parametres();
    const maintenant = new Date();
    const debutAnnee = new Date(Date.UTC(maintenant.getUTCFullYear(), 0, 1));
    const conges = await this.prisma.conge.findMany({
      where: {
        employeId: employe.id,
        type: 'ANNUEL',
        statut: { in: ['DEMANDE', 'APPROUVE'] },
        dateDebut: { gte: debutAnnee },
      },
      select: { jours: true, statut: true },
    });
    const somme = (statut: string) =>
      conges
        .filter((conge) => conge.statut === statut)
        .reduce((total, conge) => total + conge.jours, 0);
    const acquis = congesAcquis(
      employe.dateEmbauche,
      maintenant,
      parametres.joursCongeAnnuel,
    );
    return {
      acquis,
      pris: somme('APPROUVE'),
      enAttente: somme('DEMANDE'),
      disponible: acquis - somme('APPROUVE') - somme('DEMANDE'),
    };
  }

  async demanderConge(employeId: string, body: Body, acteur: Acteur) {
    const employe = await this.exiger(employeId);
    if (employe.statut !== 'ACTIF')
      throw new ConflictException("Cet employé n'est pas en activité");
    const type = choix(body.type, TYPES_CONGE, 'Le type de congé');
    const dateDebut = parseDate(body.dateDebut, 'La date de début');
    const dateFin = parseDate(body.dateFin, 'La date de fin');
    if (dateFin < dateDebut)
      throw new BadRequestException('La date de fin précède la date de début');
    const jours = joursDeConge(dateDebut, dateFin);
    if (jours === 0)
      throw new BadRequestException(
        'La période ne contient aucun jour ouvrable',
      );
    const chevauchement = await this.prisma.conge.findFirst({
      where: {
        employeId,
        statut: { in: ['DEMANDE', 'APPROUVE'] },
        dateDebut: { lte: dateFin },
        dateFin: { gte: dateDebut },
      },
    });
    if (chevauchement)
      throw new ConflictException(
        'Un autre congé de cet employé couvre déjà une partie de cette période',
      );
    if (type === 'ANNUEL') {
      const solde = await this.soldeConges(employe);
      if (jours > solde.disponible)
        throw new ConflictException(
          `Solde de congé insuffisant : ${solde.disponible} jour(s) disponible(s) pour ${jours} demandé(s). Utilisez un congé sans solde pour le complément.`,
        );
    }
    await this.prisma.conge.create({
      data: {
        employeId,
        type,
        dateDebut,
        dateFin,
        jours,
        motif:
          type === 'ANNUEL'
            ? texteOptionnel(body.motif, 300)
            : texteRequis(body.motif, 'Le motif du congé', 3, 300),
        demandeParId: acteur.id,
        demandeParNom: acteur.nom,
      },
    });
    return this.employe(employeId);
  }

  async deciderConge(id: string, body: Body, acteur: Acteur) {
    const conge = await this.prisma.conge.findUnique({
      where: { id },
      include: { employe: true },
    });
    if (!conge) throw new NotFoundException('Congé introuvable');
    if (conge.statut !== 'DEMANDE')
      throw new ConflictException('Ce congé a déjà reçu une décision');
    // Personne ne s'accorde son propre congé.
    if (conge.employe.utilisateurId === acteur.id)
      throw new ForbiddenException(
        'Vous ne pouvez pas décider de votre propre congé',
      );
    const approuve = body.approuve === true;
    await this.prisma.conge.update({
      where: { id },
      data: {
        statut: approuve ? 'APPROUVE' : 'REFUSE',
        decideParId: acteur.id,
        decideParNom: acteur.nom,
        dateDecision: new Date(),
        commentaireDecision: approuve
          ? texteOptionnel(body.commentaire, 300)
          : texteRequis(body.commentaire, 'Le motif du refus', 5, 300),
      },
    });
    return this.employe(conge.employeId);
  }

  async annulerConge(id: string, acteur: Acteur) {
    const conge = await this.prisma.conge.findUnique({ where: { id } });
    if (!conge) throw new NotFoundException('Congé introuvable');
    if (!['DEMANDE', 'APPROUVE'].includes(conge.statut))
      throw new ConflictException('Ce congé ne peut plus être annulé');
    if (conge.type === 'SANS_SOLDE' && conge.statut === 'APPROUVE')
      await this.refuserSiPaieValidee(conge.employeId, conge.dateDebut);
    await this.prisma.conge.update({
      where: { id },
      data: {
        statut: 'ANNULE',
        decideParId: acteur.id,
        decideParNom: acteur.nom,
        dateDecision: new Date(),
      },
    });
    return this.employe(conge.employeId);
  }

  congesEnAttente() {
    return this.prisma.conge.findMany({
      where: { statut: 'DEMANDE' },
      include: { employe: true },
      orderBy: { dateDemande: 'asc' },
    });
  }

  // ---------- Absences ----------

  // Les absences d'un mois dont la paie est validée ont déjà servi au calcul.
  private async refuserSiPaieValidee(employeId: string, date: Date) {
    const periode = await this.prisma.periodePaie.findUnique({
      where: {
        annee_mois: {
          annee: date.getUTCFullYear(),
          mois: date.getUTCMonth() + 1,
        },
      },
      include: { bulletins: { where: { employeId } } },
    });
    if (periode && periode.statut !== 'OUVERTE' && periode.bulletins.length)
      throw new ConflictException(
        'La paie de ce mois est validée pour cet employé : cet élément ne peut plus changer',
      );
  }

  async createAbsence(employeId: string, body: Body, acteur: Acteur) {
    const employe = await this.exiger(employeId);
    if (employe.statut === 'SORTI')
      throw new ConflictException('Cet employé est sorti des effectifs');
    const date = parseDate(body.date, "La date de l'absence");
    if (estDansLeFutur(date))
      throw new BadRequestException(
        "Une absence ne se constate qu'une fois survenue",
      );
    await this.refuserSiPaieValidee(employeId, date);
    const justifiee = body.justifiee === true;
    await this.prisma.absencePersonnel.create({
      data: {
        employeId,
        date,
        jours: parseNombre(body.jours ?? 1, "La durée de l'absence", 0.5, 31),
        justifiee,
        motif: justifiee
          ? texteRequis(body.motif, 'Le justificatif', 3, 300)
          : texteOptionnel(body.motif, 300),
        saisieParNom: acteur.nom,
      },
    });
    return this.employe(employeId);
  }

  async removeAbsence(id: string) {
    const absence = await this.prisma.absencePersonnel.findUnique({
      where: { id },
    });
    if (!absence) throw new NotFoundException('Absence introuvable');
    await this.refuserSiPaieValidee(absence.employeId, absence.date);
    await this.prisma.absencePersonnel.delete({ where: { id } });
    return this.employe(absence.employeId);
  }

  // ---------- Vue d'ensemble ----------

  async tableauDeBord() {
    const maintenant = new Date();
    const dans30Jours = new Date(maintenant.getTime() + 30 * JOUR_MS);
    const [employes, contratsExpirant, congesEnAttente, enConge, sansContrat] =
      await Promise.all([
        this.prisma.employe.groupBy({
          by: ['categorie'],
          where: { statut: 'ACTIF' },
          _count: { _all: true },
        }),
        this.prisma.contrat.findMany({
          where: {
            statut: 'ACTIF',
            dateFin: { not: null, lte: dans30Jours },
          },
          include: { employe: true },
          orderBy: { dateFin: 'asc' },
        }),
        this.prisma.conge.count({ where: { statut: 'DEMANDE' } }),
        this.prisma.conge.findMany({
          where: {
            statut: 'APPROUVE',
            dateDebut: { lte: maintenant },
            dateFin: { gte: maintenant },
          },
          include: { employe: true },
        }),
        this.prisma.employe.count({
          where: { statut: 'ACTIF', contrats: { none: { statut: 'ACTIF' } } },
        }),
      ]);
    return {
      effectif: employes.reduce((total, item) => total + item._count._all, 0),
      parCategorie: employes.map((item) => ({
        categorie: item.categorie,
        total: item._count._all,
      })),
      // Contrats à renouveler ou à clore dans les 30 jours.
      contratsExpirant,
      congesEnAttente,
      enConge,
      sansContrat,
    };
  }
}
