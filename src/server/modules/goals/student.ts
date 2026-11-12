/**
 * Goals on the personal student page (S10: STU-2, STU-4, STU-5, GOL-2..5, D-014).
 *
 * - The student id ALWAYS comes from the link session (`requireStudent`), never from the request.
 * - Students see their own goals, entries, evidence, teacher outcomes and feedback in the subjects of
 *   the classes they are in today. They write goals, reflections, notes, self-assessments and
 *   evidence, and may edit or delete only what they wrote themselves (GOL-5). Anything else answers
 *   403 (their own record written by a teacher) or 404 (someone else's record), so ids reveal nothing.
 * - This file never touches private teacher notes (GOL-6, test-enforced).
 */
import { and, eq, isNull, lt } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/goals.ts';
import type { Evidence, Goal, StudentGoalsSection } from '../../../shared/contracts/goals.ts';
import { tx } from '../../db/client.ts';
import { avatarPictures, evidence, files, goalEntries, goals } from '../../db/schema.ts';
import { emitStudentActivity } from '../../lib/activity.ts';
import { notify } from '../../lib/notify.ts';
import type { NotificationCategory } from '../../../shared/notifications.ts';
import { audit } from '../../lib/audit.ts';
import { requireStudent, type RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { assertMediaAllowed, deleteFileRow, ingestUpload, type FileRow } from '../files/service.ts';
import { studentScope, type ScopeContext, type StudentScope } from '../links/scope.ts';
import type { StudentPageInput } from '../manifest.ts';
import { isModuleEnabled } from '../school/modules.ts';
import { getYear } from '../school/policy.ts';
import { assertNoRiskyWords, assertStudentText, limitsOf, recordBlockedAttempts, urlWords } from '../textChecks/service.ts';
import { evidenceDtos, evidenceOf, feedbackDtos, feedbackOf, goalDto, goalDtos, goalsOf, type EvidenceRow, type GoalRow } from './dto.ts';
import { categoryName, categoryNamesOf, categoryUsable, getCategory, getPreset, hiddenDefaultsOf, inScope, outcomesOf, presetUsable, studentChoices } from './library.ts';
import { studentStarters } from './starters.ts';
import { classLocales, studentPageLanguage } from '../../../shared/classLanguage.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;

const classWritable = (ctx: RequestContext, sc: ScopeContext) => sc.cls.archivedAt === null && getYear(ctx.db, sc.cls.schoolYearId).archivedAt === null;
const canWriteIn = (ctx: RequestContext, sc: ScopeContext) => isModuleEnabled(ctx.db, sc.context.id, 'goals') && classWritable(ctx, sc);
const teacherIdsFor = (scope: StudentScope, subjectId: string) => [...new Set(scope.contexts.filter((c) => c.subject.id === subjectId).map((c) => c.context.teacherId))];

// ---------------------------------------------------------------- page section (manifest studentPage)
export function goalsSection(ctx: RequestContext, input: StudentPageInput): StudentGoalsSection {
  const { studentId, context } = input;
  const scope = studentScope(ctx, studentId);
  const subjectId = context.subjectId;
  const teacherIds = teacherIdsFor(scope, subjectId);
  const sc = scope.contexts.find((c) => c.context.id === context.id);
  // The class's teacher may have archived some defaults for their classes (D-116).
  const choices = studentChoices(ctx.db, subjectId, teacherIds, context.teacherId);
  // Sentence starters (S14d, D-152) in the languages of the student page (D-117), as the page shows them.
  const locales = classLocales(studentPageLanguage(scope.classes[0] ?? input.cls));
  const starters = studentStarters(ctx.db, subjectId, teacherIds, hiddenDefaultsOf(ctx.db, [context.teacherId]), new Set(choices.categories.map((c) => c.id)), locales);
  return {
    // Items a teacher hid (S13c moderation) are left out of the student page.
    goals: goalDtos(
      ctx.db,
      goalsOf(ctx.db, studentId, subjectId).filter((g) => g.hiddenAt === null),
      { forStudent: true },
    ),
    evidence: evidenceDtos(
      ctx.db,
      evidenceOf(ctx.db, studentId, subjectId).filter((e) => e.hiddenAt === null),
    ),
    feedback: feedbackDtos(ctx.db, feedbackOf(ctx.db, studentId, subjectId)),
    categories: choices.categories,
    presets: choices.presets,
    outcomes: outcomesOf(ctx.db, context.id),
    canWrite: sc ? canWriteIn(ctx, sc) : false,
    textLimits: limitsOf(ctx.db),
    starters,
  };
}

// ---------------------------------------------------------------- scope checks
/** A subject the student may write in now: one of their classes today, Goals on, class not archived. */
function writableSubject(ctx: RequestContext, scope: StudentScope, subjectId: string): ScopeContext {
  const options = scope.contexts.filter((c) => c.subject.id === subjectId);
  if (!options.length) throw notFound('Subject');
  const sc = options.find((c) => canWriteIn(ctx, c));
  if (!sc) throw new AppError('FEATURE_DISABLED', 'Goals cannot be changed in this subject now', { reason: 'GOALS_READ_ONLY' });
  return sc;
}

/** The student's own live goal (404 for anyone else's), with a subject they may write in. */
function ownGoal(ctx: RequestContext, goalId: string): { goal: GoalRow; scope: StudentScope } {
  const { studentId } = requireStudent(ctx);
  const goal = ctx.db.select().from(goals).where(eq(goals.id, goalId)).get();
  if (!goal || goal.deletedAt !== null || goal.hiddenAt !== null || goal.studentId !== studentId) throw notFound('Goal');
  const scope = studentScope(ctx, studentId);
  writableSubject(ctx, scope, goal.subjectId);
  return { goal, scope };
}

const notYours = () => new AppError('FORBIDDEN', 'Only what you wrote yourself can be changed here', { reason: 'NOT_YOUR_CONTRIBUTION' });
const reload = (ctx: RequestContext, goalId: string): Goal => goalDto(ctx.db, ctx.db.select().from(goals).where(eq(goals.id, goalId)).get()!, { forStudent: true });

/** The text check target of a student write in a subject (S13c, D-123). */
const textTarget = (scope: StudentScope, subjectId: string) => ({ studentId: scope.student.id, subjectId, teacherIds: teacherIdsFor(scope, subjectId) });
const checkChoices = (ctx: RequestContext, target: ReturnType<typeof textTarget>, choices: readonly string[] | undefined) => {
  for (const c of choices ?? []) assertStudentText(ctx, target, c, 'practiceChoice');
};
const ENTRY_TEXT_KIND = { reflection: 'reflection', note: 'note', progress: 'note', self_assessment: 'selfAssessment' } as const;
const activity = (ctx: RequestContext, studentId: string, subjectId: string) => emitStudentActivity(ctx, { source: 'goals', studentIds: [studentId], subjectId });
/** Teacher notifications (S14e3, D-155): ids only, inside the write's transaction. */
const ENTRY_NOTIFY = { reflection: 'reflection', note: 'note', self_assessment: 'selfAssessment' } as const satisfies Record<string, NotificationCategory>;
function evidenceCategory(ctx: RequestContext, kind: EvidenceRow['kind'], fileId: string | null): NotificationCategory {
  if (kind === 'text') return 'evidenceText';
  if (kind === 'link') return 'evidenceLink';
  if (kind === 'audio') return 'evidenceVoice';
  const f = fileId ? ctx.db.select({ kind: files.kind }).from(files).where(eq(files.id, fileId)).get() : undefined;
  return f?.kind === 'image' ? 'evidencePicture' : f?.kind === 'video' ? 'evidenceVideo' : 'evidenceDocument';
}

// ---------------------------------------------------------------- goals
export function createGoal(ctx: RequestContext, input: In<typeof C.studentCreateGoal>): Goal {
  return recordBlockedAttempts(ctx, () => tx(ctx.db, () => {
    const { studentId } = requireStudent(ctx);
    const scope = studentScope(ctx, studentId);
    const sc = writableSubject(ctx, scope, input.subjectId);
    const teacherIds = teacherIdsFor(scope, input.subjectId);
    const hidden = hiddenDefaultsOf(ctx.db, [sc.context.teacherId]);
    const preset = input.presetId ? getPreset(ctx.db, input.presetId) : undefined;
    if (input.presetId && (!preset || !presetUsable(preset, hidden) || !inScope(preset, input.subjectId, teacherIds))) throw notFound('Preset goal');
    const category = getCategory(ctx.db, preset?.categoryId ?? input.categoryId ?? '');
    if (!category || !categoryUsable(category, hidden) || !inScope(category, input.subjectId, teacherIds)) throw notFound('Category');
    const own = input.text?.trim();
    if (!preset && !own) throw invalid('Write your goal or choose one', { reason: 'GOAL_TEXT_REQUIRED' });
    const target = textTarget(scope, input.subjectId);
    if (own) assertStudentText(ctx, target, own, 'goal');
    checkChoices(ctx, target, input.practiceChoices);
    const now = ctx.now();
    const row: GoalRow = {
      id: newId(),
      studentId,
      subjectId: input.subjectId,
      contextId: sc.context.id,
      categoryId: category.id,
      authorType: 'student',
      authorId: studentId,
      presetId: preset?.id ?? null,
      text: own ?? preset!.text.en ?? preset!.text.tr ?? '',
      practiceChoicesJson: input.practiceChoices ?? [],
      reviewOn: null,
      status: 'active',
      // The name the student chose from (the class's teacher may have renamed a default, D-176).
      labelSnapshot: { category: categoryName(category, categoryNamesOf(ctx.db, sc.context.teacherId, input.subjectId)), ...(preset && !own ? { preset: preset.text } : {}) },
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      hiddenAt: null,
      hiddenBy: null,
      achievedAt: null,
    };
    ctx.db.insert(goals).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'goal.create', entity: 'goal', entityId: row.id, after: { subjectId: row.subjectId, categoryId: row.categoryId, presetId: row.presetId } }, now);
    activity(ctx, studentId, row.subjectId);
    notify(ctx, { category: 'goalCreated', studentId, subjectId: row.subjectId, entity: 'goal', entityId: row.id });
    return goalDto(ctx.db, row, { forStudent: true });
  }));
}

