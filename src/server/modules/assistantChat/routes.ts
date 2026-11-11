import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/assistantChat.ts';
import type { AppDeps } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { AppError } from '../../lib/errors.ts';
import { rawRoute, route } from '../../lib/http.ts';
import { assistantPrivacy } from '../mcp/assistant.ts';
import { sessionGate, type AgentEnv } from './agent.ts';
import { RunRegistry } from './runs.ts';
import { answerCall, cancelRun, checkChoice, sendMessage, statusView } from './service.ts';
import { adminView, setAdmin } from './settings.ts';
import { CardLookup, createChat, deleteChat, exportChats, listChats, loadChat, messageViews, messagesOf, summaryOf, updateChat } from './store.ts';

/** A message reaches the provider (and costs tokens): at most 30 a minute per address, besides the daily limit per teacher. */
const SEND_LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };
/** A heartbeat comment under proxies' idle timeouts (Cloudflare about 100 s). */
const HEARTBEAT_MS = 20_000;

/** The run registry of each app instance (tests build several apps in one process). */
export const registries = new WeakMap<FastifyInstance, RunRegistry>();

export function registerAssistantChatRoutes(app: FastifyInstance, deps: AppDeps) {
  const registry = new RunRegistry();
  registries.set(app, registry);
  const a: AgentEnv = { app, registry };
  app.addHook('onClose', async () => {
    registry.abortAll();
    await Promise.all(registry.all().map((r) => r.finished));
  });

  route(app, deps, C.assistantStatus, (ctx) => statusView(ctx));
  route(app, deps, C.listAssistantChats, (ctx, input) => ({ chats: listChats(ctx, assistantPrivacy(ctx.db, requireUser(ctx), ctx.now()), input.q, input.archived === 'true') }));
  route(app, deps, C.createAssistantChat, (ctx, input) => {
    const choice = { connectionId: input.connectionId ?? null, model: input.model ?? null };
    checkChoice(ctx, choice.connectionId, choice.model);
    return summaryOf(assistantPrivacy(ctx.db, requireUser(ctx), ctx.now()), createChat(ctx, choice));
  });
  route(app, deps, C.getAssistantChat, (ctx, input) => {
    const user = requireUser(ctx);
    const chat = loadChat(ctx, input.chatId);
    const p = assistantPrivacy(ctx.db, user, ctx.now());
    return { chat: summaryOf(p, chat), messages: messageViews(p, new CardLookup(ctx.db, user, p), messagesOf(ctx.db, chat.id)), runId: registry.activeFor(chat.id)?.id ?? null, compacted: chat.summarySeq > 0 };
  });
  route(app, deps, C.updateAssistantChat, (ctx, input) => {
    const user = requireUser(ctx);
    const chat = loadChat(ctx, input.chatId);
    const p = assistantPrivacy(ctx.db, user, ctx.now());
    if (input.connectionId !== undefined || input.model !== undefined) checkChoice(ctx, input.connectionId ?? null, input.model ?? null);
    const patch = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.archived !== undefined ? { archived: input.archived } : {}),
      ...(input.connectionId !== undefined ? { connectionId: input.connectionId } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
    };
    return summaryOf(p, updateChat(ctx, chat, patch, p.toProvider));
  });
  route(app, deps, C.deleteAssistantChat, (ctx, input) => {
    const chat = loadChat(ctx, input.chatId);
    registry.activeFor(chat.id)?.abort.abort();
    deleteChat(ctx, chat);
    return { ok: true as const };
  });
  route(app, deps, C.sendAssistantMessage, (ctx, input) => sendMessage(a, ctx, input), SEND_LIMIT);
  route(app, deps, C.answerAssistantCall, (ctx, input) => answerCall(a, ctx, input), SEND_LIMIT);
  route(app, deps, C.cancelAssistantRun, (ctx, input) => cancelRun(a, ctx, input.runId));

  /**
   * The answer as it is written (Server-Sent Events, D-180 refining D-134): this stream carries data,
   * the owner's own answer, so every event is parsed by the allow-list `AssistantRunEvent` and the
   * session is checked again (signed in, active, unlocked) before every write; a locked device gets no
   * more text. It ends after the run's `end` event. `after` resumes after a reconnect.
   */
  rawRoute(app, deps, C.assistantRunEvents, (ctx, input, { req, reply }) => {
    const user = requireUser(ctx);
    const run = registry.get(input.runId, user.id);
    const sessionId = ctx.session?.id ?? null;
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
    let sent = input.after ?? 0;
    let closed = false;
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      if (scheduled) clearTimeout(scheduled);
      run.listeners.delete(schedule);
      res.end();
    };
    const flush = () => {
      scheduled = null;
      if (closed) return;
      if (sessionGate(deps, sessionId, user.id) !== 'ok') return close();
      let out = '';
      for (const ev of run.events) {
        if (ev.seq <= sent) continue;
        out += `id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(C.AssistantRunEvent.parse(ev))}\n\n`;
        sent = ev.seq;
      }
      if (out) res.write(out);
      if (run.done && sent >= run.events.length) close();
    };
    // Text arrives in many small pieces: they are sent together every few milliseconds.
    function schedule() {
      if (!closed && !scheduled) scheduled = setTimeout(flush, 30);
    }
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': hb\n\n');
      schedule();
    }, HEARTBEAT_MS);
    run.listeners.add(schedule);
    req.raw.on('close', close);
    res.write('retry: 3000\n\n');
    flush();
  });

  /** The teacher's own data export of their chats (a JSON file, audited by count). */
  rawRoute(app, deps, C.exportAssistantChats, (ctx, _input, { reply }) => {
    const user = requireUser(ctx);
    const body = JSON.stringify(exportChats(ctx, assistantPrivacy(ctx.db, user, ctx.now())), null, 2);
    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', 'attachment; filename="assistant-chats.json"')
      .header('cache-control', 'no-store')
      .send(body);
    return undefined;
  });

  // Administrators: the switch and the retention, with counts only (never chat content).
  route(app, deps, C.assistantAdmin, (ctx) => adminView(ctx));
  route(app, deps, C.setAssistantAdmin, (ctx, input) => setAdmin(ctx, input));
}

/** Waits until every answer being written in this app has ended (tests). */
export async function settleRuns(app: FastifyInstance) {
  const r = registries.get(app);
  if (!r) throw new AppError('INTERNAL', 'No assistant registry');
  await Promise.all(r.all().map((x) => x.finished));
}
