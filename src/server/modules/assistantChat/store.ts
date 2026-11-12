/**
 * Chats and messages of the assistant (S19b, D-180): private to their owner (another account's chat is
 * a 404), stored as sent to the provider, shown with real names (`toBrowser`), searched, renamed,
 * archived and deleted by their owner, exported by their owner, scrubbed when a student is erased.
 */
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ASSISTANT_CHATS_MAX } from '../../../shared/assistantChat.ts';
import type * as C from '../../../shared/contracts/assistantChat.ts';
import type { AssistantChangeLine } from '../../../shared/contracts/assistantChat.ts';
import { pickText } from '../../lib/i18n.ts';
import type { LocalizedTextValue as LocalizedText } from '../../../shared/contracts/define.ts';
import { DEFAULT_GOAL_OUTCOMES } from '../../../shared/contracts/goals.ts';
import { validateThemePackage } from '../../../shared/themePackage/validate.ts';
import { tx, type Db } from '../../db/client.ts';
import {
  assistantChats,
  assistantMessages,
  assistantResponsibilities,
  classes,
  goalPresets,
  goals,
  homeworkAssignments,
  lessons,
  skillCategories,
  subjects,
  teachingContexts,
  type AssistantAttachmentJson,
  type AssistantToolCallJson,
  type HomeworkStatusJson,
} from '../../db/schema.ts';
import type { ChatMessage, ToolCall } from '../aiConnections/adapters/types.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext, type UserRow } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { conflict, notFound } from '../../lib/errors.ts';
import { ATTACHMENT_TOOLS, assistantPseudonymsOf, assistantToolByName, parseAssistantArgs, RESULT_PREFIX, studentNameFor, toBrowser, toBrowserAnswer, type AssistantPrivacy } from '../mcp/assistant.ts';
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

// ---------------------------------------------------------------- what a card and an activity line say
/**
 * Looks up, for the browser only, what a call's ids stand for among the teacher's own things: a
 * class+subject ("3-A English"), a homework (title and status labels), a goal (the student and its
 * text), a lesson, a category, a preset, a responsibility. Anything that is not the teacher's own stays
 * unresolved (the card says so and the endpoint refuses the change). Results are cached per id.
 */
