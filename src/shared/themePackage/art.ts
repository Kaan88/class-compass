/**
 * What a page needs to draw a stored theme package (S26c, D-191): its complete colour set and its art
 * through the SVG sanitiser. Split from `validate.ts` so the pages that only show an imported theme (the
 * student page, the board, the scorer, the classroom) do not load the validation report, the contrast
 * checks and the sound limits; `validate.ts` re-exports everything here.
 */
import { SCENE_LIMITS } from './limits.ts';
import type { ThemePackage } from './schema.ts';
import { parseSvg, type SvgNode } from './svg.ts';
import { DERIVED_PACKAGE_TOKENS, FIXED_COLOR_TOKENS, ILLUSTRATIONS, MASCOT_POSES, type IllustrationName, type MascotPose, type ThemeColors } from './tokens.ts';

/** The fixed print colours (D-120), the same in every theme. */
export const FIXED_COLORS: Record<(typeof FIXED_COLOR_TOKENS)[number], string> = { 'print-ink': '#000000', 'print-paper': '#ffffff' };

/** A package's complete colour set (the fixed print colours added). */
export const packageColors = (pkg: Pick<ThemePackage, 'colors'>): ThemeColors => ({ ...derivedColors(pkg.colors), ...pkg.colors, ...FIXED_COLORS }) as ThemeColors;

/**
 * Values of the optional package tokens a package left out (S17a: `scene-scrim` = its own `surface`).
 * Only tokens whose source colour the package has are returned.
 */
export function derivedColors(colors: Partial<Record<string, string | undefined>>): Partial<ThemeColors> {
  const out: Partial<Record<string, string>> = {};
  for (const [token, from] of Object.entries(DERIVED_PACKAGE_TOKENS)) {
    const v = colors[from];
    if (colors[token] === undefined && v !== undefined) out[token] = v;
  }
  return out as Partial<ThemeColors>;
}

/** Parses one scene layer with the scene limits (S17a). */
export const parseSceneSvg = (src: string) => parseSvg(src, { maxNodes: SCENE_LIMITS.svgMaxNodes, maxBytes: SCENE_LIMITS.svgMaxBytes, maxDepth: SCENE_LIMITS.svgMaxDepth });

/** The parsed art of a package: only pictures that pass the sanitiser (the rest come from the base theme). */
export interface PackageArt {
  mascot: Record<MascotPose, SvgNode[]> | null;
  illustrations: Partial<Record<IllustrationName, SvgNode[]>>;
  decoration: SvgNode[] | null;
  pattern: SvgNode[] | null;
  /** S17a: every scene layer's tree, or null when there is no scene or a layer does not pass. */
  scene: SvgNode[][] | null;
}

export function packageArt(pkg: Pick<ThemePackage, 'art'> & Partial<Pick<ThemePackage, 'scene'>>): PackageArt {
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
    scene: sceneTrees(pkg.scene),
  };
}

function sceneTrees(scene: ThemePackage['scene']): SvgNode[][] | null {
  if (!scene) return null;
  const out: SvgNode[][] = [];
  for (const layer of scene.layers) {
    const r = parseSceneSvg(layer.art);
    if (!r.ok) return null;
    out.push(r.nodes);
  }
  return out;
}
