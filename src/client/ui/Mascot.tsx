/**
 * Original, simple SVG mascots and decorations per theme (THM-1/2). Colours come only from theme
 * tokens. Mascots are static; `animate` plays ONE gentle hop, only when the class animation switch is
 * on and the OS does not ask for reduced motion (THM-5). Decorative: aria-hidden unless labelled.
 */
import { createContext, useContext } from 'react';
import { motionAllowed, useDisplay, type ThemeName } from '../lib/display.ts';

/** Overrides the document theme for a subtree (previews, the component catalog). */
export const ThemeScope = createContext<ThemeName | null>(null);

const fill = (token: string) => `var(--cc-${token})`;

function ExplorerMascot() {
  // "Compy": a round compass explorer with a little hat.
  return (
    <>
      <ellipse cx="50" cy="94" rx="26" ry="4" fill={fill('mascot-ink')} opacity="0.12" />
      <circle cx="50" cy="58" r="34" fill={fill('mascot-body')} />
      <circle cx="50" cy="62" r="22" fill={fill('mascot-belly')} />
      <path d="M50 46 L55 62 L50 78 L45 62 Z" fill={fill('mascot-accent')} />
      <circle cx="50" cy="62" r="3" fill={fill('mascot-ink')} />
      <circle cx="39" cy="40" r="4.5" fill={fill('mascot-belly')} />
      <circle cx="61" cy="40" r="4.5" fill={fill('mascot-belly')} />
      <circle cx="39.8" cy="40.8" r="2.2" fill={fill('mascot-ink')} />
      <circle cx="61.8" cy="40.8" r="2.2" fill={fill('mascot-ink')} />
      <path d="M22 26 Q50 14 78 26 L72 30 Q50 22 28 30 Z" fill={fill('mascot-accent')} />
      <path d="M34 26 Q50 2 66 26 Z" fill={fill('mascot-accent')} />
    </>
  );
}

function AnimalMascot() {
  // "Fındık": a friendly fox cub.
  return (
    <>
      <ellipse cx="50" cy="94" rx="26" ry="4" fill={fill('mascot-ink')} opacity="0.12" />
      <path d="M18 18 L36 34 L24 44 Z" fill={fill('mascot-body')} />
      <path d="M82 18 L64 34 L76 44 Z" fill={fill('mascot-body')} />
      <path d="M22 24 L32 34 L26 39 Z" fill={fill('mascot-belly')} />
      <path d="M78 24 L68 34 L74 39 Z" fill={fill('mascot-belly')} />
      <circle cx="50" cy="56" r="32" fill={fill('mascot-body')} />
      <path d="M26 62 Q50 92 74 62 Q62 70 50 70 Q38 70 26 62 Z" fill={fill('mascot-belly')} />
      <circle cx="39" cy="52" r="3.4" fill={fill('mascot-ink')} />
      <circle cx="61" cy="52" r="3.4" fill={fill('mascot-ink')} />
      <ellipse cx="50" cy="66" rx="4.5" ry="3.4" fill={fill('mascot-ink')} />
      <path d="M45 73 Q50 77 55 73" stroke={fill('mascot-ink')} strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="32" cy="64" r="4" fill={fill('mascot-cheek')} opacity="0.35" />
      <circle cx="68" cy="64" r="4" fill={fill('mascot-cheek')} opacity="0.35" />
      <path d="M62 86 Q74 80 80 88" stroke={fill('mascot-accent')} strokeWidth="5" fill="none" strokeLinecap="round" />
    </>
  );
}

function ClassroomMascot() {
  // "Yıldız": a cheerful star.
  return (
    <>
      <ellipse cx="50" cy="94" rx="24" ry="4" fill={fill('mascot-ink')} opacity="0.12" />
      <path
        d="M50 8 L61 36 L91 37 L67 55 L76 85 L50 68 L24 85 L33 55 L9 37 L39 36 Z"
        fill={fill('mascot-accent')}
        stroke={fill('mascot-body')}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <circle cx="42" cy="46" r="3.4" fill={fill('mascot-ink')} />
      <circle cx="58" cy="46" r="3.4" fill={fill('mascot-ink')} />
      <path d="M42 56 Q50 63 58 56" stroke={fill('mascot-ink')} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <circle cx="36" cy="54" r="3.5" fill={fill('mascot-cheek')} opacity="0.4" />
      <circle cx="64" cy="54" r="3.5" fill={fill('mascot-cheek')} opacity="0.4" />
    </>
  );
}

export function Mascot({ theme, size = 120, animate = false, label }: { theme?: ThemeName; size?: number; animate?: boolean; label?: string }) {
  const display = useDisplay();
  const scoped = useContext(ThemeScope);
  const th = theme ?? scoped ?? display.theme;
  const play = animate && motionAllowed(display);
  return (
    <svg
      className="cc-mascot"
      data-animate={play ? 'true' : 'false'}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      {th === 'explorer' ? <ExplorerMascot /> : th === 'animals' ? <AnimalMascot /> : <ClassroomMascot />}
    </svg>
  );
}

/** Subtle corner illustration per theme; never behind text that must be read. */
export function ThemeDecoration({ theme, corner = 'top-right', size = 220 }: { theme?: ThemeName; corner?: 'top-right' | 'bottom-left'; size?: number }) {
  const display = useDisplay();
  const scoped = useContext(ThemeScope);
  const th = theme ?? scoped ?? display.theme;
  const pos = corner === 'top-right' ? { top: -size * 0.15, right: -size * 0.15 } : { bottom: -size * 0.15, left: -size * 0.15 };
  return (
    <svg className="cc-deco" style={pos} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {th === 'explorer' ? (
        <g fill="none" strokeLinecap="round">
          <circle cx="50" cy="50" r="30" stroke={fill('deco-1')} strokeWidth="2.5" />
          <path d="M50 14 L56 50 L50 86 L44 50 Z" fill={fill('deco-2')} />
          <path d="M14 50 L50 44 L86 50 L50 56 Z" fill={fill('deco-3')} />
          <path d="M5 95 Q30 70 55 88 T98 70" stroke={fill('deco-1')} strokeWidth="2" strokeDasharray="3 5" />
        </g>
      ) : th === 'animals' ? (
        <g>
          {[
            [30, 30],
            [55, 48],
            [35, 70],
          ].map(([x, y]) => (
            <g key={`${x}-${y}`} fill={fill('deco-2')}>
              <ellipse cx={x} cy={y! + 6} rx="7" ry="6" />
              <circle cx={x! - 7} cy={y! - 3} r="2.8" />
              <circle cx={x! - 2.5} cy={y! - 7} r="2.8" />
              <circle cx={x! + 2.5} cy={y! - 7} r="2.8" />
              <circle cx={x! + 7} cy={y! - 3} r="2.8" />
            </g>
          ))}
          <path d="M70 10 Q95 20 88 45 Q70 35 70 10 Z" fill={fill('deco-1')} />
          <path d="M72 14 L86 40" stroke={fill('deco-3')} strokeWidth="1.5" />
        </g>
      ) : (
        <g>
          <circle cx="25" cy="25" r="10" fill={fill('deco-1')} />
          <rect x="55" y="15" width="18" height="18" rx="3" fill={fill('deco-2')} transform="rotate(15 64 24)" />
          <path d="M30 60 L42 82 L18 82 Z" fill={fill('deco-3')} />
          <path d="M70 55 L74 66 L86 66 L76 73 L80 85 L70 78 L60 85 L64 73 L54 66 L66 66 Z" fill={fill('deco-2')} />
        </g>
      )}
    </svg>
  );
}
