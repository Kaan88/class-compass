/**
 * Grouping (S8): GRP-1..8, DSH-8, CFG-1/2, UX-8, ENG-3 "grouping constraints & uneven sizes".
 * Test clock: Monday 2026-11-09, Europe/Istanbul. Fictional names only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Endpoint } from '../../src/shared/contracts/define.ts';
import { registeredEndpoints } from '../../src/server/lib/http.ts';
import { groupingReport } from '../../src/server/modules/grouping/service.ts';
import type { RequestContext } from '../../src/server/lib/context.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { cmd, lessonState, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
let kids: Array<{ id: string; fullName: string }>;
const NAMES = [
  'Ada Yılmaz', 'Barış Kaya', 'Cem Demir', 'Deniz Şahin', 'Ece Çelik', 'Fırat Arslan', 'Gizem Doğan', 'Hakan Kılıç', 'Irmak Aslan', 'İlker Öztürk',
  'Jale Aydın', 'Kaan Özdemir', 'Lale Koç', 'Mert Kurt', 'Nehir Çetin', 'Oğuz Erdem', 'Pelin Ateş', 'Rüzgar Bulut', 'Selin Uçar',
];
// Distinctive private values: the classroom scan below must never find them.
const LEVEL = (i: number) => `LVLSECRET-${['1', '2', '3'][i % 3]}`;
const NOTE = 'NOTEPRIVATE-keep-apart';

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  kids = [];
  for (const fullName of NAMES) kids.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
});
afterEach(async () => env.app.close());

const ctx = () => s.ctxA.id as string;
const overview = (c = s.teacherA) => ok(c.get(`/api/teacher/contexts/${ctx()}/grouping`));
const setLevels = () => ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/levels`, { levels: kids.map((k, i) => ({ studentId: k.id, level: i === 18 ? null : LEVEL(i) })) }));
const count = (sql: string) => (env.db.$client.prepare(sql).get() as { n: number }).n;

describe('default arrangements (GRP-1, GRP-2)', () => {
  it('creates the four default options (Lions/Eagles by level, Dolphins/Tigers mixed; Group 1–5) once per class+subject, never again after archiving (GRP-1 as changed, D-098)', async () => {
    const o = await overview();
    expect(o.templates).toHaveLength(4);
    expect(o.templates.map((t: any) => t.defaultKey)).toEqual(['lions', 'eagles', 'dolphins', 'tigers']);
    expect(o.templates.map((t: any) => t.name.en)).toEqual(['Lions', 'Eagles', 'Dolphins', 'Tigers']);
    expect(o.templates.map((t: any) => t.icon)).toEqual(['lion', 'eagle', 'dolphin', 'tiger']);
    expect(o.templates.map((t: any) => t.mode)).toEqual(['level', 'level', 'mixed', 'mixed']);
    expect(o.canUseNewDefaults).toBe(false);
    // Arrangements, not groups: each makes several groups covering the whole class.
    for (const t of o.templates) {
      expect(t.groups.length).toBeGreaterThan(1);
      expect(t.groups.flatMap((g: any) => g.memberIds).sort()).toEqual(kids.map((k) => k.id).sort());
      const sizes = t.groups.map((g: any) => g.memberIds.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1); // GRP-8 uneven sizes
    }
    for (const t of o.templates) expect(t.groups.map((g: any) => g.memberIds.length).sort()).toEqual([3, 4, 4, 4, 4]); // 19 in 5 groups
    // Neutral group names "Group 1…5" with a number icon (S13a; GRP-6).
    expect(o.templates[0].groups.map((g: any) => g.name.en)).toEqual(['Group 1', 'Group 2', 'Group 3', 'Group 4', 'Group 5']);
    expect(o.templates[0].groups[0]).toMatchObject({ name: { en: 'Group 1', tr: 'Grup 1' }, icon: 'g1' });

    await overview();
    await ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/grouping/arrangements`));
    expect(count("select count(*) n from group_templates")).toBe(4);
    expect(count("select count(*) n from audit_events where action = 'grouping.defaults_created'")).toBe(1);

    await ok(s.teacherA.post(`/api/teacher/grouping/templates/${o.templates[3].id}/archive`, { archived: true }));
    expect((await overview()).templates).toHaveLength(3);
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping?includeArchived=1`))).templates).toHaveLength(4);
    expect(count('select count(*) n from group_templates')).toBe(4);
  });

  it('teachers create, regenerate, change type/size and archive their own arrangements', async () => {
    await setLevels();
    const t = await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/templates`, { name: { en: 'Reading circles' }, mode: 'level', sizing: { groupCount: 3 } }));
    expect(t.groups).toHaveLength(3);
    // Level-based: similar levels together; the student without a level is in the unassessed bucket.
    const levelOf = new Map(kids.map((k, i) => [k.id, i === 18 ? null : LEVEL(i)]));
    const mixedness = t.groups.map((g: any) => new Set(g.memberIds.map((id: string) => levelOf.get(id)).filter(Boolean)).size);
    expect(mixedness.every((n: number) => n <= 2)).toBe(true);
    const mixed = await ok(s.teacherA.put(`/api/teacher/grouping/templates/${t.id}`, { expectedVersion: t.version, mode: 'mixed', sizing: { targetSize: 4 } }));
    expect(mixed.version).toBe(t.version + 1);
    expect(mixed.groups).toHaveLength(4);
    for (const g of mixed.groups) expect(new Set(g.memberIds.map((id: string) => levelOf.get(id)).filter(Boolean)).size).toBe(3); // balanced
    const again = await ok(s.teacherA.post(`/api/teacher/grouping/templates/${t.id}/generate`, { expectedVersion: mixed.version, seed: 'fixed-seed' }));
    const same = await ok(s.teacherA.post(`/api/teacher/grouping/templates/${t.id}/generate`, { expectedVersion: again.version, seed: 'fixed-seed' }));
    expect(same.groups.map((g: any) => g.memberIds)).toEqual(again.groups.map((g: any) => g.memberIds)); // deterministic per seed
    const stale = await s.teacherA.post(`/api/teacher/grouping/templates/${t.id}/generate`, { expectedVersion: again.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.reason).toBe('VERSION_CONFLICT');
    expect(count("select count(*) n from audit_events where action like 'grouping.template_%'")).toBe(4);
    // Another teacher cannot touch it (ACC-10).
    expect((await s.teacherB.put(`/api/teacher/grouping/templates/${t.id}`, { expectedVersion: same.version, name: { en: 'x' } })).status).toBe(403);
  });
});

describe('manual edits, names and roles (GRP-3, GRP-6)', () => {
  it('moves a student, renames a group, sets roles and saves it as a new arrangement', async () => {
    const o = await overview();
    const t = o.templates[0];
    const moved = t.groups[0].memberIds[0];
    const groups = t.groups.map((g: any, i: number) => ({
      id: g.id,
      name: i === 0 ? { en: 'Rockets', tr: 'Roketler' } : g.name,
      icon: g.icon,
      memberIds: i === 0 ? g.memberIds.slice(1) : i === 1 ? [...g.memberIds, moved] : g.memberIds,
      roles: i === 1 ? [{ studentId: moved, label: { en: 'Leader', tr: 'Lider' } }] : [],
    }));
    const edited = await ok(s.teacherA.put(`/api/teacher/grouping/templates/${t.id}`, { expectedVersion: t.version, groups }));
    expect(edited.groups[0].name).toEqual({ en: 'Rockets', tr: 'Roketler' });
    expect(edited.groups[1].memberIds).toContain(moved);
    expect(edited.groups[1].roles).toEqual([{ studentId: moved, label: { en: 'Leader', tr: 'Lider' } }]);
    // A student in two groups or from another class is refused.
    const twice = await s.teacherA.put(`/api/teacher/grouping/templates/${t.id}`, { expectedVersion: edited.version, groups: [{ name: { en: 'A' }, memberIds: [moved] }, { name: { en: 'B' }, memberIds: [moved] }] });
    expect(twice.body.error.details.reason).toBe('STUDENT_IN_TWO_GROUPS');
    const outsider = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Toprak Güneş' });
    const foreign = await s.teacherA.put(`/api/teacher/grouping/templates/${t.id}`, { expectedVersion: edited.version, groups: [{ name: { en: 'A' }, memberIds: [outsider.id] }] });
    expect(foreign.body.error.details.reason).toBe('STUDENT_NOT_IN_CLASS');
    // Save as a new (hand-made) arrangement.
    const copy = await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/templates`, { name: { en: 'My groups' }, mode: 'custom', sizing: { groupCount: 3 }, groups }));
    expect(copy.mode).toBe('custom');
    expect(copy.groups.map((g: any) => g.memberIds)).toEqual(edited.groups.map((g: any) => g.memberIds));
    expect((await overview()).templates).toHaveLength(5);
  });
});

describe('roster changes (GRP-1, GRP-3, review fixes)', () => {
  it('opening grouping before any student is added creates no empty defaults; they are made once students exist', async () => {
    const t = await ok(s.admin.post('/api/admin/classes', { schoolYearId: s.year.id, name: '3-C', grade: 3 }));
    const c = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.ayse.id, classId: t.id, subjectId: s.english.id }));
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${c.id}/grouping`))).templates).toEqual([]);
    expect((await ok(s.teacherA.get(`/api/classroom/contexts/${c.id}/grouping/arrangements`))).arrangements).toEqual([]);
    for (const fullName of ['Ali Can', 'Bora Er', 'Cansu Ak', 'Doruk Su', 'Eda Ay', 'Ferit Ok', 'Gül Tan', 'Harun Gök', 'Işıl Nur']) await addStudent(s.teacherA, t.id, { fullName });
    const o = await ok(s.teacherA.get(`/api/teacher/contexts/${c.id}/grouping`));
    expect(o.templates).toHaveLength(4);
    const three = await ok(s.teacherA.post(`/api/teacher/contexts/${c.id}/grouping/templates`, { name: { en: 'Three' }, mode: 'level', sizing: { groupCount: 3 } }));
    expect(three.groups.map((g: any) => g.memberIds.length)).toEqual([3, 3, 3]);
    const lessonId = await startLesson(s.teacherA, c.id, { othersPresent: true });
    expect((await cmd(s.teacherA, 'grouping.apply', { contextId: c.id, lessonId, templateId: three.id })).ok).toBe(true);
    expect((await lessonState(s.teacherA, c.id)).grouping.groups).toHaveLength(3);
    // A default saved without members (made by an earlier version while the class was empty) is used by
    // its type and size in the lesson, and filled in on the next read without changing its names.
    const lions = o.templates.find((x: any) => x.defaultKey === 'lions');
    env.db.$client.prepare("update group_templates set groups_json = '[]' where id = ?").run(lions.id);
    expect((await cmd(s.teacherA, 'grouping.apply', { contextId: c.id, lessonId, templateId: lions.id })).ok).toBe(true);
    expect((await lessonState(s.teacherA, c.id)).grouping.groups.map((g: any) => g.members.length).sort()).toEqual([1, 2, 2, 2, 2]);
    const again = (await ok(s.teacherA.get(`/api/teacher/contexts/${c.id}/grouping`))).templates.find((x: any) => x.id === lions.id);
    expect(again.groups.map((g: any) => g.memberIds.length).sort()).toEqual([1, 2, 2, 2, 2]);
    expect(again.name).toEqual(lions.name);
  });

  it('an arrangement stays editable after one of its students leaves the class', async () => {
    const o = await overview();
    const t = o.templates[0];
    const leaver = t.groups[0].memberIds[0];
    await ok(s.admin.post('/api/admin/students/move', { studentIds: [leaver], toClassId: s.c3b.id }));
    // The (stale) screen sends every saved member back, including the student who left.
    const groups = t.groups.map((g: any, i: number) => ({ id: g.id, name: i === 0 ? { en: 'Comets' } : g.name, icon: g.icon, memberIds: g.memberIds, roles: [] }));
    const saved = await ok(s.teacherA.put(`/api/teacher/grouping/templates/${t.id}`, { expectedVersion: t.version, groups }));
    expect(saved.groups[0].name).toEqual({ en: 'Comets' });
    expect(saved.groups.flatMap((g: any) => g.memberIds)).not.toContain(leaver);
    expect(saved.groups.flatMap((g: any) => g.memberIds)).toHaveLength(18);
    // A student of another class who was never in the arrangement is still refused.
    const outsider = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Toprak Güneş' });
    const bad = await s.teacherA.put(`/api/teacher/grouping/templates/${t.id}`, { expectedVersion: saved.version, groups: [{ name: { en: 'A' }, memberIds: [outsider.id] }] });
    expect(bad.body.error.details.reason).toBe('STUDENT_NOT_IN_CLASS');
  });
});

describe('pair rules (GRP-4, GRP-8)', () => {
  it("keeps 'apart' students apart, and reports rules that cannot be met with a reason", async () => {
    const [a, b, c] = kids;
    const apart = await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/rules`, { studentA: a!.id, studentB: b!.id, kind: 'apart', note: NOTE }));
    expect(apart).toMatchObject({ kind: 'apart', note: NOTE });
    const dup = await s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/rules`, { studentA: b!.id, studentB: a!.id, kind: 'together' });
    expect(dup.body.error.details.reason).toBe('RULE_EXISTS');
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/rules`, { studentA: a!.id, studentB: c!.id, kind: 'together' }));
    const t = await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/templates`, { name: { en: 'Teams' }, mode: 'mixed', sizing: { groupCount: 4 } }));
    const where = new Map(t.groups.flatMap((g: any, i: number) => g.memberIds.map((id: string) => [id, i])));
    expect(where.get(a!.id)).not.toBe(where.get(b!.id));
    expect(where.get(a!.id)).toBe(where.get(c!.id));
    expect(t.unsatisfied).toEqual([]);
    // One group: 'apart' is impossible and reported transparently.
    const one = await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/templates`, { name: { en: 'Whole class' }, mode: 'mixed', sizing: { groupCount: 1 } }));
    expect(one.unsatisfied).toEqual([{ ruleId: apart.id, a: apart.studentA, b: apart.studentB, kind: 'apart', reason: 'ONE_GROUP' }]);
    // A hand edit that breaks the rule says so.
    const broken = t.groups.map((g: any) => ({ ...g, memberIds: g.memberIds.filter((id: string) => id !== b!.id) }));
    broken[where.get(a!.id) as number].memberIds.push(b!.id);
    const edited = await ok(s.teacherA.put(`/api/teacher/grouping/templates/${t.id}`, { expectedVersion: t.version, groups: broken }));
    expect(edited.unsatisfied).toEqual([expect.objectContaining({ ruleId: apart.id, reason: 'ARRANGED_BY_HAND' })]);
    // Rules are archived, not deleted; audit never stores the note.
    await ok(s.teacherA.post(`/api/teacher/grouping/rules/${apart.id}/archive`, {}));
    expect((await overview()).rules).toHaveLength(1);
    expect(count('select count(*) n from pair_constraints')).toBe(2);
    expect(JSON.stringify(env.db.$client.prepare("select * from audit_events where action like 'grouping.rule%'").all())).not.toContain(NOTE);
  });
});

describe('groups in a lesson (GRP-5, GRP-7, DSH-8)', () => {
  it('19 students with 2 absent: groups for 17 on the display, the saved arrangement unchanged', async () => {
    await setLevels();
    const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true });
    for (const k of kids.slice(0, 2)) expect((await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx(), lessonId, studentId: k.id, status: 'absent' })).ok).toBe(true);
    const arr = await ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/grouping/arrangements`));
    const mixed = arr.arrangements.find((x: any) => x.name.en === 'Dolphins');
    const before = env.db.$client.prepare('select * from group_templates where id = ?').get(mixed.id);
    const r = await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: mixed.id });
    expect(r.ok).toBe(true);
    expect(r.result).toMatchObject({ excludedCount: 2 });
    const st = await lessonState(s.teacherA, ctx());
    expect(st.grouping.applied).toBe(true);
    const shown = st.grouping.groups.flatMap((g: any) => g.members.map((m: any) => m.id));
    expect(shown.sort()).toEqual(kids.slice(2).map((k) => k.id).sort());
    const sizes = st.grouping.groups.map((g: any) => g.members.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(st.grouping.excludedCount).toBe(2);
    // Saved arrangement untouched (GRP-5).
    expect(env.db.$client.prepare('select * from group_templates where id = ?').get(mixed.id)).toEqual(before);
    // Replays are harmless; another arrangement replaces it; clear takes it off the display.
    const replay = await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: mixed.id }, { opId: r.opId });
    expect(replay.replayed).toBe(true);
    expect(count('select count(*) n from lesson_groupings')).toBe(1);
    const pairs = arr.arrangements.find((x: any) => x.name.en === 'Tigers');
    expect((await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: pairs.id })).ok).toBe(true);
    expect(count('select count(*) n from lesson_groupings where cleared_at is null')).toBe(1);
    // A student marked absent later disappears from the display without re-applying.
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx(), lessonId, studentId: kids[5]!.id, status: 'absent' });
    const st2 = await lessonState(s.teacherA, ctx());
    expect(st2.grouping.groups.flatMap((g: any) => g.members.map((m: any) => m.id))).not.toContain(kids[5]!.id);
    expect(st2.grouping.excludedCount).toBe(3);
    expect((await cmd(s.teacherA, 'grouping.clear', { contextId: ctx(), lessonId })).ok).toBe(true);
    expect((await lessonState(s.teacherA, ctx())).grouping).toMatchObject({ applied: false, groups: [] });
    // Wrong lesson / other teacher refused (LES-4, ACC-10).
    expect((await cmd(s.teacherB, 'grouping.apply', { contextId: ctx(), lessonId, templateId: mixed.id })).ok).toBe(false);
  });

  it('no level, arrangement type, rule or note in any classroom-access response (GRP-7 scan)', async () => {
    await setLevels();
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/rules`, { studentA: kids[0]!.id, studentB: kids[1]!.id, kind: 'apart', note: NOTE }));
    const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true });
    const arr = await ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/grouping/arrangements`));
    const level = arr.arrangements[0];
    const applied = await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: level.id });
    const params: Record<string, string> = { contextId: ctx(), classId: s.c3a.id, lessonId, studentId: kids[0]!.id, templateId: level.id };
    const seen = new Set<string>();
    const gets = registeredEndpoints.filter((e: Endpoint) => e.access === 'classroom' && e.method === 'GET' && !seen.has(e.path) && seen.add(e.path));
    expect(gets.length).toBeGreaterThan(8);
    const bodies: string[] = [JSON.stringify(applied), JSON.stringify(arr)];
    for (const e of gets) {
      const url = e.path.replace(/:([A-Za-z0-9_]+)/g, (_m, k: string) => params[k] ?? '0190f0f0-0000-7000-8000-000000000000');
      const r = await s.teacherA.get(url);
      bodies.push(`${url} ${JSON.stringify(r.body)}`);
    }
    const all = bodies.join('\n');
    expect(all).toContain(kids[2]!.fullName); // the scan does see the groups
    expect(all).not.toContain('LVLSECRET');
    expect(all).not.toContain(NOTE);
    // (Counter card levels are numbers 0–3, CNT-6; a subject level would be a string.)
    // Arrangement names must not say "level" either (default names are neutral; review fix).
    const forbidden = /"mode"|"level":"|"rules"|"unsatisfied"|"studentA"|Level|Seviye|seviye/;
    expect(bodies.filter((b) => forbidden.test(b)).map((b) => b.slice(0, 160))).toEqual([]);
  });

  it('a pairs arrangement with absent partners makes no "pair" of one; a late arrival is counted as not in a group yet (GRP-5, review fix)', async () => {
    const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true });
    await overview();
    const pairs = await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/templates`, { name: { en: 'Pairs' }, mode: 'mixed', sizing: { targetSize: 2 } }));
    // One member of each of four pairs is absent.
    const away = pairs.groups.slice(0, 4).map((g: any) => g.memberIds[0]);
    for (const id of away) expect((await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx(), lessonId, studentId: id, status: 'absent' })).ok).toBe(true);
    expect((await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: pairs.id })).ok).toBe(true);
    let st = (await lessonState(s.teacherA, ctx())).grouping;
    const sizes = st.groups.map((g: any) => g.members.length);
    expect(sizes.reduce((a: number, b: number) => a + b, 0)).toBe(15);
    expect(Math.min(...sizes)).toBe(2);
    expect(st).toMatchObject({ excludedCount: 4, notPlacedCount: 0 });
    // One of them arrives late: present now, in no group until the groups are chosen again.
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx(), lessonId, studentId: away[0], status: 'present' });
    st = (await lessonState(s.teacherA, ctx())).grouping;
    expect(st).toMatchObject({ excludedCount: 3, notPlacedCount: 1 });
    expect((await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: pairs.id })).ok).toBe(true);
    st = (await lessonState(s.teacherA, ctx())).grouping;
    expect(st).toMatchObject({ excludedCount: 3, notPlacedCount: 0 });
    expect(st.groups.flatMap((g: any) => g.members.map((m: any) => m.id))).toContain(away[0]);
    // RPT-5: applying again in the same lesson does not count the lesson twice.
    const report = groupingReport({ db: env.db } as unknown as RequestContext, { contextId: ctx(), from: '2026-11-01', to: '2026-11-30' });
    expect(report).toEqual({ lessonsWithGroups: 1, arrangementsUsed: [{ templateId: pairs.id, lessons: 1 }] });
  });

  it('switching the module off keeps every arrangement and rule; classroom access answers FEATURE_DISABLED (CFG-1, CFG-2)', async () => {
    const o = await overview();
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/rules`, { studentA: kids[0]!.id, studentB: kids[1]!.id, kind: 'apart' }));
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/modules/grouping`, { enabled: false }));
    const r = await s.teacherA.get(`/api/classroom/contexts/${ctx()}/grouping/arrangements`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FEATURE_DISABLED');
    const lessonId = await startLesson(s.teacherA, ctx());
    expect((await lessonState(s.teacherA, ctx())).grouping).toBeNull();
    expect((await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: o.templates[0].id })).error?.code).toBe('FEATURE_DISABLED');
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/modules/grouping`, { enabled: true }));
    const back = await overview();
    expect(back.templates.map((t: any) => t.id)).toEqual(o.templates.map((t: any) => t.id));
    expect(back.rules).toHaveLength(1);
  });
});
