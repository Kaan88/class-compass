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
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/goals.ts';
import type { Evidence, Goal, StudentGoalsSection } from '../../../shared/contracts/goals.ts';
import { tx } from '../../db/client.ts';
import { evidence, files, goalEntries, goals } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireStudent, type RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { assertMediaAllowed, ingestUpload } from '../files/service.ts';
import { studentScope, type ScopeContext, type StudentScope } from '../links/scope.ts';
import type { StudentPageInput } from '../manifest.ts';
import { isModuleEnabled } from '../school/modules.ts';
import { getYear } from '../school/policy.ts';
import { evidenceDtos, evidenceOf, feedbackDtos, feedbackOf, goalDto, goalDtos, goalsOf, type EvidenceRow, type GoalRow } from './dto.ts';
import { categoriesFor, categoryDto, getCategory, getPreset, inScope, outcomesOf, presetDto, presetsFor } from './library.ts';

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
  return {
    goals: goalDtos(ctx.db, goalsOf(ctx.db, studentId, subjectId)),
    evidence: evidenceDtos(ctx.db, evidenceOf(ctx.db, studentId, subjectId)),
    feedback: feedbackDtos(ctx.db, feedbackOf(ctx.db, studentId, subjectId)),
    categories: categoriesFor(ctx.db, subjectId, teacherIds, false).map(categoryDto),
    presets: presetsFor(ctx.db, subjectId, teacherIds, false).map(presetDto),
    outcomes: outcomesOf(ctx.db, context.id),
    canWrite: sc ? canWriteIn(ctx, sc) : false,
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
  if (!goal || goal.deletedAt !== null || goal.studentId !== studentId) throw notFound('Goal');
  const scope = studentScope(ctx, studentId);
  writableSubject(ctx, scope, goal.subjectId);
  return { goal, scope };
}

const notYours = () => new AppError('FORBIDDEN', 'Only what you wrote yourself can be changed here', { reason: 'NOT_YOUR_CONTRIBUTION' });
const reload = (ctx: RequestContext, goalId: string): Goal => goalDto(ctx.db, ctx.db.select().from(goals).where(eq(goals.id, goalId)).get()!);

// ---------------------------------------------------------------- goals
export function createGoal(ctx: RequestContext, input: In<typeof C.studentCreateGoal>): Goal {
  return tx(ctx.db, () => {
    const { studentId } = requireStudent(ctx);
    const scope = studentScope(ctx, studentId);
    const sc = writableSubject(ctx, scope, input.subjectId);
    const teacherIds = teacherIdsFor(scope, input.subjectId);
    const preset = input.presetId ? getPreset(ctx.db, input.presetId) : undefined;
    if (input.presetId && (!preset || preset.archivedAt !== null || !inScope(preset, input.subjectId, teacherIds))) throw notFound('Preset goal');
    const category = getCategory(ctx.db, preset?.categoryId ?? input.categoryId ?? '');
    if (!category || category.archivedAt !== null || !inScope(category, input.subjectId, teacherIds)) throw notFound('Category');
    const own = input.text?.trim();
    if (!preset && !own) throw invalid('Write your goal or choose one', { reason: 'GOAL_TEXT_REQUIRED' });
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
      labelSnapshot: { category: category.name, ...(preset && !own ? { preset: preset.text } : {}) },
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    ctx.db.insert(goals).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'goal.create', entity: 'goal', entityId: row.id, after: { subjectId: row.subjectId, categoryId: row.categoryId, presetId: row.presetId } }, now);
    return goalDto(ctx.db, row);
  });
}

