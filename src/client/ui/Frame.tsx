/**
 * Theme frames (S17a, D-166): app-drawn card silhouettes, trims and corners from the active theme's
 * `frame` (presets only, colours are theme tokens). `FrameOverlay` returns decorative overlays for the
 * card it is placed in (`aria-hidden`, `pointer-events: none`); the card's content, padding, hit areas
 * and focus outline are unchanged:
 * - overlays sit (almost) outside the content box: caps above the top edge, rings behind the card,
 *   corners on the rounded corners;
 * - the overlays drawn over the card fade away while keyboard focus is inside it (app.css), so a focus
 *   ring is never covered;
 * - trims and corners are "detail": compact density and phones show the edge only (Phone mockup).
 *
 * Shapes and proportions follow the approved mockups (docs/design/mockups/2026-11-11-theme-engine/,
 * `Frames.dc.html` and `ThemedBoard.dc.html`). Components never branch on a theme: they place
 * `<FrameOverlay surface=… />` and the theme decides whether anything is drawn.
 *
 * S17b (D-168): edges and long trims are drawn in CSS pixels, never stretched. Each one measures its
 * own box (one shared ResizeObserver) and repeats its motif (a snow bump, a scallop, a torn tooth, a
 * leaf, a bulb) a whole number of times across it, so a 1,800 px box gets more bumps, not wider ones;
 * the ends (a rounded snow end, a pencil's eraser and tip) keep their size. A snow drift is a puffy
 * cap with a soft shadow edge and drips down both sides.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { BoxKey } from '../../shared/classroomLayout.ts';
import type { FrameSurface, ResolvedFrame } from '../../shared/themePackage/engine.ts';
import type { ColorToken } from '../../shared/themePackage/tokens.ts';
import type { ThemeKey } from '../../shared/themes.ts';
import { useTheme } from '../themes/index.tsx';

const tok = (t: ColorToken) => `var(--cc-${t})`;
const r1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- measuring (one shared observer)
type Size2 = { w: number; h: number };
const watched = new Map<Element, (s: Size2) => void>();
let observer: ResizeObserver | null = null;
function watch(el: Element, fn: (s: Size2) => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  observer ??= new ResizeObserver((entries) => {
    for (const e of entries) watched.get(e.target)?.({ w: e.contentRect.width, h: e.contentRect.height });
  });
  watched.set(el, fn);
  observer.observe(el);
  return () => {
    watched.delete(el);
    observer?.unobserve(el);
  };
}

/**
 * The CSS-pixel size of an overlay (rounded), measured before the first paint and on every resize.
 * Until it is known (server rendering, jsdom) the fallback is used, so something sensible is drawn.
 */
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function useBoxSize<T extends Element>(fallback: Size2): [RefObject<T | null>, Size2] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(fallback);
  useBeforePaint(() => {
    const el = ref.current;
    if (!el) return;
    const set = (s: Size2) => {
      const w = Math.round(s.w);
      const h = Math.round(s.h);
      if (w > 0 && h > 0) setSize((old) => (old.w === w && old.h === h ? old : { w, h }));
    };
    const r = el.getBoundingClientRect();
    set({ w: r.width, h: r.height });
    return watch(el, set);
  }, []);
  return [ref, size];
}

// ---------------------------------------------------------------- shapes in CSS pixels (S17b)
/** n whole motifs of about `step` px across `span` px (at least `min`). */
const tiles = (span: number, step: number, min = 1) => {
  const n = Math.max(min, Math.round(span / step));
  return { n, size: span / n };
};

/**
 * A snow drift `w`×`h`: rounded ends that hang a little lower, a row of puffy bumps of about `bump` px
 * (heights vary in a fixed pattern) and a gently wavy underside.
 */
export function driftPath(w: number, h: number, bump: number): string {
  const end = Math.min(h * 0.55, w / 5);
  const base = h * 0.42;
  const { n, size } = tiles(w - 2 * end, bump);
  const peaks = [0.04, 0.12, 0, 0.09, 0.03, 0.14];
  let d = `M0 ${r1(h * 0.88)} C0 ${r1(h * 0.55)} ${r1(end * 0.3)} ${r1(base)} ${r1(end)} ${r1(base)}`;
  for (let i = 0; i < n; i++) {
    const x0 = end + i * size;
    const x1 = x0 + size;
    // A cubic with both controls at c peaks at base + 0.75 × (c − base).
    const top = h * peaks[i % peaks.length]! + 0.5;
    const c = base - (base - top) / 0.75;
    d += ` C${r1(x0 + size * 0.08)} ${r1(c)} ${r1(x1 - size * 0.08)} ${r1(c)} ${r1(x1)} ${r1(base)}`;
  }
  d += ` C${r1(w - end * 0.3)} ${r1(base)} ${w} ${r1(h * 0.55)} ${w} ${r1(h * 0.88)}`;
  // The underside: small waves back to the left (about 28 px each).
  const under = tiles(w, 28, 2);
  for (let j = under.n - 1; j >= 0; j--) {
    const x = j * under.size;
    const y = j % 2 === 0 ? h * 0.8 : h * 0.92;
    d += ` Q${r1(x + under.size / 2)} ${r1(y)} ${r1(x)} ${r1(j === 0 ? h * 0.88 : (y + h * 0.86) / 2)}`;
  }
  return `${d}Z`;
}

