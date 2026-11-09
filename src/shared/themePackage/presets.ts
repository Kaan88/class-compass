/**
 * Typography and shadow presets (S14g, D-158). A theme package names a preset instead of writing a
 * CSS value, so nothing a package says can become arbitrary CSS. Fonts are system fonts only: nothing
 * is downloaded and the CSP stays `font-src 'self'`. The built-in themes use the same presets.
 */

/** Font stacks; every one ends in a generic family. */
export const FONT_PRESETS = {
  /** The device's own interface font. */
  system: "system-ui, 'Segoe UI', Roboto, 'Noto Sans', sans-serif",
  /** Friendly humanist headings (Explorer). */
  friendly: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  /** Clean, neutral headings (Classroom). */
  clean: "'Segoe UI', system-ui, Roboto, sans-serif",
  /** Playful hand-drawn headings (Animals). */
  playful: "'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', system-ui, sans-serif",
  /** Rounded, soft headings where the device has such a font. */
  rounded: "'Arial Rounded MT Bold', 'Varela Round', 'Nunito', system-ui, sans-serif",
  /** Wide, very legible letters. */
  wide: "Verdana, 'DejaVu Sans', system-ui, sans-serif",
  /** A book serif for headings. */
  book: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
} as const;
export type FontPreset = keyof typeof FONT_PRESETS;
export const FONT_PRESET_NAMES = Object.keys(FONT_PRESETS) as FontPreset[];

/** Card and dialog elevation; colours always come from `var(--cc-shadow-color)`. */
export const SHADOW_PRESETS = {
  none: 'none',
  /** A soft card shadow (the default cards). */
  soft: '0 2px 10px var(--cc-shadow-color)',
  /** Paper cards: a crisp bottom edge plus a soft shadow (Explorer). */
  paper: '0 2px 0 var(--cc-shadow-color), 0 6px 14px var(--cc-shadow-color)',
  /** A deeper, rounder card shadow (Animals). */
  cushion: '0 4px 16px var(--cc-shadow-color)',
  /** Dialogs and overlays (the default). */
  raised: '0 10px 30px var(--cc-shadow-color)',
  /** Dialogs and overlays, deeper (Animals). */
  floating: '0 14px 36px var(--cc-shadow-color)',
} as const;
export type ShadowPreset = keyof typeof SHADOW_PRESETS;
export const SHADOW_PRESET_NAMES = Object.keys(SHADOW_PRESETS) as ShadowPreset[];

/** The preset whose value this is (export), or null. */
export const presetName = <T extends Record<string, string>>(presets: T, value: string): keyof T | null =>
  (Object.entries(presets).find(([, v]) => v === value)?.[0] as keyof T | undefined) ?? null;
