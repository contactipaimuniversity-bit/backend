import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { Acteur } from '../common/acteur';
import { isUniqueConstraintViolation } from '../common/prisma-errors';
import {
  choix,
  estDansLeFutur,
  parseDate,
  parseEntier,
  parseNombre,
  texteOptionnel,
  texteRequis,
} from '../common/saisie';
import { PrismaService } from '../prisma/prisma.service';
import {
  bornesDuMois,
  calculerBulletin,
  joursCommuns,
  joursDeConge,
  MODES_PAIEMENT,
  MODES_RUBRIQUE,
  RubriqueCalcul,
  TYPES_RUBRIQUE,
} from './rh.rules';
import { RhService } from './rh.service';

type Body = Record<string, unknown>;

// Rubriques proposées à la première utilisation. Les taux sont des valeurs de
// départ : ils doivent être confirmés avec le comptable de l'établissement.
const RUBRIQUES_INITIALES = [
  ['TRANSPORT', 'Prime de transport', 'GAIN', 'FIXE', 0, null, false, null, 10],
  [
    'RESPONSABILITE',
    'Prime de responsabilité',
    'GAIN',
    'FIXE',
    0,
    null,
    false,
    null,
    20,
  ],
  [
    'HEURES_SUP',
    'Heures supplémentaires',
    'GAIN',
    'VARIABLE',
    0,
    null,
    true,
    null,
    30,
  ],
  [
    'PRIME',
    'Prime exceptionnelle',
    'GAIN',
    'VARIABLE',
    0,
    null,
    true,
    null,
    40,
  ],
  [
    'CNSS',
    'CNSS pensions (part salariale)',
    'RETENUE',
    'POURCENTAGE_BRUT',
    4,
    1200000,
    true,
    '431',
    50,
  ],
  [
    'IMPOT',
    'Impôt sur le revenu retenu à la source',
    'RETENUE',
    'VARIABLE',
    0,
    null,
    true,
    '447',
    60,
  ],
  [
    'AVANCE',
    'Avance sur salaire',
    'RETENUE',
    'VARIABLE',
    0,
    null,
    true,
    '421',
    70,
  ],
  [
    'CNSS_PENSION',
    'CNSS pensions (part patronale)',
    'PATRONALE',
    'POURCENTAGE_BRUT',
    8,
    1200000,
    true,
    '431',
    80,
  ],
  [
    'CNSS_FAMILLE',
    'CNSS prestations familiales',
    'PATRONALE',
    'POURCENTAGE_BRUT',
    10.03,
    600000,
    true,
    '431',
    81,
  ],
  [
    'CNSS_ACCIDENT',
    'CNSS accidents du travail',
    'PATRONALE',
    'POURCENTAGE_BRUT',
    2.25,
    600000,
    true,
    '431',
    82,
  ],
] as const;

