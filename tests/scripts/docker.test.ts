/**
 * Static checks of the deployment files (D-018, ENG-5). Docker is not run here (not installed on the
 * development machine); these tests lint what can be checked without it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.ts';

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

  it('keeps avatar pictures waiting for a teacher on the /data volume but outside the uploads that backups copy (S24, D-184)', () => {
    const c = loadConfig({ NODE_ENV: 'production', SECRET_PEPPER: 'docker-test-pepper-0123456789', PUBLIC_ORIGIN: 'https://school.example.org', DATA_DIR: '/data' });
    expect(relative(resolve('/data'), c.avatarQuarantineDir)).toBe('avatar-quarantine');
    expect(relative(c.uploadsDir, c.avatarQuarantineDir).startsWith('..')).toBe(true);
    expect(relative(c.backupsDir, c.avatarQuarantineDir).startsWith('..')).toBe(true);
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
  it('keeps secrets, real data and local output out of the build context, at any depth for file patterns', () => {
    const outside = [
      '.env',
      '.env.local',
      'deploy/.env',
      'app.env',
      'tunnel.env',
      'deploy/app.env',
      'deploy/prod.env',
      'secrets/k',
      'x.pem',
      'deploy/certs/x.pem',
      'x.key',
      'data/app.db',
      'data-test/app.db',
      'data-e2e/app.db-wal',
      'src/server/stray.db',
      'stray.sqlite',
      'uploads/x',
      'storage/x',
      'backups/x.tar',
      'nested/backup.zip',
      'dump/x.dump',
      'x.sql.gz',
      'x.bak',
      'server.log',
      'logs/server.log',
      // Local output: the usability crawl (1 GB and more), test reports, builds, editors, worktrees.
      'usability-shots/s14/a.png',
      'usability-shots/after/b.png',
      'test-results/x/trace.zip',
      'playwright-report/index.html',
      'blob-report/x',
      'coverage/index.html',
      'node_modules/x/index.js',
      'dist/client/index.html',
      'build/x',
      'tsconfig.tsbuildinfo',
      '.claude/worktrees/wf/x.ts',
      '.git/HEAD',
      '.DS_Store',
      'src/.DS_Store',
    ];
    for (const p of outside) expect(inContext(p), `${p} stays out of the build context`).toBe(false);
    expect(inContext('.env.example')).toBe(true);
  });

  it('every output, secret and data pattern of .gitignore is also left out of the build context', () => {
    // Sample paths for each .gitignore pattern: `*` becomes a name, a folder pattern gets a file in it,
    // and a pattern without a slash (which git applies at any depth) is also tried one folder down.
    const patterns = read('.gitignore')
      .split(/\r?\n/u)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
    expect(patterns).toContain('usability-shots/');
    for (const pattern of patterns) {
      const dir = pattern.endsWith('/');
      const base = pattern.replace(/\/$/u, '').replace(/\*/gu, 'sample');
      const samples = [dir ? `${base}/file.txt` : base];
      if (!base.includes('/') && !dir) samples.push(`src/${base}`);
      for (const s of samples) expect(inContext(s), `${s} (from .gitignore ${pattern}) stays out of the build context`).toBe(false);
    }
  });
});

/**
 * The build context and the image layout (S14i). Until S14h1 `.dockerignore` left out all of `docs/`,
 * so `vite build` in the image found no guides for Help (`import.meta.glob` at build time) and Help
 * was empty in every image. These checks follow Docker's `.dockerignore` rules (patterns relative to
 * the context root, `*` within one path part, `**` across parts, a pattern also covers everything
 * under a matching folder, the last matching pattern wins, `!` re-includes).
 */
