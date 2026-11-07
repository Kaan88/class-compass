// @vitest-environment jsdom
/**
 * Client module manifests (SX, D-069): every manifest key is a known policy key, every string it shows
 * exists in en + tr, ordering is deterministic, and client and server agree (every server End Lesson
 * step has a screen, every optional client module has a server module with the same policy key).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_MODULES } from '../../src/client/modules/index.ts';
import { allDashboardSlots, allStartSteps, allTeacherPages, byOrder, endStepUis } from '../../src/client/modules/registry.ts';
import { SERVER_MODULES } from '../../src/server/modules/index.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';
import { CONTEXT_MODULES } from '../../src/shared/modules.ts';

const MODULES_DIR = join(import.meta.dirname, '..', '..', 'src', 'client', 'modules');
const inBoth = (k: string) => k in en && k in tr;
const unique = (xs: readonly unknown[]) => new Set(xs).size === xs.length;

describe('client module manifests', () => {
  it('every manifest folder is listed once in the registry', () => {
    const folders = readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && readdirSync(join(MODULES_DIR, e.name)).includes('manifest.tsx'))
      .map((e) => e.name)
      .sort();
    expect(CLIENT_MODULES.map((m) => m.key).sort()).toEqual(folders);
    expect(unique(CLIENT_MODULES.map((m) => m.key))).toBe(true);
  });

  it('every policy key is a known context module, and pieces belong to their manifest’s module', () => {
    for (const m of CLIENT_MODULES) {
      if (m.policyKey !== null) expect(CONTEXT_MODULES as readonly string[]).toContain(m.policyKey);
      for (const p of [...(m.dashboardSlots ?? []), ...(m.startSteps ?? []), ...(m.studentCardAddons ?? [])]) {
        expect(CONTEXT_MODULES as readonly string[]).toContain(p.module);
        if (m.policyKey !== null) expect(p.module, `${m.key}/${p.key}`).toBe(m.policyKey);
      }
    }
  });

  it('every string a manifest shows exists in en and tr, and every i18n namespace has keys in both', () => {
    for (const m of CLIENT_MODULES) {
      expect(Object.keys(en).some((k) => k.startsWith(`${m.i18nNamespace}.`)), `en ${m.i18nNamespace}.*`).toBe(true);
      expect(Object.keys(tr).some((k) => k.startsWith(`${m.i18nNamespace}.`)), `tr ${m.i18nNamespace}.*`).toBe(true);
      for (const p of m.teacherPages ?? []) expect(inBoth(p.labelKey), p.labelKey).toBe(true);
      for (const s of m.startSteps ?? []) expect(inBoth(s.title), s.title).toBe(true);
      for (const s of m.endSteps ?? []) expect(inBoth(s.title), s.title).toBe(true);
      if (m.policyKey !== null) expect(inBoth(`module.${m.policyKey}`), `module.${m.policyKey}`).toBe(true);
    }
  });

  it('ordering is deterministic: unique keys and orders, sorted by order then key, stable under input order', () => {
    for (const list of [allDashboardSlots(), allStartSteps(), allTeacherPages()]) {
      expect(unique(list.map((x) => x.key))).toBe(true);
      expect(unique(list.map((x) => x.order))).toBe(true);
      expect(list.map((x) => x.key)).toEqual(byOrder([...list].reverse()).map((x) => x.key));
    }
    const pages = allTeacherPages();
    expect(unique(pages.map((p) => p.path))).toBe(true);
    for (const p of pages) expect(p.path).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(pages.slice(0, 3).map((p) => p.key)).toEqual(['profile', 'classes', 'students']);
  });

  it('client and server agree: every server End Lesson step has a screen; optional modules exist on both sides', () => {
    const serverSteps = SERVER_MODULES.flatMap((m) => (m.endSteps ?? []).map((s) => s.key));
    expect(serverSteps.length).toBeGreaterThan(0);
    expect(endStepUis(serverSteps).map((s) => s.key)).toEqual(serverSteps);
    const serverPolicies = new Set(SERVER_MODULES.flatMap((m) => (m.policyKey ? [m.policyKey] : [])));
    for (const m of CLIENT_MODULES) if (m.policyKey !== null) expect(serverPolicies.has(m.policyKey), m.key).toBe(true);
  });
});
