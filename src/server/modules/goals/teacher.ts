/**
 * Goals in the teacher area (S10: GOL-1..6, ACC-10, RPT-5). Every endpoint is `teacher` access
 * (PIN-gated in classroom mode). A teacher works on the goals of students in a class they teach, in
 * the subject of their own teaching context; writes need the Goals module on and a writable class.
 * Reads keep working when the module is switched off (CFG-2).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/goals.ts';
import { OutcomeSet, type Category, type Evidence, type Feedback, type Goal, type GoalLibrary, type Preset, type PrivateNote, type TeacherStudentGoals } from '../../../shared/contracts/goals.ts';
import { initials, normaliseName } from '../../../shared/text/turkish.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import { tx } from '../../db/client.ts';
import { defaultItemArchives, evidence, files, goalEntries, goalPresets, goals, skillCategories, students, subjects, teacherAssessments, teacherFeedback, teachingContexts } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { assertModuleEnabled, getMediaPolicy, isModuleEnabled, mergeModuleConfig } from '../school/modules.ts';
import { assertClassWritable, assertOwnsContext, getClass, type ClassRow, type ContextRow } from '../school/policy.ts';
import { assertMediaAllowed, deleteFileRow } from '../files/service.ts';
import { liveClassIdsOf, rosterRows } from '../students/service.ts';
import { evidenceDtos, evidenceOf, feedbackDtos, feedbackOf, goalDto, goalDtos, goalsOf, type GoalRow } from './dto.ts';
import { categoryDto, defaultLibrary, getCategory, getPreset, hiddenDefaultsOf, inScope, libraryFor, outcomesOf, presetDto, type HiddenDefaults } from './library.ts';
import { addPrivateNote, deletePrivateNote, myPrivateNotes } from './private.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;

interface TeacherScope {
  context: ContextRow;
  cls: ClassRow;
}

const cleanText = (t: LocalizedTextValue): LocalizedTextValue => ({
  ...(t.en?.trim() ? { en: normaliseName(t.en) } : {}),
  ...(t.tr?.trim() ? { tr: normaliseName(t.tr) } : {}),
});

function scopeOf(ctx: RequestContext, contextId: string): TeacherScope {
  const context = assertOwnsContext(ctx, contextId);
  return { context, cls: getClass(ctx.db, context.classId) };
}

/** Writes need the module on (CFG-1) and a writable class and year (DAT-1). */
function assertWritable(ctx: RequestContext, s: TeacherScope): void {
  assertModuleEnabled(ctx.db, s.context.id, 'goals');
  assertClassWritable(ctx.db, s.cls);
}

function assertStudentInClass(ctx: RequestContext, s: TeacherScope, studentId: string) {
  const st = ctx.db.select().from(students).where(eq(students.id, studentId)).get();
  if (!st || !liveClassIdsOf(ctx, studentId).includes(s.cls.id)) throw notFound('Student');
  return st;
}

/** The goal and the teacher's own context for its subject in one of the student's classes (ACC-10); 404 otherwise. */
function goalForTeacher(ctx: RequestContext, goalId: string): { goal: GoalRow } & TeacherScope {
  const goal = ctx.db.select().from(goals).where(eq(goals.id, goalId)).get();
  if (!goal || goal.deletedAt !== null) throw notFound('Goal');
  const classIds = liveClassIdsOf(ctx, goal.studentId);
  const context = classIds.length
    ? ctx.db
        .select()
        .from(teachingContexts)
        .where(and(eq(teachingContexts.teacherId, requireUser(ctx).id), eq(teachingContexts.subjectId, goal.subjectId), inArray(teachingContexts.classId, classIds), isNull(teachingContexts.endedAt)))
        .get()
    : undefined;
  if (!context) throw notFound('Goal');
  return { goal, context, cls: getClass(ctx.db, context.classId) };
}

/**
 * The signed-in teacher's active context for this subject in one of the student's classes (ACC-10),
 * or the same 404 as a missing record: a teacher who no longer teaches the student cannot change
 * what they wrote about them.
 */
