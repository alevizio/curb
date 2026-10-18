#!/usr/bin/env node
// Santa Monica for CURB (city build, docs/multi-city/city-build.md; research in docs/multi-city/santa-monica.md).
// Builds data/santa-monica/ from the City of Santa Monica's GIS server (gis.santamonica.gov, ODC-By):
//
//   1. Street Sweeping (FeatureServer/0): one line PER CURB, 19,550 pieces, 13,409 with a weekday and a two hour window
//      ("12-2", no AM or PM). No street names, no block ids, no side.
//   2. Street Centerlines (FeatureServer/0): 3,465 centerlines with names and address ranges. A block here is one STREET
//      centerline (its objectid_1 is the block id). The layer also splits streets where nothing crosses them, so a
//      block's cross streets are found by walking along the street to the next real intersection (limits).
//   3. Neighborhood Organizations (FeatureServer/0): 4 of the City's 7 neighborhood organization areas, for `h`.
//
// Each curb line is sampled every 5 m; each sample goes to the nearest block line running the same way within 30 m,
// on the side of it where the sample lies (left or right looking along the block line). A side keeps a rule when the
// curb carrying it covers enough of the block (keepRules). Exported functions are tested in santa-monica.test.mjs.
//
// Run: node scripts/cities/santa-monica.mjs [--refresh]   (Node 18+; inputs cached in private/cache/santa-monica/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/santa-monica/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/santa-monica/';
const log = (...a) => console.error('[santa-monica]', ...a);

const GIS = 'https://gis.santamonica.gov/server/rest/services/';
export const SOURCES = {
  sweeping: { url: GIS + 'Street_Sweeping/FeatureServer/0', oid: 'objectid', file: 'sweeping.json' },
  centerlines: { url: GIS + 'Street_Centerlines/FeatureServer/0', oid: 'objectid_1', file: 'centerlines.json' },
  hoods: { url: GIS + 'Neighborhood_Organizations/FeatureServer/0', oid: 'objectid', file: 'neighborhoods.json' },
};

// ---------- schedule ------------------------------------------------------------------------------

const DAY = { sunday: [0], monday: [1], tuesday: [2], wednesday: [3], thursday: [4], friday: [5], saturday: [6],
  // Pico Blvd's three nights a week, one curb each: Mon/Wed/Fri on the south side, Tue/Thu/Sat on the north side.
  // The map legend calls TRSat "Thur/Sat"; T + R + Sat is Tuesday, Thursday and Saturday, the other half of the week.
  mwf: [1, 3, 5], trsat: [2, 4, 6] };
const OVERNIGHT = new Set(['mwf', 'trsat']);   // the boulevard program, 3 to 6 AM (all its rows say "3-6")

// "1" → 13, "9" → 9, "3:30" → "15:30": the City's hours have no AM or PM. Residential sweeping runs by day, so an hour
// before 7 is in the afternoon (signs read 9 to 11 AM ... 3 to 5 PM); the overnight program keeps its hours as they are.
function clock(s, overnight) {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  let h = +m[1];
  const mi = m[2] ? +m[2] : 0;
  if (h > 12 || mi > 59) return null;
  if (!overnight && h < 7) h += 12;
  if (overnight && h === 12) h = 0;
  return { h, mi };
}
const fmt = ({ h, mi }) => (mi ? `${h}:${String(mi).padStart(2, '0')}` : h);
const minutes = ({ h, mi }) => h * 60 + mi;

/** One curb line's day and time → rule tuples [dow, from, to, weeks, months, flags], or { why } when it can't be read. */
export function parseSchedule(day, time) {
  const d = String(day ?? '').trim().toLowerCase();
  if (!d || d === 'null') return { rules: [], why: 'no day' };
  const days = DAY[d];
  if (!days) return { rules: [], why: `day "${day}"` };
  const t = String(time ?? '').trim().replace(/-+/g, '-');
  if (!t) return { rules: [], why: 'no hours' };
  const parts = t.split('-');
  const overnight = OVERNIGHT.has(d);
  const a = parts.length === 2 && clock(parts[0], overnight), b = parts.length === 2 && clock(parts[1], overnight);
  if (!a || !b || minutes(b) <= minutes(a)) return { rules: [], why: `hours "${time}"` };
  return { rules: days.map((dow) => [dow, fmt(a), fmt(b), 31, 0, 0]) };
}

