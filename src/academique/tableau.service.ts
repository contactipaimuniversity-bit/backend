import { Injectable } from '@nestjs/common';
import { minutes } from '../common/saisie';
import { PrismaService } from '../prisma/prisma.service';
import { StructureService } from './structure.service';

const JOUR_MS = 24 * 60 * 60 * 1000;

// Tableau de bord académique : ce qui demande une action aujourd'hui.
@Injectable()
export class TableauAcademiqueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly structure: StructureService,
  ) {}

  async aujourdhui() {
    const annee = await this.structure.anneeCourante();
    const maintenant = new Date();
    const debut = new Date(
      Date.UTC(
        maintenant.getUTCFullYear(),
        maintenant.getUTCMonth(),
        maintenant.getUTCDate(),
      ),
    );
    const fin = new Date(debut.getTime() + JOUR_MS - 1);
    const dansSeptJours = new Date(debut.getTime() + 8 * JOUR_MS - 1);
    if (!annee)
      return { annee: null, date: debut, cours: null, evaluations: null };
    const deLAnnee = { classe: { anneeAcademiqueId: annee.id } };
    const duJour = { date: { gte: debut, lte: fin } };
    const [
      regles,
      creneaux,
      seances,
      absencesEnseignants,
      evaluations,
      classes,
      coursSansEnseignant,
      inscriptionsSansClasse,
      seancesAnnee,
    ] = await Promise.all([
      this.structure.regles(),
      this.prisma.creneau.findMany({
        where: { jour: debut.getUTCDay(), cours: deLAnnee },
        include: {
          cours: {
            include: {
              matiere: { select: { nom: true } },
              enseignant: { select: { nom: true, prenom: true } },
              classe: { include: { filiere: true } },
            },
          },
        },
        orderBy: { heureDebut: 'asc' },
      }),
      this.prisma.seanceCours.findMany({
        where: { ...duJour, cours: deLAnnee },
        select: { coursId: true, heureDebut: true },
      }),
      this.prisma.absenceEnseignant.findMany({
        where: { ...duJour, cours: deLAnnee },
        select: { coursId: true, heureDebut: true },
      }),
      this.prisma.evaluation.findMany({
        where: { statut: 'OUVERTE', cours: deLAnnee },
        include: {
          notes: { select: { valeur: true, absent: true } },
          cours: {
            include: {
              matiere: { select: { nom: true } },
              classe: {
                include: {
                  filiere: true,
                  _count: {
                    select: {
                      inscriptions: {
                        where: { statut: { not: 'ABANDONNEE' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ date: 'asc' }, { libelle: 'asc' }],
      }),
      this.prisma.classe.findMany({
        where: { anneeAcademiqueId: annee.id },
        include: {
          filiere: true,
          inscriptions: {
            where: { statut: { not: 'ABANDONNEE' } },
            select: {
              id: true,
              personne: { select: { id: true, nom: true, prenom: true } },
            },
          },
          _count: { select: { cours: { where: { creneaux: { some: {} } } } } },
        },
      }),
      this.prisma.cours.count({ where: { ...deLAnnee, enseignantId: null } }),
      this.prisma.inscription.count({
        where: {
          anneeScolaire: annee.libelle,
          classeId: null,
          statut: { not: 'ABANDONNEE' },
        },
      }),
      this.prisma.seanceCours.findMany({
        where: { cours: deLAnnee },
        select: {
          dureeMinutes: true,
          cours: { select: { classeId: true } },
          absences: {
            where: { justifiee: false },
            select: { inscriptionId: true },
          },
        },
      }),
    ]);

    const cle = (item: { coursId: string; heureDebut: string }) =>
      `${item.coursId}@${item.heureDebut}`;
    const tenues = new Set(seances.map(cle));
    const manquees = new Set(absencesEnseignants.map(cle));
    const lignes = creneaux.map((creneau) => ({
      creneauId: creneau.id,
      heureDebut: creneau.heureDebut,
      heureFin: creneau.heureFin,
      dureeMinutes: minutes(creneau.heureFin) - minutes(creneau.heureDebut),
      classe: this.structure.nomClasse(creneau.cours.classe),
      matiere: creneau.cours.matiere.nom,
      enseignant: creneau.cours.enseignant,
      etat: tenues.has(cle(creneau))
        ? 'PRESENT'
        : manquees.has(cle(creneau))
          ? 'ABSENT'
          : 'A_POINTER',
    }));
    const compter = (etat: string) =>
      lignes.filter((ligne) => ligne.etat === etat).length;

    const epreuves = evaluations.map((evaluation) => {
      const effectif = evaluation.cours.classe._count.inscriptions;
      const saisies = evaluation.notes.filter(
        (note) => note.absent || note.valeur !== null,
      ).length;
      return {
        id: evaluation.id,
        coursId: evaluation.coursId,
        libelle: evaluation.libelle,
        type: evaluation.type,
        date: evaluation.date,
        heureDebut: evaluation.heureDebut,
        matiere: evaluation.cours.matiere.nom,
        classe: this.structure.nomClasse(evaluation.cours.classe),
        anonyme: evaluation.anonyme,
        saisies,
        effectif,
        complete: effectif > 0 && saisies >= effectif,
      };
    });
    const passee = (date: Date | null) => date !== null && date < debut;
    const proche = (date: Date | null) =>
      date !== null && date >= debut && date <= dansSeptJours;

    // Étudiants au-delà du seuil d'absences non justifiées, classe par classe.
    const tenuesParClasse = new Map<string, number>();
    const manqueesParEtudiant = new Map<string, number>();
    for (const seance of seancesAnnee) {
      const classeId = seance.cours.classeId;
      tenuesParClasse.set(
        classeId,
        (tenuesParClasse.get(classeId) ?? 0) + seance.dureeMinutes,
      );
      for (const absence of seance.absences)
        manqueesParEtudiant.set(
          absence.inscriptionId,
          (manqueesParEtudiant.get(absence.inscriptionId) ?? 0) +
            seance.dureeMinutes,
        );
    }
    const alertes = classes
      .flatMap((classe) => {
        const total = tenuesParClasse.get(classe.id) ?? 0;
        if (!total) return [];
        return classe.inscriptions.flatMap((inscription) => {
          const taux =
            Math.round(
              ((manqueesParEtudiant.get(inscription.id) ?? 0) / total) * 1000,
            ) / 10;
          return taux >= regles.seuilAbsences
            ? [
                {
                  personne: inscription.personne,
                  classeId: classe.id,
                  classe: this.structure.nomClasse(classe),
                  taux,
                },
              ]
            : [];
        });
      })
      .sort((a, b) => b.taux - a.taux);

    return {
      annee: { id: annee.id, libelle: annee.libelle },
      date: debut,
      cours: {
        total: lignes.length,
        emarges: compter('PRESENT'),
        absents: compter('ABSENT'),
        aPointer: compter('A_POINTER'),
        lignes,
      },
      evaluations: {
        // Toutes les notes sont saisies : il ne manque que la validation.
        aValider: epreuves.filter((item) => item.complete),
        // L'épreuve est passée et des notes manquent encore.
        enRetard: epreuves.filter(
          (item) => !item.complete && passee(item.date),
        ),
        prochaines: epreuves.filter((item) => proche(item.date)),
        // Anonymat obligatoire : épreuves proches dont les fiches ne sont pas prêtes.
        fichesAGenerer: regles.anonymatObligatoire
          ? epreuves.filter((item) => !item.anonyme && proche(item.date))
          : [],
      },
      assiduite: {
        seuil: regles.seuilAbsences,
        total: alertes.length,
        etudiants: alertes.slice(0, 10),
      },
      aCompleter: {
        coursSansEnseignant,
        classesSansEmploiDuTemps: classes
          .filter((classe) => classe._count.cours === 0)
          .map((classe) => ({
            id: classe.id,
            nom: this.structure.nomClasse(classe),
          })),
        inscriptionsSansClasse,
      },
    };
  }
}
