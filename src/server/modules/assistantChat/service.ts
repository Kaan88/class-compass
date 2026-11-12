/**
 * What the assistant chat's endpoints do (S19b, D-180): the teacher's status (available, connections,
 * defaults), sending a message (limits through `beginAssistantMessage`, D-179), answering a
 * confirmation card (single use, bound to the chat, message, call and account; the arguments are the
 * server's), and stopping an answer.
 */
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { ASSISTANT_ATTACHMENT_MAX_BYTES, attachmentLanguage, utf8Bytes, withAttachment } from '../../../shared/assistantChat.ts';
import type * as C from '../../../shared/contracts/assistantChat.ts';
import { tx } from '../../db/client.ts';
import { assistantChats, assistantMessages, type AssistantToolCallJson } from '../../db/schema.ts';
import { beginAssistantMessage, connectionForUse } from '../aiConnections/service.ts';
import { requireUser, type RequestContext, type UserRow } from '../../lib/context.ts';
import { AppError, conflict, invalid, notFound } from '../../lib/errors.ts';
import { ASSISTANT_VIA, assistantPrivacy, assistantToolByName, runAssistantTool, type AssistantPrivacy } from '../mcp/assistant.ts';
import { expirePending, runAgent, type AgentEnv } from './agent.ts';
import type { Run } from './runs.ts';
import { assertAvailable, assistantSettingsOf, defaultChoice, unavailableReason, usableConnections } from './settings.ts';
import { appendMessage, loadChat, nextAttachmentRef, resolveAttachmentArgs, type ChatRow } from './store.ts';

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
 * The connection and model a chat uses: the request's choice, else the chat's own (one the teacher chose)
 * while it can still be used, else `defaultChoice` (the school default while it can be used, else the
 * first usable connection: what the status shows). A chat's own choice that can no longer be used
 * (deleted, paused, over budget, own connections not allowed, a model taken off) falls back to the
 * default; a choice in the request is kept, and the result is checked again by `connectionForUse`.
 */
function choiceOf(ctx: RequestContext, user: UserRow, stored: { connectionId: string | null; model: string | null }, input: { connectionId?: string | null | undefined; model?: string | null | undefined }) {
  if (input.connectionId !== undefined && input.connectionId !== null) return { connectionId: input.connectionId, model: input.model ?? null };
  const usable = usableConnections(ctx, user);
  const fits = (id: string, model: string | null) => model !== null && !!usable.find((c) => c.id === id)?.modelsJson.some((m) => m.name === model);
  if (input.connectionId === undefined && stored.connectionId !== null) {
    const model = input.model !== undefined ? input.model : stored.model;
    if (usable.some((c) => c.id === stored.connectionId) && (model === null || fits(stored.connectionId, model))) return { connectionId: stored.connectionId, model };
  }
  const def = defaultChoice(ctx, user);
  if (!def) throw new AppError('FEATURE_DISABLED', 'No connection is set up', { reason: 'AI_NO_CONNECTION' });
  // A model asked for is checked by `connectionForUse`; a stored one is kept only while the default connection has it.
  if (input.model !== undefined && input.model !== null) return { connectionId: def.connectionId, model: input.model };
  const kept = stored.connectionId === null && input.connectionId === undefined && fits(def.connectionId, stored.model) ? stored.model : null;
  return { connectionId: def.connectionId, model: kept ?? def.model };
}

/** Checks a choice before it is stored on a chat (a connection the teacher may not use is a 404, a model not on it a 400). */
export function checkChoice(ctx: RequestContext, connectionId: string | null, model: string | null) {
  if (connectionId === null && model === null) return;
  connectionForUse(ctx, connectionId, model);
}

/**
 * The text a message stores and sends (S27d, D-196): the typed text, with an attached text file as a
 * fenced block. Only .json, .txt and .md up to 200 KB (UTF-8 bytes); anything else is refused before
 * the message counts against a limit. An empty message without a file is refused too.
 */
export function messageText(input: Pick<z.infer<typeof C.sendAssistantMessage.input>, 'text' | 'attachment'>, ref = 'file-1'): string {
  const text = input.text.trim();
  if (!input.attachment) {
    if (!text) throw invalid('Write a message', { reason: 'ASSISTANT_EMPTY_MESSAGE' });
    return text;
  }
  const lang = attachmentLanguage(input.attachment.name);
  if (!lang) throw invalid('Only .json, .txt and .md files can be attached', { reason: 'ASSISTANT_ATTACHMENT_TYPE' });
  if (utf8Bytes(input.attachment.text) > ASSISTANT_ATTACHMENT_MAX_BYTES) throw invalid('The file is larger than 200 KB', { reason: 'ASSISTANT_ATTACHMENT_TOO_BIG', limit: ASSISTANT_ATTACHMENT_MAX_BYTES });
  return withAttachment(text, input.attachment, lang, ref);
}

