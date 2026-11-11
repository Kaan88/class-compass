# Roadmap sweep (2026-11-11): S20 brief

The owner asked to "finish roadmap items as you go". This stage group takes the open ROADMAP boxes that need no owner decision, no real device and no new design direction, and that do not touch the S17 theme and avatar files. Decisions D-170 to D-172; no migration expected (if one turns out to be needed, generate it only after the final rebase, Stage workflow step 4).

Not in this sweep (they need the owner, a person or a device): real-device checks, End Lesson split, opening the school, restic, the Super Speakers hostname, AI tool trials, CI. Also left: the pixel-diff screenshot baseline (screenshots stay review attachments, a deliberate choice until CI returns), lesson goals per class, the school holiday calendar, offline lesson start (needs a service worker design), the ordered level picker, the larger word list, AI-assisted OCR.

## Stages (all in parallel, separate worktrees)

| Stage | Items (ROADMAP line text) | Decision |
|---|---|---|
| **S20a** Missing automated checks | e2e + axe for Reports, Admin Reports and Maintenance; a print e2e (report print view and the student link cards if not covered); mobile viewport + axe for the Secret Students teacher pages; bfcache and inactivity relock e2e for the PIN lock; a 40-student grid check on the classroom board at 1536×703 (scale 1.25) and 1920×1080 | none (tests only) |
| **S20b** Evidence from the Goals page | "Teachers cannot add evidence for a student from the Goals page (the S9 teacher upload API exists; the page only shows evidence)" | D-170 |
| **S20c** Importer: several classes, HTML-table .xls | "One file with several classes split into all its classes in one preview (per-class counts, unknown class names)" (D-163) and "HTML-table `.xls` exports are refused" (D-079) | D-171 |
| **S20d** Turkish fields everywhere + ROADMAP audit | "`LangFields` in the other label editors (routine stages, counter labels, homework statuses, goal presets, group names); Turkish-only editors still show English fields there", "Seeded defaults written only in the main language … sample string scan of a Turkish-only display", and the "Boxes to re-check against S14 and the deployments" audit | D-172 |

### Hot files
- **S20a**: new and existing e2e specs only (plus tiny test ids if a page has no stable handle); no product behaviour changes. If a check finds a real bug, fix it only if it is small and local, otherwise list it in knownGaps and add an open ROADMAP box.
- **S20b**: the Goals teacher page and its evidence components, the existing teacher upload endpoint (reuse it; do not add a second upload path), i18n `goals.*` keys.
- **S20c**: `src/server/modules/import/**` (parsers, preview, confirm), the shared importer UI (`routes/teacher/Import.tsx`, `routes/admin/ImportAdmin.tsx`), i18n `import.*`.
- **S20d**: the label editors (routine stages, counters, homework statuses, goal presets, group names), `LangFields`, the seed defaults, i18n; ROADMAP text for the audit. Do not edit the Goals page evidence UI (S20b) beyond the goal preset editor.
- None of them touch `src/client/themes/*`, `src/shared/themePackage/*`, `src/client/ui/Frame.tsx`, the classroom dock, `src/shared/avatars.ts`, `src/client/avatars/*` or `src/client/student/AvatarPanel.tsx` (S17b/S17c).

## S20a: Missing automated checks
- Reports (teacher), Admin → Reports, Admin → Maintenance: open each with the demo seed, assert the main headings, tables and one interaction (a saved view, a filter, a tab), axe serious/critical clean, also at the mobile project.
- Print: emulate print media on a report and the student link cards; assert the print layout hides navigation and keeps the content (no blank pages: content height > 0).
- Secret Students teacher pages on the mobile project with axe.
- PIN lock: bfcache (navigate away and back: the classroom is still locked and no teacher data shows), inactivity relock (shorten the timer through an existing test-only override under `NODE_ENV=test`, or add one following the CONVENTIONS rule that it only works in test).
- A 40-student class (fictional names) on the classroom board at 1536×703 @1.25 and 1920×1080: no horizontal scroll, the "more students below" control works, cards readable (name not truncated to nothing).
- Tick the "Missing automated checks" boxes honestly (split what is left).

## S20b: Evidence from the Goals page (D-170)
- On the teacher Goals page, each student's goal/entry gets "Add evidence": document upload, and photo / audio only while the media flags allow (`media.*`), with the consent rules for photos of students unchanged. Reuse the S9 upload pipeline and the existing teacher upload endpoint (ownership via the school policy helpers, quotas, sniffing, EXIF stripping), and the existing evidence list.
- Audit as the existing upload does; module gating (`assertModuleEnabled`); PIN-gated teacher access.
- Tests: server (a teacher of another class gets 403, media flag off refuses photos, quotas), client, e2e (add a document as evidence from the Goals page and see it listed), axe. EN/TR strings, teacher guide note.

## S20c: Importer: several classes in one file, HTML-table .xls (D-171)
- A file whose rows carry a class column (e-Okul exports, admin lists) is split into **all its classes in one preview**: per-class groups with counts, class names matched to the school's classes (Turkish-aware, e.g. "3-A", "3/A", "3 A"), unknown class names flagged with a choice (skip or pick a class). Only for administrators (Admin → Import) and for teachers only for the classes they teach. Confirm writes per class with the same report, history, audit and revert per class batch as today.
- HTML-table `.xls` (an HTML file with a `.xls` name, as some systems export): parse the first table(s) safely (no script execution, no external fetches, size and cell limits, in the parser worker with the existing time limit) and feed the same preview; keep refusing anything that is neither a real workbook nor a plain HTML table.
- Tests: fixtures (fictional) for a multi-class xlsx, a multi-class CSV, an HTML-table .xls (including a hostile one with script tags and a huge table), unknown classes, teacher scope, revert per class; e2e for the admin multi-class preview. Update D-079/D-163 notes, the admin and teacher guides EN/TR.

## S20d: Turkish fields everywhere + ROADMAP audit (D-172)
- `LangFields` (with "Needs translation") in the routine stage, counter label, homework status, goal preset and group name editors, following the lesson topic editor. In a Turkish-only class the editors show only Turkish fields; English-only only English; two-language classes both (D-099).
- Seeded defaults: new classes get defaults in the main language only where both languages are not needed; a sample string scan of a Turkish-only classroom display and student page finds no English UI text (fictional demo class).
- ROADMAP audit: for each item in "Boxes to re-check against S14 and the deployments" (S8 moving a student between groups on the classroom screen and late arrivals, S13a Compact density, badges on the student cards and the size control, S0 native dependencies in Docker, S12 "through the real tunnel"), check the code, tests and OPERATIONS records; tick with a short evidence note what is done, rewrite what is partly done as a precise open box, and update the summary line. Do not tick anything that needs a person or device.
- Tests for the editors (client), e2e for a Turkish-only class editing a routine stage and a counter label, i18n.

## Verification (lead)
`npm run check`, `npm run build`, the full `npx playwright test` after the wave; ROADMAP boxes honest.
