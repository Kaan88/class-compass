/**
 * Full-screen celebration (S13b, D-110): fanfare, then clapping and fireworks sounds; the theme mascot
 * in its celebrate pose fills the screen for about 2.5 s with canvas fireworks in the theme's
 * celebration colours (tokens, read from the CSS variables).
 * - Reduced motion (OS setting): no flying particles; the mascot and a few still stars fade in and
 *   out; one soft chime instead of the fanfare, clapping and fireworks (`celebrationCues`).
 * - Animations switched off for the class: no overlay at all, and only the soft chime (the sound
 *   switches still decide whether it plays).
 * The overlay never takes clicks (pointer-events: none) and is announced once to screen readers.
 * Anything can call `celebrate()`; the layer is mounted once in the root layout.
 */
import { useEffect, useRef, useState } from 'react';
import { useDisplay } from '../lib/display.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Mascot, motionMode, playThemeSound, useTheme } from './index.tsx';
import { celebrationCues } from './sequences.ts';
import type { ColorToken } from './types.ts';

export const CELEBRATION_MS = 2500;

type Listener = (e: { id: number; message: string | null }) => void;
const listeners = new Set<Listener>();
let seq = 0;

/** Starts a celebration on this screen (sounds and overlay follow the class/device settings). */
export function celebrate(message: string | null = null) {
  seq += 1;
  for (const l of listeners) l({ id: seq, message });
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  born: number;
}

/** Colour values of tokens where `el` is drawn (inside a theme preview they are the preview's). */
function tokenColors(tokens: readonly ColorToken[], el: Element): string[] {
  const css = getComputedStyle(el);
  const out = tokens.map((t) => css.getPropertyValue(`--cc-${t}`).trim()).filter(Boolean);
  return out.length ? out : ['currentColor'];
}

/** Canvas fireworks: five bursts over the celebration, gravity, fading trails. */
function Fireworks({ colors }: { colors: readonly ColorToken[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const palette = tokenColors(colors, canvas);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const parts: Particle[] = [];
    const start = performance.now();
    let bursts = 0;
    let frame = 0;
    const burst = (now: number) => {
      const cx = canvas.width * (0.2 + ((bursts * 0.37) % 0.6));
      const cy = canvas.height * (0.2 + ((bursts * 0.23) % 0.3));
      for (let i = 0; i < 42; i++) {
        const a = (i / 42) * Math.PI * 2;
        const speed = (2.2 + (i % 5) * 0.5) * dpr;
        parts.push({ x: cx, y: cy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, color: palette[(i + bursts) % palette.length]!, born: now });
      }
      bursts += 1;
    };
    const tick = (now: number) => {
      const t = now - start;
      if (bursts < 5 && t > bursts * 420) burst(now);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of parts) {
        const age = (now - p.born) / 1100;
        if (age >= 1) continue;
        p.vy += 0.05 * dpr;
        p.x += p.vx;
        p.y += p.vy;
        ctx.globalAlpha = 1 - age;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      if (t < CELEBRATION_MS) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [colors]);
  return <canvas ref={ref} className="cc-celebration__fireworks" aria-hidden="true" />;
}

/** Still stars for reduced motion (no movement, only the layer's fade). */
function Stars({ colors }: { colors: readonly ColorToken[] }) {
  const spots = [
    [12, 18],
    [82, 14],
    [24, 70],
    [74, 64],
    [50, 10],
    [90, 82],
    [8, 88],
  ];
  return (
    <svg className="cc-celebration__stars" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {spots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.6" style={{ fill: `var(--cc-${colors[i % colors.length]})` }} />
      ))}
    </svg>
  );
}

/**
 * The celebration inside a box, in the theme of the nearest ThemeProvider (Admin → Themes preview,
 * S14g): the same mascot, motion, fireworks or still stars and sounds as the full-screen layer, for
 * CELEBRATION_MS after `play` changes. Plays only from a button press (never on load).
 */
export function CelebrationPreview({ play }: { play: number }) {
  const { t } = useI18n();
  const display = useDisplay();
  const theme = useTheme();
  const [active, setActive] = useState(0);
  const mode = motionMode(display);
  useEffect(() => {
    if (play === 0) return;
    const m = motionMode(display);
    const timers = celebrationCues(m).map((cue) => setTimeout(() => playThemeSound(display, theme, cue.event), cue.at));
    setActive(play);
    const h = setTimeout(() => setActive(0), CELEBRATION_MS);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(h);
    };
    // Only a new press starts it; display or theme changes do not replay it.
  }, [play]);
  return (
    <div className={['cc-celebration-preview', mode === 'reduced' ? 'cc-motion-reduced' : ''].join(' ')} data-testid="celebration-preview" data-mode={mode}>
      {active && mode === 'full' ? <Fireworks key={active} colors={theme.celebration.colors} /> : <Stars colors={theme.celebration.colors} />}
      <div className="cc-celebration__mascot">
        <Mascot key={active} pose="celebrate" size={140} motion={active && mode === 'full' ? 'celebrate' : undefined} />
        <p className="cc-celebration-preview__message">{t('celebration.wellDone')}</p>
      </div>
    </div>
  );
}

export function CelebrationLayer() {
  const { t } = useI18n();
  const display = useDisplay();
  const theme = useTheme();
  const [active, setActive] = useState<{ id: number; message: string | null } | null>(null);
  const mode = motionMode(display);
  useEffect(() => {
    const l: Listener = (e) => {
      const m = motionMode(display);
      for (const cue of celebrationCues(m)) {
        if (cue.at === 0) playThemeSound(display, theme, cue.event);
        else setTimeout(() => playThemeSound(display, theme, cue.event), cue.at);
      }
      if (m !== 'none') setActive(e);
    };
    listeners.add(l);
    return () => void listeners.delete(l);
  }, [display, theme]);
  useEffect(() => {
    if (!active) return;
    const h = setTimeout(() => setActive(null), CELEBRATION_MS);
    return () => clearTimeout(h);
  }, [active]);
  if (!active) return null;
  return (
    <div key={active.id} className={['cc-celebration', mode === 'reduced' ? 'cc-motion-reduced' : ''].join(' ')} data-mode={mode} data-testid="celebration" role="status">
      {mode === 'full' ? <Fireworks colors={theme.celebration.colors} /> : <Stars colors={theme.celebration.colors} />}
      <div className="cc-celebration__mascot">
        <Mascot pose="celebrate" size={260} motion={mode === 'full' ? 'celebrate' : undefined} />
        <p className="cc-celebration__message">{active.message ?? t('celebration.wellDone')}</p>
      </div>
    </div>
  );
}