export function updateGoal(ctx: RequestContext, input: In<typeof C.studentUpdateGoal>): Goal {
  return recordBlockedAttempts(ctx, () => tx(ctx.db, () => {
    const { goal, scope } = ownGoal(ctx, input.goalId);
    if (goal.authorType !== 'student') throw notYours();
    const target = textTarget(scope, goal.subjectId);
    if (input.text !== undefined) assertStudentText(ctx, target, input.text, 'goal');
    checkChoices(ctx, target, input.practiceChoices);
    const patch: Partial<GoalRow> = { updatedAt: ctx.now() };
    if (input.text !== undefined) {
      patch.text = input.text;
      patch.labelSnapshot = { category: goal.labelSnapshot.category };
    }
    if (input.practiceChoices !== undefined) patch.practiceChoicesJson = input.practiceChoices;
    if (input.status !== undefined) {
      patch.status = input.status;
      // When the goal became achieved (the achievement rules use it, not updatedAt, so later edits never re-date it).
      if (input.status !== goal.status) patch.achievedAt = input.status === 'achieved' ? ctx.now() : null;
    }
    ctx.db.update(goals).set(patch).where(eq(goals.id, goal.id)).run();
    audit(ctx.db, ctx.actor, { action: 'goal.update', entity: 'goal', entityId: goal.id, before: { status: goal.status }, after: { status: patch.status, textChanged: input.text !== undefined } }, ctx.now());
    activity(ctx, goal.studentId, goal.subjectId);
    const achieved = patch.status === 'achieved' && goal.status !== 'achieved';
    notify(ctx, { category: achieved ? 'goalAchieved' : 'goalEdited', studentId: goal.studentId, subjectId: goal.subjectId, entity: 'goal', entityId: goal.id });
    return reload(ctx, goal.id);
  }));
}

