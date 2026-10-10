import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { Acteur } from '../common/acteur';
import { texteOptionnel, texteRequis } from '../common/saisie';
import { InscriptionsService } from '../inscriptions/inscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  arrondi,
  classer,
  mention,
  NIVEAUX,
  resultatAnnuel,
  resultatMatiere,
  resultatSemestre,
  resultatUE,
} from './academique.rules';
import { StructureService } from './structure.service';

type Body = Record<string, unknown>;

type Ligne = {
  inscriptionId: string;
  personne: {
    nom: string;
    prenom: string;
    matricule: string | null;
    sexe?: string | null;
  };
  moyenne: number | null;
  creditsAcquis: number;
  creditsTotal: number;
  rang: number | null;
  mention: string | null;
  decision: string;
  detail: Record<string, unknown>;
};

const DERNIER_NIVEAU = NIVEAUX[NIVEAUX.length - 1];

// Résultats d'une classe, délibérations, bulletins et passage en année supérieure.
@Injectable()
export class DeliberationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly structure: StructureService,
    private readonly inscriptions: InscriptionsService,
  ) {}

  private verifierSemestre(value: string | number): number {
    const semestre = Number(value);
    if (![0, 1, 2].includes(semestre))
      throw new BadRequestException(
        'Semestre attendu : 1, 2 ou 0 pour la délibération annuelle',
      );
    return semestre;
  }

  private etudiants(classeId: string) {
    return this.prisma.inscription.findMany({
      where: { classeId, statut: { not: 'ABANDONNEE' } },
      include: { personne: true },
      orderBy: [{ personne: { nom: 'asc' } }, { personne: { prenom: 'asc' } }],
    });
  }

  // Semestres qui portent réellement des matières dans la maquette de la classe.
  private async semestresActifs(classeId: string): Promise<number[]> {
    await this.structure.synchroniserCours(classeId);
    const cours = await this.prisma.cours.findMany({
      where: { classeId, matiere: { actif: true } },
      select: { matiere: { select: { ue: { select: { semestre: true } } } } },
    });
    return [...new Set(cours.map((item) => item.matiere.ue.semestre))].sort();
  }

  // ---------- Calcul ----------

  private async calculSemestre(classeId: string, semestre: number) {
    await this.structure.synchroniserCours(classeId);
    const [regles, etudiants, cours] = await Promise.all([
      this.structure.regles(),
      this.etudiants(classeId),
      this.prisma.cours.findMany({
        where: { classeId, matiere: { actif: true, ue: { semestre } } },
        include: {
          matiere: { include: { ue: true } },
          evaluations: { include: { notes: true } },
        },
        orderBy: [
          { matiere: { ue: { ordre: 'asc' } } },
          { matiere: { ue: { code: 'asc' } } },
          { matiere: { code: 'asc' } },
        ],
      }),
    ]);
    const problemes: string[] = [];
    if (!cours.length)
      problemes.push(
        `Aucune matière au semestre ${semestre} dans la maquette de cette classe`,
      );
    if (!etudiants.length) problemes.push('Aucun étudiant dans cette classe');
    for (const item of cours) {
      if (!item.evaluations.length)
        problemes.push(`${item.matiere.nom} : aucune évaluation`);
      for (const evaluation of item.evaluations)
        if (evaluation.statut !== 'VALIDEE')
          problemes.push(
            `${item.matiere.nom} : « ${evaluation.libelle} » n'est pas validée`,
          );
    }
    const unites = [
      ...new Map(
        cours.map((item) => [item.matiere.ueId, item.matiere.ue]),
      ).values(),
    ];

    const lignes = etudiants.map((inscription) => {
      const detailUnites = unites.map((unite) => {
        const matieres = cours
          .filter((item) => item.matiere.ueId === unite.id)
          .map((item) => {
            const resultat = resultatMatiere(
              item.evaluations.map((evaluation) => {
                const note = evaluation.notes.find(
                  (candidate) => candidate.inscriptionId === inscription.id,
                );
                return {
                  type: evaluation.type,
                  bareme: Number(evaluation.bareme),
                  valeur: note?.valeur == null ? null : Number(note.valeur),
                  absent: note?.absent ?? false,
                };
              }),
              regles,
            );
            return {
              code: item.matiere.code,
              nom: item.matiere.nom,
              coefficient: Number(item.matiere.coefficient),
              ...resultat,
            };
          });
        return {
          code: unite.code,
          nom: unite.nom,
          credits: unite.credits,
          ...resultatUE(matieres, regles),
          matieres,
        };
      });
      const bilan = resultatSemestre(detailUnites, regles);
      return {
        inscriptionId: inscription.id,
        personne: inscription.personne,
        moyenne: bilan.moyenne,
        creditsAcquis: bilan.creditsAcquis,
        creditsTotal: bilan.creditsTotal,
        mention: bilan.valide
          ? mention(bilan.moyenne, regles.moyenneValidation)
          : null,
        decision: !bilan.complet
          ? 'INCOMPLET'
          : bilan.valide
            ? 'VALIDE'
            : 'NON_VALIDE',
        detail: { unites: detailUnites, eliminatoire: bilan.eliminatoire },
      };
    });
    const incomplets = lignes.filter((ligne) => ligne.decision === 'INCOMPLET');
    if (incomplets.length && cours.length)
      problemes.push(`Notes incomplètes pour ${incomplets.length} étudiant(s)`);
    return { problemes, lignes: classer(lignes) as Ligne[] };
  }

  private async calculAnnuel(classeId: string, niveau: string) {
    const [regles, etudiants, actifs, deliberations] = await Promise.all([
      this.structure.regles(),
      this.etudiants(classeId),
      this.semestresActifs(classeId),
      this.prisma.deliberation.findMany({
        where: { classeId, semestre: { in: [1, 2] }, statut: 'CLOTUREE' },
        include: { resultats: true },
      }),
    ]);
    const problemes: string[] = [];
    if (!actifs.length)
      problemes.push('Aucune matière dans la maquette de cette classe');
    for (const semestre of actifs)
      if (!deliberations.some((item) => item.semestre === semestre))
        problemes.push(
          `La délibération du semestre ${semestre} n'est pas clôturée`,
        );
    const lignes = etudiants.map((inscription) => {
      const semestres = actifs.map((semestre) => {
        const deliberation = deliberations.find(
          (item) => item.semestre === semestre,
        );
        const resultat = deliberation?.resultats.find(
          (item) => item.inscriptionId === inscription.id,
        );
        // Étudiant absent d'une délibération : aucun crédit pour ce semestre.
        const creditsTotal =
          resultat?.creditsTotal ??
          deliberation?.resultats[0]?.creditsTotal ??
          0;
        return {
          semestre,
          moyenne: resultat?.moyenne == null ? null : Number(resultat.moyenne),
          creditsAcquis: resultat?.creditsAcquis ?? 0,
          creditsTotal,
          decision: resultat?.decision ?? 'NON_DELIBERE',
          eliminatoire:
            (resultat?.detail as { eliminatoire?: boolean } | undefined)
              ?.eliminatoire === true,
        };
      });
      const bilan = resultatAnnuel(
        semestres,
        regles,
        niveau === DERNIER_NIVEAU,
      );
      return {
        inscriptionId: inscription.id,
        personne: inscription.personne,
        moyenne: bilan.moyenne,
        creditsAcquis: bilan.creditsAcquis,
        creditsTotal: bilan.creditsTotal,
        mention:
          bilan.decision === 'ADMIS'
            ? mention(bilan.moyenne, regles.moyenneValidation)
            : null,
        decision: bilan.decision,
        detail: { semestres },
      };
    });
    return { problemes, lignes: classer(lignes) as Ligne[] };
  }

  private synthese(lignes: Ligne[]) {
    const moyennes = lignes
      .map((ligne) => ligne.moyenne)
      .filter((value): value is number => value !== null);
    const reussis = lignes.filter((ligne) =>
      ['VALIDE', 'ADMIS', 'ADMIS_AVEC_DETTES'].includes(ligne.decision),
    ).length;
    return {
      effectif: lignes.length,
      reussis,
      taux: lignes.length ? Math.round((reussis / lignes.length) * 100) : null,
      moyenneClasse: moyennes.length
        ? arrondi(
            moyennes.reduce((total, value) => total + value, 0) /
              moyennes.length,
          )
        : null,
      plusForte: moyennes.length ? Math.max(...moyennes) : null,
      plusFaible: moyennes.length ? Math.min(...moyennes) : null,
    };
  }

  // ---------- Lecture ----------

  async tableau(anneeId?: string) {
    const { annee, classes } = await this.structure.classes(anneeId);
    return {
      annee,
      annees: await this.structure.annees(),
      classes: await Promise.all(
        classes.map(async (classe) => ({
          id: classe.id,
          nom: classe.nom,
          niveau: classe.niveau,
          filiere: classe.filiere.nom,
          effectif: classe.effectif,
          semestres: await this.semestresActifs(classe.id),
          deliberations: classe.deliberations,
        })),
      ),
    };
  }

  async resultats(classeId: string, rawSemestre: string | number) {
    const semestre = this.verifierSemestre(rawSemestre);
    const classe = await this.structure.classe(classeId);
    const deliberation = await this.prisma.deliberation.findUnique({
      where: { classeId_semestre: { classeId, semestre } },
      include: {
        resultats: {
          include: { inscription: { include: { personne: true } } },
          orderBy: [{ rang: 'asc' }],
        },
      },
    });
    const entete = {
      classe: {
        id: classe.id,
        nom: classe.nom,
        niveau: classe.niveau,
        filiere: classe.filiere.nom,
        annee: classe.anneeAcademique.libelle,
        anneeCloturee: classe.anneeAcademique.statut === 'CLOTUREE',
      },
      semestre,
    };
    if (deliberation?.statut === 'CLOTUREE') {
      // Résultats figés : ils ne bougent plus, même si la maquette change.
      const lignes: Ligne[] = deliberation.resultats.map((resultat) => ({
        inscriptionId: resultat.inscriptionId,
        personne: resultat.inscription.personne,
        moyenne: resultat.moyenne === null ? null : Number(resultat.moyenne),
        creditsAcquis: resultat.creditsAcquis,
        creditsTotal: resultat.creditsTotal,
        rang: resultat.rang,
        mention: resultat.mention,
        decision: resultat.decision,
        detail: resultat.detail as Record<string, unknown>,
      }));
      return {
        ...entete,
        statut: 'CLOTUREE',
        deliberation: { ...deliberation, resultats: undefined },
        problemes: [],
        resultats: lignes,
        synthese: this.synthese(lignes),
      };
    }
    const { problemes, lignes } =
      semestre === 0
        ? await this.calculAnnuel(classeId, classe.niveau)
        : await this.calculSemestre(classeId, semestre);
    return {
      ...entete,
      statut: 'OUVERTE',
      deliberation: null,
      problemes,
      resultats: lignes,
      synthese: this.synthese(lignes),
    };
  }

  // ---------- Décisions ----------

  async cloturer(
    classeId: string,
    rawSemestre: string | number,
    body: Body,
    acteur: Acteur,
  ) {
    const semestre = this.verifierSemestre(rawSemestre);
    const classe = await this.structure.classeOuverte(classeId);
    const existante = await this.prisma.deliberation.findUnique({
      where: { classeId_semestre: { classeId, semestre } },
    });
    if (existante?.statut === 'CLOTUREE')
      throw new ConflictException('Cette délibération est déjà clôturée');
    const president = texteRequis(
      body.president,
      'Le président du jury',
      3,
      160,
    );
    const { problemes, lignes } =
      semestre === 0
        ? await this.calculAnnuel(classeId, classe.niveau)
        : await this.calculSemestre(classeId, semestre);
    // On ne délibère que sur des résultats complets et des notes verrouillées.
    if (problemes.length)
      throw new ConflictException(
        `Délibération impossible : ${problemes.slice(0, 6).join(' · ')}${problemes.length > 6 ? ` · et ${problemes.length - 6} autre(s)` : ''}`,
      );
    const meta = {
      statut: 'CLOTUREE',
      president,
      membres: texteOptionnel(body.membres, 600),
      observations: texteOptionnel(body.observations, 1000),
      clotureParId: acteur.id,
      clotureParNom: acteur.nom,
      dateCloture: new Date(),
    };
    await this.prisma.$transaction(async (transaction) => {
      const deliberation = await transaction.deliberation.upsert({
        where: { classeId_semestre: { classeId, semestre } },
        create: { classeId, semestre, ouverteParNom: acteur.nom, ...meta },
        update: meta,
      });
      await transaction.resultatDeliberation.deleteMany({
        where: { deliberationId: deliberation.id },
      });
      await transaction.resultatDeliberation.createMany({
        data: lignes.map((ligne) => ({
          deliberationId: deliberation.id,
          inscriptionId: ligne.inscriptionId,
          moyenne: ligne.moyenne,
          creditsAcquis: ligne.creditsAcquis,
          creditsTotal: ligne.creditsTotal,
          rang: ligne.rang,
          mention: ligne.mention,
          decision: ligne.decision,
          detail: ligne.detail as Prisma.InputJsonObject,
        })),
      });
    });
    return this.resultats(classeId, semestre);
  }

  async rouvrir(classeId: string, rawSemestre: string | number, body: Body) {
    const semestre = this.verifierSemestre(rawSemestre);
    await this.structure.classeOuverte(classeId);
    // Le motif est conservé dans le journal d'audit.
    texteRequis(body.motif, 'Le motif de la réouverture', 10, 500);
    const deliberations = await this.prisma.deliberation.findMany({
      where: { classeId },
    });
    const cible = deliberations.find((item) => item.semestre === semestre);
    if (cible?.statut !== 'CLOTUREE')
      throw new ConflictException("Cette délibération n'est pas clôturée");
    if (
      semestre !== 0 &&
      deliberations.some(
        (item) => item.semestre === 0 && item.statut === 'CLOTUREE',
      )
    )
      throw new ConflictException(
        "La délibération annuelle s'appuie sur ce semestre : rouvrez-la d'abord",
      );
    await this.prisma.$transaction([
      this.prisma.resultatDeliberation.deleteMany({
        where: { deliberationId: cible.id },
      }),
      this.prisma.deliberation.update({
        where: { id: cible.id },
        data: {
          statut: 'OUVERTE',
          clotureParId: null,
          clotureParNom: null,
          dateCloture: null,
        },
      }),
    ]);
    return this.resultats(classeId, semestre);
  }

  // ---------- Bulletins ----------

  // Raison pour laquelle le bulletin est retenu, ou null.
  private async retenue(inscriptionId: string): Promise<string | null> {
    const regles = await this.structure.regles();
    if (!regles.blocageImpayes) return null;
    const finance = await this.inscriptions.findFinance(inscriptionId);
    const reste = finance.obligations.reduce(
      (total, obligation) => total + Number(obligation.resteAPayer),
      0,
    );
    return reste > 0
      ? `Bulletin retenu : ${reste.toLocaleString('fr-FR')} F restent à payer sur la scolarité`
      : null;
  }

  private async absencesDuSemestre(inscriptionId: string, semestre: number) {
    const absences = await this.prisma.absenceEtudiant.findMany({
      where: {
        inscriptionId,
        ...(semestre
          ? { seance: { cours: { matiere: { ue: { semestre } } } } }
          : {}),
      },
      select: { justifiee: true, seance: { select: { dureeMinutes: true } } },
    });
    const heures = (liste: typeof absences) =>
      Math.round(
        (liste.reduce((total, item) => total + item.seance.dureeMinutes, 0) /
          60) *
          10,
      ) / 10;
    return {
      total: heures(absences),
      injustifiees: heures(absences.filter((item) => !item.justifiee)),
    };
  }

  async bulletin(inscriptionId: string, rawSemestre: string | number) {
    const semestre = this.verifierSemestre(rawSemestre);
    const inscription = await this.prisma.inscription.findUnique({
      where: { id: inscriptionId },
      include: {
        personne: true,
        classe: { include: { filiere: true, anneeAcademique: true } },
      },
    });
    if (!inscription?.classe)
      throw new NotFoundException("Cet étudiant n'est affecté à aucune classe");
    const deliberation = await this.prisma.deliberation.findUnique({
      where: {
        classeId_semestre: { classeId: inscription.classe.id, semestre },
      },
      include: { resultats: true },
    });
    if (deliberation?.statut !== 'CLOTUREE')
      throw new ConflictException(
        "Le bulletin n'est disponible qu'après clôture de la délibération",
      );
    const resultat = deliberation.resultats.find(
      (item) => item.inscriptionId === inscriptionId,
    );
    if (!resultat)
      throw new NotFoundException(
        'Cet étudiant ne figure pas dans cette délibération',
      );
    const retenue = await this.retenue(inscriptionId);
    if (retenue) throw new ForbiddenException(retenue);
    const lignes = deliberation.resultats.map((item) => ({
      inscriptionId: item.inscriptionId,
      personne: inscription.personne,
      moyenne: item.moyenne === null ? null : Number(item.moyenne),
      creditsAcquis: item.creditsAcquis,
      creditsTotal: item.creditsTotal,
      rang: item.rang,
      mention: item.mention,
      decision: item.decision,
      detail: {},
    }));
    return {
      etudiant: inscription.personne,
      inscriptionId,
      classe: {
        nom: this.structure.nomClasse(inscription.classe),
        niveau: inscription.classe.niveau,
        filiere: inscription.classe.filiere.nom,
        annee: inscription.classe.anneeAcademique.libelle,
      },
      semestre,
      resultat: {
        moyenne: resultat.moyenne === null ? null : Number(resultat.moyenne),
        creditsAcquis: resultat.creditsAcquis,
        creditsTotal: resultat.creditsTotal,
        rang: resultat.rang,
        mention: resultat.mention,
        decision: resultat.decision,
        detail: resultat.detail,
      },
      classeStats: this.synthese(lignes),
      absences: await this.absencesDuSemestre(inscriptionId, semestre),
      deliberation: {
        president: deliberation.president,
        dateCloture: deliberation.dateCloture,
      },
    };
  }

  // Tous les bulletins d'une classe ; ceux qui sont retenus sont signalés, pas livrés.
  async bulletins(classeId: string, rawSemestre: string | number) {
    const semestre = this.verifierSemestre(rawSemestre);
    const etudiants = await this.etudiants(classeId);
    const bulletins: Array<Record<string, unknown>> = [];
    for (const inscription of etudiants) {
      try {
        bulletins.push(await this.bulletin(inscription.id, semestre));
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        bulletins.push({
          inscriptionId: inscription.id,
          etudiant: inscription.personne,
          retenu: error.message,
        });
      }
    }
    return bulletins;
  }

  // ---------- Passage en année supérieure ----------

  private async contextePassage(classeId: string) {
    const classe = await this.structure.classe(classeId);
    const deliberation = await this.prisma.deliberation.findUnique({
      where: { classeId_semestre: { classeId, semestre: 0 } },
      include: { resultats: true },
    });
    if (deliberation?.statut !== 'CLOTUREE')
      throw new ConflictException(
        'Le passage se prépare après clôture de la délibération annuelle',
      );
    const debut = Number(classe.anneeAcademique.libelle.slice(0, 4));
    const suivante = `${debut + 1}-${debut + 2}`;
    const annee = await this.prisma.anneeAcademique.findUnique({
      where: { libelle: suivante },
    });
    const dejaInscrits = new Set(
      (
        await this.prisma.inscription.findMany({
          where: {
            anneeScolaire: suivante,
            personneId: {
              in: classe.inscriptions.map((item) => item.personneId),
            },
          },
          select: { personneId: true },
        })
      ).map((item) => item.personneId),
    );
    const index = NIVEAUX.indexOf(classe.niveau as (typeof NIVEAUX)[number]);
    return { classe, deliberation, suivante, annee, dejaInscrits, index };
  }

  async passage(classeId: string) {
    const { classe, deliberation, suivante, annee, dejaInscrits, index } =
      await this.contextePassage(classeId);
    return {
      anneeSuivante: suivante,
      anneeSuivanteOuverte: Boolean(annee && annee.statut !== 'CLOTUREE'),
      etudiants: classe.inscriptions
        .filter((inscription) => inscription.statut !== 'ABANDONNEE')
        .map((inscription) => {
          const resultat = deliberation.resultats.find(
            (item) => item.inscriptionId === inscription.id,
          );
          const admis =
            resultat?.decision === 'ADMIS' ||
            resultat?.decision === 'ADMIS_AVEC_DETTES';
          return {
            inscriptionId: inscription.id,
            personne: inscription.personne,
            decision: resultat?.decision ?? 'NON_DELIBERE',
            // Admis en dernière année : fin de cycle, pas de réinscription.
            niveauSuivant: !resultat
              ? null
              : admis
                ? (NIVEAUX[index + 1] ?? null)
                : classe.niveau,
            dejaInscrit: dejaInscrits.has(inscription.personneId),
          };
        }),
    };
  }

  async reinscrire(classeId: string, body: Body, acteur: Acteur) {
    const { classe, suivante, annee } = await this.contextePassage(classeId);
    if (!annee || annee.statut === 'CLOTUREE')
      throw new ConflictException(
        `Ouvrez d'abord l'année académique ${suivante} dans la structure académique`,
      );
    const choisis = new Set(
      Array.isArray(body.inscriptionIds)
        ? body.inscriptionIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : [],
    );
    if (!choisis.size)
      throw new BadRequestException('Sélectionnez au moins un étudiant');
    const { etudiants } = await this.passage(classeId);
    let creees = 0;
    const ignorees: Array<{ nom: string; raison: string }> = [];
    for (const etudiant of etudiants) {
      if (!choisis.has(etudiant.inscriptionId)) continue;
      const nom = `${etudiant.personne.prenom} ${etudiant.personne.nom}`;
      if (etudiant.dejaInscrit) {
        ignorees.push({ nom, raison: `déjà inscrit pour ${suivante}` });
        continue;
      }
      if (!etudiant.niveauSuivant) {
        ignorees.push({ nom, raison: 'fin de cycle ou non délibéré' });
        continue;
      }
      // Passe par le circuit normal d'inscription : pièces et frais du niveau sont créés.
      await this.inscriptions.create(
        {
          personneId: etudiant.personne.id,
          anneeScolaire: suivante,
          niveau: etudiant.niveauSuivant,
          filiere: classe.filiere.nom,
        },
        acteur.id,
      );
      creees += 1;
    }
    return { creees, ignorees, anneeSuivante: suivante };
  }
}
