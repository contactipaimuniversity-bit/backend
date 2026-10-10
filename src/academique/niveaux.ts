import type { $Enums } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Niveaux d'études : un référentiel modifiable, plus rien n'est écrit en dur.

export type NiveauEtude = {
  id: string;
  code: string;
  libelle: string;
  cycle: string;
  rang: number;
  diplome: string | null;
  actif: boolean;
};

// Point de départ d'un établissement qui n'a encore rien réglé.
export const NIVEAUX_DEFAUT = [
  { code: 'L1', libelle: 'Première année', cycle: 'Licence', rang: 1 },
  { code: 'L2', libelle: 'Deuxième année', cycle: 'Licence', rang: 2 },
];

type Client = Pick<PrismaService, 'niveau'>;

export async function niveauxConnus(client: Client): Promise<NiveauEtude[]> {
  const ordre = [{ cycle: 'asc' as const }, { rang: 'asc' as const }];
  const niveaux = await client.niveau.findMany({ orderBy: ordre });
  if (niveaux.length) return niveaux;
  await client.niveau.createMany({
    data: NIVEAUX_DEFAUT,
    skipDuplicates: true,
  });
  return client.niveau.findMany({ orderBy: ordre });
}

// Niveau suivant dans le cycle ; null quand le parcours se termine ici.
export function niveauSuivant(
  niveaux: NiveauEtude[],
  code: string,
  niveauFinal?: string | null,
): NiveauEtude | null {
  if (niveauFinal && niveauFinal === code) return null;
  const actuel = niveaux.find((niveau) => niveau.code === code);
  if (!actuel) return null;
  return (
    niveaux
      .filter(
        (niveau) =>
          niveau.actif &&
          niveau.cycle === actuel.cycle &&
          niveau.rang > actuel.rang,
      )
      .sort((a, b) => a.rang - b.rang)[0] ?? null
  );
}

// Pièces et frais dus selon le rang : première année, deuxième, ou au-delà.
export function niveauxApplicables(rang: number): $Enums.NiveauApplicable[] {
  if (rang <= 1) return ['PREMIERE_ANNEE', 'TOUS'];
  if (rang === 2) return ['DEUXIEME_ANNEE', 'DEUXIEME_ANNEE_PLUS', 'TOUS'];
  return ['DEUXIEME_ANNEE_PLUS', 'TOUS'];
}
