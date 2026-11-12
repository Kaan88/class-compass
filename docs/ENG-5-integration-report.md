# ENG-5 integration test report

Requirement **ENG-5**: "Integration testing on Debian VM when credentials supplied; document what was
tested and limitations honestly." Decision **D-199** (where this report lives and when it is updated).

This report is put together **only from the records in this repository** (`docs/OPERATIONS.md`,
`docs/ROADMAP.md`, `docs/DECISIONS.md`, the commit history, the e2e and visual suites). Nothing in it
was re-checked on a server while writing it, and production was not read for it. Where the records
are thin, the report says so instead of filling the gap.

**Status at the time of writing (2026-11-12):** the app has been installed and exercised on three
machines (a Debian test VM, the owner's mini PC and the owner's Oracle ARM server). The test site
`test.sareteacher.com` runs `42a6501`. Many checks that need people, real devices or outside
services are still open (section 5).

## 1. Environments actually used

| Environment | Dates | Operating system and Docker | What ran there | Status now |
|---|---|---|---|---|
| **Test VM** (D-096) | 2026-11-08 | DietPi (Debian based), Docker 29.9, Compose 5.7, Debian's buildx 0.13; LAN only, not reachable from the internet | An isolated Compose project with the fictional demo school (`seed:demo`, then `seed:demo-history`), reached through an SSH tunnel | Retired; the test site moved on |
| **Owner's mini PC** | 2026-11-09 (one day) | Not recorded in the repository: operating system, architecture and Docker version were not written down | `test.sareteacher.com` behind the owner's own Cloudflare tunnel; the S14i redeploy (`6c1c2f3`) was built here | Removed the same day on the owner's request (copy, images and route deleted) |
| **Oracle Cloud ARM server** | since 2026-11-09 | **Ubuntu 24.04, not Debian**; 2 cores, 11 GB RAM, Docker 27, buildx 0.16; shared with the owner's other services, which the app does not touch | Two stacks: `test/` (`test.sareteacher.com`, fictional demo school, shifted school-day clock) and `prod/` (`sareteacher.com`, the real school) | Test site in use for every deploy; production see section 4 |
| **Development machine** | throughout | Windows 11, Node 26; **no Docker** | `npm run check`, `npm run build`, the Playwright e2e suite, the visual baseline | Every stage |

