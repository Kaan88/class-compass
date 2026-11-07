# Engineering Conventions (read before changing code)

These patterns are established in S0/S1 and every stage must follow them. If a pattern must change, record it in DECISIONS.md and update this file.

## Runtime & tooling
- Node 26 runs TypeScript directly (type stripping). **Only erasable TS syntax**: no `enum`, no `namespace`, no constructor parameter properties. Use `as const` objects and union types.
- Relative imports include the `.ts`/`.tsx` extension. `import type` for type-only imports (`verbatimModuleSyntax`).
- `npm run check` = typecheck + lint + tests. It must be green before every commit. `npm run build` must succeed.
- Commit messages: `<stage>: <summary>` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Layout & boundaries (lint-enforced)
- `src/shared` — contracts (Zod endpoint definitions), i18n, Turkish text utils. Imports only `shared`.
- `src/domain` — pure logic (rotations, week math, grouping solver, metrics, name parsing). No I/O. Unit + property tests (`fast-check`).
- `src/server/modules/<module>/{routes,service,repo?,policy?,commands?}.ts` — register in `src/server/modules/index.ts`.
- `src/client/...` — React. Never imports server code.

## Database
- Tables in `src/server/db/schema.ts` (append a section per module). Conventions are in the file header: UUIDv7 text ids (`newId()`), epoch-ms UTC `...At`, local dates as `'YYYY-MM-DD'` text computed in the class timezone, `{en,tr}` JSON for teacher-editable labels, soft archive/void instead of delete.
- After schema changes: `npm run db:generate -- --name <stage_desc>` and commit the SQL in `drizzle/`. Never edit an already-committed migration. Check generated SQL: SQLite table rebuilds must not cascade-delete data.
- Writes that must be atomic use `tx(db, fn)` (synchronous; never `await` inside).
- Names are sorted in application code with `sortByName`/`compareNames` (never `ORDER BY name`).

## HTTP API
- Every endpoint is declared once in `src/shared/contracts/<module>.ts` with `endpoint({method, path, access, input, output})` and registered with `route(app, deps, ep, handler)`. Output schemas are allow-lists: never return rows directly when they contain fields the caller must not see.
- Access classes (`define.ts`): `public | user | account | classroom | teacher | admin | student`. Classroom-safe actions (taps, attendance, stage changes) are `classroom`; anything showing reports, private notes, roster edits, settings, links is `teacher`/`admin` (PIN-gated in classroom mode server-side).
- Resource authorisation is done in services with policy helpers (e.g. "teacher owns this teaching context", "teacher teaches in this class"). Never trust ids from the client without checking ownership. Student principals get `studentId` from the session only.
- Errors: throw `AppError(code, message, details?)`. Stable codes in `ErrorCodes`. Put a machine-readable `details.reason` (e.g. `YEAR_ARCHIVED`, `POSSIBLE_DUPLICATE`) on business conflicts and add a matching `error.<REASON>` i18n key.
- **School policy helpers** (`src/server/modules/school/policy.ts`) — reuse them, never re-implement: `assertTeachesClass(ctx, classId)` (teacher has an active context in the class), `assertOwnsContext(ctx, contextId)` (returns the context; ACC-10), `assertYearWritable(db, yearId)` / `assertClassWritable(db, cls)` before **any** write touching a class or year (archived = read-only, DAT-1), `todayFor(deps, cls)` for local dates in the class timezone. Enrolments are date-aware (D-027): use `enrolmentActiveOn(date)` (fromDate <= date < toDate) for "who is in this class on day D" — never `toDate IS NULL` alone — and `defaultEnrolmentDate(deps, cls)` for new enrolments.
- **Module gating** (`src/server/modules/school/modules.ts`): `isModuleEnabled(db, contextId, module)` / `assertModuleEnabled(...)` before serving or accepting module data; `getMediaPolicy(db)` before accepting photo/audio/document uploads (D-014, D-026). Disabled modules keep their data.
- **Students**: create via `createStudentInClass` (students service) so names are normalised, duplicates flagged and enrolments opened consistently (teacher, admin, seed, importer). Classroom endpoints return only `id, fullName, initials, avatarHue`; levels and numbers are teacher-access only (GRP-7).
- Optional services (mail) are injected through `AppDeps` (`deps.mailer`) so tests can pass fakes.
- Classroom mutations that must survive flaky Wi-Fi go through **commands** (`defineCommand` in the module's `commands.ts`, imported by its routes file so it registers). Handlers are synchronous, run inside the transaction, re-verify ownership and lesson/context consistency, and may use `meta.opId` as the id of the row they create.
- Important edits write `audit(db, ctx.actor, {...}, ctx.now())` in the same transaction (never include secrets or pre-reveal Secret Student identities).
- Time: use `ctx.now()` (injectable clock), never `Date.now()` in services.

## Client
- Data via TanStack Query + `call(endpoint, input)` from `src/client/lib/api.ts`. Sensitive queries use keys starting with `['sensitive', ...]` and are removed on lock.
- All UI strings via `useI18n().t('key')`; add keys to BOTH `src/shared/i18n/en.ts` and `tr.ts` (type-checked). Teacher-editable labels use `pickText(label, locale)`.
- Colours only via semantic CSS variables (`var(--cc-...)`); never raw hex in components. Status is never conveyed by colour alone (icon/text too). Touch targets ≥ `var(--cc-touch)`. No hover-only affordances.
- Respect `prefers-reduced-motion` and the per-class motion/sound switches; no repeated flashing.

## Tests
- Server tests use `tests/helpers.ts` (`makeEnv`, `Client`, `seedUser`, controllable `Clock`, `FakeMailer`) and `tests/school-fixture.ts` (`buildSchool`: year, subjects, 3-A/3-B, two teachers with contexts).
- `tests/server/permissions.test.ts` enumerates every registered endpoint against the access matrix; new endpoints are covered automatically — keep it green rather than adding exceptions. Test through HTTP where behaviour is user-visible; unit-test domain logic directly.
- Every requirement ID touched by a stage needs at least one test referencing it in the test name or a comment.
- Only fictional data. Synthetic Turkish/English names come from the demo seed / fixtures.
