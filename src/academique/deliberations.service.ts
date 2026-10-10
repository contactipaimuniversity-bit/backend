import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { Acteur } from '../common/acteur';
import {
  estDansLeFutur,
  parseDate,
  parseNombre,
  texteOptionnel,
  texteRequis,
} from '../common/saisie';
import { InscriptionsService } from '../inscriptions/inscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  arrondi,
  classer,
  mention,
  resultatAnnuel,
  resultatMatiere,
  resultatSemestre,
  resultatUE,
} from './academique.rules';
import { niveauSuivant } from './niveaux';
import { StructureService } from './structure.service';

type Body = Record<string, unknown>;

type Ligne = {
  inscriptionId: string;
  personne: {
    id: string;
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

type MatiereCredit = {
  code: string;
  nom: string;
  coefficient: number;
  moyenne: number | null;
};
type UniteDetail = {
  code: string;
  nom: string;
  credits: number;
  moyenne: number | null;
  validee: boolean;
  // Année où l'unité a été acquise, quand elle l'était avant cette classe.
  acquise?: string | null;
  matieres: MatiereCredit[];
};
type Tentative = {
  date: string;
  session: string | null;
  notes: Array<{ code: string; nom: string; note: number }>;
  moyenne: number | null;
  validee: boolean;
  saisiParNom: string;
  saisiLe: string;
};

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
    const classe = await this.prisma.classe.findUniqueOrThrow({
      where: { id: classeId },
      select: { id: true, filiereId: true, niveau: true },
    });
    const [regles, etudiants, acquises, cours] = await Promise.all([
      this.structure.regles(),
      this.etudiants(classeId),
      this.structure.unitesAcquises(classe),
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
      const conservees = acquises.get(inscription.personneId);
      const detailUnites = unites.map((unite) => {
        // Unité validée une année précédente : le redoublant la garde, sans la repasser.
        const conservee = conservees?.get(unite.code);
        if (conservee)
          return {
            code: unite.code,
            nom: unite.nom,
            credits: unite.credits,
            moyenne: conservee.moyenne ?? regles.moyenneValidation,
            validee: true,
            eliminatoire: false,
            acquise: conservee.annee,
            matieres: cours
              .filter((item) => item.matiere.ueId === unite.id)
              .map((item) => ({
                code: item.matiere.code,
                nom: item.matiere.nom,
                coefficient: Number(item.matiere.coefficient),
                controle: null,
                examen: null,
                rattrapage: null,
                moyenne: null,
                complet: true,
              })),
          };
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

  private async calculAnnuel(classeId: string, dernierNiveau: boolean) {
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
      const bilan = resultatAnnuel(semestres, regles, dernierNiveau);
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
        ? await this.calculAnnuel(
            classeId,
            await this.structure.finDeCycle(classe),
          )
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
        ? await this.calculAnnuel(
            classeId,
            await this.structure.finDeCycle(classe),
          )
        : await this.calculSemestre(classeId, semestre);
    // À la délibération annuelle, chaque unité devient acquise ou à rattraper.
    const credits =
      semestre === 0 && !problemes.length
        ? await this.creditsAnnuels(classe, lignes)
        : [];
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
      await transaction.creditUE.deleteMany({
        where: { deliberationId: deliberation.id },
      });
      await transaction.creditUE.createMany({
        data: credits.map((credit) => ({
          ...credit,
          deliberationId: deliberation.id,
        })),
      });
    });
    return this.resultats(classeId, semestre);
  }

  // Sort de chaque unité à l'issue de l'année. Acquise : validée, ou compensée
  // par la moyenne du semestre ou de l'année. À rattraper : non acquise par un
  // étudiant admis avec dettes. L'ajourné garde ses unités acquises et refait
  // les autres ; une unité déjà acquise auparavant n'est pas recomptée.
  private async creditsAnnuels(
    classe: {
      id: string;
      filiereId: string;
      niveau: string;
      anneeAcademique: { libelle: string };
    },
    lignes: Ligne[],
  ) {
    const semestres = await this.prisma.deliberation.findMany({
      where: {
        classeId: classe.id,
        semestre: { in: [1, 2] },
        statut: 'CLOTUREE',
      },
      include: { resultats: true },
    });
    const credits: Array<
      Omit<Prisma.CreditUECreateManyInput, 'deliberationId'>
    > = [];
    for (const ligne of lignes) {
      const anneeAcquise =
        ligne.creditsTotal > 0 && ligne.creditsAcquis === ligne.creditsTotal;
      for (const deliberation of semestres) {
        const resultat = deliberation.resultats.find(
          (item) => item.inscriptionId === ligne.inscriptionId,
        );
        if (!resultat) continue;
        const semestreAcquis = resultat.creditsAcquis === resultat.creditsTotal;
        const unites =
          (resultat.detail as { unites?: UniteDetail[] }).unites ?? [];
        for (const unite of unites) {
          if (unite.acquise) continue;
          const acquise = unite.validee || semestreAcquis || anneeAcquise;
          if (!acquise && ligne.decision !== 'ADMIS_AVEC_DETTES') continue;
          credits.push({
            personneId: ligne.personne.id,
            inscriptionId: ligne.inscriptionId,
            filiereId: classe.filiereId,
            niveau: classe.niveau,
            annee: classe.anneeAcademique.libelle,
            semestre: deliberation.semestre,
            code: unite.code,
            nom: unite.nom,
            credits: unite.credits,
            moyenne: unite.moyenne,
            statut: acquise ? 'ACQUISE' : 'DETTE',
            mode: !acquise ? null : unite.validee ? 'VALIDEE' : 'COMPENSEE',
            matieres: unite.matieres.map((matiere) => ({
              code: matiere.code,
              nom: matiere.nom,
              coefficient: matiere.coefficient,
              moyenne: matiere.moyenne,
            })),
            dateAcquisition: acquise ? new Date() : null,
          });
        }
      }
    }
    return credits;
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
    // Un rattrapage déjà passé s'appuie sur cette délibération : on ne l'efface pas.
    const credits = await this.prisma.creditUE.findMany({
      where: { deliberationId: cible.id },
      select: { mode: true, tentatives: true },
    });
    if (
      credits.some(
        (credit) =>
          credit.mode === 'RATTRAPAGE' ||
          (credit.tentatives as unknown[]).length > 0,
      )
    )
      throw new ConflictException(
        "Des crédits issus de cette délibération ont déjà fait l'objet d'un rattrapage : elle ne se rouvre plus",
      );
    await this.prisma.$transaction([
      this.prisma.creditUE.deleteMany({ where: { deliberationId: cible.id } }),
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
      include: { resultats: true, credits: true },
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
    // Niveau suivant du cycle ; aucun quand la filière se termine ici.
    const suivant =
      niveauSuivant(
        await this.structure.niveaux(),
        classe.niveau,
        classe.filiere.niveauFinal,
      )?.code ?? null;
    return { classe, deliberation, suivante, annee, dejaInscrits, suivant };
  }

  async passage(classeId: string) {
    const { classe, deliberation, suivante, annee, dejaInscrits, suivant } =
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
          const credits = deliberation.credits.filter(
            (credit) => credit.inscriptionId === inscription.id,
          );
          const total = (statut: string) =>
            credits
              .filter((credit) => credit.statut === statut)
              .reduce((somme, credit) => somme + credit.credits, 0);
          return {
            inscriptionId: inscription.id,
            personne: inscription.personne,
            decision: resultat?.decision ?? 'NON_DELIBERE',
            // Admis en dernière année : fin de cycle, pas de réinscription.
            niveauSuivant: !resultat ? null : admis ? suivant : classe.niveau,
            dejaInscrit: dejaInscrits.has(inscription.personneId),
            // Admis avec dettes : crédits à repasser. Ajourné : crédits qu'il garde.
            creditsARattraper: total('DETTE'),
            creditsConserves: admis ? 0 : total('ACQUISE'),
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
          filiereId: classe.filiereId,
        },
        acteur.id,
      );
      creees += 1;
    }
    return { creees, ignorees, anneeSuivante: suivante };
  }

  // ---------- Crédits à rattraper ----------

  // Unités dues par les étudiants admis avec dettes, et celles déjà rattrapées.
  async dettes(query: { statut?: string; q?: string }) {
    const recherche = query.q?.trim();
    const [credits, filieres, regles] = await Promise.all([
      this.prisma.creditUE.findMany({
        where: {
          ...(query.statut === 'RATTRAPEES'
            ? { mode: 'RATTRAPAGE' }
            : query.statut === 'TOUTES'
              ? { OR: [{ statut: 'DETTE' }, { mode: 'RATTRAPAGE' }] }
              : { statut: 'DETTE' }),
          ...(recherche
            ? {
                personne: {
                  OR: [
                    { nom: { contains: recherche, mode: 'insensitive' } },
                    { prenom: { contains: recherche, mode: 'insensitive' } },
                    { matricule: { contains: recherche, mode: 'insensitive' } },
                  ],
                },
              }
            : {}),
        },
        include: {
          personne: {
            select: { id: true, nom: true, prenom: true, matricule: true },
          },
        },
        orderBy: [
          { personne: { nom: 'asc' } },
          { personne: { prenom: 'asc' } },
          { semestre: 'asc' },
          { code: 'asc' },
        ],
        take: 500,
      }),
      this.prisma.filiere.findMany({ select: { id: true, nom: true } }),
      this.structure.regles(),
    ]);
    const noms = new Map(filieres.map((filiere) => [filiere.id, filiere.nom]));
    return {
      moyenneValidation: regles.moyenneValidation,
      dettes: credits.map((credit) => ({
        ...credit,
        moyenne: credit.moyenne === null ? null : Number(credit.moyenne),
        filiere: noms.get(credit.filiereId) ?? '',
      })),
    };
  }

  // Résultat d'une épreuve de rattrapage : une note par matière repassée. Une
  // note ne remplace l'ancienne que si elle est meilleure ; l'unité est acquise
  // dès que sa moyenne atteint le seuil de validation.
  async rattraper(id: string, body: Body, acteur: Acteur) {
    const credit = await this.prisma.creditUE.findUnique({ where: { id } });
    if (!credit) throw new NotFoundException('Unité à rattraper introuvable');
    if (credit.statut !== 'DETTE')
      throw new ConflictException('Cette unité est déjà acquise');
    const date = parseDate(body.date, "La date de l'épreuve");
    if (estDansLeFutur(date))
      throw new BadRequestException(
        "La date de l'épreuve ne peut pas être dans le futur",
      );
    const regles = await this.structure.regles();
    const saisies = Array.isArray(body.notes) ? (body.notes as Body[]) : [];
    const notes: Tentative['notes'] = [];
    const matieres = (credit.matieres as MatiereCredit[]).map((matiere) => {
      const saisie = saisies.find((item) => item?.code === matiere.code);
      if (
        saisie?.note === undefined ||
        saisie.note === null ||
        saisie.note === ''
      )
        return matiere;
      const note = parseNombre(saisie.note, `La note de ${matiere.nom}`, 0, 20);
      notes.push({ code: matiere.code, nom: matiere.nom, note });
      return { ...matiere, moyenne: Math.max(note, matiere.moyenne ?? 0) };
    });
    if (!notes.length)
      throw new BadRequestException(
        "Saisissez la note d'au moins une matière repassée",
      );
    const bilan = resultatUE(matieres, regles);
    const tentative: Tentative = {
      date: date.toISOString(),
      session: texteOptionnel(body.session, 120),
      notes,
      moyenne: bilan.moyenne,
      validee: bilan.validee,
      saisiParNom: acteur.nom,
      saisiLe: new Date().toISOString(),
    };
    return this.prisma.creditUE.update({
      where: { id },
      data: {
        matieres,
        moyenne: bilan.moyenne,
        tentatives: [...(credit.tentatives as Tentative[]), tentative],
        ...(bilan.validee
          ? { statut: 'ACQUISE', mode: 'RATTRAPAGE', dateAcquisition: date }
          : {}),
      },
    });
  }

  // ---------- Relevé annuel, attestation de réussite et diplôme ----------

  // Tout ce que portent les documents de fin d'année d'un étudiant : notes des
  // deux semestres, résultat annuel, crédits restant dus, et s'il est diplômé.
  async releve(inscriptionId: string) {
    const inscription = await this.prisma.inscription.findUnique({
      where: { id: inscriptionId },
      include: {
        personne: true,
        classe: { include: { filiere: true, anneeAcademique: true } },
      },
    });
    if (!inscription?.classe)
      throw new NotFoundException("Cet étudiant n'est affecté à aucune classe");
    const classe = inscription.classe;
    const deliberations = await this.prisma.deliberation.findMany({
      where: { classeId: classe.id, statut: 'CLOTUREE' },
      include: { resultats: true },
      orderBy: { semestre: 'asc' },
    });
    const annuelle = deliberations.find((item) => item.semestre === 0);
    const annuel = annuelle?.resultats.find(
      (item) => item.inscriptionId === inscriptionId,
    );
    if (!annuelle || !annuel)
      throw new ConflictException(
        "Le relevé annuel n'est disponible qu'après clôture de la délibération annuelle",
      );
    const retenue = await this.retenue(inscriptionId);
    if (retenue) throw new ForbiddenException(retenue);
    const [credits, niveaux, finDeCycle] = await Promise.all([
      // Toutes les unités de l'étudiant dans la filière, tous niveaux confondus.
      this.prisma.creditUE.findMany({
        where: {
          personneId: inscription.personneId,
          filiereId: classe.filiereId,
        },
        orderBy: [{ niveau: 'asc' }, { semestre: 'asc' }, { code: 'asc' }],
      }),
      this.structure.niveaux(),
      this.structure.finDeCycle(classe),
    ]);
    const sort = new Map(
      credits
        .filter((credit) => credit.inscriptionId === inscriptionId)
        .map((credit) => [credit.code, credit]),
    );
    const dettes = credits
      .filter((credit) => credit.statut === 'DETTE')
      .map((credit) => ({
        niveau: credit.niveau,
        annee: credit.annee,
        code: credit.code,
        nom: credit.nom,
        credits: credit.credits,
      }));
    return {
      etudiant: inscription.personne,
      inscriptionId,
      classe: {
        nom: this.structure.nomClasse(classe),
        niveau: classe.niveau,
        filiere: classe.filiere.nom,
        annee: classe.anneeAcademique.libelle,
      },
      semestres: deliberations
        .filter((item) => item.semestre !== 0)
        .flatMap((deliberation) => {
          const resultat = deliberation.resultats.find(
            (item) => item.inscriptionId === inscriptionId,
          );
          if (!resultat) return [];
          const unites =
            (resultat.detail as { unites?: UniteDetail[] }).unites ?? [];
          return [
            {
              semestre: deliberation.semestre,
              moyenne:
                resultat.moyenne === null ? null : Number(resultat.moyenne),
              creditsAcquis: resultat.creditsAcquis,
              creditsTotal: resultat.creditsTotal,
              decision: resultat.decision,
              unites: unites.map((unite) => ({
                ...unite,
                // ACQUISE, DETTE, ou NON_ACQUISE (à refaire en redoublant).
                statut: unite.acquise
                  ? 'ACQUISE'
                  : (sort.get(unite.code)?.statut ?? 'NON_ACQUISE'),
                mode: unite.acquise
                  ? 'ANTERIEURE'
                  : (sort.get(unite.code)?.mode ?? null),
              })),
            },
          ];
        }),
      resultat: {
        moyenne: annuel.moyenne === null ? null : Number(annuel.moyenne),
        creditsAcquis: annuel.creditsAcquis,
        creditsTotal: annuel.creditsTotal,
        rang: annuel.rang,
        mention: annuel.mention,
        decision: annuel.decision,
      },
      effectif: annuelle.resultats.length,
      dettes,
      finDeCycle,
      diplome:
        niveaux.find((niveau) => niveau.code === classe.niveau)?.diplome ??
        null,
      // Le diplôme suppose l'année finale validée et plus aucun crédit dû.
      diplomable: finDeCycle && annuel.decision === 'ADMIS' && !dettes.length,
      absences: await this.absencesDuSemestre(inscriptionId, 0),
      deliberation: {
        president: annuelle.president,
        dateCloture: annuelle.dateCloture,
      },
    };
  }

  // Relevés de toute une classe ; ceux qui sont retenus sont signalés, pas livrés.
  async releves(classeId: string) {
    const etudiants = await this.etudiants(classeId);
    const releves: Array<Record<string, unknown>> = [];
    for (const inscription of etudiants) {
      try {
        releves.push(await this.releve(inscription.id));
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        releves.push({
          inscriptionId: inscription.id,
          etudiant: inscription.personne,
          retenu: error.message,
        });
      }
    }
    return releves;
  }
}
