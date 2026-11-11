import path from 'node:path';
import { z } from 'zod';
import { normalizeHost } from './lib/speakersHost.ts';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3210),
  HOST: z.string().default('127.0.0.1'),
  DATA_DIR: z.string().default('./data'),
  SECRET_PEPPER: z.string().min(16, 'SECRET_PEPPER must be at least 16 characters'),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
  /**
   * Super Speakers on its own origin (S14f, D-157): optional, e.g. `https://speakers.example.org`.
   * When set, the scorer app, the board and their API are served on this hostname (and links and QR
   * codes point there), and the main hostname redirects `/p`, `/p/app` and `/board` to it. Unset (or
   * empty, or equal to PUBLIC_ORIGIN) everything stays on PUBLIC_ORIGIN as before. See `resolveOrigins`.
   */
  SPEAKERS_ORIGIN: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DEFAULT_TIMEZONE: z.string().default('Europe/Istanbul'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default(''),
  /**
   * Test-only fake mail transport (S13b): when set and NODE_ENV=test, outgoing emails are written as
   * JSON files into this folder instead of being sent (the e2e server reads them). Ignored otherwise.
   */
  CC_TEST_MAIL_DIR: z.string().optional(),
  /** Classroom weather source (S13b, D-106): Open-Meteo's forecast API; only coordinates are sent. */
  WEATHER_API_URL: z.string().url().default('https://api.open-meteo.com/v1/forecast'),
  /**
   * Test-only override of the sign-in rate limit (requests per minute per address) for the e2e
   * server, which signs in many times. Honoured only when NODE_ENV=test; ignored in development and
   * always ignored in production (see `loginRateLimitMax`).
   */
  CC_TEST_LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).optional(),
  /**
   * Test-only override of the PIN unlock rate limit (requests per minute per address) for the e2e
   * server, whose suite unlocks the PIN many times from one address. Honoured only when NODE_ENV=test
   * (see `pinUnlockRateLimitMax`). Wrong PINs are still counted per session by the auth service.
   */
  CC_TEST_PIN_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).optional(),
  /** Upload quotas in MB (STU-8): all files of one student, and all files on the server. */
  UPLOAD_STUDENT_QUOTA_MB: z.coerce.number().int().min(1).max(100_000).default(100),
  UPLOAD_GLOBAL_QUOTA_MB: z.coerce.number().int().min(1).max(10_000_000).default(10_240),
  /** Local OCR (D-011): maximum time for one image before the OCR worker is stopped. */
  OCR_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(90_000),
  /** Workbook, Word and PDF parsing (worker thread): maximum time for one file before the thread is stopped. */
  PARSE_TIMEOUT_MS: z.coerce.number().int().min(500).max(600_000).default(30_000),
  /** Local backups (D-089): folder (default DATA_DIR/backups) and retention (newest per hour / day / month). */
  BACKUP_DIR: z.string().optional(),
  BACKUP_KEEP_HOURLY: z.coerce.number().int().min(0).max(10_000).default(48),
  BACKUP_KEEP_DAILY: z.coerce.number().int().min(0).max(10_000).default(30),
  BACKUP_KEEP_MONTHLY: z.coerce.number().int().min(0).max(10_000).default(12),
  /** Off-site copies (restic, D-017): snapshots kept by `restic forget`, and when the Maintenance page warns. */
  OFFSITE_KEEP_DAILY: z.coerce.number().int().min(1).max(10_000).default(30),
  OFFSITE_KEEP_WEEKLY: z.coerce.number().int().min(0).max(10_000).default(8),
  OFFSITE_KEEP_MONTHLY: z.coerce.number().int().min(0).max(10_000).default(12),
  OFFSITE_STALE_HOURS: z.coerce.number().int().min(1).max(24 * 365).default(36),
  /** OCR language data folder (default DATA_DIR/ocr-cache); the Docker image points it at data baked in at build time. */
  OCR_CACHE_DIR: z.string().optional(),
  /**
   * Super Speakers board stream (S12, D-134): heartbeat interval of the Server-Sent Events stream.
   * 25 s keeps Cloudflare's ~100 s idle timeout and other proxies from closing the stream; each
   * heartbeat also re-checks the board link and the week (rollover).
   */
  SPEAKERS_HEARTBEAT_MS: z.coerce.number().int().min(500).max(90_000).default(25_000),
  /** Teacher notifications (S14e3, D-155): rows and digest records older than this many days are deleted. */
  NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
  /**
   * Test-only clock offset file (S12 e2e): when set and NODE_ENV=test, the server's clock is
   * `Date.now()` plus the number of milliseconds in this file (so a test can move to next week).
   * Ignored in development and production (see `testClockFile`).
   */
  CC_TEST_CLOCK_FILE: z.string().optional(),
  /**
   * "Sign in with ChatGPT" for the assistant's connections (S19a, D-179): off, and stays off until
   * OpenAI grants Class Compass access. Only with `true` AND the client id and the three addresses
   * OpenAI gives the app can an administrator or teacher start this sign-in (`chatgptAvailable`).
   */
  AI_CHATGPT_SIGNIN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AI_CHATGPT_CLIENT_ID: z.string().optional().default(''),
  AI_CHATGPT_AUTHORIZE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  AI_CHATGPT_TOKEN_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  AI_CHATGPT_API_BASE: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  AI_CHATGPT_SCOPE: z.string().optional().default(''),
});

