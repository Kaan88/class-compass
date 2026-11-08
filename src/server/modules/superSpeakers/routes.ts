/**
 * Super Speakers endpoints (S12). Scorer and board endpoints use their own access classes and cookies
 * (D-128); the board stream is Server-Sent Events (D-134).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import * as C from '../../../shared/contracts/superSpeakers.ts';
import type { CommandResult } from '../../../shared/contracts/commands.ts';
import type { Locale } from '../../../shared/i18n/index.ts';
import { audit } from '../../lib/audit.ts';
import { executeCommand } from '../../lib/commands.ts';
import { requireScorer, type AppDeps, type RequestContext } from '../../lib/context.ts';
import { AppError } from '../../lib/errors.ts';
import { DISPLAY_SESSION_ABSOLUTE_MS, SCORER_SESSION_ABSOLUTE_MS, displayCookieName, loadDisplaySession, rawRoute, route, scorerCookieName } from '../../lib/http.ts';
import { attachment, csvDelimiter, findTable, tableCsv } from '../reports/service.ts';
import { getSchoolSettings } from '../school/policy.ts';
import { onBoardChange } from './events.ts';
import { adminHistory } from './history.ts';
import * as svc from './service.ts';

/** Outer bound on exchange/pairing requests per minute per address; refused ones are limited much more tightly in the service. */
const EXCHANGE_RATE = { max: 120, timeWindow: '1 minute' };
const PAIR_RATE = { max: 30, timeWindow: '1 minute' };

function setCookie(reply: FastifyReply, name: string, value: string, deps: AppDeps, maxAgeMs: number) {
  reply.setCookie(name, value, { path: '/', httpOnly: true, secure: deps.config.isProd, sameSite: 'strict', maxAge: Math.floor(maxAgeMs / 1000) });
}

/** Open board streams, closed when the server stops (so shutdown never waits for them). */
const streams = new Set<() => void>();

