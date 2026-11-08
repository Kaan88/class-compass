# Theming guide (for agents and developers)

How the classroom looks and sounds, and how to change it safely. Written so an AI agent can make a
new theme, a new sound cue or a new celebration in one pass. Decisions: D-070 (theme registry),
D-105 (teachers choose their class display), D-110 (sound packs, SoundManager, celebrations).
For adding a theme step by step (scaffold, checklist) see [EXTENDING.md](EXTENDING.md#add-a-theme).

## The model in one paragraph

A theme is **one TypeScript object** (`ThemeDefinition`, `src/client/themes/types.ts`) in its own
folder `src/client/themes/<key>/`, listed in `src/client/themes/registry.ts` and in `THEME_KEYS`
(`src/shared/themes.ts`). It fills every slot: colour tokens, typography, shape, avatar, icons, mascot
(5 poses), decoration, pattern, 6 illustrations, 2 motions, a **sound pack** and **celebration
colours**. Components never branch on the theme key: they use CSS variables (`var(--cc-*)`) and the
helpers in `src/client/themes/index.tsx`. A theme changes how things look and sound, never what
they mean (THM-3).

## Where the active theme comes from

| Screen | Theme |
|---|---|
| Classroom display | the class's `theme` (set by its teachers in Class settings, or by an admin) |
| Teacher and admin pages, sign-in | `DEFAULT_THEME` |
| Previews, catalogue | the nearest `ThemeProvider` / `ThemeScope` |

`setDisplay()` (`src/client/lib/display.ts`) holds the classroom's display state: theme, the class
switches (animations, sounds), the device sound switch, the class volume and the time's-up choice.

## Slots and limits (test-enforced in `tests/client/themes.test.tsx`)

| Slot | Rules |
|---|---|
| `colors` | Every `COLOR_TOKENS` entry, hex. WCAG pairs from `contrast.ts` (AA body, AAA classroom text, 3:1 UI). Literals only in `base.ts` and `<theme>/tokens.ts`. |
| `Mascot` | 100×100 SVG, poses `idle`, `cheer`, `thinking`, `celebrate`, `sleepy`, all different. Coloured with `var(--cc-mascot-*)`. |
| `illustrations` | 200×140, decorative. |
| `motion` | `celebrate`, `threshold`: `full` (150–1500 ms, plays once) and `reduced` (opacity only). |
| `sounds` | A full `ThemeSoundPack` (one cue per event below) or `null` (silent theme). Short cues ≤ 1.2 s, celebration and time's-up cues ≤ 2.5 s, gain ≤ 0.3, tones 150–2500 Hz, noise band ≤ 5 kHz. |
| `celebration.colors` | 2+ colour tokens used for the fireworks (read from the CSS variables at run time). |
| `colors` → avatars (S13c) | `avatar-<colour>` (12 catalogue colours), `avatar-skin-1`…`avatar-skin-12`, `avatar-hair-<colour>`, `avatar-ink`, `avatar-outline`, `avatar-white`, `avatar-blush`. Every avatar part is drawn with these, so a theme restyles all 120+ ready-made avatars and every creator combination by changing tokens. Keep the 12 skin tones a wide, realistic range. |
| `colors` → badges (S13c) | `badge-bronze`, `badge-silver`, `badge-gold`, `badge-plain` (frame fills), `badge-ink` (glyph and outline, ≥ 3:1 on every fill, test-enforced) and `badge-shine`. The tier is always also shown by frame shape (circle, hexagon, rosette, rounded square) and written as a word, never colour alone. |

### Badge icons and avatars (S13c, D-124, D-125)

- **Add a badge icon:** add the key to `BADGE_ICONS` (`src/shared/achievements.ts`) and its 24×24 single-path glyph to `GLYPHS` (`src/client/achievements/icons.tsx`); the Record type and `tests/client/avatars-badges.test.tsx` make sure every key has a distinct glyph. Draw it yourself in the same line style (round caps, 1.8 stroke); never copy an icon set.
- **Add an avatar part:** add the option to `PERSON_PARTS` / `CREATURE_PARTS` (and `OPTION_NAMES` in EN and TR for the accessible name) in `src/shared/avatars.ts`, then draw it in `AvatarArt.tsx` with `var(--cc-avatar-*)` colours only, no ids, filters or `<image>`. The server validates specs against the same catalogue, so an unknown value is refused until it is added there. An option can unlock with a default badge through `AVATAR_UNLOCKS`.
- Theme-specific icon variants, frames or extra avatar families are not supported yet (ROADMAP S13c); a theme changes badges and avatars through the tokens above.

## Sound

### Events

`SOUND_EVENTS` in `types.ts`. Code names the **event**, never a sound:

| Event | Played when | Priority |
|---|---|---|
| `tap` | class counter tap, attendance tap | 1 |
| `pointAwarded` | a counter tap for one student | 1 |
| `undo` | undo of a tap or a shuffle | 1 |
| `stageChange` | routine stage changes | 2 |
| `groupShuffle` | groups shuffled | 2 |
| `assistantCheck` | an assistant duty ticked | 2 |
| `thresholdReached` | a tap that fills the class bar | 3 |
| `secretDrumroll`, `secretReveal` | Secret Student reveal show | 3 |
| `timeUp` | the timer ends and the class chose "chime" (or as the fallback) | 4 |
| `softChime` | the end of a celebration or reveal show with reduced motion or animations off | 2 |
| `fanfare`, `clapping`, `fireworks` | the end of the reveal show, celebrations (full motion only) | 4 |

### Making a pack

```ts
import { makeSoundPack } from '../soundPack.ts';

sounds: makeSoundPack(
  { root: 523, wave: 'triangle', scale: 'major', gain: 0.11, tempo: 1 },
  { timeUp: [{ freq: 660, at: 0, dur: 900, type: 'sine', gain: 0.15 }] }, // optional overrides
),
celebration: { colors: ['accent', 'deco-1', 'deco-2', 'deco-3', 'success'] },
```

- `root` (Hz) and `scale` (`major` bright, `pentatonic` playful) set the melody; `wave` the timbre
  (`sine` soft, `triangle` warm, `square` buzzy — use sparingly); `tempo` > 1 is snappier; `gain` 0.05–0.2.
- A `ToneNote` is `{ freq, to?, at, dur, type, gain }`: `to` glides the pitch; `type: 'noise'` is
  band-passed white noise centred on `freq` (claps ~1.4–2.3 kHz, drums ~250–350 Hz, crackle ~3 kHz).
- Everything is synthesized. **Never add audio files** to a theme; if a recorded sound is ever
  needed it must be CC0 and listed in [ASSETS.md](ASSETS.md) with its source and licence.

### Playing

- In components: `const play = useThemeSound(); play('groupShuffle')`.
- Outside components (command senders): `playEvent('tap')` from `src/client/themes/index.tsx`.
- With an explicit display state (previews, "Try" buttons): `playThemeSound(display, theme, name)`.

All three go through the **SoundManager** (`src/client/themes/soundManager.ts`): one AudioContext,
unlocked on the first tap or key press (`installSoundUnlock()` in `main.tsx`), the class volume on a
master gain, mute when the class or device switch is off, priorities with ducking (a louder cue
lowers quieter ones to 30 %, a quiet cue under a loud one starts at 30 %), taps closer than 50 ms
merged. Never create an `AudioContext` or call `speechSynthesis` from a component.

### Time's up

`modules/lessons/timeUp.ts`: `planTimeUp(setting, can)` decides voice / clip / chime / none
(fallbacks: no English voice → chime, no clip → chime, sounds off → none); `announceTimeUp()` plays
it. The teacher's clip is fetched ahead with `preloadTimeUp()` when the class is opened.

## Celebration

`celebrate(message?)` from `src/client/themes/Celebration.tsx`, mounted once (`<CelebrationLayer/>` in
the root layout):

| Class animations | OS reduced motion | What shows |
|---|---|---|
| on | no | full-screen mascot (`celebrate` pose + `celebrate` motion), canvas fireworks in `celebration.colors`, ~2.5 s |
| on | yes | mascot and still stars, opacity fade only (`cc-motion-reduced`) |
| off | — | nothing on screen |

Sounds come from `celebrationCues(mode)` in `src/client/themes/sequences.ts`: fanfare, then clapping
and fireworks with full motion; one `softChime` with reduced motion or animations off. They follow the
sound switches in every row. The overlay has
`pointer-events: none` and `role="status"` with the message, so it never blocks the teacher.

The Secret Student reveal (`modules/secret/SecretPanel.tsx`) is a sequence built the same way: a
state machine (countdown 3-2-1 → drum roll → cards one by one → fanfare) driven by timeouts, with a
"Show at once" button; with animations off it is skipped. Its cues come from `revealCue(mode, step)`:
the full show with full motion, only a closing `softChime` otherwise. A new sequence should get its
cues from a function in `sequences.ts` too, so reduced motion is handled in one place.

## Recipes for agents

**New theme** — `npm run new:theme -- <key>`, then edit `tokens.ts` (colours: keep contrast),
`art.tsx` (mascot poses, illustrations; only `tok('…')` colours), `index.ts` (motion, `makeSoundPack`
options, celebration colours). Run `npm run check` and `npx playwright test e2e/catalog.spec.ts`.
Open `/dev/catalog`: every pose, illustration, sound button and "Play the celebration".

**New sound event** — add the name to `SOUND_EVENTS`, a priority to `SOUND_PRIORITY`
(`soundManager.ts`), a cue in `makeSoundPack` (every theme then has it), a label `sound.<event>` in
en.ts and tr.ts, and call `playEvent('<event>')` where it happens. The theme test checks every pack.

**New celebration trigger** — call `celebrate(t('…'))` after the action succeeded (or optimistically
with the action). Do not celebrate on page load or on a poll: only on a teacher's action on this screen.

**Do not** branch on `theme.key`, put colour literals outside token files, loop or repeat sounds,
play anything louder than gain 0.3, or start audio before the first user gesture.
