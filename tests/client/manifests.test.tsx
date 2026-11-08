// @vitest-environment jsdom
/**
 * Client module manifests (SX, D-069): every manifest key is a known policy key, every string it shows
 * exists in en + tr, ordering is deterministic, and client and server agree (every server End Lesson
 * step has a screen, every optional client module has a server module with the same policy key).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { rosterKey, routinesKey } from '../../src/client/modules/lessons/lessonClient.ts';
import type { ClassroomContext } from '../../src/client/modules/types.ts';
import { CLIENT_MODULES } from '../../src/client/modules/index.ts';
import {
  allDashboardSlots,
  allStartSteps,
  allTeacherPages,
  byOrder,
  dashboardSlotsFor,
  endStepUis,
  initialStartValues,
  menuTeacherPages,
  startStepsFor,
  useStartContributions,
} from '../../src/client/modules/registry.ts';
import { SERVER_MODULES } from '../../src/server/modules/index.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';
import { CONTEXT_MODULES, POLICY_KEYS } from '../../src/shared/modules.ts';

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
      if (m.policyKey !== null) expect(POLICY_KEYS as readonly string[]).toContain(m.policyKey);
      for (const p of [...(m.dashboardSlots ?? []), ...(m.startSteps ?? []), ...(m.studentCardAddons ?? [])]) {
        // A core manifest (policyKey null, e.g. lessons) owns core pieces (module null) that are always on (S13a).
        if (m.policyKey === null) expect(p.module, `${m.key}/${p.key}`).toBeNull();
        else {
          expect(CONTEXT_MODULES as readonly string[]).toContain(p.module);
          expect(p.module, `${m.key}/${p.key}`).toBe(m.policyKey);
        }
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

describe('classroom pieces come from the manifests (D-069): no module is hard-coded in the lesson screens', () => {
  const ctx = (modules: ClassroomContext['modules']): ClassroomContext => ({ id: 'ctx-1', classId: 'cls-1', className: '3A', subjectName: { en: 'English' }, timezone: 'Europe/Istanbul', modules });
  const allOn = ctx({ attendance: true, routines: true, assistant: true, counters: true, secretStudents: true });

  it('Start Lesson steps: attendance → assistant → topics → routine; module steps only for enabled modules (LES-1, S13a)', () => {
    expect(startStepsFor(allOn).map((s) => s.key)).toEqual(['attendance', 'assistant', 'topics', 'routine']);
    expect(startStepsFor(ctx({ routines: true })).map((s) => s.key)).toEqual(['topics', 'routine']);
    // "Today's topic" is a core step: it is there with every module off.
    expect(startStepsFor(ctx({})).map((s) => s.key)).toEqual(['topics']);
  });

  it('dashboard regions: routine stepper beside the timer, attendance before End Lesson, module panels', () => {
    expect(dashboardSlotsFor(allOn, 'stage').map((s) => s.key)).toEqual(['routine']);
    expect(dashboardSlotsFor(allOn, 'actions').map((s) => s.key)).toEqual(['attendance']);
    expect(dashboardSlotsFor(allOn, 'panels').map((s) => s.key)).toEqual(['counters', 'assistant', 'secret']);
    expect([...dashboardSlotsFor(ctx({}), 'stage'), ...dashboardSlotsFor(ctx({}), 'actions'), ...dashboardSlotsFor(ctx({}), 'panels')]).toEqual([]);
    // The top region holds the core "Today's focus" strip (S13a), on with every module off.
    expect(dashboardSlotsFor(ctx({}), 'top').map((s) => s.key)).toEqual(['topics']);
  });

  it('the lesson screens and the router name no module (no hard-coded attendance, routine or counter pieces)', () => {
    const src = (f: string) => readFileSync(join(MODULES_DIR, '..', f), 'utf8');
    for (const f of ['modules/lessons/StartLesson.tsx', 'modules/lessons/Dashboard.tsx']) {
      expect(src(f), f).not.toMatch(/modules\.(attendance|routines|counters|assistant|secretStudents)|useRoutines|AttendanceList|routineTemplateId/);
    }
    expect(src('router.tsx')).not.toMatch(/counter-history|CounterHistory|routes\/teacher\/(?!Teacher)/);
  });

  it('counter history is a counters manifest page without a menu tile', () => {
    const page = allTeacherPages().find((p) => p.path === 'counter-history');
    expect(page?.key).toBe('counterHistory');
    expect(CLIENT_MODULES.find((m) => m.key === 'counters')?.teacherPages).toContain(page);
    expect(menuTeacherPages()).not.toContain(page);
    expect(menuTeacherPages().map((p) => p.key)).toEqual(allTeacherPages().filter((p) => p.menu !== false).map((p) => p.key));
  });

  it('start steps build the one lesson.start payload: changed attendance with what the screen showed, others present, the routine', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    qc.setQueryData(rosterKey('ctx-1', null), {
      localDate: '2026-11-09',
      attendanceEnabled: true,
      students: [
        { id: 'stu-a', fullName: 'Ada Example', initials: 'AE', avatarHue: 10, daily: null, exception: null, effective: 'not_recorded' },
        { id: 'stu-b', fullName: 'Can Example', initials: 'CE', avatarHue: 20, daily: 'absent', exception: null, effective: 'absent' },
      ],
    });
    qc.setQueryData(routinesKey('ctx-1'), { enabled: true, defaultTemplateId: 'tpl-class', templates: [] });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const values = { ...initialStartValues(), attendance: { 'stu-a': 'absent', 'stu-b': 'absent' } };

    const on = renderHook(() => useStartContributions(allOn, values), { wrapper }).result.current;
    expect(on.ready).toBe(true);
    expect(on.input).toEqual({ attendance: [{ studentId: 'stu-a', status: 'absent', expected: null }], othersPresent: true, routineTemplateId: 'tpl-class' });

    const picked = renderHook(() => useStartContributions(allOn, { ...values, routine: 'tpl-other' }), { wrapper }).result.current;
    expect(picked.input.routineTemplateId).toBe('tpl-other');

    // A switched-off module adds nothing (its hook still runs, so the hook count never changes).
    const off = renderHook(() => useStartContributions(ctx({ assistant: true }), values), { wrapper }).result.current;
    expect(off).toEqual({ input: {}, ready: true });
  });

  it('Begin waits while the attendance roster is loading', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const r = renderHook(() => useStartContributions(ctx({ attendance: true }), initialStartValues()), { wrapper }).result.current;
    expect(r.ready).toBe(false);
  });
});
