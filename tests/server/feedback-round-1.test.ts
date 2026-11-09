/**
 * S13a feedback round 1 (D-098..D-104): grouping in the lesson (shuffle/undo/move/save, the four
 * default options), assistant duty ticks, lesson topics, per-class language, account interface
 * language and the counters reminder boxes. Test clock: Monday 2026-11-09, Europe/Istanbul.
 * Fictional names only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { cmd, endLesson, lessonState, startLesson } from '../lesson-helpers.ts';
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
const members = (st: any) => st.grouping.groups.map((g: any) => g.members.map((m: any) => m.id).sort());

describe('grouping in the lesson (S13a, D-098)', () => {
  it('shuffle makes new groups of present students, undo brings the previous ones back, replays are harmless', async () => {
    const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true });
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx(), lessonId, studentId: kids[0]!.id, status: 'absent' });
    const arr = await ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/grouping/arrangements`));
    expect(arr.arrangements.map((a: any) => a.icon)).toEqual(['lion', 'eagle', 'dolphin', 'tiger']);
    const dolphins = arr.arrangements.find((a: any) => a.name.en === 'Dolphins');
    // Nothing to shuffle before groups are shown.
    expect((await cmd(s.teacherA, 'grouping.shuffle', { contextId: ctx(), lessonId })).error?.reason).toBe('GROUPS_NOT_SHOWN');
    expect((await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: dolphins.id })).ok).toBe(true);
    const first = await lessonState(s.teacherA, ctx());
    expect(first.grouping.groups).toHaveLength(5);
    const firstId = first.grouping.groupingId;
    const shuffled = await cmd(s.teacherA, 'grouping.shuffle', { contextId: ctx(), lessonId });
    expect(shuffled.ok).toBe(true);
    expect(shuffled.result.previousId).toBe(firstId);
    const after = await lessonState(s.teacherA, ctx());
    expect(after.grouping.groupingId).not.toBe(firstId);
    const placed = after.grouping.groups.flatMap((g: any) => g.members.map((m: any) => m.id)).sort();
    expect(placed).toEqual(kids.slice(1).map((k) => k.id).sort()); // the absent student is left out
    expect(after.grouping.groups.map((g: any) => g.name.en)).toEqual(['Group 1', 'Group 2', 'Group 3', 'Group 4', 'Group 5']);
    // Replaying the same shuffle opId changes nothing.
    expect((await cmd(s.teacherA, 'grouping.shuffle', { contextId: ctx(), lessonId }, { opId: shuffled.opId })).replayed).toBe(true);
    expect(count('select count(*) n from lesson_groupings where lesson_id = ?', lessonId)).toBe(2);
    // Undo.
    expect((await cmd(s.teacherA, 'grouping.restore', { contextId: ctx(), lessonId, groupingId: firstId })).ok).toBe(true);
    const back = await lessonState(s.teacherA, ctx());
    expect(back.grouping.groupingId).toBe(firstId);
    expect(members(back)).toEqual(members(first));
    expect(count('select count(*) n from lesson_groupings where lesson_id = ? and cleared_at is null', lessonId)).toBe(1);
    // A grouping of another lesson cannot be restored here.
    expect((await cmd(s.teacherA, 'grouping.restore', { contextId: ctx(), lessonId, groupingId: '0190f0f0-0000-7000-8000-000000000000' })).error?.reason).toBe('GROUPING_NOT_FOUND');
    expect(count("select count(*) n from audit_events where action in ('grouping.shuffle','grouping.restore')")).toBe(2);
  });

  it('move puts a student into another group at once; absent students and unknown groups are refused; save to option keeps it', async () => {
    const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true });
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctx(), lessonId, studentId: kids[9]!.id, status: 'absent' });
    const o = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping`));
    const lions = o.templates.find((t: any) => t.defaultKey === 'lions');
    expect((await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: lions.id })).ok).toBe(true);
    const st = await lessonState(s.teacherA, ctx());
    const [g1, g2] = st.grouping.groups;
    const who = g1.members[0].id as string;
    const moved = await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: who, toGroupId: g2.id });
    expect(moved).toMatchObject({ ok: true, result: { moved: true, from: g1.id } });
    const now = await lessonState(s.teacherA, ctx());
    expect(now.grouping.groups[1].members.map((m: any) => m.id)).toContain(who);
    expect(now.grouping.groups[0].members.map((m: any) => m.id)).not.toContain(who);
    // Moving again to the same group changes nothing.
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: who, toGroupId: g2.id })).result).toMatchObject({ moved: false });
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: kids[9]!.id, toGroupId: g2.id })).error?.reason).toBe('STUDENT_NOT_PRESENT');
    expect((await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: who, toGroupId: '0190f0f0-0000-7000-8000-000000000000' })).error?.reason).toBe('GROUP_NOT_FOUND');
    // The saved option is untouched until "Save to option".
    const absentGroup = lions.groups.find((g: any) => g.memberIds.includes(kids[9]!.id)).id;
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping`))).templates.find((t: any) => t.id === lions.id).groups[1].memberIds).not.toContain(who);
    const saved = await cmd(s.teacherA, 'grouping.saveToOption', { contextId: ctx(), lessonId });
    expect(saved).toMatchObject({ ok: true, result: { templateId: lions.id, version: lions.version + 1 } });
    const t2 = (await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping`))).templates.find((t: any) => t.id === lions.id);
    expect(t2.groups[1].memberIds).toContain(who);
    expect(t2.groups[0].memberIds).not.toContain(who);
    // The absent student keeps the group they had in the option.
    expect(t2.groups.find((g: any) => g.id === absentGroup).memberIds).toContain(kids[9]!.id);
    expect(t2.groups.flatMap((g: any) => g.memberIds).sort()).toEqual(kids.map((k) => k.id).sort());
    expect(count("select count(*) n from audit_events where action = 'grouping.save_to_option'")).toBe(1);
    // Another teacher cannot move students in this lesson (ACC-10).
    expect((await cmd(s.teacherB, 'grouping.move', { contextId: ctx(), lessonId, studentId: who, toGroupId: g1.id })).ok).toBe(false);
  });

  it('a move that breaks an apart rule shows no conflict on the classroom: no count, no text, teacher area only (S13a 2, GRP-7/8)', async () => {
    const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true });
    const o = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping`));
    const lions = o.templates.find((t: any) => t.defaultKey === 'lions');
    const applied = await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: lions.id });
    const st = await lessonState(s.teacherA, ctx());
    const [g1, g2] = st.grouping.groups;
    const who = g1.members[0].id as string;
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/rules`, { studentA: who, studentB: g2.members[0].id, kind: 'apart', note: 'NOTEPRIVATE-apart' }));
    const moved = await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: who, toGroupId: g2.id });
    expect(moved.ok).toBe(true);
    // The live grouping knows the rule is broken (teacher-side data) ...
    const live = env.db.$client.prepare('select unsatisfied_json j from lesson_groupings where lesson_id = ? and cleared_at is null').get(lessonId) as { j: string };
    expect(JSON.parse(live.j).length).toBeGreaterThan(0);
    // ... but nothing about rules reaches the classroom device.
    const after = await lessonState(s.teacherA, ctx());
    const classroom = [JSON.stringify(applied), JSON.stringify(moved), JSON.stringify(after)].join(' ');
    expect(classroom).not.toMatch(/unsatisfied|NOTEPRIVATE|"apart"|ARRANGED_BY_HAND/i);
    expect(after.grouping.groups[1].members.map((m: any) => m.id)).toContain(who);
  });

  it('no levels reach the classroom: lesson state, arrangements and command results (GRP-7)', async () => {
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/levels`, { levels: kids.map((k, i) => ({ studentId: k.id, level: `LVLSECRET-${i % 3}` })) }));
    const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true });
    const arr = await ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/grouping/arrangements`));
    const bodies = [JSON.stringify(arr)];
    bodies.push(JSON.stringify(await cmd(s.teacherA, 'grouping.apply', { contextId: ctx(), lessonId, templateId: arr.arrangements[0].id })));
    bodies.push(JSON.stringify(await cmd(s.teacherA, 'grouping.shuffle', { contextId: ctx(), lessonId })));
    const st = await lessonState(s.teacherA, ctx());
    bodies.push(JSON.stringify(await cmd(s.teacherA, 'grouping.move', { contextId: ctx(), lessonId, studentId: st.grouping.groups[0].members[0].id, toGroupId: st.grouping.groups[1].id })));
    bodies.push(JSON.stringify(await cmd(s.teacherA, 'grouping.saveToOption', { contextId: ctx(), lessonId })));
    bodies.push(JSON.stringify(await lessonState(s.teacherA, ctx())));
    const all = bodies.join('\n');
    expect(all).not.toContain('LVLSECRET');
    expect(all).not.toMatch(/"mode"|"level":"|"rules"|Level|Seviye/);
  });

  it('upper-case names is a class+subject display setting shown in the lesson state', async () => {
    const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true });
    expect((await lessonState(s.teacherA, ctx())).grouping.upperCaseNames).toBe(false);
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/modules/grouping`, { enabled: true, config: { upperCaseNames: true } }));
    expect((await lessonState(s.teacherA, ctx())).grouping.upperCaseNames).toBe(true);
    expect(lessonId).toBeTruthy();
  });

  it('old contexts keep their arrangements; "Use the 4 default options" archives them and adds the defaults once', async () => {
    await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping`));
    // Pretend the context was made before S13a: its defaults have the old keys.
    env.db.$client.prepare("update group_templates set default_key = 'legacy-' || default_key").run();
    const before = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping`));
    expect(before.canUseNewDefaults).toBe(true);
    expect(before.templates).toHaveLength(4);
    const after = await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/use-defaults`, {}));
    expect(after.canUseNewDefaults).toBe(false);
    expect(after.templates.map((t: any) => t.defaultKey)).toEqual(['lions', 'eagles', 'dolphins', 'tigers']);
    const all = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping?includeArchived=1`));
    expect(all.templates.filter((t: any) => t.archived)).toHaveLength(4); // kept, not deleted
    const again = await s.teacherA.post(`/api/teacher/contexts/${ctx()}/grouping/use-defaults`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe('DEFAULTS_ALREADY_USED');
    expect((await s.teacherB.post(`/api/teacher/contexts/${ctx()}/grouping/use-defaults`, {})).status).toBe(403);
  });
});

describe('assistant duty ticks and panel (S13a, D-100)', () => {
  it('ticks are recorded per day through commands, shown today, in the history and in the report', async () => {
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/assistant/plan`, {}));
    const today = await ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/assistant/today`));
    expect(today.checked).toEqual([]);
    expect(today.showPanel).toBe(true);
    const [r1, r2] = today.responsibilities;
    const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true });
    const tick = await cmd(s.teacherA, 'assistant.checkDuty', { contextId: ctx(), lessonId, responsibilityId: r1.id, checked: true });
    expect(tick).toMatchObject({ ok: true, result: { checked: true, changed: true } });
    expect((await cmd(s.teacherA, 'assistant.checkDuty', { contextId: ctx(), lessonId, responsibilityId: r1.id, checked: true }, { opId: tick.opId })).replayed).toBe(true);
    expect((await cmd(s.teacherA, 'assistant.checkDuty', { contextId: ctx(), lessonId, responsibilityId: r1.id, checked: true })).result).toMatchObject({ changed: false });
    await cmd(s.teacherA, 'assistant.checkDuty', { contextId: ctx(), lessonId, responsibilityId: r2.id, checked: true });
    await cmd(s.teacherA, 'assistant.checkDuty', { contextId: ctx(), lessonId, responsibilityId: r2.id, checked: false });
    expect((await ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/assistant/today`))).checked).toEqual([r1.id]);
    expect(count('select count(*) n from assistant_duty_checks')).toBe(2); // the unticked one is kept as history
    expect((await cmd(s.teacherA, 'assistant.checkDuty', { contextId: ctx(), lessonId, responsibilityId: '0190f0f0-0000-7000-8000-000000000000', checked: true })).error?.reason).toBe('RESPONSIBILITY_NOT_FOUND');
    expect((await cmd(s.teacherB, 'assistant.checkDuty', { contextId: ctx(), lessonId, responsibilityId: r1.id, checked: true })).ok).toBe(false);
    const h = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/assistant/history`));
    const day = h.days.find((d: any) => d.date === today.localDate);
    expect(day.duties.map((d: any) => d.id)).toEqual([r1.id]);
    await endLesson(s.teacherA, ctx(), lessonId);
    const report = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/report?from=2026-11-01&to=2026-11-30`));
    const sec = report.sections.find((x: any) => x.key === 'assistant');
    expect(sec.metrics.find((m: any) => m.key === 'duties').cell).toEqual({ t: 'n', v: 1 });
    expect(sec.metrics.find((m: any) => m.key === 'dutyDays').cell).toMatchObject({ t: 'n', v: 1 });
  });

  it('the panel default is a setting; a lesson can hide or show it for every device', async () => {
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/assistant/settings`, { showPanel: false }));
    expect((await ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/assistant/today`))).showPanel).toBe(false);
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/assistant/settings`))).showPanel).toBe(false);
    const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true });
    expect((await lessonState(s.teacherA, ctx())).lesson.display).toEqual({ assistantVisible: null });
    expect((await cmd(s.teacherA, 'lesson.setDisplay', { contextId: ctx(), lessonId, assistantVisible: true })).ok).toBe(true);
    expect((await lessonState(s.teacherA, ctx())).lesson.display).toEqual({ assistantVisible: true });
    expect((await cmd(s.teacherA, 'lesson.setDisplay', { contextId: ctx(), lessonId, assistantVisible: null })).ok).toBe(true);
    expect((await lessonState(s.teacherA, ctx())).lesson.display).toEqual({ assistantVisible: null });
  });
});

describe('lesson topics (S13a, D-101)', () => {
  const topics = () => ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/topics`));
  const byName = (list: any[], en: string) => list.find((t: any) => t.name.en === en);

  it('the weekly plan gives the default topic at start; the teacher can override it', async () => {
    const t = await topics();
    expect(t.topics.map((x: any) => x.name.en)).toEqual(expect.arrayContaining(['Reading', 'Speaking', 'Phonics']));
    expect(byName(t.topics, 'Speaking').icon).toBe('speech');
    expect(t.weekday).toBe(1);
    expect(t.plannedToday).toEqual([]);
    const speaking = byName(t.topics, 'Speaking').id;
    const phonics = byName(t.topics, 'Phonics').id;
    const plan = await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/topic-plan`, { plan: { '1': [speaking], '3': [phonics, speaking] } }));
    expect(plan.plan).toEqual({ '1': [speaking], '3': [phonics, speaking] });
    expect((await topics()).plannedToday).toEqual([speaking]);
    expect((await s.teacherA.put(`/api/teacher/contexts/${ctx()}/topic-plan`, { plan: { '2': ['0190f0f0-0000-7000-8000-000000000000'] } })).body.error.details.reason).toBe('UNKNOWN_TOPIC');
    expect((await s.teacherB.get(`/api/teacher/contexts/${ctx()}/topic-plan`)).status).toBe(403);
    // Plan default applied.
    let lessonId = await startLesson(s.teacherA, ctx());
    expect((await lessonState(s.teacherA, ctx())).lesson.topics.map((x: any) => x.id)).toEqual([speaking]);
    await endLesson(s.teacherA, ctx(), lessonId);
    // Override at start (an empty list = no topic today).
    lessonId = await startLesson(s.teacherA, ctx(), { topicIds: [phonics] });
    expect((await lessonState(s.teacherA, ctx())).lesson.topics).toMatchObject([{ id: phonics, name: { en: 'Phonics' }, icon: 'letters' }]);
    await endLesson(s.teacherA, ctx(), lessonId);
    lessonId = await startLesson(s.teacherA, ctx(), { topicIds: [] });
    expect((await lessonState(s.teacherA, ctx())).lesson.topics).toEqual([]);
  });

  it('changing the topic mid-lesson is idempotent, the wrong lesson is refused, snapshots survive renames, reports count them', async () => {
    const t = await topics();
    const reading = byName(t.topics, 'Reading').id;
    const speaking = byName(t.topics, 'Speaking').id;
    const custom = await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/goal-categories`, { name: { en: 'Songs', tr: 'Şarkılar' }, icon: 'music' }));
    expect(custom.icon).toBe('music');
    expect(byName((await topics()).topics, 'Songs').icon).toBe('music');

    const l1 = await startLesson(s.teacherA, ctx(), { topicIds: [reading] });
    const set = await cmd(s.teacherA, 'lesson.setTopics', { contextId: ctx(), lessonId: l1, topicIds: [custom.id, speaking] });
    expect(set).toMatchObject({ ok: true, result: { changed: true } });
    expect((await cmd(s.teacherA, 'lesson.setTopics', { contextId: ctx(), lessonId: l1, topicIds: [custom.id, speaking] }, { opId: set.opId })).replayed).toBe(true);
    expect((await cmd(s.teacherA, 'lesson.setTopics', { contextId: ctx(), lessonId: l1, topicIds: [custom.id, speaking] })).result).toMatchObject({ changed: false });
    expect((await lessonState(s.teacherA, ctx())).lesson.topics.map((x: any) => x.id)).toEqual([custom.id, speaking]);
    expect((await cmd(s.teacherA, 'lesson.setTopics', { contextId: ctx(), lessonId: '0190f0f0-0000-7000-8000-000000000000', topicIds: [reading] })).ok).toBe(false);
    expect((await cmd(s.teacherB, 'lesson.setTopics', { contextId: ctx(), lessonId: l1, topicIds: [reading] })).ok).toBe(false);
    // An unknown (or meanwhile archived) topic is dropped, never a rejected outbox command.
    expect((await cmd(s.teacherA, 'lesson.setTopics', { contextId: ctx(), lessonId: l1, topicIds: [custom.id, speaking, '0190f0f0-0000-7000-8000-000000000000'] })).result).toMatchObject({ changed: false });
    await endLesson(s.teacherA, ctx(), l1);
    const l2 = await startLesson(s.teacherA, ctx(), { topicIds: [speaking] });
    await endLesson(s.teacherA, ctx(), l2);

    // Rename the custom topic: the old lesson keeps "Songs" (DAT-6).
    await ok(s.teacherA.patch(`/api/teacher/goal-categories/${custom.id}`, { name: { en: 'Chants', tr: 'Tekerlemeler' } }));
    const row = env.db.$client.prepare('select topics_json j from lessons where id = ?').get(l1) as { j: string };
    expect(JSON.parse(row.j)[0].name.en).toBe('Songs');

    const report = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/report?from=2026-11-01&to=2026-11-30`));
    const sec = report.sections.find((x: any) => x.key === 'lessonTopics');
    expect(sec.metrics[0].cell).toEqual({ t: 'n', v: 2, d: 2 });
    const rows = sec.tables[0].rows;
    expect(rows.find((r: any) => r.key === speaking).cells[1]).toEqual({ t: 'n', v: 2, d: 2 });
    const songs = rows.find((r: any) => r.key === custom.id);
    expect(songs.cells[1]).toEqual({ t: 'n', v: 1, d: 2 });
    expect(songs.cells[0].v).toEqual({ text: { en: 'Songs', tr: 'Şarkılar' }, now: { en: 'Chants', tr: 'Tekerlemeler' } });
    // The reflections table names each lesson's topic; the student timeline shows the focus.
    const refl = report.sections.find((x: any) => x.key === 'lessonReflections');
    expect(refl.tables[0].columns.at(-1).key).toBe('topic');
    const tl = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/students/${kids[0]!.id}/timeline?from=2026-11-01&to=2026-11-30`));
    expect(tl.events.filter((e: any) => e.what.k === 'report.timeline.lessonTopic')).toHaveLength(2);
  });

  it('a topic archived after the device cached it is dropped from a replayed lesson.start (and lesson.setTopics), not a failed start', async () => {
    const t = await topics();
    const reading = byName(t.topics, 'Reading').id;
    const custom = await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/goal-categories`, { name: { en: 'Rhymes', tr: 'Uyaklar' }, icon: 'music' }));
    // The classroom device still offers "Rhymes"; the teacher archives it in the teacher area meanwhile.
    await ok(s.teacherA.patch(`/api/teacher/goal-categories/${custom.id}`, { archived: true }));
    expect(byName((await topics()).topics, 'Rhymes')).toBeUndefined();
    const start = await cmd(s.teacherA, 'lesson.start', { contextId: ctx(), othersPresent: true, attendance: [], topicIds: [custom.id, reading] });
    expect(start.ok).toBe(true);
    const lessonId = start.result.lessonId as string;
    expect((await lessonState(s.teacherA, ctx())).lesson.topics.map((x: any) => x.id)).toEqual([reading]);
    const audited = env.db.$client.prepare("select after_json a from audit_events where action = 'lesson.start' and entity_id = ?").get(lessonId) as { a: string };
    expect(JSON.parse(audited.a).droppedTopics).toEqual([custom.id]);
    // A queued mid-lesson change naming the archived topic keeps the usable ones.
    expect((await cmd(s.teacherA, 'lesson.setTopics', { contextId: ctx(), lessonId, topicIds: [custom.id] })).result).toMatchObject({ changed: true });
    expect((await lessonState(s.teacherA, ctx())).lesson.topics).toEqual([]);
    await endLesson(s.teacherA, ctx(), lessonId);
  });
});

describe('per-class language (S13a, D-099)', () => {
  it('admins and the class teacher set it; other teachers cannot; classes are isolated; labels keep both languages', async () => {
    const c3a = (await ok(s.admin.get('/api/admin/classes'))).classes?.find?.((c: any) => c.id === s.c3a.id) ?? s.c3a;
    expect(c3a).toMatchObject({ mainLanguage: 'en', secondLanguageEnabled: false });
    const r = await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/language`, { mainLanguage: 'tr', secondLanguageEnabled: true }));
    expect(r).toEqual({ classId: s.c3a.id, mainLanguage: 'tr', secondLanguageEnabled: true, studentPageMainLanguage: null, studentPageSecondLanguageEnabled: null });
    expect((await s.teacherB.put(`/api/teacher/classes/${s.c3a.id}/language`, { mainLanguage: 'en', secondLanguageEnabled: false })).status).toBe(403);
    expect((await s.teacherA.put(`/api/teacher/classes/${s.c3b.id}/language`, { mainLanguage: 'tr', secondLanguageEnabled: false })).status).toBe(403);
    const mine = await ok(s.teacherA.get('/api/teacher/contexts'));
    expect(mine.contexts.find((c: any) => c.id === ctx())).toMatchObject({ mainLanguage: 'tr', secondLanguageEnabled: true });
    const theirs = await ok(s.teacherB.get('/api/teacher/contexts'));
    expect(theirs.contexts.find((c: any) => c.id === s.ctxB.id)).toMatchObject({ mainLanguage: 'en', secondLanguageEnabled: false });
    // The admin changes 3-B only.
    await ok(s.admin.patch(`/api/admin/classes/${s.c3b.id}`, { mainLanguage: 'tr', secondLanguageEnabled: false }));
    expect((await ok(s.teacherA.get('/api/teacher/contexts'))).contexts.find((c: any) => c.id === ctx())).toMatchObject({ mainLanguage: 'tr', secondLanguageEnabled: true });
    expect(count("select count(*) n from audit_events where action = 'class.language'")).toBe(1);
    // Switching the second language off keeps the stored translations (nothing is deleted).
    const cat = await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/goal-categories`, { name: { en: 'Stories', tr: 'Hikâyeler' } }));
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/language`, { mainLanguage: 'tr', secondLanguageEnabled: false }));
    const goals = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/goal-library`));
    expect(goals.categories.find((c: any) => c.id === cat.id).name).toEqual({ en: 'Stories', tr: 'Hikâyeler' });
  });

  it('an account is created with a required interface language that the admin can change later', async () => {
    const made = await ok(s.admin.post('/api/admin/users', { login: 'zeynep.teacher', displayName: 'Zeynep Ak', role: 'teacher', locale: 'tr', setup: 'temporary_password' }));
    const u = made.user;
    expect(u.locale).toBe('tr');
    const other = (await ok(s.admin.post('/api/admin/users', { login: 'emre.teacher', displayName: 'Emre Su', role: 'teacher', locale: 'en' }))).user;
    const z = new Client(env);
    await z.login('zeynep.teacher', made.temporaryPassword);
    expect((await ok(z.get('/api/auth/me'))).locale).toBe('tr'); // Turkish on first sign-in
    await ok(s.admin.patch(`/api/admin/users/${u.id}`, { locale: 'en', setup: 'temporary_password' }));
    expect((await ok(z.get('/api/auth/me'))).locale).toBe('en');
    const list = await ok(s.admin.get('/api/admin/users'));
    expect(list.users.find((x: any) => x.id === other.id).locale).toBe('en'); // changing one user never affects another
    expect((await s.admin.post('/api/admin/users', { login: 'bad.locale', displayName: 'Bad Locale', role: 'teacher', locale: 'de' })).status).toBe(400);
  });
});

describe('counters reminder boxes (S14a, D-143 supersedes D-102)', () => {
  it('are shown by default (CNT-3) and a saved "off" stays off', async () => {
    const lessonId = await startLesson(s.teacherA, ctx());
    const read = async () => (await lessonState(s.teacherA, ctx())).counters;
    expect((await read()).showReminderBoxes).toBe(true);
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/modules/counters`, { enabled: true, config: { showReminderBoxes: false } }));
    expect((await read()).showReminderBoxes).toBe(false);
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/modules/counters`, { enabled: true, config: { showReminderBoxes: true } }));
    expect((await read()).showReminderBoxes).toBe(true);
    expect(lessonId).toBeTruthy();
  });
});