export class CardLookup {
  private db: Db;
  private user: UserRow;
  private p: AssistantPrivacy;
  private ctxs: Map<string, string> | null = null;
  private cache = new Map<string, unknown>();
  constructor(db: Db, user: UserRow, p: AssistantPrivacy) {
    this.db = db;
    this.user = user;
    this.p = p;
  }
  private once<T>(key: string, f: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, f());
    return this.cache.get(key) as T;
  }
  private text(t: LocalizedText | null | undefined) {
    return pickText(t, this.user.locale);
  }
  /** "3-A English" for a class+subject of this teacher (or one they had). */
  context(id: unknown): string | null {
    if (typeof id !== 'string') return null;
    if (!this.ctxs) {
      const rows = this.db
        .select({ id: teachingContexts.id, className: classes.name, subject: subjects.name })
        .from(teachingContexts)
        .innerJoin(classes, eq(classes.id, teachingContexts.classId))
        .innerJoin(subjects, eq(subjects.id, teachingContexts.subjectId))
        .where(eq(teachingContexts.teacherId, this.user.id))
        .all();
      this.ctxs = new Map(rows.map((r) => [r.id, `${r.className} ${this.text(r.subject)}`.trim()]));
    }
    return this.ctxs.get(id) ?? null;
  }
  student(id: unknown): string | null {
    return studentNameFor(this.p, id);
  }
  assignment(id: unknown): { title: string; context: string; statuses: HomeworkStatusJson[] } | null {
    if (typeof id !== 'string') return null;
    return this.once(`a:${id}`, () => {
      const r = this.db.select({ title: homeworkAssignments.title, contextId: homeworkAssignments.contextId, statuses: homeworkAssignments.statusSetJson }).from(homeworkAssignments).where(eq(homeworkAssignments.id, id)).get();
      const context = r ? this.context(r.contextId) : null;
      return r && context ? { title: r.title, context, statuses: r.statuses } : null;
    });
  }
  goal(id: unknown): { student: string; text: string; context: string | null } | null {
    if (typeof id !== 'string') return null;
    return this.once(`g:${id}`, () => {
      const r = this.db.select({ studentId: goals.studentId, text: goals.text, contextId: goals.contextId }).from(goals).where(eq(goals.id, id)).get();
      const student = r ? this.student(r.studentId) : null;
      return r && student ? { student, text: r.text, context: r.contextId ? this.context(r.contextId) : null } : null;
    });
  }
  lesson(id: unknown): string | null {
    if (typeof id !== 'string') return null;
    return this.once(`l:${id}`, () => {
      const r = this.db.select({ contextId: lessons.contextId, teacherId: lessons.teacherId, localDate: lessons.localDate }).from(lessons).where(eq(lessons.id, id)).get();
      const context = r && r.teacherId === this.user.id ? this.context(r.contextId) : null;
      return context ? `${context} · ${r!.localDate}` : null;
    });
  }
  classOf(id: unknown): string | null {
    if (typeof id !== 'string') return null;
    return this.once(`c:${id}`, () => {
      const owns = this.db.select({ name: classes.name }).from(teachingContexts).innerJoin(classes, eq(classes.id, teachingContexts.classId)).where(and(eq(teachingContexts.classId, id), eq(teachingContexts.teacherId, this.user.id))).get();
      return owns?.name ?? null;
    });
  }
  category(id: unknown): string | null {
    if (typeof id !== 'string') return null;
    return this.once(`k:${id}`, () => {
      const r = this.db.select({ name: skillCategories.name }).from(skillCategories).where(eq(skillCategories.id, id)).get();
      return r ? this.text(r.name) || null : null;
    });
  }
  preset(id: unknown): string | null {
    if (typeof id !== 'string') return null;
    return this.once(`p:${id}`, () => {
      const r = this.db.select({ text: goalPresets.text }).from(goalPresets).where(eq(goalPresets.id, id)).get();
      return r ? this.text(r.text) || null : null;
    });
  }
  responsibility(id: unknown): string | null {
    if (typeof id !== 'string') return null;
    return this.once(`r:${id}`, () => {
      const r = this.db.select({ label: assistantResponsibilities.labelJson, contextId: assistantResponsibilities.contextId }).from(assistantResponsibilities).where(eq(assistantResponsibilities.id, id)).get();
      return r && this.context(r.contextId) ? this.text(r.label) || null : null;
    });
  }
  weekday(day: string): string {
    // ISO weekday 1 (Monday) … 7: 2024-01-01 was a Monday.
    const n = Number(day);
    if (!Number.isInteger(n) || n < 1 || n > 7) return day;
    return new Intl.DateTimeFormat(this.user.locale === 'tr' ? 'tr-TR' : 'en-GB', { weekday: 'long', timeZone: 'UTC' }).format(Date.UTC(2024, 0, n));
  }
  get locale() {
    return this.user.locale;
  }
  get role() {
    return this.user.role;
  }
  get database() {
    return this.db;
  }
}

/**
 * A theme package on a card (S27d, D-196): what it is, never the whole JSON: the key, the names, the base
 * theme, the size and the warnings, and what happens next (a teacher's draft waits for an administrator).
 */
function themePackageLines(look: CardLookup, v: unknown): AssistantChangeLine[] {
  const { report, pkg } = validateThemePackage(typeof v === 'string' ? v : JSON.stringify(v));
  if (!pkg) return [line('package', 'missing')];
  return [
    line('themeKey', 'text', pkg.key),
    line('themeName', 'list', '', [`EN: ${pkg.name.en}`, `TR: ${pkg.name.tr}`]),
    line('themeBase', 'option', pkg.base, [], `theme.${pkg.base}`),
    line('themeSize', 'text', `${Math.max(1, Math.round(report.stats.bytes / 1024))} KB`),
    line('themeWarnings', 'text', String(report.warnings.length)),
    line('themeNext', 'option', look.role, [], look.role === 'admin' ? 'assistantChat.value.themeNext.admin' : 'assistantChat.value.themeNext.teacher'),
  ];
}

/** Arguments a card never shows (retry keys). */
const SKIP_KEYS = new Set(['opId', 'batchId']);
/** Ids the card shows as its "about" line; one that is not the teacher's own becomes a `missing` line. */
const TARGET_KEYS = ['contextId', 'classId', 'lessonId', 'assignmentId', 'studentId', 'goalId'] as const;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isLocalized = (v: unknown): boolean => isRecord(v) && Object.keys(v).length > 0 && Object.entries(v).every(([k, x]) => (k === 'en' || k === 'tr') && (typeof x === 'string' || x === undefined || x === null));

