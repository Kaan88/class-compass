/**
 * Goals history (module 'goals', GOL-1..6): teachers set goals (preset and their own words) in the
 * first week; children add their own goals; every week children write self-assessments (confidence
 * mostly rising), reflections, notes and text or link evidence on their personal page, and
 * teachers add progress notes, outcomes every few weeks, feedback, private notes and evidence.
 * Some goals are achieved and replaced by a new one; one is archived.
 *
 * Student-side work is done once per class+subject (`primaryForSubject`); a second teacher of the
 * same subject in the class (3-A English) does a lighter share of the teacher-side work.
 */
import type { GoalOutcome } from '../../../shared/contracts/goals.ts';
import {
  GOAL_OUTCOMES,
  createPreset as createPresetEp,
  goalLibrary,
  studentAddEntry,
  studentAddEvidence,
  studentCreateGoal,
  studentUpdateGoal,
  teacherAddEvidence,
  teacherAddFeedback,
  teacherAddPrivateNote,
  teacherAddProgress,
  teacherAssessGoal,
  teacherCreateGoal,
  teacherUpdateGoal,
} from '../../../shared/contracts/goals.ts';
import { addDays } from '../../../domain/dates.ts';
import * as student from '../../modules/goals/student.ts';
import * as teacher from '../../modules/goals/teacher.ts';
import {
  LINK_EVIDENCE,
  LINK_TITLES,
  PRACTICE_CHOICES,
  PRIVATE_NOTES,
  REFLECTIONS,
  STUDENT_GOALS,
  STUDENT_NOTES,
  SUBJECT_CATEGORIES,
  TEACHER_EVIDENCE,
  TEACHER_FEEDBACK,
  TEACHER_PROGRESS,
  TEXT_EVIDENCE,
} from './text.ts';
import type { ContextPlan, HistoryGenerator, HistoryRun, HistoryWeek } from './types.ts';

const KEY = 'goals';

interface GoalState {
  id: string;
  studentId: string;
  subjectId: string;
  classId: string;
  author: 'teacher' | 'student';
  confidence: number | null;
  step: number;
  status: 'active' | 'achieved' | 'archived';
}

interface Library {
  categories: string[];
  presets: Array<{ id: string; categoryId: string }>;
}

const goalsOf = (h: HistoryRun) => h.memo(`${KEY}:goals`, () => [] as GoalState[]);
const bank = <T,>(m: Record<string, T[]>, subject: string): T[] => m[subject] ?? m.other!;

/** Categories and presets of the subject (the defaults for English, the subject's own otherwise). */
function libraryOf(h: HistoryRun, plan: ContextPlan): Library {
  const cache = h.memo(`${KEY}:library`, () => new Map<string, Library>());
  const known = cache.get(plan.context.id);
  if (known) return known;
  const lib = h.call(goalLibrary, (ctx, i) => teacher.library(ctx, i.contextId), plan.ctx, { contextId: plan.context.id });
  const own = lib.categories.filter((c) => !c.archived && c.custom);
  const cats = (plan.subject === 'english' || !own.length ? lib.categories.filter((c) => !c.archived && !c.custom) : own).map((c) => c.id);
  const out = { categories: cats, presets: lib.presets.filter((p) => !p.archived && cats.includes(p.categoryId)).map((p) => ({ id: p.id, categoryId: p.categoryId })) };
  cache.set(plan.context.id, out);
  return out;
}

/** Spread the week's work over its days: `n`-th action at an evening time of one of the days. */
function studentTime(h: HistoryRun, week: HistoryWeek) {
  h.setTime(h.at(h.pick(week.days), h.pick(['16:30', '17:15', '18:00', '19:10', '20:05'])) + h.int(0, 40) * 60_000);
}
function teacherTime(h: HistoryRun, week: HistoryWeek) {
  h.setTime(h.at(week.days[week.days.length - 1]!, '15:40') + h.int(0, 80) * 60_000);
}

