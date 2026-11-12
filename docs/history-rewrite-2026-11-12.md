# Commit ids before and after the history rewrite of 2026-11-12

The repository history was rewritten once, on 2026-11-12, before it was made public (D-202). Every commit got a new id. Older docs, the ENG-5 report and the server's image tags and `src-<sha>` folders still name the old ids; this table maps them. Commit messages were updated by the rewrite.

| Old | New | Commit |
|---|---|---|
| `fbacdea` | `324607b` | Initial commit: project skeleton and gitignore |
| `0e7154a` | `53125a7` | docs: add requirements and decision log |
| `2305abc` | `5fb2099` | docs: architecture proposal, roadmap checklist, operations skeleton, design review |
| `00cb74a` | `0d374b7` | S0/S1: foundations – server, auth, PIN lock, commands, audit, i18n, client shell, CI |
| `fa1d2fa` | `2471fc7` | S2: school structure, administration, students (backend, tests, demo seed) |
| `de9e1f2` | `92373f6` | S2: docs – decisions D-020..D-026, conventions, operations (demo seed, recovery), roadmap |
| `6968e31` | `9216ae5` | S2: review fixes – date-aware enrolments, reset-link invalidation, duplicate checks |
| `44a8bff` | `69b188d` | S3: UI kit, themes, app shell, PIN lock screens, offline outbox, admin and profile UI |
| `5ee6633` | `25810d2` | S3: review fixes - per-account outbox, server-enforced temporary passwords, PIN lock scree |
| `d33a2a7` | `2a56ad5` | S5: lesson lifecycle, routines and attendance backend |
| `c23fa95` | `7ee3dc0` | S5: classroom lesson UI, attendance and routine screens, e2e, docs |
| `e5eb17f` | `e19729e` | S5: review fixes - per-class flow drafts, start attendance on resume without lost updates, |
| `c9d8fc9` | `cc271c5` | S6: English reminder counter and custom counters |
| `6068a4c` | `9f70394` | S6: review fixes - no student name in the crossing toast, class reset confirmation, histor |
| `8e24165` | `6890468` | S7: Secret Students and Daily Assistant backend |
| `4b68d9e` | `1f10697` | S7: Secret Students and Daily Assistant client, teacher pages, docs |
| `d1bd665` | `c3374b3` | S7: review fixes - unpredictable secret draws, recorded assistant absences, same-day corre |
| `552d941` | `caf72d2` | SX: extensibility - module manifests, comprehensive theme registry, scaffolds |
| `fc9ed4d` | `782df30` | SX: review fixes - classroom pieces from manifests, enabled-only contributions, manifest c |
| `db9a7ad` | `dd5382a` | S8: grouping and homework |
| `385f44c` | `4fdaee6` | S8: review fixes - level word order, neutral classroom names, editable arrangements after  |
| `a2c66bf` | `72bf844` | S9: uploads pipeline, student photos and the student list importer |
| `4b796a1` | `a6faa0f` | S9: review fixes - importer headings vs names, same-name children, names outside the teach |
| `2675530` | `2ae56e9` | ci: run a single Ubuntu job per push; Windows and e2e weekly/on demand (D-082) |
| `3f7278f` | `2ce3b79` | S10: housekeeping - even spread of students without a level (solver cost), seeded grouping |
| `a394f56` | `042cb5e` | S10: goals, reflections, evidence and personal student links |
| `1aa1dd2` | `f8e1a3a` | S10: review fixes - link exchange retry and failure-only limit, student upload clean-up, w |
| `f823193` | `e1d66b1` | S11: report sections, backups/restore CLI, exports, rollover, maintenance API |
| `b3d2fd5` | `9cf8fac` | S11: reports, maintenance, exports and rollover screens |
| `59ef636` | `941d6f8` | S11: Docker, deployment steps, backup timers and S11 docs |
| `9c2510e` | `8637642` | S11: review fixes - absent cells and attendance-off totals in counter reports, goal entrie |
| `ad71953` | `2063f10` | docs: CI pause, test VM, stage order and S12/S13/user-guide roadmap entries (D-095..D-097) |
| `f2e687f` | `60e1f0c` | docs: test VM install, restore drill results and build notes (D-096) |
| `b3f3f30` | `7e438ce` | docs: S13 feedback round brief |
| `d1e79f4` | `62d5f88` | docs: owner decision - full admin export includes private teacher notes (S13b item 10) |
| `5776a19` | `3b080ef` | docs: owner requests - archivable default presets, permanent student links, picture eviden |
| `59a2c4b` | `757b3d0` | docs: S13b covers items 1-13 |
| `a506b9f` | `b68e92c` | docs: owner amendments - admin emergency link revoke/regenerate, student-page language ove |
| `27408ac` | `07ff9ac` | docs: S13c achievements and avatars brief; emergency link actions for the student's teache |
| `7e13afd` | `24e9e57` | docs: S13c character creator and student text checks (items 11-12) |
| `5c4ee23` | `c04efe8` | docs: smaller A4 link cards with readable QR (S13b item 15) |
| `9868cb9` | `432ee37` | S13a: feedback round 1 fixes, grouping redesign, class language, density, lesson topics |
| `1f59779` | `d0d2971` | S13a: review fixes |
| `bb3c9df` | `9d8b496` | S13b: sound packs and celebrations, time's-up voice, weather, quotes, invites and email-li |
| `761b0fc` | `8c5f1c9` | S13b: review fixes |
| `c5bfa74` | `7dcfdf5` | docs: S12 Super Speakers stage brief |
| `fa8fd7b` | `ba56f63` | S13b2: private notes in the full export, archivable defaults, permanent encrypted student  |
| `c12ae62` | `7394d06` | S13b2: review fixes |
| `bffa8a9` | `3813137` | seed: demo history generator for the test VM (seed:demo-history) |
| `76dc745` | `05958f0` | S13c: student achievements, avatars and student text checks |
| `9cf8ff6` | `6de6bdd` | S13c: review fixes |
| `af80c40` | `51da654` | S12: Super Speakers school-wide English points board |
| `1faeb5f` | `a8f6b97` | S12: review fixes |
| `9c04427` | `fb5bf3a` | seed: merge the demo history generator; achievements, avatars and Super Speakers generator |
| `29aa495` | `1cea8b4` | fix(counters): count a tap as pending before any await, so a refresh never rolls the bar b |
| `cd8b73b` | `51594a9` | review fixes: Super Speakers seed gives this week's points only in school hours |
| `51ed156` | `798f8b5` | docs(guides): user guides in English and Turkish with in-app Help |
| `9fde5dc` | `74bd15e` | docs(guides): review fixes |
| `1aa182f` | `c4e74af` | S13: usability screenshot crawler (npm run usability:screens) |
| `fbd1d5f` | `6f9dfa7` | usability(admin): admin PIN in Profile, stacked tables on phones, audit in words, readable |
| `058e38d` | `fdbb2b2` | usability(classroom): End lesson always in view, panels under the cards, Display popover,  |
| `44c0a26` | `dc4f442` | usability(teacher): copy links without https, phone-sized tables and navigation, side-by-s |
| `565fb29` | `75766b1` | usability(student): subject jump bar, Help in the top bar, folded homework and badges, big |
| `c49fd4e` | `1aba1f8` | usability(superSpeakers): big two- and three-way ties, undo bar and search on phones, inst |
| `ef96b4b` | `bf1811f` | usability(auth-and-help): sign-in in Turkish too, ways out of expired links, numbered guid |
| `34c67be` | `db5b803` | usability: recheck fixes |
| `b3bb46f` | `b0b6004` | docs: feedback round 2 brief and ROADMAP S14 skeleton |
| `fa9e2c1` | `58e7a80` | S14f: Super Speakers on its own origin (SPEAKERS_ORIGIN) |
| `f405b30` | `df216f3` | S14f: D-157, operator steps for a second hostname, guides EN/TR |
| `32d95fd` | `2c2d58d` | S14e1: report catalogue, sections filter, saved report views and user settings (D-153) |
| `bd3b512` | `85823ea` | S14e1: report views on the Reports page: default star, Customise tree, folding sections, d |
| `b3442f6` | `12aeef6` | S14f: review fixes (host from raw Host, queued awards, Access caveat) |
| `7face8d` | `dfe4985` | S14a: counters on by default, "achievements" wording, button groups that fit, sound unlock |
| `fda2c25` | `58d7437` | S14a: recognisable dinosaurs and mythical creatures, Turkish names (D-146) |
| `1ea9aa9` | `e91218e` | S14a: D-143 to D-147, THEMING and CONVENTIONS notes, ROADMAP boxes, sound help in the teac |
| `bdbd762` | `8d682ea` | S14e1: review fixes: safe deep-link dates, changed-view marker, full verification |
| `5392283` | `bbd5bec` | S14a: review fixes (accessories follow the dinosaur heads, default-layout gap pinned for S |
| `f2e2d24` | `6c3a56e` | S14g: theme packages: shared validators, safe SVG tree, admin Themes page, open theme keys |
| `fe40771` | `b0d9861` | S14g: AI guidelines: AGENTS.md, CLAUDE.md, generated theming guide; D-158, D-159, ROADMAP  |
| `abd04f4` | `0a61033` | S14d: student page home tiles and short steps, sentence starters |
| `5ae4e58` | `93a8625` | S14d: D-151, D-152, conventions for student screens and starters, ROADMAP boxes |
| `b63b75b` | `91433c6` | S14d: migration 0019 text_starters (D-152) |
| `a3b3eee` | `c2a3f95` | S14d: student bundle budget re-measured after the S14g rebase (460 kB total, 26 kB entry) |
| `967c1aa` | `89076e4` | S14b: classroom layout model, layout endpoints, server start steps and assistant start tic |
| `fb009af` | `2319755` | S14b: classroom board with dock and full-screen dock views, Customise layout editor, assis |
| `2872c54` | `d16d5f0` | S14b: D-148 and D-149, CONVENTIONS and EXTENDING for the board, dock and start steps, ROAD |
| `3d8b61e` | `8bd115a` | S14b: migration 0020 classroom_layouts; the layout e2e unlocks the PIN for cleanup only af |
| `5c452d8` | `faf2e05` | S14b: the layout editor belongs to one class; leaving its board closes it and relocks |
| `7a80a8b` | `367ffda` | S14g: review fixes (switched-off theme choice survives edits, opaque colours, replaced pac |
| `0154004` | `ffee8a7` | S14d: review fixes: starter check keeps real sentences, Help focus, chip focus after No, s |
| `e3a5c6d` | `85fb5e0` | S14b: review fixes (keyboard tab stop survives docking, PIN unlock relocks when the editor |
| `e9f5338` | `137f0d7` | S14 wave 2 verification: production builds locally, stale e2e label, test-only PIN limit |
| `7407503` | `97ccef3` | S14e2: classroom student card endpoint with the classroomCard manifest field, and the draw |
| `ef99c18` | `c78ffd6` | S14e2: student names open the statistics drawer in the teacher area; classroom card names  |
| `92159f0` | `e7e5481` | S14e2: D-154, conventions for student names and the classroom card, EXTENDING classroomCar |
| `0cd1952` | `b866d95` | S14c: grouping.move takes a student out of the groups (UNPLACED); save to option saves wha |
| `1bfa4b2` | `c217dc3` | S14c: drag and drop between groups in both editors (StudentDnd, D-150) |
| `6962d26` | `677452c` | S14e2: review fixes (classroom name wraps inside its button, grouping-page names tracked u |
| `e6b8f6f` | `95e4467` | S14e2: review fixes (student names on the grouping page open statistics) |
| `db34848` | `7b1bf92` | S14c: review fixes (late arrivals keep their saved group, Turkish drag label, focus after  |
| `e02d6aa` | `68a57aa` | S14e3: teacher notifications on the server (emitter, sink, digest, purge) |
| `108179b` | `a036f1f` | S14e3: teacher menu with Today and a Class setup hub, the bell and the notifications page |
| `f786a49` | `268c2e2` | S14e3: decisions D-155 and D-156, conventions, extending, operations, roadmap |
| `cad7749` | `bf11008` | S14e3: review fixes (digest counts only new items, same-device link, bell poll and PIN win |
| `79528a0` | `1ee896f` | S14e3: erase scan matches the student number only as a whole token (flaky test) |
| `9339568` | `73ecea0` | S14h1: MCP core: /mcp Streamable HTTP server, mcp access class, personal tokens, privacy g |
| `eeb5de8` | `5944be1` | S14h1: Profile and Admin AI tools pages |
| `a04a253` | `67e1bc9` | S14h1: MCP tests: protocol, auth order, privacy by registry, SDK conformance, e2e |
| `f8b5ec5` | `5a45313` | S14h1: decisions D-160 and D-161, AI tools guides, conventions, operations, roadmap |
| `5bb053f` | `8a541ad` | S14h1: tool error messages and logged names pass the privacy gate |
| `a98cfcc` | `8623ebe` | S14h1: review fixes: privacy gate by kind, token lifecycle, JSON-RPC parse errors, batch l |
| `da551e5` | `dcb14fc` | S14h2: OAuth 2.1 authorization server for AI apps (discovery, DCR, CIMD, authorize, token, |
| `44e7b59` | `54a4500` | S14h2: consent page, connected apps on Profile and Admin → AI tools |
| `5c880f2` | `34ddda0` | S14h2: D-160 OAuth part, AI tools guides, OPERATIONS, conventions, roadmap |
| `1b06ad3` | `4cd9409` | S14h2: review fixes: refresh grace for concurrent retries, lasting CIMD revoke, registrati |
| `37f86ba` | `fa42ebd` | S14i: AI tool metadata stripped from client bundles (student page 428.7 -> 426.8 kB), Dock |
| `d4d99a6` | `5e821c4` | S14i: notification Open preselects the class and the student on achievements, avatars, stu |
| `69fdab3` | `143fa11` | S14i: user guides EN and TR for S14 and new guide screenshots |
| `0f618d6` | `5103eb0` | S14i: usability crawl covers the S14 screens; fixes from its review |
| `dadfb40` | `ae7f6e4` | S14i: honest ROADMAP for the closing stage (split boxes, human reviews open), D-155 note o |
| `6c1c2f3` | `431b7dc` | S14i: review fixes |
| `7740191` | `fed7c1d` | S14i: full e2e on main and the test-server redeploy recorded |
| `8e9716d` | `beb5139` | S14i: AGENTS.md brought up to S14; OPERATIONS describes the mini PC test server |
| `35b78c4` | `15b2d4a` | S15a: cached Intl formatters and collators; the goals report groups its rows once |
| `ab4238d` | `fdfa3b3` | S15a: notifications read the teacher's access once per request; chunked purge, digest yiel |
| `d281463` | `0db3192` | S15a: the full export streams each table from a read snapshot |
| `29b928d` | `281bccc` | S15a: D-162, server size in OPERATIONS, ROADMAP section, CONVENTIONS rule |
| `fe54d25` | `b908f84` | S15a: review fixes: grouped report sections, the tick stall's cause marked unconfirmed |
| `42788d4` | `f286bea` | S14: the owner confirmed sound works on the test site |
| `9729002` | `a48edf0` | Deploy: sareteacher.com and test.sareteacher.com on the Oracle server |
| `e62dd37` | `514093f` | Oracle server checks: restore drill, S15a re-measured, OCR in the ARM image; open points n |
| `221533e` | `ebcd2ad` | ROADMAP: future idea from the owner, AI-assisted OCR for the importer |
| `85bc3d2` | `6deed83` | ROADMAP: AI-assisted OCR idea, the owner prefers a small local model on the server |
| `7cef388` | `8eba9b6` | S16a: Admin -> Import students page with the shared importer |
| `ba4c3e2` | `fd5f39d` | S16a: review fixes (admin importer starts on the first empty class; class buttons locked w |
| `5e62319` | `49cccda` | Deploy: fd5f39d (admin importer) on both sites on the Oracle server |
| `768ca83` | `6895753` | OPERATIONS: clear sign-in lockouts after moving the test clock back |
| `75c5d1d` | `1cf790a` | OPERATIONS: Access bypass for the AI tool paths on test, limited to Anthropic and OpenAI r |
| `48a55bb` | `bfe83c1` | S16b: theme authoring over MCP as complete as in the git folder |
| `a41fd97` | `123944a` | S16b: review fix: preview_theme shows the worst avatar hue for big and small initials |
| `98640db` | `68acdb7` | Deploy: 123944a (S16b) on both sites on the Oracle server |
| `fd6d18b` | `2047c90` | S16c: classroom screen size recorded for administrators (removable displayInfo module, D-1 |
| `4a770f2` | `a134ddc` | S16c: review fix: the admin guides keep the Maintenance summary heading; Classroom screens |
| `248d6a5` | `0dc201b` | Deploy: a134ddc (S16c classroom screen sizes) on both sites |
| `e3292a3` | `40177cb` | OPERATIONS: AI tool paths on test open to everyone (published IP lists blocked ChatGPT) |
| `dcfe8e0` | `27bb131` | OPERATIONS: AI tool paths on test back to the providers' IP lists |
| `f9ba110` | `d35eb0f` | S16c: real classroom display read (1536x703 window on a 1920x1080 touch panel at 125 %) |
| `22fb603` | `c48a846` | Docs: ClassDojo integration findings and recommendation (proposal, nothing built) |
| `c0817c1` | `97e5c77` | S17/S18: brief, approved mockups and ROADMAP boxes for the theme engine and full screen in |
| `292e2fd` | `d888557` | S17c: brief and ROADMAP boxes for the avatar stage (frozen defaults, readability, picture  |
| `51ecab7` | `0c4b179` | S18: full screen during lessons (Begin lesson enters, Save and end leaves, top bar button, |
| `8d07956` | `4c0a7a3` | S18: D-167, conventions, teacher and admin guides EN/TR, ROADMAP boxes |
| `3d0783c` | `5283719` | S18: review fixes: Leave full screen whenever the page is in full screen, gesture-proof te |
| `e57f96b` | `abec65e` | S17a: theme package fields scene, frame, ambient and sets (D-166) |
| `8f54e24` | `5858c9d` | S17a: scenes, frames, ambient and sets on the board and in the admin preview |
| `769613a` | `26847c5` | S17a: Snow Day example package, theming docs, e2e at the classroom display sizes |
| `5617bf2` | `c7b2e34` | Docs: AI assistant chat in the teacher area (proposal S19, nothing built) |
| `a894221` | `5784442` | S17a: review fixes: frames take no room on the board, scene shows below the grid, live red |
| `2d4c0b1` | `5ba9799` | OPERATIONS: sareteacher.com is in production; new versions go to test first, production on |
| `63b849b` | `c79b326` | S17b: brief adds engine polish from the wave 1 screenshots (piled snow, centred dock with  |
| `f974af0` | `db396a0` | S17c: freeze the generated and ready-made avatars to the v1 lists, golden tests, review sh |
| `a01554d` | `54b73cb` | S17c: readable, fair avatar faces and richer plain families (same specs, re-rendered) |
| `9663247` | `74079e2` | S17c: picture-based avatar picker and natural Turkish avatar names |
| `c3e66f8` | `44a4714` | S17c: D-169, ROADMAP, THEMING and student guide notes for the avatar stage |
| `bb49cb5` | `7fad0be` | S17b: sound styles (tones, bells, marimba, chimes, musicBox) in packages, validator, MCP t |
| `c702caf` | `dbfa99b` | S17b: built-in themes remade with scenes, frames, ambient and sets; frames drawn in CSS pi |
| `44583d5` | `0de2270` | S17c: review fixes: hats and extras edged when near body or background, tab order, "top tu |
| `636bd23` | `7c6ca03` | Routines: stage chips named by their visible text (axe label-content-name-mismatch), e2e n |
| `038c730` | `11b7f31` | S20: roadmap sweep brief (automated checks, Goals evidence, multi-class import, Turkish la |
| `fc22309` | `7cbe488` | S20b: Add evidence from each goal on the teacher Goals page; uploads checked against the c |
| `63cfb5a` | `b010390` | S20b: D-170, teacher guide note EN/TR, ROADMAP S9 evidence box ticked |
| `0813fcf` | `863485b` | S20a: e2e and axe for Reports, Admin Reports, Maintenance and the Secret Students and assi |
| `ee32d86` | `aa64def` | S20a: PIN lock bfcache and inactivity relock e2e, a 40-student class on the board at 1536x |
| `661d1c3` | `31e0b02` | S20a: ROADMAP boxes for the missing automated checks; open box for long names breaking mid |
| `4ffbb13` | `11140cc` | S20b: review fixes: full-size "Add evidence" button on goal cards, e2e checks the upload n |
| `3ed9775` | `8629a01` | S20c: HTML-table .xls student lists read as table text in the parser worker with limits; h |
| `f40f1ca` | `0e2c153` | S20c: one list with several classes split into all its classes in one preview, then a batc |
| `94fe53d` | `6007c4e` | S20c: D-171, D-079/D-163 notes, admin and teacher guides EN/TR, S9 ROADMAP boxes ticked |
| `e43217c` | `ebe4fd5` | S20d: LangFields in the routine, counter, homework, goal and grouping editors; seeded defa |
| `365e4e7` | `e8a2614` | S20d: D-172, CONVENTIONS and EXTENDING notes, teacher guide EN/TR, ROADMAP re-check audit  |
| `1e8b782` | `8bbf473` | S20c: review fixes: split lists read up to 5000 rows (refused when longer, a class over 20 |
| `5727141` | `adfc999` | S20d: review fixes: subject-wide languages in the Goals library, LangFields for own senten |
| `1f2b487` | `57ee388` | S17b: review fixes: corners clear of controls, contained preview ambient, styled notes pea |
| `507384b` | `58c02e1` | S20a: review fixes: S14i name layout for the board's own compact grid, real bfcache restor |
| `cda6093` | `6b91525` | S21b: teacher evidence uploads require the student and the class+subject (D-174) |
| `1e486b1` | `6277251` | S21b: phone top bar wraps by blocks, toasts stand above the measured dock |
| `875a924` | `00f6828` | S21b: D-174, CONVENTIONS notes, ROADMAP boxes |
| `58d5755` | `93fafe3` | S21a: theme package validator checks avatar eyes and mouths on every avatar colour and ski |
| `04395f3` | `34a0bf9` | S21a: loudness model checked against the chain rendered in Chromium (D-173) |
| `7d40d7a` | `9e7df69` | S21b: review fixes: long class names break only as a last resort, toasts fit at 320 px and |
| `459af7d` | `5f2670e` | S21a: review fixes - loudness model follows the envelopes, avatar face message in Turkish |
| `75c3ac8` | `362c76e` | S21: avatar initials contrast messages name the circles in the admin's language |
| `fec713f` | `21aac42` | S21: regenerate the EN and TR guide screenshots after S17-S21 |
| `22de415` | `8a7e2b6` | S21: class tab parts wrap whole on a phone, "more students" cue moves to the heading line |
| `2521f65` | `5c5ad7d` | S21: second visual review - theme sample tiles keep words whole, one focus ring in tabbed  |
| `d0a2cce` | `97b01b6` | S21: regenerate the EN and TR guide screenshots (moved "more students" cue, theme sample t |
| `a1b8ef8` | `d24df5f` | S21: test.sareteacher.com on 97b01b6; ssh-piped deploy scripts give compose exec </dev/nul |
| `f93a309` | `afd0bf4` | S22b: teachers rename default goal categories for their own classes (goal_category_names), |
| `3d4877e` | `b31eebf` | S22b: rename form in the Goals library, "Change my words" on the student page (lazy editor |
| `a36413d` | `14c3a21` | S22b: D-176, ROADMAP, CONVENTIONS and guides (EN, TR) |
| `761d373` | `5e66422` | S22a: undo a class reset of a counter for 10 minutes until the next tap; threshold cue onc |
| `0984453` | `3739b4d` | S22a: record D-175, tick the S6 class reset undo and threshold sound box, update the teach |
| `2996fac` | `799b0e6` | S19: owner decisions for the AI chat and connector setup (all connections, own keys by adm |
| `8e93bfa` | `bf63c7e` | S22b: review fixes: renaming a default category clears the inherited school name in the ot |
| `158b398` | `e2b2579` | S22a: review fixes: the reset Undo window starts at the confirmation, the reset closes the |
| `cfefe19` | `42963d9` | S21: every file picker is a clear button with the chosen file named (theme import, student |
| `6202d9d` | `2dff873` | S19a: assistant connections for every provider, sealed keys, limits, school default and te |
| `8c8993c` | `5254017` | S19a: D-179, CONVENTIONS, ARCHITECTURE, ROADMAP and the admin guides (EN, TR) |
| `c66b6bf` | `6a79f17` | S19a: migration for assistant connections, usage, settings and OAuth states |
| `e1c0efb` | `28e9c39` | S22d: Compact / Normal / Large in the teacher and admin areas (per-account Spacing in Prof |
| `dee20ce` | `38b2ec7` | S22d: crawl of the teacher, admin, student and Super Speakers areas before/after S17b (785 |
| `035a2ed` | `7355dc5` | S19c: "Connect an AI app" under Profile -> AI tools, admin setup checklist |
| `3afaffd` | `8166223` | S19c: D-181, ROADMAP, CONVENTIONS, AI tools and admin guides (EN, TR), screenshots |
| `2fb7f0d` | `b6dd96f` | S22d: review fixes: Spacing hint described for screen readers, honest crawl numbers, Goals |
| `9691f92` | `28b45d5` | S19a: review fixes: test results, reasoning room, own-connection switch, Gemini keys and i |
| `cc53f6a` | `3823290` | S19c: review fixes (numbered steps, ChatGPT flow, server-side host add, Turkish, Access gu |
| `6cce261` | `eea2440` | S22c: this lesson's achievements and the group number on the student cards; cards fit the  |
| `9b45556` | `80fefa6` | S22c: D-177, ROADMAP (S13 card marks and grow-into-free-height ticked, S16c 40 students at |
| `b852bf6` | `01e4960` | S22c: card mark strings as an area dictionary (student page 459.9 of 460 kB); density chec |
| `79d108c` | `7a456e1` | S22c: D-177 notes the student page size after the rebase |
| `e9f7834` | `da02485` | S19a: security review fixes (total time limit before the headers, no test of a paused or o |
| `ba27863` | `bcb76cc` | S22c: review fixes (Compact no taller than Large where cards fit, whole-word names and tou |
| `7bca61e` | `c8fcc02` | S23a: split the strings into the main dictionary (student page) and the staff dictionary |
| `cf88114` | `9531451` | S23a: D-182, ROADMAP S23a, CONVENTIONS (which dictionary), EXTENDING, ARCHITECTURE, AGENTS |
| `afbaccb` | `ae4b5aa` | S23a: e2e specs that call translate register every dictionary (button groups, guide screen |
| `2d51608` | `0a114d4` | S23a: review fixes (sound recipe, displayInfo removal steps, guide rule, module namespace  |
| `d2e0aac` | `b69f299` | S19b: assistant chat in the teacher area (server agent loop, confirmation cards, pseudonym |
| `002b2f5` | `22c2be5` | S19b: D-180, CONVENTIONS (Assistant chat, the run stream), ARCHITECTURE, teacher, admin an |
| `f52ba68` | `4ab0c03` | S19b: migration 0028_s19b_assistant_chat (assistant_chats, assistant_messages, assistant_s |
| `d63ad0e` | `feffc32` | S23b: teacher Goals -> Students is a stacked table on phones (whole-word names, every colu |
| `1180b20` | `aa368bf` | S23b: phone dock folds what does not fit behind More; card marks as small pills on the cou |
| `1604d20` | `17260ad` | S23b: D-183, ROADMAP S23b, CONVENTIONS, THEMING, teacher guides EN/TR |
| `18f7ab8` | `878ac0c` | S23b: dock strings in the staff dictionary after S23a (D-182); D-183 records the student p |
| `154952a` | `e979e40` | S23b: D-183 notes the student page size after the rebase on S19b |
| `8ee78e1` | `519ab5b` | S19b: review fixes: connection choice, run gates, withheld arguments, readable cards |
| `8501c28` | `35891bc` | S19b: review fixes: D-180, CONVENTIONS, ROADMAP and guides EN/TR |
| `92f4fea` | `b54e706` | S23b: review fixes: the phone dock fold follows its width with reduced motion; compact Mor |
| `53dbcc9` | `5c61e6b` | S23-verify: guide screenshots after S19b, S21 and S23b; Assistant and Assistant connection |
| `705728e` | `19a1e93` | OPS: record the 5c61e6b deploy to the test site (migrations 0025-0028; production unchange |
| `65d0d08` | `bdc1868` | S24: students' own avatar pictures: upload, editor, teacher check, 14-day purge (D-184) |
| `85a40c0` | `cc9a359` | S24: D-184, docs, guides EN/TR, e2e avatar-uploads spec, Docker volume check |
| `0efa901` | `cb7acf7` | S24: review fixes: approved pictures survive the evidence clean-up, nothing shown while of |
| `f8df2ac` | `9b2af7f` | OPS: record the cb7acf7 deploy to the test site (S24, migration 0029; production unchanged |
| `435f217` | `f9be7e2` | S25c: ordered level list per class+subject: ranking, table, endpoint (D-187) |
| `1c740b4` | `f78150a` | S25c: Levels tab: level list editor, picker, levels not in the list; D-187, guides EN/TR |
| `902752d` | `fc9ef10` | S25d: lesson goals per class, an opt-in module (start step, board box, End Lesson review,  |
| `8c39711` | `c2cd3ba` | S25d: D-188, conventions for opt-in modules, teacher guide EN/TR, ROADMAP |
| `8326212` | `963d971` | S25d: migration 0031 (lesson_goals) |
| `c3b8c37` | `660a6be` | S25a: readable language fields, card marks on the count's line in tight, a lesson group in |
| `8b9e997` | `0477f14` | S25a: D-185, conventions, ROADMAP boxes and section, teacher guide EN/TR |
| `f42a3b1` | `665a9cd` | S25c: review fixes: own level pickable again, case variants as one level, 20-level note, a |
| `6da149d` | `16d9da2` | S25b: school holiday calendar: closures per year, coverage and week maths without them, cl |
| `adecf9a` | `d242413` | S25b: D-186, docs, admin and teacher guides EN/TR, ROADMAP |
| `61df142` | `a7733cd` | S25b: i18n split test reads each source file once (the new area dictionary pushed it past  |
| `d59dd7e` | `1298233` | S25a: review fixes: in tight, an attendance chip (e.g. Late) goes after the marks so they  |
| `b23b5e5` | `4b8d2fa` | S25b: review fixes: "no school" in every count of a closed period or week, make-up records |
| `a6084f4` | `ae2824d` | S25d: review fixes: goal beside today's focus (no lost card row), End Lesson steps follow  |
| `27231d1` | `dd052e6` | S25-verify: assistant week views leave every closure day out (start or end of the week ali |
| `6b6d95d` | `8579eb9` | S25-verify: guide screenshots after S24 and S25: own avatar pictures, holidays, level list |
| `ea141bb` | `f2db39b` | S25-verify: ROADMAP: guide screenshot boxes of S24, S25a, S25b, S25c and S25d ticked; last |
| `9559c39` | `b614a2b` | OPS: record the S25 deploys to the test site (dd052e6 with migrations 0030-0032, then f2db |
| `c052723` | `85339a4` | S26a: pixel-diff visual baseline of 17 screens at 1536x703 and 375x812 with a fixed clock  |
| `46c1736` | `1eb53e5` | S26a: D-189, how to update and review the visual baselines, ROADMAP ticked |
| `ae36c88` | `fa904f4` | OPS: SMTP_CONNECT_HOST connects to a mail server on the same host while TLS still checks S |
| `61ed0cc` | `c9ab320` | OPS: the test site's email reaches real mailboxes (sareteacher.com, Gmail, Proton); note o |
| `dfb12d1` | `3b1ddbc` | OPS: Outlook/Hotmail not delivered through the Brevo relay; note what to check later (owne |
| `8f1e536` | `46eb881` | S27b: Add my work on each goal in My goals opens the shared evidence steps for that goal ( |
| `05b6808` | `03f6a16` | S27b: D-194, student guide EN/TR, evidence convention, ROADMAP ticked |
| `7ce6f96` | `2612ee3` | S27b: review fixes: deleting work clears the "saved with this goal" note; tests for a fore |
| `93a7cb1` | `059431d` | S27c: one automatic card size on the classroom screen; Compact / Normal / Large removed (D |
| `42da680` | `6d364d7` | S27c: D-195, CONVENTIONS, guides EN/TR without the card size, ROADMAP S27c |
| `8cb5ac9` | `35a7536` | S26b: the teacher and classroom app's own service worker (D-190) |
| `3f6135a` | `3676755` | S26b: start a lesson offline after a reload: device copy of the classroom, queued start (D |
| `02fd2b1` | `ee31c75` | S26b: D-190, conventions, guides EN/TR (what works offline) and ROADMAP |
| `66bf11e` | `abe0039` | S26b: review fixes: relock after an offline entry, a queued lesson end, guard timeout, wor |
| `ec30022` | `a3daeb6` | S26b: D-190 and D-006 after the review, conventions, guides EN/TR (ending offline, avatar  |
| `7be8a69` | `c8aadbf` | S27d: admins in the assistant chat, teacher theme drafts behind themes:draft, text-file at |
| `6533971` | `69b1308` | S27d: Markdown answers, file attach, Admin -> Assistant and "Proposed by" on Themes (D-196 |
| `60810fe` | `2ebc758` | S27d: D-196, guides EN/TR, ROADMAP, and the theme drafts e2e spec |
| `e77c2c9` | `64ed418` | S27a: video evidence: media.evidenceVideo switch, container checks, recorder, playback (D- |
| `d00c266` | `e868ac5` | S27a: D-193, guides, OPERATIONS, ROADMAP |
| `bb708a1` | `a970d9f` | S27a: the My goals test's media flags include video after the rebase on S27b |
| `eb74d6e` | `13e0201` | S26c: student page loads only the shared code it uses (368.6 -> 345.1 kB gzip) |
| `451a8a5` | `fa42d88` | S26c: add-a-language scaffold with a ready check |
| `38ddf2f` | `ee4bbf2` | S26c: D-191, EXTENDING "Add a language", CONVENTIONS, THEMING art sets, ROADMAP boxes |
| `2d628de` | `ef53ff7` | S26c: review fixes: preloaded writing screens open without "Loading…", honest size note, g |
| `4c3c5f5` | `fa6c7e0` | S26c: My goals' "Add my work" steps lazy and preloaded like the writing screens (after the |
| `177a092` | `afb3e86` | S27d: review fixes: theme files by reference, no names in link addresses, parser hang, lis |
| `b145398` | `1bac20e` | S27d: review fixes: migration 0033 for the attached .json files kept for the theme tools ( |
| `bc3ba3d` | `d1a0c0e` | S27a: review fixes: clip playback, real video limit, upload progress, video-as-audio refus |
| `ee0a64c` | `30dcc2b` | S27c: review fixes: three rows at 1536x703 (snug step), fitted names over the compact grid |
| `89352b7` | `0867ce0` | S27: verify: e2e fixes after S27c (Snow Day free space) and a scorer pairing race |
| `75a449b` | `8d11ad4` | S27: verify: guide screenshots after S26b, S26c and S27a-d |
| `6964ed2` | `c2a904c` | OPS: 8d11ad4 (S26b, S26c, S27a-d) deployed to the test site only; production unchanged |
| `41dd922` | `310088b` | S27: guide screenshots: video choices and recorder, My goals' Add my work, Admin → Assista |
| `4f76f2c` | `62ef5ff` | S27: guide screenshots: review fixes |
| `150cb0e` | `28d0480` | OPS: 62ef5ff (S27 guide screenshots) deployed to the test site only; production unchanged |
| `94b1c20` | `066a28f` | S28c: ENG-5 integration report (D-199) |
| `9aff6e1` | `e801ce7` | S28c: review fixes |
| `66f28c7` | `70401bc` | S28a: lesson goal on the Learning goal stage and the Lesson saved summary, demo history ge |
| `6e8c19e` | `681c1db` | S28a: D-197, ROADMAP, EXTENDING, CONVENTIONS and teacher guide EN/TR |
| `ed27f66` | `b763a3a` | S28b: larger word lists for the student text check from SCOWL and Zemberek-NLP |
| `99ea9b8` | `e8a2edb` | S28b: D-198, assets and licences, conventions, roadmap |
| `3716816` | `4f0c8bd` | S28a: review fixes |
| `6540be4` | `a8c52f2` | S28b: review fixes |
| `42a6501` | `c39e27f` | S28: verify: guide screenshots of the lesson goal on the Learning goal stage and the Lesso |
| `24ca0aa` | `e43e116` | OPS: c39e27f (S28) deployed to the test site only; ENG-5 report row; production unchanged |
| `32b73bf` | `2de4ec3` | S29: whole stage names and a one-line Today's focus on the classroom board |
| `92b4669` | `f18e7c0` | S29: D-200, conventions, roadmap, teacher guide EN/TR, Turkish routine-goal picture |
| `050127f` | `0f9af65` | S29: review fixes |
| `6310142` | `2597d34` | OPS: 0f9af65 (S29) deployed to the test site only; ENG-5 report row; production unchanged |
| `dfb6260` | `3d4070b` | S28b: ROADMAP: hints on student edit forms are in place since S22b (Change my words), tick |
| `466ac8f` | `37ad528` | S18: "Full screen during lessons" off by default (owner 2026-11-12, D-167) |
| `fedf9d1` | `494fb23` | S27d: assistant replies cut off by the output limit (DeepSeek theme drafts), compact chat  |
| `2ec5898` | `d4a034e` | OPS: 37ad528 and 494fb23 deployed to the test site only; ENG-5 report rows; production unc |
| `8ac3877` | `4e45f91` | S27d: Preview theme in the assistant chat, like Admin → Themes (owner 2026-11-12) |
| `12dc416` | `b718eb9` | OPS: 4e45f91 deployed to the test site only; ENG-5 rows (owner's DeepSeek theme trial); pr |
| `37b09b1` | `b8288c5` | S27d: assistant reply limit 65536 tokens, stepping down by half when a provider refuses it |
| `b03ab77` | `5112b2e` | OPS: b8288c5 deployed to the test site only; ENG-5 row; production unchanged |
| `ac08637` | `5043b73` | S27d: assistant offers the theme draft card unasked once validate_theme passes; model pick |
| `310031f` | `6130a53` | OPS: 5043b73 deployed to the test site only; ENG-5 row; production unchanged |
| `fdbcb80` | `8a9fc50` | AUDIT: avatar pictures respect archived classes; avatar_pictures and school_closures read  |
| `89e3230` | `679a1d2` | AUDIT: client-themes: relock stays pending on non-definite errors; previews in their own k |
| `5da97be` | `5a8e1fd` | AUDIT: stale offline lesson start refused; assistant carry-forward skips closure days |
| `6939f18` | `5475968` | AUDIT: assistant chat fixes (summary filter, tool names, busy before side effects, honest  |
| `bab9c28` | `66b2888` | AUDIT: AI connections: key never follows a changed address, chat time limits for thinking  |
| `97fcef8` | `86c7b2c` | AUDIT: AI connections review fixes: short limit for Test connection, blocked summary keeps |
| `85e06eb` | `0880246` | AUDIT: import fixes: refuse HTML pages past 20 tables, rowspan past 50 keeps columns, unkn |
| `0242a4f` | `55ea7d5` | AUDIT: import review fixes: rowspan keeps its real length; unused class list uploads swept |
| `3f2c80f` | `b97e12b` | AUDIT: D-201 decision, ROADMAP section, guide line for a start that reaches the server a d |
| `3856b8c` | `a27ae39` | AUDIT: review leftovers: discarded runs end their streams; no token estimate for unsent or |
| `6203e51` | `895ba46` | AUDIT: an in-stream rate-limit or key error (no HTTP status) is still estimated; only refu |
| `8141bb6` | `5a1087b` | AUDIT: D-201 and D-171 notes match the leftover fixes (spans unclamped, token estimate rul |
| `0e95596` | `e38f859` | OPS: 5a1087b (audit fixes, D-201) deployed to the test site only; ENG-5 row; production un |
| `1f88d6e` | `e3629f1` | TEST: two flaky tests fixed: test envs with their own DATA_DIR keep exports there (a paral |
| `372b854` | `c44b8c2` | OPS: production update runbook; Cloudflare country rule (managed challenge outside Turkey, |
| `6969137` | `b94c360` | OPS: Cloudflare hardening: TLS 1.2 minimum, admin Access app kept for go-live, rate limit  |
| `5f61509` | `587a5a9` | OPS: DNSSEC enabled on the zone (pending); DS record for Spaceship recorded |
| `d0e9c87` | `f4a8bc6` | OPS: DNSSEC active (DS record at Spaceship, resolvers validate) |
| `b68d17f` | `8701ed9` | OPS: before going public: off-site backups are the owner's PBS copies; home network, other |
