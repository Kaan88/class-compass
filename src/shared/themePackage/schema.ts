/**
 * Theme package schema (S14g, D-158): the JSON file an administrator imports on Admin → Themes (and
 * that an AI tool may write). One source for the server, the admin preview, the MCP tools (S14h) and
 * `docs/theme-package.schema.json`, which `scripts/theme-docs.ts` generates from it (drift-tested).
 *
 * A package says everything a theme is with data only: colours as hex, typography, shadows and
 * motions as named presets, numbers inside fixed ranges, sound as `makeSoundPack` parameters, and
 * optional art as strict SVG fragments (svg.ts). No CSS, no markup that is drawn as markup, no URLs.
 * Objects are strict: an unknown or misspelt field is an error rather than silently ignored.
 */
import { z } from 'zod';
import { THEME_KEYS, THEME_SLUG } from '../themes.ts';
import { ART_LIMITS, MOTION_LIMITS, PACKAGE_LIMITS, SOUND_PARAM_LIMITS, STYLE_LIMITS } from './limits.ts';
import { EASINGS, MOTION_PRESETS } from './motion.ts';
import { FONT_PRESETS, SHADOW_PRESETS } from './presets.ts';
import { SOUND_SCALES, SOUND_WAVES } from './sound.ts';
import { COLOR_TOKENS, ILLUSTRATIONS, MASCOT_POSES, PACKAGE_COLOR_TOKENS, SOUND_EVENTS, type PackageColorToken } from './tokens.ts';

export const THEME_PACKAGE_FORMAT = 'class-compass-theme';
export const THEME_PACKAGE_VERSION = 1;

const range = (lo: number, hi: number) => z.number().min(lo).max(hi);
const intRange = (lo: number, hi: number) => z.number().int().min(lo).max(hi);
const keysOf = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...Array<keyof T & string>];

/** Printable text without control characters. */
const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}\p{Cf}]*$/u, 'no control or format characters');
const Labels = (max: number) => z.strictObject({ en: plainText(max), tr: plainText(max) });

export const ThemeSlug = z.string().regex(THEME_SLUG, 'a slug: 3-32 lower-case letters, digits and single hyphens, starting with a letter');
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/u, '#rrggbb or #rrggbbaa');

export const PackageColors = z
  .strictObject(Object.fromEntries(PACKAGE_COLOR_TOKENS.map((t) => [t, HexColor])) as Record<PackageColorToken, typeof HexColor>)
  .describe('Every colour token except print-ink and print-paper (always black on white). See the token table in docs/THEMING.md.');

export const Typography = z.strictObject({
  body: z.enum(keysOf(FONT_PRESETS)).describe('Font preset of body text.'),
  display: z.enum(keysOf(FONT_PRESETS)).describe('Font preset of headings and big classroom text.'),
  weightBody: intRange(...STYLE_LIMITS.weight),
  weightStrong: intRange(...STYLE_LIMITS.weight),
  weightHeading: intRange(...STYLE_LIMITS.weight),
  weightDisplay: intRange(...STYLE_LIMITS.weight),
  trackingBody: range(...STYLE_LIMITS.trackingEm).describe('Letter-spacing of body text in em (0 = normal).'),
  trackingDisplay: range(...STYLE_LIMITS.trackingEm).describe('Letter-spacing of headings in em (0 = normal).'),
});

export const Shape = z.strictObject({
  radiusRem: range(...STYLE_LIMITS.radiusRem),
  radiusSmRem: range(...STYLE_LIMITS.radiusSmRem),
  borderPx: range(...STYLE_LIMITS.borderPx),
  borderStrongPx: range(...STYLE_LIMITS.borderStrongPx),
  shadow: z.enum(keysOf(SHADOW_PRESETS)).describe('Card elevation preset.'),
  shadowRaised: z.enum(keysOf(SHADOW_PRESETS)).describe('Dialog elevation preset.'),
});

export const Avatar = z.strictObject({
  saturation: range(...STYLE_LIMITS.avatarSaturation),
  lightness: range(...STYLE_LIMITS.avatarLightness),
  lightnessSmall: range(...STYLE_LIMITS.avatarLightness),
});

export const Icons = z.strictObject({
  strokeWidth: range(...STYLE_LIMITS.iconStroke),
  linecap: z.enum(['round', 'square', 'butt']),
  linejoin: z.enum(['round', 'miter', 'bevel']),
});

const motionChoice = <P extends Record<string, string>>(presets: P) =>
  z.strictObject({
    preset: z.enum(keysOf(presets)),
    durationMs: intRange(MOTION_LIMITS.minMs, MOTION_LIMITS.maxMs),
    easing: z.enum(EASINGS),
  });
export const Motion = z.strictObject({
  celebrate: motionChoice(MOTION_PRESETS.celebrate).describe('Plays once on the mascot when the class celebrates.'),
  threshold: motionChoice(MOTION_PRESETS.threshold).describe('Plays once when the class counter bar fills.'),
});

