/**
 * Theme keys (SX, D-070): the shared list behind `classes.theme`. The server validates class themes
 * against it, and the client theme registry (`src/client/themes/registry.ts`) must define exactly
 * these keys (type- and test-enforced), so a new theme becomes selectable everywhere (admin class
 * editor, teacher preview, catalogue, e2e/axe loops) by adding one key here plus its theme folder.
 * Labels are the i18n keys `theme.<key>` (test-enforced in en + tr).
 */
export const THEME_KEYS = ['explorer', 'animals', 'classroom'] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
/** Theme of new classes and of every screen outside a class (sign-in, teacher area). */
export const DEFAULT_THEME: ThemeKey = 'classroom';
export const isThemeKey = (v: string): v is ThemeKey => (THEME_KEYS as readonly string[]).includes(v);
export const themeLabelKey = (key: ThemeKey) => `theme.${key}` as const;
