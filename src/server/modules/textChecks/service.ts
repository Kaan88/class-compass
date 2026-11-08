/**
 * Student text checks, server side (S13c item 12, D-123). The server is authoritative: every student
 * write of free text (goal, reflection, note, self-assessment comment, evidence text, link title,
 * practice choice) goes through `assertStudentText`; the student page only gives live feedback with
 * the same shared rules (`shared/text/textQuality.ts`).
 *
 * - A blocked word is never stored: the write is rejected (400 `TEXT_BLOCKED_WORD`) and only a count
 *   per student, subject and day is kept (`text_check_attempts`), for the optional teacher notice.
 * - Lists: the built-in lists, the school's block/allow lists (admin) and the words the class's
 *   teachers added for their classes.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { localDate } from '../../../domain/dates.ts';
import type * as C from '../../../shared/contracts/textChecks.ts';
import { checkStudentText, findRiskyWord, type TextKind, type TextLimits, type WordLists } from '../../../shared/text/textQuality.ts';
import { tx, type Db } from '../../db/client.ts';
import { classes, enrolments, evidence, goalEntries, goals, schoolSettings, students, teachingContexts, textCheckAttempts, textCheckWords } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { assertModuleEnabled, mergeModuleConfig, moduleConfig } from '../school/modules.ts';
import { assertClassWritable, assertOwnsContext, getClass, isClassWritable, getSchoolSettings, todayFor } from '../school/policy.ts';
import { rosterRows } from '../students/service.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;

export const cleanCheckWord = (w: string) => w.normalize('NFC').trim().toLocaleLowerCase('tr');

export function limitsOf(db: Db): TextLimits {
  const s = getSchoolSettings(db);
  return { minGoalWords: s.textMinGoalWords, minGoalLetters: s.textMinGoalLetters };
}

function wordsOf(db: Db, scope: 'school' | 'teacher', ownerIds: readonly string[], list: 'block' | 'allow'): string[] {
  if (!ownerIds.length) return [];
  return db
    .select({ word: textCheckWords.word })
    .from(textCheckWords)
    .where(and(eq(textCheckWords.scope, scope), inArray(textCheckWords.ownerId, [...ownerIds]), eq(textCheckWords.list, list)))
    .all()
    .map((r) => r.word)
    .sort((a, b) => a.localeCompare(b, 'tr'));
}

/** The lists that apply to a student's text in a subject taught by these teachers. */
export function wordListsFor(db: Db, teacherIds: readonly string[]): WordLists {
  return { block: [...wordsOf(db, 'school', [''], 'block'), ...wordsOf(db, 'teacher', teacherIds, 'block')], allow: wordsOf(db, 'school', [''], 'allow') };
}

export interface StudentTextTarget {
  studentId: string;
  subjectId: string;
  teacherIds: readonly string[];
}

/** Throws 400 with `reason: TEXT_<REASON>` (and `textReason`) when the text does not pass. */
export function assertStudentText(ctx: RequestContext, target: StudentTextTarget, text: string | null | undefined, kind: TextKind): void {
  if (text === null || text === undefined) return;
  const res = checkStudentText(text, kind, { limits: limitsOf(ctx.db), lists: wordListsFor(ctx.db, target.teacherIds) });
  if (res.ok) return;
  throw new AppError('VALIDATION', res.reason === 'BLOCKED_WORD' ? 'Please use kind words' : 'Please write real words and a little more', {
    reason: `TEXT_${res.reason}`,
    textReason: res.reason,
    kind,
    // Read by `recordBlockedAttempts` only; never the text.
    attempt: res.reason === 'BLOCKED_WORD' ? { studentId: target.studentId, subjectId: target.subjectId } : undefined,
  });
}

/**
 * The language check only (no nonsense rules) for text a student supplies that is not prose: the web
 * address of a link (host, path and query, decoded) and similar labels (S13c review, D-123). Same
 * error and attempt count as `assertStudentText`.
 */
export function assertNoRiskyWords(ctx: RequestContext, target: StudentTextTarget, text: string | null | undefined): void {
  if (!text || !findRiskyWord(text, wordListsFor(ctx.db, target.teacherIds))) return;
  throw new AppError('VALIDATION', 'Please use kind words', { reason: 'TEXT_BLOCKED_WORD', textReason: 'BLOCKED_WORD', kind: 'linkTitle', attempt: { studentId: target.studentId, subjectId: target.subjectId } });
}

/** The words of a web address as the language check reads them: host, path and query, decoded. */
export function urlWords(href: string): string {
  const u = new URL(href);
  const raw = `${u.hostname} ${u.pathname} ${u.search} ${u.hash}`;
  try {
    return decodeURIComponent(raw.replace(/\+/gu, ' '));
  } catch {
    return raw;
  }
}