export function deleteGoal(ctx: RequestContext, goalId: string): void {
  tx(ctx.db, () => {
    const { goal } = ownGoal(ctx, goalId);
    if (goal.authorType !== 'student') throw notYours();
    ctx.db.update(goals).set({ deletedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(goals.id, goal.id)).run();
    audit(ctx.db, ctx.actor, { action: 'goal.delete', entity: 'goal', entityId: goal.id, before: { subjectId: goal.subjectId } }, ctx.now());
  });
}

// ---------------------------------------------------------------- entries (reflections, notes, self-assessment)
export function addEntry(ctx: RequestContext, input: In<typeof C.studentAddEntry>): Goal {
  return recordBlockedAttempts(ctx, () => tx(ctx.db, () => {
    const { goal, scope } = ownGoal(ctx, input.goalId);
    assertStudentText(ctx, textTarget(scope, goal.subjectId), input.body, ENTRY_TEXT_KIND[input.kind]);
    if (input.kind === 'self_assessment' && input.confidence === undefined) throw invalid('Choose how sure you feel', { reason: 'CONFIDENCE_REQUIRED' });
    const now = ctx.now();
    const id = newId();
    ctx.db
      .insert(goalEntries)
      .values({ id, goalId: goal.id, authorType: 'student', authorId: goal.studentId, kind: input.kind, body: input.body, confidence: input.confidence ?? null, createdAt: now, updatedAt: now, deletedAt: null })
      .run();
    ctx.db.update(goals).set({ updatedAt: now }).where(eq(goals.id, goal.id)).run();
    audit(ctx.db, ctx.actor, { action: 'goal_entry.create', entity: 'goal_entry', entityId: id, after: { goalId: goal.id, kind: input.kind, confidence: input.confidence ?? null } }, now);
    activity(ctx, goal.studentId, goal.subjectId);
    notify(ctx, { category: ENTRY_NOTIFY[input.kind], studentId: goal.studentId, subjectId: goal.subjectId, entity: 'goal_entry', entityId: id });
    return reload(ctx, goal.id);
  }));
}

function ownEntry(ctx: RequestContext, entryId: string) {
  const { studentId } = requireStudent(ctx);
  const entry = ctx.db.select().from(goalEntries).where(eq(goalEntries.id, entryId)).get();
  const goal = entry ? ctx.db.select().from(goals).where(eq(goals.id, entry.goalId)).get() : undefined;
  if (!entry || entry.deletedAt !== null || entry.hiddenAt !== null || !goal || goal.deletedAt !== null || goal.hiddenAt !== null || goal.studentId !== studentId) throw notFound('Entry');
  const scope = studentScope(ctx, studentId);
  writableSubject(ctx, scope, goal.subjectId);
  // A teacher's progress update on the student's goal is not theirs to change (GOL-5).
  if (entry.authorType !== 'student') throw notYours();
  return { entry, goal, scope };
}

export function updateEntry(ctx: RequestContext, input: In<typeof C.studentUpdateEntry>): Goal {
  return recordBlockedAttempts(ctx, () => tx(ctx.db, () => {
    const { entry, goal, scope } = ownEntry(ctx, input.entryId);
    if (input.body !== undefined) assertStudentText(ctx, textTarget(scope, goal.subjectId), input.body, ENTRY_TEXT_KIND[entry.kind]);
    const patch: Partial<typeof goalEntries.$inferInsert> = { updatedAt: ctx.now() };
    if (input.body !== undefined) patch.body = input.body;
    if (input.confidence !== undefined) {
      if (entry.kind !== 'self_assessment') throw invalid('Only a self-assessment has a confidence', { reason: 'CONFIDENCE_NOT_ALLOWED' });
      patch.confidence = input.confidence;
    }
    ctx.db.update(goalEntries).set(patch).where(eq(goalEntries.id, entry.id)).run();
    audit(ctx.db, ctx.actor, { action: 'goal_entry.update', entity: 'goal_entry', entityId: entry.id, after: { confidence: input.confidence } }, ctx.now());
    activity(ctx, goal.studentId, goal.subjectId);
    if (entry.kind !== 'progress') notify(ctx, { category: ENTRY_NOTIFY[entry.kind], studentId: goal.studentId, subjectId: goal.subjectId, entity: 'goal_entry', entityId: entry.id });
    return reload(ctx, goal.id);
  }));
}

export function deleteEntry(ctx: RequestContext, entryId: string): void {
  tx(ctx.db, () => {
    const { entry } = ownEntry(ctx, entryId);
    ctx.db.update(goalEntries).set({ deletedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(goalEntries.id, entry.id)).run();
    audit(ctx.db, ctx.actor, { action: 'goal_entry.delete', entity: 'goal_entry', entityId: entry.id, before: { goalId: entry.goalId, kind: entry.kind } }, ctx.now());
  });
}

// ---------------------------------------------------------------- evidence (GOL-4, D-014)
export function addEvidence(ctx: RequestContext, input: In<typeof C.studentAddEvidence>): Evidence {
  return recordBlockedAttempts(ctx, () => tx(ctx.db, () => {
    const { studentId } = requireStudent(ctx);
    const scope = studentScope(ctx, studentId);
    writableSubject(ctx, scope, input.subjectId);
    if (input.goalId) {
      const g = ctx.db.select().from(goals).where(eq(goals.id, input.goalId)).get();
      if (!g || g.deletedAt !== null || g.studentId !== studentId || g.subjectId !== input.subjectId) throw notFound('Goal');
    }
    const body = input.body?.trim() || null;
    assertStudentText(ctx, textTarget(scope, input.subjectId), body, input.kind === 'text' ? 'evidenceText' : 'linkTitle');
    let url: string | null = null;
    let fileId: string | null = null;
    if (input.kind === 'text') {
      if (!body) throw invalid('Write something first', { reason: 'EVIDENCE_TEXT_REQUIRED' });
    } else if (input.kind === 'link') {
      if (!input.url) throw invalid('Add the web address', { reason: 'EVIDENCE_URL_REQUIRED' });
      url = new URL(input.url).href;
      // The address is shown back to the student and teachers: the language check reads it too (D-123).
      assertNoRiskyWords(ctx, textTarget(scope, input.subjectId), urlWords(url));
    } else {
      if (!input.fileId) throw invalid('Upload the file first', { reason: 'EVIDENCE_FILE_REQUIRED' });
      const f = ctx.db.select().from(files).where(eq(files.id, input.fileId)).get();
      // Only a file this student uploaded themselves can be attached (no attaching guessed ids).
      if (!f || f.deletedAt !== null || f.ownerStudentId !== studentId || f.uploadedByType !== 'student' || f.uploadedById !== studentId) throw notFound('File');
      const okKind = input.kind === 'audio' ? f.kind === 'audio' : f.kind === 'document' || f.kind === 'image' || f.kind === 'video';
      if (!okKind) throw invalid('This file does not match the kind of evidence', { reason: 'EVIDENCE_FILE_KIND' });
      // The media flags are checked again: an admin may have switched photos or audio off since the upload (D-014).
      assertMediaAllowed(ctx.db, f.kind, 'evidence');
      fileId = f.id;
    }
    const now = ctx.now();
    const row: EvidenceRow = { id: newId(), studentId, subjectId: input.subjectId, goalId: input.goalId ?? null, kind: input.kind, body, url, fileId, authorType: 'student', authorId: studentId, createdAt: now, updatedAt: now, deletedAt: null, hiddenAt: null, hiddenBy: null };
    ctx.db.insert(evidence).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'evidence.create', entity: 'evidence', entityId: row.id, after: { subjectId: row.subjectId, goalId: row.goalId, kind: row.kind, fileId } }, now);
    activity(ctx, studentId, row.subjectId);
    notify(ctx, { category: evidenceCategory(ctx, row.kind, fileId), studentId, subjectId: row.subjectId, entity: 'evidence', entityId: row.id });
    return evidenceDtos(ctx.db, [row])[0]!;
  }));
}