function teacherGoal(h: HistoryRun, plan: ContextPlan, studentId: string, lib: Library) {
  const own = h.chance(0.3);
  const preset = lib.presets.length && !own ? h.pick(lib.presets) : null;
  const categoryId = preset?.categoryId ?? h.pick(lib.categories);
  const g = h.call(teacherCreateGoal, teacher.createGoal, plan.ctx, {
    contextId: plan.context.id,
    studentId,
    categoryId,
    ...(preset ? { presetId: preset.id } : { text: h.pick(bank(STUDENT_GOALS, plan.subject)) }),
    ...(h.chance(0.4) ? { practiceChoices: h.shuffle(bank(PRACTICE_CHOICES, plan.subject)).slice(0, 2) } : {}),
    reviewOn: h.chance(0.7) ? addDays(plan.lessonDates[0] ?? h.from, 35) : null,
  });
  goalsOf(h).push({ id: g.id, studentId, subjectId: plan.context.subjectId, classId: plan.cls.id, author: 'teacher', confidence: null, step: -1, status: 'active' });
  h.count(KEY, preset ? 'teacher goals (preset)' : 'teacher goals (own words)');
}

function studentWeek(h: HistoryRun, plan: ContextPlan, week: HistoryWeek, lib: Library) {
  const subjectId = plan.context.subjectId;
  for (const s of plan.students) {
    const ctx = h.student(s.id);
    if (week.index === 1 && h.chance(0.4)) {
      studentTime(h, week);
      const usePreset = lib.presets.length > 0 && h.chance(0.4);
      const preset = usePreset ? h.pick(lib.presets) : null;
      const g = h.call(studentCreateGoal, student.createGoal, ctx, preset ? { subjectId, presetId: preset.id } : { subjectId, categoryId: h.pick(lib.categories), text: h.pick(bank(STUDENT_GOALS, plan.subject)) });
      goalsOf(h).push({ id: g.id, studentId: s.id, subjectId, classId: plan.cls.id, author: 'student', confidence: null, step: -1, status: 'active' });
      h.count(KEY, preset ? 'student goals (preset)' : 'student goals (own words)');
    }
    if (week.index === 0) continue;
    const mine = goalsOf(h).filter((g) => g.studentId === s.id && g.subjectId === subjectId && g.status === 'active');
    for (const g of mine) {
      if (h.chance(0.45)) {
        studentTime(h, week);
        const r = h.rand();
        g.confidence = g.confidence === null ? h.int(1, 3) : Math.max(1, Math.min(5, g.confidence + (r < 0.5 ? 1 : r < 0.6 ? -1 : 0)));
        h.call(studentAddEntry, student.addEntry, ctx, { goalId: g.id, kind: 'self_assessment', body: h.pick(REFLECTIONS), confidence: g.confidence });
        h.count(KEY, 'self-assessments');
      }
      if (h.chance(0.25)) {
        studentTime(h, week);
        h.call(studentAddEntry, student.addEntry, ctx, { goalId: g.id, kind: 'reflection', body: h.pick(REFLECTIONS) });
        h.count(KEY, 'reflections');
      }
      if (h.chance(0.07)) {
        studentTime(h, week);
        h.call(studentAddEntry, student.addEntry, ctx, { goalId: g.id, kind: 'note', body: h.pick(STUDENT_NOTES) });
        h.count(KEY, 'notes');
      }
      if (g.author === 'student' && g.confidence === 5 && h.chance(0.5)) {
        studentTime(h, week);
        h.call(studentUpdateGoal, student.updateGoal, ctx, { goalId: g.id, status: 'achieved' });
        g.status = 'achieved';
        h.count(KEY, 'achieved by the student');
      }
    }
    if (h.chance(0.12)) {
      studentTime(h, week);
      const goal = mine.length && h.chance(0.7) ? h.pick(mine) : null;
      h.call(studentAddEvidence, student.addEvidence, ctx, { subjectId, kind: 'text', body: h.pick(TEXT_EVIDENCE), ...(goal ? { goalId: goal.id } : {}) });
      h.count(KEY, 'text evidence');
    }
    if (h.chance(0.06)) {
      studentTime(h, week);
      h.call(studentAddEvidence, student.addEvidence, ctx, { subjectId, kind: 'link', url: h.pick(LINK_EVIDENCE), body: h.chance(0.5) ? h.pick(LINK_TITLES) : undefined });
      h.count(KEY, 'link evidence');
    }
  }
}

