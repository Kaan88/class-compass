/**
 * Theme keys (SX, D-070; open keys since S14g, D-158).
 * - `THEME_KEYS` lists the **built-in** themes. The client theme registry
 *   (`src/client/themes/registry.ts`) must define exactly these keys (type- and test-enforced), so a
 *   new built-in theme becomes selectable everywhere (admin class editor, teacher preview, catalogue,
 *   e2e/axe loops) by adding one key here plus its theme folder. Labels are the i18n keys
 *   `theme.<key>` (test-enforced in en + tr).
 * - Since S14g a class (and the Super Speakers board) may also use an **imported theme package**
 *   whose key is a slug (`THEME_SLUG`). `classes.theme` is therefore an open string: the contract
 *   checks the slug shape, the server checks that it is usable (`assertThemeUsable`: built-in or an
 *   enabled package) and reads fall back to `DEFAULT_THEME` when a package is disabled.
 */
export const THEME_KEYS = ['explorer', 'animals', 'classroom'] as const;
/** A built-in theme key. */
export type BuiltinThemeKey = (typeof THEME_KEYS)[number];
/** Any theme key: a built-in key or the slug of an imported theme package. */
export type ThemeKey = string;
/** Theme of new classes and of every screen outside a class (sign-in, teacher area). */
export const DEFAULT_THEME: BuiltinThemeKey = 'classroom';
/** Is this a built-in theme key? */
export const isThemeKey = (v: string): v is BuiltinThemeKey => (THEME_KEYS as readonly string[]).includes(v);
export const isBuiltinTheme = isThemeKey;
export const themeLabelKey = (key: BuiltinThemeKey) => `theme.${key}` as const;

/**
 * Shape of every theme key: 3–32 characters, lower-case letters, digits and single hyphens, starting
 * with a letter. Theme keys end up in CSS selectors and keyframe names, so nothing else is allowed.
 */
export const THEME_SLUG = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,31}$/u;
export const isThemeSlug = (v: string): boolean => THEME_SLUG.test(v);
