import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { AppDeps } from './lib/context.ts';
import { AppError } from './lib/errors.ts';
import { clientIp } from './lib/http.ts';
import { registerModules } from './modules/index.ts';
import { ensureSchoolDefaults } from './modules/school/defaults.ts';

const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/client');

/** Log redaction: never log cookies, auth headers, PINs, passwords or tokens (STU-6). */
const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.pin',
  '*.token',
];

/**
 * `logStream` (tests): log at debug level into this stream instead of stdout, so a test can scan
 * everything the server logs (SEC-3 leak scan).
 */
export async function buildApp(deps: AppDeps, opts: { logger?: boolean; logStream?: { write: (line: string) => void } } = {}): Promise<FastifyInstance> {
  ensureSchoolDefaults(deps);
  const app = Fastify({
    logger: opts.logStream
      ? { level: 'debug', redact: REDACT, stream: opts.logStream }
      : opts.logger
        ? { level: deps.config.isProd ? 'info' : 'debug', redact: REDACT }
        : false,
    bodyLimit: 1024 * 1024,
    trustProxy: deps.config.TRUST_PROXY,
    // Student link paths (/s/...) must never be logged with their URL (tokens live in the fragment,
    // which browsers never send, but be defensive anyway). The log controller replaces the deprecated
    // top-level `disableRequestLogging` option (FSTDEP023).
    logController: new LogController({ disableRequestLogging: true }),
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: deps.config.isProd ? [] : null,
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(rateLimit, { global: false, keyGenerator: (req) => clientIp(deps, req) });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    if (req.url.startsWith('/api/') || req.url.startsWith('/s/')) reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 429) return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: 'VALIDATION', message: e.message ?? 'Bad request' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  app.get('/healthz', async () => {
    deps.db.$client.prepare('select 1').get();
    return { ok: true };
  });
  app.get('/robots.txt', async (_req, reply) => reply.type('text/plain').send('User-agent: *\nDisallow: /\n'));

  registerModules(app, deps);

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) return reply.sendFile('index.html');
    return reply.status(404).send('Client not built. Run `npm run build` or use `npm run dev`.');
  });

  if (fs.existsSync(CLIENT_DIST)) {
    await app.register(fastifyStatic, { root: CLIENT_DIST, prefix: '/', index: false, wildcard: false });
  }

  return app;
}
