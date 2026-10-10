import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Acteur, peut } from '../common/acteur';
import { isUniqueConstraintViolation } from '../common/prisma-errors';
import {
  choix,
  minutes,
  parseDate,
  parseEntier,
  parseHeure,
  parseNombre,
  texteRequis,
} from '../common/saisie';
import { PrismaService } from '../prisma/prisma.service';
import {
  chevauche,
  NIVEAUX,
  normaliser,
  ReglesNotes,
} from './academique.rules';

const PARAMETRES_ID = 'academique';
const STATUTS_ANNEE = ['PREPARATION', 'EN_COURS', 'CLOTUREE'] as const;
const JOURS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

type Body = Record<string, unknown>;
type Transaction = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

@Injectable()
export class StructureService {
  constructor(private readonly prisma: PrismaService) {}

  private async unique<T>(action: () => Promise<T>, message: string) {
    try {
      return await action();
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ConflictException(message);
      throw error;
    }
  }

  // ---------- Règles ----------

  async parametres() {
    return this.prisma.parametresAcademiques.upsert({
      where: { id: PARAMETRES_ID },
      create: { id: PARAMETRES_ID },
      update: {},
    });
  }

  async regles(): Promise<
    ReglesNotes & { seuilAbsences: number; blocageImpayes: boolean }
  > {
    const parametres = await this.parametres();
    return {
      poidsControleContinu: Number(parametres.poidsControleContinu),
      moyenneValidation: Number(parametres.moyenneValidation),
      noteEliminatoire:
        parametres.noteEliminatoire === null
          ? null
          : Number(parametres.noteEliminatoire),
      compensationSemestre: parametres.compensationSemestre,
      compensationAnnuelle: parametres.compensationAnnuelle,
      creditsPassage: parametres.creditsPassage,
      seuilAbsences: Number(parametres.seuilAbsences),
      blocageImpayes: parametres.blocageImpayes,
    };
  }

  async updateParametres(body: Body) {
    await this.parametres();
    const data: Record<string, unknown> = {};
    if (body.poidsControleContinu !== undefined)
      data.poidsControleContinu = parseNombre(
        body.poidsControleContinu,
        'La part du contrôle continu',
        0,
        100,
      );
    if (body.moyenneValidation !== undefined)
      data.moyenneValidation = parseNombre(
        body.moyenneValidation,
        'La moyenne de validation',
        1,
        20,
      );
    if (body.noteEliminatoire !== undefined)
      data.noteEliminatoire =
        body.noteEliminatoire === null || body.noteEliminatoire === ''
          ? null
          : parseNombre(body.noteEliminatoire, 'La note éliminatoire', 0, 20);
    if (body.creditsPassage !== undefined)
      data.creditsPassage = parseEntier(
        body.creditsPassage,
        'Les crédits de passage',
        0,
        60,
      );
    if (body.seuilAbsences !== undefined)
      data.seuilAbsences = parseNombre(
        body.seuilAbsences,
        "Le seuil d'absences",
        0,
        100,
      );
    for (const key of [
      'compensationSemestre',
      'compensationAnnuelle',
      'blocageImpayes',
    ])
      if (body[key] !== undefined) data[key] = body[key] === true;
    return this.prisma.parametresAcademiques.update({
      where: { id: PARAMETRES_ID },
      data,
    });
  }

  // ---------- Années ----------

  annees() {
    return this.prisma.anneeAcademique.findMany({
      orderBy: { dateDebut: 'desc' },
      include: { _count: { select: { classes: true } } },
    });
  }

  async createAnnee(body: Body) {
    const libelle = texteRequis(body.libelle, "Le libellé de l'année");
    const [debut, fin] = libelle.split('-').map(Number);
    if (!/^\d{4}-\d{4}$/.test(libelle) || fin !== debut + 1)
      throw new BadRequestException(
        "Le libellé de l'année doit avoir la forme 2026-2027",
      );
    const dateDebut = parseDate(body.dateDebut, 'La date de rentrée');
    const dateFin = parseDate(body.dateFin, "La date de fin d'année");
    if (dateFin <= dateDebut)
      throw new BadRequestException(
        'La date de fin doit suivre la date de rentrée',
      );
    return this.unique(
      () =>
        this.prisma.anneeAcademique.create({
          data: { libelle, dateDebut, dateFin },
        }),
      'Cette année académique existe déjà',
    );
  }

