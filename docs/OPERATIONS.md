# Operations: Setup, Testing, Backup, Restore, Deployment

Status: development setup, testing, demo seed and account recovery are implemented (S0–S2). Backups, restore, exports and the school-year rollover are implemented and tested (S11). The Docker image, compose file and deployment steps below are written and statically checked, but **have not been run yet**: Docker is not installed on the development machine and no VPS deployment has been done (ROADMAP S11).

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
- If only accounts exist (for example you already ran `admin:create`), it refuses unless you pass `--force-demo`: `npm run seed:demo -- --force-demo`. It never changes existing accounts and refuses if one of the demo logins is taken. Accounts and school data are written in one transaction, so a run that fails part-way leaves nothing behind and can simply be repeated (D-030).
- To start over in development, stop the server and delete the local data directory (`DATA_DIR`, default `./data`). Never do this on a server with real data.

## Account recovery
- **Admin reset (always available):** `POST /api/admin/users/:userId/reset-password` (admin screens arrive in S3) returns a temporary password **once**; the user must change it at next sign-in and all their sessions end. CLI fallback on the server: `npm run cli -- admin:reset-password --login <login>`.
- **Forgotten PIN:** an admin clears it (the teacher's sessions are ended too, D-023); the teacher signs in again and sets a new PIN.
- **Invites and email sign-in (S13b, D-108):** new accounts get a single-use invite link (7 days) by default; Accounts shows it once with Copy and a QR code and emails it when SMTP is set and the account has an address. Teachers may choose email sign-in links instead of a password (links and 6-digit codes valid 15 minutes, single use). **Without SMTP, email-link accounts cannot sign in**: Maintenance warns about them; give them a temporary password (Accounts → Reset password) or a new invite. Administrators always keep a password. `CC_TEST_MAIL_DIR` is a test-only file transport (ignored unless `NODE_ENV=test`); never set it in production.
- **Email reset (D-015):** enabled only when `SMTP_HOST` is set (`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in `.env`). The sign-in page asks `GET /api/auth/password-reset` whether to offer it. A request always answers "ok" (no account enumeration); when an active account has that email, it receives a single-use link valid for **1 hour** (`<PUBLIC_ORIGIN>/reset-password#token=…`, token in the URL fragment so it never reaches server logs). Only the newest link works; at most 3 emails per account per hour and 5 requests per IP per 15 minutes. Completing a reset ends all of the user's sessions. Unused links are voided when an admin changes the account's email, resets its password or deactivates it, and when the user changes their password (D-029). **TLS:** port 465 uses implicit TLS; any other port (default 587) must offer STARTTLS — the app refuses to send in clear text (`requireTLS`) and verifies the server certificate (TLS 1.2+). Use your provider's submission port (587 or 465); a relay without TLS will not work.
- Deactivating an account blocks sign-in and ends sessions; the account's history, assignments and audit trail remain (DAT-3). Reactivation restores access.

## Testing
- `npm run check` — typecheck + lint + unit/integration tests (real SQLite in memory, controllable clock, fake mail transport).
- `npm run build` — client bundle.
- `tests/server/permissions.test.ts` checks every registered endpoint against the access matrix (401 / 403 / 423).
- `npm run test:e2e` — Playwright (planned, S3/S4): touchscreen, mobile student pages, PIN bypass attempts, screenshot matrix.
- CI runs on Ubuntu and Windows.

## Weather (S13b, D-106)

The classroom top bar shows the current weather when Admin → School settings → Weather is on (default: Ankara, Kızılay). The server calls Open-Meteo (`WEATHER_API_URL`, default `https://api.open-meteo.com/v1/forecast`, no key) with the coordinates only, caches the answer 30 minutes (a failure 5 minutes) and gives up after 5 seconds; without internet the widget simply does not appear. The firewall must allow outbound HTTPS to `api.open-meteo.com` for it to work.

## Uploads and OCR (S9)
- Uploaded files live in `DATA_DIR/uploads` (random `xx/yy/<uuid>` keys; never serve this folder directly, files are served only by the app after a permission check). Temporary parts go to `DATA_DIR/uploads/tmp` and are removed after each request.
- Quotas: `UPLOAD_STUDENT_QUOTA_MB` (default 100) per student and `UPLOAD_GLOBAL_QUOTA_MB` (default 10240) for the server.
- OCR runs locally (D-080). The Turkish/English models come from npm packages and are copied to `DATA_DIR/ocr-cache/tessdata` on first use (SHA-256 checked); no network access is needed. `OCR_TIMEOUT_MS` (default 90000) stops a stuck recognition. Back up `uploads/`; `ocr-cache/` can be deleted at any time.
- Photos and audio stay off until an administrator turns on the media policy (D-014).

## Data rules
- Never commit `.env`, databases, uploads, backups or real student data (enforced by `.gitignore`).
- Dev/test uses synthetic data only (demo seed, test fixtures).


## Reports (S11)
- Teachers: **Teacher area → Reports** (PIN-gated in classroom mode; 423 while the classroom is locked). Only their own class+subject assignments, including ended ones and archived years. An ended assignment only covers the days the teacher held it (from its start to its end, class timezone): nothing recorded after it ended is shown. Filters: class+subject, student, period (day / week / month / term / school year / custom).
- Administrators: **Admin → Reports**: the school-wide usage report (counts per class+subject and teacher, no student data, no notes) and every class+subject report (the teacher's lesson reflection notes are left out).
- Every table has a CSV link (UTF-8 with BOM; cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading `'` so spreadsheets never run them). Each download is audited.
- Print: the browser's print dialog gives A4 pages with the school, class, subject, period and print time in the header; navigation and filters are hidden.
- RPT-5: every count says what it is out of; "not recorded", "absent" and "not in the class" are words, never 0; there is no overall score. Attendance coverage counts Monday–Friday as school days (no holiday calendar yet).

## Backups (S11, D-089)
A backup is one file `DATA_DIR/backups/cc-backup-<UTC time>.tar` (folder: `BACKUP_DIR`) holding:
- `class-compass.db`: an online copy made with SQLite's backup API (safe while the app runs);
- `uploads/…`: every uploaded file;
- `manifest.json`: format version, app version, migration level, row counts per table and the size + SHA-256 of every entry.

Commands (in the container prefix them with `docker compose exec -T app`; in development use `npm run cli --`):

| Command | What it does |
|---|---|
| `node src/server/cli.ts backup:create [--trigger timer]` | New local backup of the database **as it is** (it never applies migrations; with pending migrations it warns and backs up the older schema), then retention: newest per hour for `BACKUP_KEEP_HOURLY`=48 hours, per day for `BACKUP_KEEP_DAILY`=30 days, per month for `BACKUP_KEEP_MONTHLY`=12 months; the newest is always kept; the last 10 pre-migration snapshots are kept |
| `node src/server/cli.ts backup:list` | Local backups, newest first |
| `node src/server/cli.ts backup:verify [file]` | Checks every checksum, opens the database, runs `PRAGMA integrity_check` and compares row counts with the manifest |
| `node src/server/cli.ts backup:restore <file> [--force]` | Restore (below) |
| `node src/server/cli.ts backup:offsite [file or latest]` | Copies the backup to the restic repository, then `forget --group-by host,tags --prune` with `OFFSITE_KEEP_DAILY/WEEKLY/MONTHLY` (30/8/12); grouping by host and tag is needed because every backup file has its own name |
| `node src/server/cli.ts backup:offsite-init` | Creates the restic repository once |
| `node src/server/cli.ts backup:offsite-check [--read-data-subset 5%]` (alias `restic:check`) | `restic check`, optionally reading a share of the data |
| `node src/server/cli.ts backup:offsite-snapshots` | Lists the off-site snapshots |
| `node src/server/cli.ts version` | App version and migration level |

- Every run (local, pre-migration, verify, off-site, off-site check, restore) is recorded in the `backup_runs` table and shown on **Admin → Maintenance**: last local backup, last off-site backup (a warning when none is newer than `OFFSITE_STALE_HOURS`=36 hours), last verification, last restore, disk usage, app version and migration level. "Back up now" and "Verify the latest backup" there need the administrator's PIN and are audited.
- Admin → Maintenance tells whether off-site copies are set up from the **last recorded off-site run** ("not set up" when that run found no restic settings, "no run recorded yet" before the first one): the app container never holds the restic credentials, so it cannot check them itself.
- Only the app's start-up and the `migrate` command change the database schema. Backup commands (`backup:create`, `backup:verify`, `backup:offsite`) never do, so a backup job running another image version cannot change the schema under the running app.
- **Before every database update** the app takes a database-only snapshot `cc-premigration-<time>.tar` at start-up when migrations are pending (also the CLI `migrate`).
- **Off-site (restic, D-017).** Storage credentials live only in `deploy/restic.env` (mode 600, never committed; see `deploy/restic.env.example`) and are given only to backup runs, never to the app container. The app passes restic just the restic/B2/AWS variables plus PATH/HOME and removes credential values from any message it prints or stores.
  - Cloudflare R2: `RESTIC_REPOSITORY=s3:https://<account-id>.r2.cloudflarestorage.com/<bucket>` with `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (an R2 token limited to that bucket).
  - Backblaze B2: `RESTIC_REPOSITORY=b2:<bucket>:class-compass` with `B2_ACCOUNT_ID` / `B2_ACCOUNT_KEY` (an application key limited to that bucket).
  - `RESTIC_PASSWORD` (or `RESTIC_PASSWORD_FILE`): keep a copy away from the server, or the off-site backups cannot be read.
- **Schedules** (pick one): the host timers in `deploy/systemd/` (hourly `backup:create`, nightly 01:30 `backup:offsite latest`), or the compose `backup` sidecar (`docker compose --profile backup up -d`, `src/server/backupLoop.ts`: hourly local backup, off-site once a day at `OFFSITE_HOUR_UTC`). Weekly check, e.g. by cron: `15 3 * * 0 cd /opt/class-compass && docker compose --profile backup run --rm --no-deps --entrypoint node backup src/server/cli.ts backup:offsite-check --read-data-subset 5%`.

## Restore (S11, D-089)
`backup:restore` refuses while anything uses the database: it first tries to take SQLite's exclusive lock on the database file (every open connection, also one in another container sharing the data folder, holds a shared lock, so the restore sees a running app or backup sidecar), then asks `/healthz` and reads `DATA_DIR/server.lock` (written by the server at start, removed on a clean stop). A database in use or a live server is refused **even with `--force`**. Only a lock file it cannot check (typically left by a crash) needs `--force`, after you have made sure the service is stopped.

1. `docker compose stop app backup` (the `backup` sidecar too if used; with the systemd timers, `sudo systemctl stop class-compass-backup.timer class-compass-offsite.timer`).
2. Pick the file: `docker compose run --rm --no-deps app node src/server/cli.ts backup:list`. For an off-site copy, first `restic restore <snapshot> --target /tmp/r` on the host (with `deploy/restic.env` loaded) and copy the `.tar` into `data/backups/`.
3. `docker compose run --rm --no-deps app node src/server/cli.ts backup:restore <file>` (add `--force` only when it reports a lock file it cannot check, after a crash). The restore:
   - extracts into a temporary folder in `DATA_DIR` and verifies every checksum, the integrity check and the row counts; a corrupted or truncated backup is refused and nothing changes;
   - moves the current database and `uploads/` aside into `DATA_DIR/pre-restore-<time>/` (kept until you delete it), moves the restored files in (renames on the same disk) and puts everything back if a step fails;
   - runs the database migrations of this app version and records the restore in `backup_runs`.
4. `docker compose start app` (and `backup`, or start the timers again), then check `/healthz`, sign in and open Admin → Maintenance. When all is well, delete `data/pre-restore-<time>/`.

**Restore drill** (after the first deployment, then every term): restore the latest backup into a scratch data folder on the VM, e.g. `docker run --rm -v /opt/class-compass/data/backups:/b:ro -v /tmp/drill:/data class-compass:<tag> node src/server/cli.ts backup:restore /b/<file>`, then `backup:verify` the same file and compare the row counts it prints with Admin → Maintenance. Write the date into the school's operations log and delete `/tmp/drill`.

## Exports (S11, D-090; S13b2, D-114)
- **Admin → Maintenance → Exports → Full school export** (type `EXPORT` to confirm): a ZIP with `tables/<table>.csv` for every table (header = column names, UTF-8 with BOM, formula-safe), optionally `uploads/<storage key>` for every uploaded file, and `manifest.json` (app version, migration level, row counts, size + SHA-256 per entry, what was left out). Columns are the database columns (see `src/server/db/schema.ts`: ids are UUIDs, `…_at` are epoch milliseconds UTC, local dates are `YYYY-MM-DD`, `…_json` columns hold JSON). Never exported: sessions, sign-in attempts, one-time tokens, the command log, password/PIN/token hashes and encrypted link tokens (`token_cipher`, blanked), and Secret Student choices of rounds that were never revealed (their count is `secretStudentChoicesNotRevealed`; SEC-3 hides them from everyone, administrators included). **Private teacher notes are included** (owner decision, S13b2, D-114): `tables/private_teacher_notes.csv` with author, student, subject, text and times, and the manifest's `privateNotesIncluded` gives their count. Treat a full export as containing teachers' private notes: store and share it only as the school's data protection rules allow.
- **One student's data (KVKK access request):** Admin → Maintenance → Exports, choose the student, "Prepare export": every row that refers to the student (also the groups, group roles, lessons they were left out of as absent, assistant turns they missed and importer rows about them, which are kept as JSON lists), their uploaded files, the files on their evidence (also ones a teacher uploaded), their photo and the audit events about them. Other students' ids in those rows are blanked and group lists are cut down to the student's own group and role. Private teacher notes are not part of a per-student export (the manifest's `privateNotesNotIncluded` gives how many exist; D-114); unrevealed Secret Student choices are left out.
- An export is prepared in `DATA_DIR/exports/`, can be downloaded **once** within an hour, only by the administrator who prepared it, and is then deleted. An export nobody downloads is deleted when it expires (the server sweeps the folder at start-up and every 5 minutes). Preparing and downloading are audited.

## New school year (S11, DAT-1/2)
**Admin → Maintenance → New school year**: name and dates of the new year, then choose whether to create the classes again (grade + 1, e.g. 3-A → 4-A), keep the same teachers and subjects, move the students up on the first day of the new year, and archive the old year. "Preview" shows the classes, students and assignments and any problem. In the preview each class can be switched off (a class that ends with the year, such as a graduating final grade: it is not created again and nobody moves up from it; its students stay in the archived year) and the new names can be changed; after any change "Start the new year" waits for a new preview, and it applies exactly the plan that was previewed. "Start the new year" needs the old year's name typed and runs everything in one transaction (audited). Enrolment history is kept; archived years are read-only and their reports stay available. Students who leave are deactivated (Admin → Students); their history stays in the reports of the periods they were in the class, and labels renamed since are shown as they were then, with the current text as a hint.

## Test VM install (D-096, performed 2026-11-08)
A throwaway LAN-only DietPi VM (Docker 29.9, Compose 5.7, Debian buildx 0.13) runs an isolated test copy in `~/class-compass`. This is a test install, not production.
- Source copied with `git archive`. `docker-compose.yml` comes from the example unchanged (app on 127.0.0.1:3210 only). `app.env` (mode 600) has `NODE_ENV=production`, a pepper generated on the VM, and `PUBLIC_ORIGIN=http://localhost:3210`. `data/` is owned by uid 10001.
- **Build.** The Debian `docker-buildx` 0.13 is too old for `docker compose build` ("requires buildx 0.17.0 or later"). Build with `docker build --build-arg APP_COMMIT=<sha> -t class-compass:<tag> .`, then `APP_TAG=<tag> docker compose up -d --no-build`. On a VPS, install `docker-buildx-plugin` from Docker's own repository instead.
- **Demo data.** `seed:demo` refuses `NODE_ENV=production`, as intended. On the test VM only, run it once in a one-off container: `docker compose run --rm --no-deps -T -e NODE_ENV=development app node src/server/cli.ts seed:demo > DEMO-ACCOUNTS.txt` (mode 600; the passwords are printed once). Never do this on a real install.
- **Access.** Production cookies are `Secure`, so plain HTTP on the LAN cannot keep a sign-in. Use an SSH tunnel and open `http://localhost:3210` (browsers treat localhost as secure): `ssh -N -L 3210:127.0.0.1:3210 <user>@<vm-address>`.
- **Checks done.** Healthy container, migrations 10/10, security headers, admin sign-in, Maintenance and Reports pages. Restore drill: backup, verify, mutate (one extra admin), restore refused while the app runs even with `--force`, stop, restore, row counts equal to the backup again, the pre-restore copy kept, healthy restart, the restore shown on Maintenance.
- **Known gap.** Backup and verify runs recorded after the snapshot are rolled back by the restore, so Maintenance shows "never" for them until the next run (the file list still shows the backup). Fix planned in S13 housekeeping.

## Deployment on a VPS (S11, D-018): written, not yet performed
Docker is not installed on the development machine, so the image has not been built or run yet. Follow these steps on the VM and record the results. **Test access does not authorise a production go-live** (ROADMAP).

### 1. Prerequisites and inspection (change nothing yet)
- Debian 12 or Ubuntu 22.04+ VM, at least 2 vCPU / 2 GB RAM / 20 GB disk, outbound HTTPS, SSH with keys.
- Inspect first and write down what you find: `sudo ss -tlnp` (ports in use), `docker ps -a` and `docker compose ls` (existing containers), `systemctl list-units --type=service --state=running`, `systemctl list-timers`, `df -h`, `free -h`, `ls /opt /srv`, and whether a `cloudflared` service already runs (`systemctl status cloudflared`). Do not stop, upgrade or reconfigure anything that is already there.
- Install Docker Engine and the compose plugin from Docker's Debian/Ubuntu repository only if missing (`docker version`, `docker compose version`).

### 2. Isolated install
- User and folder: `sudo useradd --system --create-home --home-dir /opt/class-compass --shell /usr/sbin/nologin classcompass`, give it Docker access (`sudo usermod -aG docker classcompass`, or run compose via sudo), and put the code in `/opt/class-compass/app` (`git clone` of the private repository, or a release tarball).
- In `/opt/class-compass` keep `docker-compose.yml` (from `docker-compose.example.yml`, with `build.context: ./app`), `app.env`, `tunnel.env`, `deploy/restic.env` (all mode 600, owner classcompass) and `data/` owned by the image user (uid 10001): `sudo install -d -o 10001 -g 10001 -m 700 /opt/class-compass/data`.
- Pick a free local port (step 1) and set `APP_HOST_PORT` in a `.env` beside the compose file if 3210 is taken. The port is bound to 127.0.0.1 only.
- `app.env` (from `.env.example`; leave `OCR_CACHE_DIR` commented out, the compose file points it at the OCR data baked into the image): `SECRET_PEPPER` (32 random bytes, base64, generated on the VM; keep a copy in the password manager, without it sessions and student links stop working), `PUBLIC_ORIGIN=https://<subdomain>.sareteacher.com` (subdomain still to be decided), `DEFAULT_TIMEZONE=Europe/Istanbul`, SMTP settings (below), upload quotas.
- Build and start: `APP_TAG=$(git -C app rev-parse --short HEAD) docker compose build`, then `APP_TAG=<same> docker compose up -d app`; check `docker compose ps` (healthy) and `curl -fsS http://127.0.0.1:<port>/healthz`.

### 3. Cloudflare Tunnel
- In Cloudflare Zero Trust → Networks → Tunnels, create a tunnel for this VM, put its token into `tunnel.env` as `TUNNEL_TOKEN=…`, and add the public hostname `<subdomain>.sareteacher.com` → service `http://app:3210`. Then `docker compose --profile tunnel up -d cloudflared`.
- If the VM already runs cloudflared for other sites, you may instead add this hostname to that tunnel with service `http://127.0.0.1:<port>`; do not replace its existing configuration.
- For that hostname: turn **off** Web Analytics / Real User Monitoring automatic injection (it would add a script the CSP blocks and send page data to a third party); turn **off** caching (a Cache Rule "bypass cache" for the hostname; the app also sends `no-store` for private data); turn off Rocket Loader and email obfuscation; keep "Always Use HTTPS" on.
- `TRUST_PROXY=true` is set in the compose file, so rate limits and the audit log use the visitor address from the tunnel.

### 4. First administrator, mail, backups
- `docker compose exec app node src/server/cli.ts admin:create --login <login> --name "<Name>"` (the password is read from the terminal, so it does not land in shell history). Sign in at `https://<subdomain>.sareteacher.com` and set a PIN in the profile (needed for Maintenance actions).
- SMTP (optional, D-015): `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS or 465), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in `app.env`; `docker compose up -d app` applies them. Without SMTP, administrators reset passwords.
- Off-site backups: fill `deploy/restic.env`, run `docker compose --profile backup run --rm --no-deps --entrypoint node backup src/server/cli.ts backup:offsite-init` once, then install the timers: copy `app/deploy/systemd/class-compass-*` to `/etc/systemd/system/`, `sudo systemctl daemon-reload`, `sudo systemctl enable --now class-compass-backup.timer class-compass-offsite.timer` (or use the sidecar profile instead, not both). Run both services once by hand (`sudo systemctl start class-compass-backup.service class-compass-offsite.service`) and check Admin → Maintenance.
- Do the restore drill (above) before real data is entered.

### 5. Upgrade and rollback
1. `git -C app fetch` and `git -C app checkout <new tag or commit>`.
2. `docker compose exec -T app node src/server/cli.ts backup:create` (a fresh backup); note the running image tag (`docker compose images app`). Stop the backup jobs during the upgrade: `docker compose stop backup` (sidecar) or `sudo systemctl stop class-compass-backup.timer class-compass-offsite.timer`.
3. `APP_TAG=<new sha> docker compose build`, then `APP_TAG=<new sha> docker compose up -d app` (the app alone). At start-up the app takes a pre-migration snapshot and applies pending migrations; watch `docker compose logs -f app` until healthy. Only the app migrates: backup commands never do.
4. Check `/healthz`, sign in; Admin → Maintenance shows the new version and migration level. Then start the backup jobs again **with the same tag**: `APP_TAG=<new sha> docker compose --profile backup up -d backup` (or start the timers again; they run inside the app container). Keep `APP_TAG` in the `.env` beside the compose file so app and sidecar never run different versions.
5. **Rollback:** if the new version failed before migrating, start the old tag: `APP_TAG=<old sha> docker compose up -d app`. If it already migrated the database, the old code may not understand the new schema: stop the app and the backup jobs (`docker compose stop app backup`, or stop the timers), restore the `cc-premigration-<time>.tar` (or the backup from step 2) with the **old** image (`APP_TAG=<old sha> docker compose run --rm --no-deps app node src/server/cli.ts backup:restore <file>`; add `--force` only if it reports a lock file it cannot check), then start the old tag for both: `APP_TAG=<old sha> docker compose --profile backup up -d app backup` (or the app plus the timers). Data entered after the upgrade is lost by such a restore: tell the teachers.
