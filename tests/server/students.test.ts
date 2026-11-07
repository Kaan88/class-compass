import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
});
afterEach(async () => env.app.close());

describe('class rosters (ACC-4, ACC-7, CRD-1)', () => {
  it('normalises Turkish names, sorts with Turkish collation and returns minimal fields to the classroom', async () => {
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'ŞEVVAL  IŞIK', studentNumber: '1203' });
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'çınar öztürk' });
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'İpek Ayşe Nur Kara Yılmaz', givenNames: 'İpek Ayşe Nur', familyName: 'Kara Yılmaz' });
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'Can Demir' });
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ilgın Ünal' });
    const room = await ok(s.teacherA.get(`/api/classroom/classes/${s.c3a.id}/roster`));
    // UX-5: Turkish casing (ŞEVVAL IŞIK → Şevval Işık) and collation (C < Ç, I < İ, S < Ş).
    expect(room.students.map((x: any) => x.fullName)).toEqual(['Can Demir', 'Çınar Öztürk', 'Ilgın Ünal', 'İpek Ayşe Nur Kara Yılmaz', 'Şevval Işık']);
    expect(room.students.find((x: any) => x.fullName === 'Şevval Işık').initials).toBe('ŞI');
    expect(room.students.find((x: any) => x.fullName.startsWith('İpek')).initials).toBe('İY');
    // Classroom view carries no numbers, levels or consent flags.
    for (const st of room.students) expect(Object.keys(st).sort()).toEqual(['avatarHue', 'fullName', 'id', 'initials']);
    const full = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/students`));
    expect(full.students.find((x: any) => x.fullName === 'Şevval Işık')).toMatchObject({ studentNumber: '1203', photoConsent: false, active: true, enrolledFrom: '2026-11-09' });
  });

  it('stores names in NFC so decomposed input matches precomposed names', async () => {
    const decomposed = 'Ayşe Gül'.normalize('NFD');
    const a = await addStudent(s.teacherA, s.c3a.id, { fullName: decomposed });
    expect(a.fullName).toBe('Ayşe Gül'.normalize('NFC'));
  });

  it('denies a teacher the roster and edits of a class they are not assigned to', async () => {
    const stuB = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Deniz Koç' });
    for (const r of [
      await s.teacherA.get(`/api/classroom/classes/${s.c3b.id}/roster`),
      await s.teacherA.get(`/api/teacher/classes/${s.c3b.id}/students`),
      await s.teacherA.post(`/api/teacher/classes/${s.c3b.id}/students`, { fullName: 'Ece Kurt' }),
      await s.teacherA.patch(`/api/teacher/students/${stuB.id}`, { fullName: 'Changed Name' }),
      await s.teacherA.get(`/api/teacher/contexts/${s.ctxB.id}/levels`),
      await s.teacherA.put(`/api/teacher/contexts/${s.ctxB.id}/levels`, { levels: [{ studentId: stuB.id, level: 'A' }] }),
    ]) {
      expect(r.status).toBe(403);
    }
    expect((await ok(s.teacherB.get(`/api/teacher/classes/${s.c3b.id}/students`))).students[0].fullName).toBe('Deniz Koç');
  });

  it('warns about possible duplicates by folded name or student number and never merges (IMP-4)', async () => {
    const first = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ömer Işık', studentNumber: '77' });
    const dupName = await s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/students`, { fullName: 'OMER ISIK' });
    expect(dupName.status).toBe(409);
    expect(dupName.body.error.details).toMatchObject({ reason: 'POSSIBLE_DUPLICATE', candidates: [{ id: first.id, fullName: 'Ömer Işık', className: '3-A', active: true }] });
    const dupNumber = await s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/students`, { fullName: 'Someone Else', studentNumber: '77' });
    expect(dupNumber.body.error.details.reason).toBe('STUDENT_NUMBER_TAKEN');
    // Confirmed as a different child → a separate identity.
    const second = await addStudent(s.teacherA, s.c3a.id, { fullName: 'OMER ISIK', allowDuplicateName: true });
    expect(second.id).not.toBe(first.id);
    expect((await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/students`))).students).toHaveLength(2);
  });

  it('does not reveal other classes’ students in duplicate warnings to teachers (ACC-4)', async () => {
    await addStudent(s.teacherB, s.c3b.id, { fullName: 'Zeynep Arslan' });
    const r = await s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/students`, { fullName: 'Zeynep Arslan' });
    expect(r.status).toBe(409);
    expect(r.body.error.details).toMatchObject({ reason: 'POSSIBLE_DUPLICATE', candidates: [], otherMatches: 1 });
  });

  it('warns when a rename would duplicate another student’s name, unless confirmed (D-022, UX-5)', async () => {
    const ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Yurt' });
    const ece = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ece Yurt' });
    const r = await s.teacherA.patch(`/api/teacher/students/${ece.id}`, { fullName: 'ADA YURT' });
    expect(r.status).toBe(409);
    expect(r.body.error.details).toMatchObject({ reason: 'POSSIBLE_DUPLICATE', candidates: [{ id: ada.id, fullName: 'Ada Yurt', className: '3-A', active: true }] });
    // A casing fix of the student's own name is not a duplicate of itself.
    await ok(s.teacherA.patch(`/api/teacher/students/${ada.id}`, { fullName: 'ada yurt' }));
    // Confirmed as a different child: allowed, still two identities.
    expect((await ok(s.teacherA.patch(`/api/teacher/students/${ece.id}`, { fullName: 'ADA YURT', allowDuplicateName: true }))).fullName).toBe('Ada Yurt');
    expect((await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/students`))).students).toHaveLength(2);
  });

  it('reports a deactivated student with the same name so they are reactivated, not duplicated (ACC-7, IMP-4)', async () => {
    const left = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Kuzey Tan' });
    await ok(s.admin.post(`/api/admin/students/${left.id}/deactivate`));
    const r = await s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/students`, { fullName: 'kuzey tan' });
    expect(r.status).toBe(409);
    expect(r.body.error.details).toMatchObject({ reason: 'POSSIBLE_DUPLICATE', candidates: [{ id: left.id, active: false }], inactiveMatches: 1 });
    // Another class's teacher only learns that an inactive match exists, not who it is (ACC-4).
    const other = await s.teacherB.post(`/api/teacher/classes/${s.c3b.id}/students`, { fullName: 'Kuzey Tan' });
    expect(other.body.error.details).toMatchObject({ reason: 'POSSIBLE_DUPLICATE', candidates: [], otherMatches: 1, inactiveMatches: 1 });
  });

  it('audits student edits with the acting teacher (ACC-9, DAT-5)', async () => {
    const st = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Mert Polat' });
    await ok(s.teacherA.patch(`/api/teacher/students/${st.id}`, { fullName: 'mert can polat', studentNumber: '501', photoConsent: true }));
    const log = await ok(s.admin.get(`/api/admin/audit?entity=student&entityId=${st.id}`));
    const upd = log.items.find((i: any) => i.action === 'student.update');
    expect(upd).toMatchObject({ actorId: s.ayse.id, actorName: 'Test ayse.teacher', before: { fullName: 'Mert Polat', studentNumber: null }, after: { fullName: 'Mert Can Polat', studentNumber: '501', photoConsent: true } });
  });
});

describe('subject levels (GRP-3, GRP-7)', () => {
  it('stores levels per subject for the teacher and never exposes them on classroom endpoints', async () => {
    const a = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Asya Bulut' });
    const b = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Berk Tekin' });
    const set = await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/levels`, { levels: [{ studentId: a.id, level: 'Confident' }, { studentId: b.id, level: 'Developing' }] }));
    expect(set.levels).toEqual([
      { studentId: a.id, level: 'Confident' },
      { studentId: b.id, level: 'Developing' },
    ]);
    const room = await s.teacherA.get(`/api/classroom/classes/${s.c3a.id}/roster`);
    const contexts = await s.teacherA.get('/api/teacher/contexts');
    for (const body of [JSON.stringify(room.body), JSON.stringify(contexts.body)]) {
      expect(body).not.toContain('Confident');
      expect(body).not.toContain('Developing');
    }
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/levels`, { levels: [{ studentId: a.id, level: null }] }));
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/levels`))).levels[0]).toEqual({ studentId: a.id, level: null });
    // A student outside the class cannot be given a level through this context.
    const other = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Kerem Uğurlu' });
    expect((await s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/levels`, { levels: [{ studentId: other.id, level: 'A' }] })).status).toBe(403);
  });
});

describe('enrolment history: move, promote, deactivate (DAT-2, DAT-3)', () => {
  it('moves a student within the year, closing the old enrolment and keeping history', async () => {
    const st = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Duru Şimşek' });
    expect((await s.admin.post('/api/admin/students/move', { studentIds: [st.id], toClassId: s.c3b.id, date: '2026-11-01' })).status).toBe(400);
    const r = await ok(s.admin.post('/api/admin/students/move', { studentIds: [st.id], toClassId: s.c3b.id, date: '2026-11-12' }));
    expect(r).toEqual({ moved: [st.id], skipped: [] });
    const detail = await ok(s.admin.get(`/api/admin/students/${st.id}`));
    expect(detail.currentClassName).toBe('3-A'); // the move takes effect on 12 Nov
    expect(detail.enrolments).toMatchObject([
      { className: '3-A', fromDate: '2026-11-09', toDate: '2026-11-12', reason: 'added' },
      { className: '3-B', fromDate: '2026-11-12', toDate: null, reason: 'move' },
    ]);
    // Moving again into the same class is reported, not duplicated.
    expect((await ok(s.admin.post('/api/admin/students/move', { studentIds: [st.id], toClassId: s.c3b.id }))).skipped).toEqual([{ studentId: st.id, reason: 'ALREADY_IN_CLASS' }]);
    // Rosters are date-aware (D-021): until 12 Nov the student is still in 3-A.
    expect((await ok(s.teacherA.get(`/api/classroom/classes/${s.c3a.id}/roster`))).students.map((x: any) => x.id)).toEqual([st.id]);
    expect((await ok(s.teacherB.get(`/api/classroom/classes/${s.c3b.id}/roster`))).students).toEqual([]);
    env.clock.advance(3 * 24 * 60 * 60 * 1000); // Thursday 12 Nov
    const a = new Client(env);
    await a.login('ayse.teacher');
    const b = new Client(env);
    await b.login('mehmet.teacher');
    expect((await ok(a.get(`/api/classroom/classes/${s.c3a.id}/roster`))).students).toEqual([]);
    expect((await ok(b.get(`/api/classroom/classes/${s.c3b.id}/roster`))).students.map((x: any) => x.id)).toEqual([st.id]);
    const admin = new Client(env);
    await admin.login('root.admin');
    expect((await ok(admin.get(`/api/admin/students/${st.id}`))).currentClassName).toBe('3-B');
  });

  it('rejects move dates outside the target class’s school year (DAT-1, DAT-2)', async () => {
    const st = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Lina Erdem' });
    const r = await s.admin.post('/api/admin/students/move', { studentIds: [st.id], toClassId: s.c3b.id, date: '2027-08-01' });
    expect(r.status).toBe(400);
    expect(r.body.error.details.reason).toBe('MOVE_DATE_OUTSIDE_YEAR');
    expect((await ok(s.admin.get(`/api/admin/students/${st.id}`))).enrolments).toHaveLength(1);
  });

  it('refuses to move or promote students out of an archived class (DAT-1, D-021)', async () => {
    const st = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Mira Tunç' });
    const next = await ok(s.admin.post('/api/admin/years', { name: '2027–2028', startsOn: '2027-09-01', endsOn: '2028-06-30' }));
    const c4a = await ok(s.admin.post('/api/admin/classes', { schoolYearId: next.id, name: '4-A', grade: 4 }));
    await ok(s.admin.post(`/api/admin/classes/${s.c3a.id}/archive`));
    for (const r of [
      await s.admin.post('/api/admin/students/move', { studentIds: [st.id], toClassId: s.c3b.id }),
      await s.admin.post(`/api/admin/classes/${s.c3a.id}/promote`, { toClassId: c4a.id }),
    ]) {
      expect(r.status).toBe(409);
      expect(r.body.error.details.reason).toBe('CLASS_ARCHIVED');
    }
    expect((await ok(s.admin.get(`/api/admin/students/${st.id}`))).enrolments).toMatchObject([{ className: '3-A', toDate: null }]);
    await ok(s.admin.post(`/api/admin/classes/${s.c3a.id}/unarchive`));
    await ok(s.admin.post('/api/admin/students/move', { studentIds: [st.id], toClassId: s.c3b.id }));
  });

  it('keeps the current class roster after a promotion dated in the new year, until that year starts (DAT-2, D-021)', async () => {
    const a = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Aras Keskin' });
    const b = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Bade Uysal' });
    const next = await ok(s.admin.post('/api/admin/years', { name: '2027–2028', startsOn: '2027-09-01', endsOn: '2028-06-30' }));
    const c4a = await ok(s.admin.post('/api/admin/classes', { schoolYearId: next.id, name: '4-A', grade: 4 }));
    // A promotion dated inside the current year would put a next-year enrolment in this year.
    const bad = await s.admin.post(`/api/admin/classes/${s.c3a.id}/promote`, { toClassId: c4a.id, date: '2027-03-01' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.reason).toBe('MOVE_DATE_OUTSIDE_YEAR');
    await ok(s.admin.post(`/api/admin/classes/${s.c3a.id}/promote`, { toClassId: c4a.id }));
    // In November 3-A still lists both students; 4-A is empty until 1 September.
    expect((await ok(s.teacherA.get(`/api/classroom/classes/${s.c3a.id}/roster`))).students.map((x: any) => x.id).sort()).toEqual([a.id, b.id].sort());
    const counts = async (c: Client) => Object.fromEntries((await ok(c.get('/api/admin/classes'))).classes.map((x: any) => [x.name, x.studentCount]));
    expect(await counts(s.admin)).toMatchObject({ '3-A': 2, '4-A': 0 });
    expect(await ok(s.admin.get(`/api/admin/students/${a.id}`))).toMatchObject({ currentClassName: '3-A' });
    // The old enrolment ends the day after the old year ends, not over the summer.
    expect((await ok(s.admin.get(`/api/admin/students/${a.id}`))).enrolments.map((e: any) => [e.className, e.fromDate, e.toDate])).toEqual([
      ['3-A', '2026-11-09', '2027-07-01'],
      ['4-A', '2027-09-01', null],
    ]);
    // Teachers can still edit the student in their current class.
    await ok(s.teacherA.patch(`/api/teacher/students/${a.id}`, { studentNumber: '3001' }));
    env.clock.t = Date.UTC(2027, 8, 2, 7, 0, 0); // 2 Sep 2027
    const admin = new Client(env);
    await admin.login('root.admin');
    expect(await counts(admin)).toMatchObject({ '3-A': 0, '4-A': 2 });
    expect(await ok(admin.get(`/api/admin/students/${a.id}`))).toMatchObject({ currentClassName: '4-A' });
  });

  it('promotes a whole class into a new year and preserves the old enrolments', async () => {
    const a = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Efe Çakır' });
    const b = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Hira Öner' });
    const gone = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Toprak Sağlam' });
    await ok(s.admin.post(`/api/admin/students/${gone.id}/deactivate`));
    const next = await ok(s.admin.post('/api/admin/years', { name: '2027–2028', startsOn: '2027-09-01', endsOn: '2028-06-30' }));
    const c4a = await ok(s.admin.post('/api/admin/classes', { schoolYearId: next.id, name: '4-A', grade: 4 }));
    // Same-year target is rejected: promotion goes to another year.
    expect((await s.admin.post(`/api/admin/classes/${s.c3a.id}/promote`, { toClassId: s.c3b.id })).status).toBe(400);
    const report = await ok(s.admin.post(`/api/admin/classes/${s.c3a.id}/promote`, { toClassId: c4a.id }));
    expect(report.moved.sort()).toEqual([a.id, b.id].sort());
    expect(report.skipped).toEqual([{ studentId: gone.id, reason: 'DEACTIVATED' }]);
    const detail = await ok(s.admin.get(`/api/admin/students/${a.id}`));
    expect(detail.enrolments).toMatchObject([
      { className: '3-A', schoolYearId: s.year.id, fromDate: '2026-11-09', toDate: '2027-07-01', reason: 'added' },
      { className: '4-A', schoolYearId: next.id, fromDate: '2027-09-01', toDate: null, reason: 'promotion' },
    ]);
    // Old year can now be archived; its history stays readable.
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/archive`));
    expect((await ok(s.admin.get(`/api/admin/students/${a.id}`))).enrolments).toHaveLength(2);
    // Archived years refuse further moves.
    const late = await addStudentAdmin(c4a.id, 'Nehir Güneş');
    const r = await s.admin.post('/api/admin/students/move', { studentIds: [late.id], toClassId: s.c3b.id });
    expect(r.status).toBe(409);
  });

  async function addStudentAdmin(classId: string, fullName: string) {
    return ok(s.admin.post('/api/admin/students', { classId, fullName }));
  }

  it('deactivates and reactivates a student without touching enrolments', async () => {
    const st = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Poyraz Ergün' });
    await ok(s.admin.post(`/api/admin/students/${st.id}/deactivate`));
    expect((await ok(s.teacherA.get(`/api/classroom/classes/${s.c3a.id}/roster`))).students).toEqual([]);
    expect((await s.teacherA.patch(`/api/teacher/students/${st.id}`, { fullName: 'X Y' })).status).toBe(409);
    expect((await ok(s.admin.get('/api/admin/students'))).total).toBe(0);
    const all = await ok(s.admin.get('/api/admin/students?includeDeactivated=true'));
    expect(all.students[0]).toMatchObject({ id: st.id, active: false, currentClassName: '3-A' });
    await ok(s.admin.post(`/api/admin/students/${st.id}/reactivate`));
    expect((await ok(s.teacherA.get(`/api/classroom/classes/${s.c3a.id}/roster`))).students.map((x: any) => x.id)).toEqual([st.id]);
    expect((await ok(s.admin.get(`/api/admin/students/${st.id}`))).enrolments).toHaveLength(1);
  });

  it('filters the school-wide student list by class, year and folded search text', async () => {
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'Gökçe Yıldız', studentNumber: '9001' });
    await addStudent(s.teacherB, s.c3b.id, { fullName: 'Göktuğ Aydın' });
    expect((await ok(s.admin.get(`/api/admin/students?classId=${s.c3b.id}`))).students.map((x: any) => x.fullName)).toEqual(['Göktuğ Aydın']);
    expect((await ok(s.admin.get(`/api/admin/students?q=gokce`))).students.map((x: any) => x.fullName)).toEqual(['Gökçe Yıldız']);
    expect((await ok(s.admin.get(`/api/admin/students?q=9001`))).total).toBe(1);
    expect((await ok(s.admin.get(`/api/admin/students?yearId=${s.year.id}&pageSize=1`))).students).toHaveLength(1);
  });
});
