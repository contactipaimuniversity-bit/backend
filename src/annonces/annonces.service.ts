import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Acteur } from '../common/acteur';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  private async donnees(body: Body, partiel: boolean) {
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
    T extends { filiereId: string | null; classeId: string | null },
  >(annonces: T[]) {
    const [filieres, classes] = await Promise.all([
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
    ]);
    return annonces.map((annonce) => {
      const classe = classes.find((item) => item.id === annonce.classeId);
      return {
        ...annonce,
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
        OR: [{ expireLe: null }, { expireLe: { gt: maintenant } }],
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
    }));
  }
}
