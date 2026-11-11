/**
 * React side of the theme registry (SX, D-070). Components use these instead of branching on a theme
 * key: the slot comes from the active theme (the class theme on the classroom display, a ThemeScope
 * for previews and the catalogue).
 */
import { createContext, useContext, useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import type { ThemeKey } from '../../shared/themes.ts';
import { getDisplay, motionAllowed, soundsAllowed, useDisplay, type DisplayState } from '../lib/display.ts';
import { useI18n } from '../lib/i18n.tsx';
import { MascotContext } from './art.tsx';
import { animationName } from './css.ts';
import { customThemesVersion, subscribeCustomThemes, themeOf } from './registry.ts';
import { SOUND_PRIORITY, soundStatus, sounds, type SoundSnapshot, type SoundStatus } from './soundManager.ts';
import type { IllustrationName, MascotPose, MotionName, SoundEvent, ThemeDefinition } from './types.ts';

export { THEME_LIST, THEMES, themeOf, pickerThemes, allThemeDefinitions } from './registry.ts';
// S26c (D-191): only the loader; the package code (`custom.tsx`) is a lazy chunk for the pages that only show themes.
export { loadThemePackage } from './customLoader.ts';
export { installThemeStyles } from './css.ts';
export type { IllustrationName, MascotPose, MotionName, SoundEvent, SoundName, ThemeDefinition } from './types.ts';
export { sounds, installSoundUnlock, SELF_UNLOCK_ATTR, type SoundSnapshot, type SoundStatus } from './soundManager.ts';

/** Overrides the document theme for a subtree (previews, the component catalogue). */
export const ThemeScope = createContext<ThemeKey | null>(null);

/** The theme that applies here: explicit > nearest ThemeScope > the document (class) theme. */
export function useTheme(explicit?: ThemeKey): ThemeDefinition {
  const display = useDisplay();
  // Re-render when an imported theme (S14g) arrives: until then `themeOf` gives the default theme.
  useSyncExternalStore(subscribeCustomThemes, customThemesVersion, customThemesVersion);
  const scoped = useContext(ThemeScope);
  return themeOf(explicit ?? scoped ?? display.theme);
}

/**
 * Renders `children` in a theme: sets `data-theme` (so the generated token rules apply to the
 * subtree) and the ThemeScope (so mascots and illustrations follow). Used by previews and the catalogue.
 */
export function ThemeProvider({ theme, children, className, testId }: { theme: ThemeKey; children: ReactNode; className?: string; testId?: string }) {
  return (
    <ThemeScope.Provider value={theme}>
      <div data-theme={theme} className={className} data-testid={testId}>
        {children}
      </div>
    </ThemeScope.Provider>
  );
}

export type MotionMode = 'full' | 'reduced' | 'none';

/** Which variant of a theme animation may play: none when the class switched animations off. */
export function motionMode(d: DisplayState): MotionMode {
  if (!d.classAnimations) return 'none';
  return motionAllowed(d) ? 'full' : 'reduced';
}

/** Inline style that plays a theme motion once (or its reduced variant, or nothing). */
export function useThemeMotion(name: MotionName, play: boolean, explicit?: ThemeKey): { style: CSSProperties; className: string | undefined } {
  const theme = useTheme(explicit);
  const display = useDisplay();
  const mode = play ? motionMode(display) : 'none';
  if (mode === 'none') return { style: {}, className: undefined };
  const reduced = mode === 'reduced';
  const a = reduced ? theme.motion[name].reduced : theme.motion[name].full;
  return {
    style: { animation: `${animationName(theme.key, name, reduced)} ${a.durationMs}ms ${a.easing} 1 both` },
    // The reduced variant only fades; it is exempt from the global "stop all animation" rule.
    className: reduced ? 'cc-motion-reduced' : undefined,
  };
}

/**
 * Play the theme's cue for a classroom event when the class and this device allow sounds (THM-5), at
 * the class volume and the event's priority (SoundManager). Returns whether it played.
 */
export function playThemeSound(display: DisplayState, theme: ThemeDefinition, name: SoundEvent): boolean {
  syncSoundSwitches(display);
  if (!soundsAllowed(display) || !theme.sounds) return false;
  return sounds.play(theme.sounds[name], SOUND_PRIORITY[name], name);
}

/** Tells the SoundManager the class volume and the class and device switches (status and mute). */
export function syncSoundSwitches(display: DisplayState) {
  sounds.setSwitches(display.classSounds, display.deviceSounds);
  sounds.setVolume(display.soundVolume);
}

/**
 * Sound status for this screen (S14a, D-145): `running`, `locked` (waiting for a tap), `unavailable`,
 * `mutedClass`, `mutedDevice` or `volumeZero`, with the manager's snapshot (context state, last cue)
 * for the Sound check.
 */
export function useSoundStatus(): { status: SoundStatus; snapshot: SoundSnapshot } {
  const display = useDisplay();
  useEffect(() => syncSoundSwitches(display), [display]);
  const snapshot = useSyncExternalStore(sounds.subscribe, sounds.snapshot, sounds.snapshot);
  const status = soundStatus(snapshot.audio, { classSounds: display.classSounds, deviceSounds: display.deviceSounds, volume: display.soundVolume });
  return { status, snapshot };
}

/** For code outside components (command senders): the cue of the document (class) theme. */
export function playEvent(name: SoundEvent): boolean {
  const d = getDisplay();
  return playThemeSound(d, themeOf(d.theme), name);
}

/** Hook form of playThemeSound for the current theme. */
export function useThemeSound(): (name: SoundEvent) => boolean {
  const theme = useTheme();
  const display = useDisplay();
  return (name) => playThemeSound(display, theme, name);
}

/**
 * The theme mascot in a pose. Decorative (aria-hidden) unless `label` is given. `motion` plays a theme
 * animation once (respecting the class switch and reduced motion).
 */
export function Mascot({
  theme,
  pose = 'idle',
  size = 120,
  motion,
  label,
}: {
  theme?: ThemeKey;
  pose?: MascotPose;
  size?: number;
  motion?: MotionName;
  label?: string;
}) {
  const def = useTheme(theme);
  const anim = useThemeMotion(motion ?? 'celebrate', Boolean(motion), def.key);
  const Body = def.Mascot;
  return (
    <svg
      className={['cc-mascot', anim.className].filter(Boolean).join(' ')}
      data-pose={pose}
      data-animate={anim.style.animation ? 'true' : 'false'}
      style={anim.style}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      <Body pose={pose} />
    </svg>
  );
}

/** A theme illustration (lock screen, empty state, threshold, start/end lesson, celebration). Always decorative. */
export function ThemeIllustration({ name, theme, width = 200, motion }: { name: IllustrationName; theme?: ThemeKey; width?: number; motion?: MotionName }) {
  const def = useTheme(theme);
  const anim = useThemeMotion(motion ?? 'celebrate', Boolean(motion), def.key);
  const Art = def.illustrations[name];
  return (
    <svg
      className={['cc-illustration', anim.className].filter(Boolean).join(' ')}
      data-illustration={name}
      data-animate={anim.style.animation ? 'true' : 'false'}
      style={anim.style}
      width={width}
      height={(width * 140) / 200}
      viewBox="0 0 200 140"
      aria-hidden="true"
      focusable="false"
    >
      {/* One mascot everywhere (S17a, D-166): built-in illustrations draw this theme's mascot. */}
      <MascotContext.Provider value={def.Mascot}>
        <Art />
      </MascotContext.Provider>
    </svg>
  );
}

/** Subtle corner decoration; never behind text that must be read. */
export function ThemeDecoration({ theme, corner = 'top-right', size = 220 }: { theme?: ThemeKey; corner?: 'top-right' | 'bottom-left'; size?: number }) {
  const def = useTheme(theme);
  const pos = corner === 'top-right' ? { top: -size * 0.15, right: -size * 0.15 } : { bottom: -size * 0.15, left: -size * 0.15 };
  const Deco = def.Decoration;
  return (
    <svg className="cc-deco" style={pos} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <Deco />
    </svg>
  );
}

/** Faint repeating background pattern of the theme, behind the page content (pointer-events: none). */
export function ThemeBackdrop({ theme }: { theme?: ThemeKey }) {
  const def = useTheme(theme);
  const Tile = def.Pattern;
  const id = `cc-pattern-${def.key}`;
  return (
    <svg className="cc-backdrop" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={id} width={def.patternSize} height={def.patternSize} patternUnits="userSpaceOnUse">
          <Tile />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** Name + description of a theme, for pickers (an imported theme brings its own names, S14g). */
export function useThemeLabels(def: ThemeDefinition) {
  const { t, locale } = useI18n();
  const own = def.custom?.labels;
  if (own) return { name: own.name[locale], description: own.description[locale], mascot: own.mascot[locale] };
  return { name: t(def.labelKey), description: t(def.descriptionKey), mascot: t(def.mascotNameKey) };
}

/** The name of the theme stored under `key` (falls back like `themeOf`). */
export function useThemeName(key: ThemeKey): string {
  useSyncExternalStore(subscribeCustomThemes, customThemesVersion, customThemesVersion);
  return useThemeLabels(themeOf(key)).name;
}
