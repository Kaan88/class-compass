# Class Compass — Architecture & Data Model

Status: **PROPOSED — awaiting owner decision (D-005).** Full panel review with scoring:
`docs/design/2026-11-07-stack-panel-review.md`.

## 1. Recommended: "Compass Core"

One TypeScript modular monolith, one SQLite database file, one uploads folder, one Linux server.

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19 + Vite SPA, TypeScript strict, TanStack Router + Query, React Aria Components, Tailwind 4 on CSS-variable design tokens | Accessible touch primitives (no hover dependence), type-safe routes with guards, cache that can be purged on PIN lock |
| Backend | Node LTS + Fastify 5, Zod 4 contracts shared with the client | Validation and *output allow-listing* from one schema; small, well-known |
| Database | SQLite (better-sqlite3, WAL) via Drizzle migrations | Hundreds of students is <1% of SQLite capacity; no DB server to run/upgrade; backup = consistent file + folder; tests run on Windows with zero installs |
| Classroom writes | Command outbox: every action has a client UUIDv7 `opId`, stored in IndexedDB before sending; server dedups in the same transaction | Satisfies UX-10/11, CNT-5: no loss, no duplicates, survives refresh |
| Sync | Lesson-state polling (5 s, ETag/304) while visible | Laptop + touchscreen stay consistent; SSE can be added later |
| Auth | In-house (~500 lines, fully tested): argon2id, server-side sessions, `__Host-` cookies, Origin+header CSRF, CLI-only first admin | Small surface, no deprecated libs, no external IdP |
| Files | Type sniffing + allow-list, images re-encoded (EXIF/GPS stripped), random names outside web root, served only via policy-checked endpoint with sandbox CSP / nosniff | STU-8: uploads can never execute |
| Import/OCR | papaparse, SheetJS (xls/xlsx), mammoth (docx), unpdf (pdf), **tesseract.js local OCR** (tur+eng) in a worker thread | No student data leaves the server (IMP-7) |
| i18n | Typed EN/TR dictionaries (TR must match EN keys at compile time); editable labels stored as `{en,tr}`; one Turkish text module (`Intl.Collator('tr')`, tr-TR casing, NFC) | UX-3/4/5 |
| Charts/print | Recharts (SVG) + data table under each chart; print-specific routes; CSV with BOM and formula-injection escaping | RPT-4/5 |
| Testing | Vitest (unit/integration on real SQLite), fast-check (property tests for rotations, weeks, grouping), Playwright (touch, mobile, PIN bypass attempts, screenshot matrix themes×languages×text sizes), axe | ENG-3/4 |
| Deploy | Caddy (HTTPS) → one hardened systemd service; releases + `current` symlink; pre-migration snapshot; health-check rollback | Two services total |
| Backup | Hourly online `db.backup()` + uploads, nightly encrypted off-site via restic, weekly verify, restore CLI exercised in CI | DAT-4 |

**Multi-school later:** one instance per school (own data dir, subdomain, systemd template unit) — zero risk of cross-school leakage.

### Alternative: "Compass on PostgreSQL"
Identical app, contracts, UI, command model. SQLite → PostgreSQL 17 (Debian package). Gains: Turkish ICU collation in SQL, transactional DDL, optional row-level security for the student portal, ready for one multi-school instance. Costs: a third service to run/upgrade, pg_dump-based backups, PostgreSQL install needed on Windows for tests. **Choose it only if a hosted multi-school service is realistic within ~2 years.**

