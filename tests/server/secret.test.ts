/**
 * Secret Students (S7): SEC-1..7, LES-2/3, D-007, D-010, D-062, D-064. Fictional names only.
 * The test reads secret_selections directly from the database (the server never tells it who was
 * chosen before the reveal).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { seededRank } from '../../src/domain/rotation.ts';
import { fairnessCounts } from '../../src/server/modules/secret/service.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { cmd, endLesson, lessonState, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
let kids: Array<{ id: string; fullName: string }>;

const NAMES = ['Ece Deniz Kaya', 'Arda Yıldız', 'Işıl Çınar', 'Oliver Clarke', 'Zeynep Aksoy', 'Mert Doğan'];

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  kids = [];
  for (const fullName of NAMES) kids.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
});
afterEach(async () => env.app.close());

const ctxId = () => s.ctxA.id as string;
const sealedIds = (lessonId: string) =>
  (env.db.$client.prepare("select s.student_id id from secret_selections s join secret_rounds r on r.id = s.round_id where r.lesson_id = ? and r.status = 'live' and s.status = 'sealed'").all(lessonId) as Array<{ id: string }>).map((r) => r.id).sort();
const selectionRows = (lessonId: string) =>
  env.db.$client.prepare('select s.student_id studentId, s.status, s.replaced_selection_id replaced from secret_selections s join secret_rounds r on r.id = s.round_id where r.lesson_id = ? order by s.selected_at, s.id').all(lessonId) as Array<{ studentId: string; status: string; replaced: string | null }>;

async function setCount(count: number, contextId = ctxId(), c = s.teacherA) {
  await ok(c.put(`/api/teacher/contexts/${contextId}/secret/settings`, { count }));
}
async function draw(lessonId: string, contextId = ctxId(), c = s.teacherA) {
  return cmd(c, 'secret.draw', { contextId, lessonId });
}
/** Next day (sessions idle out after 12 h, so both teachers sign in again). */
async function nextDay() {
  env.clock.advance(24 * 3600_000);
  await s.teacherA.login('ayse.teacher');
  await s.teacherB.login('mehmet.teacher');
}

