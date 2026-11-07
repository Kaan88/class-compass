# Class Compass

Classroom management for primary schools (English first, multi-subject by design).

See `docs/` for requirements, architecture, roadmap and operations.

## Quick start (development)
Node 26 and Git.

```sh
npm ci
cp .env.example .env        # local development values only; never commit .env
npm run db:migrate
npm run seed:demo           # a fictional demo school; prints random passwords once
npm run dev                 # server + Vite client
```

Instead of the demo school you can create a real first administrator:
`npm run cli -- admin:create --login <login> --name "<Name>"` (the password is read from the terminal).

`npm run check` runs typecheck, lint and all tests; `npm run build` builds the client; `npm run test:e2e` runs Playwright.

## Backups and server install
- Backups: `npm run cli -- backup:create`, `backup:verify`, `backup:restore <file>` (stop the server first), off-site copies with restic. See `docs/OPERATIONS.md`.
- Docker: `Dockerfile` and `docker-compose.example.yml` (the app on 127.0.0.1, optional Cloudflare Tunnel and backup sidecar). The VPS steps, first administrator, SMTP, off-site backups, restore drill, upgrade and rollback are in `docs/OPERATIONS.md` → "Deployment on a VPS". The image has not been built or run yet (Docker is not installed on the development machine).

## Extending
Adding a module or a theme: see `docs/EXTENDING.md` (checklists, the reports and timeline hooks, and the `npm run new:module -- <key>` / `npm run new:theme -- <key>` scaffolds). Engineering rules: `docs/CONVENTIONS.md`.
