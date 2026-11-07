# Operations: Setup, Testing, Backup, Restore, Deployment

Status: development setup, testing, demo seed and account recovery are implemented (S0–S2). Backup, restore and deployment are still the planned design (see ARCHITECTURE.md, D-018) and will be filled in and verified in S11.

## Development setup
1. Node 26, Git.
2. `npm ci`
3. `cp .env.example .env` — set dev secrets locally (never commit `.env`).
4. `npm run db:migrate`
5. Either create a real first admin (`npm run cli -- admin:create --login <login> --name "<Name>"`, password via stdin; no web registration, no default password — ACC-3) **or** load the demo school (below).
6. `npm run dev`

## Demo school (`npm run seed:demo`)
Creates a **fictional** school for demos and manual testing (OPS-5, ENG-4). All names are invented.

- School "Demo Primary School"; the current school year is computed from the clock (September–June, e.g. `2026–2027`) with two terms.
- Subjects English / Mathematics / Science (with Turkish names İngilizce / Matematik / Fen Bilimleri).
- Classes **3-A** (19 students), **3-B** (20), **4-C** (34, large-class edge case), **2-D** (3, tiny-class edge case).
- Students: realistic Turkish names including multi-part given names and double surnames and the letters ç ğ ı İ ö ş ü, some English names, about one in seven without a student number, some with only a full name. Generated deterministically, so every machine gets the same roster.
- Accounts: `admin` (administrator), `english` (teaches English in all four classes), `classroom3a` (teaches English, Mathematics and Science in 3-A). Emails use the reserved `demo.example` domain.
- **Passwords are random on every run and printed once** to the console. Nothing is hard-coded. If you lose them, use `npm run cli -- admin:reset-password --login <login>` or start from an empty database.

Safety rules (D-024):
- Refuses when `NODE_ENV=production`.
- Refuses when the database already contains any school data (years, subjects, classes, students).
- If only accounts exist (for example you already ran `admin:create`), it refuses unless you pass `--force-demo`: `npm run seed:demo -- --force-demo`. It never changes existing accounts and refuses if one of the demo logins is taken.
- To start over in development, stop the server and delete the local data directory (`DATA_DIR`, default `./data`). Never do this on a server with real data.

## Account recovery
- **Admin reset (always available):** `POST /api/admin/users/:userId/reset-password` (admin screens arrive in S3) returns a temporary password **once**; the user must change it at next sign-in and all their sessions end. CLI fallback on the server: `npm run cli -- admin:reset-password --login <login>`.
- **Forgotten PIN:** an admin clears it (the teacher's sessions are ended too, D-023); the teacher signs in again and sets a new PIN.
- **Email reset (D-015):** enabled only when `SMTP_HOST` is set (`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in `.env`). The sign-in page asks `GET /api/auth/password-reset` whether to offer it. A request always answers "ok" (no account enumeration); when an active account has that email, it receives a single-use link valid for **1 hour** (`<PUBLIC_ORIGIN>/reset-password#token=…`, token in the URL fragment so it never reaches server logs). Only the newest link works; at most 3 emails per account per hour and 5 requests per IP per 15 minutes. Completing a reset ends all of the user's sessions.
- Deactivating an account blocks sign-in and ends sessions; the account's history, assignments and audit trail remain (DAT-3). Reactivation restores access.

## Testing
- `npm run check` — typecheck + lint + unit/integration tests (real SQLite in memory, controllable clock, fake mail transport).
- `npm run build` — client bundle.
- `tests/server/permissions.test.ts` checks every registered endpoint against the access matrix (401 / 403 / 423).
- `npm run test:e2e` — Playwright (planned, S3/S4): touchscreen, mobile student pages, PIN bypass attempts, screenshot matrix.
- CI runs on Ubuntu and Windows.

## Data rules
- Never commit `.env`, databases, uploads, backups or real student data (enforced by `.gitignore`).
- Dev/test uses synthetic data only (demo seed, test fixtures).

## Backup (planned, S11)
- Hourly online snapshot of the database + uploads to `/var/lib/class-compass/<school>/backups`.
- Nightly encrypted off-site copy (restic; Backblaze B2 and/or Cloudflare R2, D-017).
- Weekly integrity check; admin Maintenance page warns if the last good off-site backup is >36 h old.

## Restore (planned, S11)
- `class-compass restore <snapshot>`: stops service, verifies snapshot, swaps DB + uploads, runs migrations, health check. Rehearsed in CI.

## Deployment (planned, S11)
- Docker container (localhost-only port) published through Cloudflare Tunnel (D-018); TLS at Cloudflare.
- `/opt/class-compass/releases/<sha>` + `current` symlink; config `/etc/class-compass/<school>.env` (mode 600); data `/var/lib/class-compass/<school>`.
- Deploy: build → snapshot DB → migrate → health check → switch symlink, auto-rollback on failure.
- **Debian test VM:** inspect first, preserve existing services, install in isolation (own user, port, dirs). Test access does not authorise production deployment.
