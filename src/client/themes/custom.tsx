/**
 * Imported themes on the client (S14g, D-158).
 * - `definitionFromPackage` builds a complete `ThemeDefinition` from a stored package: it parses the
 *   package again (`StoredThemePackage`: hex colours, numbers in range, preset names only, so nothing
 *   in it can become arbitrary CSS), maps presets to values, builds the sound pack with
 *   `makeSoundPack`, and draws art only through the SVG sanitiser and `SvgTree`. Anything missing
 *   (art, colour tokens added after the package was made) comes from its base theme.
 * - `loadThemePackage(key)` fetches an enabled package the page needs (`GET /api/themes/custom/:key`,
 *   public, also allowed on the Super Speakers host) and registers it; `installThemeStyles` calls it
 *   whenever the display theme changes, so every entry (classroom, student page, board, scorer) works.
 * - `useAvailableThemes()` registers the enabled packages for the theme pickers.
 * - `packageFromDefinition` exports a built-in theme as a package (Admin → Themes → Export).
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { availableThemes, publicCustomTheme } from '../../shared/contracts/themes.ts';
import { translate, type Locale } from '../../shared/i18n/index.ts';
import { isThemeKey, isThemeSlug, type BuiltinThemeKey } from '../../shared/themes.ts';
import { presetMotion, presetOf, EASINGS, motionPresetNames, type Easing } from '../../shared/themePackage/motion.ts';
import { FONT_PRESETS, presetName, SHADOW_PRESETS, type FontPreset, type ShadowPreset } from '../../shared/themePackage/presets.ts';
import { StoredThemePackage, THEME_PACKAGE_FORMAT, THEME_PACKAGE_VERSION, type ThemePackage, type ThemePackageSounds } from '../../shared/themePackage/schema.ts';
import { makeSoundPack } from '../../shared/themePackage/sound.ts';
import { PACKAGE_COLOR_TOKENS, type ThemeColors } from '../../shared/themePackage/tokens.ts';
import { FIXED_COLORS, packageArt } from '../../shared/themePackage/validate.ts';
import { call } from '../lib/api.ts';
import { getCustomTheme, setCustomTheme, THEMES } from './registry.ts';
import { SvgTree } from './SvgTree.tsx';
import { ILLUSTRATIONS, MOTIONS, type IllustrationName, type MascotProps, type ThemeDefinition } from './types.ts';

export type CustomStatus = NonNullable<ThemeDefinition['custom']>['status'];

/** The key a preview of package `key` is drawn under, so it never replaces the live theme on the page. */
export const previewKey = (key: string) => `cc-preview-${key}`;
/** Keys that may reach a CSS selector or keyframe name: a theme slug, or a preview of one. */
const SAFE_KEY = /^(?:cc-preview-)?[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,31}$/u;

const em = (n: number) => (n === 0 ? 'normal' : `${n}em`);

/** A complete theme definition from a stored package, or null when it does not parse. */
export function definitionFromPackage(raw: unknown, status: CustomStatus, key?: string): ThemeDefinition | null {
  const parsed = StoredThemePackage.safeParse(raw);
  if (!parsed.success || isThemeKey(parsed.data.key)) return null;
  const pkg = parsed.data;
  const themeKey = key ?? pkg.key;
  if (!SAFE_KEY.test(themeKey) || isThemeKey(themeKey)) return null;
  const base = THEMES[pkg.base];
  const own = Object.fromEntries(PACKAGE_COLOR_TOKENS.flatMap((t) => (pkg.colors[t] ? [[t, pkg.colors[t]]] : [])));
  const colors = { ...base.colors, ...own, ...FIXED_COLORS } as ThemeColors;
  const art = packageArt(pkg);
  const mascot = art.mascot;
  const Mascot = mascot ? ({ pose }: MascotProps) => <SvgTree nodes={mascot[pose]} /> : base.Mascot;
  const illustrations = Object.fromEntries(
    ILLUSTRATIONS.map((name) => {
      const nodes = art.illustrations[name];
      return [name, nodes ? () => <SvgTree nodes={nodes} /> : base.illustrations[name]];
    }),
  ) as Record<IllustrationName, ThemeDefinition['illustrations'][IllustrationName]>;
  const deco = art.decoration;
  const pattern = art.pattern;
  const t = pkg.typography;
  const s = pkg.shape;
  const sounds = pkg.sounds;
  return {
    key: themeKey,
    labelKey: 'themes.imported.name',
    descriptionKey: 'themes.imported.description',
    mascotNameKey: 'themes.imported.mascot',
    colors,
    typography: {
      body: FONT_PRESETS[t.body],
      display: FONT_PRESETS[t.display],
      weightBody: t.weightBody,
      weightStrong: t.weightStrong,
      weightHeading: t.weightHeading,
      weightDisplay: t.weightDisplay,
      trackingBody: em(t.trackingBody),
      trackingDisplay: em(t.trackingDisplay),
    },
    shape: {
      radius: `${s.radiusRem}rem`,
      radiusSm: `${s.radiusSmRem}rem`,
      borderWidth: `${s.borderPx}px`,
      borderWidthStrong: `${s.borderStrongPx}px`,
      shadow: SHADOW_PRESETS[s.shadow],
      shadowRaised: SHADOW_PRESETS[s.shadowRaised],
    },
    avatar: { ...pkg.avatar },
    icons: { ...pkg.icons },
    decoOpacity: pkg.decoOpacity,
    patternOpacity: pkg.patternOpacity,
    Mascot,
    Decoration: deco ? () => <SvgTree nodes={deco} /> : base.Decoration,
    Pattern: pattern ? () => <SvgTree nodes={pattern} /> : base.Pattern,
    patternSize: pattern ? (pkg.art?.patternSize ?? base.patternSize) : base.patternSize,
    illustrations,
    motion: { celebrate: presetMotion('celebrate', pkg.motion.celebrate), threshold: presetMotion('threshold', pkg.motion.threshold) },
    sounds: sounds === null ? null : makeSoundPack(sounds, sounds.overrides ?? {}),
    soundParams: sounds,
    celebration: { colors: [...pkg.celebration.colors] },
    custom: { base: pkg.base, status, labels: { name: pkg.name, description: pkg.description, mascot: pkg.mascotName } },
  };
}

