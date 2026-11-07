# Extending Class Compass: modules, themes, languages

Owner request 2026-11-07 (D-069, D-070): adding a module or a theme must be easy, and a theme is
more than colours. This guide is the checklist. Every rule in CONVENTIONS.md still applies.

Both registries are **one list per side** and are test-enforced, so a forgotten line fails
`npm run check` instead of silently doing nothing.

| | Shared key list | Server | Client |
|---|---|---|---|
| Module | `src/shared/modules.ts` (`CONTEXT_MODULE_CATALOG`) | `src/server/modules/<m>/manifest.ts`, listed in `src/server/modules/index.ts` | `src/client/modules/<m>/manifest.tsx`, listed in `src/client/modules/index.ts` |
| Theme | `src/shared/themes.ts` (`THEME_KEYS`) | `classes.theme` validates against the key list | `src/client/themes/<t>/`, listed in `src/client/themes/registry.ts` |

## Add a module

Start with the scaffold. It generates the skeleton, the registry lines and a test stub:

```sh
npm run new:module -- homeworkTracker --dry-run   # list what would change
npm run new:module -- homeworkTracker
```

It creates:
- a line in `CONTEXT_MODULE_CATALOG`, disabled by default;
- `module.<key>`, `<key>.title` and `<key>.placeholder` in `en.ts` and `tr.ts`, with the Turkish lines marked `// TODO(tr)`;
- the server manifest and an empty `commands.ts`;
- the client manifest with a placeholder dashboard slot;
- `tests/server/<key>.test.ts`, with `it.todo` entries.

The result typechecks and passes the manifest tests (`tests/scripts/scaffold.test.ts` proves this).
The placeholder panel is **not** a finished feature. Replace it before ticking any ROADMAP box.

### Server manifest (`defineServerModule`)

| Field | What it does |
|---|---|
| `key` | The folder name (unique). |
| `policyKey` | The catalogue key that switches the module per class+subject; `null` for always-on core modules. |
| `routes(app, deps)` | Endpoints declared in `src/shared/contracts/<m>.ts` with `endpoint()` and registered with `route()` (access classes, ownership checks in services). |
| `commands` | Outbox commands declared with `command({...})` from `lib/commands.ts`. Only manifests register them (test-enforced). Classroom writes go through commands, which audit and use `ctx.now()`. |
| `lessonState` | `{ key, stamp, build }` contributors to the polled lesson state (classroom-safe only; `stamp` feeds the ETag). |
| `endSteps` | `endLessonStep({ key, module, order, input, apply })`. `module` must equal `policyKey` (checked at start-up). Order below 100 runs before the core reflection. |
| `lessonCloseHooks`, `attendanceListeners` | Synchronous hooks inside the writing transaction (D-067). |
| `reports`, `studentPage` | S11 and S10 hooks. They are collected now (`reportContributions()`, `studentPageContributions()`) but not served yet. |
| `config` | `{ schema: z.object({...}), defaults }`. A teacher's patch is validated with `schema.partial().strict()`; an invalid one gets 400 `VALIDATION` with `details.reason` `INVALID_MODULE_CONFIG`. Read it with `moduleConfig(db, contextId, module)`, which returns the defaults overlaid with the stored values. Defaults must satisfy the schema (test-enforced). |

The list order in `SERVER_MODULES` is the registration order, which matters for hooks that run in
sequence.

### Client manifest (`defineClientModule`)

| Field | What it does |
|---|---|
| `key`, `policyKey` | Same meaning as on the server. Every client `policyKey` needs a server manifest with the same key (test-enforced). |
| `i18nNamespace` | Prefix of the module's strings. Keys under it must exist in en and tr. |
| `dashboardSlots` | `{ key, module, order, Component }` on the classroom dashboard. Shown only while the module is enabled. |
| `startSteps` | `{ key, module, order, title, Component }` in Start Lesson. |
| `endSteps` | `endStepUi({ key, title, initial, Component })`. `key` equals the server step key; every server step needs one (test-enforced). |
| `studentCardAddons` | `{ key, module, useAddon }`: header rows and per-card extras on the student grid. `useAddon` is a hook that is always called. |
| `teacherPages` | `{ key, path, labelKey, Icon, order, Component }`: a menu tile, a nav link and the route `/teacher/<path>` inside the PIN gate. Link with `<Link to="/teacher/$page" params={{ page: 'x' }}>`. |
| `settingsPanel` | `{ Component }`, shown under the module's switch on the class settings page. |
| `invalidations` | Outbox command prefix to the query keys to refresh. |

Ordering is deterministic: lists are sorted by `order`, then by `key`. Orders must be unique per list
(test-enforced), so pick a free multiple of 10.

### Checklist

- [ ] Catalogue line in `src/shared/modules.ts` (the scaffold adds it).
- [ ] Server manifest listed in `SERVER_MODULES`. Client manifest listed in `CLIENT_MODULES`.
- [ ] Contracts in `src/shared/contracts/<m>.ts`, with access classes and output allow-lists.
- [ ] Classroom writes are commands with audit, `ctx.now()` and `lessonForCommand` for lesson-scoped writes.
- [ ] Gate with `assertModuleEnabled`. Disabled modules keep their data.
- [ ] Schema changes appended to `src/server/db/schema.ts`, then `npm run db:generate -- --name <stage_desc>`.
- [ ] Every string in en **and** tr. Translate the scaffold's `TODO(tr)` lines.
- [ ] UI from `src/client/ui`, semantic tokens only, theme slots via `useTheme()`, `<ThemeIllustration>` and `<Mascot>`. Never branch on a theme key.
- [ ] Tests: HTTP behaviour, permissions (`permissions.test.ts` covers new endpoints automatically), audit, replay. Name requirement IDs in the tests.
- [ ] ROADMAP: add the boxes and tick only what is done. Add DECISIONS entries for new patterns.

