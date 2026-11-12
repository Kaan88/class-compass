import { buildApp } from './app.ts';
import { loadConfig, testClockFile } from './config.ts';
import { openDatabase } from './db/client.ts';
import { mailerFor } from './lib/mailer.ts';
import { offsetClock } from './lib/testClock.ts';
import { purgeOldChats, RETENTION_TICK_MS } from './modules/assistantChat/retention.ts';
import { cleanupExpiredExports } from './modules/maintenance/exports.ts';
import { PICTURE_SWEEP_MS, sweepAvatarPictures } from './modules/avatars/pictures.ts';
import { SOURCE_SWEEP_MS, sweepUnusedImportSources } from './modules/import/sweep.ts';
import { runNotificationTick, TICK_MS as NOTIFICATION_TICK_MS } from './modules/notifications/digest.ts';
import { migrateWithSnapshot, writeServerLock } from './ops/backup.ts';

const config = loadConfig();
/**
 * The clock. Only under NODE_ENV=test may an e2e run shift it with CC_TEST_CLOCK_FILE (a number of
 * milliseconds, re-read at most every 200 ms), e.g. to see the Super Speakers board after the weekly reset.
 */
const clockFile = testClockFile(config);
const now = clockFile ? offsetClock(clockFile) : Date.now;
const db = openDatabase(config.dbPath);
// Pending migrations: a database snapshot is taken first (DAT-4, D-089); a failed snapshot stops the start.
const snapshot = await migrateWithSnapshot(db, config, Date.now, 'startup');
if (snapshot) console.log(`Database snapshot before migrating: ${snapshot}`);
const releaseLock = writeServerLock(config, Date.now());
const mailer = mailerFor(config);
const app = await buildApp({ db, config, now, mailer }, { logger: true });
// Prepared exports hold student data: remove the ones that expired without a download (D-090).
const sweepExports = () => void cleanupExpiredExports(config, Date.now()).catch((err: unknown) => app.log.warn({ err }, 'export clean-up failed'));
sweepExports();
const exportSweep = setInterval(sweepExports, 5 * 60_000);
exportSweep.unref();
// Teacher notifications (S14e3, D-155): the optional daily digest and the 90-day purge, every 5 minutes.
let notificationTickRunning = false;
const notificationTick = () => {
  if (notificationTickRunning) return;
  notificationTickRunning = true;
  runNotificationTick({ db, config, now, mailer })
    .catch((err: unknown) => app.log.warn({ err }, 'notification tick failed'))
    .finally(() => {
      notificationTickRunning = false;
    });
};
const notificationTimer = setInterval(notificationTick, NOTIFICATION_TICK_MS);
notificationTimer.unref();
// Assistant chats (S19b, D-180): deleted a school year (the administrator's setting) after their last message.
const chatRetention = () => void purgeOldChats({ db, now }).catch((err: unknown) => app.log.warn({ err }, 'assistant chat retention failed'));
chatRetention();
const chatRetentionTimer = setInterval(chatRetention, RETENTION_TICK_MS);
chatRetentionTimer.unref();
// Students' own pictures (S24, D-184): unchecked ones are deleted after 14 days; at start-up and hourly.
const pictureSweep = () => void sweepAvatarPictures({ db, config, now }).catch((err: unknown) => app.log.warn({ err }, 'avatar picture clean-up failed'));
pictureSweep();
const pictureSweepTimer = setInterval(pictureSweep, PICTURE_SWEEP_MS);
pictureSweepTimer.unref();
// Uploaded class lists that never became an import batch (cancelled or refused) name children that
// erasure cannot find: deleted an hour after the upload; at start-up and every 10 minutes (D-109).
const importSourceSweep = () => void sweepUnusedImportSources({ db, config, now }).catch((err: unknown) => app.log.warn({ err }, 'import source clean-up failed'));
importSourceSweep();
const importSourceSweepTimer = setInterval(importSourceSweep, SOURCE_SWEEP_MS);
importSourceSweepTimer.unref();

const shutdown = async () => {
  clearInterval(exportSweep);
  clearInterval(notificationTimer);
  clearInterval(chatRetentionTimer);
  clearInterval(pictureSweepTimer);
  clearInterval(importSourceSweepTimer);
  await app.close();
  db.$client.close();
  releaseLock();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