/** Builds and registers a package (an enabled theme, or a preview under `previewKey`). */
export function registerThemePackage(raw: unknown, status: CustomStatus, key?: string): ThemeDefinition | null {
  const def = definitionFromPackage(raw, status, key);
  if (def) setCustomTheme(def);
  return def;
}

const pending = new Set<string>();
const missing = new Set<string>();

/**
 * Makes sure an imported theme the page needs is registered. Built-in keys, keys already loaded and
 * keys the server did not have (404: a draft, a disabled or deleted theme) are skipped; until then, and
 * for those, `themeOf` shows the default theme.
 */
export async function loadThemePackage(key: string | null | undefined): Promise<void> {
  if (!key || isThemeKey(key) || !isThemeSlug(key) || getCustomTheme(key) || pending.has(key) || missing.has(key)) return;
  pending.add(key);
  try {
    registerThemePackage(await call(publicCustomTheme, { key }), 'enabled');
  } catch {
    missing.add(key);
  } finally {
    pending.delete(key);
  }
}

export const AVAILABLE_THEMES_KEY = ['themes', 'available'] as const;

/** Registers the enabled imported themes (signed-in pages: the theme pickers). */
export function useAvailableThemes(enabled = true): void {
  const q = useQuery({ queryKey: AVAILABLE_THEMES_KEY, queryFn: () => call(availableThemes, {}), enabled, staleTime: 60_000 });
  useEffect(() => {
    for (const pkg of q.data?.themes ?? []) registerThemePackage(pkg, 'enabled');
  }, [q.data]);
}

// ---------------------------------------------------------------- export (built-in → package)
const fontOf = (stack: string): FontPreset => presetName(FONT_PRESETS, stack) ?? 'system';
const shadowOf = (v: string): ShadowPreset => presetName(SHADOW_PRESETS, v) ?? 'soft';
const emOf = (v: string) => (v === 'normal' ? 0 : Number.parseFloat(v) || 0);
const easingOf = (v: string): Easing => ((EASINGS as readonly string[]).includes(v) ? (v as Easing) : 'ease-out');

/**
 * A package that recreates a theme (Admin → Themes → Export). A built-in theme gets a new key and
 * "(copy)" names, since a package may not reuse a built-in key; its art stays with its base theme.
 * An imported theme is exported from its stored package instead (the server's copy).
 */
export function packageFromDefinition(def: ThemeDefinition, opts: { key: string; copyOf: (locale: Locale, name: string) => string }): ThemePackage {
  const name = (l: Locale) => opts.copyOf(l, def.custom ? def.custom.labels.name[l] : translate(l, def.labelKey));
  const text = (l: Locale, k: string, own?: { en: string; tr: string }) => (own ? own[l] : translate(l, k));
  const base = (def.custom?.base ?? def.key) as BuiltinThemeKey;
  const motion = <M extends (typeof MOTIONS)[number]>(m: M) => {
    const full = def.motion[m].full;
    const preset = presetOf(m, full.keyframes) ?? motionPresetNames(m)[0]!;
    return { preset, durationMs: full.durationMs, easing: easingOf(full.easing) } as ThemePackage['motion'][M];
  };
  const colors = Object.fromEntries(PACKAGE_COLOR_TOKENS.map((t) => [t, def.colors[t]])) as ThemePackage['colors'];
  return {
    format: THEME_PACKAGE_FORMAT,
    version: THEME_PACKAGE_VERSION,
    key: opts.key,
    name: { en: name('en'), tr: name('tr') },
    description: { en: text('en', def.descriptionKey, def.custom?.labels.description), tr: text('tr', def.descriptionKey, def.custom?.labels.description) },
    mascotName: { en: text('en', def.mascotNameKey, def.custom?.labels.mascot), tr: text('tr', def.mascotNameKey, def.custom?.labels.mascot) },
    base,
    colors,
    typography: {
      body: fontOf(def.typography.body),
      display: fontOf(def.typography.display),
      weightBody: def.typography.weightBody,
      weightStrong: def.typography.weightStrong,
      weightHeading: def.typography.weightHeading,
      weightDisplay: def.typography.weightDisplay,
      trackingBody: emOf(def.typography.trackingBody),
      trackingDisplay: emOf(def.typography.trackingDisplay),
    },
    shape: {
      radiusRem: Number.parseFloat(def.shape.radius),
      radiusSmRem: Number.parseFloat(def.shape.radiusSm),
      borderPx: Number.parseFloat(def.shape.borderWidth),
      borderStrongPx: Number.parseFloat(def.shape.borderWidthStrong),
      shadow: shadowOf(def.shape.shadow),
      shadowRaised: shadowOf(def.shape.shadowRaised),
    },
    avatar: { ...def.avatar },
    icons: { ...def.icons },
    decoOpacity: def.decoOpacity,
    patternOpacity: def.patternOpacity,
    motion: { celebrate: motion('celebrate'), threshold: motion('threshold') },
    sounds: def.sounds === null ? null : ((def.soundParams ?? null) as ThemePackageSounds | null),
    celebration: { colors: [...def.celebration.colors] },
  };
}
