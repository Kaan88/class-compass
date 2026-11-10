/**
 * `npm run docs:theming` (S14g, D-158, D-159): writes the generated parts of the theming docs.
 * - `docs/theme-package.schema.json`: the JSON Schema of a theme package (from the shared zod schema);
 * - the token table in docs/THEMING.md (every colour token, what it is for, its contrast rules and the
 *   value in each built-in theme), between the `tokens` markers;
 * - the limits table in docs/THEMING.md (from `shared/themePackage/limits.ts`), between the `limits` markers.
 * `tests/docs/theming.test.ts` fails when the files differ from what this script would write, so the
 * docs cannot drift from the code. `--check` only reports.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_KEYS } from '../src/shared/themes.ts';
import { CONTRAST_PAIRS } from '../src/shared/themePackage/contrast.ts';
import {
  ACHIEVEMENT_FRAMES,
  AMBIENT_PRESETS,
  AMBIENT_SIZES,
  AMBIENT_SPEEDS,
  CORNER_COLORS,
  DEFAULT_FRAME_SURFACES,
  DEFAULT_TRIM_ON,
  EDGE_COLOR,
  FRAME_CORNERS,
  FRAME_EDGES,
  FRAME_SURFACES,
  FRAME_TRIMS,
  SCENE_ANCHORS,
  SCENE_FITS,
  SCENE_SMALL_SCREENS,
  TRIM_COLORS,
} from '../src/shared/themePackage/engine.ts';
import { AMBIENT_LIMITS, ART_LIMITS, FRAME_LIMITS, MOTION_LIMITS, PACKAGE_LIMITS, SCENE_LIMITS, SETS_LIMITS, SOUND_LIMITS, SOUND_PARAM_LIMITS, STYLE_LIMITS } from '../src/shared/themePackage/limits.ts';
import { themePackageJsonSchema } from '../src/shared/themePackage/schema.ts';
import { COLOR_TOKENS, FIXED_COLOR_TOKENS, TOKEN_DOCS, TOKEN_GROUPS, type ColorToken, type TokenGroup } from '../src/shared/themePackage/tokens.ts';

const ROOT = join(import.meta.dirname, '..');
export const THEMING_MD = join(ROOT, 'docs', 'THEMING.md');
export const SCHEMA_JSON = join(ROOT, 'docs', 'theme-package.schema.json');

const begin = (name: string) => `<!-- BEGIN GENERATED ${name} (npm run docs:theming; do not edit by hand) -->`;
const end = (name: string) => `<!-- END GENERATED ${name} -->`;

/** The built-in themes' colours (their token sheets are plain TypeScript, so this runs in Node). */
export async function builtinColors(): Promise<Record<string, Record<ColorToken, string>>> {
  const out: Record<string, Record<ColorToken, string>> = {};
  for (const key of THEME_KEYS) {
    const mod = (await import(`../src/client/themes/${key}/tokens.ts`)) as { colors: Record<ColorToken, string> };
    out[key] = mod.colors;
  }
  return out;
}

function contrastOf(token: ColorToken): string {
  const rules = CONTRAST_PAIRS.filter((p) => p.fg === token || p.bg === token).map((p) => (p.fg === token ? `on ${p.bg} ≥ ${p.min}` : `under ${p.fg} ≥ ${p.min}`));
  if (token === 'avatar-text') rules.push('on every avatar hue ≥ 3 (big) / 4.5 (small)');
  return rules.length ? rules.join('; ') : '–';
}

