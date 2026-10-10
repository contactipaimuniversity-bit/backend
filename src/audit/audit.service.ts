import { BadRequestException, Injectable } from '@nestjs/common';
import {
  JournalActivite,
  JournalInteraction,
  JournalNavigation,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInteractionsDto } from './dto/create-interactions.dto';
import { CreateNavigationDto } from './dto/create-navigation.dto';
import { resolveEntityLabels } from './entity-labels';
import { SearchAuditDto } from './dto/search-audit.dto';
import { parseAuditDay } from './audit.utils';

const MAX_PAGE_DURATION_MS = 12 * 60 * 60 * 1000;
const MAX_INTERACTIONS_PER_BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async recordNavigation(
    dto: CreateNavigationDto,
    user: { sub: string; nom?: string; prenom?: string },
  ) {
    const page = typeof dto.page === 'string' ? dto.page.trim() : '';
    const titre = typeof dto.titre === 'string' ? dto.titre.trim() : '';
    const dureeMs = Math.round(Number(dto.dureeMs));
    const debut = new Date(dto.debut);
    if (
      !page.startsWith('/') ||
      !Number.isFinite(dureeMs) ||
      dureeMs < 1000 ||
      Number.isNaN(debut.getTime())
    ) {
      throw new BadRequestException('Mesure de navigation invalide');
    }
    await this.prisma.journalNavigation.create({
      data: {
        utilisateurId: user.sub,
        utilisateurNom:
          [user.prenom, user.nom].filter(Boolean).join(' ') || user.sub,
        page: page.slice(0, 200),
        titre: (titre || page).slice(0, 120),
        debut,
        dureeMs: Math.min(dureeMs, MAX_PAGE_DURATION_MS),
      },
    });
    return { enregistre: true };
  }

  async actions(search: SearchAuditDto) {
    const { page, limit } = this.pagination(search);
    const where: Prisma.JournalActiviteWhereInput = {};
    const date = this.dateRange(search);
    if (date) where.date = date;
    if (search.utilisateurId) where.utilisateurId = search.utilisateurId;
    if (search.ressource) where.ressource = search.ressource;
    if (search.methode) where.methode = search.methode.toUpperCase();
    if (search.entiteId) where.entiteId = search.entiteId;
    if (search.resultat === 'echec') where.statutHttp = { gte: 400 };
    if (search.resultat === 'succes')
      where.OR = [{ statutHttp: null }, { statutHttp: { lt: 400 } }];
    const query = search.q?.trim();
    if (query) {
      where.AND = [
        {
          OR: [
            { utilisateurNom: { contains: query, mode: 'insensitive' } },
            { action: { contains: query, mode: 'insensitive' } },
            { ressource: { contains: query, mode: 'insensitive' } },
            { chemin: { contains: query, mode: 'insensitive' } },
            { erreur: { contains: query, mode: 'insensitive' } },
            { entiteId: { contains: query } },
            { ip: { contains: query } },
          ],
        },
      ];
    }
    const [total, data] = await this.prisma.$transaction([
      this.prisma.journalActivite.count({ where }),
      this.prisma.journalActivite.findMany({
        where,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, meta: this.meta(page, limit, total) };
  }

  async navigation(search: SearchAuditDto) {
    const { page, limit } = this.pagination(search);
    const where: Prisma.JournalNavigationWhereInput = {};
    const debut = this.dateRange(search);
    if (debut) where.debut = debut;
    if (search.utilisateurId) where.utilisateurId = search.utilisateurId;
    const query = search.q?.trim();
    if (query) {
      where.OR = [
        { utilisateurNom: { contains: query, mode: 'insensitive' } },
        { titre: { contains: query, mode: 'insensitive' } },
        { page: { contains: query, mode: 'insensitive' } },
      ];
    }
    const [total, data] = await this.prisma.$transaction([
      this.prisma.journalNavigation.count({ where }),
      this.prisma.journalNavigation.findMany({
        where,
        orderBy: [{ debut: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, meta: this.meta(page, limit, total) };
  }

  // Vue d'ensemble de la période : qui a fait quoi, combien de temps, où.
  async synthese(search: SearchAuditDto) {
    const date = this.dateRange(search);
    const whereActions: Prisma.JournalActiviteWhereInput = date ? { date } : {};
    const whereNavigation: Prisma.JournalNavigationWhereInput = date
      ? { debut: date }
      : {};
    const [
      utilisateurs,
      actionsParUtilisateur,
      echecsParUtilisateur,
      tempsParUtilisateur,
      tempsParPage,
      actionsParRessource,
      clicsParUtilisateur,
      clicsParPage,
    ] = await Promise.all([
      this.prisma.utilisateur.findMany({
        select: {
          id: true,
          nom: true,
          prenom: true,
          role: true,
          poste: { select: { nom: true } },
        },
      }),
      this.prisma.journalActivite.groupBy({
        by: ['utilisateurId', 'utilisateurNom'],
        where: whereActions,
        _count: { _all: true },
        _max: { date: true },
      }),
      this.prisma.journalActivite.groupBy({
        by: ['utilisateurId'],
        where: { ...whereActions, statutHttp: { gte: 400 } },
        _count: { _all: true },
      }),
      this.prisma.journalNavigation.groupBy({
        by: ['utilisateurId', 'utilisateurNom'],
        where: whereNavigation,
        _sum: { dureeMs: true },
        _count: { _all: true },
        _max: { debut: true },
      }),
      this.prisma.journalNavigation.groupBy({
        by: ['titre'],
        where: whereNavigation,
        _sum: { dureeMs: true },
        _count: { _all: true },
      }),
      this.prisma.journalActivite.groupBy({
        by: ['ressource'],
        where: whereActions,
        _count: { _all: true },
      }),
      this.prisma.journalInteraction.groupBy({
        by: ['utilisateurId', 'utilisateurNom'],
        where: date ? { date } : {},
        _count: { _all: true },
        _max: { date: true },
      }),
      this.prisma.journalInteraction.groupBy({
        by: ['titre'],
        where: date ? { date } : {},
        _count: { _all: true },
      }),
    ]);

    type Row = {
      utilisateurId: string;
      nom: string;
      role: string | null;
      poste: string | null;
      compteActif: boolean;
      actions: number;
      echecs: number;
      tempsMs: number;
      pagesVues: number;
      clics: number;
      enLigne: boolean;
      derniereActivite: Date | null;
    };
    const rows = new Map<string, Row>();
    const row = (utilisateurId: string, fallbackName: string) => {
      let existing = rows.get(utilisateurId);
      if (!existing) {
        const compte = utilisateurs.find((item) => item.id === utilisateurId);
        existing = {
          utilisateurId,
          nom: compte
            ? [compte.prenom, compte.nom].filter(Boolean).join(' ')
            : fallbackName,
          role: compte?.role ?? null,
          poste: compte?.poste?.nom ?? null,
          compteActif: Boolean(compte),
          actions: 0,
          echecs: 0,
          tempsMs: 0,
          pagesVues: 0,
          clics: 0,
          enLigne: false,
          derniereActivite: null,
        };
        rows.set(utilisateurId, existing);
      }
      return existing;
    };
    const latest = (current: Date | null, candidate: Date | null) =>
      candidate && (!current || candidate > current) ? candidate : current;

    for (const group of actionsParUtilisateur) {
      const target = row(group.utilisateurId, group.utilisateurNom);
      target.actions += group._count._all;
      target.derniereActivite = latest(
        target.derniereActivite,
        group._max.date,
      );
    }
    for (const group of echecsParUtilisateur) {
      const target = rows.get(group.utilisateurId);
      if (target) target.echecs += group._count._all;
    }
    for (const group of tempsParUtilisateur) {
      const target = row(group.utilisateurId, group.utilisateurNom);
      target.tempsMs += group._sum.dureeMs ?? 0;
      target.pagesVues += group._count._all;
      target.derniereActivite = latest(
        target.derniereActivite,
        group._max.debut,
      );
    }

    for (const group of clicsParUtilisateur) {
      const target = row(group.utilisateurId, group.utilisateurNom);
      target.clics += group._count._all;
      target.derniereActivite = latest(
        target.derniereActivite,
        group._max.date,
      );
    }
    // En ligne : une trace d'activité dans les deux dernières minutes.
    const seuilEnLigne = Date.now() - ONLINE_WINDOW_MS;
    for (const target of rows.values()) {
      target.enLigne =
        target.utilisateurId !== 'anonyme' &&
        (target.derniereActivite?.getTime() ?? 0) >= seuilEnLigne;
    }
    const clicsPage = new Map(
      clicsParPage.map((group) => [group.titre, group._count._all]),
    );

    const parUtilisateur = [...rows.values()].sort(
      (first, second) =>
        (second.derniereActivite?.getTime() ?? 0) -
        (first.derniereActivite?.getTime() ?? 0),
    );
    return {
      totaux: {
        actions: parUtilisateur.reduce((sum, item) => sum + item.actions, 0),
        echecs: parUtilisateur.reduce((sum, item) => sum + item.echecs, 0),
        tempsMs: parUtilisateur.reduce((sum, item) => sum + item.tempsMs, 0),
        clics: parUtilisateur.reduce((sum, item) => sum + item.clics, 0),
        enLigne: parUtilisateur.filter((item) => item.enLigne).length,
        utilisateursActifs: parUtilisateur.filter(
          (item) => item.utilisateurId !== 'anonyme',
        ).length,
      },
      parUtilisateur,
      parPage: tempsParPage
        .map((group) => ({
          titre: group.titre,
          tempsMs: group._sum.dureeMs ?? 0,
          visites: group._count._all,
          clics: clicsPage.get(group.titre) ?? 0,
        }))
        .sort((first, second) => second.tempsMs - first.tempsMs),
      parRessource: actionsParRessource
        .map((group) => ({
          ressource: group.ressource,
          actions: group._count._all,
        }))
        .sort((first, second) => second.actions - first.actions),
      utilisateurs: utilisateurs
        .map((item) => ({
          id: item.id,
          nom: [item.prenom, item.nom].filter(Boolean).join(' '),
        }))
        .sort((first, second) => first.nom.localeCompare(second.nom)),
    };
  }

  // Clics dans l'interface, envoyés par lots par le navigateur.
  async recordInteractions(
    dto: CreateInteractionsDto,
    user: { sub: string; nom?: string; prenom?: string },
  ) {
    const text = (value: unknown, max: number) =>
      typeof value === 'string' ? value.trim().slice(0, max) : '';
    const now = Date.now();
    const rows = (Array.isArray(dto.evenements) ? dto.evenements : [])
      .slice(0, MAX_INTERACTIONS_PER_BATCH)
      .map((item) => {
        const date = new Date(item.date);
        return {
          utilisateurId: user.sub,
          utilisateurNom:
            [user.prenom, user.nom].filter(Boolean).join(' ') || user.sub,
          page: text(item.page, 200),
          titre: text(item.titre, 120),
          element: text(item.element, 120),
          type: text(item.type, 30) || 'bouton',
          contexte: text(item.contexte, 120) || null,
          // Une horloge de poste déréglée ne doit pas dater un clic dans le futur.
          date:
            Number.isNaN(date.getTime()) || date.getTime() > now
              ? new Date(now)
              : date,
        };
      })
      .filter((row) => row.page.startsWith('/') && row.element);
    if (rows.length)
      await this.prisma.journalInteraction.createMany({ data: rows });
    return { enregistres: rows.length };
  }

  // Flux unique, du plus récent au plus ancien : actions, refus, navigation et clics.
  async flux(search: SearchAuditDto) {
    const limit = Math.min(Math.max(Number(search.limit ?? 60) || 60, 1), 200);
    const requested = (search.types ?? '')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean);
    const wants = (type: string) =>
      requested.length === 0 || requested.includes(type);
    const range = this.dateRange(search) ?? {};
    const avant = search.avant ? new Date(search.avant) : null;
    if (avant && Number.isNaN(avant.getTime())) {
      throw new BadRequestException('Le curseur du flux est invalide');
    }
    const date: Prisma.DateTimeFilter = avant
      ? { ...range, lt: range.lt && range.lt < avant ? range.lt : avant }
      : range;
    const hasDate = Object.keys(date).length > 0;
    const query = search.q?.trim();
    const utilisateurId = search.utilisateurId || undefined;

    const actionWhere: Prisma.JournalActiviteWhereInput = { utilisateurId };
    if (hasDate) actionWhere.date = date;
    if (search.ressource) actionWhere.ressource = search.ressource;
    if (search.methode) actionWhere.methode = search.methode.toUpperCase();
    if (wants('echec') && !wants('action'))
      actionWhere.statutHttp = { gte: 400 };
    if (wants('action') && !wants('echec') && requested.length > 0)
      actionWhere.OR = [{ statutHttp: null }, { statutHttp: { lt: 400 } }];
    if (query) {
      // Recherche approfondie : aussi dans les valeurs saisies et modifiées.
      const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
      const deep = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "journal_activite"
        WHERE "donnees"::text ILIKE ${pattern} OR "modifications"::text ILIKE ${pattern}
        ORDER BY "date" DESC
        LIMIT 500`;
      actionWhere.AND = [
        {
          OR: [
            { utilisateurNom: { contains: query, mode: 'insensitive' } },
            { action: { contains: query, mode: 'insensitive' } },
            { ressource: { contains: query, mode: 'insensitive' } },
            { chemin: { contains: query, mode: 'insensitive' } },
            { erreur: { contains: query, mode: 'insensitive' } },
            { navigateur: { contains: query, mode: 'insensitive' } },
            { entiteId: { contains: query } },
            { ip: { contains: query } },
            { id: { in: deep.map((row) => row.id) } },
          ],
        },
      ];
    }
    const navigationWhere: Prisma.JournalNavigationWhereInput = {
      utilisateurId,
    };
    if (hasDate) navigationWhere.debut = date;
    const clickWhere: Prisma.JournalInteractionWhereInput = { utilisateurId };
    if (hasDate) clickWhere.date = date;
    if (search.page_) {
      navigationWhere.titre = search.page_;
      clickWhere.titre = search.page_;
    }
    if (query) {
      navigationWhere.OR = [
        { utilisateurNom: { contains: query, mode: 'insensitive' } },
        { titre: { contains: query, mode: 'insensitive' } },
        { page: { contains: query, mode: 'insensitive' } },
      ];
      clickWhere.OR = [
        { utilisateurNom: { contains: query, mode: 'insensitive' } },
        { element: { contains: query, mode: 'insensitive' } },
        { contexte: { contains: query, mode: 'insensitive' } },
        { titre: { contains: query, mode: 'insensitive' } },
        { page: { contains: query, mode: 'insensitive' } },
      ];
    }
    // Un filtre propre aux actions (donnée, type d'action) exclut navigation et clics.
    const actionOnly = Boolean(search.ressource || search.methode);
    const pageOnly = Boolean(search.page_);

    const [actions, visites, clics] = await Promise.all([
      (wants('action') || wants('echec')) && !pageOnly
        ? this.prisma.journalActivite.findMany({
            where: actionWhere,
            orderBy: [{ date: 'desc' }, { id: 'desc' }],
            take: limit,
          })
        : Promise.resolve<JournalActivite[]>([]),
      wants('navigation') && !actionOnly
        ? this.prisma.journalNavigation.findMany({
            where: navigationWhere,
            orderBy: [{ debut: 'desc' }, { id: 'desc' }],
            take: limit,
          })
        : Promise.resolve<JournalNavigation[]>([]),
      wants('clic') && !actionOnly
        ? this.prisma.journalInteraction.findMany({
            where: clickWhere,
            orderBy: [{ date: 'desc' }, { id: 'desc' }],
            take: limit,
          })
        : Promise.resolve<JournalInteraction[]>([]),
    ]);
    const cibles = await resolveEntityLabels(this.prisma, actions);

    const merged = [
      ...actions.map((event) => ({
        genre:
          (event.statutHttp ?? 200) >= 400
            ? ('echec' as const)
            : ('action' as const),
        ...event,
        cible: cibles.get(event) ?? null,
      })),
      ...visites.map((visit) => ({
        genre: 'navigation' as const,
        ...visit,
        date: visit.debut,
      })),
      ...clics.map((click) => ({ genre: 'clic' as const, ...click })),
    ]
      .sort((first, second) => second.date.getTime() - first.date.getTime())
      .slice(0, limit);
    return {
      data: merged,
      // Curseur de la page suivante : tout ce qui est strictement plus ancien.
      suivant:
        merged.length === limit
          ? merged[merged.length - 1].date.toISOString()
          : null,
    };
  }

  // Volume d'activité dans le temps, par heure (périodes courtes) ou par jour.
  async chronologie(search: SearchAuditDto) {
    const range = this.dateRange(search);
    const fin = range?.lt instanceof Date ? range.lt : new Date();
    const debut =
      range?.gte instanceof Date
        ? range.gte
        : new Date(fin.getTime() - 7 * DAY_MS);
    const hourly = fin.getTime() - debut.getTime() <= 2 * DAY_MS;
    const unit = Prisma.raw(hourly ? `'hour'` : `'day'`);
    const user = search.utilisateurId
      ? Prisma.sql`AND "utilisateurId" = ${search.utilisateurId}`
      : Prisma.empty;
    type Bucket = { t: Date; a: bigint; b: bigint };
    const [actions, clics, visites] = await Promise.all([
      this.prisma.$queryRaw<Bucket[]>`
        SELECT date_trunc(${unit}, "date") AS t,
               count(*) FILTER (WHERE "statutHttp" IS NULL OR "statutHttp" < 400) AS a,
               count(*) FILTER (WHERE "statutHttp" >= 400) AS b
        FROM "journal_activite"
        WHERE "date" >= ${debut} AND "date" < ${fin} ${user}
        GROUP BY 1`,
      this.prisma.$queryRaw<Bucket[]>`
        SELECT date_trunc(${unit}, "date") AS t, count(*) AS a, 0::bigint AS b
        FROM "journal_interactions"
        WHERE "date" >= ${debut} AND "date" < ${fin} ${user}
        GROUP BY 1`,
      this.prisma.$queryRaw<Bucket[]>`
        SELECT date_trunc(${unit}, "debut") AS t, count(*) AS a, coalesce(sum("dureeMs"), 0)::bigint AS b
        FROM "journal_navigation"
        WHERE "debut" >= ${debut} AND "debut" < ${fin} ${user}
        GROUP BY 1`,
    ]);
    const step = hourly ? 60 * 60 * 1000 : DAY_MS;
    const index = (rows: Bucket[]) =>
      new Map(rows.map((row) => [new Date(row.t).getTime(), row]));
    const byAction = index(actions);
    const byClick = index(clics);
    const byVisit = index(visites);
    const buckets: Array<{
      debut: string;
      actions: number;
      echecs: number;
      clics: number;
      visites: number;
      tempsMs: number;
    }> = [];
    const first = Math.floor(debut.getTime() / step) * step;
    for (let time = first; time < fin.getTime(); time += step) {
      buckets.push({
        debut: new Date(time).toISOString(),
        actions: Number(byAction.get(time)?.a ?? 0),
        echecs: Number(byAction.get(time)?.b ?? 0),
        clics: Number(byClick.get(time)?.a ?? 0),
        visites: Number(byVisit.get(time)?.a ?? 0),
        tempsMs: Number(byVisit.get(time)?.b ?? 0),
      });
    }
    return { pas: hourly ? 'heure' : 'jour', buckets };
  }

  // Profil d'un utilisateur : où il a passé son temps, son parcours, ses clics.
  async profil(utilisateurId: string, search: SearchAuditDto) {
    const range = this.dateRange(search);
    const visitWhere: Prisma.JournalNavigationWhereInput = {
      utilisateurId,
      ...(range ? { debut: range } : {}),
    };
    const clickWhere: Prisma.JournalInteractionWhereInput = {
      utilisateurId,
      ...(range ? { date: range } : {}),
    };
    const actionWhere: Prisma.JournalActiviteWhereInput = {
      utilisateurId,
      ...(range ? { date: range } : {}),
    };
    const [
      compte,
      tempsParPage,
      parcours,
      clicsParElement,
      clicsParPage,
      actionsParType,
      echecs,
      appareils,
    ] = await Promise.all([
      this.prisma.utilisateur.findUnique({
        where: { id: utilisateurId },
        select: {
          id: true,
          nom: true,
          prenom: true,
          email: true,
          role: true,
          poste: { select: { nom: true } },
        },
      }),
      this.prisma.journalNavigation.groupBy({
        by: ['titre'],
        where: visitWhere,
        _sum: { dureeMs: true },
        _count: { _all: true },
      }),
      this.prisma.journalNavigation.findMany({
        where: visitWhere,
        orderBy: [{ debut: 'desc' }, { id: 'desc' }],
        take: 80,
      }),
      this.prisma.journalInteraction.groupBy({
        by: ['element', 'titre'],
        where: clickWhere,
        _count: { _all: true },
        orderBy: { _count: { element: 'desc' } },
        take: 20,
      }),
      this.prisma.journalInteraction.groupBy({
        by: ['titre'],
        where: clickWhere,
        _count: { _all: true },
      }),
      this.prisma.journalActivite.groupBy({
        by: ['action'],
        where: actionWhere,
        _count: { _all: true },
        orderBy: { _count: { action: 'desc' } },
        take: 12,
      }),
      this.prisma.journalActivite.count({
        where: { ...actionWhere, statutHttp: { gte: 400 } },
      }),
      this.prisma.journalActivite.groupBy({
        by: ['ip', 'navigateur'],
        where: actionWhere,
        _count: { _all: true },
        _max: { date: true },
      }),
    ]);
    const clics = new Map(
      clicsParPage.map((group) => [group.titre, group._count._all]),
    );
    return {
      utilisateur: compte
        ? {
            id: compte.id,
            nom: [compte.prenom, compte.nom].filter(Boolean).join(' '),
            email: compte.email,
            role: compte.role,
            poste: compte.poste?.nom ?? null,
          }
        : null,
      totaux: {
        tempsMs: tempsParPage.reduce(
          (sum, group) => sum + (group._sum.dureeMs ?? 0),
          0,
        ),
        visites: tempsParPage.reduce(
          (sum, group) => sum + group._count._all,
          0,
        ),
        clics: clicsParPage.reduce((sum, group) => sum + group._count._all, 0),
        actions: actionsParType.reduce(
          (sum, group) => sum + group._count._all,
          0,
        ),
        echecs,
      },
      tempsParPage: tempsParPage
        .map((group) => ({
          titre: group.titre,
          tempsMs: group._sum.dureeMs ?? 0,
          visites: group._count._all,
          clics: clics.get(group.titre) ?? 0,
        }))
        .sort((first, second) => second.tempsMs - first.tempsMs),
      parcours,
      clicsParElement: clicsParElement.map((group) => ({
        element: group.element,
        titre: group.titre,
        clics: group._count._all,
      })),
      actionsParType: actionsParType.map((group) => ({
        action: group.action,
        total: group._count._all,
      })),
      appareils: appareils
        .filter((group) => group.ip || group.navigateur)
        .map((group) => ({
          ip: group.ip,
          navigateur: group.navigateur,
          actions: group._count._all,
          derniereUtilisation: group._max.date,
        }))
        .sort(
          (first, second) =>
            (second.derniereUtilisation?.getTime() ?? 0) -
            (first.derniereUtilisation?.getTime() ?? 0),
        ),
    };
  }

  private dateRange(search: SearchAuditDto): Prisma.DateTimeFilter | null {
    const debut = parseAuditDay(search.dateDebut);
    const fin = parseAuditDay(search.dateFin);
    if ((search.dateDebut && !debut) || (search.dateFin && !fin)) {
      throw new BadRequestException(
        'Les dates doivent etre au format AAAA-MM-JJ',
      );
    }
    if (!debut && !fin) return null;
    if (debut && fin && fin < debut) {
      throw new BadRequestException(
        'La date de fin doit suivre la date de debut',
      );
    }
    const range: Prisma.DateTimeFilter = {};
    if (debut) range.gte = debut;
    if (fin) {
      const finExclusive = new Date(fin);
      finExclusive.setUTCDate(finExclusive.getUTCDate() + 1);
      range.lt = finExclusive;
    }
    return range;
  }

  private pagination(search: SearchAuditDto) {
    const page = Number(search.page ?? 1);
    const limit = Number(search.limit ?? 50);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1
    ) {
      throw new BadRequestException(
        'Les paramètres de pagination sont invalides',
      );
    }
    return { page, limit: Math.min(limit, 500) };
  }

  private meta(page: number, limit: number, total: number) {
    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }
}
