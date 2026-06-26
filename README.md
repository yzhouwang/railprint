# RailPrint

An open-source map of every train you've ridden — 航旅纵横 / Flightradar, but for rail.

Log which railway line **segments** you've personally ridden, see them lit on a map in
real track geometry, and watch your total km + % of the national network + % HSR climb.
One tap gives you a Spotify-Wrapped-style share card. Japan-first, and now Japan **and** China
in one map — the 京沪 corridor proves the network model is country-agnostic.

> Working name. Status: **v0.9.0.0** — the real MLIT N02 national network (594 lines, ~10,000 stations,
> ~26,800 km) in full official color with logos, operating-company labels, bilingual names, and a
> zoom-tiered map; cross-line route marking; a trip diary + train-model collection; and the first
> China corridor (京沪高速铁路).

## v0 (web-app-first)

- Plain browser web app (Vite 6 + Svelte 5, static). No backend. Hosted on GitHub/Cloudflare Pages.
- MapLibre GL JS over a muted OSM raster basemap; rail geometry stitched from MLIT 国土数値情報 N02 (CC BY 4.0).
- **Every line in its official color + logo**, tagged with its operating company; **bilingual** station and line names (OpenStreetMap + Wikidata). Hover a station to see every line through it.
- **Zoom-tiered map:** the Shinkansen spine at the national view, the full network as you zoom into a city. Station dots reveal by average spacing, so dense lines (山手線, subways) stay legible.
- **Mark a ride:** pick a line → tap station A → tap station B, **or** search two stations by 日本語 / romaji / かな and pick from the routes the app finds between them — even across multiple lines (a 特急ひのとり 津→大阪難波 through-service records as one trip). Live km + % (national, HSR) update.
- **Your rides are a journey log, not just coverage.** Marking a trip you've ridden before records a *new* dated journey (coverage % never double-counts). The **旅の記録 diary** lists each journey — date · route · km · line(s) · train — and an optional **車両** field collects the rolling stock you've ridden (N700S, CR400AF, …), canonicalized so variants fold into one model.
- **Japan + China in one map.** The **京沪高速铁路 (Beijing–Shanghai HSR)** loads alongside the JR network, drawn in CR red and markable like any line. Stats are **per-country** — your Japan % stays its own number and a separate 中国 figure tracks China; WGS-84 throughout (no GCJ-02). One corridor proves the schema; broad China is next.
- CSV import (乗りつぶしオンライン / RailLab histories) + lossless export. Dexie/IndexedDB is the
  runtime store; the exported CSV is the durable backup-of-record.
- A vertical Wrapped-style share card via `<canvas>` → Web Share.

Deferred: offline/PWA, auto-import (QR/OCR), the full collection loop (badges, GPS check-in),
community heatmap, broad China beyond the 京沪 corridor, any backend.

## Docs

- [docs/DESIGN.md](docs/DESIGN.md) — full design (office-hours output, approved).
- [docs/TEST-PLAN.md](docs/TEST-PLAN.md) — coverage map + golden-file geometry suite.
- [CHANGELOG.md](CHANGELOG.md) — release-by-release history.

## Attribution

Rail geometry: 出典「国土数値情報（鉄道データ）」（国土交通省）を加工して作成 (CC BY 4.0).
Romanizations © OpenStreetMap contributors (ODbL). China corridor station coordinates are
WGS-84; geometry is to be refined from OpenStreetMap ways (ODbL).

## License

TBD (intended open source).
