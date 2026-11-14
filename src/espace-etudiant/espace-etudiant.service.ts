import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { DeliberationsService } from '../academique/deliberations.service';
import { StructureService } from '../academique/structure.service';
import { CloudinaryService } from '../fichiers/cloudinary.service';
import { situationScolarite } from '../frais-scolarite/frais-scolarite.situation';
import { PrismaService } from '../prisma/prisma.service';
import { JetonEtudiant } from './etudiant.guard';

type Body = Record<string, unknown>;

const ALPHABET_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DUREE_CODE_JOURS = 30;
const DUREE_SESSION = '30d';
const ECHECS_MAX = 5;
const BLOCAGE_MINUTES = 15;
const MOT_DE_PASSE_MIN = 8;
const IDENTIFIANTS_INVALIDES = 'Matricule ou mot de passe incorrect';
const CODE_INVALIDE = "Matricule ou code d'activation incorrect";

const texte = (value: unknown) => (typeof value === 'string' ? value : '');
const normaliserCode = (value: unknown) =>
  texte(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
const nomComplet = (personne: { prenom?: string | null; nom: string }) =>
  [personne.prenom, personne.nom].filter(Boolean).join(' ');

// Espace étudiant : connexion, activation du compte et lecture de ses propres données.
@Injectable()
export class EspaceEtudiantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly structure: StructureService,
    private readonly deliberations: DeliberationsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ---------- Comptes (côté administration) ----------

  async statutCompte(personneId: string) {
    const personne = await this.prisma.personne.findUnique({
      where: { id: personneId },
      select: { id: true, matricule: true, compteEtudiant: true },
    });
    if (!personne) throw new NotFoundException('Personne introuvable');
    return this.resumeCompte(personne.matricule, personne.compteEtudiant);
  }

  private resumeCompte(
    matricule: string | null,
    compte: {
      motDePasse: string | null;
      codeActivation: string | null;
      codeExpireLe: Date | null;
      codeCreeLe: Date | null;
      codeCreeParNom: string | null;
      activeLe: Date | null;
      derniereConnexion: Date | null;
      desactiveLe: Date | null;
    } | null,
  ) {
    const codeEnCours =
      Boolean(compte?.codeActivation) &&
      Boolean(compte?.codeExpireLe && compte.codeExpireLe > new Date());
    return {
      matricule,
      etat: !compte
        ? 'AUCUN'
        : compte.desactiveLe
          ? 'DESACTIVE'
          : compte.motDePasse
            ? 'ACTIF'
            : 'EN_ATTENTE',
      codeEnCours,
      codeExpireLe: codeEnCours ? compte?.codeExpireLe : null,
      codeCreeLe: compte?.codeCreeLe ?? null,
      codeCreeParNom: compte?.codeCreeParNom ?? null,
      activeLe: compte?.activeLe ?? null,
      derniereConnexion: compte?.derniereConnexion ?? null,
      desactiveLe: compte?.desactiveLe ?? null,
    };
  }

  // Nouveau code d'activation : il n'est montré qu'une fois. Il sert aussi
  // quand l'étudiant a oublié son mot de passe.
  async genererCode(personneId: string, parNom: string) {
    const personne = await this.prisma.personne.findUnique({
      where: { id: personneId },
      select: { id: true, nom: true, prenom: true, matricule: true },
    });
    if (!personne) throw new NotFoundException('Personne introuvable');
    if (!personne.matricule)
      throw new BadRequestException(
        "Cet étudiant n'a pas encore de matricule : il en reçoit un dès que ses frais d'inscription sont payés.",
      );
    const brut = Array.from(
      { length: 8 },
      () => ALPHABET_CODE[randomInt(ALPHABET_CODE.length)],
    ).join('');
    const expireLe = new Date(
      Date.now() + DUREE_CODE_JOURS * 24 * 60 * 60 * 1000,
    );
    const donnees = {
      codeActivation: await bcrypt.hash(brut, 10),
      codeExpireLe: expireLe,
      codeCreeLe: new Date(),
      codeCreeParNom: parNom,
      desactiveLe: null,
      echecs: 0,
      bloqueJusqua: null,
    };
    const compte = await this.prisma.compteEtudiant.upsert({
      where: { personneId },
      create: { personneId, ...donnees },
      update: donnees,
    });
    return {
      ...this.resumeCompte(personne.matricule, compte),
      etudiant: nomComplet(personne),
      // Montré une seule fois : seul son empreinte est conservée.
      codeActivation: `${brut.slice(0, 4)}-${brut.slice(4)}`,
    };
  }

  // Compte fermé : les sessions ouvertes tombent et le mot de passe est effacé.
  async desactiver(personneId: string) {
    const existant = await this.prisma.compteEtudiant.findUnique({
      where: { personneId },
      include: { personne: { select: { matricule: true } } },
    });
    if (!existant)
      throw new NotFoundException("Cet étudiant n'a pas de compte");
    const compte = await this.prisma.compteEtudiant.update({
      where: { personneId },
      data: {
        desactiveLe: new Date(),
        motDePasse: null,
        codeActivation: null,
        codeExpireLe: null,
        versionJeton: { increment: 1 },
      },
    });
    return this.resumeCompte(existant.personne.matricule, compte);
  }

  // ---------- Connexion de l'étudiant ----------

  private async compteParMatricule(rawMatricule: unknown) {
    const matricule = texte(rawMatricule).trim();
    if (!matricule) return null;
    return this.prisma.compteEtudiant.findFirst({
      where: {
        personne: { matricule: { equals: matricule, mode: 'insensitive' } },
      },
      include: { personne: { select: { id: true, nom: true, prenom: true } } },
    });
  }

  private verifierBlocage(compte: { bloqueJusqua: Date | null }) {
    if (compte.bloqueJusqua && compte.bloqueJusqua > new Date()) {
      const minutes = Math.ceil(
        (compte.bloqueJusqua.getTime() - Date.now()) / 60000,
      );
      throw new HttpException(
        `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
        429,
      );
    }
  }

  private async echec(compteId: string, echecs: number, message: string) {
    const total = echecs + 1;
    await this.prisma.compteEtudiant.update({
      where: { id: compteId },
      data:
        total >= ECHECS_MAX
          ? {
              echecs: 0,
              bloqueJusqua: new Date(Date.now() + BLOCAGE_MINUTES * 60000),
            }
          : { echecs: total },
    });
    throw new UnauthorizedException(message);
  }

  private async session(compte: {
    id: string;
    personneId: string;
    versionJeton: number;
  }) {
    const payload: JetonEtudiant = {
      sub: compte.id,
      typ: 'etudiant',
      personneId: compte.personneId,
      v: compte.versionJeton,
    };
    return {
      access_token: await this.jwtService.signAsync(payload, {
        expiresIn: DUREE_SESSION,
      }),
    };
  }

  async connexion(body: Body) {
    const compte = await this.compteParMatricule(body.matricule);
    const motDePasse = texte(body.motDePasse);
    if (!compte || !motDePasse)
      throw new UnauthorizedException(IDENTIFIANTS_INVALIDES);
    this.verifierBlocage(compte);
    if (compte.desactiveLe)
      throw new UnauthorizedException(
        "Votre accès a été désactivé. Adressez-vous à l'administration.",
      );
    if (!compte.motDePasse)
      throw new UnauthorizedException(
        "Votre compte n'est pas encore activé : utilisez le code remis par l'administration.",
      );
    if (!(await bcrypt.compare(motDePasse, compte.motDePasse)))
      return this.echec(compte.id, compte.echecs, IDENTIFIANTS_INVALIDES);
    const misAJour = await this.prisma.compteEtudiant.update({
      where: { id: compte.id },
      data: { echecs: 0, bloqueJusqua: null, derniereConnexion: new Date() },
    });
    return this.session(misAJour);
  }

  private verifierNouveauMotDePasse(value: unknown) {
    const motDePasse = texte(value);
    if (motDePasse.length < MOT_DE_PASSE_MIN)
      throw new BadRequestException(
        `Le mot de passe doit contenir au moins ${MOT_DE_PASSE_MIN} caractères.`,
      );
    return motDePasse;
  }

  // Première connexion (ou mot de passe oublié) : le code remis par
  // l'administration permet de choisir son mot de passe.
  async activation(body: Body) {
    const motDePasse = this.verifierNouveauMotDePasse(body.motDePasse);
    const code = normaliserCode(body.code);
    const compte = await this.compteParMatricule(body.matricule);
    if (!compte || !code) throw new UnauthorizedException(CODE_INVALIDE);
    this.verifierBlocage(compte);
    if (
      !compte.codeActivation ||
      !compte.codeExpireLe ||
      compte.codeExpireLe < new Date()
    )
      throw new UnauthorizedException(
        "Ce code n'est plus valable. Demandez-en un nouveau à l'administration.",
      );
    if (!(await bcrypt.compare(code, compte.codeActivation)))
      return this.echec(compte.id, compte.echecs, CODE_INVALIDE);
    const misAJour = await this.prisma.compteEtudiant.update({
      where: { id: compte.id },
      data: {
        motDePasse: await bcrypt.hash(motDePasse, 10),
        codeActivation: null,
        codeExpireLe: null,
        activeLe: compte.activeLe ?? new Date(),
        derniereConnexion: new Date(),
        desactiveLe: null,
        echecs: 0,
        bloqueJusqua: null,
        versionJeton: { increment: 1 },
      },
    });
    return this.session(misAJour);
  }

  async changerMotDePasse(compteId: string, body: Body) {
    const nouveau = this.verifierNouveauMotDePasse(body.nouveauMotDePasse);
    const compte = await this.prisma.compteEtudiant.findUniqueOrThrow({
      where: { id: compteId },
    });
    if (
      !compte.motDePasse ||
      !(await bcrypt.compare(texte(body.motDePasse), compte.motDePasse))
    )
      throw new BadRequestException('Le mot de passe actuel est incorrect.');
    const misAJour = await this.prisma.compteEtudiant.update({
      where: { id: compteId },
      data: {
        motDePasse: await bcrypt.hash(nouveau, 10),
        versionJeton: { increment: 1 },
      },
    });
    return this.session(misAJour);
  }

  // ---------- Données de l'étudiant ----------

  // L'inscription de l'année : la plus récente qui n'a pas été abandonnée.
  private async inscriptionCourante(personneId: string) {
    const inclure = {
      classe: { include: { filiere: true, anneeAcademique: true } },
      filiereRef: true,
    } as const;
    return (
      (await this.prisma.inscription.findFirst({
        where: { personneId, statut: { not: 'ABANDONNEE' } },
        include: inclure,
        orderBy: { dateInscription: 'desc' },
      })) ??
      (await this.prisma.inscription.findFirst({
        where: { personneId },
        include: inclure,
        orderBy: { dateInscription: 'desc' },
      }))
    );
  }

  private async exigerInscription(personneId: string) {
    const inscription = await this.inscriptionCourante(personneId);
    if (!inscription)
      throw new NotFoundException(
        "Aucune inscription n'est enregistrée à votre nom.",
      );
    return inscription;
  }

  async profil(personneId: string) {
    const [personne, inscription, compte] = await Promise.all([
      this.prisma.personne.findUniqueOrThrow({
        where: { id: personneId },
        select: {
          id: true,
          nom: true,
          prenom: true,
          matricule: true,
          sexe: true,
          telephone: true,
          quartier: true,
          dateNaissance: true,
          lieuNaissance: true,
          tuteurNom: true,
          tuteurPrenom: true,
          tuteurTelephone: true,
          photoUrl: true,
        },
      }),
      this.inscriptionCourante(personneId),
      this.prisma.compteEtudiant.findUnique({
        where: { personneId },
        select: { activeLe: true, derniereConnexion: true },
      }),
    ]);
    const { photoUrl, ...identite } = personne;
    const classe = inscription?.classe;
    const annee = classe?.anneeAcademique;
    return {
      etudiant: { ...identite, aPhoto: Boolean(photoUrl) },
      inscription: inscription && {
        id: inscription.id,
        statut: inscription.statut,
        anneeScolaire: inscription.anneeScolaire,
        niveau: classe?.niveau ?? inscription.niveau,
        filiere: inscription.filiereRef?.nom ?? inscription.filiere,
        viaBourse: inscription.viaBourse,
        classe: classe
          ? {
              id: classe.id,
              nom: this.structure.nomClasse(classe),
              groupe: classe.groupe,
            }
          : null,
        annee: annee
          ? {
              libelle: annee.libelle,
              dateDebut: annee.dateDebut,
              dateFin: annee.dateFin,
              finSemestre1: annee.finSemestre1,
            }
          : null,
      },
      compte,
    };
  }

  async photo(personneId: string) {
    const personne = await this.prisma.personne.findUnique({
      where: { id: personneId },
      select: { photoUrl: true, photoPublicId: true },
    });
    if (!personne?.photoUrl || !personne.photoPublicId)
      throw new NotFoundException('Aucune photo');
    const format = /\.(jpe?g|png|webp)$/i.exec(personne.photoUrl)?.[1] ?? 'jpg';
    return this.cloudinary.telechargerImage(
      personne.photoPublicId,
      format.toLowerCase(),
    );
  }

  async emploiDuTemps(personneId: string) {
    const inscription = await this.exigerInscription(personneId);
    if (!inscription.classeId) return { classe: null, creneaux: [] };
    const creneaux = await this.prisma.creneau.findMany({
      where: { cours: { classeId: inscription.classeId } },
      include: {
        salle: { select: { nom: true } },
        cours: {
          select: {
            matiere: { select: { nom: true, code: true } },
            enseignant: { select: { nom: true, prenom: true } },
          },
        },
      },
      orderBy: [{ jour: 'asc' }, { heureDebut: 'asc' }],
    });
    return {
      classe: inscription.classe
        ? this.structure.nomClasse(inscription.classe)
        : null,
      creneaux: creneaux.map((creneau) => ({
        id: creneau.id,
        jour: creneau.jour,
        heureDebut: creneau.heureDebut,
        heureFin: creneau.heureFin,
        matiere: creneau.cours.matiere.nom,
        code: creneau.cours.matiere.code,
        salle: creneau.salle?.nom ?? null,
        enseignant: creneau.cours.enseignant
          ? nomComplet(creneau.cours.enseignant)
          : null,
        commun: Boolean(creneau.regroupement),
      })),
    };
  }

  async examens(personneId: string) {
    const inscription = await this.exigerInscription(personneId);
    if (!inscription.classeId) return [];
    const evaluations = await this.prisma.evaluation.findMany({
      where: { cours: { classeId: inscription.classeId }, date: { not: null } },
      include: {
        salle: { select: { nom: true } },
        cours: { select: { matiere: { select: { nom: true } } } },
      },
      orderBy: [{ date: 'asc' }, { heureDebut: 'asc' }],
    });
    return evaluations.map((evaluation) => ({
      id: evaluation.id,
      type: evaluation.type,
      libelle: evaluation.libelle,
      date: evaluation.date,
      heureDebut: evaluation.heureDebut,
      heureFin: evaluation.heureFin,
      salle: evaluation.salle?.nom ?? null,
      matiere: evaluation.cours.matiere.nom,
      validee: evaluation.statut === 'VALIDEE',
    }));
  }

  // La carte en cours de validité : le même code que la carte imprimée, lu
  // par le contrôle à l'entrée.
  async carte(personneId: string) {
    const inscription = await this.exigerInscription(personneId);
    const carte = await this.prisma.carteEtudiant.findFirst({
      where: {
        inscriptionId: inscription.id,
        active: true,
        valableJusquau: { gte: new Date() },
      },
      orderBy: { creeLe: 'desc' },
      select: { jeton: true, valableJusquau: true, creeLe: true },
    });
    return {
      carte: inscription.statut === 'ABANDONNEE' ? null : carte,
      anneeScolaire: inscription.anneeScolaire,
    };
  }

  async scolarite(personneId: string) {
    const inscription = await this.exigerInscription(personneId);
    const [situation, paiements] = await Promise.all([
      situationScolarite(this.prisma, inscription.id),
      this.prisma.paiement.findMany({
        where: {
          inscriptionId: inscription.id,
          annulation: { is: null },
          typePaiement: { not: 'ANNULATION' },
        },
        include: {
          ligneScolarite: { select: { libelle: true } },
          elementDossier: {
            select: { elementRequis: { select: { nom: true } } },
          },
        },
        orderBy: { datePaiement: 'desc' },
      }),
    ]);
    const libelles: Record<string, string> = {
      FRAIS_DEPOT: 'Frais de dépôt',
      FRAIS_INSCRIPTION: "Frais d'inscription",
      ECHEANCE_BOURSE: 'Échéance de bourse',
      REMBOURSEMENT: 'Remboursement',
      REPORT: 'Report',
      MENSUALITE: 'Scolarité',
      FRAIS_ANNEXE: 'Frais annexe',
    };
    return {
      anneeScolaire: inscription.anneeScolaire,
      situation: situation && {
        regime: situation.regime,
        mensualites: situation.mensualites.map((ligne) => ({
          id: ligne.id,
          libelle: ligne.libelle,
          dateLimite: ligne.dateLimite,
          montant: ligne.montant,
          paye: ligne.paye,
          reste: ligne.reste,
        })),
        annexes: situation.annexes.map((ligne) => ({
          id: ligne.id,
          libelle: ligne.libelle,
          dateLimite: ligne.dateLimite,
          montant: ligne.montant,
          paye: ligne.paye,
          reste: ligne.reste,
        })),
        fraisInscription: situation.fraisInscription.map((ligne) => ({
          id: ligne.id,
          libelle: ligne.libelle,
          montant: ligne.montant,
          paye: ligne.paye,
          reste: ligne.reste,
        })),
        resteMensualites: situation.resteMensualites,
        resteAnnexes: situation.resteAnnexes,
        resteTotal:
          situation.resteTotal +
          situation.fraisInscription.reduce(
            (total, ligne) => total + ligne.reste,
            0,
          ),
        tropPercu: situation.tropPercu,
      },
      paiements: paiements.map((paiement) => ({
        id: paiement.id,
        montant: Number(paiement.montant),
        date: paiement.datePaiement,
        type: paiement.typePaiement,
        libelle:
          paiement.ligneScolarite?.libelle ??
          paiement.elementDossier?.elementRequis.nom ??
          libelles[paiement.typePaiement] ??
          'Paiement',
        numeroRecu: paiement.numeroRecu,
        mode: paiement.modePaiement,
      })),
    };
  }

  async assiduite(personneId: string) {
    const inscription = await this.exigerInscription(personneId);
    const seance = {
      select: {
        date: true,
        heureDebut: true,
        dureeMinutes: true,
        cours: { select: { matiere: { select: { nom: true } } } },
      },
    } as const;
    const [absences, retards] = await Promise.all([
      this.prisma.absenceEtudiant.findMany({
        where: { inscriptionId: inscription.id },
        include: { seance },
      }),
      this.prisma.retardEtudiant.findMany({
        where: { inscriptionId: inscription.id },
        include: { seance },
      }),
    ]);
    const parDate = (first: { date: Date }, second: { date: Date }) =>
      second.date.getTime() - first.date.getTime();
    const lignesAbsences = absences
      .map((absence) => ({
        id: absence.id,
        date: absence.seance.date,
        heureDebut: absence.seance.heureDebut,
        dureeMinutes: absence.seance.dureeMinutes,
        matiere: absence.seance.cours.matiere.nom,
        justifiee: absence.justifiee,
        motif: absence.motif,
      }))
      .sort(parDate);
    const minutes = (lignes: typeof lignesAbsences) =>
      lignes.reduce((total, ligne) => total + ligne.dureeMinutes, 0);
    return {
      totalMinutes: minutes(lignesAbsences),
      nonJustifieesMinutes: minutes(
        lignesAbsences.filter((ligne) => !ligne.justifiee),
      ),
      absences: lignesAbsences,
      retards: retards
        .map((retard) => ({
          id: retard.id,
          date: retard.seance.date,
          heureDebut: retard.seance.heureDebut,
          matiere: retard.seance.cours.matiere.nom,
          minutes: retard.minutes,
        }))
        .sort(parDate),
    };
  }

  // Seules les notes d'épreuves validées sont visibles : avant, elles peuvent
  // encore changer (et l'anonymat des copies doit tenir).
  async notes(personneId: string) {
    const inscription = await this.exigerInscription(personneId);
    const notes = await this.prisma.note.findMany({
      where: {
        inscriptionId: inscription.id,
        evaluation: { statut: 'VALIDEE' },
      },
      include: {
        evaluation: {
          select: {
            id: true,
            libelle: true,
            type: true,
            date: true,
            bareme: true,
            dateValidation: true,
            cours: {
              select: {
                matiere: {
                  select: {
                    id: true,
                    nom: true,
                    code: true,
                    coefficient: true,
                    ue: {
                      select: {
                        code: true,
                        nom: true,
                        semestre: true,
                        credits: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const resultats = await Promise.all(
      [1, 2].map(async (semestre) => {
        try {
          const bulletin = await this.deliberations.bulletin(
            inscription.id,
            semestre,
          );
          return {
            semestre,
            disponible: true as const,
            resultat: {
              moyenne: bulletin.resultat.moyenne,
              creditsAcquis: bulletin.resultat.creditsAcquis,
              creditsTotal: bulletin.resultat.creditsTotal,
              rang: bulletin.resultat.rang,
              mention: bulletin.resultat.mention,
              decision: bulletin.resultat.decision,
            },
            classe: {
              effectif: bulletin.classeStats.effectif,
              moyenne: bulletin.classeStats.moyenneClasse,
            },
            dateCloture: bulletin.deliberation.dateCloture,
          };
        } catch (error) {
          // Pas encore délibéré, ou bulletin retenu : on dit pourquoi.
          return {
            semestre,
            disponible: false as const,
            message:
              error instanceof HttpException
                ? error.message
                : 'Résultats non disponibles',
          };
        }
      }),
    );
    return {
      notes: notes
        .map((note) => {
          const matiere = note.evaluation.cours.matiere;
          return {
            id: note.id,
            valeur: note.valeur === null ? null : Number(note.valeur),
            absent: note.absent,
            evaluation: {
              id: note.evaluation.id,
              libelle: note.evaluation.libelle,
              type: note.evaluation.type,
              date: note.evaluation.date,
              bareme: Number(note.evaluation.bareme),
              publieeLe: note.evaluation.dateValidation,
            },
            matiere: {
              id: matiere.id,
              nom: matiere.nom,
              code: matiere.code,
              coefficient: Number(matiere.coefficient),
            },
            ue: matiere.ue,
          };
        })
        .sort(
          (first, second) =>
            (second.evaluation.publieeLe?.getTime() ?? 0) -
            (first.evaluation.publieeLe?.getTime() ?? 0),
        ),
      resultats,
    };
  }
}