/** The page's own words for a fixed choice of a tool (`optionKey`): i18n keys the page already has, or the chat's own. */
function optionKeyOf(tool: string, key: string, value: string): string | null {
  if (key === 'module') return `module.${value}`;
  if (key === 'kind' && tool === 'create_sentence_starter') return `goals.starters.kind.${value}`;
  if (key === 'status' && tool === 'update_student_goal') return `goals.status.${value}`;
  if (key === 'status' && tool === 'classroom_command') return `attendance.status.${value}`;
  if (key === 'command') return `assistantChat.value.command.${value}`;
  return null;
}

const line = (key: string, kind: AssistantChangeLine['kind'], value = '', items: string[] = [], optionKey: string | null = null): AssistantChangeLine => ({ key, kind, value, optionKey, items });
const NONE = (key: string) => line(key, 'option', 'none', [], 'assistantChat.value.none');

/** A nested value as one plain line (a fallback for shapes no tool uses today). */
function plain(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '—';
  if (typeof v !== 'object') return String(v);
  return JSON.stringify(v);
}

/**
 * The lines of a change card: every argument the change will use, free text exactly as it will be
 * written (never with names put in: a call whose text holds a pseudonym is refused before it gets a
 * card), ids as the names of the teacher's own things, lists in full (one line per item, never cut).
 */
