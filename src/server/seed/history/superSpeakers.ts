/**
 * Super Speakers history (school-wide module 'superSpeakers', S12, D-127..D-134): the administrator
 * switches the module on for the demo school on the first history day and makes one scorer link
 * ("Demo scorer", linked to the English teacher) and one board link. Then, every school day, the
 * scorer gives +1 points through the real `points.award` command on the backdated clock (a realistic
 * skew: a few keen speakers, most children now and then, every class some points each week); a few
 * points are taken back by the scorer within the undo window, and one is voided by the administrator
 * with a reason. Points are also given this week in school hours (earlier today, or after school on
 * this week's latest school day), so this week's board shows a podium once the week's school has begun. The points feed the Super Speakers badges through the activity hook (D-132).
 *
 * Link tokens are never printed or logged: the links are made through the admin service, which keeps
 * only the HMAC and the sealed copy (D-128).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { weekStartOf } from '../../../domain/counters.ts';
import { setModulePolicy as setModulePolicyEp } from '../../../shared/contracts/school.ts';
import { createDisplayLink, createScorerLink, voidAward } from '../../../shared/contracts/superSpeakers.ts';
import { pointEvents } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import { setModulePolicy } from '../../modules/school/service.ts';
import { adminVoid, buildBoard, createDisplay, createScorer, ensureSettings, getSettings, participants } from '../../modules/superSpeakers/service.ts';
import { isSchoolDay } from './calendar.ts';
import type { HistoryGenerator, HistoryRun } from './types.ts';

const KEY = 'superSpeakers';
const VOID_REASON = 'Given twice by mistake.';

interface State {
  scorer: RequestContext;
  /** Student id → weight (keen speakers are picked far more often), class id per student. */
  weights: Array<{ id: string; classId: string; weight: number }>;
  keen: string[];
  /** Live point ids of the last week (for the administrator's one void). */
  recent: string[];
  adminVoided: boolean;
}

const boxOf = (h: HistoryRun) => h.memo(`${KEY}:box`, () => ({ state: null as State | null }));

function weightedPick(h: HistoryRun, xs: State['weights']): State['weights'][number] {
  const total = xs.reduce((n, x) => n + x.weight, 0);
  let r = h.rand() * total;
  for (const x of xs) if ((r -= x.weight) < 0) return x;
  return xs[xs.length - 1]!;
}

/** Gives one point at time `at` (and, rarely, the scorer takes it back a minute later). */
function award(h: HistoryRun, s: State, studentId: string, at: number, mayUndo = true): void {
  h.setTime(at);
  const r = h.command(s.scorer, 'points.award', { studentId });
  const eventId = (r.result as { eventId: string }).eventId;
  h.count(KEY, 'points given');
  if (mayUndo && h.chance(0.025)) {
    h.setTime(at + h.int(20, 240) * 1000);
    h.command(s.scorer, 'points.voidOwn', { eventId });
    h.count(KEY, 'points taken back by the scorer');
  } else s.recent.push(eventId);
}

/** Sorted random instants between `from` and `to` (epoch ms). */
function instants(h: HistoryRun, n: number, from: number, to: number): number[] {
  return Array.from({ length: n }, () => from + Math.floor(h.rand() * (to - from))).sort((a, b) => a - b);
}

