/**
 * Badge icons (S13c item 1, D-121): original line glyphs drawn for Class Compass on a 24×24 grid,
 * one short path each, stroked with the theme's badge ink (`--cc-badge-ink`). The badge frame shows
 * the tier by SHAPE (bronze circle, silver hexagon, gold rosette, plain rounded square) and the tier is
 * always written next to it too (never colour alone).
 */
import type { ReactNode } from 'react';
import type { AchievementTier, BadgeIcon } from '../../shared/achievements.ts';

/** Every key of BADGE_ICONS has a glyph (type-checked by the Record). */
export const GLYPHS: Record<BadgeIcon, string> = {
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  stars: 'M9 4l1.8 3.7 4 .6-2.9 2.8.7 4L9 13.2l-3.6 1.9.7-4-2.9-2.8 4-.6zM17.5 13l1 2 2.2.3-1.6 1.6.4 2.2-2-1-2 1 .4-2.2-1.6-1.6 2.2-.3z',
  rocket: 'M12 3c3 2 4.5 5.5 4 10l-2 3h-4l-2-3c-.5-4.5 1-8 4-10zM12 9.5a1.5 1.5 0 1 0 0 .01M8 13l-3 3 3 1M16 13l3 3-3 1M10.5 19l1.5 2 1.5-2',
  book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10M9 8h5',
  books: 'M4 5h4v15H4zM9 5h4v15H9zM14.5 6l3.8-1 3.2 14.4-3.8 1z',
  bookOpen: 'M3 6c3-1 6-1 9 1 3-2 6-2 9-1v13c-3-1-6-1-9 1-3-2-6-2-9-1zM12 7v13',
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z',
  pencil: 'M15 4l5 5L9 20H4v-5zM13 6l5 5',
  pen: 'M14 3l7 7-9 9-5 1 1-5zM5 21l3-3M12 5l7 7',
  speech: 'M4 5h16v11H10l-5 4v-4H4zM8 9h8M8 12h5',
  speechTwo: 'M3 4h11v8H8l-3 3v-3H3zM10 14v2h6l3 3v-3h2V8h-4',
  medal: 'M8 3l4 7 4-7M12 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 14v4',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8M9 18h6',
  cup: 'M6 6h12l-1.5 11a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2zM6 9h12M9 3c0 1 1 1 1 2M13 3c0 1 1 1 1 2',
  ribbon: 'M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM9 12l-3 9 3-2 2 2 1-7M15 12l3 9-3-2-2 2-1-7',
  crown: 'M4 18l-1-11 5 4 4-6 4 6 5-4-1 11zM4 21h16',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z',
  heartHands: 'M12 12s-4-2.5-4-5.5a2.3 2.3 0 0 1 4-1.4 2.3 2.3 0 0 1 4 1.4C16 9.5 12 12 12 12zM3 14l4 3h5M21 14l-4 3h-5M5 20h14',
  bulb: 'M9 17h6M10 20h4M12 3a6 6 0 0 1 3.5 10.9V16h-7v-2.1A6 6 0 0 1 12 3z',
  musicNote: 'M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM9 18V5l10-2v12M19 15a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  musicNotes: 'M7 19a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 7 19zM7 19V7l6-1.5M13 5.5v9.5M13 15a2.5 2.5 0 1 1-2.5-2.5M16 6h5M18.5 3.5v5',
  planet: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM3 15c3 1.5 13 -2 18 -6M5 18c-3-1 0-4 5-6',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  comet: 'M15 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 9L3 3M11 12L2 9M13 7L8 2',
  cloud: 'M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 18z',
  rainbow: 'M3 18a9 9 0 0 1 18 0M6.5 18a5.5 5.5 0 0 1 11 0M10 18a2 2 0 0 1 4 0',
  umbrella: 'M3 12a9 9 0 0 1 18 0zM12 12v7a2 2 0 0 0 4 0M12 3v1',
  tree: 'M12 3l6 8h-3l4 5H5l4-5H6zM12 16v5',
  flower: 'M12 12a2 2 0 1 0 0-.01M12 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM12 14a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM10 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM14 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0z',
  leaf: 'M5 19C5 10 11 4 20 4c0 9-6 15-15 15zM5 19l8-8',
  seedling: 'M12 21v-9M12 12C12 8 9 6 4 6c0 4 3 6 8 6zM12 10c0-3 2-5 7-5 0 3-2 5-7 5zM8 21h8',
  mountain: 'M2 20l7-12 4 6 2-3 7 9zM8 10l1 1.5L10.5 10',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  magnifier: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L21 21',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  check: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',
  thumbsUp: 'M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7',
  clap: 'M8 13l5-5a1.5 1.5 0 0 1 2 2l-4 4M10 15l5-5a1.5 1.5 0 0 1 2 2l-5 5a5 5 0 0 1-7-7l3-3a1.5 1.5 0 0 1 2 2M17 3l-1 2M20 6l-2 1M21 10h-2',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14c2 2.5 6 2.5 8 0M9 9.5h.01M15 9.5h.01',
  handshake: 'M2 12l4-4 4 2 3-2 4 1 5 3M6 16l3 3 2-1 2 2 2-1 2 1 3-4M2 12l4 4M22 12l-4 4M10 10l4 4',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7C9 7 7.5 3 10 3s2 4 2 4zM12 7c3 0 4.5-4 2-4s-2 4-2 4z',
  balloon: 'M12 15c-3.5 0-6-3-6-6.5a6 6 0 0 1 12 0C18 12 15.5 15 12 15zM12 15l-1 2h2zM12 17c0 2-2 2-2 4',
  cake: 'M4 21V13h16v8zM4 16c2 1.5 4-1.5 6 0s4-1.5 6 0 4 0 4 0M8 13V9M12 13V9M16 13V9M8 6v1M12 6v1M16 6v1',
  kite: 'M12 2l6 7-6 9-6-9zM6 9h12M12 2v16M12 18c-1 2 1 2 0 4',
  ball: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7l4 3-1.5 4.5h-5L8 10zM12 7V3M16 10l4-1M14.5 14.5l2.5 3.5M9.5 14.5L7 18M8 10L4 9',
  bike: 'M5.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM18.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5.5 14.5L9 8h6l3.5 6.5M9 8l3 6.5h-6.5M14 5h3',
  boat: 'M3 16h18l-3 4H6zM12 3v13M12 4l6 9h-6M12 6l-5 7h5',
  plane: 'M21 12l-8-2-4-7H7l2 7-5 1-2-2H1l1 4-1 4h1l2-2 5 1-2 7h2l4-7 8-2z',
  train: 'M6 3h12a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM4 10h16M8 14h.01M16 14h.01M7 18l-2 3M17 18l2 3',
  robot: 'M5 8h14v11H5zM12 4v4M12 3h.01M9 12h.01M15 12h.01M9 16h6M3 12v3M21 12v3',
  dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  puzzle: 'M4 7h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4h-4a2 2 0 1 0-4 0H4v-4a2 2 0 1 0 0-4z',
  paint: 'M4 4h12v5H4zM16 6.5h3v5h-7v3M11 14.5h2v6.5h-2z',
  brush: 'M20 3l-9 9M11 12l2 2M13 14c0 3-2 6-8 6 1-1 1-3 1-4a3.5 3.5 0 0 1 5-4',
  palette: 'M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-2 0-3h2.5A4.5 4.5 0 0 0 21 11.5C21 6.8 17 3 12 3zM7.5 11h.01M10 7h.01M15 7h.01M17 11h.01',
  camera: 'M3 8h4l2-3h6l2 3h4v11H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  microphone: 'M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
  notebook: 'M6 3h12v18H6zM3 7h3M3 11h3M3 15h3M10 7h5M10 11h5',
  letterA: 'M5 20L12 4l7 16M8 14h8',
  abc: 'M2 17l3-9 3 9M3 14h4M10 8v9h2.5a2 2 0 0 0 0-4.5H10M10 12.5h2a2 2 0 0 0 0-4.5h-2M21 9.5a3 3 0 1 0 0 5',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  flask: 'M9 3h6M10 3v6l-5 10a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2l-5-10V3M7 15h10',
  magnet: 'M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0zM5 8h4M15 8h4',
  anchor: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 8v13M5 13a7 7 0 0 0 14 0M3 13h4M17 13h4M9 11h6',
  feather: 'M20 4C10 4 5 10 5 19l3-3h5c4-3 7-7 7-12zM5 19L15 9M9 15h5',
  wand: 'M4 20L15 9M15 9l2-2M17 3v2M21 7h-2M19.5 4.5l-1.5 1.5M13 5l1 1M18 11l1 1',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM19 3v3M17.5 4.5h3M5 17v3M3.5 18.5h3',
  gem: 'M6 4h12l3 5-9 11L3 9zM3 9h18M9 4l3 16M15 4l-3 16',
  key: 'M8 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 11h9M18 11v3M15 11v2',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4M12 3v2',
  lantern: 'M9 3h6M12 3v2M8 7h8l1 2v8l-1 2H8l-1-2V9zM7 9h10M7 17h10M12 11v4',
  telescope: 'M3 11l13-5 2 5-13 5zM14 13l3 8M10 14l-3 7M16 6l1-2 4 1-1 3',
  hourglass: 'M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2',
  cat: 'M5 9V3l4 3h6l4-3v6a8 8 0 0 1-14 0zM9 11h.01M15 11h.01M10 14l2 1 2-1M3 13h3M18 13h3',
  dog: 'M6 6l-3 6 3 2M18 6l3 6-3 2M6 6h12v7a6 6 0 0 1-12 0zM10 10h.01M14 10h.01M11 14h2',
  owl: 'M6 4l3 3h6l3-3v11a6 6 0 0 1-12 0zM9.5 11a2 2 0 1 0 0-.01M14.5 11a2 2 0 1 0 0-.01M11 14l1 1.5 1-1.5',
  fox: 'M3 4l4 4h10l4-4-2 9-7 7-7-7zM9 12h.01M15 12h.01M11 16h2',
  bear: 'M7 7a2.5 2.5 0 1 1-2-3M17 7a2.5 2.5 0 1 0 2-3M12 20a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 11h.01M14 11h.01M10.5 15c1 1 2 1 3 0',
  rabbit: 'M9 9V3c-2 0-2 6 0 6M15 9V3c2 0 2 6 0 6M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM10 14h.01M14 14h.01M11 17h2',
  lion: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10.5 11h.01M13.5 11h.01M11 14h2',
  elephant: 'M6 8a5 5 0 0 1 10 0v6c0 2-1 3-1 5M6 8a3 3 0 1 0-1 6M16 8a3 3 0 1 1 1 6M11 13v5a2 2 0 0 1-4 0M9 9h.01',
  fish: 'M3 12c3-4 8-5 12-3l5-3v12l-5-3c-4 2-9 1-12-3zM8 11h.01',
  turtle: 'M4 15a8 6 0 0 1 16 0zM4 15h16M7 15v3M17 15v3M20 13h2M8 11l2 2h4l2-2M12 9v4',
  butterfly: 'M12 7v13M12 9C9 3 3 4 4 9s5 4 8 3M12 9c3-6 9-5 8 0s-5 4-8 3M12 13c-3 0-7 1-6 4s5 2 6-1M12 13c3 0 7 1 6 4s-5 2-6-1M10 4l2 3 2-3',
  bee: 'M8 9h8a4 4 0 0 1 0 8H8a4 4 0 0 1 0-8zM11 9v8M14 9v8M10 9C8 5 5 5 6 8M14 9c2-4 5-4 4-1M20 13h2',
  ladder: 'M7 3v18M17 3v18M7 7h10M7 11h10M7 15h10M7 19h10',
  mask: 'M3 8c4-2 14-2 18 0 0 6-3 9-6 9-1.5 0-2-2-3-2s-1.5 2-3 2c-3 0-6-3-6-9zM8 11h2M14 11h2',
  apple: 'M12 7c-2-2-7-1-7 5s3 9 5 9c1 0 1.5-.5 2-.5s1 .5 2 .5c2 0 5-3 5-9s-5-7-7-5zM12 7c0-2 1-4 3-4',
};

