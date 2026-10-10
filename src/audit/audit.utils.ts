const SECRET_KEY = /mot.?de.?passe|password|token|secret/i;
const MAX_STRING = 2000;

// Copie sérialisable d'une valeur, sans les secrets : ce qui est journalisé
// ne doit jamais contenir de mot de passe ni de jeton.
export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string')
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 6) return '[…]';
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => sanitizeForAudit(item, depth + 1));
  if (typeof value === 'object') {
    // Decimal de Prisma et objets équivalents : leur forme texte suffit.
    const json = (value as { toJSON?: () => unknown }).toJSON;
    if (typeof json === 'function' && depth < 6) {
      const serialized: unknown = json.call(value);
      if (typeof serialized !== 'object' || serialized === null)
        return sanitizeForAudit(serialized, depth + 1);
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? '•••' : sanitizeForAudit(item, depth + 1),
      ]),
    );
  }
  return typeof value === 'bigint' ? value.toString() : null;
}

export type AuditChange = { champ: string; avant: unknown; apres: unknown };

function isScalar(value: unknown) {
  return value === null || typeof value !== 'object';
}

// Compare l'état avant/après d'un enregistrement, champ simple par champ simple.
export function diffForAudit(before: unknown, after: unknown): AuditChange[] {
  const previous = sanitizeForAudit(before);
  const next = sanitizeForAudit(after);
  if (
    !previous ||
    !next ||
    typeof previous !== 'object' ||
    typeof next !== 'object' ||
    Array.isArray(previous) ||
    Array.isArray(next)
  )
    return [];
  const changes: AuditChange[] = [];
  for (const [champ, avant] of Object.entries(previous)) {
    if (!(champ in next)) continue;
    const apres = (next as Record<string, unknown>)[champ];
    const comparable =
      (isScalar(avant) && isScalar(apres)) ||
      (Array.isArray(avant) && Array.isArray(apres));
    if (!comparable) continue;
    if (JSON.stringify(avant) !== JSON.stringify(apres))
      changes.push({ champ, avant, apres });
  }
  return changes;
}

export function parseAuditDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
