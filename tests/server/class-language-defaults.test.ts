/**
 * S20d (D-172, refines D-099): seeded defaults of a class+subject are written in the class's languages
 * only (assistant duties, the English reminder counter, the default group arrangements and their
 * "Group N" names). When a language is switched on later, the defaults the teacher never changed get
 * it (audited); edited labels are left alone (the editors mark them "Needs translation").
 * Test clock: Monday 2026-11-09, Europe/Istanbul. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completeDefault, inLocales, seedLocales } from '../../src/shared/classLanguage.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
const NAMES = ['Ada Yılmaz', 'Barış Kaya', 'Cem Demir', 'Deniz Şahin', 'Ece Çelik', 'Fırat Arslan'];

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  for (const fullName of NAMES) await addStudent(s.teacherA, s.c3a.id, { fullName });
});
afterEach(async () => env.app.close());

const ctx = () => s.ctxA.id as string;
const count = (sql: string, ...args: unknown[]) => (env.db.$client.prepare(sql).get(...args) as { n: number }).n;
const setLanguage = (mainLanguage: 'en' | 'tr', secondLanguageEnabled: boolean, studentPage?: unknown) =>
  ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/language`, { mainLanguage, secondLanguageEnabled, ...(studentPage ? { studentPage } : {}) }));
const duties = async () => (await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/assistant/settings`))).responsibilities.map((r: any) => r.label);
const preset = async () => (await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/counters`))).counters.find((c: any) => c.kind === 'english_reminders');
const grouping = async () => (await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/grouping`))).templates as any[];
const languagesOf = (labels: Array<Record<string, string | undefined>>) => [...new Set(labels.flatMap((l) => Object.keys(l).filter((k) => l[k]?.trim())))].sort();

describe('seeded defaults follow the class language (S20d, D-172)', () => {
  it('helpers: the class and student-page languages, main first; untouched defaults only are completed', () => {
    expect(seedLocales({ mainLanguage: 'tr', secondLanguageEnabled: false })).toEqual(['tr']);
    expect(seedLocales({ mainLanguage: 'tr', secondLanguageEnabled: false, studentPageMainLanguage: 'en', studentPageSecondLanguageEnabled: false })).toEqual(['tr', 'en']);
    expect(seedLocales({ mainLanguage: 'en', secondLanguageEnabled: true })).toEqual(['en', 'tr']);
    expect(inLocales({ en: 'Group 1', tr: 'Grup 1' }, ['tr'])).toEqual({ tr: 'Grup 1' });
    expect(inLocales({ en: 'Only English' }, ['tr'])).toEqual({ en: 'Only English' });
    const seeded = { en: 'Group 1', tr: 'Grup 1' };
    expect(completeDefault({ tr: 'Grup 1' }, seeded, ['tr', 'en'])).toEqual(seeded);
    expect(completeDefault({ tr: 'Kaplanlar' }, seeded, ['tr', 'en'])).toBeNull(); // the teacher's own name
    expect(completeDefault({ tr: 'Grup 1' }, seeded, ['tr'])).toBeNull(); // nothing to add
    expect(completeDefault({}, seeded, ['tr', 'en'])).toBeNull();
  });

  it('a Turkish-only class gets Turkish-only duties, reminder counter and group names; an English-only class stays English-only', async () => {
    await setLanguage('tr', false);
    for (const l of await duties()) expect(Object.keys(l)).toEqual(['tr']);
    const c = await preset();
    expect(languagesOf([c.labels.main, c.labels.supporting, c.labels.individual, ...c.responses.flatMap((r: any) => [r.label, r.message])])).toEqual(['tr']);
    const tpls = await grouping();
    expect(tpls.length).toBeGreaterThan(0);
    expect(languagesOf(tpls.flatMap((t) => [t.name, ...t.groups.map((g: any) => g.name)]))).toEqual(['tr']);
    expect(tpls[0].groups[0].name).toEqual({ tr: 'Grup 1' });

    // 3-B keeps the default English-only mode: its defaults are English only.
    const b = (await ok(s.teacherB.get(`/api/teacher/contexts/${s.ctxB.id}/assistant/settings`))).responsibilities.map((r: any) => r.label);
    expect(languagesOf(b)).toEqual(['en']);
  });

  it('a student-page override adds its language to the seeded defaults (D-117)', async () => {
    await setLanguage('tr', false, { mainLanguage: 'en', secondLanguageEnabled: false });
    expect(languagesOf(await duties())).toEqual(['en', 'tr']);
  });

  it('switching a language on later completes the untouched defaults, keeps edited labels as they are, and is audited', async () => {
    await setLanguage('tr', false);
    const before = await duties();
    const settings = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/assistant/settings`));
    // The teacher renames the first duty (Turkish only) and the first group of the first arrangement.
    await ok(
      s.teacherA.put(`/api/teacher/contexts/${ctx()}/assistant/settings`, {
        responsibilities: settings.responsibilities.map((r: any, i: number) => ({ id: r.id, label: i === 0 ? { tr: 'Tahtayı sil' } : r.label })),
      }),
    );
    const c = await preset();
    await ok(s.teacherA.patch(`/api/teacher/counters/${c.id}`, { labels: { ...c.labels, main: { tr: 'Türkçe konuşma' } } }));
    const tpl = (await grouping())[0];
    await ok(
      s.teacherA.put(`/api/teacher/grouping/templates/${tpl.id}`, {
        expectedVersion: tpl.version,
        groups: tpl.groups.map((g: any, i: number) => ({ id: g.id, name: i === 0 ? { tr: 'Kaplanlar' } : g.name, icon: g.icon, memberIds: g.memberIds })),
      }),
    );

    await setLanguage('tr', true);
    const after = await duties();
    expect(after[0]).toEqual({ tr: 'Tahtayı sil' });
    for (const l of after.slice(1)) expect(Object.keys(l).sort()).toEqual(['en', 'tr']);
    expect(after.slice(1).map((l: any) => l.tr)).toEqual(before.slice(1).map((l: any) => l.tr));
    const c2 = await preset();
    expect(c2.labels.main).toEqual({ tr: 'Türkçe konuşma' });
    expect(Object.keys(c2.labels.supporting).sort()).toEqual(['en', 'tr']);
    for (const r of c2.responses) expect(Object.keys(r.label).sort()).toEqual(['en', 'tr']);
    const tpls = await grouping();
    const edited = tpls.find((t) => t.id === tpl.id);
    expect(edited.groups[0].name).toEqual({ tr: 'Kaplanlar' });
    expect(edited.groups[1].name).toEqual({ tr: 'Grup 2', en: 'Group 2' });
    // The language completion moves the version on, so an editor open on the old version reloads.
    expect(edited.version).toBeGreaterThan(tpl.version + 1);
    for (const t of tpls) expect(Object.keys(t.name).sort()).toEqual(['en', 'tr']);
    expect(count("select count(*) n from audit_events where action = 'assistant.defaults_translated'")).toBe(1);
    expect(count("select count(*) n from audit_events where action = 'counter.defaults_translated'")).toBe(1);
    expect(count("select count(*) n from audit_events where action = 'grouping.defaults_translated'")).toBe(1);

    // Switching the language off keeps every stored text (D-099); switching it on again adds nothing new.
    await setLanguage('tr', false);
    await setLanguage('tr', true);
    expect(await duties()).toEqual(after);
    expect(count("select count(*) n from audit_events where action like '%.defaults_translated'")).toBe(3);
  });

  it('the admin class editor triggers the same completion', async () => {
    await setLanguage('tr', false);
    await duties();
    await ok(s.admin.patch(`/api/admin/classes/${s.c3a.id}`, { mainLanguage: 'tr', secondLanguageEnabled: true }));
    for (const l of await duties()) expect(Object.keys(l).sort()).toEqual(['en', 'tr']);
  });
});
