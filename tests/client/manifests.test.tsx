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
import { SETUP_TABS, type ClassroomContext } from '../../src/client/modules/types.ts';
import { CLIENT_MODULES } from '../../src/client/modules/index.ts';
import { BOX_CATALOGUE, BOX_KEYS, type BoxKey } from '../../src/shared/classroomLayout.ts';
import {
  allDashboardSlots,
  availableBoxKeys,
  allStartSteps,
  allTeacherPages,
  byOrder,
  dashboardSlotsFor,
  endStepUis,
  initialStartValues,
  menuTeacherPages,
  pageAvailable,
  setupPages,
  todayPages,
  type MenuContexts,
  startStepsFor,
  useStartContributions,
} from '../../src/client/modules/registry.ts';
import { SERVER_MODULES } from '../../src/server/modules/index.ts';
import { en, tr } from '../messages.ts';
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
    expect(pages.slice(0, 3).map((p) => p.key)).toEqual(['profile', 'setup', 'classes']);
  });

  it('teacher menu (S14e3, D-156): Today holds Attendance, Homework, Goals, Reports, Notifications and the Assistant (S19b); every other menu page is in a Class setup tab', () => {
    expect(todayPages().map((p) => p.key)).toEqual(['attendance', 'homework', 'goals', 'reports', 'notifications', 'assistantChat']);
    for (const p of menuTeacherPages()) {
      expect(['today', 'setup'], p.key).toContain(p.group);
      if (p.group === 'setup') expect(SETUP_TABS, p.key).toContain(p.setupTab);
      else expect(p.setupTab, p.key).toBeUndefined();
    }
    expect(SETUP_TABS.flatMap((tab) => setupPages(undefined, tab)).map((p) => p.key).sort()).toEqual(setupPages().map((p) => p.key).sort());
    for (const tab of SETUP_TABS) expect(setupPages([], tab).length, tab).toBeGreaterThan(0);
    // A page's module is a context module of its own manifest (core pages have none).
    for (const m of CLIENT_MODULES) for (const p of m.teacherPages ?? []) if (p.module) expect(CONTEXT_MODULES as readonly string[], p.key).toContain(p.module);
    expect(allTeacherPages().find((p) => p.key === 'secret')?.module).toBe('secretStudents');
  });

  it('pages of a module that is off in every class+subject are hidden; loading or no classes hides nothing (D-156)', () => {
    const on = { goals: true, homework: true, attendance: true, counters: true };
    const off = { goals: false, homework: false, attendance: false, counters: false };
    const keys = (cs?: MenuContexts) => menuTeacherPages(cs).map((p) => p.key);
    expect(keys(undefined)).toEqual(keys([]));
    expect(keys([{ modules: on }])).toContain('homework');
    // Off in one class, on in another: still listed.
    expect(keys([{ modules: off }, { modules: on }])).toContain('homework');
    const hidden = keys([{ modules: off }, { modules: off }]);
    for (const k of ['homework', 'goals', 'attendance', 'counters', 'routines', 'secret', 'assistant', 'grouping', 'achievements']) expect(hidden, k).not.toContain(k);
    for (const k of ['reports', 'notifications', 'assistantChat', 'classes', 'students', 'topics', 'avatars', 'textChecks']) expect(hidden, k).toContain(k);
    expect(pageAvailable({ module: 'homework' }, [{ modules: off }])).toBe(false);
    expect(pageAvailable({ module: null }, [{ modules: off }])).toBe(true);
  });

  it('every teacher menu tile has its own icon, so the tiles can be scanned by icon (usability audit 2026-11)', () => {
    const tiles = [...menuTeacherPages(), ...allTeacherPages().filter((p) => p.key === 'setup')];
    expect(unique(tiles.map((p) => p.Icon)), tiles.map((p) => `${p.key}: ${p.Icon.name}`).join(', ')).toBe(true);
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

  it('board boxes (S14b, D-148): every slot key is a box of the catalogue; the board gets the enabled ones', () => {
    for (const s of allDashboardSlots()) {
      expect(BOX_KEYS as readonly string[], s.key).toContain(s.key);
      expect(BOX_CATALOGUE[s.key as BoxKey].core, s.key).toBe(false);
      // A slot that can be a dock button needs its button (icon + label), except a slot that is its own
      // dock control (attendance: no dock spec, never a box).
      const spec = BOX_CATALOGUE[s.key as BoxKey];
      if (spec.dock && spec.row) expect(s.dock, s.key).toBeTruthy();
      if (s.dock) expect(inBoth(s.dock.label), s.dock.label).toBe(true);
    }
    // Every module box of the catalogue is some module's slot (no dead keys).
    for (const k of BOX_KEYS) if (!BOX_CATALOGUE[k].core) expect(allDashboardSlots().map((s) => s.key), k).toContain(k);
    expect(dashboardSlotsFor(allOn).map((s) => s.key)).toEqual(['focus', 'counters', 'assistant', 'secret', 'attendance', 'routine']);
    // "Today's focus" is core (S13a): on with every module off.
    expect(dashboardSlotsFor(ctx({})).map((s) => s.key)).toEqual(['focus']);
    expect([...availableBoxKeys(ctx({}))].sort()).toEqual(['core.dock', 'core.students', 'core.timer', 'focus']);
  });

  it('the lesson screens and the router name no module (no hard-coded attendance, routine or counter pieces)', () => {
    const src = (f: string) => readFileSync(join(MODULES_DIR, '..', f), 'utf8');
    const board = readdirSync(join(MODULES_DIR, 'lessons', 'board')).map((f) => `modules/lessons/board/${f}`);
    for (const f of ['modules/lessons/StartLesson.tsx', ...board]) {
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
    const off = renderHook(() => useStartContributions(ctx({ secretStudents: true }), values), { wrapper }).result.current;
    expect(off).toEqual({ input: {}, ready: true });
  });

  it('two modules\' server start steps are merged key by key into lesson.start `steps` (S14b, D-149)', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    qc.setQueryData(rosterKey('ctx-1', null), { localDate: '2026-11-09', attendanceEnabled: true, students: [] });
    qc.setQueryData(['classroom', 'assistant', 'today', 'ctx-1'], {
      localDate: '2026-11-09',
      schoolDay: true,
      assistant: { id: 'stu-a', fullName: 'Ada Example', initials: 'AE', avatarHue: 10 },
      responsibilities: [
        { id: 'r1', label: { en: 'Board' } },
        { id: 'r2', label: { en: 'Books' } },
      ],
      thanked: false,
      checked: ['r2'],
      showPanel: true,
    });
    const values = { ...initialStartValues(), assistant: { studentId: 'stu-a', ticks: { r1: true, r2: false } } };
    const r = renderHook(() => useStartContributions(allOn, values), { wrapper }).result.current;
    expect(r.ready).toBe(true);
    expect(r.input.steps).toEqual({ assistant: { studentId: 'stu-a', check: ['r1'], uncheck: ['r2'] } });
    expect(r.input.othersPresent).toBe(true);
    // Nothing changed against what is recorded: no step input at all.
    const same = renderHook(() => useStartContributions(allOn, { ...values, assistant: { studentId: 'stu-a', ticks: { r2: true } } }), { wrapper }).result.current;
    expect(same.input.steps).toBeUndefined();
  });

  it('every server Start Lesson step has a client start step with the same key and module (D-149)', () => {
    const client = new Map(allStartSteps().map((s) => [s.key, s]));
    const server = SERVER_MODULES.flatMap((m) => m.startSteps ?? []);
    expect(server.length).toBeGreaterThan(0);
    for (const s of server) {
      expect(client.get(s.key)?.module, s.key).toBe(s.module);
      expect(client.get(s.key)?.useContribution, s.key).toBeTruthy();
    }
  });

  it('Begin waits while the attendance roster is loading', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const r = renderHook(() => useStartContributions(ctx({ attendance: true }), initialStartValues()), { wrapper }).result.current;
    expect(r.ready).toBe(false);
  });
});
