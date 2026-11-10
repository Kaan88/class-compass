/**
 * Shared drawing helpers for theme art (mascot poses, scenes). Original simple SVG, coloured only with
 * semantic tokens, so every theme's art follows its palette and passes the raw-colour lint.
 * Nothing here is interactive or carries meaning on its own: all art is decorative (aria-hidden by
 * its wrapper) and never contains text.
 */
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { ColorToken, MascotPose, MascotProps } from './types.ts';

export const tok = (t: ColorToken) => `var(--cc-${t})`;

/**
 * One mascot everywhere (S17a, D-166): the mascot of the theme that is drawing an illustration.
 * `ThemeIllustration` provides the active theme's mascot, so an imported package that keeps a built-in
 * theme's illustrations shows its own mascot in them instead of the built-in one.
 */
export const MascotContext = createContext<ComponentType<MascotProps> | null>(null);

/**
 * The mascot a built-in illustration draws: the one from `MascotContext`, else `fallback` (the theme's
 * own mascot, e.g. in the catalogue where nothing provides one).
 */
export function mascotSlot(fallback: ComponentType<MascotProps>): ComponentType<MascotProps> {
  return function ThemeMascotSlot({ pose }: MascotProps) {
    const Active = useContext(MascotContext) ?? fallback;
    return <Active pose={pose} />;
  };
}

type Pt = readonly [number, number];

/** Eyes and mouth for a pose. `eyes` are the two eye centres, `mouth` the mouth centre. */
export function Face({ pose, eyes, mouth, size = 3.4 }: { pose: MascotPose; eyes: readonly [Pt, Pt]; mouth: Pt; size?: number }) {
  const ink = tok('mascot-ink');
  const [mx, my] = mouth;
  const eye = ([x, y]: Pt, i: number) => {
    if (pose === 'sleepy') return <path key={i} d={`M${x - size} ${y} Q${x} ${y + size} ${x + size} ${y}`} stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />;
    if (pose === 'cheer' || pose === 'celebrate')
      return <path key={i} d={`M${x - size} ${y + 1} Q${x} ${y - size - 1} ${x + size} ${y + 1}`} stroke={ink} strokeWidth="2.2" fill="none" strokeLinecap="round" />;
    if (pose === 'thinking') return <circle key={i} cx={x + 1} cy={y - 1.2} r={size * 0.8} fill={ink} />;
    return <circle key={i} cx={x} cy={y} r={size} fill={ink} />;
  };
  const mouthShape =
    pose === 'sleepy' ? (
      <ellipse cx={mx} cy={my} rx="2.2" ry="1.6" fill={ink} />
    ) : pose === 'thinking' ? (
      <path d={`M${mx - 4} ${my + 1} L${mx + 4} ${my - 1}`} stroke={ink} strokeWidth="2" strokeLinecap="round" />
    ) : pose === 'cheer' || pose === 'celebrate' ? (
      <path d={`M${mx - 6} ${my - 1} Q${mx} ${my + 9} ${mx + 6} ${my - 1} Z`} fill={ink} />
    ) : (
      <path d={`M${mx - 5} ${my} Q${mx} ${my + 5} ${mx + 5} ${my}`} stroke={ink} strokeWidth="2.2" fill="none" strokeLinecap="round" />
    );
  return (
    <g>
      {eyes.map(eye)}
      {mouthShape}
    </g>
  );
}

/** Two stubby arms at the shoulders: down (idle, sleepy), raised (cheer, celebrate), one at the chin (thinking). */
export function Arms({ pose, left, right, colour = 'mascot-body', length = 16 }: { pose: MascotPose; left: Pt; right: Pt; colour?: ColorToken; length?: number }) {
  const up = pose === 'cheer' || pose === 'celebrate';
  const arm = ([x, y]: Pt, side: -1 | 1, angle: number) => (
    <rect x={x - 4} y={y} width="8" height={length} rx="4" fill={tok(colour)} transform={`rotate(${side * angle} ${x} ${y})`} />
  );
  const leftAngle = up ? 145 : 25;
  const rightAngle = pose === 'thinking' ? 130 : up ? 145 : 25;
  return (
    <g>
      {arm(left, 1, leftAngle)}
      {arm(right, -1, rightAngle)}
    </g>
  );
}

