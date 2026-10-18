#!/usr/bin/env node
// Riverside, CA for CURB (2026-10-18; format in docs/multi-city/city-build.md, research in docs/multi-city/riverside.md).
// Builds data/riverside/ from public layers:
//
//   1. Street Sweeping Zones (City of Riverside Public Works, open data): 136 polygons, each with a route code (201A, 402P,
//      30911, NOSWEEP) and a weekday. The code is decoded here: first digit = weekday (2 Tuesday to 5 Friday), A = 7:30 to
//      11:30 AM, P = 11:30 AM to 3:30 PM (the City's Street Sweeping Program page). The layer does not say which weeks of the
//      month a zone is swept (1st & 3rd or 2nd & 4th): that comes from the City's own Street Sweeping Schedule map (a PDF the
//      City still posts), which fills every zone with its schedule's color and labels it with the same route codes. MAP_WEEKS
//      below is that map, read route by route. Zones whose weeks or hours the map does not give are left out.
//   2. Riverside County Streets (TLMA GIS, the County's road and geocoding network, cities included): one line per block,
//      with names and address ranges. Each block's two sides are placed in a zone by points 9 m to each side of the
//      centerline, so a street on a zone boundary gets each side's own schedule; a block crossing a boundary is cut there.
//   3. The City's street centerlines (only to drop private streets, which the City does not sweep) and its 28 neighborhoods.
//
// Run: node scripts/cities/riverside.mjs [--refresh]   (Node 18+; inputs cached in private/cache/riverside/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/riverside/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/riverside/';
const log = (...a) => console.error('[riverside]', ...a);

const ORG = 'https://services.arcgis.com/Fu2oOWg1Aw7azh41/arcgis/rest/services/';
export const ZONES = ORG + 'Street_Sweeping_Zones/FeatureServer/0';
export const CITY_LINES = ORG + 'Riverside_Street_Centerline/FeatureServer/0';
export const HOODS = ORG + 'RiversideNeighborhoods/FeatureServer/0';
export const STREETS = 'https://gis.countyofriverside.us/arcgis_Mapping/rest/services/OpenData/Transportation/MapServer/0';
export const SCHEDULE_MAP = 'https://riversideca.gov/publicworks/sites/riversideca.gov.publicworks/files/Street%20Sweeping%20Schedule.pdf';
export const PROGRAM = 'https://riversideca.gov/publicworks/streets/street-sweeping/street-sweeping-program';
export const CALENDAR = 'https://riversideca.gov/publicworks/streets/street-sweeping/street-sweeping-calendar';
export const FEES = 'https://riversideca.gov/finance/PDF/Fees-and-Charges-as-of-July-1,-2026.pdf';
export const TZ = 'America/Los_Angeles';
const ENVELOPE = [-117.53, 33.86, -117.27, 34.03];
// Only the fields the build reads (the County layer also has editors' initials: never requested, never cached).
const STREET_FIELDS = ['OBJECTID', 'CLASS', 'L_F_ADD', 'L_T_ADD', 'R_F_ADD', 'R_T_ADD', 'PREFIX_DIRECTION', 'STREET_NAME',
  'STREET_SUFFIX', 'SUFFIX_DIRECTION', 'FULL_NAME', 'GLOBALID'];
// County CLASS: 11 collector, 12 residential. Left out: freeways, highways, ramps, expressways (1-8), major roads and arterials
// (9, 10: the "main thoroughfares" the City sweeps weekly outside the zone schedule) and tentative streets (13).
export const KEEP_CLASS = new Set(['11', '12']);

// ---------- decoding the route codes ---------------------------------------------------------------------------------------

