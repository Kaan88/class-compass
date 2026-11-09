# AGENTS.md: working on Class Compass (for AI agents and new developers)

Class Compass is classroom management for primary schools: a TypeScript modular monolith (React 19 +
Vite client, Fastify 5 server, SQLite through Drizzle, Zod contracts shared by both sides) in one
repository, one database file and one uploads folder. English and Turkish everywhere. Children use it,
so privacy, accessibility and calm screens matter more than features.

Read this file first, then the docs it points to before you change code. If this file and a doc
disagree, the doc in `docs/` wins (and fix this file).

## Map

| Path | What lives there |
|---|---|
| `src/shared/` | Contracts (`src/shared/contracts/`, one Zod `endpoint()` per API call), i18n (`src/shared/i18n/en.ts`, `tr.ts`), module and theme key lists, Turkish text utils, the theme package validators (`src/shared/themePackage/`), the classroom board layout model (`src/shared/classroomLayout.ts`), notification categories (`src/shared/notifications.ts`), and the AI tool scopes and privacy marks (`src/shared/mcp.ts`). Imports only `shared`. |
| `src/domain/` | Pure logic (rotations, week maths, grouping solver, metrics, layout edits). No I/O. |
| `src/server/` | Fastify app (`src/server/app.ts`), config, CLI, DB schema (`src/server/db/schema.ts`), libraries (`src/server/lib/`: http, audit, commands, crypto, `notify.ts` for teacher notifications, `userSettings.ts` for per-account settings), one folder per module in `src/server/modules/` with its `manifest.ts`, seeds and the demo history (`src/server/seed/`), backups (`src/server/ops/`). The AI tools server (`/mcp`, personal tokens, the privacy filter, OAuth) is the module `src/server/modules/mcp/`. |
| `src/client/` | React app: routes (`src/client/router.tsx`, `src/client/routes/`), modules (`src/client/modules/`), the classroom board where module boxes go (`src/client/modules/lessons/board/`), shared UI (`src/client/ui/`, e.g. `StudentName.tsx`, `StudentDnd.tsx`), themes (`src/client/themes/`), styles (`src/client/styles/app.css`), and separate entries for the student page (`src/client/student/`) and Super Speakers: the scorer app (`src/client/scorer/`) and the points board for a hall screen (`src/client/board/`, not the classroom board). |
| `drizzle/` | Generated SQL migrations and their journal. Never edit by hand. |
| `tests/` | Vitest: `tests/server/` (HTTP through `app.inject`), `tests/client/` (jsdom, lint rules), `tests/domain/`, `tests/docs/`, `tests/scripts/`. |
| `e2e/` | Playwright specs (`e2e/server.ts` builds and starts a throw-away server with the demo seed; shared steps in `e2e/helpers.ts`). |
| `scripts/` | Scaffolds (`scripts/new-module.ts`, `scripts/new-theme.ts`), generators (`scripts/theme-docs.ts`), the student page size budget (`scripts/student-budget.ts`) and the build plugin that strips AI tool metadata from client bundles (`scripts/stripMcp.ts`). |
| `docs/` | Requirements, architecture, conventions, decisions, roadmap, operations, theming, stage briefs (`docs/design/`), user guides (`docs/guides/`), the theme package schema and a worked example (`docs/examples/ocean.theme.json`). |
| `deploy/` | Deployment examples (no secrets). |

## Golden rules

1. **Follow `docs/CONVENTIONS.md` exactly.** It is short and every rule is there for a reason.
2. **Erasable TypeScript only** (no `enum`, `namespace`, parameter properties); relative imports end in `.ts` / `.tsx`; `import type` for types.
3. **Every endpoint is a contract** (`endpoint({ method, path, access, input, output })`) registered with `route()`. Pick the right access class (CONVENTIONS lists all eleven; `teacher`, `admin` and `account` are PIN-gated in classroom mode; `mcp` takes a bearer token only and no other class accepts one); output schemas are allow-lists; check ownership in services with the school policy helpers (`src/server/modules/school/policy.ts`: `assertOwnsContext`, `assertTeachesClass`, and `assertClassWritable` / `assertYearWritable` before any write) and gate module data with `assertModuleEnabled` (school-wide modules: `isModuleAvailable`).
4. **Classroom writes go through outbox commands**; important edits write `audit()` in the same transaction; time comes from `ctx.now()`; take a user id from the actor with `actorUserId(ctx.actor)`, because an AI tool acts as `{ type: 'mcp', … }`.
5. **Every string in English and Turkish** (`en.ts` and `tr.ts`, natural Turkish, not word-for-word). No literal text in JSX.
6. **Colours only as semantic tokens** (`var(--cc-*)`); never branch on a theme key; status never by colour alone; touch targets ≥ `var(--cc-touch)`; respect reduced motion and the sound switches.
7. **Privacy first.** Classroom screens show names and positive things only (the classroom student card has no link to full statistics); levels, notes and Secret Student identities stay behind their boundaries (CONVENTIONS lists them, tests enforce them).
8. **AI tools see only what is opted in and marked.** Only a `classroom`, `teacher` or `admin` endpoint registered with `route()` can opt in, with `mcp: { scope, tool, description, readOnly, cost? }` on its contract (`scope` from `MCP_SCOPES` matching the access class; EXTENDING → "Offering a module's data to AI tools"); tools that combine endpoints are `handTool`s in `src/server/modules/mcp/tools.ts` calling `callEndpoint`. Every string in the output that could hold personal data is marked with `.meta(pii(kind))`; `tests/server/mcp-privacy.test.ts` fails otherwise. Files, notes, levels, Secret Student data, link tokens, exports, erasure, backups and credentials are never exposed. Both school switches (AI tools, student data) are off by default; while student data is off the AI sees pseudonyms. A test that switches either on switches it off in `finally`.
9. **No secrets and no real data, ever.** Never commit `.env` files, databases, uploads, backups, exports, tokens or real names. Tests, seeds, screenshots and examples use fictional people and the reserved `example.org` / `demo.example` domains. Token values never appear in a screenshot or a log.
10. **Do not present unfinished work as finished.** A placeholder is not a feature; a ROADMAP box is ticked only for what is done and tested; checks on real devices stay open until a person did them.
11. **Record decisions.** A new pattern or a changed rule gets an entry in `docs/DECISIONS.md` and, if it is a rule, in `docs/CONVENTIONS.md`.

