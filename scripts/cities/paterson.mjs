#!/usr/bin/env node
// Paterson, NJ for CURB (2026-10-18; format in docs/multi-city/city-build.md, research in docs/multi-city/paterson.md).
// Builds data/paterson/ from three public layers:
//
//   1. City of Paterson Street Sweeping Map (the City's ArcGIS Online map, last edited 2026-07-29): 601 route lines, each
//      with its route ("Route 3A&3B") and a Time ("Monday& Tuesday 8:00AM - 12:00PM", "Daily 6:00AM - 8:00AM"). The lines
//      have no street name, no block id and no side: a route is swept on two days and the map does not say which side
//      goes on which day.
//   2. NJOGIS Road Centerlines of NJ (NG9-1-1), the State's street centerlines, one line per block with names and address
//      ranges. Each City line is laid onto the blocks it runs along (every 4 m of a block within 10 m of a City line going
//      the same way); the block's own RCL_NGUID is its id.
//   3. The City's ward boundaries (only the ward number is read), for each block's ward and the welcome card.
//
// Sides: the City publishes no side convention (no page, PDF or map says "north side Monday"), so both days go on both
// sides and the words say so (as in Chicago's build): each side is really swept on one of the two days; the sign says which.
//
// Run: node scripts/cities/paterson.mjs [--refresh]   (Node 18+; inputs cached in private/cache/paterson/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/paterson/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/paterson/';
const log = (...a) => console.error('[paterson]', ...a);

export const SWEEP = 'https://services7.arcgis.com/24MTNeTGsw9FVZm6/arcgis/rest/services/City_of_Paterson_Street_Sweeping_Map_WFL1/FeatureServer/0';
export const SWEEP_MAP = 'https://www.arcgis.com/apps/mapviewer/index.html?webmap=59a6a355c8384b9da3f0d9afee8f61ae';
export const ROADS = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/ArcGIS/rest/services/Tran_road/FeatureServer/0';
export const WARDS = 'https://services7.arcgis.com/24MTNeTGsw9FVZm6/arcgis/rest/services/Paterson_Ward_Lookup_Map/FeatureServer/0';
export const TZ = 'America/New_York';
// Paterson's code in the State's centerlines (INCMUNI_L / INCMUNI_R hold the municipality's GNIS id).
export const PATERSON = '885343';
const ENVELOPE = [-74.215, 40.880, -74.120, 40.950];
// Only the fields the build reads. The State's layer also has an editor's user name (EDITOR) and the ward layer the council
// members' names: never requested, never cached.
const ROAD_FIELDS = ['OBJECTID', 'RCL_NGUID', 'FROMADDR_L', 'TOADDR_L', 'FROMADDR_R', 'TOADDR_R', 'PARITY_L', 'PARITY_R',
  'ST_PREDIR', 'ST_NAME', 'ST_POSTYP', 'ST_POSDIR', 'PRIMENAME', 'LST_PNAME', 'INCMUNI_L', 'INCMUNI_R', 'ROADCLASS', 'STATUSTYP'];
// Ramps (S1630) and the limited access highways (S1100: I-80, Routes 19 and 20) have no curb parking.
export const NO_CURB = new Set(['S1100', 'S1630']);

// ---------- the rule ------------------------------------------------------------------------------------------------------

// Paterson Code § 435-131 (ecode360.com/8554346): an unoccupied vehicle parked on a street during its designated street
// cleaning days and hours "shall be removed" at the owner's cost; § 435-132: a $50 fine, plus $30 court costs. flags 2 = towable.
export const FLAGS = 2;
const DAY = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
// "8:00AM" → 8, "12:00PM" → 12, "3:30PM" → "15:30" (whole hours as numbers, minutes as "H:MM", as the spec says)
export function clock(s) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i.exec(String(s || '').trim());
  if (!m || +m[1] > 12 || +m[2] > 59) return null;
  const h = (+m[1] % 12) + (m[3].toUpperCase() === 'P' ? 12 : 0);
  return +m[2] ? `${h}:${m[2]}` : h;
}
// The map's Time → { days: [JS weekday], from, to }, or null when it gives no hours ("Saturday", Bunker Hill's route).
// "Daily" is read as all seven days: the map says Daily and nothing narrows it (see the report's unverified list).
export function parseTime(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  let m = /^daily (\S+) ?- ?(\S+)$/i.exec(t);
  if (m) {
    const from = clock(m[1]), to = clock(m[2]);
    return from === null || to === null ? null : { days: [0, 1, 2, 3, 4, 5, 6], from, to };
  }
  m = /^([a-z]+) ?& ?([a-z]+) (\S+) ?- ?(\S+)$/i.exec(t);
  if (!m) return null;
  const a = DAY[m[1].toLowerCase()], b = DAY[m[2].toLowerCase()], from = clock(m[3]), to = clock(m[4]);
  if (a === undefined || b === undefined || a === b || from === null || to === null) return null;
  return { days: [a, b].sort((x, y) => x - y), from, to };
}
// Every week, all year (31, 0), towable. Both sides get every rule of the route (the map has no side).
export const rulesFor = (time) => time.days.map((dow) => [dow, time.from, time.to, 31, 0, FLAGS]);

