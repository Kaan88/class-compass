/**
 * Classroom scene (S17b, D-168; mockup ThemedBoard.dc.html, prop classroom): a sunny classroom wall
 * with two windows and bunting, bookshelves, a plant and a gold star on the floor. Original SVG in a
 * 1920×1080 box, far to near; colours are theme tokens only. The last layer (floor and shelves) is
 * also the phone strip.
 */
import { tok } from '../art.tsx';
import type { ThemeScene } from '../types.ts';

const FLAGS: ReadonlyArray<readonly [number, number, 'deco-2' | 'deco-1' | 'deco-3']> = [
  [60, 136, 'deco-2'],
  [220, 160, 'deco-1'],
  [380, 136, 'deco-3'],
  [540, 160, 'deco-2'],
  [1340, 160, 'deco-1'],
  [1500, 136, 'deco-2'],
  [1660, 160, 'deco-1'],
  [1820, 136, 'deco-3'],
];

function Window({ x, sun }: { x: number; sun: boolean }) {
  return (
    <g>
      <rect x={x} y="300" width="300" height="360" rx="14" fill={tok('art-sky')} stroke={tok('deco-1')} strokeWidth="14" />
      {sun ? <circle cx={x + 230} cy="380" r="34" fill={tok('art-light')} /> : <ellipse cx={x + 90} cy="560" rx="54" ry="20" fill={tok('surface')} />}
      {sun ? <ellipse cx={x + 90} cy="430" rx="44" ry="16" fill={tok('surface')} /> : <circle cx={x + 60} cy="380" r="26" fill={tok('art-light')} />}
      <path d={`M${x + 150} 300 V660 M${x} 480 H${x + 300}`} stroke={tok('deco-1')} strokeWidth="10" />
      <rect x={x - 16} y="656" width="332" height="16" rx="6" fill={tok('border')} />
    </g>
  );
}

/** The wall: bunting along the top and two windows. */
function Wall() {
  return (
    <g>
      <rect width="1920" height="1080" fill={tok('bg')} />
      <path d="M0 120 Q160 170 320 120 Q480 170 640 120 Q800 170 960 120 Q1120 170 1280 120 Q1440 170 1600 120 Q1760 170 1920 120" fill="none" stroke={tok('deco-3')} strokeWidth="3" />
      {FLAGS.map(([x, y, c]) => (
        <path key={x} d={`M${x} ${y} l40 0 l-20 44z`} fill={tok(c)} />
      ))}
      <Window x={70} sun />
      <Window x={1550} sun={false} />
    </g>
  );
}

const BOOKS_LEFT: ReadonlyArray<readonly [number, number, number, 'deco-3' | 'deco-2' | 'accent' | 'deco-1' | 'mascot-cheek' | 'counter-leaf']> = [
  [60, 26, 120, 'deco-3'],
  [90, 22, 110, 'deco-2'],
  [116, 30, 124, 'accent'],
  [150, 22, 104, 'deco-1'],
  [176, 28, 116, 'mascot-cheek'],
];
const BOOKS_RIGHT: typeof BOOKS_LEFT = [
  [1480, 26, 120, 'accent'],
  [1510, 24, 108, 'deco-2'],
  [1538, 30, 122, 'deco-3'],
  [1572, 22, 112, 'counter-leaf'],
  [1598, 26, 100, 'mascot-cheek'],
];

/** Floor, two bookshelves, a plant and a star. */
function Floor() {
  return (
    <g>
      <rect x="0" y="880" width="1920" height="200" fill={tok('art-ground')} />
      <path d="M0 880 H1920" stroke={tok('border')} strokeWidth="6" />
      <rect x="40" y="740" width="420" height="160" rx="10" fill={tok('border')} />
      <rect x="1460" y="740" width="420" height="160" rx="10" fill={tok('border')} />
      {[...BOOKS_LEFT, ...BOOKS_RIGHT].map(([x, w, h, c]) => (
        <rect key={x} x={x} y={880 - h} width={w} height={h} rx="3" fill={tok(c)} />
      ))}
      <path d="M212 880 L236 770 L258 774 L236 880Z" fill={tok('deco-2')} />
      <path d="M330 900 h80 l-10 -60 h-60z" fill={tok('counter-rust')} />
      <path d="M370 840 C340 800 330 770 350 740 M370 840 C390 790 410 780 420 750 M370 840 C368 800 372 770 370 730" stroke={tok('counter-leaf')} strokeWidth="10" fill="none" strokeLinecap="round" />
      <path d="M1760 720 l14 30 32 3 -24 21 7 32 -29 -16 -29 16 7 -32 -24 -21 32 -3z" fill={tok('deco-2')} stroke={tok('warning')} strokeWidth="3" strokeLinejoin="round" />
      <g fill="none" stroke={tok('border')} strokeWidth="3" opacity="0.6">
        <path d="M0 960 H1920 M0 1040 H1920" />
      </g>
    </g>
  );
}

export const classroomScene: ThemeScene = {
  opacity: 1,
  smallScreens: 'bottomStrip',
  layers: [
    { Art: Wall, viewBox: '0 0 1920 1080', fit: 'cover', anchor: 'bottom' },
    { Art: Floor, viewBox: '0 0 1920 1080', fit: 'cover', anchor: 'bottom' },
  ],
};