function scopeForStudent(ctx: RequestContext, studentId: string, subjectId: string, what: string): TeacherScope {
  const classIds = liveClassIdsOf(ctx, studentId);
  const context = classIds.length
    ? ctx.db
        .select()
        .from(teachingContexts)
        .where(and(eq(teachingContexts.teacherId, requireUser(ctx).id), eq(teachingContexts.subjectId, subjectId), inArray(teachingContexts.classId, classIds), isNull(teachingContexts.endedAt)))
        .get()
    : undefined;
  if (!context) throw notFound(what);
  return { context, cls: getClass(ctx.db, context.classId) };
}

/**
 * Library entries (own categories and presets) belong to a subject, not to one class: changing them
 * needs at least one active context of the teacher in that subject whose class and year are writable
 * (DAT-1). Otherwise the archived-class answer of the first context, or 404 when none is left.
 */
function assertLibraryWritable(ctx: RequestContext, subjectId: string | null, what: string): void {
  const contexts = subjectId
    ? ctx.db
        .select()
        .from(teachingContexts)
        .where(and(eq(teachingContexts.teacherId, requireUser(ctx).id), eq(teachingContexts.subjectId, subjectId), isNull(teachingContexts.endedAt)))
        .all()
    : [];
  if (!contexts.length) throw notFound(what);
  let first: unknown = null;
  for (const c of contexts) {
    try {
      assertClassWritable(ctx.db, getClass(ctx.db, c.classId));
      return;
    } catch (e) {
      first ??= e;
    }
  }
  throw first;
}

function teacherIdsOf(s: TeacherScope): string[] {
  return [s.context.teacherId];
}

// ---------------------------------------------------------------- reads
export function overview(ctx: RequestContext, contextId: string) {
  const s = scopeOf(ctx, contextId);
  const subject = ctx.db.select().from(subjects).where(eq(subjects.id, s.context.subjectId)).get();
  const roster = rosterRows(ctx, s.cls).map((r) => r.student);
  const ids = roster.map((r) => r.id);
  const goalRows = ids.length ? ctx.db.select().from(goals).where(and(inArray(goals.studentId, ids), eq(goals.subjectId, s.context.subjectId), isNull(goals.deletedAt))).all() : [];
  const goalIds = goalRows.map((g) => g.id);
  const entries = goalIds.length ? ctx.db.select().from(goalEntries).where(and(inArray(goalEntries.goalId, goalIds), isNull(goalEntries.deletedAt))).all() : [];
  const ev = ids.length ? ctx.db.select().from(evidence).where(and(inArray(evidence.studentId, ids), eq(evidence.subjectId, s.context.subjectId), isNull(evidence.deletedAt))).all() : [];
  const goalOwner = new Map(goalRows.map((g) => [g.id, g.studentId]));
  return {
    contextId: s.context.id,
    className: s.cls.name,
    subjectName: subject?.name ?? {},
    enabled: isModuleEnabled(ctx.db, s.context.id, 'goals'),
    students: roster.map((st) => {
      const mine = goalRows.filter((g) => g.studentId === st.id);
      const myEntries = entries.filter((e) => goalOwner.get(e.goalId) === st.id);
      const myEvidence = ev.filter((e) => e.studentId === st.id);
      const self = myEntries.filter((e) => e.kind === 'self_assessment' && e.confidence !== null).sort((a, b) => b.createdAt - a.createdAt)[0];
      const times = [...mine.map((g) => g.updatedAt), ...myEntries.map((e) => e.updatedAt), ...myEvidence.map((e) => e.updatedAt)];
      return {
        id: st.id,
        fullName: st.fullName,
        initials: initials(st.fullName),
        avatarHue: st.avatarHue,
        activeGoals: mine.filter((g) => g.status === 'active').length,
        achievedGoals: mine.filter((g) => g.status === 'achieved').length,
        evidence: myEvidence.length,
        lastConfidence: self?.confidence ?? null,
        lastActivityAt: times.length ? Math.max(...times) : null,
      };
    }),
  };
}

export function studentDetail(ctx: RequestContext, contextId: string, studentId: string): TeacherStudentGoals {
  const s = scopeOf(ctx, contextId);
  const st = assertStudentInClass(ctx, s, studentId);
  const subjectId = s.context.subjectId;
  const media = getMediaPolicy(ctx.db);
  return {
    student: { id: st.id, fullName: st.fullName, initials: initials(st.fullName), avatarHue: st.avatarHue },
    subjectId,
    goals: goalDtos(ctx.db, goalsOf(ctx.db, studentId, subjectId)),
    evidence: evidenceDtos(ctx.db, evidenceOf(ctx.db, studentId, subjectId)),
    feedback: feedbackDtos(ctx.db, feedbackOf(ctx.db, studentId, subjectId)),
    privateNotes: myPrivateNotes(ctx.db, requireUser(ctx).id, studentId, subjectId),
    library: libraryFor(ctx.db, s.context.id, subjectId, teacherIdsOf(s), true),
    media: { photos: media.evidencePhotos, audio: media.evidenceAudio, documents: media.evidenceDocuments },
  };
}

