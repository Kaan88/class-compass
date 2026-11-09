/**
 * S14c (D-150): drag and drop on the classroom group screen moves a student into "Not in a group"
 * with the `grouping.move` target `UNPLACED` (GRP-5, UX-8, UX-11). Save to option leaves out whom the
 * teacher took out; late arrivals not placed keep their saved group. Test clock: Monday 2026-11-09,
 * Europe/Istanbul. Fictional names only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UNPLACED } from '../../src/shared/contracts/grouping.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { cmd, lessonState, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
let kids: Array<{ id: string; fullName: string }>;
const NAMES = ['Ada Yılmaz', 'Barış Kaya', 'Cem Demir', 'Deniz Şahin', 'Ece Çelik', 'Fırat Arslan', 'Gizem Doğan', 'Hakan Kılıç', 'Irmak Aslan', 'İlker Öztürk'];

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  kids = [];
  for (const fullName of NAMES) kids.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
});
afterEach(async () => env.app.close());

const ctx = () => s.ctxA.id as string;
const count = (sql: string, ...args: unknown[]) => (env.db.$client.prepare(sql).get(...args) as { n: number }).n;
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

async function lessonWithLions() {
  const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true });
  const o = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping`));
  const lions = o.templates.find((t: any) => t.defaultKey === 'lions');
  expect((await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: lions.id })).ok).toBe(true);
  return { lessonId, lions };
}

describe('grouping.move to UNPLACED (S14c, D-150)', () => {
  it('takes a present student out of every group (UX-8); a second unplace and a place back work; replays are harmless (UX-11)', async () => {
    const { lessonId } = await lessonWithLions();
    const st = (await lessonState(s.teacherA, ctx())).grouping;
    const g1 = st.groups[0];
    const who = g1.members[0].id as string;
    expect(st.notPlaced).toEqual([]);

    const out = await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: who, toGroupId: UNPLACED });
    expect(out).toMatchObject({ ok: true, result: { moved: true, from: g1.id } });
    let now = (await lessonState(s.teacherA, ctx())).grouping;
    expect(now.groups.flatMap((g: any) => ids(g.members))).not.toContain(who);
    expect(ids(now.notPlaced)).toEqual([who]);
    expect(now.notPlacedCount).toBe(1);
    // The same opId again is a replay, not a second move.
    const replay = await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: who, toGroupId: UNPLACED }, { opId: out.opId });
    expect(replay.replayed).toBe(true);
    // Unplacing a student who is in no group changes nothing.
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: who, toGroupId: UNPLACED })).result).toMatchObject({ moved: false, from: null });
    expect(count("select count(*) n from audit_events where action = 'grouping.move'")).toBe(1);
    const audit = env.db.$client.prepare("select after_json a from audit_events where action = 'grouping.move'").get() as { a: string };
    expect(JSON.parse(audit.a)).toMatchObject({ studentId: who, from: g1.id, to: UNPLACED });

    // Placing them again (tap "Move here" or a drop on a group) works as before.
    const g2 = now.groups[1];
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: who, toGroupId: g2.id })).result).toMatchObject({ moved: true, from: null });
    now = (await lessonState(s.teacherA, ctx())).grouping;
    expect(ids(now.groups[1].members)).toContain(who);
    expect(now.notPlaced).toEqual([]);
  });

  it('a role goes with the student; absent students and other teachers are refused (ACC-10, LES-4)', async () => {
    const { lessonId, lions } = await lessonWithLions();
    const g = lions.groups[0];
    const who = g.memberIds[0] as string;
    // Give the student a role in the option and use it again, so the lesson grouping has the role.
    const saved = await ok(
      s.teacherA.put(`/api/teacher/grouping/templates/${lions.id}`, {
        expectedVersion: lions.version,
        groups: lions.groups.map((x: any) => ({ id: x.id, name: x.name, icon: x.icon, memberIds: x.memberIds, roles: x.id === g.id ? [{ studentId: who, label: { en: 'Leader' } }] : [] })),
      }),
    );
    expect((await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: saved.id })).ok).toBe(true);
    expect((await lessonState(s.teacherA, ctx())).grouping.groups[0].members.find((m: any) => m.id === who).role).toEqual({ en: 'Leader' });
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: who, toGroupId: UNPLACED })).ok).toBe(true);
    const live = env.db.$client.prepare('select effective_groups_json j from lesson_groupings where lesson_id = ? and cleared_at is null').get(lessonId) as { j: string };
    expect(JSON.parse(live.j).flatMap((x: any) => x.roles)).toEqual([]);

    const away = kids.find((k) => k.id !== who)!;
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx(), lessonId, studentId: away.id, status: 'absent' });
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: away.id, toGroupId: UNPLACED })).error?.reason).toBe('STUDENT_NOT_PRESENT');
    expect((await cmd(s.teacherB, 'grouping.move', { contextId: ctx(), lessonId, studentId: kids[2]!.id, toGroupId: UNPLACED })).ok).toBe(false);
    // Without groups on the display there is nothing to take a student out of.
    expect((await cmd(s.teacherA, 'grouping.clear', { contextId: ctx(), lessonId })).ok).toBe(true);
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: kids[2]!.id, toGroupId: UNPLACED })).error?.reason).toBe('GROUPS_NOT_SHOWN');
  });

  it('save to option: a student taken out with UNPLACED is in no group, an absent one keeps theirs (GRP-5)', async () => {
    const { lessonId, lions } = await lessonWithLions();
    const absent = lions.groups[1].memberIds[0] as string;
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx(), lessonId, studentId: absent, status: 'absent' });
    const who = lions.groups[0].memberIds[0] as string;
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: who, toGroupId: UNPLACED })).ok).toBe(true);
    expect((await cmd(s.teacherA, 'grouping.saveToOption', { contextId: ctx(), lessonId })).ok).toBe(true);
    const t2 = (await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping`))).templates.find((t: any) => t.id === lions.id);
    const savedMembers = t2.groups.flatMap((g: any) => g.memberIds);
    expect(savedMembers).not.toContain(who);
    expect(t2.groups.find((g: any) => g.id === lions.groups[1].id).memberIds).toContain(absent);
    expect(savedMembers.sort()).toEqual(kids.map((k) => k.id).filter((id) => id !== who).sort());
    // Next time the option is used, the unplaced student joins the smallest group again (GRP-5 fit).
    expect((await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: lions.id })).ok).toBe(true);
    expect((await lessonState(s.teacherA, ctx())).grouping.notPlaced).toEqual([]);
  });

  it('save to option keeps the saved group and role of a late arrival the teacher has not placed (GRP-5, D-098)', async () => {
    const { lessonId, lions } = await lessonWithLions();
    const g = lions.groups[0];
    const late = g.memberIds[0] as string;
    // A role in the option for the student who will arrive late.
    const withRole = await ok(
      s.teacherA.put(`/api/teacher/grouping/templates/${lions.id}`, {
        expectedVersion: lions.version,
        groups: lions.groups.map((x: any) => ({ id: x.id, name: x.name, icon: x.icon, memberIds: x.memberIds, roles: x.id === g.id ? [{ studentId: late, label: { en: 'Leader' } }] : [] })),
      }),
    );
    // Away when the option is used, marked late afterwards: listed under "Not in a group".
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx(), lessonId, studentId: late, status: 'absent' });
    expect((await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: withRole.id })).ok).toBe(true);
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx(), lessonId, studentId: late, status: 'late' });
    const st = (await lessonState(s.teacherA, ctx())).grouping;
    expect(ids(st.notPlaced)).toEqual([late]);
    // The teacher moves someone else and saves: the late arrival's saved place and role survive.
    const other = st.groups[1].members[0].id as string;
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: other, toGroupId: st.groups[2].id })).ok).toBe(true);
    expect((await cmd(s.teacherA, 'grouping.saveToOption', { contextId: ctx(), lessonId })).ok).toBe(true);
    const t2 = (await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping`))).templates.find((t: any) => t.id === lions.id);
    const savedG = t2.groups.find((x: any) => x.id === g.id);
    expect(savedG.memberIds).toContain(late);
    expect(savedG.roles).toEqual([{ studentId: late, label: { en: 'Leader' } }]);
    expect(t2.groups.flatMap((x: any) => x.memberIds).sort()).toEqual(kids.map((k) => k.id).sort());
  });

  it('a late arrival placed by hand and then taken out is saved in no group (GRP-5)', async () => {
    const { lessonId, lions } = await lessonWithLions();
    const late = lions.groups[0].memberIds[0] as string;
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx(), lessonId, studentId: late, status: 'absent' });
    expect((await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: lions.id })).ok).toBe(true);
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx(), lessonId, studentId: late, status: 'late' });
    const st = (await lessonState(s.teacherA, ctx())).grouping;
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: late, toGroupId: st.groups[1].id })).ok).toBe(true);
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: late, toGroupId: UNPLACED })).ok).toBe(true);
    expect(ids((await lessonState(s.teacherA, ctx())).grouping.notPlaced)).toEqual([late]);
    expect((await cmd(s.teacherA, 'grouping.saveToOption', { contextId: ctx(), lessonId })).ok).toBe(true);
    const t2 = (await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping`))).templates.find((t: any) => t.id === lions.id);
    expect(t2.groups.flatMap((x: any) => x.memberIds)).not.toContain(late);
  });

  it('the payload refuses an empty or over-long target (contract)', async () => {
    const { lessonId } = await lessonWithLions();
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: kids[0]!.id, toGroupId: '' })).ok).toBe(false);
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: kids[0]!.id, toGroupId: 'x'.repeat(65) })).ok).toBe(false);
  });
});
