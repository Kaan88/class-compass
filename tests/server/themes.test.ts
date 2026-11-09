/**
 * Theme packages (S14g, D-158; THM-2, THM-3, ACC-9): validation without saving, the draft → enabled →
 * disabled → deleted lifecycle with audit, `assertThemeUsable` for classes, class display and the Super
 * Speakers board, reads that fall back to the default theme, the public package endpoint (enabled
 * only), admin-only management. The worked example is docs/examples/ocean.theme.json (fictional).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditEvents, classes, customThemes } from '../../src/server/db/schema.ts';
import { PACKAGE_LIMITS } from '../../src/shared/themePackage/limits.ts';
import { onBoardChange } from '../../src/server/modules/superSpeakers/events.ts';
import { buildBoard } from '../../src/server/modules/superSpeakers/service.ts';
import { DEFAULT_THEME } from '../../src/shared/themes.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const OCEAN = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'examples', 'ocean.theme.json'), 'utf8');
const ocean = () => JSON.parse(OCEAN) as Record<string, any>;
const withChanges = (fn: (p: Record<string, any>) => void, key = 'ocean') => {
  const p = ocean();
  p.key = key;
  fn(p);
  return JSON.stringify(p);
};

let env: TestEnv;
let s: School;
beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
});
afterEach(async () => env.app.close());

const actions = (key: string) =>
  env.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, key))
    .all()
    .map((a) => a.action);

async function enabledOcean() {
  await ok(s.admin.post('/api/admin/themes', { source: OCEAN }));
  return ok(s.admin.post('/api/admin/themes/ocean/enable'));
}

describe('validation (nothing is stored)', () => {
  it('the worked example validates with a warning for the art that comes from the base theme', async () => {
    const r = await ok(s.admin.post('/api/admin/themes/validate', { source: OCEAN }));
    expect(r.report.ok).toBe(true);
    expect(r.report.errors).toEqual([]);
    expect(r.report.warnings.map((w: any) => w.code)).toEqual(['ART_FROM_BASE']);
    expect(r.package.key).toBe('ocean');
    expect(r.exists).toBe(false);
    expect(env.db.select().from(customThemes).all()).toEqual([]);
  });

  it('reports contrast, JSON, schema, built-in key, sound and SVG problems; no package is returned', async () => {
    const check = async (source: string) => (await ok(s.admin.post('/api/admin/themes/validate', { source }))) as { report: any; package: unknown };
    const contrastBad = await check(withChanges((p) => (p.colors['text-muted'] = '#b0c4cc')));
    expect(contrastBad.package).toBeNull();
    expect(contrastBad.report.errors.some((e: any) => e.code === 'CONTRAST' && e.path === 'colors.text-muted')).toBe(true);
    expect((await check('{"format":')).report.errors[0].code).toBe('NOT_JSON');
    expect((await check(withChanges((p) => (p.colors.surface = 'red')))).report.errors[0]).toMatchObject({ code: 'SCHEMA', path: 'colors.surface' });
    expect((await check(withChanges((p) => (p.extra = 1)))).report.errors[0].code).toBe('SCHEMA');
    expect((await check(withChanges(() => undefined, 'explorer'))).report.errors.map((e: any) => e.code)).toContain('KEY_BUILTIN');
    const loud = await check(withChanges((p) => (p.sounds.overrides = { tap: [{ freq: 600, at: 0, dur: 80, type: 'sine', gain: 0.3 }] })));
    expect(loud.report.errors.some((e: any) => e.code === 'SOUND' && e.params.kind === 'tapTooLoud')).toBe(true);
    const svg = await check(withChanges((p) => (p.art.decoration = `<circle cx='1' cy='1' r='1' onclick='alert(1)'/>`)));
    expect(svg.report.errors[0]).toMatchObject({ code: 'SVG', path: 'art.decoration', params: { reason: 'attribute' } });
    const same = await check(withChanges((p) => (p.art.mascot.cheer = p.art.mascot.idle)));
    expect(same.report.errors.map((e: any) => e.code)).toContain('MASCOT_POSES_SAME');
  });

  it('only administrators may validate or manage themes: every endpoint for every caller (ACC-1, review fix)', async () => {
    await enabledOcean();
    await ok(s.admin.post('/api/admin/themes', { source: withChanges(() => undefined, 'lagoon') }));
    await ok(s.admin.post('/api/admin/themes', { source: withChanges(() => undefined, 'reef') }));
    await ok(s.admin.post('/api/admin/themes/reef/enable'));
    await ok(s.admin.post('/api/admin/themes/reef/disable'));
    const ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
    const student = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
    const callers: Record<string, Client> = { anonymous: new Client(env), student, teacher: s.teacherA, admin: s.admin };
    const admin = { anonymous: 401, student: 401, teacher: 403 };
    // [method, path, body, admin status]; every admin endpoint is refused to everyone else before it does anything.
    const manage: Array<[string, string, unknown, number]> = [
      ['GET', '/api/admin/themes', undefined, 200],
      ['POST', '/api/admin/themes/validate', { source: OCEAN }, 200],
      ['GET', '/api/admin/themes/ocean', undefined, 200],
      ['POST', '/api/admin/themes', { source: withChanges(() => undefined, 'kelp') }, 200],
      ['PUT', '/api/admin/themes/ocean', { source: OCEAN }, 200],
      ['POST', '/api/admin/themes/lagoon/enable', undefined, 200],
      ['POST', '/api/admin/themes/lagoon/disable', undefined, 200],
      ['DELETE', '/api/admin/themes/lagoon', { confirm: 'lagoon' }, 200],
    ];
    for (const [method, path, body, adminStatus] of manage) {
      for (const [who, expected] of Object.entries(admin)) {
        expect((await callers[who]!.req(method, path, body)).status, `${who} ${method} ${path}`).toBe(expected);
      }
      expect((await s.admin.req(method, path, body)).status, `admin ${method} ${path}`).toBe(adminStatus);
    }
    expect(env.db.select().from(customThemes).all().map((r) => r.key).sort()).toEqual(['kelp', 'ocean', 'reef']);
    // The pickers' list needs a signed-in account; the public package is enabled themes only.
    expect((await callers.anonymous!.get('/api/themes/available')).status).toBe(401);
    expect((await callers.student!.get('/api/themes/available')).status).toBe(401);
    expect((await ok(s.teacherA.get('/api/themes/available'))).themes.map((t: any) => t.key)).toEqual(['ocean']);
    expect((await ok(s.admin.get('/api/themes/available'))).themes.map((t: any) => t.key)).toEqual(['ocean']);
    for (const c of Object.values(callers)) {
      expect((await c.get('/api/themes/custom/ocean')).status).toBe(200);
      expect((await c.get('/api/themes/custom/kelp')).status).toBe(404); // draft
      expect((await c.get('/api/themes/custom/reef')).status).toBe(404); // disabled
      expect((await c.get('/api/themes/custom/lagoon')).status).toBe(404); // deleted
    }
    // Admin endpoints on an unknown theme are 404, not 500.
    for (const [method, path, body] of [
      ['GET', '/api/admin/themes/nope', undefined],
      ['PUT', '/api/admin/themes/nope', { source: withChanges(() => undefined, 'nope') }],
      ['POST', '/api/admin/themes/nope/enable', undefined],
      ['POST', '/api/admin/themes/nope/disable', undefined],
      ['DELETE', '/api/admin/themes/nope', { confirm: 'nope' }],
    ] as const) {
      expect((await s.admin.req(method, path, body)).status, `${method} ${path}`).toBe(404);
    }
  });
});

describe('lifecycle', () => {
  it('draft → enabled → disabled → enabled → deleted, audited; classes fall back while it is not enabled and move to the default when it is deleted (THM-3)', async () => {
    const draft = await ok(s.admin.post('/api/admin/themes', { source: OCEAN }));
    expect(draft).toMatchObject({ key: 'ocean', status: 'draft', classCount: 0, board: false, name: { en: 'Ocean', tr: 'Okyanus' }, base: 'classroom', warnings: 1 });
    expect((await s.admin.post('/api/admin/themes', { source: OCEAN })).body.error.details.reason).toBe('THEME_KEY_TAKEN');
    expect((await ok(s.admin.post('/api/admin/themes/validate', { source: OCEAN }))).exists).toBe(true);

    // A draft can be previewed by the admin but is neither public nor choosable.
    expect((await new Client(env).get('/api/themes/custom/ocean')).status).toBe(404);
    expect((await ok(s.teacherA.get('/api/themes/available'))).themes).toEqual([]);
    expect((await s.admin.patch(`/api/admin/classes/${s.c3a.id}`, { theme: 'ocean' })).body.error.details.reason).toBe('THEME_NOT_AVAILABLE');
    expect((await ok(s.admin.get('/api/admin/themes/ocean'))).package.key).toBe('ocean');

    await ok(s.admin.post('/api/admin/themes/ocean/enable'));
    const pub = await ok(new Client(env).get('/api/themes/custom/ocean'));
    expect(pub.name.en).toBe('Ocean');
    expect((await ok(s.teacherA.get('/api/themes/available'))).themes.map((t: any) => t.key)).toEqual(['ocean']);

    // A teacher of the class chooses it for the class display; every read shows it.
    expect((await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/display`, { theme: 'ocean' }))).theme).toBe('ocean');
    const ctx = () => ok(s.teacherA.get('/api/teacher/contexts')).then((r) => r.contexts.find((c: any) => c.classId === s.c3a.id).theme);
    expect(await ctx()).toBe('ocean');
    expect((await ok(s.admin.get('/api/admin/themes'))).themes[0].classCount).toBe(1);

    // Disabled: the class keeps the key but reads show the default theme until it is enabled again.
    await ok(s.admin.post('/api/admin/themes/ocean/disable'));
    expect(await ctx()).toBe(DEFAULT_THEME);
    expect(env.db.select().from(classes).where(eq(classes.id, s.c3a.id)).get()!.theme).toBe('ocean');
    expect((await new Client(env).get('/api/themes/custom/ocean')).status).toBe(404);
    expect((await s.teacherA.put(`/api/teacher/classes/${s.c3b.id}/display`, { theme: 'ocean' })).status).toBeGreaterThanOrEqual(400);
    await ok(s.admin.post('/api/admin/themes/ocean/enable'));
    expect(await ctx()).toBe('ocean');

    // Delete: typed confirmation, then the class moves to the default theme.
    expect((await s.admin.req('DELETE', '/api/admin/themes/ocean', { confirm: 'oceans' })).body.error.details.reason).toBe('CONFIRMATION_MISMATCH');
    const del = await ok(s.admin.req('DELETE', '/api/admin/themes/ocean', { confirm: 'ocean' }));
    expect(del).toEqual({ ok: true, movedClasses: 1, movedBoard: false });
    expect(env.db.select().from(classes).where(eq(classes.id, s.c3a.id)).get()!.theme).toBe(DEFAULT_THEME);
    expect((await new Client(env).get('/api/themes/custom/ocean')).status).toBe(404);
    expect(actions('ocean')).toEqual(['theme.create', 'theme.enable', 'theme.disable', 'theme.enable', 'theme.delete']);
    const deleted = env.db.select().from(auditEvents).where(eq(auditEvents.action, 'theme.delete')).get()!;
    expect(JSON.parse(deleted.afterJson!)).toMatchObject({ movedClassIds: [s.c3a.id], movedBoard: false, to: DEFAULT_THEME });
    // The audit never holds the whole package.
    expect(env.db.select().from(auditEvents).all().every((a) => !(a.afterJson ?? '').includes('<path'))).toBe(true);
  });

  it('replace keeps the status, needs the same key and a package without errors', async () => {
    await enabledOcean();
    const renamed = withChanges((p) => (p.name.en = 'Deep ocean'));
    const r = await ok(s.admin.put('/api/admin/themes/ocean', { source: renamed }));
    expect(r).toMatchObject({ status: 'enabled', name: { en: 'Deep ocean' } });
    expect((await s.admin.put('/api/admin/themes/ocean', { source: withChanges(() => undefined, 'lagoon') })).body.error.details.reason).toBe('THEME_KEY_MISMATCH');
    expect((await s.admin.put('/api/admin/themes/ocean', { source: withChanges((p) => (p.colors.text = '#cccccc')) })).body.error.details.reason).toBe('THEME_INVALID');
    expect((await s.admin.put('/api/admin/themes/lagoon', { source: withChanges(() => undefined, 'lagoon') })).status).toBe(404);
    expect(actions('ocean')).toEqual(['theme.create', 'theme.enable', 'theme.replace']);
  });

  it('refuses a package with errors and keeps at most the limit of imported themes', async () => {
    const bad = await s.admin.post('/api/admin/themes', { source: withChanges((p) => (p.art.pattern = '<image href="x"/>')) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.reason).toBe('THEME_INVALID');
    expect(bad.body.error.details.errors[0].code).toBe('SVG');
    const now = env.clock.now();
    for (let i = 0; i < PACKAGE_LIMITS.maxCustomThemes; i++) {
      env.db.insert(customThemes).values({ key: `filler-${i}`, packageJson: {}, reportJson: { warnings: [] }, status: 'draft', bytes: 2, createdAt: now, updatedAt: now }).run();
    }
    expect((await s.admin.post('/api/admin/themes', { source: OCEAN })).body.error.details.reason).toBe('THEME_LIMIT');
  });

  it('the theme key in a path is a slug: anything else is a validation error, never a lookup', async () => {
    expect((await s.admin.get('/api/admin/themes/Ocean')).status).toBe(400);
    expect((await new Client(env).get("/api/themes/custom/x'%5D%7B")).status).toBe(400);
  });
});

describe('where a theme is used', () => {
  it('admin class create and update accept only built-in or enabled themes (THM-3)', async () => {
    const year = (await ok(s.admin.get('/api/admin/classes'))).classes[0].schoolYearId;
    expect((await s.admin.post('/api/admin/classes', { schoolYearId: year, name: '5-Z', theme: 'ocean' })).body.error.details.reason).toBe('THEME_NOT_AVAILABLE');
    await enabledOcean();
    expect((await ok(s.admin.post('/api/admin/classes', { schoolYearId: year, name: '5-Z', theme: 'ocean' }))).theme).toBe('ocean');
    expect((await ok(s.admin.patch(`/api/admin/classes/${s.c3b.id}`, { theme: 'ocean' }))).theme).toBe('ocean');
    // Unchanged fields of a class whose theme was disabled can still be saved; the admin sees the stored choice.
    await ok(s.admin.post('/api/admin/themes/ocean/disable'));
    expect(await ok(s.admin.patch(`/api/admin/classes/${s.c3b.id}`, { name: '3-B' }))).toMatchObject({ theme: 'ocean', themeAvailable: false });
  });

  it('a disabled theme survives saving every other field of the class and the board as the admin pages send them (review fix, D-158)', async () => {
    await ok(s.admin.put('/api/admin/module-policies/superSpeakers', { availability: 'enabled' }));
    await enabledOcean();
    await ok(s.admin.patch(`/api/admin/classes/${s.c3a.id}`, { theme: 'ocean' }));
    await ok(s.admin.put('/api/admin/speakers/settings', { theme: 'ocean' }));
    await ok(s.admin.post('/api/admin/themes/ocean/disable'));

    // Screens show the default theme; the admin editor and the teacher picker see the stored choice.
    const ctx = (await ok(s.teacherA.get('/api/teacher/contexts'))).contexts.find((c: any) => c.classId === s.c3a.id);
    expect(ctx).toMatchObject({ theme: DEFAULT_THEME, chosenTheme: 'ocean' });
    const cls = (await ok(s.admin.get('/api/admin/classes'))).classes.find((c: any) => c.id === s.c3a.id);
    expect(cls).toMatchObject({ theme: 'ocean', themeAvailable: false });
    const settings = (await ok(s.admin.get('/api/admin/speakers'))).settings;
    expect(settings).toMatchObject({ theme: 'ocean', themeAvailable: false });
    expect(buildBoard(env.db, env.clock.now()).theme).toBe(DEFAULT_THEME);

    // Round trip: every editable field of the GET goes back (as a form that sends the whole record would).
    const without = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
    const fields = without(cls, ['id', 'schoolYearId', 'themeAvailable', 'archived', 'yearArchived', 'studentCount', 'studentPageMainLanguage', 'studentPageSecondLanguageEnabled']);
    await ok(s.admin.patch(`/api/admin/classes/${s.c3a.id}`, { ...fields, name: '3-A' }));
    await ok(s.admin.put('/api/admin/speakers/settings', { ...without(settings, ['themeAvailable']), undoWindowMinutes: 7 }));
    expect(env.db.select().from(classes).where(eq(classes.id, s.c3a.id)).get()!.theme).toBe('ocean');
    expect((await ok(s.admin.get('/api/admin/themes'))).themes[0]).toMatchObject({ classCount: 1, board: true });

    // Enabled again: the class and the board use it again.
    await ok(s.admin.post('/api/admin/themes/ocean/enable'));
    expect((await ok(s.teacherA.get('/api/teacher/contexts'))).contexts.find((c: any) => c.classId === s.c3a.id)).toMatchObject({ theme: 'ocean', chosenTheme: 'ocean' });
    expect(buildBoard(env.db, env.clock.now()).theme).toBe('ocean');
    expect((await ok(s.admin.get('/api/admin/speakers'))).settings).toMatchObject({ theme: 'ocean', themeAvailable: true, undoWindowMinutes: 7 });

    // Choosing another theme on purpose still replaces it.
    await ok(s.admin.post('/api/admin/themes/ocean/disable'));
    expect((await ok(s.admin.patch(`/api/admin/classes/${s.c3a.id}`, { theme: DEFAULT_THEME }))).theme).toBe(DEFAULT_THEME);
  });

  it('the Super Speakers board: settings accept only usable themes; the board falls back and moves to the default on delete', async () => {
    await ok(s.admin.put('/api/admin/module-policies/superSpeakers', { availability: 'enabled' }));
    expect((await s.admin.put('/api/admin/speakers/settings', { theme: 'ocean' })).body.error.details.reason).toBe('THEME_NOT_AVAILABLE');
    await enabledOcean();
    expect((await ok(s.admin.put('/api/admin/speakers/settings', { theme: 'ocean' }))).theme).toBe('ocean');
    expect((await ok(s.admin.get('/api/admin/themes'))).themes[0].board).toBe(true);
    expect(buildBoard(env.db, env.clock.now()).theme).toBe('ocean');
    await ok(s.admin.post('/api/admin/themes/ocean/disable'));
    expect((await ok(s.admin.get('/api/admin/speakers'))).settings).toMatchObject({ theme: 'ocean', themeAvailable: false });
    expect(buildBoard(env.db, env.clock.now()).theme).toBe(DEFAULT_THEME);
    await ok(s.admin.post('/api/admin/themes/ocean/enable'));
    expect((await ok(s.admin.req('DELETE', '/api/admin/themes/ocean', { confirm: 'ocean' }))).movedBoard).toBe(true);
    expect((await ok(s.admin.get('/api/admin/speakers'))).settings).toMatchObject({ theme: DEFAULT_THEME, themeAvailable: true });
  });

  it('open boards hear about a change to their theme, and a replaced package changes the board version (review fix)', async () => {
    await ok(s.admin.put('/api/admin/module-policies/superSpeakers', { availability: 'enabled' }));
    await enabledOcean();
    await ok(s.admin.put('/api/admin/speakers/settings', { theme: 'ocean' }));
    let signals = 0;
    const off = onBoardChange(() => signals++);
    const settle = () => new Promise((r) => setImmediate(r));
    try {
      await settle();
      signals = 0;
      const v1 = buildBoard(env.db, env.clock.now()).version;
      env.clock.advance(1000);
      await ok(s.admin.put('/api/admin/themes/ocean', { source: withChanges((p) => (p.name.en = 'Deep ocean')) }));
      await settle();
      expect(signals).toBe(1);
      expect(buildBoard(env.db, env.clock.now()).version).not.toBe(v1);
      for (const step of ['disable', 'enable']) {
        await ok(s.admin.post(`/api/admin/themes/ocean/${step}`));
        await settle();
      }
      expect(signals).toBe(3);
      // A theme the board does not use sends nothing.
      await ok(s.admin.post('/api/admin/themes', { source: withChanges(() => undefined, 'lagoon') }));
      await ok(s.admin.post('/api/admin/themes/lagoon/enable'));
      await settle();
      expect(signals).toBe(3);
      await ok(s.admin.req('DELETE', '/api/admin/themes/ocean', { confirm: 'ocean' }));
      await settle();
      expect(signals).toBe(4);
    } finally {
      off();
    }
  });

  it('the public package answers 304 to its ETag until the package is replaced (review fix)', async () => {
    await enabledOcean();
    const anon = new Client(env);
    const first = await anon.get('/api/themes/custom/ocean');
    expect(first.status).toBe(200);
    const etag = String(first.headers.etag);
    expect(etag).toMatch(/^"ocean-\d+"$/u);
    expect((await anon.req('GET', '/api/themes/custom/ocean', undefined, { 'if-none-match': etag })).status).toBe(304);
    env.clock.advance(1000);
    await ok(s.admin.put('/api/admin/themes/ocean', { source: withChanges((p) => (p.name.en = 'Deep ocean')) }));
    const again = await anon.req('GET', '/api/themes/custom/ocean', undefined, { 'if-none-match': etag });
    expect(again.status).toBe(200);
    expect(again.body.name.en).toBe('Deep ocean');
  });
});
