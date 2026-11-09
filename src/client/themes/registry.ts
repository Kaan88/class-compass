/**
 * Theme registry (SX, D-070; imported themes S14g, D-158).
 * - Built-in themes: one line per theme folder. It must define exactly the keys of the shared
 *   THEME_KEYS list (type-checked by `Record<BuiltinThemeKey, …>`), which the server accepts for
 *   `classes.theme`, so a new theme is selectable everywhere once it is listed in both. Everything that
 *   iterates the built-in themes (catalogue, contrast test, e2e axe loop) uses `THEME_LIST`.
 * - Imported themes (packages) are added at run time by `themes/custom.tsx` (`registerThemePackage`):
 *   an enabled package the screen needs, or a preview on Admin → Themes. `themeOf` finds both; an
 *   unknown key falls back to the default theme. Pickers list `pickerThemes()`.
 * See docs/EXTENDING.md "Add a theme" and docs/THEMING.md.
 */
import { DEFAULT_THEME, THEME_KEYS, type BuiltinThemeKey } from '../../shared/themes.ts';
import { animalsTheme } from './animals/index.ts';
import { classroomTheme } from './classroom/index.ts';
import { explorerTheme } from './explorer/index.ts';
import type { ThemeDefinition } from './types.ts';

export const THEMES: Record<BuiltinThemeKey, ThemeDefinition> = {
  explorer: explorerTheme,
  animals: animalsTheme,
  classroom: classroomTheme,
};

/** Built-in themes in the shared order (THEME_KEYS). */
export const THEME_LIST: readonly ThemeDefinition[] = THEME_KEYS.map((k) => THEMES[k]);

// ---------------------------------------------------------------- imported themes (S14g)
const custom = new Map<string, ThemeDefinition>();
const listeners = new Set<() => void>();
let version = 0;

/** Adds or replaces an imported theme (built from a validated package by `themes/custom.tsx`). */
export function setCustomTheme(def: ThemeDefinition): void {
  if (Object.hasOwn(THEMES, def.key)) throw new Error(`${def.key} is a built-in theme`);
  custom.set(def.key, def);
  version += 1;
  listeners.forEach((l) => l());
}

export function removeCustomTheme(key: string): void {
  if (!custom.delete(key)) return;
  version += 1;
  listeners.forEach((l) => l());
}

export const getCustomTheme = (key: string): ThemeDefinition | undefined => custom.get(key);
/** Imported themes currently known on this page (enabled ones and previews). */
export const customThemeList = (): ThemeDefinition[] => [...custom.values()];
/** Changes whenever an imported theme is added or removed (for `useSyncExternalStore`). */
export const customThemesVersion = () => version;
export function subscribeCustomThemes(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Every theme with CSS on this page: the built-in ones, then the imported ones. */
export const allThemeDefinitions = (): ThemeDefinition[] => [...THEME_LIST, ...custom.values()];

/** Themes a teacher or administrator may choose: built-in plus enabled imported themes (never previews or drafts). */
export const pickerThemes = (): ThemeDefinition[] => [...THEME_LIST, ...[...custom.values()].filter((d) => d.custom?.status === 'enabled')];

/** The definition for a key: built-in, imported, else the default theme (D-158: reads fall back). */
export const themeOf = (key: string | null | undefined): ThemeDefinition => {
  if (key && Object.hasOwn(THEMES, key)) return THEMES[key as BuiltinThemeKey];
  return (key ? custom.get(key) : undefined) ?? THEMES[DEFAULT_THEME];
};
