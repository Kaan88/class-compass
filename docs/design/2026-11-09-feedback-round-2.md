# Classroom feedback round 2 (2026-11-08/09): S14 brief

Feedback from the English teacher (Sare) and the owner after using the test server, with the owner decisions that followed. Stage briefs for S14a–S14i; record the decisions in DECISIONS.md (pre-assigned D-143 to D-161) as they are built, and tick the ROADMAP S14 boxes honestly.

## Context
Sare (English teacher) and the owner used test.sareteacher.com (commit 34c67be) and sent a second feedback round:
- **The classroom screen got worse after S13a.**
  - Routine and timer were squeezed into a 24rem right rail (D-103/D-139).
  - The stage strip scrolls sideways and never follows the current stage. The cause is the `@media (max-height:1100px)` nowrap rule in app.css, with no `scrollIntoView`.
- **Bugs:**
  - The evidence kind buttons overflow. The cause is `.cc-evidence-modes` auto-fill minmax(7rem) plus big padding and a bare text label.
  - Per-student counters are hidden, because D-102 made `showReminderBoxes` off by default.
  - No sound played on the test server.
- **Wishes:**
  - stats on any student name;
  - drag-and-drop between groups;
  - calmer reports with favourites/templates;
  - notifications;
  - assistant duty ticks on the start and reveal screens;
  - a lighter teacher menu;
  - a simpler student page with sentence starters;
  - the word "achievements" instead of "badges";
  - recognisable dinosaur and mythical avatars;
  - Super Speakers on its own domain;
  - a comprehensive MCP feature;
  - detailed AI and theming guidelines;
  - theme import and preview in the admin panel.

The goal is one stage group, **S14 "Classroom feedback round 2"**, built with the same per-stage workflow as S13: implement → two adversarial reviewers (requirements, security) → fix → commit and push.

## Owner decisions (2026-11-09, answered in this session)
- **Classroom:** a **wide row on top**, as before S13a: the routine with every stage visible next to a big timer, then the counter bar, the full-width student grid, and a bottom **dock** of big buttons for the other panels. On top of that, teachers can **drag and resize the boxes** themselves (PIN-gated, saved per teacher and class).
- **Student page:** **home tiles plus short steps**.
- **Teacher dashboard:** only **tidy the teacher menu**: a "Today" group plus one "Class setup" hub, and pages of switched-off modules are hidden. Nothing moves to the admin panel.
- **Student stats:**
  - In the teacher area, every name opens a full stats panel.
  - On the classroom screen, a name opens a small card with positive things only. There is **no full-stats button there**.
- **Super Speakers:** **configurable SPEAKERS_ORIGIN only**. No hostname or deployment now.
- **Notifications:** **in-app bell plus an optional daily email digest**, off by default.
- **MCP:** **full access, privacy-gated**.
  - Personal scoped tokens and OAuth for claude.ai, Claude Desktop and Claude Code.
  - Exactly the user's own app permissions; every call is audited.
  - A KVKK switch "student data to AI tools" is off by default. While it is off, the AI sees pseudonyms.
- **Avatars:** **redraw** the dinosaurs and mythical creatures so they are recognisable, and fix their Turkish names.
- **Claude's calls (accepted at plan review):**
  - Reports get saved views ("templates") with a star for the default, plus a section picker.
  - Sentence starters: built-in EN/TR, and teachers can add or hide their own.
  - "Badges" becomes "achievements". In Turkish "rozet" becomes "başarı / başarılar", matching the existing module name.

## Stages, order and parallelism
Waves run stages that touch different hot files. Parallel stages use `isolation: 'worktree'`, rebase on main before push, and generate their migration only after rebasing.

Pre-assigned numbers:
- migrations: 0017 e1, 0018 b, 0019 d, 0020 g, 0021 e3, 0022 h;
- decisions: D-143 to D-161.

i18n keys are added in per-stage namespaces. Only S14a edits existing strings in place (the rename), so it goes first.

| Wave | Stage | Items | Size / risk |
|---|---|---|---|
| W1 | **S14a** Quick fixes, sound, avatars | counters on, evidence buttons, achievements wording, sound, avatar redraw | M / low–med |
| W1 | **S14f** Super Speakers origin | SPEAKERS_ORIGIN | M / med (CSRF, host) |
| W1 | **S14e1** Report views | favourites/templates | M / low |
| W2 | **S14b** Classroom board + layout editor + assistant ticks | layout, stepper, dock, editor, duty ticks | XL / high |
| W2 | **S14d** Student page + sentence starters | home tiles, steps, starters | L / med |
| W2 | **S14g** Theme packages + AI guidelines | import/preview, AGENTS.md, THEMING | L / high (SVG/CSS) |
| W3 | **S14c** Groups drag-and-drop | both editors | M / med (touch) |
| W3 | **S14e2** Student name → stats | drawer + classroom card | M–L / med (privacy) |
| W4 | **S14e3** Notifications + teacher menu tidy | bell, digest, menu | L / med–high |
| W5 | **S14h** MCP | endpoint, tokens, OAuth, privacy | XL / highest |
| W6 | **S14i** Closing | guides, screenshots, full verification, real-device round | M |

