# Class Compass — Product Requirements

Status: **Agreed scope (v1)**. Stack/architecture: see `ARCHITECTURE.md` (pending owner decision).
Requirement IDs are stable; reference them in commits, tests and the checklist (`ROADMAP.md`).
Nothing here may be dropped silently — de-scoping requires an entry in `DECISIONS.md`.

## 0. Product context
- Primary-school classroom app. First user: an English teacher; then classroom teachers and other subject teachers.
- Shown on a classroom display; driven from a laptop or the classroom touchscreen. Typical class 18–20 students; larger classes supported.
- English first, but core must be subject-neutral: subjects, custom counters, routines, goals, teacher preferences.
- Name: **Class Compass** (TR: *Sınıf Pusulası*). Chosen to fit the explorer theme and future multi-subject use.

## 1. Project & operations (OPS)
- OPS-1 Private GitHub repo `Kaan88/class-compass` (created, verified private 2026-11-07).
- OPS-2 Persistent docs: requirements, decisions, architecture & data model, roadmap/checklist, setup/testing/backup/restore/deployment.
- OPS-3 Checklist kept current so work can resume across sessions.
- OPS-4 Production: Linux (details TBD). Test deployment on owner's Debian VM: inspect first, preserve existing services, isolate the app. VM access ≠ production authorisation.
- OPS-5 Never commit credentials, student records, uploads, photos, DB files or backups. Fictional/synthetic data only in dev/test. Example config without real secrets.
- OPS-6 Reviewable stages, meaningful commits; demonstrate features with fictional data; state remaining work honestly; no placeholders presented as done.

## 2. Usability & languages (UX)
- UX-1 One classroom interface (no separate presenter/controller views).
- UX-2 Desktop and classroom touchscreen first. Student personal pages: mobile-friendly. Other pages need not be mobile-first.
- UX-3 English + Turkish throughout; default English everywhere.
- UX-4 Language preference is per teacher (and per device/session for student pages) — one teacher changing language must not change another teacher's interface.
- UX-5 Correct Turkish characters, casing (İ/ı, I/i), sorting/collation and name handling.
- UX-6 Large readable text, generous touch targets, clear labels, strong contrast, predictable navigation.
- UX-7 No reliance on hover or colour alone.
- UX-8 Routine classroom actions in one or two taps.
- UX-9 Undo for common accidental actions.
- UX-10 Clear saving / saved / offline / error states.
- UX-11 Interrupted connections never silently lose or duplicate actions (idempotent, queued writes).

## 3. Visual design & themes (THM)
- THM-1 Attractive to children, not cluttered or distracting.
- THM-2 Theme system with at least: Explorer/adventure; Friendly animal mascots; Clean colourful classroom with subtle illustrations.
- THM-3 Theme chosen per class. Essential controls and meanings identical across themes.
- THM-4 Implemented via shared design tokens and components — no per-theme copies.
- THM-5 Sounds and animations can be disabled; respect reduced motion; no repeated flashing.
- THM-6 Adjustable text size.

## 4. Accounts, roles, shared data (ACC)
- ACC-1 Separate **administrator** role, distinct from **teacher**.
- ACC-2 Admin features (designed by us, see ARCHITECTURE): teacher accounts & access, class/subject management, assignments of teachers to class+subject, global module availability & permissions, account recovery, maintenance (backups, archive, audit log, school years).
- ACC-3 Secure initial admin setup; no hard-coded admin password; no public admin registration.
- ACC-4 Teachers access only assigned classes and authorised records.
- ACC-5 Teachers configure modules per class/subject they teach, within admin permissions.
- ACC-6 Teachers create their own counters, assignments, goals, routines, optional Secret Student and Assistant systems.
- ACC-7 One student identity; shared class roster.
- ACC-8 Shared daily attendance with lesson-specific exceptions.
- ACC-9 Record who changed shared information.
- ACC-10 Lesson records, assignments, counters, goals, role rotations kept appropriately separate per subject/teacher.
- ACC-11 Ownership & permission rules defined and documented.
- ACC-12 Admin controls application-wide availability/permissions; teachers customise within them.

## 5. Presentation-safe administration (PIN)
- PIN-1 During an active classroom session, sensitive pages require a teacher PIN.
- PIN-2 Opening administration first shows a neutral lock screen.
- PIN-3 Sensitive content is never rendered behind the PIN screen nor flashed during navigation.
- PIN-4 After unlocking, a teacher menu is shown before any sensitive report opens.
- PIN-5 Clear indication that administration is visible on the classroom display.
- PIN-6 Returning to the classroom interface relocks automatically.
- PIN-7 Inactivity auto-lock; rate limiting / lockout on repeated PIN failures.
- PIN-8 No bypass via direct URLs, history, refresh, or API requests — enforced server-side.
- PIN-9 PIN supplements, never replaces, authenticated teacher access.

