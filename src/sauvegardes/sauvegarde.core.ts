import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { Client } from 'pg';

// Sauvegarde et restauration de la base, sans dépendre d'un outil installé sur
// le serveur. Le fichier est un texte compressé : une ligne d'en-tête, puis une
// ligne par table. Les valeurs sont conservées telles que PostgreSQL les écrit,
// ce qui garantit une restauration fidèle (dates, montants, listes, JSON).

export type EnteteSauvegarde = {
  version: 1;
  date: string;
  migrations: string[];
  tables: Array<{ nom: string; lignes: number }>;
};

type LigneTable = {
  table: string;
  colonnes: string[];
  lignes: Array<Array<string | null>>;
};

// Table tenue par l'outil de migration : elle est recréée par les migrations elles-mêmes.
const TABLE_MIGRATIONS = '_prisma_migrations';
const identifiant = (nom: string) => `"${nom.replace(/"/g, '""')}"`;

// Connexion qui rend chaque valeur sous sa forme texte d'origine.
export function connexion(url: string): Client {
  return new Client({
    connectionString: url,
    types: { getTypeParser: () => (value: string) => value },
  });
}

async function tablesPubliques(client: Client): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

export async function sauvegarder(
  url: string,
  fichier: string,
): Promise<EnteteSauvegarde> {
  const client = connexion(url);
  await client.connect();
  try {
    // Photographie cohérente : toutes les tables sont lues au même instant.
    await client.query('begin isolation level repeatable read read only');
    const tables = (await tablesPubliques(client)).filter(
      (table) => table !== TABLE_MIGRATIONS,
    );
    const migrations = await client
      .query<{ migration_name: string }>(
        `select migration_name from ${identifiant(TABLE_MIGRATIONS)}
         where finished_at is not null order by migration_name`,
      )
      .then((result) => result.rows.map((row) => row.migration_name))
      .catch(() => [] as string[]);
    const contenus: LigneTable[] = [];
    for (const table of tables) {
      const result = await client.query({
        text: `select * from ${identifiant(table)}`,
        rowMode: 'array',
      });
      contenus.push({
        table,
        colonnes: result.fields.map((field) => field.name),
        lignes: result.rows as Array<Array<string | null>>,
      });
    }
    await client.query('commit');
    const entete: EnteteSauvegarde = {
      version: 1,
      date: new Date().toISOString(),
      migrations,
      tables: contenus.map((contenu) => ({
        nom: contenu.table,
        lignes: contenu.lignes.length,
      })),
    };
    const gzip = createGzip({ level: 9 });
    const sortie = createWriteStream(fichier);
    gzip.pipe(sortie);
    gzip.write(`${JSON.stringify(entete)}\n`);
    for (const contenu of contenus) gzip.write(`${JSON.stringify(contenu)}\n`);
    gzip.end();
    await finished(sortie);
    return entete;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function* lire(fichier: string): AsyncGenerator<unknown> {
  const lignes = createInterface({
    input: createReadStream(fichier).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const ligne of lignes) if (ligne.trim()) yield JSON.parse(ligne);
}

export async function lireEntete(fichier: string): Promise<EnteteSauvegarde> {
  for await (const ligne of lire(fichier)) {
    const entete = ligne as EnteteSauvegarde;
    if (entete.version !== 1 || !Array.isArray(entete.tables))
      throw new Error("Ce fichier n'est pas une sauvegarde reconnue");
    return entete;
  }
  throw new Error('Sauvegarde vide');
}

type Lien = { table: string; colonne: string; cible: string };

// Ordre d'insertion qui respecte les liens entre tables. Un lien qui forme une
// boucle (une table qui se référence, par exemple) est rempli dans un second temps.
async function planDeRestauration(client: Client, tables: string[]) {
  const result = await client.query<{
    table_name: string;
    column_name: string;
    cible: string;
  }>(
    `select tc.table_name, kcu.column_name, ccu.table_name as cible
     from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu
       on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
     join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
     where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`,
  );
  const liens: Lien[] = result.rows.map((row) => ({
    table: row.table_name,
    colonne: row.column_name,
    cible: row.cible,
  }));
  const ordre: string[] = [];
  const differes: Lien[] = [];
  const restantes = new Set(tables);
  while (restantes.size) {
    const prete = [...restantes].find((table) =>
      liens.every(
        (lien) =>
          lien.table !== table ||
          differes.includes(lien) ||
          !restantes.has(lien.cible),
      ),
    );
    if (prete) {
      ordre.push(prete);
      restantes.delete(prete);
      continue;
    }
    // Boucle : on diffère un lien pour débloquer la suite.
    const boucle = liens.find(
      (lien) =>
        restantes.has(lien.table) &&
        restantes.has(lien.cible) &&
        !differes.includes(lien),
    );
    if (!boucle) throw new Error('Ordre de restauration introuvable');
    differes.push(boucle);
  }
  return { ordre, differes };
}

export type BilanRestauration = {
  tables: number;
  lignes: number;
  ecarts: string[];
};

// Charge une sauvegarde dans une base dont les tables existent déjà et sont vides.
export async function restaurer(
  client: Client,
  fichier: string,
): Promise<BilanRestauration> {
  const entete = await lireEntete(fichier);
  const presentes = new Set(await tablesPubliques(client));
  const contenus = new Map<string, LigneTable>();
  let premiere = true;
  for await (const ligne of lire(fichier)) {
    if (premiere) {
      premiere = false;
      continue;
    }
    const contenu = ligne as LigneTable;
    contenus.set(contenu.table, contenu);
  }
  const manquantes = [...contenus.keys()].filter(
    (table) => !presentes.has(table),
  );
  if (manquantes.length)
    throw new Error(
      `La base cible n'a pas les tables ${manquantes.join(', ')} : appliquez d'abord les migrations de la sauvegarde`,
    );
  const { ordre, differes } = await planDeRestauration(client, [
    ...contenus.keys(),
  ]);
  let total = 0;
  await client.query('begin');
  try {
    const aCompleter: Array<{ lien: Lien; id: string; valeur: string }> = [];
    for (const table of ordre) {
      const contenu = contenus.get(table)!;
      if (!contenu.lignes.length) continue;
      const liensDifferes = differes.filter((lien) => lien.table === table);
      const indexId = contenu.colonnes.indexOf('id');
      const colonnes = contenu.colonnes.map(identifiant).join(', ');
      // PostgreSQL accepte au plus 65 535 paramètres par requête.
      const parLot = Math.max(
        1,
        Math.min(500, Math.floor(60_000 / contenu.colonnes.length)),
      );
      for (let debut = 0; debut < contenu.lignes.length; debut += parLot) {
        const lot = contenu.lignes.slice(debut, debut + parLot);
        const valeurs: Array<string | null> = [];
        const emplacements = lot.map((ligne) => {
          const copie = [...ligne];
          for (const lien of liensDifferes) {
            const index = contenu.colonnes.indexOf(lien.colonne);
            const valeur = copie[index];
            if (valeur === null) continue;
            if (indexId < 0)
              throw new Error(
                `La table ${table} ne peut pas être restaurée en deux temps`,
              );
            aCompleter.push({ lien, id: copie[indexId]!, valeur });
            copie[index] = null;
          }
          const depart = valeurs.length;
          valeurs.push(...copie);
          return `(${copie.map((_, index) => `$${depart + index + 1}`).join(', ')})`;
        });
        await client.query(
          `insert into ${identifiant(table)} (${colonnes}) values ${emplacements.join(', ')}`,
          valeurs,
        );
      }
      total += contenu.lignes.length;
    }
    for (const { lien, id, valeur } of aCompleter)
      await client.query(
        `update ${identifiant(lien.table)} set ${identifiant(lien.colonne)} = $1 where id = $2`,
        [valeur, id],
      );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
  // Contrôle : chaque table contient exactement le nombre de lignes sauvegardé.
  const ecarts: string[] = [];
  for (const table of entete.tables) {
    const compte = await client.query<{ total: string }>(
      `select count(*) as total from ${identifiant(table.nom)}`,
    );
    if (Number(compte.rows[0].total) !== table.lignes)
      ecarts.push(
        `${table.nom} : ${compte.rows[0].total} ligne(s) au lieu de ${table.lignes}`,
      );
  }
  return { tables: entete.tables.length, lignes: total, ecarts };
}

// Recrée les tables dans une base vide en rejouant les migrations du projet.
export async function appliquerMigrations(
  client: Client,
  dossierMigrations: string,
  seulement?: string[],
): Promise<number> {
  const dossiers = (await readdir(dossierMigrations, { withFileTypes: true }))
    .filter((entree) => entree.isDirectory())
    .map((entree) => entree.name)
    .filter((nom) => !seulement?.length || seulement.includes(nom))
    .sort();
  for (const dossier of dossiers)
    await client.query(
      await readFile(join(dossierMigrations, dossier, 'migration.sql'), 'utf8'),
    );
  return dossiers.length;
}

export async function compterLignes(client: Client): Promise<number> {
  let total = 0;
  for (const table of await tablesPubliques(client)) {
    if (table === TABLE_MIGRATIONS) continue;
    const compte = await client.query<{ total: string }>(
      `select count(*) as total from ${identifiant(table)}`,
    );
    total += Number(compte.rows[0].total);
  }
  return total;
}

export async function viderTables(client: Client): Promise<void> {
  const tables = (await tablesPubliques(client)).filter(
    (table) => table !== TABLE_MIGRATIONS,
  );
  if (tables.length)
    await client.query(
      `truncate table ${tables.map(identifiant).join(', ')} cascade`,
    );
}

// Restaure la sauvegarde dans une base jetable, compare, puis supprime cette base.
export async function testerRestauration(
  url: string,
  fichier: string,
  dossierMigrations: string,
): Promise<BilanRestauration> {
  const entete = await lireEntete(fichier);
  const nom = `ipaim_test_restauration_${Date.now()}`;
  const admin = connexion(url);
  await admin.connect();
  try {
    await admin.query(`create database ${identifiant(nom)}`);
    try {
      const cible = new URL(url);
      cible.pathname = `/${nom}`;
      const client = connexion(cible.toString());
      await client.connect();
      try {
        await appliquerMigrations(client, dossierMigrations, entete.migrations);
        // Certaines migrations créent des données de référence : la sauvegarde
        // les contient déjà, on repart donc de tables vides.
        await viderTables(client);
        return await restaurer(client, fichier);
      } finally {
        await client.end().catch(() => undefined);
      }
    } finally {
      await admin.query(`drop database if exists ${identifiant(nom)}`);
    }
  } finally {
    await admin.end().catch(() => undefined);
  }
}
