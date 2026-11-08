/**
 * Homework history (module 'homework'): after about half of the lessons the teacher sets homework
 * due at the next lesson; on the due day it is checked (fast checking: the exceptions first, then
 * "mark all remaining" as completed), absent children are excused or left unchecked, and some
 * missing work comes in late afterwards. Work due after the history stays unchecked.
 */
import { createHomework as createHomeworkEp, markRemainingHomework, setHomeworkMarks } from '../../../shared/contracts/homework.ts';
import { createHomework, markRemaining, setMarks } from '../../modules/homework/service.ts';
import { HOMEWORK, HOMEWORK_NOTES } from './text.ts';
import type { ContextPlan, HistoryGenerator, HistoryRun, LessonRun } from './types.ts';

const KEY = 'homework';

interface Assignment {
  id: string;
  dueOn: string;
  missing: string[];
  lateChecked: boolean;
}

const assignments = (h: HistoryRun, plan: ContextPlan) => {
  const all = h.memo(`${KEY}:assignments`, () => new Map<string, Assignment[]>());
  let mine = all.get(plan.context.id);
  if (!mine) all.set(plan.context.id, (mine = []));
  return mine;
};

/** The next lesson day of this context after `date` by the weekly timetable (it may lie after the history). */
function nextLessonDay(h: HistoryRun, plan: ContextPlan, date: string): string {
  const later = plan.lessonDates.find((d) => d > date);
  if (later) return later;
  const d = new Date(`${date}T12:00:00Z`);
  for (let i = 0; i < 14; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (plan.timetable.has(iso)) return d.toISOString().slice(0, 10);
  }
  return h.to;
}

function check(h: HistoryRun, lesson: LessonRun, a: Assignment) {
  const ctx = lesson.plan.ctx;
  const here = new Set(h.present(lesson));
  const changes: Array<{ studentId: string; status: string; note?: string | null }> = [];
  for (const s of lesson.plan.students) {
    if (!here.has(s.id)) {
      if (h.chance(0.6)) changes.push({ studentId: s.id, status: 'excused' });
      continue;
    }
    const r = h.rand();
    if (r < 0.1) changes.push({ studentId: s.id, status: 'partly_completed' });
    else if (r < 0.19) changes.push({ studentId: s.id, status: 'missing', note: h.chance(0.3) ? 'Forgot the book at home.' : null });
  }
  if (changes.length) {
    h.call(setHomeworkMarks, setMarks, ctx, { assignmentId: a.id, changes });
    a.missing = changes.filter((c) => c.status === 'missing').map((c) => c.studentId);
  }
  // Present children still unchecked: usually all done; sometimes one or two are left for later.
  if (h.chance(0.9)) h.call(markRemainingHomework, markRemaining, ctx, { assignmentId: a.id, status: 'completed' });
  else {
    const rest = [...here].filter((id) => !changes.some((c) => c.studentId === id)).slice(2);
    if (rest.length) h.call(setHomeworkMarks, setMarks, ctx, { assignmentId: a.id, changes: rest.map((studentId) => ({ studentId, status: 'completed' })) });
  }
  h.count(KEY, 'assignments checked');
  h.count(KEY, 'marked missing', a.missing.length);
}

export const homeworkGenerator: HistoryGenerator = {
  key: KEY,
  module: 'homework',
  afterLesson(h, lesson) {
    const plan = lesson.plan;
    const mine = assignments(h, plan);
    h.setTime(lesson.endAt + h.int(3, 25) * 60_000);
    // Missing work from the last check that came in late.
    for (const a of mine.filter((x) => x.dueOn < lesson.date && !x.lateChecked && x.missing.length)) {
      a.lateChecked = true;
      const late = a.missing.filter(() => h.chance(0.5));
      if (late.length) {
        h.call(setHomeworkMarks, setMarks, plan.ctx, { assignmentId: a.id, changes: late.map((studentId) => ({ studentId, status: 'submitted_late' })) });
        h.count(KEY, 'handed in late', late.length);
      }
    }
    for (const a of mine.filter((x) => x.dueOn === lesson.date)) check(h, lesson, a);
    if (h.chance(0.5)) {
      const bank = HOMEWORK[plan.subject] ?? HOMEWORK.other!;
      const item = bank[(mine.length + h.int(0, 2)) % bank.length]!;
      const dueOn = nextLessonDay(h, plan, lesson.date);
      const created = h.call(createHomeworkEp, createHomework, plan.ctx, {
        contextId: plan.context.id,
        title: item.title,
        details: item.details ?? null,
        assignedOn: lesson.date,
        dueOn,
        notes: h.chance(0.15) ? h.pick(HOMEWORK_NOTES) : null,
      });
      mine.push({ id: created.id, dueOn, missing: [], lateChecked: false });
      h.count(KEY, 'assignments set');
    }
  },
};
