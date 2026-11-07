/**
 * Goal, evidence and feedback responses shared by the teacher area and the student page. These are
 * allow-lists: they never carry private notes (GOL-6), author ids, storage keys or other students.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Evidence, Feedback, Goal, GoalOutcome } from '../../../shared/contracts/goals.ts';
import type { Db } from '../../db/client.ts';
import { evidence, files, goalEntries, goals, skillCategories, teacherAssessments, teacherFeedback, users } from '../../db/schema.ts';

export type GoalRow = typeof goals.$inferSelect;
export type EntryRow = typeof goalEntries.$inferSelect;
export type EvidenceRow = typeof evidence.$inferSelect;
export type FeedbackRow = typeof teacherFeedback.$inferSelect;

export function goalDtos(db: Db, rows: readonly GoalRow[]): Goal[] {
  if (!rows.length) return [];
  const ids = rows.map((g) => g.id);
  const entries = db.select().from(goalEntries).where(and(inArray(goalEntries.goalId, ids), isNull(goalEntries.deletedAt))).all();
  const assessments = db.select().from(teacherAssessments).where(inArray(teacherAssessments.goalId, ids)).orderBy(desc(teacherAssessments.createdAt)).all();
  const cats = new Map(
    db
      .select()
      .from(skillCategories)
      .where(inArray(skillCategories.id, [...new Set(rows.map((g) => g.categoryId))]))
      .all()
      .map((c) => [c.id, c]),
  );
  return rows.map((g) => ({
    id: g.id,
    subjectId: g.subjectId,
    category: { id: g.categoryId, name: cats.get(g.categoryId)?.name ?? g.labelSnapshot.category, nameAtCreation: g.labelSnapshot.category },
    authorType: g.authorType,
    presetId: g.presetId,
    presetText: g.labelSnapshot.preset ?? null,
    text: g.text,
    practiceChoices: g.practiceChoicesJson,
    reviewOn: g.reviewOn,
    status: g.status,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    entries: entries
      .filter((e) => e.goalId === g.id)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((e) => ({ id: e.id, kind: e.kind, authorType: e.authorType, body: e.body, confidence: e.confidence, createdAt: e.createdAt, updatedAt: e.updatedAt })),
    assessments: assessments.filter((a) => a.goalId === g.id).map((a) => ({ id: a.id, outcome: a.outcome as GoalOutcome, createdAt: a.createdAt })),
  }));
}

export const goalDto = (db: Db, row: GoalRow): Goal => goalDtos(db, [row])[0]!;

/** Live goals of a student in a subject, newest first. */
export function goalsOf(db: Db, studentId: string, subjectId: string): GoalRow[] {
  return db
    .select()
    .from(goals)
    .where(and(eq(goals.studentId, studentId), eq(goals.subjectId, subjectId), isNull(goals.deletedAt)))
    .all()
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export function evidenceDtos(db: Db, rows: readonly EvidenceRow[]): Evidence[] {
  const fileIds = rows.flatMap((r) => (r.fileId ? [r.fileId] : []));
  const fileRows = new Map((fileIds.length ? db.select().from(files).where(inArray(files.id, fileIds)).all() : []).map((f) => [f.id, f]));
  return rows.map((r) => {
    const f = r.fileId ? fileRows.get(r.fileId) : undefined;
    return {
      id: r.id,
      goalId: r.goalId,
      kind: r.kind,
      body: r.body,
      url: r.url,
      file: f && f.deletedAt === null ? { id: f.id, mime: f.sniffedMime, name: f.originalName, size: f.size, hasThumbnail: f.thumbStorageKey !== null } : null,
      authorType: r.authorType,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

export function evidenceOf(db: Db, studentId: string, subjectId: string): EvidenceRow[] {
  return db
    .select()
    .from(evidence)
    .where(and(eq(evidence.studentId, studentId), eq(evidence.subjectId, subjectId), isNull(evidence.deletedAt)))
    .all()
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export function feedbackDtos(db: Db, rows: readonly FeedbackRow[]): Feedback[] {
  const teacherIds = [...new Set(rows.map((r) => r.teacherId))];
  const names = new Map((teacherIds.length ? db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, teacherIds)).all() : []).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, goalId: r.goalId, body: r.body, teacherName: names.get(r.teacherId) ?? '', createdAt: r.createdAt, updatedAt: r.updatedAt }));
}

export function feedbackOf(db: Db, studentId: string, subjectId: string): FeedbackRow[] {
  return db
    .select()
    .from(teacherFeedback)
    .where(and(eq(teacherFeedback.studentId, studentId), eq(teacherFeedback.subjectId, subjectId), isNull(teacherFeedback.deletedAt)))
    .all()
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}