// City Hall closing days, from the City's monthly "What's happening" calendars (Public Works news, patersonnj.gov). A day
// marked "CITY HALL CLOSED" there is listed as verified; the months with no calendar online (January, July, November 2026)
// and all of 2027 are filled in with the same holidays and the federal weekend rule (Saturday → Friday, Sunday → Monday).
// Whether street cleaning stops on these days is not published: unverified (report.json).
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Presidents' Day",
  '2026-04-03': 'Good Friday', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day', '2026-10-12': 'Columbus Day',
  '2026-11-11': 'Veterans Day', '2026-11-26': 'Thanksgiving Day', '2026-12-24': 'Christmas Eve', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Presidents' Day",
  '2027-03-26': 'Good Friday', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day', '2027-10-11': 'Columbus Day',
  '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving Day', '2027-12-24': 'Christmas Day (observed)',
  '2027-12-31': "New Year's Day (observed)",
};
// The 2026 days seen as "CITY HALL CLOSED" on the City's own calendars (Dec 2025 to Oct 2026).
export const HOLIDAYS_SEEN = ['2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-09-07', '2026-10-12'];

// ---------- names, numbers, sides ----------------------------------------------------------------------------------------

const DIRS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const word = (w) => w.split('-').map((p) => {
  if (/^\d+(ST|ND|RD|TH)$/.test(p)) return p.toLowerCase();
  if (/^MC[A-Z]{2,}$/.test(p)) return 'Mc' + p[2] + p.slice(3).toLowerCase();
  if (/^O'[A-Z]{2,}$/.test(p)) return "O'" + p[2] + p.slice(3).toLowerCase();
  return p.charAt(0) + p.slice(1).toLowerCase();
}).join('-');
// "E 18TH ST" → "E 18th St", "MCBRIDE AVE" → "McBride Ave"
export function titleCase(s) {
  const w = String(s || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
  return w.map((x) => (DIRS.has(x) ? x : word(x))).join(' ');
}
const TYPE = { Street: 'St', Avenue: 'Ave', Road: 'Rd', Place: 'Pl', Terrace: 'Ter', Court: 'Ct', Boulevard: 'Blvd', Drive: 'Dr',
  Lane: 'Ln', Parkway: 'Pkwy', Highway: 'Hwy', Circle: 'Cir', Square: 'Sq', Plaza: 'Plz', Alley: 'Aly', Turnpike: 'Tpke' };
const DIR = { North: 'N', South: 'S', East: 'E', West: 'W' };
// The street as people say it: the State's legacy short name ("E MAIN ST"), else its parts, abbreviated.
export function streetName(p) {
  if (String(p.LST_PNAME || '').trim()) return titleCase(p.LST_PNAME);
  const parts = [DIR[p.ST_PREDIR] || p.ST_PREDIR, p.ST_NAME, TYPE[p.ST_POSTYP] || p.ST_POSTYP, DIR[p.ST_POSDIR] || p.ST_POSDIR];
  return titleCase(parts.filter(Boolean).join(' ')) || titleCase(p.PRIMENAME);
}
// The State's placeholder for a street with no name.
export const isStreetName = (name) => !!name && !/^unnamed( segment)?$/i.test(name);
const num = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : null; };
// Which side (looking from the line's first point to its last) has the odd house numbers: the State's parity, else the ranges.
export function oddSide(p) {
  const par = (flag, a, b) => (flag === 'O' ? 1 : flag === 'E' ? 0 : (() => { const n = num(a) ?? num(b); return n === null ? null : n % 2; })());
  const l = par(p.PARITY_L, p.FROMADDR_L, p.TOADDR_L), r = par(p.PARITY_R, p.FROMADDR_R, p.TOADDR_R);
  if (l === 1 && r !== 1) return 'L';
  if (r === 1 && l !== 1) return 'R';
  return null;
}
export function houseRange(p) {
  const n = [p.FROMADDR_L, p.TOADDR_L, p.FROMADDR_R, p.TOADDR_R].map(num).filter((v) => v !== null);
  return n.length ? [Math.min(...n), Math.max(...n)] : null;
}

const LAT0 = 40.915, LON0 = -74.17, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
export const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
export const lengthM = (c) => { let s = 0; for (let i = 1; i < c.length; i++) { const a = xy(c[i - 1]), b = xy(c[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
// The compass word for one side of a line, as in scripts/cities/boston.mjs.
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;
export function round6(c) {
  const out = [];
  for (const [lo, la] of c) { const p = [r6(lo), r6(la)]; const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
  return out;
}
export function midpoint(c) {
  let half = lengthM(c) / 2;
  for (let i = 1; i < c.length; i++) {
    const a = xy(c[i - 1]), b = xy(c[i]), d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d && half <= d) { const t = half / d; return [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t]; }
    half -= d;
  }
  return c[c.length - 1];
}
export function inPolygon([x, y], geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  for (const rings of polys) {
    let inside = false;
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
export const wardName = (w) => { const n = parseInt(w, 10); return n > 0 ? `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} Ward` : ''; };
export const parts = (g) => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

// Cross streets at a line's ends: the other streets meeting there. Where only the same street goes on (a line split
// mid-block), walk on along it to the next corner, at most 12 lines; a dead end or a fork gives ''.
export function crossStreets(lines) {
  const canon = new Map();
  const key = ([lo, la]) => {   // ends on a 1e-5 degree grid (about 1 m); an end within one cell of a known one joins it
    const i = Math.round(lo * 1e5), j = Math.round(la * 1e5);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const k = (i + di) + ',' + (j + dj); if (canon.has(k)) return canon.get(k); }
    const k = i + ',' + j; canon.set(k, k); return k;
  };
  const at = new Map(), ends = [];
  lines.forEach(({ c, name }, idx) => {
    if (!c || c.length < 2 || !name) return;
    const a = key(c[0]), b = key(c[c.length - 1]);
    ends[idx] = [a, b];
    for (const [n, o] of [[a, b], [b, a]]) { if (!at.has(n)) at.set(n, []); at.get(n).push({ idx, o, name }); }
  });
  return (idx, end) => {   // end 0 = the line's first point, 1 = its last
    if (!ends[idx]) return '';
    const own = lines[idx].name;
    let node = ends[idx][end], cur = idx;
    for (let hop = 0; hop < 12; hop++) {
      const here = at.get(node) || [];
      const other = [...new Set(here.filter((x) => x.name !== own).map((x) => x.name))].sort();
      if (other.length) return other[0];
      const next = here.filter((x) => x.idx !== cur);
      if (next.length !== 1) return '';
      cur = next[0].idx; node = next[0].o;
    }
    return '';
  };
}

// ---------- laying the City's lines onto the State's blocks ------------------------------------------------------------

// TOL: the first pass (any street). TOL2: the second pass, only for a City line already laid on blocks of the same street
// name (hand-drawn lines drift: South Main St's line runs up to 27 m off the centerline at its southern end).
export const STEP = 4, TOL = 10, TOL2 = 30, MIN_COS = 0.85, END_SKIP = 5, MIN_COVER = 0.5, MIN_SHARE = 0.25, MIN_BLOCK = 8;
// A grid of every City line's pieces (in meters), for "which City line runs along here" lookups.
export function lineIndex(lines, tol = TOL, cellM = 40) {
  const grid = new Map(), cell = (v) => Math.floor(v / cellM);
  for (const it of lines) for (const part of it.parts) {
    const pts = part.map(xy);
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      if (x1 === x2 && y1 === y2) continue;
      for (let cx = cell(Math.min(x1, x2) - tol); cx <= cell(Math.max(x1, x2) + tol); cx++)
        for (let cy = cell(Math.min(y1, y2) - tol); cy <= cell(Math.max(y1, y2) + tol); cy++) {
          const k = cx + ',' + cy;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([x1, y1, x2, y2, it]);
        }
    }
  }
  // the nearest line within tol that runs within ~32 degrees of direction (ux, uy) and passes `ok`
  return ([px, py], [ux, uy], ok) => {
    let best = null;
    for (const [x1, y1, x2, y2, it] of grid.get(cell(px) + ',' + cell(py)) || []) {
      if (ok && !ok(it)) continue;
      const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy);
      if (Math.abs((dx * ux + dy * uy) / l) < MIN_COS) continue;
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (l * l)));
      const d = Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
      if (d <= tol && (!best || d < best.d)) best = { d, it };
    }
    return best;
  };
}
// Points every STEP meters along a line (skipping END_SKIP at each end, where cross streets' lines come close), with direction.
export function samples(c) {
  const out = [], pts = c.map(xy), total = lengthM(c);
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], l = Math.hypot(x2 - x1, y2 - y1);
    if (!l) continue;
    const ux = (x2 - x1) / l, uy = (y2 - y1) / l;
    for (let s = (STEP - (run % STEP)) % STEP; s <= l; s += STEP) {
      const at = run + s;
      if (at >= END_SKIP && at <= total - END_SKIP) out.push([[x1 + ux * s, y1 + uy * s], [ux, uy]]);
    }
    run += l;
  }
  if (!out.length && pts.length >= 2) {   // very short block: its middle
    const m = xy(midpoint(c)), [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1], l = Math.hypot(x2 - x1, y2 - y1) || 1;
    out.push([m, [(x2 - x1) / l, (y2 - y1) / l]]);
  }
  return out;
}
// Which City lines a block runs along: { cover (share of the block on any line), shares: Map(line → share) }.
export function matchBlock(c, near, ok) {
  const ss = samples(c), shares = new Map();
  let hit = 0;
  for (const [p, u] of ss) {
    const n = near(p, u, ok);
    if (!n) continue;
    hit++;
    shares.set(n.it, (shares.get(n.it) || 0) + 1);
  }
  for (const [k, v] of shares) shares.set(k, v / ss.length);
  return { cover: ss.length ? hit / ss.length : 0, shares };
}

