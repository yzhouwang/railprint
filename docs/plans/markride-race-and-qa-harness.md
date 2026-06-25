# Plan — markRide concurrency fix + map QA harness

Branch: `codex/S2-line-rank` · Scope: two code-health tasks from the codebase audit
(plus two folded-in items that turned out already-safe, kept as confirming tests).

## Problem

1. **markRide concurrent-mark race** (P0, data integrity). `markRide` (store.ts:321) reads
   the events snapshot, computes the newly-lit set, then `await`s the write. Two in-flight
   calls (a fast double-tap, or two overlapping marks) both read the **same** snapshot before
   either writes, so both persist events for the same segment → the durable ride log gets the
   segment twice under two `tripId`s. Coverage % is set-based and survives; per-event stats
   (most-ridden line, ride history) and the CSV backup-of-record bloat.

   ```
   tap①  read events(snapshot S0) ─ added = {seg} ─┐                       ┌─ putEvents(seg, tripA)
   tap②  read events(snapshot S0) ─ added = {seg} ─────(both saw empty)────┴─ putEvents(seg, tripB)
                                                                              => seg logged TWICE
   FIX: the read-dedup-write becomes ONE atomic rw transaction; tap② serializes
        behind tap①'s commit, sees seg already present, writes nothing.
   ```

2. **Map zoom-LOD is un-QA-able** (P0, dev velocity). Headless `$B` browse has no WebGL;
   the headed GPU Chromium can't be zoom-driven over CDP. Zoom-tiered LOD has shipped 3×
   this session with only manual verification. We need a real headless WebGL harness.

## Locked decisions (plan-eng-review, 2026-06-25)

- **D2 markRide fix → atomic Dexie rw-transaction.** New `db.addRideSegments(candidates)`
  does the dedup-read + insert inside one `db.transaction('rw', …)` (the idiom db.ts already
  uses for `replaceAllEvents`/`clearAll`). Re-checks `segmentId` presence **inside** the txn,
  `bulkAdd`s only genuinely-fresh rows, returns them. Also closes import-vs-mark concurrency.
- **D3 smoke depth → boot + zoom-LOD assertions.** Not boot-only. Seed a ridden line, drive
  zoom via `window.__map`, assert tier visibility.
- **D4 `window.__map` exposure → behind `?e2e=1`.** DEV-only won't exist under `vite preview`
  (Node 26 dev publicDir bug forces the prod build). A URL flag works on the preview build and
  leaves no global for normal users.
- **D5 folded-in items → add confirming tests anyway.** `export.ts:53` split and the JR
  logo-family matcher are already safe; add a malformed-segmentId export test + one more JR
  logo golden as belt-and-suspenders.

## Two-lane split

### Codex (engine + pure-logic lane · offline · gpt-5.5 xhigh fast)
Self-contained logic + tests it can verify with `vitest run` and `node pipeline/verify-jp.ts`
(no network). Files (disjoint from Claude's): `src/lib/db.ts`, `src/lib/store.ts`,
`src/lib/store.test.ts`, `src/lib/export.test.ts`, `pipeline/verify-jp.ts`.

- `db.ts`: add `addRideSegments(candidates: RideEvent[]): Promise<RideEvent[]>` — atomic
  rw-txn, in-txn dedup by `segmentId` (`where('segmentId').anyOf(ids)`), `bulkAdd` fresh,
  return fresh.
- `store.ts`: `markRide` builds candidate events, calls `addRideSegments`, and reports the
  **actually-persisted** set (so the km toast can't over-count on a race). Keep the cheap
  pre-check early-return.
- `store.test.ts`: concurrency regression — `Promise.all([markRide(X), markRide(X)])` on the
  same slice ⇒ each segment appears exactly once in `events`; added counts don't double.
- `export.test.ts`: malformed-segmentId (no `:`) → `lineNameFor` falls back without throwing.
- `verify-jp.ts`: `expectLogoToken('東海旅客鉄道', '東海道新幹線', 'Shinkansen jrc', 'Shinkansen jre')`.

### Claude (experience + browser-tooling lane · needs network for Playwright)
Files (disjoint from Codex's): `src/screens/MapView.svelte`, `playwright.config.ts`,
`tests/e2e/map-lod.spec.ts`, `package.json`.

- `MapView.svelte`: after the map `'load'` (≈:170), when `new URLSearchParams(location.search)`
  has `e2e`, set `window.__map = map` and a `window.__mapReady = true` flag; clear on unmount.
- Add `@playwright/test`; `playwright.config.ts` with a `webServer` that runs
  `npm run build && npm run preview` (prod build — dev publicDir bug) and a chromium project
  (bundled SwiftShader = headless WebGL).
- `tests/e2e/map-lod.spec.ts`: seed rideEvents into IndexedDB, navigate `/?e2e=1`, await
  `__mapReady`, then assert via `__map.setZoom` + `queryRenderedFeatures`: z4 shows only
  rank-0 (Shinkansen) + the ridden line; z12 reveals urban lines; the ridden segment stays
  visible at z4.
- `package.json`: `"test:e2e": "playwright test"`.

Commits are **sequenced** (Codex commits its files first, Claude commits second) to avoid
`index.lock` contention in the shared checkout; the file sets don't overlap.

## Test plan

| Layer | What | Runner |
|-------|------|--------|
| unit | markRide concurrency: double-mark ⇒ one event/segment | vitest (fake-indexeddb) |
| unit | export malformed-segmentId fallback | vitest |
| engine | JR-Central 東海道新幹線 logo golden + 0-violation invariant | `node pipeline/verify-jp.ts` |
| e2e | zoom-LOD tier visibility at z4 vs z12; ridden always-on | Playwright + SwiftShader |

Full suite green: `npm test` + new `npm run test:e2e`.

## NOT in scope
Rail-geo version migration (separate P0, before next data release); Web Worker package load;
feature-state ridden styling; the train-model collection feature.

## GSTACK REVIEW REPORT

| Run | Status | Findings |
|-----|--------|----------|
| Scope gate (D1) | done | User chose the wider slice (2 tasks + 2 adjacent items) |
| Step 0 scope challenge | done | 4 files for task A; 5 for task B; under the 8-file smell threshold. Folded-in items (export split, JR logo-family) found already-safe — no defect, kept only as confirming tests per D5 |
| Architecture | done | Atomic rw-txn reuses the existing db.ts transaction idiom; no new concurrency primitive. `?e2e` gate is the only design choice with a footgun (global handle) and it's flag-gated |
| Code quality | done | DRY: dedup logic centralized in `addRideSegments`, not duplicated in store. markRide returns the persisted set (explicit over clever) |
| Tests | done | Concurrency regression + malformed-input + engine golden + e2e LOD — covers the race, the folded items, and the un-QA-able LOD class |
| Performance | done | `addRideSegments` reads only candidate rows via the `segmentId` index, not the full table; e2e runs against the prod build |

VERDICT: APPROVED — two real P0s fixed with the smallest clean diff; two folded-in items
confirmed safe and pinned with tests. Two-lane split is file-disjoint with sequenced commits.

NO UNRESOLVED DECISIONS
