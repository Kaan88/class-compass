# Class Compass: architecture review and recommendation

I read both files in full: `C:/Users/owner/Desktop/class/docs/REQUIREMENTS.md` (every requirement ID) and `C:/Users/owner/Desktop/class/docs/DECISIONS.md` (D-001 to D-005; D-005 still needs an owner decision). I wrote no files.

## 1. Scores (1–10)

| | P1 SQLite Monolith | P2 Fortress (PG + RLS + worker) | P3 PG + tRPC monorepo |
|---|---|---|---|
| Requirement coverage | 8 | 9 | 9 |
| Security | 7 | 9 | 8 |
| Long-term maintainability by an AI agent | 8 | 6 | 8 |
| Ops burden (higher = lighter) | 9 | 5 | 7 |
| Classroom UX | 7 | 8 | 9 |
| Risk (higher = safer) | 7 | 6 | 7 |
| **Overall** | **7.7** | **7.2** | **8.0** |

**P1: SQLite monolith**
- **Strengths:**
  - It has the fewest moving parts.
  - Tests run against the real database on Windows with nothing installed.
  - Backup is "one file plus a folder".
  - The default-deny route tags and the fragment-plus-cookie student link are good.
- **Defects:**
  - **The SEC-7 design leaks a secret.** The UI says "one secret student is now absent: replace?" right after the teacher marks a student absent. That tells the teacher who was selected. The `attention.absentSelectedCount` field leaks it the same way.
  - **Relocking on every classroom GET breaks PIN use.** "Any request to a classroom endpoint clears the unlock" will relock admin straight away while the 3 s lesson-state poll or the outbox sender is still running.
  - **"HEIC→converted" is wrong.** Prebuilt sharp cannot decode HEIC.
  - Polling only, no "needs attention" tray for rejected ops, and a cold reload while offline shows nothing.
  - SQLite `ALTER TABLE` means table-rebuild migrations. With `foreign_keys=ON` a rebuild can cascade-delete rows unless it is done carefully.

**P2: Postgres, RLS, separate worker**
- **Strengths:**
  - The strongest security: the cc_student role with RLS, an append-only audit table, the authorisation-matrix test, CSV formula-injection escaping, and a photo-consent flag.
  - A single `/api/commands` endpoint with a needs-attention tray.
- **Costs:**
  - The most things to run and understand: Postgres with 3 roles, RLS policies that must track every migration, pg-boss, a second process, and tesseract, ffmpeg and poppler as system packages.
  - The audit hash chain is extra work.
  - Native PostgreSQL is needed on Windows for dev.
  - OCR tests on Windows only replay recorded fixtures.
  - Too heavy for one school run by a non-specialist owner with an agent.

**P3: Postgres, tRPC, pnpm monorepo**
- **Strengths:**
  - The best UX and maintainability ideas:
    - module manifests and dashboard slots
    - End Lesson assembled from steps that each enabled module adds
    - `eslint-plugin-boundaries` to stop modules reaching into each other
    - a `/dev/catalog` page screenshot-tested for every theme, language and text size
    - a token contrast unit test
    - a `ClassBanner` and toasts that name the class
    - the `MetricCell` discriminated union
    - a double-tap window with an explicit "tap again" message
  - It replaces an absent secret student silently, which is the correct handling for SEC-7.
- **Costs:**
  - Postgres on Windows and in CI.
  - tRPC couples client and server, and a pnpm workspace adds tooling surface.
  - SheetJS has to be installed from its own CDN tarball.
  - pg-boss is more than this load needs.

## 2. Recommended architecture: "Compass Core"

The backbone is P1, plus P3's UI and module architecture and P2's command and safety details.

**Runtime and deployment**
- One Node LTS process on Debian 13.
- It runs Fastify 5 and serves both the JSON API and the prebuilt React SPA from the same origin.
- One SQLite file (better-sqlite3, WAL) and one uploads directory.
- Caddy for HTTPS, systemd for the service and timers, restic for off-site backup.
- No Docker, Redis, queue service or second process.
- More schools later means one instance per school (P1/P2 template unit), each with its own data directory and subdomain.