/** "Sign in with ChatGPT" can be offered: the switch is on and every value it needs is set (D-179). */
export const chatgptAvailable = (c: Pick<Config, 'AI_CHATGPT_SIGNIN' | 'AI_CHATGPT_CLIENT_ID' | 'AI_CHATGPT_AUTHORIZE_URL' | 'AI_CHATGPT_TOKEN_URL' | 'AI_CHATGPT_API_BASE'>): boolean =>
  c.AI_CHATGPT_SIGNIN && Boolean(c.AI_CHATGPT_CLIENT_ID && c.AI_CHATGPT_AUTHORIZE_URL && c.AI_CHATGPT_TOKEN_URL && c.AI_CHATGPT_API_BASE);

/** The e2e clock offset file, honoured only under NODE_ENV=test. */
export const testClockFile = (e: { NODE_ENV: string; CC_TEST_CLOCK_FILE?: string | undefined }): string | null => (e.NODE_ENV === 'test' && e.CC_TEST_CLOCK_FILE ? e.CC_TEST_CLOCK_FILE : null);

/** Sign-in attempts per minute per address (production value). */
export const LOGIN_RATE_LIMIT_MAX = 20;

/**
 * The sign-in rate limit to use. The e2e override applies only under NODE_ENV=test, so a stray
 * variable on a production (or development) server can never weaken the limit.
 */
export function loginRateLimitMax(e: { NODE_ENV: string; CC_TEST_LOGIN_RATE_LIMIT?: number | undefined }): number {
  return e.NODE_ENV === 'test' && e.CC_TEST_LOGIN_RATE_LIMIT !== undefined ? e.CC_TEST_LOGIN_RATE_LIMIT : LOGIN_RATE_LIMIT_MAX;
}

/** PIN unlock attempts per minute per address. */
export const PIN_UNLOCK_RATE_LIMIT_MAX = 15;

/** The PIN unlock rate limit to use; like the sign-in limit, the e2e override applies only under NODE_ENV=test. */
export function pinUnlockRateLimitMax(e: { NODE_ENV: string; CC_TEST_PIN_RATE_LIMIT?: number | undefined }): number {
  return e.NODE_ENV === 'test' && e.CC_TEST_PIN_RATE_LIMIT !== undefined ? e.CC_TEST_PIN_RATE_LIMIT : PIN_UNLOCK_RATE_LIMIT_MAX;
}

/**
 * The origins the server answers for (S14f, D-157). `main` is PUBLIC_ORIGIN's origin; `speakers` is
 * SPEAKERS_ORIGIN's origin, or `main` when it is unset. `split` is true only when Super Speakers has a
 * hostname of its own; the hosts are `normalizeHost` spellings (lower case, no default port, no
 * trailing dot), the same rule the host routing applies to the `Host` header.
 */
export interface Origins {
  main: string;
  speakers: string;
  mainHost: string;
  speakersHost: string;
  split: boolean;
}

/**
 * Work out the origins and refuse invalid combinations (D-157): SPEAKERS_ORIGIN must be a bare
 * http(s) origin (no path, query, fragment or credentials), use the same scheme as PUBLIC_ORIGIN and
 * have a hostname of its own (cookies are separated by hostname, not by port; `school.example.org.`
 * is the same name as `school.example.org`, and a trailing dot is refused). Equal to PUBLIC_ORIGIN
 * counts as unset.
 */