// ---------- geometry ------------------------------------------------------------------------------

const LAT0 = 34.02, LON0 = -118.47, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110950;
export const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
export const partsOf = (g) => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);
export function lineLen(c) {
  let s = 0;
  for (let i = 1; i < c.length; i++) { const a = xy(c[i - 1]), b = xy(c[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return s;
}
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
/** The compass word for side L or R of a line (looking from its first point to its last), as in boston.mjs. */
export function compass(c, side, project = xy) {
  const a = project(c[0]);
  let b = project(c[c.length - 1]);
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) b = project(c[Math.floor(c.length / 2)]);   // a loop: start to halfway
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}

const nodeId = ([lon, lat]) => lon.toFixed(5) + ',' + lat.toFixed(5);
const STUB_M = 20;

/**
 * The cross streets at both ends of every street piece: `limits(pieces)` → Map(piece → [at its first point, at its
 * last point]). The City's layer also splits streets where nothing crosses them, and does not always join a cross
 * street to the node, so an end takes the nearest other street whose line passes within `snap` m, and an end with
 * none walks on along the same street (through nodes where it simply continues) until it finds one.
 */
export function limits(pieces, { snap = 12, project = xy } = {}) {
  const at = new Map();
  for (const p of pieces) {
    p.a = nodeId(p.coords[0]); p.b = nodeId(p.coords[p.coords.length - 1]);
    for (const n of [p.a, p.b]) { if (!at.has(n)) at.set(n, []); at.get(n).push(p); }
  }
  const near = crossStreets(pieces, { near: snap, project });
  const coordOf = (n) => n.split(',').map(Number);
  // the cross street at node n, leaving piece p; walks through nodes where the street simply continues
  function cross(p, n) {
    const seen = new Set([p]);
    for (let i = 0; i < 50; i++) {
      const hit = near(coordOf(n), p.name);
      if (hit) return hit;
      const next = at.get(n).filter((q) => q !== p);
      if (next.length !== 1 || next[0].name !== p.name || seen.has(next[0])) return '';
      p = next[0]; seen.add(p);
      n = p.a === n ? p.b : p.a;
    }
    return '';
  }
  return new Map(pieces.map((p) => [p, [cross(p, p.a), cross(p, p.b)]]));
}

/**
 * Curb lines → block sides. `curbs` = [{ id, coords: [[lng,lat]...][], rules, label? }], `blocks` = [{ id, coords }].
 * Every 5 m of curb goes to the nearest block line within `maxD` m whose direction is within ~37° of the curb's,
 * on the side of it where the curb lies. A curb's schedule (its `label`, else its rules) is the unit a side counts:
 * returns { sides: Map("blockId|L" → { len, dist (length-weighted sum of distances: dist / len is the mean), scheds:
 * Map(label → { rules, len }) }), unassigned: [{ id, len }] (curb lines with less than half their length placed),
 * sampled, placed } (lengths in m).
 */
export function matchCurbs(curbs, blocks, { maxD = 30, cosMin = 0.8, step = 5, project = xy } = {}) {
  const CELL = 50, cell = (v) => Math.floor(v / CELL), grid = new Map();
  for (const b of blocks) {
    const pts = b.coords.map(project);
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      for (let cx = cell(Math.min(x1, x2) - maxD); cx <= cell(Math.max(x1, x2) + maxD); cx++)
        for (let cy = cell(Math.min(y1, y2) - maxD); cy <= cell(Math.max(y1, y2) + maxD); cy++) {
          const k = cx + ',' + cy;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([x1, y1, x2, y2, b]);
        }
    }
  }
  const sides = new Map(), unassigned = [];
  let sampled = 0, placed = 0;
  for (const curb of curbs) {
    let cLen = 0, cPlaced = 0;
    for (const part of curb.coords) {
      const pts = part.map(project);
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], len = Math.hypot(x2 - x1, y2 - y1);
        if (!len) continue;
        const n = Math.max(1, Math.round(len / step)), w = len / n, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        for (let j = 0; j < n; j++) {
          const t = (j + 0.5) / n, px = x1 + t * (x2 - x1), py = y1 + t * (y2 - y1);
          cLen += w;
          let best = null;
          for (const [ax, ay, bx, by, b] of grid.get(cell(px) + ',' + cell(py)) || []) {
            const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
            if (!l2) continue;
            if (Math.abs(dx * ux + dy * uy) / Math.sqrt(l2) < cosMin) continue;
            const s = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
            const d = Math.hypot(px - ax - s * dx, py - ay - s * dy);
            if (d <= maxD && (!best || d < best.d)) best = { d, b, side: dx * (py - ay) - dy * (px - ax) > 0 ? 'L' : 'R' };
          }
          if (!best) continue;
          cPlaced += w;
          const key = best.b.id + '|' + best.side, label = curb.label || curb.rules.map((r) => r.join('|')).join(' ');
          if (!sides.has(key)) sides.set(key, { len: 0, dist: 0, scheds: new Map() });
          const s = sides.get(key);
          s.len += w; s.dist += w * best.d;
          if (!s.scheds.has(label)) s.scheds.set(label, { rules: curb.rules, len: 0 });
          s.scheds.get(label).len += w;
        }
      }
    }
    sampled += cLen; placed += cPlaced;
    if (cPlaced < cLen / 2) unassigned.push({ id: curb.id, len: Math.round(cLen) });
  }
  return { sides, unassigned, sampled, placed };
}

