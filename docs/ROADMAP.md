# Roadmap & Checklist

Keep this file current — it is how work resumes across sessions. `[x]` done · `[~]` in progress · `[ ]` not started.
Each stage ends with: tests green, docs updated, commit(s) pushed, demo with fictional data.

## S-1 Project startup
- [x] Name chosen (Class Compass) — D-001
- [x] Folder inspected (empty, no prior work), git initialised
- [x] Private repo `Kaan88/class-compass` created and verified private — D-002
- [x] REQUIREMENTS.md, DECISIONS.md
- [x] Stack options evaluated (3 independent proposals + judged synthesis) → ARCHITECTURE.md
- [x] ROADMAP.md, OPERATIONS.md (skeleton)
- [x] Owner decisions recorded (D-005, D-012…D-018)

## S0 Spike & foundations
- [x] Verify native deps on Windows (better-sqlite3, sharp, argon2) — Node 26 chosen (D-019)
- [ ] Verify native deps inside Docker on the VPS; tesseract.js `tur` + SheetJS (S9)
- [x] Repo skeleton, boundaries lint, Vitest, GitHub Actions (Ubuntu + Windows), CONVENTIONS.md
- [x] Playwright setup; i18n/a11y/raw-colour lint rules — done in S3 (`tests/client/lint-rules.test.ts`, axe in e2e)
- [x] Baseline migration, `/healthz`, redacted logging, CSP/security headers, robots/noindex
- [x] Synthetic Turkish/English name generator (fictional students only) — `demoNames` in `src/server/seed/demo.ts` (S2)

## S1 Contracts, auth, audit
- [x] Endpoint registry with mandatory access class; typed client
- [x] Users, sessions, argon2id, CSRF/Origin, login lockout, `admin:create` + `admin:reset-password` CLI
- [x] Email password reset when SMTP configured (D-015) — done in S2
- [x] Audit helper, command log, `/api/commands` idempotency
- [x] Tests: session expiry, lockout, CSRF, per-teacher locale, PIN lock/unlock/lockout, command replay/conflict (22 tests)
- [x] Test enumerating every endpoint against the permission matrix — done in S2 (`tests/server/permissions.test.ts`)

