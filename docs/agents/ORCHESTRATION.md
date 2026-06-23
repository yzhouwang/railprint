# RailPrint — two-agent orchestration

**Steering control:** the human + the planning session. Owns `src/contract/types.ts`, the integration order, and the test gate. The two coding agents run their lanes in parallel against the frozen contract.

## Why this split (Opus 4.8 vs GPT-5.5, 2026 numbers)

| | Opus 4.8 (claude) | GPT-5.5 (codex CLI) |
|---|---|---|
| SWE-bench Pro (messy multi-file) | **69.2%** | 58.6% |
| Terminal-Bench (CLI/pipeline) | 74.6% | **82.7%** |
| Algorithmic (Codeforces/ICPC) | strong | **~1807 Elo / 12-of-12** |
| Self-honesty ("done" claims) | **~4× fewer missed flaws** | ~29% false-"done" on hard tasks |
| Long-context repo work | 1M ctx | **MRCR 74%, 1M ctx** |

→ **GPT-5.5 = deterministic geometry + projection + test harnesses** (correctness is mechanically checkable, its strength). **Opus 4.8 = app kernel + importer + all UI** (messy integration, judgment, taste, and code whose silent failure corrupts user data, where self-checking matters most).

## Lanes

- **Engine (GPT-5.5):** T1 spike · T2 stitch · T3 Shinkansen projection · T7 golden tests · T9 China corridor · T12 E2E. Lives in `pipeline/ rail-geo/ overrides/ tests/geometry/ e2e/`. → [CODEX_PLAN.md](CODEX_PLAN.md)
- **Experience + kernel (Opus 4.8):** T4 importer · T5 resolver+store · T6 map · T8 card · T10 durability · T11 trips · D1–D7 UI/design. Lives in `src/`. → [CLAUDE_PLAN.md](CLAUDE_PLAN.md)

## The one cross-lane boundary

GPT-5.5 emits **`RailGeoPackage`** (the frozen, versioned geometry artifact). Opus 4.8 consumes it through the resolver and never re-derives geometry. Everything else is intra-lane. The contract (`src/contract/types.ts`) defines this shape + the import/coverage/export types; **steering-control owns it, neither lane edits it.**

## Integration sequence

```
0. STEERING freezes src/contract/types.ts + src/design/tokens.ts        [done]
1. GPT-5.5 T2 stitch → RailGeoPackage + overrides            ── lands first
2. GPT-5.5 T3 projection/isHSR + T7 golden tests gate it ; T9 China re-run
   ── in PARALLEL ──
   Opus 4.8 builds against a STUB RailGeoPackage + stub CoverageResult:
   T5 resolver/store, D3 tokens, D1 nav, D4 states, D6 shell
3. Opus 4.8 T6 map swaps stub → real package once steps 1-2 are green ; D5 motion on T6
4. Opus 4.8 T4 importer + D2 review screen (uses T1 spike findings)
5. Opus 4.8 T8 card · T10 export (round-trips through T4) · T11 trips   ── late
6. GPT-5.5 T12 Playwright E2E over the 5 wired flows                    ── LAST
```

## Collision rules (steering enforces)

- `src/contract/types.ts` — steering only. A change = a steering bump, not a lane edit.
- Dexie schema/version — **Opus 4.8 (T5) is sole owner.** No parallel version bumps.
- MapLibre style ↔ package: Opus 4.8 style keys off `segmentId`/`isHSR`; GPT-5.5 MUST emit those exact property names.
- `src/design/tokens.ts` — Opus 4.8 (D3) owns; map + card read it, never fork.
- Export CSV columns (`EXPORT_CSV_COLUMNS`) — round-trip is sacred; both T10 and T4 are Opus 4.8, so intra-lane, but keep the column order exact.
- `vite.config` build steps (turf precompute is engine-side outputs vs font-subset D7) — coordinate plugin ordering through steering.

## The test gate is the arbiter

Anthropic flags 4.8 "reasoning about how it'll be graded"; GPT-5.5 over-claims "done." So **neither agent's self-report is trusted** — a task is done only when the golden-file suite (T7) + the relevant E2E (T12) pass. Steering runs the gate before any lane's PR merges.

## How to run each lane

- Engine: `codex` CLI in the repo, pointed at `docs/agents/CODEX_PLAN.md` (also surfaced via root `AGENTS.md`). One task/branch/PR.
- Experience: `claude` (Opus 4.8) pointed at `docs/agents/CLAUDE_PLAN.md`. One task/branch/PR.
- Both: branch per task, PR into `master`, green gate required to merge.