  async updateAnnee(id: string, body: Body) {
    const annee = await this.prisma.anneeAcademique.findUnique({
      where: { id },
    });
    if (!annee) throw new NotFoundException('Année académique introuvable');
    const data: Record<string, unknown> = {};
    if (body.dateDebut !== undefined)
      data.dateDebut = parseDate(body.dateDebut, 'La date de rentrée');
    if (body.dateFin !== undefined)
      data.dateFin = parseDate(body.dateFin, "La date de fin d'année");
    if (body.statut !== undefined) {
      const statut = choix(body.statut, STATUTS_ANNEE, 'Le statut');
      if (statut === 'CLOTUREE' && annee.statut !== 'CLOTUREE') {
        // On ne ferme pas une année dont une classe attend encore ses résultats.
        const enAttente = await this.prisma.classe.findMany({
          where: {
            anneeAcademiqueId: id,
            inscriptions: { some: {} },
            deliberations: { none: { semestre: 0, statut: 'CLOTUREE' } },
          },
          include: { filiere: true },
        });
        if (enAttente.length)
          throw new ConflictException(
            `Délibération annuelle non clôturée pour : ${enAttente
              .map((classe) => this.nomClasse(classe))
              .join(', ')}`,
          );
      }
      data.statut = statut;
    }
    return this.prisma.anneeAcademique.update({ where: { id }, data });
  }

  // ---------- Filières et salles ----------

  filieres() {
    return this.prisma.filiere.findMany({ orderBy: { nom: 'asc' } });
  }

  createFiliere(body: Body) {
    return this.unique(
      () =>
        this.prisma.filiere.create({
          data: {
            code: texteRequis(body.code, 'Le code', 2, 12).toUpperCase(),
            nom: texteRequis(body.nom, 'Le nom de la filière', 2, 120),
          },
        }),
      'Une filière porte déjà ce code ou ce nom',
    );
  }

  updateFiliere(id: string, body: Body) {
    return this.unique(
      () =>
        this.prisma.filiere.update({
          where: { id },
          data: {
            ...(body.code !== undefined
              ? { code: texteRequis(body.code, 'Le code', 2, 12).toUpperCase() }
              : {}),
            ...(body.nom !== undefined
              ? { nom: texteRequis(body.nom, 'Le nom de la filière', 2, 120) }
              : {}),
            ...(body.actif !== undefined ? { actif: body.actif === true } : {}),
          },
        }),
      'Une filière porte déjà ce code ou ce nom',
    );
  }

  salles() {
    return this.prisma.salle.findMany({ orderBy: { nom: 'asc' } });
  }

  private salleData(body: Body) {
    return {
      ...(body.nom !== undefined
        ? { nom: texteRequis(body.nom, 'Le nom de la salle', 1, 60) }
        : {}),
      ...(body.capacite !== undefined
        ? {
            capacite:
              body.capacite === null || body.capacite === ''
                ? null
                : parseEntier(body.capacite, 'La capacité', 1, 5000),
          }
        : {}),
      ...(body.actif !== undefined ? { actif: body.actif === true } : {}),
    };
  }

  createSalle(body: Body) {
    texteRequis(body.nom, 'Le nom de la salle', 1, 60);
    return this.unique(
      () =>
        this.prisma.salle.create({
          data: this.salleData(body) as { nom: string },
        }),
      'Cette salle existe déjà',
    );
  }

  updateSalle(id: string, body: Body) {
    return this.unique(
      () =>
        this.prisma.salle.update({ where: { id }, data: this.salleData(body) }),
      'Cette salle existe déjà',
    );
  }