function teacherWeek(h: HistoryRun, plan: ContextPlan, week: HistoryWeek, lib: Library) {
  const share = plan.primaryForSubject ? 1 : 0.3;
  const ids = new Set(plan.students.map((s) => s.id));
  const goals = goalsOf(h).filter((g) => g.subjectId === plan.context.subjectId && g.classId === plan.cls.id && ids.has(g.studentId) && g.status === 'active');
  for (const g of goals) {
    if (h.chance(0.2 * share)) {
      teacherTime(h, week);
      h.call(teacherAddProgress, teacher.addProgress, plan.ctx, { goalId: g.id, body: h.pick(TEACHER_PROGRESS) });
      h.count(KEY, 'progress notes');
    }
    if (week.index % 3 === 2 && h.chance(share)) {
      teacherTime(h, week);
      g.step = Math.min(GOAL_OUTCOMES.length - 1, g.step + (g.step < 0 || h.chance(0.6) ? 1 : 0));
      h.call(teacherAssessGoal, teacher.assess, plan.ctx, { goalId: g.id, outcome: GOAL_OUTCOMES[g.step] as GoalOutcome });
      h.count(KEY, 'outcomes recorded');
      if (g.step >= 2 && week.index >= 5 && h.chance(0.45)) {
        h.call(teacherUpdateGoal, teacher.updateGoal, plan.ctx, { goalId: g.id, status: 'achieved' });
        g.status = 'achieved';
        h.count(KEY, 'achieved (teacher)');
        if (!week.last && h.chance(0.5)) teacherGoal(h, plan, g.studentId, lib);
      }
    }
  }
  // One goal that no longer fits is archived (kept, hidden from the active list).
  const memo = h.memo(`${KEY}:archived`, () => new Set<string>());
  if (week.index === 4 && !memo.has(plan.context.id) && plan.primaryForSubject) {
    const g = goalsOf(h).find((x) => x.classId === plan.cls.id && x.subjectId === plan.context.subjectId && x.status === 'active' && x.author === 'teacher');
    if (g) {
      memo.add(plan.context.id);
      teacherTime(h, week);
      h.call(teacherUpdateGoal, teacher.updateGoal, plan.ctx, { goalId: g.id, status: 'archived' });
      g.status = 'archived';
      h.count(KEY, 'archived');
    }
  }
  for (const s of plan.students) {
    if (h.chance(0.12 * share)) {
      teacherTime(h, week);
      const own = goals.filter((g) => g.studentId === s.id);
      const goal = own.length && h.chance(0.5) ? h.pick(own) : null;
      h.call(teacherAddFeedback, teacher.addFeedback, plan.ctx, { contextId: plan.context.id, studentId: s.id, body: h.pick(TEACHER_FEEDBACK), ...(goal ? { goalId: goal.id } : {}) });
      h.count(KEY, 'feedback');
    }
    if (h.chance(0.04 * share)) {
      teacherTime(h, week);
      h.call(teacherAddPrivateNote, teacher.privateNote, plan.ctx, { contextId: plan.context.id, studentId: s.id, body: h.pick(PRIVATE_NOTES) });
      h.count(KEY, 'private notes');
    }
    if (h.chance(0.03 * share)) {
      teacherTime(h, week);
      h.call(teacherAddEvidence, teacher.addEvidence, plan.ctx, { contextId: plan.context.id, studentId: s.id, kind: 'text', body: h.pick(TEACHER_EVIDENCE) });
      h.count(KEY, 'teacher evidence');
    }
  }
}

export const goalsGenerator: HistoryGenerator = {
  key: KEY,
  module: 'goals',
  setup(h, plan) {
    // Preset goals for the subject's own categories (once per teacher and subject).
    const cats = SUBJECT_CATEGORIES[plan.subject];
    const done = h.memo(`${KEY}:presets`, () => new Set<string>());
    const key = `${plan.teacher.id}:${plan.context.subjectId}`;
    if (!cats || done.has(key)) return;
    done.add(key);
    const lib = h.call(goalLibrary, (ctx, i) => teacher.library(ctx, i.contextId), plan.ctx, { contextId: plan.context.id });
    for (const c of cats) {
      const cat = lib.categories.find((x) => x.custom && x.name.en === c.name.en);
      if (!cat) continue;
      h.call(createPresetEp, teacher.createPreset, plan.ctx, { contextId: plan.context.id, categoryId: cat.id, text: c.preset });
      h.count(KEY, 'preset goals');
    }
  },
  endOfWeek(h, plan, week) {
    const lib = libraryOf(h, plan);
    if (!lib.categories.length || !plan.students.length) return;
    if (week.index === 0) {
      const share = plan.primaryForSubject ? 0.55 : 0.15;
      for (const s of plan.students) {
        if (!h.chance(share)) continue;
        teacherTime(h, week);
        teacherGoal(h, plan, s.id, lib);
      }
    }
    if (plan.primaryForSubject) studentWeek(h, plan, week, lib);
    if (week.index > 0) teacherWeek(h, plan, week, lib);
  },
};