@Injectable()
export class PaieService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rh: RhService,
  ) {}

  // ---------- Rubriques ----------

  async rubriques() {
    if ((await this.prisma.rubriquePaie.count()) === 0)
      await this.prisma.rubriquePaie.createMany({
        data: RUBRIQUES_INITIALES.map(
          ([
            code,
            libelle,
            type,
            mode,
            valeur,
            plafond,
            appliqueATous,
            compteNumero,
            ordre,
          ]) => ({
            code,
            libelle,
            type,
            mode,
            valeur,
            plafond,
            appliqueATous,
            compteNumero,
            ordre,
          }),
        ),
        skipDuplicates: true,
      });
    return this.prisma.rubriquePaie.findMany({
      orderBy: [{ ordre: 'asc' }, { code: 'asc' }],
    });
  }

  private rubriqueData(body: Body, creation: boolean) {
    const data: Record<string, unknown> = {};
    if (creation || body.libelle !== undefined)
      data.libelle = texteRequis(body.libelle, 'Le libellé', 2, 120);
    if (creation || body.type !== undefined)
      data.type = choix(body.type, TYPES_RUBRIQUE, 'Le type');
    if (creation || body.mode !== undefined)
      data.mode = choix(body.mode, MODES_RUBRIQUE, 'Le mode de calcul');
    if (creation || body.valeur !== undefined)
      data.valeur = parseNombre(body.valeur ?? 0, 'La valeur');
    if (body.plafond !== undefined)
      data.plafond =
        body.plafond === null || body.plafond === ''
          ? null
          : parseNombre(body.plafond, 'Le plafond', 1);
    if (body.appliqueATous !== undefined)
      data.appliqueATous = body.appliqueATous === true;
    if (body.compteNumero !== undefined)
      data.compteNumero = texteOptionnel(body.compteNumero, 12);
    if (body.ordre !== undefined)
      data.ordre = parseEntier(body.ordre, "L'ordre", 0, 999);
    if (body.actif !== undefined) data.actif = body.actif === true;
    return data;
  }

  async createRubrique(body: Body) {
    const code = texteRequis(body.code, 'Le code', 2, 24)
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_');
    if (['BASE', 'VACATION', 'ABSENCE'].includes(code))
      throw new BadRequestException(
        'Ce code est réservé au calcul automatique',
      );
    try {
      return await this.prisma.rubriquePaie.create({
        data: {
          ...(this.rubriqueData(body, true) as {
            libelle: string;
            type: string;
            mode: string;
          }),
          code,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException('Une rubrique porte déjà ce code');
      throw error;
    }
  }

  async updateRubrique(id: string, body: Body) {
    const rubrique = await this.prisma.rubriquePaie.findUnique({
      where: { id },
    });
    if (!rubrique) throw new NotFoundException('Rubrique introuvable');
    return this.prisma.rubriquePaie.update({
      where: { id },
      data: this.rubriqueData(body, false),
    });
  }

  // Valeur propre à un employé pour une rubrique ; vide pour la retirer.
  async definirRubriqueEmploye(employeId: string, body: Body) {
    const rubriqueId = texteRequis(body.rubriqueId, 'La rubrique');
    const [employe, rubrique] = await Promise.all([
      this.prisma.employe.findUnique({ where: { id: employeId } }),
      this.prisma.rubriquePaie.findUnique({ where: { id: rubriqueId } }),
    ]);
    if (!employe) throw new NotFoundException('Employé introuvable');
    if (!rubrique) throw new NotFoundException('Rubrique introuvable');
    const cle = { employeId_rubriqueId: { employeId, rubriqueId } };
    if (
      body.valeur === null ||
      body.valeur === undefined ||
      body.valeur === ''
    ) {
      await this.prisma.employeRubrique.deleteMany({
        where: { employeId, rubriqueId },
      });
    } else {
      const valeur = parseNombre(body.valeur, 'La valeur');
      await this.prisma.employeRubrique.upsert({
        where: cle,
        create: { employeId, rubriqueId, valeur },
        update: { valeur },
      });
    }
    return this.rh.employe(employeId);
  }

  // ---------- Calcul ----------

  private async calculer(periodeId: string) {
    const periode = await this.prisma.periodePaie.findUniqueOrThrow({
      where: { id: periodeId },
      include: { bulletins: true },
    });
    const mois = bornesDuMois(periode.annee, periode.mois);
    const [parametres, rubriques, employes] = await Promise.all([
      this.rh.parametres(),
      this.rubriques(),
      this.prisma.employe.findMany({
        where: {
          dateEmbauche: { lte: mois.fin },
          OR: [{ dateSortie: null }, { dateSortie: { gte: mois.debut } }],
        },
        include: {
          rubriques: true,
          // Contrats qui couvrent au moins un jour du mois.
          contrats: {
            where: {
              dateDebut: { lte: mois.fin },
              OR: [{ dateFin: null }, { dateFin: { gte: mois.debut } }],
            },
            orderBy: { dateDebut: 'desc' },
          },
          absences: {
            where: {
              justifiee: false,
              date: { gte: mois.debut, lte: mois.fin },
            },
          },
          conges: {
            where: {
              type: 'SANS_SOLDE',
              statut: 'APPROUVE',
              dateDebut: { lte: mois.fin },
              dateFin: { gte: mois.debut },
            },
          },
          seances: {
            where: { date: { gte: mois.debut, lte: mois.fin } },
            select: { dureeMinutes: true },
          },
        },
      }),
    ]);
    const actives = rubriques.filter((rubrique) => rubrique.actif);
    const conserves = new Set<string>();

    for (const employe of employes) {
      if (!employe.contrats.length) continue;
      // Salaire au prorata des jours couverts par chaque contrat du mois.
      let salaire = 0;
      let joursCouverts = 0;
      for (const contrat of employe.contrats) {
        const jours = joursCommuns(
          contrat.dateDebut,
          contrat.dateFin,
          mois.debut,
          mois.fin,
        );
        salaire += (Number(contrat.salaireBase) * jours) / mois.jours;
        joursCouverts += jours;
      }
      const contrat = employe.contrats[0];
      const tauxHoraire = Number(contrat.tauxHoraire);
      const heuresVacation =
        tauxHoraire > 0
          ? Math.round(
              (employe.seances.reduce(
                (total, seance) => total + seance.dureeMinutes,
                0,
              ) /
                60) *
                100,
            ) / 100
          : 0;
      const joursAbsence =
        employe.absences.reduce(
          (total, absence) => total + Number(absence.jours),
          0,
        ) +
        employe.conges.reduce(
          (total, conge) =>
            total +
            joursDeConge(
              conge.dateDebut > mois.debut ? conge.dateDebut : mois.debut,
              conge.dateFin < mois.fin ? conge.dateFin : mois.fin,
            ),
          0,
        );
      const applicables: RubriqueCalcul[] = actives.flatMap((rubrique) => {
        const propre = employe.rubriques.find(
          (item) => item.rubriqueId === rubrique.id,
        );
        if (!propre && !rubrique.appliqueATous) return [];
        return [
          {
            code: rubrique.code,
            libelle: rubrique.libelle,
            type: rubrique.type,
            mode: rubrique.mode,
            // Une rubrique variable sans valeur propre vaut zéro tant qu'elle n'est pas saisie.
            valeur: propre
              ? Number(propre.valeur)
              : rubrique.mode === 'VARIABLE'
                ? 0
                : Number(rubrique.valeur),
            plafond:
              rubrique.plafond === null ? null : Number(rubrique.plafond),
            compteNumero: rubrique.compteNumero,
            ordre: rubrique.ordre,
          },
        ];
      });
      const existant = periode.bulletins.find(
        (bulletin) => bulletin.employeId === employe.id,
      );
      const ajustements = (existant?.ajustements ?? {}) as Record<
        string,
        number
      >;
      const calcul = calculerBulletin({
        salaireBase:
          joursCouverts > 0 ? (salaire * mois.jours) / joursCouverts : 0,
        prorata: Math.min(1, joursCouverts / mois.jours),
        tauxHoraire,
        heuresVacation,
        joursAbsence,
        joursOuvresMois: parametres.joursOuvresMois,
        rubriques: applicables,
        ajustements,
      });
      // Rien à payer ce mois : pas de bulletin (vacataire sans heures, par exemple).
      if (calcul.brut === 0 && !calcul.lignes.length) continue;
      conserves.add(employe.id);
      const data = {
        categorie: employe.categorie,
        fonction: employe.fonction,
        salaireBase: calcul.salaireBase,
        heuresVacation,
        tauxHoraire,
        joursAbsence,
        brut: calcul.brut,
        totalRetenues: calcul.totalRetenues,
        net: calcul.net,
        chargesPatronales: calcul.chargesPatronales,
        lignes: calcul.lignes as unknown as Prisma.InputJsonArray,
      };
      await this.prisma.bulletinPaie.upsert({
        where: {
          periodeId_employeId: { periodeId, employeId: employe.id },
        },
        create: {
          ...data,
          periodeId,
          employeId: employe.id,
          numero: `BP-${periode.annee}${String(periode.mois).padStart(2, '0')}-${employe.matricule}`,
          ajustements,
        },
        update: data,
      });
    }
    await this.prisma.bulletinPaie.deleteMany({
      where: { periodeId, employeId: { notIn: [...conserves] } },
    });
  }

  // ---------- Périodes ----------

  periodes() {
    return this.prisma.periodePaie.findMany({
      orderBy: [{ annee: 'desc' }, { mois: 'desc' }],
      include: {
        _count: { select: { bulletins: true } },
        bulletins: {
          select: { brut: true, net: true, chargesPatronales: true },
        },
      },
    });
  }

  async periode(id: string) {
    const periode = await this.prisma.periodePaie.findUnique({
      where: { id },
      include: {
        bulletins: {
          include: {
            employe: {
              select: {
                id: true,
                matricule: true,
                nom: true,
                prenom: true,
                modePaiement: true,
                coordonneesPaiement: true,
                numeroCnss: true,
                dateEmbauche: true,
              },
            },
          },
          orderBy: [
            { employe: { nom: 'asc' } },
            { employe: { prenom: 'asc' } },
          ],
        },
      },
    });
    if (!periode) throw new NotFoundException('Période de paie introuvable');
    const total = (
      cle: 'brut' | 'totalRetenues' | 'net' | 'chargesPatronales',
    ) =>
      periode.bulletins.reduce(
        (somme, bulletin) => somme + Number(bulletin[cle]),
        0,
      );
    // Employés actifs sans contrat : ils n'apparaissent sur aucun bulletin.
    const mois = bornesDuMois(periode.annee, periode.mois);
    const sansContrat = await this.prisma.employe.findMany({
      where: {
        statut: 'ACTIF',
        dateEmbauche: { lte: mois.fin },
        contrats: {
          none: {
            dateDebut: { lte: mois.fin },
            OR: [{ dateFin: null }, { dateFin: { gte: mois.debut } }],
          },
        },
      },
      select: { id: true, nom: true, prenom: true, matricule: true },
    });
    return {
      ...periode,
      totaux: {
        brut: total('brut'),
        retenues: total('totalRetenues'),
        net: total('net'),
        chargesPatronales: total('chargesPatronales'),
        coutTotal: total('brut') + total('chargesPatronales'),
      },
      anomalies: [
        ...periode.bulletins
          .filter((bulletin) => Number(bulletin.net) < 0)
          .map(
            (bulletin) =>
              `${bulletin.employe.prenom} ${bulletin.employe.nom} : net à payer négatif`,
          ),
        ...sansContrat.map(
          (employe) =>
            `${employe.prenom} ${employe.nom} (${employe.matricule}) : aucun contrat sur ce mois, non payé`,
        ),
      ],
    };
  }

  async createPeriode(body: Body, acteur: Acteur) {
    const annee = parseEntier(body.annee, "L'année", 2020, 2100);
    const mois = parseEntier(body.mois, 'Le mois', 1, 12);
    // On ne prépare pas la paie d'un mois qui n'a pas commencé.
    if (estDansLeFutur(bornesDuMois(annee, mois).debut))
      throw new BadRequestException(
        "La paie d'un mois à venir ne peut pas encore être préparée",
      );
    let periode: { id: string };
    try {
      periode = await this.prisma.periodePaie.create({
        data: {
          annee,
          mois,
          prepareParId: acteur.id,
          prepareParNom: acteur.nom,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException('La paie de ce mois existe déjà');
      throw error;
    }
    await this.calculer(periode.id);
    return this.periode(periode.id);
  }

  private async ouverte(id: string) {
    const periode = await this.prisma.periodePaie.findUnique({ where: { id } });
    if (!periode) throw new NotFoundException('Période de paie introuvable');
    if (periode.statut !== 'OUVERTE')
      throw new ConflictException(
        'Cette paie est validée : elle ne se modifie plus',
      );
    return periode;
  }

  async recalculer(id: string) {
    await this.ouverte(id);
    await this.calculer(id);
    return this.periode(id);
  }

  async ajuster(bulletinId: string, body: Body) {
    const bulletin = await this.prisma.bulletinPaie.findUnique({
      where: { id: bulletinId },
    });
    if (!bulletin) throw new NotFoundException('Bulletin introuvable');
    await this.ouverte(bulletin.periodeId);
    const variables = new Set(
      (await this.rubriques())
        .filter((rubrique) => rubrique.actif && rubrique.mode === 'VARIABLE')
        .map((rubrique) => rubrique.code),
    );
    const saisis = (body.ajustements ?? {}) as Record<string, unknown>;
    const ajustements: Record<string, number> = {};
    for (const [code, valeur] of Object.entries(saisis)) {
      if (!variables.has(code))
        throw new BadRequestException(
          `« ${code} » n'est pas une rubrique à saisir chaque mois`,
        );
      if (valeur === null || valeur === '' || valeur === undefined) continue;
      const montant = parseNombre(valeur, `Le montant de ${code}`);
      if (montant > 0) ajustements[code] = montant;
    }
    await this.prisma.bulletinPaie.update({
      where: { id: bulletinId },
      data: { ajustements },
    });
    await this.calculer(bulletin.periodeId);
    return this.periode(bulletin.periodeId);
  }

  // Celui qui prépare la paie ne la valide pas lui-même.
  async valider(id: string, acteur: Acteur) {
    const periode = await this.ouverte(id);
    if (periode.prepareParId === acteur.id)
      throw new ForbiddenException(
        'Vous avez préparé cette paie : sa validation revient à une autre personne',
      );
    await this.calculer(id);
    const detail = await this.periode(id);
    if (!detail.bulletins.length)
      throw new ConflictException('Aucun bulletin à valider pour ce mois');
    const negatifs = detail.anomalies.filter((anomalie) =>
      anomalie.includes('négatif'),
    );
    if (negatifs.length)
      throw new ConflictException(
        `Validation impossible : ${negatifs.join(' · ')}`,
      );
    await this.prisma.periodePaie.update({
      where: { id },
      data: {
        statut: 'VALIDEE',
        valideParId: acteur.id,
        valideParNom: acteur.nom,
        dateValidation: new Date(),
      },
    });
    return this.periode(id);
  }

  async rouvrir(id: string, body: Body) {
    const periode = await this.prisma.periodePaie.findUnique({ where: { id } });
    if (!periode) throw new NotFoundException('Période de paie introuvable');
    if (periode.statut !== 'VALIDEE')
      throw new ConflictException(
        periode.statut === 'PAYEE'
          ? 'Une paie déjà versée ne se rouvre pas'
          : "Cette paie n'est pas validée",
      );
    // Le motif est conservé dans le journal d'audit.
    texteRequis(body.motif, 'Le motif de la réouverture', 10, 500);
    await this.prisma.periodePaie.update({
      where: { id },
      data: {
        statut: 'OUVERTE',
        valideParId: null,
        valideParNom: null,
        dateValidation: null,
      },
    });
    return this.periode(id);
  }

  async payer(id: string, body: Body, acteur: Acteur) {
    const periode = await this.prisma.periodePaie.findUnique({ where: { id } });
    if (!periode) throw new NotFoundException('Période de paie introuvable');
    if (periode.statut !== 'VALIDEE')
      throw new ConflictException(
        periode.statut === 'PAYEE'
          ? 'Cette paie est déjà versée'
          : 'La paie doit être validée avant son versement',
      );
    const datePaiement = parseDate(body.datePaiement, 'La date du versement');
    if (estDansLeFutur(datePaiement))
      throw new BadRequestException(
        'La date du versement ne peut pas être dans le futur',
      );
    await this.prisma.periodePaie.update({
      where: { id },
      data: {
        statut: 'PAYEE',
        payeParId: acteur.id,
        payeParNom: acteur.nom,
        datePaiement,
        modePaiement: choix(
          body.modePaiement,
          MODES_PAIEMENT,
          'Le mode de versement',
        ),
      },
    });
    return this.periode(id);
  }

  async bulletin(id: string) {
    const bulletin = await this.prisma.bulletinPaie.findUnique({
      where: { id },
      include: { employe: true, periode: true },
    });
    if (!bulletin) throw new NotFoundException('Bulletin introuvable');
    return bulletin;
  }
}
