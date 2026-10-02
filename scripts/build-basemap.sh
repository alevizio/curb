#!/usr/bin/env bash
# Build the self-hosted parchment basemap for CURB → basemap/parchment/{z}/{x}/{y}.png ($0/mo).
# The tiles are committed and served by Vercel from this repo (see docs/self-host-basemap-plan.md).
# Re-bake a few times a year to pick up OSM changes: bump PLANET, run, commit basemap/parchment.
#
# Pipeline: extract SF + Bay Area vector tiles -> parchment style -> render PNGs in headless Chrome.
# Run from the repo root:  bash scripts/build-basemap.sh
#
# Requires: curl, unzip, node + npm, Google Chrome (headless renderer). macOS arm64 assumed.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p basemap

# --- knobs ---------------------------------------------------------------------------------------
# Daily planet builds; pick a current one from https://build-metadata.protomaps.dev/builds.json
PLANET="https://build.protomaps.com/20260926.pmtiles"
SF_BBOX="-122.56,37.685,-122.34,37.84"        # street zooms z14-17 (keep in sync with render-basemap.mjs)
BAY_BBOX="-123.10,37.20,-121.60,38.30"        # zoomed-out view z8-13 (keep in sync with index.html bounds)

# --- 1) pmtiles CLI (go-pmtiles), macOS arm64 ----------------------------------------------------
if [ ! -x ./pmtiles ]; then
  echo "› fetching go-pmtiles…"
  V=1.31.2
  curl -fL -o pmtiles.zip "https://github.com/protomaps/go-pmtiles/releases/download/v${V}/go-pmtiles-${V}_Darwin_arm64.zip"
  unzip -o pmtiles.zip pmtiles && chmod +x pmtiles && rm pmtiles.zip
fi

# --- 2) extract vector tiles (streams byte-ranges; never downloads the ~130GB planet) ------------
echo "› extracting SF + Bay Area from planet…"
./pmtiles extract "$PLANET" basemap/sf.pmtiles --bbox="$SF_BBOX" --maxzoom=15
./pmtiles extract "$PLANET" basemap/bay.pmtiles --bbox="$BAY_BBOX" --maxzoom=13

# --- 3) parchment MapLibre style from the Flavor + render deps -----------------------------------
npm i --no-save @protomaps/basemaps maplibre-gl pmtiles puppeteer-core sharp
node basemap/parchment-flavor.mjs > basemap/parchment-style.json

# --- 4) render 512px (@2x) PNG tiles with headless Chrome + MapLibre GL JS -----------------------
rm -rf basemap/parchment
node scripts/render-basemap.mjs

du -sh basemap/parchment
echo "✅ Next: check it with npm run dev → http://localhost:3077, then commit basemap/parchment."