/**
 * The schedules a block side keeps: each one carried by at least `share` of the block's length and `minM` m of curb
 * (on a block shorter than minM / 0.6, 60% of its length): enough to leave out curb corners that reach a cross street.
 * Returns { rules (the kept schedules' rules, by weekday then hour), kept (how many schedules) }.
 */
export function keepRules(side, blockLen, { minM = 15, share = 0.15 } = {}) {
  const need = Math.max(Math.min(minM, 0.6 * blockLen), share * blockLen) - 0.5, seen = new Set(), rules = [];
  const kept = [...side.scheds.values()].filter((x) => x.len >= need);
  for (const { rules: rs } of kept) for (const r of rs) { const k = r.join('|'); if (!seen.has(k)) { seen.add(k); rules.push(r); } }
  rules.sort((x, y) => x[0] - y[0] || String(x[1]).localeCompare(String(y[1]), 'en', { numeric: true }));
  return { rules, kept: kept.length };
}

// ---------- names, numbers, neighborhoods ----------------------------------------------------------

const KEEP_UPPER = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
/** "14TH ST" → "14th St", "MC CLELLAN ST" → "Mc Clellan St", "O'CONNELL" → "O'Connell". */
export function titleCase(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').split(' ').map((w) => {
    if (KEEP_UPPER.has(w.toUpperCase())) return w.toUpperCase();
    if (/^\d/.test(w)) return w;                                   // 14th, 2nd
    return w.replace(/(^|[-'’(])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/^Mc([a-z])/, (m, c) => 'Mc' + c.toUpperCase());
  }).join(' ').replace(/'S\b/g, "'s");
}

const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
/** Lowest and highest house number, and which side (L|R along the block) holds the odd numbers, by a vote of the pieces. */
export function addresses(pieces, fields = ['adlf', 'adlt', 'adrf', 'adrt']) {
  const [lf, lt, rf, rt] = fields, all = [];
  let vote = 0;
  for (const { piece, fwd } of pieces) {
    const p = piece.props || piece;
    const L = [num(p[lf]), num(p[lt])].filter(Boolean), R = [num(p[rf]), num(p[rt])].filter(Boolean);
    all.push(...L, ...R);
    const lOdd = L.length ? L.every((n) => n % 2) : null, rOdd = R.length ? R.every((n) => n % 2) : null;
    let odd = null;
    if (lOdd === true && rOdd !== true) odd = 'L'; else if (rOdd === true && lOdd !== true) odd = 'R';
    else if (lOdd === false && rOdd === null) odd = 'R'; else if (rOdd === false && lOdd === null) odd = 'L';
    if (odd) vote += (fwd ? odd === 'L' : odd === 'R') ? 1 : -1;
  }
  return { n: all.length ? [Math.min(...all), Math.max(...all)] : null, o: vote > 0 ? 'L' : vote < 0 ? 'R' : null };
}

function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** The name of the polygon feature holding the point, or '' (GeoJSON Polygon / MultiPolygon, holes respected). */
export function hoodAt(pt, hoods, field) {
  for (const f of hoods) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (polys.some((rings) => inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h)))) return f.properties[field] || '';
  }
  return '';
}
// The City's organization names → the neighborhood names people use.
export const HOOD_NAME = { 'Santa Monica Mid-City Neighbors': 'Mid-City', 'Ocean Park Association': 'Ocean Park',
  'Pico Neighborhood Association': 'Pico', 'Wilshire/Montana Neighborhood Coalition': 'Wilshire Montana' };