export function changeLines(look: CardLookup, tool: string, args: Record<string, unknown>): AssistantChangeLine[] {
  const out: AssistantChangeLine[] = [];
  for (const [key, v] of Object.entries(args)) {
    if (SKIP_KEYS.has(key)) continue;
    if (key === 'package' && tool === 'import_theme_draft') {
      out.push(...themePackageLines(look, v));
      continue;
    }
    if ((TARGET_KEYS as readonly string[]).includes(key)) {
      const found = key === 'contextId' ? look.context(v) : key === 'classId' ? look.classOf(v) : key === 'lessonId' ? look.lesson(v) : key === 'assignmentId' ? look.assignment(v) : key === 'studentId' ? look.student(v) : look.goal(v);
      if (!found && v !== null && v !== undefined) out.push(line(key, 'missing'));
      continue;
    }
    if (v === null || v === undefined) {
      out.push(NONE(key));
      continue;
    }
    if (key === 'categoryId') {
      const name = look.category(v);
      out.push(name ? line(key, 'name', name) : line(key, 'missing'));
      continue;
    }
    if (key === 'presetId') {
      const text = look.preset(v);
      out.push(text ? line(key, 'name', text) : line(key, 'missing'));
      continue;
    }
    if (key === 'responsibilityId') {
      const label = look.responsibility(v);
      out.push(label ? line(key, 'name', label) : line(key, 'missing'));
      continue;
    }
    if (key === 'topicIds' && Array.isArray(v)) {
      out.push(line(key, 'list', '', v.map((x) => look.category(x) ?? plain(x))));
      continue;
    }
    if (key === 'outcome' && typeof v === 'string') {
      const def = DEFAULT_GOAL_OUTCOMES.find((o) => o.key === v);
      out.push(def ? line(key, 'name', pickText(def.label, look.locale)) : line(key, 'text', v));
      continue;
    }
    if (key === 'changes' && tool === 'set_homework_marks' && Array.isArray(v)) {
      const a = look.assignment(args.assignmentId);
      const label = (status: unknown) => {
        const def = a?.statuses.find((x) => x.key === status);
        return def ? pickText(def.label, look.locale) || String(status) : plain(status);
      };
      out.push(
        line(
          key,
          'list',
          '',
          v.map((c) => {
            const m = isRecord(c) ? c : {};
            const note = typeof m.note === 'string' && m.note.trim() ? ` (${m.note})` : '';
            return `${look.student(m.studentId) ?? '—'}: ${label(m.status)}${note}`;
          }),
        ),
      );
      continue;
    }
    if (key === 'plan' && tool === 'set_topic_plan' && isRecord(v)) {
      out.push(line(key, 'list', '', Object.entries(v).map(([day, ids]) => `${look.weekday(day)}: ${Array.isArray(ids) && ids.length ? ids.map((x) => look.category(x) ?? plain(x)).join(', ') : '—'}`)));
      continue;
    }
    if (typeof v === 'boolean') {
      out.push(line(key, 'flag', String(v)));
      continue;
    }
    if (typeof v === 'number') {
      out.push(line(key, 'text', String(v)));
      continue;
    }
    if (typeof v === 'string') {
      const optionKey = optionKeyOf(tool, key, v);
      out.push(optionKey ? line(key, 'option', v, [], optionKey) : line(key, 'text', v));
      continue;
    }
    if (isLocalized(v)) {
      const t = v as LocalizedText;
      out.push(line(key, 'list', '', (['en', 'tr'] as const).flatMap((l) => (t[l]?.trim() ? [`${l.toUpperCase()}: ${t[l]}`] : []))));
      continue;
    }
    if (Array.isArray(v)) {
      out.push(line(key, 'list', '', v.map(plain)));
      continue;
    }
    out.push(line(key, 'list', '', Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${plain(x)}`)));
  }
  return out;
}

/** What a call is about, for its activity line and card: the class+subject, the homework, the student, the goal. */
export function targetOf(look: CardLookup, args: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const add = (s: string | null | undefined) => {
    if (s && !parts.includes(s)) parts.push(s);
  };
  const assignment = look.assignment(args.assignmentId);
  const goal = look.goal(args.goalId);
  const lesson = look.lesson(args.lessonId);
  if (lesson) add(lesson);
  else add(look.context(args.contextId) ?? assignment?.context ?? goal?.context ?? look.classOf(args.classId));
  if (assignment) add(`“${assignment.title}”`);
  add(look.student(args.studentId) ?? goal?.student);
  if (goal) add(`“${goal.text}”`);
  if (!parts.length && typeof args.guide === 'string') add(args.guide);
  return parts.length ? parts.join(' · ') : null;
}

// ---------------------------------------------------------------- attached files (S27d review, D-196)
/** The next reference for a file attached in this chat (`file-1`, `file-2` …). */
export function nextAttachmentRef(db: Db, chatId: string): string {
  const n = db.select({ n: sql<number>`count(*)` }).from(assistantMessages).where(and(eq(assistantMessages.chatId, chatId), isNotNull(assistantMessages.attachmentJson))).get()?.n ?? 0;
  return `file-${n + 1}`;
}

/** The .json file attached in this chat under `ref`, exactly as attached, or null. */
export function attachmentOf(db: Db, chatId: string, ref: string): AssistantAttachmentJson | null {
  const rows = db
    .select({ a: assistantMessages.attachmentJson })
    .from(assistantMessages)
    .where(and(eq(assistantMessages.chatId, chatId), eq(assistantMessages.role, 'user'), isNotNull(assistantMessages.attachmentJson)))
    .all();
  return rows.find((r) => r.a?.ref === ref)?.a ?? null;
}

/**
 * A theme tool's arguments with `attachment: "file-N"` replaced by the attached file's text (the model
 * never copies a package back: its output limit would cut a real one, and the copy it saw went through
 * the name filter). Other tools and calls with `package` are unchanged; a reference to nothing, or both
 * at once, is refused with a message the model can act on.
 */
export function resolveAttachmentArgs(db: Db, chatId: string, toolName: string, args: Record<string, unknown>): { ok: true; args: Record<string, unknown> } | { ok: false; content: string } {
  if (!ATTACHMENT_TOOLS.includes(toolName) || args.attachment === undefined) return { ok: true, args };
  const fail = (message: string) => ({ ok: false as const, content: RESULT_PREFIX + JSON.stringify({ error: { code: 'VALIDATION', message } }) });
  if (args.package !== undefined) return fail('Not done: pass either package or attachment, not both.');
  const file = typeof args.attachment === 'string' ? attachmentOf(db, chatId, args.attachment) : null;
  if (!file) return fail(`Not done: there is no attached .json file "${String(args.attachment).slice(0, 20)}" in this chat. Use the reference written next to the attached file (attachment file-N).`);
  const rest = { ...args };
  delete rest.attachment;
  return { ok: true, args: { ...rest, package: file.text } };
}

/** A stored call as the browser sees it (`result`: its tool row, when it ran). */
export function callView(p: AssistantPrivacy, look: CardLookup, call: AssistantToolCallJson, result: MessageRow | undefined, chatId: string): CallView {
  const tool = assistantToolByName(look.role, call.name);
  const readOnly = tool?.readOnly ?? true;
  // The arguments as the tool will get them (an attached file read by its reference; parsed: trimmed,
  // defaults), so the card shows what is written.
  const resolved = tool && !readOnly ? resolveAttachmentArgs(look.database, chatId, call.name, call.arguments) : null;
  const parsed = tool && !readOnly && resolved?.ok ? parseAssistantArgs(tool, resolved.args, p) : null;
  const args = parsed?.ok && isRecord(parsed.data) ? parsed.data : call.arguments;
  const changes = readOnly || call.state === 'refused' ? [] : changeLines(look, call.name, args);
  const theme = !!tool && THEME_PREVIEW_TOOLS.includes(call.name) && call.state !== 'refused' && !call.invalidArguments;
  return { id: call.id, tool: tool ? call.name : 'unknown', readOnly, state: call.state, target: targetOf(look, args), changes, failed: result ? result.isError : null, theme };
}

/** Calls whose theme package the page can preview (the model showing a theme, or offering to save it). */
export const THEME_PREVIEW_TOOLS: readonly string[] = ['preview_theme', 'import_theme_draft'];

/**
 * The theme package of one call in the owner's chat, validated again (owner 2026-11-12): the page
 * renders the same preview as Admin → Themes from it. 404 for anything else: another teacher's chat,
 * a message or call that is not there, a tool without a package, a refused call or a file that is gone.
 */
export function callTheme(ctx: RequestContext, input: { chatId: string; messageId: string; callId: string }) {
  const user = requireUser(ctx);
  const chat = loadChat(ctx, input.chatId);
  const msg = ctx.db.select().from(assistantMessages).where(and(eq(assistantMessages.id, input.messageId), eq(assistantMessages.chatId, chat.id))).get();
  const call = msg?.role === 'assistant' ? (msg.toolCallsJson ?? []).find((c) => c.id === input.callId) : undefined;
  if (!call || !THEME_PREVIEW_TOOLS.includes(call.name) || call.state === 'refused' || call.invalidArguments || !assistantToolByName(user.role, call.name)) throw notFound('Theme');
  const resolved = resolveAttachmentArgs(ctx.db, chat.id, call.name, call.arguments);
  const pkg = resolved.ok ? resolved.args.package : undefined;
  if (pkg === undefined || pkg === null) throw notFound('Theme');
  const { report, pkg: valid } = validateThemePackage(typeof pkg === 'string' ? pkg : JSON.stringify(pkg));
  return { report, package: valid as unknown as z.infer<typeof C.assistantCallTheme.output>['package'] };
}

export function messageViews(p: AssistantPrivacy, look: CardLookup, rows: MessageRow[]): Array<z.infer<typeof C.AssistantMessageView>> {
  const results = new Map(rows.filter((r) => r.role === 'tool' && r.toolCallId).map((r) => [r.toolCallId!, r]));
  return rows
    .filter((r) => r.role !== 'tool')
    .map((r) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant',
      // An answer is Markdown: names never go into a link's address (toBrowserAnswer).
      text: r.role === 'assistant' ? toBrowserAnswer(p, r.content) : toBrowser(p, r.content),
      createdAt: r.createdAt,
      status: r.status,
      errorCode: r.errorCode,
      calls: (r.toolCallsJson ?? []).map((c) => callView(p, look, c, results.get(c.id), r.chatId)),
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
      // An empty reply (cut off or failed before any output) is not sent back: providers refuse an
      // assistant message with neither text nor tool calls (DeepSeek answers HTTP 400).
      if (!r.content && !calls.length) continue;
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
  const look = new CardLookup(ctx.db, user, p);
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
      messages: messageViews(p, look, messagesOf(ctx.db, c.id)).map((m) => ({
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
      if (!might(m.content) && !might(calls) && !might(m.attachmentJson?.text ?? null)) continue;
      db.update(assistantMessages)
        .set({
          content: f(m.content),
          toolCallsJson: m.toolCallsJson ? (deep(f, m.toolCallsJson) as AssistantToolCallJson[]) : null,
          attachmentJson: m.attachmentJson ? { ...m.attachmentJson, text: f(m.attachmentJson.text) } : null,
        })
        .where(eq(assistantMessages.id, m.id))
        .run();
      changed += 1;
    }
  }
  return changed;
}