const FRAME: Record<AchievementTier, ReactNode> = {
  // Bronze: a circle.
  bronze: <circle cx="24" cy="24" r="21" />,
  // Silver: a hexagon.
  silver: <path d="M24 2l19 11v22L24 46 5 35V13z" />,
  // Gold: a rosette (twelve rounded points).
  gold: <path d={rosette()} />,
  // Plain (no tier): a rounded square.
  none: <rect x="4" y="4" width="40" height="40" rx="10" />,
};

function rosette(): string {
  const pts: string[] = [];
  for (let i = 0; i < 24; i++) {
    const r = i % 2 ? 19 : 23;
    const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
    pts.push(`${(24 + r * Math.cos(a)).toFixed(2)} ${(24 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}z`;
}

const FILL: Record<AchievementTier, string> = { bronze: 'badge-bronze', silver: 'badge-silver', gold: 'badge-gold', none: 'badge-plain' };

/** A badge: tier frame (shape) + glyph. Decorative; the badge name and tier label are written beside it. */
export function BadgeArt({ icon, tier, size = 48, locked = false }: { icon: BadgeIcon | string; tier: AchievementTier; size?: number | string; locked?: boolean }) {
  const d = GLYPHS[icon as BadgeIcon] ?? GLYPHS.star;
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={`cc-badge-art${locked ? ' cc-badge-art--locked' : ''}`} aria-hidden="true" focusable="false" data-tier={tier}>
      <g fill={`var(--cc-${FILL[tier]})`} stroke="var(--cc-badge-ink)" strokeWidth="1.5">
        {FRAME[tier]}
      </g>
      <g transform="translate(12 12)" fill="none" stroke="var(--cc-badge-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </g>
    </svg>
  );
}