  // Reprend les années et les filières déjà saisies à la main dans les inscriptions.
  async importerDepuisInscriptions() {
    const inscriptions = await this.prisma.inscription.findMany({
      select: { anneeScolaire: true, filiere: true },
    });
    const [annees, filieres] = await Promise.all([
      this.prisma.anneeAcademique.findMany(),
      this.prisma.filiere.findMany(),
    ]);
    const anneesConnues = new Set(annees.map((annee) => annee.libelle));
    const filieresConnues = new Set(
      filieres.flatMap((filiere) => [
        normaliser(filiere.nom),
        normaliser(filiere.code),
      ]),
    );
    const codes = new Set(filieres.map((filiere) => filiere.code));
    let anneesCreees = 0;
    let filieresCreees = 0;
    for (const { anneeScolaire, filiere } of inscriptions) {
      const libelle = anneeScolaire.trim();
      if (/^\d{4}-\d{4}$/.test(libelle) && !anneesConnues.has(libelle)) {
        const debut = Number(libelle.slice(0, 4));
        anneesConnues.add(libelle);
        // Dates de rentrée proposées, à ajuster ensuite.
        await this.prisma.anneeAcademique.create({
          data: {
            libelle,
            dateDebut: new Date(Date.UTC(debut, 8, 1)),
            dateFin: new Date(Date.UTC(debut + 1, 7, 31, 23, 59, 59)),
          },
        });
        anneesCreees += 1;
      }
      const nom = filiere.trim().replace(/\s+/g, ' ');
      if (nom.length >= 2 && !filieresConnues.has(normaliser(nom))) {
        filieresConnues.add(normaliser(nom));
        const initiales =
          nom
            .split(/[^A-Za-zÀ-ÿ0-9]+/)
            .filter((mot) => mot.length > 2 || /\d/.test(mot))
            .map((mot) => mot[0])
            .join('')
            .toUpperCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .slice(0, 6) || nom.slice(0, 3).toUpperCase();
        let code = initiales.length >= 2 ? initiales : `${initiales}X`;
        for (let suffixe = 2; codes.has(code); suffixe += 1)
          code = `${initiales}${suffixe}`;
        codes.add(code);
        await this.prisma.filiere.create({ data: { code, nom } });
        filieresCreees += 1;
      }
    }
    return { anneesCreees, filieresCreees };
  }

  // ---------- Classes ----------

  nomClasse(classe: {
    niveau: string;
    groupe: string;
    filiere: { code: string };
  }) {
    return `${classe.filiere.code} ${classe.niveau}${classe.groupe === 'A' ? '' : ` ${classe.groupe}`}`;
  }

  async classes(anneeId?: string) {
    const annee = anneeId
      ? await this.prisma.anneeAcademique.findUnique({ where: { id: anneeId } })
      : // Par défaut : l'année qui couvre la date du jour, sinon la plus récente.
        ((await this.prisma.anneeAcademique.findFirst({
          where: {
            statut: { not: 'CLOTUREE' },
            dateDebut: { lte: new Date() },
            dateFin: { gte: new Date() },
          },
          orderBy: { dateDebut: 'desc' },
        })) ??
        (await this.prisma.anneeAcademique.findFirst({
          where: { statut: 'EN_COURS' },
          orderBy: { dateDebut: 'desc' },
        })) ??
        (await this.prisma.anneeAcademique.findFirst({
          orderBy: { dateDebut: 'desc' },
        })));
    const classes = await this.prisma.classe.findMany({
      // Sans année connue, la liste est simplement vide.
      where: { anneeAcademiqueId: annee?.id ?? '' },
      include: {
        filiere: true,
        _count: { select: { inscriptions: true, cours: true } },
        deliberations: { select: { semestre: true, statut: true } },
      },
      orderBy: [
        { filiere: { nom: 'asc' } },
        { niveau: 'asc' },
        { groupe: 'asc' },
      ],
    });
    return {
      annee,
      classes: classes.map((classe) => ({
        ...classe,
        nom: this.nomClasse(classe),
        effectif: classe._count.inscriptions,
      })),
    };
  }

  async createClasse(body: Body) {
    const anneeAcademiqueId = texteRequis(body.anneeAcademiqueId, "L'année");
    const filiereId = texteRequis(body.filiereId, 'La filière');
    const niveau = choix(body.niveau, NIVEAUX, 'Le niveau');
    const groupe = (
      typeof body.groupe === 'string' && body.groupe.trim()
        ? body.groupe.trim()
        : 'A'
    )
      .toUpperCase()
      .slice(0, 8);
    const [annee, filiere] = await Promise.all([
      this.prisma.anneeAcademique.findUnique({
        where: { id: anneeAcademiqueId },
      }),
      this.prisma.filiere.findUnique({ where: { id: filiereId } }),
    ]);
    if (!annee) throw new NotFoundException('Année académique introuvable');
    if (annee.statut === 'CLOTUREE')
      throw new ConflictException('Cette année académique est clôturée');
    if (!filiere?.actif) throw new BadRequestException('Filière indisponible');
    const classe = await this.unique(
      () =>
        this.prisma.classe.create({
          data: {
            anneeAcademiqueId,
            filiereId,
            niveau,
            groupe,
            capacite:
              body.capacite === undefined ||
              body.capacite === null ||
              body.capacite === ''
                ? null
                : parseEntier(body.capacite, 'La capacité', 1, 5000),
          },
        }),
      'Cette classe existe déjà pour cette année',
    );
    await this.synchroniserCours(classe.id);
    return classe;
  }