/**
 * Cross street finder for block ends: `crossAt(point, name)` → the nearest other street whose line passes within
 * `near` m of the point (the layer does not always join cross streets to a node), or ''.
 */
export function crossStreets(pieces, { near = 12, project = xy } = {}) {
  const CELL = 40, cell = (v) => Math.floor(v / CELL), grid = new Map();
  for (const p of pieces) {
    if (!p.name) continue;
    const pts = p.coords.map(project);
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      for (let cx = cell(Math.min(x1, x2) - near); cx <= cell(Math.max(x1, x2) + near); cx++)
        for (let cy = cell(Math.min(y1, y2) - near); cy <= cell(Math.max(y1, y2) + near); cy++) {
          const k = cx + ',' + cy;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([x1, y1, x2, y2, p.name]);
        }
    }
  }
  return (pt, self) => {
    const [px, py] = project(pt);
    let best = null;
    for (const [x1, y1, x2, y2, name] of grid.get(cell(px) + ',' + cell(py)) || []) {
      if (name === self) continue;
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
      const d = Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
      if (d <= near && (!best || d < best.d || (d === best.d && name < best.name))) best = { d, name };
    }
    return best ? best.name : '';
  };
}

/** Halfway along a line, by length. */
export function midpoint(c) {
  let half = lineLen(c) / 2;
  for (let i = 1; i < c.length; i++) {
    const a = xy(c[i - 1]), b = xy(c[i]), d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d && half <= d) { const t = half / d; return [c[i - 1][0] + t * (c[i][0] - c[i - 1][0]), c[i - 1][1] + t * (c[i][1] - c[i - 1][1])]; }
    half -= d;
  }
  return c[c.length - 1];
}

// ---------- holidays ------------------------------------------------------------------------------

// santamonica.gov/street-sweeping (revised 2026-06-15, read 2026-10-18): "Street cleaning does not occur" on 13
// holidays; a holiday on a Saturday is kept the Friday before, one on a Sunday the Monday after. 2026 exceptions on the
// same page: Juneteenth (Fri Jun 19) and Independence Day (Fri Jul 3 and Sat Jul 4) have regular service. 2027 is
// derived by the same rule; the City posts each year's exceptions, so check the page again when 2027's appear.
// Left out, unverified: Juneteenth 2027 (in the page's FAQ list and on santamonica.gov/holiday-parking-enforcement,
// not in the main list, and swept in 2026), and Sat 2027-12-25 itself (Christmas is kept Fri Dec 24).
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Presidents' Day",
  '2026-03-30': 'Farmworkers Day', '2026-05-25': 'Memorial Day', '2026-09-07': 'Labor Day', '2026-11-11': 'Veterans Day',
  '2026-11-26': 'Thanksgiving Day', '2026-11-27': 'Day after Thanksgiving', '2026-12-24': 'Christmas Eve',
  '2026-12-25': 'Christmas Day', '2026-12-31': "New Year's Eve",
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Presidents' Day",
  '2027-03-29': 'Farmworkers Day', '2027-05-31': 'Memorial Day', '2027-07-05': 'Independence Day (observed)',
  '2027-09-06': 'Labor Day', '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving Day',
  '2027-11-26': 'Day after Thanksgiving', '2027-12-24': 'Christmas Eve and Christmas Day (observed)',
  '2027-12-31': "New Year's Eve and New Year's Day (observed)",
};

