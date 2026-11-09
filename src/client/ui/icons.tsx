/**
 * Small inline icon set (stroke = currentColor, so icons follow text colour in every theme).
 * Icons always accompany text or an aria-label; they are decorative (aria-hidden).
 */
import type { ReactNode, SVGProps } from 'react';

function Icon({ children, ...p }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg className="cc-icon" width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}>
      {children}
    </svg>
  );
}

export const IconLock = () => (
  <Icon>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Icon>
);
export const IconUnlock = () => (
  <Icon>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 7.5-2" />
  </Icon>
);
export const IconCheck = () => (
  <Icon>
    <path d="M4 12.5l5 5L20 6.5" />
  </Icon>
);
export const IconCloudOff = () => (
  <Icon>
    <path d="M3 3l18 18" />
    <path d="M7 18h10.5a3.5 3.5 0 0 0 .8-6.9A6 6 0 0 0 8.4 7.6" />
    <path d="M5.2 9.4A4.5 4.5 0 0 0 7 18" />
  </Icon>
);
export const IconAlert = () => (
  <Icon>
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4.5" />
    <path d="M12 17.5v.01" />
  </Icon>
);
export const IconSync = () => (
  <Icon>
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
    <path d="M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
    <path d="M20 20v-4h-4" />
  </Icon>
);
export const IconPlus = () => (
  <Icon strokeWidth={3}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const IconUndo = () => (
  <Icon>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Icon>
);
export const IconX = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const IconUser = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);
export const IconUsers = () => (
  <Icon>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
    <path d="M18 14a6.5 6.5 0 0 1 3.5 6" />
  </Icon>
);
export const IconSettings = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </Icon>
);
export const IconBack = () => (
  <Icon>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);
export const IconHome = () => (
  <Icon>
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v10h14V10" />
  </Icon>
);
export const IconBoard = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Icon>
);
export const IconBook = () => (
  <Icon>
    <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
    <path d="M4 5v16" />
  </Icon>
);
export const IconCalendar = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Icon>
);
export const IconList = () => (
  <Icon>
    <path d="M9 6h12M9 12h12M9 18h12" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" />
  </Icon>
);
export const IconShield = () => (
  <Icon>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
  </Icon>
);
export const IconCopy = () => (
  <Icon>
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
  </Icon>
);
export const IconSwap = () => (
  <Icon>
    <path d="M7 7h13l-4-4M17 17H4l4 4" />
  </Icon>
);
/** Move handle of a box in the classroom layout editor (S14b): four arrows. */
export const IconMove = () => (
  <Icon>
    <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
  </Icon>
);
/** "Customise layout" (S14b): a board of tiles. */
export const IconLayout = () => (
  <Icon>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M12 9v12" />
  </Icon>
);
export const IconBackspace = () => (
  <Icon>
    <path d="M21 5H9l-6 7 6 7h12z" />
    <path d="M12 9l6 6M18 9l-6 6" />
  </Icon>
);
export const IconUserOff = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 12.5-6.6" />
    <path d="M17 17l4 4M21 17l-4 4" />
  </Icon>
);
export const IconDot = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" fill="currentColor" />
  </Icon>
);
export const IconUp = () => (
  <Icon>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);
