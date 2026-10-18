#!/usr/bin/env node
// Saint Paul for CURB (2026-10-18; format in docs/multi-city/city-build.md). Builds data/saint-paul/ from the City of
// Saint Paul's own ArcGIS layers:
//
//   1. Street Sweeping (Public Works): "the authoritative data source for street sweeping routes", the layer behind the
//      City's Street Sweep Map. One line per street block, with its address ranges, cross streets and, during a
//      residential sweep, the block's SweepDate. The City posts temporary No Parking signs and bans parking from 8 AM to
//      6 PM on that date (ticket and tow). The layer has one date per block and no side, so both sides get the date.
//   2. District Councils: the 17 planning districts, for each block's neighborhood and the welcome card.
//   3. Centerlines (2019): only to name the few swept blocks whose street name is blank in (1), matched by geometry.
//   4. Parking citations 2025 (Police): only for report.json's check of the hours (no-parking tickets on residential
//      blocks during the 2025 fall sweep).
//
// The dates move: the City reschedules blocks for weather and staffing, so during a sweep run this build daily.
// Arterial overnight "sanitation bans" (hours only on the signs) and snow emergencies (declared) are not modeled.
//
// Run: node scripts/cities/saint-paul.mjs [--refresh]   (Node 18+; inputs cached in private/cache/saint-paul/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/saint-paul/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/saint-paul/';
const log = (...a) => console.error('[saint-paul]', ...a);

const ORG = 'https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/';
export const SWEEP = ORG + 'Street_Sweeping/FeatureServer/0';
export const DISTRICTS = ORG + 'District_Councils/FeatureServer/0';
export const CENTERLINES = ORG + 'Centerlines/FeatureServer/0';
export const CITATIONS = ORG + 'ParkingCitationsSPPD_2025_public_view/FeatureServer/0';
// Only the fields the build reads. The layers also carry editors' user names: never requested, never cached.
export const SWEEP_FIELDS = ['OBJECTID', 'L_F_ADD', 'L_T_ADD', 'R_F_ADD', 'R_T_ADD', 'STREETALL', 'F_XSTREET', 'T_XSTREET',
  'DAY_RTE', 'NIGHT_N_E', 'NIGHT_S_W', 'SweepDate', 'SweepOperation'];
const CENTERLINE_FIELDS = ['OBJECTID', 'STREETALL', 'F_XSTREET', 'T_XSTREET', 'L_F_ADD', 'L_T_ADD', 'R_F_ADD', 'R_T_ADD'];

export const TZ = 'America/Chicago';
// The posted rule (stpaul.gov Street Sweeping Operations, "Sweeping Dos & Don'ts", read 2026-10-18): temporary "No
// Parking" signs at least 24 hours ahead (24 to 48 in the fall section), "banning parking from 8 a.m.-6 p.m. the day the
// street is swept"; parked cars "could be ticketed and towed". flags 2 = towable.
export const FROM = 8, TO = 18, FLAGS = 2;
export const ruleFor = (dates) => [-1, FROM, TO, 0, 0, FLAGS, [...new Set(dates)].sort()];

// City of Saint Paul paid holidays (policy 209.00, stpaul.gov/books/20900-holidays: "The eleven holidays are"). A fixed
// date holiday on a Saturday is observed the Friday before, on a Sunday the Monday after (Minn. Stat. 645.44 subd. 5).
// 2026 checked against the City's calendar (offices closed Nov 11, Nov 26, Nov 27, Dec 25); 2027 derived by the same rules.
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Presidents' Day",
  '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day', '2026-11-11': 'Veterans Day', '2026-11-26': 'Thanksgiving Day',
  '2026-11-27': 'Day after Thanksgiving', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Presidents' Day",
  '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)', '2027-07-05': 'Independence Day (observed)',
  '2027-09-06': 'Labor Day', '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving Day',
  '2027-11-26': 'Day after Thanksgiving', '2027-12-24': 'Christmas Day (observed)', '2027-12-31': "New Year's Day (observed)",
};

// ---------- pure helpers (tested in saint-paul.test.mjs) --------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
// SweepDate is an instant (06:01 UTC = 1:01 AM in Saint Paul): its local calendar date is the sweep date.
export const localDate = (ms) => dateFmt.format(new Date(ms));
export const weekday = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();

