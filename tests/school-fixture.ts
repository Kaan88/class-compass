/**
 * Small fictional school built through the admin API: one year (2026–2027, containing the test
 * clock's "today"), English + Mathematics, classes 3-A and 3-B, two teachers:
 *   ayse.teacher   → English in 3-A
 *   mehmet.teacher → Mathematics in 3-B
 */
import { expect } from 'vitest';
import { Client, seedUser, type TestEnv } from './helpers.ts';

export async function ok(p: Promise<{ status: number; body: any }>, status = 200) {
  const r = await p;
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}

export async function buildSchool(env: TestEnv) {
  const adminUser = await seedUser(env, 'admin', 'root.admin');
  const ayse = await seedUser(env, 'teacher', 'ayse.teacher');
  const mehmet = await seedUser(env, 'teacher', 'mehmet.teacher');
  const admin = new Client(env);
  await admin.login('root.admin');
  const year = await ok(admin.post('/api/admin/years', { name: '2026–2027', startsOn: '2026-09-01', endsOn: '2027-06-30' }));
  const english = await ok(admin.post('/api/admin/subjects', { name: { en: 'English', tr: 'İngilizce' } }));
  const maths = await ok(admin.post('/api/admin/subjects', { name: { en: 'Mathematics', tr: 'Matematik' } }));
  const c3a = await ok(admin.post('/api/admin/classes', { schoolYearId: year.id, name: '3-A', grade: 3, theme: 'explorer' }));
  const c3b = await ok(admin.post('/api/admin/classes', { schoolYearId: year.id, name: '3-B', grade: 3 }));
  const ctxA = await ok(admin.post('/api/admin/teaching-contexts', { teacherId: ayse.id, classId: c3a.id, subjectId: english.id }));
  const ctxB = await ok(admin.post('/api/admin/teaching-contexts', { teacherId: mehmet.id, classId: c3b.id, subjectId: maths.id }));
  const teacherA = new Client(env);
  await teacherA.login('ayse.teacher');
  const teacherB = new Client(env);
  await teacherB.login('mehmet.teacher');
  expect(ctxA.className).toBe('3-A');
  return { admin, adminUser, ayse, mehmet, teacherA, teacherB, year, english, maths, c3a, c3b, ctxA, ctxB };
}

export type School = Awaited<ReturnType<typeof buildSchool>>;

export async function addStudent(c: Client, classId: string, body: Record<string, unknown>) {
  return ok(c.post(`/api/teacher/classes/${classId}/students`, body));
}