## 6. Classroom dashboard & lesson lifecycle (DSH / LES)
- DSH-1 Prominent active class and subject.
- DSH-2 Auto-updating local date and day (configured timezone; default Europe/Istanbul; never hard-coded dates).
- DSH-3 Today's assistant and responsibilities.
- DSH-4 Routine/current stage.
- DSH-5 Main class counter.
- DSH-6 Secret Student select/reveal controls.
- DSH-7 Collapsible student-card grid.
- DSH-8 Access to groups, homework, lesson tools.
- LES-1 Start Lesson: select class+subject → confirm attendance → show today's assistant → start selected routine → initialise lesson state.
- LES-2 Resume Lesson: restore after refresh/reopen/class switch; preserve counters, routine stage, hidden Secret Student selection; never accidentally create a new lesson or reroll.
- LES-3 End Lesson: reveal Secret Students → record outcomes → short reflection → save completed lesson. Works when optional modules are disabled.
- LES-4 Quick class switching preserves each class's state and prevents recording against the wrong class.

## 7. Routines (RTN)
- RTN-1 Default: Greeting → Date and weather → Assistant → Learning goal → Activities → Reflection.
- RTN-2 Teachers create/save templates; reorder, add, remove, rename stages; different templates per class.
- RTN-3 Current stage shown clearly. Optional classroom timer.

## 8. Feature configuration (CFG)
- CFG-1 Modules enabled/disabled per class/subject by teachers, subject to admin permission: Routines, Attendance, Counters, Secret Students, Assistant, Grouping, Homework, Goals & reflections.
- CFG-2 Disabling never deletes history.
- CFG-3 Meaningful configurable defaults; settings kept out of the way during lessons.

## 9. English/Turkish reminder counter (CNT)
- CNT-1 Default English module labels: main “Our English Time”; supporting “3 / 10 Turkish reminders”; individual “Turkish reminders”. Labels and threshold responses editable (EN/TR).
- CNT-2 Main bar: 10 segments by default; belongs to one lesson (class+subject); resets on NEW lesson; not on resume or class switch.
- CNT-3 Tap + on a student card records a reminder event attributed to student + lesson; updates lesson bar and student's weekly count.
- CNT-4 Undo/correction keeps accountability (events are voided, not deleted).
- CNT-5 Idempotent recording: no duplicates from retries or accidental double taps.
- CNT-6 Individual counters accumulate weekly, no maximum, clear numeric count, neutral→amber→red via configurable thresholds (colour supplementary).
- CNT-7 Previous weeks preserved; explicit week boundary in configured timezone (default Monday 00:00).
- CNT-8 Lesson total = sum of that lesson's events (not sum of weekly totals).
- CNT-9 At threshold: configurable message + optional brief mascot animation; “No breaktime” is one selectable message, not fixed. Alternatives e.g. class reset, English practice challenge. No repeated flashing; never highlight the triggering student.
- CNT-10 Individual reminders continue after the bar is full.
- CNT-11 Defined undo behaviour below threshold (threshold state is derived; dropping below clears “reached” display; response is not re-fired until crossed again — documented).
- CNT-12 Custom counters: name, scope (per lesson / per student / both), limit, reset period, colours, optional threshold responses. English preset preserved.

## 10. Student cards (CRD)
- CRD-1 Stylised initials avatar left of full name; stable attractive colours; optional uploaded photo.
- CRD-2 Weekly reminder count + visual indicator; large reminder button; clear absent status (not colour-only).
- CRD-3 Collapsible grid, designed for 18–20, supports larger classes.

## 11. Secret Students (SEC)
- SEC-1 Teacher presses a button to select; count configurable; only present students.
- SEC-2 Fair rotation (avoid repeats).
- SEC-3 Identities hidden from everyone incl. teacher until reveal; not exposed in any pre-reveal client response.
- SEC-4 Persist across refresh and class switching; reset for each NEW lesson.
- SEC-5 At End Lesson: reveal, record Goal met / Still practising, optional notes & celebration.
- SEC-6 Keep selection and outcome history.
- SEC-7 Graceful with small classes, insufficient eligible students, attendance changes (e.g. selected student marked absent mid-lesson).

## 12. Daily assistant (AST)
- AST-1 One assistant per day per enabled class/teacher/subject context, kept for all relevant lessons that day.
- AST-2 Fair rotation through roster; weekly schedule announceable in advance; stable (not regenerated randomly).
- AST-3 Manual swaps and overrides.
- AST-4 Absent assistant → replacement chosen; absent student keeps their opportunity later.
- AST-5 Record planned vs actual; cumulative history.
- AST-6 Default editable responsibilities: remind classmates to prepare English materials; help organise the classroom; keep extra materials ready; tell the teacher about problems.

## 13. Grouping (GRP)
- GRP-1 Five default saved arrangements: two by level, three mixed-level (arrangements, not groups).
- GRP-2 Change number/type of arrangements; reusable templates; group count or target size.
- GRP-3 Subject-specific levels; generate and manually edit; save and reuse.
- GRP-4 Pair preferences (should / should not work together).
- GRP-5 Exclude absent students for the current lesson without altering the saved template.
- GRP-6 Child-friendly group names; optional roles.
- GRP-7 No private ability labels on the classroom screen.
- GRP-8 Uneven sizes and conflicting constraints handled transparently (report unsatisfied constraints).