// ---------- build ---------------------------------------------------------------------------------

async function getJSON(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-city-build (+https://curb.guide)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const j = await r.json();
      if (j.error) throw new Error(`${url}: ${JSON.stringify(j.error)}`);
      return j;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 2000 * i));
    }
  }
}
/** Every feature of an ArcGIS layer as GeoJSON in WGS84, paged by object id order. */
export async function fetchLayer({ url, oid }, fetchJSON = getJSON) {
  const out = [];
  for (let off = 0; ; off += 2000) {
    const q = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'geojson', orderByFields: oid,
      resultOffset: off, resultRecordCount: 2000 });
    const page = await fetchJSON(`${url}/query?${q}`);
    out.push(...(page.features || []));
    if ((page.features || []).length < 2000 && !(page.properties && page.properties.exceededTransferLimit)) return out;
  }
}
async function cached(name, fetcher, refresh) {
  const f = CACHE + name;
  if (!refresh && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fetcher();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}
// Fail loudly when the City's data changes shape.
function expectShape(name, features, fields, min) {
  if (features.length < min) throw new Error(`${name}: ${features.length} features, expected at least ${min}`);
  const missing = fields.filter((k) => !(k in (features[0].properties || {})));
  if (missing.length) throw new Error(`${name}: no field ${missing.join(', ')} (the layer changed)`);
}

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const bboxOf = (cs) => {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [lo, la] of cs) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < s) s = la; if (la > n) n = la; }
  return [w, s, e, n];
};