  // Classe et son année ; refuse toute écriture sur une année clôturée.
  async classeOuverte(
    classeId: string,
    client: PrismaService | Transaction = this.prisma,
  ) {
    const classe = await client.classe.findUnique({
      where: { id: classeId },
      include: { anneeAcademique: true, filiere: true },
    });
    if (!classe) throw new NotFoundException('Classe introuvable');
    if (classe.anneeAcademique.statut === 'CLOTUREE')
      throw new ConflictException(
        `L'année ${classe.anneeAcademique.libelle} est clôturée : plus aucune modification n'y est possible`,
      );
    return classe;
  }

  // Une classe enseigne toutes les matières actives de la maquette de sa filière et de son niveau.
  async synchroniserCours(classeId: string) {
    const classe = await this.prisma.classe.findUnique({
      where: { id: classeId },
      include: { cours: { select: { matiereId: true } } },
    });
    if (!classe) return;
    const matieres = await this.prisma.matiere.findMany({
      where: {
        actif: true,
        ue: { filiereId: classe.filiereId, niveau: classe.niveau },
      },
      select: { id: true },
    });
    const existants = new Set(classe.cours.map((cours) => cours.matiereId));
    const manquants = matieres.filter((matiere) => !existants.has(matiere.id));
    if (manquants.length)
      await this.prisma.cours.createMany({
        data: manquants.map((matiere) => ({ classeId, matiereId: matiere.id })),
        skipDuplicates: true,
      });
  }

  async classe(id: string) {
    await this.synchroniserCours(id);
    const classe = await this.prisma.classe.findUnique({
      where: { id },
      include: {
        anneeAcademique: true,
        filiere: true,
        inscriptions: {
          include: { personne: true },
          orderBy: [
            { personne: { nom: 'asc' } },
            { personne: { prenom: 'asc' } },
          ],
        },
        deliberations: { select: { semestre: true, statut: true } },
      },
    });
    if (!classe) throw new NotFoundException('Classe introuvable');
    return { ...classe, nom: this.nomClasse(classe) };
  }

  // Inscriptions de la même année et du même niveau qui n'ont pas encore de classe.
  async candidats(classeId: string) {
    const classe = await this.classeOuverte(classeId);
    const inscriptions = await this.prisma.inscription.findMany({
      where: {
        classeId: null,
        anneeScolaire: classe.anneeAcademique.libelle,
        niveau: classe.niveau,
        statut: { not: 'ABANDONNEE' },
      },
      include: { personne: true },
      orderBy: [{ personne: { nom: 'asc' } }, { personne: { prenom: 'asc' } }],
    });
    const cibles = [
      normaliser(classe.filiere.nom),
      normaliser(classe.filiere.code),
    ];
    return inscriptions.map((inscription) => ({
      id: inscription.id,
      filiere: inscription.filiere,
      statut: inscription.statut,
      personne: inscription.personne,
      // La filière saisie à l'inscription correspond-elle à celle de la classe ?
      correspond: cibles.includes(normaliser(inscription.filiere)),
    }));
  }