// The City's Street Sweeping Program page: neighborhoods are swept "on the 1st/3rd and 2nd/4th weeks of the month from
// 7:30 a.m. to 11:30 a.m. or from 11:30 a.m. to 3:30 p.m."; the 2026 calendar colors each Tuesday to Friday by its
// occurrence in the month (1st and 3rd blue, 2nd and 4th yellow, a 5th one blank), so the week masks are 5 and 10.
export const WINDOW = { A: ['7:30', '11:30'], P: ['11:30', '15:30'] };
// The City's Street Sweeping Schedule map (SCHEDULE_MAP: an ArcMap export dated 2015-07-09, still posted by the City), read
// route by route: each route label's zone color matched to the legend ("1st & 3rd Tues. AM" ...), and each current zone's
// interior sampled on the georeferenced map (docs/multi-city/riverside.md). 5 = 1st & 3rd weeks, 10 = 2nd & 4th weeks.
// On every route the map shows, odd route numbers are 1st & 3rd and even ones 2nd & 4th, but only the routes it shows are here.
export const MAP_WEEKS = {
  201: 5, 202: 10, 203: 5, 204: 10, 205: 5, 210: 10, 211: 5, 212: 10, 213: 5,
  303: 5, 304: 10, 305: 5, 306: 10, 307: 5, 308: 10, 310: 10, 312: 10, 314: 10,
  402: 10, 403: 5, 404: 10, 405: 5, 406: 10, 407: 5, 408: 10, 409: 5, 410: 10, 411: 5, 412: 10,
  501: 5, 503: 5, 504: 10, 505: 5, 510: 10, 511: 5, 512: 10, 513: 5, 515: 5,
};
// Zones whose two sides follow different schedules, from the same legend. 309/11: "1st & 3rd Wed. AM Odd Side / PM Even
// Side". 206/7, 208/9 ("1st & 3rd Tues. Odd Side / 2nd & 4th Tues. Even Side") and 506/7 (the same on Friday) give no
// window on the map, so they are left out.
export const SPLIT = { '30911': { dow: 3, weeks: 5, odd: 'A', even: 'P' } };
export const NO_WINDOW = { '206/7': 'Tuesday', '208/9': 'Tuesday', '506/7': 'Friday' };
const DAY = { Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5 };
export const FLAGS = 0;   // a $46 ticket, no tow

// One zone → { kind: 'both', rule } | { kind: 'split', odd, even } | { skip: reason }.
export function decodeZone(code, day) {
  const k = String(code || '').trim().toUpperCase();
  if (k === 'NOSWEEP' || day === 'NoSweep') return { skip: 'NOSWEEP zone (not swept)' };
  if (SPLIT[k]) {
    const s = SPLIT[k];
    if (DAY[day] !== s.dow) return { skip: `weekday ${day} does not match route ${k}` };
    return { kind: 'split', odd: [s.dow, ...WINDOW[s.odd], s.weeks, 0, FLAGS], even: [s.dow, ...WINDOW[s.even], s.weeks, 0, FLAGS] };
  }
  if (NO_WINDOW[k]) return { skip: 'side-by-side schedule with no hours on the City\'s map (odd side 1st & 3rd, even side 2nd & 4th)' };
  const m = /^([2-5])(\d{2})([AP])$/.exec(k);
  if (!m) return { skip: 'route code not decoded' };
  const dow = +m[1], route = +(m[1] + m[2]), weeks = MAP_WEEKS[route];
  if (DAY[day] !== dow) return { skip: `weekday ${day} does not match route ${k}` };
  if (!weeks) return { skip: 'route not on the City\'s schedule map: week pair unknown' };
  return { kind: 'both', rule: [dow, ...WINDOW[m[3]], weeks, 0, FLAGS] };
}
// Which occurrence of its weekday a date is in its month (1 to 5), and whether a weeks mask sweeps it.
export const occurrence = (iso) => Math.ceil(+iso.slice(8, 10) / 7);
export const sweepsOn = (rule, iso) => new Date(iso + 'T12:00:00Z').getUTCDay() === rule[0] && !!(rule[3] & (1 << (occurrence(iso) - 1)));

// What the map shows inside each current zone (share of interior sample points with each legend color; rendered 2026-10-18).
// 87 of 92 swept zones show their own day, window and one week pair (84% to 100% of points, median 99%). The rest:
export const MAP_CHECK = {
  zonesSampled: 92, agreeOnDayAndWindow: 87, sharesMedian: 99, sharesMin: 84,
  differences: [
    { route: '313A', shows: '1st & 3rd Fri. AM (100%)', note: 'Wednesday zone edited 2023-04-04; the map shows the old Friday route 511/513 here. Left out.' },
    { route: '313P', shows: '1st & 3rd Fri. PM (100%)', note: 'As 313A. Left out.' },
    { route: '315A', shows: '1st & 3rd Fri. AM (99%)', note: 'As 313A. Left out.' },
    { route: '315P', shows: '1st & 3rd Fri. PM (99%)', note: 'As 313A. Left out.' },
    { route: '406A (second polygon)', shows: '2nd & 4th Thurs. PM (100%)', note: 'Same weeks, other window: the layer\'s A (7:30 to 11:30) is used, the newer source. Ask the City.' },
  ],
};

