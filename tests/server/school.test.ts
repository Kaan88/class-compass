import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMediaPolicy, isModuleEnabled } from '../../src/server/modules/school/modules.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
});
afterEach(async () => env.app.close());

describe('school settings', () => {
  it('seeds one settings row with the configured timezone and validates timezones via Intl', async () => {
    const st = await ok(s.admin.get('/api/admin/settings'));
    expect(st).toMatchObject({ timezone: 'Europe/Istanbul', weekStartsOn: 1, defaultLocale: 'en', emailResetEnabled: false });
    expect((await s.admin.patch('/api/admin/settings', { timezone: 'Mars/Olympus' })).status).toBe(400);
    const next = await ok(s.admin.patch('/api/admin/settings', { schoolName: 'Demo  School', timezone: 'Europe/London' }));
    expect(next).toMatchObject({ schoolName: 'Demo School', timezone: 'Europe/London' });
  });

  it('keeps each teacher’s language separate from other teachers and from the school default (UX-4)', async () => {
    await ok(s.admin.patch('/api/admin/settings', { defaultLocale: 'tr' }));
    // The signed-out sign-in pages start in the school default (UX-4 is unchanged for accounts).
    expect((await new Client(env).get('/api/auth/password-reset')).body.defaultLocale).toBe('tr');
    expect((await s.teacherA.get('/api/auth/me')).body.locale).toBe('en');
    await ok(s.teacherA.patch('/api/auth/preferences', { locale: 'tr' }));
    expect((await s.teacherB.get('/api/auth/me')).body.locale).toBe('en');
    expect((await s.teacherA.get('/api/auth/me')).body.locale).toBe('tr');
    // S13a (D-099): the admin chooses the new account's interface language (English unless chosen).
    const created = await ok(s.admin.post('/api/admin/users', { login: 'new.teacher', displayName: 'New Teacher', role: 'teacher', setup: 'temporary_password' }));
    const c = new Client(env);
    expect((await c.login('new.teacher', created.temporaryPassword)).body.locale).toBe('en');
  });
});