export function resolveOrigins(publicOrigin: string, speakersOrigin?: string | undefined): Origins {
  const main = new URL(publicOrigin);
  const mainOrigin = main.origin;
  // Hosts are stored the way the host routing compares them (normalizeHost: lower case, no default
  // port, no trailing dot), so the refusal below and the request hook apply the same rule.
  const mainHost = normalizeHost(main.host);
  const unsplit: Origins = { main: mainOrigin, speakers: mainOrigin, mainHost, speakersHost: mainHost, split: false };
  if (!speakersOrigin) return unsplit;
  const refuse = (why: string): never => {
    throw new Error(`Invalid configuration: SPEAKERS_ORIGIN ${why}`);
  };
  let sp: URL;
  try {
    sp = new URL(speakersOrigin);
  } catch {
    return refuse('is not a valid URL');
  }
  if (sp.protocol !== 'https:' && sp.protocol !== 'http:') refuse('must start with https:// (or http:// for local testing)');
  if (sp.username || sp.password) refuse('must not contain a user name or password');
  if ((sp.pathname !== '/' && sp.pathname !== '') || sp.search || sp.hash) refuse('must be an origin only, like https://speakers.example.org (no path, query or #)');
  if (sp.origin === mainOrigin) return unsplit;
  if (sp.hostname.endsWith('.')) refuse('must not end its hostname with a dot');
  if (sp.protocol !== main.protocol) refuse(`must use the same scheme as PUBLIC_ORIGIN (${main.protocol}//)`);
  const bareName = (h: string) => h.replace(/\.$/u, '');
  if (bareName(sp.hostname) === bareName(main.hostname)) refuse('must use a different hostname from PUBLIC_ORIGIN (a different port is not enough)');
  return { main: mainOrigin, speakers: sp.origin, mainHost, speakersHost: normalizeHost(sp.host), split: true };
}

export type Config = z.infer<typeof EnvSchema> & {
  /** Main and Super Speakers origins (S14f, D-157), from PUBLIC_ORIGIN and SPEAKERS_ORIGIN. */
  origins: Origins;
  dbPath: string;
  uploadsDir: string;
  /**
   * S24 (D-184): students' avatar pictures waiting for a teacher. Outside `uploadsDir`, so backups and
   * exports never contain them (a refused picture is gone for good); inside DATA_DIR, so the Docker
   * volume keeps it and an approval is a move on the same disk.
   */
  avatarQuarantineDir: string;
  backupsDir: string;
  /** Local OCR language data cache (copied from the pinned @tesseract.js-data packages, D-011). */
  ocrCacheDir: string;
  isProd: boolean;
  smtpEnabled: boolean;
  /** Effective sign-in attempts per minute per address (20 except under NODE_ENV=test with the override). */
  loginRateLimit: number;
  /** Effective PIN unlock attempts per minute per address (15 except under NODE_ENV=test with the override). */
  pinUnlockRateLimit: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && e.SECRET_PEPPER.includes('change-me')) {
    throw new Error('Refusing to start in production with the example SECRET_PEPPER');
  }
  const dataDir = path.resolve(e.DATA_DIR);
  // Computed after the overrides, so a test that overrides PUBLIC_ORIGIN or SPEAKERS_ORIGIN gets
  // matching (and validated) origins.
  const origins =
    overrides.origins ?? resolveOrigins(overrides.PUBLIC_ORIGIN ?? e.PUBLIC_ORIGIN, 'SPEAKERS_ORIGIN' in overrides ? overrides.SPEAKERS_ORIGIN : e.SPEAKERS_ORIGIN);
  return {
    ...e,
    origins,
    dbPath: path.join(dataDir, 'class-compass.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    avatarQuarantineDir: path.join(dataDir, 'avatar-quarantine'),
    backupsDir: e.BACKUP_DIR ? path.resolve(e.BACKUP_DIR) : path.join(dataDir, 'backups'),
    ocrCacheDir: e.OCR_CACHE_DIR ? path.resolve(e.OCR_CACHE_DIR) : path.join(dataDir, 'ocr-cache'),
    isProd: e.NODE_ENV === 'production',
    smtpEnabled: e.SMTP_HOST.length > 0 || (e.NODE_ENV === 'test' && Boolean(e.CC_TEST_MAIL_DIR)),
    loginRateLimit: loginRateLimitMax(e),
    pinUnlockRateLimit: pinUnlockRateLimitMax(e),
    ...overrides,
  };
}
