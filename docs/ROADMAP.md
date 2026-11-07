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
- [ ] Verify the e2e CI job on Ubuntu stays reliable over several runs

## S4 Classroom mode & PIN
- [~] Lock screen, teacher menu (menu first after unlock), display banner, client idle relock, lockout countdown, server 423 enforcement — client side done in S3 (D-031, D-032); classroom-mode entry from a started lesson comes with S5
- [~] Tests: direct URL / back / refresh / raw API bypass and 423 swap covered in `e2e/pin-lock.spec.ts`; bfcache restore and inactivity relock not yet covered by e2e

## S5 Lessons, outbox, attendance, routines
- [ ] Start / resume / end lesson; class switching; outbox + needs-attention tray; polling — outbox client, tray, save badge and class switcher exist (S3); lesson flows, polling and dashboard slot contents do not
- [ ] Daily attendance + lesson exceptions; routine templates, stages, timer; dashboard date/timezone
- [ ] Tests: new vs resumed, switching with queued ops, offline/abort-after-commit, attendance independence

## S6 Counters
- [ ] English reminder preset; custom counters; void/undo; thresholds & responses
- [ ] Tests: week boundary (property), lesson vs weekly totals, undo below threshold, double-tap

## S7 Secret Students, assistant, End Lesson
- [ ] Sealed draw, reveal, outcomes, silent absent replacement, history
- [ ] Weekly assistant plan, swaps, planned vs actual, responsibilities
- [ ] End Lesson assembled from enabled module steps
- [ ] Tests: pre-reveal leak scan, fairness, schedule stability, absence carry-forward

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