## Where to look for common tasks

| Task | Read |
|---|---|
| A new module (server and client manifests, scaffold, checklist) | `docs/EXTENDING.md` → "Add a module" |
| A box or dock button on the classroom board | EXTENDING → client manifest `dashboardSlots`; CONVENTIONS → "Classroom board" |
| A step in Start or End Lesson | EXTENDING → `startSteps` / `endSteps` (server and client) |
| Something a teacher should be notified about | EXTENDING → `notificationSink`; CONVENTIONS → "Teacher notifications" (`notify()` from `src/server/lib/notify.ts`) |
| An item on the classroom student card | EXTENDING → `classroomCard`; CONVENTIONS → "Classroom student card" |
| A teacher page in the menu | EXTENDING → client manifest `teacherPages` (`group`, `setupTab`, `module`) |
| A report section, table or column | EXTENDING → `reports` (cells only from `src/server/modules/reports/cells.ts`: denominators, not recorded is never 0, no overall score) and the contribution's `meta` (every table `build` can return); CONVENTIONS → "Report sections and timeline" and "Report views and user settings" |
| A per-account setting | CONVENTIONS → "Report views and user settings" (`src/server/lib/userSettings.ts`) |
| A place where a student types text (with or without starters) | CONVENTIONS → "Student text" (`assertStudentText` inside `recordBlockedAttempts`, a `TEXT_KINDS` entry) and "Sentence starters" |
| Moving students between lists | CONVENTIONS → "Moving students between lists" (`StudentDnd`, never hand-made drag events) |
| Offering data to AI tools | EXTENDING → "Offering a module's data to AI tools"; CONVENTIONS → "AI tools over MCP" (OAuth rules there too) |
| A theme, theme package, sound or celebration | `docs/THEMING.md` → "For AI agents: making a package" and "Recipes for agents"; validate every package with `validateThemePackage` |
| Scorer or board endpoints (Super Speakers) | CONVENTIONS → "Super Speakers origin" (paths under `/api/scorer…` or `/api/board…`) |

## Commands

| Command | What |
|---|---|
| `npm ci` | Install exactly the locked dependencies. |
| `npm run check` | Typecheck + lint + all Vitest tests. Must be green before every commit. |
| `npm run build` | Build the client and check the student page size budget (must pass). |
| `npm run size:student` | After `npm run build`: list each file the student page loads with its gzip size (it reads `dist/client`). |
| `npx playwright test e2e/<spec>.ts` | One end-to-end spec; `npx playwright test` runs them all (both projects). |
| `npm run dev` | Server and Vite client (needs `.env` from `.env.example`, `npm run db:migrate`, `npm run seed:demo`). |
| `npm run db:generate -- --name <stage_desc>` | Generate a migration after a schema change (in a stage: only after your final rebase, Stage workflow step 4); check that SQLite table rebuilds do not cascade-delete data; commit the SQL and `drizzle/meta`. |
| `npm run new:module -- <key>` / `npm run new:theme -- <key>` | Scaffolds (`docs/EXTENDING.md`). |
| `npm run docs:theming` | Regenerate the token table and limits in `docs/THEMING.md` and `docs/theme-package.schema.json` (drift-tested). |
| `npm run docs:theme-examples` | Regenerate `docs/examples/<key>.theme.json` from the built-in themes (served to AI tools; drift-tested). |
| `npm run docs:screenshots`, `npm run usability:screens` | Guide screenshots and the usability screen crawl (separate Playwright configs). |

