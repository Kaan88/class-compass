/**
 * Explorer scene (S17b, D-168; mockup ThemedBoard.dc.html, prop explorer): a map table under rolling
 * hills with a dotted trail, flags, tents and round trees, and a large faint compass rose in the sky.
 * Original SVG in a 1920×1080 box, far to near; colours are theme tokens only. Important things sit in
 * the lower half and away from the far edges (the board covers the middle; THEMING → Scene).
 */
import { tok } from '../art.tsx';
import type { ThemeScene } from '../types.ts';

/** Sky, the compass rose and the far mountains with light tops. */
function Far() {
  return (
    <g>
      <rect width="1920" height="1080" fill={tok('art-sky')} />
      <g fill="none" stroke={tok('deco-3')} strokeWidth="3" opacity="0.8">
        <circle cx="1660" cy="250" r="120" />
        <circle cx="1660" cy="250" r="86" />
        <path d="M1660 110 V390 M1520 250 H1800" />
      </g>
      <path d="M1660 150 L1680 230 L1760 250 L1680 270 L1660 350 L1640 270 L1560 250 L1640 230Z" fill={tok('deco-3')} opacity="0.8" />
      <circle cx="1660" cy="250" r="8" fill={tok('art-sky')} stroke={tok('deco-3')} strokeWidth="3" />
      <g fill={tok('surface')} opacity="0.85">
        <ellipse cx="300" cy="220" rx="96" ry="30" />
        <ellipse cx="360" cy="198" rx="60" ry="30" />
        <ellipse cx="1120" cy="170" rx="80" ry="24" />
      </g>
      <path d="M0 720 L180 600 L300 680 L460 560 L640 700 L820 610 L1000 700 L1200 580 L1380 690 L1560 600 L1760 690 L1920 640 V1080 H0Z" fill={tok('deco-3')} opacity="0.75" />
      <path d="M440 580 L460 560 L482 584 L470 578 L458 590Z M1180 600 L1200 580 L1222 604 L1208 598 L1196 610Z M1540 618 L1560 600 L1580 622 L1568 616 L1556 626Z" fill={tok('surface')} />
    </g>
  );
}

/** Rolling hills, the dotted trail with a flag, round trees and two tents. */
function Hills() {
  return (
    <g>
      <path d="M0 800 C260 740 520 790 780 770 C1040 750 1240 810 1500 780 C1680 760 1820 760 1920 780 V1080 H0Z" fill={tok('art-ground')} />
      <path d="M0 900 C300 860 640 900 960 880 C1280 860 1600 900 1920 870 V1080 H0Z" fill={tok('deco-3')} opacity="0.55" />
      <path d="M120 1000 C340 930 520 990 760 920 C980 860 1180 940 1400 880 C1580 830 1720 860 1860 800" fill="none" stroke={tok('deco-2')} strokeWidth="6" strokeDasharray="4 18" strokeLinecap="round" />
      <path d="M1846 800 L1860 736" fill="none" stroke={tok('text-muted')} strokeWidth="4" strokeLinecap="round" />
      <path d="M1860 736 L1900 748 L1862 762Z" fill={tok('deco-2')} stroke={tok('text-muted')} strokeWidth="3" strokeLinejoin="round" />
      <path d="M560 812 L566 770" fill="none" stroke={tok('text-muted')} strokeWidth="3" strokeLinecap="round" />
      <path d="M566 770 L594 778 L566 788Z" fill={tok('deco-1')} />
      <g fill={tok('deco-1')}>
        <circle cx="90" cy="830" r="46" />
        <circle cx="150" cy="850" r="36" />
        <circle cx="1690" cy="830" r="42" />
        <circle cx="1750" cy="850" r="32" />
        <circle cx="620" cy="830" r="30" />
        <circle cx="1240" cy="812" r="26" />
      </g>
      <g fill={tok('surface')} opacity="0.25">
        <circle cx="76" cy="814" r="16" />
        <circle cx="1678" cy="816" r="14" />
        <circle cx="612" cy="820" r="10" />
      </g>
      <g fill={tok('text-muted')}>
        <rect x="84" y="866" width="12" height="40" />
        <rect x="1684" y="864" width="12" height="40" />
        <rect x="616" y="852" width="8" height="26" />
        <rect x="1236" y="830" width="8" height="22" />
      </g>
      <path d="M300 930 L360 840 L420 930Z" fill={tok('deco-2')} />
      <path d="M360 840 L372 930 H348Z" fill={tok('mascot-ink')} opacity="0.35" />
      <path d="M1300 900 L1350 830 L1400 900Z" fill={tok('deco-1')} />
      <path d="M1350 830 L1360 900 H1340Z" fill={tok('mascot-ink')} opacity="0.35" />
    </g>
  );
}

/** The map table along the bottom: wood, an unrolled map with a dotted route, a pin and a lens. */
function MapTable() {
  return (
    <g>
      <path d="M0 990 C320 975 640 1000 960 992 C1300 982 1600 1000 1920 986 V1080 H0Z" fill={tok('deco-3')} />
      <path d="M0 1022 H1920" stroke={tok('text-muted')} strokeWidth="2" opacity="0.25" />
      <path d="M0 1052 H1920" stroke={tok('text-muted')} strokeWidth="2" opacity="0.2" />
      <g transform="rotate(-4 260 1010)">
        <rect x="90" y="972" width="360" height="140" rx="6" fill={tok('surface')} stroke={tok('deco-3')} strokeWidth="4" />
        <path d="M120 1040 C170 1000 220 1060 270 1020 C320 984 360 1030 420 1000" fill="none" stroke={tok('deco-2')} strokeWidth="5" strokeDasharray="3 12" strokeLinecap="round" />
        <path d="M130 990 Q180 1006 210 986 M300 1060 Q350 1040 400 1064" fill="none" stroke={tok('deco-1')} strokeWidth="3" opacity="0.6" />
        <path d="M402 990 l10 -18 l10 18 l-10 -6z" fill={tok('deco-1')} />
      </g>
      <g transform="rotate(5 1660 1010)">
        <rect x="1480" y="976" width="340" height="130" rx="6" fill={tok('surface')} stroke={tok('deco-3')} strokeWidth="4" />
        <path d="M1510 1040 C1560 1010 1620 1050 1680 1016 C1730 990 1770 1020 1800 1000" fill="none" stroke={tok('deco-2')} strokeWidth="5" strokeDasharray="3 12" strokeLinecap="round" />
        <circle cx="1800" cy="1000" r="9" fill={tok('deco-2')} stroke={tok('text-muted')} strokeWidth="3" />
      </g>
      <circle cx="560" cy="1036" r="26" fill={tok('art-sky')} stroke={tok('text-muted')} strokeWidth="6" opacity="0.9" />
      <path d="M578 1054 L608 1080" stroke={tok('text-muted')} strokeWidth="9" strokeLinecap="round" />
    </g>
  );
}

/** Hills and the map table: the last layer is also the phone strip, so it carries the most. */
function Near() {
  return (
    <g>
      <Hills />
      <MapTable />
    </g>
  );
}

export const explorerScene: ThemeScene = {
  opacity: 1,
  smallScreens: 'bottomStrip',
  layers: [
    { Art: Far, viewBox: '0 0 1920 1080', fit: 'cover', anchor: 'bottom' },
    { Art: Near, viewBox: '0 0 1920 1080', fit: 'cover', anchor: 'bottom' },
  ],
};