describe('school years and terms (DAT-1)', () => {
  it('creates terms inside the year and rejects terms outside it', async () => {
    const t = await ok(s.admin.post(`/api/admin/years/${s.year.id}/terms`, { name: { en: 'Term 1', tr: '1. Dönem' }, startsOn: '2026-09-01', endsOn: '2027-01-23' }));
    expect((await s.admin.post(`/api/admin/years/${s.year.id}/terms`, { name: { en: 'Bad' }, startsOn: '2026-08-01', endsOn: '2026-12-01' })).status).toBe(400);
    expect((await s.admin.post(`/api/admin/years/${s.year.id}/terms`, { name: { en: 'Bad' }, startsOn: '2026-02-30', endsOn: '2026-12-01' })).status).toBe(400);
    const years = await ok(s.admin.get('/api/admin/years'));
    expect(years.years[0].terms.map((x: any) => x.id)).toEqual([t.id]);
    await ok(s.admin.patch(`/api/admin/terms/${t.id}`, { name: { en: 'Autumn term' } }));
    await ok(s.admin.del(`/api/admin/terms/${t.id}`));
    expect((await ok(s.admin.get('/api/admin/years'))).years[0].terms).toEqual([]);
  });

  it('keeps terms inside the year and years from overlapping when dates change (DAT-1)', async () => {
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/terms`, { name: { en: 'Term 2' }, startsOn: '2027-02-09', endsOn: '2027-06-30' }));
    const shrink = await s.admin.patch(`/api/admin/years/${s.year.id}`, { endsOn: '2027-06-15' });
    expect(shrink.status).toBe(409);
    expect(shrink.body.error.details.reason).toBe('TERM_OUTSIDE_YEAR');
    const overlap = await s.admin.post('/api/admin/years', { name: '2027–2028', startsOn: '2027-06-01', endsOn: '2028-06-30' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.details.reason).toBe('YEAR_OVERLAP');
    const next = await ok(s.admin.post('/api/admin/years', { name: '2027–2028', startsOn: '2027-09-01', endsOn: '2028-06-30' }));
    expect((await s.admin.patch(`/api/admin/years/${next.id}`, { startsOn: '2027-06-30' })).body.error.details.reason).toBe('YEAR_OVERLAP');
    // Students enrolled from 9 Nov: the year cannot start after that.
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'Nil Akay' });
    expect((await s.admin.patch(`/api/admin/years/${s.year.id}`, { startsOn: '2026-12-01' })).body.error.details.reason).toBe('ENROLMENT_OUTSIDE_YEAR');
    await ok(s.admin.patch(`/api/admin/years/${s.year.id}`, { startsOn: '2026-09-07' }));
  });

  it('makes an archived year read-only for admins and teachers, and reversible by unarchiving', async () => {
    const stu = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Elif Kaya' });
    const archived = await ok(s.admin.post(`/api/admin/years/${s.year.id}/archive`));
    expect(archived.archived).toBe(true);
    const readOnly = [
      await s.admin.patch(`/api/admin/years/${s.year.id}`, { name: 'x' }),
      await s.admin.post(`/api/admin/years/${s.year.id}/terms`, { name: { en: 'T' }, startsOn: '2026-09-01', endsOn: '2026-10-01' }),
      await s.admin.post('/api/admin/classes', { schoolYearId: s.year.id, name: '5-Z' }),
      await s.admin.patch(`/api/admin/classes/${s.c3a.id}`, { theme: 'animals' }),
      await s.admin.post('/api/admin/teaching-contexts', { teacherId: s.mehmet.id, classId: s.c3a.id, subjectId: s.maths.id }),
      await s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/students`, { fullName: 'Can Demir' }),
      await s.teacherA.patch(`/api/teacher/students/${stu.id}`, { fullName: 'Elif Su Kaya' }),
      await s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/routines`, { enabled: false }),
      await s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/levels`, { levels: [{ studentId: stu.id, level: 'A' }] }),
    ];
    for (const r of readOnly) {
      expect(r.status).toBe(409);
      expect(r.body.error.details.reason).toBe('YEAR_ARCHIVED');
    }
    // Reading still works: the admin sees the class and the history.
    const cls = await ok(s.admin.get(`/api/admin/classes?yearId=${s.year.id}`));
    expect(cls.classes.find((c: any) => c.id === s.c3a.id)).toMatchObject({ yearArchived: true, studentCount: 1 });
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/unarchive`));
    await ok(s.admin.patch(`/api/admin/classes/${s.c3a.id}`, { theme: 'animals' }));
  });
});

describe('subjects, classes, teaching contexts', () => {
  it('archives subjects and classes without deleting them, and rejects duplicate class names (Turkish-insensitive)', async () => {
    expect((await s.admin.post('/api/admin/classes', { schoolYearId: s.year.id, name: '3-a' })).status).toBe(409);
    await ok(s.admin.post(`/api/admin/subjects/${s.maths.id}/archive`));
    expect((await ok(s.admin.get('/api/admin/subjects'))).subjects.map((x: any) => x.name.en)).toEqual(['English']);
    expect((await ok(s.admin.get('/api/admin/subjects?includeArchived=true'))).subjects).toHaveLength(2);
    // Archived subjects cannot be newly assigned.
    expect((await s.admin.post('/api/admin/teaching-contexts', { teacherId: s.ayse.id, classId: s.c3a.id, subjectId: s.maths.id })).status).toBe(400);
    const archivedClass = await ok(s.admin.post(`/api/admin/classes/${s.c3b.id}/archive`));
    expect(archivedClass.archived).toBe(true);
    expect((await s.admin.patch(`/api/admin/classes/${s.c3b.id}`, { name: '3-Z' })).body.error.details.reason).toBe('CLASS_ARCHIVED');
    expect((await ok(s.admin.get('/api/admin/classes'))).classes.map((c: any) => c.name)).toEqual(['3-A']);
  });

  it('updates class display settings (theme, timezone, sounds, animations)', async () => {
    const c = await ok(s.admin.patch(`/api/admin/classes/${s.c3a.id}`, { theme: 'animals', timezone: 'Europe/London', soundsEnabled: false, animationsEnabled: false }));
    expect(c).toMatchObject({ theme: 'animals', timezone: 'Europe/London', soundsEnabled: false, animationsEnabled: false });
    expect((await s.admin.patch(`/api/admin/classes/${s.c3a.id}`, { timezone: 'Nowhere/Land' })).status).toBe(400);
    const mine = await ok(s.teacherA.get('/api/teacher/contexts'));
    expect(mine.contexts[0]).toMatchObject({ className: '3-A', theme: 'animals', timezone: 'Europe/London', soundsEnabled: false });
  });

  it('allows one active assignment per teacher+class+subject and ending it removes access but keeps the row', async () => {
    expect((await s.admin.post('/api/admin/teaching-contexts', { teacherId: s.ayse.id, classId: s.c3a.id, subjectId: s.english.id })).status).toBe(409);
    expect((await s.admin.post('/api/admin/teaching-contexts', { teacherId: s.adminUser.id, classId: s.c3a.id, subjectId: s.english.id })).status).toBe(400);
    await ok(s.admin.post(`/api/admin/teaching-contexts/${s.ctxA.id}/end`));
    expect((await s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/students`)).status).toBe(403);
    expect((await ok(s.teacherA.get('/api/teacher/contexts'))).contexts).toEqual([]);
    const all = await ok(s.admin.get('/api/admin/teaching-contexts?includeEnded=true'));
    expect(all.contexts.find((c: any) => c.id === s.ctxA.id).endedAt).not.toBeNull();
    // A fresh assignment can be made again after ending.
    await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.ayse.id, classId: s.c3a.id, subjectId: s.english.id }));
  });

  it('lists only the teacher’s own contexts with names and effective module switches (classroom-safe)', async () => {
    const mine = await ok(s.teacherA.get('/api/teacher/contexts'));
    expect(mine.contexts).toHaveLength(1);
    expect(mine.contexts[0]).toMatchObject({ id: s.ctxA.id, className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' } });
    expect(Object.values(mine.contexts[0].modules).every((v) => v === true)).toBe(true);
    expect(Object.keys(mine.contexts[0])).not.toContain('teacherId');
  });
});