## Stage workflow

Work is planned as stages in `docs/ROADMAP.md`; a stage group has a brief in `docs/design/` with the
owner's decisions, the order of the stages, which stage owns which "hot" files, and pre-assigned
decision and migration numbers.

1. Read the brief section of your stage, `docs/CONVENTIONS.md`, `docs/EXTENDING.md`, `docs/ARCHITECTURE.md`, and the code you build on.
2. Stay inside your stage's scope and hot files; parallel stages run in other worktrees.
3. Implement fully with tests (requirement IDs from `docs/REQUIREMENTS.md` in test names or comments). Keep `npm run check` green and `npm run build` passing; run the e2e specs you touch or add.
4. Generate a migration only after your final rebase on `origin/main`, and accept the next free number. If `drizzle/meta` conflicts later, delete your generated files, take main's journal and snapshots, and generate again.
5. Record your decisions under your pre-assigned numbers, update the docs the change affects, tick ROADMAP boxes honestly (split a box when only part is done).
6. Commit in meaningful commits: the message starts with the stage id (`S14g: …`) and ends with the `Co-Authored-By:` line your tool's instructions give (for Claude: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Stage files with explicit paths (`git add <paths>`), never `git add -A`.
7. To push: `git fetch origin`, `git rebase origin/main` (keep both sides in `docs/DECISIONS.md`, `docs/ROADMAP.md`, `en.ts` / `tr.ts` and `app.css`), `npm run check` again if the rebase brought commits, then `git push origin HEAD:main`. Never force-push and never rewrite pushed history.

## Pitfalls that have bitten before

- **Changing a visible string, label or test id**: grep `e2e/` and `tests/` for the old text and update every use. A stale label in one spec makes a later spec wait and fail.
- **The e2e suite shares one server and database** (one worker): a test that switches a school setting on switches it back in `finally`, or later specs see the wrong state.
- **Test-only overrides** (e.g. `CC_TEST_PIN_RATE_LIMIT`, `CC_TEST_LOGIN_RATE_LIMIT` in `src/server/config.ts`) take effect only under `NODE_ENV=test`; never add one that works in production.
- **`.env` is for the Node server only.** `vite.config.ts` sets `envDir: false`, because a `NODE_ENV` read from `.env` once made `vite build` ship React's development build. Keep it that way.
- **The student page has a size budget** (`scripts/student-budget.ts`, D-151), checked by `npm run build`. Do not import teacher-only or server-only code into shared modules the student page uses; the `mcp` property on contracts is stripped from client builds, so never read it in client code.
- **Docker images contain only what `.dockerignore` lets in and the Dockerfile copies.** A file the client build or the server reads at run time (guides, docs used as AI tool resources) must be in both; `tests/scripts/docker.test.ts` checks this.

## Docs index

| Doc | Read it for |
|---|---|
| `docs/REQUIREMENTS.md` | What the school asked for (requirement IDs). |
| `docs/ARCHITECTURE.md` | Stack, code structure, permission model, data model. |
| `docs/CONVENTIONS.md` | The engineering rules (must read). |
| `docs/EXTENDING.md` | Adding a module, a theme, a language; manifest hooks; offering data to AI tools; demo history generators. |
| `docs/THEMING.md` | Themes, theme packages, tokens, contrast, sound, celebrations; recipes for agents; the AI theme tools. |
| `docs/DECISIONS.md` | Why things are the way they are (D-numbers). |
| `docs/ROADMAP.md` | Stages and what is done. |
| `docs/OPERATIONS.md` | Setup, demo data, backups, deployment, upgrade and rollback, the test VM install and the test server, the Cloudflare Access bypass for AI tools. |
| `docs/ASSETS.md` | Third-party assets and licences (art and sounds are original or CC0). |
| `docs/guides/` | User guides in English and Turkish (shown in the app under Help); `docs/guides/en/ai-tools.md` explains what leaves the school when AI tools are on. |

## Windows notes

The main development machine runs Windows 11 with Node 26, Git Bash and PowerShell.

- In Git Bash use forward slashes and quote paths with spaces; in PowerShell 5.1 there is no `&&` (use `;` or `if ($?) { … }`).
- `.gitattributes` keeps text files LF (`* text=auto eol=lf`); do not commit CRLF changes. Generated docs are compared after normalising line endings.
- Node runs TypeScript directly (type stripping): run scripts with `node scripts/<name>.ts`; no build step for the server.
- SQLite files can be locked by a running dev server or test: stop it before deleting `data/` or `data-test/`.
- Playwright needs the Chromium build: `npx playwright install chromium` once.
- Git worktrees for parallel work live under `.claude/worktrees/` (ignored); each one needs its own `npm ci`. Do not link `node_modules` between worktrees: removing a worktree can delete the linked folder.
- Docker is not installed on the development machine; images are built on the server that runs them (OPERATIONS → "Oracle server").
