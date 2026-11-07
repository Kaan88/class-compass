# Decision Log

Format: `D-NNN — date — decision — rationale — status`.

- **D-001** — 2026-11-07 — Product name **Class Compass** (TR *Sınıf Pusulası*). — Friendly, fits Explorer theme, not English-specific. — Agreed by Claude; owner may rename.
- **D-002** — 2026-11-07 — Private repo `Kaan88/class-compass`, default branch `main`. — Per startup instructions. — Done, verified private.
- **D-003** — 2026-11-07 — Week boundary default: Monday 00:00 in the class's configured timezone (default Europe/Istanbul). — Matches Turkish school week; configurable. — Proposed.
- **D-004** — 2026-11-07 — Counter undo semantics: events are voided (soft, with actor+time), never hard-deleted; threshold state is derived from live (non-voided) events. Dropping below threshold clears the "reached" state; the threshold response fires again only on a new crossing, at most once per crossing, no flashing. — Accountability + predictability. — Proposed.
- **D-005** — 2026-11-07 — Stack & architecture. — See ARCHITECTURE.md options. — **Awaiting owner decision.**
