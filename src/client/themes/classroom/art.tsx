/**
 * Colourful classroom theme art (original SVG): "Yıldız", a cheerful star, with books, pencils and a
 * board. All shapes use semantic tokens only.
 */
import type { ComponentType } from 'react';
import { Arms, Confetti, Face, Moon, Place, PoseExtras, Scene, Sparkles, Stars, Sun, tok } from '../art.tsx';
import type { IllustrationName, MascotProps } from '../types.ts';

export function ClassroomMascot({ pose }: MascotProps) {
  return (
    <g>
      <ellipse cx="50" cy="94" rx="24" ry="4" fill={tok('mascot-ink')} opacity="0.12" />
      <Arms pose={pose} left={[26, 58]} right={[74, 58]} colour="mascot-body" length={14} />
      <path
        d="M50 8 L61 36 L91 37 L67 55 L76 85 L50 68 L24 85 L33 55 L9 37 L39 36 Z"
        fill={tok('mascot-accent')}
        stroke={tok('mascot-body')}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <Face pose={pose} eyes={[[42, 46], [58, 46]]} mouth={[50, 56]} />
      <circle cx="36" cy="54" r="3.5" fill={tok('mascot-cheek')} opacity="0.4" />
      <circle cx="64" cy="54" r="3.5" fill={tok('mascot-cheek')} opacity="0.4" />
      <PoseExtras pose={pose} at={pose === 'sleepy' ? [76, 14] : pose === 'thinking' ? [80, 20] : [88, 26]} />
    </g>
  );
}

const Mascot = ClassroomMascot;

/** Corner decoration: simple bright shapes. */
export function ClassroomDecoration() {
  return (
    <g>
      <circle cx="25" cy="25" r="10" fill={tok('deco-1')} />
      <rect x="55" y="15" width="18" height="18" rx="3" fill={tok('deco-2')} transform="rotate(15 64 24)" />
      <path d="M30 60 L42 82 L18 82 Z" fill={tok('deco-3')} />
      <path d="M70 55 L74 66 L86 66 L76 73 L80 85 L70 78 L60 85 L64 73 L54 66 L66 66 Z" fill={tok('deco-2')} />
    </g>
  );
}

/** Background tile: dotted grid paper. */
export function ClassroomPattern() {
  return (
    <g fill={tok('pattern')}>
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="50" cy="10" r="1.6" />
      <circle cx="10" cy="50" r="1.6" />
      <circle cx="50" cy="50" r="1.6" />
    </g>
  );
}

function Book({ x, y, open = false }: { x: number; y: number; open?: boolean }) {
  return open ? (
    <g>
      <path d={`M${x} ${y} Q${x + 22} ${y - 8} ${x + 44} ${y} V${y + 26} Q${x + 22} ${y + 18} ${x} ${y + 26} Z`} fill={tok('surface')} stroke={tok('accent')} strokeWidth="2.5" />
      <path d={`M${x + 44} ${y} Q${x + 66} ${y - 8} ${x + 88} ${y} V${y + 26} Q${x + 66} ${y + 18} ${x + 44} ${y + 26} Z`} fill={tok('surface')} stroke={tok('accent')} strokeWidth="2.5" />
      <path d={`M${x + 10} ${y + 8} h24 M${x + 10} ${y + 14} h20 M${x + 54} ${y + 8} h24 M${x + 54} ${y + 14} h18`} stroke={tok('border')} strokeWidth="2" strokeLinecap="round" />
    </g>
  ) : (
    <g>
      <rect x={x} y={y} width="56" height="12" rx="3" fill={tok('deco-1')} />
      <rect x={x + 4} y={y - 12} width="52" height="12" rx="3" fill={tok('deco-3')} />
    </g>
  );
}

function Pencil({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`rotate(-30 ${x} ${y})`}>
      <rect x={x} y={y} width="48" height="8" rx="2" fill={tok('deco-2')} />
      <path d={`M${x + 48} ${y} L${x + 58} ${y + 4} L${x + 48} ${y + 8} Z`} fill={tok('mascot-ink')} opacity="0.7" />
    </g>
  );
}

function LockScreen() {
  return (
    <Scene>
      <Moon x={156} y={32} />
      <Stars points={[[30, 24], [64, 16], [100, 28]]} />
      <Book x={36} y={100} />
      <Place x={84} y={42} s={0.62}>
        <Mascot pose="sleepy" />
      </Place>
    </Scene>
  );
}

function EmptyState() {
  return (
    <Scene>
      {/* an empty board */}
      <rect x="92" y="26" width="92" height="60" rx="6" fill={tok('surface')} stroke={tok('accent')} strokeWidth="3" />
      <rect x="132" y="86" width="12" height="20" fill={tok('border')} />
      <Place x={14} y={40} s={0.64}>
        <Mascot pose="idle" />
      </Place>
    </Scene>
  );
}

function Threshold() {
  return (
    <Scene>
      {/* a calm bell */}
      <path d="M140 40 Q160 40 162 70 L168 82 H112 L118 70 Q120 40 140 40 Z" fill={tok('deco-2')} />
      <circle cx="140" cy="88" r="5" fill={tok('mascot-ink')} opacity="0.7" />
      <Place x={16} y={34} s={0.72}>
        <Mascot pose="thinking" />
      </Place>
    </Scene>
  );
}

function StartLesson() {
  return (
    <Scene>
      <Sun x={164} y={34} r={11} />
      <Book x={100} y={92} open />
      <Pencil x={30} y={110} />
      <Place x={22} y={20} s={0.66}>
        <Mascot pose="cheer" />
      </Place>
    </Scene>
  );
}

function EndLesson() {
  return (
    <Scene>
      {/* a board with three ticks */}
      <rect x="96" y="22" width="88" height="66" rx="6" fill={tok('surface')} stroke={tok('accent')} strokeWidth="3" />
      {[38, 54, 70].map((y) => (
        <g key={y}>
          <path d={`M106 ${y} l4 4 l8 -8`} stroke={tok('success')} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d={`M124 ${y} h48`} stroke={tok('border')} strokeWidth="3" strokeLinecap="round" />
        </g>
      ))}
      <Place x={14} y={40} s={0.64}>
        <Mascot pose="idle" />
      </Place>
    </Scene>
  );
}

function Celebration() {
  return (
    <Scene>
      <Sparkles points={[[130, 30], [160, 50], [176, 26], [140, 70]]} size={7} />
      <Confetti x={20} y={12} w={160} />
      <Place x={24} y={30} s={0.76}>
        <Mascot pose="celebrate" />
      </Place>
    </Scene>
  );
}

export const classroomIllustrations: Record<IllustrationName, ComponentType> = {
  lockScreen: LockScreen,
  emptyState: EmptyState,
  threshold: Threshold,
  startLesson: StartLesson,
  endLesson: EndLesson,
  celebration: Celebration,
};