export function library(ctx: RequestContext, contextId: string): GoalLibrary {
  const s = scopeOf(ctx, contextId);
  return libraryFor(ctx.db, s.context.id, s.context.subjectId, teacherIdsOf(s), true);
}

// ---------------------------------------------------------------- goals
export function createGoal(ctx: RequestContext, input: In<typeof C.teacherCreateGoal>): Goal {
  return tx(ctx.db, () => {
    const s = scopeOf(ctx, input.contextId);
    assertWritable(ctx, s);
    assertStudentInClass(ctx, s, input.studentId);
    const subjectId = s.context.subjectId;
    const preset = input.presetId ? getPreset(ctx.db, input.presetId) : undefined;
    if (input.presetId && (!preset || !inScope(preset, subjectId, teacherIdsOf(s)))) throw notFound('Preset goal');
    const category = getCategory(ctx.db, preset?.categoryId ?? input.categoryId);
    if (!category || !inScope(category, subjectId, teacherIdsOf(s))) throw notFound('Category');
    const text = input.text ?? (preset ? (preset.text.en ?? preset.text.tr ?? '') : '');
    if (!text.trim()) throw invalid('Write the goal or choose a preset goal', { reason: 'GOAL_TEXT_REQUIRED' });
    const now = ctx.now();
    const row: GoalRow = {
      id: newId(),
      studentId: input.studentId,
      subjectId,
      contextId: s.context.id,
      categoryId: category.id,
      authorType: 'teacher',
      authorId: requireUser(ctx).id,
      presetId: preset?.id ?? null,
      text: text.trim(),
      practiceChoicesJson: input.practiceChoices ?? [],
      reviewOn: input.reviewOn ?? null,
      status: 'active',
      labelSnapshot: { category: category.name, ...(preset && !input.text ? { preset: preset.text } : {}) },
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    ctx.db.insert(goals).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'goal.create', entity: 'goal', entityId: row.id, after: { studentId: row.studentId, subjectId, categoryId: row.categoryId, presetId: row.presetId, reviewOn: row.reviewOn } }, now);
    return goalDto(ctx.db, row);
  });
}

export function updateGoal(ctx: RequestContext, input: In<typeof C.teacherUpdateGoal>): Goal {
  return tx(ctx.db, () => {
    const { goal, ...s } = goalForTeacher(ctx, input.goalId);
    assertWritable(ctx, s);
    // A student's own words stay theirs (GOL-5): teachers change status, review date and category only.
    if ((input.text !== undefined || input.practiceChoices !== undefined) && goal.authorType !== 'teacher') {
      throw new AppError('FORBIDDEN', 'The student wrote this goal; only they can change its words', { reason: 'STUDENT_CONTRIBUTION' });
    }
    const patch: Partial<GoalRow> = { updatedAt: ctx.now() };
    if (input.text !== undefined) {
      patch.text = input.text;
      patch.labelSnapshot = { category: goal.labelSnapshot.category };
    }
    if (input.practiceChoices !== undefined) patch.practiceChoicesJson = input.practiceChoices;
    if (input.reviewOn !== undefined) patch.reviewOn = input.reviewOn;
    if (input.status !== undefined) patch.status = input.status;
    if (input.categoryId !== undefined && input.categoryId !== goal.categoryId) {
      const cat = getCategory(ctx.db, input.categoryId);
      if (!cat || !inScope(cat, goal.subjectId, teacherIdsOf(s))) throw notFound('Category');
      patch.categoryId = cat.id;
      patch.labelSnapshot = { ...(patch.labelSnapshot ?? goal.labelSnapshot), category: cat.name };
    }
    ctx.db.update(goals).set(patch).where(eq(goals.id, goal.id)).run();
    audit(ctx.db, ctx.actor, { action: 'goal.update', entity: 'goal', entityId: goal.id, before: { status: goal.status, reviewOn: goal.reviewOn, categoryId: goal.categoryId }, after: { status: patch.status, reviewOn: patch.reviewOn, categoryId: patch.categoryId, textChanged: input.text !== undefined } }, ctx.now());
    return goalDto(ctx.db, ctx.db.select().from(goals).where(eq(goals.id, goal.id)).get()!);
  });
}

