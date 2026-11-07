/**
 * Explorer theme art (original SVG): "Compy", a round compass explorer with a sun hat, on map paper.
 * All shapes use semantic tokens only.
 */
import type { ComponentType } from 'react';
import { Arms, Confetti, Face, Moon, Place, PoseExtras, Scene, Sparkles, Stars, Sun, tok } from '../art.tsx';
import type { IllustrationName, MascotProps } from '../types.ts';

export function ExplorerMascot({ pose }: MascotProps) {
  return (
    <g>
      <ellipse cx="50" cy="95" rx="26" ry="4" fill={tok('mascot-ink')} opacity="0.12" />
      <Arms pose={pose} left={[20, 60]} right={[80, 60]} />
      <circle cx="50" cy="60" r="33" fill={tok('mascot-body')} />
      {/* compass face on the belly */}
      <circle cx="50" cy="73" r="14" fill={tok('mascot-belly')} />
      <path d="M50 62 L53.5 73 L50 84 L46.5 73 Z" fill={tok('mascot-accent')} />
      <circle cx="50" cy="73" r="2" fill={tok('mascot-ink')} />
      {/* face */}
      <circle cx="40" cy="45" r="6" fill={tok('mascot-belly')} />
      <circle cx="60" cy="45" r="6" fill={tok('mascot-belly')} />
      <Face pose={pose} eyes={[[40, 45.5], [60, 45.5]]} mouth={[50, 54]} size={3} />
      <circle cx="33" cy="54" r="3.5" fill={tok('mascot-cheek')} opacity="0.35" />
      <circle cx="67" cy="54" r="3.5" fill={tok('mascot-cheek')} opacity="0.35" />
      {/* hat */}
      <path d="M20 31 Q50 20 80 31 L74 35 Q50 27 26 35 Z" fill={tok('mascot-accent')} />
      <path d="M33 31 Q50 6 67 31 Z" fill={tok('mascot-accent')} />
      <path d="M36 27 Q50 23 64 27" stroke={tok('mascot-belly')} strokeWidth="2" fill="none" />
      <PoseExtras pose={pose} at={pose === 'sleepy' ? [76, 18] : pose === 'thinking' ? [80, 26] : [86, 30]} />
    </g>
  );
}

const Mascot = ExplorerMascot;

/** Corner decoration: compass rose and a dotted trail. */
export function ExplorerDecoration() {
  return (
    <g fill="none" strokeLinecap="round">
      <circle cx="50" cy="50" r="30" stroke={tok('deco-1')} strokeWidth="2.5" />
      <path d="M50 14 L56 50 L50 86 L44 50 Z" fill={tok('deco-2')} />
      <path d="M14 50 L50 44 L86 50 L50 56 Z" fill={tok('deco-3')} />
      <path d="M5 95 Q30 70 55 88 T98 70" stroke={tok('deco-1')} strokeWidth="2" strokeDasharray="3 5" />
    </g>
  );
}

/** Background tile: faint contour lines of a map. */
export function ExplorerPattern() {
  return (
    <g fill="none" stroke={tok('pattern')} strokeWidth="1">
      <path d="M0 20 Q20 10 40 20 T80 20" />
      <path d="M0 48 Q20 38 40 48 T80 48" />
      <circle cx="62" cy="66" r="6" />
      <circle cx="62" cy="66" r="11" />
    </g>
  );
}

function Hills() {
  return (
    <g>
      <path d="M4 104 L48 64 L82 92 L118 56 L160 96 L196 76 V108 H4 Z" fill={tok('deco-3')} opacity="0.55" />
      <path d="M118 56 L128 66 L110 66 Z" fill={tok('surface')} />
    </g>
  );
}

function Trail({ d }: { d: string }) {
  return <path d={d} stroke={tok('deco-2')} strokeWidth="3" strokeDasharray="4 6" fill="none" strokeLinecap="round" />;
}

function Flag({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width="3" height="34" rx="1.5" fill={tok('mascot-ink')} />
      <path d={`M${x + 3} ${y + 2} L${x + 25} ${y + 8} L${x + 3} ${y + 15} Z`} fill={tok('deco-2')} />
    </g>
  );
}

function LockScreen() {
  return (
    <Scene>
      <Moon x={156} y={32} />
      <Stars points={[[30, 26], [62, 18], [98, 30], [128, 16]]} />
      {/* tent */}
      <path d="M24 106 L58 52 L92 106 Z" fill={tok('accent')} />
      <path d="M58 52 L66 106 L50 106 Z" fill={tok('accent-strong')} />
      <Place x={104} y={50} s={0.62}>
        <Mascot pose="sleepy" />
      </Place>
    </Scene>
  );
}

function EmptyState() {
  return (
    <Scene>
      {/* unrolled map with a dotted route and an X */}
      <path d="M30 34 L80 26 L120 36 L170 28 L170 96 L120 104 L80 94 L30 102 Z" fill={tok('surface')} stroke={tok('border')} strokeWidth="2" />
      <path d="M80 26 V94 M120 36 V104" stroke={tok('border')} strokeWidth="1.5" />
      <Trail d="M44 88 Q70 60 100 72 T150 46" />
      <path d="M146 40 l10 10 M156 40 l-10 10" stroke={tok('danger')} strokeWidth="3" strokeLinecap="round" />
      <Place x={6} y={70} s={0.5}>
        <Mascot pose="idle" />
      </Place>
    </Scene>
  );
}

function Threshold() {
  return (
    <Scene>
      {/* a signpost asking for a pause */}
      <rect x="132" y="40" width="5" height="66" rx="2" fill={tok('mascot-ink')} />
      <path d="M112 44 H166 L174 52 L166 60 H112 Z" fill={tok('deco-2')} />
      <path d="M100 66 H150 V82 H100 L92 74 Z" fill={tok('accent')} />
      <Place x={22} y={36} s={0.7}>
        <Mascot pose="thinking" />
      </Place>
    </Scene>
  );
}

function StartLesson() {
  return (
    <Scene>
      <Sun x={150} y={44} />
      <Hills />
      <Trail d="M20 126 Q70 96 110 112" />
      <Place x={58} y={42} s={0.68}>
        <Mascot pose="cheer" />
      </Place>
    </Scene>
  );
}

function EndLesson() {
  return (
    <Scene>
      <Sun x={40} y={36} r={11} />
      <Hills />
      <Flag x={116} y={24} />
      <Place x={128} y={58} s={0.56}>
        <Mascot pose="idle" />
      </Place>
    </Scene>
  );
}

function Celebration() {
  return (
    <Scene>
      {/* open treasure chest */}
      <rect x="112" y="76" width="56" height="30" rx="4" fill={tok('mascot-accent')} />
      <path d="M112 76 Q140 52 168 76 Z" fill={tok('deco-2')} />
      <rect x="136" y="80" width="8" height="10" rx="2" fill={tok('art-light')} />
      <Sparkles points={[[124, 50], [156, 44], [140, 34]]} size={5} />
      <Confetti x={20} y={14} w={160} />
      <Place x={22} y={34} s={0.72}>
        <Mascot pose="celebrate" />
      </Place>
    </Scene>
  );
}

export const explorerIllustrations: Record<IllustrationName, ComponentType> = {
  lockScreen: LockScreen,
  emptyState: EmptyState,
  threshold: Threshold,
  startLesson: StartLesson,
  endLesson: EndLesson,
  celebration: Celebration,
};
