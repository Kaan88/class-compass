/**
 * Static checks of the deployment files (D-018, ENG-5). Docker is not run here (not installed on the
 * development machine); these tests lint what can be checked without it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

describe('Dockerfile', () => {
  const df = read('Dockerfile');
  const lines = df.split(/\r?\n/u).filter((l) => l.trim() && !l.trim().startsWith('#'));

  it('builds on Node 26 bookworm-slim in stages and installs production dependencies only in the final image', () => {
    expect(df).toMatch(/^ARG NODE_IMAGE=node:26-bookworm-slim$/mu);
    for (const stage of ['deps', 'build', 'runtime']) expect(df).toMatch(new RegExp(`^FROM \\$\\{NODE_IMAGE\\} AS ${stage}$`, 'mu'));
    expect(df).toContain('npm ci --omit=dev');
    const runtime = df.slice(df.indexOf('AS runtime'));
    expect(runtime).not.toMatch(/npm (ci|install)/u);
    expect(runtime).toContain('COPY --from=deps');
  });

  it('runs as a non-root user with NODE_ENV=production, DATA_DIR=/data and a /healthz HEALTHCHECK', () => {
    const users = lines.filter((l) => l.startsWith('USER '));
    expect(users).toEqual(['USER app']);
    expect(df).toMatch(/NODE_ENV=production/u);
    expect(df).toMatch(/DATA_DIR=\/data/u);
    expect(df).toMatch(/HEALTHCHECK [^\n]*\\\n[^\n]*\/healthz/u);
    expect(df).toContain('VOLUME ["/data"]');
  });

  it('bakes the OCR language data in at build time', () => {
    expect(df).toContain('node scripts/prepare-ocr.ts');
    expect(df).toContain('OCR_CACHE_DIR=/opt/class-compass/ocr');
    expect(existsSync(join(ROOT, 'scripts', 'prepare-ocr.ts'))).toBe(true);
  });

  it('holds no secrets and copies only files that exist', () => {
    for (const l of lines.filter((x) => /^(ENV|ARG)\b/u.test(x) || /^\s+[A-Z_]+=/u.test(x))) expect(l).not.toMatch(/SECRET|PASSWORD|TOKEN|PEPPER|AWS_|B2_|RESTIC_/u);
    for (const l of lines.filter((x) => x.startsWith('COPY ') && !x.includes('--from='))) {
      const parts = l.split(/\s+/u).filter((p) => !p.startsWith('--'));
      for (const src of parts.slice(1, -1)) expect(existsSync(join(ROOT, src)), src).toBe(true);
    }
  });
});

describe('.dockerignore', () => {
  it('keeps secrets and real data out of the build context', () => {
    const ignore = read('.dockerignore').split(/\r?\n/u);
    for (const p of ['.env', '.env.*', 'data/', 'uploads/', 'backups/', '*.db', '*.sqlite', 'node_modules', '.git', 'app.env', 'tunnel.env', 'deploy/*.env']) expect(ignore, p).toContain(p);
    expect(ignore).toContain('!.env.example');
  });
});

describe('docker-compose.example.yml', () => {
  const dc = read('docker-compose.example.yml');
  it('binds the app to 127.0.0.1 only, trusts the tunnel proxy and keeps cloudflared on the internal network', () => {
    expect(dc).toMatch(/- "127\.0\.0\.1:\$\{APP_HOST_PORT:-3210\}:3210"/u);
    expect(dc).not.toMatch(/- "(0\.0\.0\.0:)?\d+:\d+"/u);
    expect(dc).toMatch(/TRUST_PROXY: "true"/u);
    expect(dc).toMatch(/cloudflared:[\s\S]*profiles: \["tunnel"\][\s\S]*networks:\s*\n\s*- internal/u);
    expect(dc).toMatch(/backup:[\s\S]*backupLoop\.ts/u);
    expect(existsSync(join(ROOT, 'src', 'server', 'backupLoop.ts'))).toBe(true);
  });

  it('contains no secret values; secrets come from env files that git and Docker ignore', () => {
    expect(dc).not.toMatch(/(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*:\s*\S+/u);
    const gi = read('.gitignore').split(/\r?\n/u);
    for (const p of ['app.env', 'tunnel.env', 'deploy/*.env', '.env']) expect(gi, p).toContain(p);
  });
});

describe('restic and timer examples', () => {
  it('the restic example has no filled-in credentials and covers R2 and B2', () => {
    const r = read('deploy/restic.env.example');
    expect(r).toContain('s3:https://<account-id>.r2.cloudflarestorage.com/<bucket>');
    expect(r).toContain('b2:<bucket>:');
    for (const l of r.split(/\r?\n/u).filter((x) => x && !x.startsWith('#'))) expect(l).toMatch(/^(RESTIC_PASSWORD=|OFFSITE_KEEP_\w+=\d+)$/u);
  });

  it('systemd timers run backup:create hourly and backup:offsite nightly', () => {
    expect(read('deploy/systemd/class-compass-backup.timer')).toContain('OnCalendar=hourly');
    expect(read('deploy/systemd/class-compass-backup.service')).toContain('backup:create --trigger timer');
    expect(read('deploy/systemd/class-compass-offsite.timer')).toMatch(/OnCalendar=\*-\*-\* 01:30:00/u);
    expect(read('deploy/systemd/class-compass-offsite.service')).toContain('backup:offsite latest --trigger timer');
  });
});
