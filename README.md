# RailPrint

An open-source map of every train you've ridden — 航旅纵横 / Flightradar, but for rail.

Log which railway line **segments** you've personally ridden, see them lit on a map in
real track geometry, and watch your total km + % of the national network + % HSR climb.
One tap gives you a Spotify-Wrapped-style share card. Japan first; China later.

> Working name. Status: **v0.6.0.0** — the real MLIT N02 national network (594 lines, ~10,000 stations,
> ~26,800 km), in full official color, with line logos, operating-company labels, bilingual
> (日本語 + romaji) names, and a zoom-tiered map.

## v0 (web-app-first)

- Plain browser web app (Vite 6 + Svelte 5, static). No backend. Hosted on GitHub/Cloudflare Pages.
- MapLibre GL JS over a muted OSM raster basemap; rail geometry stitched from MLIT 国土数値情報 N02 (CC BY 4.0).
- **Every line in its official color + logo**, tagged with its operating company; **bilingual** station and line names (OpenStreetMap + Wikidata). Hover a station to see every line through it.
- **Zoom-tiered map:** the Shinkansen spine at the national view, the full network as you zoom into a city. Station dots reveal by average spacing, so dense lines (山手線, subways) stay legible.
- Mark a ride: pick a line → tap station A → tap station B, **or** search a station by 日本語 / romaji / かな; the linking line is inferred. Live km + % (national, HSR) update.
- CSV import (乗りつぶしオンライン / RailLab histories) + lossless export. Dexie/IndexedDB is the
  runtime store; the exported CSV is the durable backup-of-record.
- A vertical Wrapped-style share card via `<canvas>` → Web Share.

Deferred: offline/PWA, auto-import (QR/OCR), gamification/badges, GPS check-in,
community heatmap, China namespace, any backend.

## Docs

- [docs/DESIGN.md](docs/DESIGN.md) — full design (office-hours output, approved).
- [docs/TEST-PLAN.md](docs/TEST-PLAN.md) — coverage map + golden-file geometry suite.

## Attribution

Rail geometry: 出典「国土数値情報（鉄道データ）」（国土交通省）を加工して作成 (CC BY 4.0).

## License

TBD (intended open source).
