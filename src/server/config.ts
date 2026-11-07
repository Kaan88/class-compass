import path from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3210),
  HOST: z.string().default('127.0.0.1'),
  DATA_DIR: z.string().default('./data'),
  SECRET_PEPPER: z.string().min(16, 'SECRET_PEPPER must be at least 16 characters'),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
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
   * Test-only override of the sign-in rate limit (requests per minute per address) for the e2e
   * server, which signs in many times. Honoured only when NODE_ENV=test; ignored in development and
   * always ignored in production (see `loginRateLimitMax`).
   */
  CC_TEST_LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).optional(),
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
});

/** Sign-in attempts per minute per address (production value). */
export const LOGIN_RATE_LIMIT_MAX = 20;

/**
 * The sign-in rate limit to use. The e2e override applies only under NODE_ENV=test, so a stray
 * variable on a production (or development) server can never weaken the limit.
 */
export function loginRateLimitMax(e: { NODE_ENV: string; CC_TEST_LOGIN_RATE_LIMIT?: number | undefined }): number {
  return e.NODE_ENV === 'test' && e.CC_TEST_LOGIN_RATE_LIMIT !== undefined ? e.CC_TEST_LOGIN_RATE_LIMIT : LOGIN_RATE_LIMIT_MAX;
}

export type Config = z.infer<typeof EnvSchema> & {
  dbPath: string;
  uploadsDir: string;
  backupsDir: string;
  /** Local OCR language data cache (copied from the pinned @tesseract.js-data packages, D-011). */
  ocrCacheDir: string;
  isProd: boolean;
  smtpEnabled: boolean;
  /** Effective sign-in attempts per minute per address (20 except under NODE_ENV=test with the override). */
  loginRateLimit: number;
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
  return {
    ...e,
    dbPath: path.join(dataDir, 'class-compass.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    backupsDir: e.BACKUP_DIR ? path.resolve(e.BACKUP_DIR) : path.join(dataDir, 'backups'),
    ocrCacheDir: e.OCR_CACHE_DIR ? path.resolve(e.OCR_CACHE_DIR) : path.join(dataDir, 'ocr-cache'),
    isProd: e.NODE_ENV === 'production',
    smtpEnabled: e.SMTP_HOST.length > 0,
    loginRateLimit: loginRateLimitMax(e),
    ...overrides,
  };
}
