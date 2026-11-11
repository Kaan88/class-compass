/**
 * Module catalogue (SX, D-069): the ONE shared list of module policy keys. Contracts, the admin
 * policy screen, the teacher module switches, `isModuleEnabled` and both module manifests (server
 * `src/server/modules/<m>/manifest.ts`, client `src/client/modules/<m>/manifest.tsx`) derive their
 * keys from here, so a new module is one line in this list (plus its manifests).
 *
 * - `CONTEXT_MODULE_CATALOG`: modules a teacher switches per class+subject within admin policy (CFG-1).
 * - `MEDIA_MODULE_CATALOG`: admin-only global media flags (D-014).
 * - `SCHOOL_MODULE_CATALOG` (S12, D-127): school-wide modules an administrator switches for the whole
 *   school (no per class+subject switch), e.g. Super Speakers. Their manifests use the key as
 *   `policyKey`; `isModuleEnabled` is then the admin availability alone.
 * Labels are the i18n keys `module.<key>` (test-enforced in en + tr).
 * Order matters: it is the order of the switches on the admin and teacher screens.
 */

type Availability = 'enabled' | 'disabled';
interface CatalogEntry {
  readonly key: string;
  readonly defaultAvailability: Availability;
}

export const CONTEXT_MODULE_CATALOG = [
  { key: 'routines', defaultAvailability: 'enabled' },
  { key: 'attendance', defaultAvailability: 'enabled' },
  { key: 'counters', defaultAvailability: 'enabled' },
  { key: 'secretStudents', defaultAvailability: 'enabled' },
  { key: 'assistant', defaultAvailability: 'enabled' },
  { key: 'grouping', defaultAvailability: 'enabled' },
  { key: 'homework', defaultAvailability: 'enabled' },
  { key: 'goals', defaultAvailability: 'enabled' },
  { key: 'achievements', defaultAvailability: 'enabled' },
] as const satisfies readonly CatalogEntry[];

/** Photos and audio stay off until consent is confirmed (D-014, D-026). */
export const MEDIA_MODULE_CATALOG = [
  { key: 'media.studentPhotos', defaultAvailability: 'disabled' },
  { key: 'media.evidencePhotos', defaultAvailability: 'disabled' },
  { key: 'media.evidenceAudio', defaultAvailability: 'disabled' },
  { key: 'media.evidenceDocuments', defaultAvailability: 'enabled' },
  /** S24 (D-184): students' own avatar pictures, checked by a teacher before anyone else sees them. */
  { key: 'media.avatarPictures', defaultAvailability: 'disabled' },
] as const satisfies readonly CatalogEntry[];

/** School-wide modules (S12, D-127): one admin switch, no teacher switch; new ones start disabled. */
export const SCHOOL_MODULE_CATALOG = [{ key: 'superSpeakers', defaultAvailability: 'disabled' }] as const satisfies readonly CatalogEntry[];

type Keys<T extends readonly CatalogEntry[]> = { -readonly [K in keyof T]: T[K]['key'] };
const keysOf = <const T extends readonly CatalogEntry[]>(xs: T) => xs.map((x) => x.key) as unknown as Keys<T>;

export const CONTEXT_MODULES = keysOf(CONTEXT_MODULE_CATALOG);
export const MEDIA_MODULES = keysOf(MEDIA_MODULE_CATALOG);
export const SCHOOL_MODULES = keysOf(SCHOOL_MODULE_CATALOG);
export const MODULE_KEYS = [...CONTEXT_MODULES, ...MEDIA_MODULES, ...SCHOOL_MODULES] as const;
export type ContextModule = (typeof CONTEXT_MODULES)[number];
export type MediaModule = (typeof MEDIA_MODULES)[number];
export type SchoolModule = (typeof SCHOOL_MODULES)[number];
/** What a module manifest's `policyKey` may be: a per class+subject module or a school-wide one (D-127). */
export const POLICY_KEYS = [...CONTEXT_MODULES, ...SCHOOL_MODULES] as const;
export type PolicyKey = (typeof POLICY_KEYS)[number];
export const isSchoolModule = (m: string): m is SchoolModule => (SCHOOL_MODULES as readonly string[]).includes(m);
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Defaults when no policy row exists (D-026). */
export const DEFAULT_AVAILABILITY = Object.fromEntries([...CONTEXT_MODULE_CATALOG, ...MEDIA_MODULE_CATALOG, ...SCHOOL_MODULE_CATALOG].map((m) => [m.key, m.defaultAvailability])) as Record<
  ModuleKey,
  Availability
>;

/** i18n key of a module's name. */
export const moduleLabelKey = (key: ModuleKey) => `module.${key}` as const;