### Hot files and their owners (one stage at a time; later stages rebase)

| File | Order |
|---|---|
| `server/lib/http.ts`, `server/app.ts`, `server/config.ts` | f → h |
| `server/modules/manifest.ts` (additive fields only) | e1 `meta` → b `startSteps` → e2 `classroomCard` → e3 `notificationSink` |
| `client/modules/types.ts`, `registry.ts` | b → e3 |
| `ui/Students.tsx` | b → e2 |
| `GroupsPanel.tsx` | b → c |
| `EvidenceAdder.tsx` | a → d |
| `ClassroomTopBar.tsx` | a → b |
| `routes/teacher/Teacher.tsx` | e3 → h |
| `reports/ReportsPage.tsx`, `ReportView.tsx` | e1 → e2 |
| `themes/soundManager.ts`, `themes/types.ts` | a → g |

---

## S14a: Quick fixes, sound, avatars

### Counters on by default (D-143, supersedes D-102)
- **Files:**
  - `server/modules/counters/manifest.ts:18` → `showReminderBoxes: true`;
  - `client/modules/counters/manifest.tsx:18` → `defaultValue={true}`;
  - `CounterPanel.tsx:242` gate becomes `=== false`;
  - hint `en.ts:1849` / `tr.ts:1847`;
  - `docs/guides/{en,tr}/teacher.md:119`.
- **No migration.** A `false` a teacher saved stays.
- **Tests:**
  - `tests/server/feedback-round-1.test.ts:337`;
  - `e2e/counters.spec.ts:12`;
  - re-measure "19 cards at 1440×900" with the boxes on.

### Evidence buttons (D-147)
- `EvidenceAdder.tsx:221` wraps the label in a span.
- `app.css:2842-2876`:
  - auto-**fit** minmax(min(100%,11rem),1fr);
  - `min-width:0`, `padding-inline:.8rem`, `white-space:normal`;
  - the label gets `overflow-wrap:break-word`;
  - move the 30rem media rule **after** the base rule (the icon-above tile pattern of `.cc-reflect__option`).
- New **`e2e/button-groups.spec.ts`**:
  - every button and label has `scrollWidth ≤ clientWidth+1`, and there are no empty grid tracks;
  - covers the evidence modes, topic choice, group options, confidence picker, reflect, segmented and menu grid (later the dock and student tiles);
  - at 375/768/1280 px, in EN and TR, at text scale 100% and 200%.

### "Badges" → "achievements" (D-144)
- About 75 values in each of `en.ts` and `tr.ts`.
- Resolve the title/tab clash: `tab.badges` becomes "All achievements".
- The tier word "Badge" becomes "Special".
- Guides in EN and TR. Internal ids, CSS, tokens and testids stay unchanged.
- Guard test in `tests/client/lint-rules.test.ts`: no `\bbadges?\b` in en values and no `rozet` in tr values.

### Sound (D-145)
**Owner result (2026-11-09):** on the test server only the time's-up sound played. Time's up uses `speechSynthesis` (the voice), not WebAudio. So every WebAudio cue was silent, which points at the AudioContext unlock and loudness, not CSP or faketime. Fix the unlock first; the remaining diagnostics are optional.

**Optional diagnostics** (only if the unlock fix does not solve it on the test server):
- On the MacBook with Safari and Chrome: does Class settings → "Try" play? What are `cc.deviceSounds`, the class `soundsEnabled` and the volume? What is the `AudioContext` state?
- On the test host: the container date and the libfaketime offset.

