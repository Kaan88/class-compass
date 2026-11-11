/**
 * Animals scene (S17b, D-168; mockup ThemedBoard.dc.html, prop animals): a meadow under a soft sun
 * with clouds, round trees, flowers and a burrow. Original SVG in a 1920×1080 box, far to near;
 * colours are theme tokens only. The last layer (the meadow) is also the phone strip.
 */
import { tok } from '../art.tsx';
import type { ThemeScene } from '../types.ts';

/** Sky, sun, clouds and the far hills with round trees. */
function Far() {
  return (
    <g>
      <rect width="1920" height="1080" fill={tok('art-sky')} />
      <circle cx="1640" cy="230" r="130" fill={tok('art-light')} opacity="0.5" />
      <circle cx="1640" cy="230" r="90" fill={tok('art-light')} />
      <g fill={tok('surface')} opacity="0.9">
        <ellipse cx="320" cy="220" rx="90" ry="34" />
        <ellipse cx="380" cy="200" rx="60" ry="34" />
        <ellipse cx="1100" cy="160" rx="80" ry="28" />
        <ellipse cx="1150" cy="146" rx="46" ry="24" />
      </g>
      <path d="M0 740 C240 660 480 700 720 680 C980 660 1200 720 1440 690 C1660 660 1800 670 1920 690 V1080 H0Z" fill={tok('art-ground')} />
      <g fill={tok('deco-1')} opacity="0.7">
        <circle cx="220" cy="660" r="60" />
        <circle cx="300" cy="690" r="44" />
        <circle cx="1500" cy="650" r="66" />
        <circle cx="1590" cy="680" r="48" />
        <circle cx="860" cy="670" r="40" />
      </g>
    </g>
  );
}

const FLOWERS: ReadonlyArray<readonly [number, number, 'deco-2' | 'deco-3' | 'surface']> = [
  [420, 900, 'deco-2'],
  [560, 930, 'deco-2'],
  [1240, 920, 'deco-2'],
  [1400, 900, 'deco-2'],
  [480, 940, 'deco-3'],
  [1320, 940, 'deco-3'],
  [700, 910, 'deco-3'],
  [1000, 930, 'surface'],
  [1100, 905, 'surface'],
  [260, 960, 'surface'],
  [1640, 950, 'deco-2'],
];

/** The meadow: big round trees at the sides, flowers, the burrow and the front grass. */
function Meadow() {
  return (
    <g>
      <path d="M0 840 C300 790 620 830 940 815 C1260 800 1560 840 1920 810 V1080 H0Z" fill={tok('deco-1')} opacity="0.45" />
      <g fill={tok('avatar-brown')}>
        <rect x="72" y="850" width="16" height="70" />
        <rect x="1792" y="846" width="16" height="70" />
      </g>
      <g fill={tok('deco-1')}>
        <circle cx="80" cy="800" r="70" />
        <circle cx="170" cy="830" r="54" />
        <circle cx="1800" cy="790" r="74" />
        <circle cx="1700" cy="830" r="50" />
      </g>
      <g fill={tok('surface')} opacity="0.2">
        <circle cx="60" cy="780" r="24" />
        <circle cx="1780" cy="770" r="26" />
      </g>
      {FLOWERS.map(([x, y, c]) => (
        <g key={`${x}-${y}`}>
          <path d={`M${x} ${y + 8} V${y + 30}`} stroke={tok('deco-1')} strokeWidth="3" strokeLinecap="round" />
          <circle cx={x} cy={y} r="8" fill={tok(c)} />
          <circle cx={x} cy={y} r="3" fill={tok('art-light')} />
        </g>
      ))}
      <path d="M880 962 a70 50 0 0 1 140 0Z" fill={tok('avatar-brown')} />
      <path d="M906 962 a44 32 0 0 1 88 0Z" fill={tok('mascot-ink')} opacity="0.7" />
      <path d="M0 1000 C320 970 640 1010 960 990 C1300 970 1600 1010 1920 980 V1080 H0Z" fill={tok('deco-1')} opacity="0.75" />
      <g fill="none" stroke={tok('deco-1')} strokeWidth="4" strokeLinecap="round">
        <path d="M150 1000 q6 -22 14 -30 M330 1006 q-4 -20 -12 -28 M1560 996 q6 -22 14 -30 M1750 990 q-4 -20 -12 -28" />
      </g>
    </g>
  );
}

export const animalsScene: ThemeScene = {
  opacity: 1,
  smallScreens: 'bottomStrip',
  layers: [
    { Art: Far, viewBox: '0 0 1920 1080', fit: 'cover', anchor: 'bottom' },
    { Art: Meadow, viewBox: '0 0 1920 1080', fit: 'cover', anchor: 'bottom' },
  ],
};