/** A student's upload name with a blocked word is replaced by a neutral one (the file itself is kept). */
export function neutralStudentFileName(db: Db, name: string | null): string | null {
  if (!name || !findRiskyWord(name, wordListsFor(db, []))) return name;
  const ext = /\.[A-Za-z0-9]{1,5}$/u.exec(name)?.[0] ?? '';
  return `file${ext.toLowerCase()}`;
}

/**
 * Runs a student write; when it was rejected for a blocked word, counts the attempt (outside the
 * rolled-back transaction) and rethrows. The text itself is never stored.
 */
export function recordBlockedAttempts<T>(ctx: RequestContext, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const attempt = e instanceof AppError ? (e.details as { attempt?: { studentId: string; subjectId: string } } | undefined)?.attempt : undefined;
    if (attempt) {
      const date = localDate(ctx.now(), getSchoolSettings(ctx.db).timezone);
      ctx.db
        .insert(textCheckAttempts)
        .values({ studentId: attempt.studentId, subjectId: attempt.subjectId, localDate: date, count: 1, updatedAt: ctx.now() })
        .onConflictDoUpdate({ target: [textCheckAttempts.studentId, textCheckAttempts.subjectId, textCheckAttempts.localDate], set: { count: sql`${textCheckAttempts.count} + 1`, updatedAt: ctx.now() } })
        .run();
    }
    throw e;
  }
}

// ---------------------------------------------------------------- admin
export function adminView(db: Db): z.infer<typeof C.AdminTextChecks> {
  return { limits: limitsOf(db), block: wordsOf(db, 'school', [''], 'block'), allow: wordsOf(db, 'school', [''], 'allow') };
}

function replaceList(ctx: RequestContext, scope: 'school' | 'teacher', ownerId: string, list: 'block' | 'allow', words: readonly string[]) {
  const uid = requireUser(ctx).id;
  const next = [...new Set(words.map(cleanCheckWord).filter(Boolean))];
  ctx.db.delete(textCheckWords).where(and(eq(textCheckWords.scope, scope), eq(textCheckWords.ownerId, ownerId), eq(textCheckWords.list, list))).run();
  for (const word of next) ctx.db.insert(textCheckWords).values({ id: newId(), scope, ownerId, list, word, createdAt: ctx.now(), createdBy: uid }).run();
  return next.length;
}

export function adminSet(ctx: RequestContext, input: In<typeof C.setAdminTextChecks>) {
  return tx(ctx.db, () => {
    const before = adminView(ctx.db);
    if (input.limits) ctx.db.update(schoolSettings).set({ textMinGoalWords: input.limits.minGoalWords, textMinGoalLetters: input.limits.minGoalLetters }).where(eq(schoolSettings.id, 1)).run();
    const counts: Record<string, number> = {};
    if (input.block) counts.block = replaceList(ctx, 'school', '', 'block', input.block);
    if (input.allow) counts.allow = replaceList(ctx, 'school', '', 'allow', input.allow);
    // Counts only in the audit log: the words themselves are not repeated there.
    audit(
      ctx.db,
      ctx.actor,
      { action: 'text_checks.update', entity: 'school_settings', entityId: '1', before: { limits: before.limits, block: before.block.length, allow: before.allow.length }, after: { limits: input.limits, ...counts } },
      ctx.now(),
    );
    return adminView(ctx.db);
  });
}

// ---------------------------------------------------------------- teacher words
export function teacherWords(ctx: RequestContext) {
  return { block: wordsOf(ctx.db, 'teacher', [requireUser(ctx).id], 'block') };
}

export function setTeacherWords(ctx: RequestContext, input: In<typeof C.setTeacherTextWords>) {
  return tx(ctx.db, () => {
    const uid = requireUser(ctx).id;
    const n = replaceList(ctx, 'teacher', uid, 'block', input.block);
    audit(ctx.db, ctx.actor, { action: 'text_checks.teacher_words', entity: 'user', entityId: uid, after: { block: n } }, ctx.now());
    return teacherWords(ctx);
  });
}

// ---------------------------------------------------------------- notice (counts only)
const noticeOn = (db: Db, contextId: string) => moduleConfig(db, contextId, 'goals').blockedTextNotice === true;

export function notice(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  assertModuleEnabled(ctx.db, context.id, 'goals');
  if (!noticeOn(ctx.db, context.id)) return { enabled: false, students: [] };
  const roster = rosterRows(ctx, getClass(ctx.db, context.classId)).map((r) => r.student);
  const ids = roster.map((s) => s.id);
  const rows = ids.length ? ctx.db.select().from(textCheckAttempts).where(and(inArray(textCheckAttempts.studentId, ids), eq(textCheckAttempts.subjectId, context.subjectId))).all() : [];
  const out = roster
    .map((s) => {
      const mine = rows.filter((r) => r.studentId === s.id);
      return { id: s.id, fullName: s.fullName, count: mine.reduce((n, r) => n + r.count, 0), lastDate: mine.map((r) => r.localDate).sort().at(-1) ?? '' };
    })
    .filter((s) => s.count > 0);
  return { enabled: true, students: out };
}