describe('module policies (CFG-1/2, ACC-5/12, D-014)', () => {
  it('defaults photo and audio media flags OFF and documents ON', async () => {
    expect(getMediaPolicy(env.db)).toEqual({ studentPhotos: false, evidencePhotos: false, evidenceAudio: false, evidenceDocuments: true, avatarPictures: false });
    const p = await ok(s.admin.get('/api/admin/module-policies'));
    const byKey = Object.fromEntries(p.policies.map((x: any) => [x.module, x]));
    expect(byKey['media.studentPhotos']).toMatchObject({ availability: 'disabled', adminOnly: true });
    expect(byKey['media.evidenceAudio'].availability).toBe('disabled');
    expect(byKey['routines']).toMatchObject({ availability: 'enabled', adminOnly: false });
    expect((await ok(s.teacherA.get('/api/teacher/contexts'))).media).toMatchObject({ 'media.studentPhotos': false, 'media.evidenceDocuments': true });
  });

  it('lets teachers switch modules per context only within admin policy', async () => {
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/secretStudents`, { enabled: false }));
    expect(isModuleEnabled(env.db, s.ctxA.id, 'secretStudents')).toBe(false);
    // Other teachers' contexts are untouched and not editable by this teacher.
    expect(isModuleEnabled(env.db, s.ctxB.id, 'secretStudents')).toBe(true);
    expect((await s.teacherA.put(`/api/teacher/contexts/${s.ctxB.id}/modules/secretStudents`, { enabled: false })).status).toBe(403);
    expect((await s.teacherA.get(`/api/teacher/contexts/${s.ctxB.id}/modules`)).status).toBe(403);
    // Admin turns homework off globally: teachers cannot turn it back on.
    await ok(s.admin.put('/api/admin/module-policies/homework', { availability: 'disabled' }));
    const r = await s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/homework`, { enabled: true });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FEATURE_DISABLED');
    // Media flags are admin-only; they are not teacher-configurable modules.
    expect((await s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/media.studentPhotos`, { enabled: true })).status).toBe(400);
  });

  it('keeps teacher settings and config when a module is disabled and restores them when re-enabled (CFG-2)', async () => {
    const config = { stages: ['Greeting', 'Date and weather', 'Assistant'] };
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/routines`, { enabled: true, config }));
    await ok(s.admin.put('/api/admin/module-policies/routines', { availability: 'disabled' }));
    let mods = (await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/modules`))).modules;
    expect(mods.find((m: any) => m.module === 'routines')).toMatchObject({ available: false, enabled: true, effective: false, config });
    expect(isModuleEnabled(env.db, s.ctxA.id, 'routines')).toBe(false);
    await ok(s.admin.put('/api/admin/module-policies/routines', { availability: 'enabled' }));
    mods = (await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/modules`))).modules;
    expect(mods.find((m: any) => m.module === 'routines')).toMatchObject({ effective: true, config });
    // Teacher-level disable keeps config too.
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/routines`, { enabled: false }));
    mods = (await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/modules`))).modules;
    expect(mods.find((m: any) => m.module === 'routines')).toMatchObject({ enabled: false, config });
  });
});