function ownEvidence(ctx: RequestContext, evidenceId: string): EvidenceRow {
  const { studentId } = requireStudent(ctx);
  const e = ctx.db.select().from(evidence).where(eq(evidence.id, evidenceId)).get();
  if (!e || e.deletedAt !== null || e.hiddenAt !== null || e.studentId !== studentId) throw notFound('Evidence');
  writableSubject(ctx, studentScope(ctx, studentId), e.subjectId);
  if (e.authorType !== 'student') throw notYours();
  return e;
}

export function updateEvidence(ctx: RequestContext, input: In<typeof C.studentUpdateEvidence>): Evidence {
  return recordBlockedAttempts(ctx, () => tx(ctx.db, () => {
    const e = ownEvidence(ctx, input.evidenceId);
    const patch: Partial<EvidenceRow> = { updatedAt: ctx.now() };
    if (input.body !== undefined) {
      const body = input.body?.trim() || null;
      if (e.kind === 'text' && !body) throw invalid('Write something first', { reason: 'EVIDENCE_TEXT_REQUIRED' });
      assertStudentText(ctx, textTarget(studentScope(ctx, e.studentId), e.subjectId), body, e.kind === 'text' ? 'evidenceText' : 'linkTitle');
      patch.body = body;
    }
    if (input.goalId !== undefined) {
      if (input.goalId !== null) {
        const g = ctx.db.select().from(goals).where(eq(goals.id, input.goalId)).get();
        if (!g || g.deletedAt !== null || g.studentId !== e.studentId || g.subjectId !== e.subjectId) throw notFound('Goal');
      }
      patch.goalId = input.goalId;
    }
    ctx.db.update(evidence).set(patch).where(eq(evidence.id, e.id)).run();
    audit(ctx.db, ctx.actor, { action: 'evidence.update', entity: 'evidence', entityId: e.id, after: { goalId: patch.goalId } }, ctx.now());
    notify(ctx, { category: evidenceCategory(ctx, e.kind, e.fileId), studentId: e.studentId, subjectId: e.subjectId, entity: 'evidence', entityId: e.id });
    return evidenceDtos(ctx.db, [ctx.db.select().from(evidence).where(eq(evidence.id, e.id)).get()!])[0]!;
  }));
}