  async affecter(classeId: string, body: Body) {
    const ids = Array.isArray(body.inscriptionIds)
      ? [
          ...new Set(
            body.inscriptionIds.filter(
              (id): id is string => typeof id === 'string',
            ),
          ),
        ]
      : [];
    if (!ids.length)
      throw new BadRequestException('Sélectionnez au moins un étudiant');
    return this.prisma.$transaction(async (transaction) => {
      const classe = await this.classeOuverte(classeId, transaction);
      const inscriptions = await transaction.inscription.findMany({
        where: { id: { in: ids } },
        include: { personne: true },
      });
      if (inscriptions.length !== ids.length)
        throw new NotFoundException('Inscription introuvable');
      for (const inscription of inscriptions) {
        const nom = `${inscription.personne.prenom} ${inscription.personne.nom}`;
        if (inscription.classeId)
          throw new ConflictException(`${nom} est déjà dans une classe`);
        if (inscription.statut === 'ABANDONNEE')
          throw new ConflictException(`L'inscription de ${nom} est abandonnée`);
        if (
          inscription.anneeScolaire !== classe.anneeAcademique.libelle ||
          inscription.niveau !== classe.niveau
        )
          throw new ConflictException(
            `${nom} est inscrit en ${inscription.niveau} pour ${inscription.anneeScolaire}, pas dans l'année et le niveau de cette classe`,
          );
      }
      if (classe.capacite !== null) {
        const effectif = await transaction.inscription.count({
          where: { classeId },
        });
        if (effectif + ids.length > classe.capacite)
          throw new ConflictException(
            `Capacité dépassée : ${classe.capacite} places, ${effectif} occupées`,
          );
      }
      await transaction.inscription.updateMany({
        where: { id: { in: ids }, classeId: null },
        data: { classeId },
      });
      // Premier passage en classe : l'étudiant reçoit son matricule définitif.
      const debut = classe.anneeAcademique.libelle.slice(2, 4);
      for (const inscription of inscriptions) {
        if (inscription.personne.matricule) continue;
        const cle = `ETU-${debut}`;
        const sequence = await transaction.sequenceNumero.upsert({
          where: { cle },
          create: { cle, valeur: 1 },
          update: { valeur: { increment: 1 } },
        });
        await transaction.personne.update({
          where: { id: inscription.personneId },
          data: {
            matricule: `${debut}${classe.filiere.code}${String(sequence.valeur).padStart(4, '0')}`,
          },
        });
      }
      return { affectes: ids.length };
    });
  }

  async retirer(classeId: string, inscriptionId: string) {
    await this.classeOuverte(classeId);
    const inscription = await this.prisma.inscription.findFirst({
      where: { id: inscriptionId, classeId },
      include: {
        _count: { select: { notes: true, absences: true, resultats: true } },
      },
    });
    if (!inscription)
      throw new NotFoundException("Cet étudiant n'est pas dans la classe");
    if (
      inscription._count.notes +
        inscription._count.absences +
        inscription._count.resultats >
      0
    )
      throw new ConflictException(
        "Cet étudiant a déjà des notes ou des absences dans la classe : il ne peut plus en être retiré. Marquez son inscription « abandonnée » s'il a quitté l'établissement.",
      );
    await this.prisma.inscription.update({
      where: { id: inscriptionId },
      data: { classeId: null },
    });
    return { retire: true };
  }

  // ---------- Maquette ----------

  async maquette(filiereId: string, niveau: string) {
    const unites = await this.prisma.uniteEnseignement.findMany({
      where: { filiereId, niveau },
      include: { matieres: { orderBy: { code: 'asc' } } },
      orderBy: [{ semestre: 'asc' }, { ordre: 'asc' }, { code: 'asc' }],
    });
    return {
      unites,
      // Un semestre compte normalement 30 crédits.
      credits: [1, 2].map((semestre) => ({
        semestre,
        total: unites
          .filter((unite) => unite.semestre === semestre)
          .reduce((total, unite) => total + unite.credits, 0),
      })),
    };
  }

  private async classesDeLaMaquette(filiereId: string, niveau: string) {
    const classes = await this.prisma.classe.findMany({
      where: {
        filiereId,
        niveau,
        anneeAcademique: { statut: { not: 'CLOTUREE' } },
      },
      select: { id: true },
    });
    for (const classe of classes) await this.synchroniserCours(classe.id);
  }

  async createUnite(body: Body) {
    const filiereId = texteRequis(body.filiereId, 'La filière');
    const niveau = choix(body.niveau, NIVEAUX, 'Le niveau');
    return this.unique(
      () =>
        this.prisma.uniteEnseignement.create({
          data: {
            filiereId,
            niveau,
            semestre: parseEntier(body.semestre, 'Le semestre', 1, 2),
            code: texteRequis(body.code, 'Le code', 1, 20).toUpperCase(),
            nom: texteRequis(body.nom, "Le nom de l'unité", 2, 160),
            credits: parseEntier(body.credits, 'Les crédits', 1, 60),
            ordre:
              body.ordre === undefined
                ? 0
                : parseEntier(body.ordre, "L'ordre", 0, 999),
          },
        }),
      'Une unité porte déjà ce code dans cette maquette',
    );
  }

