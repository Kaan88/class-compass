/**
 * Theme vocabulary shared by the client theme registry, the theme package validator (server, admin
 * preview, MCP) and the generated docs (S14g, D-158). Moved here from `client/themes/types.ts`, which
 * re-exports everything, so existing imports keep working.
 *
 * `TOKEN_DOCS` says what every colour token is for; `scripts/theme-docs.ts` turns it into the token
 * table in docs/THEMING.md (drift-tested). A new token needs an entry (type-checked).
 */

/** Semantic colour tokens, emitted as `--cc-<name>`. Values are colour literals (hex). */
export const COLOR_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'text',
  'text-muted',
  'border',
  'border-strong',
  'accent',
  'accent-strong',
  'accent-soft',
  'accent-text',
  'focus',
  'success',
  'success-soft',
  'warning',
  'warning-soft',
  'danger',
  'danger-strong',
  'danger-soft',
  'on-strong',
  'overlay',
  'shadow-color',
  // "visible on the classroom display" banner (PIN-5)
  'display-banner-bg',
  'display-banner-text',
  'display-banner-border',
  // counter depth levels neutral → amber → deeper amber → red (CNT-6), always with numbers + words
  'level-0',
  'level-1',
  'level-2',
  'level-3',
  'level-edge-0',
  'level-edge-1',
  'level-edge-2',
  'level-edge-3',
  // counter colour keys (CNT-12): teachers pick a name, never a raw colour
  'counter-accent',
  'counter-accent-edge',
  'counter-teal',
  'counter-teal-edge',
  'counter-plum',
  'counter-plum-edge',
  'counter-rust',
  'counter-rust-edge',
  'counter-leaf',
  'counter-leaf-edge',
  'counter-berry',
  'counter-berry-edge',
  'segment-on',
  'segment-off',
  'avatar-text',
  // icon accent (menu tiles, illustrations' line work)
  'icon-accent',
  // decorations, background pattern, mascot and illustrations (always subtle)
  'deco-1',
  'deco-2',
  'deco-3',
  'pattern',
  'mascot-body',
  'mascot-belly',
  'mascot-accent',
  'mascot-ink',
  'mascot-cheek',
  'art-sky',
  'art-ground',
  'art-light',
  // avatars and badges (S13c, D-124): named colours, skin tones and hair colours only; never raw colours in specs
  'avatar-red',
  'avatar-orange',
  'avatar-yellow',
  'avatar-green',
  'avatar-teal',
  'avatar-blue',
  'avatar-navy',
  'avatar-purple',
  'avatar-pink',
  'avatar-brown',
  'avatar-grey',
  'avatar-mint',
  'avatar-skin-1',
  'avatar-skin-2',
  'avatar-skin-3',
  'avatar-skin-4',
  'avatar-skin-5',
  'avatar-skin-6',
  'avatar-skin-7',
  'avatar-skin-8',
  'avatar-skin-9',
  'avatar-skin-10',
  'avatar-skin-11',
  'avatar-skin-12',
  'avatar-hair-black',
  'avatar-hair-darkBrown',
  'avatar-hair-brown',
  'avatar-hair-auburn',
  'avatar-hair-ginger',
  'avatar-hair-blonde',
  'avatar-hair-lightBlonde',
  'avatar-hair-grey',
  'avatar-hair-white',
  'avatar-hair-blue',
  'avatar-hair-pink',
  'avatar-hair-purple',
  'avatar-ink',
  'avatar-outline',
  'avatar-white',
  'avatar-blush',
  'badge-bronze',
  'badge-silver',
  'badge-gold',
  'badge-plain',
  'badge-ink',
  'badge-shine',
  // printed QR cards (S13b2, D-120): always pure black on white, the same in every theme
  'print-ink',
  'print-paper',
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ThemeColors = Record<ColorToken, string>;

/** Tokens no theme (built-in or package) may change: printed QR codes scan best as pure black on white (D-120). */
export const FIXED_COLOR_TOKENS = ['print-ink', 'print-paper'] as const satisfies readonly ColorToken[];
export type FixedColorToken = (typeof FIXED_COLOR_TOKENS)[number];
/** The colour tokens a theme package lists: every token except the fixed print colours. */
export const PACKAGE_COLOR_TOKENS = COLOR_TOKENS.filter((t): t is Exclude<ColorToken, FixedColorToken> => !(FIXED_COLOR_TOKENS as readonly string[]).includes(t));
export type PackageColorToken = (typeof PACKAGE_COLOR_TOKENS)[number];
export const isColorToken = (v: string): v is ColorToken => (COLOR_TOKENS as readonly string[]).includes(v);

export const MASCOT_POSES = ['idle', 'cheer', 'thinking', 'celebrate', 'sleepy'] as const;
export type MascotPose = (typeof MASCOT_POSES)[number];

export const ILLUSTRATIONS = ['lockScreen', 'emptyState', 'threshold', 'startLesson', 'endLesson', 'celebration'] as const;
export type IllustrationName = (typeof ILLUSTRATIONS)[number];

