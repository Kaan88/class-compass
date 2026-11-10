/**
 * What the classroom board reports about its screen (S16c, D-165). Only sizes, the pixel ratio, a
 * short browser/OS text parsed here (never the full user agent), and display preferences. Nothing about
 * students.
 */
import { DISPLAY_DENSITIES, DisplaySample, type DISPLAY_OS } from '../../../shared/contracts/displayInfo.ts';

type Os = (typeof DISPLAY_OS)[number];

/** Browser family + major version and OS family from a user agent string. */
export function parseUserAgent(ua: string): { browser: string; os: Os } {
  const major = (re: RegExp) => ua.match(re)?.[1] ?? null;
  const pick = (name: string, re: RegExp) => {
    const v = major(re);
    return v ? `${name} ${v.slice(0, 4)}` : name;
  };
  let browser = 'Other';
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = pick('Edge', /Edg(?:e|A|iOS)?\/(\d+)/);
  else if (/OPR\//.test(ua)) browser = pick('Opera', /OPR\/(\d+)/);
  else if (/SamsungBrowser\//.test(ua)) browser = pick('Samsung Internet', /SamsungBrowser\/(\d+)/);
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = pick('Firefox', /(?:Firefox|FxiOS)\/(\d+)/);
  else if (/Chrome\/|CriOS\//.test(ua)) browser = pick('Chrome', /(?:Chrome|CriOS)\/(\d+)/);
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = pick('Safari', /Version\/(\d+)/);
  let os: Os = 'Other';
  if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser, os };
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));

export interface SampleInputs {
  density: string | null;
  theme: string | null;
  layout: 'default' | 'class' | 'all' | null;
  textScale: number;
}

/** Reads the window; returns null when the result does not pass the contract (nothing is sent then). */
export function readSample(inputs: SampleInputs, w: Window = window): DisplaySample | null {
  const reduced = typeof w.matchMedia === 'function' ? w.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  const { browser, os } = parseUserAgent(w.navigator.userAgent ?? '');
  const candidate = {
    innerWidth: clampInt(w.innerWidth, 100, 16384),
    innerHeight: clampInt(w.innerHeight, 100, 16384),
    screenWidth: clampInt(w.screen?.width ?? w.innerWidth, 100, 16384),
    screenHeight: clampInt(w.screen?.height ?? w.innerHeight, 100, 16384),
    pixelRatio: Math.min(8, Math.max(0.25, Math.round((w.devicePixelRatio || 1) * 100) / 100)),
    density: (DISPLAY_DENSITIES as readonly string[]).includes(inputs.density ?? '') ? (inputs.density as DisplaySample['density']) : null,
    theme: inputs.theme && /^[a-z0-9][a-z0-9-]{0,39}$/.test(inputs.theme) ? inputs.theme : null,
    layout: inputs.layout,
    browser,
    os,
    touch: (w.navigator.maxTouchPoints ?? 0) > 0,
    reducedMotion: reduced,
    textScale: clampInt(inputs.textScale, 50, 300),
    fullscreen: Boolean(w.document?.fullscreenElement),
  };
  const parsed = DisplaySample.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
