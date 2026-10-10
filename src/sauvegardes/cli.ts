import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dechiffrer } from './chiffrement';
import {
  compterLignes,
  connexion,
  lireEntete,
  restaurer,
  sauvegarder,
  testerRestauration,
  viderTables,
} from './sauvegarde.core';

// Sauvegarde et restauration en ligne de commande, utilisables même si
// l'application ne démarre plus :
//   npm run sauvegarde:creer
//   npm run sauvegarde:tester -- <fichier>
//   npm run sauvegarde:restaurer -- <fichier> --confirmer [--ecraser] [--cible <url>]
//   npm run sauvegarde:dechiffrer -- <fichier.chiffre>   (copie externe → fichier .gz)

const [commande, ...reste] = process.argv.slice(2);
const option = (nom: string) => reste.includes(nom);
const valeur = (nom: string) => {
  const index = reste.indexOf(nom);
  return index >= 0 ? reste[index + 1] : undefined;
};
const fichierDemande = () => {
  const fichier = reste.find((argument) => argument.endsWith('.gz'));
  if (!fichier) throw new Error('Indiquez le fichier de sauvegarde (.gz)');
  return resolve(fichier);
};

async function main() {
  if (commande === 'dechiffrer') {
    const source = reste.find((argument) => !argument.startsWith('--'));
    if (!source) throw new Error('Indiquez le fichier chiffré à déchiffrer');
    const phrase = valeur('--cle') ?? process.env.BACKUP_ENCRYPTION_KEY;
    if (!phrase)
      throw new Error(
        'Phrase secrète absente : BACKUP_ENCRYPTION_KEY ou --cle <phrase>',
      );
    const destination = resolve(source).replace(/\.chiffre$/, '');
    if (destination === resolve(source))
      throw new Error('Le fichier attendu se termine par .chiffre');
    await writeFile(
      destination,
      dechiffrer(await readFile(resolve(source)), phrase),
    );
    console.log(`Sauvegarde déchiffrée : ${destination}`);
    return;
  }

  const url = valeur('--cible') ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL est absent');

  if (commande === 'creer') {
    const dossier = resolve(
      process.env.BACKUP_DIR ?? join(process.cwd(), 'backups'),
    );
    await mkdir(dossier, { recursive: true });
    const horodatage = new Date()
      .toISOString()
      .replace(/[:T]/g, '-')
      .slice(0, 19);
    const fichier = join(dossier, `ipaim-${horodatage}.sauvegarde.gz`);
    const entete = await sauvegarder(url, fichier);
    const lignes = entete.tables.reduce(
      (total, table) => total + table.lignes,
      0,
    );
    console.log(`Sauvegarde créée : ${fichier}`);
    console.log(`${lignes} lignes dans ${entete.tables.length} tables`);
    return;
  }

  if (commande === 'tester') {
    const bilan = await testerRestauration(
      url,
      fichierDemande(),
      join(process.cwd(), 'prisma', 'migrations'),
    );
    if (bilan.ecarts.length) {
      console.error('Écarts constatés :');
      for (const ecart of bilan.ecarts) console.error(` - ${ecart}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `Restauration vérifiée : ${bilan.lignes} lignes dans ${bilan.tables} tables, identiques à la sauvegarde`,
    );
    return;
  }

  if (commande === 'restaurer') {
    const fichier = fichierDemande();
    const entete = await lireEntete(fichier);
    const hote = new URL(url);
    console.log(
      `Sauvegarde du ${entete.date} → base « ${hote.pathname.slice(1)} » sur ${hote.host}`,
    );
    if (!option('--confirmer'))
      throw new Error(
        'Ajoutez --confirmer pour lancer la restauration dans cette base',
      );
    const client = connexion(url);
    await client.connect();
    try {
      const existantes = await compterLignes(client);
      if (existantes > 0) {
        if (!option('--ecraser'))
          throw new Error(
            `La base cible contient déjà ${existantes} lignes (une base tout juste migrée en contient quelques-unes, créées par les migrations). Ajoutez --ecraser pour remplacer TOUTES ses données par celles de la sauvegarde.`,
          );
        await viderTables(client);
        console.log(`${existantes} lignes existantes effacées`);
      }
      const bilan = await restaurer(client, fichier);
      if (bilan.ecarts.length) {
        console.error('Restauration terminée avec des écarts :');
        for (const ecart of bilan.ecarts) console.error(` - ${ecart}`);
        process.exitCode = 1;
        return;
      }
      console.log(
        `Restauration réussie : ${bilan.lignes} lignes dans ${bilan.tables} tables`,
      );
    } finally {
      await client.end();
    }
    return;
  }

  throw new Error('Commande attendue : creer, tester, restaurer ou dechiffrer');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
