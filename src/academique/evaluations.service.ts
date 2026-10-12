import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Acteur, peut } from '../common/acteur';
import {
  choix,
  dateOptionnelle,
  minutes,
  parseDate,
  parseHeure,
  parseNombre,
  texteOptionnel,
  texteRequis,
} from '../common/saisie';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  chevauche,
  normaliser,
  resultatMatiere,
  TYPES_EVALUATION,
} from './academique.rules';
import { StructureService } from './structure.service';

type Body = Record<string, unknown>;

type Epreuve = {
  id?: string;
  classeId: string;
  date: Date | null;
  heureDebut: string | null;
  heureFin: string | null;
  salleId: string | null;
  surveillant: string | null;
};

const jourDe = (date: Date) => date.toISOString().slice(0, 10);

// Code d'une fiche d'anonymat : trois chiffres et une lettre, sans I, O ni Q
// (trop proches de 1 et 0 à la lecture d'une copie).
const LETTRES_CODE = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const tirerCode = () =>
  `IPAIM-${String(randomInt(1000)).padStart(3, '0')}${LETTRES_CODE[randomInt(LETTRES_CODE.length)]}`;
// Un code n'a plus cours six mois après la validation de son épreuve.
const CONSERVATION_CODES_JOURS = 180;

// Évaluations d'un cours et saisie des notes, jusqu'à leur verrouillage.
@Injectable()
export class EvaluationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly structure: StructureService,
  ) {}

  private async semestreClos(classeId: string, semestre: number) {
    const deliberation = await this.prisma.deliberation.findUnique({
      where: { classeId_semestre: { classeId, semestre } },
    });
    return deliberation?.statut === 'CLOTUREE';
  }

  // Cours ouvert à la saisie : année non clôturée et semestre non délibéré.
  private async coursOuvert(coursId: string, acteur: Acteur) {
    const cours = await this.structure.exigerCours(coursId, acteur);
    await this.structure.classeOuverte(cours.classeId);
    if (await this.semestreClos(cours.classeId, cours.matiere.ue.semestre))
      throw new ConflictException(
        `La délibération du semestre ${cours.matiere.ue.semestre} est clôturée : les notes de cette matière sont définitives`,
      );
    return cours;
  }

  async grille(coursId: string, acteur: Acteur) {
    const cours = await this.structure.exigerCours(coursId, acteur);
    const [etudiants, dispenses, evaluations, regles, clos] = await Promise.all(
      [
        this.prisma.inscription.findMany({
          where: { classeId: cours.classeId, statut: { not: 'ABANDONNEE' } },
          include: { personne: true },
          orderBy: [
            { personne: { nom: 'asc' } },
            { personne: { prenom: 'asc' } },
          ],
        }),
        this.dispenses(cours),
        this.prisma.evaluation.findMany({
          where: { coursId },
          include: { notes: true, salle: true },
          orderBy: [{ date: 'asc' }, { libelle: 'asc' }],
        }),
        this.structure.regles(),
        this.semestreClos(cours.classeId, cours.matiere.ue.semestre),
      ],
    );
    return {
      cours: {
        id: cours.id,
        matiere: cours.matiere,
        classeId: cours.classeId,
        classeNom: this.structure.nomClasse(cours.classe),
        annee: cours.classe.anneeAcademique.libelle,
        enseignant: cours.enseignant
          ? `${cours.enseignant.prenom} ${cours.enseignant.nom}`
          : null,
      },
      // Lecture seule une fois le semestre délibéré ou l'année clôturée.
      verrouille: clos || cours.classe.anneeAcademique.statut === 'CLOTUREE',
      peutValider: peut(acteur, 'edit:deliberations'),
      // Le correcteur n'approche ni les fiches ni la table d'anonymat.
      gereAnonymat:
        peut(acteur, 'edit:deliberations') &&
        !(await this.estCorrecteur(cours, acteur)),
      anonymatObligatoire: regles.anonymatObligatoire,
      poidsControleContinu: regles.poidsControleContinu,
      evaluations: evaluations.map(({ notes, ...evaluation }) => ({
        ...evaluation,
        notesSaisies: notes.filter(
          (note) => note.absent || note.valeur !== null,
        ).length,
      })),
      etudiants: etudiants.map((inscription) => {
        const notes = evaluations.map((evaluation) => {
          const note = evaluation.notes.find(
            (item) => item.inscriptionId === inscription.id,
          );
          // Copies anonymes : personne ne voit qui a eu quoi avant la validation.
          const masquee = evaluation.anonyme && evaluation.statut !== 'VALIDEE';
          return {
            evaluationId: evaluation.id,
            type: evaluation.type,
            bareme: Number(evaluation.bareme),
            valeur:
              masquee || note?.valeur == null ? null : Number(note.valeur),
            absent: masquee ? false : (note?.absent ?? false),
            masquee,
          };
        });
        return {
          inscriptionId: inscription.id,
          personne: inscription.personne,
          notes,
          ...resultatMatiere(notes, regles),
          // Unité déjà acquise une année précédente : rien à noter.
          dispense: dispenses.has(inscription.personneId),
        };
      }),
    };
  }

  async create(body: Body, acteur: Acteur) {
    const cours = await this.coursOuvert(
      texteRequis(body.coursId, 'Le cours'),
      acteur,
    );
    const type = choix(body.type, TYPES_EVALUATION, "Le type d'évaluation");
    // Un seul examen et un seul rattrapage par matière ; les contrôles sont libres.
    if (type !== 'CONTROLE') {
      const existe = await this.prisma.evaluation.count({
        where: { coursId: cours.id, type },
      });
      if (existe)
        throw new ConflictException(
          type === 'EXAMEN'
            ? "L'examen de cette matière existe déjà"
            : 'Le rattrapage de cette matière existe déjà',
        );
    }
    if (type === 'RATTRAPAGE') {
      const examen = await this.prisma.evaluation.findFirst({
        where: { coursId: cours.id, type: 'EXAMEN', statut: 'VALIDEE' },
      });
      if (!examen)
        throw new ConflictException(
          "Le rattrapage ne s'organise qu'après validation des notes de l'examen",
        );
    }
    const epreuve = {
      classeId: cours.classeId,
      date: dateOptionnelle(body.date, 'La date'),
      ...this.horaire(body.heureDebut, body.heureFin),
      salleId:
        typeof body.salleId === 'string' && body.salleId ? body.salleId : null,
      surveillant: texteOptionnel(body.surveillant, 160),
    };
    await this.verifierConflits(epreuve);
    const { classeId, ...planification } = epreuve;
    void classeId;
    return this.prisma.evaluation.create({
      data: {
        coursId: cours.id,
        type,
        libelle: texteRequis(body.libelle, "L'intitulé", 2, 120),
        bareme: parseNombre(body.bareme ?? 20, 'Le barème', 1, 100),
        ...planification,
        creeParNom: acteur.nom,
      },
    });
  }

  // Les étudiants de la classe qui ont déjà acquis l'unité de ce cours.
  private async dispenses(cours: {
    classeId: string;
    classe: { filiereId: string; niveau: string };
    matiere: { ue: { code: string } };
  }): Promise<Set<string>> {
    const acquises = await this.structure.unitesAcquises({
      id: cours.classeId,
      filiereId: cours.classe.filiereId,
      niveau: cours.classe.niveau,
    });
    return new Set(
      [...acquises.entries()]
        .filter(([, unites]) => unites.has(cours.matiere.ue.code))
        .map(([personneId]) => personneId),
    );
  }

  // ---------- Calendrier des épreuves ----------

  // Une épreuve a ses deux heures, ou aucune.
  private horaire(debut: unknown, fin: unknown) {
    const vide = (value: unknown) =>
      value === undefined || value === null || value === '';
    if (vide(debut) && vide(fin)) return { heureDebut: null, heureFin: null };
    if (vide(debut) || vide(fin))
      throw new BadRequestException(
        "Indiquez l'heure de début et l'heure de fin de l'épreuve",
      );
    const heureDebut = parseHeure(debut, "L'heure de début");
    const heureFin = parseHeure(fin, "L'heure de fin");
    if (minutes(heureFin) <= minutes(heureDebut))
      throw new BadRequestException(
        "L'heure de fin doit suivre l'heure de début",
      );
    return { heureDebut, heureFin };
  }

  private epreuvesDuJour(date: Date, sansId?: string) {
    const debut = new Date(`${jourDe(date)}T00:00:00.000Z`);
    return this.prisma.evaluation.findMany({
      where: {
        date: { gte: debut, lt: new Date(debut.getTime() + 86_400_000) },
        ...(sansId ? { id: { not: sansId } } : {}),
      },
      include: {
        salle: true,
        cours: {
          include: { matiere: true, classe: { include: { filiere: true } } },
        },
      },
    });
  }

  // Raison pour laquelle deux épreuves du même jour ne peuvent pas se tenir
  // ensemble : même classe, même salle ou même surveillant sur des horaires
  // qui se chevauchent.
  private conflit(
    epreuve: Epreuve,
    autre: Epreuve & {
      libelle: string;
      salle: { nom: string } | null;
      cours: {
        matiere: { nom: string };
        classe: { niveau: string; groupe: string; filiere: { code: string } };
      };
    },
  ): string | null {
    if (
      !epreuve.heureDebut ||
      !epreuve.heureFin ||
      !autre.heureDebut ||
      !autre.heureFin ||
      !chevauche(
        {
          debut: minutes(epreuve.heureDebut),
          fin: minutes(epreuve.heureFin),
        },
        { debut: minutes(autre.heureDebut), fin: minutes(autre.heureFin) },
      )
    )
      return null;
    const quoi = `« ${autre.libelle} » de ${autre.cours.matiere.nom} (${this.structure.nomClasse(autre.cours.classe)}) de ${autre.heureDebut} à ${autre.heureFin}`;
    if (autre.classeId === epreuve.classeId) return `La classe a déjà ${quoi}`;
    if (epreuve.salleId && autre.salleId === epreuve.salleId)
      return `La salle ${autre.salle?.nom ?? ''} est prise par ${quoi}`;
    if (
      epreuve.surveillant &&
      autre.surveillant &&
      normaliser(epreuve.surveillant) === normaliser(autre.surveillant)
    )
      return `${epreuve.surveillant} surveille déjà ${quoi}`;
    return null;
  }

  private async verifierConflits(epreuve: Epreuve) {
    if (epreuve.salleId) {
      const salle = await this.prisma.salle.findUnique({
        where: { id: epreuve.salleId },
      });
      if (!salle?.actif) throw new BadRequestException('Salle indisponible');
    }
    if (!epreuve.date || !epreuve.heureDebut) return;
    for (const autre of await this.epreuvesDuJour(epreuve.date, epreuve.id)) {
      const raison = this.conflit(epreuve, {
        ...autre,
        classeId: autre.cours.classeId,
      });
      if (raison) throw new ConflictException(raison);
    }
  }

  // Toutes les épreuves datées d'une année, dans l'ordre, avec leurs conflits.
  async calendrier(query: { anneeId?: string; du?: string; au?: string }) {
    const annee = query.anneeId
      ? await this.prisma.anneeAcademique.findUnique({
          where: { id: query.anneeId },
        })
      : await this.structure.anneeCourante();
    const deLAnnee = {
      cours: { classe: { anneeAcademiqueId: annee?.id ?? '' } },
    };
    const [evaluations, sansDate] = await Promise.all([
      this.prisma.evaluation.findMany({
        where: {
          ...deLAnnee,
          date: {
            not: null,
            ...(query.du
              ? { gte: parseDate(query.du, 'La date de début') }
              : {}),
            ...(query.au ? { lte: parseDate(query.au, 'La date de fin') } : {}),
          },
        },
        include: {
          salle: true,
          cours: {
            include: {
              matiere: true,
              classe: { include: { filiere: true } },
              enseignant: { select: { nom: true, prenom: true } },
            },
          },
        },
        orderBy: [{ date: 'asc' }, { heureDebut: 'asc' }],
      }),
      this.prisma.evaluation.count({ where: { ...deLAnnee, date: null } }),
    ]);
    const epreuves = evaluations.map((evaluation) => ({
      ...evaluation,
      classeId: evaluation.cours.classeId,
    }));
    return {
      annee,
      // Épreuves sans date : elles n'apparaissent pas au calendrier.
      sansDate,
      epreuves: epreuves.map((epreuve) => ({
        id: epreuve.id,
        type: epreuve.type,
        libelle: epreuve.libelle,
        date: epreuve.date,
        heureDebut: epreuve.heureDebut,
        heureFin: epreuve.heureFin,
        statut: epreuve.statut,
        salle: epreuve.salle?.nom ?? null,
        surveillant: epreuve.surveillant,
        coursId: epreuve.coursId,
        matiere: epreuve.cours.matiere.nom,
        classeId: epreuve.classeId,
        classe: this.structure.nomClasse(epreuve.cours.classe),
        enseignant: epreuve.cours.enseignant
          ? `${epreuve.cours.enseignant.prenom} ${epreuve.cours.enseignant.nom}`
          : null,
        conflits: epreuves
          .filter(
            (autre) =>
              autre.id !== epreuve.id &&
              jourDe(autre.date!) === jourDe(epreuve.date!),
          )
          .map((autre) => this.conflit(epreuve, autre))
          .filter((raison): raison is string => raison !== null),
        // Sans horaire, les conflits ne peuvent pas être contrôlés.
        horaireManquant: !epreuve.heureDebut,
      })),
    };
  }

  private async evaluationOuverte(id: string, acteur: Acteur) {
    const evaluation = await this.prisma.evaluation.findUnique({
      where: { id },
      include: { _count: { select: { notes: true } } },
    });
    if (!evaluation) throw new NotFoundException('Évaluation introuvable');
    const cours = await this.coursOuvert(evaluation.coursId, acteur);
    return { evaluation, cours };
  }

  async update(id: string, body: Body, acteur: Acteur) {
    const { evaluation, cours } = await this.evaluationOuverte(id, acteur);
    if (evaluation.statut !== 'OUVERTE')
      throw new ConflictException(
        'Cette évaluation est validée : elle ne se modifie plus',
      );
    if (body.bareme !== undefined && evaluation._count.notes > 0)
      throw new ConflictException(
        'Le barème ne change plus une fois des notes saisies',
      );
    const horaire =
      body.heureDebut !== undefined || body.heureFin !== undefined
        ? this.horaire(
            body.heureDebut ?? evaluation.heureDebut,
            body.heureFin ?? evaluation.heureFin,
          )
        : {};
    await this.verifierConflits({
      id,
      classeId: cours.classeId,
      date:
        body.date !== undefined
          ? dateOptionnelle(body.date, 'La date')
          : evaluation.date,
      heureDebut: evaluation.heureDebut,
      heureFin: evaluation.heureFin,
      ...horaire,
      salleId:
        body.salleId !== undefined
          ? typeof body.salleId === 'string' && body.salleId
            ? body.salleId
            : null
          : evaluation.salleId,
      surveillant:
        body.surveillant !== undefined
          ? texteOptionnel(body.surveillant, 160)
          : evaluation.surveillant,
    });
    return this.prisma.evaluation.update({
      where: { id },
      data: {
        ...(body.libelle !== undefined
          ? { libelle: texteRequis(body.libelle, "L'intitulé", 2, 120) }
          : {}),
        ...(body.date !== undefined
          ? { date: dateOptionnelle(body.date, 'La date') }
          : {}),
        ...(body.bareme !== undefined
          ? { bareme: parseNombre(body.bareme, 'Le barème', 1, 100) }
          : {}),
        ...horaire,
        ...(body.salleId !== undefined
          ? {
              salleId:
                typeof body.salleId === 'string' && body.salleId
                  ? body.salleId
                  : null,
            }
          : {}),
        ...(body.surveillant !== undefined
          ? { surveillant: texteOptionnel(body.surveillant, 160) }
          : {}),
      },
    });
  }

  async remove(id: string, acteur: Acteur) {
    const { evaluation } = await this.evaluationOuverte(id, acteur);
    if (evaluation.statut !== 'OUVERTE')
      throw new ConflictException('Une évaluation validée ne se supprime pas');
    await this.prisma.evaluation.delete({ where: { id } });
    return { supprime: true };
  }

  async saisirNotes(id: string, body: Body, acteur: Acteur) {
    const { evaluation, cours } = await this.evaluationOuverte(id, acteur);
    if (evaluation.statut !== 'OUVERTE')
      throw new ConflictException(
        'Les notes de cette évaluation sont validées : demandez sa réouverture à la scolarité',
      );
    if (evaluation.anonyme)
      throw new ConflictException(
        "Cette évaluation est anonyme : les notes se saisissent par code d'anonymat",
      );
    if ((await this.structure.regles()).anonymatObligatoire)
      throw new ConflictException(
        "L'anonymat est obligatoire : la scolarité génère d'abord les fiches d'anonymat, puis les notes se saisissent par code",
      );
    if (!Array.isArray(body.notes))
      throw new BadRequestException('Aucune note transmise');
    const bareme = Number(evaluation.bareme);
    const notes = (body.notes as Body[]).map((item) => {
      const absent = item?.absent === true;
      const vide =
        item?.valeur === null ||
        item?.valeur === undefined ||
        item?.valeur === '';
      const valeur =
        absent || vide ? null : parseNombre(item.valeur, 'La note', 0, bareme);
      if (valeur !== null && Math.round(valeur * 100) !== valeur * 100)
        throw new BadRequestException('Une note a au maximum deux décimales');
      return {
        inscriptionId: texteRequis(item?.inscriptionId, "L'étudiant"),
        valeur,
        absent,
      };
    });
    const ids = [...new Set(notes.map((note) => note.inscriptionId))];
    const inscrits = await this.prisma.inscription.count({
      where: { id: { in: ids }, classeId: cours.classeId },
    });
    if (inscrits !== ids.length)
      throw new BadRequestException(
        "Une note concerne un étudiant qui n'est pas dans cette classe",
      );
    await this.prisma.$transaction(
      notes.map((note) =>
        this.prisma.note.upsert({
          where: {
            evaluationId_inscriptionId: {
              evaluationId: id,
              inscriptionId: note.inscriptionId,
            },
          },
          create: {
            evaluationId: id,
            ...note,
            saisieParNom: acteur.nom,
          },
          update: {
            valeur: note.valeur,
            absent: note.absent,
            saisieParNom: acteur.nom,
            dateSaisie: new Date(),
          },
        }),
      ),
    );
    return this.grille(cours.id, acteur);
  }

  // ---------- Anonymat des copies ----------

  // Le correcteur d'un cours : l'enseignant qui en a la charge.
  private async estCorrecteur(
    cours: { enseignantId: string | null },
    acteur: Acteur,
  ) {
    if (!cours.enseignantId) return false;
    const employe = await this.prisma.employe.findUnique({
      where: { utilisateurId: acteur.id },
      select: { id: true },
    });
    return employe?.id === cours.enseignantId;
  }

  // Fiches et table d'anonymat : la scolarité seule, jamais celui qui corrige.
  private async exigerGardienAnonymat(
    cours: { enseignantId: string | null },
    acteur: Acteur,
  ) {
    if (!peut(acteur, 'edit:deliberations'))
      throw new ForbiddenException(
        "Les fiches et la table d'anonymat sont réservées au service de scolarité",
      );
    if (await this.estCorrecteur(cours, acteur))
      throw new ForbiddenException(
        "Vous corrigez cette matière : ses fiches et sa table d'anonymat vous sont fermées",
      );
  }

  // Efface les codes des épreuves validées depuis longtemps : ils peuvent resservir.
  private async purgerCodesPerimes() {
    const limite = new Date(
      Date.now() - CONSERVATION_CODES_JOURS * 24 * 60 * 60 * 1000,
    );
    await this.prisma.note.updateMany({
      where: {
        codeAnonymat: { not: null },
        evaluation: { statut: 'VALIDEE', dateValidation: { lt: limite } },
      },
      data: { codeAnonymat: null, numeroAnonymat: null },
    });
  }

  // Attribue à chaque étudiant un code tiré au hasard, propre à cette épreuve.
  // Relancée, elle ne code que les étudiants arrivés depuis.
  async anonymiser(id: string, acteur: Acteur) {
    const { evaluation, cours } = await this.evaluationOuverte(id, acteur);
    await this.exigerGardienAnonymat(cours, acteur);
    if (evaluation.statut !== 'OUVERTE')
      throw new ConflictException('Cette évaluation est déjà validée');
    await this.purgerCodesPerimes();
    const [etudiants, notes] = await Promise.all([
      this.prisma.inscription.findMany({
        where: { classeId: cours.classeId, statut: { not: 'ABANDONNEE' } },
        select: { id: true },
      }),
      this.prisma.note.findMany({ where: { evaluationId: id } }),
    ]);
    if (
      !evaluation.anonyme &&
      notes.some((note) => note.absent || note.valeur !== null)
    )
      throw new ConflictException(
        "Des notes sont déjà saisies au nom des étudiants : l'anonymat se décide avant la correction",
      );
    const numerotes = new Set(
      notes
        .filter((note) => note.codeAnonymat !== null)
        .map((note) => note.inscriptionId),
    );
    const pris = new Set(notes.map((note) => note.codeAnonymat));
    const nouveauCode = () => {
      let code = tirerCode();
      while (pris.has(code)) code = tirerCode();
      pris.add(code);
      return code;
    };
    const nouveaux = etudiants
      .filter((etudiant) => !numerotes.has(etudiant.id))
      .map((etudiant) => ({ id: etudiant.id, tirage: Math.random() }))
      .sort((a, b) => a.tirage - b.tirage);
    let numero = Math.max(
      100,
      ...notes.map((note) => note.numeroAnonymat ?? 0),
    );
    await this.prisma.$transaction([
      this.prisma.evaluation.update({
        where: { id },
        data: { anonyme: true },
      }),
      ...nouveaux.map((etudiant) => {
        numero += 1;
        const codeAnonymat = nouveauCode();
        return this.prisma.note.upsert({
          where: {
            evaluationId_inscriptionId: {
              evaluationId: id,
              inscriptionId: etudiant.id,
            },
          },
          create: {
            evaluationId: id,
            inscriptionId: etudiant.id,
            numeroAnonymat: numero,
            codeAnonymat,
            saisieParNom: acteur.nom,
          },
          update: { numeroAnonymat: numero, codeAnonymat },
        });
      }),
    ]);
    return this.grille(cours.id, acteur);
  }

  private async evaluationAnonyme(id: string, acteur: Acteur) {
    const { evaluation, cours } = await this.evaluationOuverte(id, acteur);
    if (!evaluation.anonyme)
      throw new ConflictException("Cette évaluation n'est pas anonyme");
    return { evaluation, cours };
  }

  // Ce que voit le correcteur : des codes, jamais des noms.
  async copies(id: string, acteur: Acteur) {
    const { evaluation } = await this.evaluationAnonyme(id, acteur);
    const notes = await this.prisma.note.findMany({
      where: { evaluationId: id, codeAnonymat: { not: null } },
      orderBy: { codeAnonymat: 'asc' },
    });
    return {
      evaluation: {
        id: evaluation.id,
        libelle: evaluation.libelle,
        bareme: Number(evaluation.bareme),
        statut: evaluation.statut,
      },
      copies: notes.map((note) => ({
        numero: note.numeroAnonymat,
        code: note.codeAnonymat,
        valeur: note.valeur === null ? null : Number(note.valeur),
        absent: note.absent,
      })),
    };
  }

  async saisirCopies(id: string, body: Body, acteur: Acteur) {
    const { evaluation, cours } = await this.evaluationAnonyme(id, acteur);
    if (evaluation.statut !== 'OUVERTE')
      throw new ConflictException(
        'Les notes de cette évaluation sont validées',
      );
    // Épreuve rouverte après la levée de l'anonymat : les noms sont connus,
    // la correction des notes revient à la scolarité.
    if (evaluation.anonymatLeveLe)
      await this.exigerGardienAnonymat(cours, acteur);
    if (!Array.isArray(body.notes))
      throw new BadRequestException('Aucune note transmise');
    const bareme = Number(evaluation.bareme);
    const copies = await this.prisma.note.findMany({
      where: { evaluationId: id, codeAnonymat: { not: null } },
    });
    const parCode = new Map(copies.map((note) => [note.codeAnonymat, note.id]));
    const parNumero = new Map(
      copies.map((note) => [note.numeroAnonymat, note.id]),
    );
    const saisies = (body.notes as Body[]).map((item) => {
      const code =
        typeof item?.code === 'string' ? item.code.trim().toUpperCase() : '';
      const noteId = code
        ? parCode.get(code)
        : parNumero.get(Number(item?.numero));
      if (!noteId)
        throw new BadRequestException(
          `Le code d'anonymat ${code || String(item?.numero)} n'existe pas pour cette évaluation`,
        );
      const absent = item?.absent === true;
      const vide =
        item?.valeur === null ||
        item?.valeur === undefined ||
        item?.valeur === '';
      const valeur =
        absent || vide ? null : parseNombre(item.valeur, 'La note', 0, bareme);
      if (valeur !== null && Math.round(valeur * 100) !== valeur * 100)
        throw new BadRequestException('Une note a au maximum deux décimales');
      return { noteId, valeur, absent };
    });
    await this.prisma.$transaction(
      saisies.map((saisie) =>
        this.prisma.note.update({
          where: { id: saisie.noteId },
          data: {
            valeur: saisie.valeur,
            absent: saisie.absent,
            saisieParNom: acteur.nom,
            dateSaisie: new Date(),
          },
        }),
      ),
    );
    return this.copies(id, acteur);
  }

  // Table de correspondance code → étudiant : c'est elle qu'on imprime en
  // fiches d'anonymat. Réservée à la scolarité, jamais au correcteur.
  async correspondance(id: string, acteur: Acteur) {
    const { evaluation, cours } = await this.evaluationAnonyme(id, acteur);
    await this.exigerGardienAnonymat(cours, acteur);
    const notes = await this.prisma.note.findMany({
      where: { evaluationId: id, codeAnonymat: { not: null } },
      include: { inscription: { include: { personne: true } } },
    });
    return {
      evaluation: evaluation.libelle,
      type: evaluation.type,
      date: evaluation.date,
      matiere: cours.matiere.nom,
      classe: this.structure.nomClasse(cours.classe),
      annee: cours.classe.anneeAcademique.libelle,
      lignes: notes
        .map((note) => ({
          numero: note.numeroAnonymat,
          code: note.codeAnonymat,
          nom: note.inscription.personne.nom,
          prenom: note.inscription.personne.prenom,
          matricule: note.inscription.personne.matricule,
        }))
        .sort((a, b) => a.nom.localeCompare(b.nom)),
    };
  }

  // Liste d'appel de l'épreuve : la scolarité, qui sait qui était là, note les
  // absents par leur nom. Le correcteur verra seulement « copie absente » en
  // face des codes concernés.
  async absents(id: string, acteur: Acteur) {
    const { evaluation, cours } = await this.evaluationAnonyme(id, acteur);
    await this.exigerGardienAnonymat(cours, acteur);
    const notes = await this.prisma.note.findMany({
      where: { evaluationId: id, codeAnonymat: { not: null } },
      include: { inscription: { include: { personne: true } } },
    });
    return {
      evaluation: evaluation.libelle,
      etudiants: notes
        .map((note) => ({
          inscriptionId: note.inscriptionId,
          nom: note.inscription.personne.nom,
          prenom: note.inscription.personne.prenom,
          matricule: note.inscription.personne.matricule,
          absent: note.absent,
        }))
        .sort((a, b) => a.nom.localeCompare(b.nom)),
    };
  }

  async marquerAbsents(id: string, body: Body, acteur: Acteur) {
    const { evaluation, cours } = await this.evaluationAnonyme(id, acteur);
    await this.exigerGardienAnonymat(cours, acteur);
    if (evaluation.statut !== 'OUVERTE')
      throw new ConflictException(
        'Les notes de cette évaluation sont validées',
      );
    if (!Array.isArray(body.inscriptionIds))
      throw new BadRequestException("La liste d'appel est vide");
    const absents = new Set(
      (body.inscriptionIds as unknown[]).filter(
        (item): item is string => typeof item === 'string',
      ),
    );
    const notes = await this.prisma.note.findMany({
      where: { evaluationId: id, codeAnonymat: { not: null } },
    });
    const connus = new Set(notes.map((note) => note.inscriptionId));
    if ([...absents].some((inscriptionId) => !connus.has(inscriptionId)))
      throw new BadRequestException(
        "Un étudiant marqué absent n'a pas de fiche pour cette évaluation",
      );
    await this.prisma.$transaction([
      // Un absent n'a pas de copie : sa note éventuelle est effacée.
      this.prisma.note.updateMany({
        where: { evaluationId: id, inscriptionId: { in: [...absents] } },
        data: { absent: true, valeur: null, saisieParNom: acteur.nom },
      }),
      this.prisma.note.updateMany({
        where: {
          evaluationId: id,
          absent: true,
          inscriptionId: { notIn: [...absents] },
        },
        data: { absent: false, saisieParNom: acteur.nom },
      }),
    ]);
    return this.absents(id, acteur);
  }

  // La validation verrouille les notes : elle relève de la scolarité, pas de celui qui saisit.
  async valider(id: string, acteur: Acteur) {
    if (!peut(acteur, 'edit:deliberations'))
      throw new ForbiddenException(
        'La validation des notes relève du service de scolarité',
      );
    const { evaluation, cours } = await this.evaluationOuverte(id, acteur);
    if (evaluation.statut !== 'OUVERTE')
      throw new ConflictException('Cette évaluation est déjà validée');
    // Valider lève l'anonymat : celui qui corrige ne le fait pas lui-même.
    if (evaluation.anonyme) await this.exigerGardienAnonymat(cours, acteur);
    const [inscrits, dispenses, notes] = await Promise.all([
      this.prisma.inscription.findMany({
        where: { classeId: cours.classeId, statut: { not: 'ABANDONNEE' } },
        include: { personne: true },
      }),
      this.dispenses(cours),
      this.prisma.note.findMany({ where: { evaluationId: id } }),
    ]);
    // Qui a déjà acquis l'unité n'a pas de note à recevoir.
    const etudiants = inscrits.filter(
      (etudiant) => !dispenses.has(etudiant.personneId),
    );
    const saisis = new Set(
      notes
        .filter((note) => note.absent || note.valeur !== null)
        .map((note) => note.inscriptionId),
    );
    // Au rattrapage, seuls ceux qui l'ont passé sont notés.
    if (evaluation.type !== 'RATTRAPAGE') {
      const manquants = etudiants.filter(
        (etudiant) => !saisis.has(etudiant.id),
      );
      if (manquants.length)
        throw new ConflictException(
          `Note manquante pour ${manquants.length} étudiant(s) : ${manquants
            .slice(0, 5)
            .map(
              (etudiant) =>
                `${etudiant.personne.prenom} ${etudiant.personne.nom}`,
            )
            .join(
              ', ',
            )}${manquants.length > 5 ? '…' : ''}. Saisissez une note ou marquez-les absents.`,
        );
    } else if (!saisis.size) {
      throw new ConflictException('Aucune note de rattrapage saisie');
    }
    await this.prisma.evaluation.update({
      where: { id },
      data: {
        statut: 'VALIDEE',
        valideParId: acteur.id,
        valideParNom: acteur.nom,
        dateValidation: new Date(),
        ...(evaluation.anonyme && !evaluation.anonymatLeveLe
          ? { anonymatLeveLe: new Date() }
          : {}),
      },
    });
    return this.grille(cours.id, acteur);
  }

  async rouvrir(id: string, body: Body, acteur: Acteur) {
    if (!peut(acteur, 'edit:deliberations'))
      throw new ForbiddenException(
        'La réouverture des notes relève du service de scolarité',
      );
    // Le motif est conservé dans le journal d'audit.
    texteRequis(body.motif, 'Le motif de la réouverture', 10, 500);
    const { evaluation, cours } = await this.evaluationOuverte(id, acteur);
    if (evaluation.statut !== 'VALIDEE')
      throw new ConflictException("Cette évaluation n'est pas validée");
    await this.prisma.evaluation.update({
      where: { id },
      data: {
        statut: 'OUVERTE',
        valideParId: null,
        valideParNom: null,
        dateValidation: null,
      },
    });
    return this.grille(cours.id, acteur);
  }
}
