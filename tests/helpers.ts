/**
 * Test harness: a real app on an in-memory SQLite DB with all migrations applied, a controllable
 * clock, and a cookie-aware client. Only fictional data is ever used.
 */
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.ts';
import { loadConfig, type Config } from '../src/server/config.ts';
import { openDatabase, runMigrations, type Db } from '../src/server/db/client.ts';
import { createUser } from '../src/server/modules/auth/service.ts';
import type { AppDeps } from '../src/server/lib/context.ts';
import type { Mailer, MailMessage } from '../src/server/lib/mailer.ts';

export const TEST_ORIGIN = 'http://localhost:5173';

export class Clock {
  t = Date.UTC(2026, 10, 9, 7, 0, 0); // Monday 2026-11-09 10:00 Istanbul
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export interface TestEnv {
  app: FastifyInstance;
  db: Db;
  clock: Clock;
  config: Config;
  deps: AppDeps;
}

/** Fake mail transport (D-015): records messages instead of sending them. */
export class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(msg: MailMessage) {
    this.sent.push(msg);
  }
}

export async function makeEnv(overrides: Partial<Config> = {}, extra: { mailer?: Mailer | null } = {}): Promise<TestEnv> {
  const config = loadConfig(
    { NODE_ENV: 'test', SECRET_PEPPER: 'test-pepper-0123456789abcdef', PUBLIC_ORIGIN: TEST_ORIGIN, DATA_DIR: './data-test' },
    overrides,
  );
  const db = openDatabase(':memory:');
  runMigrations(db);
  const clock = new Clock();
  const deps: AppDeps = { db, config, now: clock.now, mailer: extra.mailer ?? null };
  const app = await buildApp(deps);
  await app.ready();
  return { app, db, clock, config, deps };
}

export const SYSTEM = { type: 'system' as const, id: null };

export async function seedUser(env: TestEnv, role: 'admin' | 'teacher', login: string, password = 'correct-horse-battery') {
  return createUser(env.db, { login, displayName: `Test ${login}`, role, password }, SYSTEM, env.clock.now());
}

/** Minimal cookie-jar client that behaves like a same-origin browser fetch. */
export class Client {
  cookies = new Map<string, string>();
  private env: TestEnv;
  constructor(env: TestEnv) {
    this.env = env;
  }

  async req(method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { origin: TEST_ORIGIN, 'x-cc-csrf': '1', ...extraHeaders };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await this.env.app.inject({ method: method as 'GET', url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    for (const c of res.cookies as Array<{ name: string; value: string; maxAge?: number }>) {
      if (c.value === '' || c.maxAge === 0) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null, headers: res.headers };
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body: unknown = {}) => this.req('POST', url, body);
  patch = (url: string, body: unknown = {}) => this.req('PATCH', url, body);
  put = (url: string, body: unknown = {}) => this.req('PUT', url, body);
  del = (url: string) => this.req('DELETE', url, {});

  async login(login: string, password = 'correct-horse-battery') {
    const r = await this.post('/api/auth/login', { login, password });
    if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`);
    return r;
  }
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