export function updateGoal(ctx: RequestContext, input: In<typeof C.studentUpdateGoal>): Goal {
  return tx(ctx.db, () => {
    const { goal } = ownGoal(ctx, input.goalId);
    if (goal.authorType !== 'student') throw notYours();
    const patch: Partial<GoalRow> = { updatedAt: ctx.now() };
    if (input.text !== undefined) {
      patch.text = input.text;
      patch.labelSnapshot = { category: goal.labelSnapshot.category };
    }
    if (input.practiceChoices !== undefined) patch.practiceChoicesJson = input.practiceChoices;
    if (input.status !== undefined) patch.status = input.status;
    ctx.db.update(goals).set(patch).where(eq(goals.id, goal.id)).run();
    audit(ctx.db, ctx.actor, { action: 'goal.update', entity: 'goal', entityId: goal.id, before: { status: goal.status }, after: { status: patch.status, textChanged: input.text !== undefined } }, ctx.now());
    return reload(ctx, goal.id);
  });
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
  return tx(ctx.db, () => {
    const { goal } = ownGoal(ctx, input.goalId);
    if (input.kind === 'self_assessment' && input.confidence === undefined) throw invalid('Choose how sure you feel', { reason: 'CONFIDENCE_REQUIRED' });
    const now = ctx.now();
    const id = newId();
    ctx.db
      .insert(goalEntries)
      .values({ id, goalId: goal.id, authorType: 'student', authorId: goal.studentId, kind: input.kind, body: input.body, confidence: input.confidence ?? null, createdAt: now, updatedAt: now, deletedAt: null })
      .run();
    ctx.db.update(goals).set({ updatedAt: now }).where(eq(goals.id, goal.id)).run();
    audit(ctx.db, ctx.actor, { action: 'goal_entry.create', entity: 'goal_entry', entityId: id, after: { goalId: goal.id, kind: input.kind, confidence: input.confidence ?? null } }, now);
    return reload(ctx, goal.id);
  });
}

function ownEntry(ctx: RequestContext, entryId: string) {
  const { studentId } = requireStudent(ctx);
  const entry = ctx.db.select().from(goalEntries).where(eq(goalEntries.id, entryId)).get();
  const goal = entry ? ctx.db.select().from(goals).where(eq(goals.id, entry.goalId)).get() : undefined;
  if (!entry || entry.deletedAt !== null || !goal || goal.deletedAt !== null || goal.studentId !== studentId) throw notFound('Entry');
  writableSubject(ctx, studentScope(ctx, studentId), goal.subjectId);
  // A teacher's progress update on the student's goal is not theirs to change (GOL-5).
  if (entry.authorType !== 'student') throw notYours();
  return { entry, goal };
}

export function updateEntry(ctx: RequestContext, input: In<typeof C.studentUpdateEntry>): Goal {
  return tx(ctx.db, () => {
    const { entry, goal } = ownEntry(ctx, input.entryId);
    const patch: Partial<typeof goalEntries.$inferInsert> = { updatedAt: ctx.now() };
    if (input.body !== undefined) patch.body = input.body;
    if (input.confidence !== undefined) {
      if (entry.kind !== 'self_assessment') throw invalid('Only a self-assessment has a confidence', { reason: 'CONFIDENCE_NOT_ALLOWED' });
      patch.confidence = input.confidence;
    }
    ctx.db.update(goalEntries).set(patch).where(eq(goalEntries.id, entry.id)).run();
    audit(ctx.db, ctx.actor, { action: 'goal_entry.update', entity: 'goal_entry', entityId: entry.id, after: { confidence: input.confidence } }, ctx.now());
    return reload(ctx, goal.id);
  });
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
  return tx(ctx.db, () => {
    const { studentId } = requireStudent(ctx);
    const scope = studentScope(ctx, studentId);
    writableSubject(ctx, scope, input.subjectId);
    if (input.goalId) {
      const g = ctx.db.select().from(goals).where(eq(goals.id, input.goalId)).get();
      if (!g || g.deletedAt !== null || g.studentId !== studentId || g.subjectId !== input.subjectId) throw notFound('Goal');
    }
    const body = input.body?.trim() || null;
    let url: string | null = null;
    let fileId: string | null = null;
    if (input.kind === 'text') {
      if (!body) throw invalid('Write something first', { reason: 'EVIDENCE_TEXT_REQUIRED' });
    } else if (input.kind === 'link') {
      if (!input.url) throw invalid('Add the web address', { reason: 'EVIDENCE_URL_REQUIRED' });
      url = new URL(input.url).href;
    } else {
      if (!input.fileId) throw invalid('Upload the file first', { reason: 'EVIDENCE_FILE_REQUIRED' });
      const f = ctx.db.select().from(files).where(eq(files.id, input.fileId)).get();
      // Only a file this student uploaded themselves can be attached (no attaching guessed ids).
      if (!f || f.deletedAt !== null || f.ownerStudentId !== studentId || f.uploadedByType !== 'student' || f.uploadedById !== studentId) throw notFound('File');
      const okKind = input.kind === 'audio' ? f.kind === 'audio' : f.kind === 'document' || f.kind === 'image';
      if (!okKind) throw invalid('This file does not match the kind of evidence', { reason: 'EVIDENCE_FILE_KIND' });
      // The media flags are checked again: an admin may have switched photos or audio off since the upload (D-014).
      assertMediaAllowed(ctx.db, f.kind, 'evidence');
      fileId = f.id;
    }
    const now = ctx.now();
    const row: EvidenceRow = { id: newId(), studentId, subjectId: input.subjectId, goalId: input.goalId ?? null, kind: input.kind, body, url, fileId, authorType: 'student', authorId: studentId, createdAt: now, updatedAt: now, deletedAt: null };
    ctx.db.insert(evidence).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'evidence.create', entity: 'evidence', entityId: row.id, after: { subjectId: row.subjectId, goalId: row.goalId, kind: row.kind, fileId } }, now);
    return evidenceDtos(ctx.db, [row])[0]!;
  });
}