export function addProgress(ctx: RequestContext, input: In<typeof C.teacherAddProgress>): Goal {
  return tx(ctx.db, () => {
    const { goal, ...s } = goalForTeacher(ctx, input.goalId);
    assertWritable(ctx, s);
    const now = ctx.now();
    const id = newId();
    ctx.db.insert(goalEntries).values({ id, goalId: goal.id, authorType: 'teacher', authorId: requireUser(ctx).id, kind: 'progress', body: input.body, confidence: null, createdAt: now, updatedAt: now, deletedAt: null }).run();
    ctx.db.update(goals).set({ updatedAt: now }).where(eq(goals.id, goal.id)).run();
    audit(ctx.db, ctx.actor, { action: 'goal_entry.create', entity: 'goal_entry', entityId: id, after: { goalId: goal.id, kind: 'progress' } }, now);
    return goalDto(ctx.db, ctx.db.select().from(goals).where(eq(goals.id, goal.id)).get()!);
  });
}

/** Teacher outcome (GOL-3): a new row each time, so the history of outcomes is kept. */
export function assess(ctx: RequestContext, input: In<typeof C.teacherAssessGoal>): Goal {
  return tx(ctx.db, () => {
    const { goal, ...s } = goalForTeacher(ctx, input.goalId);
    assertWritable(ctx, s);
    const now = ctx.now();
    const id = newId();
    ctx.db.insert(teacherAssessments).values({ id, goalId: goal.id, teacherId: requireUser(ctx).id, outcome: input.outcome, createdAt: now }).run();
    audit(ctx.db, ctx.actor, { action: 'goal.assess', entity: 'goal', entityId: goal.id, after: { outcome: input.outcome } }, now);
    return goalDto(ctx.db, goal);
  });
}

// ---------------------------------------------------------------- feedback and private notes (GOL-6)
export function addFeedback(ctx: RequestContext, input: In<typeof C.teacherAddFeedback>): Feedback {
  return tx(ctx.db, () => {
    const s = scopeOf(ctx, input.contextId);
    assertWritable(ctx, s);
    assertStudentInClass(ctx, s, input.studentId);
    if (input.goalId) {
      const g = ctx.db.select().from(goals).where(eq(goals.id, input.goalId)).get();
      if (!g || g.deletedAt !== null || g.studentId !== input.studentId || g.subjectId !== s.context.subjectId) throw notFound('Goal');
    }
    const now = ctx.now();
    const row = { id: newId(), studentId: input.studentId, subjectId: s.context.subjectId, goalId: input.goalId ?? null, teacherId: requireUser(ctx).id, body: input.body, createdAt: now, updatedAt: now, deletedAt: null };
    ctx.db.insert(teacherFeedback).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'feedback.create', entity: 'teacher_feedback', entityId: row.id, after: { studentId: row.studentId, goalId: row.goalId } }, now);
    return feedbackDtos(ctx.db, [row])[0]!;
  });
}

