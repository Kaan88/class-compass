/**
 * Server module manifests (SX, D-069, ENG-1): every module folder has one manifest listed in the
 * registry, policy keys come from the shared catalogue, End Lesson steps are ordered deterministically
 * and config defaults match the services (CFG-1/3, LES-3).
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';
import { CONTEXT_MODULES, MODULE_KEYS, moduleLabelKey } from '../../src/shared/modules.ts';
import { registeredCommandTypes } from '../../src/server/lib/commands.ts';
import { contextModules } from '../../src/server/db/schema.ts';
import { collectContributions, enabledContributions, installModules, reportContributions, SERVER_MODULES, studentPageContributions } from '../../src/server/modules/index.ts';
import { defineServerModule } from '../../src/server/modules/manifest.ts';
import { allEndSteps } from '../../src/server/modules/lessons/endSteps.ts';
import { mergeModuleConfig, moduleConfig, moduleConfigSpec } from '../../src/server/modules/school/modules.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';

const MODULES_DIR = join(import.meta.dirname, '..', '..', 'src', 'server', 'modules');

describe('server manifests', () => {
  it('every module folder has a manifest.ts listed exactly once in the registry', () => {
    const folders = readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const f of folders) expect(existsSync(join(MODULES_DIR, f, 'manifest.ts')), `${f}/manifest.ts`).toBe(true);
    expect(SERVER_MODULES.map((m) => m.key).sort()).toEqual(folders);
  });

  it('every policy key is a known module key with an EN and TR label', () => {
    for (const m of SERVER_MODULES) {
      if (m.policyKey === null) continue;
      expect(CONTEXT_MODULES).toContain(m.policyKey);
      expect(en).toHaveProperty([moduleLabelKey(m.policyKey)]);
      expect(tr).toHaveProperty([moduleLabelKey(m.policyKey)]);
    }
    for (const k of MODULE_KEYS) expect(Object.keys(en)).toContain(moduleLabelKey(k));
    const policyKeys = SERVER_MODULES.flatMap((m) => (m.policyKey ? [m.policyKey] : []));
    expect(new Set(policyKeys).size).toBe(policyKeys.length);
  });

  it('registers every manifest command once, and nothing else (no import side effects)', () => {
    installModules();
    const declared = SERVER_MODULES.flatMap((m) => (m.commands ?? []).map((c) => c.type));
    const registered = registeredCommandTypes();
    for (const t of declared) expect(registered).toContain(t);
    // Only test files may define extra commands (tests/server/commands.test.ts uses `test.*`).
    expect(registered.filter((t) => !declared.includes(t) && !t.startsWith('test.'))).toEqual([]);
  });

  it('End Lesson steps run in a deterministic order: Secret Students → assistant thank-you → reflection (LES-3)', () => {
    installModules();
    const steps = allEndSteps();
    expect(steps.map((s) => s.key)).toEqual(['secretStudents', 'assistantThanks', 'reflection']);
    const orders = steps.map((s) => s.order);
    expect(new Set(orders).size).toBe(orders.length); // no ties left to key order
    for (const m of SERVER_MODULES) for (const s of m.endSteps ?? []) expect(s.module === null || s.module === m.policyKey).toBe(true);
  });

  it('config defaults match their schema and only modules with a policy key declare one', () => {
    installModules();
    for (const m of SERVER_MODULES) {
      if (!m.config) continue;
      expect(m.policyKey).not.toBeNull();
      expect(m.config.schema.safeParse(m.config.defaults).success).toBe(true);
      expect(moduleConfigSpec(m.policyKey!)).toBe(m.config);
    }
  });
});

describe('module config through the manifest schema (CFG-1, CFG-3)', () => {
  let env: TestEnv;
  let s: School;
  beforeEach(async () => {
    env = await makeEnv();
    s = await buildSchool(env);
  });
  afterEach(async () => env.app.close());

  it('defaults equal what the services use for a context without config', async () => {
    expect(moduleConfig(env.db, s.ctxA.id, 'secretStudents')).toEqual({ count: 2 });
    expect(await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/secret/settings`))).toEqual({ count: 2 });
    expect(moduleConfig(env.db, s.ctxA.id, 'assistant')).toEqual({ schoolDays: [1, 2, 3, 4, 5] });
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/assistant/settings`))).schoolDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('a teacher config patch is validated against the module schema', async () => {
    const bad = await s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/secretStudents`, { enabled: true, config: { count: 99 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.reason).toBe('INVALID_MODULE_CONFIG');
    const unknown = await s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/secretStudents`, { enabled: true, config: { surprise: true } });
    expect(unknown.status).toBe(400);
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/secretStudents`, { enabled: true, config: { count: 3 } }));
    expect(moduleConfig(env.db, s.ctxA.id, 'secretStudents')).toEqual({ count: 3 });
    expect(await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/secret/settings`))).toEqual({ count: 3 });
  });

  it('a stored value that fails the schema (e.g. written before SX) falls back to the manifest default in the services (D-069)', async () => {
    installModules();
    const now = Date.now();
    for (const [module, configJson] of [
      ['secretStudents', JSON.stringify({ count: 99 })],
      ['assistant', JSON.stringify({ schoolDays: [1, 9] })],
    ] as const) {
      env.db.insert(contextModules).values({ contextId: s.ctxA.id, module, enabled: true, configJson, updatedAt: now, updatedBy: null }).run();
    }
    expect(moduleConfig(env.db, s.ctxA.id, 'secretStudents')).toEqual({ count: 2 });
    expect(await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/secret/settings`))).toEqual({ count: 2 });
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/assistant/settings`))).schoolDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('mergeModuleConfig (the services’ write path) validates the patch against the manifest schema', () => {
    installModules();
    const uid = s.ayse.id;
    expect(() => mergeModuleConfig(env.db, s.ctxA.id, 'secretStudents', { count: 99 }, uid, Date.now())).toThrow(expect.objectContaining({ code: 'VALIDATION', details: expect.objectContaining({ reason: 'INVALID_MODULE_CONFIG' }) }));
    expect(() => mergeModuleConfig(env.db, s.ctxA.id, 'assistant', { surprise: true }, uid, Date.now())).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(moduleConfig(env.db, s.ctxA.id, 'secretStudents')).toEqual({ count: 2 });
    expect(mergeModuleConfig(env.db, s.ctxA.id, 'secretStudents', { count: 3 }, uid, Date.now())).toEqual({ count: 3 });
  });
});

describe('report and student-page hooks serve enabled modules only (CFG-2, ACC-12)', () => {
  let env: TestEnv;
  let s: School;
  beforeEach(async () => {
    env = await makeEnv();
    s = await buildSchool(env);
  });
  afterEach(async () => env.app.close());

  it('contributions are stamped with their manifest’s policy key and a disabled module’s sections are left out', async () => {
    installModules();
    const build = () => ({});
    const none = () => null;
    const fake = [
      defineServerModule({ key: 'fakeCore', policyKey: null, reports: [{ key: 'core', order: 20, build }], studentPage: [{ key: 'homework', order: 20, build: none }] }),
      defineServerModule({ key: 'fakeSecret', policyKey: 'secretStudents', reports: [{ key: 'secret', order: 10, build }], studentPage: [{ key: 'goals', order: 10, build: none }] }),
    ];
    const c = collectContributions(fake);
    expect(c.reports.map((r) => [r.key, r.module])).toEqual([
      ['secret', 'secretStudents'],
      ['core', null],
    ]);
    expect(enabledContributions(c.reports, env.db, s.ctxA.id).map((r) => r.key)).toEqual(['secret', 'core']);
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/secretStudents`, { enabled: false }));
    expect(enabledContributions(c.reports, env.db, s.ctxA.id).map((r) => r.key)).toEqual(['core']);
    expect(enabledContributions(c.studentPage, env.db, s.ctxA.id).map((r) => r.key)).toEqual(['homework']);
    expect(enabledContributions(c.reports, env.db, s.ctxB.id).map((r) => r.key)).toEqual(['secret', 'core']);
    // The registered lists go through the same filter: S8 adds the homework and grouping report
    // sections (served from S11) and S10 the goals and homework student page sections, left out once
    // their module is switched off.
    expect(studentPageContributions(env.db, s.ctxA.id).map((r) => [r.key, r.module])).toEqual([
      ['goals', 'goals'],
      ['homework', 'homework'],
    ]);
    expect(reportContributions(env.db, s.ctxA.id).map((r) => [r.key, r.module])).toEqual([
      ['homework', 'homework'],
      ['groupingHistory', 'grouping'],
    ]);
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/homework`, { enabled: false }));
    expect(reportContributions(env.db, s.ctxA.id).map((r) => r.key)).toEqual(['groupingHistory']);
    expect(studentPageContributions(env.db, s.ctxA.id).map((r) => r.key)).toEqual(['goals']);
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/goals`, { enabled: false }));
    expect(studentPageContributions(env.db, s.ctxA.id)).toEqual([]);
  });
});