function ownEvidence(ctx: RequestContext, evidenceId: string): EvidenceRow {
  const { studentId } = requireStudent(ctx);
  const e = ctx.db.select().from(evidence).where(eq(evidence.id, evidenceId)).get();
  if (!e || e.deletedAt !== null || e.studentId !== studentId) throw notFound('Evidence');
  writableSubject(ctx, studentScope(ctx, studentId), e.subjectId);
  if (e.authorType !== 'student') throw notYours();
  return e;
}

export function updateEvidence(ctx: RequestContext, input: In<typeof C.studentUpdateEvidence>): Evidence {
  return tx(ctx.db, () => {
    const e = ownEvidence(ctx, input.evidenceId);
    const patch: Partial<EvidenceRow> = { updatedAt: ctx.now() };
    if (input.body !== undefined) {
      const body = input.body?.trim() || null;
      if (e.kind === 'text' && !body) throw invalid('Write something first', { reason: 'EVIDENCE_TEXT_REQUIRED' });
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
    return evidenceDtos(ctx.db, [ctx.db.select().from(evidence).where(eq(evidence.id, e.id)).get()!])[0]!;
  });
}

export function deleteEvidence(ctx: RequestContext, evidenceId: string): void {
  tx(ctx.db, () => {
    const e = ownEvidence(ctx, evidenceId);
    ctx.db.update(evidence).set({ deletedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(evidence.id, e.id)).run();
    audit(ctx.db, ctx.actor, { action: 'evidence.delete', entity: 'evidence', entityId: e.id, before: { kind: e.kind, fileId: e.fileId } }, ctx.now());
  });
}

/** Student upload (STU-8): media flag first (before the body is read), then the usual pipeline with the student as owner. */
export async function uploadEvidenceFile(ctx: RequestContext, req: FastifyRequest, kind: In<typeof C.studentUploadFile>['kind']) {
  const { studentId } = requireStudent(ctx);
  assertMediaAllowed(ctx.db, kind, 'evidence');
  const scope = studentScope(ctx, studentId);
  if (!scope.contexts.some((c) => canWriteIn(ctx, c))) throw new AppError('FEATURE_DISABLED', 'Evidence cannot be added now', { reason: 'GOALS_READ_ONLY' });
  const f = await ingestUpload(ctx, req, { kind, ownerStudentId: studentId });
  return { id: f.id, kind, mime: f.sniffedMime, name: f.originalName, size: f.size, hasThumbnail: f.thumbStorageKey !== null };
}

/** Live evidence of this student that shows this file (for the file policy). */
export function fileOnStudentEvidence(ctx: RequestContext, studentId: string, fileId: string): boolean {
  return Boolean(ctx.db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.studentId, studentId), eq(evidence.fileId, fileId), isNull(evidence.deletedAt))).get());
}
