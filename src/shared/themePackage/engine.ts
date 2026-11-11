/**
 * Theme engine vocabulary (S17a, D-166): the app-defined presets a theme (built-in or package) can ask
 * for beyond colours and art: a viewport-scale **scene** behind the app, **frames** around cards
 * (silhouette edges, trims and corners drawn by the app), a silent **ambient** animation and **sets**
 * (which built-in achievement frame and avatar families come first, whose mascot to borrow).
 *
 * Everything here is a NAME the app maps to its own drawing code: a package never brings CSS, and the
 * frame colours are colour TOKEN names (`var(--cc-<token>)`), never raw colours. One source for the
 * schema (`schema.ts`), the validator, the client renderers (`client/ui/Frame.tsx`,
 * `client/themes/Scene.tsx`, `client/themes/Ambient.tsx`) and the generated docs.
 */
import { BOX_KEYS, type BoxKey } from '../classroomLayout.ts';
import type { CreatureFamily } from '../avatars.ts';
import type { BuiltinThemeKey } from '../themes.ts';
import type { ColorToken } from './tokens.ts';

// ---------------------------------------------------------------- scene
/** How a scene layer fills the screen: `cover` crops, `contain` shows all, `width` / `height` fit one side. */
export const SCENE_FITS = ['cover', 'contain', 'width', 'height'] as const;
export type SceneFit = (typeof SCENE_FITS)[number];
/** Which part of the layer stays in view when it is cropped (or where it sits when it is smaller). */
export const SCENE_ANCHORS = ['bottom', 'top', 'center', 'bottom-left', 'bottom-right', 'top-left', 'top-right'] as const;
export type SceneAnchor = (typeof SCENE_ANCHORS)[number];
/** Below the phone breakpoint: every layer, only the last layer as a strip at the bottom, or none. */
export const SCENE_SMALL_SCREENS = ['full', 'bottomStrip', 'hidden'] as const;
export type SceneSmallScreens = (typeof SCENE_SMALL_SCREENS)[number];

/** `preserveAspectRatio` of a scene layer from its fit and anchor. */
export function scenePreserveAspectRatio(fit: SceneFit, anchor: SceneAnchor): string {
  const x = anchor.endsWith('left') ? 'xMin' : anchor.endsWith('right') ? 'xMax' : 'xMid';
  const y = anchor.startsWith('top') ? 'YMin' : anchor.startsWith('bottom') ? 'YMax' : 'YMid';
  return `${x}${y} ${fit === 'contain' ? 'meet' : 'slice'}`;
}

/** `0 0 W H` with positive W and H (scene layers always start at the origin). */
export const SCENE_VIEWBOX = /^0 0 (?:[1-9]\d{0,4})(?:\.\d{1,3})? (?:[1-9]\d{0,4})(?:\.\d{1,3})?$/u;

// ---------------------------------------------------------------- frames
/** The card silhouette: snow piled on top, a gingerbread scallop, a torn paper edge. */
export const FRAME_EDGES = ['none', 'snowDrift', 'scallop', 'torn'] as const;
export type FrameEdge = (typeof FRAME_EDGES)[number];
/** A band around (or along) the card. */
export const FRAME_TRIMS = ['none', 'candyStripe', 'garland', 'lights', 'frost', 'stitched', 'pencil'] as const;
export type FrameTrim = (typeof FRAME_TRIMS)[number];
/** Small accents at the corners. */
export const FRAME_CORNERS = ['none', 'frost', 'holly', 'star', 'compass', 'leaf'] as const;
export type FrameCorners = (typeof FRAME_CORNERS)[number];
/**
 * Which surfaces get the edge and the corners: board boxes, the student cards of the classroom grid
 * (the edge only), the classroom top bar (the edge only: its class name and buttons reach its corners,
 * S17b review), the dock, ordinary cards of the other pages (the edge only) and dialogs.
 */
export const FRAME_SURFACES = ['boardBoxes', 'studentCards', 'topBar', 'dock', 'cards', 'dialogs'] as const;
export type FrameSurface = (typeof FRAME_SURFACES)[number];
export const DEFAULT_FRAME_SURFACES: readonly FrameSurface[] = ['boardBoxes', 'studentCards', 'topBar'];
/** Board boxes that get the trim when the theme does not say (the routine and the timer). */
export const DEFAULT_TRIM_ON: readonly BoxKey[] = ['routine', 'core.timer'];
export { BOX_KEYS as FRAME_BOX_KEYS };

/** Default colour tokens per preset (mockups 2026-11-11): edges and corners, then the trim colours. */
export const EDGE_COLOR: Record<FrameEdge, ColorToken> = { none: 'surface', snowDrift: 'art-ground', scallop: 'surface', torn: 'surface' };
export const TRIM_COLORS: Record<FrameTrim, readonly ColorToken[]> = {
  none: ['accent', 'surface'],
  candyStripe: ['accent', 'surface'],
  garland: ['deco-1', 'deco-2', 'deco-3'],
  lights: ['deco-2', 'deco-3', 'deco-1'],
  frost: ['art-ground', 'border'],
  stitched: ['deco-2', 'surface'],
  pencil: ['deco-2', 'deco-3', 'text-muted'],
};
export const CORNER_COLORS: Record<FrameCorners, readonly ColorToken[]> = {
  none: ['border'],
  frost: ['art-ground', 'border'],
  holly: ['deco-1', 'deco-3'],
  star: ['deco-2', 'text-muted'],
  compass: ['deco-2', 'text-muted'],
  leaf: ['deco-1', 'icon-accent'],
};