## 2. Code structure
```
src/shared/      contracts (Zod endpoint registry), i18n dictionaries, turkish text utils, tokens
src/domain/      pure logic, no I/O: rotations, week boundaries, grouping solver, metrics, name parsing
src/server/modules/<module>/{routes,service,repo,policy}.ts
src/client/modules/<module>/   + src/client/ui (design-system components)
```
- Each module (lessons, counters, secret, assistant, grouping, homework, attendance, goals, evidence, links, import, reports, admin) declares a **manifest**: dashboard slots, End-Lesson steps, settings, permissions. Disabled modules simply don't contribute; data stays (CFG-2, LES-3).
- `eslint-plugin-boundaries` stops modules reaching into each other's internals; `tests/client/lint-rules.test.ts` (TypeScript compiler API) bans raw UI strings in JSX, checks en/tr key parity and bans raw colours outside the token sheet.
- **Client shell (S3):** `src/client/router.tsx` (TanStack Router, code-based) → `RootLayout` (locale, text scale) → route guards in `routes/guards.ts` (`requireSession`, `homeFor`, safe `next`). `/classroom` (classroom-safe dashboard: class switcher, banner with local date, save badge, attention tray, module slots), `/teacher/*` and `/admin/*` (both wrapped in `SensitiveGate`: PIN lock screen, menu-first, idle relock, display banner). Admin screens and `/dev/catalog` are lazy chunks (D-038). Server state via TanStack Query; `me` is always refetched before guarded routes and after a 423, and `['sensitive', …]` caches are purged on lock and on bfcache restore.
- **Offline outbox (ENG-4):** `src/client/lib/outbox.ts` stores command envelopes in IndexedDB (Dexie) *before* sending, flushes in order in batches to `/api/commands` (single flight per tab, Web Locks across tabs), retries network/5xx/429/423 failures with exponential backoff (a locked device keeps its queue), pauses on 401 until the next sign-in, and moves rejected commands to a needs-attention list (retry under a new opId, or dismiss; opId conflicts can only be dismissed). The server's opId log makes resends after a lost response harmless. Commands belong to the account that queued them (D-039): only the signed-in owner's commands are sent (with `asUser`, which the server checks) or shown, so on a shared classroom PC another teacher's queued commands stay parked until that teacher signs in again.
- **Admin UI:** one screen per S2 resource under `/admin` (accounts, school settings, years/terms, subjects, classes with theme preview and promotion, teaching assignments, module and media policies, students with search/move/history, audit log). Temporary passwords are shown once with a copy button; destructive actions need typed confirmation.
- Every endpoint is declared once with an **access class** (`classroom | teacher | admin | student | public`); the server refuses to start if one is missing, and a test enumerates all endpoints against the permission matrix.

## 3. Permission model
**Principals:** admin, teacher (sessions from login); student (session derived only from a personal link — `student_id` never comes from request parameters).

**Ownership:**
- *Shared class data* — students, enrolments, daily attendance, photos: any teacher with an active teaching context in that class may edit; every change records `changed_by` and an audit event (ACC-7/8/9).
- *Context-owned data* — a **teaching context** = teacher × class × subject. Lessons, counters, routines, assistant rota, Secret Student rounds, groupings, homework hang off it and are visible/editable only by its teacher (and admins) (ACC-10).
- *Student-owned data* — student goals, reflections, self-assessments, evidence: editable by the student (via link) and readable by their teachers. Teacher assessments, feedback and private notes are teacher-owned; students have no write path, and private notes have no student-side read path at all (GOL-3/5/6).
- *Admin* — global module availability, accounts, years/terms, classes/subjects, assignments, maintenance.

**Classroom mode & PIN (PIN-1…9):** classroom mode is a property of the device session, set when a lesson is started/resumed on it. In classroom mode, only `classroom` endpoints work; `teacher`/`admin` endpoints return **423 PIN_REQUIRED** server-side, so URLs, history, refresh and raw API calls can't bypass it. Unlock slides 5 min per sensitive request; relock on entering the classroom view, the lock button, or inactivity; escalating lockout after 5 failures, session revoked after 10. Sensitive client caches are never fetched while locked, purged on lock, and sent `no-store`. After unlock: teacher menu first, with a persistent "visible on classroom display" banner.

## 4. Data model (outline)
One school per instance. Times in UTC; events also store `local_date` and `week_start` computed at write time in the class timezone (default Europe/Istanbul, week from Monday 00:00 — D-003).

