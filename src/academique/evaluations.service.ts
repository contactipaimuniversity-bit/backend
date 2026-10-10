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
  parseNombre,
  texteOptionnel,
  texteRequis,
} from '../common/saisie';
import { PrismaService } from '../prisma/prisma.service';
import { resultatMatiere, TYPES_EVALUATION } from './academique.rules';
import { StructureService } from './structure.service';

type Body = Record<string, unknown>;

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
    const [etudiants, evaluations, regles, clos] = await Promise.all([
      this.prisma.inscription.findMany({
        where: { classeId: cours.classeId, statut: { not: 'ABANDONNEE' } },
        include: { personne: true },
        orderBy: [
          { personne: { nom: 'asc' } },
          { personne: { prenom: 'asc' } },
        ],
      }),
      this.prisma.evaluation.findMany({
        where: { coursId },
        include: { notes: true, salle: true },
        orderBy: [{ date: 'asc' }, { libelle: 'asc' }],
      }),
      this.structure.regles(),
      this.semestreClos(cours.classeId, cours.matiere.ue.semestre),
    ]);
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
    return this.prisma.evaluation.create({
      data: {
        coursId: cours.id,
        type,
        libelle: texteRequis(body.libelle, "L'intitulé", 2, 120),
        date: dateOptionnelle(body.date, 'La date'),
        bareme: parseNombre(body.bareme ?? 20, 'Le barème', 1, 100),
        salleId:
          typeof body.salleId === 'string' && body.salleId
            ? body.salleId
            : null,
        surveillant: texteOptionnel(body.surveillant, 160),
        creeParNom: acteur.nom,
      },
    });
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
    const { evaluation } = await this.evaluationOuverte(id, acteur);
    if (evaluation.statut !== 'OUVERTE')
      throw new ConflictException(
        'Cette évaluation est validée : elle ne se modifie plus',
      );
    if (body.bareme !== undefined && evaluation._count.notes > 0)
      throw new ConflictException(
        'Le barème ne change plus une fois des notes saisies',
      );
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
        "Cette évaluation est anonyme : les notes se saisissent par numéro d'anonymat",
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

  // Attribue à chaque étudiant un numéro tiré au hasard. Relancée, elle ne
  // numérote que les étudiants arrivés depuis.
  async anonymiser(id: string, acteur: Acteur) {
    const { evaluation, cours } = await this.evaluationOuverte(id, acteur);
    if (evaluation.statut !== 'OUVERTE')
      throw new ConflictException('Cette évaluation est déjà validée');
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
        .filter((note) => note.numeroAnonymat !== null)
        .map((note) => note.inscriptionId),
    );
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
            saisieParNom: acteur.nom,
          },
          update: { numeroAnonymat: numero },
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

  // Ce que voit le correcteur : des numéros, jamais des noms.
  async copies(id: string, acteur: Acteur) {
    const { evaluation } = await this.evaluationAnonyme(id, acteur);
    const notes = await this.prisma.note.findMany({
      where: { evaluationId: id, numeroAnonymat: { not: null } },
      orderBy: { numeroAnonymat: 'asc' },
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
        valeur: note.valeur === null ? null : Number(note.valeur),
        absent: note.absent,
      })),
    };
  }

  async saisirCopies(id: string, body: Body, acteur: Acteur) {
    const { evaluation } = await this.evaluationAnonyme(id, acteur);
    if (evaluation.statut !== 'OUVERTE')
      throw new ConflictException(
        'Les notes de cette évaluation sont validées',
      );
    if (!Array.isArray(body.notes))
      throw new BadRequestException('Aucune note transmise');
    const bareme = Number(evaluation.bareme);
    const connus = new Map(
      (
        await this.prisma.note.findMany({
          where: { evaluationId: id, numeroAnonymat: { not: null } },
        })
      ).map((note) => [note.numeroAnonymat, note.id]),
    );
    const saisies = (body.notes as Body[]).map((item) => {
      const numero = Number(item?.numero);
      const noteId = connus.get(numero);
      if (!noteId)
        throw new BadRequestException(
          `Le numéro d'anonymat ${String(item?.numero)} n'existe pas pour cette évaluation`,
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

  // Table de correspondance numéro → étudiant : réservée à la scolarité, jamais au correcteur.
  async correspondance(id: string, acteur: Acteur) {
    if (!peut(acteur, 'edit:deliberations'))
      throw new ForbiddenException(
        "La table d'anonymat est réservée au service de scolarité",
      );
    const { evaluation, cours } = await this.evaluationAnonyme(id, acteur);
    const notes = await this.prisma.note.findMany({
      where: { evaluationId: id, numeroAnonymat: { not: null } },
      include: { inscription: { include: { personne: true } } },
    });
    return {
      evaluation: evaluation.libelle,
      matiere: cours.matiere.nom,
      classe: this.structure.nomClasse(cours.classe),
      lignes: notes
        .map((note) => ({
          numero: note.numeroAnonymat,
          nom: note.inscription.personne.nom,
          prenom: note.inscription.personne.prenom,
          matricule: note.inscription.personne.matricule,
        }))
        .sort((a, b) => a.nom.localeCompare(b.nom)),
    };
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
    const [etudiants, notes] = await Promise.all([
      this.prisma.inscription.findMany({
        where: { classeId: cours.classeId, statut: { not: 'ABANDONNEE' } },
        include: { personne: true },
      }),
      this.prisma.note.findMany({ where: { evaluationId: id } }),
    ]);
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