/** A frame as a package writes it: everything but `edge` may be left out. */
export interface FrameInput {
  edge: FrameEdge;
  trim?: FrameTrim;
  corners?: FrameCorners;
  apply?: readonly FrameSurface[];
  trimOn?: readonly BoxKey[];
  snowColor?: ColorToken;
  trimColors?: readonly ColorToken[];
  cornerColors?: readonly ColorToken[];
}

/** A frame with every default filled in (what the renderer and Export use). */
export interface ResolvedFrame {
  edge: FrameEdge;
  trim: FrameTrim;
  corners: FrameCorners;
  apply: readonly FrameSurface[];
  trimOn: readonly BoxKey[];
  snowColor: ColorToken;
  trimColors: readonly ColorToken[];
  cornerColors: readonly ColorToken[];
}

export function resolveFrame(f: FrameInput): ResolvedFrame {
  const trim = f.trim ?? 'none';
  const corners = f.corners ?? 'none';
  return {
    edge: f.edge,
    trim,
    corners,
    apply: [...new Set(f.apply ?? DEFAULT_FRAME_SURFACES)],
    trimOn: [...new Set(f.trimOn ?? DEFAULT_TRIM_ON)],
    snowColor: f.snowColor ?? EDGE_COLOR[f.edge],
    trimColors: f.trimColors?.length ? [...f.trimColors] : [...TRIM_COLORS[trim]],
    cornerColors: f.cornerColors?.length ? [...f.cornerColors] : [...CORNER_COLORS[corners]],
  };
}

// ---------------------------------------------------------------- ambient
/** Silent background animation, drawn on one canvas between the scene and the content. */
export const AMBIENT_PRESETS = ['none', 'snowfall', 'leaves'] as const;
export type AmbientPreset = (typeof AMBIENT_PRESETS)[number];
export const AMBIENT_SPEEDS = ['slow', 'medium', 'fast'] as const;
export type AmbientSpeed = (typeof AMBIENT_SPEEDS)[number];
export const AMBIENT_SIZES = ['small', 'mixed', 'large'] as const;
export type AmbientSize = (typeof AMBIENT_SIZES)[number];
/** Fall speed in CSS pixels per second (before the per-particle variation). */
export const AMBIENT_SPEED_PX: Record<AmbientSpeed, number> = { slow: 22, medium: 40, fast: 64 };
/** Particle radius range in CSS pixels. */
export const AMBIENT_SIZE_PX: Record<AmbientSize, readonly [number, number]> = { small: [1.5, 3], mixed: [1.5, 5], large: [3.5, 6] };
/** Colours when the theme names none. */
export const AMBIENT_COLORS: Record<AmbientPreset, readonly ColorToken[]> = { none: ['surface'], snowfall: ['surface'], leaves: ['deco-1', 'deco-2', 'deco-3'] };

export interface AmbientSpec {
  preset: AmbientPreset;
  density: number;
  speed: AmbientSpeed;
  color?: ColorToken;
  size: AmbientSize;
}

// ---------------------------------------------------------------- sets
/** A frame drawn around the existing badge art; the tier keeps its shape and its word. */
export const ACHIEVEMENT_FRAMES = ['classic', 'ornament', 'snowflake', 'star', 'shield'] as const;
export type AchievementFrame = (typeof ACHIEVEMENT_FRAMES)[number];

export interface ThemeSetsSpec {
  achievementFrame: AchievementFrame;
  /** Only reorders the avatar picker; nothing is hidden and stored avatars never change. */
  avatarFamiliesFirst: readonly CreatureFamily[];
  /** Whose mascot to use when the package has no mascot art. */
  mascotFrom?: BuiltinThemeKey;
}

/** Creature families in picker order: the theme's first ones, then the rest in catalogue order. */
export function orderFamilies<F extends string>(all: readonly F[], first: readonly string[] | undefined): F[] {
  const lead = (first ?? []).filter((f): f is F => (all as readonly string[]).includes(f));
  return [...new Set([...lead, ...all])];
}

/**
 * Ready-made avatars in picker order: creatures of the theme's first families first (in that order),
 * then everything else in its catalogue order. Only the order changes; every item stays.
 */
export function orderByFamilies<T extends { type: string; family?: string }>(items: readonly T[], first: readonly string[] | undefined): T[] {
  if (!first?.length) return [...items];
  const rank = (it: T) => {
    const i = it.type === 'creature' && it.family !== undefined ? first.indexOf(it.family) : -1;
    return i === -1 ? first.length : i;
  };
  return items.map((it, i) => ({ it, i, r: rank(it) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.it);
}
