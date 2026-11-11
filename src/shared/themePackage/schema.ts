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
import { THEME_KEYS } from '../themes.ts';
import { ThemeSlug } from './contractParts.ts';
import { CREATURE_FAMILY_KEYS, type CreatureFamily } from '../avatars.ts';
import { BOX_KEYS } from '../classroomLayout.ts';
import {
  ACHIEVEMENT_FRAMES,
  AMBIENT_PRESETS,
  AMBIENT_SIZES,
  AMBIENT_SPEEDS,
  FRAME_CORNERS,
  FRAME_EDGES,
  FRAME_SURFACES,
  FRAME_TRIMS,
  SCENE_ANCHORS,
  SCENE_FITS,
  SCENE_SMALL_SCREENS,
  SCENE_VIEWBOX,
} from './engine.ts';
import { AMBIENT_LIMITS, ART_LIMITS, FRAME_LIMITS, MOTION_LIMITS, PACKAGE_LIMITS, SCENE_LIMITS, SETS_LIMITS, SOUND_PARAM_LIMITS, STYLE_LIMITS } from './limits.ts';
import { EASINGS, MOTION_PRESETS } from './motion.ts';
import { FONT_PRESETS, SHADOW_PRESETS } from './presets.ts';
import { SOUND_SCALES, SOUND_WAVES } from './sound.ts';
import { COLOR_TOKENS, ILLUSTRATIONS, isDerivedPackageToken, isTranslucentToken, MASCOT_POSES, PACKAGE_COLOR_TOKENS, SOUND_EVENTS, SOUND_STYLES, type PackageColorToken } from './tokens.ts';

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

export { ThemeSlug };
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/u, '#rrggbb or #rrggbbaa');
/** An opaque colour: every token except the translucent layers (`TRANSLUCENT_COLOR_TOKENS`). */
export const OpaqueHexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/u, '#rrggbb (opaque; only overlay, shadow-color and avatar-outline may be translucent)');
const colorSchemaOf = (t: PackageColorToken) => (isTranslucentToken(t) ? HexColor : OpaqueHexColor);

export const PackageColors = z
  .strictObject(
    Object.fromEntries(PACKAGE_COLOR_TOKENS.map((t) => [t, isDerivedPackageToken(t) ? colorSchemaOf(t).optional() : colorSchemaOf(t)])) as Record<PackageColorToken, typeof HexColor>,
  )
  .describe(
    'Every colour token except print-ink and print-paper (always black on white). Opaque #rrggbb, except overlay, shadow-color and avatar-outline (#rrggbb or #rrggbbaa). scene-scrim may be left out (it is then the package surface). See the token table in docs/THEMING.md.',
  );

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
    wave: z.enum(SOUND_WAVES).describe('Oscillator of the plain tones style (sine soft, triangle warm, square buzzy).'),
    style: z
      .enum(SOUND_STYLES)
      .optional()
      .describe('Instrument style of every tone note (S17b): tones (the plain wave, the default when absent), bells, marimba, chimes or musicBox. App-defined synthesis; every limit still applies.'),
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

// ---------------------------------------------------------------- S17a (D-166): scene, frame, ambient, sets
export const SceneSvgSource = z
  .string()
  .min(1)
  .max(SCENE_LIMITS.svgMaxBytes)
  .describe(`An SVG fragment for one scene layer (no <svg> element), the same allow-list as other art; at most ${SCENE_LIMITS.svgMaxBytes / 1024} KB and ${SCENE_LIMITS.svgMaxNodes} elements.`);

export const SceneLayer = z.strictObject({
  art: SceneSvgSource,
  viewBox: z.string().regex(SCENE_VIEWBOX, '"0 0 W H" with a positive width and height').describe('The coordinate box of the art, e.g. "0 0 1920 1080".'),
  fit: z.enum(SCENE_FITS).describe('cover crops to fill the screen, contain shows all of it, width / height fit one side.'),
  anchor: z.enum(SCENE_ANCHORS).describe('Which part stays in view when cropped, or where a smaller layer sits.'),
  maxHeightVh: range(...SCENE_LIMITS.maxHeightVh).optional().describe('Highest the layer may be, in percent of the screen height (e.g. 45 keeps a village in the lower part).'),
});

export const Scene = z
  .strictObject({
    layers: z.array(SceneLayer).min(SCENE_LIMITS.layers[0]).max(SCENE_LIMITS.layers[1]).describe('Drawn back to front: the first layer is the farthest.'),
    opacity: range(...SCENE_LIMITS.opacity),
    smallScreens: z.enum(SCENE_SMALL_SCREENS).describe('Below the phone breakpoint: full, only the last layer as a strip at the bottom (bottomStrip), or none (hidden).'),
  })
  .describe('Viewport-scale artwork fixed behind the app (decorative). Text never sits on it: boxes and bars keep their surfaces and headings on the page get a scene-scrim panel.');

