/**
 * Daily Assistant (S7): AST-1..6, DSH-3, LES-1/3, UX-5, D-063, D-065, D-066. Test clock: Monday
 * 2026-11-09, Europe/Istanbul. Fictional names chosen so Turkish and code-point order differ.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { cmd, endLesson, lessonState, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
const by: Record<string, string> = {};
// Turkish order: Can Uslu, Çağla Ak, Ilgaz Ok, Işıl Er, İrem Su (a code-point sort would put Ç and İ last).
const NAMES = ['İrem Su', 'Çağla Ak', 'Işıl Er', 'Can Uslu', 'Ilgaz Ok'];
const TURKISH_ORDER = ['Can Uslu', 'Çağla Ak', 'Ilgaz Ok', 'Işıl Er', 'İrem Su'];

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  for (const fullName of NAMES) by[fullName] = (await addStudent(s.teacherA, s.c3a.id, { fullName })).id;
});
afterEach(async () => env.app.close());

const ctxId = () => s.ctxA.id as string;
const plan = (weekStart?: string) => ok(s.teacherA.get(`/api/teacher/contexts/${ctxId()}/assistant/plan${weekStart ? `?weekStart=${weekStart}` : ''}`));
const names = (p: any) => p.days.map((d: any) => d.assistant?.fullName ?? null);
async function goTo(date: string) {
  env.clock.t = Date.parse(`${date}T07:00:00Z`); // 10:00 in Istanbul
  await s.teacherA.login('ayse.teacher');
  await s.teacherB.login('mehmet.teacher');
}
const markDaily = (studentId: string, status: string, date: string) => ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/attendance`, { date, studentId, status }));

describe('weekly plan (AST-2, UX-5, D-063)', () => {
  it('first use plans the week Monday–Friday in fair, deterministic Turkish order', async () => {
    const st = await lessonState(s.teacherA, ctxId());
    expect(st.assistant).toMatchObject({ localDate: '2026-11-09', schoolDay: true, assistant: { fullName: 'Can Uslu' } });
    const p = await plan();
    expect(p.weekStart).toBe('2026-11-09');
    expect(p.days.map((d: any) => d.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
    expect(names(p)).toEqual(TURKISH_ORDER);
    expect(p.plan).toMatchObject({ announcedAt: null });
    // Another school with the same students added in another order plans exactly the same week (no randomness).
    const env2 = await makeEnv();
    try {
      const s2 = await buildSchool(env2);
      for (const fullName of [...NAMES].reverse()) await addStudent(s2.teacherA, s2.c3a.id, { fullName });
      const p2 = await ok(s2.teacherA.post(`/api/teacher/contexts/${s2.ctxA.id}/assistant/plan`, {}));
      expect(names(p2)).toEqual(TURKISH_ORDER);
    } finally {
      await env2.app.close();
    }
  });

  it('generating again returns the plan unchanged; regenerating needs confirmation and only changes future unchanged days', async () => {
    const first = await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan`, {}));
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ahmet Kaya' });
    expect(names(await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan`, {})))).toEqual(names(first)); // never silently
    expect((await s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan/regenerate`, { weekStart: '2026-11-09' })).status).toBe(400);
    const re = await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan/regenerate`, { weekStart: '2026-11-09', confirm: true }));
    expect(names(re)).toEqual(['Can Uslu', 'Ahmet Kaya', 'Çağla Ak', 'Ilgaz Ok', 'Işıl Er']); // today kept
    const audits = env.db.$client.prepare("select count(*) n from audit_events where action = 'assistant.plan_regenerate'").get();
    expect(audits).toEqual({ n: 1 });
  });

  it('an announced week never changes: regenerate is refused and new students do not move anyone', async () => {
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan`, {}));
    const announced = await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan/announce`, { weekStart: '2026-11-09' }));
    expect(announced.plan.announcedAt).toBe(env.clock.t);
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ahmet Kaya' });
    const r = await s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan/regenerate`, { weekStart: '2026-11-09', confirm: true });
    expect(r.status).toBe(409);
    expect(r.body.error.details.reason).toBe('PLAN_ANNOUNCED');
    await lessonState(s.teacherA, ctxId());
    await goTo('2026-11-11');
    await lessonState(s.teacherA, ctxId());
    expect(names(await plan('2026-11-09'))).toEqual(TURKISH_ORDER);
    // The classroom may show the announced week (names only, D-066).
    const week = await ok(s.teacherA.get(`/api/classroom/contexts/${ctxId()}/assistant/week?weekStart=2026-11-09`));
    expect(week.announced).toBe(true);
    expect(week.days.map((d: any) => d.assistant.fullName)).toEqual(TURKISH_ORDER);
    expect(Object.keys(week.days[0]).sort()).toEqual(['assistant', 'date', 'weekday']);
  });

  it('school days are configurable (Monday, Wednesday, Friday)', async () => {
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctxId()}/assistant/settings`, { schoolDays: [1, 3, 5] }));
    const p = await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan`, { weekStart: '2026-11-16' }));
    expect(p.days.map((d: any) => d.date)).toEqual(['2026-11-16', '2026-11-18', '2026-11-20']);
    expect(names(p)).toEqual(TURKISH_ORDER.slice(0, 3));
    // A day that is not a school day has no assistant.
    await goTo('2026-11-17');
    expect((await lessonState(s.teacherA, ctxId())).assistant).toMatchObject({ schoolDay: false, assistant: null });
  });

  it('the next week continues the rotation from the turns already taken', async () => {
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan`, {}));
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ahmet Kaya' }); // joins on Monday, after the week was planned
    const next = await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan`, { weekStart: '2026-11-16' }));
    expect(names(next)[0]).toBe('Ahmet Kaya'); // the only student without a turn yet
    expect(names(next).slice(1)).toEqual(TURKISH_ORDER.slice(0, 4));
  });
});

describe('one assistant per day (AST-1)', () => {
  it('two lessons on the same day share the same assistant; another class+subject has its own', async () => {
    const l1 = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    expect((await lessonState(s.teacherA, ctxId())).assistant.assistant.fullName).toBe('Can Uslu');
    await endLesson(s.teacherA, ctxId(), l1);
    await startLesson(s.teacherA, ctxId());
    expect((await lessonState(s.teacherA, ctxId())).assistant.assistant.fullName).toBe('Can Uslu');
    expect(env.db.$client.prepare('select count(*) n from assistant_assignments where context_id = ? and local_date = ?').get(ctxId(), '2026-11-09')).toEqual({ n: 1 });

    const maths = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.mehmet.id, classId: s.c3a.id, subjectId: s.maths.id }));
    const other = await lessonState(s.teacherB, maths.id);
    expect(other.assistant.assistant.fullName).toBe('Can Uslu'); // its own rotation, same fair start
    expect(env.db.$client.prepare('select count(*) n from assistant_assignments where local_date = ?').get('2026-11-09')).toEqual({ n: 2 });
  });
});

describe('absence (AST-4, AST-5, D-065)', () => {
  it("today's absent assistant swaps with the next planned student who is here: the absent student keeps a turn", async () => {
    await lessonState(s.teacherA, ctxId()); // plan the week
    const lessonId = await startLesson(s.teacherA, ctxId(), { attendance: [{ studentId: by['Can Uslu'], status: 'absent' }], othersPresent: true });
    expect(lessonId).toBeTruthy();
    expect((await lessonState(s.teacherA, ctxId())).assistant.assistant.fullName).toBe('Çağla Ak');
    const p = await plan();
    expect(p.days[0]).toMatchObject({ planned: { fullName: 'Can Uslu' }, actual: { fullName: 'Çağla Ak' }, status: 'replaced_absent', reason: 'absent' });
    expect(p.days[1]).toMatchObject({ planned: { fullName: 'Çağla Ak' }, actual: { fullName: 'Can Uslu' }, status: 'swapped', reason: 'carry_forward' });
    expect(names(p)).toEqual(['Çağla Ak', 'Can Uslu', 'Ilgaz Ok', 'Işıl Er', 'İrem Su']);
    const h = await ok(s.teacherA.get(`/api/teacher/contexts/${ctxId()}/assistant/history`));
    expect(h.days[0]).toMatchObject({ date: '2026-11-09', planned: { fullName: 'Can Uslu' }, actual: { fullName: 'Çağla Ak' }, status: 'replaced_absent' });
    expect(h.students.find((x: any) => x.student.fullName === 'Can Uslu')).toMatchObject({ turns: 0, missed: 1, nextDate: '2026-11-10' });
  });

  it('with nobody planned later the next fair student helps, and the absent student comes first next week', async () => {
    await lessonState(s.teacherA, ctxId());
    await goTo('2026-11-13'); // Friday: İrem is planned, nobody after her this week
    for (const n of NAMES) if (n !== 'İrem Su') await markDaily(by[n]!, 'present', '2026-11-13');
    await markDaily(by['İrem Su']!, 'excused', '2026-11-13');
    const st = await lessonState(s.teacherA, ctxId());
    expect(st.assistant.assistant.fullName).toBe('Can Uslu'); // everyone else has one turn; Can's was longest ago
    const next = await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan`, { weekStart: '2026-11-16' }));
    expect(names(next)[0]).toBe('İrem Su'); // her missed turn was not counted
  });

  it('absence recorded before the plan existed is handled on first use; a present assistant is never replaced', async () => {
    await markDaily(by['Can Uslu']!, 'absent', '2026-11-09');
    await markDaily(by['Çağla Ak']!, 'late', '2026-11-09');
    const st = await lessonState(s.teacherA, ctxId());
    expect(st.assistant.assistant.fullName).toBe('Çağla Ak');
    await markDaily(by['Çağla Ak']!, 'present', '2026-11-09');
    expect((await lessonState(s.teacherA, ctxId())).assistant.assistant.fullName).toBe('Çağla Ak');
  });
});

describe('swaps and overrides (AST-3, AST-5)', () => {
  it('records planned vs actual and refuses past days', async () => {
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan`, {}));
    const sw = await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/swap`, { dateA: '2026-11-11', dateB: '2026-11-12' }));
    expect(sw.days[2]).toMatchObject({ planned: { fullName: 'Ilgaz Ok' }, actual: { fullName: 'Işıl Er' }, assistant: { fullName: 'Işıl Er' }, status: 'swapped', reason: 'teacher_swap' });
    expect(sw.days[3]).toMatchObject({ planned: { fullName: 'Işıl Er' }, actual: { fullName: 'Ilgaz Ok' }, status: 'swapped' });
    const ov = await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/override`, { date: '2026-11-13', studentId: by['Can Uslu'], reason: 'Birthday' }));
    expect(ov.days[4]).toMatchObject({ planned: { fullName: 'İrem Su' }, actual: { fullName: 'Can Uslu' }, status: 'override', reason: 'Birthday' });
    const past = await s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/swap`, { dateA: '2026-11-06', dateB: '2026-11-12' });
    expect(past.body.error.details.reason).toBe('DAY_IN_PAST');
    const outsider = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Selin Kar' });
    const wrong = await s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/override`, { date: '2026-11-13', studentId: outsider.id });
    expect(wrong.body.error.details.reason).toBe('STUDENT_NOT_IN_CLASS');
    // Teacher-area only: another teacher cannot touch this rota (ACC-10).
    expect((await s.teacherB.post(`/api/teacher/contexts/${ctxId()}/assistant/swap`, { dateA: '2026-11-11', dateB: '2026-11-12' })).status).toBe(403);
    const audits = env.db.$client.prepare("select action from audit_events where action in ('assistant.swap','assistant.override')").all();
    expect(audits).toHaveLength(2);
  });
});

describe('responsibilities and End Lesson thanks (AST-6, DSH-3, LES-3)', () => {
  it('seeds the four defaults in English and Turkish, edits keep history', async () => {
    const st = await ok(s.teacherA.get(`/api/teacher/contexts/${ctxId()}/assistant/settings`));
    expect(st.schoolDays).toEqual([1, 2, 3, 4, 5]);
    expect(st.responsibilities.map((r: any) => r.label.en)).toEqual(['Remind classmates to prepare their English materials', 'Help organise the classroom', 'Keep extra materials ready', 'Tell the teacher about problems']);
    expect(st.responsibilities.every((r: any) => r.label.tr)).toBe(true);
    const [a, , c] = st.responsibilities;
    const next = await ok(
      s.teacherA.put(`/api/teacher/contexts/${ctxId()}/assistant/settings`, {
        responsibilities: [{ id: c.id, label: c.label }, { id: a.id, label: { en: 'Hand out the books', tr: 'Kitapları dağıt' } }, { label: { en: 'Water the plants' } }],
      }),
    );
    expect(next.responsibilities.map((r: any) => r.label.en)).toEqual(['Keep extra materials ready', 'Hand out the books', 'Water the plants']);
    expect(env.db.$client.prepare('select count(*) n from assistant_responsibilities where archived_at is not null').get()).toEqual({ n: 2 });
    const today = await ok(s.teacherA.get(`/api/classroom/contexts/${ctxId()}/assistant/today`));
    expect(today.responsibilities).toHaveLength(3);
  });

  it('the optional thank-you at End Lesson confirms the turn', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    expect((await lessonState(s.teacherA, ctxId())).lesson.endSteps).toEqual(['secretStudents', 'assistantThanks', 'reflection']);
    await endLesson(s.teacherA, ctxId(), lessonId, { assistantThanks: { thanked: true } });
    const h = await ok(s.teacherA.get(`/api/teacher/contexts/${ctxId()}/assistant/history`));
    expect(h.days[0]).toMatchObject({ date: '2026-11-09', status: 'confirmed', thanked: true });
    expect((await ok(s.teacherA.get(`/api/classroom/contexts/${ctxId()}/assistant/today`))).thanked).toBe(true);
  });

  it('with the module off there is no assistant in the lesson state and no step', async () => {
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctxId()}/modules/assistant`, { enabled: false }));
    await startLesson(s.teacherA, ctxId());
    const st = await lessonState(s.teacherA, ctxId());
    expect(st.assistant).toBeNull();
    expect(st.lesson.endSteps).not.toContain('assistantThanks');
    expect((await s.teacherA.get(`/api/classroom/contexts/${ctxId()}/assistant/today`)).status).toBe(403);
    expect(env.db.$client.prepare('select count(*) n from assistant_assignments').get()).toEqual({ n: 0 });
  });
});

describe('archived years are read-only (DAT-1)', () => {
  it('reading the classroom in an archived year writes nothing', async () => {
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/archive`, {}));
    const st = await lessonState(s.teacherA, ctxId());
    expect(st.assistant).toMatchObject({ assistant: null });
    expect(env.db.$client.prepare('select count(*) n from assistant_assignments').get()).toEqual({ n: 0 });
    const r = await cmd(s.teacherA, 'lesson.start', { contextId: ctxId() });
    expect(r.ok).toBe(false);
  });
});

describe('review fixes: who missed the turn (AST-4, AST-5, D-068)', () => {
  const hist = () => ok(s.teacherA.get(`/api/teacher/contexts/${ctxId()}/assistant/history`));
  const missed = (h: any, name: string) => h.students.find((x: any) => x.student.fullName === name)?.missed;

  it('a swapped-in assistant who is absent gets the missed turn, not the planned student; a replacement who is also absent too', async () => {
    await lessonState(s.teacherA, ctxId()); // Mon Can, Tue Çağla, Wed Ilgaz, Thu Işıl, Fri İrem
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/swap`, { dateA: '2026-11-09', dateB: '2026-11-11' }));
    for (const n of NAMES) await markDaily(by[n]!, 'present', '2026-11-09');
    await markDaily(by['Ilgaz Ok']!, 'absent', '2026-11-09');
    let p = await plan();
    // Wednesday is no longer 'planned' (swapped), so Tuesday's Çağla takes today and Ilgaz takes Tuesday.
    expect(p.days[0]).toMatchObject({ planned: { fullName: 'Can Uslu' }, actual: { fullName: 'Çağla Ak' }, status: 'replaced_absent' });
    expect(p.days[1]).toMatchObject({ actual: { fullName: 'Ilgaz Ok' }, status: 'swapped', reason: 'carry_forward' });
    let h = await hist();
    expect(missed(h, 'Ilgaz Ok')).toBe(1);
    expect(missed(h, 'Can Uslu')).toBe(0);
    expect(h.days[0].absent.map((x: any) => x.fullName)).toEqual(['Ilgaz Ok']);

    await markDaily(by['Çağla Ak']!, 'excused', '2026-11-09');
    p = await plan();
    expect(p.days[0].assistant.fullName).toBe('Işıl Er'); // the next planned day still in class (Thursday)
    expect(p.days[3]).toMatchObject({ actual: { fullName: 'Çağla Ak' }, reason: 'carry_forward' });
    h = await hist();
    expect(missed(h, 'Ilgaz Ok')).toBe(1);
    expect(missed(h, 'Çağla Ak')).toBe(1);
    expect(missed(h, 'Can Uslu')).toBe(0);
    expect(h.days[0].absent.map((x: any) => x.fullName)).toEqual(['Ilgaz Ok', 'Çağla Ak']);
  });

  it('an override after an absence replacement keeps the missed turn', async () => {
    await lessonState(s.teacherA, ctxId());
    await markDaily(by['Can Uslu']!, 'absent', '2026-11-09');
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/override`, { date: '2026-11-09', studentId: by['İrem Su'] }));
    const h = await hist();
    expect(h.days[0]).toMatchObject({ status: 'override', actual: { fullName: 'İrem Su' } });
    expect(h.days[0].absent.map((x: any) => x.fullName)).toEqual(['Can Uslu']);
    expect(missed(h, 'Can Uslu')).toBe(1);
  });

  it('marking the assistant present again the same day gives the day back and undoes the carry-forward', async () => {
    await lessonState(s.teacherA, ctxId());
    await markDaily(by['Can Uslu']!, 'absent', '2026-11-09');
    expect((await lessonState(s.teacherA, ctxId())).assistant.assistant.fullName).toBe('Çağla Ak');
    await markDaily(by['Can Uslu']!, 'present', '2026-11-09');
    const p = await plan();
    expect(p.days[0]).toMatchObject({ assistant: { fullName: 'Can Uslu' }, actual: null, status: 'planned' });
    expect(p.days[1]).toMatchObject({ assistant: { fullName: 'Çağla Ak' }, actual: null, status: 'planned' });
    expect(missed(await hist(), 'Can Uslu')).toBe(0);
    expect(env.db.$client.prepare("select count(*) n from audit_events where action = 'assistant.restore_after_absence'").get()).toEqual({ n: 1 });
    // Clearing the record ("not recorded") after a new mistake also restores.
    await markDaily(by['Can Uslu']!, 'excused', '2026-11-09');
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/attendance`, { date: '2026-11-09', studentId: by['Can Uslu'], status: null }));
    expect((await plan()).days[0]).toMatchObject({ assistant: { fullName: 'Can Uslu' }, status: 'planned' });
  });

  it('a correction does not undo a day the teacher thanked in the meantime', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    await lessonState(s.teacherA, ctxId()); // plan the week
    await markDaily(by['Can Uslu']!, 'absent', '2026-11-09');
    await endLesson(s.teacherA, ctxId(), lessonId, { assistantThanks: { thanked: true } });
    await markDaily(by['Can Uslu']!, 'present', '2026-11-09');
    const p = await plan();
    expect(p.days[0]).toMatchObject({ assistant: { fullName: 'Çağla Ak' }, status: 'replaced_absent' });
    expect(p.days[1]).toMatchObject({ assistant: { fullName: 'Can Uslu' }, reason: 'carry_forward' });
  });
});

describe('review fixes: roster changes after planning (AST-1, AST-2, D-068)', () => {
  it('a student who leaves mid-week is no longer shown; today and later days get someone in the class', async () => {
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan`, {}));
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan/announce`, { weekStart: '2026-11-09' }));
    // Ilgaz (Wednesday) moves to 3-B from Wednesday; Can (today) moves today.
    await ok(s.admin.post('/api/admin/students/move', { studentIds: [by['Ilgaz Ok']], toClassId: s.c3b.id, date: '2026-11-11' }));
    await ok(s.admin.post('/api/admin/students/move', { studentIds: [by['Can Uslu']], toClassId: s.c3b.id, date: '2026-11-09' }));
    const st = await lessonState(s.teacherA, ctxId());
    expect(st.assistant.assistant).not.toBeNull();
    expect(st.assistant.assistant.fullName).not.toBe('Can Uslu');
    const p = await plan();
    expect(p.days[0]).toMatchObject({ planned: { fullName: 'Can Uslu' }, status: 'replaced_absent', reason: 'not_in_class' });
    expect(names(p)).not.toContain('Ilgaz Ok');
    expect(names(p)).not.toContain('Can Uslu');
    expect(names(p).every((n: string | null) => n !== null)).toBe(true);
    const week = await ok(s.teacherA.get(`/api/classroom/contexts/${ctxId()}/assistant/week`));
    expect(week.days.map((d: any) => d.assistant?.fullName)).not.toContain('Ilgaz Ok');
    // Leaving is not a missed turn.
    const h = await ok(s.teacherA.get(`/api/teacher/contexts/${ctxId()}/assistant/history`));
    expect(h.days[0].absent).toEqual([]);
  });

  it('a week planned while the class had no students is filled once students are added', async () => {
    const env2 = await makeEnv();
    try {
      const s2 = await buildSchool(env2);
      const ctx2 = s2.ctxA.id as string;
      expect((await lessonState(s2.teacherA, ctx2)).assistant).toMatchObject({ schoolDay: true, assistant: null });
      for (const fullName of NAMES) await addStudent(s2.teacherA, s2.c3a.id, { fullName });
      expect((await lessonState(s2.teacherA, ctx2)).assistant.assistant.fullName).toBe('Can Uslu');
      const p = await ok(s2.teacherA.get(`/api/teacher/contexts/${ctx2}/assistant/plan`));
      expect(names(p)).toEqual(TURKISH_ORDER);
    } finally {
      await env2.app.close();
    }
  });
});

describe('review fixes: the classroom sees only the announced week (AST-2, D-066, D-068, PIN-8)', () => {
  it('a draft shows no names; past and far weeks are refused; next week only once announced', async () => {
    await lessonState(s.teacherA, ctxId()); // this week planned, not announced
    const draft = await ok(s.teacherA.get(`/api/classroom/contexts/${ctxId()}/assistant/week`));
    expect(draft).toMatchObject({ weekStart: '2026-11-09', announced: false, days: [] });
    const raw = JSON.stringify(draft);
    for (const n of NAMES) expect(raw).not.toContain(n);
    const past = await s.teacherA.get(`/api/classroom/contexts/${ctxId()}/assistant/week?weekStart=2026-11-02`);
    expect(past.status).toBe(403);
    expect(past.body.error.details.reason).toBe('WEEK_NOT_IN_CLASSROOM');
    expect((await s.teacherA.get(`/api/classroom/contexts/${ctxId()}/assistant/week?weekStart=2026-11-23`)).status).toBe(403);
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan`, { weekStart: '2026-11-16' }));
    expect((await ok(s.teacherA.get(`/api/classroom/contexts/${ctxId()}/assistant/week?weekStart=2026-11-16`))).days).toEqual([]);
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctxId()}/assistant/plan/announce`, { weekStart: '2026-11-16' }));
    expect((await ok(s.teacherA.get(`/api/classroom/contexts/${ctxId()}/assistant/week?weekStart=2026-11-16`))).days).toHaveLength(5);
    // Next Monday, the old week is history (teacher area only).
    await goTo('2026-11-16');
    expect((await s.teacherA.get(`/api/classroom/contexts/${ctxId()}/assistant/week?weekStart=2026-11-09`)).status).toBe(403);
  });
});
