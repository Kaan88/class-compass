/**
 * Client module manifest types (SX, D-069; ARCHITECTURE §2). Each folder under `src/client/modules/`
 * has ONE `manifest.tsx` that lists what the module contributes to the app:
 * - classroom: dashboard slots (boxes or dock buttons of the classroom board, S14b), Start Lesson
 *   steps (each adds its part of the 'lesson.start' command), End Lesson step screens (matching the
 *   server's steps by key), student-card add-ons;
 * - teacher area: menu entries + their routes (PIN-gated inside TeacherLayout), a class settings panel;
 * - outbox: which queries to refresh after the module's commands;
 * - i18n: the key namespace its strings live under (test-enforced in en + tr).
 * A piece is shown only while its module (policyKey) is enabled for the class+subject; nothing is
 * shown for modules that contribute nothing, so the classroom never displays a placeholder (D-052).
 */
import type { ComponentType, ReactNode } from 'react';
import type { EffectiveAttendance } from '../../domain/attendance.ts';
import type { LessonCommandPayload, LessonState } from '../../shared/contracts/lessons.ts';
import type { ContextModule, PolicyKey } from '../../shared/modules.ts';
import type { MessageKey } from '../../shared/i18n/index.ts';
import type { CommandInvalidation } from '../lib/outbox-client.ts';

export interface ClassroomContext {
  id: string;
  classId: string;
  className: string;
  subjectName: { en?: string | undefined; tr?: string | undefined };
  timezone: string;
  modules: Partial<Record<ContextModule, boolean>>;
  /** Class language mode (S13a, D-099); absent in older callers = English only. */
  mainLanguage?: 'en' | 'tr';
  secondLanguageEnabled?: boolean;
  /** Quote of the day on the classroom top bar (S13b); absent = on. */
  quoteEnabled?: boolean;
}

/**
 * How a dashboard slot is shown on the classroom board (S14b, D-148): as a box in a row of the board,
 * or inside the full-screen view that its dock button opens.
 */
export type SlotPresentation = 'box' | 'dock';

export interface DashboardSlotProps {
  context: ClassroomContext;
  lesson: LessonState;
  presentation: SlotPresentation;
}

/**
 * The slot's button in the board's dock (S14b): icon, label and an optional short badge (a hook,
 * called on every render of the button). A badge is shown to the class, so it never carries a
 * sensitive count (no levels, no Secret Student identities, no private data).
 */
export interface DockSpec {
  Icon: ComponentType;
  label: MessageKey;
  useBadge?: (context: ClassroomContext, lesson: LessonState) => string | null;
}

export interface DashboardSlot {
  /**
   * The slot's box on the classroom board: a key of `BOX_CATALOGUE` (`shared/classroomLayout.ts`,
   * test-enforced), which holds its default place (row or dock) and minimum size.
   */
  key: string;
  module: ContextModule | null;
  order: number;
  /**
   * With a dock spec the dock shows a button that opens the slot in a full-screen view; without one
   * the slot renders its own control in the dock (the attendance button and its dialog).
   */
  dock?: DockSpec;
  /** May render nothing (null) when it has nothing to show for this lesson. */
  Component: ComponentType<DashboardSlotProps>;
}

/** What a Start Lesson step may add to the one 'lesson.start' command (everything but the context). */
export type StartLessonContribution = Partial<Omit<LessonCommandPayload<'lesson.start'>, 'contextId'>>;

export interface StartStepProps<V> {
  context: ClassroomContext;
  /** The step's value from the per-class start draft (kept when switching classes, LES-4). */
  value: V;
  onChange: (update: (v: V) => V) => void;
}

export interface StartStep<V = unknown> {
  key: string;
  module: ContextModule | null;
  order: number;
  title: MessageKey;
  initial: () => V;
  Component: ComponentType<StartStepProps<V>>;
  /**
   * Optional React hook: what this step adds to 'lesson.start' and whether "Begin" may be pressed
   * (e.g. false while the step's data is loading). It is called on every Start Lesson render for every
   * registered step, with `enabled` false when the module is off (then it must contribute nothing),
   * so the number of hook calls never changes. Contributions are merged in step order; `steps`
   * (the inputs of server start steps, S14b) is merged key by key, so two modules never overwrite
   * each other's part.
   */
  useContribution?: (context: ClassroomContext, value: V, enabled: boolean) => { input: StartLessonContribution; ready: boolean };
}

