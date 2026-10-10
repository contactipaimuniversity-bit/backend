import { BadRequestException, ForbiddenException } from '@nestjs/common';

// Lecture et contrôle des valeurs saisies, communs à tous les modules de gestion.

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function exiger(blocage: string | null): void {
  if (blocage) throw new ForbiddenException(blocage);
}

// Saisie brute d'un champ : seuls un texte ou un nombre sont acceptés.
export function saisie(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

function nombre(value: unknown): { texte: string; valeur: number } {
  const texte = saisie(value).trim().replace(/\s/g, '').replace(',', '.');
  return { texte, valeur: Number(texte) };
}

export function parseMontant(value: unknown, libelle: string): number {
  const { texte, valeur } = nombre(value);
  if (!texte || !Number.isFinite(valeur) || valeur <= 0)
    throw new BadRequestException(`${libelle} doit être strictement positif`);
  if (!/^\d+(\.\d{1,2})?$/.test(texte))
    throw new BadRequestException(
      `${libelle} doit avoir au maximum 2 décimales`,
    );
  if (valeur > 9_999_999_999.99)
    throw new BadRequestException(`${libelle} dépasse la limite autorisée`);
  return roundMoney(valeur);
}

// Nombre positif ou nul, borné (montant facultatif, taux, coefficient, note…).
export function parseNombre(
  value: unknown,
  libelle: string,
  min = 0,
  max = 9_999_999_999,
): number {
  const { texte, valeur } = nombre(value);
  if (!texte || !Number.isFinite(valeur) || valeur < min || valeur > max)
    throw new BadRequestException(
      `${libelle} doit être compris entre ${min} et ${max}`,
    );
  return valeur;
}

export function parseEntier(
  value: unknown,
  libelle: string,
  min = 0,
  max = 1_000_000,
): number {
  const valeur = parseNombre(value, libelle, min, max);
  if (!Number.isInteger(valeur))
    throw new BadRequestException(`${libelle} doit être un nombre entier`);
  return valeur;
}

export function texteRequis(
  value: unknown,
  libelle: string,
  longueurMin = 1,
  longueurMax = 2000,
): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < longueurMin)
    throw new BadRequestException(
      longueurMin > 1
        ? `${libelle} : au moins ${longueurMin} caractères sont attendus`
        : `${libelle} est obligatoire`,
    );
  if (text.length > longueurMax)
    throw new BadRequestException(`${libelle} est trop long`);
  return text;
}

export function texteOptionnel(
  value: unknown,
  longueurMax = 500,
): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > longueurMax)
    throw new BadRequestException('Texte trop long');
  return text || null;
}

export function choix<T extends string>(
  value: unknown,
  valeurs: readonly T[],
  libelle: string,
): T {
  const found = valeurs.find((item) => item === value);
  if (!found)
    throw new BadRequestException(
      `${libelle} : valeur attendue parmi ${valeurs.join(', ')}`,
    );
  return found;
}

// Une date saisie sans heure arrive à minuit UTC : là où l'heure locale est en
// avance sur UTC, « aujourd'hui » paraît dans le futur juste après minuit. On
// tolère donc le plus grand décalage horaire possible.
const DECALAGE_HORAIRE_MAX_MS = 14 * 60 * 60 * 1000;

export function estDansLeFutur(date: Date): boolean {
  return date.getTime() > Date.now() + DECALAGE_HORAIRE_MAX_MS;
}

export function parseDate(value: unknown, libelle: string): Date {
  const date = new Date(typeof value === 'string' ? value : '');
  if (Number.isNaN(date.getTime()))
    throw new BadRequestException(`${libelle} est invalide`);
  return date;
}

export function dateOptionnelle(value: unknown, libelle: string): Date | null {
  return typeof value === 'string' && value.trim()
    ? parseDate(value, libelle)
    : null;
}

// Heure au format HH:MM.
export function parseHeure(value: unknown, libelle: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text))
    throw new BadRequestException(`${libelle} doit être au format HH:MM`);
  return text;
}

export function minutes(heure: string): number {
  const [h, m] = heure.split(':').map(Number);
  return h * 60 + m;
}

export function pagination(
  query: { page?: string; limit?: string },
  defaut = 20,
) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || defaut));
  return { page, limit, skip: (page - 1) * limit };
}

export function meta(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