// City holidays: 2026 as marked "H" on the City's 2026 Street Sweeping Schedule (CALENDAR); "If my sweeping day is a holiday
// does my street get swept that week? No." (PROGRAM), so a holiday cancels that week's sweep. 2027 derived by the same list
// and the 2026 calendar's weekend rule (a Saturday holiday is observed the Friday before, a Sunday one the Monday after).
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Presidents' Day",
  '2026-03-31': 'César Chávez Day', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day', '2026-10-12': 'Columbus Day',
  '2026-11-11': 'Veterans Day', '2026-11-26': 'Thanksgiving Day', '2026-11-27': 'Day after Thanksgiving', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Presidents' Day",
  '2027-03-31': 'César Chávez Day', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day', '2027-10-11': 'Columbus Day',
  '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving Day', '2027-11-26': 'Day after Thanksgiving',
  '2027-12-24': 'Christmas Day (observed)', '2027-12-31': "New Year's Day (observed)",
};

// ---------- names, numbers, geometry -------------------------------------------------------------------------------------

const DIRS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const word = (w) => w.split('-').map((p) => {
  if (/^\d+(ST|ND|RD|TH)$/.test(p)) return p.toLowerCase();
  if (/^MC[A-Z]{2,}$/.test(p)) return 'Mc' + p[2] + p.slice(3).toLowerCase();
  if (/^O'[A-Z]{2,}$/.test(p)) return "O'" + p[2] + p.slice(3).toLowerCase();
  if (/^(DE|LA|EL|DEL|LOS|LAS)$/.test(p)) return p.charAt(0) + p.slice(1).toLowerCase();
  return p.charAt(0) + p.slice(1).toLowerCase();
}).join('-');
// "PALM AVE" → "Palm Ave", "N ORANGE ST" → "N Orange St", "MCKINLEY ST" → "McKinley St"
export function titleCase(s) {
  const w = String(s || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
  return w.map((x) => (DIRS.has(x) ? x : word(x))).join(' ');
}
export function streetName(p) {
  const full = String(p.FULL_NAME || '').trim();
  if (full) return titleCase(full);
  return titleCase([p.PREFIX_DIRECTION, p.STREET_NAME, p.STREET_SUFFIX, p.SUFFIX_DIRECTION].filter(Boolean).join(' '));
}
// Lines the County names by what they are, not a street name ("Ramp", "Walkway", "Street A", "<access Road>"), and alleys.
export const notAStreet = (name) => /^(ramp|walkway|noname|no name|unnamed|street [a-z])$/i.test(name) || /[<>]/.test(name) || /\b(alley|aly)$/i.test(name);
const num = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : null; };
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

const LAT0 = 33.95, LON0 = -117.40, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
export const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
export const ll = ([x, y]) => [x / KX + LON0, y / KY + LAT0];
export const lengthM = (c) => { let s = 0; for (let i = 1; i < c.length; i++) { const a = xy(c[i - 1]), b = xy(c[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
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
export const parts = (g) => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);
// The point `d` meters along a line, with the direction there.
export function pointAt(c, d) {
  let run = 0;
  for (let i = 1; i < c.length; i++) {
    const a = xy(c[i - 1]), b = xy(c[i]), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!l) continue;
    if (run + l >= d || i === c.length - 1) {
      const t = Math.max(0, Math.min(1, (d - run) / l));
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], u: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
    }
    run += l;
  }
  const a = xy(c[0]);
  return { p: a, u: [1, 0] };
}
// The piece of a line between d0 and d1 meters along it (same direction).
export function cut(c, d0, d1) {
  const out = [];
  let run = 0;
  for (let i = 1; i < c.length; i++) {
    const a = xy(c[i - 1]), b = xy(c[i]), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const s0 = run, s1 = run + l;
    if (l && s1 >= d0 && s0 <= d1) {
      const t0 = Math.max(0, (d0 - s0) / l), t1 = Math.min(1, (d1 - s0) / l);
      if (!out.length) out.push(ll([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]));
      out.push(ll([a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]));
    }
    run = s1;
  }
  return out;
}
export const OFFSET = 9, STEP = 5, MIN_PIECE = 15, MIN_BLOCK = 10;
// Which zone each side of a block falls in, along the block: runs of [from m, to m, zoneLeft, zoneRight].
export function sideRuns(c, zoneAt) {
  const L = lengthM(c), n = Math.max(1, Math.round(L / STEP)), samples = [];
  for (let i = 0; i < n; i++) {
    const d = ((i + 0.5) / n) * L, { p, u } = pointAt(c, d), nx = -u[1], ny = u[0];
    samples.push([d, zoneAt(ll([p[0] + nx * OFFSET, p[1] + ny * OFFSET])), zoneAt(ll([p[0] - nx * OFFSET, p[1] - ny * OFFSET]))]);
  }
  const compact = (rs) => {
    const out = [];
    for (const r of rs) { const last = out[out.length - 1]; if (last && last.zl === r.zl && last.zr === r.zr) last.n += r.n; else out.push({ ...r }); }
    return out;
  };
  let runs = compact(samples.map(([, zl, zr]) => ({ zl, zr, n: 1 })));
  // a run shorter than MIN_PIECE joins its longer neighbor (a zone corner clipping the block, or a crooked boundary), the
  // shortest first, so a short block takes the zone along most of it
  const step = L / n;
  while (runs.length > 1) {
    let i = -1;
    runs.forEach((r, k) => { if (r.n * step < MIN_PIECE && (i < 0 || r.n < runs[i].n)) i = k; });
    if (i < 0) break;
    const prev = runs[i - 1], next = runs[i + 1], into = !prev ? next : !next ? prev : prev.n >= next.n ? prev : next;
    into.n += runs[i].n;
    runs.splice(i, 1);
    runs = compact(runs);
  }
  const out = [];
  let at = 0;
  for (const r of runs) { const to = at + r.n * step; out.push([at, Math.min(L, to), r.zl, r.zr]); at = to; }
  out[out.length - 1][1] = L;
  return out;
}

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

// ---------- fetching ----------------------------------------------------------------------------------------------------

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-riverside-build (+https://curb.guide)' } });
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
const inEnvelope = { geometry: ENVELOPE.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };

// ---------- the build ---------------------------------------------------------------------------------------------------

function assertShape(zones, streets) {
  if (!Array.isArray(zones) || zones.length < 100 || zones.length > 200)
    throw new Error(`Street Sweeping Zones: expected 100 to 200 polygons, got ${zones && zones.length}. The layer changed: check it before trusting a build.`);
  const missing = ['OBJECTID', 'StreetSweepRoute', 'StreetSweepDay'].filter((k) => !(k in zones[0].properties));
  if (missing.length) throw new Error(`Street Sweeping Zones: fields missing: ${missing.join(', ')}`);
  const decoded = zones.filter((z) => !decodeZone(z.properties.StreetSweepRoute, z.properties.StreetSweepDay).skip).length;
  if (decoded < 60) throw new Error(`Street Sweeping Zones: only ${decoded} zones decode (expected about 80): the route codes changed`);
  if (streets.length < 15000) throw new Error(`County Streets: expected over 15,000 lines around Riverside, got ${streets.length}`);
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const fetched = new Date().toISOString().slice(0, 10);
  const zones = await cached('street-sweeping-zones.json', async () => { log('fetching Street Sweeping Zones…'); return allFeatures(ZONES, ['OBJECTID', 'StreetSweepRoute', 'StreetSweepDay', 'StreetSweepZone', 'LastUpdated']); }, refresh);
  const streets = await cached('county-streets.json', async () => { log('fetching County Streets…'); return allFeatures(STREETS, STREET_FIELDS, inEnvelope); }, refresh);
  const privateLines = await cached('city-centerlines-private.json', async () => {
    log('fetching the City\'s private street centerlines…');
    return allFeatures(CITY_LINES, ['OBJECTID', 'StreetNameFull', 'OwnedBy'], { where: "OwnedBy = 'Private'" });
  }, refresh);
  const hoods = await cached('neighborhoods.json', async () => { log('fetching neighborhoods…'); return allFeatures(HOODS, ['OBJECTID', 'Neighborhood']); }, refresh);
  assertShape(zones, streets);
  log(`${zones.length} zones, ${streets.length} County street lines, ${privateLines.length} private City centerlines, ${hoods.length} neighborhoods`);

  // ---- zones ----
  const zoneInfo = new Map();   // OBJECTID → { code, day, decoded, bbox, geometry }
  const zoneList = [];
  for (const z of zones) {
    const p = z.properties, code = String(p.StreetSweepRoute || '').trim(), dec = decodeZone(code, p.StreetSweepDay);
    let w = 180, s = 90, e = -180, n = -90;
    const polys = z.geometry.type === 'Polygon' ? [z.geometry.coordinates] : z.geometry.coordinates;
    for (const rings of polys) for (const [lo, la] of rings[0]) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
    const info = { id: String(p.OBJECTID), code, day: p.StreetSweepDay, dec, bb: [w, s, e, n], geometry: z.geometry };
    zoneInfo.set(info.id, info); zoneList.push(info);
  }
  const zoneAt = ([lo, la]) => {
    for (const z of zoneList) if (lo >= z.bb[0] && lo <= z.bb[2] && la >= z.bb[1] && la <= z.bb[3] && inPolygon([lo, la], z.geometry)) return z.id;
    return null;
  };

  // ---- private streets (City centerline OwnedBy 'Private'), as a grid of their pieces ----
  const CELL = 40, cell = (v) => Math.floor(v / CELL), privGrid = new Map();
  for (const f of privateLines) for (const c of parts(f.geometry)) {
    const pts = c.map(xy);
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      for (let cx = cell(Math.min(x1, x2) - 8); cx <= cell(Math.max(x1, x2) + 8); cx++)
        for (let cy = cell(Math.min(y1, y2) - 8); cy <= cell(Math.max(y1, y2) + 8); cy++) {
          const k = cx + ',' + cy;
          if (!privGrid.has(k)) privGrid.set(k, []);
          privGrid.get(k).push([x1, y1, x2, y2]);
        }
    }
  }
  const nearPrivate = ([px, py], [ux, uy]) => (privGrid.get(cell(px) + ',' + cell(py)) || []).some(([x1, y1, x2, y2]) => {
    const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy);
    if (!l || Math.abs((dx * ux + dy * uy) / l) < 0.85) return false;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (l * l)));
    return Math.hypot(px - x1 - t * dx, py - y1 - t * dy) <= 8;
  });
  const privateShare = (c) => {
    const L = lengthM(c), n = Math.max(1, Math.round(L / STEP));
    let hit = 0;
    for (let i = 0; i < n; i++) { const { p, u } = pointAt(c, ((i + 0.5) / n) * L); if (nearPrivate(p, u)) hit++; }
    return hit / n;
  };

  // ---- cross streets: every County line but ramps (CLASS 2, 4, 6, 8) and lines that are not streets ----
  const crossAt = crossStreets(streets.map((f) => {
    const name = streetName(f.properties);
    return ['2', '4', '6', '8'].includes(String(f.properties.CLASS)) || notAStreet(name) ? { c: null, name: '' } : { c: parts(f.geometry)[0], name };
  }));

  // ---- blocks ----
  const skipped = new Map();
  const skip = (why, ex) => {
    if (!skipped.has(why)) skipped.set(why, { why, count: 0, examples: [] });
    const s = skipped.get(why); s.count++;
    if (ex && s.examples.length < 5) s.examples.push(ex);
  };
  const checks = { cutAtZoneBoundary: 0, sidesInDifferentZones: 0, splitZoneSides: 0, splitZoneSidesNoParity: 0, arterialsInZones: 0 };
  const zoneSides = new Map();   // zone id → sides placed
  const blocks = [];
  for (let fi = 0; fi < streets.length; fi++) {
    const f = streets[fi], p = f.properties, c = parts(f.geometry)[0], name = streetName(p);
    if (!c || c.length < 2) continue;
    const L = lengthM(c);
    const ex = { id: String(p.GLOBALID || '').replace(/[{}]/g, ''), street: name };
    if (!KEEP_CLASS.has(String(p.CLASS))) {
      if (['9', '10'].includes(String(p.CLASS)) && zoneAt(c[Math.floor(c.length / 2)]) && L >= MIN_BLOCK) {
        const z = zoneInfo.get(zoneAt(c[Math.floor(c.length / 2)]));
        if (z && !z.dec.skip) checks.arterialsInZones++;
      }
      continue;
    }
    if (L < MIN_BLOCK) continue;
    const runs = sideRuns(c, zoneAt);
    if (runs.every(([, , zl, zr]) => (!zl || zoneInfo.get(zl).dec.skip) && (!zr || zoneInfo.get(zr).dec.skip))) {
      // not swept: tally why, by the zone under the block's middle
      const mid = runs[Math.floor(runs.length / 2)], z = zoneInfo.get(mid[2] || mid[3] || '');
      if (z) skip(z.dec.skip, { ...ex, zone: z.code }); else skip('outside every zone (not in the City, or a gap)', null);
      continue;
    }
    if (!name) { skip('no street name', ex); continue; }
    if (notAStreet(name)) { skip('not a street (an alley, ramp or walkway, or a placeholder name)', ex); continue; }
    if (!ex.id) { skip('no GLOBALID (no stable id)', ex); continue; }
    if (privateShare(c) >= 0.5) { skip('private street (the City\'s centerline: owned by Private)', ex); continue; }
    const a = crossAt(fi, 0), b = crossAt(fi, 1);
    const l = a && b && a !== b ? `${a} - ${b}` : a || b;
    const odd = oddSide(p), n = houseRange(p);
    if (runs.length > 1) checks.cutAtZoneBoundary++;
    runs.forEach(([d0, d1, zl, zr], k) => {
      const g = round6(runs.length > 1 ? cut(c, d0, d1) : c);
      if (g.length < 2) return;
      const d = [];
      for (const [side, zid] of [['L', zl], ['R', zr]]) {
        const z = zid && zoneInfo.get(zid);
        if (!z || z.dec.skip) continue;
        if (z.dec.kind === 'both') d.push([side, compass(g, side), [z.dec.rule.slice()], z.id]);
        else {
          checks.splitZoneSides++;
          if (!odd) { checks.splitZoneSidesNoParity++; continue; }
          const isOdd = side === odd;
          d.push([side, isOdd ? 'Odd side' : 'Even side', [(isOdd ? z.dec.odd : z.dec.even).slice()], z.id]);
        }
      }
      if (!d.length) {   // a piece of a cut block lying in an unswept zone, or a side-by-side zone side with no house numbers
        const z = zoneInfo.get(zl || zr || '');
        skip(z && z.dec.skip ? `${z.dec.skip} (piece of a block cut at a zone boundary)` : z ? 'side-by-side zone, no house numbers to tell the sides apart' : 'piece of a block outside every zone', { ...ex, ...(z ? { zone: z.code } : {}) });
        return;
      }
      if (d.length === 2 && d[0][3] !== d[1][3]) checks.sidesInDifferentZones++;
      for (const x of d) zoneSides.set(x[3], (zoneSides.get(x[3]) || 0) + 1);
      blocks.push({ c: runs.length > 1 ? `${ex.id}-${k + 1}` : ex.id, s: name, l, n, o: odd, g, d: d.map(([side, label, rules]) => [side, label, rules]) });
    });
  }
  // neighborhoods
  const hoodAt = (pt) => hoods.find((h) => inPolygon(pt, h.geometry));
  for (const b of blocks) {
    const mid = b.g[Math.floor(b.g.length / 2)], h = hoodAt(mid);
    const out = { c: b.c, s: b.s, l: b.l, ...(h ? { h: h.properties.Neighborhood } : {}), ...(b.n ? { n: b.n } : {}), ...(b.o ? { o: b.o } : {}), g: b.g, d: b.d };
    Object.keys(b).forEach((k) => delete b[k]); Object.assign(b, out);
  }
  const ids = new Set();
  for (const b of blocks) { if (ids.has(b.c)) throw new Error(`duplicate block id ${b.c}`); ids.add(b.c); }
  blocks.sort((x, y) => x.s.localeCompare(y.s) || x.l.localeCompare(y.l) || x.c.localeCompare(y.c));

  // ---- zones: decoded, left out ----
  const zoneRows = zoneList.map((z) => ({ id: z.id, route: z.code, day: z.day, sides: zoneSides.get(z.id) || 0, ...(z.dec.skip ? { leftOut: z.dec.skip } : { rule: z.dec.rule || { odd: z.dec.odd, even: z.dec.even } }) }))
    .sort((a, b) => a.route.localeCompare(b.route) || +a.id - +b.id);
  const swept = zoneRows.filter((z) => z.route !== 'NOSWEEP');
  const leftOut = swept.filter((z) => z.leftOut);

  // ---- write ----
  const sides = blocks.reduce((s, b) => s + b.d.length, 0), nRules = blocks.reduce((s, b) => s + b.d.reduce((t, d) => t + d[2].length, 0), 0);
  let W = 180, S = 90, E = -180, N = -90;
  for (const b of blocks) for (const [lo, la] of b.g) { W = Math.min(W, lo); E = Math.max(E, lo); S = Math.min(S, la); N = Math.max(N, la); }
  const pad = 0.005, r4 = (v) => Math.round(v * 1e4) / 1e4;
  const bboxOf = (geom) => {
    let w = 180, s = 90, e = -180, n = -90;
    const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
    for (const ring of rings) for (const [lo, la] of ring) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
    return [w, s, e, n].map((v) => v.toFixed(4)).join(',');
  };
  const perHood = {};
  for (const b of blocks) if (b.h) perHood[b.h] = (perHood[b.h] || 0) + 1;
  const sources = [
    { name: 'Street Sweeping Zones (City of Riverside Public Works, open data)', url: ZONES, license: 'City of Riverside Open Data (no license stated)', fetched },
    { name: 'Street Sweeping Schedule map (City of Riverside; the week pair of each route, read by hand)', url: SCHEDULE_MAP, license: 'City document', fetched },
    { name: 'Streets (Riverside County TLMA GIS; block lines, names, address ranges)', url: STREETS, license: 'Riverside County GIS open data, public use', fetched },
    { name: 'Street Centerlines (City of Riverside; only to drop private streets)', url: CITY_LINES, license: 'City of Riverside Open Data (no license stated)', fetched },
    { name: 'Neighborhoods (City of Riverside)', url: HOODS, license: 'City of Riverside Open Data (no license stated)', fetched },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'riverside', time_zone: TZ, generated: new Date().toISOString(), sources, blocks: blocks.length, sides,
      format: 'b[] = {c: GLOBALID of the County street line (-1, -2 when a zone boundary cuts it), s: street, l: cross streets (first point to last), h: neighborhood, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label or Odd side/Even side, rules]]}; '
        + 'rule = [jsDow, from, to, weeksMask (5 = 1st & 3rd, 10 = 2nd & 4th), monthsMask (0 = all year), flags (0: ticket, no tow)]. Each side takes the schedule of the zone it lies in.' },
    b: blocks }));

  const center = [33.961, -117.3915];   // the Wood Streets, next to Magnolia Center (Downtown's zone 506/7 is left out)
  const city = {
    id: 'riverside', name: 'Riverside', region: 'California', tz: TZ,
    center, zoom: 15, bounds: [[r4(S - pad), r4(W - pad)], [r4(N + pad), r4(E + pad)]],
    holidays: HOLIDAYS, holidaysSource: CALENDAR, holidayRule: 'all',
    fine: '$46', tow: 'no', fineSource: FEES,
    agency: 'Riverside Public Works', scheduleUrl: PROGRAM,
    sources,
    words: {
      rule: 'No parking on your street\'s posted sweeping day, the 1st & 3rd or 2nd & 4th Tuesday, Wednesday, Thursday or Friday of the month, 7:30 to 11:30 AM or 11:30 AM to 3:30 PM.',
      afterpass: 'All year · no sweeping on City holidays or a 5th week, and no make-up day · $46 ticket, no tow',
      dataNotes: `Zones come from the City's Street Sweeping Zones layer; which weeks each route is swept comes from the City's own Street Sweeping Schedule map, which colors every zone by its schedule. Each side of a street takes the schedule of the zone it lies in. ${leftOut.length} of the City's ${swept.length} swept zones are left off because the map gives no weeks or hours for them.`,
    },
    neighborhoods: hoods.filter((h) => (perHood[h.properties.Neighborhood] || 0) >= 20).sort((x, y) => x.properties.Neighborhood.localeCompare(y.properties.Neighborhood))
      .map((h) => ({ name: h.properties.Neighborhood, bbox: bboxOf(h.geometry) })),
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1) + '\n');

  const report = {
    generated: new Date().toISOString(),
    inputs: { zones: zones.length, sweptZones: swept.length, noSweepZones: zoneRows.length - swept.length, countyStreetLines: streets.length,
      privateCityCenterlines: privateLines.length, neighborhoods: hoods.length },
    output: { blocks: blocks.length, sides, rules: nRules, sizeBytes: 0, zonesUsed: swept.length - leftOut.length, zonesLeftOut: leftOut.length,
      blocksByNeighborhood: Object.fromEntries(Object.entries(perHood).sort(([a], [b]) => a.localeCompare(b))) },
    season: { from: null, to: null, note: 'All year, Tuesday to Friday; Mondays, weekends, City holidays and the 5th occurrence of a weekday have no sweeping (the City\'s 2026 calendar).' },
    zonesLeftOut: leftOut.map((z) => ({ id: z.id, route: z.route, day: z.day, why: z.leftOut })),
    zones: zoneRows,
    skipped: [...skipped.values()].sort((a, b) => b.count - a.count),
    checks: { ...checks,
      method: `Each County collector and residential street line is sampled every ${STEP} m; points ${OFFSET} m to its left and right are placed in a zone. A side takes its zone's schedule; where the zone changes along the line (a boundary crossing the block), the line is cut there (pieces under ${MIN_PIECE} m join their neighbor). Lines with half or more of their length within 8 m of a City centerline owned by Private are left out.`,
      arterialsInZones: `${checks.arterialsInZones} arterial or major road lines (County CLASS 9 and 10) cross swept zones and are not shown: the City sweeps main thoroughfares weekly outside the zone schedule, and their posting is not published.` },
    mapCheck: { source: SCHEDULE_MAP, ...MAP_CHECK,
      method: 'The map PDF is georeferenced (its viewport carries corner latitudes and longitudes). Each route label\'s surrounding fill color was matched to the legend, and each current zone was sampled on a grid of interior points projected onto the rendered map; a point counts for the legend color within 20 RGB units of its pixels.' },
    assumptions: [
      'The week pair of each route comes from the City\'s Street Sweeping Schedule map (dated July 2015, still posted on riversideca.gov). Its zones and route labels match today\'s layer: 87 of the 92 swept zones show their own day, window and a single week pair on the map.',
      'A = 7:30 to 11:30 AM and P = 11:30 AM to 3:30 PM, the two windows the City\'s Street Sweeping Program page gives; the first digit of the code is the weekday (2 Tuesday, 3 Wednesday, 4 Thursday, 5 Friday), as the layer\'s own StreetSweepDay confirms on every zone.',
      '"1st & 3rd" and "2nd & 4th" count the weekday\'s occurrences in the month (weeks masks 5 and 10), as the City\'s 2026 calendar colors them; a 5th Tuesday to Friday has no sweeping.',
      'Every collector and residential street inside a zone is swept and posted on both sides (the City: signs are posted on neighborhood streets). Arterials and major roads are left out (main thoroughfares are swept weekly, not on the zone schedule); private streets (City centerline) are left out.',
      'Zone 406A\'s second polygon is shown with the layer\'s AM window although the 2015 map colors that area as the PM window (same weeks): the layer is the newer source.',
      'No tow (flags 0): the City writes a $46 ticket (RMC 10.52.030(a), Fees and Charges as of July 1, 2026) and mentions no tow.',
      'Holidays: the days marked H on the City\'s 2026 Street Sweeping Schedule; a holiday cancels that week\'s sweep with no make-up day (the City\'s FAQ). 2027 follows the same list with the 2026 weekend rule (derived).',
    ],
    unverified: [
      'The week pair of the four Wednesday zones changed in 2023 (313A, 313P, 315A, 315P): left out. The 2015 map shows the old Friday routes there as 1st & 3rd, and odd routes are 1st & 3rd everywhere else on the map, so 1st & 3rd Wednesday is likely, but no City source says so.',
      'The hours of the side-by-side zones 206/7 and 208/9 (Tuesday) and 506/7 (Friday, Downtown): the map gives odd side 1st & 3rd, even side 2nd & 4th, but no window. Left out.',
      'Zone 406A\'s second polygon: AM (layer) or PM (2015 map).',
      'That arterial streets inside zones are not posted for the zone schedule.',
      'The 2027 holidays (derived).',
    ],
    questionsForCity: [
      'Zones 313A, 313P, 315A and 315P (Wednesday since 2023): are they swept on the 1st & 3rd or the 2nd & 4th Wednesday?',
      'Zones 206/7 and 208/9 (Tuesday) and 506/7 (Friday, Downtown): what are the posted hours on each side?',
      'Zone 406A: is the part east of the 2015 route 406P now swept in the morning (7:30 to 11:30) or still in the afternoon?',
      'Could the Street Sweeping Zones layer carry the week pair (1st & 3rd or 2nd & 4th) and the hours, so the schedule does not depend on the 2015 map?',
      'Are main thoroughfares (weekly sweeping) posted with no parking hours, and where?',
    ],
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');
  report.output.sizeBytes = fs.statSync(OUT + 'segments.json').size;
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');
  log(`${blocks.length} blocks, ${sides} sides, ${nRules} rules; zones used ${swept.length - leftOut.length} of ${swept.length} swept (${leftOut.length} left out: ${leftOut.map((z) => z.route).join(', ')})`);
  log(`skipped: ${[...skipped.values()].map((s) => `${s.count} ${s.why}`).join('; ')}`);
  log(`cut at zone boundaries ${checks.cutAtZoneBoundary}, sides in two zones ${checks.sidesInDifferentZones}, split-zone sides ${checks.splitZoneSides} (no parity ${checks.splitZoneSidesNoParity}), arterials in zones ${checks.arterialsInZones}`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/riverside/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