export const MOTIONS = ['celebrate', 'threshold'] as const;
export type MotionName = (typeof MOTIONS)[number];

/**
 * The theme sound pack (S13b, D-110): one short synthesized cue per classroom event. Every theme
 * fills all of them (usually with `makeSoundPack`); the SoundManager plays them with the class
 * volume, priorities and ducking. Callers name the event, never a sound.
 */
export const SOUND_EVENTS = [
  'tap',
  'undo',
  'stageChange',
  'timeUp',
  'thresholdReached',
  'assistantCheck',
  'groupShuffle',
  'secretDrumroll',
  'secretReveal',
  'fanfare',
  'clapping',
  'fireworks',
  'pointAwarded',
  'softChime',
  // S14a (D-145)
  'lessonStart',
  'lessonEnd',
  'timerStart',
  'groupMove',
  'achievementGiven',
  'soundTest',
] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number];

/** A short synthesized note (WebAudio): no audio files are shipped. */
export interface ToneNote {
  /** Frequency in Hz (for 'noise': the centre of the band-pass filter). */
  freq: number;
  /** Optional glide: the frequency reached at the end of the note. */
  to?: number;
  /** Start offset in ms. */
  at: number;
  /** Length in ms. */
  dur: number;
  /** 'noise' is filtered white noise (claps, drum rolls, firework crackle). */
  type: 'sine' | 'triangle' | 'square' | 'noise';
  /** Peak gain 0..0.3 (gentle); scaled by the class volume. */
  gain: number;
}
export type SoundSpec = readonly ToneNote[];
export type ThemeSoundPack = Record<SoundEvent, SoundSpec>;

/** Groups of the token table in docs/THEMING.md. */
export const TOKEN_GROUPS = {
  page: 'Page, cards and text',
  accent: 'Accent, focus and status',
  banner: 'Display banner (PIN-5)',
  levels: 'Counter levels (CNT-6)',
  counters: 'Counter colours (CNT-12)',
  art: 'Icons, decoration, mascot and illustrations',
  avatars: 'Avatars (S13c)',
  badges: 'Achievements (S13c)',
  print: 'Printed cards (fixed)',
} as const;
export type TokenGroup = keyof typeof TOKEN_GROUPS;

export interface TokenDoc {
  group: TokenGroup;
  use: string;
}

const counterDoc = <N extends string>(name: N) =>
  ({
    [`counter-${name}`]: { group: 'counters', use: `Counter colour "${name}": bar segments and the counter's chip.` },
    [`counter-${name}-edge`]: { group: 'counters', use: `Edge and pressed state of counter colour "${name}".` },
  }) as Record<`counter-${N}` | `counter-${N}-edge`, TokenDoc>;
const AVATAR_COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'navy', 'purple', 'pink', 'brown', 'grey', 'mint'] as const;
const HAIR = ['black', 'darkBrown', 'brown', 'auburn', 'ginger', 'blonde', 'lightBlonde', 'grey', 'white', 'blue', 'pink', 'purple'] as const;

