/**
 * Animal friends theme art (original SVG): "Fındık", a friendly fox cub, among leaves and paw prints.
 * All shapes use semantic tokens only.
 */
import type { ComponentType } from 'react';
import { Arms, Confetti, Face, mascotSlot, Moon, Place, PoseExtras, Scene, Sparkles, Stars, Sun, tok } from '../art.tsx';
import type { IllustrationName, MascotProps } from '../types.ts';

export function AnimalMascot({ pose }: MascotProps) {
  return (
    <g>
      <ellipse cx="50" cy="95" rx="26" ry="4" fill={tok('mascot-ink')} opacity="0.12" />
      {/* tail */}
      <path d="M66 86 Q90 80 88 62 Q80 74 64 78 Z" fill={tok('mascot-body')} />
      <path d="M84 66 Q88 62 88 62 Q87 70 82 74 Z" fill={tok('mascot-belly')} />
      <Arms pose={pose} left={[26, 70]} right={[74, 70]} length={14} />
      {/* ears */}
      <path d="M18 18 L36 34 L24 44 Z" fill={tok('mascot-body')} />
      <path d="M82 18 L64 34 L76 44 Z" fill={tok('mascot-body')} />
      <path d="M22 24 L32 34 L26 39 Z" fill={tok('mascot-belly')} />
      <path d="M78 24 L68 34 L74 39 Z" fill={tok('mascot-belly')} />
      {/* head */}
      <circle cx="50" cy="56" r="32" fill={tok('mascot-body')} />
      <path d="M26 62 Q50 92 74 62 Q62 70 50 70 Q38 70 26 62 Z" fill={tok('mascot-belly')} />
      <Face pose={pose} eyes={[[39, 52], [61, 52]]} mouth={[50, 74]} />
      <ellipse cx="50" cy="66" rx="4.5" ry="3.4" fill={tok('mascot-ink')} />
      <circle cx="32" cy="64" r="4" fill={tok('mascot-cheek')} opacity="0.35" />
      <circle cx="68" cy="64" r="4" fill={tok('mascot-cheek')} opacity="0.35" />
      {/* leaf on the head */}
      <path d="M50 24 Q62 14 70 22 Q60 30 50 24 Z" fill={tok('mascot-accent')} />
      <PoseExtras pose={pose} at={pose === 'sleepy' ? [78, 14] : pose === 'thinking' ? [80, 22] : [86, 30]} />
    </g>
  );
}

// The active theme's mascot in the illustrations (S17a, D-166); this theme's own where none is provided.
const Mascot = mascotSlot(AnimalMascot);

/** Corner decoration: paw prints and a leaf. */
export function AnimalDecoration() {
  return (
    <g>
      {[
        [30, 30],
        [55, 48],
        [35, 70],
      ].map(([x, y]) => (
        <Paw key={`${x}-${y}`} x={x!} y={y!} />
      ))}
      <path d="M70 10 Q95 20 88 45 Q70 35 70 10 Z" fill={tok('deco-1')} />
      <path d="M72 14 L86 40" stroke={tok('deco-3')} strokeWidth="1.5" />
    </g>
  );
}

function Paw({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g fill={tok('deco-2')} transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="6" rx="7" ry="6" />
      <circle cx="-7" cy="-3" r="2.8" />
      <circle cx="-2.5" cy="-7" r="2.8" />
      <circle cx="2.5" cy="-7" r="2.8" />
      <circle cx="7" cy="-3" r="2.8" />
    </g>
  );
}

/** Background tile: a tiny leaf and a paw print. */
export function AnimalPattern() {
  return (
    <g fill={tok('pattern')}>
      <path d="M12 20 Q22 10 30 18 Q20 26 12 20 Z" />
      <g transform="translate(58 58) scale(0.6)">
        <ellipse cx="0" cy="6" rx="7" ry="6" />
        <circle cx="-7" cy="-3" r="2.8" />
        <circle cx="-2.5" cy="-7" r="2.8" />
        <circle cx="2.5" cy="-7" r="2.8" />
        <circle cx="7" cy="-3" r="2.8" />
      </g>
    </g>
  );
}

function Tree({ x }: { x: number }) {
  return (
    <g>
      <rect x={x - 4} y="62" width="8" height="44" rx="3" fill={tok('mascot-ink')} opacity="0.55" />
      <circle cx={x} cy="56" r="22" fill={tok('deco-1')} />
      <circle cx={x - 14} cy="66" r="12" fill={tok('deco-1')} />
      <circle cx={x + 14} cy="66" r="12" fill={tok('deco-1')} />
    </g>
  );
}

function LockScreen() {
  return (
    <Scene>
      <Moon x={160} y={30} />
      <Stars points={[[28, 22], [60, 16], [96, 26], [130, 14]]} />
      {/* a log to sleep on */}
      <rect x="40" y="96" width="120" height="16" rx="8" fill={tok('mascot-accent')} />
      <Place x={58} y={34} s={0.72}>
        <Mascot pose="sleepy" />
      </Place>
    </Scene>
  );
}

function EmptyState() {
  return (
    <Scene>
      <Paw x={150} y={112} s={0.8} />
      <Paw x={126} y={96} s={0.8} />
      <Paw x={150} y={80} s={0.8} />
      <Tree x={162} />
      <Place x={24} y={40} s={0.66}>
        <Mascot pose="idle" />
      </Place>
    </Scene>
  );
}

function Threshold() {
  return (
    <Scene>
      <Tree x={160} />
      {/* a big calm leaf */}
      <path d="M100 96 Q120 60 150 70 Q140 104 100 96 Z" fill={tok('deco-1')} />
      <path d="M104 94 Q126 80 146 72" stroke={tok('mascot-belly')} strokeWidth="2" fill="none" />
      <Place x={14} y={34} s={0.72}>
        <Mascot pose="thinking" />
      </Place>
    </Scene>
  );
}

function StartLesson() {
  return (
    <Scene>
      <Sun x={40} y={36} />
      <Tree x={160} />
      <Place x={64} y={38} s={0.7}>
        <Mascot pose="cheer" />
      </Place>
    </Scene>
  );
}

function EndLesson() {
  return (
    <Scene>
      <Sun x={150} y={40} r={11} />
      <Tree x={40} />
      <Place x={86} y={44} s={0.64}>
        <Mascot pose="idle" />
      </Place>
    </Scene>
  );
}

function Celebration() {
  return (
    <Scene>
      {/* balloons */}
      {[
        [140, 40, 'deco-2'],
        [162, 30, 'deco-3'],
        [176, 50, 'deco-1'],
      ].map(([x, y, c]) => (
        <g key={`${x}`}>
          <path d={`M${x} ${(y as number) + 14} Q${(x as number) - 4} ${(y as number) + 40} ${(x as number) - 10} ${(y as number) + 60}`} stroke={tok('mascot-ink')} strokeWidth="1" fill="none" opacity="0.5" />
          <ellipse cx={x} cy={y} rx="10" ry="13" fill={tok(c as 'deco-1')} />
        </g>
      ))}
      <Sparkles points={[[120, 30], [110, 60]]} size={5} />
      <Confetti x={14} y={12} w={110} />
      <Place x={24} y={34} s={0.74}>
        <Mascot pose="celebrate" />
      </Place>
    </Scene>
  );
}

export const animalIllustrations: Record<IllustrationName, ComponentType> = {
  lockScreen: LockScreen,
  emptyState: EmptyState,
  threshold: Threshold,
  startLesson: StartLesson,
  endLesson: EndLesson,
  celebration: Celebration,
};
