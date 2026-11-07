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
});

export type Config = z.infer<typeof EnvSchema> & {
  dbPath: string;
  uploadsDir: string;
  backupsDir: string;
  isProd: boolean;
  smtpEnabled: boolean;
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
    backupsDir: path.join(dataDir, 'backups'),
    isProd: e.NODE_ENV === 'production',
    smtpEnabled: e.SMTP_HOST.length > 0,
    ...overrides,
  };
}
