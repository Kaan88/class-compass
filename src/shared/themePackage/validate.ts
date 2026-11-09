/**
 * Theme package validation report (S14g, D-158): the one check the server runs before storing a
 * package, the admin page shows before a preview, and the MCP `validate_theme` tool (S14h) returns.
 *
 * Errors block saving: the file is not JSON or too big, the schema (shape, ranges, presets, unknown
 * fields), a built-in key, a WCAG contrast pair (the same pairs as the built-in themes), a sound limit
 * (length, gain, frequency, loudness), refused SVG, mascot poses that are not all different.
 * Warnings do not: art that comes from the base theme, a silent theme.
 * Messages are plain English for tools and logs; the admin page translates `code` and shows `params`.
 */
import { contrastFailures } from './contrast.ts';
import { PACKAGE_LIMITS } from './limits.ts';
import { THEME_PACKAGE_FORMAT, ThemePackage } from './schema.ts';
import { makeSoundPack, soundPackProblems } from './sound.ts';
import { parseSvg, svgToString, type SvgNode } from './svg.ts';
import { FIXED_COLOR_TOKENS, ILLUSTRATIONS, MASCOT_POSES, type IllustrationName, type MascotPose, type ThemeColors } from './tokens.ts';
import { THEME_KEYS } from '../themes.ts';

export const THEME_ISSUE_CODES = ['TOO_LARGE', 'NOT_JSON', 'SCHEMA', 'KEY_BUILTIN', 'CONTRAST', 'SOUND', 'SVG', 'MASCOT_POSES_SAME', 'ART_FROM_BASE', 'SILENT'] as const;
export type ThemeIssueCode = (typeof THEME_ISSUE_CODES)[number];

export interface ThemeIssue {
  code: ThemeIssueCode;
  /** Where in the package, as a dotted path (`colors.text`, `art.mascot.idle`), or '' for the whole file. */
  path: string;
  /** Plain English explanation. */
  message: string;
  /** Values for the translated message (ratio, limit, reason …). */
  params?: Record<string, string | number>;
}

export interface ThemeReport {
  ok: boolean;
  key: string | null;
  errors: ThemeIssue[];
  warnings: ThemeIssue[];
  stats: { bytes: number; pictures: number; svgNodes: number };
}

/** The fixed print colours (D-120), the same in every theme. */
export const FIXED_COLORS: Record<(typeof FIXED_COLOR_TOKENS)[number], string> = { 'print-ink': '#000000', 'print-paper': '#ffffff' };

/** A package's complete colour set (the fixed print colours added). */
export const packageColors = (pkg: ThemePackage): ThemeColors => ({ ...pkg.colors, ...FIXED_COLORS }) as ThemeColors;

/** The parsed art of a package: only pictures that pass the sanitiser (the rest come from the base theme). */
export interface PackageArt {
  mascot: Record<MascotPose, SvgNode[]> | null;
  illustrations: Partial<Record<IllustrationName, SvgNode[]>>;
  decoration: SvgNode[] | null;
  pattern: SvgNode[] | null;
}

export function packageArt(pkg: Pick<ThemePackage, 'art'>): PackageArt {
  const tree = (src: string | undefined) => {
    if (src === undefined) return null;
    const r = parseSvg(src);
    return r.ok ? r.nodes : null;
  };
  const poses = MASCOT_POSES.map((p) => [p, tree(pkg.art?.mascot?.[p])] as const);
  const illustrations: Partial<Record<IllustrationName, SvgNode[]>> = {};
  for (const name of ILLUSTRATIONS) {
    const t = tree(pkg.art?.illustrations?.[name]);
    if (t) illustrations[name] = t;
  }
  return {
    mascot: poses.every(([, t]) => t !== null) ? (Object.fromEntries(poses) as Record<MascotPose, SvgNode[]>) : null,
    illustrations,
    decoration: tree(pkg.art?.decoration),
    pattern: tree(pkg.art?.pattern),
  };
}

const SVG_REASONS: Record<string, string> = {
  empty: 'the picture is empty',
  tooLarge: 'the picture is larger than the limit',
  tooManyNodes: 'the picture has too many elements',
  tooDeep: 'groups are nested too deeply',
  markup: 'comments, CDATA, doctypes and processing instructions are not allowed',
  entity: 'entities (&…;) are not allowed',
  text: 'text is not allowed in pictures',
  element: 'this element is not allowed',
  attribute: 'this attribute is not allowed',
  duplicateAttribute: 'an attribute appears twice',
  value: 'this value is not allowed (colours must be var(--cc-<token>), none or currentColor)',
  children: 'only g may contain other elements',
  syntax: 'the markup is not well formed',
  unclosed: 'an element is not closed',
};

const SOUND_TEXT: Record<string, string> = {
  missing: 'has no cue',
  tooManyNotes: 'has too many notes',
  tooLong: 'is too long (ms)',
  gain: 'has a note louder than the gain cap',
  frequency: 'has a note outside the allowed frequencies (Hz)',
  clips: 'would clip at volume 100 (dBFS)',
  tapTooQuiet: 'is too quiet at volume 80 (dBFS)',
  tapTooLoud: 'is too loud at volume 80 (dBFS)',
};

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/**
 * Validates a package given as the file text (preferred: the size and JSON syntax are checked too)
 * or as an already parsed value. Returns the report and, when there are no errors, the package.
 */
