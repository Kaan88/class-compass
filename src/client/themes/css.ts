/**
 * Turns theme definitions into CSS (SX, D-070): one rule per theme, `[data-theme='<key>']`, holding
 * EVERY token (colours, typography, shape, avatar, icons, opacities), plus the theme's one-shot
 * keyframes. The default theme also applies on `:root`, so screens outside a class look right before
 * anything sets `data-theme`. Because every theme block is complete, a nested `[data-theme]` (theme
 * previews, the catalogue) gets the right value for derived tokens too.
 */
import { DEFAULT_THEME } from '../../shared/themes.ts';
import { THEME_LIST } from './registry.ts';
import { COLOR_TOKENS, MOTIONS, type ThemeDefinition } from './types.ts';

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

/** Name of a theme animation (`reduced` = the reduced-motion variant). */
export const animationName = (theme: string, motion: string, reduced: boolean) => `cc-${theme}-${motion}${reduced ? '-reduced' : ''}`;

export function themeCss(def: ThemeDefinition): string {
  const selector = def.key === DEFAULT_THEME ? `:root, [data-theme='${def.key}']` : `[data-theme='${def.key}']`;
  const vars = themeTokens(def)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  const frames = MOTIONS.flatMap((m) => [
    `@keyframes ${animationName(def.key, m, false)} { ${def.motion[m].full.keyframes} }`,
    `@keyframes ${animationName(def.key, m, true)} { ${def.motion[m].reduced.keyframes} }`,
  ]).join('\n');
  return `${selector} {\n${vars}\n}\n${frames}\n`;
}

/** The stylesheet for every registered theme. The default theme comes first so later themes win on equal specificity. */
export function allThemesCss(): string {
  const ordered = [...THEME_LIST].sort((a, b) => Number(b.key === DEFAULT_THEME) - Number(a.key === DEFAULT_THEME));
  return ordered.map(themeCss).join('\n');
}

/** Writes (or refreshes) the theme stylesheet in `<head>`. Called once at start-up (main.tsx) and by tests. */
export function installThemeStyles(doc: Document = document): HTMLStyleElement {
  let el = doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    doc.head.prepend(el);
  }
  el.textContent = allThemesCss();
  return el;
}
