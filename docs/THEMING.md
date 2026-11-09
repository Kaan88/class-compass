# Theming guide (for agents and developers)

How the classroom looks and sounds, and how to change it safely. Written so an AI agent can make a
new theme, a theme package, a new sound cue or a new celebration in one pass. Decisions: D-070
(theme registry), D-105 (teachers choose their class display), D-110 (sound packs, SoundManager,
celebrations), D-145 (unlock, loudness, sound status), D-146 (redrawn creatures), D-158 (theme
packages: import, preview, enable), D-159 (AI guidelines, this guide).
For adding a built-in theme step by step (scaffold, checklist) see [EXTENDING.md](EXTENDING.md#add-a-theme).
Agents: start with [AGENTS.md](../AGENTS.md).

## Two ways to make a theme

| | Built-in theme | Theme package (S14g) |
|---|---|---|
| What it is | TypeScript in `src/client/themes/<key>/` | One JSON file ([schema](theme-package.schema.json), [example](examples/ocean.theme.json)) |
| Who adds it | A developer, with a release | An administrator on **Admin → Themes**, no release |
| Art | React SVG components (`art.tsx`) | Strict SVG fragments, drawn as a sanitised tree; missing art comes from a base theme |
| Motion, fonts, shadows | Keyframes and CSS values from the shared presets | Preset **names** only |
| Sounds | `themeSounds(params, overrides)` | The same parameters and overrides as data |
| Checked by | `npm run check` (tests) | The shared validator, on import and before it is enabled |

Both end up as the same `ThemeDefinition` at run time, use the same tokens and pass the same limits.
Start a package from **Export** of the closest theme on Admin → Themes: every field is filled in.

## The model in one paragraph

A theme is **one `ThemeDefinition` object** (`src/client/themes/types.ts`). A built-in theme lives in
its own folder `src/client/themes/<key>/`, listed in `src/client/themes/registry.ts` and in
`THEME_KEYS` (`src/shared/themes.ts`); an imported package is turned into the same object by
`definitionFromPackage` (`src/client/themes/custom.tsx`). It fills every slot: colour tokens,
typography, shape, avatar, icons, mascot (5 poses), decoration, pattern, 6 illustrations, 2 motions,
a **sound pack** and **celebration colours**. Components never branch on the theme key: they use CSS
variables (`var(--cc-*)`) and the helpers in `src/client/themes/index.tsx`. A theme changes how things
look and sound, never what they mean (THM-3).

## Where the active theme comes from

| Screen | Theme |
|---|---|
| Classroom display | the class's `theme` (set by its teachers in Class settings, or by an admin) |
| Student page | the theme of the student's first class |
| Super Speakers board and scorer app | the board theme in Admin → Super Speakers |
| Teacher and admin pages, sign-in | `DEFAULT_THEME` |
| Previews, catalogue, Admin → Themes | the nearest `ThemeProvider` / `ThemeScope` |

`setDisplay()` (`src/client/lib/display.ts`) holds the classroom's display state: theme, the class
switches (animations, sounds), the device sound switch, the class volume and the time's-up choice.

**Theme keys are open strings (D-158).** A class or the board stores a built-in key or the slug of an
imported package. Writes go through `assertThemeUsable(db, key)` (built-in, or a package that is
**enabled**; else 400 `THEME_NOT_AVAILABLE`); reads go through `effectiveTheme(db, key)`, which gives
`DEFAULT_THEME` for a package that is a draft, disabled or deleted. On the client `themeOf(key)` falls
back the same way, and `installThemeStyles()` loads the package the display needs from
`GET /api/themes/custom/:key` (public, enabled only, also served on the Super Speakers host). It
re-checks that package with its ETag (304 when unchanged) when the display changes, when the page
becomes visible and every five minutes, at most every 30 s, so a **replaced** package reaches open
screens without a reload; the Super Speakers board also gets a change signal (its version includes the
package's revision). Deleting a package moves its classes and the board to `DEFAULT_THEME` (audited);
disabling keeps their choice. Editors therefore receive the **stored** choice: the admin class editor
and the Super Speakers settings read `theme` as stored plus `themeAvailable`, the teacher's contexts
carry `chosenTheme` next to the shown `theme`, and the pickers (`ThemePicker switchedOff`) say the
choice is switched off instead of ticking the default. Forms send `theme` only when it was changed, and
the server writes it only when it differs from the stored key, so saving other fields never replaces it.

## Slots and limits (test-enforced in `tests/client/themes.test.tsx` and by the package validator)

| Slot | Rules |
|---|---|
| `colors` | Every `COLOR_TOKENS` entry, hex `#rrggbb`; only `overlay`, `shadow-color` and `avatar-outline` (`TRANSLUCENT_COLOR_TOKENS`, in no contrast pair) may be `#rrggbbaa`. A translucent colour in a pair counts as 1:1. WCAG pairs from `shared/themePackage/contrast.ts` (AA body, AAA classroom text, 3:1 UI). Literals only in `base.ts` and `<theme>/tokens.ts` (or in a package). |
| `Mascot` | 100×100 SVG, poses `idle`, `cheer`, `thinking`, `celebrate`, `sleepy`, all different. Coloured with `var(--cc-mascot-*)`. |
| `illustrations` | 200×140, decorative. The lock screen art must not hint at the page behind it. |
| `motion` | `celebrate`, `threshold`: a preset from `shared/themePackage/motion.ts`, played once; `reduced` is the shared fade. |
| `sounds` | A full `ThemeSoundPack` (one cue per event below) or `null` (silent theme), checked by `soundPackProblems`. |
| `celebration.colors` | 2–8 colour tokens used for the fireworks (read from the CSS variables at run time). |
| `colors` → avatars (S13c) | `avatar-<colour>` (12 catalogue colours), `avatar-skin-1`…`avatar-skin-12`, `avatar-hair-<colour>`, `avatar-ink`, `avatar-outline`, `avatar-white`, `avatar-blush`. Every avatar part is drawn with these, so a theme restyles all 120+ ready-made avatars and every creator combination by changing tokens. Keep the 12 skin tones a wide, realistic range. |
| `colors` → badges (S13c) | `badge-bronze`, `badge-silver`, `badge-gold`, `badge-plain` (frame fills), `badge-ink` (glyph and outline, ≥ 3:1 on every fill, test-enforced) and `badge-shine`. The tier is always also shown by frame shape (circle, hexagon, rosette, rounded square) and written as a word, never colour alone. |

### Limits

Quoted from `src/shared/themePackage/limits.ts` (the tests and the package validator use the same
numbers; loosening one is a decision in DECISIONS.md):

<!-- BEGIN GENERATED limits (npm run docs:theming; do not edit by hand) -->

| What | Limit |
|---|---|
| Package file | ≤ 512 KB; names ≤ 40 characters, descriptions ≤ 160; at most 30 imported themes per school |
| One SVG picture | ≤ 400 elements, ≤ 20 KB, groups nested ≤ 12 deep |
| Decoration / pattern opacity | ≤ 0.6 / ≤ 0.15; pattern tile 8–400 px |
| Motion | 150–1500 ms, plays once, opacity turns at most 1×; reduced motion = fade only |
| Sound cue length | ≤ 1200 ms; secretDrumroll, clapping, fireworks, fanfare, timeUp ≤ 2500 ms; ≤ 64 notes |
| Sound note | gain ≤ 0.3; tones 150–2500 Hz (a glide may end at ≤ 3000 Hz); noise band ≤ 5000 Hz |
| Loudness | a tap at class volume 80 peaks between -12 and -6 dBFS; no cue reaches 0 dBFS at volume 100 |
| Sound parameters | root 150–1000 Hz, gain 0.05–0.2, tempo 0.5–2 |
| Typography | weights 400–900; letter-spacing -0.05–0.1 em; system font presets only |
| Shape | radius 0–2 rem (small 0–1.5 rem); borders 1–4 px (strong 1–6 px); shadow presets only |
| Icons and avatars | icon stroke 1.5–3; avatar saturation 0–100 %, lightness 10–90 % |
| Celebration colours | 2–8 colour tokens |

<!-- END GENERATED limits -->

### Badge icons and avatars (S13c, D-124, D-125)

- **Add a badge icon:** add the key to `BADGE_ICONS` (`src/shared/achievements.ts`) and its 24×24 single-path glyph to `GLYPHS` (`src/client/achievements/icons.tsx`); the Record type and `tests/client/avatars-badges.test.tsx` make sure every key has a distinct glyph. Draw it yourself in the same line style (round caps, 1.8 stroke); never copy an icon set.
- **Add an avatar part:** add the option to `PERSON_PARTS` / `CREATURE_PARTS` (and `OPTION_NAMES` in EN and TR for the accessible name) in `src/shared/avatars.ts`, then draw it in `AvatarArt.tsx` with `var(--cc-avatar-*)` colours only, no ids, filters or `<image>`. The server validates specs against the same catalogue, so an unknown value is refused until it is added there. An option can unlock with a default badge through `AVATAR_UNLOCKS`.
- **Creature faces (S14a, D-146):** `SPECIES_FACE` in `AvatarArt.tsx` says where each species' eyes go (centre, height, spacing, size), which mouth it has (`person`, `beak`, `snout`, `muzzle`, `jaw`) and where a hat sits; the unicorn's horn is drawn over the hat. A new species gets an entry there (a species without one gets the front-facing default) and a body in `CreatureBody` that is more than one plain ellipse (test-enforced: every species has its own outline). Darker parts of a creature use `Shade` (the body colour under a thin ink layer), so they follow the chosen colour.
- Theme-specific icon variants, frames or extra avatar families are not supported yet (ROADMAP S13c); a theme changes badges and avatars through the tokens above.

## Palette design and contrast

Design the palette in this order; the validator and `tests/client/themes.test.tsx` check every pair.

1. **Page and cards.** `bg`, `surface` and `text` first: classroom text must reach **7:1** on both
   (it is read from the back of the room). `surface-2` and `accent-soft` carry text at 4.5:1.
   `text-muted` needs 4.5:1 on `bg`, `surface` and `surface-2`.
2. **Accent.** `accent` and `accent-strong` carry `accent-text` (button labels) at 4.5:1;
   `accent-strong` is also link text on `bg`, `surface` and `accent-soft` (4.5:1). Pick the accent
   from the theme's world (sea blue, map teal), not a new meaning.
3. **Status.** `success`, `warning`, `danger` keep their meanings in every theme (green, amber, red
   family) and reach 4.5:1 on `surface` and on their `-soft` backgrounds. Status is never colour
   alone: icons and words always come with it.
4. **Counter levels.** `level-0`…`level-3` stay neutral → amber → deeper amber → soft red (CNT-6),
   each with `text` at 4.5:1; the number, pattern and word always come with the colour.
5. **UI parts at 3:1.** `border-strong`, `focus`, `icon-accent`, `segment-on` and the counter colours
   on `surface`.
6. **Art.** `deco-*`, `mascot-*`, `art-*` and `pattern` are decorative (no contrast rule) but stay
   calm: decoration opacity ≤ 0.6, pattern ≤ 0.15.
7. **Avatars and achievements.** `avatar-text` on every avatar hue (the theme's saturation and
   lightness), `badge-ink` on every badge fill. Usually copy them from the base theme.
8. `print-ink` and `print-paper` are fixed black on white (D-120) and are not part of a package.

### Token table

<!-- BEGIN GENERATED tokens (npm run docs:theming; do not edit by hand) -->

109 colour tokens, emitted as `--cc-<token>`. Contrast rules use WCAG ratios (`fg on bg ≥ min`). Values are those of the built-in themes.

#### Page, cards and text

| Token | Used for | Contrast | explorer | animals | classroom |
|---|---|---|---|---|---|
| `bg` | Page background. Classroom text on it needs 7:1 (AAA). | under text ≥ 7; under text-muted ≥ 4.5; under accent-strong ≥ 4.5; under focus ≥ 3 | `#f4efe3` | `#f2f7ef` | `#f7f8fc` |
| `surface` | Cards, dialogs and inputs. Classroom text on it needs 7:1 (AAA). | under text ≥ 7; under text-muted ≥ 4.5; under accent-strong ≥ 4.5; under success ≥ 4.5; under warning ≥ 4.5; under danger ≥ 4.5; under border-strong ≥ 3; under focus ≥ 3; under icon-accent ≥ 3; under segment-on ≥ 3; under counter-teal ≥ 3; under counter-plum ≥ 3; under counter-rust ≥ 3; under counter-leaf ≥ 3; under counter-berry ≥ 3 | `#fffaf0` | `#ffffff` | `#ffffff` |
| `surface-2` | Secondary surfaces: table stripes, panels inside cards, the empty counter segment. | under text ≥ 4.5; under text-muted ≥ 4.5 | `#efe4cc` | `#e3f0dc` | `#eef1f8` |
| `text` | Body and classroom text. | on bg ≥ 7; on surface ≥ 7; on surface-2 ≥ 4.5; on accent-soft ≥ 4.5; on level-0 ≥ 4.5; on level-1 ≥ 4.5; on level-2 ≥ 4.5; on level-3 ≥ 4.5 | `#14182b` | `#14182b` | `#14182b` |
| `text-muted` | Hints and secondary text (4.5:1 on bg, surface and surface-2). | on bg ≥ 4.5; on surface ≥ 4.5; on surface-2 ≥ 4.5 | `#4f4a3d` | `#45574a` | `#4a5170` |
| `border` | Quiet dividers and card outlines (decorative, no contrast rule). | – | `#cdbf9f` | `#c4d8b8` | `#c9cfe0` |
| `border-strong` | Borders of inputs and controls (3:1 on surface). | on surface ≥ 3 | `#5b5140` | `#47604a` | `#4a5170` |
| `overlay` | Dim layer behind dialogs (usually translucent, #rrggbbaa). | – | `#14182b8c` | `#14182b8c` | `#14182b8c` |
| `shadow-color` | Colour of card and dialog shadows (usually translucent). | – | `#14182b1f` | `#14182b1f` | `#14182b1f` |

#### Accent, focus and status

| Token | Used for | Contrast | explorer | animals | classroom |
|---|---|---|---|---|---|
| `accent` | Primary buttons, selected states, links; the default counter colour and bar segment. | under accent-text ≥ 4.5 | `#1f6f5c` | `#7a35a6` | `#2f5bd3` |
| `accent-strong` | Pressed primary buttons and accent text on the page and cards. | under accent-text ≥ 4.5; on surface ≥ 4.5; on bg ≥ 4.5; on accent-soft ≥ 4.5 | `#175646` | `#642b88` | `#2448ad` |
| `accent-soft` | Selected rows, active navigation, soft accent backgrounds. | under text ≥ 4.5; under accent-strong ≥ 4.5 | `#d7ece5` | `#efe2f7` | `#dfe7fb` |
| `accent-text` | Text on accent and accent-strong (primary button labels). | on accent ≥ 4.5; on accent-strong ≥ 4.5 | `#ffffff` | `#ffffff` | `#ffffff` |
| `focus` | Keyboard focus ring (3:1 on bg and surface). | on bg ≥ 3; on surface ≥ 3 | `#a8480f` | `#b0470c` | `#b25e00` |
| `success` | Success text and chips. | on surface ≥ 4.5; on success-soft ≥ 4.5; under on-strong ≥ 4.5 | `#17733f` | `#17733f` | `#17733f` |
| `success-soft` | Success alert background. | under success ≥ 4.5 | `#dcf3e5` | `#dcf3e5` | `#dcf3e5` |
| `warning` | Warning text and icons. | on surface ≥ 4.5; on warning-soft ≥ 4.5 | `#8a5100` | `#8a5100` | `#8a5100` |
| `warning-soft` | Warning alert background. | under warning ≥ 4.5 | `#fff1d1` | `#fff1d1` | `#fff1d1` |
| `danger` | Error text and destructive buttons. | on surface ≥ 4.5; on danger-soft ≥ 4.5; under on-strong ≥ 4.5 | `#b3261e` | `#b3261e` | `#b3261e` |
| `danger-strong` | Pressed destructive buttons. | – | `#8c1d17` | `#8c1d17` | `#8c1d17` |
| `danger-soft` | Error alert background. | under danger ≥ 4.5 | `#fde3e1` | `#fde3e1` | `#fde3e1` |
| `on-strong` | Text on danger and success fills. | on danger ≥ 4.5; on success ≥ 4.5 | `#ffffff` | `#ffffff` | `#ffffff` |

#### Display banner (PIN-5)

| Token | Used for | Contrast | explorer | animals | classroom |
|---|---|---|---|---|---|
| `display-banner-bg` | Background of the "visible on the classroom display" banner. | under display-banner-text ≥ 4.5 | `#fff1d1` | `#fff1d1` | `#fff1d1` |
| `display-banner-text` | Text of the display banner (4.5:1 on its background). | on display-banner-bg ≥ 4.5 | `#14182b` | `#14182b` | `#14182b` |
| `display-banner-border` | Border of the display banner. | – | `#8a5100` | `#8a5100` | `#8a5100` |

#### Counter levels (CNT-6)

| Token | Used for | Contrast | explorer | animals | classroom |
|---|---|---|---|---|---|
| `level-0` | Student card level 0 (no reminders): neutral. | under text ≥ 4.5 | `#efe4cc` | `#e3f0dc` | `#eef1f8` |
| `level-1` | Student card level 1: light amber. Always shown with number, pattern and word. | under text ≥ 4.5 | `#fff1d1` | `#fff1d1` | `#fff1d1` |
| `level-2` | Student card level 2: deeper amber. | under text ≥ 4.5 | `#ffd27a` | `#ffd27a` | `#ffd27a` |
| `level-3` | Student card level 3: soft red. | under text ≥ 4.5 | `#fde3e1` | `#fde3e1` | `#fde3e1` |
| `level-edge-0` | Edge of a level 0 card. | – | `#cdbf9f` | `#c4d8b8` | `#c9cfe0` |
| `level-edge-1` | Edge of a level 1 card. | – | `#8a5100` | `#8a5100` | `#8a5100` |
| `level-edge-2` | Edge of a level 2 card. | – | `#6e3f00` | `#6e3f00` | `#6e3f00` |
| `level-edge-3` | Edge of a level 3 card. | – | `#b3261e` | `#b3261e` | `#b3261e` |

#### Counter colours (CNT-12)

| Token | Used for | Contrast | explorer | animals | classroom |
|---|---|---|---|---|---|
| `counter-accent` | Counter colour "accent": bar segments and the counter's chip. | – | `#1f6f5c` | `#7a35a6` | `#2f5bd3` |
| `counter-accent-edge` | Edge and pressed state of counter colour "accent". | – | `#175646` | `#642b88` | `#2448ad` |
| `counter-teal` | Counter colour "teal": bar segments and the counter's chip. | on surface ≥ 3 | `#1f6f5c` | `#1f6f5c` | `#1f6f5c` |
| `counter-teal-edge` | Edge and pressed state of counter colour "teal". | – | `#175646` | `#175646` | `#175646` |
| `counter-plum` | Counter colour "plum": bar segments and the counter's chip. | on surface ≥ 3 | `#7a35a6` | `#7a35a6` | `#7a35a6` |
| `counter-plum-edge` | Edge and pressed state of counter colour "plum". | – | `#642b88` | `#642b88` | `#642b88` |
| `counter-rust` | Counter colour "rust": bar segments and the counter's chip. | on surface ≥ 3 | `#c25a22` | `#c25a22` | `#c25a22` |
| `counter-rust-edge` | Edge and pressed state of counter colour "rust". | – | `#6e3f00` | `#6e3f00` | `#6e3f00` |
| `counter-leaf` | Counter colour "leaf": bar segments and the counter's chip. | on surface ≥ 3 | `#4f8a37` | `#4f8a37` | `#4f8a37` |
| `counter-leaf-edge` | Edge and pressed state of counter colour "leaf". | – | `#17733f` | `#17733f` | `#17733f` |
| `counter-berry` | Counter colour "berry": bar segments and the counter's chip. | on surface ≥ 3 | `#d6406a` | `#d6406a` | `#d6406a` |
| `counter-berry-edge` | Edge and pressed state of counter colour "berry". | – | `#8c1d17` | `#8c1d17` | `#8c1d17` |
| `segment-on` | Filled segment of the class counter bar (3:1 on surface). | on surface ≥ 3 | `#1f6f5c` | `#7a35a6` | `#2f5bd3` |
| `segment-off` | Empty segment of the class counter bar. | – | `#efe4cc` | `#e3f0dc` | `#eef1f8` |

#### Icons, decoration, mascot and illustrations

| Token | Used for | Contrast | explorer | animals | classroom |
|---|---|---|---|---|---|
| `icon-accent` | Menu tile icons and line work in illustrations (3:1 on surface). | on surface ≥ 3 | `#a8480f` | `#3f7a2c` | `#6a4fc4` |
| `deco-1` | Decoration and illustration colour 1. | – | `#1f6f5c` | `#5f9b45` | `#8fc3ef` |
| `deco-2` | Decoration and illustration colour 2. | – | `#c8642c` | `#ef8a3c` | `#ffd166` |
| `deco-3` | Decoration and illustration colour 3. | – | `#cdbf9f` | `#7a35a6` | `#8b6fd6` |
| `pattern` | Lines of the faint background pattern (drawn at patternOpacity). | – | `#8a6d3b` | `#5f9b45` | `#2f5bd3` |
| `mascot-body` | Mascot body. | – | `#1f6f5c` | `#ef8a3c` | `#8b6fd6` |
| `mascot-belly` | Mascot belly, eye whites and light parts. | – | `#fffaf0` | `#ffe6d1` | `#dfe7fb` |
| `mascot-accent` | Mascot hat, compass, scarf and other accents. | – | `#c8642c` | `#5f9b45` | `#ffd166` |
| `mascot-ink` | Mascot eyes, mouth and outlines. | – | `#14182b` | `#14182b` | `#14182b` |
| `mascot-cheek` | Mascot cheeks (drawn translucent). | – | `#e2557a` | `#e2557a` | `#e2557a` |
| `art-sky` | Illustration sky. | – | `#e3efe9` | `#e6f2fb` | `#dcecfb` |
| `art-ground` | Illustration ground. | – | `#e6d6b0` | `#cfe6c4` | `#e8e2f8` |
| `art-light` | Illustration sun, lamp and highlights. | – | `#fff3cf` | `#fff4d6` | `#fff7d6` |

#### Avatars (S13c)

| Token | Used for | Contrast | explorer | animals | classroom |
|---|---|---|---|---|---|
| `avatar-text` | Initials on generated avatar circles (checked over every hue). | on every avatar hue ≥ 3 (big) / 4.5 (small) | `#ffffff` | `#ffffff` | `#ffffff` |
| `avatar-red` | Avatar colour "red" (clothes, creature bodies, backgrounds). | – | `#d9483b` | `#d9483b` | `#d9483b` |
| `avatar-orange` | Avatar colour "orange" (clothes, creature bodies, backgrounds). | – | `#e8833a` | `#e8833a` | `#e8833a` |
| `avatar-yellow` | Avatar colour "yellow" (clothes, creature bodies, backgrounds). | – | `#f2c94c` | `#f2c94c` | `#f2c94c` |
| `avatar-green` | Avatar colour "green" (clothes, creature bodies, backgrounds). | – | `#4caf6a` | `#4caf6a` | `#4caf6a` |
| `avatar-teal` | Avatar colour "teal" (clothes, creature bodies, backgrounds). | – | `#2a9d8f` | `#2a9d8f` | `#2a9d8f` |
| `avatar-blue` | Avatar colour "blue" (clothes, creature bodies, backgrounds). | – | `#3b7dd8` | `#3b7dd8` | `#3b7dd8` |
| `avatar-navy` | Avatar colour "navy" (clothes, creature bodies, backgrounds). | – | `#2c3e7a` | `#2c3e7a` | `#2c3e7a` |
| `avatar-purple` | Avatar colour "purple" (clothes, creature bodies, backgrounds). | – | `#8a5cc2` | `#8a5cc2` | `#8a5cc2` |
| `avatar-pink` | Avatar colour "pink" (clothes, creature bodies, backgrounds). | – | `#e46aa6` | `#e46aa6` | `#e46aa6` |
| `avatar-brown` | Avatar colour "brown" (clothes, creature bodies, backgrounds). | – | `#8d5b3e` | `#8d5b3e` | `#8d5b3e` |
| `avatar-grey` | Avatar colour "grey" (clothes, creature bodies, backgrounds). | – | `#8a93a6` | `#8a93a6` | `#8a93a6` |
| `avatar-mint` | Avatar colour "mint" (clothes, creature bodies, backgrounds). | – | `#8fd6c0` | `#8fd6c0` | `#8fd6c0` |
| `avatar-skin-1` | Skin tone 1 of 12 (keep the 12 a wide, realistic range, light to dark). | – | `#fde3cf` | `#fde3cf` | `#fde3cf` |
| `avatar-skin-2` | Skin tone 2 of 12 (keep the 12 a wide, realistic range, light to dark). | – | `#f8d5b8` | `#f8d5b8` | `#f8d5b8` |
| `avatar-skin-3` | Skin tone 3 of 12 (keep the 12 a wide, realistic range, light to dark). | – | `#f1c29a` | `#f1c29a` | `#f1c29a` |
| `avatar-skin-4` | Skin tone 4 of 12 (keep the 12 a wide, realistic range, light to dark). | – | `#e8b07f` | `#e8b07f` | `#e8b07f` |
| `avatar-skin-5` | Skin tone 5 of 12 (keep the 12 a wide, realistic range, light to dark). | – | `#d99a68` | `#d99a68` | `#d99a68` |
| `avatar-skin-6` | Skin tone 6 of 12 (keep the 12 a wide, realistic range, light to dark). | – | `#c68652` | `#c68652` | `#c68652` |
| `avatar-skin-7` | Skin tone 7 of 12 (keep the 12 a wide, realistic range, light to dark). | – | `#b07142` | `#b07142` | `#b07142` |
| `avatar-skin-8` | Skin tone 8 of 12 (keep the 12 a wide, realistic range, light to dark). | – | `#965c35` | `#965c35` | `#965c35` |
| `avatar-skin-9` | Skin tone 9 of 12 (keep the 12 a wide, realistic range, light to dark). | – | `#7d4a2a` | `#7d4a2a` | `#7d4a2a` |
| `avatar-skin-10` | Skin tone 10 of 12 (keep the 12 a wide, realistic range, light to dark). | – | `#653a22` | `#653a22` | `#653a22` |
| `avatar-skin-11` | Skin tone 11 of 12 (keep the 12 a wide, realistic range, light to dark). | – | `#4f2d1b` | `#4f2d1b` | `#4f2d1b` |
| `avatar-skin-12` | Skin tone 12 of 12 (keep the 12 a wide, realistic range, light to dark). | – | `#3b2115` | `#3b2115` | `#3b2115` |
| `avatar-hair-black` | Hair colour "black". | – | `#1f1a17` | `#1f1a17` | `#1f1a17` |
| `avatar-hair-darkBrown` | Hair colour "darkBrown". | – | `#3e2a1f` | `#3e2a1f` | `#3e2a1f` |
| `avatar-hair-brown` | Hair colour "brown". | – | `#6b4428` | `#6b4428` | `#6b4428` |
| `avatar-hair-auburn` | Hair colour "auburn". | – | `#8e3b22` | `#8e3b22` | `#8e3b22` |
| `avatar-hair-ginger` | Hair colour "ginger". | – | `#c4622d` | `#c4622d` | `#c4622d` |
| `avatar-hair-blonde` | Hair colour "blonde". | – | `#d9b45a` | `#d9b45a` | `#d9b45a` |
| `avatar-hair-lightBlonde` | Hair colour "lightBlonde". | – | `#ecd796` | `#ecd796` | `#ecd796` |
| `avatar-hair-grey` | Hair colour "grey". | – | `#9a9a9a` | `#9a9a9a` | `#9a9a9a` |
| `avatar-hair-white` | Hair colour "white". | – | `#ececec` | `#ececec` | `#ececec` |
| `avatar-hair-blue` | Hair colour "blue". | – | `#3b6fd1` | `#3b6fd1` | `#3b6fd1` |
| `avatar-hair-pink` | Hair colour "pink". | – | `#e07bb0` | `#e07bb0` | `#e07bb0` |
| `avatar-hair-purple` | Hair colour "purple". | – | `#7d4fc0` | `#7d4fc0` | `#7d4fc0` |
| `avatar-ink` | Avatar eyes, mouths and fine lines. | – | `#1d2033` | `#1d2033` | `#1d2033` |
| `avatar-outline` | Thin avatar outlines (usually translucent ink). | – | `#1d203340` | `#1d203340` | `#1d203340` |
| `avatar-white` | Eye whites, teeth and highlights in avatars. | – | `#ffffff` | `#ffffff` | `#ffffff` |
| `avatar-blush` | Avatar cheeks. | – | `#f0807f` | `#f0807f` | `#f0807f` |

#### Achievements (S13c)

| Token | Used for | Contrast | explorer | animals | classroom |
|---|---|---|---|---|---|
| `badge-bronze` | Bronze achievement frame. | – | `#c07a3f` | `#c07a3f` | `#c07a3f` |
| `badge-silver` | Silver achievement frame. | – | `#a9b2c3` | `#a9b2c3` | `#a9b2c3` |
| `badge-gold` | Gold achievement frame. | – | `#e5b631` | `#e5b631` | `#e5b631` |
| `badge-plain` | Special (untiered) achievement frame. | – | `#6c8cd5` | `#6c8cd5` | `#6c8cd5` |
| `badge-ink` | Achievement glyph and outline (3:1 on every frame fill). | – | `#1d2033` | `#1d2033` | `#1d2033` |
| `badge-shine` | Highlight on achievement frames. | – | `#ffffff` | `#ffffff` | `#ffffff` |

#### Printed cards (fixed)

| Token | Used for | Contrast | explorer | animals | classroom |
|---|---|---|---|---|---|
| `print-ink` | Printed QR codes and cut lines: always black, the same in every theme (D-120). (fixed, not in packages) | on print-paper ≥ 7 | `#000000` | `#000000` | `#000000` |
| `print-paper` | Printed card paper: always white, the same in every theme (D-120). (fixed, not in packages) | under print-ink ≥ 7 | `#ffffff` | `#ffffff` | `#ffffff` |

<!-- END GENERATED tokens -->

## Theme packages (S14g, D-158)

A package is a JSON file. Everything in it is data: hex colours, numbers inside fixed ranges, preset
names and strict SVG. Nothing in it is CSS, script or markup that is drawn as markup; the CSP is
unchanged. One source of truth for every check: `src/shared/themePackage/` (the server, the admin
preview, the MCP tools of S14h and the tests use it).

| File | What |
|---|---|
| `schema.ts` | The zod schema (strict: an unknown or misspelt field is an error) → [theme-package.schema.json](theme-package.schema.json) |
| `tokens.ts` | Colour tokens and what each is for, poses, illustrations, motions, sound events |
| `limits.ts` | The limits above and the loudness model |
| `contrast.ts` | WCAG maths and the contrast pairs |
| `presets.ts`, `motion.ts` | Font stacks, shadows and motion keyframes, by name |
| `sound.ts` | `makeSoundPack` and `soundPackProblems` |
| `svg.ts` | The strict SVG tokenizer and sanitiser |
| `validate.ts` | `validateThemePackage(text)` → the report (`errors`, `warnings`, `stats`) and the package |

### Fields

| Field | Content |
|---|---|
| `format`, `version` | `"class-compass-theme"`, `1` |
| `key` | The slug classes store: 3–32 lower-case letters, digits and single hyphens, starting with a letter; never a built-in key; unique in the school |
| `name`, `description`, `mascotName` | `{ "en": …, "tr": … }`, plain text (names ≤ 40 characters, description ≤ 160) |
| `base` | A built-in theme: it supplies art the package leaves out, and colour tokens added to the app after the package was made |
| `colors` | Every token of the table above except `print-ink` / `print-paper`; opaque `#rrggbb`, except `overlay`, `shadow-color` and `avatar-outline`, which may be `#rrggbbaa` |
| `typography` | `body` and `display` font presets (`system`, `friendly`, `clean`, `playful`, `rounded`, `wide`, `book`), four weights, letter-spacing in em |
| `shape` | `radiusRem`, `radiusSmRem`, `borderPx`, `borderStrongPx`, `shadow` and `shadowRaised` presets (`none`, `soft`, `paper`, `cushion`, `raised`, `floating`) |
| `avatar`, `icons` | Avatar saturation and lightness (big and small initials); icon stroke width, linecap, linejoin |
| `decoOpacity`, `patternOpacity` | ≤ 0.6, ≤ 0.15 |
| `motion` | `celebrate` (`hop`, `squash`, `pop`, `sway`, `grow`) and `threshold` (`slideIn`, `rise`, `settle`, `grow`, `fade`), each with `durationMs` and `easing` |
| `sounds` | `null` (silent) or `{ root, wave, scale, gain, tempo, overrides? }` (`overrides`: hand-made cues per event, as `ToneNote` lists) |
| `celebration.colors` | Colour tokens of the fireworks |
| `art` (optional) | `mascot` (all five poses), `illustrations` (any of the six), `decoration`, `pattern`, `patternSize` |

### SVG allow-list

Art is an SVG **fragment**: the content of the `<svg>` element (100×100 for the mascot and the
decoration, 200×140 for illustrations, `patternSize` for the pattern tile), without the `<svg>`
element itself. Single or double quotes both work, so it can be written inside JSON strings.

- **Elements:** `g`, `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`. Only `g` may contain other elements.
- **Geometry:** `d` (path data), `cx` `cy` `r`, `rx` `ry`, `x` `y` `width` `height`, `x1` `y1` `x2` `y2`, `points`.
- **Paint:** `fill` and `stroke` are `none`, `currentColor` or `var(--cc-<colour token>)` only. No colour literals.
- **Presentation:** `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`, `opacity`, `fill-opacity`, `stroke-opacity`, `fill-rule`.
- **Transform:** `translate`, `scale`, `rotate`, `skewX`, `skewY`, `matrix` with numbers only.
- **Never:** ids, `class`, `style`, `href` / `xlink:href`, event handlers (`on…`), `filter`, `mask`, `url()`, text, `image`, `use`, `foreignObject`, `script`, `a`, comments, CDATA, entities (`&…;`), doctypes, processing instructions.
- **Size:** at most 400 elements, 20 KB and 12 nested groups per picture.

The sanitiser never repairs: anything outside the list is an error with the reason and position. The
client draws the resulting tree with `createElement` in `src/client/themes/SvgTree.tsx` (never
`dangerouslySetInnerHTML`), passing only allow-listed attributes. Generated CSS is checked once more
(`safeKey`, `safeValue` and preset-only keyframes in `themes/css.ts`).

### Import, preview, enable

1. **Admin → Themes → Import a theme:** choose the file or paste the JSON (it can be edited there),
   then **Check package**. The report lists errors (they block saving) and notes (art from the base
   theme, a silent theme).
2. **Preview** appears for a package without errors: the classroom board, the student home, the
   board podium, every mascot pose and illustration, the celebration (button), every sound and the
   contrast table. It is drawn under a preview key, so nothing live changes.
3. **Save as draft.** A draft can be previewed again from the table but cannot be chosen.
4. **Enable.** The package is checked again (limits may have changed since the import), then
   teachers see it in Class settings → Display, and admins in the class editor and Super Speakers.
5. **Disable** keeps the classes' choice; they show the default theme until it is enabled again.
   **Delete** needs the key typed; classes and the board move to the default theme.
6. **Export** gives any theme as a package: an imported one exactly as stored, a built-in one with a
   new key (`<key>-copy`) and "(copy)" names, without art (its art comes from `base`).

Checking the same key again offers **Replace the saved theme**, which keeps its status. Open screens
that show it pick up the new package within a few minutes (an open board usually at once); a reload is not needed.

### Worked example: `ocean`

[docs/examples/ocean.theme.json](examples/ocean.theme.json) is a complete package (fictional; also
the fixture of `tests/server/themes.test.ts`, `tests/client/theme-packages.test.tsx` and
`e2e/theme-packages.spec.ts`).

Next to it, `docs/examples/<key>.theme.json` holds one package per built-in theme
([explorer](examples/explorer.theme.json), [animals](examples/animals.theme.json),
[classroom](examples/classroom.theme.json)): exactly what **Admin → Themes → Export** downloads (key
`<key>-copy`, "(copy)" names; the art stays with the base theme). They are generated from the theme
definitions by `npm run docs:theme-examples`, and `tests/docs/theme-examples.test.ts` fails when a
built-in theme changes and the files were not regenerated (D-164). Run it after changing a built-in
theme's colours, typography, shape, motion or sounds.

- **Palette.** `bg` `#eef6f8` (sea foam) and white `surface` with `text` `#0f2430` (deep sea): 7:1+
  on both. `accent` `#0b6e8a` (sea blue) with white labels; `accent-strong` one step darker for
  links. `focus` stays a warm rust (`#a8480f`) so the focus ring is never mistaken for the accent.
  Status, level, avatar and achievement colours are copied from the base theme `classroom`.
  `art-ground` is sand, `art-sky` a pale sky, `deco-*` sea, sun and coral.
- **Mascot "Dalga the whale".** One body (shadow, tail, body, belly, fin, cheeks) shared by the five
  poses; only the face and extras change: dot eyes and a smile (`idle`), happy eyes, open mouth and a
  spout (`cheer`), eyes up and thought bubbles (`thinking`), a big spout with sparkles
  (`celebrate`), closed eyes and a drawn "Z Z" (`sleepy`; letters are paths, text is not allowed).
- **Art.** `startLesson`, `endLesson` and `celebration` are sea scenes; `lockScreen`, `emptyState`
  and `threshold` are left out on purpose and come from `classroom` (the report notes this).
  Decoration: waves and bubbles. Pattern: bubbles and a wave line on a 60 px tile at opacity 0.07.
- **Type and shape.** `rounded` headings, `system` body text, slightly rounder cards (1.2 rem).
- **Motion.** `sway` (a boat on a calm sea) for celebrations, `rise` for the full class bar.
- **Sound.** Soft sines on a pentatonic scale from G4 (392 Hz), a little slower (`tempo` 0.9),
  `gain` 0.1 (a tap peaks near −9.5 dBFS at volume 80), and a hand-made three-note time's-up cue.

To try it: Admin → Themes → choose `docs/examples/ocean.theme.json` → Check package → look at the
preview → Save as draft → Enable → Class settings → Display → Ocean.

### Checklist for a package

- [ ] Start from **Export** of the closest theme; change `key`, the names (EN and TR), `base`.
- [ ] Colours: follow "Palette design and contrast"; keep status, level and achievement meanings.
- [ ] Art (optional): only the allowed SVG; five different mascot poses; nothing that hints at
      private pages on the lock screen; original drawings only (no copied icon sets or characters).
- [ ] Motion and sound: presets and parameters inside the limits; listen to every cue in the preview.
- [ ] **Check package** shows no errors; read the notes.
- [ ] Look at the preview: classroom, student page, board, celebration (with and without reduced
      motion), sounds, contrast table. Then on the classroom display itself, from the back of the room.
- [ ] Save as draft, enable, choose it for one class first.
- [ ] Fictional data only: a package holds no names of real people, schools or places.

### For AI agents: making a package

Read this file and [theme-package.schema.json](theme-package.schema.json), start from an exported
package (or the `ocean` example), change it, and run the validator before handing it over:

```ts
import { readFileSync } from 'node:fs';
import { validateThemePackage } from './src/shared/themePackage/validate.ts';
const { report } = validateThemePackage(readFileSync('my.theme.json', 'utf8'));
console.log(report.errors, report.warnings);
```

Fix every error (the `path` says where; contrast errors give the ratio and the minimum). Never put
real people or a real school in a package. Enabling a theme stays a human action on Admin → Themes.

**MCP theme tools (S14h1, D-160; S16b, D-164).** An AI assistant connected to `/mcp` (personal
token or OAuth, `docs/guides/en/ai-tools.md`) can make a package as well as an agent in the git
folder. What it gets:

| Here in git | Over MCP |
|---|---|
| This guide | Resource `classcompass://docs/theming` (relative links rewritten: documents that are resources become `classcompass://` links, other files are named as repository files) |
| `docs/theme-package.schema.json` | Resource `classcompass://themes/package-schema`, tool `theme_schema` |
| `docs/examples/*.theme.json` | Resources `classcompass://themes/examples/<key>` (`ocean` and one per built-in theme) |
| Export on Admin → Themes | `export_theme`: a built-in key gives the same package as the admin page (`<key>-copy`); an imported theme its stored package (teachers: enabled themes; administrators with `themes:write`: any). Read-only |
| `validateThemePackage` | `validate_theme` (the same report; nothing is saved) |
| `/dev/catalog` and the admin preview | `preview_theme`: the report, the base theme, every colour token with its value and source (package, base theme, fixed print colour), every contrast pair with ratio, minimum and pass, and which mascot poses, illustrations, decoration and pattern come from the base theme. No images are drawn |
| Import on Admin → Themes | `import_theme_draft` (administrators with `themes:write`): saves a **draft** only |

The server's instructions (sent on `initialize`) and every theme tool's description point at this
guide and the examples, so an assistant that does not read resources by itself still finds them; the
prompt `design_theme` walks through the checklist above. Looking at the real preview and **enabling**
a theme stay human actions on Admin → Themes.

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
| `lessonStart` | Begin lesson pressed (S14a) | 3 |
| `lessonEnd` | Save and end lesson pressed (S14a) | 3 |
| `timerStart` | the lesson timer is started (S14a) | 2 |
| `achievementGiven` | an achievement given in class without the celebration (S14a) | 3 |
| `soundTest` | **Test sound** in the Display popover, the "Turn sound on" chip (S14a) | 2 |
| `groupMove` | a student moved to another group (declared in S14a, played from S14c) | 1 |

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
the class volume on a master gain, mute when the class or device switch is off, priorities with
ducking (a louder cue lowers quieter ones to 30 %, a quiet cue under a loud one starts at 30 %), taps
closer than 50 ms merged. Never create an `AudioContext` or call `speechSynthesis` from a component.

### Unlock, loudness and status (S14a, D-145)

- **Unlock.** Browsers start WebAudio only from a user gesture. `installSoundUnlock()` (in each
  `main.tsx`) listens to `pointerdown`, `pointerup`, `touchend`, `click` and `keydown` and keeps
  listening until the context really runs; it arms again when the browser suspends or interrupts the
  context or the page is shown again. `sounds.unlocked` is the context state, never a guess. A control
  that unlocks audio in its own press handler carries `data-unlocks-sound` (`SELF_UNLOCK_ATTR`).
- **Loudness.** Master (class volume, squared curve) → compressor (−24 dB, ratio 6, hard knee; the
  browser adds about +12 dB makeup) → makeup ×2.2 → speakers. Notes stay ≤ 0.3 each. A tap at volume 80
  must peak between −12 and −6 dBFS and no cue may reach 0 dBFS at volume 100: `outputPeakDb(peak,
  volume)` models it and `tests/client/themes.test.tsx` checks every theme's pack. A theme that makes
  its taps much quieter or its chords much louder fails there; change `gain` in `makeSoundPack`.
- **Status.** `useSoundStatus()` (from `themes/index.tsx`) returns `running`, `locked`, `unavailable`,
  `mutedClass`, `mutedDevice` or `volumeZero` plus a snapshot (context state, last cue). The classroom
  top bar shows "Sound is off · Turn sound on" for `locked` and `mutedDevice`, and the Display popover
  has the Sound check with **Test sound** and **Copy diagnostics**. Use the hook for any other screen
  that must say why it is silent; do not read the AudioContext yourself.

### Time's up

`modules/lessons/timeUp.ts`: `planTimeUp(setting, can)` decides voice / clip / chime / none
(fallbacks: no English voice → chime, no clip → chime, sounds off → none); `announceTimeUp()` plays
it. The voice list is cached and refreshed on `voiceschanged` (`currentVoices()`), because browsers
fill it late. The teacher's clip is fetched ahead with `preloadTimeUp()` when the class is opened.

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

**New theme package** (no code) — see "Checklist for a package" above: export the closest theme,
change it, run `validateThemePackage`, import it on Admin → Themes.

**New built-in theme** — `npm run new:theme -- <key>`, then edit `tokens.ts` (colours: keep contrast),
`art.tsx` (mascot poses, illustrations; only `tok('…')` colours), `index.ts` (motion, `makeSoundPack`
options, celebration colours). Run `npm run check` and `npx playwright test e2e/catalog.spec.ts`.
Open `/dev/catalog`: every pose, illustration, sound button and "Play the celebration".

**New sound event** — add the name to `SOUND_EVENTS` (`src/shared/themePackage/tokens.ts`), a
priority to `SOUND_PRIORITY` (`soundManager.ts`), a cue in `makeSoundPack`
(`src/shared/themePackage/sound.ts`; every theme and every package then has it), a label
`sound.<event>` in en.ts and tr.ts, and call `playEvent('<event>')` where it happens. The theme test
and the package validator check every pack.

**New colour token** — add it to `COLOR_TOKENS` and `TOKEN_DOCS` (`src/shared/themePackage/tokens.ts`),
give it a value in `base.ts` (and the theme token sheets where it differs), add its pair to
`CONTRAST_PAIRS` if it is text or UI on a surface, then `npm run docs:theming`. Packages made before
it get the value of their base theme; new packages must list it.

**New preset** (font, shadow, motion) — add it to `presets.ts` / `motion.ts`, run
`npm run docs:theming` (the schema lists presets) and say in DECISIONS.md why it is needed. A preset
is never raw CSS from a package.

**New celebration trigger** — call `celebrate(t('…'))` after the action succeeded (or optimistically
with the action). Do not celebrate on page load or on a poll: only on a teacher's action on this screen.

**Do not** branch on `theme.key`, put colour literals outside token files, loop or repeat sounds,
play anything louder than gain 0.3, start audio before the first user gesture, render package art as
markup, or accept CSS from a package.
