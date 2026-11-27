import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Acteur } from '../common/acteur';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsPushService } from './notifications-push.service';

type Body = Record<string, unknown>;

const IMPORTANCES = ['NORMALE', 'IMPORTANTE'];
const TITRE_MAX = 140;
const CONTENU_MAX = 4000;

const texte = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';
const optionnel = (value: unknown) => texte(value) || null;

function dateOuNull(value: unknown, libelle: string) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(
    typeof value === 'string' || typeof value === 'number' ? value : NaN,
  );
  if (Number.isNaN(date.getTime()))
    throw new BadRequestException(`${libelle} n'est pas une date valide`);
  return date;
}

// Annonces de l'administration aux étudiants : création, modification,
// suppression, et lecture filtrée pour l'espace étudiant.
@Injectable()
export class AnnoncesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: NotificationsPushService,
  ) {}

  private async donnees(rawBody: Body, partiel: boolean) {
    // Un étudiant précis prime : filière, niveau et classe sont alors ignorés.
    const body: Body = optionnel(rawBody.personneId)
      ? { ...rawBody, filiereId: null, niveau: null, classeId: null }
      : rawBody;
    const data: Record<string, unknown> = {};
    if (!partiel || body.titre !== undefined) {
      const titre = texte(body.titre);
      if (!titre)
        throw new BadRequestException("Le titre de l'annonce est requis");
      if (titre.length > TITRE_MAX)
        throw new BadRequestException(
          `Le titre dépasse ${TITRE_MAX} caractères`,
        );
      data.titre = titre;
    }
    if (!partiel || body.contenu !== undefined) {
      const contenu = texte(body.contenu);
      if (!contenu)
        throw new BadRequestException("Le message de l'annonce est requis");
      if (contenu.length > CONTENU_MAX)
        throw new BadRequestException(
          `Le message dépasse ${CONTENU_MAX} caractères`,
        );
      data.contenu = contenu;
    }
    if (!partiel || body.importance !== undefined) {
      const importance = texte(body.importance) || 'NORMALE';
      if (!IMPORTANCES.includes(importance))
        throw new BadRequestException('Importance inconnue');
      data.importance = importance;
    }
    if (!partiel || body.epinglee !== undefined)
      data.epinglee = body.epinglee === true;
    if (!partiel || body.filiereId !== undefined) {
      const filiereId = optionnel(body.filiereId);
      if (
        filiereId &&
        !(await this.prisma.filiere.count({ where: { id: filiereId } }))
      )
        throw new BadRequestException('Filière introuvable');
      data.filiereId = filiereId;
    }
    if (!partiel || body.niveau !== undefined)
      data.niveau = optionnel(body.niveau);
    if (!partiel || body.classeId !== undefined) {
      const classeId = optionnel(body.classeId);
      if (
        classeId &&
        !(await this.prisma.classe.count({ where: { id: classeId } }))
      )
        throw new BadRequestException('Classe introuvable');
      data.classeId = classeId;
    }
    if (!partiel || body.personneId !== undefined) {
      const personneId = optionnel(body.personneId);
      if (
        personneId &&
        !(await this.prisma.personne.count({ where: { id: personneId } }))
      )
        throw new BadRequestException('Étudiant introuvable');
      data.personneId = personneId;
      // Pour un étudiant précis, les autres cibles n'ont plus de sens.
      if (personneId) {
        data.filiereId = null;
        data.niveau = null;
        data.classeId = null;
      }
    }
    if (!partiel || body.publieeLe !== undefined)
      data.publieeLe =
        dateOuNull(body.publieeLe, 'La date de publication') ?? new Date();
    if (!partiel || body.expireLe !== undefined)
      data.expireLe = dateOuNull(body.expireLe, "La date de fin d'affichage");
    const publieeLe = data.publieeLe as Date | undefined;
    const expireLe = data.expireLe as Date | null | undefined;
    if (publieeLe && expireLe && expireLe <= publieeLe)
      throw new BadRequestException(
        "La fin d'affichage doit venir après la publication",
      );
    return data;
  }

  // Noms lisibles des cibles (filière, classe), pour la liste de l'administration.
  private async avecCibles<
    T extends {
      filiereId: string | null;
      classeId: string | null;
      personneId: string | null;
    },
  >(annonces: T[]) {
    const [filieres, classes, etudiants] = await Promise.all([
      this.prisma.filiere.findMany({
        where: {
          id: {
            in: annonces.flatMap((a) => (a.filiereId ? [a.filiereId] : [])),
          },
        },
        select: { id: true, nom: true },
      }),
      this.prisma.classe.findMany({
        where: {
          id: { in: annonces.flatMap((a) => (a.classeId ? [a.classeId] : [])) },
        },
        select: {
          id: true,
          niveau: true,
          groupe: true,
          filiere: { select: { code: true } },
        },
      }),
      this.prisma.personne.findMany({
        where: {
          id: {
            in: annonces.flatMap((a) => (a.personneId ? [a.personneId] : [])),
          },
        },
        select: { id: true, nom: true, prenom: true, matricule: true },
      }),
    ]);
    return annonces.map((annonce) => {
      const classe = classes.find((item) => item.id === annonce.classeId);
      const etudiant = etudiants.find((item) => item.id === annonce.personneId);
      return {
        ...annonce,
        etudiant: etudiant
          ? `${etudiant.nom} ${etudiant.prenom}${etudiant.matricule ? ` (${etudiant.matricule})` : ''}`
          : null,
        filiere:
          filieres.find((item) => item.id === annonce.filiereId)?.nom ?? null,
        classe: classe
          ? `${classe.filiere.code} ${classe.niveau} ${classe.groupe}`
          : null,
      };
    });
  }

  async liste() {
    const annonces = await this.prisma.annonce.findMany({
      orderBy: [{ epinglee: 'desc' }, { publieeLe: 'desc' }],
    });
    return this.avecCibles(annonces);
  }

  // Recherche d'un étudiant à qui adresser une annonce personnelle : il doit
  // avoir un matricule ; on indique s'il a activé son espace et ses notifications.
  async etudiants(rawQ: unknown) {
    const q = texte(rawQ);
    if (q.length < 2) return [];
    const mots = q.split(/\s+/).filter(Boolean).slice(0, 4);
    const personnes = await this.prisma.personne.findMany({
      where: {
        matricule: { not: null },
        AND: mots.map((mot) => ({
          OR: [
            { nom: { contains: mot, mode: 'insensitive' as const } },
            { prenom: { contains: mot, mode: 'insensitive' as const } },
            { matricule: { contains: mot, mode: 'insensitive' as const } },
          ],
        })),
      },
      select: {
        id: true,
        nom: true,
        prenom: true,
        matricule: true,
        inscriptions: {
          where: { statut: { not: 'ABANDONNEE' } },
          orderBy: { dateInscription: 'desc' },
          take: 1,
          select: { filiere: true, niveau: true },
        },
        compteEtudiant: {
          select: {
            motDePasse: true,
            desactiveLe: true,
            _count: { select: { abonnementsPush: true } },
          },
        },
      },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
      take: 15,
    });
    return personnes.map((personne) => {
      const compte = personne.compteEtudiant;
      const actif = Boolean(compte?.motDePasse && !compte.desactiveLe);
      return {
        id: personne.id,
        nom: `${personne.nom} ${personne.prenom}`,
        matricule: personne.matricule,
        detail: personne.inscriptions[0]
          ? `${personne.inscriptions[0].filiere} · ${personne.inscriptions[0].niveau}`
          : null,
        espaceActif: actif,
        notifications: actif && (compte?._count.abonnementsPush ?? 0) > 0,
      };
    });
  }

  // Choix proposés dans le formulaire : filières actives, niveaux, classes de l'année en cours.
  async cibles() {
    const [filieres, niveaux, classes] = await Promise.all([
      this.prisma.filiere.findMany({
        where: { actif: true },
        select: { id: true, nom: true },
        orderBy: { nom: 'asc' },
      }),
      this.prisma.niveau.findMany({
        where: { actif: true },
        select: { code: true, libelle: true },
        orderBy: [{ cycle: 'asc' }, { rang: 'asc' }],
      }),
      this.prisma.classe.findMany({
        where: { anneeAcademique: { statut: { not: 'CLOTUREE' } } },
        select: {
          id: true,
          niveau: true,
          groupe: true,
          filiere: { select: { code: true, nom: true } },
        },
        orderBy: [{ niveau: 'asc' }, { groupe: 'asc' }],
      }),
    ]);
    return {
      filieres,
      niveaux,
      classes: classes.map((classe) => ({
        id: classe.id,
        nom: `${classe.filiere.code} ${classe.niveau} ${classe.groupe}`,
      })),
    };
  }

  async creer(body: Body, acteur: Acteur) {
    const data = await this.donnees(body, false);
    const annonce = await this.prisma.annonce.create({
      data: {
        ...(data as { titre: string; contenu: string }),
        creeParId: acteur.id,
        creeParNom: acteur.nom,
      },
    });
    // Publiée tout de suite : la notification part sans attendre la réponse.
    void this.push.diffuser();
    return (await this.avecCibles([annonce]))[0];
  }

  async modifier(id: string, body: Body) {
    const existe = await this.prisma.annonce.findUnique({ where: { id } });
    if (!existe) throw new NotFoundException('Annonce introuvable');
    const data = await this.donnees(body, true);
    const publieeLe = (data.publieeLe as Date | undefined) ?? existe.publieeLe;
    const expireLe =
      data.expireLe !== undefined
        ? (data.expireLe as Date | null)
        : existe.expireLe;
    if (expireLe && expireLe <= publieeLe)
      throw new BadRequestException(
        "La fin d'affichage doit venir après la publication",
      );
    const annonce = await this.prisma.annonce.update({ where: { id }, data });
    // Une annonce programmée avancée à maintenant part tout de suite.
    void this.push.diffuser();
    return (await this.avecCibles([annonce]))[0];
  }

  async supprimer(id: string) {
    const existe = await this.prisma.annonce.count({ where: { id } });
    if (!existe) throw new NotFoundException('Annonce introuvable');
    await this.prisma.annonce.delete({ where: { id } });
    return { id };
  }

  // Ce que voit un étudiant : les annonces publiées, pas expirées, qui
  // s'adressent à tous ou à sa filière, son niveau ou sa classe.
  async pourEtudiant(
    personneId: string,
    inscription: {
      filiereId: string | null;
      niveau: string;
      classeId: string | null;
      classeNiveau?: string | null;
    } | null,
  ) {
    const maintenant = new Date();
    const niveau = inscription?.classeNiveau ?? inscription?.niveau ?? null;
    const annonces = await this.prisma.annonce.findMany({
      where: {
        publieeLe: { lte: maintenant },
        AND: [
          { OR: [{ expireLe: null }, { expireLe: { gt: maintenant } }] },
          {
            OR: [
              { personneId },
              {
                personneId: null,
                AND: [
                  {
                    OR: [
                      { filiereId: null },
                      ...(inscription?.filiereId
                        ? [{ filiereId: inscription.filiereId }]
                        : []),
                    ],
                  },
                  { OR: [{ niveau: null }, ...(niveau ? [{ niveau }] : [])] },
                  {
                    OR: [
                      { classeId: null },
                      ...(inscription?.classeId
                        ? [{ classeId: inscription.classeId }]
                        : []),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      orderBy: [{ epinglee: 'desc' }, { publieeLe: 'desc' }],
      take: 50,
    });
    return annonces.map((annonce) => ({
      id: annonce.id,
      titre: annonce.titre,
      contenu: annonce.contenu,
      importance: annonce.importance,
      epinglee: annonce.epinglee,
      publieeLe: annonce.publieeLe,
      modifieLe: annonce.modifieLe,
      auteur: annonce.creeParNom,
      personnelle: annonce.personneId !== null,
    }));
  }
}