describe('draw (SEC-1, SEC-3, SEC-4)', () => {
  it('chooses the configured number of present students; the classroom only learns counts', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    const before = await lessonState(s.teacherA, ctxId());
    expect(before.secret).toEqual({ roundExists: false, requestedCount: 0, selectedCount: 0, shortfall: null, revealed: false, configuredCount: 2 });
    const r = await draw(lessonId);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.result).sort()).toEqual(['created', 'requestedCount', 'roundId', 'selectedCount', 'shortfall']);
    expect(r.result).toMatchObject({ created: true, requestedCount: 2, selectedCount: 2, shortfall: null });
    const chosen = sealedIds(lessonId);
    expect(chosen).toHaveLength(2);
    const st = await lessonState(s.teacherA, ctxId());
    expect(st.secret).toEqual({ roundExists: true, requestedCount: 2, selectedCount: 2, shortfall: null, revealed: false, configuredCount: 2 });
    // The full state lists every student (counters, assistant); the secret part and the draw answer carry no identity.
    const raw = JSON.stringify([r, st.secret]);
    for (const id of chosen) {
      expect(raw).not.toContain(id);
      expect(raw).not.toContain(kids.find((k) => k.id === id)!.fullName);
    }
  });

  it('a second draw, a replay and a refresh keep the same round: no reroll (LES-2, SEC-4)', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    const first = await draw(lessonId);
    const chosen = sealedIds(lessonId);
    const again = await draw(lessonId); // another device / double tap: a new opId
    expect(again.result).toEqual({ ...first.result, created: false });
    const replay = await cmd(s.teacherA, 'secret.draw', { contextId: ctxId(), lessonId }, { opId: first.opId });
    expect(replay).toMatchObject({ replayed: true, result: first.result });
    expect(sealedIds(lessonId)).toEqual(chosen);
    expect((await lessonState(s.teacherA, ctxId())).secret.selectedCount).toBe(2);
    expect(env.db.$client.prepare('select count(*) n from secret_rounds where lesson_id = ?').get(lessonId)).toEqual({ n: 1 });
  });

  it('a new lesson gets a new round (SEC-4)', async () => {
    const l1 = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    await draw(l1);
    await endLesson(s.teacherA, ctxId(), l1);
    const l2 = await startLesson(s.teacherA, ctxId());
    expect((await lessonState(s.teacherA, ctxId())).secret.roundExists).toBe(false);
    const r = await draw(l2);
    expect(r.result.created).toBe(true);
    expect(env.db.$client.prepare('select count(distinct lesson_id) n from secret_rounds').get()).toEqual({ n: 2 });
  });

  it('only present or late students are eligible; never the same student twice (SEC-1)', async () => {
    const [a, b, c, d, e, f] = kids;
    const lessonId = await startLesson(s.teacherA, ctxId(), {
      attendance: [
        { studentId: a!.id, status: 'absent' },
        { studentId: b!.id, status: 'excused' },
        { studentId: c!.id, status: 'late' },
        { studentId: d!.id, status: 'present' },
      ],
    });
    // e and f are "not recorded": not in the room as far as the app knows.
    void e;
    void f;
    await setCount(5);
    const r = await draw(lessonId);
    expect(r.result).toMatchObject({ requestedCount: 5, selectedCount: 2, shortfall: 'NOT_ENOUGH_ELIGIBLE' });
    expect(sealedIds(lessonId)).toEqual([c!.id, d!.id].sort());
  });

  it('small class: 2-D with 3 students asked for 5 selects 3 and records the shortfall (SEC-7)', async () => {
    const c2d = await ok(s.admin.post('/api/admin/classes', { schoolYearId: s.year.id, name: '2-D', grade: 2 }));
    const ctx2d = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.ayse.id, classId: c2d.id, subjectId: s.english.id }));
    for (const fullName of ['Ada Er', 'Bora Can', 'Cem Ay']) await addStudent(s.teacherA, c2d.id, { fullName });
    await setCount(5, ctx2d.id);
    const lessonId = await startLesson(s.teacherA, ctx2d.id, { othersPresent: true });
    const r = await draw(lessonId, ctx2d.id);
    expect(r.result).toMatchObject({ requestedCount: 5, selectedCount: 3, shortfall: 'NOT_ENOUGH_ELIGIBLE' });
    expect(new Set(sealedIds(lessonId)).size).toBe(3);
    expect((await lessonState(s.teacherA, ctx2d.id)).secret).toMatchObject({ requestedCount: 5, selectedCount: 3, shortfall: 'NOT_ENOUGH_ELIGIBLE' });
  });

  it('everyone absent: 0 selected with a reason; a later draw keeps that round until an explicit redraw (SEC-7)', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { attendance: kids.map((k) => ({ studentId: k.id, status: 'absent' })) });
    const r = await draw(lessonId);
    expect(r.result).toMatchObject({ selectedCount: 0, shortfall: 'NO_ELIGIBLE' });
    for (const k of kids.slice(0, 3)) await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctxId(), lessonId, studentId: k.id, status: 'present' });
    expect((await draw(lessonId)).result).toMatchObject({ created: false, selectedCount: 0 });
    const re = await cmd(s.teacherA, 'secret.redraw', { contextId: ctxId(), lessonId, confirm: true });
    expect(re.result).toMatchObject({ created: true, selectedCount: 2, shortfall: null });
  });

  it('is refused while the Secret Students module is off (CFG-1) and End Lesson still works', async () => {
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctxId()}/modules/secretStudents`, { enabled: false }));
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    expect((await draw(lessonId)).error?.code).toBe('FEATURE_DISABLED');
    const st = await lessonState(s.teacherA, ctxId());
    expect(st.secret).toBeNull();
    expect(st.lesson.endSteps).not.toContain('secretStudents');
    await endLesson(s.teacherA, ctxId(), lessonId);
  });

  it('only the owner of the context can draw (ACC-10)', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    expect((await draw(lessonId, ctxId(), s.teacherB)).error?.code).toBe('FORBIDDEN');
  });
});

describe('redraw (SEC-4, D-062)', () => {
  it('needs an explicit confirmation, is audited and withdraws the old selections, which do not count for fairness', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    await draw(lessonId);
    const old = sealedIds(lessonId);
    const noConfirm = await cmd(s.teacherA, 'secret.redraw', { contextId: ctxId(), lessonId });
    expect(noConfirm.ok).toBe(false);
    const re = await cmd(s.teacherA, 'secret.redraw', { contextId: ctxId(), lessonId, confirm: true });
    expect(re.result).toMatchObject({ created: true, selectedCount: 2 });
    expect(re.result.roundId).toBe(re.opId);
    const rows = selectionRows(lessonId);
    expect(rows.filter((r) => r.status === 'withdrawn_redraw').map((r) => r.studentId).sort()).toEqual(old);
    const audit = env.db.$client.prepare("select before_json b, after_json a from audit_events where action = 'secret.redraw'").get() as { b: string; a: string };
    expect(audit).toBeTruthy();
    for (const id of [...old, ...sealedIds(lessonId)]) expect(audit.a + audit.b).not.toContain(id); // counts only (SEC-3)
    const counts = fairnessCounts(env.db, ctxId(), s.year.id);
    const now = sealedIds(lessonId);
    for (const id of old) if (!now.includes(id)) expect(counts.get(id)).toBeUndefined();
    for (const id of now) expect(counts.get(id)?.count).toBe(1);
  });

  it('is refused after the reveal', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    await draw(lessonId);
    await cmd(s.teacherA, 'secret.reveal', { contextId: ctxId(), lessonId });
    const re = await cmd(s.teacherA, 'secret.redraw', { contextId: ctxId(), lessonId, confirm: true });
    expect(re.error?.reason).toBe('SECRET_ALREADY_REVEALED');
  });
});

describe('the draw cannot be predicted from client-visible data (SEC-3, SEC-2, review fix)', () => {
  it('the round id (= the client opId) and the roster do not determine who is chosen', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    // Redraws withdraw the old selections, which do not count, so every round starts with all counts at 0
    // and the order is decided by the tie-break alone. Seeded by the round id, it would be fully predictable.
    let predicted = 0;
    const seen = new Set<string>();
    const ROUNDS = 10;
    for (let i = 0; i < ROUNDS; i++) {
      const r = await cmd(s.teacherA, i === 0 ? 'secret.draw' : 'secret.redraw', i === 0 ? { contextId: ctxId(), lessonId } : { contextId: ctxId(), lessonId, confirm: true });
      expect(r.ok).toBe(true);
      const guess = [...kids]
        .sort((a, b) => seededRank(r.result.roundId, a.id) - seededRank(r.result.roundId, b.id) || (a.id < b.id ? -1 : 1))
        .slice(0, 2)
        .map((k) => k.id)
        .sort();
      const actual = sealedIds(lessonId);
      seen.add(actual.join(','));
      if (guess.join(',') === actual.join(',')) predicted += 1;
    }
    // With fresh server randomness each guess is right with probability 1/15.
    expect(predicted).toBeLessThan(ROUNDS);
    expect(seen.size).toBeGreaterThan(1);
    // The seed is not stored anywhere a client-facing read could reach it.
    const cols = (env.db.$client.prepare("select name from pragma_table_info('secret_rounds')").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols.some((c) => /seed/i.test(c))).toBe(false);
  });
});

describe('absent chosen student is replaced silently (SEC-3, SEC-7, D-007)', () => {
  const shape = (r: any, studentId: string) => JSON.stringify({ ...r, opId: 'OP', result: { ...r.result, studentId: r.result.studentId === studentId ? 'S' : r.result.studentId } });

  it('daily absence: the attendance answer and the lesson state look exactly the same as for any other student', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    await draw(lessonId);
    const [chosen] = sealedIds(lessonId);
    const other = kids.find((k) => !sealedIds(lessonId).includes(k.id))!;
    const v0 = (await lessonState(s.teacherA, ctxId())).lesson.version;

    const plain = await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctxId(), lessonId, studentId: other.id, status: 'absent' });
    const st1 = await lessonState(s.teacherA, ctxId());
    const hit = await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctxId(), lessonId, studentId: chosen!, status: 'absent' });
    const st2 = await lessonState(s.teacherA, ctxId());

    expect(shape(hit, chosen!)).toBe(shape(plain, other.id));
    expect(st1.lesson.version).toBe(v0);
    expect(st2.lesson.version).toBe(v0);
    expect(st2.secret).toEqual(st1.secret);
    expect(st2.secret.selectedCount).toBe(2);

    const rows = selectionRows(lessonId);
    const withdrawn = rows.find((r) => r.studentId === chosen);
    expect(withdrawn?.status).toBe('withdrawn_absent');
    const replacement = rows.find((r) => r.replaced !== null);
    expect(replacement).toMatchObject({ status: 'sealed' });
    expect([chosen, other.id]).not.toContain(replacement!.studentId);
    expect(sealedIds(lessonId)).toHaveLength(2);
    // No audit row hints at the replacement before the reveal.
    expect(env.db.$client.prepare("select count(*) n from audit_events where action like 'secret.%' and action <> 'secret.draw'").get()).toEqual({ n: 0 });

    // The reveal says who was replaced (D-007).
    const rv = await cmd(s.teacherA, 'secret.reveal', { contextId: ctxId(), lessonId });
    expect(rv.result.selections).toHaveLength(2);
    expect(rv.result.absent).toEqual([expect.objectContaining({ student: expect.objectContaining({ id: chosen }), replacedBy: expect.any(String) })]);
    expect(rv.result.selections.find((x: any) => x.selectionId === rv.result.absent[0].replacedBy).replacedSelectionId).toBe(rv.result.absent[0].selectionId);
  });

  it('lesson-only exception: same answer shape, replaced only in that lesson', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    await draw(lessonId);
    const [chosen] = sealedIds(lessonId);
    const other = kids.find((k) => !sealedIds(lessonId).includes(k.id))!;
    const plain = await cmd(s.teacherA, 'attendance.setLessonException', { contextId: ctxId(), lessonId, studentId: other.id, status: 'excused' });
    const v1 = (await lessonState(s.teacherA, ctxId())).lesson.version;
    const hit = await cmd(s.teacherA, 'attendance.setLessonException', { contextId: ctxId(), lessonId, studentId: chosen!, status: 'excused' });
    const v2 = (await lessonState(s.teacherA, ctxId())).lesson.version;
    expect(shape(hit, chosen!)).toBe(shape(plain, other.id));
    expect(v2 - v1).toBe(1); // an exception bumps the version for everyone, chosen or not
    expect(sealedIds(lessonId)).not.toContain(chosen);
    expect(sealedIds(lessonId)).toHaveLength(2);
  });

  it('a late student is still in the room and is not replaced; nobody left means no replacement and the count stays', async () => {
    await setCount(2);
    const c2d = await ok(s.admin.post('/api/admin/classes', { schoolYearId: s.year.id, name: '2-D', grade: 2 }));
    const ctx2d = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.ayse.id, classId: c2d.id, subjectId: s.english.id }));
    const small = [];
    for (const fullName of ['Ada Er', 'Bora Can']) small.push(await addStudent(s.teacherA, c2d.id, { fullName }));
    const lessonId = await startLesson(s.teacherA, ctx2d.id, { othersPresent: true });
    await draw(lessonId, ctx2d.id);
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx2d.id, lessonId, studentId: small[0].id, status: 'late' });
    expect(sealedIds(lessonId)).toHaveLength(2);
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx2d.id, lessonId, studentId: small[0].id, status: 'absent' });
    expect(sealedIds(lessonId)).toEqual([small[1].id]);
    expect((await lessonState(s.teacherA, ctx2d.id)).secret.selectedCount).toBe(2);
    const rv = await cmd(s.teacherA, 'secret.reveal', { contextId: ctx2d.id, lessonId });
    expect(rv.result.absent).toEqual([expect.objectContaining({ replacedBy: null })]);
  });

  it('a teacher-area daily correction for today also replaces silently', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    await draw(lessonId);
    const [chosen] = sealedIds(lessonId);
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/attendance`, { date: '2026-11-09', studentId: chosen, status: 'absent' }));
    expect(sealedIds(lessonId)).not.toContain(chosen);
    expect(sealedIds(lessonId)).toHaveLength(2);
  });
});