**`themes/soundManager.ts`:**
- **Unlock:** listen for pointerdown, pointerup, touchend, click and keydown.
  - Keep the listeners until `ctx.state==='running'`.
  - Play a 1-sample silent buffer on WebKit.
  - Re-arm on visibilitychange, pageshow and `onstatechange` (including Safari's "interrupted").
  - Never set "unlocked" after a failed `resume()`.
  - Set `navigator.audioSession.type='playback'`.
- **Loudness:** master → DynamicsCompressor → makeup gain (about ×3.5).
  - The per-note cap stays 0.3.
  - Use a perceptual volume curve.
  - Target a tap cue at volume 80 peaking between −12 and −6 dBFS (unit-tested).
- **Status store:** `sounds.status()` returns running, locked, unavailable, mutedClass, mutedDevice or volumeZero, with a `useSoundStatus()` hook.
- **New events:** lessonStart, lessonEnd, timerStart, groupMove (wired in S14c), achievementGiven and soundTest.
  - Add them to `SOUND_EVENTS`, `SOUND_PRIORITY`, `makeSoundPack`, i18n and the THEMING table.

**`ui/ClassroomTopBar.tsx`:**
- A visible chip "Sound is off · Turn sound on". Tapping it is the unlocking gesture.
- In the Display popover:
  - **Test sound**;
  - a "Sound check" block;
  - **Copy diagnostics**.

**Time's up:** re-query voices on `voiceschanged` (`timeUp.ts:57`).

**Tests:**
- `tests/client/sound-unlock.test.ts`, with a fake AudioContext whose `resume()` first rejects and then resolves;
- extend `themes.test.tsx`;
- `e2e/sound.spec.ts`: the chip shows before a gesture and disappears after one, and Test sound updates "Last sound".

### Avatar redraw (D-146)
**`avatars/AvatarArt.tsx`, `CreatureBody` (546-762) and `Creature` (764-778):**
- A `SPECIES_FACE` table: eye position, mouth style (person, beak, snout, muzzle or jaw), hat offset, horn over the hat.
- The stored spec does not change (D-124).
- Redraws:
  - **rex:** jaw and teeth, nostril, tiny arms, tail;
  - **stegosaur:** plates and legs;
  - **long-neck:** curved neck, body and legs inside the circle;
  - **unicorn:** muzzle, ears, mane, spiral horn drawn after the hat;
  - **dragon:** snout, horns, crest that does not look like the crown hat, wings, scales;
  - **phoenix:** beak, flame crest, wings, tail.
- Review the other families for odd human mouths.

**Turkish names** (`shared/avatars.ts:312,323`), confirmed by the owner 2026-11-09: Tiranozor, Stegozor, Uzun boyunlu dinozor, Tek boynuzlu at, Ejderha, Anka kuşu. These are the `tr` values only; the English names stay English.

**Tests:**
- keep the 120 ready-made, tokens-only and no-ids checks;
- add:
  - every species has a distinct, non-ellipse signature;
  - the unicorn horn comes after the hat for every hat;
  - beak species render no person mouth.
- Sare (and a few children) name each species from the catalog.

---

## S14b: Classroom board, layout editor, assistant ticks (D-148, D-149)

### Layout model
It is tiling on a 12×12 snap grid. Unlike free x/y placement this leaves no holes or overlaps, and it heals when modules are switched off.

**`src/shared/classroomLayout.ts`:**
- `{version:1, rows:[{h, boxes:[{key,w}]}] (Σh=12, Σw=12 per row, 1–6 rows, ≤4 boxes per row), dock: BoxKey[]}`.
- `BOX_CATALOGUE`:
  - `core.timer` (row, minW 3)
  - `core.students` (row, required, minW 6)
  - `core.dock` (required)
  - `routine` (stage slot, minW 5)
  - `focus` (top slot)
  - `counters` (row by default)
  - `assistant`, `secret`, `groups`, `homework`, `achievements` (dock by default, or a box)
- `layoutIssues()` validates the layout (8 KB cap).
- `effectiveLayout(stored|null, available)` heals: it drops unavailable boxes and spreads their width and height, and adds newly available ones.

**Edit operations** in `src/domain/classroomLayout.ts`: `moveBox`, `resizeW`, `resizeH`, `toDock`, `fromDock`. Pointer and keyboard use the same operations.

**Default layout:**

| Row | Height | Boxes |
|---|---|---|
| 1 | 3 | routine w8 · timer w4 |
| 2 | 1 | focus w4 · counters w8 |
| 3 | 7 | students w12 |
| 4 | 1 | dock |

Dock contents: Attendance, Assistant, Secret Students, Groups, Homework, Achievements, a spacer, End lesson.

**CSS:** a new section replaces `app.css:1596-1735`.
- `.cc-lesson-board` is a grid with `height:calc(100dvh - var(--cc-board-top))`.
- Rows are `minmax(min-content,Nfr)`. The students row is `minmax(0,Nfr)` and scrolls inside its box.
- Boxes use `container-type:inline-size`, so the timer digits are sized by `cqi`.
- Delete the nowrap stepper rule; the stepper wraps.
- Below 64rem the layout is a single column and the editor is disabled.

**Server:** core module `server/modules/classroomLayout/`; table `classroom_layouts(user_id, scope 'all'|contextId, layout_json, version, updated_at, PK(user_id,scope))`.

| Endpoint | Access | Notes |
|---|---|---|
| `GET /api/classroom/layout?contextId` | `classroom` | works while locked; ETag |
| `PUT /api/teacher/classroom-layout {contextId, applyTo:'class'\|'all', layout}` | `teacher` | PIN-gated |
| `DELETE /api/teacher/classroom-layout` | `teacher` | |

It is a personal preference, so it is not audited (record this in D-148).

**Client:**
- `modules/lessons/Dashboard.tsx` becomes `board/{Board,Box,Dock,DockView,LayoutEditor}.tsx` and `layoutClient.ts`.
- `DashboardSlot` gains `dock?:{Icon,label,useBadge?}`, `box?:{minW?}` and a `presentation` prop. Each panel file adds its dock spec; dock badges carry no sensitive counts.
- `DockView` is a full-screen `Modal`; the panel mounts only while it is open. Undo and feedback show inside the dialog. Audit the achievements and shuffle undo toasts.
- `RoutineClassroom.tsx`: scroll the current chip into view when the strip overflows a narrow custom box; short Previous/Next labels with the full text in `aria-label`.

**Editor:**
- "Customise layout" in the Display popover opens a `PinDialog`.
  - Extract `usePinUnlock()` from `routes/Lock.tsx:51-85` into `lib/pinUnlock.ts`.
- Edit mode: the board is inert under box frames with a move handle, a width splitter, a row-height splitter, "Put in dock / Show as box" and a 12-column guide.
- Toolbar: Save, Cancel, Undo, Reset (with confirm), "This class / All my classes".
- **Pointer:** pointer capture plus a rAF-throttled ghost.
- **Keyboard:** roving tabindex. Enter picks up a box, arrows move it, Shift+arrows resize, Escape cancels, with `aria-live` announcements. Per-box buttons give a single-pointer alternative (WCAG 2.5.7).
- Save, Cancel, idle and page hidden all call **`lockNow()`**.

### Assistant ticks in Start and End Lesson (D-149)
- **Start:** `lesson.start` gains `steps: record(unknown)` (`contracts/lessons.ts:167`). A new server `startSteps` registry runs in `lessons/service.ts` `startLesson` after attendance; on `LESSON_ALREADY_ACTIVE` it runs only the `onResume` steps.
- **Client:** `useStartContributions` (`client/modules/registry.ts:38`) must **deep-merge `steps`**; today it is a shallow spread.
- **Assistant start step** `{studentId, check[], uncheck[]}`:
  - It is applied only if that student is still today's assistant (attendance may have moved the turn). Otherwise the ticks are dropped and the lesson result reports `dutiesDropped`.
  - Extract `setDutyCheck` from `assistant/duties.ts`.
- **End Lesson:** `AssistantThanksStep` renders the extracted `DutyTicks` with the live `tickDuty`.

### Tests
- **Property tests** (fast-check, `tests/domain/classroom-layout.test.ts`).
- **Server** `classroom-layout.test.ts`: validation, scope precedence, apply to all, 423 while locked, isolation, invalid stored layout falls back to the default.
- **Manifests:** every slot key is in `BOX_CATALOGUE`.
- **Component:** `classroom-board.test.tsx`.
- **Rewrite `e2e/classroom-layout.spec.ts`:**
  - layout facts over `[data-box]`;
  - 13 module combinations × 3 themes;
  - 19 cards at 1440×900 and every width ≥1440 at Normal;
  - **all 6 routine chips**, End lesson, Attendance and timer Start fully in view at every viewport, including 1280×720;
  - editor flow by keyboard and mouse, persistence, "all classes", reset;
  - **423 after save**, which proves the relock;
  - axe on edit mode and on each dock view.
- **New `openDock()` helper** in `e2e/helpers.ts`. Update `usability-screens`, `secret-assistant`, `homework-check`, `grouping-homework`, `docs-screenshots`, `achievements-avatars` and `lessons`.
- **Assistant:** start ticks, resume, assistant changed, module off, replay idempotent, and the two-module start merge.

---

## S14c: Group drag-and-drop (D-150; supersedes the move parts of D-098, D-104, D-140)
**Shared `ui/StudentDnd.tsx`:**
- react-aria `GridList` and `useDragAndDrop`, one list per group plus "Not in a group".
- Drop indicator with "Drop here" text.
- Wrapped in `I18nProvider` with the class or teacher locale.
- Fallback without dragging: tap a chip, then tap that group's "Move here" button. Keyboard drag-and-drop also works.

**Teacher editor** (`routes/teacher/Grouping.tsx:114-215`): remove the sticky move bar (and the CSS at `app.css:2416`); reuse `move()`.

**Classroom group screen** (`GroupsPanel.tsx:68-251`):
- replace the native `draggable`;
- the `grouping.move` command gains an `UNPLACED` target (`contracts/grouping.ts:306`);
- play `groupMove` on a move.

**Tests:**
- component keyboard and tap paths;
- server unplace;
- e2e mouse `dragTo` in both editors, the tap path on mobile, axe.

---

## S14d: Student page and sentence starters

### Home tiles plus short steps (D-151, refines D-085)
**Navigation:**
- Screens live in the **query string**: `/s?screen=…&subject=…&goal=…&step=n`, with pushState and popstate.
- **Never use the hash**: `student/main.tsx:21` reads the token from it.
- Focus the `h1` on every screen change; Back goes back in history, or to home.

**Home screen:** avatar, "Hello", a subject switch (remembered per device), and tiles: My goals · New goal · How is it going? · Show my work · My achievements · My homework · My avatar. A tile shows only if its section exists.

**Screens** in `student/screens/`:
- **MyGoals:** in-page confirm through a new `ui/InlineConfirm.tsx`, replacing `window.confirm`.
- **NewGoal:** category tiles → ready goals or own words with starters → practice idea **chips**.
- **HowIsItGoing:** goal card → face 1–5 → starters or free words. All entry kinds stay reachable: self-assessment, "Something I learned" (reflection), "Note to myself" (note).
- **ShowMyWork:** `EvidenceAdder layout="steps"` (how → which goal, where "For all my learning" replaces "Not for one goal" → words). There is still one upload pipeline.
- **Achievements, Homework, Avatar.**

**Other changes:**
- `IconFace` gets level 5.
- Text hints show **only on save**.
- Simpler words in EN and TR.
- Keep D-084, D-117, D-119, D-123 and the hide/moderation rules.
- No new libraries in the student bundle; add a gzip size-budget check.

### Sentence starters (D-152)
**Table** `text_starters(id, kind, subject_id, category_id, text_json{en,tr}, sort_order, created_by, archived_at, …)`:
- Kinds: goal, reflection, note, selfAssessment, evidence, caption, practice.
- The blank is `___`.
- Built-ins (about 6 per kind and language, for 7–10-year-olds) are seeded by `ensureStarterDefaults()` in `goals/starters.ts`, following the `library.ts` pattern.

**Hiding and archiving:**
- Teachers hide defaults through `default_item_archives`. Add `'starter'` to **both** `DEFAULT_ITEM_KINDS` lists (`contracts/goals.ts:301`, `db/schema.ts`).
- Admins archive (D-116).

**Editing:** the Goals → Library tab gets a "Sentence starters" section; Admin → Modules → Goals defaults gets a list.

**Delivery:** `StudentGoalsSection.starters`, already in the page locale.

**Checks:**
- New text-check rule **`STARTER_UNFINISHED`** in `shared/text/textQuality.ts`: the blank is still there, or the text equals a starter. It is enforced on the server in `assertStudentText` and is not counted as a blocked attempt.
- A teacher starter is refused if it has risky words or fails the checks once a sample word fills the blank.

**Client:** `student/SentenceStarters.tsx`. Tapping a chip fills the box and selects the blank. If the box already has words, a "Replace your words?" prompt appears.

**Tests:**
- built-in corpus: filled starters pass, unchanged ones fail;
- `tests/server/starters.test.ts`;
- e2e flows at 375×812 in EN, TR and with two subjects;
- axe per screen;
- deep-link reload;
- the hash token is never confused with a screen.

---

## S14e1: Report views (D-153)
**Server:**
- `ReportContribution` gains `meta {title, tables[]}`, tested against the tables each section actually produces.
- `ReportInput.sections`: unrequested sections are **skipped** in `reports/service.ts:24`.
- New `GET /api/{teacher,admin}/reports/catalog`.

**Tables (migration 0017):**
- `report_views(id, user_id, viewer, name, spec_json, …)`: at most 30 per user, hard delete.
- Generic `user_settings(user_id, key, value_json, PK)` with a registry in `server/lib/userSettings.ts`. It holds the default view, and later the notification settings.

**Built-in views:** Everything, Attendance & homework, Goals & reflections, Classroom tools, Achievements & Super Speakers, Student overview.

**Client** (`ReportsPage.tsx`):
- view select with a ★ for the default;
- a Customise checkbox tree for sections and tables;
- save as, update, delete;
- sections inside `<details>`;
- print expands the selected sections;
- **deep link** with `contextId`, `studentId`, `view`, `period`, `from`, `to`. The admin "by class" tab reuses all of this.

**Tests:** the filter builds only the requested sections; CRUD isolation; e2e save, collapse, reload, default; axe.

---

## S14e2: Student name → stats (D-154)
**Teacher area:**
- New `ui/StudentName.tsx` opens a lazy `reports/StudentStatsDrawer.tsx`:
  - context and period pickers;
  - `contextReport` with `studentId` and a sections filter, drawn with a compact `SectionView`;
  - the last 20 timeline events;
  - **Open full report**, a deep link with the Student overview view.
  - Query keys are `['sensitive',…]`.
- `CellView` student cells become `StudentName`.
- Roll out to about 25 places. Where the name already does something (Goals, Achievements), add a separate stats icon button instead. Grouping chips stay drag handles.

**Classroom screen:**
- New server-manifest field `classroomCard`.
- `GET /api/classroom/contexts/:contextId/students/:studentId/card` (`classroom` access). It requires `assertOwnsContext` and enrolment today, otherwise 404.
- **Allowed sections only:**
  - recent achievements;
  - own Super Speakers week points (no rank);
  - assistant days this term;
  - counters, only when the boxes are on.
- **Never:** attendance, homework, goals or text, levels, Secret Student data, notes.
- The card name is a `Button` in a grid area separate from the + target. `StudentCardDialog.tsx` has **no stats link**.

**Tests:**
- `tests/server/classroom-card.test.ts`: works while locked; cross-teacher 404; marker-string leak scan; auto-included in `secret-leak`;
- name and + targets do not overlap;
- e2e drawer → full report with the student preselected;
- classroom card;
- axe.

---

## S14e3: Notifications and teacher menu (D-155, D-156)
**Tables (migration 0021):**
- `notifications(id, user_id, student_id, subject_id, context_id, category, entity, entity_id, count, local_date, created_at, updated_at, read_at)`, with indexes and a unique partial index for the daily aggregate categories;
- `notification_digests(user_id, local_date, sent_at, status, items)`.

**Categories** (`shared/notifications.ts`):

| Default | Categories |
|---|---|
| On | goal created / edited / achieved; reflection, note, self-assessment; evidence text / link / picture / document / voice; achievement earned |
| Off | avatar changed; blocked text (count only); link opened on a new device; Super Speakers points (aggregated) |

**Capture:** a separate emitter **`server/lib/notify.ts`**.
- It is not part of the activity hook, to avoid re-running achievement rules and recursion.
- Emit sites, inside the existing transactions:
  - `goals/student.ts`: create, update, entries, evidence (student actor only);
  - `avatars/service.ts:59`;
  - the link exchange;
  - `textChecks recordBlockedAttempts`;
  - achievement awarding (never the quiet backfill, never the awarding teacher);
  - `points.award`.
- The sink in `notifications/writer.ts` writes only for current teachers of that student and subject, with the module on and the category enabled. Rows hold **ids only**.

**Read:**

| Endpoint | Access / behaviour |
|---|---|
| `GET /api/teacher/notifications` | `teacher`. Re-checks access at read time; 120-character snippets; deleted or hidden items get no snippet; never notes, secrets or blocked words |
| `GET …/count` | ETag; polled every 60 s while visible |
| `POST …/read` | |
| `GET/PUT …/notification-settings` | categories; digest `{enabled:false, hour:16, includeNames:false}` |

**Digest** (`notifications/digest.ts`, ticked every 5 minutes from `main.ts`):
- once a day per teacher, after their hour;
- **counts only**, names only on opt-in, **never student text**;
- in the teacher's locale, plain text;
- the same tick purges rows older than 90 days (config).

**Client:**
- `modules/notifications/NotificationsPage.tsx`: filters, grouped by student with `StudentName`, mark read, a settings tab.
- `Bell.tsx` (new `IconBell`) in `TeacherNav` and `TeacherMenu`, inside `SensitiveGate`.

**Privacy:** erasure covers the new rows automatically (`student_id` column); the full export includes them; the per-student export excludes them, as for teacher-side notes.

**Teacher menu (D-156, refines D-140):**
- `TeacherPage` gains `module` and `group: 'today'|'setup'`.
- `menuTeacherPages(contexts)` hides a module's page when the module is off in all of the teacher's contexts.
- `TeacherMenu`: Open classroom; **Today** (Attendance, Homework, Goals, Reports, Notifications); one **Class setup** tile leading to a new `/teacher/setup` hub with tabs; a small row with Profile, Help, Leave and Sign out.
- All old `/teacher/<path>` URLs keep working. A page whose module is off shows an empty state.

**Tests:**
- `tests/server/notifications.test.ts`: every category through its real write path; recipient rules; settings; aggregation; access lost; hidden and deleted items; digest with `FakeMailer`; purge; erasure; 423;
- e2e: a student adds a goal → the bell shows 1 → deep link;
- menu grouping and hiding;
- axe.

---

## S14f: Super Speakers origin (D-157; refines D-128, D-134, D-135)
**Config:** `config.ts` gets an optional `SPEAKERS_ORIGIN` and `config.origins {main, speakers, speakersHost, split}`; the server refuses invalid combinations.

**CSRF** (`lib/http.ts:201`): the origin class is set by the **endpoint path** when the route is registered. `/api/scorer*` and `/api/board*` accept the speakers origin; everything else accepts only the main origin.

**Host routing** (`app.ts`, `onRequest`, only when split):
- The speakers host serves only `/p`, `/p/app`, `/p/*`, `/board`, `/assets/*`, `/scorer-sw.js`, `/api/scorer*`, `/api/board*` and `/healthz`. Anything else is 404.
- The main host answers `/p`, `/p/app` and `/board` with a **308** to the speakers host, keeping the path and query; the fragment survives.
- When split, the main host serves a **kill-switch `scorer-sw.js`**. Bump the cache to v2.

**Links:** `superSpeakers/service.ts:524` links and QR codes use the speakers origin.

**Docs:** OPERATIONS covers the second tunnel hostname, per-hostname Cloudflare settings and the **Access Bypass** a TV or phone needs. Update the guides. **No deployment.**

**Tests:** `tests/server/speakers-origin.test.ts`, using `app.inject` with a host header: config, the CSRF matrix, allow/deny/308, links, the service worker. `permissions.test.ts` stays green.

---

## S14g: Theme packages + AI guidelines (D-158, D-159)
**Shared validators** in `src/shared/themePackage/` (one source for the server, the preview, MCP and the existing tests):

| File | Contents |
|---|---|
| `schema.ts` | zod package schema → `docs/theme-package.schema.json`, with a drift test |
| `limits.ts` | sound, motion and opacity limits moved out of the tests |
| `contrast.ts` | moved from `client/themes/contrast.ts` |
| `motion.ts` | presets only; **no raw CSS** |
| `svg.ts` | strict tokenizer and sanitiser |
| `validate.ts` | validation report |

**SVG allow-list:**
- Elements: g, path, circle, ellipse, rect, line, polyline, polygon.
- Attributes: geometry, a strict `transform` grammar, fill and stroke only as `var(--cc-<token>)`, none or currentColor.
- **Not allowed:** ids, class, style, href, `on*`, filter, mask, `url()`, text, image, use, foreignObject, script, entities, CDATA.
- At most 400 nodes and 20 KB.
- The output is a JSON tree that the client renders with `createElement` in `themes/SvgTree.tsx`. **No `dangerouslySetInnerHTML`.**

**Package** (JSON, at most 512 KB):
- format and version, key slug, `{en,tr}` labels, a base built-in theme;
- complete colours, typography presets, shape, motion presets, sound params;
- optional art (mascot poses, illustrations, decoration, pattern). Missing art falls back to the base theme.

**Table** `custom_themes(key, package_json, report_json, status draft|enabled|disabled, …)`.
- Theme keys become open strings. `Theme` in `contracts/school.ts:23` becomes a slug, checked by `assertThemeUsable` (built-in or enabled), in classes and in the Super Speakers settings.
- Reads fall back to the default theme.
- Deleting a theme moves its classes to the default and is audited.

**Endpoints:**

| Endpoint | Access |
|---|---|
| `POST /api/admin/themes/validate` | `admin` |
| create, enable, disable, delete | `admin`, audited |
| `GET /api/themes/available` | `user` |
| `GET /api/themes/custom/:key` | `public`, enabled themes only |

**Admin "Themes" page** (lazy):
- catalogue;
- live previews: classroom mini-board, student home, board podium, mascot poses, celebration, every sound, contrast table;
- **Export** any theme;
- **Import** → validation report → preview → draft → Enable.
- CSP is unchanged.

**AI guidelines:**
- Root **`AGENTS.md`** (map, golden rules, commands, stage workflow, docs, no secrets or real data) plus `CLAUDE.md` that includes it.
- **`docs/THEMING.md`:**
  - a per-token table **generated** by `scripts/theme-docs.ts`, with a drift test;
  - palette design and contrast pairs;
  - the limits quoted from `limits.ts`;
  - the SVG allow-list;
  - a worked example theme `ocean`;
  - the package schema and a checklist;
  - the MCP theme tools.
- `EXTENDING.md` gains the new hooks.

**Tests:**
- sanitiser fuzz and property tests (fast-check);
- the validators;
- server lifecycle and permission matrix;
- generated CSS cannot inject;
- e2e: import a fixture with one bad contrast → fix → enable → class uses it → axe → delete falls back.

---

## S14h: MCP (D-160 MCP, D-161 AI data switch)
**Transport:**
- A **minimal compliant Streamable HTTP JSON-RPC server** at `/mcp` inside Fastify: initialize with version negotiation, ping, tools, resources and prompts; POST answered as JSON, GET answered 405, DELETE ends the session.
- `@modelcontextprotocol/sdk` is a **devDependency only**, used for conformance tests. MCP Inspector is a manual check.

**Access:**
- New access class `'mcp'`: bearer token only. Bearer tokens never work on `/api/*`, and cookies never work on `/mcp`.
- Endpoints opt in with `mcp:{scope, tool, description, readOnly}`. `route()` records handlers for generated tools.
- `Actor` gains `{type:'mcp', id, role, tokenId}`, with a helper `actorUserId()` used at `students/service.ts:232`, `links/service.ts:137`, `files/service.ts:188` and `lib/commands.ts:50`.
- Audit gets a `via_token_id` column.
- **Order of checks on every call:** school switch on → token valid → user active → role matches → scope granted → then the normal ownership checks.
- `user` and `account` endpoints are never exposed.
- **The classroom PIN cannot be bypassed:** tokens and OAuth consent are only created through `account` endpoints (PIN-gated) with re-authentication.

**Scopes:**
- classes:read, reports:read, goals:read, goals:write, homework:write, classroom:command, settings:write;
- admin only: settings:admin, themes:write, school:read.
- **Never exposed:** exports, erasure, backups, credentials, link tokens.

**Tokens:**
- `mcp_tokens` (HMAC-hashed with the pepper, prefix `ccmcp_`, shown once, 30-day default, admin cap ≤90 days).
- Profile gets an "AI tools" section to create, list and revoke tokens.

**OAuth 2.1** (for claude.ai, Claude Desktop and Claude Code):
- Discovery (RFC 9728 and RFC 8414), plus `401 WWW-Authenticate` with resource metadata.
- Dynamic client registration (RFC 7591): https on the admin's allowed hosts, or loopback; rate-limited; expires.
- Authorize: exact redirect match, PKCE S256 required, `resource=/mcp` (RFC 8707).
- **Consent page** in the SPA: "not verified by your school" banner, the redirect host shown, plain-language scopes that can be narrowed, privacy mode, expiry, re-authentication.
- Codes are single-use and last 60 seconds.
- Access tokens last 1 hour; refresh tokens rotate and are revoked as a family if reused. Revocation endpoint (RFC 7009).
- Tables: `oauth_clients`, `oauth_requests`, `oauth_codes`.

**Privacy gate:**
- `school_settings.mcp_enabled` and `ai_student_data_allowed` both default to **false**. They are set on Admin → AI tools; turning on student data needs a typed confirmation and the categories are listed.
- Contract fields get `.meta({cc:{pii:…}})` annotations. A classification test walks every exposed schema.
- `mcp/privacy.ts` handles the output:
  - **pseudonymous mode:** "Student N", stable per token family (`mcp_pseudonyms`); student text withheld; names inside teacher text replaced; `student-N` aliases accepted as input;
  - **both modes:** files, photos and audio never leave, and neither do notes, pre-reveal Secret Student data, levels or link tokens;
  - **named mode:** student text is wrapped as `untrustedText`.
- `mcp_calls` logs each call **without arguments**; writes are also audited.
- Rate limits: 120 per minute per token, plus per-tool costs.
- Results are capped at 256 KB.
- The `Origin` header is checked.

**Tools, resources and prompts:**
- About 30 generated tools: contexts, roster, report with sections, timeline, goals, presets and starters, homework, topics, lessons, settings, usage.
- Hand-written tools: `class_overview`, `student_summary`, `create_goal_preset`, `create_sentence_starter`, `theme_schema`, `validate_theme`, `import_theme_draft` (enabling stays a human action), `export_theme`.
- Resources: guides, theming doc, theme schema, my classes.
- Prompts: weekly summary, goal presets, topic plan, design a theme.

**Docs:**
- `docs/guides/{en,tr}/ai-tools.md`: what leaves the school in each mode; Claude Code `claude mcp add --transport http …`; claude.ai/Desktop custom connector (verify the current callback hosts at build time).
- OPERATIONS: a Cloudflare Access **Bypass** for `/mcp`, `/oauth/*` and `/.well-known/oauth-*`.
- KVKK: the school's KVKK contact signs off before the student-data switch is turned on.
- Parent privacy text is updated.

**Tests:**
- `mcp-protocol`, `mcp-auth`, `oauth` (PKCE, redirect, resource, rotation, reuse, 423 in classroom mode, no open redirect), `mcp-privacy` (marker names and texts never leak in pseudonymous mode; no files, notes, secrets or levels in either mode), `mcp-conformance` (SDK client including OAuth);
- `permissions.test.ts` covers `mcp`;
- e2e PAT and consent flows;
- axe.

---

## S14i: Closing
- Guides EN and TR: classroom board and Customise layout, student home, starters, notifications, report views, achievements wording, AI tools, theme import.
- `npm run docs:screenshots`; a usability screenshot crawl with human before/after review.
- ROADMAP S14 section with honest boxes.
- Open boxes for every real-device check (below).
- Update memory (a new feedback-round-2 entry).
- **Then ask the owner** before redeploying test.sareteacher.com: rebuild the faketime image from the new tag, keep the override, migrations run on start.

## How it is executed
1. This brief, the ROADMAP S14 skeleton and a memory note (done 2026-11-09).
2. Run the existing `class-compass-stages` workflow pattern (implement → requirements and security reviewers → fix → commit and push) per stage.
   - Waves W1 to W6 as above. Stages in the same wave run in parallel worktrees and rebase before push.
   - The security reviewer for S14f, S14g and S14h gets the explicit hot-spot list: CSRF and host, SVG and CSS injection, OAuth, tokens, pseudonymisation, PIN relock.
3. After each wave: `npm run check`, `npm run build` and the full `npx playwright test` on main. CI stays off until 1 December.

## Verification
- **Automated, per stage and at the end:**
  - `npm run check` (typecheck, lint, vitest);
  - `npm run build`;
  - `npx playwright test` (both projects);
  - `npm run usability:screens` (human diff review);
  - the student bundle size budget;
  - the MCP SDK-client conformance test plus a manual MCP Inspector run against a dev server.
- **Human checks on real devices** (open ROADMAP boxes until done):

| Area | What to check |
|---|---|
| Classroom (Sare's MacBook, Safari and Chrome) | default board, all stages visible, dock views, Customise layout with trackpad and keyboard, PIN relock, a 1280×720 projector, a touch panel |
| Sound | first-tap unlock, the "Turn sound on" chip, Test sound, loudness on classroom speakers, time's-up voice, iPad silent switch |
| Groups | mouse, touch panel, iPad and Android drag, keyboard, VoiceOver |
| Student page | low-end Android and iPhone: tiles, steps, back button, reload, starters, camera and voice |
| Avatars | Sare and children name each redrawn species |
| Notifications | the digest arrives in a real mailbox in EN and TR |
| MCP | Claude Code with a token; claude.ai/Desktop connector over OAuth against the test server (Access bypass); **fictional data only until the owner and KVKK contact approve** |
| Themes | import the worked example and preview it on the classroom display |
| Super Speakers second host | only when the owner creates a hostname |
