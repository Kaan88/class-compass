/**
 * Homework report (RPT-3, RPT-5, HW-1..4): assignments DUE in the period, students expected = in the
 * class on the due date (plus anyone already marked). "Not checked" (no mark) and "missing" are
 * always separate columns; every count is shown out of the students expected.
 */
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { HOMEWORK_STATUS_KINDS, NOT_CHECKED } from '../../../shared/contracts/homework.ts';
import type { ReportSectionData, TimelineEvent } from '../../../shared/contracts/reports.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { homeworkAssignments } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { ReportScope } from '../manifest.ts';
import { col, date, key, lbl, n, raw, scopeIds, student, table, text } from '../reports/cells.ts';
import { rosterRowsOn, type StudentRow } from '../students/service.ts';
import { expectedStudents, marksOfMany } from './service.ts';

type Kind = (typeof HOMEWORK_STATUS_KINDS)[number];
const KINDS: readonly Kind[] = ['completed', 'partly_completed', 'submitted_late', 'missing', 'excused', 'other', 'not_checked'];
const OUTSTANDING: ReadonlySet<Kind> = new Set(['missing', 'partly_completed']);
const kindKey = (k: Kind) => `homework.kind.${k}` as MessageKey;

function assignmentsDue(ctx: RequestContext, scope: ReportScope) {
  return ctx.db
    .select()
    .from(homeworkAssignments)
    .where(and(eq(homeworkAssignments.contextId, scope.context.id), isNull(homeworkAssignments.archivedAt), gte(homeworkAssignments.dueOn, scope.from), lte(homeworkAssignments.dueOn, scope.to)))
    .orderBy(asc(homeworkAssignments.dueOn), asc(homeworkAssignments.createdAt))
    .all();
}

/** Per assignment: the expected students in scope and each one's status key and kind. */
function marksFor(ctx: RequestContext, scope: ReportScope) {
  const ids = new Set(scopeIds(scope));
  const assignments = assignmentsDue(ctx, scope);
  // One read for every assignment's marks and one roster per distinct due date (D-162), not 2–3 reads
  // per assignment; the expected students and their order are the same as `expectedStudents` alone.
  const marksById = marksOfMany(ctx.db, assignments.map((a) => a.id));
  const rosters = new Map<string, StudentRow[]>();
  const rosterOn = (day: string) => {
    let r = rosters.get(day);
    if (!r) rosters.set(day, (r = rosterRowsOn(ctx.db, scope.cls.id, day).map((x) => x.student)));
    return r;
  };
  return assignments.map((a) => {
    const marks = marksById.get(a.id)!;
    const { roster, extra } = expectedStudents(ctx.db, a, scope.cls.id, marks, rosterOn(a.dueOn));
    const kindOf = new Map(a.statusSetJson.map((s) => [s.key, s.kind as Kind]));
    const labelOf = new Map(a.statusSetJson.map((s) => [s.key, s.label]));
    const expected = [...roster, ...extra].filter((s) => ids.has(s.id));
    const statuses = expected.map((s) => {
      const st = marks.get(s.id)?.status ?? NOT_CHECKED;
      return { student: s, key: st, kind: (st === NOT_CHECKED ? 'not_checked' : (kindOf.get(st) ?? 'other')) as Kind, label: labelOf.get(st) ?? null };
    });
    return { a, statuses };
  });
}

export function homeworkSection(ctx: RequestContext, scope: ReportScope): ReportSectionData {
  const rows = marksFor(ctx, scope);
  const expectedTotal = rows.reduce((t, r) => t + r.statuses.length, 0);
  const checked = rows.reduce((t, r) => t + r.statuses.filter((s) => s.kind !== 'not_checked').length, 0);
  const tally = (list: Array<{ kind: Kind }>, k: Kind) => list.filter((s) => s.kind === k).length;
  const byStudent = scope.students.map((s) => {
    const mine = rows.flatMap((r) => r.statuses.filter((x) => x.student.id === s.id));
    return { s, mine };
  });
  const outstanding = rows.flatMap((r) => r.statuses.filter((x) => OUTSTANDING.has(x.kind)).map((x) => ({ r, x })));
  return {
    key: 'homework',
    title: key('report.section.homework'),
    intro: key('report.homework.intro'),
    metrics: [
      { key: 'assignments', label: key('report.homework.assignmentsDue'), cell: n(rows.length) },
      { key: 'checked', label: key('report.homework.checked'), cell: n(checked, expectedTotal) },
      { key: 'outstanding', label: key('report.homework.outstanding'), cell: n(outstanding.length, expectedTotal) },
    ],
    tables: [
      table({
        key: 'assignments',
        title: key('report.homework.byAssignment'),
        columns: [col('title', key('report.col.assignment')), col('due', key('report.col.dueOn')), col('expected', key('report.col.expected'), true), ...KINDS.map((k) => col(k, key(kindKey(k)), true))],
        rows: rows.map(({ a, statuses }) => ({ key: a.id, cells: [lbl(raw(a.title)), date(a.dueOn), n(statuses.length), ...KINDS.map((k) => n(tally(statuses, k), statuses.length))] })),
        chart: { kind: 'bar', labelColumn: 'title', valueColumns: ['completed', 'missing', 'not_checked'] },
      }),
      table({
        key: 'students',
        title: key('report.homework.byStudent'),
        columns: [col('student', key('report.col.student')), col('expected', key('report.col.expected'), true), ...KINDS.map((k) => col(k, key(kindKey(k)), true))],
        rows: byStudent.map(({ s, mine }) => ({ key: s.id, cells: [student(s), n(mine.length), ...KINDS.map((k) => n(tally(mine, k), mine.length))] })),
      }),
      table({
        key: 'outstanding',
        title: key('report.homework.outstandingList'),
        note: key('report.homework.outstandingNote'),
        columns: [col('student', key('report.col.student')), col('title', key('report.col.assignment')), col('due', key('report.col.dueOn')), col('status', key('report.col.status'))],
        rows: outstanding.map(({ r, x }) => ({ key: `${r.a.id}|${x.student.id}`, cells: [student(x.student), lbl(raw(r.a.title)), date(r.a.dueOn), lbl(x.label ? text(x.label) : key(kindKey(x.kind)))] })),
      }),
    ],
    notes: [key('report.homework.notCheckedNote')],
  };
}

export function homeworkTimeline(ctx: RequestContext, scope: ReportScope, studentId: string): TimelineEvent[] {
  return marksFor(ctx, scope).flatMap(({ a, statuses }) =>
    statuses
      .filter((s) => s.student.id === studentId)
      .map((s) => ({ date: a.dueOn, at: null, module: 'homework' as const, what: key('report.timeline.homework', { title: a.title }), detail: s.label ? text(s.label) : key(kindKey(s.kind)) })),
  );
}
