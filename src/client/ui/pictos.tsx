/**
 * Picture icons for the classroom (S13a): lesson topic icons (TOPIC_ICONS) and grouping option icons
 * (OPTION_ICONS: lion, eagle, …). Simple line drawings in currentColor, so they follow the theme and
 * contrast settings; always shown next to text (aria-hidden). Unknown keys (older data such as an
 * emoji icon from before S13a) render as text.
 */
import type { ReactNode } from 'react';

function Picto({ children, size = '1.5em' }: { children: ReactNode; size?: string }) {
  return (
    <svg className="cc-picto" width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const TOPIC: Record<string, ReactNode> = {
  book: (
    <>
      <path d="M4 7c4-2 8-2 12 1v18c-4-3-8-3-12-1z" />
      <path d="M28 7c-4-2-8-2-12 1v18c4-3 8-3 12-1z" />
    </>
  ),
  pen: (
    <>
      <path d="M6 26l3-9L22 4l6 6-13 13z" />
      <path d="M19 7l6 6M6 26l5-2" />
    </>
  ),
  grammar: (
    <>
      <rect x="4" y="6" width="24" height="20" rx="3" />
      <path d="M9 21l4-10 4 10M10.5 18h5M20 12h4M20 16h4M20 20h3" />
    </>
  ),
  words: (
    <>
      <rect x="3" y="8" width="11" height="9" rx="2" />
      <rect x="18" y="15" width="11" height="9" rx="2" />
      <path d="M6 12.5h5M21 19.5h5M14 12.5c3 0 4 2 4 5" />
    </>
  ),
  ear: (
    <>
      <path d="M10 13a7 7 0 1 1 13 3c-1.5 2.5-4 3-4 6a4 4 0 0 1-7 2" />
      <path d="M14 13a3 3 0 1 1 5 2" />
    </>
  ),
  speech: (
    <>
      <path d="M5 7h22v14H14l-6 5v-5H5z" />
      <path d="M10 12h12M10 16h8" />
    </>
  ),
  letters: (
    <>
      <path d="M4 24l5-15 5 15M6 19h6" />
      <path d="M18 9h5a3 3 0 0 1 0 6h-5zM18 15h6a3.5 3.5 0 0 1 0 7h-6z" />
    </>
  ),
  star: <path d="M16 4l3.6 7.6 8.4 1-6.2 5.8 1.6 8.3L16 22.6l-7.4 4.1 1.6-8.3L4 12.6l8.4-1z" />,
  music: (
    <>
      <path d="M12 23V7l14-3v16" />
      <circle cx="9" cy="23" r="3" />
      <circle cx="23" cy="20" r="3" />
    </>
  ),
  game: (
    <>
      <rect x="3" y="10" width="26" height="14" rx="7" />
      <path d="M10 14v6M7 17h6" />
      <circle cx="21" cy="15.5" r="1.2" />
      <circle cx="24" cy="18.5" r="1.2" />
    </>
  ),
  puzzle: <path d="M6 6h7a3 3 0 1 1 6 0h7v7a3 3 0 1 0 0 6v7h-7a3 3 0 1 0-6 0H6v-7a3 3 0 1 1 0-6z" />,
  paint: (
    <>
      <path d="M16 4a12 12 0 1 0 0 24c2 0 2-2 1-3s-1-3 1-3h4a6 6 0 0 0 6-6c0-7-5-12-12-12z" />
      <circle cx="10" cy="14" r="1.6" />
      <circle cx="15" cy="9" r="1.6" />
      <circle cx="21" cy="11" r="1.6" />
    </>
  ),
};

const OPTION: Record<string, ReactNode> = {
  lion: (
    <>
      <circle cx="16" cy="17" r="7" />
      <path d="M16 4l3 3 4-1 1 4 4 2-2 4 2 4-4 2-1 4-4-1-3 3-3-3-4 1-1-4-4-2 2-4-2-4 4-2 1-4 4 1z" />
      <path d="M13.5 16h.01M18.5 16h.01M14.5 20c1 1 2 1 3 0" />
    </>
  ),
  eagle: (
    <>
      <path d="M3 13c5-1 8 1 10 4 1-5 3-8 6-9 3 0 5 1 6 3l4 1-4 2c0 6-4 10-10 11-3-3-5-6-5-9-2 0-5 0-7-3z" />
      <path d="M23.5 11.5h.01" />
    </>
  ),
  dolphin: (
    <>
      <path d="M3 20c4-9 12-13 20-11l3-4 1 6c2 2 2 5 1 8l-4-1c-4 3-10 4-15 2l-4 4z" />
      <path d="M20 13h.01" />
    </>
  ),
  tiger: (
    <>
      <path d="M8 7l3 3h10l3-3 1 7c0 7-4 12-9 12s-9-5-9-12z" />
      <path d="M12 16h.01M20 16h.01M14 21c1.3 1 2.7 1 4 0M16 10v3M10 18l-3-1M22 18l3-1" />
    </>
  ),
  owl: (
    <>
      <path d="M8 6l3 3h10l3-3v13a8 8 0 0 1-16 0z" />
      <circle cx="12.5" cy="15" r="2.5" />
      <circle cx="19.5" cy="15" r="2.5" />
      <path d="M15 19l1 2 1-2" />
    </>
  ),
  fox: (
    <>
      <path d="M5 6l6 6h10l6-6-2 10-9 10-9-10z" />
      <path d="M12.5 16h.01M19.5 16h.01M15 21h2" />
    </>
  ),
  turtle: (
    <>
      <path d="M5 21c0-7 5-12 11-12s11 5 11 12z" />
      <path d="M11 21l2-6h6l2 6M16 9v6M27 19l3-1M8 21l-2 4M24 21l2 4" />
    </>
  ),
  bee: (
    <>
      <ellipse cx="16" cy="19" rx="7" ry="8" />
      <path d="M9.5 16h13M9.5 21h13M12 10c-3-4-8-3-8 0s4 3 8 2M20 10c3-4 8-3 8 0s-4 3-8 2" />
    </>
  ),
};

export function TopicPicto({ icon, size }: { icon: string | null | undefined; size?: string }) {
  return <Picto size={size}>{TOPIC[icon ?? 'book'] ?? TOPIC.book}</Picto>;
}

export function OptionPicto({ icon, size }: { icon: string | null | undefined; size?: string }) {
  const art = icon ? OPTION[icon] : undefined;
  if (art) return <Picto size={size}>{art}</Picto>;
  return icon ? (
    <span className="cc-picto cc-picto--text" aria-hidden="true">
      {icon}
    </span>
  ) : null;
}

/** "Group N" badge icon: the number in a circle ('g1'…); anything else (older emoji names) as text. */
export function GroupPicto({ icon, size }: { icon: string | null | undefined; size?: string }) {
  const n = /^g(\d+)$/.exec(icon ?? '')?.[1];
  if (n) {
    return (
      <svg className="cc-picto cc-picto--num" width={size ?? '1.6em'} height={size ?? '1.6em'} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <circle cx="16" cy="16" r="14" fill="currentColor" />
        <text x="16" y="21.5" textAnchor="middle" fontSize="16" fontWeight="800" fill="var(--cc-surface)">
          {n}
        </text>
      </svg>
    );
  }
  return icon ? (
    <span className="cc-picto cc-picto--text" aria-hidden="true">
      {icon}
    </span>
  ) : null;
}
