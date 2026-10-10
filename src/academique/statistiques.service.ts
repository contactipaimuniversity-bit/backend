import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { arrondi } from './academique.rules';
import { StructureService } from './structure.service';

const pourcentage = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : null;

// Indicateurs académiques d'une année : effectifs, réussite, assiduité, encadrement.
@Injectable()
export class StatistiquesAcademiquesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly structure: StructureService,
  ) {}

  async synthese(anneeId?: string) {
    const [{ annee, classes }, annees] = await Promise.all([
      this.structure.classes(anneeId),
      this.structure.annees(),
    ]);
    // Évolution des effectifs sur toutes les années connues des inscriptions.
    const parAnnee = await this.prisma.inscription.groupBy({
      by: ['anneeScolaire'],
      _count: { _all: true },
      orderBy: { anneeScolaire: 'asc' },
    });
    const evolution = parAnnee.map((item) => ({
      annee: item.anneeScolaire,
      inscrits: item._count._all,
    }));
    if (!annee) return { annee: null, annees, evolution };

    const inscriptions = await this.prisma.inscription.findMany({
      where: { anneeScolaire: annee.libelle },
      select: {
        statut: true,
        niveau: true,
        filiere: true,
        viaBourse: true,
        classeId: true,
        personne: { select: { sexe: true } },
        classe: { select: { filiere: { select: { nom: true } } } },
      },
    });
    const actifs = inscriptions.filter(
      (inscription) => inscription.statut !== 'ABANDONNEE',
    );
    const repartition = <T>(liste: T[], cle: (item: T) => string) => {
      const totaux = new Map<string, number>();
      for (const item of liste)
        totaux.set(cle(item), (totaux.get(cle(item)) ?? 0) + 1);
      return [...totaux.entries()]
        .map(([libelle, total]) => ({ libelle, total }))
        .sort((a, b) => b.total - a.total);
    };

    // Réussite : uniquement à partir des délibérations clôturées.
    const deliberations = await this.prisma.deliberation.findMany({
      where: {
        statut: 'CLOTUREE',
        classeId: { in: classes.map((classe) => classe.id) },
      },
      include: { resultats: { select: { decision: true, moyenne: true } } },
    });
    const reussite = classes.map((classe) => {
      const ligne = (semestre: number) => {
        const deliberation = deliberations.find(
          (item) => item.classeId === classe.id && item.semestre === semestre,
        );
        if (!deliberation) return null;
        const moyennes = deliberation.resultats
          .map((resultat) => resultat.moyenne)
          .filter((value) => value !== null)
          .map(Number);
        const reussis = deliberation.resultats.filter((resultat) =>
          ['VALIDE', 'ADMIS', 'ADMIS_AVEC_DETTES'].includes(resultat.decision),
        ).length;
        return {
          effectif: deliberation.resultats.length,
          reussis,
          taux: pourcentage(reussis, deliberation.resultats.length),
          moyenne: moyennes.length
            ? arrondi(
                moyennes.reduce((total, value) => total + value, 0) /
                  moyennes.length,
              )
            : null,
          admisAvecDettes: deliberation.resultats.filter(
            (resultat) => resultat.decision === 'ADMIS_AVEC_DETTES',
          ).length,
          ajournes: deliberation.resultats.filter((resultat) =>
            ['AJOURNE', 'NON_VALIDE'].includes(resultat.decision),
          ).length,
        };
      };
      return {
        classeId: classe.id,
        classe: classe.nom,
        filiere: classe.filiere.nom,
        niveau: classe.niveau,
        effectif: classe.effectif,
        semestre1: ligne(1),
        semestre2: ligne(2),
        annuel: ligne(0),
      };
    });

    // Assiduité et avancement des programmes.
    const cours = await this.prisma.cours.findMany({
      where: {
        classeId: { in: classes.map((classe) => classe.id) },
        matiere: { actif: true },
      },
      select: {
        classeId: true,
        enseignantId: true,
        matiere: { select: { volumeHoraire: true } },
        seances: {
          select: {
            dureeMinutes: true,
            absences: { select: { justifiee: true } },
          },
        },
      },
    });
    const effectifs = new Map(
      classes.map((classe) => [classe.id, classe.effectif]),
    );
    let minutesTenues = 0;
    let minutesEtudiants = 0;
    let minutesAbsence = 0;
    let minutesInjustifiees = 0;
    for (const item of cours)
      for (const seance of item.seances) {
        minutesTenues += seance.dureeMinutes;
        minutesEtudiants +=
          seance.dureeMinutes * (effectifs.get(item.classeId) ?? 0);
        minutesAbsence += seance.dureeMinutes * seance.absences.length;
        minutesInjustifiees +=
          seance.dureeMinutes *
          seance.absences.filter((absence) => !absence.justifiee).length;
      }
    const heuresPrevues = cours.reduce(
      (total, item) => total + item.matiere.volumeHoraire,
      0,
    );
    const enseignants = new Set(
      cours.map((item) => item.enseignantId).filter(Boolean),
    );

    return {
      annee,
      annees,
      evolution,
      effectifs: {
        inscrits: inscriptions.length,
        actifs: actifs.length,
        abandons: inscriptions.length - actifs.length,
        tauxAbandon: pourcentage(
          inscriptions.length - actifs.length,
          inscriptions.length,
        ),
        boursiers: actifs.filter((inscription) => inscription.viaBourse).length,
        enClasse: actifs.filter((inscription) => inscription.classeId).length,
        sansClasse: actifs.filter((inscription) => !inscription.classeId)
          .length,
        parNiveau: repartition(actifs, (inscription) => inscription.niveau),
        // La filière de la classe fait foi ; à défaut, celle saisie à l'inscription.
        parFiliere: repartition(
          actifs,
          (inscription) =>
            inscription.classe?.filiere.nom ?? inscription.filiere.trim(),
        ),
        parSexe: repartition(actifs, (inscription) =>
          inscription.personne.sexe === 'F'
            ? 'Femmes'
            : inscription.personne.sexe === 'M'
              ? 'Hommes'
              : 'Non renseigné',
        ),
      },
      reussite,
      assiduite: {
        heuresTenues: Math.round(minutesTenues / 60),
        tauxAbsence: pourcentage(minutesAbsence, minutesEtudiants),
        tauxAbsenceInjustifiee: pourcentage(
          minutesInjustifiees,
          minutesEtudiants,
        ),
      },
      enseignement: {
        cours: cours.length,
        coursSansEnseignant: cours.filter((item) => !item.enseignantId).length,
        enseignants: enseignants.size,
        etudiantsParEnseignant: enseignants.size
          ? Math.round((actifs.length / enseignants.size) * 10) / 10
          : null,
        heuresPrevues,
        heuresFaites: Math.round(minutesTenues / 60),
        avancement: pourcentage(minutesTenues / 60, heuresPrevues),
      },
    };
  }
}
