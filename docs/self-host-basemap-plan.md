# Self-hosted parchment basemap ($0/mo)

CURB's basemap is its own pre-baked parchment raster, committed at `basemap/parchment/{z}/{x}/{y}.png`
and served by Vercel from this repo. No map vendor, no key, no bill.

## Why (2026-09-27)

- Google Map Tiles (~$200/mo, CURB's dominant cost) was forced off on 2026-06-29 (`GMAPS_KEY=""`).
- The keyless CARTO fallback then started returning a blank tile stamped **"API KEY REQUIRED"** on
  every request, so curb.guide had no basemap.
- The self-host plan (ALE-198) was already designed; it shipped on Vercel instead of Cloudflare R2
  because curb.guide's DNS is on Vercel (an R2 custom domain needs the zone on Cloudflare).

## What it is

- Pre-baked parchment **raster** tiles, Leaflet unchanged → all overlays and every CLAUDE.md
  invariant untouched. Plain `<img>` tiles = no WebGL = WKWebView-safe.
- Baked 1:1 from `MAP_STYLE` via `basemap/parchment-flavor.mjs` (a Protomaps Flavor). The output
  uses exactly the MAP_STYLE palette: paper `#fbf7ef`, ink `#5a4b3c`, parks `#c6ddbe`, water
  `#ded1b7`, roads `#eceff1` + casing `#aeb6bd`, boundaries `#d7c4a5`. No buildings, no POIs.
- Coverage: Bay Area z8-13, SF z14-17 (512px @2x tiles). `index.html` `addSelfBasemap()` uses
  `minNativeZoom:8`, `maxNativeZoom:17` (overzooms 18-20) and `bounds` so Leaflet never asks for a
  tile that wasn't baked. ~9.3k files, ~70 MB.

**The load-bearing constraint:** road fill stays a cool near-paper light grey `#eceff1`. Streets
separate from the warm land by **hue, not darkness**, so the amber "soon" curb line keeps ~3:1
contrast. **Never darken roads.**

## Re-bake (a few times a year, to pick up OSM changes)

```
bash scripts/build-basemap.sh   # bump PLANET first; ~5 min on an M-series Mac
npm run dev                     # check http://localhost:3000, then commit basemap/parchment
```

Pipeline: `pmtiles extract` streams just the SF + Bay Area byte ranges from a daily Protomaps planet
build → `parchment-flavor.mjs` writes the MapLibre style → `scripts/render-basemap.mjs` renders
metatiles in headless Chrome (MapLibre GL JS) and slices them into palette-quantized PNGs. Needs only
node + Google Chrome (no Docker; MapLibre native has no prebuilt binary for current Node).

## Cost and limits

- $0: static files on Vercel Hobby. A map session is ~30-60 tiles at ~8 KB each (well under 1 MB).
- Tiles bypass the service worker (`sw.js`) and carry `Cache-Control: public, max-age=2592000`
  (`vercel.json`), so repeat visits don't refetch them.
- Watch: Hobby's included bandwidth is shared with the whole site. If traffic ever outgrows it, move
  `basemap/parchment` to Cloudflare Pages (free, unlimited bandwidth, CNAME `basemap.curb.guide`)
  and point `SELF_BASEMAP` at it.

## Teardown still open

The Google path (`createSession` flow, `GLOGO`, viewport attribution, `gmapsDownToday`,
`config.js`/`api/config.js` + rewrite, the `tile.googleapis.com` preconnects) and `addCarto()` are
now unreachable while `SELF_BASEMAP` is set. Remove them once the self-hosted tiles have been proven
in production and in the iOS wrapper, and close the Google Cloud billing budget.
