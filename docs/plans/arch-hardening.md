# Plan: architecture hardening (post-railnet-split review, 2026-07-02)

**Branch:** `arch/hardening` off a clean `master` (see Phase 0 — the base decision is settled) · **Lane:** Opus, single lane
**Scope:** the five actionable items from the 2026-07-02 whole-repo architecture review — CI e2e guard, layering fixes, MapView decomposition, self-hosted fonts, hygiene. NOT the topology/PMTiles data split (that is the broad-China/E2 precondition, a separate program).
**Status:** engineering-reviewed. A 5-architect adversarial review (2026-07-02) returned *sound-with-fixes* on all dimensions; every fix is folded in below. The base-strategy fork was decided by the user: **merge the railnet split (PR #14) to master first, then branch off clean master.**

## Problem

The architecture is sound (event-log-as-truth + pure resolver + versioned railnet boundary — settled, do not touch), but five things will bend as the app grows. All line numbers below were verified against `split/railnet` and re-verified by the review.

1. The e2e suite is the ONLY coverage `src/screens/MapView.svelte` has, and CI never runs it — `playwright.config.ts` was written CI-aware (`forbidOnly: !!CI`, CI retries, `reuseExistingServer: !CI`) but `.github/workflows/ci.yml` only runs verify/check/test/build. CI cannot catch a map regression.
2. Pure modules import from the stateful store: `GeoIndex`/`buildGeoIndex`/`groupKeyOf` live in `store.ts`, so `search.ts`, `map/popup.ts`, `export.ts`, `wrapped/card.ts` depend on the module that owns fetch/Dexie/fallback (`popup.ts:7` is a **value** import of `groupKeyOf`, dragging the whole store graph). Also `src/fixtures/stubPackage.ts` ships in the production bundle (degraded-mode fallback, `store.ts:23`) while named like test-only code.
3. `MapView.svelte` is 1,551 lines carrying ~6 jobs. The search-marking logic has real invariants reachable only via Playwright — no unit test can touch them inline.
4. Noto Sans JP loads from Google Fonts at runtime (`index.html`): first-ever offline boot falls back to system fonts, plus a third-party origin on every cold load. `wrapped/font.ts` was deliberately built as the single seam for the swap.
5. Papercuts: README claims offline/PWA is "Deferred" (line 33) while the status paragraph says it shipped; `pmtiles` is a dead dependency (in `package.json` + `vite.config.ts` `assetsInclude`, zero imports in `src/`).

## Pre-derived facts (verified; re-verify only what you touch)

- Baseline gates on split/railnet post-`@types/node`-fix: `check` 0 errors (396 files), `test:app` **279** (25 files), `build` clean (15 precache entries), `verify:rail` ✓ 3 artifacts. Master (pre-split) still has `pipeline/`, `data/`, `tests/geometry/`, a different vite `test.include`, and no `verify:rail` — so NONE of these facts hold on bare master; they hold only AFTER PR #14 merges. This is why Phase 0 merges the split first.
- Sizes: `MapView.svelte` 1551 · `ImportScreen.svelte` 918 · `store.ts` 810 · `route.ts` 630 · `map/style.ts` 553. Of MapView's 1551: `<style>` ≈ lines 1044–1551 (~507 immovable) and template ≈ 832–1042 (~210); ~717 lines Phase 3 does not touch.
- `store.ts` geo-index block ≈ lines 46–102 (`StationGroupMember`, `GeoIndex`, `groupKeyOf`, `buildGeoIndex`; the reactive `geo` derived at :102 **calls `buildGeoIndex`** and STAYS in store).
- Store consumers and how they import it:
  - **pure, must move to `./geo-index`:** `search.ts` (types + `groupKeyOf` value), `map/popup.ts` (type + `groupKeyOf` **value** — the leak), `export.ts` (`GeoIndex` type), `wrapped/card.ts` (`GeoIndex` type; also imports `Headline` **type-only** — `Headline` is a store concept and STAYS imported from store).
  - **already type-only (fine as-is):** `import/parse.ts`, `import/crosswalk.ts` (`import type { GeoIndex }`).
  - **legitimate stateful value import (STAYS):** `import/commit.ts:23` `import * as store` → `store.addEvents`/`store.replaceEvents` (write path). Do NOT try to remove this; extracting mutations is an explicit non-goal.
- e2e harness: `MapView.svelte` ≈ :261–311 (`e2eEnabled` gated on `?e2e`, `exposeE2EHandle`/`clearE2EHandle`, sets/deletes `window.__map` + `window.__mapReady`). All 7 specs reference ONLY `window.__map`/`window.__mapReady`/`__map.fire('load')` — none import from MapView, so a faithful extraction needs ZERO spec edits.
- maplibre rule (`MapView.svelte:11`): never *statically value-import* maplibre (side-effectful WebGL). `import type { Map, Popup, MapLayerMouseEvent } from 'maplibre-gl'` is fully erased under `verbatimModuleSyntax`+`isolatedModules` (both on) and is allowed.
- The marking state (`MapView.svelte`): `entryMode, queryA/B, hitsA/B, pickedA/B, routeChoices, noRoute, searching, searchSeq` are `$state`, **bound directly in the template** (`bind`/`oninput`/`{#each}`/conditionals). `searchIndex = $derived(buildSearchIndex($geo))` at :100.
  - `searchSeq` (:97, ++'d :585, checked :587) guards ONLY `resolveInto` — the async **station-name** resolution (`await resolveQuery`, async via lazy `wanakana`).
  - the **route** search (`tryInfer`→`findRoutes`, :660–699) is NOT guarded by `searchSeq`; it uses an **object-identity** guard after the rAF yield (:677–680: `if (pickedA !== a || pickedB !== b) return`).
  - `tryInfer` branches: same-station short-circuit (:666–669, toasts + returns, sets NEITHER noRoute nor routeChoices); single-candidate auto-commit (:694–697 → `commitRoute`); multi → show picker.
  - `resetMarking` (:112–119) mutates `selectedLine, stationA, stationAName, markTrainModel, pickerCountry` (tap/train/country state, NOT being moved) and delegates the search half to `resetSearch`. `selectedLine` is shared: also cleared in `switchEntry` (:581), `onQueryA/B` (:606,611), Escape (:637). It STAYS component-owned.
- Fonts: `@fontsource/noto-sans-jp@5` emits `font-family: 'Noto Sans JP'` verbatim — exactly matches `CANVAS_FONT_FAMILY` (`font.ts:14`) and `tokens.ts:34`, so **neither file changes**. Its CSS carries 108 unicode-range subsets per weight (full CJK/kana coverage) with `font-display:swap`. Today's Google Fonts is `StaleWhileRevalidate` (NOT precache, `maxEntries:24`) so first offline boot ALREADY falls back — self-host is strictly better.
- Version-bump targets for 0.10.1.0: `package.json`, `VERSION`, `README.md:13`, `CHANGELOG.md` (all currently 0.10.0.1).

## Hard constraints (apply to every phase)

- Do NOT touch: `public/rail/**`, `src/contract/rail-package.ts` (railnet-owned, synced — new code imports app-owned `src/contract/types.ts` instead), `scripts/sync-railnet.mjs`, `railnet.json`, the ID/migration scheme, the resolver contract.
- **Kill the stale preview server before every local `npm run test:e2e`.** `reuseExistingServer:!CI` silently reuses an old build on :4173 → false-green. Executable pre-step: `lsof -ti:4173 | xargs kill -9 2>/dev/null; true`.
- Never edit an e2e spec to make a refactor pass — the specs are the behavioral baseline. If one fails, the refactor is wrong.
- Never reduce a test count; Phase 3 must add tests.
- Conventional-commit messages matching `git log`; match the codebase's narrative comment density.
- Run the full gate set after every phase before committing: `lsof -ti:4173|xargs kill -9 2>/dev/null; true` → `npm run verify:rail` → `npm run check` → `npm run test:app` → `npm run build` → `npm run test:e2e`.

## Phase 0 — land the split, then branch (base decision: settled)

State of the world: PR #13 (durability) merged to master; PR #14 (the railnet split, `split/railnet`) open with a **stale base** (`feat/rail-geo-durable-package`, itself already merged). Master does NOT yet contain the split. Decision: merge the split to master first.

1. Make PR #14 green: it failed CI because `@types/node` was undeclared (test fixtures use `node:fs`) — **fixed** on split/railnet (`613d758`). Confirm the app job is green.
2. `gh pr edit 14 --base master` (retarget off the dead branch — verified a clean 3-commit diff; `split/railnet` merges into master with zero conflicts).
3. Merge PR #14 to master (only once its CI is green).
4. `git fetch origin`; branch `arch/hardening` off `origin/master`. The uncommitted `docs/plans/arch-hardening.md` (this file, revised) carries over untracked — commit it as arch/hardening's first commit.
5. Record the green baseline (279 / 16 e2e / check 0 / build clean). If not green, stop and report.

## Phase 1 — CI guard (do FIRST; open a draft PR right after)

- `.github/workflows/ci.yml`: add `cache: 'npm'` to the existing `app` job's setup-node.
- Add a parallel `e2e` job: checkout → setup-node (24, npm cache) → `npm ci` → `npx playwright install chromium --with-deps` → `npm run test:e2e`. Playwright's `webServer` handles build+preview; SwiftShader flags are already in the config and work on ubuntu runners.
- **Open a draft PR (`arch/hardening` → `master`) immediately after this commit** so every subsequent phase's push triggers the e2e job — the MapView refactor then gets per-phase CI signal instead of only at ship (ci.yml triggers on `pull_request`).
- **Accept:** both jobs green on the draft PR; the `app` job behavior unchanged.

## Phase 2 — layering (mechanical, zero behavior change; up to 2 commits)

**2a. Extract `src/lib/geo-index.ts`.** Move `StationGroupMember`, `GeoIndex`, `groupKeyOf`, `buildGeoIndex` out of `store.ts`. Because `store.ts:102` calls `buildGeoIndex` for the `geo` derived, store must **both import for local use AND re-export** (a bare `export … from` does not bind into local scope under `verbatimModuleSyntax`):
```ts
import { buildGeoIndex, groupKeyOf } from './geo-index';
export { buildGeoIndex, groupKeyOf } from './geo-index';
export type { GeoIndex, StationGroupMember } from './geo-index';
```
Re-point the pure consumers to `./geo-index` directly: `search.ts`, `map/popup.ts` (kills the value-import leak), `export.ts`, `wrapped/card.ts` (GeoIndex only; `Headline` stays from store). `geo-index.ts` imports its data types from `../contract/types` (app-owned), never the synced `rail-package.ts`.
**Accept:** none of `search.ts`, `map/popup.ts`, `export.ts`, `wrapped/card.ts` VALUE-imports store (card.ts's type-only `Headline` is the allowed exception); `import/commit.ts`'s `import * as store` for mutations is EXPECTED and stays; check 0; vitest 279 with zero test-file edits.

**2b. Rename `src/fixtures/stubPackage.ts` → `src/lib/fallback-package.ts`** (+ its `.test.ts` beside it). It ships to prod as the degraded-mode fallback; the name must say so. Keep every export name (`JP_PACKAGE`, …); re-point ~16 importers; update the header comment to state the dual role (production fallback AND shared test fixture). Delete `src/fixtures/` when empty.
**Accept:** check 0; vitest 279 (net-zero — the 11 renamed tests move, none added/dropped); `grep -rn fixtures\\\|stubPackage src` → nothing.

## Phase 3 — MapView decomposition (the core; up to 3 commits: 3a/3b/3c)

Path: `src/screens/MapView.svelte`.

**3a. Type the map handle.** Replace `let map: any` / `let popup: any` (:67,70) with `import type { Map, Popup, MapLayerMouseEvent } from 'maplibre-gl'`. Extend the :11 comment: type-only imports are erased and allowed; the rule bans side-effectful VALUE loads only. No value import of maplibre may appear. **Commit 1.**

**3b. Extract the e2e harness** (≈ :261–311 incl. `E2EWindow`) into `src/lib/map/e2e.ts` as functions taking the map + deps. Preserve the `?e2e` gate and the `window.__map`/`window.__mapReady` set-on-mount / delete-on-unmount contract byte-for-byte. **Commit 2. Accept:** e2e 16/16 with ZERO spec edits.

**3c. Extract the PURE marking logic** into `src/lib/marking.ts` — and NOTHING side-effectful. Decided seam (the "$state mirror + plain class" idea is rejected: it fights Svelte 5 runes and forces rewiring ~10 template bindings; a `.svelte.ts` runes module has no precedent here and isn't proven unit-testable under the current vitest config). Instead:

- **Keep in the component:** all `$state`, all template bindings, and all I/O — `tryInfer`, `commitRoute`, `resolveInto`, `resetMarking`, toasts, `get(packages/geo/litSegmentIds)`, `findRoutes` calls, `markRoute`/`removeTrip`, `pulse()`, `markMode.set`, `selectedLine` and the tap/train/country state.
- **Move to `marking.ts` as pure, dependency-free functions** (the testable core):
  1. `isCurrentSeq(seq, latest)` — the `searchSeq` latest-wins predicate for `resolveInto`.
  2. a hit-reducer: given resolved hits, the next `{hitsX, pickedX}` (incl. the single-hit auto-collapse of the disambiguation list).
  3. `classifyRoute(a, b, packages, geo)` — wraps the pure `findRoutes`/`segmentsBetween`; returns `{kind:'same-station'|'no-route'|'single'|'multi', routes}`. This is where noRoute/single/multi is DECIDED; the component just performs the I/O for each kind.
  4. `clearedOnEndpointChange(state)` — the reset of `routeChoices`/`noRoute` when an endpoint changes; and the search-only reset that `resetMarking` composes with its tap/train/country clears.
- `marking.test.ts` (≥8 cases) pins, as pure functions:
  - **1a** `isCurrentSeq`: an out-of-order (stale) resolve is dropped.
  - **1b** (documented, e2e-guarded not unit-guarded): the object-identity route stale-guard lives in the component's `tryInfer` across the rAF yield; the route-picker spec (`does NOT auto-pick while typing`) covers it. Note this explicitly so no one writes a `searchSeq` test against route search.
  - **#2** exiting mark mode resets all search state (the pure reset half).
  - **#3** endpoint change clears `routeChoices`+`noRoute`.
  - **#4** `classifyRoute` returns `no-route` (→ noRoute) ONLY for a completed search with zero candidates; never a partial.
  - **#5** disambiguation: multi-hit → picking collapses to one and advances.
  - **same-station:** `classifyRoute` returns `same-station` (component toasts, sets NEITHER noRoute nor routeChoices).
  - **single vs multi:** one candidate → `single` (auto-commit); ≥2 → `multi` (picker).
- Optional if smooth: move `logoCreditLine`/`surfaceLogoCredits` to `src/lib/map/logo-credits.ts` + a unit test on `logoCreditLine`.

**Do not touch** the flood animation (`midpoints`, `cancelFlood`, the two big `$effect`s ~:442–477), `showPopup`, tap-marking (`doMark`, `wireStationClicks`), LOD filters, or the `<style>` block. **Commit 3.**
**Accept:** e2e 16/16 with ZERO spec edits; new marking tests green (vitest ≥ 287); check 0. **Behavior is the ONLY size gate** — the file will realistically land ~1150–1250 lines (~507 immovable `<style>`); there is NO ≤900 target, and chasing one by moving forbidden code is a failure.

## Phase 4 — self-host Noto Sans JP (closes D7) — **DESCOPED (2026-07-02), deferred to a focused follow-up**

**Outcome: reverted.** The implementation worked (fonts self-hosted via `@fontsource/noto-sans-jp`,
family unchanged, `document.fonts.check("16px 'Noto Sans JP'", "東京")` → true, zero third-party
requests), BUT it broke the two `offline.spec.ts` e2e tests, and the fix would require either editing
the spec (forbidden — the offline guarantee is the baseline) or reworking the service-worker
first-load registration (too risky for this pass).

**Root cause (proven by bisection + a headless SW-state diagnostic):** `offline.spec`'s
`waitForPrecache` waits for `navigator.serviceWorker.controller` + the rail package cached, then cuts
the network and reloads, expecting the SW to serve the shell. There is a narrow window where the SW
has not yet *stably* taken control after its first-load claim; adding ANY font loading (eager,
after-mount, or even gated on `serviceWorker.ready`) delays the SW settling enough that the test cuts
the network mid-window → `page.reload()` fails with `ERR_INTERNET_DISCONNECTED`. A diagnostic with a
3 s settle wait made it pass, confirming it's a settle-timing race, not a font-correctness bug. No
user-facing offline regression (the shell precaches; fonts degrade to system fallback offline), but
the test — correctly — does not tolerate the widened window.

**Follow-up to land fonts:** eliminate the first-load SW *control gap* (so the SW controls stably from
the first load without the post-claim window) — e.g. adjust the `registerType`/registration so
`waitForPrecache`'s guarantee holds — THEN re-apply the self-host. Tracked; not in this PR.

<details><summary>Original Phase 4 spec (for the follow-up)</summary>

- Add `@fontsource/noto-sans-jp` (regular `dependencies`); import weights 400/500/700 in `app.css` or `main.ts`. Remove the three font `<link>`s from `index.html`; remove the `google-fonts` `runtimeCaching` block from `vite.config.ts` (:59–70).
- **PWA (decided):** fontsource emits content-hashed woff2 under `/assets/`. Remove `woff2` from `globPatterns` (it is a no-op today) and add a same-origin runtime route — using a **predicate, not a glob string** (a bare `'/assets/*.woff2'` matches nothing in Workbox):
```js
{ urlPattern: ({ url }) => url.pathname.startsWith('/assets/') && url.pathname.endsWith('.woff2'),
  handler: 'CacheFirst',
  options: { cacheName: 'app-fonts', expiration: { maxEntries: 256, maxAgeSeconds: 60*60*24*365 } } }
```
`maxEntries:256` (108 subsets × 3 weights ≈ 324 possible; 48 would evict → offline tofu). Net offline behavior ≥ today.
- `wrapped/font.ts` and `tokens.ts` need no change (same family name — verified).
- **Accept (the automated gates give NO font signal — card.draw uses a mock ctx, offline.spec makes no font assertion; the real gate is manual):**
  - `grep -rn "fonts.googleapis\|fonts.gstatic" dist src index.html vite.config.ts` → nothing (note `vite.config.ts` is in scope — that's where the dead block lives).
  - `npm run preview`, confirm the network panel shows ZERO third-party font requests.
  - Eyeball: DOM UI + the exported Wrapped card render real Japanese glyphs (not system fallback), both online and after going offline.
  - offline e2e + card.draw tests still green (regression guard, not font validation).

</details>

## Phase 5 — hygiene + ship

- `README.md:33`: drop "offline/PWA" from Deferred (shipped v0.9.2.0); scan the rest for staleness.
- Remove `pmtiles` from `package.json` dependencies + `assetsInclude` + its comment in `vite.config.ts`; `npm install` to refresh the lockfile. Git history re-adds it when the tiles work lands.
- Bump to `0.10.1.0` in `package.json` + `VERSION` + `README.md:13`; CHANGELOG entry summarizing: CI e2e gate, geo-index extraction, fallback-package rename, MapView decomposition + marking unit tests, dead-dep removal. (Self-hosted fonts DESCOPED — see Phase 4.) Keep the 4-part scheme (a change is a user decision, out of scope).
- Full gate set once more, then `/ship` (the draft PR promotes to ready).

## Explicit non-goals (settled — do not do)

Topology/PMTiles geometry-vs-coverage data split (E2 precondition, needs railnet — separate program) · basemap provider swap (deferred to public launch; OSM attribution at `style.ts:388/397` already compliant) · runtime CDN move (audit-blocked) · runes migration of lib stores · store.ts decomposition beyond geo-index (incl. moving mutations out of the `import * as store` path) · semver scheme change · E1 open-ridelog spec · ImportScreen decomposition.
