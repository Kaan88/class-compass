/**
 * Classroom screen size, recorded for administrators (S16c, D-165). A removable module: see the
 * header of `src/server/modules/displayInfo/manifest.ts` for how to take it out.
 *
 * The classroom board sends what it sees of the screen (sizes, pixel ratio, a short browser/OS text,
 * a few display preferences, whether it is in full screen since S18); the server keeps the last
 * sample per teacher account plus the last five distinct sizes. Nothing about students. Every field
 * is bounded and short texts follow an allow-list pattern, so the endpoint cannot be used to store arbitrary text.
 */
import { z } from 'zod';
import { Empty, Ok, endpoint } from './define.ts';

export const DISPLAY_DENSITIES = ['compact', 'normal', 'large'] as const;
export const DISPLAY_OS = ['Windows', 'macOS', 'iOS', 'Android', 'ChromeOS', 'Linux', 'Other'] as const;
export const DISPLAY_LAYOUTS = ['default', 'class', 'all'] as const;
/** How many distinct sizes are kept per account. */
export const RECENT_SIZES = 5;

const px = z.number().int().min(100).max(16384);

export const DisplaySample = z
  .object({
    innerWidth: px,
    innerHeight: px,
    screenWidth: px,
    screenHeight: px,
    pixelRatio: z.number().min(0.25).max(8),
    density: z.enum(DISPLAY_DENSITIES).nullable(),
    /** The theme key shown (built-in key or an imported theme's slug). */
    theme: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).nullable(),
    /** Where the board's layout came from: the default, this class's own, or the teacher's "all classes" layout. */
    layout: z.enum(DISPLAY_LAYOUTS).nullable(),
    /** Browser family and major version, e.g. "Chrome 142" (parsed on the client; never the full user agent). */
    browser: z.string().regex(/^[A-Za-z][A-Za-z ]{0,19}( [0-9]{1,4})?$/),
    os: z.enum(DISPLAY_OS),
    touch: z.boolean(),
    reducedMotion: z.boolean(),
    textScale: z.number().int().min(50).max(300),
    /** S18 (D-167): whether the page was in full screen when the sample was taken. */
    fullscreen: z.boolean(),
  })
  .strict();
export type DisplaySample = z.infer<typeof DisplaySample>;

/** A stored sample. Samples stored before S18 have no `fullscreen`: read as null ("not recorded"), so they are kept. */
export const DisplaySeen = DisplaySample.extend({ seenAt: z.number().int(), fullscreen: z.boolean().nullable().default(null) });
export type DisplaySeen = z.infer<typeof DisplaySeen>;

export const DisplaySize = z.object({
  innerWidth: px,
  innerHeight: px,
  screenWidth: px,
  screenHeight: px,
  pixelRatio: z.number().min(0.25).max(8),
  seenAt: z.number().int(),
});
export type DisplaySize = z.infer<typeof DisplaySize>;

/** The stored user setting `displayInfo.lastSeen`. */
export const DisplayInfoRecord = z.object({ last: DisplaySeen.nullable(), recent: z.array(DisplaySize).max(RECENT_SIZES) });
export type DisplayInfoRecord = z.infer<typeof DisplayInfoRecord>;
export const EMPTY_DISPLAY_INFO: DisplayInfoRecord = { last: null, recent: [] };

export const reportDisplay = endpoint({ method: 'POST', path: '/api/classroom/display-info', access: 'classroom', input: DisplaySample, output: Ok });

export const DisplayInfoRow = z.object({ userId: z.string(), displayName: z.string(), last: DisplaySeen, recent: z.array(DisplaySize) });
export type DisplayInfoRow = z.infer<typeof DisplayInfoRow>;

export const adminDisplayInfo = endpoint({ method: 'GET', path: '/api/admin/display-info', access: 'admin', input: Empty, output: z.object({ teachers: z.array(DisplayInfoRow) }) });
