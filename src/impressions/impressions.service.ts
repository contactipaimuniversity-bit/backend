import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const TYPES_DOCUMENT = [
  'RECU_PAIEMENT',
  'RECU_REMBOURSEMENT',
  'CERTIFICAT_BOURSE',
  'CERTIFICAT_INSCRIPTION',
  'BON_COMMANDE',
  'RAPPORT_ACTIVITE',
  'BULLETIN_NOTES',
  'PV_DELIBERATION',
  'BULLETIN_PAIE',
  'CARTE_ETUDIANT',
  'RELEVE_NOTES',
  'ATTESTATION_REUSSITE',
  'DIPLOME',
] as const;
const MODES = ['IMPRESSION', 'PDF'] as const;
const DOSSIERS = ['demande-bourse', 'inscription', 'depense'] as const;
// Une impression faite hors ligne est déclarée au retour de la connexion.
const RETARD_MAX_MS = 30 * 24 * 60 * 60 * 1000;

export type ImpressionBody = {
  typeDocument?: unknown;
  mode?: unknown;
  dossierType?: unknown;
  dossierId?: unknown;
  libelle?: unknown;
  reference?: unknown;
  date?: unknown;
};

type Auteur = { sub: string; nom?: string; prenom?: string; email?: string };

@Injectable()
export class ImpressionsService {
  constructor(private readonly prisma: PrismaService) {}

  private text(value: unknown, max: number): string | null {
    return typeof value === 'string' && value.trim()
      ? value.trim().slice(0, max)
      : null;
  }

  async create(body: ImpressionBody, auteur: Auteur) {
    const typeDocument = TYPES_DOCUMENT.find(
      (item) => item === body.typeDocument,
    );
    const mode = MODES.find((item) => item === body.mode);
    const libelle = this.text(body.libelle, 200);
    if (!typeDocument || !mode || !libelle)
      throw new BadRequestException('Impression mal décrite');
    const declared = new Date(typeof body.date === 'string' ? body.date : '');
    const now = Date.now();
    // L'heure du poste n'est retenue que si elle est plausible.
    const date =
      !Number.isNaN(declared.getTime()) &&
      declared.getTime() <= now &&
      declared.getTime() >= now - RETARD_MAX_MS
        ? declared
        : new Date(now);
    return this.prisma.impression.create({
      data: {
        typeDocument,
        mode,
        dossierType: DOSSIERS.find((item) => item === body.dossierType) ?? null,
        dossierId: this.text(body.dossierId, 64),
        libelle,
        reference: this.text(body.reference, 120),
        utilisateurId: auteur.sub,
        utilisateurNom:
          [auteur.prenom, auteur.nom].filter(Boolean).join(' ') ||
          auteur.email ||
          auteur.sub,
        date,
      },
      select: { id: true },
    });
  }

  async findAll(query: {
    q?: string;
    typeDocument?: string;
    utilisateurId?: string;
    dateDebut?: string;
    dateFin?: string;
    page?: string;
    limit?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const q = query.q?.trim();
    const debut = new Date(query.dateDebut ?? '');
    const fin = new Date(query.dateFin ?? '');
    const typeDocument = TYPES_DOCUMENT.find(
      (item) => item === query.typeDocument,
    );
    const where = {
      ...(typeDocument ? { typeDocument } : {}),
      ...(query.utilisateurId ? { utilisateurId: query.utilisateurId } : {}),
      ...(!Number.isNaN(debut.getTime()) || !Number.isNaN(fin.getTime())
        ? {
            date: {
              ...(!Number.isNaN(debut.getTime()) ? { gte: debut } : {}),
              ...(!Number.isNaN(fin.getTime()) ? { lte: fin } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { libelle: { contains: q, mode: 'insensitive' as const } },
              { reference: { contains: q, mode: 'insensitive' as const } },
              { utilisateurNom: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, data, auteurs] = await Promise.all([
      this.prisma.impression.count({ where }),
      this.prisma.impression.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.impression.findMany({
        distinct: ['utilisateurId'],
        select: { utilisateurId: true, utilisateurNom: true },
        orderBy: { utilisateurNom: 'asc' },
      }),
    ]);
    return {
      data,
      auteurs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