/** What every colour token is for (the generated token table). */
export const TOKEN_DOCS: Record<ColorToken, TokenDoc> = {
  bg: { group: 'page', use: 'Page background. Classroom text on it needs 7:1 (AAA).' },
  surface: { group: 'page', use: 'Cards, dialogs and inputs. Classroom text on it needs 7:1 (AAA).' },
  'surface-2': { group: 'page', use: 'Secondary surfaces: table stripes, panels inside cards, the empty counter segment.' },
  text: { group: 'page', use: 'Body and classroom text.' },
  'text-muted': { group: 'page', use: 'Hints and secondary text (4.5:1 on bg, surface and surface-2).' },
  border: { group: 'page', use: 'Quiet dividers and card outlines (decorative, no contrast rule).' },
  'border-strong': { group: 'page', use: 'Borders of inputs and controls (3:1 on surface).' },
  accent: { group: 'accent', use: 'Primary buttons, selected states, links; the default counter colour and bar segment.' },
  'accent-strong': { group: 'accent', use: 'Pressed primary buttons and accent text on the page and cards.' },
  'accent-soft': { group: 'accent', use: 'Selected rows, active navigation, soft accent backgrounds.' },
  'accent-text': { group: 'accent', use: 'Text on accent and accent-strong (primary button labels).' },
  focus: { group: 'accent', use: 'Keyboard focus ring (3:1 on bg and surface).' },
  success: { group: 'accent', use: 'Success text and chips.' },
  'success-soft': { group: 'accent', use: 'Success alert background.' },
  warning: { group: 'accent', use: 'Warning text and icons.' },
  'warning-soft': { group: 'accent', use: 'Warning alert background.' },
  danger: { group: 'accent', use: 'Error text and destructive buttons.' },
  'danger-strong': { group: 'accent', use: 'Pressed destructive buttons.' },
  'danger-soft': { group: 'accent', use: 'Error alert background.' },
  'on-strong': { group: 'accent', use: 'Text on danger and success fills.' },
  overlay: { group: 'page', use: 'Dim layer behind dialogs (may be translucent, #rrggbbaa).' },
  'shadow-color': { group: 'page', use: 'Colour of card and dialog shadows (usually translucent).' },
  'display-banner-bg': { group: 'banner', use: 'Background of the "visible on the classroom display" banner.' },
  'display-banner-text': { group: 'banner', use: 'Text of the display banner (4.5:1 on its background).' },
  'display-banner-border': { group: 'banner', use: 'Border of the display banner.' },
  'level-0': { group: 'levels', use: 'Student card level 0 (no reminders): neutral.' },
  'level-1': { group: 'levels', use: 'Student card level 1: light amber. Always shown with number, pattern and word.' },
  'level-2': { group: 'levels', use: 'Student card level 2: deeper amber.' },
  'level-3': { group: 'levels', use: 'Student card level 3: soft red.' },
  'level-edge-0': { group: 'levels', use: 'Edge of a level 0 card.' },
  'level-edge-1': { group: 'levels', use: 'Edge of a level 1 card.' },
  'level-edge-2': { group: 'levels', use: 'Edge of a level 2 card.' },
  'level-edge-3': { group: 'levels', use: 'Edge of a level 3 card.' },
  ...counterDoc('accent'),
  ...counterDoc('teal'),
  ...counterDoc('plum'),
  ...counterDoc('rust'),
  ...counterDoc('leaf'),
  ...counterDoc('berry'),
  'segment-on': { group: 'counters', use: 'Filled segment of the class counter bar (3:1 on surface).' },
  'segment-off': { group: 'counters', use: 'Empty segment of the class counter bar.' },
  'avatar-text': { group: 'avatars', use: 'Initials on generated avatar circles (checked over every hue).' },
  'icon-accent': { group: 'art', use: 'Menu tile icons and line work in illustrations (3:1 on surface).' },
  'deco-1': { group: 'art', use: 'Decoration and illustration colour 1.' },
  'deco-2': { group: 'art', use: 'Decoration and illustration colour 2.' },
  'deco-3': { group: 'art', use: 'Decoration and illustration colour 3.' },
  pattern: { group: 'art', use: 'Lines of the faint background pattern (drawn at patternOpacity).' },
  'mascot-body': { group: 'art', use: 'Mascot body.' },
  'mascot-belly': { group: 'art', use: 'Mascot belly, eye whites and light parts.' },
  'mascot-accent': { group: 'art', use: 'Mascot hat, compass, scarf and other accents.' },
  'mascot-ink': { group: 'art', use: 'Mascot eyes, mouth and outlines.' },
  'mascot-cheek': { group: 'art', use: 'Mascot cheeks (drawn translucent).' },
  'art-sky': { group: 'art', use: 'Illustration sky.' },
  'art-ground': { group: 'art', use: 'Illustration ground.' },
  'art-light': { group: 'art', use: 'Illustration sun, lamp and highlights.' },
  ...(Object.fromEntries(AVATAR_COLOURS.map((c) => [`avatar-${c}`, { group: 'avatars', use: `Avatar colour "${c}" (clothes, creature bodies, backgrounds).` }])) as Record<`avatar-${(typeof AVATAR_COLOURS)[number]}`, TokenDoc>),
  ...(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`avatar-skin-${i + 1}`, { group: 'avatars', use: `Skin tone ${i + 1} of 12 (keep the 12 a wide, realistic range, light to dark).` }])) as Record<Extract<ColorToken, `avatar-skin-${string}`>, TokenDoc>),
  ...(Object.fromEntries(HAIR.map((h) => [`avatar-hair-${h}`, { group: 'avatars', use: `Hair colour "${h}".` }])) as Record<`avatar-hair-${(typeof HAIR)[number]}`, TokenDoc>),
  'avatar-ink': { group: 'avatars', use: 'Avatar eyes, mouths and fine lines.' },
  'avatar-outline': { group: 'avatars', use: 'Thin avatar outlines (usually translucent ink).' },
  'avatar-white': { group: 'avatars', use: 'Eye whites, teeth and highlights in avatars.' },
  'avatar-blush': { group: 'avatars', use: 'Avatar cheeks.' },
  'badge-bronze': { group: 'badges', use: 'Bronze achievement frame.' },
  'badge-silver': { group: 'badges', use: 'Silver achievement frame.' },
  'badge-gold': { group: 'badges', use: 'Gold achievement frame.' },
  'badge-plain': { group: 'badges', use: 'Special (untiered) achievement frame.' },
  'badge-ink': { group: 'badges', use: 'Achievement glyph and outline (3:1 on every frame fill).' },
  'badge-shine': { group: 'badges', use: 'Highlight on achievement frames.' },
  'print-ink': { group: 'print', use: 'Printed QR codes and cut lines: always black, the same in every theme (D-120).' },
  'print-paper': { group: 'print', use: 'Printed card paper: always white, the same in every theme (D-120).' },
};
