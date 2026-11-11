/**
 * What the assistant chat's endpoints do (S19b, D-180): the teacher's status (available, connections,
 * defaults), sending a message (limits through `beginAssistantMessage`, D-179), answering a
 * confirmation card (single use, bound to the chat, message, call and account; the arguments are the
 * server's), and stopping an answer.
 */
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/assistantChat.ts';
import { tx } from '../../db/client.ts';
import { assistantChats, assistantMessages, type AssistantToolCallJson } from '../../db/schema.ts';
import { beginAssistantMessage, connectionForUse } from '../aiConnections/service.ts';
import { requireUser, type RequestContext, type UserRow } from '../../lib/context.ts';
import { AppError, conflict, notFound } from '../../lib/errors.ts';
import { ASSISTANT_VIA, assistantPrivacy, assistantToolByName, runAssistantTool, type AssistantPrivacy } from '../mcp/assistant.ts';
import { expirePending, runAgent, type AgentEnv } from './agent.ts';
import type { Run } from './runs.ts';
import { assertAvailable, assistantSettingsOf, defaultChoice, unavailableReason, usableConnections } from './settings.ts';
import { appendMessage, loadChat, type ChatRow } from './store.ts';

export function statusView(ctx: RequestContext): z.infer<typeof C.AssistantStatus> {
  const user = requireUser(ctx);
  const why = unavailableReason(ctx, user);
  const conns = why === 'OFF' || why === 'AI_TOOLS_OFF' ? [] : usableConnections(ctx, user);
  // The same choice a message without its own uses (`choiceOf`), so the picker never shows one that fails.
  const def = conns.length ? defaultChoice(ctx, user) : null;
  return {
    available: why === null,
    unavailable: why,
    studentNames: assistantPrivacy(ctx.db, user, ctx.now()).mode === 'named',
    connections: conns.map((c) => ({ id: c.id, name: c.name, type: c.type, scope: c.ownerUserId ? ('personal' as const) : ('school' as const), models: c.modelsJson.map((m) => ({ name: m.name, tools: m.tools })) })),
    defaultConnectionId: def?.connectionId ?? null,
    defaultModel: def?.model ?? null,
    retentionDays: assistantSettingsOf(ctx.db).retentionDays,
  };
}

/**
 * The connection and model a chat uses: the request's choice, else the chat's, else `defaultChoice` (the
 * school default while it can be used, else the first usable connection: what the status shows). The
 * result is checked again by `connectionForUse`.
 */
function choiceOf(ctx: RequestContext, user: UserRow, chat: ChatRow, input: { connectionId?: string | null | undefined; model?: string | null | undefined }) {
  const connectionId = input.connectionId !== undefined ? input.connectionId : chat.connectionId;
  const model = input.model !== undefined ? input.model : chat.model;
  if (connectionId !== null) return { connectionId, model };
  const def = defaultChoice(ctx, user);
  if (!def) throw new AppError('FEATURE_DISABLED', 'No connection is set up', { reason: 'AI_NO_CONNECTION' });
  return { connectionId: def.connectionId, model: model ?? def.model };
}

/** Checks a choice before it is stored on a chat (a connection the teacher may not use is a 404, a model not on it a 400). */
export function checkChoice(ctx: RequestContext, connectionId: string | null, model: string | null) {
  if (connectionId === null && model === null) return;
  connectionForUse(ctx, connectionId, model);
}

export function sendMessage(a: AgentEnv, ctx: RequestContext, input: z.infer<typeof C.sendAssistantMessage.input>): { runId: string; messageId: string } {
  const user = requireUser(ctx);
  const chat = loadChat(ctx, input.chatId);
  assertAvailable(ctx, user);
  if (a.registry.activeFor(chat.id)) throw conflict('An answer is still being written', { reason: 'ASSISTANT_BUSY' });
  const choice = choiceOf(ctx, user, chat, input);
  // Checks the connection and the model, the monthly budget and the daily message limit, and counts the message.
  const used = beginAssistantMessage(ctx, choice.connectionId, choice.model);
  const p = assistantPrivacy(ctx.db, user, ctx.now());
  const run = a.registry.start(chat.id, user.id, ctx.now());
  const now = ctx.now();
  const message = tx(ctx.db, () => {
    expirePending(ctx.db, chat.id, now);
    const content = p.toProvider(input.text);
    const row = appendMessage(ctx.db, chat.id, now, { role: 'user', content, privacy: p.mode, connectionId: used.row.id, model: used.model });
    const set: Partial<ChatRow> = { connectionId: input.connectionId === null ? null : used.row.id, model: input.model === null ? null : used.model };
    // A chat without a typed title is named after its first message (as stored: pseudonyms, shown with names).
    if (!chat.titleSet && chat.title === '') set.title = content.replace(/\s+/gu, ' ').trim().slice(0, 60);
    ctx.db.update(assistantChats).set(set).where(eq(assistantChats.id, chat.id)).run();
    return row;
  });
  start(a, ctx, chat.id, run, used, p);
  return { runId: run.id, messageId: message.id };
}

