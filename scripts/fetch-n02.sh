#!/usr/bin/env bash
# Fetch the raw MLIT N02 rail GeoJSON that the JP RailGeoPackage is built from.
#
# Source: Sager1145/Japan-Train-Map (CC BY 4.0), pinned to a commit for reproducibility.
# That repo extracted the data from MLIT 国土数値情報（鉄道データ N02）2025. The files are
# gitignored here (15MB); this script restores them so `npm run build:rail-geo:jp` can run.
#
# Long-term: regenerate from MLIT's official N02-25 GML (the authoritative CC BY source)
# at https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html instead of the
# second-hand JSON. For v0 the pinned copy below is the source of truth.
set -euo pipefail

REPO="Sager1145/Japan-Train-Map"
SHA="7d3acf0d3603bfc5627e0992472c73f90ea4bcf8" # pin: bump deliberately, then rebuild + re-verify
BASE="https://raw.githubusercontent.com/${REPO}/${SHA}/app/data"
DEST="$(cd "$(dirname "$0")/.." && pwd)/data/n02"

mkdir -p "$DEST"
for f in rail-sections stations; do
  echo "fetching ${f}.json from ${REPO}@${SHA:0:7} ..."
  curl -fsSL "${BASE}/${f}.json" -o "${DEST}/${f}.json"
done

echo "done → ${DEST}"
echo "next: npm run build:rail-geo:jp && npm run verify:rail-geo:jp"
