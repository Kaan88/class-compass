# Usability audit, November 2026 (S13a)

Audit of the screens teachers and administrators use, made during S13a after the first feedback round
(Sare and Kaan, 2026-11-07; brief: `docs/design/2026-11-07-feedback-round-1.md`). Done by Claude on the
demo school with Playwright at 1920×1080 (classroom display) and 1440×900 (laptop), plus the device
matrix of D-103. It was not done with teachers in a classroom; their next round of hands-on feedback
is still the real test.

Screenshots are produced by the Playwright suite and are not committed (they show only fictional demo
data but change on every run). Run `npx playwright test e2e/classroom-layout.spec.ts` and look in:

- `test-results/layout/<modules>-<theme>.png`: classroom dashboard for all modules on, all off,
  counters only, grouping + homework + assistant, and each module off on its own (`without-<module>`),
  in the explorer, animals and classroom themes.
- `test-results/fit/<display>-normal.png`, `1440x900-large.png`, `1440x900-compact.png`: the dashboard
  at 1440×900, 1470×956, 1366×768, 1280×800, 1920×1080, 2560×1440 and a 4K panel at 150% and 200%.

Severity: **critical** = a routine task fails or cannot be finished; **major** = the task is slow,
confusing or needs more than two taps, or something is cut off / colour-only / hover-only;
**minor** = polish.

## Fixed in S13a

| Screen | Issue | Severity | Fix |
| --- | --- | --- | --- |
| Classroom, homework checking dialog | Bulk controls scroll out of view; a student near the bottom can only be selected through a small box, so "Apply to selected" seemed broken | critical | Sticky bulk bar with "N selected", the whole name area selects, wide dialog (D-104) |
| Classroom, groups | Students could not be moved between groups; the panel expanded inline and pushed the dashboard around | critical | Full-screen group screen with tap-to-move and drag-and-drop, chips in the rail (D-098) |
| Classroom dashboard with modules off | Empty grid cells and misaligned columns when modules were switched off | major | Main column + rail layout; empty slots render nothing; Playwright matrix (D-103) |
| Classroom dashboard on a laptop | The 19 student cards needed scrolling at 1440×900; panels pushed the grid down | major | Viewport-based sizing and the rail; all 19 cards on screen at Normal from 1440×900 up (D-103) |
| Classroom, any size | No way to make things bigger or smaller for the room | major | Compact / Normal / Large in the top bar, kept per device and teacher |
| Classroom, timer | Only five preset lengths | major | "Set time" keypad (mm:ss, up to 99:59) |
| Classroom, assistant | Panel always took space; duties could not be ticked | major | Hide/show per lesson with a class default; tick boxes recorded per day (D-100) |
| Classroom, student cards | Turkish-reminder boxes on every card, also in classes that do not use them | major | Off by default, a class+subject switch (D-102) |
| Classroom, language | Turkish text on the display of English-only classes | major | Class language mode; the switch only with two languages (D-099) |
| Classroom, group member buttons | Accessible name did not contain the visible name (axe `label-content-name-mismatch`) | major | Visible name is the button text, with a visually hidden "Move" prefix |
| Classroom, language switch | Buttons showed "EN"/"TR" but were named "English"/"Turkish" (name mismatch) | minor | Buttons show the language names |
| Classroom, group screen | Shuffle's Undo was in a toast behind the full-screen dialog (unreachable) | critical | Undo and the status message are inside the group screen |
| Teacher, Grouping | Moving a student needed a select per student | major | Tap a name, then "Move here" (select kept as keyboard fallback); levels shown in the editor |
| Teacher, Goals (student view) | Long lists of goals and evidence without a filter | minor | Filter by topic |
| Admin, new account | The interface language of the new teacher could not be chosen | major | Required "Interface language" in the create dialog, editable later |
| Admin, Maintenance | Showed "never" for the last backup and verification after a restore | major | Restore re-records the restored backup's run (D-104) |

## Checked, no critical or major issue found

- Teacher Goals, Student links (with the printable cards and print media), teacher Reports, admin
  Reports, Maintenance and the New school year tab: no serious or critical axe violation
  (`e2e/pages-a11y.spec.ts`).
- Start Lesson: attendance → assistant → today's topic → routine; each step is one tap to accept.
- PIN lock, preferences, counters, secret students, student page: covered by their existing e2e
  tests, which pass after the S13a changes.

## Remaining minor issues (not fixed in S13a)

- Classroom top bar at 1440×900 wraps to two rows (class/date on the first, size and sound controls
  on the second); it fits but uses about 4rem of height.
- The rail scrolls on its own when many modules are on; on a 1366×768 display the module panels
  below the timer need a scroll inside the rail. Nothing is cut off, but it is not visible at once.
- At 1366×768 the 19 cards fit at Normal in the November screenshots, but the test asserts the
  "all cards on screen" rule only from 1440×900 up (the owner's target); smaller displays are checked
  for no horizontal scroll and no overlap only.
- The size control exists on the classroom screen only; the teacher area still follows the text-scale
  preference alone.
- The screenshot matrix covers the classroom dashboard. The group screen, Start/End Lesson, teacher
  menu and admin home are exercised by e2e tests at 1920×1080 but have no multi-size screenshot set.
- Label editors other than lesson topics and assistant responsibilities (routine stages, counter
  labels, homework statuses, goal presets, group names) still show both language fields regardless
  of the class language.
- The "Toast" area is inert while any full-screen dialog is open; other dialogs that raise toasts
  (homework checking in the classroom) still rely on toasts for confirmation. The status in the
  checking grid itself shows the result, so this is minor.
- Counter "+ Class" button: its accessible name ("Class: Our English Time ...") is longer than the
  visible "Class"; it contains it, so axe passes, but a shorter name would be clearer.
