/**
 * Turns theme definitions into CSS (SX, D-070): one rule per theme, `[data-theme='<key>']`, holding
 * EVERY token (colours, typography, shape, avatar, icons, opacities), plus the theme's one-shot
 * keyframes. The default theme also applies on `:root`, so screens outside a class look right before
 * anything sets `data-theme`. Because every theme block is complete, a nested `[data-theme]` (theme
 * previews, the catalogue) gets the right value for derived tokens too.
 *
 * Imported themes (S14g, D-158) get their block when they are registered, and the stylesheet is
 * rewritten. Their values were built from presets, hex colours and numbers only, and `themeCss`
 * checks every key and value once more (`safeKey`, `safeValue`): a value that could end the
 * declaration, open a block or load anything is dropped (the token then inherits the default theme).
 */
import { DEFAULT_THEME } from '../../shared/themes.ts';
import { getDisplay, subscribeDisplay } from '../lib/display.ts';
import { loadThemePackage } from './custom.tsx';
import { allThemeDefinitions, subscribeCustomThemes } from './registry.ts';
import { FADE_IN, MOTION_PRESETS } from '../../shared/themePackage/motion.ts';
import { COLOR_TOKENS, MOTIONS, type MotionName, type ThemeDefinition } from './types.ts';

export const STYLE_ELEMENT_ID = 'cc-theme-tokens';

/** CSS custom properties of one theme, as `[name, value]` pairs. */
export function themeTokens(def: ThemeDefinition): Array<[string, string]> {
  const t = def.typography;
  const s = def.shape;
  return [
    ...COLOR_TOKENS.map((c): [string, string] => [`--cc-${c}`, def.colors[c]]),
    ['--cc-font', t.body],
    ['--cc-font-display', t.display],
    ['--cc-weight-body', String(t.weightBody)],
    ['--cc-weight-strong', String(t.weightStrong)],
    ['--cc-weight-heading', String(t.weightHeading)],
    ['--cc-weight-display', String(t.weightDisplay)],
    ['--cc-tracking-body', t.trackingBody],
    ['--cc-tracking-display', t.trackingDisplay],
    ['--cc-radius', s.radius],
    ['--cc-radius-sm', s.radiusSm],
    ['--cc-border-width', s.borderWidth],
    ['--cc-border-width-strong', s.borderWidthStrong],
    ['--cc-shadow', s.shadow],
    ['--cc-shadow-raised', s.shadowRaised],
    ['--cc-avatar-s', `${def.avatar.saturation}%`],
    ['--cc-avatar-l', `${def.avatar.lightness}%`],
    ['--cc-avatar-l-small', `${def.avatar.lightnessSmall}%`],
    ['--cc-icon-stroke', String(def.icons.strokeWidth)],
    ['--cc-icon-linecap', def.icons.linecap],
    ['--cc-icon-linejoin', def.icons.linejoin],
    ['--cc-deco-opacity', String(def.decoOpacity)],
    ['--cc-pattern-opacity', String(def.patternOpacity)],
  ];
}

/** Theme keys that may appear in a selector or keyframe name (built-in keys, slugs, previews of slugs). */
export const safeKey = (key: string) => /^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(key);
/**
 * A token value that cannot leave its declaration: no `;`, braces, `<`, `>`, backslash, `@`, comments
 * or `url(` (fonts in quotes and `var(--cc-…)` in shadows are fine).
 */
export const safeValue = (value: string) => value.length <= 300 && !/[;{}<>\\@]|\/\*|\*\/|url\s*\(|expression\s*\(|image-set|import/iu.test(value);
/** Keyframes come only from the shared motion presets (built-in and imported themes alike). */
const safeKeyframes = (motion: MotionName, kf: string) => kf === FADE_IN.keyframes || (Object.values(MOTION_PRESETS[motion]) as string[]).includes(kf);

/** Name of a theme animation (`reduced` = the reduced-motion variant). */
export const animationName = (theme: string, motion: string, reduced: boolean) => `cc-${theme}-${motion}${reduced ? '-reduced' : ''}`;

export function themeCss(def: ThemeDefinition): string {
  if (!safeKey(def.key)) return '';
  const selector = def.key === DEFAULT_THEME ? `:root, [data-theme='${def.key}']` : `[data-theme='${def.key}']`;
  const vars = themeTokens(def)
    .filter(([, v]) => safeValue(v))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  const frames = MOTIONS.flatMap((m) =>
    ([false, true] as const).flatMap((reduced) => {
      const kf = reduced ? def.motion[m].reduced.keyframes : def.motion[m].full.keyframes;
      return safeKeyframes(m, kf) ? [`@keyframes ${animationName(def.key, m, reduced)} { ${kf} }`] : [];
    }),
  ).join('\n');
  return `${selector} {\n${vars}\n}\n${frames}\n`;
}

/** The stylesheet for every registered theme. The default theme comes first so later themes win on equal specificity. */
export function allThemesCss(): string {
  const ordered = [...allThemeDefinitions()].sort((a, b) => Number(b.key === DEFAULT_THEME) - Number(a.key === DEFAULT_THEME));
  return ordered.map(themeCss).join('\n');
}

let stopWatching: (() => void) | null = null;

/** How often an open page re-checks the imported theme it shows (a conditional GET; 304 when unchanged). */
const THEME_POLL_MS = 5 * 60_000;

/**
 * Writes (or refreshes) the theme stylesheet in `<head>`. Called once at start-up (main.tsx) and by
 * tests. It then keeps the sheet current when an imported theme is registered, and loads (and
 * re-checks) the imported theme the display asks for (`setDisplay({ theme })`), on every entry.
 */
export function installThemeStyles(doc: Document = document): HTMLStyleElement {
  let el = doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    doc.head.prepend(el);
  }
  el.textContent = allThemesCss();
  if (doc === globalThis.document && !stopWatching) {
    const offThemes = subscribeCustomThemes(() => {
      const sheet = doc.getElementById(STYLE_ELEMENT_ID);
      if (sheet) sheet.textContent = allThemesCss();
    });
    const check = () => void loadThemePackage(getDisplay().theme);
    const offDisplay = subscribeDisplay(check);
    check();
    // A replaced package reaches screens that stay open (classroom display, board) without a reload.
    const onVisible = () => {
      if (doc.visibilityState === 'visible') check();
    };
    doc.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, THEME_POLL_MS);
    stopWatching = () => {
      offThemes();
      offDisplay();
      doc.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }
  return el;
}