export function registerSpeakersRoutes(app: FastifyInstance, deps: AppDeps) {
  svc.ensureSettings(deps.db, deps.now());
  app.addHook('onClose', async () => {
    for (const close of [...streams]) close();
  });

  // ---------------------------------------------------------------- scorer
  route(app, deps, C.exchangeScorerLink, (ctx, input, { reply }) => {
    const { token } = svc.exchangeScorerToken(ctx, ctx.ip, input.token);
    setCookie(reply, scorerCookieName(deps), token, deps, SCORER_SESSION_ABSOLUTE_MS);
    return { ok: true as const };
  }, { rateLimit: EXCHANGE_RATE });
  route(app, deps, C.pairScorer, (ctx, input, { reply }) => {
    const { token } = svc.pairWithCode(ctx, ctx.ip, input.code);
    setCookie(reply, scorerCookieName(deps), token, deps, SCORER_SESSION_ABSOLUTE_MS);
    return { ok: true as const };
  }, { rateLimit: PAIR_RATE });
  route(app, deps, C.leaveScorerSession, (ctx, _i, { reply }) => {
    svc.endSession(ctx);
    reply.clearCookie(scorerCookieName(deps), { path: '/' });
    return { ok: true as const };
  });
  route(app, deps, C.scorerMe, (ctx) => svc.scorerMe(ctx));
  route(app, deps, C.createPairingCode, (ctx) => svc.createPairingCode(ctx), { rateLimit: { max: 20, timeWindow: '10 minutes' } });
  route(app, deps, C.scorerStudents, (ctx) => svc.scorerStudents(ctx));
  route(app, deps, C.scorerAwards, (ctx) => svc.scorerAwards(ctx));
  route(app, deps, C.submitScorerCommands, (ctx, input) => {
    const scorer = requireScorer(ctx);
    // Commands queued under another scorer link on this device are never applied as this one.
    if (input.asScorer !== undefined && input.asScorer !== scorer.scorerLinkId) {
      throw new AppError('CONFLICT', 'These points were queued by another scorer link', { reason: 'WRONG_ACCOUNT' });
    }
    const results: CommandResult[] = input.commands.map((c) =>
      c.type.startsWith('points.') ? executeCommand(ctx, c) : { opId: c.opId, ok: false, replayed: false, error: { code: 'FORBIDDEN', message: 'Scorer links can only give points', reason: 'SCORER_ONLY' } },
    );
    return { results };
  });

  // ---------------------------------------------------------------- board (display)
  route(app, deps, C.exchangeBoardLink, (ctx, input, { reply }) => {
    const { token } = svc.exchangeDisplayToken(ctx, ctx.ip, input.token);
    setCookie(reply, displayCookieName(deps), token, deps, DISPLAY_SESSION_ABSOLUTE_MS);
    return { ok: true as const };
  }, { rateLimit: EXCHANGE_RATE });
  route(app, deps, C.board, (ctx, _i, { req, reply }) => {
    const b = svc.buildBoard(ctx.db, ctx.now());
    // Conditional GET (D-045) for the 10-second fallback poll.
    const etag = `"${b.version}"`;
    reply.header('ETag', etag);
    if (req.headers['if-none-match'] === etag) reply.code(304).send();
    return b;
  });
  /**
   * Server-Sent Events (SSP-8, D-134): `event: version` with the board version at once and on every
   * change; a comment line every heartbeat (default 25 s, under Cloudflare's ~100 s idle timeout), which
   * also re-checks the board link (a revoked link closes the stream) and the week (rollover). No
   * buffering or transformation by proxies: `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`.
   */
  rawRoute(app, deps, C.boardEvents, (ctx, _i, { req, reply }) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
    });
    res.flushHeaders?.();
    let last = '';
    let closed = false;
    const send = (chunk: string) => {
      if (!closed) res.write(chunk);
    };
    const push = () => {
      if (closed) return;
      // Revocation is immediate: the board link is checked again before anything is sent.
      if (!loadDisplaySession(deps, req).display) return close();
      const v = svc.boardVersion(ctx.db, ctx.now());
      if (v !== last) {
        last = v;
        send(`event: version\ndata: ${v}\n\n`);
      }
    };
    const heartbeat = setInterval(() => {
      send(': hb\n\n');
      push();
    }, deps.config.SPEAKERS_HEARTBEAT_MS);
    const unsubscribe = onBoardChange(push);
    function close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(close);
      res.end();
    }
    streams.add(close);
    req.raw.on('close', close);
    send('retry: 5000\n\n');
    push();
  });

  // ---------------------------------------------------------------- admin
  route(app, deps, C.speakersAdmin, (ctx) => svc.adminOverview(ctx));
  route(app, deps, C.setSpeakersSettings, (ctx, input) => svc.saveSettings(ctx, input));
  route(app, deps, C.createScorerLink, (ctx, input) => svc.createScorer(ctx, input));
  route(app, deps, C.updateScorerLink, (ctx, input) => svc.updateScorer(ctx, input));
  route(app, deps, C.regenerateScorerLink, (ctx, input) => svc.regenerateScorer(ctx, input.id));
  route(app, deps, C.revokeScorerLink, (ctx, input) => svc.revokeScorer(ctx, input.id));
  route(app, deps, C.createDisplayLink, (ctx, input) => svc.createDisplay(ctx, input));
  route(app, deps, C.regenerateDisplayLink, (ctx, input) => svc.regenerateDisplay(ctx, input.id));
  route(app, deps, C.revokeDisplayLink, (ctx, input) => svc.revokeDisplay(ctx, input.id));
  route(app, deps, C.speakersAwards, (ctx, input) => svc.listAwards(ctx, input));
  route(app, deps, C.voidAward, (ctx, input) => svc.adminVoid(ctx, input));
  route(app, deps, C.adminBoard, (ctx) => svc.buildBoard(ctx.db, ctx.now()));
  route(app, deps, C.speakersHistory, (ctx, input) => ({ from: input.from, to: input.to, section: { ...adminHistory(ctx, input.from, input.to), module: 'superSpeakers' as const } }));
  rawRoute(app, deps, C.speakersHistoryCsv, (ctx, input, { reply }) => {
    const section = { ...adminHistory(ctx, input.from, input.to), module: 'superSpeakers' as const };
    const t = findTable([section], 'superSpeakers', input.table);
    const locale: Locale = ctx.user?.locale ?? getSchoolSettings(ctx.db).defaultLocale;
    sendAudited(ctx, input);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', attachment(`super-speakers-${input.table}-${input.from}_${input.to}.csv`))
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .send(tableCsv(t, locale, csvDelimiter(input.delimiter)));
  });
}

function sendAudited(ctx: RequestContext, input: { from: string; to: string; table: string }) {
  audit(ctx.db, ctx.actor, { action: 'report.csv_exported', entity: 'report', entityId: null, after: { section: 'superSpeakers', table: input.table, from: input.from, to: input.to } }, ctx.now());
}