/**
 * The file is this student's own upload and no live evidence shows it any more. Never their own avatar
 * picture (S24, D-184): approved pictures are recorded as uploaded by the system, and a picture row
 * pointing at the file keeps it too (review fix: the clean-up below once deleted approved pictures).
 */
const isOwnLooseUpload = (ctx: RequestContext, studentId: string, f: FileRow) =>
  f.deletedAt === null &&
  f.ownerStudentId === studentId &&
  f.uploadedByType === 'student' &&
  f.uploadedById === studentId &&
  !ctx.db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.fileId, f.id), isNull(evidence.deletedAt))).get() &&
  !ctx.db.select({ id: avatarPictures.id }).from(avatarPictures).where(eq(avatarPictures.fileId, f.id)).get();

/**
 * Deleting own evidence (GOL-5) also deletes the file the student uploaded for it when nothing else
 * shows it (STU-8): the bytes go, the upload space is freed and neither the student nor teachers can
 * open it any more. The file delete is audited by `deleteFileRow`.
 */
export async function deleteEvidence(ctx: RequestContext, evidenceId: string): Promise<void> {
  const { studentId } = requireStudent(ctx);
  const loose = tx(ctx.db, () => {
    const e = ownEvidence(ctx, evidenceId);
    ctx.db.update(evidence).set({ deletedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(evidence.id, e.id)).run();
    audit(ctx.db, ctx.actor, { action: 'evidence.delete', entity: 'evidence', entityId: e.id, before: { kind: e.kind, fileId: e.fileId } }, ctx.now());
    const f = e.fileId ? ctx.db.select().from(files).where(eq(files.id, e.fileId)).get() : undefined;
    return f && isOwnLooseUpload(ctx, studentId, f) ? f : null;
  });
  if (loose) await deleteFileRow(ctx, loose);
}

/** An upload the student never attached is removed after this long (it still counts until then). */
export const LOOSE_UPLOAD_GRACE_MS = 60 * 60_000;

/** Remove the student's own uploads that no live evidence shows and that are older than the grace period. */
async function removeLooseUploads(ctx: RequestContext, studentId: string): Promise<void> {
  const old = ctx.db
    .select()
    .from(files)
    .where(and(eq(files.ownerStudentId, studentId), eq(files.uploadedByType, 'student'), eq(files.uploadedById, studentId), isNull(files.deletedAt), lt(files.createdAt, ctx.now() - LOOSE_UPLOAD_GRACE_MS)))
    .all();
  for (const f of old) if (isOwnLooseUpload(ctx, studentId, f)) await deleteFileRow(ctx, f);
}

/**
 * Student upload (STU-8): media flag first (before the body is read), then the usual pipeline with the
 * student as owner. The client attaches the file at once (`addEvidence`).
 */
export async function uploadEvidenceFile(ctx: RequestContext, req: FastifyRequest, kind: In<typeof C.studentUploadFile>['kind']) {
  const { studentId } = requireStudent(ctx);
  assertMediaAllowed(ctx.db, kind, 'evidence');
  const scope = studentScope(ctx, studentId);
  if (!scope.contexts.some((c) => canWriteIn(ctx, c))) throw new AppError('FEATURE_DISABLED', 'Evidence cannot be added now', { reason: 'GOALS_READ_ONLY' });
  // Uploads never attached (a failed save, or someone with the link filling the space) do not keep
  // the student's quota full: they are removed before the quota is checked again.
  await removeLooseUploads(ctx, studentId);
  const f = await ingestUpload(ctx, req, { kind, ownerStudentId: studentId });
  return { id: f.id, kind, mime: f.sniffedMime, name: f.originalName, size: f.size, hasThumbnail: f.thumbStorageKey !== null };
}

/** Live evidence of this student that shows this file (for the file policy). */
export function fileOnStudentEvidence(ctx: RequestContext, studentId: string, fileId: string): boolean {
  return Boolean(ctx.db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.studentId, studentId), eq(evidence.fileId, fileId), isNull(evidence.deletedAt))).get());
}