/** Small extras that make a pose readable at a glance: Zz, thought dots, sparkles, confetti. */
export function PoseExtras({ pose, at }: { pose: MascotPose; at: Pt }) {
  const [x, y] = at;
  if (pose === 'sleepy')
    return (
      <g stroke={tok('mascot-ink')} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.7">
        <path d={`M${x} ${y} h6 l-6 7 h6`} />
        <path d={`M${x + 9} ${y - 10} h4 l-4 5 h4`} />
      </g>
    );
  if (pose === 'thinking')
    return (
      <g fill={tok('mascot-ink')} opacity="0.55">
        <circle cx={x} cy={y + 8} r="1.8" />
        <circle cx={x + 5} cy={y + 2} r="2.6" />
        <circle cx={x + 12} cy={y - 6} r="4" />
      </g>
    );
  if (pose === 'cheer') return <Sparkles points={[[x, y], [x - 70, y + 6]]} />;
  if (pose === 'celebrate') return <Confetti x={x - 40} y={y - 4} w={80} />;
  return null;
}

export function Sparkles({ points, size = 4 }: { points: readonly Pt[]; size?: number }) {
  return (
    <g fill={tok('mascot-accent')}>
      {points.map(([x, y]) => (
        <path key={`${x}-${y}`} d={`M${x} ${y - size} L${x + size * 0.35} ${y - size * 0.35} L${x + size} ${y} L${x + size * 0.35} ${y + size * 0.35} L${x} ${y + size} L${x - size * 0.35} ${y + size * 0.35} L${x - size} ${y} L${x - size * 0.35} ${y - size * 0.35} Z`} />
      ))}
    </g>
  );
}

/** A handful of static confetti pieces (they never blink; motion comes only from the theme's one-shot animation). */
export function Confetti({ x, y, w }: { x: number; y: number; w: number }) {
  const colours: ColorToken[] = ['deco-1', 'deco-2', 'deco-3', 'mascot-accent'];
  const pieces = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ cx: x + ((i * 37) % 100) * (w / 100), cy: y + ((i * 53) % 23), r: (i * 29) % 60, c: colours[i % colours.length]! }));
  return (
    <g>
      {pieces.map((p, i) => (
        <rect key={i} x={p.cx} y={p.cy} width="5" height="3" rx="1" fill={tok(p.c)} transform={`rotate(${p.r} ${p.cx} ${p.cy})`} />
      ))}
    </g>
  );
}

/** Rounded sky + ground backdrop for a 200×140 illustration. */
export function Scene({ children, ground = 104 }: { children: ReactNode; ground?: number }) {
  return (
    <g>
      <rect x="4" y="4" width="192" height="132" rx="18" fill={tok('art-sky')} />
      <path d={`M4 ${ground} Q60 ${ground - 12} 110 ${ground - 2} T196 ${ground - 6} V118 a18 18 0 0 1 -18 18 H22 a18 18 0 0 1 -18 -18 Z`} fill={tok('art-ground')} />
      {children}
    </g>
  );
}

/** Place 100×100 mascot content at (x, y) with a scale. */
export const Place = ({ x, y, s, children }: { x: number; y: number; s: number; children: ReactNode }) => <g transform={`translate(${x} ${y}) scale(${s})`}>{children}</g>;

export function Moon({ x, y, r = 12 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={tok('art-light')} />
      <circle cx={x + r * 0.45} cy={y - r * 0.3} r={r * 0.85} fill={tok('art-sky')} />
    </g>
  );
}

export function Sun({ x, y, r = 14 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r + 6} fill={tok('art-light')} />
      <circle cx={x} cy={y} r={r} fill={tok('deco-2')} />
    </g>
  );
}

export function Stars({ points }: { points: readonly Pt[] }) {
  return (
    <g fill={tok('art-light')}>
      {points.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" />
      ))}
    </g>
  );
}
