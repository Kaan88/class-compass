/**
 * Theme ambient animation (S17a, D-166): silent snowfall or falling leaves on ONE canvas between the
 * scene and the content. It is its own layer with its own code: nothing is shared with the celebration
 * bus (`Celebration.tsx`); app.css dims it while a celebration is on screen.
 *
 * - Runs only while `motionMode()` is `full`; with the class animation switch off or reduced motion it
 *   draws ONE still frame (the same particles, standing still) and no timer runs.
 * - At most 30 frames a second (`AMBIENT_LIMITS.maxFps`), paused while the page is hidden.
 * - Sized to its box in device pixels (`devicePixelRatio`, e.g. 1.25 on the classroom PC), capped at
 *   `AMBIENT_MAX_DPR` (soft flakes gain nothing above it, and every frame clears the whole backing
 *   store), redrawn when the box changes size.
 * - Follows a reduced-motion change while the page is open (`useReducedMotion`): it stops and draws
 *   the still frame without a reload.
 * - The particle count follows the screen area (`density` is for 1920×1080), so a phone gets fewer.
 * - Colours are theme tokens read from the CSS variables at run time (never raw colours in code).
 */
import { useEffect, useRef } from 'react';
import { AMBIENT_COLORS, AMBIENT_SIZE_PX, AMBIENT_SPEED_PX, type AmbientSpec } from '../../shared/themePackage/engine.ts';
import { AMBIENT_LIMITS } from '../../shared/themePackage/limits.ts';
import type { ThemeKey } from '../../shared/themes.ts';
import { useDisplay, useReducedMotion } from '../lib/display.ts';
import { motionMode, useTheme } from './index.tsx';

/** Highest backing-store ratio of the ambient canvas (the classroom PC's 1.25 is below it). */
export const AMBIENT_MAX_DPR = 2;
/** Phones and small windows (< 40rem wide) draw at most at this ratio. */
export const AMBIENT_MAX_DPR_SMALL = 1.5;

/** The backing-store ratio for a canvas `cssWidth` CSS pixels wide on a `dpr` screen. */
export function ambientPixelRatio(dpr: number, cssWidth: number): number {
  const cap = cssWidth < 640 ? AMBIENT_MAX_DPR_SMALL : AMBIENT_MAX_DPR;
  return Math.max(1, Math.min(cap, dpr || 1));
}

export interface Particle {
  x: number;
  y: number;
  r: number;
  /** Fall speed factor and sideways sway. */
  v: number;
  phase: number;
  /** Rotation (leaves) and its speed. */
  rot: number;
  spin: number;
  colour: number;
}

/** Small deterministic random numbers (the still frame looks the same on every load). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many particles a box of w×h CSS pixels gets (`density` is for 1920×1080). */
export function particleCount(spec: Pick<AmbientSpec, 'density'>, w: number, h: number): number {
  const area = Math.max(0, w * h) / (1920 * 1080);
  return Math.max(0, Math.min(spec.density, Math.round(spec.density * Math.min(1, area))));
}

export function makeParticles(spec: AmbientSpec, w: number, h: number, colours: number, seed = 7): Particle[] {
  const rnd = mulberry32(seed);
  const [lo, hi] = AMBIENT_SIZE_PX[spec.size];
  return Array.from({ length: particleCount(spec, w, h) }, () => ({
    x: rnd() * w,
    y: rnd() * h,
    r: lo + rnd() * (hi - lo),
    v: 0.6 + rnd() * 0.8,
    phase: rnd() * Math.PI * 2,
    rot: rnd() * Math.PI * 2,
    spin: (rnd() - 0.5) * 1.2,
    colour: Math.floor(rnd() * Math.max(1, colours)),
  }));
}

/** Moves every particle `dt` seconds on; particles leaving the bottom come back at the top. */
export function stepParticles(ps: Particle[], spec: AmbientSpec, dt: number, w: number, h: number): void {
  const fall = AMBIENT_SPEED_PX[spec.speed];
  const leaves = spec.preset === 'leaves';
  for (const p of ps) {
    p.y += fall * p.v * dt * (leaves ? 0.8 : 1);
    p.phase += dt * (leaves ? 1.1 : 0.7);
    p.x += Math.sin(p.phase) * (leaves ? 18 : 8) * dt;
    p.rot += p.spin * dt;
    if (p.y - p.r > h) {
      p.y = -p.r * 2;
      p.x = (p.x + w * 0.37) % w;
    }
    if (p.x < -10) p.x += w + 20;
    else if (p.x > w + 10) p.x -= w + 20;
  }
}