function ignoreRules(text: string) {
  return text
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const include = l.startsWith('!');
      const pattern = (include ? l.slice(1) : l).replace(/^\/+|\/+$/gu, '');
      const source = pattern
        .split('/')
        .map((part) => (part === '**' ? '.*' : part.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^/]*').replace(/\?/gu, '[^/]')))
        .join('/')
        .replace(/\.\*\//gu, '(?:.*/)?');
      return { include, re: new RegExp(`^${source}$`, 'u') };
    });
}
const rules = ignoreRules(read('.dockerignore'));
/** Whether `rel` (a path relative to the repository root, forward slashes) is in the Docker build context. */
function inContext(rel: string): boolean {
  const parts = rel.split('/');
  let ignored = false;
  for (const r of rules) {
    for (let n = 1; n <= parts.length; n += 1) {
      if (r.re.test(parts.slice(0, n).join('/'))) {
        ignored = !r.include;
        break;
      }
    }
  }
  return !ignored;
}
const filesIn = (dir: string, ext: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(`${dir}/${e.name}`, ext) : e.name.endsWith(ext) ? [`${dir}/${e.name}`] : []));

/** COPY lines of the runtime stage that take files from the build context: [sources, destination]. */
function runtimeCopies(): Array<{ sources: string[]; dest: string }> {
  const df = read('Dockerfile');
  const runtime = df.slice(df.indexOf('AS runtime'));
  expect(runtime).toMatch(/^WORKDIR \/app$/mu);
  return runtime
    .split(/\r?\n/u)
    .filter((l) => l.startsWith('COPY ') && !l.includes('--from='))
    .map((l) => {
      const parts = l.split(/\s+/u).slice(1).filter((p) => !p.startsWith('--'));
      return { sources: parts.slice(0, -1), dest: parts[parts.length - 1]! };
    });
}
/** Where a repository file lands in the runtime image (absolute), or null when no COPY brings it. */
function imagePathOf(rel: string): string | null {
  for (const { sources, dest } of runtimeCopies()) {
    const destAbs = posix.resolve('/app', dest);
    const destIsDir = dest.endsWith('/') || sources.length > 1;
    for (const src of sources) {
      const s = src.replace(/^\.\//u, '').replace(/\/$/u, '');
      if (rel === s) return destIsDir ? posix.join(destAbs, posix.basename(s)) : destAbs;
      if (rel.startsWith(`${s}/`)) return posix.join(destAbs, rel.slice(s.length + 1));
    }
  }
  return null;
}

describe('Docker build context and image layout (S14i)', () => {
  it('the .dockerignore matcher follows Docker rules', () => {
    expect(inContext('.env')).toBe(false);
    expect(inContext('.env.example')).toBe(true);
    expect(inContext('data/app.db')).toBe(false);
    expect(inContext('docs/ROADMAP.md')).toBe(false);
    expect(inContext('docs/design/x.md')).toBe(false);
    expect(inContext('tests/scripts/docker.test.ts')).toBe(false);
    expect(inContext('src/server/main.ts')).toBe(true);
  });

  it('the build stage gets everything `npm run build` reads: entries, vite config and its imports, client sources, the guides and their pictures for Help', () => {
    const df = read('Dockerfile');
    const build = df.slice(df.indexOf('AS build'), df.indexOf('AS runtime'));
    expect(build).toMatch(/^COPY \. \.$/mu);
    expect(build).toContain('npm run build');
    const needed = ['package.json', 'package-lock.json', 'vite.config.ts', 'index.html', 'student.html', 'scorer.html', 'board.html', 'scripts/student-budget.ts', 'scripts/prepare-ocr.ts'];
    for (const m of read('vite.config.ts').matchAll(/from '(\.\/[^']+)'/gu)) needed.push(m[1]!.slice(2));
    for (const m of read('package.json').matchAll(/node (scripts\/[\w-]+\.ts)/gu)) needed.push(m[1]!);
    // Help bundles the guides at build time (src/client/help/guides.ts).
    const help = read('src/client/help/guides.ts');
    expect(help).toContain("import.meta.glob<string>('../../../docs/guides/*/*.md'");
    expect(help).toContain("import.meta.glob<string>('../../../docs/guides/img/*/*.png'");
    const guides = [...filesIn('docs/guides/en', '.md'), ...filesIn('docs/guides/tr', '.md')];
    const pictures = filesIn('docs/guides/img', '.png');
    expect(guides.length).toBeGreaterThan(15);
    expect(pictures.length).toBeGreaterThan(50);
    needed.push(...guides, ...pictures, ...filesIn('src/client', '.tsx'), ...filesIn('src/shared', '.ts'));
    for (const f of needed) {
      expect(existsSync(join(ROOT, f)), `${f} exists`).toBe(true);
      expect(inContext(f), `${f} is in the build context`).toBe(true);
    }
  });

  it('every COPY source of the Dockerfile is in the build context', () => {
    for (const { sources } of runtimeCopies()) for (const s of sources) expect(inContext(s.replace(/^\.\//u, '').replace(/\/$/u, '')), s).toBe(true);
  });

  it('the runtime image has every file the server reads at run time, at the path the server reads it from', () => {
    // Paths the server resolves from its own source location (keep in sync with the code they name).
    const fromSource = (file: string, pattern: RegExp) => {
      const m = pattern.exec(read(file));
      expect(m, file).not.toBeNull();
      return posix.normalize(posix.join(posix.dirname(file), m![1]!));
    };
    expect(fromSource('src/server/modules/mcp/resources.ts', /const DOCS = path\.resolve\([^,]+, '([^']+)'\)/u)).toBe('docs');
    expect(fromSource('src/server/db/client.ts', /MIGRATIONS_DIR = path\.resolve\([^,]+, '([^']+)'\)/u)).toBe('drizzle');
    expect(fromSource('src/server/ops/version.ts', /const ROOT = path\.resolve\([^,]+, '([^']+)'\)/u)).toBe('.');
    expect(fromSource('src/server/app.ts', /CLIENT_DIST = path\.resolve\([^,]+, '([^']+)'\)/u)).toBe('dist/client');

    const runtimeFiles = [
      'package.json',
      'src/server/main.ts',
      'src/server/cli.ts',
      'src/server/backupLoop.ts',
      'drizzle/meta/_journal.json',
      ...filesIn('drizzle', '.sql'),
      // AI tools resources (S14h1, D-160): the guides' Markdown and the theming guide, read from docs/.
      ...filesIn('docs/guides/en', '.md'),
      ...filesIn('docs/guides/tr', '.md'),
      'docs/THEMING.md',
      'docs/theme-package.schema.json',
      // The theme example packages (S16b, D-164): MCP resources and export_theme of a built-in theme.
      ...filesIn('docs/examples', '.json'),
      ...filesIn('src/server', '.ts'),
      ...filesIn('src/shared', '.ts'),
      ...filesIn('src/domain', '.ts'),
    ];
    for (const f of runtimeFiles) {
      expect(inContext(f), `${f} is in the build context`).toBe(true);
      expect(imagePathOf(f), `${f} is copied into the runtime image`).toBe(`/app/${f}`);
    }
    const df = read('Dockerfile');
    expect(df).toMatch(/^COPY --from=build \S+ \/app\/dist\/client \.\/dist\/client$/mu);
    expect(df).toMatch(/^CMD \["node", "src\/server\/main\.ts"\]$/mu);
  });

  it('the app service worker (S26b, D-190): its code and builder reach the build, and the built /app-sw.js lands in the image', () => {
    // `vite build` writes dist/client/app-sw.js from the worker's code (scripts/appWorker.ts).
    expect(read('vite.config.ts')).toMatch(/import \{ appWorkerPlugin \} from '\.\/scripts\/appWorker\.ts'/u);
    expect(read('vite.config.ts')).toContain('appWorkerPlugin()');
    expect(read('scripts/appWorker.ts')).toContain("WORKER_FILE = 'app-sw.js'");
    for (const f of ['scripts/appWorker.ts', 'src/client/sw/appWorker.ts']) {
      expect(existsSync(join(ROOT, f)), f).toBe(true);
      expect(inContext(f), `${f} is in the build context`).toBe(true);
    }
    // The build stage copies everything; the runtime image takes the whole built client.
    const df = read('Dockerfile');
    expect(df.slice(df.indexOf('AS build'), df.indexOf('AS runtime'))).toMatch(/^COPY \. \.$/mu);
    expect(df).toMatch(/^COPY --from=build \S+ \/app\/dist\/client \.\/dist\/client$/mu);
    expect(read('src/server/app.ts')).toMatch(/APP_WORKER_PATH = '\/app-sw\.js'/u);
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
