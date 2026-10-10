import type { Request } from 'express';

// Une saisie faite hors ligne n'arrive au serveur qu'à la synchronisation.
// L'appareil transmet alors, en en-têtes, l'heure réelle de la saisie et
// l'identifiant qu'il a donné à l'enregistrement (repris sur le reçu remis).
// Une valeur absente ou invraisemblable est ignorée : le serveur garde alors
// son heure et son identifiant, sans bloquer l'envoi.

const ANCIENNETE_MAX_MS = 60 * 24 * 60 * 60 * 1000;
const AVANCE_MAX_MS = 5 * 60 * 1000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SaisieLocale = { date?: Date; id?: string };

export function dateSaisieLocale(request: Request): Date | undefined {
  const brut = request.get('x-saisie-le');
  if (!brut) return undefined;
  const date = new Date(brut);
  const ecart = Date.now() - date.getTime();
  if (
    Number.isNaN(ecart) ||
    ecart < -AVANCE_MAX_MS ||
    ecart > ANCIENNETE_MAX_MS
  )
    return undefined;
  return date;
}

export function saisieLocale(request: Request): SaisieLocale {
  const id = request.get('x-identifiant-local');
  return {
    date: dateSaisieLocale(request),
    id: id && UUID.test(id) ? id.toLowerCase() : undefined,
  };
}
