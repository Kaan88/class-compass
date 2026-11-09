/**
 * Report views (S14e1, D-153): which report sections, and which of their tables, a teacher or an
 * administrator wants to see. A view is a template: it never names a class, a student or a period
 * (those are deep-link parameters), so a saved view holds no student data.
 *
 * Built-in views are constants shared by client and server. Saved views live in `report_views`
 * (at most MAX_REPORT_VIEWS per account); the account's default view is the user setting
 * `reports.defaultView.<viewer>` (`server/lib/userSettings.ts`).
 *
 * On the wire a view travels as the report's `sections` parameter: comma-separated tokens, either a
 * section key (`attendance`, the whole section) or `section.table` (only that table). Table keys are
 * the keys of the section's catalogue (`ReportContribution.meta`); a `perItem` table (one per counter)
 * matches every produced table `<key>-<id>`.
 */
import { z } from 'zod';

/** A section or table key of the catalogue (letters and digits, starting with a letter). */
export const ReportKey = z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,59}$/u);

export const ReportViewSection = z.object({
  key: ReportKey,
  /** null = every table of the section (also tables added later). */
  tables: z.array(ReportKey).min(1).max(30).nullable(),
});
export type ReportViewSection = z.infer<typeof ReportViewSection>;

export const ReportViewSpec = z
  .object({ sections: z.array(ReportViewSection).min(1).max(40) })
  .refine((s) => new Set(s.sections.map((x) => x.key)).size === s.sections.length, { message: 'Each section once' })
  .refine((s) => s.sections.every((x) => x.tables === null || new Set(x.tables).size === x.tables.length), { message: 'Each table once' });
export type ReportViewSpec = z.infer<typeof ReportViewSpec>;

/** Saved views per account. */
export const MAX_REPORT_VIEWS = 30;
export const REPORT_VIEW_NAME_MAX = 60;

export const BUILTIN_VIEW_IDS = ['everything', 'attendanceHomework', 'goalsReflections', 'classroomTools', 'achievementsSpeakers', 'studentOverview'] as const;
export type BuiltinViewId = (typeof BUILTIN_VIEW_IDS)[number];

const all = (...keys: string[]): ReportViewSection[] => keys.map((key) => ({ key, tables: null }));

/**
 * The built-in views (owner decision 2026-11-09). `null` = everything, including sections of modules
 * added later. Every built-in view starts with the overview (lessons held), which gives the numbers
 * below their context. A section that is off for a class+subject is simply not there.
 */
export const BUILTIN_VIEWS: Readonly<Record<BuiltinViewId, ReportViewSpec | null>> = {
  everything: null,
  attendanceHomework: { sections: all('overview', 'attendance', 'homework') },
  goalsReflections: { sections: all('overview', 'lessonTopics', 'goals', 'studentReflections', 'lessonReflections') },
  classroomTools: { sections: all('overview', 'counters', 'assistant', 'secretStudents', 'groupingHistory') },
  achievementsSpeakers: { sections: all('overview', 'achievements', 'superSpeakers') },
  // One row per student in each area: the view the student stats drawer opens (S14e2).
  studentOverview: {
    sections: [
      { key: 'overview', tables: null },
      { key: 'attendance', tables: ['students'] },
      { key: 'homework', tables: ['students', 'outstanding'] },
      { key: 'goals', tables: ['students', 'activity'] },
      { key: 'studentReflections', tables: null },
      { key: 'counters', tables: ['students'] },
      { key: 'assistant', tables: null },
      { key: 'achievements', tables: ['students'] },
      { key: 'superSpeakers', tables: ['students'] },
    ],
  },
};

/** A reference to a view: `builtin:<id>` or a saved view's id. */
export const ViewRef = z.string().regex(/^(builtin:[A-Za-z]{1,40}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u);
export type ViewRef = z.infer<typeof ViewRef>;
export const builtinRef = (id: BuiltinViewId): ViewRef => `builtin:${id}`;
export const DEFAULT_VIEW_REF: ViewRef = builtinRef('everything');

export function builtinOf(ref: string): BuiltinViewId | null {
  if (!ref.startsWith('builtin:')) return null;
  const id = ref.slice('builtin:'.length);
  return (BUILTIN_VIEW_IDS as readonly string[]).includes(id) ? (id as BuiltinViewId) : null;
}

/** The `sections` report parameter. Commas separate tokens; a token is `section` or `section.table`. */
export const SectionsParam = z.string().max(4000).regex(/^[A-Za-z0-9.,]*$/u);

/** Encodes a view for the `sections` parameter (undefined = everything). */
export function sectionsParam(spec: ReportViewSpec | null): string | undefined {
  if (!spec) return undefined;
  return spec.sections.flatMap((s) => (s.tables ? s.tables.map((t) => `${s.key}.${t}`) : [s.key])).join(',');
}

/** Section key → the chosen table keys (null = all of them). */
export type SectionFilter = ReadonlyMap<string, ReadonlySet<string> | null>;

/** Parses the `sections` parameter; undefined or empty = no filter (everything). */
export function parseSectionsParam(param: string | undefined): SectionFilter | null {
  if (!param) return null;
  const out = new Map<string, Set<string> | null>();
  for (const token of param.split(',')) {
    if (!token) continue;
    const [section, tableKey, extra] = token.split('.');
    if (!section || extra !== undefined) continue;
    if (tableKey === undefined) out.set(section, null);
    else if (tableKey && out.get(section) !== null) out.set(section, new Set([...(out.get(section) ?? []), tableKey]));
  }
  return out.size ? out : null;
}

/** The view as a filter (null = everything). */
export const filterOfSpec = (spec: ReportViewSpec | null): SectionFilter | null => parseSectionsParam(sectionsParam(spec));

export interface TableMetaLike {
  key: string;
  perItem?: boolean | undefined;
}

/** Does a produced table (`students-<counterId>` or `students`) belong to this catalogue table? */
export const tableMatches = (meta: TableMetaLike, tableKey: string): boolean => tableKey === meta.key || (meta.perItem === true && tableKey.startsWith(`${meta.key}-`));