/** Scallops (gingerbread icing) of about `step` px along the bottom of a `w`×`h` box. */
export function scallopPath(w: number, h: number, step = 20): string {
  const { n, size } = tiles(w, step);
  const ry = Math.min(h - 1, size * 0.5);
  return `M0 ${h}${` a${r1(size / 2)} ${r1(ry)} 0 0 1 ${r1(size)} 0`.repeat(n)}`;
}

/** A torn paper edge: teeth of about 14 px; the line and the filled shape. */
export function tornPaths(w: number, h: number): { line: string; fill: string } {
  const { n, size } = tiles(w, 14);
  const ys = [0.2, 0.45, 0.15, 0.4, 0.1, 0.35];
  let line = `M0 ${r1(h * 0.4)}`;
  for (let i = 1; i <= n; i++) line += ` L${r1(i * size)} ${r1(h * ys[(i - 1) % ys.length]!)}`;
  return { line, fill: `${line} L${w} ${h} L0 ${h}Z` };
}

const DRIP = 'M6 0 C12 6 11 20 8 30 C7 36 3 38 3 32 C2 22 0 8 6 0Z';
const FROST_CORNER = 'M4 36 L20 20 M4 36 L30 34 M4 36 L6 10 M12 28 l-4 -6 M12 28 l6 2 M20 34 l-2 -6';
const FROST_CORNER_FINE = 'M4 36 L20 20 M4 36 L30 34 M4 36 L6 10';
const STAR = 'M20 2 l5 12 13 1 -10 8 3 13 -11 -7 -11 7 3 -13 -10 -8 13 -1z';
const COMPASS = 'M20 2 L24 16 L38 20 L24 24 L20 38 L16 24 L2 20 L16 16Z';
const LEAF = 'M4 30 C4 12 16 4 34 4 C34 22 22 30 4 30Z';

type Size = 'box' | 'card';
const pick = (list: readonly ColorToken[], i: number): ColorToken => list[Math.min(i, list.length - 1)]!;

/** An SVG overlay placed by CSS class (position and size live in app.css, per surface). */
function Svg({ className, viewBox, children, over = true, flip }: { className: string; viewBox: string; children: ReactNode; over?: boolean; flip?: 'x' | 'y' }) {
  return (
    <svg
      className={`cc-frame ${over ? 'cc-frame--over' : 'cc-frame--under'} ${className}`}
      viewBox={viewBox}
      preserveAspectRatio={className.includes('cc-frame__corner') ? 'xMidYMid meet' : 'none'}
      aria-hidden="true"
      focusable="false"
      data-flip={flip}
    >
      {children}
    </svg>
  );
}

/**
 * An overlay drawn in its own CSS pixels: it measures itself and `draw` builds the shapes for that
 * size, so its viewBox always equals its box (nothing stretched).
 */
