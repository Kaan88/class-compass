/**
 * Client module manifest types (SX, D-069; ARCHITECTURE §2). Each folder under `src/client/modules/`
 * has ONE `manifest.tsx` that lists what the module contributes to the app:
 * - classroom: dashboard slots, Start Lesson steps, End Lesson step screens (matching the server's
 *   steps by key), student-card add-ons;
 * - teacher area: menu entries + their routes (PIN-gated inside TeacherLayout), a class settings panel;
 * - outbox: which queries to refresh after the module's commands;
 * - i18n: the key namespace its strings live under (test-enforced in en + tr).
 * A piece is shown only while its module (policyKey) is enabled for the class+subject; nothing is
 * shown for modules that contribute nothing, so the classroom never displays a placeholder (D-052).
 */
import type { ComponentType, ReactNode } from 'react';
import type { LessonState } from '../../shared/contracts/lessons.ts';
import type { ContextModule } from '../../shared/modules.ts';
import type { MessageKey } from '../../shared/i18n/index.ts';
import type { CommandInvalidation } from '../lib/outbox-client.ts';

export interface ClassroomContext {
  id: string;
  classId: string;
  className: string;
  subjectName: { en?: string | undefined; tr?: string | undefined };
  timezone: string;
  modules: Partial<Record<ContextModule, boolean>>;
}

export interface DashboardSlot {
  key: string;
  module: ContextModule;
  order: number;
  Component: ComponentType<{ context: ClassroomContext; lesson: LessonState }>;
}

export interface StartStep {
  key: string;
  module: ContextModule;
  order: number;
  title: MessageKey;
  Component: ComponentType<{ context: ClassroomContext }>;
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
}

/**
 * A module's contribution to the student grid. `useAddon` is a React hook: it is called on every
 * dashboard render for every registered addon (with `enabled` false when the module is off), so the
 * number of hook calls never changes; it returns null when it has nothing to add.
 */
export interface StudentCardAddon {
  key: string;
  module: ContextModule;
  useAddon: (context: ClassroomContext, lesson: LessonState, enabled: boolean) => { header?: ReactNode; cardProps: (studentId: string, fullName: string) => StudentCardExtras } | null;
}

/** A teacher-area page: a menu tile + nav link + route `/teacher/<path>` (inside the PIN gate). */
export interface TeacherPage {
  key: string;
  /** Path below /teacher, without slashes (e.g. 'counters'). */
  path: string;
  labelKey: MessageKey;
  Icon: ComponentType;
  /** Menu order (lower first). */
  order: number;
  Component: ComponentType;
}

/** Per-class module settings shown under the module's switch on the class settings page. */
export interface SettingsPanel {
  Component: ComponentType<{ contextId: string }>;
}

export interface ClientModuleManifest {
  /** Folder name under src/client/modules (unique). */
  key: string;
  /** Policy key from `src/shared/modules.ts`, or null for core pieces that are always on. */
  policyKey: ContextModule | null;
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
