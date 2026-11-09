/**
 * The classroom student card (S14e2, D-154; CRD-1, PIN-1, PIN-8, ACC-10, GRP-7, SEC-3) and the
 * student statistics drawer's class+subject list (RPT-6).
 * - `GET /api/classroom/contexts/:contextId/students/:studentId/card` is `classroom` access: it works
 *   while the teacher area is locked, only for the teacher's own class+subject and a student in the
 *   class today (404 otherwise, never 403: nothing is said about other classes);
 * - it carries positive items only (recent achievements, own Super Speakers points this week, days
 *   as the assistant this term, counters while the reminder boxes are on) and never attendance,
 *   homework, goals or notes, levels or Secret Student data (marker-string scan);
 * - switched-off modules add nothing.
 * Test clock: Monday 2026-11-09 Europe/Istanbul. Fictional names only.
 */
import { v7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultAchievementId } from '../../src/shared/achievements.ts';
import { ClassroomCardItem } from '../../src/shared/contracts/classroomCard.ts';
import { SERVER_MODULES } from '../../src/server/modules/index.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { cmd, lessonState, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

const SUNSHINE = defaultAchievementId('teacher.sunshine');
const SECRET_STAR = defaultAchievementId('secret.earned');
const MARK = 'ZQXMARKER';

let env: TestEnv;
let s: School;
let kids: Array<{ id: string; fullName: string }>;

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  kids = [];
  for (const fullName of ['Ada Yıldız', 'Bora Kaya', 'Cem Aksoy', 'Defne Şahin', 'Ece Çınar', 'Mert Doğan']) kids.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
});
afterEach(async () => env.app.close());

const card = (c: Client, studentId: string, contextId: string = s.ctxA.id) => c.get(`/api/classroom/contexts/${contextId}/students/${studentId}/card`);
const keys = (body: any) => (body.items as Array<{ key: string }>).map((i) => i.key);
const item = (body: any, key: string) => (body.items as Array<{ key: string; data: any }>).find((i) => i.key === key)?.data;

