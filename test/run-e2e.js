// Lance les tests de bout en bout métier, chacun sur sa propre base jetable :
// création, migrations, exécution, puis suppression.
//   node test/run-e2e.js depenses gestion
// Les modules ESM de Nest ne se chargent pas sous Jest avec Node 20 : les tests
// sont compilés comme l'application, puis exécutés par le lanceur de Node
// (voir e2e-globals.js).
require('dotenv/config');
const { Client } = require('pg');
const { spawnSync } = require('node:child_process');

const specs = process.argv.slice(2);
if (!specs.length) {
  console.error('Indiquez au moins un test : depenses, gestion');
  process.exit(1);
}
const base = new URL(process.env.DATABASE_URL);

async function admin(sql) {
  const client = new Client({ connectionString: base.toString() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

(async () => {
  let status = spawnSync('npx tsc -p test/tsconfig.e2e.json', {
    shell: true,
    stdio: 'inherit',
  }).status;
  for (const spec of specs) {
    if (status !== 0) break;
    const name = `ipaim_e2e_${spec.replace(/[^a-z0-9]/gi, '_')}`;
    const target = new URL(base);
    target.pathname = `/${name}`;
    await admin(`DROP DATABASE IF EXISTS ${name}`);
    await admin(`CREATE DATABASE ${name}`);
    try {
      const env = {
        ...process.env,
        DATABASE_URL: target.toString(),
        E2E_DATABASE_URL: target.toString(),
        BACKUP_AUTO: 'false',
      };
      const run = (command) =>
        spawnSync(command, { shell: true, stdio: 'inherit', env }).status;
      status = run('npx prisma migrate deploy --config prisma7.config.ts');
      if (status === 0)
        status = run(
          `node -r ./test/e2e-globals.js --test-reporter=spec --test build/e2e/test/${spec}.e2e-spec.js`,
        );
    } finally {
      await admin(`DROP DATABASE IF EXISTS ${name}`);
    }
  }
  process.exit(status ?? 1);
})();