export const IconStop = () => (
  <Icon>
    <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" />
    <path d="M12 8v5M12 16v.01" />
  </Icon>
);
export const IconArchive = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v11h14V9M10 13h4" />
  </Icon>
);
export const IconKey = () => (
  <Icon>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M17 6l3 3" />
  </Icon>
);
export const IconSound = () => (
  <Icon>
    <path d="M4 9v6h4l5 4V5L8 9z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" />
  </Icon>
);
/** A speaker with a cross: sound is off (S14a, D-145). */
export const IconSoundOff = () => (
  <Icon>
    <path d="M4 9v6h4l5 4V5L8 9z" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Icon>
);
export const IconClock = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
export const IconPlay = () => (
  <Icon>
    <path d="M7 5l12 7-12 7z" />
  </Icon>
);
export const IconPause = () => (
  <Icon>
    <path d="M8 5v14M16 5v14" />
  </Icon>
);
export const IconNext = () => (
  <Icon>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const IconPrev = () => (
  <Icon>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);
export const IconFlag = () => (
  <Icon>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </Icon>
);
export const IconChevronDown = () => (
  <Icon>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);
export const IconChevronUp = () => (
  <Icon>
    <path d="M6 15l6-6 6 6" />
  </Icon>
);
export const IconNote = () => (
  <Icon>
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M9 11h6M9 15h6" />
  </Icon>
);
export const IconMinus = () => (
  <Icon>
    <path d="M6 12h12" />
  </Icon>
);
/**
 * Reflection faces 1 (tough) … 4 (great): the mouth curve changes; always shown with a text label.
 * Level 5 (S14d, the student's "How is it going?" 1–5) is the big smile with happy, closed eyes.
 */
export const IconFace = ({ level }: { level: 1 | 2 | 3 | 4 | 5 }) => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    {level === 5 ? <path d="M7.8 10.2c.8-1 2-1 2.8 0M13.4 10.2c.8-1 2-1 2.8 0" /> : <path d="M9 10h.01M15 10h.01" />}
    {level === 1 ? <path d="M8.5 16.5c2-2 5-2 7 0" /> : level === 2 ? <path d="M9 15.5h6" /> : level === 3 ? <path d="M9 14.5c1.5 1.5 4.5 1.5 6 0" /> : <path d="M8 14c2 3 6 3 8 0z" />}
  </Icon>
);
export const IconTrash = () => (
  <Icon>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </Icon>
);
export const IconLink = () => (
  <Icon>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);
export const IconMic = () => (
  <Icon>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);
export const IconFile = () => (
  <Icon>
    <path d="M14 3H6v18h12V7z" />
    <path d="M14 3v4h4" />
  </Icon>
);
export const IconImage = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="m21 17-5-5-9 8" />
  </Icon>
);
export const IconCamera = () => (
  <Icon>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </Icon>
);
export const IconPrint = () => (
  <Icon>
    <path d="M7 9V3h10v6" />
    <rect x="3" y="9" width="18" height="8" rx="2" />
    <path d="M7 14h10v7H7z" />
  </Icon>
);
export const IconGlobe = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
  </Icon>
);
export const IconChart = () => (
  <Icon>
    <path d="M4 20V4M4 20h16" />
    <path d="M8 16v-5M12 16V8M16 16v-3M20 16V6" />
  </Icon>
);
export const IconDatabase = () => (
  <Icon>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </Icon>
);
export const IconStar = () => (
  <Icon>
    <path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z" />
  </Icon>
);
/* Teacher menu tiles (usability audit 2026-11): one icon per page, never shared by two tiles. */
export const IconTrophy = () => (
  <Icon>
    <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
    <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4" />
    <path d="M12 13v4M8 21h8M9.5 17h5v4h-5z" />
  </Icon>
);
export const IconTarget = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.2" />
  </Icon>
);
export const IconClipboardCheck = () => (
  <Icon>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1M9 4v2h6V4" />
    <path d="M8.5 13.5l2.5 2.5 4.5-5" />
  </Icon>
);
export const IconUpload = () => (
  <Icon>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </Icon>
);
export const IconTally = () => (
  <Icon>
    <path d="M6 5v14M10 5v14M14 5v14M18 5v14" />
    <path d="M3 16L21 8" />
  </Icon>
);
export const IconMask = () => (
  <Icon>
    <path d="M3 8c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0v3c0 4-3 7-6 7-1.5 0-2.3-1-3-2-.7 1-1.5 2-3 2-3 0-6-3-6-7z" />
    <path d="M7 11.5h2.5M14.5 11.5H17" />
  </Icon>
);
export const IconPencil = () => (
  <Icon>
    <path d="M4 20l1-4L16 5l3 3L8 19z" />
    <path d="M14 7l3 3" />
  </Icon>
);
export const IconGroups = () => (
  <Icon>
    <circle cx="6" cy="7" r="2.5" />
    <circle cx="18" cy="7" r="2.5" />
    <circle cx="12" cy="15" r="2.5" />
    <path d="M2.5 13a3.5 3.5 0 0 1 7 0M14.5 13a3.5 3.5 0 0 1 7 0M8.5 21a3.5 3.5 0 0 1 7 0" />
  </Icon>
);
export const IconAvatar = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 10h.01M15 10h.01" />
    <path d="M8.5 14.5c2 2 5 2 7 0" />
  </Icon>
);