**Debian, honestly.** ENG-5 names a Debian VM. The test VM of 2026-11-08 was Debian based (DietPi),
so the first install and the first restore drill did run on Debian. Every later integration check ran
on the Oracle server, which is **Ubuntu 24.04**. Inside the container the app always runs on the
image's base, `node:26-bookworm-slim`, which is **Debian 12 (bookworm)** (D-093). The native
modules (sharp, `node:sqlite`) and OCR were verified on Debian userland in the **ARM** image on the
Oracle server (2026-11-09). The ROADMAP records that the image was also built and run on x86 ("the
test VM, the mini PC and the Oracle server (x86 and ARM)"), but it does not say which machine was x86,
and no OCR or sharp check is recorded on an x86 image. The host side that was actually used (Docker,
cron, the host's cloudflared) ran on DietPi and Ubuntu; the systemd timers were not used (section 5).
A clean Debian 12 VPS install along OPERATIONS section "Deployment on a VPS" has not been done.

## 2. What was tested, how and with what result

### 2.1 Install and build

- **Test VM, 2026-11-08** (D-096; OPERATIONS → "Test VM install"). Source copied with `git archive`;
  `docker-compose.yml` from the example unchanged (app on localhost only); `app.env` mode 600 with
  `NODE_ENV=production` and a pepper generated on the VM; `data/` owned by uid 10001.
  - Result: Debian's buildx 0.13 is too old for `docker compose build` ("requires buildx 0.17.0 or
    later"); the image was built with `docker build --build-arg APP_COMMIT=<sha> …` and started
    with `docker compose up -d --no-build`. Recorded as a build note in OPERATIONS.
  - Healthy container, migrations 10/10, security headers present, admin sign-in, Maintenance and
    Reports pages opened.
  - Production cookies are `Secure`, so plain HTTP on the LAN cannot keep a sign-in: access went
    through an SSH tunnel to localhost (by design, not a defect).
  - `seed:demo` and `seed:demo-history` refuse `NODE_ENV=production`, as intended, and ran in a
    one-off container with the override (also checked with a production-only install,
    `npm ci --omit=dev`).
- **Mini PC, 2026-11-09.** S14i redeploy: image `class-compass:0.1.0-6c1c2f3` built there (the first
  real Docker build with the Help guides and pictures in the image), faketime image from the new tag;
  backup before the switch, pre-migration snapshot by the app, all 25 migrations applied, demo data
  kept, AI tools off, `/healthz` healthy behind Cloudflare Access (ROADMAP S14).
- **Oracle server, 2026-11-09** (commit `9729002`). Both stacks installed beside the owner's
  services; the test site moved from the mini PC with its data copied byte for byte (same checksum
  over every file) and the same clock offset. Production installed empty with its own pepper and a
  first administrator from `admin:create`.
  - Native dependencies in the ARM image: the app's OCR read a fictional Turkish class list in
    1.5 s at 92–96 % confidence, Ö ğ ı ü ş kept, one Ç read as C (the importer preview lets a teacher
    correct it); sharp and `node:sqlite` work (ROADMAP S0, commit `e62dd37`).
  - Found and fixed: the host's cloudflared resolves `localhost` to IPv6, where the apps do not
    listen; the routes use the IPv4 loopback address (OPERATIONS → "Tunnel and Access").
- **Build context and image layout** are checked on every `npm run check` by
  `tests/scripts/docker.test.ts` (the `.dockerignore` rules against `.gitignore`, the files the
  Dockerfile copies). This was added after images built before S14h1 shipped without the Help guides.

### 2.2 Upgrades and migrations on deploy

Each deploy follows OPERATIONS → "Oracle server" → "Upgrade": unpack the commit into `src-<sha>`,
`docker build`, a `backup:create` in the stack, set `APP_TAG`, `docker compose up -d --no-build app`;
the app takes a pre-migration snapshot and migrates at start-up. The procedure prescribes checks
after each deploy (`/healthz` inside the container, migration count against `drizzle/`, the log, both
addresses answering with the Cloudflare Access sign-in). The records do **not** list those checks one
by one: for each deploy they state only "healthy", with the backup and migration details shown below.

| Date | Commit | Sites | Migrations | Recorded result |
|---|---|---|---|---|
| 2026-11-09 | `6c1c2f3` (S14i) | test (mini PC) | all 25 | healthy, demo data kept |
| 2026-11-09 | `42788d4` (the image of the S15a measurements), `ba4c3e2` (admin importer), `a41fd97` (S16b) | both (`42788d4`: the records name the image, not the sites) | none recorded | healthy |
| 2026-11-09 | `4a770f2` (S16c) | both | none | backup of each before the switch, both healthy; **production stays on this commit** |
| 2026-11-11 | `d0a2cce` (S17b, S17c, S20a–d, S21) | test | none | healthy; the ssh-piped deploy script stopped after `compose exec` (it read the rest of the script as its input) and the switch was finished by hand; fixed in OPERATIONS (`</dev/null`) |
| 2026-11-11 | `53dbcc9` (S19a/b, S22a–d, S23a/b) | test | `0025`–`0028` | healthy |
| 2026-11-11 | `0efa901` (S24) | test | `0029` | backup, pre-migration snapshot, healthy |
| 2026-11-11 | `27231d1`, then `ea141bb` (S25) | test | `0030`–`0032` | backup, pre-migration snapshot, healthy |
| 2026-11-11 | `ae36c88` (D-192 `SMTP_CONNECT_HOST`) | test | none | healthy; mail check below |
| 2026-11-12 | `75a449b` (S26b, S26c, S27a–d) | test | `0033` | backup, pre-migration snapshot, healthy; student page 347.7 kB gzip |
| 2026-11-12 | `4f76f2c` (S27 guide screenshots, docs only) | test | none | backup, healthy |
| 2026-11-12 | `42a6501` (S28a lesson goal on the routine stage and summary, S28b larger word lists, S28c this report, S28 verify) | test | none | backup, healthy; student page 348.1 kB gzip |

So every migration from the baseline to `0033` has been applied on a deployed copy holding weeks of
fictional history, on top of the snapshot the app takes first. A **rollback** (OPERATIONS section 5)
has not been needed and has not been rehearsed on a server.

### 2.3 Backups and restore

- **Automated**: `tests/server/backup.test.ts` (backup, change, restore gives equal row counts and file
  hashes; corrupted and truncated backups refused; restore refused while the server runs; retention).
- **Test VM drill, 2026-11-08**: backup, verify, a change (one extra admin), restore refused while the
  app ran **even with `--force`**, stop, restore, row counts equal to the backup again, the
  pre-restore copy kept, healthy restart, the restore shown on Maintenance. Gap found: backup and
  verify runs recorded after the snapshot were rolled back by the restore; fixed in S13a (D-104).
- **Oracle server drill, 2026-11-09** (commit `e62dd37`): the test site's latest backup restored into a
  scratch folder with the deployed image and verified: 76 tables and 25,566 rows equal to the live
  database, integrity ok, checksums match. Found and fixed: the drill command mounted the backups
  read-only, which fails with `EROFS` (OPERATIONS → "Restore drill").
- **Running backups**: the owner's crontab runs `backup:create --trigger timer` hourly in each stack,
  and the owner's nightly encrypted PBS job copies the whole home folder including those files
  (OPERATIONS → "Oracle server" → "Backups"). A backup is also taken by hand before every deploy.
- Not tested: off-site copies with restic (section 5).

### 2.4 Health, security headers and access

- "Healthy" is recorded after every deploy (table above); the records do not say more than that.
- Security headers were checked on the test VM. The Access sign-in in front of the sites is set up and
  described in OPERATIONS → "Tunnel and Access"; checking it after a deploy is part of the upgrade
  procedure, but it is not recorded per deploy, and from `d0a2cce` on the deploys touched the test
  site only. The endpoint permission matrix (`tests/server/permissions.test.ts`) and the PIN lock
  (`e2e/pin-lock.spec.ts`) are covered by the automated suites, not re-run against a server.

### 2.5 Mail

- **2026-11-11, test site** (commits `ae36c88`, `61ed0cc`, `dfb12d1`): with `SMTP_CONNECT_HOST` (the mail
  server runs on the same host, D-192) and the owner's SMTP password, a test email from the test
  container reached the school domain's mailbox, Gmail and Proton (confirmed by the owner).
- **Outlook / Hotmail: not delivered** (two tests, neither reached the inbox). Outside mail goes
  through the owner's relay; what to check next is listed in OPERATIONS → "Mail check".
- Production cannot send mail yet (it needs the same two settings; only on the owner's request).

### 2.6 Super Speakers

- `seed:demo-history` (D-136) switches the module on in the demo school with one scorer link and one
  board link and fills points for every school day; the test site carries that data.
- Automated: the S12 e2e in Chromium (an admin creates links, a "phone" scorer, which is Chromium's
  Pixel 7 emulation, searches, gives +1 and undoes, the
  1920×1080 board updates live without a reload, the weekly rollover) and the board fitting checks.
- **Not checked through the real Cloudflare tunnel**: the board's live updates (Server-Sent Events) on
  `test.sareteacher.com`; scorer app installed and paired on a real iPhone and Android phone; the
  real hall screen. The separate Super Speakers hostname (OPERATIONS section 3a) is written, not
  performed.

### 2.7 AI tools (MCP)

- On the test site a second Access application covers only the paths an AI provider's servers call
  (`/mcp`, the OAuth registration, token and revoke paths, the discovery documents). On 2026-11-09 it
  first allowed only the providers' published address ranges; ChatGPT called from addresses outside
  OpenAI's list and was refused, then **connected** once the paths were open to everyone (the owner's
  decision, closed again the same evening). With a temporarily added address `/mcp` and the discovery
  document reached the app; without it they were refused (OPERATIONS → "AI tools through Access").
- Automated: `tests/server/mcp-privacy.test.ts` (every exposed string marked), `mcp-conformance`, `mcp-protocol`, `mcp-auth` and
  `oauth` tests, and the pseudonym rules of D-160 and D-161.
- **Not done**: Claude Code, claude.ai and Claude Desktop end to end against the test site, and the
  "Connect an AI app" steps followed by people (ROADMAP S16b, S19c). AI tools are off on production.

### 2.8 Offline start

- Automated only: `e2e/offline-start.spec.ts` (load, go offline, reload, start, queued, back online,
  the start reaches the server once) and the unit, client and Docker tests of S26b (D-190). The app's
  service worker is in the image deployed to the test site on 2026-11-12 (`75a449b`).
- **Not done** on the real classroom PC: an offline reload and start, and a deploy while a lesson runs.

### 2.9 Performance on the intended server

- **2026-11-09**, image `42788d4`, the S15a scripts and fictional schools on the Oracle server with the
  live sites running beside it (D-162; ROADMAP S15a): notifications list 992 → 65 ms, bell count
  483 → 22 ms, whole-year class report 315 → 181 ms (max 484 ms), five reports at once 436 → 323 ms;
  during a full export the classroom lesson state waited 1,659 → 100 ms; process memory under 370 MB;
  idle lesson state p50 19 ms, p99 38 ms.
- Not done: the notification tick watched over a real school day, and a full lesson day on the real
  classroom display.

### 2.10 Automated suites (development machine)

- `npm run check` (typecheck, lint, Vitest) and `npm run build` (with the student page size budget) are
  green before every commit; Vitest runs the server against real SQLite in memory with a controllable
  clock and a fake mail transport.
- Playwright e2e: 58 spec files, run per stage for the specs a stage touches and in full by the lead
  after each wave (the last full count written into the ROADMAP is S14i: 78 passed, 3 skipped, on
  `6c1c2f3`; later full runs are not recorded with counts).
- Visual baseline (D-189): 17 screens in two sizes against `e2e/visual-baselines/win32/`; Windows
  baselines only.
- **Chromium only.** The e2e and visual suites run in Chromium alone (D-037, `playwright.config.ts`):
  a 1920×1080 touch "classroom display" project on desktop Chrome and a Pixel 7 emulation for the
  phone tests. Safari / WebKit (the teacher's MacBook, iPads, iPhones) and Firefox have never been
  exercised by the suites.
- **Windows only since CI was paused.** GitHub Actions on Ubuntu ran the check job from S0 until the
  Actions budget ran out (D-082, 2026-11-07); the CI workflow has been off since then and stays off
  until 2026-12-01 (D-095).

### 2.11 Real devices (recorded by people, not by the suites)

- **Sound on the test site** (`6c1c2f3`, 2026-11-09): confirmed working by the owner (ROADMAP S14).
  The device and speakers are not recorded.
- **Classroom display size reading** (2026-11-10, ROADMAP S16c, D-165, commit `f9ba110`): the screen
  sample the board sends was read on production through Admin → Maintenance → Classroom screens and
  recorded: Windows, Chrome, touch screen, pixel ratio 1.25 (a 1920×1080 panel at 125 %), board window
  1536×703 with the browser bars visible; the teacher's MacBook (1440×900 CSS px) appeared the same
  morning. It was a size reading, not a functional test; it led to the 1536×703 size in the e2e set.
- **Production in classroom use since 2026-11-10** (OPERATIONS, the owner, 2026-11-11). This is the
  owner's report of real use, not a recorded check.

## 3. How to repeat the checks

The commands are in OPERATIONS and are not repeated here: "Test VM install" (build, demo data, access),
"Oracle server" → "Upgrade" (a deploy and its checks), "Restore" and "Restore drill", "Backups",
"Mail server on the same host" and "Mail check", "AI tools through Access", section 3a step 7 (the
Super Speakers hostname checks). Only fictional data is used on the test site, and tools never read or
write production.

## 4. Production

`sareteacher.com` was installed empty on 2026-11-09 behind Cloudflare Access and was deployed together
with the test site up to `4a770f2` (2026-11-09). OPERATIONS records that the English teacher has used
it in the classroom since 2026-11-10 (owner, 2026-11-11); that real use is the owner's report, not a
check made by a tool. The only reading taken from production that the records hold is the classroom
display's screen sample of 2026-11-10 (section 2.11: screen and window size, browser, touch; no
student data; commit `f9ba110`). Apart from that, **no check in this report was made on production**:
the restore drill used the test site's backup, the performance figures come from fictional schools,
and the deploy checks after `4a770f2` were made on the test site only. The ROADMAP box "Production go-live only with
explicit owner authorisation" stays open (opening the site to the school, KVKK sign-off before real
students are added).

## 5. Limitations and what was NOT tested

- **No clean Debian 12 VPS install.** The Debian-based test VM was a LAN VM; the server in use runs
  Ubuntu 24.04. The VPS steps (dedicated user under `/opt/class-compass`, the compose `cloudflared` and
  `backup` profiles, the systemd timers) are written and checked statically, not performed: the Oracle
  server uses cron and the host's own cloudflared instead.
- **Off-site backups (restic)**: never run against a real R2 or B2 repository; only the command wrapper
  and the redaction are tested, with a fake restic. Today the owner's nightly PBS backup is the only
  copy off the app's folder.
- **Restore of a real school's data**: not done (no real data was restored or read); the drills used
  fictional data. A rollback to an older image after a migration has not been rehearsed.
- **Mail**: Outlook / Hotmail delivery fails; the daily digest has not been checked in a real mailbox
  (EN, TR); production has no mail settings yet.
- **Real devices and people** (beyond the sound confirmation and the display size reading in
  section 2.11): a full lesson day on the classroom display, the touch panel tested by a person, the
  classroom speakers and the sound switches there, the iPad silent switch, the 1280×720 projector, the
  teacher's MacBook in Safari and Chrome, iPad and Android tablets, the student page on a low-end
  Android phone and an iPhone, the scorer app on real phones, the hall screen, video recording and
  upload through the tunnel, guides read by colleagues. All open in the ROADMAP ("Open points noted
  with the owner" lists them).
- **Browsers**: every automated browser check ran in Chromium (desktop Chrome and a Pixel 7
  emulation). Safari / WebKit and Firefox were never exercised by the suites.
- **Through the tunnel**: the Super Speakers board's live updates; a large video upload (Cloudflare's
  100 MB body limit is documented, not tried); the separate Super Speakers hostname.
- **Outside services**: the weather was not tried against the live Open-Meteo service from a server;
  AI providers in the assistant chat were tested with a scripted fake model (real providers need keys);
  "Sign in with ChatGPT" waits for OpenAI.
- **AI tools end to end** with Claude Code, claude.ai and Claude Desktop: not done (only ChatGPT
  connected once, on 2026-11-09).
- **CI**: Ubuntu CI ran the check job in the early stages and has been paused since about 2026-11-07
  (D-082, D-095), off until 2026-12-01. There has been no Linux run since then, the e2e suite has never
  been confirmed reliable on Ubuntu (its ROADMAP box in S3 is still open), and no Linux visual baselines exist.
- **Load**: measured with fictional schools and scripts, not with a class of real users at once.
- **The mini PC**: its operating system, architecture and Docker version were not written down.
- **x86 image**: built and run, but no OCR, sharp or `node:sqlite` check is recorded on it.
- **Security review of the deployed site** (for example an outside scan) has not been done; headers
  were checked by hand once on the test VM and by the automated tests.

## 6. Keeping this report current

Per D-199: after each deploy to the test site, add a row to the table in section 2.2 next to the
"Deployed" line in OPERATIONS, and move an item out of section 5 only when the check was really done,
with its date and commit.
