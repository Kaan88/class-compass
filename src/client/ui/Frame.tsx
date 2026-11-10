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
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import type { BoxKey } from '../../shared/classroomLayout.ts';
import type { FrameSurface, ResolvedFrame } from '../../shared/themePackage/engine.ts';
import type { ColorToken } from '../../shared/themePackage/tokens.ts';
import type { ThemeKey } from '../../shared/themes.ts';
import { useTheme } from '../themes/index.tsx';

const tok = (t: ColorToken) => `var(--cc-${t})`;

// ---------------------------------------------------------------- shapes (mockup paths)
const DRIFT =
  'M0 42 V24 C10 22 14 12 30 13 C44 4 62 8 72 14 C86 6 104 4 116 13 C132 5 150 7 160 15 C176 6 194 6 206 14 C220 5 240 6 250 14 C266 4 286 7 296 15 C310 6 330 6 342 13 C356 5 378 8 388 15 C396 16 400 20 400 26 V42 C392 38 386 44 378 40 C360 44 350 38 330 41 C300 36 280 44 250 40 C220 44 200 37 170 41 C140 44 120 38 90 41 C60 44 40 38 20 41 C10 44 4 40 0 42Z';
const DRIFT_SM = 'M0 30 V18 C8 14 14 8 26 10 C38 3 52 6 60 11 C72 4 88 4 96 11 C108 4 124 5 132 11 C142 8 150 12 150 18 V30 C140 26 132 30 120 27 C100 30 90 25 70 28 C50 30 36 25 20 28 C10 30 4 27 0 30Z';
const DRIP = 'M6 0 C12 6 11 20 8 30 C7 36 3 38 3 32 C2 22 0 8 6 0Z';
const SCALLOP = `M0 16${' a10 10 0 0 1 20 0'.repeat(10)}`;
const TORN_LINE = (() => {
  let d = 'M0 8';
  for (let x = 12, i = 0; x <= 400; x += 14, i++) d += ` L${x} ${[4, 9, 3, 8, 2, 7][i % 6]}`;
  return d;
})();
const TORN_FILL = `${TORN_LINE} L400 20 L0 20Z`;
const GARLAND = 'M4 8 Q56 34 110 10 Q164 34 216 8';
const LIGHTS_WIRE = 'M4 6 Q60 22 110 8 Q160 22 216 6';
const BULBS: ReadonlyArray<readonly [number, number]> = [
  [24, 15],
  [52, 19],
  [80, 17],
  [110, 13],
  [140, 17],
  [168, 19],
  [196, 15],
];
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

function Edge({ f, size, bottom }: { f: ResolvedFrame; size: Size; bottom: boolean }) {
  const fill = tok(f.snowColor);
  const line = tok('border');
  const flip = bottom ? 'y' : undefined;
  const where = bottom ? 'bottom' : 'top';
  switch (f.edge) {
    case 'snowDrift':
      return (
        <>
          <Svg className={`cc-frame__edge cc-frame__edge--drift cc-frame__edge--${where}`} viewBox={size === 'box' ? '0 0 400 46' : '0 0 150 30'} flip={flip}>
            <path d={size === 'box' ? DRIFT : DRIFT_SM} fill={fill} stroke={line} strokeWidth={size === 'box' ? 1.5 : 1.2} vectorEffect="non-scaling-stroke" />
          </Svg>
          {size === 'box' && !bottom ? (
            <Svg className="cc-frame__drip cc-frame--detail" viewBox="0 0 12 40">
              <path d={DRIP} fill={fill} stroke={line} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            </Svg>
          ) : null}
        </>
      );
    case 'scallop':
      return (
        <>
          <Svg className={`cc-frame__edge cc-frame__edge--scallop cc-frame__edge--${where}`} viewBox="0 0 200 16" flip={flip}>
            <path d={SCALLOP} fill={fill} stroke={line} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </Svg>
          {size === 'box' && !bottom ? (
            <Svg className="cc-frame__edge cc-frame__edge--scallop cc-frame__edge--bottom" viewBox="0 0 200 16" flip="y">
              <path d={SCALLOP} fill={fill} stroke={line} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </Svg>
          ) : null}
        </>
      );
    case 'torn':
      return (
        <Svg className={`cc-frame__edge cc-frame__edge--torn cc-frame__edge--${where}`} viewBox="0 0 400 20" flip={flip}>
          <path d={TORN_FILL} fill={fill} />
          <path d={TORN_LINE} fill="none" stroke={line} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </Svg>
      );
    default:
      return null;
  }
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
      return (
        <Svg className="cc-frame__swag cc-frame--detail" viewBox="0 0 220 34">
          <path d={GARLAND} fill="none" stroke={tok(pick(c, 0))} strokeWidth="9" strokeLinecap="round" />
          <path d={GARLAND} fill="none" stroke={tok('text')} strokeOpacity="0.25" strokeWidth="3" strokeDasharray="2 6" strokeLinecap="round" />
          <circle cx="34" cy="18" r="4" fill={tok(pick(c, 1))} />
          <circle cx="74" cy="21" r="4" fill={tok(pick(c, 2))} />
          <circle cx="146" cy="21" r="4" fill={tok(pick(c, 1))} />
          <circle cx="186" cy="18" r="4" fill={tok(pick(c, 2))} />
          <circle cx="110" cy="10" r="6" fill={tok(pick(c, 1))} />
        </Svg>
      );
    case 'lights':
      return (
        <Svg className="cc-frame__swag cc-frame__swag--lights cc-frame--detail" viewBox="0 0 220 30">
          <path d={LIGHTS_WIRE} fill="none" stroke={tok('text-muted')} strokeWidth="1.6" />
          {BULBS.map(([x, y], i) => (
            <ellipse key={x} cx={x} cy={y} rx="4.5" ry="6" fill={tok(pick(c, i % c.length))} />
          ))}
        </Svg>
      );
    case 'pencil':
      return (
        <Svg className="cc-frame__pencil cc-frame--detail" viewBox="0 0 400 30">
          <path d="M20 6 H360 L398 15 L360 24 H20Z" fill={tok(pick(c, 0))} />
          <path d="M2 6 H20 V24 H2Z" fill={tok(pick(c, 1))} />
          <path d="M20 6 H360 L398 15 L360 24 H20Z M360 6 V24 M20 15 H360 M386 12 L398 15 L386 18 M2 6 H20 V24 H2Z" fill="none" stroke={tok(pick(c, 2))} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </Svg>
      );
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