**Repository**
- One package (not a workspace), with folders `src/shared` (contracts, i18n, Turkish text helpers), `src/domain` (pure logic, no I/O), `src/server/modules/<m>/{routes,service,repo,policy}` and `src/client/modules/<m>`.
- ESLint 9 with typescript-eslint, `eslint-plugin-boundaries`, jsx-a11y, `eslint-plugin-i18next` (bans raw JSX strings) and a custom rule against raw colour values. Prettier for formatting.
- I chose ESLint over Biome because the boundary and accessibility plugins matter more here.

**API contracts (instead of tRPC)**
- `src/shared/contracts` lists every endpoint once: `{method, path, input: Zod, output: Zod (strict), access}`.
- The server registers routes only from that list (fastify-type-provider-zod). The output schema doubles as a serialisation allow-list.
- A ~150-line typed fetch client is generated from the same list.
- Tests can enumerate every endpoint (from P3's idea), and nothing is coupled to tRPC.

**Classroom writes (P2's command model)**
- Every classroom mutation is a command `{opId: UUIDv7, type, lessonId, classId, payload}`.
- The client stores it in a Dexie outbox before the optimistic UI update. Commands are sent in order per lesson to `POST /api/commands` (batches of up to 50).
- The server inserts `command_log(op_id PK, request_hash, result)` in the same transaction as the effect. Domain rows also use `id = opId`, a second guard against duplicates.
- Rejected commands go to a visible "Needs attention" tray.
- The save-state badge shows status with text and an icon, not colour alone (UX-10/11).
- A 700 ms per-student double-tap window shows "Already counted – tap again" (P3). Every action gets an 8 s undo toast.

**Multi-device sync**
- Poll lesson state every 5 s with an ETag (304 when unchanged), only while the classroom view is visible, and refetch on focus.
- Add SSE invalidation hints later if needed.

**Offline scope (record as a decision)**
- v1 tolerates drops and reloads. There is no service worker yet.
- After cold-start testing on the real classroom hardware, add an optional cached app shell (vite-plugin-pwa). It caches static assets only, never API data.

**PIN lock and classroom mode (fixed version)**
- Classroom mode is a property of the session (the device). It turns on when a lesson is started or resumed from that session, or when the teacher marks the device as the classroom display.
- Relocking happens only on an explicit `GET /api/classroom/enter` (the classroom bootstrap), plus inactivity and the lock button. It does not happen on every classroom route. This fixes P1's bug.

**Secret Students (P3's silent replacement)**
- If a selected student is marked absent, the server withdraws them and draws a replacement inside the attendance transaction.
- The attendance response, audit row and lesson DTO look identical whether or not a replacement happened.
- At reveal the teacher sees "replaced (was absent)".

**Turkish text**
- All Turkish handling lives in one module: `Intl.Collator('tr')` for sorting, `toLocale*('tr-TR')` for casing, NFC normalisation, and a folded search key (`name_fold`).
- Names are never sorted in SQL. A test with Turkish fixture names enforces this.
- `better-sqlite3` cannot register custom collations (unverified, see §8), so the sorting decision does not rely on one.

**i18n**
- Typed TS dictionaries: `tr.ts satisfies Messages<typeof en>`, plurals via `Intl.PluralRules`. This is P1's approach, with no dependency.
- Labels teachers can edit are stored as `{en, tr}` JSON.

**UI**
- React 19, Vite 7, TanStack Router and Query, React Aria Components, Tailwind 4 with three token layers (P3).
- `/dev/catalog` screenshot matrix, an axe check for each theme, and a contrast unit test.
- Recharts for charts, which print cleanly, with each chart followed by its data table.

**Files**
- Sniff the real type with `file-type` against an allow-list.
- Re-encode images with sharp, which strips EXIF/GPS. Reject HEIC, and tell users to pick "Most Compatible" or use the browser's own conversion.
- Store audio as uploaded (webm/opus or mp4/aac). ffmpeg transcoding is an optional later addition.
- Files are stored outside any web root under random names and served only by `/api/files/:id` after a policy check, with headers: sandbox CSP, `nosniff`, `no-store`, and attachment for anything that is not image or audio. Range requests are supported for audio.
- Quotas are checked in the same transaction that inserts the file row. Student photos have a consent flag (P2).

**Import and OCR**
- Parsers: papaparse (with a Windows-1254 fallback for Turkish Excel CSVs), SheetJS CE 0.20.x as a pinned tarball, mammoth for Word, unpdf for PDF text.
- I chose SheetJS over exceljs because it also reads `.xls`, which e-Okul-style exports often use.
- OCR uses tesseract.js 6 in a `worker_thread`, with tur+eng traineddata vendored in the repo. It sits behind an `OcrEngine` interface so native `tesseract` can replace it later.
- Scanned PDFs are rasterised only if `pdftoppm` is installed (feature flag).

**Auth**
- Built in-house, about 500 lines. Passwords use argon2id via `@node-rs/argon2`.
- The PIN is argon2id over HMAC(pepper, PIN), so a DB-only leak cannot be brute-forced offline.
- Cookies are `__Host-` prefixed: Lax for teachers, Strict for students. CSRF protection: Origin check plus a custom header.
- The first admin comes only from the `admin:create` CLI. Admins reset teacher passwords. Optional TOTP for admins later.

**Ops**
- `/opt/class-compass/releases/<sha>` with a `current` symlink, data in `/var/lib/class-compass/<school>`, config in `/etc/class-compass/<school>.env` (mode 600).
- Hardened systemd unit.
- Every deploy takes a `VACUUM INTO` snapshot before migrating, then checks `/healthz` and switches the symlink back if unhealthy.
- An hourly `db.backup()` timer, nightly restic off-site, and a weekly `restic check`.
- `class-compass restore` is exercised in CI.
- The Maintenance page warns when the last good off-site backup is more than 36 h old.

## 3. Alternative (heavier): "Compass on PostgreSQL"

Same app, same contracts, UI and command model. Swap SQLite for PostgreSQL 17 (from the Debian package) with Drizzle (or Kysely). Use ICU `tr-TR` collation in `ORDER BY`. Keep jobs in-process; there is still no pg-boss or worker process. Optionally add P2's `cc_student` role with RLS for the student portal only.

| | Compass Core (SQLite) | PostgreSQL variant |
|---|---|---|
| Services on the box | caddy + app | caddy + app + postgres |
| Tests on Windows or a cloud agent sandbox | Run anywhere, no install | Need native PG (winget/EDB) and template-database cloning |
| Backup and restore | Consistent file + folder; very simple | pg_dump + folder; standard but more steps |
| Turkish sorting | In app code (needs discipline) | In SQL (built in) |
| Student isolation | Typed `StudentScope` + tests | The same, plus RLS defence in depth |
| Schema evolution | Table-rebuild migrations; must be tested against fixture DBs | Transactional DDL; easier for big changes |
| Scaling path | Single process; move to PG if this becomes a hosted SaaS | Ready for multiple processes or many schools in one instance |

Choose PostgreSQL if the owner expects a hosted multi-school service within about two years, or is comfortable running PostgreSQL. Otherwise choose Compass Core.

## 4. Data-model outline

Each school is its own instance, so no table has a `school_id`. Times are stored as UTC epoch-ms. Events also store `local_date` and `week_start`, computed at write time in the class's timezone (D-003).

**School structure and accounts**
- **School structure:**
  - `school_settings(tz, week_start, default_locale)`
  - `school_years(id, name, starts_on, ends_on, archived_at)`
  - `terms(id, school_year_id, …)`
  - Archived years are read-only (a service-layer guard).
- **People and access:**
  - `users(id, login, display_name, role admin|teacher, password_hash, pin_hash, locale, text_scale, must_change_pw, disabled_at)`
  - `sessions(id_hash, kind teacher|student, user_id?, student_link_id?, classroom_mode, pin_unlocked_until, created/idle/absolute expiry)`
  - `auth_attempts(scope user|session|ip, kind login|pin, fails, locked_until)`
  - `one_time_tokens(kind setup|reset, hash, expires, used_at)`
- **Teaching structure:**
  - `subjects(id, name_json, archived_at)`
  - `classes(id, school_year_id, name, grade, theme, tz_override?)`
  - `teaching_contexts(id, teacher_id, class_id, subject_id, active_from, active_to)`. This is the teacher assignment. Counters, routines, the assistant, secret selections, groupings and homework hang off `context_id` (ACC-10).
  - `module_policies(module, availability)` holds the admin's global setting. `context_modules(context_id, module, enabled, config_json)` holds the teacher's per-class/subject setting (CFG-1/ACC-12). Disabling a module never deletes rows (CFG-2).

**Students and attendance**
- **Students:**
  - `students(id, student_number?, full_name, given/family?, name_fold, avatar_hue, photo_file_id?, photo_consent, deactivated_at, created_by_import_batch_id?)`
  - `enrolments(id, student_id, class_id, school_year_id, from_date, to_date, reason, import_batch_id?)` (DAT-2)
  - `student_subject_levels(student_id, subject_id, level, updated_by)`
- **Attendance:**
  - `attendance_daily(student_id, class_id, date, status, recorded_by, op_id)`, unique on (student, date)
  - `attendance_lesson_exceptions(lesson_id, student_id, status, …)`
  - Effective attendance is the lesson exception, else the daily record, else "not recorded".
  - Stored completely separately from homework (ATT-1).

**Lessons and routines**
- `routine_templates(id, context_id, name_json, stages_json, version)`
- `lessons(id, context_id, status active|ended|abandoned, started_at, ended_at, local_date, routine_snapshot_json, stage_index, timer_json, reflection, version, class_name_snapshot, subject_name_snapshot)`
- A partial unique index allows only one `active` lesson per `context_id`.

**Counters (event-based)**
- `counters(id, context_id, kind english|custom, label_json, scope lesson|student|both, bar_segments, reset_period, thresholds_json, archived_at)`
- `threshold_responses(id, counter_id, message_json, animation, sound)`
- `counter_events(id = opId, counter_id, lesson_id, student_id?, occurred_at, local_date, week_start, recorded_by, voided_at, voided_by, void_op_id, label_snapshot_json)`
- `threshold_crossings(counter_id, student_id?, period_key, crossing_seq, level, crossed_at, cleared_at, event_id)`, unique on (counter, student, period, seq) (CNT-11/D-004)
- Lesson total = count of non-voided events for the lesson. Weekly count = count of non-voided events for (student, counter, week_start).

**Secret Students**
- `secret_rounds(id, lesson_id, requested, selected, shortfall_reason, drawn_at, revealed_at, op_id)`, one live round per lesson
- `secret_selections(id, round_id, student_id, status sealed|withdrawn_absent|revealed|unrevealed_abandoned, outcome goal_met|still_practising|not_assessed, note, goal_label_snapshot)`
- Only the `secretStudent` service may read `student_id` before `revealed_at`.

**Daily assistant**
- `assistant_assignments(context_id, date, planned_student_id, actual_student_id, status, reason, generated_at, announced_at)`, unique on (context, date)
- `assistant_responsibilities(context_id, label_json, order)`

**Grouping**
- `group_templates(id, context_id, name, mode, group_count|target_size, seed, version, groups_json{name, role, members}, archived_at)`
- `pair_constraints(context_id, a, b, must|must_not)`
- `lesson_groupings(lesson_id, template_id, template_version, effective_groups_json, unsatisfied_json)` holds the per-lesson result with absent students excluded

**Homework**
- `homework(id, context_id, title, details, assigned_on, due_on, status_set_json)`
- `homework_marks(homework_id, student_id, status, note, updated_by, op_id)`
- No row means "not checked", which is never treated as missing (HW-4).

**Goals and evidence**
- `skill_categories(id, subject_id, name_json)`
- `goals(id, student_id, subject_id, category_id, author_type, text, preset_id?, review_on, status)`
- `goal_entries(id, goal_id, author_type teacher|student, kind reflection|progress|self_assessment, …)`
- `teacher_assessments` and `teacher_feedback` (visible to the student) are separate tables, and students have no write path to them (GOL-3/5).
- `private_teacher_notes(student_id, teacher_id, subject_id, text)` has no student-side repository function at all (GOL-6).
- `evidence(id, goal_id, kind text|link|file|audio, file_id?, author_type)`

**Files**
- `files(id, storage_key, sha256, size, sniffed_mime, kind, owner_student_id?, uploaded_by_type/id, created_at, deleted_at)`

**Student links**
- `student_links(id, student_id, token_hash UNIQUE, generation, created_by, created_at, revoked_at, last_used_at)`, at most one active link per student
- The hash is HMAC(pepper, token).

**Imports**
- `import_batches(id, source_type, file_id?, target_class_id, school_year_id, created_by, status draft|committed|reverted, counts_json, committed_at, reverted_at)`
- `import_rows(id, batch_id, idx, raw, parsed_json, ocr_conf, flags, decision, matched_student_id, created_student_id, created_enrolment_id, outcome, reason, source_row_hash)`

**Audit and operations**
- `command_log(op_id PK, actor, type, request_hash, result_json, at)`
- `audit_events(id, at, actor_type, actor_id, session_id, op_id, action, entity, entity_id, before_json, after_json)`. Insert only; services write it through `withAudit`. Secret identities are left out before reveal, and high-frequency taps are on an allow-list instead of being audited.
- `backup_runs(id, kind, status, size, location, verified_at)`

## 5. Permission model

**Who can call the API**
- **Anonymous:** `/healthz`, login, and the student-link token exchange (rate-limited).
- **Teacher session** (role `teacher` or `admin`).
- **Student session:** derived only from the link. `student_id` comes from the session, never from request parameters.

**Access class on each endpoint** (the server refuses to start if any endpoint is missing one)
- `classroom`: a teacher in an active lesson context. Allowed while locked.
- `teacher`: a teacher's own records. Needs the PIN when in classroom mode.
- `admin`: the admin role. Needs the PIN when in classroom mode.
- `student`: only the student's own records.

| Request | Locked classroom mode | Classroom mode, PIN unlocked | Personal (laptop) mode |
|---|---|---|---|
| Classroom actions (taps, attendance, stage, timer) | yes | yes | yes |
| Reports, private notes, roster edits, links, settings | 423 PIN_REQUIRED | yes | yes |
| Admin | 423 | admin role only | admin role only |

**PIN unlock rules**
- The unlock slides by 5 minutes on each sensitive request (PIN-7).
- `/classroom/enter`, the lock button, or inactivity relock it (PIN-6).
- 5 failures lock the PIN for 5 minutes, with escalating lockouts; 10 failures revoke the session. All attempts are audited.
- On unlock the client opens the teacher menu first (PIN-4) and shows a "visible on display" banner (PIN-5).
- Sensitive queries live under `['sensitive']`, are not fetched while locked, are removed on lock, and use `no-store` (PIN-3).

**Resource checks** (policy functions in services)
- A teacher may act on an active `teaching_context` they own.
- For shared class data (students, enrolments, daily attendance): any teacher with an active context in that class, with `changed_by` recorded and an audit entry (ACC-8/9).
- Admins have everything.
- Repository functions take typed `TeacherScope`, `StudentScope` or `AdminScope` parameters.

**Students**
- Every request re-checks that the link is still active, so revoking or regenerating takes effect at once (STU-3).
- Students can never reach other students, admin endpoints, private notes, secret rounds or teacher assessments.

## 6. Implementation stages

**S0. Spike and foundations**
- **Deliverables:**
  - Prove on Windows (Node 26) and on the Debian VM: better-sqlite3 prebuild, sharp, `@node-rs/argon2`, tesseract.js with `tur` on a sample photo, SheetJS tarball install. Choose the Node major (see §8).
  - Repo skeleton, lint rules, Vitest, Playwright, GitHub Actions (Ubuntu and Windows).
  - Drizzle baseline migration, `/healthz`, pino with redaction, helmet CSP.
  - Docs, D-005 recorded, synthetic Turkish fixture generator.
- **Tests:** CI green on both operating systems; fresh-migration test.

**S1. Contracts, auth and audit**
- **Deliverables:** contract registry and typed client; users and sessions; argon2; CSRF/Origin checks; `admin:create` CLI; password reset; `withAudit`; `command_log` and `/api/commands`.
- **Tests:**
  - Every endpoint has an access class.
  - Session expiry; login lockout.
  - Command replay returns the stored result; same opId with a different body returns 409.

**S2. School structure, admin and i18n**
- **Deliverables:**
  - Years, terms, classes, subjects, contexts, module policies; admin panel.
  - Students, enrolments, manual entry and paste/CSV entry; Turkish text module; EN/TR dictionaries with per-teacher locale.
- **Tests:**
  - Authorisation matrix (assigned vs unassigned teacher, admin).
  - Turkish sorting, casing and initials.
  - Missing-key parity is a compile-time check; one teacher's locale does not change another's.

**S3. UI kit and themes**
- **Deliverables:** tokens; 3 themes; BigButton, StudentCard, CounterBar, SaveStateBadge, UndoToast, LockScreen, ClassBanner, MetricCell, ConfirmDestructive; text scale; reduced motion; `/dev/catalog`.
- **Tests:** screenshot matrix (themes × EN/TR × text sizes); axe; contrast unit test; card grid with 20 and 40 students.

**S4. Classroom mode and PIN**
- **Deliverables:** route guards, lock screen, teacher menu, banner, auto-lock, lockout.
- **Tests:**
  - Playwright: direct URL, back button, refresh, bfcache.
  - Raw API calls get 423.
  - `/classroom/enter` relocks; background polling does not relock.

**S5. Lessons, outbox and attendance**
- **Deliverables:** start/resume/end (forced new lesson only with confirmation); Dexie outbox; needs-attention tray; polling; daily attendance and lesson exceptions; routines, templates, timer; dashboard with date and timezone.
- **Tests:**
  - New vs resumed lesson; class switching with queued ops.
  - Offline and `route.abort` after the server commits: no duplicates and no losses.
  - Attendance kept independent of homework.

**S6. Counters**
- **Deliverables:** English reminder preset; custom counters; void/undo; thresholds and crossings; responses.
- **Tests:** fast-check properties for the week boundary (Monday 00:00 Istanbul), lesson total vs weekly count, undo below threshold not re-firing, double-tap window.

**S7. Secret Students, assistant and End Lesson**
- **Deliverables:** sealed draw, reveal, outcomes, silent absent replacement, history; materialised weekly assistant plan with swaps and planned vs actual; End Lesson assembled from module steps.
- **Tests:**
  - Leak scan of every response body and log line before reveal, including attendance responses during a replacement.
  - Fairness spread within 1.
  - The schedule is stable when regenerated; absence carries the turn forward.
  - End Lesson works with modules disabled.

**S8. Grouping and homework**
- **Deliverables:** solver; 5 default arrangements; subject levels; pair constraints; unsatisfied-constraint report; homework with statuses, bulk checking and daily/weekly/monthly views.
- **Tests:** properties for partition completeness, sizes, determinism for a seed and impossible constraints; no levels in the classroom view; "not checked" is not "missing".

**S9. Files, import and OCR**
- **Deliverables:** upload pipeline; photos with consent; importer for paste/CSV/XLSX/XLS/DOCX/PDF/OCR with preview, field mapping, flags, batches and revert.
- **Tests:** polyglot files (HTML-in-JPEG, SVG, EXIF/GPS); quotas; re-import creates no duplicates; never merges on similar names; low-confidence OCR rows flagged; revert keeps students with history.

**S10. Goals, evidence and student links**
- **Deliverables:** categories; goals; self vs teacher assessment; private notes; evidence including MediaRecorder audio; fragment-token links with QR printing; mobile pages.
- **Tests:** student A against B's records, files and notes; revoked and regenerated links; student cannot write teacher assessments; mobile viewport.

**S11. Reports, long-term data and ops**
- **Deliverables:**
  - Metric cells with denominators; all RPT areas; CSV (BOM, formula-injection escaping); print routes.
  - Year archive and promotion; account deactivation; full ZIP export.
  - Backup and restore CLI; timers; restic; `deploy.sh` with rollback; Caddy; isolated Debian VM install and an honest ENG-5 report.
- **Tests:** zero vs absent vs not recorded; CI restore drill (row counts and file hashes); migration from the previous release's fixture DB.
- Production go-live only with the owner's explicit authorisation (OPS-4).

## 7. Decisions to log in DECISIONS.md

- D-005: stack. Compass Core, or the PostgreSQL variant.
- D-006: offline scope. Tolerate drops and reloads; no cold-start offline in v1.
- D-007: an absent secret student is replaced silently and shown as "replaced" at reveal.
- D-008: one instance per school.
- D-009: Turkish sorting happens in app code (Core option only).
- D-010: an abandoned lesson's secret selection stays unrevealed. It counts toward fairness but is never shown as "selected".

## 8. Libraries or claims to verify at S0

- **better-sqlite3 12.x prebuilds for Node 26** (win32-x64 and linux-x64). It is tied to Node's ABI, unlike sharp and `@node-rs/argon2`, which use N-API.
  - If prebuilds are missing, run Node 24 LTS on both machines (install alongside 26 with fnm).
  - The built-in `node:sqlite` may still be experimental (unverified).
  - I have not verified whether better-sqlite3 can register custom collations; I believe it cannot.
- **Drizzle version:** 0.44 vs 1.x. I am unsure whether 1.0 is stable by now; pin exact versions.
- **fastify-type-provider-zod with Zod 4:** check that the major version supports it.
- **exceljs:** looks unmaintained since 2023, which is why I prefer SheetJS CE.
- **SheetJS CE 0.20.x:** only distributed from its own CDN.
- **@fontsource "Atkinson Hyperlegible Next":** unsure it exists.
- **tesseract.js 6:** check the Node `worker_thread` API and loading traineddata from local files.
- **unpdf:** check that it works on Node 26.
- **sharp prebuilds:** no HEIC (P1's claim is wrong).
- **pg-boss, kysely-codegen, ECharts 6:** not needed in the recommended option.
- **Debian 13 packages:** Debian's own `nodejs` is too old; use NodeSource or the official tarball. PostgreSQL 17 and tesseract 5.5 match what I remember; confirm on the VM.

## 9. Questions for the owner

1. **Database:** Compass Core (SQLite, lightest to run) or the PostgreSQL variant? The deciding question is whether a hosted multi-school version is realistic within two years.
2. **Production server:** Debian version, what already listens on 80/443 (nginx?), which domain or subdomain to use, and who holds SSH access.
3. **Off-site backup:** where (B2, Hetzner Storage Box, a home machine) and who provides the credentials. Is losing up to 1 hour acceptable, or does it need to be less?
4. **Classroom hardware:** what the touchscreen is (Windows PC with Chrome, an Android board, a smart-board browser), and how often Wi-Fi drops completely. This decides whether a cold-start offline service worker is needed.
5. **Student lists:** do they come from e-Okul exports (.xls), Excel files or photos of paper? Do students have school numbers? This sets importer priorities.
6. **Data protection (KVKK) and consent:**
   - Are student photos and audio allowed?
   - Who is the data controller?
   - How long should archived years be kept?
7. **Teacher logins:** do teachers have email addresses? Is SMTP available for reset links, or are resets admin-only?
8. **Student devices:** home phones, or shared school tablets? This sets the student cookie lifetime and whether a "sign out on this device" option is needed. QR cards for links: yes or no?
9. **Simultaneous devices:** do the teacher's laptop and the touchscreen drive the same lesson at the same time? This decides polling vs SSE.
10. **Secret Students:** confirm the silent replacement when a selected student is marked absent.