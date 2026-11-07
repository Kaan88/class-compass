# Decision Log

Format: `D-NNN — date — decision — rationale — status`.

- **D-001** — 2026-11-07 — Product name **Class Compass** (TR *Sınıf Pusulası*). — Friendly, fits Explorer theme, not English-specific. — Agreed by Claude; owner may rename.
- **D-002** — 2026-11-07 — Private repo `Kaan88/class-compass`, default branch `main`. — Per startup instructions. — Done, verified private.
- **D-003** — 2026-11-07 — Week boundary default: Monday 00:00 in the class's configured timezone (default Europe/Istanbul). — Matches Turkish school week; configurable. — Proposed.
- **D-004** — 2026-11-07 — Counter undo semantics: events are voided (soft, with actor+time), never hard-deleted; threshold state is derived from live (non-voided) events. Dropping below threshold clears the "reached" state; the threshold response fires again only on a new crossing, at most once per crossing, no flashing. — Accountability + predictability. — Proposed.
- **D-005** — 2026-11-07 — Stack & architecture: "Compass Core" (SQLite) recommended vs PostgreSQL variant. — See ARCHITECTURE.md. — **Awaiting owner decision.**
- **D-006** — 2026-11-07 — Offline scope v1: survive connection drops and page reloads with no lost/duplicated actions; full offline cold-start (service worker) deferred until tested on real classroom hardware. — Proposed.
- **D-007** — 2026-11-07 — A Secret Student marked absent is silently replaced in the same transaction; shown as "replaced (was absent)" only at reveal. — Any visible prompt would leak the identity (SEC-3). — Proposed.
- **D-008** — 2026-11-07 — One instance per school (no multi-tenant rows). — Eliminates cross-school leakage. — Proposed.
- **D-009** — 2026-11-07 — Turkish name sorting done in application code with `Intl.Collator('tr')` (SQLite option). — Proposed.
- **D-010** — 2026-11-07 — An abandoned lesson's secret selection is never revealed; it counts toward fairness but is not shown as "selected". — Proposed.
- **D-011** — 2026-11-07 — OCR runs locally (tesseract.js, Turkish + English); no external OCR service unless owner approves after explanation (IMP-7). — Proposed.
