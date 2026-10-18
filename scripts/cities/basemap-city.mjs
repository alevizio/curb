#!/usr/bin/env node
// Each city's basemap: the parchment style (basemap/parchment-flavor.mjs, the one SF's and Boston's tiles are baked
// from) drawn live on the city's page from one vector file, basemap/cities/<id>.pmtiles, cut from the current
// Protomaps planet build to the tiles around the city's blocks (data/<id>/segments.json). One file per city instead
// of thousands of PNG tiles a city; the page draws it with MapLibre (scripts/cities/city-page.mjs).
// Also writes basemap/cities/style.json (the style, its source filled in by the page) and basemap/cities/index.json
// (each file's planet build, the ?v= that keeps a browser from mixing two builds' bytes).
//
// Run: node scripts/cities/basemap-city.mjs [id ...]   (default: every city in lib/city-configs.js; PLANET=<build url> to
// pin a planet build; MAXZOOM=14 for more detail)
// Needs ./pmtiles (go-pmtiles, fetched by scripts/build-basemap.sh) and @protomaps/basemaps (npm i --no-save).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../../lib/city-configs.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'basemap/cities/';
const MAXZOOM = +(process.env.MAXZOOM || 13);   // vector lines stay sharp past it: MapLibre overzooms to street level
const Z = 12;                                    // the region: z12 tiles holding a block, and their neighbors

if (!fs.existsSync(ROOT + 'pmtiles')) throw new Error('./pmtiles is missing: run scripts/build-basemap.sh once (it fetches go-pmtiles)');
const planet = process.env.PLANET || await fetch('https://build-metadata.protomaps.dev/builds.json').then((r) => r.json())
  .then((b) => 'https://build.protomaps.com/' + b.map((x) => x.key).filter((k) => /^\d{8}\.pmtiles$/.test(k)).sort().pop());
const build = path.basename(planet, '.pmtiles');

// z12 tile squares around every block vertex, as one MultiPolygon (pmtiles extract --region)
function region(blocks) {
  const n = 2 ** Z, tx = (lng) => Math.floor(((lng + 180) / 360) * n);
  const ty = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
  const lng = (x) => (x / n) * 360 - 180, lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const tiles = new Set();
  for (const b of blocks) for (const [lo, la] of b.g) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) tiles.add((tx(lo) + i) + '/' + (ty(la) + j));
  const squares = [...tiles].map((k) => { const [x, y] = k.split('/').map(Number);
    return [[[lng(x), lat(y)], [lng(x + 1), lat(y)], [lng(x + 1), lat(y + 1)], [lng(x), lat(y + 1)], [lng(x), lat(y)]]]; });
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: squares } };
}

fs.mkdirSync(OUT, { recursive: true });
const style = JSON.parse(execFileSync('node', [ROOT + 'basemap/parchment-flavor.mjs'], { encoding: 'utf8', maxBuffer: 1 << 26 }));
style.sources.protomaps.url = '';   // the page puts the city's file here
fs.writeFileSync(OUT + 'style.json', JSON.stringify(style) + '\n');

const indexFile = OUT + 'index.json';
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(globalThis.CITY_CONFIGS);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'curb-basemap-'));
try {
  for (const id of ids) {
    const blocks = JSON.parse(fs.readFileSync(`${ROOT}data/${id}/segments.json`, 'utf8')).b;
    const geo = path.join(tmp, id + '.geojson');
    fs.writeFileSync(geo, JSON.stringify(region(blocks)));
    execFileSync(ROOT + 'pmtiles', ['extract', planet, `${OUT}${id}.pmtiles`, `--region=${geo}`, `--maxzoom=${MAXZOOM}`], { stdio: 'ignore' });
    const bytes = fs.statSync(`${OUT}${id}.pmtiles`).size;
    index[id] = { build, maxzoom: MAXZOOM, bytes };
    console.error(`[basemap-city] basemap/cities/${id}.pmtiles: ${(bytes / 1e6).toFixed(1)} MB, z0-${MAXZOOM}, planet ${build}`);
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
fs.writeFileSync(indexFile, JSON.stringify(Object.fromEntries(Object.entries(index).sort()), null, 2) + '\n');