describe('classroom card access (D-154; PIN-1, PIN-8, ACC-10)', () => {
  it('answers with classroom-safe display fields only, also while the teacher area is locked', async () => {
    expect((await s.teacherA.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '2468' })).status).toBe(200);
    expect((await s.teacherA.post('/api/classroom/enter')).status).toBe(200);
    // Locked: the teacher area answers 423, the card still answers.
    expect((await s.teacherA.get(`/api/teacher/students/${kids[0]!.id}/report-contexts`)).status).toBe(423);
    const body = await ok(card(s.teacherA, kids[0]!.id));
    expect(Object.keys(body.student).sort()).toEqual(['avatarHue', 'fullName', 'id', 'initials']);
    expect(body.student).toMatchObject({ id: kids[0]!.id, fullName: 'Ada Yıldız', initials: 'AY' });
  });

  it('another teacher, another class, an unknown id and a student who left all get 404 (never 403)', async () => {
    const other = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Oya Demir' });
    expect((await card(s.teacherB, kids[0]!.id)).status).toBe(404); // ctxA belongs to Ayşe
    expect((await card(s.teacherA, other.id)).status).toBe(404); // not in 3-A
    expect((await card(s.teacherB, other.id, s.ctxB.id)).status).toBe(200);
    expect((await card(s.teacherA, '0190f0f0-0000-7000-8000-000000000000')).status).toBe(404);
    // An administrator account has no classroom (the access class refuses it before the card).
    expect((await card(s.admin, kids[0]!.id)).status).toBe(403);
    // Removed from the class today: no card any more.
    await ok(s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/students/${kids[5]!.id}/remove`, {}));
    expect((await card(s.teacherA, kids[5]!.id)).status).toBe(404);
  });
});

describe('classroom card items (D-154)', () => {
  it('recent achievements (newest first, never Secret Student ones), assistant days this term and counters while the boxes are on', async () => {
    const lessonId = await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
    // Today's assistant is planned on first use (AST-2); that student has one day this term.
    const st = await lessonState(s.teacherA, s.ctxA.id);
    const assistant = st.assistant.assistant as { id: string };
    expect(item(await ok(card(s.teacherA, assistant.id)), 'assistant')).toEqual({ days: 1 });
    const notAssistant = kids.find((k) => k.id !== assistant.id)!;
    expect(keys(await ok(card(s.teacherA, notAssistant.id)))).not.toContain('assistant');

    // Achievements: one given in class; a Secret Student one written directly is never shown.
    expect((await cmd(s.teacherA, 'achievements.award', { contextId: s.ctxA.id, lessonId, achievementId: SUNSHINE, studentIds: [kids[1]!.id] })).ok).toBe(true);
    env.db.$client
      .prepare("insert into student_achievements (id, student_id, achievement_id, context_id, awarded_at, source, name_snapshot, icon_snapshot, tier_snapshot, quiet) values (?, ?, ?, ?, ?, 'auto', ?, 'mask', 'bronze', 0)")
      .run(v7(), kids[1]!.id, SECRET_STAR, s.ctxA.id, env.clock.t + 1000, JSON.stringify({ en: 'Secret star', tr: 'Gizli yıldız' }));
    const bora = await ok(card(s.teacherA, kids[1]!.id));
    expect(item(bora, 'achievements').items.map((a: any) => a.name.en)).toEqual(['Ray of sunshine']);
    expect(item(bora, 'achievements').items[0]).toMatchObject({ icon: expect.any(String), tier: expect.any(String), awardedOn: '2026-11-09' });
    expect(JSON.stringify(bora)).not.toContain('Secret star');

    // Counters: the per-student count, the same number as the card's reminder box.
    const counter = st.counters.counters.find((c: any) => c.scope !== 'lesson');
    expect((await cmd(s.teacherA, 'counter.tap', { contextId: s.ctxA.id, lessonId, counterId: counter.id, studentId: kids[2]!.id })).ok).toBe(true);
    const cem = item(await ok(card(s.teacherA, kids[2]!.id)), 'counters');
    expect(cem.counters.find((c: any) => c.id === counter.id)).toMatchObject({ count: 1, colour: counter.colour });
    // Reminder boxes off: no counters on the card either.
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/counters`, { enabled: true, config: { showReminderBoxes: false } }));
    expect(keys(await ok(card(s.teacherA, kids[2]!.id)))).not.toContain('counters');
  });

  it('Super Speakers: the student’s own points this week, never a rank, only while the school switch is on', async () => {
    expect(keys(await ok(card(s.teacherA, kids[3]!.id)))).not.toContain('superSpeakers');
    await ok(s.admin.put('/api/admin/module-policies/superSpeakers', { availability: 'enabled' }));
    const link = await ok(s.admin.post('/api/admin/speakers/scorers', { label: 'Ms Deniz' }));
    const phone = new Client(env);
    await ok(phone.post('/api/scorer/session', { token: link.url.slice(link.url.indexOf('#') + 1) }));
    for (let i = 0; i < 2; i++) await ok(phone.post('/api/scorer/commands', { commands: [{ opId: v7(), type: 'points.award', payload: { studentId: kids[3]!.id } }] }));
    await ok(phone.post('/api/scorer/commands', { commands: [{ opId: v7(), type: 'points.award', payload: { studentId: kids[4]!.id } }] }));
    const defne = await ok(card(s.teacherA, kids[3]!.id));
    expect(item(defne, 'superSpeakers')).toEqual({ points: 2 });
    expect(JSON.stringify(defne)).not.toMatch(/rank|place|podium/iu);
    expect(JSON.stringify(defne)).not.toContain(kids[4]!.fullName);
    await ok(s.admin.put('/api/admin/module-policies/superSpeakers', { availability: 'disabled' }));
    expect(keys(await ok(card(s.teacherA, kids[3]!.id)))).not.toContain('superSpeakers');
  });

  it('a switched-off module adds nothing; nothing to show is an empty list, not zeros', async () => {
    await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/assistant`, { enabled: false }));
    const st = await lessonState(s.teacherA, s.ctxA.id);
    expect(st.assistant ?? null).toBeNull();
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/counters`, { enabled: false }));
    for (const k of kids) expect(await ok(card(s.teacherA, k.id))).toMatchObject({ items: [] });
  });
});

