# Theme engine: scenes, frames, ambient, sets and sound styles; full screen in lessons (2026-11-11): S17/S18 brief

The owner imported the "Peppermint Parade: Snow Day" package and the classroom board still looked like the standard layout in other colours. The owner asked for a much more powerful theme engine, approved the mockups and asked for the built-in themes to be remade with it. Stages S17a, S17b, S17c and S18; decisions D-166 to D-169; **no migrations**.

Mockups (approved 2026-11-11): the canvas "Snow Day theme mockups" (owner's private artifact); copies of the artboards are in `docs/design/mockups/2026-11-11-theme-engine/`:

| File | Shows |
|---|---|
| `Main.dc.html` | Snow Day board, 1920×1080, snowfall on: village scene, snow-drift frames, candy-stripe trim on Today and Timer, frost corners, snow caps on student cards |
| `ThemedBoard.dc.html` | The board at the **real classroom size 1536×703** and in full screen (1536×864), in all four themes (prop `theme`: snow, explorer, animals, classroom). The exact frame paths, colours and the per-theme frame choices are in its `renderVals()` |
| `Phone.dc.html` | Phone: the scene shrinks to a bottom strip, frames simplified to snow caps |
| `Frames.dc.html` | The frame preset catalogue (edges, trims, corners) |
| `AdminPreview.dc.html` | Admin → Themes package preview with a Motion on/off toggle and the new blocks |
| `Sets.dc.html` | Achievement frames, avatar families first, one mascot everywhere |

They are design references (static HTML in a canvas format), not code to copy; shapes and colours in the app come from theme tokens.

## Context: why packages look flat today
- The tile pattern is a 5–15 % opacity backdrop (`.cc-backdrop`); the decoration art is never rendered on the classroom board (only on the auth card, previews and the catalogue).
- Card shape is only radius, border width and shadow; there is no way to give a card a silhouette or trim.
- Built-in illustrations hard-code their own mascot (`themes/explorer/art.tsx` imports its mascot; animals and classroom the same), so a package that keeps base illustrations shows two mascots.
- Avatars and achievement badges take only colours from the theme.
- Sound is one synthesised voice (`sounds`: root, wave, scale, gain, tempo); a package cannot ask for a different instrument character.

## Real classroom display (S16c reading, ROADMAP S16c)
- Classroom PC: Windows, Chrome, 1920×1080 touch panel at 125 % (pixel ratio 1.25), so 1536×864 CSS px. With the browser bars the board window is **1536×703**; in full screen **1536×864**.
- Sare's MacBook: 1440×825 and 1440×787 at pixel ratio 2.
- **Test matrix for S17/S18** (screenshots, e2e, performance): 1536×703 and 1536×864 at device scale factor 1.25 with touch; 1440×787 at scale 2; 1920×1080; 1280×720; 375 px phone. Motion on and off at each board size.

## Owner decisions (2026-11-09 to 2026-11-11)
- Mockups first, then build (done; mockups approved: "I really like the mockups").
- **Art sets** = choose and recolour the built-in sets (no custom SVG avatar or badge sets).
- **Borders are graphical**, e.g. snow piled around the card.
- **Built-in themes are remade with the new engine** to the same level as Snow Day (scene, frames, ambient where it fits, sets, sound style). They change for classes already using them; there is no "plain look" switch.
- **Avatars stay** (a child's stored avatar never changes with the theme). The owner asked for a separate review of the avatars for changes or more styles; that is not part of these stages.
- **Sound styles**: packages (and AI agents over MCP) can choose an instrument style.
- **Full screen**: Start lesson enters full screen, End lesson leaves it.

## Stages, order and parallelism

| Wave | Stage | Scope | Decision |
|---|---|---|---|
| 1 | **S17a** Theme engine | Package fields `scene`, `frame`, `ambient`, `sets`; rendering on the board and elsewhere; mascot context; Admin preview; validator, schema, docs; the Snow Day example package | D-166 |
| 1 | **S18** Full screen during lessons | Start/End lesson full screen, re-enter button, teacher setting, `displayInfo.fullscreen` | D-167 |
| 2 | **S17b** Built-ins remade + sound styles | Explorer, Animals, Classroom get scenes/frames/ambient/sets per the mockups; `sounds.style` with app-defined instrument styles; Snow Day gets `bells` | D-168 |
| 2 | **S17c** Avatars: frozen defaults, readability, picture picker, richer families | From the avatar review (2026-11-11); no stored avatar changes | D-169 |

S17a and S18 run at the same time in separate worktrees. S17b and S17c start after S17a is on main and run at the same time (S17c needs S17a's picker ordering; it touches no theme files).

### Hot files
- **S17a**: `src/shared/themePackage/*` (schema, limits, validate, svg, tokens docs), `src/client/themes/*` (types, index, custom, css, art, new `Scene`/`Ambient` components), new `src/client/ui/Frame.tsx`, `src/client/routes/Root.tsx`, `src/client/modules/lessons/board/Box.tsx` and `Board.tsx` (frames only), the student card in `src/client/ui/` (frames only), `src/client/achievements/icons.tsx`, the avatar picker (ordering only), `src/client/routes/admin/Themes.tsx`, `docs/THEMING.md`, `docs/theme-package.schema.json`, `docs/examples/`, `app.css` (frame/scene/ambient section).
- **S18**: `src/client/modules/lessons/StartLesson.tsx`, `EndLesson.tsx`, the board top bar where the lesson controls live (a small button only; S17a wraps boxes, not the controls inside), `src/server/lib/userSettings.ts` (one key), the teacher settings page, the `displayInfo` module (contract + client watcher + admin table column), i18n `fullscreen.*` / `lessons.fullscreen*` keys, guides.
- **S17c**: `src/shared/avatars.ts`, `src/shared/contracts/avatars.ts` (no enum removals), `src/client/avatars/*` (`AvatarArt.tsx`), the avatar picker (`AvatarPanel.tsx`), the `avatar.*` i18n keys, avatar tests. Not the theme token files (no new tokens).
- **S17b**: `src/client/themes/{explorer,animals,classroom}/*`, the sound engine (`src/shared/themePackage/sound.ts`, `src/client/themes/sound*.ts`), schema `Sounds`, `docs/examples/*.theme.json` (regenerated), THEMING.

## S17a: Theme engine (D-166)

### Package format
Format version stays **1**; every new field is optional; old packages and `docs/examples/ocean.theme.json` load unchanged (`StoredThemePackage` keeps loading them). Limits in `limits.ts`, field docs in the token/field docs that feed `npm run docs:theming`.

**`scene`**: viewport-scale artwork behind the app.
- `{ layers: 1–3 × { art: SvgSource, viewBox: "0 0 W H", fit: cover|contain|width|height, anchor: bottom|top|center|bottom-left|bottom-right|top-left|top-right, maxHeightVh?: 20–100 }, opacity: 0.3–1, smallScreens: full|bottomStrip|hidden }`.
- Sanitised by the existing SVG sanitiser (`svg.ts`) with a larger scene limit (about 60 KB and 1,500 nodes per layer); the same element/attribute allow-list, colours only as `var(--cc-*)` tokens or the allowed literal forms the sanitiser already accepts.
- Rendered fixed behind content (`pointer-events: none`, `aria-hidden`), `preserveAspectRatio` mapped from fit + anchor. The tile pattern stays above the scene.
- `smallScreens`: below the phone breakpoint `bottomStrip` shows only the last layer as a strip at the bottom (mockup `Phone.dc.html`), `hidden` shows none.

**`frame`**: card silhouettes, trims and corners from **app-defined presets only** (no package SVG here).
- `edge`: `none | snowDrift | scallop | torn`.
- `trim`: `none | candyStripe | garland | lights | frost | stitched | pencil`.
- `corners`: `none | frost | holly | star | compass | leaf`.
- `apply`: which surfaces get edge + corners: `boardBoxes`, `studentCards`, `topBar`, `dock`, `cards` (ordinary cards in teacher/admin pages), `dialogs`. Default when `frame` is set: board boxes, student cards, top bar.
- `trimOn`: which board boxes get the trim (box ids from the board layout model, e.g. the routine and timer boxes); default routine + timer.
- Colours: `snowColor`, `trimColors` (2–3) and `cornerColors` are **token names**, never raw colours; defaults per preset (mockups: snow `#ffffff`-like `art-ground`, candy stripe `accent` + `surface`, garland `deco-1` with `deco-2`/`deco-3` berries, pencil `deco-2` with a pink end from `deco-3`).
- Rendering: a new `ui/Frame.tsx` draws the shapes as overlays outside the content box (`aria-hidden`, `pointer-events: none`); content padding, hit areas and the focus outline are unchanged (the focus ring sits above the overlay). Compact density and phones get the simplified version (caps only, no trims or corners), as in `Phone.dc.html`. Shapes and proportions follow `ThemedBoard.dc.html` and `Frames.dc.html`.

**`ambient`**: app-defined ambient animation, silent.
- `{ preset: none | snowfall | leaves, density: 10–150, speed: slow|medium|fast, color?: token, size: small|mixed|large }`.
- One canvas layer between scene and content, capped at 30 fps, paused while the page is hidden, sized to the viewport (device pixel ratio aware, e.g. 1.25 on the classroom PC).
- Runs only when `motionMode() === 'full'`; with the class animation switch off or `prefers-reduced-motion` it draws **one still frame** instead. Separate from celebrations (own layer, below `.cc-celebration`, no shared code with the celebration bus; dims while a celebration plays).

**`sets`**: choose and recolour built-in sets.
- `achievementFrame: classic | ornament | snowflake | star | shield` (frame around the existing badge art in `src/client/achievements/icons.tsx`; gold/silver/bronze stay tokens). Mind the student page size budget: the student page renders achievements.
- `avatarFamiliesFirst: string[]` (keys from `CREATURE_FAMILIES` in `src/shared/avatars.ts`): only reorders the avatar picker; nothing hidden, stored avatars never change.
- `mascotFrom?`: a built-in theme key whose mascot to use when the package has no mascot art.

### Engine fixes
- **One mascot everywhere**: built-in illustrations take the mascot from the active theme definition through a mascot context in `themes/art.tsx`, instead of importing it. A package that keeps base illustrations shows its own mascot in them.
- **Board**: `Root.tsx` mounts the scene and ambient layers beside `ThemeBackdrop`; board boxes (`Box.tsx`), student cards and the top bar use `Frame` when the theme asks. Text never sits directly on the scene: top bar, dock and boxes keep surface backgrounds; headings on the page background get a `scene-scrim` token panel when a scene is set (new token, contrast-checked against text by the validator).
- **Definitions**: `ThemeDefinition` (`themes/types.ts`) gains optional `scene`, `frame`, `ambient`, `sets`; `custom.tsx definitionFromPackage` maps them; `packageFromDefinition` exports them. Built-in themes stay as they are in S17a (S17b remakes them).

### Admin → Themes
`ThemePackagePreview`: the classroom sample shows the scene, frames and ambient; a **Motion on/off** toggle in the preview (mockup `AdminPreview.dc.html`); the Scene/Frames/Ambient/Sets blocks; validation reports cover the new fields (sizes, node counts, contrast of the scrim). Enabling stays a human step.

### MCP
The theme tools (`theme_schema`, `validate_theme`, `import_theme_draft`, the examples resource) pick up the new schema automatically; add tests that they expose and validate the new fields.

### Snow Day example package
`docs/examples/peppermint-snow-day.theme.json`: the owner's package (`C:\Users\owner\Downloads\peppermint-snow-day.theme (1).json`) extended per `Main.dc.html` / `ThemedBoard.dc.html` (theme `snow`):
- a 3-layer village scene (far hills, fir trees, cottages with lit windows and string lights), cover, bottom anchor, `smallScreens: bottomStrip`;
- `frame`: edge `snowDrift`, trim `candyStripe` on routine + timer, corners `frost`;
- `ambient`: snowfall, slow, mixed, density about 60;
- `sets`: achievement frame `snowflake`.

Validate it with `validateThemePackage` (and a test that keeps it valid). Fictional text only. Copy it to `C:\Users\owner\Downloads\peppermint-snow-day.theme.json` for the owner. Do not enable it anywhere.

### Docs
THEMING: a section "Scenes, frames, ambient and sets" (fields and limits, fit and anchor per screen size, the contrast rules, an authoring recipe for AI agents) and a mention in "For AI agents: making a package"; `npm run docs:theming` regenerates the tables and `docs/theme-package.schema.json`; EN/TR admin guide note.

### Tests
Schema and validator for the new fields; scene SVG limits through the sanitiser fuzz test; no CSS/SVG injection through frame tokens or scene art; old packages and `ocean` load unchanged; ambient off/still with the class switch off and with reduced motion; the package mascot appears in base illustrations; avatar picker order; achievement frame rendering. e2e (`e2e/theme-packages.spec.ts` extended): import the Snow Day package, preview, enable, a class uses it; the board shows scene, frames and snowfall at 1536×703 (scale 1.25) and 1920×1080, the still scene with motion off; keyboard focus visible on framed cards; tap target bounding boxes unchanged vs. no frame; axe on the board and the preview; delete falls back. Performance: snowfall at 1536×703 has no long tasks over 50 ms (measure in Playwright with a PerformanceObserver). The student page size budget passes.

## S18: Full screen during lessons (D-167)
- **Start lesson** calls `document.documentElement.requestFullscreen()` inside the click handler (browsers need a user gesture); **End lesson** calls `document.exitFullscreen()` if the document is in full screen. Failures are ignored silently (no error to the class).
- While a lesson runs and the page is not in full screen, the board top bar shows a **Full screen** button; in full screen a small **Leave full screen** button (icon with an accessible name). Esc always leaves (browser behaviour; never block it).
- Where the browser has no Fullscreen API (`document.fullscreenEnabled` false, e.g. iPhone) nothing is shown and nothing is called.
- Per-account setting **"Full screen during lessons"** (on by default) via `src/server/lib/userSettings.ts` and the teacher settings page; when off, Start/End lesson do not touch full screen (the button still works).
- `displayInfo` records `fullscreen: boolean` (strict Zod field, admin table column), so the admin sees whether the classroom uses it; update D-165 notes and the removal list if needed.
- Dialogs, the PIN lock, celebrations and toasts keep working in full screen (the whole document is full screen).
- Tests: client tests with a stubbed Fullscreen API (called on start, exited on end, not called when the setting is off or unsupported, button visibility); e2e with a stubbed API (Playwright headless has no real full screen) through Start and End lesson; i18n EN/TR; teacher guide EN/TR.

## S17b: Built-in themes remade + sound styles (D-168)

### Built-in themes remade (mockup `ThemedBoard.dc.html`, props explorer/animals/classroom)
Each built-in gets a scene, frames, ambient and sets, using only the S17a engine (no theme-key branches in components):
- **Explorer** (Compy): a scene of a map table and rolling hills with a dotted trail, flags, tents and round trees, a large faint compass rose in the sky; edge `torn`, trim `stitched` on routine + timer, corners `compass`; no ambient; achievement frame `shield`; avatar families first: space, animals.
- **Animals** (Fındık): a meadow with a sun, round trees, flowers and a burrow; edge `none`, trim `garland` (leaf vine with flowers) on routine + timer, corners `leaf`; ambient `leaves` (slow); achievement frame `classic`; families first: animals, sea.
- **Classroom** (Yıldız): a sunny classroom wall with windows, bunting, bookshelves and a plant; edge `scallop`, trim `pencil` on routine + timer, corners `star`; no ambient; achievement frame `star`; families first: robots, space.
- Contrast, focus, tap targets unchanged; the usability screen crawl and screenshots compared before/after; `npm run docs:theme-examples` regenerates the built-in examples with the new fields.

### Sound styles
- `sounds.style`: `tones` (today's synthesis, the default when absent) | `bells` | `marimba` | `chimes` | `musicBox`. App-defined Web Audio synthesis only (no audio files; partials/envelopes per style), every existing limit still applies (peak level, length, the sound switches and volume, the iPad unlock path).
- The schema, validator, docs, the generated schema and the MCP theme tools include it; a test checks the MCP `theme_schema` lists the styles and `validate_theme` rejects an unknown one.
- Choices: Snow Day `bells` (update the example package and the Downloads copy), Explorer `marimba`, Animals `musicBox`, Classroom `chimes`.
- Admin preview: the existing sound preview plays the style.

## S17c: Avatars (D-169)
From a read-only avatar review on 2026-11-11 (sheets of every species and colour at 46–96 px, pixel ratio 1.25). The owner's rule: **a child's avatar never changes or disappears**. Every item below keeps stored specs valid and drawn as the same character.

Findings that drive this stage:
- `generatedAvatar(id)` (the class fallback default 'generated') and `READY_MADE` draw from the live catalogue lists, so **any** new family, species, colour or option silently changes the creature of every child who never chose one. Only determinism within one catalogue is tested.
- Faces are tiny at board size (dot eyes r 2.4 of 100, about 1 px at 46 px; side-view dinosaur faces scaled 0.55–0.75); most expressions are indistinguishable at 46–58 px.
- Features are always `avatar-ink` (#1d2033): contrast against navy 1.59:1, brown 2.83:1, purple 3.36:1, red 3.78:1, blue 3.91:1; on person skin tones 10–12 the face nearly disappears (a fairness problem). No test covers ink against body colours or skins.
- Body and background colours are picked independently: 13 of 120 ready-made and about 7.6 % of generated avatars have the same body and background colour.
- Sports, space, fruits and robots are bare geometry next to the S14 dinosaurs and mythical creatures (football disc, pilot without a rocket, plain carrot, strawberry like a shield).
- Hats cover the cat/bunny ears and sit across the face on some species; scarves float on the carrot and strawberry.
- The creator is text-only native selects; the 120 ready-made avatars are not grouped by family.
- Turkish: `teal` "çam yeşili" → "petrol yeşili"; `hat.cap` "kep" → "şapka"; more natural accessible names ("Kepli ve atkılı mavi kedi" style).

Scope:
1. **Freeze the defaults** (first, before any catalogue change): a frozen copy of the v1 catalogue lists used only by `generatedAvatar` and `READY_MADE`; golden tests with about 20 fixed student ids and all 120 ready-made specs exactly as today. A test and a CONVENTIONS rule: catalogue keys are never removed or renamed (only added).
2. **Readability and fairness in the renderer** (same specs, re-rendered): creature faces about 1.4× larger at the same anchors (bigger eyes and pupils, stroke 2.4–2.6), dinosaur faces not below 0.75; every eye style gets a light rim or catch-light so it reads on dark bodies and dark skins (no new theme tokens); when body and background are equal or a near pair, a lighter background veil or a 2 px `avatar-outline` rim; hats and scarves placed per species (cat and bunny ears, fluffy, round robot, carrot, strawberry). A contrast test: features vs every body colour and skin tone ≥ 3:1 in every built-in theme and the Snow Day example.
3. **Richer plain families** to the S14 level: football with a hexagon pattern and the face on white, pilot with helmet, visor and a small rocket (or rename it), astronaut with visor glint, carrot with taper and ridges, heart-shaped strawberry with seeds, star kid with rounded points; robots and the remaining plain species checked the same way.
4. **Picture-based picker** (`AvatarPanel.tsx`): colour swatches and picture buttons for eyes, mouth, hat and accessory (radio groups with labels, keyboard and screen-reader friendly, touch targets ≥ `var(--cc-touch)`); family tabs with species thumbnails; ready-made avatars grouped by family and honouring the theme's `avatarFamiliesFirst`; Randomise never gives body = background. Choosing a family keeps the chosen species when possible.
5. **Turkish and names**: the fixes above; accessible names in natural Turkish; EN names checked.

Not in this stage (later, owner to choose): new families (arctic, forest, farm, bugs, a sea turtle), seasonal hats and accessories, a theme-chosen avatar style (outline, shading, face scale), more expressions. All of them become safe additions once the defaults are frozen.

Tests: the golden defaults, the contrast test, picker unit tests (grouping, order, Randomise rule), axe on the picker, Playwright screenshots of all species × 12 colours at 48 px before and after (saved for the owner), the student page size budget (the student page shows avatars and may host the picker).

## Verification (lead, after each wave)
`npm run check`, `npm run build` (student budget), the full `npx playwright test`, screenshots of the board in all four themes at the test matrix sizes with motion on and off, the Admin preview, and a phone. Real-device checks (the classroom display, speakers) stay open for the owner.
