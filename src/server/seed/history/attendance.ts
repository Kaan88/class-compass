/**
 * Attendance history (module 'attendance'): the daily register is taken in the first lesson of the
 * day ('lesson.start' attendance + everyone else present). Most children are present; a few are
 * absent, late or excused; one or two per class have a sick week; now and then a child marked
 * absent arrives during the lesson (then 'late'), or leaves one lesson for the nurse (exception).
 */
import { dailyFor } from '../../modules/attendance/service.ts';
import type { ContextPlan, HistoryGenerator, HistoryRun } from './types.ts';

const KEY = 'attendance';
type Planned = 'absent' | 'late' | 'excused' | 'arrivesLate';

/** The fictional register of one class for every history day (deterministic). */
function classRegister(h: HistoryRun, plan: ContextPlan): Map<string, Map<string, Planned>> {
  const all = h.memo(`${KEY}:register`, () => new Map<string, Map<string, Map<string, Planned>>>());
  const known = all.get(plan.cls.id);
  if (known) return known;
  const days = h.weeks.flatMap((w) => w.days);
  const reg = new Map<string, Map<string, Planned>>(days.map((d) => [d, new Map()]));
  const ids = plan.students.map((s) => s.id);
  // One or two children with a sick week (three to five school days in a row).
  const sick = ids.length >= 10 ? h.shuffle(ids).slice(0, h.int(1, 2)) : ids.length >= 3 && h.chance(0.5) ? [h.pick(ids)] : [];
  for (const id of sick) {
    const start = h.int(Math.min(1, days.length - 1), Math.max(0, days.length - 6));
    const len = h.int(3, 5);
    for (const d of days.slice(start, start + len)) reg.get(d)!.set(id, 'absent');
    h.count(KEY, 'sick weeks');
  }
  // One child in bigger classes who is often late.
  const oftenLate = ids.length >= 15 ? h.pick(ids) : null;
  for (const d of days) {
    const day = reg.get(d)!;
    for (const id of ids) {
      if (day.has(id)) continue;
      const r = h.rand();
      if (r < 0.025) day.set(id, 'absent');
      else if (r < 0.03) day.set(id, 'excused');
      else if (r < 0.04) day.set(id, 'arrivesLate');
      else if (r < (id === oftenLate ? 0.16 : 0.065)) day.set(id, 'late');
    }
  }
  all.set(plan.cls.id, reg);
  return reg;
}

export const attendanceGenerator: HistoryGenerator = {
  key: KEY,
  module: 'attendance',
  startInput(h, plan, date) {
    // Daily attendance is shared by the class: only the first lesson of the day takes the register.
    if (dailyFor(h.deps.db, plan.cls.id, date).size > 0) return { othersPresent: true };
    const planned = classRegister(h, plan).get(date) ?? new Map<string, Planned>();
    const entries = [...planned].map(([studentId, s]) => ({ studentId, status: s === 'arrivesLate' ? ('absent' as const) : s }));
    const late = [...planned].filter(([, s]) => s === 'arrivesLate').map(([id]) => id);
    if (late.length) h.memo(`${KEY}:arrivals`, () => new Map<string, string[]>()).set(`${plan.cls.id}:${date}`, late);
    h.count(KEY, 'registers taken');
    h.count(KEY, 'non-present entries', entries.length);
    return { attendance: entries, othersPresent: true };
  },
  duringLesson(h, lesson) {
    const ref = { contextId: lesson.plan.context.id, lessonId: lesson.lessonId };
    const arrivals = h.memo(`${KEY}:arrivals`, () => new Map<string, string[]>());
    const key = `${lesson.plan.cls.id}:${lesson.date}`;
    for (const studentId of arrivals.get(key) ?? []) {
      h.during(lesson, 0.12);
      h.command(lesson.plan.ctx, 'attendance.setDaily', { ...ref, studentId, status: 'late' });
      h.count(KEY, 'arrived during the lesson');
    }
    arrivals.delete(key);
    if (h.chance(0.03)) {
      const here = h.present(lesson);
      if (here.length > 1) {
        h.during(lesson, 0.6);
        h.command(lesson.plan.ctx, 'attendance.setLessonException', { ...ref, studentId: h.pick(here), status: 'excused' });
        h.count(KEY, 'lesson exceptions');
      }
    }
  },
};
