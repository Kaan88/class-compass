/**
 * React side of the theme registry (SX, D-070). Components use these instead of branching on a theme
 * key: the slot comes from the active theme (the class theme on the classroom display, a ThemeScope
 * for previews and the catalogue).
 */
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { ThemeKey } from '../../shared/themes.ts';
import { getDisplay, motionAllowed, soundsAllowed, useDisplay, type DisplayState } from '../lib/display.ts';
import { useI18n } from '../lib/i18n.tsx';
import { animationName } from './css.ts';
import { themeOf } from './registry.ts';
import { SOUND_PRIORITY, sounds } from './soundManager.ts';
import type { IllustrationName, MascotPose, MotionName, SoundEvent, ThemeDefinition } from './types.ts';

export { THEME_LIST, THEMES, themeOf } from './registry.ts';
export { installThemeStyles } from './css.ts';
export type { IllustrationName, MascotPose, MotionName, SoundEvent, SoundName, ThemeDefinition } from './types.ts';
export { sounds, installSoundUnlock } from './soundManager.ts';

/** Overrides the document theme for a subtree (previews, the component catalogue). */
export const ThemeScope = createContext<ThemeKey | null>(null);

/** The theme that applies here: explicit > nearest ThemeScope > the document (class) theme. */
export function useTheme(explicit?: ThemeKey): ThemeDefinition {
  const display = useDisplay();
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
  sounds.setMuted(!soundsAllowed(display));
  sounds.setVolume(display.soundVolume);
  if (!soundsAllowed(display) || !theme.sounds) return false;
  return sounds.play(theme.sounds[name], SOUND_PRIORITY[name]);
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
      <Art />
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

/** Name + description of a theme, for pickers. */
export function useThemeLabels(def: ThemeDefinition) {
  const { t } = useI18n();
  return { name: t(def.labelKey), description: t(def.descriptionKey), mascot: t(def.mascotNameKey) };
}