## S2 School structure, admin, students (backend)
- [x] Years, terms (archive = read-only guard), subjects, classes (theme, timezone, sounds/animations), teaching contexts, module policies + per-context module settings (`isModuleEnabled`, `getMediaPolicy`; media photos/audio OFF by default) — D-014, D-026
- [x] Policy helpers for later stages: `assertTeachesClass`, `assertOwnsContext`, `assertYearWritable`, `assertClassWritable`
- [x] Accounts admin: create (temporary password once), edit, deactivate/reactivate, password reset, clear PIN; school settings; audit-log query (filters, paging, secrets stripped)
- [x] Students + enrolments: teacher/admin manual entry, edit (audited), duplicate warnings (never merged), Turkish normalisation/sorting, classroom-safe roster vs teacher roster, subject levels (teacher-only), deactivate/reactivate, move and whole-class promotion with history — D-021, D-022
- [x] Email password reset when SMTP configured (nodemailer, injectable mailer) — D-015
- [x] `seed:demo` fictional school (3-A 19, 3-B 20, 4-C 34, 2-D 3; random passwords printed once) — D-024
- [x] Tests: permission matrix over all endpoints, unassigned-class/other-context denial, archived year read-only, promotion history, deactivated teacher + audit retained, media defaults, module disable keeps data, locale isolation, email reset, seed
- [x] Review fixes (D-027…D-030): date-aware rosters (future-dated moves/promotions keep the current class until the date), move dates validated against the target year and old enrolments capped at the old year's end, no moves out of archived classes, year overlap / term / enrolment range checks on year edits, duplicate warning on rename and for deactivated students, reset links voided on email/password/state changes, SMTP STARTTLS required, atomic demo seed, missing `error.*` i18n keys (75 tests total)
- [x] Admin UI and teacher roster/module screens — done in S3
- [ ] Paste entry of student lists — moved to S9 (it is the importer's paste input, IMP-1)

## S3 UI kit & themes
- [x] Tokens (primitive → semantic → theme) + 3 themes (explorer, animals, classroom) with mascots; UI kit in `src/client/ui`: buttons, fields, native select, switches, dialogs, ConfirmDestructive, tabs, toasts + undo toast, SaveStateBadge, NeedsAttentionTray, StudentCard/Grid (compact > 24), CounterBar, MetricCell (not recorded ≠ 0), ClassBanner, DisplayBanner, ClassSwitcher, DataTable, PinPad, ThemePicker/preview — D-036
- [x] Text scale (80–200 %, per teacher), reduced motion + per-class animation switch, per-class sounds + per-device sound switch; `/dev/catalog` — D-034
- [x] App shell: TanStack Router routes and guards, sign-in, forgot/reset password, forced password change, teacher menu, profile (language, text size, PIN, password), class settings (modules, theme preview), teacher roster with duplicate confirmation
- [x] Admin screens on the S2 APIs (users with one-time temporary password, settings, years/terms, subjects, classes with theme preview + promotion, assignments, module/media policies, students incl. search/move/history, audit log)
- [x] Offline outbox client (Dexie/IndexedDB, ordered, single-flight, backoff, needs-attention retry/dismiss) with unit tests — D-035 (used by lesson commands from S5)
- [x] Lint tests: no raw colours, en/tr key + placeholder parity, no untranslated JSX text
- [~] Tests: axe per theme (incl. contrast), 20- and 34-student grids on 1920×1080, 200 % text, admin/PIN/preferences flows on desktop + mobile (11 e2e) — a pixel-diff screenshot baseline and a 40-student grid are not done yet (D-037)
- [x] Review fixes (D-039…D-041): outbox partitioned per account (`asUser` checked server-side, no Retry for opId conflicts, translated tray reasons), server-side enforcement of temporary passwords, relative PIN lockout countdown + sign-out warning, menu-first in every tab, toasts cleared on lock and undo toasts never evicted, visible current-class marker in the class switcher, add-student dialog reset on Cancel (tests: outbox user switch / WRONG_ACCOUNT / conflict, toast store, PIN lockout details, temporary-password matrix, two-tab e2e, no toast after lock)
- [ ] Verify the e2e CI job on Ubuntu stays reliable over several runs

## S4 Classroom mode & PIN
- [~] Lock screen, teacher menu (menu first after unlock), display banner, client idle relock, lockout countdown, server 423 enforcement — client side done in S3 (D-031, D-032); classroom-mode entry from a started lesson comes with S5
- [~] Tests: direct URL / back / refresh / raw API bypass and 423 swap covered in `e2e/pin-lock.spec.ts`; bfcache restore and inactivity relock not yet covered by e2e

## S5 Lessons, outbox, attendance, routines
- [x] Start / resume / end lesson as outbox commands (lesson id = start opId, one active lesson per class+subject, resumed after refresh/reopen/class switch, never a second one); class switcher with "lesson in progress" mark and per-class screen state; commands naming another lesson/class refused with `WRONG_LESSON`; ETag/304 polling paused while commands are pending — D-042…D-046
- [x] Daily attendance shared by the teachers of a class (audited with actor) + lesson-only exceptions; start-screen attendance (everyone present by default, one tap per change), in-lesson attendance dialog with undo, teacher attendance page (any day of the school year, history, change log) — D-049, D-050
- [x] Routine templates (built-in default RTN-1, own templates with add/remove/reorder/rename stages, per-class default), snapshot at lesson start, stepper with current stage; server-timed classroom timer with one soft tone — D-047, D-048
- [x] End Lesson: step registry (core reflection step; module steps plug in later), works with every optional module off; lesson summary — D-051
- [x] Dashboard: live local date/day in the class timezone, collapsible student grid with attendance chips, module slot registry (only enabled modules that contribute a slot are shown) — D-052
- [~] Dashboard slots for groups/homework (DSH-8) are not built yet (S8). The counter slot (DSH-5) is registered by S6; the assistant (DSH-3), Secret Students (DSH-6) slots and the assistant start step by S7
- [~] ATT-1 "shown alongside homework": attendance is stored separately; the homework view and the cross-test (`it.todo`) come with S8
- [x] Tests: new vs resumed, start replay, switching with queued ops (WRONG_LESSON / LESSON_ENDED), ETag 304, shared attendance + audit actor, exception precedence, template edits vs snapshot, end with all modules off, Istanbul midnight boundary, overnight auto-abandon; e2e: 19-student start on 1920×1080 touch, refresh resume, class switch and back, offline attendance tap synced once (`e2e/lessons.spec.ts`)
- [x] Review fixes (D-053…D-056): start-screen attendance applied on the resume path and guarded against overwriting a colleague's newer record (`expected` + `othersPresent`, warning toast for kept entries); Start/End Lesson drafts kept per class and keyed by class/lesson; finished timer restarts on Start (server + device) and its tone never replays after reload/remount; teacher attendance page shows times in the class timezone; classroom summary limited to held contexts with older reflection notes withheld; teacher-area exception edits need the context still assigned (tests: second start with attendance, stale start screen vs colleague, finished-timer restart, ended assignment, summary note next day; e2e: End Lesson drafts per class)
- [ ] D-006 offline cold start: starting a lesson while offline waits in the outbox until the connection returns (no service worker yet)

## S6 Counters
- [x] English reminder preset, created automatically for English classes ("Our English Time", "3 / 10 Turkish reminders", levels 2/4/6, four responses with "Back to English" as the default) — D-060
- [x] Custom counters: labels in both languages, class bar / each student / both, limit, reset period (week / term→school year / never), colour, up to 3 levels, up to 8 responses; archive and use again; PIN-gated settings page with a live preview — CNT-6, CRD-3
- [x] Taps as outbox commands (event id = opId) with optimistic update, an undo toast naming the class and the student, offline queue synced once, a 700 ms double-tap guard, absent students refused — D-057, CNT-3/4/5, UX-9/10/11
- [x] Class bar on the dashboard (DSH-5 slot) and counts on student cards with number + pattern + word levels (never colour alone); student-card add-on registry; several student counters selectable — CRD-1/2, THM-5
- [x] Thresholds: one crossing per upward pass, undo below the limit clears it, counting continues past the limit; calm overlay once per crossing per device (mascot once, reduced motion respected, never names a student), then a banner; class reset with markers — D-058, D-059, CNT-9/10/11
- [x] Weekly history in the teacher area with explicit week ranges in the class timezone (Monday start), class-only / total / undone taps, lessons per week and labels used; counts only, never scores — CNT-7, CNT-12, RPT-5
- [x] Tests: week boundary (property, Istanbul), crossings (property), lesson vs weekly totals, undo below threshold, replay, absent student, archive, reset, history; client guard and optimistic updates; e2e: taps, undo, double tap, offline sync once, overlay once without names, settings and history (`e2e/counters.spec.ts`)
- [x] Review fixes (D-061): the toast of the tap that fills the bar no longer names the student; class reset asks for confirmation; weekly history shows "not recorded" (no lesson) and "not in the class" (per-week enrolment) instead of 0; neutral card level words; no preset created in an archived school year (tests: toast text and crossing detection, history cells, per-week enrolment, archived-year poll; e2e: no student name in any toast while the overlay is open)
- [ ] Undo for a class reset (a confirmation dialog guards it for now; not covered by e2e); threshold sound; per-attended-lesson rates in reports (S11)

## S7 Secret Students, assistant, End Lesson
- [x] Sealed draw (count setting 1–10, default 2), confirmed redraw, reveal and outcomes (goal met / still practising, note, celebration) at End Lesson, silent absent replacement with an identical attendance response, shortfall reasons for small classes, unrevealed rounds of abandoned lessons closed and never shown, teacher-area settings and history — SEC-1..7, D-007, D-010, D-062, D-064
- [x] Fair rotation: fewest counted selections, then longest ago, then a seeded order; redraw and absent withdrawals do not count, abandoned selections do (property test) — SEC-2, D-062
- [x] Daily Assistant: one per class+subject and day, deterministic weekly plan in Turkish collation, generated once and stable after announcing, re-plan only future unchanged days with confirmation, swaps, overrides, absence carry-forward, planned vs actual, missed turns, editable EN+TR responsibilities (four defaults), school days — AST-1..6, D-063, D-065
- [x] Dashboard panels for the assistant (with the classroom-safe week) and Secret Students (counts only, mascot), Start Lesson assistant step — DSH-3, DSH-6, D-066
- [x] End Lesson assembled from enabled module steps: Secret Students reveal → assistant thank-you → reflection — LES-3, D-067
- [x] Teacher-area weekly schedule page with a print view, responsibilities editor and history; Secret Students settings and history
- [x] Tests: differential pre-reveal leak scan over every GET (responses + ETags) plus logs/audit/command results, secrecy boundary grep, fairness properties, schedule determinism and stability, absence carry-forward, archived year read-only; e2e: draw, refresh, no chosen name in the panel or any secret-related response before the reveal, reveal and outcomes, weekly plan and announce, axe on the panels, the reveal and the assistant page (`e2e/secret-assistant.spec.ts`)
- [ ] Not yet: mobile-viewport check of the new teacher pages and an axe pass of the Secret Students teacher page (the panels, the reveal and the assistant page are axe-checked; small avatars were darkened for 4.5:1 contrast); the print view is CSS only, with no print e2e; fairness and outcome reports over the kept history come with S11

## S8 Grouping & homework
- [ ] Solver, 5 default arrangements, subject levels, pair constraints, unsatisfied report
- [ ] Homework, statuses, bulk checking, daily/weekly/monthly views
- [ ] Tests: partition/size/constraint properties, no levels on classroom screen, not-checked ≠ missing

## S9 Files, import, OCR
- [ ] Upload pipeline, photos with consent, quotas
- [ ] Importer: paste/CSV/XLSX/XLS/DOCX/PDF/OCR, preview, mapping, flags, batches, revert
- [ ] Tests: polyglot files, quotas, reimport no-dup, no similar-name merge, low-confidence OCR flagged

## S10 Goals, evidence, student links
- [ ] Categories, goals, self vs teacher assessment, private notes, evidence incl. audio recording
- [ ] Personal links (fragment token → cookie), revoke/regenerate, QR print, mobile pages
- [ ] Tests: cross-student isolation, revocation, no write to teacher assessments, mobile viewport

## S11 Reports, long-term data, operations
- [ ] All report areas with denominators/coverage, CSV, print
- [ ] Full data export (year archive, promotion and deactivation APIs already done in S2)
- [ ] Backup/restore CLI, timers, off-site, deploy with rollback; isolated install on Debian VM; ENG-5 report
- [ ] Production go-live only with explicit owner authorisation