## 14. Homework & attendance (HW / ATT)
- HW-1 Stored per assignment; daily, weekly, monthly views.
- HW-2 Statuses: Not checked, Completed, Partly completed, Missing, Submitted late, Excused (default; configurable).
- HW-3 Details, subject, dates, optional notes.
- HW-4 Fast checking: bulk actions + individual corrections. Unreviewed ≠ missing.
- ATT-1 Shown alongside homework, stored separately and independently.
- ATT-2 Daily attendance + lesson-specific exceptions; present / absent / late / excused.

## 15. Goals, reflection, evidence (GOL)
- GOL-1 Default skill categories: Reading, Writing, Grammar, Vocabulary, Listening; custom categories; preset or custom goals.
- GOL-2 Teacher-created goals; student-selected preset goals; student-written goals; practice choices; review dates; progress updates; notes & reflections; evidence; teacher feedback & outcomes.
- GOL-3 Student self-assessment kept separate from teacher assessment.
- GOL-4 Evidence: text, web links, photos, documents, audio uploads, in-browser audio recording where supported.
- GOL-5 Students manage own contributions; cannot alter teacher assessments.
- GOL-6 Private teacher notes clearly separated from student-visible feedback.

## 16. Personal student pages (STU)
- STU-1 Personal link per student; link-only (no account/PIN); mobile-friendly.
- STU-2 Shows only that student's permitted records across subjects; can add goals, notes, reflections, evidence.
- STU-3 Teachers revoke and regenerate links.
- STU-4 Strong unguessable tokens; stored hashed; scope enforced on every request and file access.
- STU-5 Never rely on hidden buttons or URL secrecy alone; no access to classmates, admin, private notes, hidden Secret Student selections.
- STU-6 No token leakage via logs, analytics, referrers (Referrer-Policy: no-referrer), indexing (noindex, robots).
- STU-7 Explain to teachers that anyone holding a valid link can act within its scope.
- STU-8 Upload validation (type sniffing, size limits, per-student/global quotas); uploaded content can never execute; evidence protected by owner's access rules.

## 17. Student list importer (IMP)
- IMP-1 Inputs: pasted text, CSV, Excel, Word, PDF, photos/scans (OCR).
- IMP-2 Workflow: upload/paste → extract candidate rows → identify names + optional student numbers/classes → editable preview & field mapping → flag uncertainty/duplicates/missing → confirm → report added/matched/skipped/failed.
- IMP-3 Preserve Turkish characters; multi-part names without simplistic surname assumptions; ignore headings and blank rows.
- IMP-4 Match by student number when available; never silently merge on similar names.
- IMP-5 Re-import never duplicates or overwrites history; imports correctable/reversible (import batches).
- IMP-6 Auto-generated initials avatars.
- IMP-7 Any external OCR service explained (with data implications) before use; local OCR preferred.

## 18. Statistics & reports (RPT)
- RPT-1 Areas: overview; English/custom counter trends; homework; attendance; goals & skills; reflections; assistant & Secret Student fairness; grouping history; individual timelines; printable/exportable reports.
- RPT-2 Filters: class, subject, student, date; daily/weekly/monthly/custom periods.
- RPT-3 Counts, trends, charts; homework completion & outstanding; goal progress & evidence; confidence/reflection history; time since last role; reminders per attended lesson where meaningful.
- RPT-4 CSV export and printable summaries.
- RPT-5 Distinguish zero / absent / not recorded; show denominators and coverage; no invented metrics; no overall student score from reminders.
- RPT-6 Reports never exposed accidentally on classroom display (PIN-gated).

## 19. Long-term data (DAT)
- DAT-1 School years and terms; archive completed years.
- DAT-2 Move/promote students between classes preserving history (enrolment records).
- DAT-3 Deactivate accounts without corrupting records.
- DAT-4 Data export; documented backup & restore; safe schema migrations.
- DAT-5 Audit history for important edits; explicit confirmation for destructive actions.
- DAT-6 History stays understandable after renames (snapshot labels on historical records / versioned names).

## 20. Engineering & verification (ENG)
- ENG-1 Maintainable architecture, reusable components, clear module boundaries.
- ENG-2 Real persistence, authN, authZ, validation, error handling, migrations; not browser-storage-only.
- ENG-3 Tests for: new vs resumed lesson; class switching & refresh; weekly vs lesson counter boundaries; duplicate submissions & undo; Secret Student secrecy; fair rotations & absences; stable assistant schedules; grouping constraints & uneven sizes; import duplicates & uncertain OCR; attendance/homework independence; student-link isolation & revocation; protected evidence & upload validation; teacher/admin permissions & PIN locking; language & theme switching; archive & restore.
- ENG-4 Realistic layouts with 18–20 fictional students and larger edge cases; touchscreen and mobile student pages checked.
- ENG-5 Integration testing on Debian VM when credentials supplied; document what was tested and limitations honestly.