  updateUnite(id: string, body: Body) {
    return this.unique(
      () =>
        this.prisma.uniteEnseignement.update({
          where: { id },
          data: {
            ...(body.code !== undefined
              ? { code: texteRequis(body.code, 'Le code', 1, 20).toUpperCase() }
              : {}),
            ...(body.nom !== undefined
              ? { nom: texteRequis(body.nom, "Le nom de l'unité", 2, 160) }
              : {}),
            ...(body.credits !== undefined
              ? { credits: parseEntier(body.credits, 'Les crédits', 1, 60) }
              : {}),
            ...(body.semestre !== undefined
              ? { semestre: parseEntier(body.semestre, 'Le semestre', 1, 2) }
              : {}),
          },
        }),
      'Une unité porte déjà ce code dans cette maquette',
    );
  }

  async removeUnite(id: string) {
    const unite = await this.prisma.uniteEnseignement.findUnique({
      where: { id },
      include: { _count: { select: { matieres: true } } },
    });
    if (!unite) throw new NotFoundException('Unité introuvable');
    if (unite._count.matieres > 0)
      throw new ConflictException(
        "Retirez d'abord les matières de cette unité",
      );
    await this.prisma.uniteEnseignement.delete({ where: { id } });
    return { supprime: true };
  }

  async createMatiere(body: Body) {
    const ueId = texteRequis(body.ueId, "L'unité d'enseignement");
    const unite = await this.prisma.uniteEnseignement.findUnique({
      where: { id: ueId },
    });
    if (!unite) throw new NotFoundException('Unité introuvable');
    const matiere = await this.unique(
      () =>
        this.prisma.matiere.create({
          data: {
            ueId,
            code: texteRequis(body.code, 'Le code', 1, 20).toUpperCase(),
            nom: texteRequis(body.nom, 'Le nom de la matière', 2, 160),
            coefficient: parseNombre(
              body.coefficient ?? 1,
              'Le coefficient',
              0.25,
              20,
            ),
            volumeHoraire: parseEntier(
              body.volumeHoraire ?? 0,
              'Le volume horaire',
              0,
              1000,
            ),
          },
        }),
      'Une matière porte déjà ce code dans cette unité',
    );
    await this.classesDeLaMaquette(unite.filiereId, unite.niveau);
    return matiere;
  }

  async updateMatiere(id: string, body: Body) {
    const matiere = await this.unique(
      () =>
        this.prisma.matiere.update({
          where: { id },
          data: {
            ...(body.code !== undefined
              ? { code: texteRequis(body.code, 'Le code', 1, 20).toUpperCase() }
              : {}),
            ...(body.nom !== undefined
              ? { nom: texteRequis(body.nom, 'Le nom de la matière', 2, 160) }
              : {}),
            ...(body.coefficient !== undefined
              ? {
                  coefficient: parseNombre(
                    body.coefficient,
                    'Le coefficient',
                    0.25,
                    20,
                  ),
                }
              : {}),
            ...(body.volumeHoraire !== undefined
              ? {
                  volumeHoraire: parseEntier(
                    body.volumeHoraire,
                    'Le volume horaire',
                    0,
                    1000,
                  ),
                }
              : {}),
            ...(body.actif !== undefined ? { actif: body.actif === true } : {}),
          },
          include: { ue: true },
        }),
      'Une matière porte déjà ce code dans cette unité',
    );
    if (matiere.actif)
      await this.classesDeLaMaquette(matiere.ue.filiereId, matiere.ue.niveau);
    return matiere;
  }

  // Une matière déjà enseignée ou notée ne disparaît pas : elle se désactive.
  async removeMatiere(id: string) {
    const utilises = await this.prisma.cours.count({
      where: {
        matiereId: id,
        OR: [{ seances: { some: {} } }, { evaluations: { some: {} } }],
      },
    });
    if (utilises > 0)
      throw new ConflictException(
        'Cette matière a déjà des séances ou des notes : désactivez-la au lieu de la supprimer',
      );
    await this.prisma.$transaction([
      this.prisma.cours.deleteMany({ where: { matiereId: id } }),
      this.prisma.matiere.delete({ where: { id } }),
    ]);
    return { supprime: true };
  }

