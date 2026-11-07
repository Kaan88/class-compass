# Operations: Setup, Testing, Backup, Restore, Deployment

Status: **skeleton** — commands below are the planned design (see ARCHITECTURE.md) and will be filled in and verified as stages land. Nothing here is implemented yet.

## Development setup (planned)
1. Node LTS (exact major fixed in S0), Git.
2. `npm ci`
3. `cp .env.example .env` — set dev secrets locally (never commit `.env`).
4. `npm run db:migrate && npm run seed:demo` — creates a **fictional** demo school.
5. `npm run dev`
6. First admin: `npm run cli -- admin:create` (no web registration, no default password).

## Testing (planned)
- `npm test` — unit + integration (real SQLite, temp DB per test file).
- `npm run test:e2e` — Playwright: touchscreen, mobile student pages, PIN bypass attempts, screenshot matrix.
- CI runs both on Ubuntu and Windows.

## Data rules
- Never commit `.env`, databases, uploads, backups or real student data (enforced by `.gitignore`).
- Dev/test uses synthetic data only.

## Backup (planned)
- Hourly online snapshot of the database + uploads to `/var/lib/class-compass/<school>/backups`.
- Nightly encrypted off-site copy (restic; destination to be decided by owner).
- Weekly integrity check; admin Maintenance page warns if the last good off-site backup is >36 h old.

## Restore (planned)
- `class-compass restore <snapshot>`: stops service, verifies snapshot, swaps DB + uploads, runs migrations, health check. Rehearsed in CI.

## Deployment (planned)
- Docker container (localhost-only port) published through Cloudflare Tunnel (D-018); TLS at Cloudflare.
- `/opt/class-compass/releases/<sha>` + `current` symlink; config `/etc/class-compass/<school>.env` (mode 600); data `/var/lib/class-compass/<school>`.
- Deploy: build → snapshot DB → migrate → health check → switch symlink, auto-rollback on failure.
- **Debian test VM:** inspect first, preserve existing services, install in isolation (own user, port, dirs). Test access does not authorise production deployment.
