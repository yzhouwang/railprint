# RailPrint ↔ railnet

RailPrint's rail-geometry data is produced by **[railnet](../railnet)**, a standalone, versioned
package (the build pipeline + the MLIT N02 / OSM / Wikimedia sources + the released artifacts). This
app is a **consumer**: it pins a railnet version and vendors railnet's built artifacts so its runtime
stays **same-origin** — offline (the service worker precaches `public/rail/`) and SHA-256 integrity
both keep working with zero change. The split is about *who owns the data + build*, not *how the app
serves it*.

## What's generated (do not hand-edit)

| Path | Generated from |
|------|----------------|
| `public/rail/*` (jp-2025.json, cn-jinghu-2025.json, manifest.json, migrations/, logos/, logo-credits.json) | `railnet/rail/*` |
| `src/contract/rail-package.ts` | `railnet/contract/rail-package.ts` |

The pin lives in **`railnet.json`** (the railnet version + the per-namespace data versions). The
shared contract (`rail-package.ts`) is the single producer↔consumer boundary; it carries explicit
`PACKAGE_SCHEMA_VERSION` / `MANIFEST_SCHEMA_VERSION` so a producer/consumer skew fails loudly (the app
rejects a manifest whose schema is newer than it understands) instead of silently mis-resolving saved
coverage.

## Updating the network data

1. In `railnet`: update the source / bump the data version, `npm run build && npm run verify`.
2. In this app: `npm run sync:railnet` — copies the artifacts + contract over and **verifies every
   package's bytes against railnet's manifest SHA-256** before succeeding. Then `git diff` and commit.

Two integrity gates, by what they need:

- **`npm run verify:rail`** — self-contained; needs NO railnet checkout. Verifies the vendored
  `public/rail/*` against their own manifest SHA-256, so a corrupted or partial sync fails the build.
  This runs in the app's CI (`.github/workflows/ci.yml`) on every PR.
- **`npm run sync:railnet:check`** — the cross-repo *pin* check; needs a `railnet` checkout beside the
  app (`../railnet`, or `$RAILNET_PATH`). Fails if the vendored data/contract has drifted from the
  pinned railnet version. Run it after a sync, or in a combined CI once railnet is published.

## Why vendored-and-committed, not a runtime CDN

A readiness audit found that moving the 8.8 MB package off-origin to a CDN is genuinely *blocked*
today: CORS isn't wired, the service-worker precache is same-origin only (offline would break), and
`crypto.subtle` is null in an insecure context (an HTTP CDN would silently disable the SHA-256 check).
So the package stays same-origin and committed; the railnet *secondary-origin* machinery
(`VITE_RAIL_CDN_SECONDARY`) is in place for when those are addressed. Tracked in
`docs/designs/rail-geo-durable-package.md`.
