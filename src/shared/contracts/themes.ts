/**
 * Theme packages (S14g, D-158): administrators import, preview, enable, disable, export and delete
 * themes made as JSON packages (`shared/themePackage`). Enabled packages are offered next to the
 * built-in themes for classes and the Super Speakers board.
 */
import { z } from 'zod';
import { THEME_ISSUE_CODES } from '../themePackage/validate.ts';
import { ThemeSlug } from '../themePackage/schema.ts';
import { THEME_KEYS } from '../themes.ts';
import { endpoint, Empty, pii } from './define.ts';

export const CUSTOM_THEME_STATUSES = ['draft', 'enabled', 'disabled'] as const;
export type CustomThemeStatus = (typeof CUSTOM_THEME_STATUSES)[number];

const Issue = z.object({
  code: z.enum(THEME_ISSUE_CODES),
  path: z.string().meta(pii('none')),
  message: z.string().meta(pii('none')),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional().meta(pii('none')),
});
export const ThemeReport = z.object({
  ok: z.boolean(),
  key: z.string().nullable(),
  errors: z.array(Issue),
  warnings: z.array(Issue),
  stats: z.object({ bytes: z.number(), pictures: z.number(), svgNodes: z.number(), // Scene stats (S17a, D-166); reports stored before S17a have none.
    sceneLayers: z.number().default(0),
    sceneBytes: z.number().default(0),
    sceneNodes: z.number().default(0),
    // Each scene layer's bytes and elements against the per-layer limits (S17a review).
    sceneLayerStats: z.array(z.object({ bytes: z.number(), nodes: z.number().nullable() })).default([]),
  }),
});
export type ThemeReportDto = z.infer<typeof ThemeReport>;

/**
 * A stored package as the server sends it. It passed `ThemePackage` when it was imported; the client
 * parses it again with `StoredThemePackage` before drawing anything (an older package may lack colour
 * tokens added later, which then come from its base theme).
 */
export const PackageDto = z
  .object({ format: z.string(), version: z.number(), key: z.string() })
  .catchall(z.unknown());
export type PackageDto = z.infer<typeof PackageDto>;

const Labels = z.object({ en: z.string(), tr: z.string() }).meta(pii('label'));
export const CustomThemeSummary = z.object({
  key: z.string(),
  status: z.enum(CUSTOM_THEME_STATUSES),
  name: Labels,
  base: z.enum(THEME_KEYS),
  /** Classes whose stored theme is this key (they fall back to the default while it is not enabled). */
  classCount: z.number().int(),
  /** The Super Speakers board uses it. */
  board: z.boolean(),
  warnings: z.number().int(),
  bytes: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type CustomThemeSummary = z.infer<typeof CustomThemeSummary>;

/** The package file text (JSON). Kept as text so the size and JSON syntax are checked like a file. */
const Source = z.object({ source: z.string().min(1).max(700_000) });
const KeyParam = z.object({ key: ThemeSlug });

export const listCustomThemes = endpoint({
  method: 'GET',
  path: '/api/admin/themes',
  access: 'admin',
  input: Empty,
  output: z.object({ themes: z.array(CustomThemeSummary), limit: z.number().int() }),
  mcp: { scope: 'themes:write', tool: 'list_custom_themes', readOnly: true, description: 'Administrators: the imported theme packages (key, names, base theme, status draft/enabled/disabled, how many classes use each, warnings). Use export_theme for a package itself. No personal data.' },
});
export const getCustomTheme = endpoint({
  method: 'GET',
  path: '/api/admin/themes/:key',
  access: 'admin',
  input: KeyParam,
  output: z.object({ summary: CustomThemeSummary, package: PackageDto, report: ThemeReport }),
});
/** Checks a package without saving anything: the report, and the package when it has no errors. */
export const validateCustomTheme = endpoint({
  method: 'POST',
  path: '/api/admin/themes/validate',
  access: 'admin',
  input: Source,
  output: z.object({ report: ThemeReport, package: PackageDto.nullable(), exists: z.boolean() }),
});
/** Saves a package that has no errors as a new draft (audited). */
export const createCustomTheme = endpoint({ method: 'POST', path: '/api/admin/themes', access: 'admin', input: Source, output: CustomThemeSummary });
/** Replaces the package of an existing theme with the same key; its status stays (audited). */
export const replaceCustomTheme = endpoint({ method: 'PUT', path: '/api/admin/themes/:key', access: 'admin', input: KeyParam.extend(Source.shape), output: CustomThemeSummary });
export const enableCustomTheme = endpoint({ method: 'POST', path: '/api/admin/themes/:key/enable', access: 'admin', input: KeyParam, output: CustomThemeSummary });
/** Classes and the board keep the key and show the default theme until it is enabled again (audited). */
export const disableCustomTheme = endpoint({ method: 'POST', path: '/api/admin/themes/:key/disable', access: 'admin', input: KeyParam, output: CustomThemeSummary });
/** Deletes the theme; its classes and the board move to the default theme (typed confirmation, audited). */
export const deleteCustomTheme = endpoint({
  method: 'DELETE',
  path: '/api/admin/themes/:key',
  access: 'admin',
  input: KeyParam.extend({ confirm: z.string() }),
  output: z.object({ ok: z.literal(true), movedClasses: z.number().int(), movedBoard: z.boolean() }),
});

/** Enabled imported themes, for the theme pickers (signed-in teachers and administrators). */
export const availableThemes = endpoint({ method: 'GET', path: '/api/themes/available', access: 'user', input: Empty, output: z.object({ themes: z.array(PackageDto) }) });
/**
 * One enabled theme package (public: the classroom, student page, board and scorer app draw a class or
 * board theme with it; it holds no school data). A draft, disabled or unknown key answers 404.
 */
export const publicCustomTheme = endpoint({ method: 'GET', path: '/api/themes/custom/:key', access: 'public', input: KeyParam, output: PackageDto });
