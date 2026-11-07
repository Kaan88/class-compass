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
- [ ] Playwright setup; i18n/a11y/raw-colour lint rules (S3)
- [x] Baseline migration, `/healthz`, redacted logging, CSP/security headers, robots/noindex
- [ ] Synthetic Turkish/English fixture generator (fictional students only)

## S1 Contracts, auth, audit
- [x] Endpoint registry with mandatory access class; typed client
- [x] Users, sessions, argon2id, CSRF/Origin, login lockout, `admin:create` + `admin:reset-password` CLI
- [ ] Email password reset when SMTP configured (D-015) — S2
- [x] Audit helper, command log, `/api/commands` idempotency
- [x] Tests: session expiry, lockout, CSRF, per-teacher locale, PIN lock/unlock/lockout, command replay/conflict (22 tests)
- [ ] Test enumerating every endpoint against the permission matrix — S2

## S2 School structure, admin, i18n
- [ ] Years, terms, classes, subjects, teaching contexts, module policies; admin UI
- [ ] Students, enrolments, manual + paste entry; Turkish text module; EN/TR with per-teacher locale
- [ ] Tests: authorisation matrix, Turkish sort/case/initials, locale isolation

## S3 UI kit & themes
- [ ] Tokens + 3 themes; StudentCard, CounterBar, SaveStateBadge, UndoToast, LockScreen, ClassBanner, ConfirmDestructive…
- [ ] Text scale, reduced motion, sounds/animation switches; `/dev/catalog`
- [ ] Tests: screenshot matrix, axe, contrast, 20- and 40-student grids

## S4 Classroom mode & PIN
- [ ] Lock screen, teacher menu, display banner, auto-lock, lockout, server 423 enforcement
- [ ] Tests: direct URL / back / refresh / bfcache / raw API bypass attempts

## S5 Lessons, outbox, attendance, routines
- [ ] Start / resume / end lesson; class switching; outbox + needs-attention tray; polling
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
- [ ] Year archive, promotion, deactivation, full export
- [ ] Backup/restore CLI, timers, off-site, deploy with rollback; isolated install on Debian VM; ENG-5 report
- [ ] Production go-live only with explicit owner authorisation