function draw(ctx: CanvasRenderingContext2D, ps: readonly Particle[], spec: AmbientSpec, colours: readonly string[], outline: string, dpr: number): void {
  const c = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const leaves = spec.preset === 'leaves';
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = outline;
  for (const p of ps) {
    ctx.fillStyle = colours[p.colour % colours.length] ?? colours[0]!;
    ctx.beginPath();
    if (leaves) {
      ctx.ellipse(p.x, p.y, p.r * 2.2, p.r * 1.1, p.rot, 0, Math.PI * 2);
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

export type AmbientMode = 'full' | 'still';

/**
 * Starts the ambient layer on `canvas` and returns its stop function. `full` animates (≤ 30 fps,
 * paused while the page is hidden); `still` draws one frame and keeps no timer.
 */
export function startAmbient(canvas: HTMLCanvasElement, spec: AmbientSpec, mode: AmbientMode): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;
  const style = getComputedStyle(canvas);
  const tokenColours = spec.color ? [spec.color] : AMBIENT_COLORS[spec.preset];
  const colours = tokenColours.map((t) => style.getPropertyValue(`--cc-${t}`).trim() || 'transparent');
  const outline = style.getPropertyValue('--cc-border').trim() || 'transparent';
  let w = 0;
  let h = 0;
  let dpr = 1;
  let ps: Particle[] = [];
  let frames = 0;
  const size = () => {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    dpr = ambientPixelRatio(globalThis.devicePixelRatio || 1, w);
    canvas.dataset.dpr = String(dpr);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ps = makeParticles(spec, w, h, colours.length);
    draw(ctx, ps, spec, colours, outline, dpr);
  };
  size();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null;
  ro?.observe(canvas);
  canvas.dataset.running = 'false';
  if (mode === 'still') return () => ro?.disconnect();

  const minStep = 1000 / AMBIENT_LIMITS.maxFps;
  let raf = 0;
  let last = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (last === 0) last = now;
    const elapsed = now - last;
    // At most 30 frames a second (a little slack for rAF jitter on a 60 Hz screen).
    if (elapsed < minStep - 2) return;
    last = now;
    stepParticles(ps, spec, Math.min(elapsed, 100) / 1000, w, h);
    draw(ctx, ps, spec, colours, outline, dpr);
    frames += 1;
    if (frames % 30 === 0) canvas.dataset.frames = String(frames);
  };
  const run = () => {
    if (raf) return;
    last = 0;
    raf = requestAnimationFrame(tick);
    canvas.dataset.running = 'true';
  };
  const pause = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    canvas.dataset.running = 'false';
  };
  const onVisibility = () => (document.visibilityState === 'hidden' ? pause() : run());
  document.addEventListener('visibilitychange', onVisibility);
  if (document.visibilityState !== 'hidden') run();
  return () => {
    pause();
    ro?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * The ambient layer of the active theme (or of `theme`). `motion` overrides the class switch (the
 * Admin → Themes preview's Motion on/off); `contained` keeps it inside a positioned preview box.
 */
export function ThemeAmbient({ theme, contained = false, motion }: { theme?: ThemeKey; contained?: boolean; motion?: AmbientMode }) {
  const def = useTheme(theme);
  const display = useDisplay();
  // Subscribed so a reduced-motion switch re-renders and the effect restarts in 'still' mode
  // (motionMode reads the media query; this makes the change reach it).
  const reduced = useReducedMotion();
  const ref = useRef<HTMLCanvasElement>(null);
  const spec = def.ambient && def.ambient.preset !== 'none' ? def.ambient : null;
  const mode: AmbientMode = motion ?? (!reduced && motionMode(display) === 'full' ? 'full' : 'still');
  const specKey = spec ? JSON.stringify(spec) : '';
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !spec) return;
    return startAmbient(canvas, spec, mode);
    // The spec object may be rebuilt with the same content; restart only when it really changed.
  }, [specKey, mode, def.key]);
  if (!spec) return null;
  return <canvas ref={ref} className={`cc-ambient${contained ? ' cc-ambient--contained' : ''}`} aria-hidden="true" data-testid="theme-ambient" data-mode={mode} data-preset={spec.preset} />;
}