  // ---------- Cours et emploi du temps ----------

  // Un enseignant sans rôle de scolarité ne voit et ne renseigne que ses propres cours.
  async enseignantRestreint(acteur: Acteur): Promise<string | null> {
    if (peut(acteur, 'view:academics') || peut(acteur, 'view:deliberations'))
      return null;
    const employe = await this.prisma.employe.findUnique({
      where: { utilisateurId: acteur.id },
      select: { id: true, categorie: true },
    });
    return employe?.categorie.startsWith('ENSEIGNANT') ? employe.id : null;
  }

  async exigerCours(coursId: string, acteur: Acteur) {
    const cours = await this.prisma.cours.findUnique({
      where: { id: coursId },
      include: {
        matiere: { include: { ue: true } },
        classe: { include: { anneeAcademique: true, filiere: true } },
        enseignant: true,
      },
    });
    if (!cours) throw new NotFoundException('Cours introuvable');
    const restreint = await this.enseignantRestreint(acteur);
    if (restreint && cours.enseignantId !== restreint)
      throw new ForbiddenException('Ce cours ne vous est pas attribué');
    return cours;
  }

  async cours(
    query: { classeId?: string; enseignantId?: string },
    acteur: Acteur,
  ) {
    if (query.classeId) await this.synchroniserCours(query.classeId);
    const restreint = await this.enseignantRestreint(acteur);
    const cours = await this.prisma.cours.findMany({
      where: {
        ...(query.classeId ? { classeId: query.classeId } : {}),
        ...(restreint
          ? { enseignantId: restreint }
          : query.enseignantId
            ? { enseignantId: query.enseignantId }
            : {}),
        // Sans classe précisée, on reste sur les années en cours.
        ...(query.classeId
          ? {}
          : { classe: { anneeAcademique: { statut: { not: 'CLOTUREE' } } } }),
        matiere: { actif: true },
      },
      include: {
        matiere: { include: { ue: true } },
        classe: { include: { filiere: true, anneeAcademique: true } },
        enseignant: { select: { id: true, nom: true, prenom: true } },
        seances: { select: { dureeMinutes: true } },
        _count: { select: { evaluations: true } },
      },
      orderBy: [
        { matiere: { ue: { semestre: 'asc' } } },
        { matiere: { code: 'asc' } },
      ],
    });
    return cours.map(({ seances, ...item }) => ({
      ...item,
      classeNom: this.nomClasse(item.classe),
      // Avancement du programme : heures tenues face au volume prévu.
      heuresFaites:
        Math.round(
          (seances.reduce((total, seance) => total + seance.dureeMinutes, 0) /
            60) *
            10,
        ) / 10,
    }));
  }

  async updateCours(id: string, body: Body) {
    const cours = await this.prisma.cours.findUnique({ where: { id } });
    if (!cours) throw new NotFoundException('Cours introuvable');
    await this.classeOuverte(cours.classeId);
    const enseignantId =
      typeof body.enseignantId === 'string' && body.enseignantId
        ? body.enseignantId
        : null;
    if (enseignantId) {
      const enseignant = await this.prisma.employe.findUnique({
        where: { id: enseignantId },
      });
      if (
        !enseignant ||
        enseignant.statut !== 'ACTIF' ||
        !enseignant.categorie.startsWith('ENSEIGNANT')
      )
        throw new BadRequestException(
          'Choisissez un enseignant en activité dans le personnel',
        );
      // Les créneaux déjà posés ne doivent pas mettre cet enseignant à deux endroits.
      const creneaux = await this.prisma.creneau.findMany({
        where: { coursId: id },
      });
      for (const creneau of creneaux)
        await this.verifierConflits(
          { ...creneau, coursId: id },
          cours.classeId,
          enseignantId,
          creneau.id,
          true,
        );
    }
    return this.prisma.cours.update({ where: { id }, data: { enseignantId } });
  }

