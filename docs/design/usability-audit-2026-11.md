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

## Fixed after the November screenshot crawl (admin area, D-138)

| Screen | Issue | Severity | Fix |
| --- | --- | --- | --- |
| Admin tables (classes, accounts, students, assignments, audit) on phones and tablets | Status and action columns off-screen with no scroll hint; rows 150–200px tall | critical | One card per row below 52rem, actions in a wrapping row |
| Profile / Maintenance | Administrators could not set the PIN that Back up now and Verify ask for | major | PIN form for every account; the Maintenance dialog links to Profile when no PIN is set |
| Maintenance, Backups | Internal migration tag widened the page on phones | major | "Up to date" / waiting count; the tag under "Technical details", wrapping |
| Audit log | Raw codes in both languages; free-text filters needing the codes | major | Actions and record types in words (EN, TR); filter lists |
| Permanent delete and other confirmations on a phone | Type-to-confirm field and buttons below the fold of the dialog | major | Sticky dialog footer |
| Admin navigation on a phone | 15 pills before any content; "Sign out" on its own row | major | One Section select below 52rem, none on the admin home; compact top bar |
| Modules and media | One very long page; Archive buttons misaligned; same-name badges | major | Tabs; one right-aligned action column; tier after the badge name |
| Reports charts | Overlapping week labels, identical stubs, 5px text on phones | major | Real-width SVG, short dates, class · subject, thinned/turned labels with ellipsis |
| Super Speakers links (TR) | "Kapat" (same word as Close) revoked a link | major | "Bağlantıyı iptal et" / "İptal edildi" |
| Students, link dialog | Deactivated student's link still showed a QR code and address | minor | Hidden; "Reactivate the student" offered |
| Maintenance, New school year | Placeholders looked like values; no reason for disabled buttons; typed dates | minor | Prefilled suggestion, date pickers, a reason line |
| Reports, Super Speakers | Wider page than the other admin pages; "Status" heading over buttons | minor | Normal page width; separate Status and action columns |
| Accounts | "Active" and "Invite pending" together; unexplained "Password" pill; solid red Deactivate on every row | minor | One status; "Sign-in: password"; outline danger style, TR "Devre dışı bırak" |
| School years | Reversible Archive solid red, irreversible Delete neutral; ISO dates split on phones | minor | Styles swapped; dates in words, unbroken |
| School settings | Free-text timezone; plain weather heading; e-mail status pill above Save | minor | Timezone list; bold legend; its own "Password reset by email" row |
| Super Speakers settings | Badge subject option in English quotes; "… within (minutes)" label; other week-start wording | minor | "Automatic: the English subject"; one limit row with a sentence; the school-settings label |
| New class dialog | Theme names twice, uneven theme grid, big preview pushing the buttons away, no grade hint | minor | Name once, equal tiles, the large preview folded, grade hint |

## Fixed after the November screenshot crawl (classroom area, D-139)

| Screen | Issue | Severity | Fix |
| --- | --- | --- | --- |
| Classroom dashboard (1920×1080, 1366×768, 1280×720, 4K) | Rail cut off: timer presets, Attendance, End lesson, counter and panels out of sight while the main column was half empty | major | Panels in a grid under the student cards (counter full width); rail ends at the screen bottom with Attendance + End lesson pinned; stages one sideways row on short displays; Playwright check at 1920×1080 and 1280×720 |
| Give a badge | Ticked recipients struck through ("removed") | major | Strikethrough only for done assistant duties; recipients get the accent background |
| Toasts | "Lesson started" covered dialog buttons (timer keypad), cards and End lesson | major | Classroom notes at the bottom left, 2.5 s; hidden while a classroom dialog is open (errors and Undo stay); room under the page |
| Badge Undo | Undo only in the clipped Badges panel | major | Undo note after the celebration (or at once when given quietly); panel list kept |
| Celebration overlay | Mascot over the badge, avatar and name; no name in the banner | major | Mascot and message in the bottom-left corner; "Well done, {names}! New badge: …" for up to three students |
| Attendance tiles, group screen, homework rows | Small avatar art shrunk to a dot by `.cc-btn svg` | major | Avatar art always fills its circle |
| End Lesson | Save 650px below the fold; outcomes as prominent as the celebration | major | Back / Save pinned at the bottom; result and note smaller under "For your records" (split into a teacher-only step left to the owner) |
| Top bar (Turkish, 1280 wide) | Two or three rows of controls (~165px) | major | Size, class language and sounds in a Display popover; one row |
| Secret Students panel | Count and Choose again squeezed and wrapping | minor | Text takes the row, the button goes under it, never wraps |
| Groups panel | Bare count ("Group 1 4"), half-drawn border | minor | "4 students", full coloured border |
| Group screen | Group titles wrapping; picked student only outlined; no scroll cue | minor | Names never break, count wraps under; picked student filled, Cancel by the hint; scroll shadow on wide and full dialogs |
| Homework check | ISO date; label line doubling every row; Close only at the end | minor | Date in words; label for screen readers only; Close beside the title; short "Check" button |
| Turkish wording | "Sıkı", "19 Var", "Seçeneğe kaydet" | minor | "Küçük", "Bugün: 19 Var", "Gelecek sefer için kaydet" |
| Panel headers | Lone icon line, actions on a row of their own, mixed button sizes | minor | One `PanelHead` for the classroom panels; Give a badge as large as the others |
| Student cards | Name below the avatar's centre; names broken mid-word in Compact | minor | Name centred, broken only between words; Compact cards a little wider |