describe('reveal and outcomes at End Lesson (SEC-5, SEC-6, LES-3)', () => {
  it('reveals names only in the active lesson, records outcomes and keeps the history', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    await draw(lessonId);
    const chosen = sealedIds(lessonId);
    const pre = await ok(s.teacherA.get(`/api/classroom/lessons/${lessonId}/secret`));
    expect(pre).toEqual({ state: expect.objectContaining({ roundExists: true, revealed: false }), reveal: null });

    const rv = await cmd(s.teacherA, 'secret.reveal', { contextId: ctxId(), lessonId });
    expect(rv.ok).toBe(true);
    expect(rv.result.selections.map((x: any) => x.student.id).sort()).toEqual(chosen);
    expect(rv.result.selections[0].student.fullName).toBeTruthy();
    const again = await cmd(s.teacherA, 'secret.reveal', { contextId: ctxId(), lessonId });
    expect(again.result.selections.map((x: any) => x.selectionId)).toEqual(rv.result.selections.map((x: any) => x.selectionId));
    expect((await lessonState(s.teacherA, ctxId())).secret.revealed).toBe(true);

    const [x, y] = rv.result.selections;
    const o1 = await cmd(s.teacherA, 'secret.recordOutcome', { contextId: ctxId(), lessonId, selectionId: x.selectionId, outcome: 'goal_met', note: 'Asked two questions in English', celebration: true });
    expect(o1.result).toMatchObject({ outcome: 'goal_met', celebration: true });
    await cmd(s.teacherA, 'secret.recordOutcome', { contextId: ctxId(), lessonId, selectionId: y.selectionId, outcome: 'still_practising' });
    const after = await ok(s.teacherA.get(`/api/classroom/lessons/${lessonId}/secret`));
    expect(after.reveal.selections.find((z: any) => z.selectionId === x.selectionId)).toMatchObject({ outcome: 'goal_met', note: 'Asked two questions in English', celebration: true });

    await endLesson(s.teacherA, ctxId(), lessonId, { secretStudents: {}, reflection: { rating: 3 } });
    const h = await ok(s.teacherA.get(`/api/teacher/contexts/${ctxId()}/secret/history`));
    expect(h.rounds[0]).toMatchObject({ lessonId, state: 'revealed', selectedCount: 2 });
    expect(h.students.find((z: any) => z.student.id === x.student.id)).toMatchObject({ revealed: 1, goalMet: 1, lastRevealedDate: '2026-11-09' });
    expect(h.students.find((z: any) => z.student.id === y.student.id)).toMatchObject({ revealed: 1, stillPractising: 1 });
    // After the lesson, outcomes can no longer be changed from the classroom.
    const late = await cmd(s.teacherA, 'secret.recordOutcome', { contextId: ctxId(), lessonId, selectionId: x.selectionId, outcome: 'still_practising' });
    expect(late.error?.reason).toBe('LESSON_ENDED');
  });

  it('outcomes are refused before the reveal; End Lesson reveals a round that was not revealed yet', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    await draw(lessonId);
    const sel = env.db.$client.prepare('select id from secret_selections limit 1').get() as { id: string };
    const early = await cmd(s.teacherA, 'secret.recordOutcome', { contextId: ctxId(), lessonId, selectionId: sel.id, outcome: 'goal_met' });
    expect(early.error?.reason).toBe('SECRET_NOT_REVEALED');
    await endLesson(s.teacherA, ctxId(), lessonId, { secretStudents: { outcomes: [{ selectionId: sel.id, outcome: 'goal_met' }] } });
    expect(selectionRows(lessonId).map((r) => r.status)).toEqual(['revealed', 'revealed']);
    const h = await ok(s.teacherA.get(`/api/teacher/contexts/${ctxId()}/secret/history`));
    expect(h.students.reduce((n: number, z: any) => n + z.goalMet, 0)).toBe(1);
  });

  it('reveal without a round is refused; the classroom reveal endpoint serves only today (D-055)', async () => {
    const lessonId = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    expect((await cmd(s.teacherA, 'secret.reveal', { contextId: ctxId(), lessonId })).error?.reason).toBe('NO_SECRET_ROUND');
    await draw(lessonId);
    await endLesson(s.teacherA, ctxId(), lessonId);
    expect((await s.teacherA.get(`/api/classroom/lessons/${lessonId}/secret`)).status).toBe(200);
    await nextDay();
    expect((await s.teacherA.get(`/api/classroom/lessons/${lessonId}/secret`)).status).toBe(404);
    expect((await s.teacherB.get(`/api/classroom/lessons/${lessonId}/secret`)).status).toBe(404);
  });
});

