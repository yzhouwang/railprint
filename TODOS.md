# TODOS — RailPrint

## Deferred (captured by /plan-eng-review 2026-06-23)

### rail-geo version migrations
- **What:** A migration path for when the rail-geo dataset is re-versioned (re-stitched N02): map old→new station/segment IDs and quarantine coverage references that can't be resolved.
- **Why:** Stored coverage is a set of references to rail-geo IDs. When IDs split/merge/shift on a data-quality release, "warn on mismatch" silently changes the meaning of a user's saved rides — risking corruption of lifetime logs.
- **Pros:** Protects every user's history across data updates; makes geometry improvements safe to ship.
- **Cons:** Real work (ID-diff + quarantine UX); premature for v0 (only one rail-geo version exists at launch).
- **Context:** v0 already pins the rail-geo version in each ridelog and warns on mismatch — that buys runway. This TODO comes due **before the second rail-geo release**, not before launch. Both outside voices (Codex + Claude subagent) flagged "warn isn't enough."
- **Depends on:** rail-geo being versioned (v0), at least two published vintages.

---

_Promoted to v0 (not deferred): one China corridor (京沪高铁) through the pipeline to validate the country-agnostic schema — see docs/DESIGN.md → Implementation Tasks T9._