// "RUTH ST N" → "Ruth St N", "MCKNIGHT RD N" → "McKnight Rd N", "7TH ST W" → "7th St W"
const DIRS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const KEEP = new Set(['NB', 'SB', 'EB', 'WB']);
const word = (w) => (w === 'CUL-DE-SAC' ? 'Cul-de-sac' : w.split('-').map((p) => {
  if (KEEP.has(p) || /^I\d+[A-Z]?$/.test(p)) return p;
  if (/^\d+(ST|ND|RD|TH)$/.test(p)) return p.toLowerCase();
  if (/^MC[A-Z]{2,}$/.test(p)) return 'Mc' + p[2] + p.slice(3).toLowerCase();
  if (/^O'[A-Z]{2,}$/.test(p)) return "O'" + p[2] + p.slice(3).toLowerCase();
  return p.charAt(0) + p.slice(1).toLowerCase();
}).join('-'));
export function titleCase(s) {
  const w = String(s || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
  return w.map((x, i) => (i > 0 && DIRS.has(x) ? x : word(x))).join(' ');
}
// House numbers never leave the build: a few rows name a street or a cross street by an address ("ACCESS ROAD TO 506
// RANDOLPH AVE", private drives' "1157 - 1177 EDGCUMBE RD"). Numbers after HIGHWAY, HWY, INTERSTATE and the like stay.
const ROUTE_WORDS = new Set(['HIGHWAY', 'HWY', 'INTERSTATE', 'ROUTE', 'COUNTY', 'CR', 'CSAH', 'TH', 'US', 'I']);
export function scrubHouseNumbers(s) {
  const t = String(s || '').toUpperCase().trim().split(/\s+/).filter(Boolean), out = [];
  for (let i = 0; i < t.length; i++) {
    const isNum = /^\d+$/.test(t[i]) && !ROUTE_WORDS.has(out[out.length - 1]);
    const joiner = (t[i] === '-' || t[i] === 'AND' || t[i] === '&') && /^\d+$/.test(t[i + 1] || '') && /^\d+$/.test(t[i - 1] || '');
    if (isNum || joiner) continue;
    out.push(t[i]);
  }
  return out.join(' ');
}
// Every street name the build writes goes through here.
export const cleanName = (s) => titleCase(scrubHouseNumbers(s));

const num = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : null; };
// Which side of the line (first point to last) has the odd house numbers, from the left and right address ranges.
export function oddSide(p) {
  const par = (a, b) => { const n = num(a) ?? num(b); return n === null ? null : n % 2; };
  const l = par(p.L_F_ADD, p.L_T_ADD), r = par(p.R_F_ADD, p.R_T_ADD);
  if (l === 1 && r !== 1) return 'L';
  if (r === 1 && l !== 1) return 'R';
  return null;
}
export function houseRange(p) {
  const n = [p.L_F_ADD, p.L_T_ADD, p.R_F_ADD, p.R_T_ADD].map(num).filter((v) => v !== null);
  return n.length ? [Math.min(...n), Math.max(...n)] : null;
}

const LAT0 = 44.95, LON0 = -93.1, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
export const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
export const lengthM = (c) => { let s = 0; for (let i = 1; i < c.length; i++) { const a = xy(c[i - 1]), b = xy(c[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
// The compass word for one side of a line, as in scripts/cities/boston.mjs.
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}

// A MultiLineString whose parts join end to end (within 1 m) → one line; otherwise null.
export function chain(parts) {
  const close = (a, b) => { const p = xy(a), q = xy(b); return Math.hypot(p[0] - q[0], p[1] - q[1]) <= 1; };
  let line = parts[0].slice();
  const rest = parts.slice(1);
  while (rest.length) {
    const i = rest.findIndex((p) => close(p[0], line[line.length - 1]) || close(p[p.length - 1], line[line.length - 1]) || close(p[p.length - 1], line[0]) || close(p[0], line[0]));
    if (i < 0) return null;
    const p = rest.splice(i, 1)[0];
    if (close(p[0], line[line.length - 1])) line = line.concat(p.slice(1));
    else if (close(p[p.length - 1], line[line.length - 1])) line = line.concat(p.slice().reverse().slice(1));
    else if (close(p[p.length - 1], line[0])) line = p.concat(line.slice(1));
    else line = p.slice().reverse().concat(line.slice(1));
  }
  return line;
}
export function lineOf(geometry) {
  if (!geometry) return { line: null, how: 'none' };
  if (geometry.type === 'LineString') return { line: geometry.coordinates, how: 'line' };
  if (geometry.type === 'MultiLineString') {
    const parts = geometry.coordinates.filter((p) => p.length >= 2);
    if (parts.length === 1) return { line: parts[0], how: 'line' };
    const joined = chain(parts);
    if (joined) return { line: joined, how: 'joined' };
    return { line: parts.slice().sort((x, y) => lengthM(y) - lengthM(x))[0], how: 'longest part' };
  }
  return { line: null, how: geometry.type };
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
// Ray casting over every ring (holes count as outside).
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
// Meters from a point to the nearest edge of a polygon's rings.
export function edgeDistance(pt, geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  const [px, py] = xy(pt);
  let best = Infinity;
  for (const rings of polys) for (const ring of rings) for (let i = 1; i < ring.length; i++) {
    const [x1, y1] = xy(ring[i - 1]), [x2, y2] = xy(ring[i]), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - x1 - t * dx, py - y1 - t * dy));
  }
  return best;
}
// Do two lines run the same way (their end to end vectors point within 90 degrees of each other)?
export function sameDirection(a, b) {
  const [ax, ay] = xy(a[0]), [bx, by] = xy(a[a.length - 1]), [cx, cy] = xy(b[0]), [dx, dy] = xy(b[b.length - 1]);
  return (bx - ax) * (dx - cx) + (by - ay) * (dy - cy) >= 0;
}
// "Payne - Phalen" → "Payne-Phalen" (the planning districts' own names, hyphens closed up)
export const districtName = (s) => String(s || '').replace(/\s+-\s+/g, '-').trim();
// The cross streets, from the line's first point to its last ("Iowa Ave E - Idaho Ave E").
export function limits(from, to) {
  const a = cleanName(from), b = cleanName(to);
  return a && b && a !== b ? `${a} - ${b}` : a || b;
}
// Why a feature of the sweeping layer is not a swept block on the map, or null when it is one.
export const MIN_UNNAMED_M = 20;
export function skipReason(p, line) {
  if (!p.SweepDate) {
    if (p.SweepOperation === 'Arterial') return 'arterial: no residential sweep date (overnight bans are posted, hours not in the data)';
    if (p.SweepOperation === 'Highway') return 'highway: not swept by this program';
    if (p.SweepOperation === 'Seasonal') return 'residential block with no sweep date yet (not scheduled)';
    return 'no sweep program and no date (private drives, dead ends, blank rows)';
  }
  if (!line || line.length < 2) return 'no geometry';
  if (!String(p.STREETALL || '').trim() && lengthM(line) < MIN_UNNAMED_M) return `unnamed piece under ${MIN_UNNAMED_M} m (an intersection sliver)`;
  return null;
}
// One swept feature → one block of segments.json (name: the street when the feature's own is blank).
export function blockOf(p, line, { name, from, to, addr, hood } = {}) {
  const date = localDate(p.SweepDate);
  const g = round6(line);
  const a = addr || p, odd = oddSide(a), n = houseRange(a);
  const rule = ruleFor([date]);
  return {
    c: String(p.OBJECTID), s: cleanName(name || p.STREETALL), l: limits(from ?? p.F_XSTREET, to ?? p.T_XSTREET),
    ...(hood ? { h: hood } : {}), ...(n ? { n } : {}), ...(odd ? { o: odd } : {}), g,
    d: ['L', 'R'].map((side) => [side, compass(g, side), [rule.slice(0, 6).concat([rule[6].slice()])]]),
  };
}

// ---------- fetching ----------------------------------------------------------------------------------------------------

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-saint-paul-build (+https://curb.guide)' } });
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
async function allFeatures(layer, fields, { geojson = true, where = '1=1' } = {}) {
  const out = [];
  for (let off = 0; ; off += 2000) {
    const q = new URLSearchParams({ where, outFields: fields.join(','), orderByFields: 'OBJECTID', resultOffset: off,
      resultRecordCount: 2000, ...(geojson ? { outSR: '4326', f: 'geojson' } : { returnGeometry: 'false', f: 'json' }) });
    const page = await getJSON(`${layer}/query?${q}`);
    const rows = geojson ? page.features : page.features.map((x) => x.attributes);
    out.push(...rows);
    if (rows.length < 2000) return out;
  }
}

// ---------- the build ---------------------------------------------------------------------------------------------------

function assertShape(features) {
  if (!Array.isArray(features) || features.length < 10000 || features.length > 14000)
    throw new Error(`Street Sweeping: expected 10,000 to 14,000 features, got ${features && features.length}. The layer changed: check it before trusting a build.`);
  const missing = SWEEP_FIELDS.filter((k) => !(k in features[0].properties));
  if (missing.length) throw new Error(`Street Sweeping: fields missing: ${missing.join(', ')}`);
  const dated = features.filter((f) => f.properties.SweepDate);
  if (dated.length < 1000) throw new Error(`Street Sweeping: only ${dated.length} blocks have a SweepDate. The season may be over or the City cleared the dates; keep the last data/saint-paul/ until it is set again.`);
  return dated;
}

// A grid of every line's pieces, for "nearest line" lookups.
export function lineGrid(items, cellM = 50, padM = 30) {
  const grid = new Map(), cell = (v) => Math.floor(v / cellM);
  for (const it of items) {
    const pts = it.line.map(xy);
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      for (let cx = cell(Math.min(x1, x2) - padM); cx <= cell(Math.max(x1, x2) + padM); cx++)
        for (let cy = cell(Math.min(y1, y2) - padM); cy <= cell(Math.max(y1, y2) + padM); cy++) {
          const k = cx + ',' + cy;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([x1, y1, x2, y2, it]);
        }
    }
  }
  const near = (pt, tol) => {
    const [px, py] = xy(pt);
    const seen = new Map();
    for (const [x1, y1, x2, y2, it] of grid.get(cell(px) + ',' + cell(py)) || []) {
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
      const d = Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
      if (d <= tol && (!seen.has(it) || d < seen.get(it))) seen.set(it, d);
    }
    return seen;
  };
  return near;
}

// A blank street name in the sweeping layer → the 2019 centerline lying on the same line (every sample within 4 m).
export function nameFromCenterlines(line, near) {
  const L = lengthM(line), samples = [];
  for (let k = 1; k <= 5; k++) {
    let want = (L * k) / 6;
    for (let i = 1; i < line.length; i++) {
      const d = lengthM([line[i - 1], line[i]]);
      if (want <= d) { const t = d ? want / d : 0; samples.push([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]); break; }
      want -= d;
    }
  }
  const score = new Map();
  for (const s of samples) for (const [it, d] of near(s, 4)) { const v = score.get(it) || []; v.push(d); score.set(it, v); }
  const full = [...score.entries()].filter(([, v]) => v.length === samples.length && samples.length)
    .map(([it, v]) => [it, v.reduce((a, b) => a + b, 0) / v.length]).sort((a, b) => a[1] - b[1]);
  return full.length ? full[0][0] : null;
}

// report.json's check: 2025 no-parking tickets (Minn. Stat. 169.34 subd. 1(a)(14), "official signs prohibit parking") on
// residential blocks during the 2025 fall sweep, by hour. OCDATE holds the local wall clock time (meter tickets fall
// 8 AM to 10 PM in it, the meters' hours). It can check the posted window, not the dates (2025's dates are not published).
function citationCheck(rows, sweepItems) {
  const near = lineGrid(sweepItems);
  const statute = '169.34.1.A.14', from = Date.UTC(2025, 9, 16), to = Date.UTC(2025, 10, 27);
  const hours = new Array(24).fill(0), arterialHours = new Array(24).fill(0);
  let considered = 0, snapped = 0;
  for (const r of rows) {
    if (r.STATUTE !== statute || !r.LATITUDE || !r.LONGITUDE || r.OCDATE < from || r.OCDATE >= to) continue;
    const t = new Date(r.OCDATE);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    considered++;
    let best = null;
    for (const [it, d] of near([r.LONGITUDE, r.LATITUDE], 30)) if (!best || d < best[1]) best = [it, d];
    if (!best) continue;
    snapped++;
    (best[0].op === 'Seasonal' ? hours : arterialHours)[t.getUTCHours()]++;
  }
  const share = (h) => { const all = h.reduce((a, b) => a + b, 0); return all ? Math.round((1000 * h.slice(FROM, TO).reduce((a, b) => a + b, 0)) / all) / 10 : null; };
  return {
    what: 'No-parking-zone tickets (Minn. Stat. 169.34 subd. 1(a)(14)) on weekdays of the 2025 fall sweep (Oct 16 to Nov 26, 2025), snapped to the nearest block line within 30 m.',
    tickets: considered, snapped, onResidentialBlocks: hours.reduce((a, b) => a + b, 0),
    residentialShare8to18: share(hours), arterialShare8to18: share(arterialHours), residentialByHour: hours,
    caveats: [
      'The ticket data does not say which ticket was for sweeping: the same statute covers every posted no parking sign (construction, events, the summer sweep).',
      'A ticket\'s place is a block point, not the curb: it cannot tell the side of the street.',
      'The City does not publish 2025\'s sweep date for each block, so the dates themselves cannot be checked; the 2026 route codes are new each season.',
    ],
  };
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const fetched = new Date().toISOString().slice(0, 10);
  const features = await cached('street-sweeping.json', async () => { log('fetching Street Sweeping…'); return allFeatures(SWEEP, SWEEP_FIELDS); }, refresh);
  const districts = await cached('districts.json', async () => { log('fetching District Councils…'); return allFeatures(DISTRICTS, ['OBJECTID', 'districtnumber', 'planningdistrictname']); }, refresh);
  const centerlines = await cached('centerlines.json', async () => { log('fetching Centerlines…'); return allFeatures(CENTERLINES, CENTERLINE_FIELDS); }, refresh);
  let citations = null;
  try {
    citations = await cached('citations-2025.json', async () => { log('fetching 2025 citations…'); return allFeatures(CITATIONS, ['OBJECTID', 'OCDATE', 'STATUTE', 'LATITUDE', 'LONGITUDE'], { geojson: false }); }, refresh);
  } catch (e) { log('citations unavailable, check skipped:', e.message); }

  const dated = assertShape(features);
  if (districts.length !== 17) throw new Error(`District Councils: expected 17, got ${districts.length}`);
  log(`${features.length} sweeping features, ${dated.length} with a sweep date, ${districts.length} districts, ${centerlines.length} centerlines`);

  // node → streets touching it, for the cross streets' order
  const nodeKey = ([lo, la]) => lo.toFixed(5) + ',' + la.toFixed(5);
  const nodeStreets = new Map();
  const lines = new Map();
  for (const f of features) {
    const { line } = lineOf(f.geometry);
    lines.set(f.properties.OBJECTID, line);
    if (!line || !f.properties.STREETALL) continue;
    for (const pt of [line[0], line[line.length - 1]]) {
      const k = nodeKey(pt);
      if (!nodeStreets.has(k)) nodeStreets.set(k, new Set());
      nodeStreets.get(k).add(cleanName(f.properties.STREETALL));
    }
  }
  const clItems = centerlines.map((f) => ({ p: f.properties, line: lineOf(f.geometry).line })).filter((x) => x.line && x.p.STREETALL);
  const nearCl = lineGrid(clItems, 50, 10);

  const skipped = new Map();   // reason → { count, examples }
  const skip = (why, p) => {
    if (!skipped.has(why)) skipped.set(why, { why, count: 0, examples: [] });
    const s = skipped.get(why); s.count++;
    if (s.examples.length < 5) s.examples.push({ id: String(p.OBJECTID), street: cleanName(p.STREETALL) || null, from: cleanName(p.F_XSTREET) || null, to: cleanName(p.T_XSTREET) || null, operation: p.SweepOperation || null });
  };
  const checks = { geometryJoined: 0, geometryLongestPart: 0, namedFromCenterlines: 0, crossStreetsInLineOrder: 0, crossStreetsReversed: 0,
    crossStreetsUnplaced: 0, districtByNearestEdge: 0, noDistrict: 0, otherOperationsWithADate: {} };
  const routeDates = new Map();
  const blocks = [];
  for (const f of features) {
    const p = f.properties, raw = f.geometry ? lineOf(f.geometry) : { line: null, how: 'none' };
    const why = skipReason(p, raw.line);
    if (why) { skip(why, p); continue; }
    if (raw.how === 'joined') checks.geometryJoined++;
    if (raw.how === 'longest part') checks.geometryLongestPart++;
    if (p.SweepOperation !== 'Seasonal') checks.otherOperationsWithADate[p.SweepOperation || '(blank)'] = (checks.otherOperationsWithADate[p.SweepOperation || '(blank)'] || 0) + 1;
    const date = localDate(p.SweepDate);
    if (p.DAY_RTE) { if (!routeDates.has(p.DAY_RTE)) routeDates.set(p.DAY_RTE, new Set()); routeDates.get(p.DAY_RTE).add(date); }
    let opts = {};
    if (!String(p.STREETALL || '').trim()) {
      const cl = nameFromCenterlines(raw.line, nearCl);
      if (!cl) { skip('no street name, in this layer or on a centerline under it', p); continue; }
      checks.namedFromCenterlines++;
      // the centerline may run the other way: then its left and right ranges are this line's right and left
      const same = sameDirection(raw.line, cl.line);
      const clAddr = same ? cl.p : { L_F_ADD: cl.p.R_T_ADD, L_T_ADD: cl.p.R_F_ADD, R_F_ADD: cl.p.L_T_ADD, R_T_ADD: cl.p.L_F_ADD };
      opts = { name: cl.p.STREETALL, from: p.F_XSTREET || (same ? cl.p.F_XSTREET : cl.p.T_XSTREET),
        to: p.T_XSTREET || (same ? cl.p.T_XSTREET : cl.p.F_XSTREET), addr: houseRange(p) ? p : clAddr };
    }
    // cross streets in the line's direction: F_XSTREET should meet the first point
    const a = nodeStreets.get(nodeKey(raw.line[0])) || new Set(), b = nodeStreets.get(nodeKey(raw.line[raw.line.length - 1])) || new Set();
    const fx = cleanName(opts.from ?? p.F_XSTREET), tx = cleanName(opts.to ?? p.T_XSTREET);
    if ((fx && a.has(fx)) || (tx && b.has(tx))) checks.crossStreetsInLineOrder++;
    else if ((fx && b.has(fx)) || (tx && a.has(tx))) { checks.crossStreetsReversed++; opts = { ...opts, from: opts.to ?? p.T_XSTREET, to: opts.from ?? p.F_XSTREET }; }
    else checks.crossStreetsUnplaced++;
    const mid = midpoint(raw.line);
    let d = districts.find((x) => inPolygon(mid, x.geometry));
    if (!d) {   // a street on the city limits: the district whose edge is nearest, within 150 m
      const near = districts.map((x) => [x, edgeDistance(mid, x.geometry)]).sort((u, v) => u[1] - v[1])[0];
      if (near && near[1] <= 150) { d = near[0]; checks.districtByNearestEdge++; } else checks.noDistrict++;
    }
    blocks.push(blockOf(p, raw.line, { ...opts, hood: d ? districtName(d.properties.planningdistrictname) : undefined }));
  }

  // Two features drawn on the very same line become one block (their dates merged).
  const byLine = new Map();
  let merged = 0;
  for (const b of blocks) {
    const k = JSON.stringify(String(b.g[0]) <= String(b.g[b.g.length - 1]) ? b.g : b.g.slice().reverse());   // same line either way round
    if (!byLine.has(k)) { byLine.set(k, b); continue; }
    const keep = byLine.get(k); merged++;
    for (const side of keep.d) {
      const other = b.d.find((x) => x[0] === side[0]) || b.d[0];
      side[2][0][6] = [...new Set(side[2][0][6].concat(other[2][0][6]))].sort();
    }
  }
  const out = [...byLine.values()].sort((x, y) => Number(x.c) - Number(y.c));

  // ---- sanity: every listed date is a weekday, none a City holiday, all inside one season ----
  const allDates = out.flatMap((b) => b.d.flatMap(([, , rules]) => rules.flatMap((r) => r[6])));
  const uniq = [...new Set(allDates)].sort();
  const onHoliday = uniq.filter((d) => HOLIDAYS[d]);
  if (onHoliday.length) throw new Error(`Sweep dates on City holidays: ${onHoliday.join(', ')}. Decide with the City before shipping (holidayRule "all" would hide them).`);
  const weekend = uniq.filter((d) => [0, 6].includes(weekday(d)));
  if (weekend.length > 3) throw new Error(`Sweep dates on weekends: ${weekend.join(', ')}`);
  const season = { from: uniq[0], to: uniq[uniq.length - 1] };
  const gaps = [];
  for (let t = Date.parse(season.from + 'T12:00:00Z'); t <= Date.parse(season.to + 'T12:00:00Z'); t += 864e5) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (![0, 6].includes(weekday(iso)) && !uniq.includes(iso)) gaps.push(HOLIDAYS[iso] ? `${iso} (${HOLIDAYS[iso]})` : iso);
  }
  const perDate = Object.fromEntries(uniq.map((d) => [d, 0]));
  for (const b of out) for (const d of b.d[0][2][0][6]) perDate[d]++;
  const multiDateRoutes = [...routeDates].filter(([, s]) => s.size > 1).map(([r, s]) => ({ route: r, dates: [...s].sort() }));

  // ---- neighborhoods for the welcome card ----
  const bboxOf = (geom) => {
    let w = 180, s = 90, e = -180, n = -90;
    const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
    for (const ring of rings) for (const [lo, la] of ring) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
    return [w, s, e, n].map((v) => v.toFixed(4)).join(',');
  };
  const neighborhoods = districts.slice().sort((x, y) => x.properties.districtnumber - y.properties.districtnumber)
    .map((x) => ({ name: districtName(x.properties.planningdistrictname), bbox: bboxOf(x.geometry) }));

  let W = 180, S = 90, E = -180, N = -90;
  for (const b of out) for (const [lo, la] of b.g) { W = Math.min(W, lo); E = Math.max(E, lo); S = Math.min(S, la); N = Math.max(N, la); }
  const pad = 0.005, r4 = (v) => Math.round(v * 1e4) / 1e4;

  // The Street Sweep Map's license (item c2af26c6795845528e5aa2bac4475e84, licenseInfo): a copy of the data must carry it.
  const NOTICE = 'The Geographic Information System (GIS) Data to which this notice is attached are made available pursuant to the Minnesota Government Data Practices Act (Minnesota Statutes Chapter 13). The GIS Data are provided to you \u201cAS IS\u201d and without any warranty as to their performance, merchantability, or fitness for any particular purpose. The GIS Data were developed by the City of Saint Paul for its own internal business purposes. The City of Saint Paul does not represent or warrant that the GIS Data or the data documentation are error-free, complete, current, or accurate. You are responsible for any consequences resulting from your use of the GIS Data or your reliance on the GIS Data. You should consult the data documentation for this particular GIS Data to determine the limitations of the GIS Data and the precision with which the GIS Data may depict distance, direction, location, or other geographic features. If you transmit or provide the GIS Data (or any portion of it) to another user, the GIS Data must include a copy of this disclaimer.';
  const sources = [
    { name: 'Street Sweeping (Saint Paul Public Works; the data behind the City\'s Street Sweep Map)', url: SWEEP, notice: NOTICE,
      license: 'City of Saint Paul GIS data notice (Minnesota Government Data Practices Act): provided as is; a copy must include the notice', fetched },
    { name: 'District Councils (planning districts)', url: DISTRICTS, license: 'Public domain (City of Saint Paul notice)', fetched },
    { name: 'Centerlines (2019), only to name swept blocks whose street name is blank', url: CENTERLINES, license: 'City of Saint Paul GIS data (no license stated)', fetched },
  ];
  const sides = out.reduce((n, b) => n + b.d.length, 0);
  const dateEntries = out.reduce((n, b) => n + b.d.reduce((m, [, , rules]) => m + rules.reduce((k, r) => k + r[6].length, 0), 0), 0);

  fs.mkdirSync(OUT, { recursive: true });
  const segs = { _meta: { city: 'saint-paul', time_zone: TZ, generated: new Date().toISOString(), notice: NOTICE, sources, blocks: out.length, sides, season,
    format: 'b[] = {c: Street Sweeping OBJECTID, s: street, l: cross streets (first point to last), h: planning district, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
      + 'rule = [-1, fromH, toH, 0, 0, flags, ["YYYY-MM-DD", ...]]: no parking fromH to toH (local time) on each listed date; flags 2 = towable. One date per block from the City\'s data, given to both sides. City holidays are never listed.' },
  b: out };
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify(segs));
  const sizeBytes = fs.statSync(OUT + 'segments.json').size;

  const city = {
    id: 'saint-paul', name: 'Saint Paul', region: 'Minnesota', tz: TZ,
    center: [44.9395, -93.146], zoom: 14, bounds: [[r4(S - pad), r4(W - pad)], [r4(N + pad), r4(E + pad)]],
    holidays: HOLIDAYS, holidaysSource: 'https://www.stpaul.gov/books/20900-holidays', holidayRule: 'all',
    fine: '', tow: 'yes', fineSource: '',
    agency: 'Saint Paul Public Works', scheduleUrl: 'https://www.stpaul.gov/departments/public-works/street-maintenance/street-sweeping-operations',
    sources,
    words: {
      rule: 'During the fall sweep, temporary No Parking signs go up 24 to 48 hours ahead: no parking 8 AM to 6 PM on the block\'s sweep date.',
      afterpass: `Fall sweep ${fmtDay(season.from)} to ${fmtDay(season.to)}, ${season.to.slice(0, 4)}, one day per block; the City can move a date for weather. Parked cars can be ticketed and towed.`,
      dataNotes: 'Dates come from the City\'s Street Sweeping layer, the data behind its Street Sweep Map, which gives one date per block and no side, so both sides show it. Dates can move on short notice: the temporary signs on the block win. Arterial overnight bans (hours only on the signs) and snow emergencies are not shown. The City provides its GIS data as is, with no warranty; its full notice comes with the data file.',
    },
    neighborhoods,
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1) + '\n');

  const residential = features.filter((f) => f.properties.SweepOperation === 'Seasonal');
  const report = {
    generated: new Date().toISOString(),
    inputs: { sweepingFeatures: features.length, withSweepDate: dated.length,
      byOperation: Object.fromEntries([...new Set(features.map((f) => f.properties.SweepOperation ?? '(none)'))].map((k) => [k, features.filter((f) => (f.properties.SweepOperation ?? '(none)') === k).length])),
      residentialWithoutDate: residential.filter((f) => !f.properties.SweepDate).length,
      routes: routeDates.size, districts: districts.length, centerlines: centerlines.length },
    output: { blocks: out.length, sides, rules: sides, dateEntries, distinctDates: uniq.length, mergedSameLine: merged, sizeBytes },
    season: { ...season, sweepDays: uniq.length, weekdaysWithoutSweeps: gaps, blocksPerDate: perDate },
    skipped: [...skipped.values()].sort((a, b) => b.count - a.count),
    checks: { ...checks, routesWithMoreThanOneDate: multiDateRoutes.length, routesWithMoreThanOneDateList: multiDateRoutes.slice(0, 10),
      weekendDates: weekend, datesOnHolidays: onHoliday,
      arterialNightRoutes: {
        arterialBlocks: features.filter((f) => f.properties.SweepOperation === 'Arterial').length,
        withANightRouteCode: features.filter((f) => f.properties.SweepOperation === 'Arterial' && (f.properties.NIGHT_N_E || f.properties.NIGHT_S_W)).length,
        note: 'NIGHT_N_E / NIGHT_S_W give one weekday per side (M-3-N = Monday, north side). They match the posted overnight bans a 2020 City memo lists for Grand Ave (north Monday, south Tuesday), Dale St (east Monday, west Thursday) and Cleveland Ave (Friday), but Snelling Ave, posted three nights a side, has one; the hours (most 2 to 7 AM, per the memo) are not in the data. Not modeled: a one night rule would call a banned night free.',
      },
      ...(citations ? { citations2025: citationCheck(citations, features.map((f) => ({ op: f.properties.SweepOperation, line: lines.get(f.properties.OBJECTID) })).filter((x) => x.line)) } : {}) },
    assumptions: [
      'Both sides of a block share its date: the layer has one SweepDate per block and no side, the City\'s map shows one date per block, and the City\'s pages never say the sides are swept on different days.',
      'The window is 8 AM to 6 PM on the date, from the City\'s Street Sweeping Operations page and the Street Sweep Map\'s description; the date is the SweepDate\'s calendar date in Saint Paul.',
      'Every swept block can be ticketed and towed (flags 2): the City says cars in the posted zone "could be ticketed and towed".',
      'A block with no SweepDate is not shown: arterials (posted overnight bans, hours not in the data), highways, and residential blocks the City has not scheduled yet.',
      'Not modeled: snow emergencies (declared) and the winter weekly alternate side parking pilot (two pilot areas, January to April in 2025 and 2026).',
      `Unnamed pieces under ${MIN_UNNAMED_M} m are intersection slivers and are left off; longer unnamed blocks take the name of the City centerline (2019) under them.`,
      'Holidays: the City\'s eleven paid holidays (policy 209.00) with the Minnesota weekend rule (Minn. Stat. 645.44 subd. 5); 2027 is derived, not published. No 2026 sweep date falls on one.',
    ],
    unverified: [
      'The fine: no City page gives the amount for a sweeping ticket. Tickets during sweeps are written as "no parking zone" (Minn. Stat. 169.34 subd. 1(a)(14)), whose 2025 statewide payable is $25 plus a $12 surcharge ($37), but that the City uses this payable for sweeping tickets is not confirmed. The snow emergency ticket ($56) is a different code. city.json leaves fine empty.',
      'That both sides are swept the same day (see assumptions).',
      'That signs go up on every block: the operations page also says streets "may or may not be posted in advance".',
      'The 2027 holiday dates (derived by rule).',
    ],
    questionsForCity: [
      'What is the fine for parking on a block during its posted residential sweep, and what does the tow cost (the impound lot\'s standard tow, or the snow emergency rate)?',
      'Are both sides of a residential block always swept on the block\'s SweepDate, or can one side be done another day?',
      'When a block is rescheduled, is SweepDate updated the same day, and are the signs moved with it? How late can a date change?',
      'Can the posted nights and hours of the arterial overnight sanitation bans be added to the layer? NIGHT_N_E and NIGHT_S_W give one weekday per side, and some streets (Snelling Ave) are posted three nights a side.',
      'Is the layer\'s OBJECTID stable from season to season (it matched the 2022 copy of the layer), so saved alerts keep working next spring?',
      'Will the spring 2027 dates be published in the same layer, and when?',
      'Will the weekly alternate side parking pilot (winters 2025 and 2026, two pilot areas, layer Weekly_Alternate_Side_Parking) run again this winter, and where?',
    ],
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');
  log(`${out.length} blocks, ${sides} sides, ${uniq.length} sweep dates ${season.from} to ${season.to}; skipped ${[...skipped.values()].map((s) => `${s.count} ${s.why}`).join('; ')}`);
  log(`named from centerlines ${checks.namedFromCenterlines}; cross streets in line order ${checks.crossStreetsInLineOrder}, reversed ${checks.crossStreetsReversed}, unplaced ${checks.crossStreetsUnplaced}; no district ${checks.noDistrict}`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/saint-paul/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}
function fmtDay(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
