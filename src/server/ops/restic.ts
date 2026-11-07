/**
 * Off-site backups with restic (D-017, D-089). The repository URL, its password and the storage
 * credentials come ONLY from the environment of the process that runs the CLI (the backup sidecar or
 * a host timer); they are passed to restic through its environment, never on the command line, and
 * never logged or stored: every text that leaves this file goes through `redact()`.
 *
 * Supported repositories:
 *   Cloudflare R2 (S3-compatible): RESTIC_REPOSITORY=s3:https://<account id>.r2.cloudflarestorage.com/<bucket>[/<path>]
 *                                  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (an R2 API token with access to that bucket)
 *   Backblaze B2:                  RESTIC_REPOSITORY=b2:<bucket>:<path>   B2_ACCOUNT_ID / B2_ACCOUNT_KEY
 *   A local folder (tests, a second disk): an absolute path or local:<path>.
 */
import { spawn } from 'node:child_process';

export const RESTIC_ENV_KEYS = [
  'RESTIC_REPOSITORY',
  'RESTIC_PASSWORD',
  'RESTIC_PASSWORD_FILE',
  'RESTIC_CACHE_DIR',
  'RESTIC_HOST',
  'B2_ACCOUNT_ID',
  'B2_ACCOUNT_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_DEFAULT_REGION',
  'RESTIC_BIN',
] as const;
/** Values that are secrets (redacted wherever they could appear). The repository URL counts: it names the account/bucket. */
const SECRET_KEYS = ['RESTIC_REPOSITORY', 'RESTIC_PASSWORD', 'B2_ACCOUNT_ID', 'B2_ACCOUNT_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const;

export type RepositoryKind = 'r2' | 's3' | 'b2' | 'local';

/** Checks the repository URL format; returns the kind or a reason it is not accepted. */
export function repositoryKind(repo: string | undefined): { ok: true; kind: RepositoryKind } | { ok: false; reason: string } {
  if (!repo?.trim()) return { ok: false, reason: 'RESTIC_REPOSITORY is not set' };
  const r = repo.trim();
  if (/^s3:https:\/\/[a-z0-9]+\.r2\.cloudflarestorage\.com\/[a-z0-9][a-z0-9.-]{1,62}(\/[^\s]*)?$/iu.test(r)) return { ok: true, kind: 'r2' };
  if (/^s3:https:\/\/[^\s/]+\/[a-z0-9][a-z0-9.-]{1,62}(\/[^\s]*)?$/iu.test(r)) return { ok: true, kind: 's3' };
  if (/^b2:[a-z0-9][a-z0-9-]{4,49}:[^\s]*$/iu.test(r)) return { ok: true, kind: 'b2' };
  if (/^local:\S+$/u.test(r) || r.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(r)) return { ok: true, kind: 'local' };
  if (/^s3:http:\/\//iu.test(r)) return { ok: false, reason: 'Use https:// for an S3/R2 repository' };
  return { ok: false, reason: 'Unsupported RESTIC_REPOSITORY (use s3:https://<account>.r2.cloudflarestorage.com/<bucket> or b2:<bucket>:<path>)' };
}

/** Problems with the off-site settings (empty = ready). Never includes the values themselves. */
export function offsiteProblems(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const kind = repositoryKind(env.RESTIC_REPOSITORY);
  if (!kind.ok) out.push(kind.reason);
  if (!env.RESTIC_PASSWORD && !env.RESTIC_PASSWORD_FILE) out.push('RESTIC_PASSWORD or RESTIC_PASSWORD_FILE is not set');
  if (kind.ok && (kind.kind === 'r2' || kind.kind === 's3') && (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY)) out.push('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are needed for an S3/R2 repository');
  if (kind.ok && kind.kind === 'b2' && (!env.B2_ACCOUNT_ID || !env.B2_ACCOUNT_KEY)) out.push('B2_ACCOUNT_ID and B2_ACCOUNT_KEY are needed for a B2 repository');
  return out;
}

/** The environment restic runs with: PATH/HOME plus only the restic and storage variables. */
export function resticEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TMP', 'TEMP', 'TMPDIR'] as const) if (env[k]) out[k] = env[k]!;
  for (const k of RESTIC_ENV_KEYS) if (env[k]) out[k] = env[k]!;
  if (out.RESTIC_REPOSITORY?.startsWith('local:')) out.RESTIC_REPOSITORY = out.RESTIC_REPOSITORY.slice('local:'.length);
  return out;
}

/** Replaces every secret value (and the repository URL) in `text` with `***`. */
export function redact(text: string, env: NodeJS.ProcessEnv): string {
  let out = text;
  const values = SECRET_KEYS.map((k) => env[k]).filter((v): v is string => typeof v === 'string' && v.length >= 4);
  for (const v of values.sort((a, b) => b.length - a.length)) out = out.split(v).join('***');
  // Credentials embedded in URLs, just in case restic echoes them.
  return out.replace(/\b(https?:\/\/)[^\s/@]+@/giu, '$1***@');
}

export interface ResticRun {
  code: number;
  stdout: string;
  stderr: string;
}

export type ResticRunner = (bin: string, args: string[], env: Record<string, string>) => Promise<ResticRun>;

/** Spawns restic without a shell (arguments are never interpreted). */
export const spawnRestic: ResticRunner = (bin, args, env) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, { env, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout = (stdout + d.toString('utf8')).slice(-200_000)));
    child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString('utf8')).slice(-200_000)));
    child.on('error', (err) => resolve({ code: 127, stdout, stderr: `${stderr}\n${err.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

export interface OffsiteOptions {
  env: NodeJS.ProcessEnv;
  runner?: ResticRunner;
}

const binOf = (env: NodeJS.ProcessEnv) => env.RESTIC_BIN?.trim() || 'restic';

async function restic(args: string[], o: OffsiteOptions): Promise<ResticRun> {
  const problems = offsiteProblems(o.env);
  if (problems.length) return { code: 2, stdout: '', stderr: problems.join('; ') };
  const r = await (o.runner ?? spawnRestic)(binOf(o.env), args, resticEnv(o.env));
  return { code: r.code, stdout: redact(r.stdout, o.env), stderr: redact(r.stderr, o.env) };
}

/** Last lines of restic's error output, redacted, for `backup_runs` and the console. */
export const tail = (s: string, lines = 8) => s.trim().split(/\r?\n/u).slice(-lines).join('\n').slice(0, 1500);

/** `restic init` (once per repository). */
export const offsiteInit = (o: OffsiteOptions) => restic(['init'], o);

/**
 * Copies one local backup file into the repository, then applies the off-site retention
 * (`restic forget --prune`). Returns the snapshot id from restic's JSON summary.
 */
export async function offsiteBackup(file: string, keep: { daily: number; weekly: number; monthly: number }, o: OffsiteOptions): Promise<{ ok: boolean; snapshotId: string | null; message: string }> {
  const host = o.env.RESTIC_HOST?.trim() || 'class-compass';
  const b = await restic(['backup', '--json', '--tag', 'class-compass', '--host', host, file], o);
  if (b.code !== 0) return { ok: false, snapshotId: null, message: tail(b.stderr || b.stdout) };
  let snapshotId: string | null = null;
  for (const line of b.stdout.split(/\r?\n/u)) {
    try {
      const j = JSON.parse(line) as { message_type?: string; snapshot_id?: string };
      if (j.message_type === 'summary' && j.snapshot_id) snapshotId = j.snapshot_id;
    } catch {
      /* progress lines */
    }
  }
  const f = await restic(
    ['forget', '--tag', 'class-compass', '--host', host, '--keep-daily', String(keep.daily), '--keep-weekly', String(keep.weekly), '--keep-monthly', String(keep.monthly), '--prune'],
    o,
  );
  if (f.code !== 0) return { ok: false, snapshotId, message: `backup stored, but forget/prune failed: ${tail(f.stderr || f.stdout)}` };
  return { ok: true, snapshotId, message: 'ok' };
}

/** `restic check` (structure), optionally reading a share of the data (e.g. '5%'). */
export function offsiteCheck(o: OffsiteOptions, readDataSubset?: string) {
  const args = ['check'];
  if (readDataSubset) {
    if (!/^\d{1,3}(\.\d+)?%$|^\d+\/\d+$/u.test(readDataSubset)) throw new Error('--read-data-subset must look like 5% or 1/10');
    args.push(`--read-data-subset=${readDataSubset}`);
  }
  return restic(args, o);
}

/** `restic snapshots` (for the restore drill). */
export const offsiteSnapshots = (o: OffsiteOptions) => restic(['snapshots', '--tag', 'class-compass'], o);