// ---------- fetching ----------------------------------------------------------------------------------------------------

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-paterson-build (+https://curb.guide)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const j = await r.json();
      if (j.error) throw new Error(`ArcGIS error ${JSON.stringify(j.error)} for ${url}`);
      return j;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 2000 * i));
    }
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
async function allFeatures(layer, fields, extra = {}) {
  const out = [];
  for (let off = 0; ; off += 2000) {
    const q = new URLSearchParams({ where: '1=1', outFields: fields.join(','), orderByFields: 'OBJECTID', resultOffset: off,
      resultRecordCount: 2000, outSR: '4326', f: 'geojson', ...extra });
    const page = (await getJSON(`${layer}/query?${q}`)).features || [];
    out.push(...page);
    if (page.length < 2000) return out;
  }
}

// ---------- the build ---------------------------------------------------------------------------------------------------

function assertShape(sweep, roads, wards) {
  if (!Array.isArray(sweep) || sweep.length < 450 || sweep.length > 800)
    throw new Error(`Street Sweeping Map: expected 450 to 800 lines, got ${sweep && sweep.length}. The layer changed: check it before trusting a build.`);
  const missing = ['OBJECTID', 'Route', 'Time'].filter((k) => !(k in sweep[0].properties));
  if (missing.length) throw new Error(`Street Sweeping Map: fields missing: ${missing.join(', ')}`);
  const unread = [...new Set(sweep.map((f) => f.properties.Time))].filter((t) => !parseTime(t) && !/^saturday$/i.test(String(t).trim()));
  if (unread.length) throw new Error(`Street Sweeping Map: Time values the build cannot read: ${unread.join(' | ')}`);
  if (roads.length < 5000) throw new Error(`Road centerlines: expected over 5,000 lines around Paterson, got ${roads.length}`);
  if (!roads.some((f) => f.properties.INCMUNI_L === PATERSON)) throw new Error(`Road centerlines: no line coded ${PATERSON} (Paterson): the municipality codes changed`);
  if (wards.length !== 6) throw new Error(`Wards: expected 6, got ${wards.length}`);
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const fetched = new Date().toISOString().slice(0, 10);
  const sweep = await cached('street-sweeping-map.json', async () => { log('fetching the Street Sweeping Map…'); return allFeatures(SWEEP, ['OBJECTID', 'Route', 'Time']); }, refresh);
  const roads = await cached('road-centerlines.json', async () => {
    log('fetching road centerlines…');
    return allFeatures(ROADS, ROAD_FIELDS, { geometry: ENVELOPE.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' });
  }, refresh);
  const wards = await cached('wards.json', async () => { log('fetching wards…'); return allFeatures(WARDS, ['OBJECTID', 'Ward']); }, refresh);
  assertShape(sweep, roads, wards);
  log(`${sweep.length} City lines, ${roads.length} road centerlines, ${wards.length} wards`);

  // ---- the City's lines ----
  const routes = new Map();   // route → { times: Set, lines }
  const lines = [], noHours = [];
  for (const f of sweep) {
    const p = f.properties, time = parseTime(p.Time);
    const it = { id: String(p.OBJECTID), route: String(p.Route || '').trim(), time: String(p.Time || '').trim(), parts: parts(f.geometry), rules: time ? rulesFor(time) : null };
    if (!routes.has(it.route)) routes.set(it.route, { times: new Set(), lines: 0 });
    routes.get(it.route).times.add(it.time); routes.get(it.route).lines++;
    if (!it.parts.length) continue;
    lines.push(it);
    if (!time) noHours.push(it);
  }
  const near = lineIndex(lines);

  // ---- blocks: the State's centerlines that run along a City line ----
  // cross streets: every centerline but ramps and highways (a block ending at an on-ramp names the street, not the ramp)
  const crossAt = crossStreets(roads.map((f) => (NO_CURB.has(f.properties.ROADCLASS) || !isStreetName(streetName(f.properties))
    ? { c: null, name: '' } : { c: parts(f.geometry)[0], name: streetName(f.properties) })));

  const skipped = new Map();
  const skip = (why, ex) => {
    if (!skipped.has(why)) skipped.set(why, { why, count: 0, examples: [] });
    const s = skipped.get(why); s.count++;
    if (s.examples.length < 5) s.examples.push(ex);
  };
  const checks = { secondPass: 0, partial: 0, multiSchedule: 0, multiScheduleExamples: [], noOddSide: 0, noCrossStreet: 0, noWard: 0, cityLimitOneSide: 0 };
  // Pass 1: blocks within TOL of a City line. Pass 2: blocks within TOL2 of a City line already laid on that street name.
  const eligible = roads.map((f, i) => ({ i, p: f.properties, c: parts(f.geometry)[0] }))
    .filter(({ p, c }) => c && c.length >= 2 && !NO_CURB.has(p.ROADCLASS));
  const accepted = [], follows = new Map();   // City line → Set of street names it was laid on
  for (const r of eligible) {
    const m = matchBlock(r.c, near);
    if (m.cover < MIN_COVER) continue;
    r.m = m; accepted.push(r);
    const name = streetName(r.p);
    for (const [it, s] of m.shares) if (s >= MIN_SHARE) { if (!follows.has(it)) follows.set(it, new Set()); follows.get(it).add(name); }
  }
  const near2 = lineIndex(lines, TOL2);
  for (const r of eligible) {
    if (r.m) continue;
    const name = streetName(r.p);
    const m = matchBlock(r.c, near2, (it) => follows.has(it) && follows.get(it).has(name));
    if (m.cover < MIN_COVER) continue;
    r.m = m; r.second = true; accepted.push(r);
  }
  const blocks = [];
  for (const { i, p, c, m, second } of accepted) {
    const on = [...m.shares].filter(([, s]) => s >= MIN_SHARE).map(([it]) => it);
    if (!on.length) continue;
    const name = streetName(p), L = lengthM(c);
    const ex = { id: p.RCL_NGUID, street: name, cover: Math.round(m.cover * 100) / 100, routes: [...new Set(on.map((it) => it.route))] };
    if (second) checks.secondPass++;
    if (L < MIN_BLOCK) { skip(`block under ${MIN_BLOCK} m (an intersection sliver)`, ex); continue; }
    if (!isStreetName(name)) { skip('no street name on the centerline (blank or "Unnamed Segment")', ex); continue; }
    if (!p.RCL_NGUID) { skip('no RCL_NGUID (no stable id)', ex); continue; }
    const withHours = on.filter((it) => it.rules);
    if (!withHours.length) { skip('only on a route with no hours on the map (Bunker Hill, "Saturday")', ex); continue; }
    // the City's rule reaches only its own curbs: a side coded to a neighboring town (Clifton, Haledon, Prospect Park, Totowa)
    // is left out, a block with neither side in Paterson too (the City's line runs past its limit)
    const ownSides = ['L', 'R'].filter((side) => (side === 'L' ? p.INCMUNI_L : p.INCMUNI_R) === PATERSON);
    if (!ownSides.length) { skip('outside Paterson (both sides in a neighboring town)', ex); continue; }
    if (ownSides.length === 1) checks.cityLimitOneSide++;
    if (m.cover < 0.8) checks.partial++;
    const times = [...new Set(withHours.map((it) => it.time))].sort();
    if (times.length > 1) { checks.multiSchedule++; if (checks.multiScheduleExamples.length < 8) checks.multiScheduleExamples.push({ ...ex, times }); }
    const rules = new Map();
    for (const it of withHours) for (const r of it.rules) rules.set(r.join('|'), r);
    const sorted = [...rules.values()].sort((a, b) => a[0] - b[0] || String(a[1]).localeCompare(String(b[1])));
    const g = round6(c);
    if (g.length < 2) { skip('line collapses to one point at 6 decimals', ex); continue; }
    const a = crossAt(i, 0), b = crossAt(i, 1);
    if (!a && !b) checks.noCrossStreet++;
    const mid = midpoint(c), w = wards.find((x) => inPolygon(mid, x.geometry));
    if (!w) checks.noWard++;
    const n = houseRange(p), odd = oddSide(p);
    if (!odd) checks.noOddSide++;
    blocks.push({ c: String(p.RCL_NGUID), s: name, l: a && b && a !== b ? `${a} - ${b}` : a || b,
      ...(w ? { h: wardName(w.properties.Ward) } : {}), ...(n ? { n } : {}), ...(odd ? { o: odd } : {}), g,
      d: ownSides.map((side) => [side, compass(g, side), sorted.map((r) => r.slice())]),
      _routes: ex.routes });
  }
  const ids = new Set();
  for (const b of blocks) { if (ids.has(b.c)) throw new Error(`duplicate block id ${b.c}`); ids.add(b.c); }
  blocks.sort((x, y) => x.s.localeCompare(y.s) || x.l.localeCompare(y.l) || x.c.localeCompare(y.c));

  // ---- City lines that found no block (drawn off the State's streets, or along a ramp or highway) ----
  // a City line counts as placed where a block of the output runs along it (within TOL2, same direction), whichever line
  // the block was laid from: several lines are drawn twice
  const blockNear = lineIndex(blocks.map((b) => ({ parts: [b.g] })), TOL2);
  const placedShare = (it) => { let n = 0, hit = 0; for (const c of it.parts) for (const [pt, u] of samples(c)) { n++; if (blockNear(pt, u)) hit++; } return n ? hit / n : 1; };
  const unplaced = lines.filter((it) => it.rules && placedShare(it) < 0.3);
  const routeBlocks = {};
  for (const b of blocks) for (const r of b._routes) routeBlocks[r] = (routeBlocks[r] || 0) + 1;
  for (const b of blocks) delete b._routes;

  // ---- write ----
  const sides = blocks.reduce((s, b) => s + b.d.length, 0), rules = blocks.reduce((s, b) => s + b.d.reduce((t, d) => t + d[2].length, 0), 0);
  let W = 180, S = 90, E = -180, N = -90;
  for (const b of blocks) for (const [lo, la] of b.g) { W = Math.min(W, lo); E = Math.max(E, lo); S = Math.min(S, la); N = Math.max(N, la); }
  const pad = 0.004, r4 = (v) => Math.round(v * 1e4) / 1e4;
  const bboxOf = (geom) => {
    let w = 180, s = 90, e = -180, n = -90;
    const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
    for (const ring of rings) for (const [lo, la] of ring) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
    return [w, s, e, n].map((v) => v.toFixed(4)).join(',');
  };
  const sources = [
    { name: 'Street Sweeping Map (City of Paterson; routes, days and hours)', url: SWEEP,
      license: 'Public layer, no license stated; the City asks users of its open data to cite the City of Paterson Open Data Portal', fetched },
    { name: 'Road Centerlines of NJ, NG9-1-1 (NJ Office of GIS; block lines, names, address ranges)', url: ROADS,
      license: 'NJOGIS conditions of use (njgin, "as is"); acknowledgement of NJOGIS requested', fetched },
    { name: 'Ward boundaries (City of Paterson)', url: WARDS, license: 'Public layer, no license stated', fetched },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'paterson', time_zone: TZ, generated: new Date().toISOString(), sources, blocks: blocks.length, sides,
      format: 'b[] = {c: RCL_NGUID of the State NG9-1-1 centerline block, s: street, l: cross streets (first point to last), h: ward, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
        + 'rule = [jsDow, from, to, weeksMask (31 = every week), monthsMask (0 = all year), flags (2 = towable)]. Both sides carry both days of their route: the City\'s map does not say which side is swept on which day.' },
    b: blocks }));

  const city = {
    id: 'paterson', name: 'Paterson', region: 'New Jersey', tz: TZ,
    center: [40.9165, -74.1718], zoom: 15, bounds: [[r4(S - pad), r4(W - pad)], [r4(N + pad), r4(E + pad)]],
    holidays: HOLIDAYS, holidaysSource: 'https://www.patersonnj.gov/egov/apps/document/center.egov?view=browse&eGov_searchType=62&eGov_searchDepartment=20',
    holidayRule: 'all',
    fine: '$50', tow: 'yes', fineSource: 'https://ecode360.com/8554348',
    agency: 'Paterson Department of Public Works', scheduleUrl: SWEEP_MAP,
    sources,
    words: {
      rule: 'No parking on your block during its posted street cleaning hours: most routes twice a week, 8 AM to noon or 1 to 3:30 PM, and downtown daily 6 to 8 AM.',
      afterpass: 'On two-day routes each side is swept on one of the two days; the sign says which · $50 ticket plus $30 court costs, and the car can be towed',
      dataNotes: 'Routes, days and hours come from the City of Paterson\'s Street Sweeping Map (July 2026), laid block by block onto the State\'s street centerlines. The map gives each route two days but not which side is swept on which day, so both sides show both days: the posted sign on your side says which one is yours. Bunker Hill\'s Saturday route has no hours on the map and is not shown.',
    },
    neighborhoods: wards.slice().sort((x, y) => +x.properties.Ward - +y.properties.Ward).map((x) => ({ name: wardName(x.properties.Ward), bbox: bboxOf(x.geometry) })),
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1) + '\n');

  const timeCounts = {};
  for (const f of sweep) timeCounts[f.properties.Time] = (timeCounts[f.properties.Time] || 0) + 1;
  const report = {
    generated: new Date().toISOString(),
    inputs: { cityLines: sweep.length, cityLinesWithGeometry: lines.length, routes: routes.size, roadCenterlines: roads.length, wards: wards.length,
      linesByTime: timeCounts, mapLastEdited: '2026-07-29 (the layer\'s editingInfo)' },
    output: { blocks: blocks.length, sides, rules, sizeBytes: 0,
      blocksByRoute: Object.fromEntries(Object.entries(routeBlocks).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) },
    season: { from: null, to: null, note: 'All year: no season is published for 2026. In past years the City announced restarts after a winter pause (Feb 3, 2020; Apr 4, 2022), so a winter pause may exist.' },
    skipped: [
      { why: 'City lines on a route with no hours (Bunker Hill, Time "Saturday")', count: noHours.length, examples: noHours.slice(0, 5).map((it) => ({ id: it.id, route: it.route, time: it.time })) },
      { why: 'City lines with hours that run along no State centerline block for most of their length (drawn across blocks or off the streets, or along an I-80 ramp)', count: unplaced.length,
        examples: unplaced.map((it) => ({ id: it.id, route: it.route, time: it.time, meters: Math.round(it.parts.reduce((s, c) => s + lengthM(c), 0)) })) },
      ...[...skipped.values()].sort((a, b) => b.count - a.count),
    ],
    checks: { ...checks,
      method: `Each State centerline block (ramps and limited access highways left out) is sampled every ${STEP} m, ${END_SKIP} m in from each end; a sample counts when a City line runs within ${TOL} m of it in the same direction (within about 32 degrees). A block is swept when at least ${MIN_COVER * 100}% of its samples are on City lines; it takes the rules of every City line holding at least ${MIN_SHARE * 100}% of them. A second pass widens the distance to ${TOL2} m, but only for a City line already laid on blocks of the same street name (hand-drawn lines drift, South Main St's by up to 27 m: ${checks.secondPass} blocks were placed by this pass). 97% of the City lines' points lie within 6 m of a State centerline.`,
      partial: `${checks.partial} blocks are covered between ${MIN_COVER * 100}% and 80% (a City line ending mid-block)`,
    },
    assumptions: [
      'Both sides of a block carry both days of its route. The City\'s map gives each route two days (routes are named "3A&3B": one side each day, apparently) but no side, and no City page, PDF or ordinance found online says which side goes on which day. A resident on one side is told about both days; the posted sign gives the one day for that side.',
      '"Daily 6:00AM - 8:00AM" (the Downtown route) is read as every day of the week, Sunday included, because the map says Daily.',
      'Every swept block is towable (flags 2): Paterson Code § 435-131 says vehicles parked during the designated street cleaning days and hours shall be removed at the owner\'s cost; § 435-132 sets the fine at $50 plus $30 court costs.',
      'All year (months 0): no season is published for 2026.',
      'A block takes the rules of every City line laid on it; where two routes overlap (a street on a route boundary), the block shows both schedules.',
      'Only Paterson\'s own curbs: on a street along the city limit (46 blocks) only the side the State codes to Paterson is shown, and 11 blocks wholly in Clifton, Haledon, Prospect Park or Totowa that the City\'s lines run onto are left out.',
      'Block ids (c) are the State\'s RCL_NGUID for the centerline block, not the City\'s line OBJECTID: the City republished its map as a new layer in July 2026 (its earlier copy, "Street Sweeping Route and Time", has other ids), while the State\'s ids have been stable since 2013.',
      'Holidays: the days City Hall closed in 2026 on the City\'s own monthly calendars (Presidents\' Day, Good Friday, Memorial Day, Juneteenth, Labor Day, Columbus Day; Christmas Eve and Christmas in December 2025), with the usual federal holidays for the months with no calendar online and all of 2027 derived the same way.',
    ],
    unverified: [
      'Which side is swept on which of the two days, on every route (the main gap).',
      'That street cleaning stops on City holidays (holidayRule "all" is the City\'s office closing list; no page says sweeping follows it).',
      'Whether "Daily" downtown includes Sunday (and Saturday).',
      'Bunker Hill\'s Saturday route: no hours on the map, so it is left off.',
      'A winter pause: in 2020 and 2022 the City announced dates when cleaning and enforcement resumed.',
      'The 2026 holidays in January, July and November, and every 2027 holiday (derived, not published).',
    ],
    questionsForCity: [
      'On a route swept two days a week (for example Route 3A&3B, Monday and Tuesday 8 AM to noon), which side is swept on which day? Is there a rule (north and east sides on the first day) or a list by street?',
      'Does "Daily 6:00AM - 8:00AM" downtown include Saturday and Sunday?',
      'What are the hours of the Bunker Hill route swept on Saturdays?',
      'Is street cleaning (and its ticketing) suspended on City holidays, and on which days? Is there a winter pause, and when does it start and end?',
      'Will the Street Sweeping Map layer keep its fields (Route, Time) when it is updated, and can it carry the street names and the side for each day?',
    ],
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');
  report.output.sizeBytes = fs.statSync(OUT + 'segments.json').size;
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');
  log(`${blocks.length} blocks, ${sides} sides, ${rules} rules; ${unplaced.length} City lines placed on no block; ${noHours.length} lines with no hours`);
  log(`skipped: ${[...skipped.values()].map((s) => `${s.count} ${s.why}`).join('; ') || 'none'}; partial ${checks.partial}, two schedules ${checks.multiSchedule}, no odd side ${checks.noOddSide}, no cross street ${checks.noCrossStreet}, no ward ${checks.noWard}, on the city limit (one side) ${checks.cityLimitOneSide}`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/paterson/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