export interface EndStepUi<V = unknown> {
  /** Same key as the server step (`lesson.endSteps`); the server decides which steps run and in which order. */
  key: string;
  title: MessageKey;
  initial: () => V;
  Component: ComponentType<{ lesson: LessonState; value: V; onChange: (v: V) => void }>;
}

/** Extra props a module puts on every student card (S6: weekly count, level, + button). */
export interface StudentCardExtras {
  weeklyCount?: number;
  level?: 0 | 1 | 2 | 3;
  countLabel?: string;
  periodLabel?: string;
  addLabel?: string;
  onAdd?: () => void;
  notice?: string | null;
  /** Effective attendance for the lesson (attendance module). */
  attendance?: EffectiveAttendance;
}

/**
 * A module's contribution to the student grid. `useAddon` is a React hook: it is called on every
 * dashboard render for every registered addon (with `enabled` false when the module is off), so the
 * number of hook calls never changes; it returns null when it has nothing to add.
 */
export interface StudentCardAddon {
  key: string;
  module: ContextModule | null;
  /**
   * `summary` is a short line beside the student heading (visible even with the grid closed);
   * `header` is shown above the grid.
   */
  useAddon: (
    context: ClassroomContext,
    lesson: LessonState,
    enabled: boolean,
  ) => { summary?: ReactNode; header?: ReactNode; cardProps: (studentId: string, fullName: string) => StudentCardExtras } | null;
}

/** Search parameters of a teacher page URL (`/teacher/<path>?a=b`), as strings. */
export type TeacherPageSearch = Readonly<Record<string, string | undefined>>;

/** Where a menu page is listed (S14e3, D-156): the menu's "Today" group, or the Class setup hub. */
export type TeacherPageGroup = 'today' | 'setup';
/** The tab of the Class setup hub a setup page is listed under. */
export type SetupTab = 'classes' | 'lessons' | 'progress';
export const SETUP_TABS: readonly SetupTab[] = ['classes', 'lessons', 'progress'];

/**
 * A teacher-area page: the route `/teacher/<path>` (inside the PIN gate) plus, unless `menu` is
 * false, a tile and nav link in its `group` (S14e3, D-156): "Today" pages are tiles on the teacher
 * menu, setup pages are tiles in the Class setup hub (`/teacher/setup`, one tab per `setupTab`). A
 * sub-page reached from another page (e.g. counter history) sets `menu: false`.
 */
export interface TeacherPage {
  key: string;
  /** Path below /teacher, without slashes (e.g. 'counters'). */
  path: string;
  labelKey: MessageKey;
  Icon: ComponentType;
  /** Menu order (lower first). */
  order: number;
  /** false = route only, no menu tile or nav link. */
  menu?: boolean;
  /** Menu pages: the "Today" group or the Class setup hub (test-enforced for every menu page). */
  group?: TeacherPageGroup;
  /** Setup pages: the hub's tab (test-enforced). */
  setupTab?: SetupTab;
  /**
   * The module the page belongs to (null/absent = core). Its tile and link are hidden while the module
   * is off in every class+subject of the teacher, and the page itself then shows an empty state; the
   * URL keeps working.
   */
  module?: ContextModule | null;
  Component: ComponentType<{ search: TeacherPageSearch }>;
}

/** Per-class module settings shown under the module's switch on the class settings page. */
export interface SettingsPanel {
  Component: ComponentType<{ contextId: string }>;
}

export interface ClientModuleManifest {
  /** Folder name under src/client/modules (unique). */
  key: string;
  /** Policy key from `src/shared/modules.ts`, or null for core pieces that are always on. */
  policyKey: PolicyKey | null;
  /** Prefix of the module's i18n keys (`<namespace>.…`), present in en.ts and tr.ts. */
  i18nNamespace: string;
  dashboardSlots?: readonly DashboardSlot[];
  startSteps?: readonly StartStep[];
  endSteps?: readonly EndStepUi[];
  studentCardAddons?: readonly StudentCardAddon[];
  teacherPages?: readonly TeacherPage[];
  settingsPanel?: SettingsPanel;
  invalidations?: readonly CommandInvalidation[];
}

/** Identity helpers that type-check manifest pieces. */
export const defineClientModule = (m: ClientModuleManifest): ClientModuleManifest => m;
export const endStepUi = <V,>(step: EndStepUi<V>): EndStepUi => step as unknown as EndStepUi;
export const startStep = <V,>(step: StartStep<V>): StartStep => step as unknown as StartStep;
