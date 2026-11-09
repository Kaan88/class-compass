/**
 * WCAG 2.x contrast maths and the colour pairs every theme must pass (UX-6, THM-3; SX). Used by the
 * theme contrast unit test and, since S14g (D-158), by the theme package validator (server, admin
 * preview, MCP); pure functions, no DOM. `client/themes/contrast.ts` re-exports it.
 */
import type { ColorToken, ThemeColors } from './tokens.ts';

/** Avatar circles: hue from the student id, saturation/lightness from the theme (CRD-1). */
export interface AvatarTone {
  saturation: number;
  lightness: number;
  /** Small avatars carry small initials (not large text), so they need 4.5:1: darker. */
  lightnessSmall: number;
}

type Rgb = [number, number, number];

/** `#rgb`, `#rrggbb` or `#rrggbbaa` → [r, g, b] 0..255 (alpha ignored; see `over`). */
export function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as Rgb;
}

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export function contrast(a: Rgb | string, b: Rgb | string): number {
  const la = luminance(typeof a === 'string' ? parseHex(a) : a);
  const lb = luminance(typeof b === 'string' ? parseHex(b) : b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG levels: normal text AA 4.5, large text / UI parts AA 3, normal text AAA 7. */
export const AA = 4.5;
export const AA_LARGE = 3;
export const AAA = 7;

export interface ContrastPair {
  fg: ColorToken;
  bg: ColorToken;
  min: number;
  why: string;
}

/**
 * Pairs that appear on screen in every theme. AA for body text, AA-large/UI 3:1 for borders, icons
 * and focus rings, AAA (7:1) for the big classroom text on the page and card backgrounds.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'print-ink', bg: 'print-paper', min: AAA, why: 'printed link cards and QR codes' },
  { fg: 'text', bg: 'bg', min: AAA, why: 'classroom text on the page (AAA)' },
  { fg: 'text', bg: 'surface', min: AAA, why: 'classroom text on cards (AAA)' },
  { fg: 'text', bg: 'surface-2', min: AA, why: 'text on secondary surfaces' },
  { fg: 'text', bg: 'accent-soft', min: AA, why: 'active nav / selected rows' },
  { fg: 'text-muted', bg: 'bg', min: AA, why: 'hints on the page' },
  { fg: 'text-muted', bg: 'surface', min: AA, why: 'hints on cards' },
  { fg: 'text-muted', bg: 'surface-2', min: AA, why: 'hints on secondary surfaces' },
  { fg: 'accent-text', bg: 'accent', min: AA, why: 'primary button label' },
  { fg: 'accent-text', bg: 'accent-strong', min: AA, why: 'pressed primary button' },
  { fg: 'accent-strong', bg: 'surface', min: AA, why: 'links on cards' },
  { fg: 'accent-strong', bg: 'bg', min: AA, why: 'links on the page' },
  { fg: 'accent-strong', bg: 'accent-soft', min: AA, why: 'accent text on soft accent' },
  { fg: 'success', bg: 'surface', min: AA, why: 'success text' },
  { fg: 'success', bg: 'success-soft', min: AA, why: 'success alert' },
  { fg: 'warning', bg: 'surface', min: AA, why: 'warning text' },
  { fg: 'warning', bg: 'warning-soft', min: AA, why: 'warning alert' },
  { fg: 'danger', bg: 'surface', min: AA, why: 'error text' },
  { fg: 'danger', bg: 'danger-soft', min: AA, why: 'error alert' },
  { fg: 'on-strong', bg: 'danger', min: AA, why: 'destructive button label' },
  { fg: 'on-strong', bg: 'success', min: AA, why: 'success chip label' },
  { fg: 'display-banner-text', bg: 'display-banner-bg', min: AA, why: 'display banner (PIN-5)' },
  { fg: 'text', bg: 'level-0', min: AA, why: 'card level chip 0' },
  { fg: 'text', bg: 'level-1', min: AA, why: 'card level chip 1' },
  { fg: 'text', bg: 'level-2', min: AA, why: 'card level chip 2' },
  { fg: 'text', bg: 'level-3', min: AA, why: 'card level chip 3' },
  { fg: 'border-strong', bg: 'surface', min: AA_LARGE, why: 'control borders (UI 3:1)' },
  { fg: 'focus', bg: 'bg', min: AA_LARGE, why: 'focus ring on the page' },
  { fg: 'focus', bg: 'surface', min: AA_LARGE, why: 'focus ring on cards' },
  { fg: 'icon-accent', bg: 'surface', min: AA_LARGE, why: 'menu icons' },
  { fg: 'segment-on', bg: 'surface', min: AA_LARGE, why: 'counter bar segment' },
  { fg: 'counter-teal', bg: 'surface', min: AA_LARGE, why: 'counter colour teal' },
  { fg: 'counter-plum', bg: 'surface', min: AA_LARGE, why: 'counter colour plum' },
  { fg: 'counter-rust', bg: 'surface', min: AA_LARGE, why: 'counter colour rust' },
  { fg: 'counter-leaf', bg: 'surface', min: AA_LARGE, why: 'counter colour leaf' },
  { fg: 'counter-berry', bg: 'surface', min: AA_LARGE, why: 'counter colour berry' },
];

export interface ContrastFailure {
  pair: string;
  /** The two tokens (`fg` is `avatar-text` for the avatar hue sweep, `bg` then names the hue). */
  fg: string;
  bg: string;
  ratio: number;
  min: number;
}

/** Every failing pair of a theme's colours (empty = all pass). */
export function contrastFailures(colors: ThemeColors, avatar: AvatarTone): ContrastFailure[] {
  const out: ContrastFailure[] = [];
  for (const p of CONTRAST_PAIRS) {
    const ratio = contrast(colors[p.fg], colors[p.bg]);
    if (ratio < p.min) out.push({ pair: `${p.fg} on ${p.bg} (${p.why})`, fg: p.fg, bg: p.bg, ratio: Math.round(ratio * 100) / 100, min: p.min });
  }
  // Avatars: initials on every hue. Big avatars carry large bold initials (3:1), small ones 4.5:1.
  for (let hue = 0; hue < 360; hue += 5) {
    const big = contrast(colors['avatar-text'], hslToRgb(hue, avatar.saturation, avatar.lightness));
    if (big < AA_LARGE) out.push({ pair: `avatar-text on avatar hue ${hue}`, fg: 'avatar-text', bg: `avatar hue ${hue}`, ratio: Math.round(big * 100) / 100, min: AA_LARGE });
    const small = contrast(colors['avatar-text'], hslToRgb(hue, avatar.saturation, avatar.lightnessSmall));
    if (small < AA) out.push({ pair: `avatar-text on small avatar hue ${hue}`, fg: 'avatar-text', bg: `small avatar hue ${hue}`, ratio: Math.round(small * 100) / 100, min: AA });
  }
  return out;
}