function MeasuredSvg({ className, flip, fallback, draw }: { className: string; flip?: 'x' | 'y'; fallback: Size2; draw: (s: Size2) => ReactNode }) {
  const [ref, s] = useBoxSize<SVGSVGElement>(fallback);
  return (
    <svg ref={ref} className={`cc-frame cc-frame--over ${className}`} viewBox={`0 0 ${s.w} ${s.h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false" data-flip={flip}>
      {draw(s)}
    </svg>
  );
}

function Edge({ f, size, bottom }: { f: ResolvedFrame; size: Size; bottom: boolean }) {
  const fill = tok(f.snowColor);
  const line = tok('border');
  const flip = bottom ? 'y' : undefined;
  const where = bottom ? 'bottom' : 'top';
  switch (f.edge) {
    case 'snowDrift': {
      const bump = size === 'box' ? 46 : 30;
      return (
        <>
          <MeasuredSvg
            className={`cc-frame__edge cc-frame__edge--drift cc-frame__edge--${where}`}
            flip={flip}
            fallback={size === 'box' ? { w: 400, h: 30 } : { w: 150, h: 18 }}
            draw={({ w, h }) => {
              const d = driftPath(w, h - 2, bump);
              return (
                <>
                  {/* The soft shadow edge under the snow (mockup Main.dc.html). */}
                  <path d={d} transform="translate(0 2)" fill={line} opacity="0.45" />
                  <path d={d} fill={fill} stroke={line} strokeWidth={size === 'box' ? 1.5 : 1.2} strokeLinejoin="round" />
                </>
              );
            }}
          />
          {size === 'box' && !bottom ? (
            <>
              <Svg className="cc-frame__drip cc-frame__drip--left cc-frame--detail" viewBox="0 0 12 40">
                <path d={DRIP} fill={fill} stroke={line} strokeWidth="1" vectorEffect="non-scaling-stroke" />
              </Svg>
              <Svg className="cc-frame__drip cc-frame__drip--right cc-frame--detail" viewBox="0 0 12 40" flip="x">
                <path d={DRIP} fill={fill} stroke={line} strokeWidth="1" vectorEffect="non-scaling-stroke" />
              </Svg>
            </>
          ) : null}
        </>
      );
    }
    case 'scallop': {
      const scallop = (cls: string, fl?: 'y') => (
        <MeasuredSvg
          className={`cc-frame__edge cc-frame__edge--scallop ${cls}`}
          flip={fl}
          fallback={{ w: 200, h: 12 }}
          draw={({ w, h }) => <path d={scallopPath(w - 2, h - 1, size === 'box' ? 20 : 16)} transform="translate(1 0)" fill={fill} stroke={line} strokeWidth="2" />}
        />
      );
      return (
        <>
          {scallop(`cc-frame__edge--${where}`, flip)}
          {size === 'box' && !bottom ? scallop('cc-frame__edge--bottom', 'y') : null}
        </>
      );
    }
    case 'torn':
      return (
        <MeasuredSvg
          className={`cc-frame__edge cc-frame__edge--torn cc-frame__edge--${where}`}
          flip={flip}
          fallback={{ w: 400, h: 12 }}
          draw={({ w, h }) => {
            const p = tornPaths(w, h);
            return (
              <>
                <path d={p.fill} fill={fill} />
                <path d={p.line} fill="none" stroke={line} strokeWidth="2" strokeLinejoin="round" />
              </>
            );
          }}
        />
      );
    default:
      return null;
  }
}

/** A leaf vine with flowers across `w`×`h` (the garland trim, Animals mockup): leaves about every 45 px. */
function Garland({ w, h, c }: { w: number; h: number; c: readonly ColorToken[] }) {
  const { n, size } = tiles(w - 8, 45, 2);
  const mid = h * 0.45;
  const amp = h * 0.18;
  const yAt = (x: number) => mid + amp * Math.sin((x / 110) * Math.PI * 2);
  let vine = `M4 ${r1(yAt(4))}`;
  for (let x = 14; x <= w - 4; x += 10) vine += ` L${r1(x)} ${r1(yAt(x))}`;
  const leaves: ReactNode[] = [];
  const flowers: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const x = 4 + (i + 0.5) * size;
    const y = yAt(x);
    const up = i % 2 === 0;
    leaves.push(<path key={`l${i}`} d={`M${r1(x)} ${r1(y)} q${up ? '7 -11 15 -3' : '7 11 15 3'} q${up ? '-8 8 -15 3' : '-8 -8 -15 -3'}z`} />);
    if (i % 2 === 1) {
      const fx = x + size / 2;
      const fy = yAt(fx);
      flowers.push(
        <g key={`f${i}`}>
          <circle cx={r1(fx)} cy={r1(fy)} r="4.6" fill={tok(pick(c, i % 4 === 1 ? 1 : 2))} />
          <circle cx={r1(fx)} cy={r1(fy)} r="1.8" fill={tok('art-light')} />
        </g>,
      );
    }
  }
  return (
    <>
      <path d={vine} fill="none" stroke={tok(pick(c, 0))} strokeWidth="3" strokeLinecap="round" />
      <path d={vine} fill="none" stroke={tok('text')} strokeOpacity="0.2" strokeWidth="3" strokeLinecap="round" />
      <g fill={tok(pick(c, 0))}>{leaves}</g>
      {flowers}
    </>
  );
}

/** String lights: a sagging wire between hooks about every 110 px, a bulb about every 28 px. */
function Lights({ w, h, c }: { w: number; h: number; c: readonly ColorToken[] }) {
  const sag = tiles(w - 8, 110);
  let wire = `M4 ${r1(h * 0.2)}`;
  for (let i = 0; i < sag.n; i++) wire += ` Q${r1(4 + (i + 0.5) * sag.size)} ${r1(h * 0.75)} ${r1(4 + (i + 1) * sag.size)} ${r1(h * 0.2)}`;
  const bulbs = tiles(w - 8, 28, 2);
  // On a quadratic sag the wire is at y0 + 2t(1 − t)(yc − y0), t the share of the way along the sag.
  const yOn = (x: number) => {
    const t = (((x - 4) % sag.size) + sag.size) % sag.size / sag.size;
    return h * 0.2 + 2 * t * (1 - t) * (h * 0.75 - h * 0.2);
  };
  return (
    <>
      <path d={wire} fill="none" stroke={tok('text-muted')} strokeWidth="1.6" />
      {Array.from({ length: bulbs.n }, (_, i) => {
        const x = 4 + (i + 0.5) * bulbs.size;
        return <ellipse key={i} cx={r1(x)} cy={r1(yOn(x) + 6)} rx="4.5" ry="6" fill={tok(pick(c, i % c.length))} />;
      })}
    </>
  );
}

/** A pencil `w`×`h`: an eraser and a metal band, a long body with two grooves, a wooden tip and lead. */
function Pencil({ w, h, c }: { w: number; h: number; c: readonly ColorToken[] }) {
  const eraser = Math.min(18, w / 8);
  const band = 6;
  const tip = Math.min(34, w / 6);
  const bodyEnd = w - tip;
  const t = 1;
  const b = h - 1;
  const m = h / 2;
  const outline = `M${eraser} ${t} H${r1(bodyEnd)} L${w - 1} ${r1(m)} L${r1(bodyEnd)} ${b} H${eraser} Z`;
  return (
    <>
      <path d={`M2 ${t} H${eraser} V${b} H2 Q0 ${r1(m)} 2 ${t}Z`} fill={tok(pick(c, 1))} />
      <path d={outline} fill={tok(pick(c, 0))} />
      <path d={`M${r1(bodyEnd)} ${t} L${w - 1} ${r1(m)} L${r1(bodyEnd)} ${b}Z`} fill={tok('art-light')} />
      <path d={`M${r1(w - tip * 0.3)} ${r1(m - h * 0.15)} L${w - 1} ${r1(m)} L${r1(w - tip * 0.3)} ${r1(m + h * 0.15)}Z`} fill={tok(pick(c, 2))} />
      <rect x={eraser} y={t} width={band} height={b - t} fill={tok('border')} />
      <path
        d={`${outline} M${eraser + band} ${r1(h / 3)} H${r1(bodyEnd)} M${eraser + band} ${r1((2 * h) / 3)} H${r1(bodyEnd)} M2 ${t} H${eraser} V${b} H2`}
        fill="none"
        stroke={tok(pick(c, 2))}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </>
  );
}

function Trim({ f }: { f: ResolvedFrame }) {
  const c = f.trimColors;
  const vars = (n: number): CSSProperties => Object.fromEntries(Array.from({ length: n }, (_, i) => [`--cc-frame-c${i}`, tok(pick(c, i))]));
  switch (f.trim) {
    case 'candyStripe':
      return <span className="cc-frame cc-frame--under cc-frame--detail cc-frame__ring cc-frame__ring--candy" style={vars(2)} aria-hidden="true" />;
    case 'frost':
      return <span className="cc-frame cc-frame--under cc-frame--detail cc-frame__ring cc-frame__ring--frost" style={vars(2)} aria-hidden="true" />;
    case 'stitched':
      return <span className="cc-frame cc-frame--over cc-frame--detail cc-frame__stitch" style={vars(1)} aria-hidden="true" />;
    case 'garland':
      return <MeasuredSvg className="cc-frame__swag cc-frame--detail" fallback={{ w: 220, h: 28 }} draw={({ w, h }) => <Garland w={w} h={h} c={c} />} />;
    case 'lights':
      return <MeasuredSvg className="cc-frame__swag cc-frame__swag--lights cc-frame--detail" fallback={{ w: 220, h: 22 }} draw={({ w, h }) => <Lights w={w} h={h} c={c} />} />;
    case 'pencil':
      return <MeasuredSvg className="cc-frame__pencil cc-frame--detail" fallback={{ w: 400, h: 18 }} draw={({ w, h }) => <Pencil w={w} h={h} c={c} />} />;
    default:
      return null;
  }
}

function Corners({ f }: { f: ResolvedFrame }) {
  const c0 = tok(pick(f.cornerColors, 0));
  const c1 = tok(pick(f.cornerColors, 1));
  switch (f.corners) {
    case 'frost':
      return (
        <>
          {(['left', 'right'] as const).map((side) => (
            <Svg key={side} className={`cc-frame__corner cc-frame__corner--bottom-${side} cc-frame--detail`} viewBox="0 0 40 40" flip={side === 'right' ? 'x' : undefined}>
              <path d={FROST_CORNER} fill="none" stroke={c0} strokeWidth="3.5" strokeLinecap="round" />
              <path d={FROST_CORNER_FINE} fill="none" stroke={c1} strokeWidth="1" strokeLinecap="round" />
            </Svg>
          ))}
        </>
      );
    case 'holly':
      return (
        <Svg className="cc-frame__corner cc-frame__corner--top-left cc-frame__corner--wide cc-frame--detail" viewBox="0 0 60 50">
          <path d="M30 26 C22 14 10 18 2 10 C8 20 4 26 10 30 C16 26 20 32 30 26Z" fill={c0} />
          <path d="M30 26 C38 12 50 16 58 8 C52 18 56 26 50 30 C44 26 40 32 30 26Z" fill={c0} />
          <path d="M30 26 C38 12 50 16 58 8 C52 18 56 26 50 30 C44 26 40 32 30 26Z" fill={tok('text')} opacity="0.15" />
          <circle cx="26" cy="30" r="5" fill={c1} />
          <circle cx="34" cy="31" r="5" fill={c1} />
          <circle cx="30" cy="24" r="5" fill={c1} />
        </Svg>
      );
    case 'star':
      return (
        <Svg className="cc-frame__corner cc-frame__corner--top-right cc-frame--detail" viewBox="0 0 40 40">
          <path d={STAR} fill={c0} stroke={c1} strokeWidth="1.5" strokeLinejoin="round" />
        </Svg>
      );
    case 'compass':
      return (
        <Svg className="cc-frame__corner cc-frame__corner--top-right cc-frame--detail" viewBox="0 0 40 40">
          <path d={COMPASS} fill={c0} stroke={c1} strokeWidth="2" strokeLinejoin="round" />
        </Svg>
      );
    case 'leaf':
      return (
        <Svg className="cc-frame__corner cc-frame__corner--top-left cc-frame--detail" viewBox="0 0 40 40">
          <path d={LEAF} fill={c0} stroke={c1} strokeWidth="2" strokeLinejoin="round" />
          <path d="M7 27 L28 8" fill="none" stroke={c1} strokeWidth="3" strokeLinecap="round" />
        </Svg>
      );
    default:
      return null;
  }
}

/**
 * Ordinary cards (`.cc-card`) are everywhere and drawn without a component, so their frame is the edge
 * only, drawn by app.css from `<html data-frame-cards="<edge>">` (with the edge colour in
 * `--cc-frame-edge`). Mounted once by the root layout for the document theme.
 */
export function FrameDocumentFlags() {
  const f = useTheme().frame;
  const edge = f && f.apply.includes('cards') && f.edge !== 'none' ? f.edge : null;
  const colour = f ? tok(f.snowColor) : null;
  useEffect(() => {
    const html = document.documentElement;
    if (edge && colour) {
      html.dataset.frameCards = edge;
      html.style.setProperty('--cc-frame-edge', colour);
    } else {
      delete html.dataset.frameCards;
      html.style.removeProperty('--cc-frame-edge');
    }
  }, [edge, colour]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset.frameCards;
      document.documentElement.style.removeProperty('--cc-frame-edge');
    },
    [],
  );
  return null;
}

/**
 * The frame overlays of one surface, or nothing when the theme has no frame there. Place it as a
 * child of the framed element (which becomes `position: relative` through app.css when it has one).
 * `boxKey` (board boxes): whether this box gets the trim (`trimOn`).
 */
export function FrameOverlay({ surface, boxKey, theme }: { surface: FrameSurface; boxKey?: BoxKey; theme?: ThemeKey }) {
  const f = useTheme(theme).frame;
  if (!f || !f.apply.includes(surface)) return null;
  // Student cards are small: the edge only (mockup). Cards and dialogs: the edge only. The top bar
  // spans the page from its top: its edge hangs from the bottom.
  const size: Size = surface === 'studentCards' ? 'card' : 'box';
  const edgeOnly = surface === 'studentCards' || surface === 'cards';
  const trim = surface === 'boardBoxes' && boxKey !== undefined && f.trimOn.includes(boxKey);
  if (f.edge === 'none' && (edgeOnly || (!trim && f.corners === 'none'))) return null;
  return (
    <>
      <Edge f={f} size={size} bottom={surface === 'topBar'} />
      {trim ? <Trim f={f} /> : null}
      {edgeOnly ? null : <Corners f={f} />}
    </>
  );
}
