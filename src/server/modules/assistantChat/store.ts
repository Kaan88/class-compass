/**
 * Chats and messages of the assistant (S19b, D-180): private to their owner (another account's chat is
 * a 404), stored as sent to the provider, shown with real names (`toBrowser`), searched, renamed,
 * archived and deleted by their owner, exported by their owner, scrubbed when a student is erased.
 */
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ASSISTANT_CHATS_MAX } from '../../../shared/assistantChat.ts';
import type * as C from '../../../shared/contracts/assistantChat.ts';
import { pickText } from '../../lib/i18n.ts';
import { tx, type Db } from '../../db/client.ts';
import { assistantChats, assistantMessages, classes, subjects, teachingContexts, type AssistantToolCallJson } from '../../db/schema.ts';
import type { ChatMessage, ToolCall } from '../aiConnections/adapters/types.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext, type UserRow } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { conflict, notFound } from '../../lib/errors.ts';
import { assistantPseudonymsOf, assistantToolByName, studentNameFor, toBrowser, type AssistantPrivacy } from '../mcp/assistant.ts';
import { foldSameLength, NameScrubber } from '../mcp/privacy.ts';

export type ChatRow = typeof assistantChats.$inferSelect;
export type MessageRow = typeof assistantMessages.$inferSelect;
type CallView = z.infer<typeof C.AssistantCallView>;

/** The caller's chat; anything else (missing, another account's) is a 404. */
export function loadChat(ctx: RequestContext, chatId: string): ChatRow {
  const user = requireUser(ctx);
  const row = ctx.db.select().from(assistantChats).where(eq(assistantChats.id, chatId)).get();
  if (!row || row.ownerUserId !== user.id) throw notFound('Chat');
  return row;
}

export const messagesOf = (db: Db, chatId: string): MessageRow[] => db.select().from(assistantMessages).where(eq(assistantMessages.chatId, chatId)).orderBy(asc(assistantMessages.seq)).all();

export function summaryOf(p: AssistantPrivacy, row: ChatRow): z.infer<typeof C.AssistantChatSummary> {
  return { id: row.id, title: toBrowser(p, row.title), createdAt: row.createdAt, lastMessageAt: row.lastMessageAt, archived: row.archivedAt !== null, connectionId: row.connectionId, model: row.model };
}

// ---------------------------------------------------------------- labels for the activity lines and cards
/** "3-A English" for each class+subject the teacher has (or had) — ids are not personal, so this is only for the browser. */
export function contextLabels(db: Db, user: UserRow): Map<string, string> {
  const rows = db
    .select({ id: teachingContexts.id, className: classes.name, subject: subjects.name })
    .from(teachingContexts)
    .innerJoin(classes, eq(classes.id, teachingContexts.classId))
    .innerJoin(subjects, eq(subjects.id, teachingContexts.subjectId))
    .where(eq(teachingContexts.teacherId, user.id))
    .all();
  return new Map(rows.map((r) => [r.id, `${r.className} ${pickText(r.subject, user.locale)}`.trim()]));
}