Not changed: the modal backdrop already covers the whole screen (the crawl's full-page shots were taken
with the page scrolled, so the top bar looked undimmed), and the empty "Today's focus" stays a small
"Choose a topic" action as the owner asked (feedback round 1, item 7). Still open: badges and group
numbers on the student cards, Compact using free height, and the End Lesson split (ROADMAP).

## Fixed after the November screenshot crawl (teacher area, D-140)

| Screen | Issue | Severity | Fix |
| --- | --- | --- | --- |
| Student links (plain-HTTP LAN) | Copy failed and told the teacher to select an address that is not on the page | critical | `copyText` with an `execCommand` fallback; otherwise the link opens selected in a read-only field |
| Students (phone) | Actions column cut off, names on three lines | major | Stacked cards (name as heading, "Joined" left out); outline danger button |
| Attendance (phone) | ~590px per student, columns off-screen | major | Stacked cards; four statuses in one row, Clear and Note under them; "Recorded by" only on wide screens |
| Grouping editor | One long form; thousands of pixels between "pick" and "Move here"; names looked like empty fields | major | Groups side by side, name chips, sticky "Move … to:" bar, names and roles in a disclosure |
| Reports charts | "5 üzerinden" cut labels; empty all-zero charts in print | major | Steps 1–5 on the axis (short dates were already fixed in D-138); no chart when all values are 0; print height capped |
| Achievements, Badges | Cramped cards, one word per line, ~60 ungrouped badges, tier only in grey text | major | Wider cards with the button on its own line, folded groups per category, tier chip, art never shrinks |
| Teacher navigation (phone) | 20 link chips filled the first screen; repeated on the menu page | major | One **Page** select below 52rem; no link row on the menu page |
| Counter history | Week headers with ", Europe/Istanbul" overflowing at 1920px; two names for one counter | major | "Mon 2 Nov – Sun 8 Nov", timezone once in the caption, the counter's own name |
| Achievements student dialog (phone) | Close only after the whole badge list; icons of different sizes | major | Close beside the title; art never shrinks |
| Make your own badge | Picture list showed English keys ("star") | minor | Picture names in EN and TR |
| Homework check | Counts twice; "2 selected" misaligned; "Not recorded" chip read as "not handed in" | minor | Counts once with the selection count on the same line; "Attendance: …" chip, hidden when attendance was not taken |
| Assistant settings | Duty fields 235px wide, text cut off | minor | Fields take the row width |
| Teacher dates | ISO dates and "Europe/Istanbul" in Turkish screens | minor | Dates in words; timezone removed from the homework week line |
| Goals, New goal | Two fields called "Goal"; child's voice option | minor | "Ready-made goal" / "Goal text" / "Write my own (below)" (TR "Hazır hedef" / "Hedef metni" / "Kendim yazacağım (aşağıya)") |
| Students | 19 solid red buttons | minor | `danger-outline`; solid red only in the confirmation (no edit menu: teachers cannot edit students, the administrator does) |
| Teacher menu | Same icon on unrelated tiles | minor | One icon per tile (test-checked) |

## Fixed after the November screenshot crawl (auth and help, D-142)

| Screen | Issue | Severity | Fix |
| --- | --- | --- | --- |
| Help, every guide | Numbered steps and bullets showed no numbers or bullets (Tailwind preflight) | major | List markers restored inside `.cc-guide` (Help page and Help panel) |
| Expired sign-in, reset and invite links | Dead end: only a red alert | major | **Email me a new sign-in link** / **Ask for a new reset link** and **Back to sign-in** |
| Sign-in pages (TR) | English only, no language switch | major | **English \| Türkçe** on the card, per device; default: Turkish browser, then the school's language for new accounts |
| Change password, reset, email link | Main action a small left-aligned button | minor | Big full-width main button like Sign in |
| Invite | Username hidden mid-sentence | minor | "Your username" label and a monospace box |
| Help (phone) | Guide list filled the first screen | minor | Folded into one "Guides: …" line below 52rem |
| Help, language switch | Guide list and top bar stayed in the other language | minor | The whole Help page follows the guide language |
| Help, pictures (phone) | Shrunk desktop screenshots unreadable, not tappable | minor | Each picture opens full size in a new tab (phone-width captures not made) |
| Component catalog | Theme decoration widened the page | minor | `overflow: clip` on catalog panels |
| Invite, second link in the same tab | Fragment read once: a stale invite stayed on screen (and the crawl never captured the invalid state) | minor | Token re-read on `hashchange`; the crawl leaves `/invite` first |
| Email link sent | No address shown, no way to fix a typo | minor | The typed address in a shorter message, **Use a different email** |