export function deleteFeedback(ctx: RequestContext, feedbackId: string): void {
  tx(ctx.db, () => {
    const f = ctx.db.select().from(teacherFeedback).where(eq(teacherFeedback.id, feedbackId)).get();
    if (!f || f.deletedAt !== null || f.teacherId !== requireUser(ctx).id) throw notFound('Feedback');
    // Like every write: the teacher still teaches the student here, module on, class and year writable.
    assertWritable(ctx, scopeForStudent(ctx, f.studentId, f.subjectId, 'Feedback'));
    ctx.db.update(teacherFeedback).set({ deletedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(teacherFeedback.id, f.id)).run();
    audit(ctx.db, ctx.actor, { action: 'feedback.delete', entity: 'teacher_feedback', entityId: f.id, before: { studentId: f.studentId, goalId: f.goalId } }, ctx.now());
  });
}

export function privateNote(ctx: RequestContext, input: In<typeof C.teacherAddPrivateNote>): PrivateNote {
  return tx(ctx.db, () => {
    const s = scopeOf(ctx, input.contextId);
    assertClassWritable(ctx.db, s.cls);
    assertStudentInClass(ctx, s, input.studentId);
    return addPrivateNote(ctx, input.studentId, s.context.subjectId, input.body);
  });
}

/** The author deletes their note while they still teach the student and the class and year are writable (DAT-1). */
export const removePrivateNote = (ctx: RequestContext, noteId: string) =>
  deletePrivateNote(ctx, noteId, (n) => assertClassWritable(ctx.db, scopeForStudent(ctx, n.studentId, n.subjectId, 'Note').cls));

// ---------------------------------------------------------------- categories, presets, outcome labels (GOL-1)
export function createCategory(ctx: RequestContext, input: In<typeof C.createCategory>): Category {
  return tx(ctx.db, () => {
    const s = scopeOf(ctx, input.contextId);
    assertClassWritable(ctx.db, s.cls);
    const now = ctx.now();
    const row = { id: newId(), subjectId: s.context.subjectId, name: cleanText(input.name), icon: input.icon ?? null, sortOrder: 1000, createdBy: requireUser(ctx).id, archivedAt: null, createdAt: now, updatedAt: now };
    ctx.db.insert(skillCategories).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'goal_category.create', entity: 'skill_category', entityId: row.id, after: { name: row.name, subjectId: row.subjectId } }, now);
    return categoryDto(row);
  });
}

/**
 * A teacher archives or restores a DEFAULT category or preset for their own classes only (S13b2,
 * D-116): a row in `default_item_archives`; the default itself and other teachers are unaffected.
 * Defaults cannot be renamed by teachers. Returns the viewer's state of the item.
 */
function setDefaultHidden(ctx: RequestContext, kind: 'category' | 'preset', itemId: string, archived: boolean | undefined, renamed: boolean): HiddenDefaults {
  const userId = requireUser(ctx).id;
  if (renamed) throw new AppError('FORBIDDEN', 'Default items belong to the school and cannot be renamed', { reason: 'DEFAULT_ITEM_READ_ONLY' });
  if (archived !== undefined) {
    const where = and(eq(defaultItemArchives.userId, userId), eq(defaultItemArchives.kind, kind), eq(defaultItemArchives.itemId, itemId));
    const had = Boolean(ctx.db.select().from(defaultItemArchives).where(where).get());
    if (archived && !had) ctx.db.insert(defaultItemArchives).values({ userId, kind, itemId, archivedAt: ctx.now() }).run();
    if (!archived && had) ctx.db.delete(defaultItemArchives).where(where).run();
    if (archived !== had) {
      audit(ctx.db, ctx.actor, { action: archived ? 'goal_default.hide' : 'goal_default.show', entity: kind === 'category' ? 'skill_category' : 'goal_preset', entityId: itemId, after: { scope: 'teacher' } }, ctx.now());
    }
  }
  return hiddenDefaultsOf(ctx.db, [userId]);
}

export function updateCategory(ctx: RequestContext, input: In<typeof C.updateCategory>): Category {
  return tx(ctx.db, () => {
    const c = getCategory(ctx.db, input.categoryId);
    if (c && c.createdBy === null) return categoryDto(c, setDefaultHidden(ctx, 'category', c.id, input.archived, Boolean(input.name) || input.icon !== undefined));
    // Custom categories: teachers edit only their own.
    if (!c || c.createdBy !== requireUser(ctx).id) throw notFound('Category');
    assertLibraryWritable(ctx, c.subjectId, 'Category');
    const patch: Partial<typeof skillCategories.$inferInsert> = { updatedAt: ctx.now() };
    if (input.name) patch.name = cleanText(input.name);
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.archived !== undefined) patch.archivedAt = input.archived ? ctx.now() : null;
    ctx.db.update(skillCategories).set(patch).where(eq(skillCategories.id, c.id)).run();
    audit(ctx.db, ctx.actor, { action: 'goal_category.update', entity: 'skill_category', entityId: c.id, before: { name: c.name, archived: c.archivedAt !== null }, after: { name: patch.name, archived: input.archived } }, ctx.now());
    return categoryDto(getCategory(ctx.db, c.id)!);
  });
}

