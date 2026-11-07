#!/usr/bin/env node
// data/grades.json: how steep each swept SF block is and which way it climbs, for the hill reminder (lib/hill.js). San
// Francisco tickets a car on a grade over 3% whose wheels aren't curbed (Transportation Code 7.2.35), about 30,000 tickets
// a year (owner, 2026-11-06, after one of the owner's own: "Could we have a reminder in the streets needed to park in grades").
//
// Elevation is USGS 3DEP (1 m lidar in SF), five points along each block. The grade is the steepest quarter of the block,
// not end to end: on six blocks with a City figure it came within 0.3 points (22nd St, Church to Vicksburg: City 31.5%,
// steepest quarter 31.6%, end to end 24.7%), since a block flattens where it meets a cross street.
//
// Entry: b[cnn] = [grade in tenths of a percent, rises along the line (1) or falls (-1) or both (0), way]. `way` is which
// way traffic runs, relative to the sweeping dataset's line, the one its cnnrightleft sides refer to: B both, F with the
// line, T against it, '' unknown. Only blocks at MIN_GRADE or more are kept.
//
// Local build, like build:routes (not in the data-refresh CI): hills don't move. The samples are kept in a cache file so an
// interrupted run picks up where it stopped: CURB_GRADES_CACHE, default private/grade-samples.json (gitignored).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SWEEP = 'https://data.sf.gov/resource/yhqp-riqs.json';
const STREETS = 'https://data.sf.gov/resource/3psu-pn9h.json';
const USGS = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples';
const UA = { 'User-Agent': 'curb-build-grades' };

export const MIN_GRADE = 2.5;   // the rule starts over 3%; curbing costs nothing and a miss costs a ticket
const POINTS = 5, CHUNK = 400;
const SHORT_BLOCK_M = 40;       // quarters of a block this short are a few metres each: lidar noise, so end to end only
const SPIKE_MIN = 15, SPIKE_RATIO = 2.5;   // one steep quarter among flat ones: a bridge, tunnel or overpass (3rd St's bridge read 39%, the water under it)

export function metres(a, b) {
  const k = Math.cos((a[1] * Math.PI) / 180) * 111320;
  return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 110540);
}

/** `n` points evenly spaced along a line, both ends included → { points, length (metres) }. */
export function sampleAlong(line, n = POINTS) {
  const seg = line.slice(1).map((p, i) => metres(line[i], p));
  const length = seg.reduce((s, x) => s + x, 0);
  const points = [];
  for (let t = 0; t < n; t++) {
    let want = (length * t) / (n - 1), i = 0;
    while (i < seg.length - 1 && want > seg[i]) want -= seg[i++];
    const f = seg[i] ? Math.min(1, want / seg[i]) : 0;
    points.push([line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f]);
  }
  return { points, length };
}

/** Elevations at evenly spaced points along a block → { grade (percent), dir } or null with no length. */
export function gradeOf(zs, length) {
  if (!(length > 0)) return null;
  const rise = zs[zs.length - 1] - zs[0];
  const ends = (Math.abs(rise) / length) * 100;
  const parts = zs.slice(1).map((z, i) => ((z - zs[i]) / (length / (zs.length - 1))) * 100);
  const [steepest, next] = parts.map(Math.abs).sort((a, b) => b - a);
  // a real hill is steep for more than a quarter of a block. Past a spike keep the higher of the rest, so a real pitch at
  // the end of a block still gets its reminder: a false alarm costs nothing, a miss costs a ticket.
  const grade = length < SHORT_BLOCK_M ? ends : steepest >= SPIKE_MIN && steepest > SPIKE_RATIO * next ? Math.max(next, ends) : steepest;
  // a block that climbs and then drops (or the reverse) has no one way to face
  const up = parts.some((p) => p >= MIN_GRADE), down = parts.some((p) => p <= -MIN_GRADE);
  const dir = up && down ? 0 : (up || (!down && rise > 0)) ? 1 : -1;
  return { grade, dir };
}

/** DataSF's oneway (F = with the streets dataset's line, T = against it, B = both; checked on Oak, Fell, Pine, Bush,
 *  Franklin and Gough) → the same, relative to the sweeping dataset's line, which can run the other way. */