const SKIP_KEYS = new Set(['opId', 'batchId']);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One argument value as the teacher reads it: student ids and aliases as names, class+subject ids as their names, pseudonyms in text as names. */
function display(p: AssistantPrivacy, labels: Map<string, string>, v: unknown, depth = 0): string {
  if (typeof v === 'string') return studentNameFor(p, v) ?? labels.get(v) ?? toBrowser(p, v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return '—';
  if (depth > 2) return '…';
  if (Array.isArray(v)) return v.map((x) => display(p, labels, x, depth + 1)).join('; ');
  if (isRecord(v))
    return Object.entries(v)
      .filter(([k]) => !SKIP_KEYS.has(k))
      .map(([k, x]) => `${k}: ${display(p, labels, x, depth + 1)}`)
      .join(', ');
  return String(v);
}
const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What a call is about, for its activity line: the class+subject and/or the student. */
export function targetOf(p: AssistantPrivacy, labels: Map<string, string>, args: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const ctxLabel = typeof args.contextId === 'string' ? labels.get(args.contextId) : undefined;
  if (ctxLabel) parts.push(ctxLabel);
  const student = studentNameFor(p, args.studentId);
  if (student) parts.push(student);
  if (!parts.length && typeof args.guide === 'string') parts.push(args.guide);
  return parts.length ? parts.join(' · ') : null;
}

/** A stored call as the browser sees it (`result`: its tool row, when it ran). */
export function callView(p: AssistantPrivacy, labels: Map<string, string>, call: AssistantToolCallJson, result: MessageRow | undefined): CallView {
  const tool = assistantToolByName(call.name);
  const readOnly = tool?.readOnly ?? true;
  const changes = readOnly
    ? []
    : Object.entries(call.arguments)
        .filter(([k]) => !SKIP_KEYS.has(k))
        .slice(0, 20)
        .map(([key, value]) => ({ key, value: clip(display(p, labels, value)) }));
  return { id: call.id, tool: tool ? call.name : 'unknown', readOnly, state: call.state, target: targetOf(p, labels, call.arguments), changes, failed: result ? result.isError : null };
}

export function messageViews(p: AssistantPrivacy, labels: Map<string, string>, rows: MessageRow[]): Array<z.infer<typeof C.AssistantMessageView>> {
  const results = new Map(rows.filter((r) => r.role === 'tool' && r.toolCallId).map((r) => [r.toolCallId!, r]));
  return rows
    .filter((r) => r.role !== 'tool')
    .map((r) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant',
      text: toBrowser(p, r.content),
      createdAt: r.createdAt,
      status: r.status,
      errorCode: r.errorCode,
      calls: (r.toolCallsJson ?? []).map((c) => callView(p, labels, c, results.get(c.id))),
    }));
}

// ---------------------------------------------------------------- what the provider gets
/**
 * The chat as provider messages, from the last summary on: every tool call is followed by its result
 * (a call that never ran, refused or declined or expired, gets a short result that says so).
 */