export const superSpeakersGenerator: HistoryGenerator = {
  key: KEY,
  module: 'superSpeakers',
  setupSchool(h) {
    const admin = h.admin;
    ensureSettings(h.deps.db, h.now());
    h.call(setModulePolicyEp, (ctx, i) => setModulePolicy(ctx, i.module, i.availability), admin, { module: 'superSpeakers', availability: 'enabled' });
    const english = h.plans.find((p) => p.teacher.login === 'english')?.teacher ?? null;
    const link = h.call(createScorerLink, createScorer, admin, { label: 'Demo scorer', locale: 'en', userId: english?.id ?? null });
    h.call(createDisplayLink, createDisplay, admin, { label: 'Hall screen' });
    h.count(KEY, 'links (scorer and board)', 2);
    const scorer: RequestContext = {
      ...admin,
      user: null,
      session: null,
      scorer: { scorerLinkId: link.id, userId: link.userId, label: link.label, locale: link.locale },
      actor: { type: 'scorer', id: link.id },
    };
    const people = participants(h.deps.db, h.now());
    const weights = people.map((p) => {
      const r = h.rand();
      return { id: p.student.id, classId: p.cls.id, weight: r < 0.1 ? 6 : r < 0.65 ? 1 : 0.25 };
    });
    const keen = weights.filter((w) => w.weight === 6).map((w) => w.id);
    boxOf(h).state = { scorer, weights, keen, recent: [], adminVoided: false };
  },
  endOfSchoolWeek(h, week) {
    const s = boxOf(h).state;
    if (!s || !s.weights.length) return;
    s.recent = [];
    const given = new Set<string>();
    for (const day of week.days) {
      const times = instants(h, h.int(4, 11), h.at(day, '08:35'), h.at(day, '15:30'));
      for (const at of times) {
        const who = weightedPick(h, s.weights);
        given.add(who.classId);
        award(h, s, who.id, at);
      }
    }
    // Every class gets some points each week.
    const lastDay = week.days[week.days.length - 1]!;
    for (const classId of new Set(s.weights.map((w) => w.classId))) {
      if (given.has(classId)) continue;
      award(h, s, h.pick(s.weights.filter((w) => w.classId === classId)).id, h.at(lastDay, '14:50') + h.int(0, 30) * 60_000, false);
    }
    // Once, the administrator voids a point given twice by mistake (with a reason, audited).
    if (!s.adminVoided && week.index >= Math.min(5, h.weeks.length - 1) && s.recent.length) {
      s.adminVoided = true;
      h.setTime(h.at(lastDay, '16:30'));
      h.call(voidAward, adminVoid, h.admin, { id: s.recent[s.recent.length - 1]!, reason: VOID_REASON });
      h.count(KEY, 'points voided by the administrator');
    }
  },
  finish(h) {
    const s = boxOf(h).state;
    if (!s || !s.weights.length) return;
    const db = h.deps.db;
    const weekStartsOn = getSettings(db).weekStartsOn;
    const weekStart = weekStartOf(h.realNow, h.tz, weekStartsOn);
    const latest = h.realNow - 60_000;
    // Points only in school hours: earlier today when today is a school day and school has started
    // (after 08:35), else after school on the latest school day of this week. Before the first school
    // day of the week has started (e.g. Monday 07:00, or a Monday holiday) nobody has scored yet, so
    // this week's board stays empty: points on last week's days would not show on it.
    const thisWeekDays = h.weeks.flatMap((w) => w.days).filter((d) => d >= weekStart);
    const lastDay = thisWeekDays[thisWeekDays.length - 1];
    let from: number;
    let to: number;
    if (isSchoolDay(h.today) && h.at(h.today, '08:35') < latest) [from, to] = [h.at(h.today, '08:30'), Math.min(latest, h.at(h.today, '15:30'))];
    else if (lastDay) [from, to] = [h.at(lastDay, '15:31'), h.at(lastDay, '15:59')];
    else return;
    if (to - from < 60_000) return;
    for (const at of instants(h, h.int(8, 14), from, to)) award(h, s, weightedPick(h, s.weights).id, at, false);
    // The board shows a podium of three places: when the totals so far do not give three different
    // ones, three keen speakers get the few extra points that make them first, second and third.
    const board = () => buildBoard(db, h.now());
    if (board().places.length < 3) {
      const totals = new Map(
        db
          .select({ id: pointEvents.studentId, n: sql<number>`count(*)` })
          .from(pointEvents)
          .where(and(eq(pointEvents.weekStart, weekStart), isNull(pointEvents.voidedAt)))
          .groupBy(pointEvents.studentId)
          .all()
          .map((r) => [r.id, r.n]),
      );
      const top = Math.max(0, ...totals.values());
      const three = [...new Set([...s.keen, ...s.weights.map((w) => w.id)])].slice(0, 3);
      const extra = three.map((id, i) => Math.max(0, top + 3 - i - (totals.get(id) ?? 0)));
      const all = three.flatMap((id, i) => Array.from({ length: extra[i]! }, () => id));
      const times = instants(h, all.length, from, to);
      all.forEach((id, i) => award(h, s, id, times[i]!, false));
    }
    h.setTime(latest);
    h.count(KEY, 'podium places this week', board().places.length);
  },
};
