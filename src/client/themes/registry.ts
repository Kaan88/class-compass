/**
 * Theme registry (SX, D-070): one line per theme folder. It must define exactly the keys of the
 * shared THEME_KEYS list (type-checked by `Record<ThemeKey, …>`), which the server validates
 * `classes.theme` against, so a new theme is selectable everywhere once it is listed in both.
 * Everything that iterates themes (picker, previews, catalogue, contrast test, e2e axe loop) uses
 * `THEME_LIST`. See docs/EXTENDING.md "Add a theme".
 */
import { DEFAULT_THEME, THEME_KEYS, type ThemeKey } from '../../shared/themes.ts';
import { animalsTheme } from './animals/index.ts';
import { classroomTheme } from './classroom/index.ts';
import { explorerTheme } from './explorer/index.ts';
import type { ThemeDefinition } from './types.ts';

export const THEMES: Record<ThemeKey, ThemeDefinition> = {
  explorer: explorerTheme,
  animals: animalsTheme,
  classroom: classroomTheme,
};

/** Themes in the shared order (THEME_KEYS). */
export const THEME_LIST: readonly ThemeDefinition[] = THEME_KEYS.map((k) => THEMES[k]);

export const themeOf = (key: string | null | undefined): ThemeDefinition => THEMES[(key && key in THEMES ? key : DEFAULT_THEME) as ThemeKey];