export function createPreset(ctx: RequestContext, input: In<typeof C.createPreset>): Preset {
  return tx(ctx.db, () => {
    const s = scopeOf(ctx, input.contextId);
    assertClassWritable(ctx.db, s.cls);
    const cat = getCategory(ctx.db, input.categoryId);
    if (!cat || !inScope(cat, s.context.subjectId, teacherIdsOf(s))) throw notFound('Category');
    const now = ctx.now();
    const row = { id: newId(), categoryId: cat.id, subjectId: s.context.subjectId, text: cleanText(input.text), createdBy: requireUser(ctx).id, archivedAt: null, createdAt: now, updatedAt: now };
    ctx.db.insert(goalPresets).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'goal_preset.create', entity: 'goal_preset', entityId: row.id, after: { categoryId: cat.id, subjectId: row.subjectId } }, now);
    return presetDto(row);
  });
}

export function updatePreset(ctx: RequestContext, input: In<typeof C.updatePreset>): Preset {
  return tx(ctx.db, () => {
    const p = getPreset(ctx.db, input.presetId);
    if (p && p.createdBy === null) return presetDto(p, setDefaultHidden(ctx, 'preset', p.id, input.archived, Boolean(input.text)));
    if (!p || p.createdBy !== requireUser(ctx).id) throw notFound('Preset goal');
    assertLibraryWritable(ctx, p.subjectId, 'Preset goal');
    const patch: Partial<typeof goalPresets.$inferInsert> = { updatedAt: ctx.now() };
    if (input.text) patch.text = cleanText(input.text);
    if (input.archived !== undefined) patch.archivedAt = input.archived ? ctx.now() : null;
    ctx.db.update(goalPresets).set(patch).where(eq(goalPresets.id, p.id)).run();
    audit(ctx.db, ctx.actor, { action: 'goal_preset.update', entity: 'goal_preset', entityId: p.id, after: { textChanged: Boolean(input.text), archived: input.archived } }, ctx.now());
    return presetDto(getPreset(ctx.db, p.id)!);
  });
}

export function getSettings(ctx: RequestContext, contextId: string) {
  const s = scopeOf(ctx, contextId);
  return { outcomes: outcomesOf(ctx.db, s.context.id) };
}

export function setSettings(ctx: RequestContext, input: In<typeof C.setGoalSettings>) {
  return tx(ctx.db, () => {
    const s = scopeOf(ctx, input.contextId);
    assertClassWritable(ctx.db, s.cls);
    const outcomes = input.outcomes.map((o) => ({ key: o.key, label: cleanText(o.label) }));
    const ok = OutcomeSet.safeParse(outcomes);
    if (!ok.success) throw new AppError('VALIDATION', 'Every outcome needs a label', { reason: 'INVALID_OUTCOMES' });
    const before = outcomesOf(ctx.db, s.context.id);
    mergeModuleConfig(ctx.db, s.context.id, 'goals', { outcomes: ok.data }, requireUser(ctx).id, ctx.now());
    audit(ctx.db, ctx.actor, { action: 'goals.settings', entity: 'teaching_context', entityId: s.context.id, before: { outcomes: before }, after: { outcomes: ok.data } }, ctx.now());
    return { outcomes: outcomesOf(ctx.db, s.context.id) };
  });
}

// ---------------------------------------------------------------- evidence by the teacher (S13b2, D-119)
/**
 * Evidence for a student from the teacher Goals page: text, a safe link, or a file the teacher
 * uploaded for this student (`uploadFile` with the student as owner). The media flags are checked
 * again here (an admin may have switched photos or audio off since the upload, D-014).
 */
/** True when the file is some student's current profile photo (never attachable or deletable as evidence). */
function isStudentPhotoFile(ctx: RequestContext, fileId: string): boolean {
  return ctx.db.select({ id: students.id }).from(students).where(eq(students.photoFileId, fileId)).get() !== undefined;
}

