import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase, runMigrations } from './db/client.ts';

const config = loadConfig();
const db = openDatabase(config.dbPath);
runMigrations(db);
const app = await buildApp({ db, config, now: Date.now }, { logger: true });

const shutdown = async () => {
  await app.close();
  db.$client.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
