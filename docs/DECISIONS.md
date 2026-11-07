# Decision Log

Format: `D-NNN — date — decision — rationale — status`.

- **D-001** — 2026-11-07 — Product name **Class Compass** (TR *Sınıf Pusulası*). — Friendly, fits Explorer theme, not English-specific. — Agreed by Claude; owner may rename.
- **D-002** — 2026-11-07 — Private repo `Kaan88/class-compass`, default branch `main`. — Per startup instructions. — Done, verified private.
- **D-003** — 2026-11-07 — Week boundary default: Monday 00:00 in the class's configured timezone (default Europe/Istanbul). — Matches Turkish school week; configurable. — Proposed.
- **D-004** — 2026-11-07 — Counter undo semantics: events are voided (soft, with actor+time), never hard-deleted; threshold state is derived from live (non-voided) events. Dropping below threshold clears the "reached" state; the threshold response fires again only on a new crossing, at most once per crossing, no flashing. — Accountability + predictability. — Proposed.
- **D-005** — 2026-11-07 — Stack & architecture: **"Compass Core" (SQLite)**. — See ARCHITECTURE.md. — **Agreed by owner.**
- **D-006** — 2026-11-07 — Offline scope v1: survive connection drops and page reloads with no lost/duplicated actions; full offline cold-start (service worker) deferred until tested on real classroom hardware. — Proposed.
- **D-007** — 2026-11-07 — A Secret Student marked absent is silently replaced in the same transaction; shown as "replaced (was absent)" only at reveal. — Any visible prompt would leak the identity (SEC-3). — Proposed.
- **D-008** — 2026-11-07 — One instance per school (no multi-tenant rows). — Eliminates cross-school leakage. — Proposed.
- **D-009** — 2026-11-07 — Turkish name sorting done in application code with `Intl.Collator('tr')` (SQLite option). — Proposed.
- **D-010** — 2026-11-07 — An abandoned lesson's secret selection is never revealed; it counts toward fairness but is not shown as "selected". — Proposed.
- **D-011** — 2026-11-07 — OCR runs locally (tesseract.js, Turkish + English); no external OCR service unless owner approves after explanation (IMP-7). — Proposed.

## Owner answers — 2026-11-07
- **D-012** — Classroom device: assume Chrome (evergreen Chromium; Edge also fine). Playwright tests target Chromium desktop + touch, and mobile Chrome/Safari viewports for student pages. — Agreed.
- **D-013** — Student lists usually come from **e-Okul** exports (.xls/.xlsx). Importer prioritises e-Okul layouts (header detection, "Öğrenci No", "Adı", "Soyadı" columns, Windows-1254 text); other formats still supported. — Agreed.
- **D-014** — **Student photos and audio: implemented but disabled by default** through admin global feature policy (`media.studentPhotos`, `media.evidencePhotos`, `media.evidenceAudio`, all OFF). Admin can enable later once consent/KVKK position is certain. Documents/text/links evidence remain available (admin-toggleable). When off, the UI hides the controls AND the server rejects the uploads. — Agreed.
- **D-015** — Email: teachers have email; SMTP will be configured later. Password-reset-by-email is built and enabled only when SMTP config is present; admin reset always available. — Agreed.
- **D-016** — Domain: `sareteacher.com` (exact host/subdomain decided at deployment). — Agreed.
- **D-017** — Off-site backups via restic to **Backblaze B2 and/or Cloudflare R2** (S3-compatible); repository URL and keys in server env only. — Agreed.
- **D-018** — **Deployment via Docker + Cloudflare Tunnel** (replaces Caddy/systemd design): app container binds to localhost only; `cloudflared` publishes it; TLS terminates at Cloudflare. App trusts `CF-Connecting-IP` only from the tunnel/proxy; sends `Cache-Control: no-store` on `/api` and student pages; Cloudflare automatic Web Analytics / RUM injection must be disabled for the hostname (STU-6). Data on a bind-mounted volume; backups run from a sidecar/cron inside the compose project. Docker not needed on the dev machine. — Agreed (owner prefers tunnels, has used nginx, not Caddy).
- **D-019** — Toolchain pins: Node 26 (LTS), TypeScript 6.0.x (typescript-eslint not yet compatible with TS 7), better-sqlite3 13, Drizzle 0.45, Fastify 5, Zod 4, React 19, Vite 8, Vitest 5, Playwright. Verified on Windows 2026-11-07: better-sqlite3 (SQLite 3.53.4), argon2, sharp, Turkish collation/casing all OK. — Decided by Claude.