const tokenName = z.enum(COLOR_TOKENS);
export const Frame = z
  .strictObject({
    edge: z.enum(FRAME_EDGES).describe('Card silhouette: snow piled on top, a scalloped edge, a torn paper edge.'),
    trim: z.enum(FRAME_TRIMS).optional().describe('A band around the boxes listed in trimOn (default none).'),
    corners: z.enum(FRAME_CORNERS).optional().describe('Small accents at the corners (default none).'),
    apply: z
      .array(z.enum(FRAME_SURFACES))
      .min(1)
      .max(FRAME_SURFACES.length)
      .optional()
      .describe('Surfaces that get the edge and corners (default boardBoxes, studentCards, topBar). studentCards, cards and topBar get the edge only; dialogs get the edge and corners; the trim is only on the board boxes in trimOn.'),
    trimOn: z.array(z.enum(BOX_KEYS)).max(BOX_KEYS.length).optional().describe('Board boxes that get the trim (box keys of the classroom board; default routine and core.timer).'),
    snowColor: tokenName.optional().describe('Colour token of the edge shape (default per edge: art-ground for snowDrift, surface otherwise).'),
    trimColors: z.array(tokenName).min(FRAME_LIMITS.trimColors[0]).max(FRAME_LIMITS.trimColors[1]).optional().describe('Colour tokens of the trim (default per trim, e.g. accent and surface for candyStripe).'),
    cornerColors: z.array(tokenName).min(FRAME_LIMITS.cornerColors[0]).max(FRAME_LIMITS.cornerColors[1]).optional().describe('Colour tokens of the corners (default per corner preset).'),
  })
  .describe('App-drawn frames from presets only (no SVG in the package). Colours are token names. Phones get the edge only.');

export const Ambient = z
  .strictObject({
    preset: z.enum(AMBIENT_PRESETS),
    density: intRange(...AMBIENT_LIMITS.density).describe('Number of particles on a 1920x1080 screen (fewer on smaller screens).'),
    speed: z.enum(AMBIENT_SPEEDS),
    color: tokenName.optional().describe('Colour token of the particles (default: surface for snowfall, deco-1..3 for leaves).'),
    size: z.enum(AMBIENT_SIZES),
  })
  .describe(`A silent background animation on one canvas between the scene and the content, at most ${AMBIENT_LIMITS.maxFps} frames a second. With the class animation switch off or reduced motion it draws one still frame.`);

const families = CREATURE_FAMILY_KEYS as [CreatureFamily, ...CreatureFamily[]];
export const Sets = z
  .strictObject({
    achievementFrame: z.enum(ACHIEVEMENT_FRAMES).describe('A frame around the badge art; the tier keeps its shape, colour token and word.'),
    avatarFamiliesFirst: z
      .array(z.enum(families))
      .min(SETS_LIMITS.avatarFamiliesFirst[0])
      .max(SETS_LIMITS.avatarFamiliesFirst[1])
      .describe('Creature families shown first in the avatar picker; nothing is hidden and saved avatars never change.'),
    mascotFrom: z.enum(THEME_KEYS).optional().describe('A built-in theme whose mascot to use when the package has no mascot art (default: the base theme).'),
  })
  .describe('Choose and recolour built-in sets (no custom avatar or badge art).');

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
  scene: Scene.optional(),
  frame: Frame.optional(),
  ambient: Ambient.optional(),
  sets: Sets.optional(),
});
export type ThemePackage = z.infer<typeof ThemePackage>;
export type ThemePackageScene = z.infer<typeof Scene>;
export type ThemePackageFrame = z.infer<typeof Frame>;
export type ThemePackageAmbient = z.infer<typeof Ambient>;
export type ThemePackageSets = z.infer<typeof Sets>;

/**
 * A package as stored (it passed `ThemePackage` when imported). Read leniently on the client: colour
 * tokens added to the app after the package was made are missing from it, and tokens since removed
 * are ignored; the missing ones come from the base theme.
 */
export const StoredThemePackage = ThemePackage.extend({
  colors: z.object(Object.fromEntries(PACKAGE_COLOR_TOKENS.map((t) => [t, colorSchemaOf(t).optional()])) as Record<PackageColorToken, z.ZodOptional<typeof HexColor>>),
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