export const ToneNoteSchema = z.strictObject({
  freq: range(1, 20000),
  to: range(1, 20000).optional(),
  at: intRange(0, 10000),
  dur: intRange(1, 10000),
  type: z.enum(['sine', 'triangle', 'square', 'noise']),
  gain: range(0, 1),
});

export const Sounds = z
  .strictObject({
    root: range(...SOUND_PARAM_LIMITS.rootHz).describe('Root note in Hz (523 = C5).'),
    wave: z.enum(SOUND_WAVES),
    scale: z.enum(SOUND_SCALES),
    gain: range(...SOUND_PARAM_LIMITS.gain).describe('Peak gain of the main voice; the tap must still peak between -12 and -6 dBFS at volume 80.'),
    tempo: range(...SOUND_PARAM_LIMITS.tempo).describe('Speed: above 1 is snappier, below 1 calmer.'),
    overrides: z.partialRecord(z.enum(SOUND_EVENTS), z.array(ToneNoteSchema).min(1)).optional().describe('Hand-made cues for single events; every limit still applies.'),
  })
  .nullable()
  .describe('null keeps the theme silent (every visual signal stays).');

export const SvgSource = z.string().min(1).max(ART_LIMITS.svgMaxBytes).describe('An SVG fragment (no <svg> element) using only the allowed elements and attributes (docs/THEMING.md).');

export const Art = z.strictObject({
  mascot: z
    .strictObject(Object.fromEntries(MASCOT_POSES.map((p) => [p, SvgSource])) as Record<(typeof MASCOT_POSES)[number], typeof SvgSource>)
    .optional()
    .describe('All five poses in a 100x100 box, all different. Without it the base theme mascot is used.'),
  illustrations: z
    .strictObject(Object.fromEntries(ILLUSTRATIONS.map((p) => [p, SvgSource.optional()])) as Record<(typeof ILLUSTRATIONS)[number], z.ZodOptional<typeof SvgSource>>)
    .optional()
    .describe('Any of the six illustrations in a 200x140 box; missing ones come from the base theme.'),
  decoration: SvgSource.optional().describe('Corner decoration, 100x100.'),
  pattern: SvgSource.optional().describe('Background tile, patternSize x patternSize.'),
  patternSize: intRange(...ART_LIMITS.patternSize).optional(),
});

export const ThemePackage = z.strictObject({
  format: z.literal(THEME_PACKAGE_FORMAT),
  version: z.literal(THEME_PACKAGE_VERSION),
  key: ThemeSlug.describe('The theme key classes store. Not a built-in key; unique in the school.'),
  name: Labels(PACKAGE_LIMITS.nameMax),
  description: Labels(PACKAGE_LIMITS.descriptionMax),
  mascotName: Labels(PACKAGE_LIMITS.nameMax),
  base: z.enum(THEME_KEYS).describe('Built-in theme that supplies missing art and colour tokens added after this package was made.'),
  colors: PackageColors,
  typography: Typography,
  shape: Shape,
  avatar: Avatar,
  icons: Icons,
  decoOpacity: range(0, 0.6),
  patternOpacity: range(0, 0.15),
  motion: Motion,
  sounds: Sounds,
  celebration: z.strictObject({
    colors: z
      .array(z.enum(COLOR_TOKENS))
      .min(PACKAGE_LIMITS.celebrationColors[0])
      .max(PACKAGE_LIMITS.celebrationColors[1])
      .describe('Colour tokens of the celebration fireworks.'),
  }),
  art: Art.optional(),
});
export type ThemePackage = z.infer<typeof ThemePackage>;

/**
 * A package as stored (it passed `ThemePackage` when imported). Read leniently on the client: colour
 * tokens added to the app after the package was made are missing from it, and tokens since removed
 * are ignored; the missing ones come from the base theme.
 */
export const StoredThemePackage = ThemePackage.extend({
  colors: z.object(Object.fromEntries(PACKAGE_COLOR_TOKENS.map((t) => [t, HexColor.optional()])) as Record<PackageColorToken, z.ZodOptional<typeof HexColor>>),
});
export type StoredThemePackage = z.infer<typeof StoredThemePackage>;
export type ThemePackageSounds = NonNullable<ThemePackage['sounds']>;

/** The JSON Schema of a package (docs/theme-package.schema.json and the MCP `theme_schema` tool). */
export function themePackageJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ThemePackage, { target: 'draft-2020-12', unrepresentable: 'any' }) as Record<string, unknown>;
  return {
    $schema: schema.$schema,
    $id: 'https://class-compass.invalid/theme-package.schema.json',
    title: 'Class Compass theme package',
    description: 'Version 1. Generated from src/shared/themePackage/schema.ts by scripts/theme-docs.ts; do not edit.',
    ...Object.fromEntries(Object.entries(schema).filter(([k]) => k !== '$schema')),
  };
}
