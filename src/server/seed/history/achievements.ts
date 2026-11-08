/**
 * Achievements history (module 'achievements', S13c, D-121, D-122): each teacher makes a few badges of
 * their own. In the last full week every class+subject chooses "award past achievements quietly", so
 * the rule engine backfills the badges the history earned so far (quiet, no celebration), and from
 * then on the automatic badges follow the students' activity (goals, evidence, homework, assistant,
 * Secret Students, Super Speakers) through the real activity hook. Teachers give about 40 manual
 * badges over the weeks: in class through the outbox command (celebrated on the display; one mis-tap
 * undone at once) and from the teacher area; one mistaken award is revoked later with a reason. One
 * class shows the End Lesson "Well done!" moment.
 */
import type { AchievementTier, BadgeIcon } from '../../../shared/achievements.ts';
import { classroomAchievements, createAchievement, revokeAward, setAchievementSettings, startAchievements, teacherAward } from '../../../shared/contracts/achievements.ts';
import * as svc from '../../modules/achievements/service.ts';
import type { ContextPlan, HistoryGenerator, HistoryRun, LessonRun } from './types.ts';

const KEY = 'achievements';
/** Manual awards wanted over the whole history (about; each event gives one or two students a badge). */
const MANUAL_TARGET = 40;

interface CustomBadge {
  name: { en: string; tr: string };
  description: { en: string; tr: string };
  icon: BadgeIcon;
  tier: AchievementTier;
  rule?: { event: 'reflection' | 'homework_completed'; threshold: number };
}

/** Fictional badges the demo teachers make for themselves: the English teacher's, and one for mathematics. */
const CUSTOM_BADGES: Record<string, CustomBadge[]> = {
  english: [
    { name: { en: 'Song star', tr: 'Şarkı yıldızı' }, description: { en: 'Sang the English song with the class.', tr: 'İngilizce şarkıyı sınıfla birlikte söyledi.' }, icon: 'musicNote', tier: 'none' },
    { name: { en: 'Story teller', tr: 'Hikâye anlatıcısı' }, description: { en: 'Told a short story in English.', tr: 'İngilizce kısa bir hikâye anlattı.' }, icon: 'bookOpen', tier: 'none' },
    {
      name: { en: 'Thinking cap', tr: 'Düşünce şapkası' },
      description: { en: 'Write 3 reflections.', tr: '3 düşünce yaz.' },
      icon: 'bulb',
      tier: 'bronze',
      rule: { event: 'reflection', threshold: 3 },
    },
  ],
  mathematics: [{ name: { en: 'Number ninja', tr: 'Sayı ustası' }, description: { en: 'Solved a tricky number problem.', tr: 'Zor bir sayı problemini çözdü.' }, icon: 'puzzle', tier: 'none' }],
};

const MISTAKE_REASON = 'Given to the wrong student by mistake.';

interface State {
  /** Manual award ids per context (for the one revoke). */
  awards: Map<string, string[]>;
  revoked: boolean;
  undone: boolean;
  totalLessons: number;
  /** Lessons seen so far and manual awards given so far (to pace the awards over the weeks). */
  seen: number;
  given: number;
}
const stateOf = (h: HistoryRun) =>
  h.memo<State>(`${KEY}:state`, () => ({ awards: new Map(), revoked: false, undone: false, totalLessons: h.plans.reduce((n, p) => n + p.lessonDates.length, 0), seen: 0, given: 0 }));

/** Behind the pace of about MANUAL_TARGET manual awards spread evenly over the history's lessons. */
const behind = (s: State) => s.given < (MANUAL_TARGET * s.seen) / Math.max(1, s.totalLessons) - 1;

/**
 * The week in which the classes switch automatic badges on (the backfill): the last full week before
 * this one. The backfill covers most of the history in one pass; the live rule engine (every activity
 * re-evaluates the student) runs only for the last days, because it is the costly part of the run.
 */
const startWeek = (h: HistoryRun) => Math.max(0, h.weeks.length - 2);

function remember(h: HistoryRun, plan: ContextPlan, ids: readonly string[]) {
  const s = stateOf(h);
  s.awards.set(plan.context.id, [...(s.awards.get(plan.context.id) ?? []), ...ids]);
}

function manualBadges(h: HistoryRun, plan: ContextPlan, lessonId?: string) {
  return h.call(classroomAchievements, svc.classroomView, plan.ctx, { contextId: plan.context.id, ...(lessonId ? { lessonId } : {}) }).badges;
}

