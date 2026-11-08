/**
 * S13c performance (items 3, 11): a school of 1,500 students in 50 classes. The quiet backfill of
 * every class, the classroom avatar directory and a student page stay quick. Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import { READY_MADE } from '../../src/shared/avatars.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const READING = '00000000-0000-7000-8000-00000000c001';
const CLASSES = 50;
const PER_CLASS = 30;

let env: TestEnv;
let s: School;
const contexts: string[] = [];
let firstStudent: { id: string; classId: string };

beforeAll(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  const classIds: string[] = [s.c3a.id];
  contexts.push(s.ctxA.id);
  for (let i = 1; i < CLASSES; i++) {
    const c = await ok(s.admin.post('/api/admin/classes', { schoolYearId: s.year.id, name: `P-${i}`, grade: 4 }));
    const ctx = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.ayse.id, classId: c.id, subjectId: s.english.id }));
    classIds.push(c.id);
    contexts.push(ctx.id);
  }
  // One student and one goal through the API; the rest are copied in SQL (fast set-up).
  const ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
  firstStudent = { id: ada.id, classId: s.c3a.id };
  const phone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
  await ok(phone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read one book every week.' }));
  const db = env.db.$client;
  const now = env.clock.now();
  const insStudent = db.prepare('insert into students (id, full_name, name_fold, avatar_hue, avatar_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)');
  const insEnrol = db.prepare("insert into enrolments (id, student_id, class_id, school_year_id, from_date, reason, created_at) values (?, ?, ?, ?, '2026-09-01', 'added', ?)");
  const goalCols = (db.prepare('pragma table_info(goals)').all() as Array<{ name: string }>).map((c) => c.name).filter((c) => c !== 'id' && c !== 'student_id' && c !== 'context_id');
  const insGoal = db.prepare(`insert into goals (id, student_id, context_id, ${goalCols.join(', ')}) select ?, ?, ?, ${goalCols.join(', ')} from goals limit 1`);
  db.transaction(() => {
    let n = 1;
    for (let c = 0; c < CLASSES; c++) {
      for (let k = c === 0 ? 1 : 0; k < PER_CLASS; k++, n++) {
        const id = v7();
        insStudent.run(id, `Kurgu Öğrenci ${n}`, `kurgu ogrenci ${n}`, n % 360, n % 3 === 0 ? JSON.stringify(READY_MADE[n % READY_MADE.length]) : null, now, now);
        insEnrol.run(v7(), id, classIds[c], s.year.id, now);
        if (n % 2 === 0) insGoal.run(v7(), id, contexts[c]);
      }
    }
  })();
  expect((db.prepare('select count(*) as n from students').get() as { n: number }).n).toBe(CLASSES * PER_CLASS);
}, 120_000);
afterAll(() => env.app.close());

describe('1,500 students', () => {
  it('quietly backfills every class, serves the avatar directory and a student page quickly', async () => {
    const t0 = performance.now();
    let awarded = 0;
    for (const id of contexts) awarded += (await ok(s.teacherA.post(`/api/teacher/contexts/${id}/achievements/start`, { mode: 'quiet' }))).awarded;
    const backfill = performance.now() - t0;
    // Every second student has one goal: the "Goal setter" badge for each of them, once.
    expect(awarded).toBe(1 + Math.floor((CLASSES * PER_CLASS - 1) / 2));
    expect(backfill).toBeLessThan(20_000);

    const t1 = performance.now();
    const dir = await ok(s.teacherA.get('/api/classroom/avatars'));
    const directory = performance.now() - t1;
    expect(dir.students).toHaveLength(CLASSES * PER_CLASS);
    expect(directory).toBeLessThan(2_000);

    const t2 = performance.now();
    const overview = await ok(s.teacherA.get(`/api/teacher/contexts/${contexts[0]}/achievements`));
    expect(overview.students).toHaveLength(PER_CLASS);
    const phone = await openLink(env, await linkUrl(s.teacherA, firstStudent.classId, firstStudent.id));
    await ok(phone.get('/api/student/page'));
    expect(performance.now() - t2).toBeLessThan(2_000);
  }, 60_000);
});