async function main() {
  const refresh = process.argv.includes('--refresh');
  const sweeping = await cached(SOURCES.sweeping.file, () => { log('fetching the sweeping curbs…'); return fetchLayer(SOURCES.sweeping); }, refresh);
  const centerlines = await cached(SOURCES.centerlines.file, () => { log('fetching the street centerlines…'); return fetchLayer(SOURCES.centerlines); }, refresh);
  const hoods = await cached(SOURCES.hoods.file, () => { log('fetching the neighborhoods…'); return fetchLayer(SOURCES.hoods); }, refresh);
  expectShape('sweeping', sweeping, ['objectid', 'day', 'time'], 15000);
  expectShape('centerlines', centerlines, ['objectid_1', 'fullname', 'type', 'adlf', 'adlt', 'adrf', 'adrt'], 3000);
  expectShape('neighborhoods', hoods, ['neighbor'], 1);
  log(`${sweeping.length} curb lines, ${centerlines.length} centerlines, ${hoods.length} neighborhood areas`);

  // 1. curb lines and their rules
  const skipped = { noDay: 0, noDayLen: 0, unreadable: [] };
  const curbs = [], byWhy = {};
  for (const f of sweeping) {
    const p = f.properties, coords = partsOf(f.geometry).filter((c) => c.length > 1);
    if (!coords.length) continue;
    const { rules, why } = parseSchedule(p.day, p.time);
    if (why === 'no day') { skipped.noDay++; skipped.noDayLen += coords.reduce((s, c) => s + lineLen(c), 0); continue; }
    if (!rules.length) {
      byWhy[why] = (byWhy[why] || 0) + 1;
      skipped.unreadable.push({ id: p.objectid, day: p.day, time: p.time, why, m: Math.round(coords.reduce((s, c) => s + lineLen(c), 0)), at: midpoint(coords[0]).map(r6) });
      continue;
    }
    curbs.push({ id: p.objectid, coords, rules, label: `${p.day} ${String(p.time).trim()}` });
  }

  // 2. blocks: STREET centerlines (alleys, walkways, ramps and highways have no posted sweeping)
  const pieces = [];
  for (const f of centerlines) {
    const p = f.properties, parts = partsOf(f.geometry).filter((c) => c.length > 1);
    if (p.type !== 'STREET' || !p.fullname || !parts.length) continue;
    pieces.push({ id: p.objectid_1, name: p.fullname.trim(), coords: parts.flat(), props: p });
  }
  const ends = limits(pieces), byId = new Map(pieces.map((p) => [p.id, p]));
  // Pieces under 20 m with a cross street at both of their own ends are intersections and median crossings of divided
  // streets, where no one parks (CVC 22500): left out, with the curb that reaches into them.
  const crossNear = crossStreets(pieces);
  const crossing = (p) => lineLen(p.coords) < STUB_M && crossNear(p.coords[0], p.name) && crossNear(p.coords[p.coords.length - 1], p.name);
  const stubs = pieces.filter(crossing), blocks = pieces.filter((p) => !crossing(p));

  // 3. curbs → block sides
  const m = matchCurbs(curbs, blocks);
  const multi = [], dropped = { sides: 0, m: 0 };
  const out = [];
  const sidesByBlock = new Map();
  for (const [key, side] of m.sides) {
    const [id, lr] = key.split('|'), b = byId.get(+id);
    const { rules, kept } = keepRules(side, lineLen(b.coords));
    if (!rules.length) { dropped.sides++; dropped.m += side.len; continue; }
    if (kept > 1) multi.push({ c: String(b.id), s: titleCase(b.name), side: compass(b.coords, lr), rules });
    if (!sidesByBlock.has(b.id)) sidesByBlock.set(b.id, []);
    sidesByBlock.get(b.id).push([lr, compass(b.coords, lr), rules]);
  }
  for (const [id, d] of sidesByBlock) {
    const b = byId.get(id), { n, o } = addresses([{ piece: b, fwd: true }]), [a, z] = ends.get(b);
    const hood = HOOD_NAME[hoodAt(midpoint(b.coords), hoods, 'neighbor')] || '';
    out.push({ c: String(id), s: titleCase(b.name), l: [a, z].filter(Boolean).map(titleCase).join(' - '),
      ...(hood ? { h: hood } : {}), ...(n ? { n } : {}), ...(o ? { o } : {}),
      g: b.coords.map(([lo, la]) => [r6(lo), r6(la)]),
      d: d.sort((x, y) => x[0].localeCompare(y[0])) });
  }
  out.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));

  // 4. counts
  const ruleCount = out.reduce((s, b) => s + b.d.reduce((t, [, , r]) => t + r.length, 0), 0);
  const sideCount = out.reduce((s, b) => s + b.d.length, 0);
  const schedLen = curbs.reduce((s, c) => s + c.coords.reduce((t, x) => t + lineLen(x), 0), 0);
  const byRule = {};
  for (const b of out) for (const [, , rs] of b.d) for (const r of rs) {
    const k = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][r[0]]} ${r[1]}-${r[2]}`;
    byRule[k] = (byRule[k] || 0) + 1;
  }
  const unassignedIds = new Set(m.unassigned.map((u) => u.id));
  const unassignedExamples = curbs.filter((c) => unassignedIds.has(c.id)).map((c) => ({ id: c.id, m: Math.round(c.coords.reduce((s, x) => s + lineLen(x), 0)),
    rules: c.rules.length, at: midpoint(c.coords[0]).map(r6) })).sort((x, y) => y.m - x.m);

  // 5. write
  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: 'Street Sweeping (Public Works, Resource Recovery and Recycling)', url: 'https://gis.santamonica.gov/server/rest/services/Street_Sweeping/FeatureServer/0', license: 'ODC-By 1.0', fetched: today },
    { name: 'Street Centerlines', url: 'https://gis.santamonica.gov/server/rest/services/Street_Centerlines/FeatureServer/0', license: 'ODC-By 1.0', fetched: today },
    { name: 'Neighborhood Organizations', url: 'https://gis.santamonica.gov/server/rest/services/Neighborhood_Organizations/FeatureServer/0', license: 'ODC-By 1.0', fetched: today },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  const all = out.flatMap((b) => b.g);
  const [w, s, e, n] = bboxOf(all);
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'santa-monica', time_zone: 'America/Los_Angeles', generated: new Date().toISOString(), sources, blocks: out.length, sides: sideCount,
      format: 'b[] = {c: Street Centerlines objectid_1, s: street, l: cross streets, h: neighborhood organization area (4 of 7 published), n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
        + 'rule = [jsDow, from, to, weeksMask (31 = every week), monthsMask (0 = all year), flags (0: holidays stop it, no tow)]' },
    b: out }));

  const city = {
    id: 'santa-monica', name: 'Santa Monica', region: 'California', tz: 'America/Los_Angeles',
    center: [34.011, -118.4654], zoom: 15,   // the most swept blocks within 600 m (Sunset Park and Ocean Park, around 21st St)
    bounds: [[+(s - 0.002).toFixed(4), +(w - 0.002).toFixed(4)], [+(n + 0.002).toFixed(4), +(e + 0.002).toFixed(4)]],
    holidays: HOLIDAYS, holidaysSource: 'https://www.santamonica.gov/street-sweeping', holidayRule: 'all',
    fine: '$73', tow: 'no', fineSource: 'https://www.santamonica.gov/fines',
    agency: 'City of Santa Monica Public Works (Resource Recovery and Recycling)', scheduleUrl: 'https://www.santamonica.gov/street-sweeping',
    sources,
    words: {
      rule: 'Weekly street sweeping: no parking on the day and two hours on the curb\'s sign; the two sides of a street are usually swept on different days.',
      afterpass: 'All year · not on City holidays · $73 ticket, no tow',
      dataNotes: 'The City\'s street sweeping map data (Santa Monica GIS, updated September 2026, ODC-By) gives every curb its own line, day and hours, written without AM or PM: daytime windows are read from 9 AM to 5 PM as on the signs, and Pico Blvd\'s three nights a week as 3 to 6 AM. Each curb line was put on the side of the City\'s street centerline it runs along.',
    },
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1));

  const report = {
    generated: new Date().toISOString(),
    season: 'All year, weekly. No sweeping on the 13 City holidays of santamonica.gov/street-sweeping (2026: Juneteenth and Independence Day swept as usual). No make-up day.',
    input: { curbLines: sweeping.length, withDayAndHours: curbs.length, noDay: skipped.noDay, noDayKm: +(skipped.noDayLen / 1000).toFixed(1),
      unreadable: skipped.unreadable.length, unreadableWhy: byWhy, scheduledKm: +(schedLen / 1000).toFixed(1),
      centerlines: centerlines.length, streetCenterlines: pieces.length, intersectionPiecesLeftOut: stubs.length },
    placement: {
      method: 'Each scheduled curb line sampled every 5 m; a sample goes to the nearest block line (a STREET centerline) within 30 m whose direction is within about 37 degrees of the curb, on the side where it lies. A side keeps a schedule carried by at least 15% of the block length and 15 m of curb (60% of a block shorter than 25 m).',
      sampledKm: +(m.sampled / 1000).toFixed(1), placedKm: +(m.placed / 1000).toFixed(1), placedShare: +(m.placed / m.sampled).toFixed(4),
      curbLinesMostlyUnplaced: m.unassigned.length, curbLinesMostlyUnplacedKm: +(m.unassigned.reduce((s2, u) => s2 + u.len, 0) / 1000).toFixed(2),
      unplacedExamples: unassignedExamples.slice(0, 15),
      sidesBelowThreshold: dropped.sides, sidesBelowThresholdKm: +(dropped.m / 1000).toFixed(2),
      sidesWithSeveralRules: multi.length, severalRulesExamples: multi.slice(0, 15),
    },
    output: { blocks: out.length, sides: sideCount, rules: ruleCount, rulesByDayAndHours: byRule,
      oddSideKnown: out.filter((b) => b.o).length, withNeighborhood: out.filter((b) => b.h).length },
    skipped: { noDay: `${skipped.noDay} curb lines (${(skipped.noDayLen / 1000).toFixed(1)} km) have no sweeping day: not swept, or not posted`,
      unreadable: skipped.unreadable },
    ticketCheck: 'Santa Monica publishes no parking citations with time and place (data.santamonica.gov has none), so no cross-check.',
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1));
  log(`curbs: ${curbs.length} with a day and hours, ${skipped.noDay} without a day, ${skipped.unreadable.length} unreadable`);
  log(`placed ${(m.placed / 1000).toFixed(1)} of ${(m.sampled / 1000).toFixed(1)} km; ${m.unassigned.length} curb lines mostly unplaced; ${dropped.sides} sides under the threshold`);
  log(`${out.length} blocks, ${sideCount} sides, ${ruleCount} rules, ${multi.length} sides with several rules`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/santa-monica/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
