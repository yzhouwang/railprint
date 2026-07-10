# RailPrint

An open-source map of every train you've ridden — Flightradar, but for rail.

**Live: <https://yzhouwang.github.io/railprint/>** · installable PWA, works fully offline.

Log which railway line **segments** you've personally ridden, see them lit on a map in
real track geometry, and watch your total km + % of the national network + % HSR climb.
One tap gives you a Spotify-Wrapped-style share card. **Japan, plus one China corridor preview**
(京沪高速铁路) — enough to prove the network model is country-agnostic.

> **China corridor is a preview.** It's a curated WGS-84 station-sequence polyline (北京南 → 上海虹桥,
> 13 stops), **not** full China track geometry yet — that's a tracked refinement from OpenStreetMap ways (ODbL).

> Working name. Status: **v0.13.0.0** — the real MLIT N02 national network (594 lines, ~10,000 stations,
> ~26,800 km) in full official color with logos, operating-company labels, bilingual names, and a
> zoom-tiered map; 共用区間 braiding (shared-track corridors render as side-by-side strands);
> cross-line route marking; a trip diary + the **車両図鑑** collection loop (a data-honest
> vehicle dex over a curated, fact-checked model registry); and the first
> China corridor (京沪高速铁路). The rail data is content-addressed and SHA-256 verified, works fully
> offline (installable PWA), and a returning rider's coverage survives multi-version data refreshes —
> rides on now-abolished track are kept as closed-line history rather than silently dropped.

## v0 (web-app-first)

- Plain browser web app (Vite 6 + Svelte 5, static). No backend. Hosted on GitHub Pages.
- MapLibre GL JS over OpenFreeMap's muted positron vector basemap; rail geometry stitched from MLIT 国土数値情報 N02 (CC BY 4.0).
- **Every line in its official color + logo**, tagged with its operating company; **bilingual** station and line names (OpenStreetMap + Wikidata). Hover a station to see every line through it.
- **Zoom-tiered map:** the Shinkansen spine at the national view, the full network as you zoom into a city. Station dots reveal by average spacing, so dense lines (山手線, subways) stay legible.
- **共用区間 braid:** lines that share physical track (青函トンネル, 成田空港線↔北総線, 三田線↔南北線…) draw as side-by-side strands instead of stacking, so you can see which one you rode. Ride every line of a corridor and their glows merge into one halo; ridden lines always paint above unridden ones.
- **Mark a ride:** pick a line → tap station A → tap station B, **or** search two stations by 日本語 / romaji / かな and pick from the routes the app finds between them — even across multiple lines (a 特急ひのとり 津→大阪難波 through-service records as one trip). Live km + % (national, HSR) update.
- **Your rides are a journey log, not just coverage.** Marking a trip you've ridden before records a *new* dated journey (coverage % never double-counts). The **旅の記録 diary** lists each journey — date · route · km · line(s) · train — and an optional **車両** field collects the rolling stock you've ridden (N700S, CR400AF, …), canonicalized so variants fold into one model. Tap a diary pill to fix or add a trip's 車両 after the fact; a **未記録のみ** filter makes enriching an imported history visible progress.
- **車両図鑑 — a data-honest vehicle dex.** Every model you log becomes a collected card: claymation silhouettes in real livery tints, completion meters over curated **closed** rosters only (新幹線 X/13; 京沪で会える車両 X/4 — the CN meter counts what the corridor can actually deliver), a ghost want-list with retirement urgency straight from roster facts (500系「2027年1月引退予定」), model detail pages (operator · top speed · 愛称 · your trips on it), and five milestone stamps. No gacha, no invented rarity; unknown free-text models stay first-class. Mark a new-to-you model and the toast becomes 「◯◯を図鑑に追加しました · 新幹線 8/13」 — tap through to the card.
- **Japan + China in one map.** The **京沪高速铁路 (Beijing–Shanghai HSR)** loads alongside the JR network, drawn in CR red and markable like any line. Stats are **per-country** — your Japan % stays its own number and a separate 中国 figure tracks China; WGS-84 throughout (no GCJ-02). One corridor proves the schema; broad China is next.
- CSV import (乗りつぶしオンライン / RailLab histories) + lossless export. Dexie/IndexedDB is the
  runtime store; the exported CSV is the durable backup-of-record.
- A vertical Wrapped-style share card via `<canvas>` → Web Share.

Deferred: auto-import (QR/OCR), the rest of the collection loop (per-model silhouette
pipeline, batch backfill stepper, GPS check-in), community heatmap, broad China beyond
the 京沪 corridor, any backend.

## Docs

- [CHANGELOG.md](CHANGELOG.md) — release-by-release history.
- [RAILNET.md](RAILNET.md) — how the app vendors and verifies the railnet data package (the producer↔consumer contract).

## Attribution

Rail geometry: 出典「国土数値情報（鉄道データ）」（国土交通省）を加工して作成 (CC BY 4.0).
Romanizations © OpenStreetMap contributors (ODbL). China corridor station coordinates are
WGS-84; geometry is to be refined from OpenStreetMap ways (ODbL).

## License

Code: [AGPL-3.0-only](LICENSE) — run a modified copy as a service, share your source.
Data licenses are separate: rail geometry CC BY 4.0 (MLIT N02), romanizations ODbL
(OpenStreetMap) — see Attribution above and the per-namespace licenses in
[railnet](https://github.com/yzhouwang/railnet) (publishing shortly; the data pipeline +
released artifacts live there).