export function setNotice(ctx: RequestContext, input: In<typeof C.setBlockedTextNotice>) {
  return tx(ctx.db, () => {
    const context = assertOwnsContext(ctx, input.contextId);
    assertClassWritable(ctx.db, getClass(ctx.db, context.classId));
    mergeModuleConfig(ctx.db, context.id, 'goals', { blockedTextNotice: input.enabled }, requireUser(ctx).id, ctx.now());
    audit(ctx.db, ctx.actor, { action: 'text_checks.notice', entity: 'teaching_context', entityId: context.id, after: { enabled: input.enabled } }, ctx.now());
    return { enabled: input.enabled };
  });
}

// ---------------------------------------------------------------- hide from the student page (moderation)
/**
 * The teacher teaches this subject in a class the student is in today, and at least one such class is
 * writable (archived classes and years are read-only, DAT-1: 409 CLASS_ARCHIVED / YEAR_ARCHIVED).
 */
function assertTeachesStudentSubject(ctx: RequestContext, studentId: string, subjectId: string) {
  const uid = requireUser(ctx).id;
  const s = ctx.db.select().from(students).where(eq(students.id, studentId)).get();
  if (!s) throw notFound('Student');
  const rows = ctx.db
    .select({ cls: classes, e: enrolments })
    .from(enrolments)
    .innerJoin(classes, eq(classes.id, enrolments.classId))
    .innerJoin(teachingContexts, and(eq(teachingContexts.classId, classes.id), eq(teachingContexts.teacherId, uid), eq(teachingContexts.subjectId, subjectId), isNull(teachingContexts.endedAt)))
    .where(eq(enrolments.studentId, studentId))
    .all();
  const matched = rows
    .filter(({ cls, e }) => {
      const today = todayFor(ctx, cls);
      return e.fromDate <= today && (e.toDate === null || e.toDate > today);
    })
    .map((r) => r.cls);
  if (!matched.length) throw new AppError('FORBIDDEN', 'Not your student in this subject');
  if (!matched.some((c) => isClassWritable(ctx.db, c))) assertClassWritable(ctx.db, matched[0]!);
}

export function hide(ctx: RequestContext, input: In<typeof C.hideStudentText>) {
  return tx(ctx.db, () => {
    const uid = requireUser(ctx).id;
    const now = ctx.now();
    const set = input.hidden ? { hiddenAt: now, hiddenBy: uid } : { hiddenAt: null, hiddenBy: null };
    let studentId: string;
    let before: number | null;
    if (input.kind === 'goal') {
      const g = ctx.db.select().from(goals).where(eq(goals.id, input.itemId)).get();
      if (!g || g.deletedAt !== null) throw notFound('Goal');
      studentId = g.studentId;
      before = g.hiddenAt;
      assertTeachesStudentSubject(ctx, g.studentId, g.subjectId);
      ctx.db.update(goals).set(set).where(eq(goals.id, g.id)).run();
    } else if (input.kind === 'entry') {
      const e = ctx.db.select().from(goalEntries).where(eq(goalEntries.id, input.itemId)).get();
      const g = e ? ctx.db.select().from(goals).where(eq(goals.id, e.goalId)).get() : undefined;
      if (!e || !g || e.deletedAt !== null || g.deletedAt !== null) throw notFound('Entry');
      studentId = g.studentId;
      before = e.hiddenAt;
      assertTeachesStudentSubject(ctx, g.studentId, g.subjectId);
      ctx.db.update(goalEntries).set(set).where(eq(goalEntries.id, e.id)).run();
    } else {
      const e = ctx.db.select().from(evidence).where(eq(evidence.id, input.itemId)).get();
      if (!e || e.deletedAt !== null) throw notFound('Evidence');
      studentId = e.studentId;
      before = e.hiddenAt;
      assertTeachesStudentSubject(ctx, e.studentId, e.subjectId);
      ctx.db.update(evidence).set(set).where(eq(evidence.id, e.id)).run();
    }
    audit(
      ctx.db,
      ctx.actor,
      { action: input.hidden ? 'student_text.hide' : 'student_text.show', entity: input.kind === 'entry' ? 'goal_entry' : input.kind, entityId: input.itemId, before: { hidden: before !== null }, after: { hidden: input.hidden, studentId } },
      now,
    );
    return { ok: true as const };
  });
}