export function addEvidence(ctx: RequestContext, input: In<typeof C.teacherAddEvidence>): Evidence {
  return tx(ctx.db, () => {
    const s = scopeOf(ctx, input.contextId);
    assertWritable(ctx, s);
    assertStudentInClass(ctx, s, input.studentId);
    const subjectId = s.context.subjectId;
    if (input.goalId) {
      const g = ctx.db.select().from(goals).where(eq(goals.id, input.goalId)).get();
      if (!g || g.deletedAt !== null || g.studentId !== input.studentId || g.subjectId !== subjectId) throw notFound('Goal');
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
      const me = requireUser(ctx).id;
      if (!f || f.deletedAt !== null || f.ownerStudentId !== input.studentId || f.uploadedByType !== 'user' || f.uploadedById !== me) throw notFound('File');
      // A student's consent-gated profile photo is never evidence (STU-8): it would become visible to the student
      // and deleting the evidence would delete the photo.
      if (isStudentPhotoFile(ctx, f.id)) throw notFound('File');
      const okKind = input.kind === 'audio' ? f.kind === 'audio' : f.kind === 'document' || f.kind === 'image';
      if (!okKind) throw invalid('This file does not match the kind of evidence', { reason: 'EVIDENCE_FILE_KIND' });
      assertMediaAllowed(ctx.db, f.kind, 'evidence');
      fileId = f.id;
    }
    const now = ctx.now();
    const row = { id: newId(), studentId: input.studentId, subjectId, goalId: input.goalId ?? null, kind: input.kind, body, url, fileId, authorType: 'teacher' as const, authorId: requireUser(ctx).id, createdAt: now, updatedAt: now, deletedAt: null };
    ctx.db.insert(evidence).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'evidence.create', entity: 'evidence', entityId: row.id, after: { studentId: row.studentId, subjectId, goalId: row.goalId, kind: row.kind, fileId } }, now);
    return evidenceDtos(ctx.db, [row])[0]!;
  });
}

/** The author (a teacher who still teaches the student in that subject) deletes their evidence; its file goes too. */
export async function deleteEvidence(ctx: RequestContext, evidenceId: string): Promise<void> {
  const file = tx(ctx.db, () => {
    const e = ctx.db.select().from(evidence).where(eq(evidence.id, evidenceId)).get();
    if (!e || e.deletedAt !== null) throw notFound('Evidence');
    const s = scopeForStudent(ctx, e.studentId, e.subjectId, 'Evidence');
    if (e.authorType !== 'teacher' || e.authorId !== requireUser(ctx).id) throw new AppError('FORBIDDEN', 'Only evidence you added yourself can be deleted here', { reason: 'STUDENT_CONTRIBUTION' });
    assertWritable(ctx, s);
    ctx.db.update(evidence).set({ deletedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(evidence.id, e.id)).run();
    audit(ctx.db, ctx.actor, { action: 'evidence.delete', entity: 'evidence', entityId: e.id, before: { kind: e.kind, fileId: e.fileId } }, ctx.now());
    const f = e.fileId ? ctx.db.select().from(files).where(eq(files.id, e.fileId)).get() : undefined;
    const stillShown = f ? ctx.db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.fileId, f.id), isNull(evidence.deletedAt))).get() : undefined;
    return f && f.deletedAt === null && !stillShown && !isStudentPhotoFile(ctx, f.id) && f.uploadedByType === 'user' && f.uploadedById === requireUser(ctx).id ? f : null;
  });
  if (file) await deleteFileRow(ctx, file);
}

// ---------------------------------------------------------------- school-wide defaults (admin, D-116)
export const adminDefaults = (ctx: RequestContext) => defaultLibrary(ctx.db);

/** An administrator archives a default category or preset for every class, or restores it. */
export function adminArchiveDefault(ctx: RequestContext, input: In<typeof C.adminArchiveGoalDefault>) {
  return tx(ctx.db, () => {
    const table = input.kind === 'category' ? skillCategories : goalPresets;
    const row = ctx.db.select().from(table).where(eq(table.id, input.itemId)).get();
    if (!row || row.createdBy !== null) throw notFound(input.kind === 'category' ? 'Category' : 'Preset goal');
    if ((row.archivedAt !== null) !== input.archived) {
      ctx.db.update(table).set({ archivedAt: input.archived ? ctx.now() : null, updatedAt: ctx.now() }).where(eq(table.id, row.id)).run();
      audit(ctx.db, ctx.actor, { action: input.archived ? 'goal_default.archive' : 'goal_default.restore', entity: input.kind === 'category' ? 'skill_category' : 'goal_preset', entityId: row.id, after: { scope: 'school' } }, ctx.now());
    }
    return defaultLibrary(ctx.db);
  });
}