function start(a: AgentEnv, ctx: RequestContext, chatId: string, run: Run, used: { row: Parameters<typeof runAgent>[1]['connection']; model: string }, p: AssistantPrivacy) {
  // The run outlives the request; it ends on its own, on Stop, or when the session locks or ends.
  void runAgent(a, { ctx, chatId, run, connection: used.row, model: used.model, privacy: p });
}

/**
 * The teacher's Yes or No on one confirmation card. The call must be `pending` in this chat's message
 * (claimed in one transaction, so a second answer is a 409); a Yes runs the stored tool call as the
 * teacher (never arguments from the request). When no call of the message waits any more, the answer
 * continues in a new run.
 */
export async function answerCall(a: AgentEnv, ctx: RequestContext, input: z.infer<typeof C.answerAssistantCall.input>): Promise<{ runId: string | null }> {
  const user = requireUser(ctx);
  const chat = loadChat(ctx, input.chatId);
  if (input.approve) assertAvailable(ctx, user);
  if (a.registry.activeFor(chat.id)) throw conflict('An answer is still being written', { reason: 'ASSISTANT_BUSY' });
  const now = ctx.now();
  const call = tx(ctx.db, () => {
    const m = ctx.db.select().from(assistantMessages).where(eq(assistantMessages.id, input.messageId)).get();
    if (!m || m.chatId !== chat.id || m.role !== 'assistant') throw notFound('Message');
    const calls = m.toolCallsJson ?? [];
    const matches = calls.filter((x) => x.id === input.callId);
    const c = matches[0];
    if (!c) throw notFound('Call');
    // Ids are made unique when a reply is stored (runAgent); two calls with one id are never answered.
    if (matches.length > 1) throw conflict('This card cannot be answered', { reason: 'ASSISTANT_ALREADY_ANSWERED' });
    if (c.state !== 'pending') throw conflict('This change was already answered', { reason: 'ASSISTANT_ALREADY_ANSWERED' });
    const next: AssistantToolCallJson[] = calls.map((x) => (x.id === c.id ? { ...x, state: input.approve ? 'approved' : 'declined', decidedAt: now } : x));
    ctx.db.update(assistantMessages).set({ toolCallsJson: next }).where(eq(assistantMessages.id, m.id)).run();
    return { message: m, call: c, stillPending: next.some((x) => x.state === 'pending') };
  });
  const p = assistantPrivacy(ctx.db, user, now);
  if (input.approve) {
    const tool = assistantToolByName(call.call.name);
    if (!tool || tool.readOnly) throw new AppError('INTERNAL', 'Not a change tool');
    const toolCtx: RequestContext = { ...ctx, actor: { type: 'mcp', id: user.id, role: user.role, tokenId: `${ASSISTANT_VIA}${chat.id}` }, mcp: null };
    const r = await runAssistantTool({ app: a.app, ctx: toolCtx }, tool, call.call.arguments, p);
    tx(ctx.db, () => appendMessage(ctx.db, chat.id, ctx.now(), { role: 'tool', toolCallId: call.call.id, toolName: tool.name, content: r.content, isError: r.isError, untrusted: r.untrusted, privacy: p.mode }));
  } else {
    tx(ctx.db, () =>
      appendMessage(ctx.db, chat.id, ctx.now(), { role: 'tool', toolCallId: call.call.id, toolName: call.call.name, content: 'Not done: the teacher declined this change. Do not try it again unless the teacher asks.', privacy: p.mode }),
    );
  }
  if (call.stillPending) return { runId: null };
  // The model hears the outcome and goes on (no new message is counted; the budget is checked again).
  if (unavailableReason(ctx, user)) return { runId: null };
  const fresh = ctx.db.select().from(assistantChats).where(eq(assistantChats.id, chat.id)).get()!;
  const choice = choiceOf(ctx, user, fresh, { connectionId: call.message.connectionId ?? fresh.connectionId, model: call.message.model ?? fresh.model });
  const used = connectionForUse(ctx, choice.connectionId, choice.model);
  const run = a.registry.start(chat.id, user.id, ctx.now());
  start(a, ctx, chat.id, run, used, p);
  return { runId: run.id };
}

export function cancelRun(a: AgentEnv, ctx: RequestContext, runId: string) {
  const user = requireUser(ctx);
  const run = a.registry.get(runId, user.id);
  run.abort.abort();
  return { ok: true as const };
}