export function validateThemePackage(input: unknown): { report: ThemeReport; pkg: ThemePackage | null } {
  const errors: ThemeIssue[] = [];
  const warnings: ThemeIssue[] = [];
  let svgNodes = 0;
  let pictures = 0;
  const done = (key: string | null, bytes: number, pkg: ThemePackage | null) => ({
    report: { ok: errors.length === 0, key, errors, warnings, stats: { bytes, pictures, svgNodes } },
    pkg: errors.length === 0 ? pkg : null,
  });

  let value: unknown = input;
  let bytes = 0;
  if (typeof input === 'string') {
    bytes = utf8Length(input);
    if (bytes > PACKAGE_LIMITS.maxBytes) {
      errors.push({ code: 'TOO_LARGE', path: '', message: `The file is ${bytes} bytes; the limit is ${PACKAGE_LIMITS.maxBytes}.`, params: { bytes, limit: PACKAGE_LIMITS.maxBytes } });
      return done(null, bytes, null);
    }
    try {
      value = JSON.parse(input);
    } catch (e) {
      errors.push({ code: 'NOT_JSON', path: '', message: `The file is not valid JSON: ${e instanceof Error ? e.message.slice(0, 120) : 'parse error'}.` });
      return done(null, bytes, null);
    }
  } else {
    bytes = utf8Length(JSON.stringify(input) ?? '');
    if (bytes > PACKAGE_LIMITS.maxBytes) {
      errors.push({ code: 'TOO_LARGE', path: '', message: `The package is ${bytes} bytes; the limit is ${PACKAGE_LIMITS.maxBytes}.`, params: { bytes, limit: PACKAGE_LIMITS.maxBytes } });
      return done(null, bytes, null);
    }
  }

  const rawKey = value && typeof value === 'object' && typeof (value as { key?: unknown }).key === 'string' ? (value as { key: string }).key.slice(0, 40) : null;
  if (value && typeof value === 'object' && (value as { format?: unknown }).format !== THEME_PACKAGE_FORMAT) {
    errors.push({ code: 'SCHEMA', path: 'format', message: `This is not a Class Compass theme package (format must be "${THEME_PACKAGE_FORMAT}").`, params: { detail: 'format' } });
    return done(rawKey, bytes, null);
  }
  const parsed = ThemePackage.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 50)) {
      const path = issue.path.map(String).join('.');
      errors.push({ code: 'SCHEMA', path, message: `${path || 'package'}: ${issue.message}`, params: { detail: issue.message.slice(0, 200) } });
    }
    return done(rawKey, bytes, null);
  }
  const pkg = parsed.data;

  if ((THEME_KEYS as readonly string[]).includes(pkg.key)) errors.push({ code: 'KEY_BUILTIN', path: 'key', message: `"${pkg.key}" is a built-in theme; choose another key.`, params: { key: pkg.key } });

  for (const f of contrastFailures(packageColors(pkg), pkg.avatar)) {
    errors.push({
      code: 'CONTRAST',
      path: f.bg.includes('hue') ? 'avatar' : `colors.${f.fg}`,
      message: `${f.pair}: contrast ${f.ratio}:1, needs ${f.min}:1.`,
      params: { fg: f.fg, bg: f.bg, ratio: f.ratio, min: f.min },
    });
  }

  if (pkg.sounds === null) warnings.push({ code: 'SILENT', path: 'sounds', message: 'The theme is silent: no classroom sounds play with it.' });
  else {
    const { overrides, ...params } = pkg.sounds;
    const pack = makeSoundPack(params, overrides ?? {});
    for (const p of soundPackProblems(pack)) {
      errors.push({
        code: 'SOUND',
        path: overrides?.[p.event] ? `sounds.overrides.${p.event}` : 'sounds',
        message: `The ${p.event} cue ${SOUND_TEXT[p.kind] ?? p.kind}: ${p.value}, limit ${p.limit}.`,
        params: { event: p.event, kind: p.kind, value: p.value, limit: p.limit },
      });
    }
  }

  const checkSvg = (path: string, src: string | undefined): SvgNode[] | null => {
    if (src === undefined) return null;
    pictures += 1;
    const r = parseSvg(src);
    if (r.ok) {
      svgNodes += r.count;
      return r.nodes;
    }
    const why = SVG_REASONS[r.error.reason] ?? r.error.reason;
    errors.push({
      code: 'SVG',
      path,
      message: `${path}: ${why}${r.error.detail ? ` (${r.error.detail})` : ''} at character ${r.error.at}.`,
      params: { reason: r.error.reason, detail: r.error.detail ?? '', at: r.error.at },
    });
    return null;
  };
  const art = pkg.art;
  const poses = MASCOT_POSES.map((p) => checkSvg(`art.mascot.${p}`, art?.mascot?.[p]));
  if (art?.mascot && poses.every((t) => t !== null)) {
    const texts = poses.map((t) => svgToString(t!));
    if (new Set(texts).size !== texts.length) errors.push({ code: 'MASCOT_POSES_SAME', path: 'art.mascot', message: 'Every mascot pose must look different.' });
  }
  for (const name of ILLUSTRATIONS) checkSvg(`art.illustrations.${name}`, art?.illustrations?.[name]);
  checkSvg('art.decoration', art?.decoration);
  checkSvg('art.pattern', art?.pattern);

  const fromBase = [
    ...(art?.mascot ? [] : ['mascot']),
    ...ILLUSTRATIONS.filter((n) => !art?.illustrations?.[n]),
    ...(art?.decoration ? [] : ['decoration']),
    ...(art?.pattern ? [] : ['pattern']),
  ];
  if (fromBase.length) warnings.push({ code: 'ART_FROM_BASE', path: 'art', message: `From the base theme "${pkg.base}": ${fromBase.join(', ')}.`, params: { base: pkg.base, items: fromBase.join(', ') } });

  return done(pkg.key, bytes, pkg);
}
