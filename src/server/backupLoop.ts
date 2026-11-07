/**
 * Backup scheduler for the optional compose `backup` sidecar (OPS-2, D-017): a local backup every
 * hour (backup:create, with retention) and the off-site copy once a day at OFFSITE_HOUR_UTC
 * (backup:offsite latest). Each run is a separate CLI process, recorded in backup_runs like a
 * systemd timer run. Credentials stay in the environment and are never printed.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const CLI = path.join(import.meta.dirname, 'cli.ts');
const HOUR = 3600_000;
const offsiteHour = Number(process.env.OFFSITE_HOUR_UTC ?? '1');

function run(args: string[]): boolean {
  const r = spawnSync(process.execPath, [CLI, ...args, '--trigger', 'timer'], { stdio: 'inherit' });
  if (r.status !== 0) console.error(`[backup-loop] ${args[0]} failed (exit ${r.status ?? r.signal})`);
  return r.status === 0;
}

let lastOffsiteDay = '';
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});

while (!stopping) {
  const started = Date.now();
  run(['backup:create']);
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (now.getUTCHours() === offsiteHour && lastOffsiteDay !== day) {
    if (run(['backup:offsite', 'latest'])) lastOffsiteDay = day;
  }
  // Sleep until the next full hour (in short steps so a stop signal ends the loop quickly).
  const next = Math.ceil((started + 1) / HOUR) * HOUR;
  while (!stopping && Date.now() < next) await new Promise((r) => setTimeout(r, Math.min(5000, next - Date.now())));
}
