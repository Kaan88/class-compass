import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { AppDeps } from './lib/context.ts';
import { AppError } from './lib/errors.ts';
import { clientIp } from './lib/http.ts';
import { isSpeakersHost, movedToSpeakers, pathOf, SCORER_SW_KILL_SWITCH, speakersHostAllows, speakersRedirect } from './lib/speakersHost.ts';
import { registerModules } from './modules/index.ts';
import { ensureSchoolDefaults } from './modules/school/defaults.ts';
import { MAX_UPLOAD_BYTES } from './modules/files/storage.ts';
import { STUDENT_PAGE_PATH } from '../shared/contracts/links.ts';
import { BOARD_PAGE_PATH, SCORER_APP_PATH, SCORER_PAGE_PATH, SCORER_QUEUE_COOKIE } from '../shared/contracts/superSpeakers.ts';

const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/client');
/** Built HTML of the student page entry (vite input `student.html`). */
const STUDENT_HTML = 'student.html';
/** `/s`, `/s?…`, `/s/…` and the built file itself: never cached, never indexed, no referrer. */
const isStudentPagePath = (url: string) => url === STUDENT_PAGE_PATH || /^\/s[?/#]/u.test(url) || url.startsWith(`/${STUDENT_HTML}`);
/** Super Speakers entries (S12): the scorer app (`/p`, `/p/app`) and the board (`/board`). */
const SCORER_HTML = 'scorer.html';
const BOARD_HTML = 'board.html';
/** The scorer and board pages, their built files and the service worker: never cached by browsers or proxies (the worker keeps its own shell copy). */
const isSpeakersPagePath = (url: string) =>
  /^\/(?:p|p\/app|board)(?:[?#]|$)/u.test(url) || url.startsWith(`/${SCORER_HTML}`) || url.startsWith(`/${BOARD_HTML}`) || url.startsWith('/scorer-sw.js');

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
  '*.code',
  // OAuth for AI apps (S14h2, D-160): never log a token, code, verifier or secret.
  '*.access_token',
  '*.refresh_token',
  '*.code_verifier',
  '*.client_secret',
  // AI connections (S19a, D-179): a pasted provider key.
  '*.apiKey',
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
  // Uploads (S9, STU-8): one file per request; per-kind size limits are applied again by the files module.
  await app.register(multipart, { limits: { files: 1, fields: 10, parts: 11, fieldSize: 4096, fileSize: MAX_UPLOAD_BYTES } });
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
    // An API answer is never cached, except a `private, …` header a route set on purpose (S24, D-184:
    // approved avatar pictures, whose address changes with every new picture).
    const cache = reply.getHeader('Cache-Control');
    const keep = typeof cache === 'string' && cache.startsWith('private, max-age=');
    if ((req.url.startsWith('/api/') || isStudentPagePath(req.url) || isSpeakersPagePath(req.url)) && !keep) reply.header('Cache-Control', 'no-store');
    // The student page and its API never send a referrer (STU-6; helmet sets it globally, kept explicit here).
    if (isStudentPagePath(req.url) || req.url.startsWith('/api/student/')) reply.header('Referrer-Policy', 'no-referrer');
  });

  // Super Speakers on its own origin (S14f, D-157), only while SPEAKERS_ORIGIN is set: the speakers
  // host serves only the scorer app, the board and their API; the main host moves those pages there
  // and retires the old scorer service worker. Unset, no hook is installed and nothing changes.
  const { origins } = deps.config;
  const notFound = (req: FastifyRequest, reply: FastifyReply) =>
    req.url.startsWith('/api/') ? reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } }) : reply.status(404).type('text/plain; charset=utf-8').send('Not found');
  if (origins.split) {
    app.addHook('onRequest', async (req, reply) => {
      const path = pathOf(req.url);
      // The raw Host header decides, never `req.host` (it follows X-Forwarded-Host behind a trusted
      // proxy, which a client can send): a forwarded host can only narrow to the speakers allow-list.
      if (isSpeakersHost(origins, req.headers)) {
        if (speakersHostAllows(path)) return;
        return notFound(req, reply);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return;
      // A scorer device with awards still queued opens the app here, sends them, then moves itself.
      if (movedToSpeakers(path, req.cookies[SCORER_QUEUE_COOKIE] === '1')) return reply.redirect(speakersRedirect(origins, req.url), 308);
      if (path === '/scorer-sw.js') return reply.type('text/javascript; charset=utf-8').send(SCORER_SW_KILL_SWITCH);
    });
  }

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

  // The personal student page (S10, STU-2): its own small client entry. The token is in the fragment,
  // which browsers never send, so this URL carries no secret.
  app.get(STUDENT_PAGE_PATH, (_req, reply) => {
    if (fs.existsSync(path.join(CLIENT_DIST, STUDENT_HTML))) return reply.sendFile(STUDENT_HTML);
    return reply.status(404).send('Client not built. Run `npm run build` or use `npm run dev`.');
  });

  // Super Speakers (S12, D-128): the scorer link page, the installed scorer app and the board. Tokens
  // live in the fragment only, so these URLs carry no secret.
  const page = (file: string) => (_req: FastifyRequest, reply: FastifyReply) => {
    if (fs.existsSync(path.join(CLIENT_DIST, file))) return reply.header('Referrer-Policy', 'no-referrer').sendFile(file);
    return reply.status(404).send('Client not built. Run `npm run build` or use `npm run dev`.');
  };
  app.get(SCORER_PAGE_PATH, page(SCORER_HTML));
  app.get(SCORER_APP_PATH, page(SCORER_HTML));
  app.get(BOARD_PAGE_PATH, page(BOARD_HTML));

  app.setNotFoundHandler((req, reply) => {
    // The speakers host never falls back to the main app's page (D-157).
    if (req.url.startsWith('/api/') || isSpeakersHost(origins, req.headers)) return notFound(req, reply);
    if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) return reply.sendFile('index.html');
    return reply.status(404).send('Client not built. Run `npm run build` or use `npm run dev`.');
  });

  if (fs.existsSync(CLIENT_DIST)) {
    await app.register(fastifyStatic, { root: CLIENT_DIST, prefix: '/', index: false, wildcard: false });
  }

  return app;
}