describe('classroom card boundary (D-154; GRP-7, SEC-3, GOL-6)', () => {
  it('never carries attendance, homework, goals or notes, levels or Secret Student data (marker scan)', async () => {
    const target = kids[0]!;
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/levels`, { levels: kids.map((k) => ({ studentId: k.id, level: `LVL${MARK}` })) }));
    await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${target.id}/private-notes`, { contextId: s.ctxA.id, studentId: target.id, body: `Note ${MARK}` }));
    await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/homework`, { title: `Homework ${MARK}`, dueOn: '2026-11-10', notes: `Notes ${MARK}` }));
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/secret/settings`, { count: 3 }));
    const lessonId = await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
    expect((await cmd(s.teacherA, 'attendance.setLessonException', { contextId: s.ctxA.id, lessonId, studentId: target.id, status: 'late' })).ok).toBe(true);
    expect((await cmd(s.teacherA, 'secret.draw', { contextId: s.ctxA.id, lessonId })).ok).toBe(true);
    expect((await cmd(s.teacherA, 'achievements.award', { contextId: s.ctxA.id, lessonId, achievementId: SUNSHINE, studentIds: [target.id] })).ok).toBe(true);
    const sealed = env.db.$client.prepare("select student_id id from secret_selections where status = 'sealed'").all() as Array<{ id: string }>;
    expect(sealed.length).toBe(3);
    const bodies: string[] = [];
    for (const k of kids) bodies.push(JSON.stringify(await ok(card(s.teacherA, k.id))));
    const all = bodies.join('\n');
    expect(all).toContain('achievements'); // the scan sees real items
    expect(all).not.toContain(MARK);
    expect(all).not.toMatch(/"attendance"|"late"|"absent"|"homework"|"goal|"note|"level"|"secret|"selected"|"sealed"/iu);
    // Every card has the same shape whether or not the student was chosen as a Secret Student (SEC-3).
    // Without the student's own fields and the assistant day, the other cards are identical.
    const rest = kids
      .filter((k) => k.id !== target.id)
      .map((k) => JSON.parse(bodies[kids.indexOf(k)]!) as { items: Array<{ key: string }> })
      .map((b) => JSON.stringify(b.items.filter((i) => i.key !== 'assistant')));
    expect(rest.length).toBe(kids.length - 1);
    expect(new Set(rest).size).toBe(1);
  });

  it('every card item a manifest declares is in the shared allow-list, once, from a module the brief allows', () => {
    const allowed = new Set<string>(ClassroomCardItem.options.map((o) => o.shape.key.value));
    const declared = SERVER_MODULES.flatMap((m) => (m.classroomCard ?? []).map((c) => ({ key: c.key, module: m.policyKey })));
    expect(declared.map((d) => d.key).sort()).toEqual([...allowed].sort());
    expect(new Set(declared.map((d) => d.key)).size).toBe(declared.length);
    for (const d of declared) expect(['achievements', 'superSpeakers', 'assistant', 'counters']).toContain(d.module);
  });
});

describe('student statistics drawer: class+subject list (D-154; RPT-6, ACC-10)', () => {
  it('lists only the teacher’s own class+subjects the student was in; another teacher’s student gives an empty list', async () => {
    const r = await ok(s.teacherA.get(`/api/teacher/students/${kids[0]!.id}/report-contexts`));
    expect(r.contexts.map((c: any) => c.id)).toEqual([s.ctxA.id]);
    expect((await ok(s.teacherB.get(`/api/teacher/students/${kids[0]!.id}/report-contexts`))).contexts).toEqual([]);
    expect((await s.admin.get(`/api/teacher/students/${kids[0]!.id}/report-contexts`)).status).toBe(403);
    // The drawer's report: the student with the built-in Student overview sections.
    const report = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report?studentId=${kids[0]!.id}&sections=overview,attendance.students,achievements.students`));
    expect(report.student).toMatchObject({ id: kids[0]!.id });
    expect(report.sections.map((x: any) => x.key)).toEqual(expect.arrayContaining(['overview', 'attendance']));
  });
});
