/**
 * Goals and skills report (RPT-1, RPT-5, GOL-3). The student's own self-assessment (confidence 1–5)
 * and the teacher's assessment (outcome) are ALWAYS separate tables, never merged into one figure.
 * Goals counted: the students' goals in this subject that existed by the end of the period; the
 * latest assessment of each kind up to the end of the period. Student reflections are a section of
 * their own (counts and dates; the text stays on the goal page). Private teacher notes are never read
 * here (GOL-6).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { localDate } from '../../../domain/dates.ts';
import type { ReportSectionData, TimelineEvent } from '../../../shared/contracts/reports.ts';
import { goalEntries, goals, skillCategories, teacherAssessments } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { ReportScope } from '../manifest.ts';
import { col, date, key, lbl, n, NA, NR, scopeIds, student, table, text } from '../reports/cells.ts';
import { outcomesOf } from './library.ts';

const CONFIDENCE = [1, 2, 3, 4, 5] as const;
const GOAL_STATES = ['active', 'achieved', 'archived'] as const;

function load(ctx: RequestContext, scope: ReportScope) {
  const ids = scopeIds(scope);
  const day = (ms: number) => localDate(ms, scope.timezone);
  const all = ids.length ? ctx.db.select().from(goals).where(and(inArray(goals.studentId, ids), eq(goals.subjectId, scope.context.subjectId), isNull(goals.deletedAt))).all() : [];
  const gs = all.filter((g) => day(g.createdAt) <= scope.to);
  const gIds = gs.map((g) => g.id);
  const entries = gIds.length
    ? ctx.db
        .select()
        .from(goalEntries)
        .where(and(inArray(goalEntries.goalId, gIds), isNull(goalEntries.deletedAt)))
        .all()
        .filter((e) => day(e.createdAt) <= scope.to)
    : [];
  const assessments = gIds.length
    ? ctx.db
        .select()
        .from(teacherAssessments)
        .where(inArray(teacherAssessments.goalId, gIds))
        .all()
        .filter((a) => day(a.createdAt) <= scope.to)
    : [];
  const latest = <T extends { goalId: string; createdAt: number }>(xs: T[]) => {
    const m = new Map<string, T>();
    for (const x of xs) if (!m.has(x.goalId) || m.get(x.goalId)!.createdAt <= x.createdAt) m.set(x.goalId, x);
    return m;
  };
  const self = entries.filter((e) => e.kind === 'self_assessment' && e.confidence !== null);
  return { gs, entries, assessments, day, lastTeacher: latest(assessments), lastSelf: latest(self), self };
}

export function goalsReportSection(ctx: RequestContext, scope: ReportScope): ReportSectionData {
  const { gs, assessments, day, lastTeacher, lastSelf, self } = load(ctx, scope);
  const outcomes = outcomesOf(ctx.db, scope.context.id);
  const catIds = [...new Set(gs.map((g) => g.categoryId))];
  const cats = catIds.length ? ctx.db.select().from(skillCategories).where(inArray(skillCategories.id, catIds)).all() : [];
  const inPeriod = (ms: number) => day(ms) >= scope.from && day(ms) <= scope.to;
  const teacherLatest = [...lastTeacher.values()];
  const selfLatest = [...lastSelf.values()];
  return {
    key: 'goals',
    title: key('report.section.goals'),
    intro: key('report.goals.intro'),
    metrics: [
      { key: 'goals', label: key('report.goals.goals'), cell: n(gs.length) },
      { key: 'teacherAssessed', label: key('report.goals.teacherAssessed'), cell: n(lastTeacher.size, gs.length) },
      { key: 'selfAssessed', label: key('report.goals.selfAssessed'), cell: n(lastSelf.size, gs.length) },
      { key: 'assessmentsInPeriod', label: key('report.goals.assessmentsInPeriod'), cell: n(assessments.filter((a) => inPeriod(a.createdAt)).length) },
    ],
    tables: [
      table({
        key: 'categories',
        title: key('report.goals.byCategory'),
        columns: [col('category', key('report.col.category')), col('active', key('report.goals.active'), true), col('achieved', key('report.goals.achieved'), true), col('archived', key('report.goals.archived'), true)],
        rows: catIds.map((cid) => {
          const mine = gs.filter((g) => g.categoryId === cid);
          const now = cats.find((c) => c.id === cid)?.name;
          return { key: cid, cells: [lbl(text(mine[mine.length - 1]!.labelSnapshot.category, now)), ...GOAL_STATES.map((st) => n(mine.filter((g) => g.status === st).length, mine.length))] };
        }),
      }),
      table({
        key: 'teacherAssessment',
        title: key('report.goals.teacherAssessment'),
        note: key('report.goals.teacherAssessmentNote'),
        columns: [col('outcome', key('report.col.outcome')), col('goals', key('report.goals.goals'), true)],
        rows: [
          ...outcomes.map((o) => ({ key: o.key, cells: [lbl(text(o.label)), n(teacherLatest.filter((a) => a.outcome === o.key).length, gs.length)] })),
          { key: 'none', cells: [lbl(key('report.goals.notAssessed')), n(gs.length - lastTeacher.size, gs.length)] },
        ],
        chart: { kind: 'bar', labelColumn: 'outcome', valueColumns: ['goals'] },
      }),
      table({
        key: 'selfAssessment',
        title: key('report.goals.selfAssessment'),
        note: key('report.goals.selfAssessmentNote'),
        columns: [col('confidence', key('report.col.confidence')), col('goals', key('report.goals.goals'), true)],
        rows: [
          ...CONFIDENCE.map((c) => ({ key: String(c), cells: [lbl(key('report.goals.confidenceValue', { value: c })), n(selfLatest.filter((e) => e.confidence === c).length, gs.length)] })),
          { key: 'none', cells: [lbl(key('report.goals.noSelfAssessment')), n(gs.length - lastSelf.size, gs.length)] },
        ],
        chart: { kind: 'bar', labelColumn: 'confidence', valueColumns: ['goals'] },
      }),
      table({
        key: 'students',
        title: key('report.goals.byStudent'),
        columns: [
          col('student', key('report.col.student')),
          col('goals', key('report.goals.goals'), true),
          col('achieved', key('report.goals.achieved'), true),
          col('teacherAssessed', key('report.goals.teacherAssessed'), true),
          col('selfAssessed', key('report.goals.selfAssessed'), true),
          col('selfInPeriod', key('report.goals.selfInPeriod'), true),
        ],
        rows: scope.students.map((s) => {
          const mine = gs.filter((g) => g.studentId === s.id);
          if (!mine.length) return { key: s.id, cells: [student(s), n(0), NA, NA, NA, NA] };
          const ids = new Set(mine.map((g) => g.id));
          return {
            key: s.id,
            cells: [
              student(s),
              n(mine.length),
              n(mine.filter((g) => g.status === 'achieved').length, mine.length),
              n([...lastTeacher.keys()].filter((id) => ids.has(id)).length, mine.length),
              n([...lastSelf.keys()].filter((id) => ids.has(id)).length, mine.length),
              n(self.filter((e) => ids.has(e.goalId) && inPeriod(e.createdAt)).length),
            ],
          };
        }),
      }),
    ],
    notes: [key('report.goals.separateNote')],
  };
}

export function studentReflectionsSection(ctx: RequestContext, scope: ReportScope): ReportSectionData {
  const { gs, entries, day } = load(ctx, scope);
  const owner = new Map(gs.map((g) => [g.id, g.studentId]));
  const refl = entries.filter((e) => e.kind === 'reflection' && e.authorType === 'student' && day(e.createdAt) >= scope.from);
  return {
    key: 'studentReflections',
    title: key('report.section.studentReflections'),
    metrics: [{ key: 'reflections', label: key('report.reflections.studentCount'), cell: n(refl.length) }],
    tables: [
      table({
        key: 'students',
        title: key('report.reflections.byStudent'),
        columns: [col('student', key('report.col.student')), col('count', key('report.reflections.studentCount'), true), col('last', key('report.col.lastTime'))],
        rows: scope.students.map((s) => {
          const mine = refl.filter((e) => owner.get(e.goalId) === s.id).sort((a, b) => a.createdAt - b.createdAt);
          return { key: s.id, cells: [student(s), n(mine.length), mine.length ? date(day(mine[mine.length - 1]!.createdAt)) : NR] };
        }),
      }),
    ],
    notes: [key('report.reflections.textOnGoalPage')],
  };
}

export function goalsTimeline(ctx: RequestContext, scope: ReportScope, studentId: string): TimelineEvent[] {
  const { gs, entries, assessments, day } = load(ctx, scope);
  const outcomes = outcomesOf(ctx.db, scope.context.id);
  const mine = gs.filter((g) => g.studentId === studentId);
  const ids = new Set(mine.map((g) => g.id));
  const out: TimelineEvent[] = [];
  for (const g of mine) out.push({ date: day(g.createdAt), at: g.createdAt, module: 'goals', what: key('report.timeline.goalSet'), detail: { raw: g.text } });
  for (const e of entries.filter((x) => ids.has(x.goalId) && x.kind === 'self_assessment' && x.confidence !== null)) {
    out.push({ date: day(e.createdAt), at: e.createdAt, module: 'goals', what: key('report.timeline.selfAssessment'), detail: key('report.goals.confidenceValue', { value: e.confidence ?? 0 }) });
  }
  for (const a of assessments.filter((x) => ids.has(x.goalId))) {
    const o = outcomes.find((x) => x.key === a.outcome);
    out.push({ date: day(a.createdAt), at: a.createdAt, module: 'goals', what: key('report.timeline.teacherAssessment'), detail: o ? text(o.label) : { raw: a.outcome } });
  }
  return out;
}