  async emploiDuTemps(
    query: { classeId?: string; enseignantId?: string; salleId?: string },
    acteur: Acteur,
  ) {
    const restreint = await this.enseignantRestreint(acteur);
    const enseignantId = restreint ?? query.enseignantId;
    if (!query.classeId && !enseignantId && !query.salleId) return [];
    const creneaux = await this.prisma.creneau.findMany({
      where: {
        ...(query.salleId ? { salleId: query.salleId } : {}),
        cours: {
          ...(query.classeId ? { classeId: query.classeId } : {}),
          ...(enseignantId ? { enseignantId } : {}),
          classe: { anneeAcademique: { statut: { not: 'CLOTUREE' } } },
        },
      },
      include: {
        salle: true,
        cours: {
          include: {
            matiere: true,
            classe: { include: { filiere: true } },
            enseignant: { select: { id: true, nom: true, prenom: true } },
          },
        },
      },
      orderBy: [{ jour: 'asc' }, { heureDebut: 'asc' }],
    });
    return creneaux.map((creneau) => ({
      ...creneau,
      classeNom: this.nomClasse(creneau.cours.classe),
    }));
  }

  // Une classe, un enseignant et une salle ne peuvent être qu'à un endroit à la fois.
  private async verifierConflits(
    creneau: {
      coursId: string;
      jour: number;
      heureDebut: string;
      heureFin: string;
      salleId: string | null;
    },
    classeId: string,
    enseignantId: string | null,
    sansCreneauId?: string,
    enseignantSeulement = false,
  ) {
    const classe = await this.prisma.classe.findUniqueOrThrow({
      where: { id: classeId },
    });
    const autres = await this.prisma.creneau.findMany({
      where: {
        jour: creneau.jour,
        ...(sansCreneauId ? { id: { not: sansCreneauId } } : {}),
        cours: { classe: { anneeAcademiqueId: classe.anneeAcademiqueId } },
      },
      include: {
        salle: true,
        cours: {
          include: {
            matiere: true,
            classe: { include: { filiere: true } },
            enseignant: true,
          },
        },
      },
    });
    const plage = {
      debut: minutes(creneau.heureDebut),
      fin: minutes(creneau.heureFin),
    };
    for (const autre of autres) {
      if (
        !chevauche(plage, {
          debut: minutes(autre.heureDebut),
          fin: minutes(autre.heureFin),
        })
      )
        continue;
      const quand = `le ${JOURS[autre.jour]} de ${autre.heureDebut} à ${autre.heureFin}`;
      const quoi = `${autre.cours.matiere.nom} (${this.nomClasse(autre.cours.classe)})`;
      if (enseignantId && autre.cours.enseignantId === enseignantId)
        throw new ConflictException(`L'enseignant a déjà ${quoi} ${quand}`);
      if (enseignantSeulement) continue;
      if (autre.cours.classeId === classeId)
        throw new ConflictException(`La classe a déjà ${quoi} ${quand}`);
      if (creneau.salleId && autre.salleId === creneau.salleId)
        throw new ConflictException(
          `La salle ${autre.salle?.nom ?? ''} est occupée par ${quoi} ${quand}`,
        );
    }
  }

  async createCreneau(body: Body) {
    const coursId = texteRequis(body.coursId, 'Le cours');
    const cours = await this.prisma.cours.findUnique({
      where: { id: coursId },
    });
    if (!cours) throw new NotFoundException('Cours introuvable');
    await this.classeOuverte(cours.classeId);
    const creneau = {
      coursId,
      jour: parseEntier(body.jour, 'Le jour', 1, 6),
      heureDebut: parseHeure(body.heureDebut, "L'heure de début"),
      heureFin: parseHeure(body.heureFin, "L'heure de fin"),
      salleId:
        typeof body.salleId === 'string' && body.salleId ? body.salleId : null,
    };
    if (minutes(creneau.heureFin) <= minutes(creneau.heureDebut))
      throw new BadRequestException(
        "L'heure de fin doit suivre l'heure de début",
      );
    if (creneau.salleId) {
      const salle = await this.prisma.salle.findUnique({
        where: { id: creneau.salleId },
      });
      if (!salle?.actif) throw new BadRequestException('Salle indisponible');
    }
    await this.verifierConflits(creneau, cours.classeId, cours.enseignantId);
    return this.prisma.creneau.create({ data: creneau });
  }

  async removeCreneau(id: string) {
    const creneau = await this.prisma.creneau.findUnique({
      where: { id },
      include: { cours: true },
    });
    if (!creneau) throw new NotFoundException('Créneau introuvable');
    await this.classeOuverte(creneau.cours.classeId);
    await this.prisma.creneau.delete({ where: { id } });
    return { supprime: true };
  }
}