export const achievementsGenerator: HistoryGenerator = {
  key: KEY,
  module: 'achievements',
  setup(h, plan) {
    // A few badges of the teachers' own: once per subject, English ones by the English teacher only.
    const done = h.memo(`${KEY}:custom`, () => new Set<string>());
    if (!done.has(plan.subject) && (plan.subject !== 'english' || plan.teacher.login === 'english')) {
      done.add(plan.subject);
      for (const b of CUSTOM_BADGES[plan.subject] ?? []) {
        h.call(createAchievement, svc.createDef, plan.ctx, {
          contextId: plan.context.id,
          name: b.name,
          description: b.description,
          icon: b.icon,
          tier: b.tier,
          kind: b.rule ? 'auto' : 'manual',
          ...(b.rule ? { rule: b.rule } : {}),
        });
        h.count(KEY, b.rule ? 'custom automatic badges' : 'custom badges');
      }
    }
    // One class shows the End Lesson "Well done!" moment for new automatic badges.
    const wellDone = h.memo(`${KEY}:wellDone`, () => ({ set: false }));
    if (!wellDone.set && plan.subject === 'english' && plan.teacher.login === 'english') {
      wellDone.set = true;
      h.call(setAchievementSettings, svc.setSettings, plan.ctx, { contextId: plan.context.id, announce: 'endOfLesson' });
      h.count(KEY, 'classes with "Well done!"');
    }
  },
  startOfWeek(h, plan, week) {
    if (week.index !== startWeek(h)) return;
    // Monday before school: "award past achievements quietly" (the S13c backfill over the history so far).
    h.setTime(h.at(week.days[0]!, '07:45') + h.int(0, 20) * 60_000);
    const r = h.call(startAchievements, svc.start, plan.ctx, { contextId: plan.context.id, mode: 'quiet' });
    h.count(KEY, 'classes started (quiet backfill)');
    h.count(KEY, 'badges backfilled quietly', r.awarded);
  },
  duringLesson(h, lesson: LessonRun) {
    const s = stateOf(h);
    const plan = lesson.plan;
    s.seen++;
    // About MANUAL_TARGET awards in all: about half in class (celebrated on the display), the rest in the teacher area.
    if (!behind(s) || !h.chance(0.5)) return;
    const present = h.present(lesson);
    const badges = manualBadges(h, plan, lesson.lessonId);
    if (!present.length || !badges.length) return;
    h.during(lesson, 0.5 + h.rand() * 0.4);
    const studentIds = h.shuffle(present).slice(0, h.chance(0.2) ? 2 : 1);
    const r = h.command(plan.ctx, 'achievements.award', { contextId: plan.context.id, lessonId: lesson.lessonId, achievementId: h.pick(badges).id, studentIds });
    const ids = (r.result as { awardIds: string[] }).awardIds;
    // Once, a mis-tap is undone straight away (within the 10-minute classroom undo).
    if (!s.undone && ids.length) {
      s.undone = true;
      h.setTime(h.now() + 40_000);
      h.command(plan.ctx, 'achievements.undo', { contextId: plan.context.id, lessonId: lesson.lessonId, awardIds: ids });
      h.count(KEY, 'undone in class (mis-tap)', ids.length);
      return;
    }
    remember(h, plan, ids);
    s.given += ids.length;
    h.count(KEY, 'manual badges in class (celebrated)', ids.length);
  },
  afterLesson(h, lesson) {
    const s = stateOf(h);
    const plan = lesson.plan;
    if (!behind(s)) return;
    const badges = manualBadges(h, plan);
    if (!badges.length || !plan.students.length) return;
    h.setTime(h.now() + h.int(5, 90) * 60_000);
    const studentIds = h.shuffle(plan.students.map((x) => x.id)).slice(0, h.chance(0.2) ? 2 : 1);
    const r = h.call(teacherAward, svc.teacherAward, plan.ctx, { contextId: plan.context.id, achievementId: h.pick(badges).id, studentIds });
    remember(
      h,
      plan,
      r.awards.map((a) => a.id),
    );
    s.given += r.awards.length;
    h.count(KEY, 'manual badges from the teacher area', r.awards.length);
  },
  endOfWeek(h, plan, week) {
    // A few weeks later, one award turns out to be a mistake: revoked with a reason (kept, never deleted).
    const s = stateOf(h);
    if (s.revoked || week.index < Math.min(4, h.weeks.length - 1)) return;
    const id = s.awards.get(plan.context.id)?.[0];
    if (!id) return;
    s.revoked = true;
    h.setTime(h.at(week.days[week.days.length - 1]!, '16:10'));
    h.call(revokeAward, svc.revoke, plan.ctx, { awardId: id, reason: MISTAKE_REASON });
    h.count(KEY, 'revoked (mistake)');
  },
};