export function wayAlong(oneway, streetsLine, sweepLine) {
  if (oneway === 'B') return 'B';
  if (oneway !== 'F' && oneway !== 'T') return '';
  const heading = (a) => [a[a.length - 1][0] - a[0][0], a[a.length - 1][1] - a[0][1]];
  const s = heading(streetsLine), w = heading(sweepLine);
  const same = s[0] * w[0] + s[1] * w[1] >= 0;
  return same ? oneway : oneway === 'F' ? 'T' : 'F';
}

const flat = (g) => (g.type === 'MultiLineString' ? g.coordinates.flat() : g.coordinates);

async function getAll(url, select) {
  const out = [];
  for (let offset = 0; ; offset += 50000) {
    const q = new URLSearchParams({ $select: select, $order: 'cnn', $limit: '50000', $offset: String(offset) });
    const r = await fetch(`${url}?${q}`, { headers: UA });
    if (!r.ok) throw new Error(`${url} answered ${r.status}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 50000) return out;
  }
}

async function elevations(points) {
  const body = new URLSearchParams({
    geometry: JSON.stringify({ points, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', interpolation: 'RSP_BilinearInterpolation', f: 'json',
  });
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(USGS, { method: 'POST', body, headers: UA, signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw new Error(`USGS answered ${r.status}`);
      const d = await r.json();
      if (!d.samples) throw new Error('USGS: ' + JSON.stringify(d).slice(0, 200));
      const z = new Map(d.samples.map((s) => [s.locationId, Number(s.value)]));
      return points.map((_, i) => z.get(i));
    } catch (e) {
      if (attempt >= 6) throw e;
      console.error(`  retry ${attempt}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 5000 * attempt));
    }
  }
}

async function main() {
  const cachePath = process.env.CURB_GRADES_CACHE || path.join(ROOT, 'private/grade-samples.json');
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
  const limit = Number(process.env.CURB_GRADES_LIMIT) || Infinity;   // a trial run on a few blocks: writes no data file

  const sweep = await getAll(SWEEP, 'cnn,line');
  const lines = new Map();
  for (const r of sweep) if (r.line && !lines.has(r.cnn)) lines.set(r.cnn, flat(r.line));
  const streets = new Map((await getAll(STREETS, 'cnn,oneway,line')).map((r) => [r.cnn, r]));
  const cnns = [...lines.keys()].slice(0, limit);
  console.log(`${cnns.length} swept blocks, ${Object.keys(cache).length} already sampled`);

  const todo = cnns.filter((c) => !cache[c]);
  const perCall = Math.floor(CHUNK / POINTS);
  for (let i = 0; i < todo.length; i += perCall) {
    const batch = todo.slice(i, i + perCall);
    const t = Date.now();
    const zs = await elevations(batch.flatMap((c) => sampleAlong(lines.get(c)).points));
    batch.forEach((c, j) => { cache[c] = zs.slice(j * POINTS, (j + 1) * POINTS); });
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache));
    console.log(`  ${Math.min(i + perCall, todo.length)}/${todo.length} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  }

  const b = {};
  let missing = 0;
  for (const c of cnns) {
    const zs = cache[c];
    if (!zs || zs.some((z) => !Number.isFinite(z))) { missing++; continue; }
    const g = gradeOf(zs, sampleAlong(lines.get(c)).length);
    if (!g || g.grade < MIN_GRADE) continue;
    const st = streets.get(c);
    b[c] = [Math.round(g.grade * 10), g.dir, st && st.line ? wayAlong(st.oneway, flat(st.line), lines.get(c)) : ''];
  }
  const kept = Object.keys(b).length;
  console.log(`${kept} of ${cnns.length} blocks at ${MIN_GRADE}% or more, ${missing} without elevation`);
  if (limit !== Infinity) { console.log(JSON.stringify(b).slice(0, 400)); return; }
  const meta = {
    generated: new Date().toISOString(),
    source: 'USGS 3DEP elevation at five points per block, DataSF yhqp-riqs (block lines) + 3psu-pn9h (one way)',
    blocks: cnns.length, kept, minGrade: MIN_GRADE,
    note: 'b[cnn] = [grade in tenths of a percent, 1 rises along the line / -1 falls / 0 both, way: B both, F with the line, T against it, empty unknown]',
  };
  fs.writeFileSync(path.join(ROOT, 'data/grades.json'), JSON.stringify({ _meta: meta, b }));
  console.log('wrote data/grades.json');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