- **Structure:** `school_settings`, `school_years`, `terms`, `subjects{name:{en,tr}}`, `classes{year, name, theme, tz?}`, `teaching_contexts{teacher, class, subject, active_from/to}`, `module_policies` (admin), `context_modules{context, module, enabled, config}` (teacher).
- **People:** `users{role admin|teacher, password_hash, pin_hash, locale, text_scale, disabled_at}`, `sessions`, `auth_attempts`, `one_time_tokens`.
- **Students:** `students{student_number?, full_name, name_fold, avatar_hue, photo_file_id?, photo_consent, deactivated_at}`, `enrolments{student, class, year, from, to, reason}` (promotion keeps history), `student_subject_levels` (never shown on classroom screen).
- **Attendance:** `attendance_daily(student,date)` + `attendance_lesson_exceptions(lesson,student)`; effective = exception › daily › *not recorded*. Independent of homework.
- **Lessons:** `routine_templates{stages}`, `lessons{context, status active|ended|abandoned, routine_snapshot, stage_index, timer, reflection, class/subject name snapshots}`; DB-enforced one active lesson per context.
- **Counters:** `counters{kind, labels, scope, segments, reset_period, thresholds}`, `threshold_responses`, `counter_events{id=opId, lesson, student?, week_start, voided_at/by, label_snapshot}`, `threshold_crossings`. Lesson total = live events of that lesson; weekly count = live events in that week (CNT-8).
- **Secret Students:** `secret_rounds{lesson, requested, selected, shortfall_reason, revealed_at}`, `secret_selections{student, status sealed|withdrawn_absent|revealed, outcome, note}`. Only the secret-student service can read identities pre-reveal; DTOs carry counts only. Absent selected student → silently replaced in the same transaction; responses identical either way (SEC-3/7).
- **Assistant:** `assistant_assignments(context,date){planned, actual, status, reason, announced_at}` — materialised weekly plan, so announced schedules never regenerate; absences carry the turn forward.
- **Grouping:** `group_templates{mode level|mixed, count|target_size, seed, groups}`, `pair_constraints{must|must_not}`, `lesson_groupings{effective_groups, unsatisfied}`.
- **Homework:** `homework{context, title, details, assigned_on, due_on}`, `homework_marks{status, note}` — no row = *Not checked*, never Missing.
- **Goals:** `skill_categories`, `goals{author_type, preset?, review_on}`, `goal_entries{author_type, kind reflection|progress|self_assessment}`, `teacher_assessments`, `teacher_feedback` (student-visible), `private_teacher_notes`, `evidence{kind text|link|file|audio}`.
- **Files:** `files{storage_key, sha256, size, sniffed_mime, owner_student?, uploaded_by, deleted_at}`.
- **Links:** `student_links{student, token_hash (HMAC with server pepper), generation, revoked_at, last_used_at}`; token delivered in the URL fragment then exchanged for a strict cookie, so it never reaches logs or referrers.
- **Import:** `import_batches{source, target_class, status draft|committed|reverted, counts}`, `import_rows{raw, parsed, ocr_conf, flags, decision, matched/created ids}` — enables preview, report and safe reversal.
- **Audit/ops:** `command_log(op_id)`, `audit_events{actor, action, entity, before, after}` (insert-only), `backup_runs`.
- **Renames (DAT-6):** historical rows keep label snapshots, so renamed classes/goals/counters stay understandable.

## 5. Design system
Three token layers: primitives (`--p-*`) → semantic (`--cc-surface`, `--cc-accent`, `--cc-danger`, `--cc-level-0..2`…) → theme overrides under `[data-theme="explorer|animals|classroom"]`, all in `src/client/styles/app.css`. Components only use semantic tokens; themes only change tokens + illustration set + mascot. Meanings (icons, labels, positions) identical across themes. Text scale is a root multiplier; reduced-motion and per-class sounds/animations switches gate every effect; no repeated flashing anywhere.