export function sendMessage(a: AgentEnv, ctx: RequestContext, input: z.infer<typeof C.sendAssistantMessage.input>): { runId: string; messageId: string } {
  const user = requireUser(ctx);
  const chat = loadChat(ctx, input.chatId);
  // Checked before anything counts (type, size); the text with the file's reference is made below.
  messageText(input);
  assertAvailable(ctx, user);
  // The run's slot (one per chat, `RUNS_PER_USER` per account) is taken before the message counts against
  // the daily limit, and given back when anything below refuses: a refused send uses up nothing.
  const run = a.registry.start(chat.id, user.id, ctx.now());
  let begun: { used: ReturnType<typeof beginAssistantMessage>; p: AssistantPrivacy; messageId: string };
  try {
    const choice = choiceOf(ctx, user, chat, input);
    // Checks the connection and the model, the monthly budget and the daily message limit, and counts the message.
    const used = beginAssistantMessage(ctx, choice.connectionId, choice.model);
    const p = assistantPrivacy(ctx.db, user, ctx.now());
    const now = ctx.now();
    const message = tx(ctx.db, () => {
      expirePending(ctx.db, chat.id, now);
      // A .json file is also kept exactly as attached, under its reference, for the theme tools (S27d
      // review): the provider gets the message text (names filtered while student data is off).
      const ref = nextAttachmentRef(ctx.db, chat.id);
      const typed = messageText(input, ref);
      const content = p.toProvider(typed);
      const keep = input.attachment && attachmentLanguage(input.attachment.name) === 'json' ? { ref, name: input.attachment.name, text: input.attachment.text.replace(/\r\n?/gu, '\n') } : null;
      const row = appendMessage(ctx.db, chat.id, now, { role: 'user', content, attachmentJson: keep, privacy: p.mode, connectionId: used.row.id, model: used.model });
      // Only a choice the teacher made in the request is kept with the chat; without one the chat goes on
      // following the school default (`choiceOf`).
      const set: Partial<ChatRow> = {};
      if (input.connectionId !== undefined) set.connectionId = input.connectionId === null ? null : used.row.id;
      if (input.connectionId !== undefined || input.model !== undefined) set.model = input.model === null ? null : used.model;
      // A chat without a typed title is named after its first message (as stored: pseudonyms, shown with names).
      if (!chat.titleSet && chat.title === '') set.title = content.replace(/\s+/gu, ' ').trim().slice(0, 60);
      if (Object.keys(set).length) ctx.db.update(assistantChats).set(set).where(eq(assistantChats.id, chat.id)).run();
      return row;
    });
    begun = { used, p, messageId: message.id };
  } catch (e) {
    a.registry.discard(run);
    throw e;
  }
  start(a, ctx, chat.id, run, begun.used, begun.p);
  return { runId: run.id, messageId: begun.messageId };
}

function start(a: AgentEnv, ctx: RequestContext, chatId: string, run: Run, used: { row: Parameters<typeof runAgent>[1]['connection']; model: string }, p: AssistantPrivacy) {
  // The run outlives the request; it ends on its own, on Stop, or when the session ends (a PIN lock does not end it, D-204).
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
  // The slot of the run that goes on afterwards is taken first (one per chat, `RUNS_PER_USER` per
  // account): an answer refused as busy changes nothing; the slot is given back when no run follows.
  const run = a.registry.start(chat.id, user.id, ctx.now());
  let started = false;
  try {
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
      // Looked up before the card is claimed: a tool this account may not use any more (a role change, a
      // tool taken away) leaves the card refused, never approved with nothing done.
      const found = assistantToolByName(user.role, c.name);
      const tool = found && !found.readOnly ? found : null;
      const state = !input.approve ? 'declined' : tool ? 'approved' : 'refused';
      const next: AssistantToolCallJson[] = calls.map((x) => (x.id === c.id ? { ...x, state, decidedAt: now } : x));
      ctx.db.update(assistantMessages).set({ toolCallsJson: next }).where(eq(assistantMessages.id, m.id)).run();
      return { message: m, call: c, tool, stillPending: next.some((x) => x.state === 'pending') };
    });
    const p = assistantPrivacy(ctx.db, user, now);
    if (input.approve && call.tool) {
      const tool = call.tool;
      const toolCtx: RequestContext = { ...ctx, actor: { type: 'mcp', id: user.id, role: user.role, tokenId: `${ASSISTANT_VIA}${chat.id}` }, mcp: null };
      const resolved = resolveAttachmentArgs(ctx.db, chat.id, tool.name, call.call.arguments);
      const r = resolved.ok ? await runAssistantTool({ app: a.app, ctx: toolCtx }, tool, resolved.args, p) : { content: resolved.content, isError: true, untrusted: false };
      tx(ctx.db, () => appendMessage(ctx.db, chat.id, ctx.now(), { role: 'tool', toolCallId: call.call.id, toolName: tool.name, content: r.content, isError: r.isError, untrusted: r.untrusted, privacy: p.mode }));
    } else if (input.approve) {
      tx(ctx.db, () =>
        appendMessage(ctx.db, chat.id, ctx.now(), { role: 'tool', toolCallId: call.call.id, toolName: call.call.name, content: 'Not done: this tool is not available to this account any more.', isError: true, privacy: p.mode }),
      );
    } else {
      tx(ctx.db, () =>
        appendMessage(ctx.db, chat.id, ctx.now(), { role: 'tool', toolCallId: call.call.id, toolName: call.call.name, content: 'Not done: the teacher declined this change. Do not try it again unless the teacher asks.', privacy: p.mode }),
      );
    }
    if (call.stillPending) return { runId: null };
    // The model hears the outcome and goes on (no new message is counted; the budget is checked again).
    if (unavailableReason(ctx, user)) return { runId: null };
    const fresh = ctx.db.select().from(assistantChats).where(eq(assistantChats.id, chat.id)).get()!;
    // The connection of the answer the card was in while it can still be used, else the default.
    const choice = choiceOf(ctx, user, { connectionId: call.message.connectionId ?? fresh.connectionId, model: call.message.connectionId ? call.message.model : fresh.model }, {});
    const used = connectionForUse(ctx, choice.connectionId, choice.model);
    start(a, ctx, chat.id, run, used, p);
    started = true;
    return { runId: run.id };
  } finally {
    if (!started) a.registry.discard(run);
  }
}

export function cancelRun(a: AgentEnv, ctx: RequestContext, runId: string) {
  const user = requireUser(ctx);
  const run = a.registry.get(runId, user.id);
  run.abort.abort();
  return { ok: true as const };
}
