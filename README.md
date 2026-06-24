# RailPrint

An open-source map of every train you've ridden — 航旅纵横 / Flightradar, but for rail.

Log which railway line **segments** you've personally ridden, see them lit on a map in
real track geometry, and watch your total km + % of the national network + % HSR climb.
One tap gives you a Spotify-Wrapped-style share card. Japan first; China later.

> Working name. Status: v0 shipping — the real MLIT N02 national network (594 lines, ~10,000 stations, ~26,800 km) loads in-app.

## v0 (web-app-first)

- Plain browser web app (Vite + Svelte, static). No backend. Hosted on GitHub/Cloudflare Pages.
- MapLibre GL JS + PMTiles for the map; rail geometry from MLIT 国土数値情報 N02 (CC BY 4.0).
- Pick a line → tap station A → tap station B → the segment lights; live km + % update.
- CSV import (ingest 乗りつぶしオンライン / RailLab histories) + export. Dexie/IndexedDB is the
  runtime store; the exported CSV is the durable backup-of-record.
- One vertical Wrapped share card via `<canvas>` → Web Share.

Deferred: offline/PWA, auto-import (QR/OCR), gamification/badges, GPS check-in,
community heatmap, China namespace, any backend.

## Docs

- [docs/DESIGN.md](docs/DESIGN.md) — full design (office-hours output, approved).
- [docs/TEST-PLAN.md](docs/TEST-PLAN.md) — coverage map + golden-file geometry suite.

## Attribution

Rail geometry: 出典「国土数値情報（鉄道データ）」（国土交通省）を加工して作成 (CC BY 4.0).

## License

TBD (intended open source).