## Add a theme

A theme is a folder `src/client/themes/<key>/` that fills **every** slot of `ThemeDefinition`
(`src/client/themes/types.ts`). Start with the scaffold, which copies the default theme with renamed
identifiers so the tests stay green while you change it:

```sh
npm run new:theme -- ocean --dry-run
npm run new:theme -- ocean
```

It adds the key to `THEME_KEYS` (so the server accepts `classes.theme = 'ocean'`), the folder, the
registry line, the names in en and tr (Turkish marked TODO) and `tests/client/theme-<key>.test.ts`.

### Slots

| File | Slot | Notes |
|---|---|---|
| `tokens.ts` | `colors` (`COLOR_TOKENS`) | Use `themeColors({...})` from `../base.ts`; it derives counter, segment, icon and pattern colours. Covers surfaces, text, accent, focus, success/warning/danger, display banner, counter levels 0–3 with edges, counter colour keys, avatar text, icon accent, decoration, pattern, mascot and art colours. **Colour literals live only in `base.ts` and the `tokens.ts` files** (lint-enforced). |
| `tokens.ts` | `typography` | Body and display font stacks (system fonts only: nothing is downloaded and CSP is `font-src 'self'`), four weights, letter-spacing. |
| `tokens.ts` | `shape` | Radii, border widths, shadows (use `var(--cc-shadow-color)`). |
| `tokens.ts` | `avatar` | Saturation and lightness for avatar circles (big, and small with 4.5:1 initials). |
| `tokens.ts` | `icons` | Stroke width, linecap and linejoin of the line icons (the icon accent style). |
| `art.tsx` | `Mascot` | Original SVG in a 100×100 box with the poses `idle`, `cheer`, `thinking`, `celebrate` and `sleepy`, all distinct (test-enforced). |
| `art.tsx` | `Decoration`, `Pattern` (+ `patternSize`) | Corner decoration and background tile. Kept subtle by `decoOpacity` ≤ 0.6 and `patternOpacity` ≤ 0.15. |
| `art.tsx` | `illustrations` | `lockScreen`, `emptyState`, `threshold`, `startLesson`, `endLesson`, `celebration`, each in a 200×140 box and decorative (`aria-hidden`). The lock screen art must not hint at the page behind it. |
| `index.ts` | `motion` | `celebrate` and `threshold`. Each has `full` and `reduced` variants, plays once and lasts 150–1500 ms. `reduced` is opacity only (`FADE_IN`). No flashing: opacity changes direction at most once. |
| `index.ts` | `sounds` | Optional (`null` means silent). `timerEnd` and `celebrate` are WebAudio tone lists, ≤ 1500 ms, gain ≤ 0.3, played only when the class and the device allow sounds. |

All art is coloured with `tok('name')` (that is, `var(--cc-name)`), never literals. Shared building
blocks (`Face`, `Arms`, `Scene`, `Sparkles`, `Confetti`, …) are in `src/client/themes/art.tsx`.

### What the registry gives you

- **CSS.** `installThemeStyles()` writes one complete token block per theme (`[data-theme='<key>']`, the default theme also on `:root`) plus its keyframes, so nested previews work.
- **React.** `ThemeProvider` (previews and catalogue), `useTheme()`, `<Mascot pose motion>`, `<ThemeIllustration name motion>`, `<ThemeDecoration>`, `<ThemeBackdrop>`, `useThemeMotion()` and `useThemeSound()`. Components use these and never branch on a theme key (theme lint).
- **Everywhere that lists themes iterates `THEME_LIST`.** That covers the admin class editor, the teacher preview, `/dev/catalog`, the e2e axe loop with per-theme screenshots, and the contrast and slot tests.

### THM-3: same controls, same meanings

A theme changes how things look, never what they are. Every theme keeps the same controls, the same
labels, the same counter levels (number + pattern + word) and the same flows.

### Checklist

- [ ] `npm run new:theme -- <key>`, then edit `tokens.ts`, `art.tsx` and `index.ts`.
- [ ] `npm run check`, which runs:
  - `tests/client/themes.test.tsx`: every slot, WCAG pairs (AA body text, AAA classroom text on page and cards, 3:1 UI and focus), avatar hue sweep, motion and sound limits;
  - `tests/client/lint-rules.test.ts`: no literals outside token sheets, identical token sets, no theme branching.
- [ ] Look at `/dev/catalog` (all poses and illustrations; the animation switch replays motions; sound buttons) in both languages and at 200 % text.
- [ ] `npm run test:e2e -- catalog` (axe on every theme, plus screenshots attached to the report).
- [ ] Translate the `TODO(tr)` lines. Record the theme in ROADMAP and DECISIONS.

## Add a language (notes)

Not scaffolded yet. English and Turkish are the supported pair, and much of the code assumes exactly
these two.

- `src/shared/i18n/<lang>.ts` must satisfy `Messages` (every key, type-checked). Extend the `Locale` type and `translate()` in `src/shared/i18n/index.ts`, including plural rules via `Intl.PluralRules` (`_one`/`_other` keys).
- `tests/client/lint-rules.test.ts` compares en and tr keys and placeholders. Extend it to the new dictionary.
- Teacher-editable labels are `{en, tr}` JSON (`pickText`). A new language needs a schema change for those labels and a migration. Record that as a decision first.
- Names are sorted with Turkish collation (`sortByName`). Check that this is still right for the new language's users.
- The profile language picker and the `language.*` keys list the locales.