describe('abandoned lessons (D-010)', () => {
  it('an unrevealed round of an abandoned lesson is never shown as selected but counts for fairness', async () => {
    await setCount(3);
    const l1 = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    await draw(l1);
    const abandoned = sealedIds(l1);
    await nextDay(); // Tuesday: the next start abandons Monday's lesson
    const l2 = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    expect(selectionRows(l1).every((r) => r.status === 'unrevealed_abandoned')).toBe(true);
    const h = await ok(s.teacherA.get(`/api/teacher/contexts/${ctxId()}/secret/history`));
    const r1 = h.rounds.find((r: any) => r.lessonId === l1);
    expect(r1).toMatchObject({ state: 'abandoned', selections: [], absent: [] });
    for (const id of abandoned) expect(JSON.stringify(h)).not.toContain(id);
    // Fairness: the three abandoned students have had their turn, so the other three are chosen now.
    await draw(l2);
    const now = sealedIds(l2);
    expect(now).toEqual(kids.map((k) => k.id).filter((id) => !abandoned.includes(id)).sort());
  });

  it('a round left unrevealed because the module was switched off is closed the same way at End Lesson', async () => {
    const l1 = await startLesson(s.teacherA, ctxId(), { othersPresent: true });
    await draw(l1);
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctxId()}/modules/secretStudents`, { enabled: false }));
    await endLesson(s.teacherA, ctxId(), l1);
    expect(selectionRows(l1).every((r) => r.status === 'unrevealed_abandoned')).toBe(true);
  });
});

describe('fair rotation (SEC-2, D-062)', () => {
  it('over many lessons, always-present students differ by at most one selection, absences included', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }), { minLength: 12, maxLength: 20 }), fc.integer({ min: 1, max: 3 }), async (days, count) => {
        await setCount(count);
        env.db.$client.exec("delete from secret_selections; delete from secret_rounds;");
        // Students 0 and 1 are always present; the others may be absent on any day.
        for (const presence of days) {
          const attendance = kids.map((k, i) => ({ studentId: k.id, status: i < 2 || presence[i] ? 'present' : 'absent' }));
          const lessonId = await startLesson(s.teacherA, ctxId(), { attendance });
          await draw(lessonId);
          await endLesson(s.teacherA, ctxId(), lessonId);
          // Re-mark everyone present next time (daily rows are per day; same day here).
          env.db.$client.exec('delete from attendance_daily');
        }
        const counts = fairnessCounts(env.db, ctxId(), s.year.id);
        const always = [0, 1].map((i) => counts.get(kids[i]!.id)?.count ?? 0);
        expect(Math.abs(always[0]! - always[1]!)).toBeLessThanOrEqual(1);
        // Among students present every day, the spread is at most one as well.
        const everyDay = kids.filter((_, i) => i < 2 || days.every((d) => d[i])).map((k) => counts.get(k.id)?.count ?? 0);
        expect(Math.max(...everyDay) - Math.min(...everyDay)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 6 },
    );
  }, 120_000);
});
