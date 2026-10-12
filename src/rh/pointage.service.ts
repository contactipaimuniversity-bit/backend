import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Acteur } from '../common/acteur';
import {
  estDansLeFutur,
  minutes,
  parseDate,
  parseEntier,
  parseHeure,
  texteOptionnel,
  texteRequis,
} from '../common/saisie';
import { PrismaService } from '../prisma/prisma.service';
import { bornesDuMois, CAHIER_A_COMPLETER } from './rh.rules';
import { RhService } from './rh.service';

type Body = Record<string, unknown>;

const JOUR_MS = 24 * 60 * 60 * 1000;
// Le personnel qui pointe son arrivée et son départ ; les enseignants émargent par créneau.
const CATEGORIES_POINTEES = ['ADMINISTRATIF', 'TECHNIQUE'];

const nomClasse = (classe: {
  niveau: string;
  groupe: string;
  filiere: { code: string };
}) =>
  `${classe.filiere.code} ${classe.niveau}${classe.groupe === 'A' ? '' : ` ${classe.groupe}`}`;

// Présences du personnel : arrivée et départ des administratifs, émargement
// des enseignants sur les créneaux de l'emploi du temps.
@Injectable()
export class PointageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rh: RhService,
  ) {}

  // Jour pointé, ramené à minuit ; on ne pointe pas un jour à venir.
  private jour(value: unknown) {
    const saisie = parseDate(value, 'La date');
    const debut = new Date(
      Date.UTC(
        saisie.getUTCFullYear(),
        saisie.getUTCMonth(),
        saisie.getUTCDate(),
      ),
    );
    if (estDansLeFutur(debut))
      throw new BadRequestException(
        "Le pointage d'un jour à venir n'est pas possible",
      );
    return { debut, fin: new Date(debut.getTime() + JOUR_MS - 1) };
  }

  // ---------- Personnel administratif et technique ----------

  private ecarts(
    pointage: { heureArrivee: string | null; heureDepart: string | null },
    horaires: {
      heureArrivee: string;
      heureDepart: string;
      toleranceRetard: number;
    },
  ) {
    const retard = pointage.heureArrivee
      ? minutes(pointage.heureArrivee) - minutes(horaires.heureArrivee)
      : 0;
    const avance = pointage.heureDepart
      ? minutes(horaires.heureDepart) - minutes(pointage.heureDepart)
      : 0;
    return {
      // En deçà de la tolérance, l'arrivée n'est pas comptée comme un retard.
      retardMinutes: retard > horaires.toleranceRetard ? retard : 0,
      departAnticipeMinutes: avance > 0 ? avance : 0,
      minutesTravaillees:
        pointage.heureArrivee && pointage.heureDepart
          ? minutes(pointage.heureDepart) - minutes(pointage.heureArrivee)
          : 0,
    };
  }

  async personnel(rawDate: unknown) {
    const { debut, fin } = this.jour(rawDate);
    const [horaires, employes] = await Promise.all([
      this.rh.parametres(),
      this.prisma.employe.findMany({
        where: {
          categorie: { in: CATEGORIES_POINTEES },
          dateEmbauche: { lte: fin },
          OR: [{ dateSortie: null }, { dateSortie: { gte: debut } }],
        },
        select: {
          id: true,
          matricule: true,
          nom: true,
          prenom: true,
          fonction: true,
          service: true,
          pointages: { where: { date: { gte: debut, lte: fin } } },
          absences: { where: { date: { gte: debut, lte: fin } } },
          conges: {
            where: {
              statut: 'APPROUVE',
              dateDebut: { lte: fin },
              dateFin: { gte: debut },
            },
            select: { id: true, type: true, dateFin: true },
          },
        },
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
      }),
    ]);
    const lignes = employes.map(
      ({ pointages, absences, conges, ...employe }) => {
        const pointage = pointages[0] ?? null;
        const absence = absences[0] ?? null;
        const conge = conges[0] ?? null;
        return {
          employe,
          etat: absence
            ? 'ABSENT'
            : conge
              ? 'CONGE'
              : pointage?.heureArrivee
                ? 'PRESENT'
                : 'A_POINTER',
          pointage,
          absence,
          conge,
          ...(pointage
            ? this.ecarts(pointage, horaires)
            : {
                retardMinutes: 0,
                departAnticipeMinutes: 0,
                minutesTravaillees: 0,
              }),
        };
      },
    );
    const compter = (etat: string) =>
      lignes.filter((ligne) => ligne.etat === etat).length;
    return {
      date: debut,
      horaires: {
        heureArrivee: horaires.heureArrivee,
        heureDepart: horaires.heureDepart,
        toleranceRetard: horaires.toleranceRetard,
      },
      synthese: {
        effectif: lignes.length,
        presents: compter('PRESENT'),
        absents: compter('ABSENT'),
        enConge: compter('CONGE'),
        aPointer: compter('A_POINTER'),
        retards: lignes.filter((ligne) => ligne.retardMinutes > 0).length,
      },
      lignes,
    };
  }

  private async employePointe(id: string) {
    const employe = await this.prisma.employe.findUnique({ where: { id } });
    if (!employe) throw new NotFoundException('Employé introuvable');
    if (!CATEGORIES_POINTEES.includes(employe.categorie))
      throw new BadRequestException(
        'Un enseignant émarge sur ses créneaux de cours, pas à la journée',
      );
    return employe;
  }

  async pointer(employeId: string, body: Body, acteur: Acteur) {
    await this.employePointe(employeId);
    const { debut, fin } = this.jour(body.date);
    const heure = (value: unknown, libelle: string) =>
      typeof value === 'string' && value.trim()
        ? parseHeure(value, libelle)
        : null;
    const heureArrivee = heure(body.heureArrivee, "L'heure d'arrivée");
    const heureDepart = heure(body.heureDepart, "L'heure de départ");
    if (heureDepart && !heureArrivee)
      throw new BadRequestException(
        "L'heure d'arrivée se saisit avant l'heure de départ",
      );
    if (
      heureArrivee &&
      heureDepart &&
      minutes(heureDepart) <= minutes(heureArrivee)
    )
      throw new BadRequestException(
        "L'heure de départ doit suivre l'heure d'arrivée",
      );
    const absence = await this.prisma.absencePersonnel.findFirst({
      where: { employeId, date: { gte: debut, lte: fin } },
    });
    if (absence && heureArrivee)
      throw new ConflictException(
        "Cette personne est notée absente ce jour-là : retirez d'abord l'absence",
      );
    const observation = texteOptionnel(body.observation, 200);
    if (!heureArrivee && !observation)
      await this.prisma.pointagePersonnel.deleteMany({
        where: { employeId, date: debut },
      });
    else
      await this.prisma.pointagePersonnel.upsert({
        where: { employeId_date: { employeId, date: debut } },
        create: {
          employeId,
          date: debut,
          heureArrivee,
          heureDepart,
          observation,
          saisieParNom: acteur.nom,
        },
        update: {
          heureArrivee,
          heureDepart,
          observation,
          saisieParNom: acteur.nom,
        },
      });
    return this.personnel(debut.toISOString());
  }

  // Absence d'une journée : elle rejoint les absences du dossier et, non
  // justifiée, sera retenue sur le salaire du mois.
  async noterAbsent(employeId: string, body: Body, acteur: Acteur) {
    await this.employePointe(employeId);
    const { debut, fin } = this.jour(body.date);
    const existante = await this.prisma.absencePersonnel.findFirst({
      where: { employeId, date: { gte: debut, lte: fin } },
    });
    if (existante)
      throw new ConflictException('Cette absence est déjà enregistrée');
    await this.rh.createAbsence(
      employeId,
      {
        date: debut.toISOString(),
        jours: 1,
        justifiee: body.justifiee === true,
        motif: body.motif,
      },
      acteur,
    );
    await this.prisma.pointagePersonnel.deleteMany({
      where: { employeId, date: debut },
    });
    return this.personnel(debut.toISOString());
  }

  // Remet la journée d'un employé à « à pointer ».
  async effacer(employeId: string, rawDate: unknown) {
    const { debut, fin } = this.jour(rawDate);
    const absences = await this.prisma.absencePersonnel.findMany({
      where: { employeId, date: { gte: debut, lte: fin } },
    });
    // Passe par le dossier : une absence déjà retenue par une paie validée ne s'efface pas.
    for (const absence of absences) await this.rh.removeAbsence(absence.id);
    await this.prisma.pointagePersonnel.deleteMany({
      where: { employeId, date: debut },
    });
    return this.personnel(debut.toISOString());
  }

  // Récapitulatif du mois : jours pointés, retards, départs anticipés, absences.
  async recapPersonnel(query: { annee?: string; mois?: string }) {
    const maintenant = new Date();
    const annee = parseEntier(
      query.annee ?? maintenant.getUTCFullYear(),
      "L'année",
      2020,
      2100,
    );
    const moisNumero = parseEntier(
      query.mois ?? maintenant.getUTCMonth() + 1,
      'Le mois',
      1,
      12,
    );
    const mois = bornesDuMois(annee, moisNumero);
    const [horaires, employes] = await Promise.all([
      this.rh.parametres(),
      this.prisma.employe.findMany({
        where: {
          categorie: { in: CATEGORIES_POINTEES },
          dateEmbauche: { lte: mois.fin },
          OR: [{ dateSortie: null }, { dateSortie: { gte: mois.debut } }],
        },
        select: {
          id: true,
          matricule: true,
          nom: true,
          prenom: true,
          fonction: true,
          pointages: { where: { date: { gte: mois.debut, lte: mois.fin } } },
          absences: { where: { date: { gte: mois.debut, lte: mois.fin } } },
        },
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
      }),
    ]);
    return {
      annee,
      mois: moisNumero,
      lignes: employes.map(({ pointages, absences, ...employe }) => {
        const ecarts = pointages.map((pointage) =>
          this.ecarts(pointage, horaires),
        );
        const somme = (cle: keyof (typeof ecarts)[number]) =>
          ecarts.reduce((total, ecart) => total + ecart[cle], 0);
        return {
          employe,
          joursPointes: pointages.filter((pointage) => pointage.heureArrivee)
            .length,
          retards: ecarts.filter((ecart) => ecart.retardMinutes > 0).length,
          minutesRetard: somme('retardMinutes'),
          departsAnticipes: ecarts.filter(
            (ecart) => ecart.departAnticipeMinutes > 0,
          ).length,
          minutesDepartAnticipe: somme('departAnticipeMinutes'),
          heuresTravaillees:
            Math.round((somme('minutesTravaillees') / 60) * 10) / 10,
          joursAbsence: absences.reduce(
            (total, absence) => total + Number(absence.jours),
            0,
          ),
          joursAbsenceInjustifiee: absences
            .filter((absence) => !absence.justifiee)
            .reduce((total, absence) => total + Number(absence.jours), 0),
        };
      }),
    };
  }

  // ---------- Enseignants : émargement par créneau ----------

  async enseignants(rawDate: unknown) {
    const { debut, fin } = this.jour(rawDate);
    const creneaux = await this.prisma.creneau.findMany({
      where: {
        jour: debut.getUTCDay(),
        cours: {
          classe: {
            anneeAcademique: {
              dateDebut: { lte: fin },
              dateFin: { gte: debut },
            },
          },
        },
      },
      include: {
        salle: { select: { nom: true } },
        cours: {
          include: {
            matiere: { select: { nom: true, code: true } },
            enseignant: {
              select: { id: true, nom: true, prenom: true, matricule: true },
            },
            classe: { include: { filiere: true } },
          },
        },
      },
      orderBy: [{ heureDebut: 'asc' }],
    });
    const jourDit = { date: { gte: debut, lte: fin } };
    const [seances, absences] = await Promise.all([
      this.prisma.seanceCours.findMany({
        where: jourDit,
        include: {
          enseignant: { select: { id: true, nom: true, prenom: true } },
          cours: {
            include: {
              matiere: { select: { nom: true } },
              classe: { include: { filiere: true } },
            },
          },
        },
        orderBy: { heureDebut: 'asc' },
      }),
      this.prisma.absenceEnseignant.findMany({ where: jourDit }),
    ]);
    const cle = (coursId: string, heureDebut: string) =>
      `${coursId}@${heureDebut}`;
    const prevus = new Set(
      creneaux.map((creneau) => cle(creneau.coursId, creneau.heureDebut)),
    );
    const lignes = creneaux.map((creneau) => {
      const seance = seances.find(
        (item) =>
          item.coursId === creneau.coursId &&
          item.heureDebut === creneau.heureDebut,
      );
      const absence = absences.find(
        (item) =>
          item.coursId === creneau.coursId &&
          item.heureDebut === creneau.heureDebut,
      );
      return {
        creneauId: creneau.id,
        heureDebut: creneau.heureDebut,
        heureFin: creneau.heureFin,
        classe: nomClasse(creneau.cours.classe),
        matiere: creneau.cours.matiere.nom,
        salle: creneau.salle?.nom ?? null,
        enseignant: seance?.enseignant ?? creneau.cours.enseignant,
        etat: seance ? 'PRESENT' : absence ? 'ABSENT' : 'A_POINTER',
        seance: seance
          ? {
              id: seance.id,
              dureeMinutes: seance.dureeMinutes,
              cahierRempli: seance.contenu !== CAHIER_A_COMPLETER,
            }
          : null,
        absence: absence
          ? {
              id: absence.id,
              justifiee: absence.justifiee,
              motif: absence.motif,
            }
          : null,
      };
    });
    const compter = (etat: string) =>
      lignes.filter((ligne) => ligne.etat === etat).length;
    return {
      date: debut,
      synthese: {
        creneaux: lignes.length,
        presents: compter('PRESENT'),
        absents: compter('ABSENT'),
        aPointer: compter('A_POINTER'),
      },
      lignes,
      // Séances tenues ce jour en dehors de l'emploi du temps (rattrapages).
      exceptionnelles: seances
        .filter((seance) => !prevus.has(cle(seance.coursId, seance.heureDebut)))
        .map((seance) => ({
          id: seance.id,
          heureDebut: seance.heureDebut,
          dureeMinutes: seance.dureeMinutes,
          classe: nomClasse(seance.cours.classe),
          matiere: seance.cours.matiere.nom,
          enseignant: seance.enseignant,
        })),
    };
  }

  // Le créneau, à condition qu'il tombe bien le jour pointé.
  private async creneauDuJour(creneauId: unknown, debut: Date) {
    const creneau = await this.prisma.creneau.findUnique({
      where: { id: texteRequis(creneauId, 'Le créneau') },
      include: {
        cours: { include: { classe: { include: { anneeAcademique: true } } } },
      },
    });
    if (!creneau) throw new NotFoundException('Créneau introuvable');
    if (creneau.jour !== debut.getUTCDay())
      throw new BadRequestException(
        "Ce créneau n'a pas lieu ce jour-là : l'émargement suit l'emploi du temps",
      );
    const annee = creneau.cours.classe.anneeAcademique;
    if (annee.statut === 'CLOTUREE')
      throw new ConflictException('Cette année académique est clôturée');
    if (debut < annee.dateDebut || debut > annee.dateFin)
      throw new BadRequestException(
        `La date est en dehors de l'année ${annee.libelle}`,
      );
    return creneau;
  }

  async marquerPresent(body: Body, acteur: Acteur) {
    const { debut } = this.jour(body.date);
    const creneau = await this.creneauDuJour(body.creneauId, debut);
    const enseignantId = creneau.cours.enseignantId;
    if (!enseignantId)
      throw new BadRequestException(
        "Aucun enseignant n'est affecté à ce cours : affectez-en un dans la classe",
      );
    const existante = await this.prisma.seanceCours.findFirst({
      where: {
        coursId: creneau.coursId,
        date: debut,
        heureDebut: creneau.heureDebut,
      },
    });
    if (!existante)
      await this.prisma.$transaction([
        this.prisma.absenceEnseignant.deleteMany({
          where: {
            coursId: creneau.coursId,
            date: debut,
            heureDebut: creneau.heureDebut,
          },
        }),
        this.prisma.seanceCours.create({
          data: {
            coursId: creneau.coursId,
            date: debut,
            heureDebut: creneau.heureDebut,
            dureeMinutes:
              minutes(creneau.heureFin) - minutes(creneau.heureDebut),
            contenu: CAHIER_A_COMPLETER,
            enseignantId,
            saisieParId: acteur.id,
            saisieParNom: acteur.nom,
          },
        }),
      ]);
    return this.enseignants(debut.toISOString());
  }

  async marquerAbsent(body: Body, acteur: Acteur) {
    const { debut } = this.jour(body.date);
    const creneau = await this.creneauDuJour(body.creneauId, debut);
    const enseignantId = creneau.cours.enseignantId;
    if (!enseignantId)
      throw new BadRequestException(
        "Aucun enseignant n'est affecté à ce cours",
      );
    const seance = await this.prisma.seanceCours.findFirst({
      where: {
        coursId: creneau.coursId,
        date: debut,
        heureDebut: creneau.heureDebut,
      },
    });
    if (seance)
      throw new ConflictException(
        "Cette séance est émargée comme tenue : annulez d'abord la présence",
      );
    const justifiee = body.justifiee === true;
    const donnees = {
      enseignantId,
      dureeMinutes: minutes(creneau.heureFin) - minutes(creneau.heureDebut),
      justifiee,
      motif: justifiee
        ? texteRequis(body.motif, 'Le justificatif', 3, 300)
        : texteOptionnel(body.motif, 300),
      saisieParNom: acteur.nom,
    };
    await this.prisma.absenceEnseignant.upsert({
      where: {
        coursId_date_heureDebut: {
          coursId: creneau.coursId,
          date: debut,
          heureDebut: creneau.heureDebut,
        },
      },
      create: {
        ...donnees,
        coursId: creneau.coursId,
        date: debut,
        heureDebut: creneau.heureDebut,
      },
      update: donnees,
    });
    return this.enseignants(debut.toISOString());
  }

  // Remet un créneau à « à pointer ».
  async annulerEmargement(creneauId: string, rawDate: unknown) {
    const { debut } = this.jour(rawDate);
    const creneau = await this.creneauDuJour(creneauId, debut);
    const ou = {
      coursId: creneau.coursId,
      date: debut,
      heureDebut: creneau.heureDebut,
    };
    const seance = await this.prisma.seanceCours.findFirst({
      where: ou,
      include: { _count: { select: { absences: true } } },
    });
    if (seance) {
      // Un cahier de textes rempli ou un appel fait ne s'efface pas d'ici.
      if (seance.contenu !== CAHIER_A_COMPLETER || seance._count.absences)
        throw new ConflictException(
          "Le cahier de textes ou l'appel de cette séance est déjà rempli : supprimez-la depuis « Enseignement »",
        );
      if (seance.periodePaieId) {
        const paie = await this.prisma.periodePaie.findUnique({
          where: { id: seance.periodePaieId },
        });
        if (paie && paie.statut !== 'OUVERTE')
          throw new ConflictException(
            'Cette séance a déjà été payée à son enseignant',
          );
      }
      await this.prisma.seanceCours.delete({ where: { id: seance.id } });
    }
    await this.prisma.absenceEnseignant.deleteMany({ where: ou });
    return this.enseignants(debut.toISOString());
  }

  // Récapitulatif du mois par enseignant : séances tenues, heures, absences.
  async recapEnseignants(query: { annee?: string; mois?: string }) {
    const maintenant = new Date();
    const annee = parseEntier(
      query.annee ?? maintenant.getUTCFullYear(),
      "L'année",
      2020,
      2100,
    );
    const moisNumero = parseEntier(
      query.mois ?? maintenant.getUTCMonth() + 1,
      'Le mois',
      1,
      12,
    );
    const mois = bornesDuMois(annee, moisNumero);
    const duMois = { date: { gte: mois.debut, lte: mois.fin } };
    const enseignants = await this.prisma.employe.findMany({
      where: {
        OR: [
          { seances: { some: duMois } },
          { absencesCours: { some: duMois } },
        ],
      },
      select: {
        id: true,
        matricule: true,
        nom: true,
        prenom: true,
        seances: { where: duMois, select: { dureeMinutes: true } },
        absencesCours: {
          where: duMois,
          select: { dureeMinutes: true, justifiee: true },
        },
      },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });
    const heures = (liste: Array<{ dureeMinutes: number }>) =>
      Math.round(
        (liste.reduce((total, item) => total + item.dureeMinutes, 0) / 60) * 10,
      ) / 10;
    return {
      annee,
      mois: moisNumero,
      lignes: enseignants.map(({ seances, absencesCours, ...employe }) => ({
        employe,
        seances: seances.length,
        heuresFaites: heures(seances),
        absences: absencesCours.length,
        absencesInjustifiees: absencesCours.filter((item) => !item.justifiee)
          .length,
        heuresManquees: heures(absencesCours),
      })),
    };
  }
}