export function renderTokenTable(colors: Record<string, Record<ColorToken, string>>): string {
  const keys = Object.keys(colors);
  const lines: string[] = [begin('tokens'), ''];
  lines.push(`${COLOR_TOKENS.length} colour tokens, emitted as \`--cc-<token>\`. Contrast rules use WCAG ratios (\`fg on bg ≥ min\`). Values are those of the built-in themes.`);
  for (const group of Object.keys(TOKEN_GROUPS) as TokenGroup[]) {
    const tokens = COLOR_TOKENS.filter((t) => TOKEN_DOCS[t].group === group);
    if (!tokens.length) continue;
    lines.push('', `#### ${TOKEN_GROUPS[group]}`, '', `| Token | Used for | Contrast | ${keys.join(' | ')} |`, `|---|---|---|${keys.map(() => '---').join('|')}|`);
    for (const t of tokens) {
      const fixed = (FIXED_COLOR_TOKENS as readonly string[]).includes(t) ? ' (fixed, not in packages)' : '';
      lines.push(`| \`${t}\` | ${TOKEN_DOCS[t].use}${fixed} | ${contrastOf(t)} | ${keys.map((k) => `\`${colors[k]![t]}\``).join(' | ')} |`);
    }
  }
  lines.push('', end('tokens'));
  return lines.join('\n');
}

const r = (x: readonly [number, number], unit = '') => `${x[0]}–${x[1]}${unit}`;
export function renderLimits(): string {
  const S = SOUND_LIMITS;
  const rows: Array<[string, string]> = [
    ['Package file', `≤ ${PACKAGE_LIMITS.maxBytes / 1024} KB; names ≤ ${PACKAGE_LIMITS.nameMax} characters, descriptions ≤ ${PACKAGE_LIMITS.descriptionMax}; at most ${PACKAGE_LIMITS.maxCustomThemes} imported themes per school`],
    ['One SVG picture', `≤ ${ART_LIMITS.svgMaxNodes} elements, ≤ ${ART_LIMITS.svgMaxBytes / 1024} KB, groups nested ≤ ${ART_LIMITS.svgMaxDepth} deep`],
    ['Decoration / pattern opacity', `≤ ${ART_LIMITS.decoOpacityMax} / ≤ ${ART_LIMITS.patternOpacityMax}; pattern tile ${r(ART_LIMITS.patternSize, ' px')}`],
    ['Motion', `${MOTION_LIMITS.minMs}–${MOTION_LIMITS.maxMs} ms, plays once, opacity turns at most ${MOTION_LIMITS.maxOpacityTurns}×; reduced motion = fade only`],
    ['Sound cue length', `≤ ${S.shortCueMaxMs} ms; ${S.longEvents.join(', ')} ≤ ${S.longCueMaxMs} ms; ≤ ${S.maxNotesPerCue} notes`],
    ['Sound note', `gain ≤ ${S.noteGainCap}; tones ${S.toneMinHz}–${S.toneMaxHz} Hz (a glide may end at ≤ ${S.glideMaxHz} Hz); noise band ≤ ${S.noiseMaxHz} Hz`],
    ['Loudness', `a tap at class volume 80 peaks between ${S.tapPeakDbAt80[0]} and ${S.tapPeakDbAt80[1]} dBFS; no cue reaches ${S.clipDbAt100} dBFS at volume 100`],
    ['Sound parameters', `root ${r(SOUND_PARAM_LIMITS.rootHz, ' Hz')}, gain ${r(SOUND_PARAM_LIMITS.gain)}, tempo ${r(SOUND_PARAM_LIMITS.tempo)}`],
    ['Typography', `weights ${r(STYLE_LIMITS.weight)}; letter-spacing ${r(STYLE_LIMITS.trackingEm, ' em')}; system font presets only`],
    ['Shape', `radius ${r(STYLE_LIMITS.radiusRem, ' rem')} (small ${r(STYLE_LIMITS.radiusSmRem, ' rem')}); borders ${r(STYLE_LIMITS.borderPx, ' px')} (strong ${r(STYLE_LIMITS.borderStrongPx, ' px')}); shadow presets only`],
    ['Icons and avatars', `icon stroke ${r(STYLE_LIMITS.iconStroke)}; avatar saturation ${r(STYLE_LIMITS.avatarSaturation, ' %')}, lightness ${r(STYLE_LIMITS.avatarLightness, ' %')}`],
    ['Celebration colours', `${r(PACKAGE_LIMITS.celebrationColors)} colour tokens`],
    [
      'Scene (S17a)',
      `${r(SCENE_LIMITS.layers)} layers; each ≤ ${SCENE_LIMITS.svgMaxNodes} elements, ≤ ${SCENE_LIMITS.svgMaxBytes / 1024} KB, groups nested ≤ ${SCENE_LIMITS.svgMaxDepth} deep; opacity ${r(SCENE_LIMITS.opacity)}; maxHeightVh ${r(SCENE_LIMITS.maxHeightVh)}`,
    ],
    ['Frames (S17a)', `presets only; trimColors ${r(FRAME_LIMITS.trimColors)} colour tokens, cornerColors ${r(FRAME_LIMITS.cornerColors)}`],
    ['Ambient (S17a)', `density ${r(AMBIENT_LIMITS.density)} particles on 1920×1080 (fewer on smaller screens); ≤ ${AMBIENT_LIMITS.maxFps} frames a second; one still frame without full motion`],
    ['Sets (S17a)', `avatarFamiliesFirst ${r(SETS_LIMITS.avatarFamiliesFirst)} families`],
  ];
  return [begin('limits'), '', '| What | Limit |', '|---|---|', ...rows.map(([a, b]) => `| ${a} | ${b} |`), '', end('limits')].join('\n');
}

const names = (list: readonly string[]) => list.map((x) => `\`${x}\``).join(', ');

/** The theme engine presets (S17a, D-166) with their default colour tokens. */
export function renderEngine(): string {
  const rows: Array<[string, string]> = [
    ['`scene.layers[].fit`', names(SCENE_FITS)],
    ['`scene.layers[].anchor`', names(SCENE_ANCHORS)],
    ['`scene.smallScreens`', names(SCENE_SMALL_SCREENS)],
    ['`frame.edge` (default `snowColor`)', FRAME_EDGES.map((e) => `\`${e}\` (${EDGE_COLOR[e]})`).join(', ')],
    ['`frame.trim` (default `trimColors`)', FRAME_TRIMS.map((t) => `\`${t}\` (${TRIM_COLORS[t].join(', ')})`).join('; ')],
    ['`frame.corners` (default `cornerColors`)', FRAME_CORNERS.map((c) => `\`${c}\` (${CORNER_COLORS[c].join(', ')})`).join('; ')],
    ['`frame.apply`', `${names(FRAME_SURFACES)}; default ${names(DEFAULT_FRAME_SURFACES)}`],
    ['`frame.trimOn`', `board box keys; default ${names(DEFAULT_TRIM_ON)}`],
    ['`ambient.preset`', names(AMBIENT_PRESETS)],
    ['`ambient.speed` / `ambient.size`', `${names(AMBIENT_SPEEDS)} / ${names(AMBIENT_SIZES)}`],
    ['`sets.achievementFrame`', names(ACHIEVEMENT_FRAMES)],
  ];
  return [begin('engine'), '', '| Field | Presets |', '|---|---|', ...rows.map(([a, b]) => `| ${a} | ${b} |`), '', end('engine')].join('\n');
}

export const renderSchema = () => `${JSON.stringify(themePackageJsonSchema(), null, 2)}\n`;

/** THEMING.md with its generated blocks replaced. */
export function renderThemingMd(current: string, colors: Record<string, Record<ColorToken, string>>): string {
  const swap = (text: string, name: string, block: string) => {
    const a = text.indexOf(begin(name));
    const b = text.indexOf(end(name));
    if (a === -1 || b === -1 || b < a) throw new Error(`docs/THEMING.md has no ${name} markers`);
    return text.slice(0, a) + block + text.slice(b + end(name).length);
  };
  return swap(swap(swap(current, 'tokens', renderTokenTable(colors)), 'limits', renderLimits()), 'engine', renderEngine());
}

if (import.meta.main) {
  const check = process.argv.includes('--check');
  const colors = await builtinColors();
  const md = readFileSync(THEMING_MD, 'utf8');
  const nextMd = renderThemingMd(md, colors);
  const nextSchema = renderSchema();
  let schemaNow = '';
  try {
    schemaNow = readFileSync(SCHEMA_JSON, 'utf8');
  } catch {
    /* first run */
  }
  const stale = [nextMd !== md ? 'docs/THEMING.md' : null, nextSchema !== schemaNow ? 'docs/theme-package.schema.json' : null].filter(Boolean);
  if (check) {
    if (stale.length) {
      console.error(`Out of date: ${stale.join(', ')}. Run npm run docs:theming.`);
      process.exit(1);
    }
    console.log('Theming docs are up to date.');
  } else {
    writeFileSync(THEMING_MD, nextMd);
    writeFileSync(SCHEMA_JSON, nextSchema);
    console.log(stale.length ? `Updated ${stale.join(', ')}.` : 'Theming docs were already up to date.');
  }
}