export function historyFor(chat: ChatRow, rows: MessageRow[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const results = new Map(rows.filter((r) => r.role === 'tool' && r.toolCallId).map((r) => [r.toolCallId!, r]));
  for (const r of rows) {
    if (r.seq <= chat.summarySeq) continue;
    if (r.role === 'user') out.push({ role: 'user', content: r.content });
    else if (r.role === 'assistant') {
      const calls = r.toolCallsJson ?? [];
      // A call still waiting for the teacher is not sent (the model gets it back once it is answered).
      if (calls.some((c) => c.state === 'pending')) {
        if (r.content) out.push({ role: 'assistant', content: r.content });
        continue;
      }
      const toolCalls: ToolCall[] = calls.map((c) => ({
        id: c.id,
        ...(c.generatedId ? { generatedId: true as const } : {}),
        name: c.name,
        arguments: c.arguments,
        ...(c.invalidArguments ? { invalidArguments: true as const } : {}),
        ...(c.signature ? { signature: c.signature } : {}),
      }));
      out.push(toolCalls.length ? { role: 'assistant', content: r.content, toolCalls } : { role: 'assistant', content: r.content });
      for (const c of calls) {
        const res = results.get(c.id);
        if (res) out.push({ role: 'tool', toolCallId: c.id, name: c.name, content: res.content, ...(res.isError ? { isError: true } : {}) });
        else out.push({ role: 'tool', toolCallId: c.id, name: c.name, content: c.state === 'expired' ? 'Not done: the teacher moved on without answering.' : 'Not done.', isError: true });
      }
    }
  }
  // Leading assistant or tool messages after a summary cut are dropped (providers want a user turn first).
  while (out.length && out[0]!.role !== 'user') out.shift();
  return out;
}

// ---------------------------------------------------------------- writing
/** Appends a message with the chat's next number (inside the caller's transaction). */
export function appendMessage(db: Db, chatId: string, now: number, m: Omit<typeof assistantMessages.$inferInsert, 'id' | 'chatId' | 'seq' | 'createdAt'> & { id?: string }): MessageRow {
  const chat = db.select({ nextSeq: assistantChats.nextSeq }).from(assistantChats).where(eq(assistantChats.id, chatId)).get();
  if (!chat) throw notFound('Chat');
  const row = { ...m, id: m.id ?? newId(), chatId, seq: chat.nextSeq, createdAt: now };
  db.insert(assistantMessages).values(row).run();
  db.update(assistantChats).set({ nextSeq: chat.nextSeq + 1, lastMessageAt: now, updatedAt: now }).where(eq(assistantChats.id, chatId)).run();
  return db.select().from(assistantMessages).where(eq(assistantMessages.id, row.id)).get()!;
}

export function createChat(ctx: RequestContext, choice: { connectionId: string | null; model: string | null }): ChatRow {
  const user = requireUser(ctx);
  const now = ctx.now();
  return tx(ctx.db, () => {
    const n = ctx.db.select({ n: sql<number>`count(*)` }).from(assistantChats).where(eq(assistantChats.ownerUserId, user.id)).get()?.n ?? 0;
    if (n >= ASSISTANT_CHATS_MAX) throw conflict('Too many chats: delete old ones first', { reason: 'ASSISTANT_TOO_MANY_CHATS', max: ASSISTANT_CHATS_MAX });
    const row: ChatRow = { id: newId(), ownerUserId: user.id, title: '', titleSet: false, connectionId: choice.connectionId, model: choice.model, summary: null, summarySeq: 0, nextSeq: 1, createdAt: now, updatedAt: now, lastMessageAt: now, archivedAt: null };
    ctx.db.insert(assistantChats).values(row).run();
    return row;
  });
}

export function updateChat(ctx: RequestContext, chat: ChatRow, patch: { title?: string; archived?: boolean; connectionId?: string | null; model?: string | null }, toProvider: (s: string) => string): ChatRow {
  const now = ctx.now();
  const set: Partial<ChatRow> = {};
  // A title the teacher types is stored like a message (as it would be sent), so erasure and pseudonyms treat it the same.
  if (patch.title !== undefined) {
    set.title = toProvider(patch.title);
    set.titleSet = true;
  }
  if (patch.archived !== undefined) set.archivedAt = patch.archived ? (chat.archivedAt ?? now) : null;
  if (patch.connectionId !== undefined) set.connectionId = patch.connectionId;
  if (patch.model !== undefined) set.model = patch.model;
  if (!Object.keys(set).length) return chat;
  ctx.db
    .update(assistantChats)
    .set({ ...set, updatedAt: now })
    .where(eq(assistantChats.id, chat.id))
    .run();
  return { ...chat, ...set, updatedAt: now };
}

export function deleteChat(ctx: RequestContext, chat: ChatRow) {
  // Messages go with it (cascade). Only a count is audited, never the content.
  tx(ctx.db, () => {
    const n = ctx.db.select({ n: sql<number>`count(*)` }).from(assistantMessages).where(eq(assistantMessages.chatId, chat.id)).get()?.n ?? 0;
    ctx.db.delete(assistantMessages).where(eq(assistantMessages.chatId, chat.id)).run();
    ctx.db.delete(assistantChats).where(eq(assistantChats.id, chat.id)).run();
    audit(ctx.db, ctx.actor, { action: 'assistant_chat.delete', entity: 'assistant_chat', entityId: chat.id, after: { messages: n } }, ctx.now());
  });
}

/** The teacher's chats, newest first; `q` searches titles and messages as the teacher sees them (with names). */
export function listChats(ctx: RequestContext, p: AssistantPrivacy, q: string | undefined, archived: boolean): Array<z.infer<typeof C.AssistantChatSummary>> {
  const user = requireUser(ctx);
  const rows = ctx.db
    .select()
    .from(assistantChats)
    .where(and(eq(assistantChats.ownerUserId, user.id), archived ? isNotNull(assistantChats.archivedAt) : isNull(assistantChats.archivedAt)))
    .orderBy(desc(assistantChats.lastMessageAt))
    .all();
  const needle = q?.trim() ? foldSameLength(q.trim().normalize('NFC')) : null;
  if (!needle) return rows.map((r) => summaryOf(p, r));
  return rows
    .filter((r) => {
      if (foldSameLength(toBrowser(p, r.title)).includes(needle)) return true;
      return ctx.db
        .select({ content: assistantMessages.content })
        .from(assistantMessages)
        .where(and(eq(assistantMessages.chatId, r.id), sql`${assistantMessages.role} in ('user','assistant')`))
        .all()
        .some((m) => foldSameLength(toBrowser(p, m.content)).includes(needle));
    })
    .map((r) => summaryOf(p, r));
}

/** The teacher's own data export of their chats (as they see them, with names). A GET without side effects: their own data, not audited. */
export function exportChats(ctx: RequestContext, p: AssistantPrivacy) {
  const user = requireUser(ctx);
  const labels = contextLabels(ctx.db, user);
  const chats = ctx.db.select().from(assistantChats).where(eq(assistantChats.ownerUserId, user.id)).orderBy(asc(assistantChats.createdAt)).all();
  const out = {
    format: 'class-compass-assistant-chats',
    version: 1,
    exportedAt: new Date(ctx.now()).toISOString(),
    account: user.displayName,
    chats: chats.map((c) => ({
      title: toBrowser(p, c.title),
      createdAt: new Date(c.createdAt).toISOString(),
      lastMessageAt: new Date(c.lastMessageAt).toISOString(),
      archived: c.archivedAt !== null,
      model: c.model,
      messages: messageViews(p, labels, messagesOf(ctx.db, c.id)).map((m) => ({
        role: m.role,
        at: new Date(m.createdAt).toISOString(),
        text: m.text,
        status: m.status,
        actions: m.calls.map((x) => ({ tool: x.tool, state: x.state, about: x.target, changes: x.changes })),
      })),
    })),
  };
  return out;
}

// ---------------------------------------------------------------- erasure (D-109)

/**
 * Erasing a student: their name (full or a part, any case) and their pseudonyms in the teachers'
 * assistant families become `[name]` in every stored chat title, summary, message and tool call. Called
 * inside the erasure transaction, before the student row and their pseudonyms are deleted.
 */
export function scrubStudentFromChats(db: Db, student: { id: string; fullName: string; givenNames: string | null; familyName: string | null; studentNumber: string | null }): number {
  const scrubber = new NameScrubber([student]);
  const pseudonyms = assistantPseudonymsOf(db, student.id);
  const byUser = new Map<string, RegExp>();
  for (const ps of pseudonyms) byUser.set(ps.userId, new RegExp(`\\b(?:Student ${ps.number}|student-${ps.number})\\b`, 'gu'));
  const scrubFor = (userId: string) => (s: string) => {
    const re = byUser.get(userId);
    const t = scrubber.scrub(s, () => null).replaceAll(student.id, '[name]');
    return re ? t.replace(re, '[name]') : t;
  };
  const deep = (f: (s: string) => string, v: unknown): unknown => {
    if (typeof v === 'string') return f(v);
    if (Array.isArray(v)) return v.map((x) => deep(f, x));
    if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(f, x)]));
    return v;
  };
  // Only chats that could mention the student: their name parts, their id, or one of their pseudonyms.
  const parts = [student.fullName, ...student.fullName.split(/\s+/u), student.givenNames ?? '', student.familyName ?? '', student.id].filter((x) => x.trim().length >= 2);
  let changed = 0;
  for (const chat of db.select().from(assistantChats).all()) {
    const f = scrubFor(chat.ownerUserId);
    const pseudo = byUser.get(chat.ownerUserId);
    const might = (s: string | null) => !!s && (parts.some((x) => foldSameLength(s).includes(foldSameLength(x))) || (pseudo ? new RegExp(pseudo.source, 'u').test(s) : false));
    if (might(chat.title) || might(chat.summary)) {
      db.update(assistantChats)
        .set({ title: f(chat.title), summary: chat.summary === null ? null : f(chat.summary) })
        .where(eq(assistantChats.id, chat.id))
        .run();
      changed += 1;
    }
    for (const m of messagesOf(db, chat.id)) {
      const calls = m.toolCallsJson ? JSON.stringify(m.toolCallsJson) : null;
      if (!might(m.content) && !might(calls)) continue;
      db.update(assistantMessages)
        .set({ content: f(m.content), toolCallsJson: m.toolCallsJson ? (deep(f, m.toolCallsJson) as AssistantToolCallJson[]) : null })
        .where(eq(assistantMessages.id, m.id))
        .run();
      changed += 1;
    }
  }
  return changed;
}

