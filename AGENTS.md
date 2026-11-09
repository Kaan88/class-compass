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
| `src/shared/` | Contracts (`src/shared/contracts/`, one Zod `endpoint()` per API call), i18n (`src/shared/i18n/en.ts`, `tr.ts`), module and theme key lists, Turkish text utils, the theme package validators (`src/shared/themePackage/`). Imports only `shared`. |
| `src/domain/` | Pure logic (rotations, week maths, grouping solver, metrics). No I/O. |
| `src/server/` | Fastify app (`src/server/app.ts`), config, CLI, DB schema (`src/server/db/schema.ts`), libraries (`src/server/lib/`: http, audit, commands, crypto), one folder per module in `src/server/modules/` with its `manifest.ts`, seeds and the demo history (`src/server/seed/`), backups (`src/server/ops/`). |
| `src/client/` | React app: routes (`src/client/router.tsx`, `src/client/routes/`), modules (`src/client/modules/`), shared UI (`src/client/ui/`), themes (`src/client/themes/`), styles (`src/client/styles/app.css`), and separate entries for the student page (`src/client/student/`), the scorer app (`src/client/scorer/`) and the board (`src/client/board/`). |
| `drizzle/` | Generated SQL migrations and their journal. Never edit by hand. |
| `tests/` | Vitest: `tests/server/` (HTTP through `app.inject`), `tests/client/` (jsdom, lint rules), `tests/domain/`, `tests/docs/`, `tests/scripts/`. |
| `e2e/` | Playwright specs (`e2e/server.ts` builds and starts a throw-away server with the demo seed). |
| `scripts/` | Scaffolds (`scripts/new-module.ts`, `scripts/new-theme.ts`) and generators (`scripts/theme-docs.ts`). |
| `docs/` | Requirements, architecture, conventions, decisions, roadmap, operations, theming, stage briefs (`docs/design/`), user guides (`docs/guides/`). |
| `deploy/` | Deployment examples (no secrets). |

## Golden rules

1. **Follow `docs/CONVENTIONS.md` exactly.** It is short and every rule is there for a reason.
2. **Erasable TypeScript only** (no `enum`, `namespace`, parameter properties); relative imports end in `.ts` / `.tsx`; `import type` for types.
3. **Every endpoint is a contract** (`endpoint({ method, path, access, input, output })`) registered with `route()`. Pick the right access class; output schemas are allow-lists; check ownership in services with the policy helpers.
4. **Classroom writes go through outbox commands**; important edits write `audit()` in the same transaction; time comes from `ctx.now()`.
5. **Every string in English and Turkish** (`en.ts` and `tr.ts`, natural Turkish, not word-for-word). No literal text in JSX.
6. **Colours only as semantic tokens** (`var(--cc-*)`); never branch on a theme key; status never by colour alone; touch targets ≥ `var(--cc-touch)`; respect reduced motion and the sound switches.
7. **Privacy first.** Classroom screens show names and positive things only; levels, notes and Secret Student identities stay behind their boundaries (CONVENTIONS lists them, tests enforce them).
8. **No secrets and no real data, ever.** Never commit `.env` files, databases, uploads, backups, exports, tokens or real names. Tests, seeds, screenshots and examples use fictional people and the reserved `example.org` / `demo.example` domains.
9. **Do not present unfinished work as finished.** A placeholder is not a feature; a ROADMAP box is ticked only for what is done and tested; checks on real devices stay open until a person did them.
10. **Record decisions.** A new pattern or a changed rule gets an entry in `docs/DECISIONS.md` and, if it is a rule, in `docs/CONVENTIONS.md`.

## Commands

| Command | What |
|---|---|
| `npm ci` | Install exactly the locked dependencies. |
| `npm run check` | Typecheck + lint + all Vitest tests. Must be green before every commit. |
| `npm run build` | Build the client (must pass). |
| `npx playwright test e2e/<spec>.ts` | One end-to-end spec; `npx playwright test` runs them all (both projects). |
| `npm run dev` | Server and Vite client (needs `.env` from `.env.example`, `npm run db:migrate`, `npm run seed:demo`). |
| `npm run db:generate -- --name <stage_desc>` | Generate a migration after a schema change; commit the SQL and `drizzle/meta`. |
| `npm run new:module -- <key>` / `npm run new:theme -- <key>` | Scaffolds (`docs/EXTENDING.md`). |
| `npm run docs:theming` | Regenerate the token table and limits in `docs/THEMING.md` and `docs/theme-package.schema.json` (drift-tested). |
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

## Docs index

| Doc | Read it for |
|---|---|
| `docs/REQUIREMENTS.md` | What the school asked for (requirement IDs). |
| `docs/ARCHITECTURE.md` | Stack, code structure, permission model, data model. |
| `docs/CONVENTIONS.md` | The engineering rules (must read). |
| `docs/EXTENDING.md` | Adding a module, a theme, a language; manifest hooks; demo history generators. |
| `docs/THEMING.md` | Themes, theme packages, tokens, contrast, sound, celebrations; recipes for agents. |
| `docs/DECISIONS.md` | Why things are the way they are (D-numbers). |
| `docs/ROADMAP.md` | Stages and what is done. |
| `docs/OPERATIONS.md` | Setup, demo data, backups, deployment, test VM. |
| `docs/ASSETS.md` | Third-party assets and licences (art and sounds are original or CC0). |
| `docs/guides/` | User guides in English and Turkish (shown in the app under Help). |

## Windows notes

The main development machine runs Windows 11 with Node 26, Git Bash and PowerShell.

- In Git Bash use forward slashes and quote paths with spaces; in PowerShell 5.1 there is no `&&` (use `;` or `if ($?) { … }`).
- `.gitattributes` keeps text files LF (`* text=auto eol=lf`); do not commit CRLF changes. Generated docs are compared after normalising line endings.
- Node runs TypeScript directly (type stripping): run scripts with `node scripts/<name>.ts`; no build step for the server.
- SQLite files can be locked by a running dev server or test: stop it before deleting `data/` or `data-test/`.
- Playwright needs the Chromium build: `npx playwright install chromium` once.
- Git worktrees for parallel work live under `.claude/worktrees/` (ignored); each one needs its own `npm ci`.
