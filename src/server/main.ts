import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/client.ts';
import { createSmtpMailer } from './lib/mailer.ts';
import { migrateWithSnapshot, writeServerLock } from './ops/backup.ts';

const config = loadConfig();
const db = openDatabase(config.dbPath);
// Pending migrations: a database snapshot is taken first (DAT-4, D-089); a failed snapshot stops the start.
const snapshot = await migrateWithSnapshot(db, config, Date.now, 'startup');
if (snapshot) console.log(`Database snapshot before migrating: ${snapshot}`);
const releaseLock = writeServerLock(config, Date.now());
const mailer = config.smtpEnabled ? createSmtpMailer(config) : null;
const app = await buildApp({ db, config, now: Date.now, mailer }, { logger: true });

const shutdown = async () => {
  await app.close();
  db.$client.close();
  releaseLock();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
