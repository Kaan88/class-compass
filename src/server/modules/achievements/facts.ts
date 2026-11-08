/**
 * What one student did in one class+subject, for the achievement rules (S13c item 3, D-121). Ids,
 * times and kinds only: no text is read into the facts. Hidden and deleted items do not count.
 * Nothing about attendance is read (the rules are effort-based; a test scans this folder).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { weekStartOf } from '../../../domain/counters.ts';
import { emptyFacts, type ActivityFacts } from '../../../domain/achievements.ts';
import { SKILL_OF_CATEGORY_ICON, type AchievementSkill, type EvidenceFilterKind } from '../../../shared/achievements.ts';
import type { Db } from '../../db/client.ts';
import { assistantAssignments, assistantDutyChecks, assistantResponsibilities, evidence, files, goalEntries, goals, homeworkAssignments, homeworkMarkChanges, homeworkMarks, skillCategories } from '../../db/schema.ts';
import { earnedSecretTurns } from '../secret/service.ts';
import { livePointTimes } from '../superSpeakers/points.ts';
import { badgeSubject } from '../superSpeakers/service.ts';

const badgeSubjectId = (db: Db) => badgeSubject(db)?.id ?? null;
import type { ContextRow } from '../school/policy.ts';

export interface FactsOptions {
  timezone: string;
  weekStartsOn: number;
}

const skillOfIcon = (icon: string | null | undefined): AchievementSkill | null => (icon ? (SKILL_OF_CATEGORY_ICON[icon] ?? null) : null);

/** Facts of many students at once (backfill, reports); one query per source. */
export function collectFactsMany(db: Db, studentIds: readonly string[], context: ContextRow, opts: FactsOptions): Map<string, ActivityFacts> {
  const out = new Map<string, ActivityFacts>(studentIds.map((id) => [id, emptyFacts()]));
  if (!studentIds.length) return out;
  const ids = [...studentIds];
  const get = (id: string) => out.get(id)!;

  // Goals (student + subject): set, achieved, entries, evidence.
  const goalRows = db
    .select({ g: goals, icon: skillCategories.icon })
    .from(goals)
    .leftJoin(skillCategories, eq(skillCategories.id, goals.categoryId))
    .where(and(inArray(goals.studentId, ids), eq(goals.subjectId, context.subjectId), isNull(goals.deletedAt), isNull(goals.hiddenAt)))
    .all();
  const goalSkill = new Map<string, AchievementSkill | null>();
  for (const { g, icon } of goalRows) {
    const skill = skillOfIcon(icon);
    goalSkill.set(g.id, skill);
    get(g.studentId).goalsSet.push({ at: g.createdAt, skill });
    if (g.status === 'achieved') get(g.studentId).goalsAchieved.push({ at: g.achievedAt ?? g.createdAt, skill });
  }
  const goalOwner = new Map(goalRows.map(({ g }) => [g.id, g.studentId]));
  if (goalOwner.size) {
    const entries = db
      .select()
      .from(goalEntries)
      .where(and(inArray(goalEntries.goalId, [...goalOwner.keys()]), isNull(goalEntries.deletedAt), isNull(goalEntries.hiddenAt), eq(goalEntries.authorType, 'student')))
      .all();
    for (const e of entries) {
      const f = get(goalOwner.get(e.goalId)!);
      if (e.kind === 'reflection') f.reflections.push({ at: e.createdAt, weekStart: weekStartOf(e.createdAt, opts.timezone, opts.weekStartsOn) });
      else if (e.kind === 'note') f.notes.push({ at: e.createdAt });
      else if (e.kind === 'self_assessment' && e.confidence !== null) f.selfAssessments.push({ at: e.createdAt, goalId: e.goalId, confidence: e.confidence });
    }
  }
  const ev = db
    .select({ e: evidence, fileKind: files.kind })
    .from(evidence)
    .leftJoin(files, eq(files.id, evidence.fileId))
    .where(and(inArray(evidence.studentId, ids), eq(evidence.subjectId, context.subjectId), isNull(evidence.deletedAt), isNull(evidence.hiddenAt)))
    .all();
  for (const { e, fileKind } of ev) {
    const kind: EvidenceFilterKind = e.kind === 'file' ? (fileKind === 'image' ? 'image' : 'document') : e.kind;
    get(e.studentId).evidence.push({ at: e.createdAt, kind, skill: e.goalId ? (goalSkill.get(e.goalId) ?? null) : null });
  }

  // Homework of this class+subject (reviewed marks only; the kind comes from the assignment's status list).
  const hw = db.select().from(homeworkAssignments).where(and(eq(homeworkAssignments.contextId, context.id), isNull(homeworkAssignments.archivedAt))).all();
  if (hw.length) {
    const byId = new Map(hw.map((a) => [a.id, a]));
    const marks = db.select().from(homeworkMarks).where(and(inArray(homeworkMarks.assignmentId, [...byId.keys()]), inArray(homeworkMarks.studentId, ids))).all();
    const kindOf = (assignmentId: string, status: string | null) => (status === null ? null : (byId.get(assignmentId)!.statusSetJson.find((s) => s.key === status)?.kind ?? status));
    // A mark is dated by when it first reached its current kind (the change history), not by
    // `updatedAt`, which a later note edit bumps (S13c review: "start fresh" must not count old work).
    const since = new Map<string, number>();
    if (marks.length) {
      const changes = db
        .select({ assignmentId: homeworkMarkChanges.assignmentId, studentId: homeworkMarkChanges.studentId, afterStatus: homeworkMarkChanges.afterStatus, changedAt: homeworkMarkChanges.changedAt })
        .from(homeworkMarkChanges)
        .where(and(inArray(homeworkMarkChanges.assignmentId, [...byId.keys()]), inArray(homeworkMarkChanges.studentId, ids), isNull(homeworkMarkChanges.undoneAt)))
        .all()
        .sort((x, y) => x.changedAt - y.changedAt);
      const last = new Map<string, string | null>();
      for (const c of changes) {
        const k = `${c.assignmentId}:${c.studentId}`;
        const kind = kindOf(c.assignmentId, c.afterStatus);
        if (!last.has(k) || last.get(k) !== kind) since.set(k, c.changedAt);
        last.set(k, kind);
      }
    }
    for (const m of marks) {
      const a = byId.get(m.assignmentId)!;
      const kind = kindOf(m.assignmentId, m.status)!;
      get(m.studentId).homework.push({ at: since.get(`${m.assignmentId}:${m.studentId}`) ?? m.updatedAt, dueOn: a.dueOn, kind });
    }
  }

  // Daily assistant days (thanked or with duty ticks).
  const days = db.select().from(assistantAssignments).where(eq(assistantAssignments.contextId, context.id)).all();
  const mine = days.filter((d) => {
    const who = d.actualStudentId ?? d.plannedStudentId;
    return who !== null && out.has(who);
  });
  if (mine.length) {
    const active = db.select({ id: assistantResponsibilities.id }).from(assistantResponsibilities).where(and(eq(assistantResponsibilities.contextId, context.id), isNull(assistantResponsibilities.archivedAt))).all().length;
    const checks = db
      .select()
      .from(assistantDutyChecks)
      .where(and(eq(assistantDutyChecks.contextId, context.id), inArray(assistantDutyChecks.localDate, [...new Set(mine.map((d) => d.localDate))])))
      .all()
      .filter((c) => c.uncheckedAt === null);
    for (const d of mine) {
      const who = (d.actualStudentId ?? d.plannedStudentId)!;
      const ticks = checks.filter((c) => c.localDate === d.localDate && c.studentId === who);
      if (!ticks.length && d.thankedAt === null) continue;
      const at = Math.max(d.thankedAt ?? 0, ...ticks.map((t) => t.checkedAt));
      get(who).assistantDays.push({ at, date: d.localDate, allDuties: active > 0 && new Set(ticks.map((t) => t.responsibilityId)).size >= active });
    }
  }

  // Secret Students: revealed turns where the class earned it (read through the secret module).
  for (const id of ids) get(id).secretEarned.push(...earnedSecretTurns(db, id, context.id));

  // Super Speakers (S12, D-132): live points, school-wide, only in the badge subject's class+subjects.
  if (badgeSubjectId(db) === context.subjectId) for (const [id, times] of livePointTimes(db, ids)) get(id).speakerPoints.push(...times.map((at) => ({ at })));
  return out;
}

export const collectFacts = (db: Db, studentId: string, context: ContextRow, opts: FactsOptions): ActivityFacts => collectFactsMany(db, [studentId], context, opts).get(studentId)!;
