import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Acteur } from '../common/acteur';
import {
  estDansLeFutur,
  parseDate,
  parseEntier,
  parseHeure,
  texteOptionnel,
  texteRequis,
} from '../common/saisie';
import { PrismaService } from '../prisma/prisma.service';
import { CAHIER_A_COMPLETER } from '../rh/rh.rules';
import { StructureService } from './structure.service';

type Body = Record<string, unknown>;
const JOURS = [
  'dimanche',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
];
type Absent = {
  inscriptionId: string;
  justifiee: boolean;
  motif: string | null;
};

// Séances tenues : appel des étudiants et cahier de textes.
@Injectable()
export class ScolariteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly structure: StructureService,
  ) {}

  // Les heures d'un mois dont la paie est validée sont figées : elles ont servi au calcul.
  private async refuserSiPaieValidee(
    date: Date,
    enseignantId: string | null,
    periodePaieId?: string | null,
  ) {
    if (!enseignantId) return;
    // Heures réglées par une paie validée, quel que soit le mois de la séance.
    if (periodePaieId) {
      const paie = await this.prisma.periodePaie.findUnique({
        where: { id: periodePaieId },
      });
      if (paie && paie.statut !== 'OUVERTE')
        throw new ConflictException(
          'Cette séance a été payée à son enseignant : elle ne peut plus être modifiée ni supprimée',
        );
    }
    const periode = await this.prisma.periodePaie.findUnique({
      where: {
        annee_mois: {
          annee: date.getUTCFullYear(),
          mois: date.getUTCMonth() + 1,
        },
      },
      include: { bulletins: { where: { employeId: enseignantId } } },
    });
    if (periode && periode.statut !== 'OUVERTE' && periode.bulletins.length)
      throw new ConflictException(
        'La paie de ce mois est validée pour cet enseignant : ses séances ne peuvent plus être ajoutées, modifiées ni supprimées',
      );
  }

  private async absents(body: Body, classeId: string): Promise<Absent[]> {
    if (!Array.isArray(body.absents)) return [];
    const absents = (body.absents as Body[]).map((item) => ({
      inscriptionId: texteRequis(item?.inscriptionId, "L'étudiant absent"),
      justifiee: item?.justifiee === true,
      motif: texteOptionnel(item?.motif, 200),
    }));
    const ids = [...new Set(absents.map((item) => item.inscriptionId))];
    const total = await this.prisma.inscription.count({
      where: { id: { in: ids }, classeId },
    });
    if (total !== ids.length)
      throw new BadRequestException(
        "Un étudiant marqué absent n'appartient pas à cette classe",
      );
    return ids.map(
      (id) => absents.find((item) => item.inscriptionId === id) as Absent,
    );
  }

  async createSeance(body: Body, acteur: Acteur) {
    const cours = await this.structure.exigerCours(
      texteRequis(body.coursId, 'Le cours'),
      acteur,
    );
    await this.structure.classeOuverte(cours.classeId);
    const date = parseDate(body.date, 'La date de la séance');
    if (estDansLeFutur(date))
      throw new BadRequestException(
        "Une séance ne se déclare qu'une fois tenue",
      );
    const annee = cours.classe.anneeAcademique;
    if (date < annee.dateDebut || date > annee.dateFin)
      throw new BadRequestException(
        `La date est en dehors de l'année ${annee.libelle}`,
      );
    const heureDebut = parseHeure(body.heureDebut, "L'heure de début");
    const dureeMinutes = parseEntier(body.dureeMinutes, 'La durée', 30, 480);
    // Une séance s'émarge sur un créneau de l'emploi du temps : même jour, même
    // heure. Seule une séance exceptionnelle (rattrapage) y échappe.
    const horsCreneau = body.horsCreneau === true;
    if (!horsCreneau) {
      const creneaux = await this.prisma.creneau.findMany({
        where: { coursId: cours.id },
        orderBy: [{ jour: 'asc' }, { heureDebut: 'asc' }],
      });
      const jour = date.getUTCDay();
      if (
        !creneaux.some(
          (creneau) =>
            creneau.jour === jour && creneau.heureDebut === heureDebut,
        )
      )
        throw new BadRequestException(
          `Ce cours n'a pas de créneau le ${JOURS[jour]} à ${heureDebut} (${
            creneaux.length
              ? `prévu : ${creneaux.map((creneau) => `${JOURS[creneau.jour]} ${creneau.heureDebut}`).join(', ')}`
              : "aucun créneau dans l'emploi du temps"
          }). Pour un rattrapage, déclarez une séance exceptionnelle.`,
        );
    }
    // Le cahier de textes est obligatoire : pas de séance sans contenu enseigné.
    const contenu = texteRequis(
      body.contenu,
      'Le contenu de la séance (cahier de textes)',
      5,
      2000,
    );
    const enseignantId =
      typeof body.enseignantId === 'string' && body.enseignantId
        ? body.enseignantId
        : cours.enseignantId;
    if (!enseignantId)
      throw new BadRequestException(
        "Aucun enseignant n'est affecté à ce cours : affectez-en un avant de déclarer une séance",
      );
    await this.refuserSiPaieValidee(date, enseignantId);
    const doublon = await this.prisma.seanceCours.findFirst({
      where: { coursId: cours.id, date, heureDebut },
    });
    const absents = await this.absents(body, cours.classeId);
    // Séance déjà émargée par la scolarité : la déclaration vient remplir son
    // cahier de textes et son appel, sans changer les heures émargées.
    if (doublon?.contenu === CAHIER_A_COMPLETER)
      return this.prisma.$transaction(async (transaction) => {
        await transaction.absenceEtudiant.deleteMany({
          where: { seanceId: doublon.id },
        });
        await transaction.absenceEtudiant.createMany({
          data: absents.map((absent) => ({ ...absent, seanceId: doublon.id })),
        });
        return transaction.seanceCours.update({
          where: { id: doublon.id },
          data: { contenu },
          include: { absences: true },
        });
      });
    if (doublon)
      throw new ConflictException(
        'Cette séance est déjà déclarée (même cours, même jour, même heure)',
      );
    // L'enseignant est venu : une absence notée sur ce créneau n'a plus lieu d'être.
    await this.prisma.absenceEnseignant.deleteMany({
      where: { coursId: cours.id, date, heureDebut },
    });
    return this.prisma.seanceCours.create({
      data: {
        coursId: cours.id,
        date,
        heureDebut,
        dureeMinutes,
        contenu,
        horsCreneau,
        enseignantId,
        saisieParId: acteur.id,
        saisieParNom: acteur.nom,
        absences: { create: absents },
      },
      include: { absences: true },
    });
  }

  private async seanceModifiable(id: string, acteur: Acteur) {
    const seance = await this.prisma.seanceCours.findUnique({ where: { id } });
    if (!seance) throw new NotFoundException('Séance introuvable');
    const cours = await this.structure.exigerCours(seance.coursId, acteur);
    await this.structure.classeOuverte(cours.classeId);
    await this.refuserSiPaieValidee(
      seance.date,
      seance.enseignantId,
      seance.periodePaieId,
    );
    return { seance, cours };
  }

  async updateSeance(id: string, body: Body, acteur: Acteur) {
    const { cours } = await this.seanceModifiable(id, acteur);
    const data: Record<string, unknown> = {};
    if (body.contenu !== undefined)
      data.contenu = texteRequis(
        body.contenu,
        'Le contenu de la séance (cahier de textes)',
        5,
        2000,
      );
    if (body.dureeMinutes !== undefined)
      data.dureeMinutes = parseEntier(body.dureeMinutes, 'La durée', 30, 480);
    const absents =
      body.absents !== undefined
        ? await this.absents(body, cours.classeId)
        : null;
    return this.prisma.$transaction(async (transaction) => {
      if (absents) {
        await transaction.absenceEtudiant.deleteMany({
          where: { seanceId: id },
        });
        await transaction.absenceEtudiant.createMany({
          data: absents.map((absent) => ({ ...absent, seanceId: id })),
        });
      }
      return transaction.seanceCours.update({
        where: { id },
        data,
        include: { absences: true },
      });
    });
  }

  async removeSeance(id: string, acteur: Acteur) {
    await this.seanceModifiable(id, acteur);
    await this.prisma.seanceCours.delete({ where: { id } });
    return { supprime: true };
  }

  async seances(
    query: { coursId?: string; classeId?: string; du?: string; au?: string },
    acteur: Acteur,
  ) {
    const restreint = await this.structure.enseignantRestreint(acteur);
    const du = new Date(query.du ?? '');
    const au = new Date(query.au ?? '');
    if (!query.coursId && !query.classeId && !restreint) return [];
    return this.prisma.seanceCours.findMany({
      where: {
        ...(query.coursId ? { coursId: query.coursId } : {}),
        cours: {
          ...(query.classeId ? { classeId: query.classeId } : {}),
          ...(restreint ? { enseignantId: restreint } : {}),
        },
        ...(!Number.isNaN(du.getTime()) || !Number.isNaN(au.getTime())
          ? {
              date: {
                ...(!Number.isNaN(du.getTime()) ? { gte: du } : {}),
                ...(!Number.isNaN(au.getTime()) ? { lte: au } : {}),
              },
            }
          : {}),
      },
      include: {
        absences: {
          include: { inscription: { include: { personne: true } } },
        },
        enseignant: { select: { id: true, nom: true, prenom: true } },
        cours: { include: { matiere: true } },
      },
      orderBy: [{ date: 'desc' }, { heureDebut: 'desc' }],
      take: 300,
    });
  }

  // Une absence peut être justifiée après coup, sur présentation d'un justificatif.
  async justifier(id: string, body: Body, acteur: Acteur) {
    const absence = await this.prisma.absenceEtudiant.findUnique({
      where: { id },
      include: { seance: true },
    });
    if (!absence) throw new NotFoundException('Absence introuvable');
    const cours = await this.structure.exigerCours(
      absence.seance.coursId,
      acteur,
    );
    await this.structure.classeOuverte(cours.classeId);
    const justifiee = body.justifiee === true;
    return this.prisma.absenceEtudiant.update({
      where: { id },
      data: {
        justifiee,
        motif: justifiee
          ? texteRequis(body.motif, 'Le motif de la justification', 3, 200)
          : null,
      },
    });
  }

  // Assiduité de chaque étudiant d'une classe : heures manquées face aux heures tenues.
  async assiduite(classeId: string) {
    const [classe, regles] = await Promise.all([
      this.structure.classe(classeId),
      this.structure.regles(),
    ]);
    const seances = await this.prisma.seanceCours.findMany({
      where: { cours: { classeId } },
      select: {
        dureeMinutes: true,
        absences: { select: { inscriptionId: true, justifiee: true } },
      },
    });
    const tenues = seances.reduce(
      (total, seance) => total + seance.dureeMinutes,
      0,
    );
    const parEtudiant = new Map<
      string,
      { total: number; injustifiees: number }
    >();
    for (const seance of seances)
      for (const absence of seance.absences) {
        const cumul = parEtudiant.get(absence.inscriptionId) ?? {
          total: 0,
          injustifiees: 0,
        };
        cumul.total += seance.dureeMinutes;
        if (!absence.justifiee) cumul.injustifiees += seance.dureeMinutes;
        parEtudiant.set(absence.inscriptionId, cumul);
      }
    const heures = (value: number) => Math.round((value / 60) * 10) / 10;
    return {
      classe: { id: classe.id, nom: classe.nom },
      heuresTenues: heures(tenues),
      seuil: regles.seuilAbsences,
      etudiants: classe.inscriptions.map((inscription) => {
        const cumul = parEtudiant.get(inscription.id) ?? {
          total: 0,
          injustifiees: 0,
        };
        const taux =
          tenues > 0
            ? Math.round((cumul.injustifiees / tenues) * 1000) / 10
            : 0;
        return {
          inscriptionId: inscription.id,
          personne: inscription.personne,
          statut: inscription.statut,
          heuresAbsence: heures(cumul.total),
          heuresInjustifiees: heures(cumul.injustifiees),
          taux,
          // Signalé au jury et à la scolarité dès que le seuil est atteint.
          alerte: regles.seuilAbsences > 0 && taux >= regles.seuilAbsences,
        };
      }),
    };
  }
}
