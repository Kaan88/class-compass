# Extending Class Compass: modules, themes, languages

Owner request 2026-11-07 (D-069, D-070): adding a module or a theme must be easy, and a theme is
more than colours. This guide is the checklist. Every rule in CONVENTIONS.md still applies.

Both registries are **one list per side** and are test-enforced, so a forgotten line fails
`npm run check` instead of silently doing nothing.

| | Shared key list | Server | Client |
|---|---|---|---|
| Module | `src/shared/modules.ts` (`CONTEXT_MODULE_CATALOG`) | `src/server/modules/<m>/manifest.ts`, listed in `src/server/modules/index.ts` | `src/client/modules/<m>/manifest.tsx`, listed in `src/client/modules/index.ts` |
| Theme | `src/shared/themes.ts` (`THEME_KEYS`, built-in) | `classes.theme`: a built-in key or an enabled theme package (`assertThemeUsable`, D-158) | `src/client/themes/<t>/`, listed in `src/client/themes/registry.ts` |

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

### School-wide modules (S12, D-127)

A module that the administrator switches on for the whole school (not per class+subject), like Super
Speakers, is listed in `SCHOOL_MODULE_CATALOG` instead of `CONTEXT_MODULE_CATALOG` (move the
scaffold's line). Its `policyKey` is still the key; it has no `config`; gate it with
`isModuleAvailable(db, key)`. Admin → Modules shows it under "School-wide modules". Its report and
timeline contributions appear while the school switch is on. If it needs its own principals (links,
screens), add an access class in `define.ts` (`ACCESS_CLASSES`), a cookie and a resolver in
`lib/http.ts`, and extend `tests/server/permissions.test.ts` so a session of the new class is proven
to reach only its own endpoints (see D-128). A separate client entry (its own HTML file, like
`scorer.html` and `board.html`) goes into `vite.config.ts` (`input` and the dev rewrite) and is served
by `app.ts` with `no-store`. Super Speakers pages may be served on their own origin (S14f, D-157): a new scorer or board endpoint goes under `/api/scorer…` / `/api/board…` (the CSRF origin class follows the path), and a new page or file they need goes into the speakers-host allow-list in `src/server/lib/speakersHost.ts`.

### Server manifest (`defineServerModule`)

| Field | What it does |
|---|---|
| `key` | The folder name (unique). |
| `policyKey` | The catalogue key that switches the module per class+subject; `null` for always-on core modules. |
| `routes(app, deps)` | Endpoints declared in `src/shared/contracts/<m>.ts` with `endpoint()` and registered with `route()` (access classes, ownership checks in services). |
| `commands` | Outbox commands declared with `command({...})` from `lib/commands.ts`. Only manifests register them (test-enforced). Classroom writes go through commands, which audit and use `ctx.now()`. |
| `lessonState` | `{ key, stamp, build }` contributors to the polled lesson state (classroom-safe only; `stamp` feeds the ETag). |
| `endSteps` | `endLessonStep({ key, module, order, input, apply, when? })`. `module` must equal `policyKey` (checked at start-up). Order below 100 runs before the core reflection. The optional `when(db, contextId)` (S13c, D-126) leaves the step out unless it applies (the achievements "Well done!" step, order 70, only when the class chose it). |
| `startSteps` | S14b (D-149): `startLessonStep({ key, module, order, input, onResume?, apply })`, the server side of a client start step whose `useContribution` sends `lesson.start` `steps[key]`. Runs inside the start command after the lesson row and the start-screen attendance; a missing input skips it, an invalid one fails the start (`START_STEP_INVALID`). `onResume: true` also runs it when the start resumes a running lesson (per-day data, like the assistant's duty ticks). `apply` may return `StartStepNotes` for the start result (`dutiesDropped`). Every server start step needs a client start step with the same key (test-enforced). |
| `lessonCloseHooks`, `attendanceListeners` | Synchronous hooks inside the writing transaction (D-067). |
| `activityListeners` | S13c (D-126): `(ctx, activity) => void`, called inside the writing transaction when a module calls `emitStudentActivity(ctx, { source, studentIds, contextId?, subjectId? })` from `lib/activity.ts` after a student-related write (goals, evidence, reflections, homework marks, assistant duties, Secret Student outcomes). Achievements re-evaluate their rules here. A new module whose data should earn badges emits activity and adds a rule event to `RULE_EVENTS` / `EVENT_SOURCE` (`shared/achievements.ts`) with its fact in `achievements/facts.ts` and `domain/achievements.ts`. |
| `reports`, `timeline`, `studentPage` | S11 and S10 hooks. Each contribution is stamped with the manifest's `policyKey` when it is registered, and `reportContributions` / `timelineContributions` / `studentPageContributions(db, contextId)` return only those of core modules and of modules enabled for that class+subject, so a switched-off module's section is never served (CFG-2, ACC-12). **Reports** (S11, D-091): `{ key, order, meta, build(ctx, scope) }` returns a `ReportSectionData` (title, optional note, tables of typed cells) or `null`. `scope` gives the context, period, viewer (`teacher` / `admin`), optional student, the students in the class in the period, `enrolledOn(studentId, date)` and the lessons held. Build cells only with `src/server/modules/reports/cells.ts` (`n(v, d)` with its denominator, `NR` not recorded, `ABSENT`, `NA` not in the class, `text(then, now)` for renamed labels, `date`, `range`, `student`, `days`); never return 0 for something not recorded and never an overall score (RPT-5). A table's `chart` is drawn from the table's own rows, and the table is always shown with it. Hide notes from `viewer: 'admin'` where the teacher wrote them for themselves. Orders in use: 10 overview, 15 lesson topics, 20 attendance, 30 counters, 40 homework, 50 goals, 60/61 reflections, 70/71 assistant and Secret Students, 80 grouping history, 90 achievements, 95 Super Speakers. CSV and print come for free. `meta` (S14e1, D-153) is the section's entry in the report catalogue that saved report views and the Customise tree use: `{ title: <i18n key>, tables: [{ key, title, perItem? }] }`, listing every table `build` may return (`perItem: true` for one table per item, keyed `<key>-<id>`, like the counter tables). `build` runs only when the section is requested (`ReportInput.sections`), and the reports module keeps only the requested tables; `tests/server/report-views.test.ts` and the demo-history test check `meta` against the tables actually produced. A new section may also be added to a built-in view in `src/shared/reportViews.ts` (`BUILTIN_VIEWS`). **Timeline**: `{ key, order, build(ctx, scope, studentId) }` returns dated `TimelineEvent`s for one student (only what the teacher may see; no pre-reveal Secret Student identity, no private notes). The student page (S10) serves `studentPage`: the key and data shape must be in the shared `StudentPageSection` union and its home tiles and screens in `src/client/student/sections.tsx` (S14d, D-151: `STUDENT_SECTIONS[key]` lists `{ screen, label, Icon, show?, isNew?, render }`; a new screen name goes into `SCREENS` in `student/nav.ts` and `TILE_ORDER`; long input is split into short steps with `step` in the address). |
| `config` | `{ schema: z.object({...}), defaults }`. A teacher's patch is validated with `schema.partial().strict()`; an invalid one gets 400 `VALIDATION` with `details.reason` `INVALID_MODULE_CONFIG`. Services read it with `moduleConfig(db, contextId, module)`, which returns the defaults overlaid with the stored values that pass the schema (an invalid stored value, e.g. from before SX, falls back to its default); never read `getModuleConfig` (raw JSON) in a service. Services write with `mergeModuleConfig`, which validates the patch the same way. Defaults must satisfy the schema (test-enforced). |

The list order in `SERVER_MODULES` is the registration order, which matters for hooks that run in
sequence.

### Client manifest (`defineClientModule`)

| Field | What it does |
|---|---|
| `key`, `policyKey` | Same meaning as on the server. Every client `policyKey` needs a server manifest with the same key (test-enforced). |
| `i18nNamespace` | Prefix of the module's strings. Keys under it must exist in en and tr. |
| `dashboardSlots` | `{ key, module, order, dock?, Component }` on the classroom board (S14b, D-148), shown only while the module is enabled. `key` is the slot's box in `BOX_CATALOGUE` (`src/shared/classroomLayout.ts`): add an entry there with its default place (`row` or `dock`), whether it may be a box and/or a dock button, and its minimum width/height (test-enforced). `dock: { Icon, label, useBadge? }` is its dock button (a badge is a short count the class may see); a slot without `dock` renders its own control in the dock (the attendance button). `Component` gets `{ context, lesson, presentation }`: `'box'` on the board, `'dock'` in the full-screen view its dock button opens (show feedback and undo inside it). A slot may render `null` when it has nothing to show (its box then disappears). |
| `startSteps` | `startStep({ key, module, order, title, initial, Component, useContribution? })` in Start Lesson. `Component` gets `{ context, value, onChange }`; the value is kept in the per-class start draft. `useContribution(context, value, enabled)` is a hook (called for every registered step, with `enabled` false when the module is off, and then it must add nothing) that returns `{ input, ready }`: `input` is the step's part of the one `lesson.start` command (attendance adds `attendance` + `othersPresent`, routines add `routineTemplateId`, the assistant adds `steps.assistant`), and `ready: false` keeps "Begin" disabled (e.g. while loading). A module's own data goes under `steps[<key>]` with a server `startSteps` entry (S14b; `steps` is merged key by key); only core fields extend `LessonCommands['lesson.start']` itself. |
| `endSteps` | `endStepUi({ key, title, initial, Component })`. `key` equals the server step key; every server step needs one (test-enforced). |
| `studentCardAddons` | `{ key, module, useAddon }`: a `summary` beside the student heading, `header` rows above the grid and per-card extras (counts, the attendance chip). `useAddon` is a hook that is always called. |
| `teacherPages` | `{ key, path, labelKey, Icon, order, menu?, Component }`: the route `/teacher/<path>` inside the PIN gate plus, unless `menu: false`, a menu tile and nav link (a sub-page such as counter history sets `menu: false`). `Component` gets `{ search }`, the URL's string search parameters. Link with `<Link to="/teacher/$page" params={{ page: 'x' }}>` (add `search={{ id }}` to preselect something). |
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
- [ ] A demo history generator (below), so the test VM shows the module with weeks of data.

## Demo history generators

`seed:demo-history` (OPERATIONS.md, test VM) fills the demo school with about nine past school weeks
of fictional history. It is driven by `src/server/seed/history.ts` and one small generator per module
in `src/server/seed/history/<module>.ts`, listed once in `HISTORY_GENERATORS`
(`src/server/seed/history/generators.ts`). The run builds a weekly timetable for every class+subject,
then walks the school days in order (Europe/Istanbul or the school timezone, weekends and a few fixed
holidays skipped), starting and ending every lesson through the real commands on a backdated clock.

A generator is `{ key, module, …hooks }` (`HistoryGenerator` in `history/types.ts`):

| Field / hook | When it runs |
|---|---|
| `key` | Name in the printed summary (`h.count(key, 'what', n)`). |
| `module` | The catalogue key (`src/shared/modules.ts`), or `null` for core. The generator is skipped for a class+subject where the module is off, and everywhere when the key is not in this build's catalogue, so a generator can be merged before or after its module. A school-wide module (`SCHOOL_MODULE_CATALOG`, off by default) is switched on by its own generator in `setupSchool` (Super Speakers). |
| `setupSchool(h)` | Once for the whole school, before the class+subject setups: switch a school-wide module on, make its links (as `h.admin`). |
| `setup(h, plan)` | Once per class+subject before the first lesson: settings, defaults, plans. |
| `startOfWeek(h, plan, week)` | Monday morning, before the week's first lesson. |
| `startInput(h, plan, date)` | Fields merged into the `lesson.start` payload. |
| `duringLesson(h, lesson)` | While the lesson runs. Place events with `h.during(lesson, 0…1)`. `lesson.state` is the polled lesson state (counters, assistant, groups); `h.present(lesson)` lists who is in the room. |
| `endSteps(h, lesson)` | End Lesson step inputs merged into `lesson.end` (`{ <stepKey>: input }`). |
| `afterLesson(h, lesson)` | Teacher-area work after the lesson (also after an abandoned one). |
| `endOfWeek(h, plan, week)` | After the week's lessons: evening and weekend work (set the time with `h.setTime(h.at(day, 'HH:MM'))`). |
| `endOfSchoolWeek(h, week)` | Once per week for the whole school, after every class+subject's `endOfWeek` (school-wide work, e.g. the week's Super Speakers points). |
| `finish(h)` | Once after the last week: work earlier today, before `h.realNow` (this week's board podium). |

Rules:
- **Write through the app.** Classroom actions go through `h.command(plan.ctx, type, payload)` (the real
  `executeCommand`: audit, command log, `ctx.now()`); a refusal throws unless its `details.reason` is
  in the `allow` list. Teacher-area and student-page actions call the module's service with
  `h.call(endpoint, serviceFn, ctx, input)`, which validates `input` with the endpoint's own schema.
  The student page context is `h.student(studentId)` (the student's permanent link) and the
  administrator's is `h.admin`; a scorer context is `h.admin` with `user: null`, `scorer` set and a
  `scorer` actor. Insert rows directly only where no service exists, and say so in the generator's
  header.
- **Respect the boundaries.** A generator never reads tables another module owns privately (Secret
  Student selections, private notes): it uses what the commands and services return (the reveal
  result, the private-note service), so the boundary tests stay green.
- **Deterministic and fictional.** Use `h.rand/chance/int/pick/shuffle` (mulberry32), never
  `Math.random`; text comes from `history/text.ts` (short child-like English and Turkish sentences,
  links only on example.org / example.com / example.net). Student text must pass the S13c text checks
  (D-123; the services refuse it otherwise, and a test checks every student string in `text.ts`). Keep
  cross-hook state in `h.memo(key, init)`. Never print or log link tokens.
- **The past only.** `h.setTime` refuses an instant at or after the real "now". Lessons never fall on a
  weekend or a holiday.
- Keep it cheap: the whole run (one transaction, about 20–30 s on a laptop) must stay under a minute
  on the test VM. Every student activity re-evaluates the achievement rules once badges have started,
  so the history starts them (quiet backfill) only in the last full week.
- `tests/server/seed-history.test.ts` checks that every generator of a module that is in the catalogue and
  switched on in the demo school (or school-wide) creates something, so a new generator is covered
  automatically.

Example (a points module):

```ts
export const pointsGenerator: HistoryGenerator = {
  key: 'points',
  module: 'points',
  duringLesson(h, lesson) {
    for (const studentId of h.present(lesson).filter(() => h.chance(0.2))) {
      h.during(lesson, 0.3 + h.rand() * 0.6);
      h.command(lesson.plan.ctx, 'points.award', { contextId: lesson.plan.context.id, lessonId: lesson.lessonId, studentId, points: 1 });
      h.count('points', 'points awarded');
    }
  },
};
```

## Add a theme

> **Agents: read [THEMING.md](THEMING.md) first.** It explains the sound packs, the SoundManager,
> celebrations and the time's-up announcement (S13b, D-110), theme packages (S14g, D-158), palette
> design, every colour token and every limit, with recipes for a new theme, a theme package, a new
> sound event, a new token and a new celebration trigger.

**A theme without code (S14g, D-158).** Most new looks do not need a built-in theme: an
administrator imports a **theme package** (JSON) on Admin → Themes. Start from Export of the closest
theme and follow THEMING.md → "Theme packages". Make a built-in theme only when it needs art or
motions the package format cannot express.

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
| `index.ts` | `sounds` | A sound pack with one cue per classroom event (`SOUND_EVENTS`), usually `makeSoundPack({ root, wave, scale, gain, tempo }, overrides)`; `null` means silent. Synthesized only, gain ≤ 0.3, short cues ≤ 1.2 s, celebration cues ≤ 2.5 s (THEMING.md). |
| `index.ts` | `celebration` | `colors`: 2+ colour tokens for the celebration fireworks. |

All art is coloured with `tok('name')` (that is, `var(--cc-name)`), never literals. Shared building
blocks (`Face`, `Arms`, `Scene`, `Sparkles`, `Confetti`, …) are in `src/client/themes/art.tsx`.

### Theme hooks (S14g, D-158)

| Hook | Where | Use |
|---|---|---|
| `validateThemePackage(textOrValue)` | `src/shared/themePackage/validate.ts` | The one check of a package (server, admin page, MCP, tests). |
| `assertThemeUsable(db, key)` / `effectiveTheme(db, key)` / `isThemeUsable(db, key)` | `src/server/modules/themes/service.ts` | Before writing a theme key / when sending one to a screen / with the stored key in an editor (`themeAvailable`), so a round trip keeps a switched-off choice. |
| `themeOf(key)`, `pickerThemes()` | `src/client/themes/registry.ts` | Resolve a key (falls back to the default); list choosable themes. |
| `registerThemePackage(pkg, status, key?)`, `loadThemePackage(key)`, `useAvailableThemes()` | `src/client/themes/custom.tsx` | Make a package a live theme or a preview; load the one the display needs and re-check it (ETag) so a replaced package appears; load the enabled ones for pickers. |
| `<ThemePicker value switchedOff>`, `<ThemeNameLabel theme switchedOff>` | `src/client/ui/ThemePreview.tsx` | Choose a theme; `switchedOff` when the stored choice is an imported theme that is not enabled now. |
| `useThemeLabels(def)`, `useThemeName(key)` | `src/client/themes/index.tsx` | A theme's names (imported themes carry their own). |
| `<SvgTree nodes>` | `src/client/themes/SvgTree.tsx` | Draw sanitised package art. |
| `themeSounds(params, overrides)` | `src/client/themes/soundPack.ts` | A built-in theme's sounds plus the parameters exported into packages. |
| `presetMotion`, `FONT_PRESETS`, `SHADOW_PRESETS` | `src/shared/themePackage/motion.ts`, `presets.ts` | Motions, fonts and shadows by name (built-in themes use them too). |
| `npm run docs:theming` | `scripts/theme-docs.ts` | Regenerate the token table, the limits and the package schema in the docs. |

### What the registry gives you

- **CSS.** `installThemeStyles()` writes one complete token block per theme (`[data-theme='<key>']`, the default theme also on `:root`) plus its keyframes, so nested previews work.
- **React.** `ThemeProvider` (previews and catalogue), `useTheme()`, `<Mascot pose motion>`, `<ThemeIllustration name motion>`, `<ThemeDecoration>`, `<ThemeBackdrop>`, `useThemeMotion()` and `useThemeSound()`. Components use these and never branch on a theme key (theme lint).
- **Everywhere that lists built-in themes iterates `THEME_LIST`** (`/dev/catalog`, the e2e axe loop with per-theme screenshots, the contrast and slot tests); the pickers (admin class editor, Class settings, Super Speakers) use `pickerThemes()`, which adds the enabled packages.

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
- [ ] `npm run docs:theming` (the token table shows every built-in theme's values; drift-tested).

## Add a language (notes)

Not scaffolded yet. English and Turkish are the supported pair, and much of the code assumes exactly
these two.

- `src/shared/i18n/<lang>.ts` must satisfy `Messages` (every key, type-checked). Extend the `Locale` type and `translate()` in `src/shared/i18n/index.ts`, including plural rules via `Intl.PluralRules` (`_one`/`_other` keys).
- `tests/client/lint-rules.test.ts` compares en and tr keys and placeholders. Extend it to the new dictionary.
- Teacher-editable labels are `{en, tr}` JSON (`pickText`). A new language needs a schema change for those labels and a migration. Record that as a decision first.
- Names are sorted with Turkish collation (`sortByName`). Check that this is still right for the new language's users.
- The profile language picker and the `language.*` keys list the locales.
