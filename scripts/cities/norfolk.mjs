#!/usr/bin/env node
// Norfolk, Virginia for CURB (started 2026-10-18; city-build.md in docs/multi-city/). Builds data/norfolk/ from the City
// of Norfolk's open data:
//
//   1. Street Sweeping Schedule (data.norfolk.gov pic8-i2xr, Public Works): one row per address point and sweep date in
//      2026 (77,706 addresses x their dates), with the date's words ("Second Tuesday of November") and whether the curb
//      in front has enforcement signs (signed_area). Only signed curbs get a ticket or a tow: the rest is swept on the
//      same kind of monthly day with advisory signs or none, so it is left out (counted in report.json).
//   2. Street Centerline (gisshare.norfolk.gov OpenData/Public_Works/FeatureServer/1): 16,067 block lines with left and
//      right address ranges. Each signed address is placed on the block of its street whose range holds its number, and on
//      the side whose range has its parity (odd or even); where the ranges can't tell, on the side of the line it lies on.
//   3. Planning Districts (OpenData/Planning/FeatureServer/2): the neighborhood name of each block.
//   4. Parking Citations (data.norfolk.gov ei2q-6g8n): the street cleaning tickets of Jan 2022 to Mar 2024, read for the
//      time of day and the street only (the table also holds plates: never fetched), to check the hours and the days.
//
// The City publishes no hours: they are on the signs. The window here, 8 AM to 2 PM, is what the tickets show (none of
// 7,465 street cleaning tickets before 8:00 or after 1:50 PM). Sweeping stops on City holidays (each closure notice says
// "no ... street sweeping operations"), and a signed street missed for any reason "can not be rescheduled", so the build
// drops every City holiday from the dates (the data still lists Thanksgiving, Christmas, Veterans Day and others).
//
// Writes data/norfolk/segments.json, city.json, report.json.
// Run: node scripts/cities/norfolk.mjs [--refresh]   (Node 18+; inputs cached in private/cache/norfolk/, about 95 MB)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/norfolk/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/norfolk/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[norfolk]', ...a);

export const TZ = 'America/New_York';
const SCHEDULE_CSV = 'https://data.norfolk.gov/api/views/pic8-i2xr/rows.csv?accessType=DOWNLOAD';
const SCHEDULE_META = 'https://data.norfolk.gov/api/views/pic8-i2xr.json';
const CENTERLINE = 'https://gisshare.norfolk.gov/pubserver/rest/services/OpenData/Public_Works/FeatureServer/1/query';
const DISTRICTS = 'https://gisshare.norfolk.gov/pubserver/rest/services/OpenData/Planning/FeatureServer/2/query';
const CITATIONS = 'https://data.norfolk.gov/resource/ei2q-6g8n.json';

// The posted window, inferred from the tickets (see the top of this file): 8 AM to 2 PM. Signs can be towed (2).
export const WINDOW = [8, 14];
export const FLAGS = 2;

// City holidays, City Code Sec. 2-48 (norfolk.gov/4740/Holidays, read 2026-10-18): a Saturday holiday is observed the
// Friday before, a Sunday one the Monday after. 2027 dates as the Norfolk Public Library's Holiday Closings table lists
// them (norfolk.gov/6121/Holiday-Closings), which follows the same rule; in 2027 Christmas falls on a Saturday, so
// Christmas Day is observed Friday Dec 24 and Christmas Eve Thursday Dec 23 (the library's table; unconfirmed by HR).
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': "Martin Luther King's Birthday", '2026-02-16': "Washington's Birthday",
  '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day', '2026-11-03': 'Election Day', '2026-11-11': 'Veterans Day', '2026-11-26': 'Thanksgiving Day',
  '2026-11-27': 'Day after Thanksgiving', '2026-12-24': 'Christmas Eve', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': "Martin Luther King's Birthday", '2027-02-15': "Washington's Birthday",
  '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)', '2027-07-05': 'Independence Day (observed)',
  '2027-09-06': 'Labor Day', '2027-11-02': 'Election Day', '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving Day',
  '2027-11-26': 'Day after Thanksgiving', '2027-12-23': 'Christmas Eve (observed)', '2027-12-24': 'Christmas Day (observed)',
};

// ---------- pure helpers (exported for the tests) ---------------------------------------------------

// One CSV line → fields (the export has no quotes today, but a quoted field with commas must not shift the columns).
export function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

// The schedule's street spelling → the centerline's FULLNAME, for the names that differ.
export const ALIAS = { 'REDGATED AVENUE': 'REDGATE AVENUE', 'PREMIUM OUTLETS BOULEVARD': 'PREMIUM OUTLET BOULEVARD' };
export const normStreet = (s) => { const k = String(s || '').toUpperCase().replace(/\s+/g, ' ').trim(); return ALIAS[k] || k; };

// "1000 34TH STREET" → { num: 1000, street: '34TH STREET' }; "1000A …" keeps the number. null when there is no number.
// A letter after a space is part of the street ("123 W OLNEY ROAD", "12 A VIEW AVENUE"), never a unit.
export function parseAddress(a) {
  const m = /^\s*(\d+)([A-Z])?\s+(.+?)\s*$/i.exec(String(a || ''));
  return m ? { num: +m[1], street: normStreet(m[3]) } : null;
}

const ORDINAL = { First: 1, Second: 2, Third: 3, Fourth: 4, Fifth: 5 };
const WEEKDAY = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "Second Tuesday of November" → { nth: 2, dow: 2, month: 11 }; "Daily" → { daily: true }; anything else → null.
export function parseDescription(s) {
  const t = String(s || '').trim();
  if (/^daily$/i.test(t)) return { daily: true };
  const m = /^(First|Second|Third|Fourth|Fifth) (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) of (\w+)$/.exec(t);
  if (!m || !MONTH.includes(m[3])) return null;
  return { nth: ORDINAL[m[1]], dow: WEEKDAY[m[2]], month: MONTH.indexOf(m[3]) + 1 };
}
// The pattern without the month ("Second Tuesday"), the key a block side is grouped on.
export const patternOf = (s) => String(s || '').replace(/ of \w+$/, '').trim();
// "11/10/2026" → "2026-11-10"
export function isoDate(mdy) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(mdy || '').trim());
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}
// The nth weekday of its month that a local date is ({ nth, dow, month }).
export function nthWeekday(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  return { nth: Math.floor((d - 1) / 7) + 1, dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(), month: mo };
}
export function descriptionMatches(desc, iso) {
  const p = parseDescription(desc);
  if (!p || p.daily) return !!p;
  const w = nthWeekday(iso);
  return p.nth === w.nth && p.dow === w.dow && p.month === w.month;
}
// The listed dates minus the City holidays: { kept, dropped } (both sorted, unique).
export function dropHolidays(dates, holidays = HOLIDAYS) {
  const all = [...new Set(dates)].sort();
  return { kept: all.filter((d) => !(d in holidays)), dropped: all.filter((d) => d in holidays) };
}

// An address range ("501", "531") → { lo, hi, parity } (parity 0|1, or null for a mixed range); null when empty.
export function rangeOf(fr, to) {
  const a = parseInt(fr, 10), b = parseInt(to, 10);
  const v = [a, b].filter((x) => Number.isFinite(x) && x > 0);
  if (!v.length) return null;
  const lo = Math.min(...v), hi = Math.max(...v);
  return { lo, hi, parity: lo % 2 === hi % 2 ? lo % 2 : null };
}
const inRange = (r, n) => !!r && n >= r.lo && n <= r.hi;
// The side of a centerline segment (looking from its first point to its last) that holds house number `num`:
// the side whose range holds the number with its parity, else the only side with that parity, else null.
export function sideByParity(p, num) {
  const L = rangeOf(p.LADD_FR, p.LADD_TO), R = rangeOf(p.RADD_FR, p.RADD_TO), par = num % 2;
  const inL = inRange(L, num) && L.parity === par, inR = inRange(R, num) && R.parity === par;
  if (inL !== inR) return inL ? 'L' : 'R';
  const lp = L ? L.parity : null, rp = R ? R.parity : null;
  if (lp === par && rp !== par) return 'L';
  if (rp === par && lp !== par) return 'R';
  return null;
}
export const holdsNumber = (p, num) => inRange(rangeOf(p.LADD_FR, p.LADD_TO), num) || inRange(rangeOf(p.RADD_FR, p.RADD_TO), num);
// Which side has the odd numbers (Boston's rule: the side whose range starts or ends odd, when the other doesn't).
export function oddSide(p) {
  const par = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n % 2 : null; };
  const l = par(p.LADD_FR) ?? par(p.LADD_TO), r = par(p.RADD_FR) ?? par(p.RADD_TO);
  if (l === 1 && r !== 1) return 'L';
  if (r === 1 && l !== 1) return 'R';
  return null;
}

// Local meters around Norfolk (equirectangular; ample for a city 25 km across).
const LAT0 = 36.88, LON0 = -76.25, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110950;
export const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
// Distance in meters from a point to a line, and which side of the line it lies on (L = left looking along the line).
export function nearestOnLine(c, pt) {
  const [px, py] = xy(pt);
  let best = null;
  for (let i = 1; i < c.length; i++) {
    const [x1, y1] = xy(c[i - 1]), [x2, y2] = xy(c[i]);
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    const d = Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
    if (!best || d < best.d) best = { d, side: dx * (py - y1) - dy * (px - x1) > 0 ? 'L' : 'R' };
  }
  return best;
}

// A block whose address ranges are on the wrong sides of its line: of the address points within 40 m that have a side from
// their numbers, at least 3 sit on the other side, and more than four times as many as sit on the side the numbers give.
export const flippedRanges = ({ ok, bad }) => bad >= 3 && bad > 4 * ok;

// One address → its block and side. `streets` maps a FULLNAME to its segments ({ id, p, c }).
export const NEAREST_MAX = 60;   // meters: a fallback to the nearest block of the street must be this close
export function snapAddress({ num, street, lon, lat }, streets) {
  const cands = streets.get(street) || [];
  if (!cands.length) return { why: 'street not in the centerline' };
  const pt = [lon, lat];
  const ranged = cands.filter((s) => holdsNumber(s.p, num));
  const pool = ranged.length ? ranged : cands;
  let pick = null;
  for (const s of pool) { const n = nearestOnLine(s.c, pt); if (!pick || n.d < pick.n.d) pick = { s, n }; }
  const how = ranged.length ? 'range' : 'nearest';
  if (how === 'nearest' && pick.n.d > NEAREST_MAX) return { why: `no block of the street holds the number, nearest over ${NEAREST_MAX} m` };
  const paritySide = sideByParity(pick.s.p, num), geoSide = pick.n.side;
  return { seg: pick.s, how, dist: pick.n.d, paritySide, geoSide, side: paritySide || geoSide };
}

const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
// The compass side of a block (boston.mjs): which way the L or R curb faces, from the line's first point to its last.
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}

const TYPE = { STREET: 'St', AVENUE: 'Ave', ROAD: 'Rd', DRIVE: 'Dr', BOULEVARD: 'Blvd', HIGHWAY: 'Hwy', COURT: 'Ct',
  LANE: 'Ln', CIRCLE: 'Cir', PLACE: 'Pl', TERRACE: 'Ter', PARKWAY: 'Pkwy', SQUARE: 'Sq' };
const word = (w) => /^\d+(ST|ND|RD|TH)$/.test(w) ? w.toLowerCase() : /^\d+[A-Z]*$/.test(w) ? w
  : /^MC[A-Z]{2,}$/.test(w) ? 'Mc' + w[2] + w.slice(3).toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase();
export function titleCase(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).map((w) => w.split(/([-\/])/).map((x) => (/^[-\/]$/.test(x) ? x : word(x))).join('')).join(' ');
}
// "W OLNEY ROAD" → "W Olney Rd", "34TH STREET" → "34th St", "BERKLEY AVENUE EX" → "Berkley Ave Ext", "AVENUE H" → "Avenue H"
export function streetLabel(fullname) {
  const w = String(fullname || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
  let ext = false;
  if (w.length > 2 && w[w.length - 1] === 'EX') { ext = true; w.pop(); }
  const out = w.map((x, i) => {
    if (i === 0 && w.length > 1 && /^[NSEW]$/.test(x)) return x;
    if (i === w.length - 1 && i > 0 && TYPE[x]) return TYPE[x];
    return titleCase(x);
  });
  return out.join(' ') + (ext ? ' Ext' : '');
}
// Centerline names that are no street a driver would name: ramps and connectors, alleys, interstates.
export const notACrossStreet = (key) => /^(MISCELLANEOUS STREET|PUBLIC ALLEY STREET)$/.test(key) || /^I-\d/.test(key);
// A Planning District name as people write it: "LAYFAYETTE" (the layer's spelling) → "Lafayette", "LAMBERTS POINT / ODU" → "Lamberts Point / ODU".
export const DISTRICT_FIX = { LAYFAYETTE: 'Lafayette' };
export function districtName(t) {
  const k = String(t || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!k) return '';
  return DISTRICT_FIX[k] || titleCase(k).replace(/\bOdu\b/g, 'ODU').replace(/\bBlvd\.$/, 'Blvd');
}
// Point in a GeoJSON Polygon / MultiPolygon (rings in lng, lat).
export function inPolygon(pt, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  return polys.some((rings) => inRing(rings[0]) && !rings.slice(1).some(inRing));
}
// Halfway along a line (by length).
export function midpoint(c) {
  const p = c.map(xy);
  let total = 0;
  for (let i = 1; i < p.length; i++) total += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  let half = total / 2;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (d && half <= d) { const t = half / d; return [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t]; }
    half -= d;
  }
  return c[c.length - 1];
}
export const r6 = (v) => Math.round(v * 1e6) / 1e6;
// The one rule of a signed side: no parking 8 to 14 on each listed date, towable.
export const ruleOf = (dates) => [-1, WINDOW[0], WINDOW[1], 0, 0, FLAGS, [...new Set(dates)].sort()];

// ---------- fetching ------------------------------------------------------------------------------

async function get(url, as = 'json', tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: as === 'json' ? 'application/json' : 'text/csv', 'User-Agent': 'curb-norfolk-build (+https://curb.guide)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return as === 'json' ? await r.json() : await r.text();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 3000 * i));
    }
  }
}
async function cached(name, fetcher, as = 'json') {
  const f = CACHE + name;
  if (!REFRESH && fs.existsSync(f)) return as === 'json' ? JSON.parse(fs.readFileSync(f, 'utf8')) : fs.readFileSync(f, 'utf8');
  const v = await fetcher();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, as === 'json' ? JSON.stringify(v) : v);
  return v;
}
async function arcgisAll(url, fields) {
  const out = [];
  for (let off = 0; ; off += 2000) {
    const q = new URLSearchParams({ where: '1=1', outFields: fields, outSR: '4326', f: 'geojson', orderByFields: 'OBJECTID',
      resultOffset: off, resultRecordCount: 2000 });
    const page = (await get(`${url}?${q}`)).features;
    if (!Array.isArray(page)) throw new Error(`no features from ${url}`);
    out.push(...page);
    if (page.length < 2000) return out;
  }
}
const need = (cond, msg) => { if (!cond) throw new Error(`Norfolk data changed shape: ${msg}`); };

// ---------- the build -----------------------------------------------------------------------------

async function main() {
  const CL_FIELDS = 'OBJECTID,UNIQUE_NO,FULLNAME,LADD_FR,LADD_TO,RADD_FR,RADD_TO';
  const csv = await cached('schedule.csv', () => { log('fetching the sweeping schedule (about 90 MB)…'); return get(SCHEDULE_CSV, 'text'); }, 'text');
  const meta = await cached('schedule-meta.json', async () => {
    const m = await get(SCHEDULE_META);
    return { name: m.name, rowsUpdatedAt: m.rowsUpdatedAt, columns: m.columns.map((c) => c.fieldName) };
  });
  const lines = await cached('centerlines.json', () => { log('fetching street centerlines…'); return arcgisAll(CENTERLINE, CL_FIELDS); });
  const districts = await cached('planning-districts.json', () => { log('fetching planning districts…'); return arcgisAll(DISTRICTS, 'OBJECTID,TEXT'); });
  const tickets = await cached('citations-street-cleaning.json', () => {
    log('fetching street cleaning tickets (time and street only)…');
    const where = "upper(violation_description) like '%CLEAN%' OR upper(violation_description) like '%SWEEP%'";
    const q = new URLSearchParams({ $select: 'date_and_time_issued,location,violation_description', $where: where, $limit: '50000', $order: 'date_and_time_issued' });
    return get(`${CITATIONS}?${q}`);
  });

  // ----- 1. the schedule, one entry per address
  const rows = csv.split(/\r?\n/).filter((l) => l.trim());
  const HEADER = ['Address', 'Latitude', 'Longitude', 'Sweeping Date', 'Sweeping Day Description', 'Signed Area', 'Sweeping Frequency'];
  need(JSON.stringify(parseCsvLine(rows[0])) === JSON.stringify(HEADER), `CSV header is ${rows[0]}`);
  need(rows.length - 1 > 800000 && rows.length - 1 < 1500000, `${rows.length - 1} schedule rows`);
  const addr = new Map();   // address → { signed, freq, lat, lon, patterns: Set, dates: Set }
  const counts = { rows: rows.length - 1, signedRows: 0, unsignedRows: 0, dailyRows: 0, badDate: 0, badDescription: [], years: {} };
  for (let i = 1; i < rows.length; i++) {
    const [a, la, lo, d, desc, signed, freq] = parseCsvLine(rows[i]);
    const iso = isoDate(d);
    if (!iso) { counts.badDate++; continue; }
    counts.years[iso.slice(0, 4)] = (counts.years[iso.slice(0, 4)] || 0) + 1;
    if (!descriptionMatches(desc, iso)) { if (counts.badDescription.length < 2000) counts.badDescription.push(`${desc} on ${iso}`); continue; }
    if (signed === 'Yes') counts.signedRows++; else counts.unsignedRows++;
    if (freq === 'Daily') counts.dailyRows++;
    let e = addr.get(a);
    if (!e) addr.set(a, (e = { signed: signed === 'Yes', freq, lat: +la, lon: +lo, patterns: new Set(), dates: new Set(), mixed: false }));
    if ((signed === 'Yes') !== e.signed) e.mixed = true;
    e.patterns.add(patternOf(desc));
    e.dates.add(iso);
  }
  need(counts.badDate === 0, `${counts.badDate} rows without a date`);
  need(counts.badDescription.length < counts.rows * 0.005, `${counts.badDescription.length} rows whose date is not their description's day, e.g. ${counts.badDescription.slice(0, 3)}`);
  const signedAddr = [...addr].filter(([, e]) => e.signed);
  need(signedAddr.length > 5000 && signedAddr.length < 20000, `${signedAddr.length} signed addresses`);
  need([...addr.values()].every((e) => !e.mixed), 'an address is both signed and unsigned');

  // ----- 2. centerlines and the street graph
  need(lines.length > 14000 && lines.length < 19000, `${lines.length} centerline segments`);
  const segs = [], streets = new Map(), byId = new Map();
  for (const f of lines) {
    const p = f.properties, c = f.geometry && f.geometry.coordinates;
    need(p && 'UNIQUE_NO' in p && 'FULLNAME' in p && 'LADD_FR' in p && 'RADD_TO' in p, 'centerline fields');
    if (!c || f.geometry.type !== 'LineString' || c.length < 2 || !String(p.FULLNAME || '').trim()) continue;
    const s = { id: String(p.UNIQUE_NO), p, c, key: normStreet(p.FULLNAME), name: streetLabel(p.FULLNAME) };
    need(!byId.has(s.id), `UNIQUE_NO ${s.id} twice`);
    byId.set(s.id, s); segs.push(s);
    if (!streets.has(s.key)) streets.set(s.key, []);
    streets.get(s.key).push(s);
  }
  const nodeId = ([lon, lat]) => lon.toFixed(5) + ',' + lat.toFixed(5);
  const nodeStreets = new Map();
  for (const s of segs) for (const n of [nodeId(s.c[0]), nodeId(s.c[s.c.length - 1])]) {
    if (!nodeStreets.has(n)) nodeStreets.set(n, new Map());
    nodeStreets.get(n).set(s.key, s.name);
  }
  // Cross streets of a block: the other streets at each end ("Colonial Ave - Westover Ave"), never a placeholder name
  // (the centerline calls ramps and connectors "MISCELLANEOUS STREET") or an interstate.
  // Where a street's line is split with no street crossing (a bend, a change of width), walk on along the same street,
  // up to 6 pieces, to the next corner.
  const nodeSegs = new Map();
  for (const s of segs) for (const n of [nodeId(s.c[0]), nodeId(s.c[s.c.length - 1])]) {
    if (!nodeSegs.has(n)) nodeSegs.set(n, []);
    nodeSegs.get(n).push(s);
  }
  const crossAt = (n) => [...(nodeStreets.get(n) || new Map()).entries()].filter(([k]) => !notACrossStreet(k));
  const limitsOf = (s) => {
    const end = (n) => {
      let from = s;
      for (let hop = 0; hop < 6; hop++) {
        const other = crossAt(n).filter(([k]) => k !== s.key).map(([, v]) => v).sort();
        if (other.length) return other[0];
        const next = (nodeSegs.get(n) || []).filter((x) => x !== from && x.key === s.key);
        if (next.length !== 1) return '';
        from = next[0];
        n = nodeId(from.c[0]) === n ? nodeId(from.c[from.c.length - 1]) : nodeId(from.c[0]);
      }
      return '';
    };
    const a = end(nodeId(s.c[0])), b = end(nodeId(s.c[s.c.length - 1]));
    return a && b && a !== b ? `${a} - ${b}` : a || b;
  };
  need(districts.length > 50 && districts.length < 150, `${districts.length} planning districts`);
  const hoods = districts.filter((f) => f.geometry && f.properties && f.properties.TEXT).map((f) => {
    const g = f.geometry, rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
    let w = 180, so = 90, e = -180, n = -90;
    for (const ring of rings) for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < so) so = y; if (y > n) n = y; }
    return { name: districtName(f.properties.TEXT), g, bb: [w, so, e, n] };
  });
  const hoodAt = (pt) => (hoods.find((h) => pt[0] >= h.bb[0] && pt[0] <= h.bb[2] && pt[1] >= h.bb[1] && pt[1] <= h.bb[3] && inPolygon(pt, h.g)) || {}).name || '';

  // ----- 3. addresses → block sides
  // Every address (signed or not) is placed first, so each block can be checked: where the points near the line sit on the
  // other side from the one their numbers give, on most of a block, its address ranges are on the wrong sides of the line,
  // and the points decide (flippedRanges).
  const placed = [];
  for (const [a, e] of addr) {
    const pa = parseAddress(a);
    placed.push({ a, e, pa, r: pa ? snapAddress({ ...pa, lon: e.lon, lat: e.lat }, streets) : { why: 'no house number' } });
  }
  const vote = new Map();     // segment id → { ok, bad } among points within 40 m that have a side from their numbers
  const allPoints = { withSide: 0, agree: 0 };
  for (const { r } of placed) {
    if (r.seg && r.paritySide) { allPoints.withSide++; if (r.paritySide === r.geoSide) allPoints.agree++; }
    if (!r.seg || !r.paritySide || r.dist >= 40) continue;
    const v = vote.get(r.seg.id) || { ok: 0, bad: 0 };
    if (r.paritySide === r.geoSide) v.ok++; else v.bad++;
    vote.set(r.seg.id, v);
  }
  const flipped = new Set([...vote].filter(([, v]) => flippedRanges(v)).map(([id]) => id));
  const sides = new Map();    // "id|L" → { seg, side, signed: n, unsigned: n, patterns: Map(pattern → n), dates: Set }
  const snap = { range: 0, nearest: 0, skipped: [], parityKnown: 0, agree: 0, disagree: 0, disagreeBy: new Map(), farRange: 0, geoOnly: 0, flippedSegments: [], flippedAddresses: 0, disagreeOnFlipped: 0 };
  const skippedStreets = new Map(), unsignedOnly = { skipped: 0 };
  for (const { a, e, pa, r: r0 } of placed) {
    if (!pa) { if (e.signed) snap.skipped.push({ why: 'no house number', count: 1, examples: [] }); continue; }
    const r = r0.seg && flipped.has(r0.seg.id) ? { ...r0, side: r0.geoSide, flipped: true } : r0;
    if (!r.seg) {
      if (e.signed) {
        const k = `${pa.street}|${r.why}`;
        skippedStreets.set(k, (skippedStreets.get(k) || 0) + 1);
      } else unsignedOnly.skipped++;
      continue;
    }
    if (e.signed && r.flipped) snap.flippedAddresses++;
    const k = r.seg.id + '|' + r.side;
    if (!sides.has(k)) sides.set(k, { seg: r.seg, side: r.side, signed: 0, unsigned: 0, patterns: new Map(), dates: new Set() });
    const sd = sides.get(k);
    if (!e.signed) { sd.unsigned++; continue; }
    sd.signed++;
    sd.nearest = Math.min(sd.nearest ?? Infinity, r.dist);
    snap[r.how]++;
    if (r.how === 'range' && r.dist > NEAREST_MAX) snap.farRange++;
    if (r.paritySide) {
      snap.parityKnown++;
      if (r.paritySide === r.geoSide) snap.agree++;
      else {
        snap.disagree++;
        if (r.flipped) snap.disagreeOnFlipped++;
        else {
          const g = snap.disagreeBy.get(r.seg.id) || { name: r.seg.name, n: 0, min: Infinity, max: 0 };
          g.n++; g.min = Math.min(g.min, r.dist); g.max = Math.max(g.max, r.dist);
          snap.disagreeBy.set(r.seg.id, g);
        }
      }
    } else snap.geoOnly++;
    for (const p of e.patterns) sd.patterns.set(p, (sd.patterns.get(p) || 0) + 1);
    for (const d of e.dates) sd.dates.add(d);
  }
  // Skipped signed addresses, one entry per reason, the streets as examples ("E Charlotte St (125)").
  const byWhy = new Map();
  for (const [k, n] of [...skippedStreets].sort((x, y) => y[1] - x[1])) {
    const [street, why] = k.split('|');
    const w = byWhy.get(why) || { why, count: 0, examples: [] };
    w.count += n; w.examples.push(`${streetLabel(street)} (${n})`);
    byWhy.set(why, w);
  }
  snap.skipped.push(...byWhy.values());
  for (const id of flipped) {
    const s = byId.get(id), v = vote.get(id), signedHere = ['L', 'R'].reduce((n, lr) => n + (sides.get(id + '|' + lr)?.signed || 0), 0);
    snap.flippedSegments.push({ c: id, s: s.name, l: limitsOf(s), pointsAgree: v.ok, pointsDisagree: v.bad, signedAddresses: signedHere });
  }
  snap.flippedSegments.sort((x, y) => y.signedAddresses - x.signedAddresses || x.c.localeCompare(y.c, 'en', { numeric: true }));

  // ----- 4. block sides → blocks and rules
  const dropped = {};
  const blocks = new Map();
  const quality = { signedSides: 0, conflictSides: 0, conflictEx: [], minoritySides: 0, minorityEx: [], mixedSides: 0, farSides: [] };
  for (const sd of sides.values()) {
    if (!sd.signed) continue;
    quality.signedSides++;
    if (sd.unsigned) quality.mixedSides++;
    if (sd.nearest > NEAREST_MAX) quality.farSides.push(`${sd.seg.name} (segment ${sd.seg.id}, ${sd.side}): ${sd.signed} signed, the nearest ${Math.round(sd.nearest)} m from the line`);
    if (sd.signed < sd.unsigned) { quality.minoritySides++; if (quality.minorityEx.length < 10) quality.minorityEx.push(`${sd.seg.name} (segment ${sd.seg.id}, ${sd.side}): ${sd.signed} signed and ${sd.unsigned} unsigned addresses`); }
    if (sd.patterns.size > 1) {
      quality.conflictSides++;
      if (quality.conflictEx.length < 12) quality.conflictEx.push(`${sd.seg.name} (segment ${sd.seg.id}, ${sd.side}): ${[...sd.patterns].map(([p, n]) => `${p} x${n}`).join(', ')}`);
    }
    const { kept, dropped: gone } = dropHolidays([...sd.dates]);
    for (const d of gone) dropped[d] = (dropped[d] || 0) + 1;
    if (!kept.length) continue;
    if (!blocks.has(sd.seg.id)) blocks.set(sd.seg.id, { seg: sd.seg, d: [] });
    blocks.get(sd.seg.id).d.push([sd.side, compass(sd.seg.c, sd.side), [ruleOf(kept)]]);
  }
  const out = [];
  for (const [id, b] of blocks) {
    const s = b.seg, p = s.p;
    const nums = ['LADD_FR', 'LADD_TO', 'RADD_FR', 'RADD_TO'].map((k) => parseInt(p[k], 10)).filter((v) => v > 0);
    const odd = oddSide(p), h = hoodAt(midpoint(s.c)), l = limitsOf(s);
    b.d.sort((x, y) => x[0].localeCompare(y[0]));
    out.push({ c: id, s: s.name, l, ...(h ? { h } : {}), ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}),
      ...(odd ? { o: odd } : {}), g: s.c.map(([lo, la]) => [r6(lo), r6(la)]), d: b.d });
  }
  out.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));

  // Every listed date is a real sweep date: none on a City holiday, all sorted, all in the data's year.
  const allDates = new Set();
  for (const b of out) for (const [, , rules] of b.d) for (const r of rules) {
    need(r.length === 7 && r[0] === -1 && Array.isArray(r[6]) && r[6].length, `rule ${JSON.stringify(r)}`);
    for (let i = 0; i < r[6].length; i++) {
      if (r[6][i] in HOLIDAYS) throw new Error(`a listed date is a City holiday: ${r[6][i]} on block ${b.c}`);
      if (i && r[6][i] <= r[6][i - 1]) throw new Error(`dates not sorted on block ${b.c}`);
      allDates.add(r[6][i]);
    }
  }
  const dateList = [...allDates].sort();
  const sideCount = out.reduce((n, b) => n + b.d.length, 0);
  const ruleCount = out.reduce((n, b) => n + b.d.reduce((m, x) => m + x[2].length, 0), 0);
  const dateEntries = out.reduce((n, b) => n + b.d.reduce((m, x) => m + x[2].reduce((k, r) => k + r[6].length, 0), 0), 0);

  // ----- 5. the tickets: hours, days, and whether the street and its day are in the signed schedule
  const T = { total: tickets.length, byYear: {}, byHour: {}, byWeekday: {}, firstMinute: null, lastMinute: null, outside: [],
    onSignedStreet: 0, dayMatches: 0, dayDiffers: 0, sameDayByYear: {}, onDailyOnlyStreet: 0, onUnsignedStreet: 0, unknownStreet: 0, differsEx: {} };
  const signedPatternsByStreet = new Map(), streetKind = new Map();
  for (const [a, e] of addr) {
    const pa = parseAddress(a); if (!pa) continue;
    const kind = e.signed ? 'signed' : e.freq === 'Daily' ? 'daily' : 'unsigned';
    // a street with any signed address is signed; else one with downtown daily addresses is daily; else unsigned
    const prev = streetKind.get(pa.street), rank = { signed: 3, daily: 2, unsigned: 1 };
    if (!prev || rank[kind] > rank[prev]) streetKind.set(pa.street, kind);
    if (e.signed) { if (!signedPatternsByStreet.has(pa.street)) signedPatternsByStreet.set(pa.street, new Set()); for (const p of e.patterns) signedPatternsByStreet.get(pa.street).add(p); }
  }
  const DOWS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], ORD = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
  for (const t of tickets) {
    // The feed writes the year as "0022" for 2022.
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(t.date_and_time_issued || '');
    if (!m) continue;
    const y = +m[1] < 100 ? 2000 + +m[1] : +m[1], iso = `${y}-${m[2]}-${m[3]}`, mins = +m[4] * 60 + +m[5];
    T.byYear[y] = (T.byYear[y] || 0) + 1;
    T.byHour[+m[4]] = (T.byHour[+m[4]] || 0) + 1;
    const w = nthWeekday(iso);
    T.byWeekday[DOWS[w.dow]] = (T.byWeekday[DOWS[w.dow]] || 0) + 1;
    if (mins >= WINDOW[0] * 60 && mins < WINDOW[1] * 60) {
      if (T.firstMinute === null || mins < T.firstMinute) T.firstMinute = mins;
      if (T.lastMinute === null || mins > T.lastMinute) T.lastMinute = mins;
    } else T.outside.push(mins);
    const st = normStreet(t.location), kind = streetKind.get(st);
    if (kind === 'signed') {
      T.onSignedStreet++;
      const pat = `${ORD[w.nth - 1]} ${DOWS[w.dow]}`;
      const yr = (T.sameDayByYear[y] ||= { tickets: 0, sameDay: 0 });
      yr.tickets++;
      if (signedPatternsByStreet.get(st).has(pat)) { T.dayMatches++; yr.sameDay++; }
      else { T.dayDiffers++; const k = `${titleCase(st)}: ticketed on a ${pat}, schedule says ${[...signedPatternsByStreet.get(st)].join(' or ')}`; T.differsEx[k] = (T.differsEx[k] || 0) + 1; }
    } else if (kind === 'daily') T.onDailyOnlyStreet++;
    else if (kind === 'unsigned') T.onUnsignedStreet++;
    else T.unknownStreet++;
  }
  const hhmm = (v) => (v === null ? null : `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`);
  const inWindow = Object.entries(T.byHour).reduce((n, [h, v]) => n + (+h >= WINDOW[0] && +h < WINDOW[1] ? v : 0), 0);

  // ----- 6. write
  const fetched = (name) => fs.statSync(CACHE + name).mtime.toISOString().slice(0, 10);   // when the cached copy was downloaded
  const sources = [
    { name: 'Street Sweeping Schedule (Public Works)', url: 'https://data.norfolk.gov/d/pic8-i2xr', license: 'not stated (City of Norfolk Open Data)', fetched: fetched('schedule.csv') },
    { name: 'Street Centerline (Public Works, Division of Surveys)', url: 'https://gisshare.norfolk.gov/pubserver/rest/services/OpenData/Public_Works/FeatureServer/1', license: 'not stated (City of Norfolk GIS)', fetched: fetched('centerlines.json') },
    { name: 'Planning Districts (Planning and Community Development)', url: 'https://gisshare.norfolk.gov/pubserver/rest/services/OpenData/Planning/FeatureServer/2', license: 'not stated (City of Norfolk GIS)', fetched: fetched('planning-districts.json') },
    { name: 'Parking Citations (street cleaning tickets, time and street only)', url: 'https://data.norfolk.gov/d/ei2q-6g8n', license: 'not stated (City of Norfolk Open Data)', fetched: fetched('citations-street-cleaning.json') },
  ];
  const season = { from: dateList[0], to: dateList[dateList.length - 1] };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'norfolk', time_zone: TZ, generated: new Date().toISOString(), sources: sources.slice(0, 3), blocks: out.length, sides: sideCount, season,
      format: 'b[] = {c: City centerline UNIQUE_NO, s: street, l: cross streets, h: planning district, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
        + 'rule = [-1, fromH, toH, 0, 0, flags (2 = towable), [local dates YYYY-MM-DD]]: no parking from fromH to toH on each listed date. Only blocks with regulatory (enforced) signs; 2026 dates, City holidays removed' },
    b: out }));

  // Neighborhoods for the welcome card: the planning districts with signed blocks, framed on those blocks.
  const hoodBox = new Map();
  for (const b of out) {
    if (!b.h) continue;
    const bb = hoodBox.get(b.h) || { n: 0, w: 180, s: 90, e: -180, nn: -90 };
    bb.n++;
    for (const [lo, la] of b.g) { if (lo < bb.w) bb.w = lo; if (lo > bb.e) bb.e = lo; if (la < bb.s) bb.s = la; if (la > bb.nn) bb.nn = la; }
    hoodBox.set(b.h, bb);
  }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const neighborhoods = [...hoodBox].filter(([, bb]) => bb.n >= 5).sort((x, y) => x[0].localeCompare(y[0]))
    .map(([name, bb]) => ({ name, bbox: [r4(bb.w - 0.001), r4(bb.s - 0.001), r4(bb.e + 0.001), r4(bb.nn + 0.001)].join(',') }));
  // Map view: bounds = every City street; center = the densest signed area (Ghent and around), zoom 15.
  let W = 180, S = 90, E = -180, N = -90;
  for (const s of segs) for (const [lo, la] of s.c) { if (lo < W) W = lo; if (lo > E) E = lo; if (la < S) S = la; if (la > N) N = la; }
  // The opening view: the 2 by 2 km window holding the most signed blocks, centered on them (Park Place, Colonial Place, Ghent).
  const mids = out.map((b) => midpoint(b.g)), near = (q) => (p) => Math.abs(p[0] - q[0]) < 0.0125 && Math.abs(p[1] - q[1]) < 0.009;
  const dense = mids.map((q) => ({ q, n: mids.filter(near(q)).length })).sort((x, y) => y.n - x.n)[0];
  const inView = mids.filter(near(dense.q));
  const center = [r4(inView.reduce((s, p) => s + p[1], 0) / inView.length), r4(inView.reduce((s, p) => s + p[0], 0) / inView.length)];
  const city = {
    id: 'norfolk', name: 'Norfolk', region: 'Virginia', tz: TZ, center, zoom: 14,
    bounds: [[r4(S), r4(W)], [r4(N), r4(E)]],
    holidays: HOLIDAYS, holidaysSource: 'https://www.norfolk.gov/4740/Holidays', holidayRule: 'all',
    fine: '$60', tow: 'sometimes', fineSource: 'https://www.norfolk.gov/493/Parking-Fine-Fees',
    agency: 'Norfolk Public Works', scheduleUrl: 'https://www.norfolk.gov/2658/Street-Sweeping',
    sources,
    words: {
      rule: 'Streets with regulatory street sweeping signs are swept on the same day each month, like the second Tuesday: no parking during the hours on the sign.',
      afterpass: 'All year. $60 ticket, and the car can be towed. No sweeping on City holidays, and a missed signed sweep is not made up.',
      dataNotes: 'Dates from the City\'s 2026 Street Sweeping Schedule (one row per address and date), only where the City marks enforcement signs, each address placed on its block and side by the City\'s centerline address ranges. '
        + 'The City publishes no hours: 8 AM to 2 PM is read from its street cleaning tickets, so the sign\'s hours win. City holidays are taken off the dates. Streets with advisory signs or none are left off: no ticket there.',
    },
    neighborhoods,
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1) + '\n');

  const unsignedSides = [...sides.values()].filter((sd) => !sd.signed && sd.unsigned);
  const unsignedBlocks = new Set(unsignedSides.map((sd) => sd.seg.id));
  for (const b of out) unsignedBlocks.delete(b.c);
  const dailyAddresses = [...addr.values()].filter((e) => e.freq === 'Daily').length;
  const size = fs.statSync(OUT + 'segments.json').size;
  const report = {
    generated: new Date().toISOString(),
    inputs: {
      scheduleRows: counts.rows, scheduleYears: counts.years, scheduleUpdated: meta.rowsUpdatedAt ? new Date(meta.rowsUpdatedAt * 1000).toISOString().slice(0, 10) : null,
      addresses: addr.size, signedAddresses: signedAddr.length, signedRows: counts.signedRows, unsignedRows: counts.unsignedRows,
      dailyAddresses, dailyRows: counts.dailyRows, rowsWhoseDateIsNotTheirDescription: counts.badDescription.length,
      centerlineSegments: lines.length, planningDistricts: districts.length, streetCleaningTickets: tickets.length,
    },
    output: { blocks: out.length, sides: sideCount, rules: ruleCount, dateEntries, distinctDates: dateList.length, sizeBytes: size },
    placement: {
      signedAddressesPlaced: snap.range + snap.nearest, byAddressRange: snap.range, byNearestBlockOfTheStreet: snap.nearest,
      rangeMatchesFartherThan60m: snap.farRange, sideFromNumbers: snap.parityKnown, sideFromPositionOnly: snap.geoOnly,
      numbersAndPositionAgree: snap.agree, numbersAndPositionDisagree: snap.disagree, disagreeOnBlocksWithRangesOnTheWrongSide: snap.disagreeOnFlipped,
      disagreeElsewhereNumbersKept: snap.disagree - snap.disagreeOnFlipped,
      allAddressPoints: { withASideFromNumbers: allPoints.withSide, positionAgrees: allPoints.agree, share: +(allPoints.agree / allPoints.withSide).toFixed(4) },
      blocksWithRangesOnTheWrongSide: snap.flippedSegments.length, signedAddressesOnThem: snap.flippedAddresses, rangesOnTheWrongSide: snap.flippedSegments,
      otherDisagreements: [...snap.disagreeBy].sort((x, y) => y[1].n - x[1].n).map(([id, g]) => `${g.name} (segment ${id}): ${g.n} point${g.n > 1 ? 's' : ''}, ${Math.round(g.min)} to ${Math.round(g.max)} m off the line; the number's side kept`),
      signedSides: quality.signedSides, sidesWithTwoPatterns: quality.conflictSides, twoPatternExamples: quality.conflictEx,
      sidesWhoseSignedAddressesAllLieOver60m: quality.farSides.length, farSideExamples: quality.farSides,
      sidesMixingSignedAndUnsigned: quality.mixedSides, sidesWhereSignedAreTheMinority: quality.minoritySides, minorityExamples: quality.minorityEx,
    },
    skipped: [
      { why: 'not signed: advisory signs or none, no ticket (signed_area = No), swept monthly', count: addr.size - signedAddr.length - dailyAddresses,
        unit: 'address points', blocksWithOnlyUnsignedAddresses: unsignedBlocks.size, unsignedNotPlacedOnABlock: unsignedOnly.skipped,
        examples: ['most of the city: 87% of address points'] },
      { why: 'downtown daily sweeping: every weekday, but signed_area = No on all of it, and the tickets show no enforcement there (4 street cleaning tickets in 27 months on downtown-only streets)', count: dailyAddresses, unit: 'address points', examples: ['Granby St', 'Boush St', 'E Main St', 'Monticello Ave'] },
      ...snap.skipped.map((x) => ({ why: `signed address: ${x.why}`, count: x.count, unit: 'address points', examples: x.examples })),
      { why: 'City holiday dates taken off signed sides (no sweeping on City holidays; a missed signed sweep is not made up)', count: Object.values(dropped).reduce((a, b) => a + b, 0), unit: 'side dates',
        examples: Object.entries(dropped).sort().map(([d, n]) => `${d} ${HOLIDAYS[d]}: ${n} sides`) },
    ],
    season: { yearRound: true, ...season, dataCovers: Object.keys(counts.years).sort(), note: 'The City lists 2026 only (updated at the start of each year); 2027 dates are unknown until it publishes them.' },
    checks: {
      tickets: {
        what: 'Street cleaning tickets, Jan 2022 to Mar 2024 (the City\'s citation table, street name only, no house number or point): their time of day, and whether their street and day (nth weekday) are in the signed schedule. They cannot be placed on a block or side.',
        total: T.total, byYear: T.byYear, byHour: T.byHour, byWeekday: T.byWeekday, firstInWindow: hhmm(T.firstMinute), lastInWindow: hhmm(T.lastMinute), outsideWindow: T.outside.sort((a, b) => a - b).map(hhmm),
        inWindow, inWindowShare: +(inWindow / T.total).toFixed(4),
        onAStreetWithSignedSweeping: T.onSignedStreet, onSignedStreetShare: +(T.onSignedStreet / T.total).toFixed(4),
        sameDayAsTheSchedule: T.dayMatches, sameDayByYear: T.sameDayByYear, sameDayShare: +(T.dayMatches / Math.max(1, T.onSignedStreet)).toFixed(4), otherDay: T.dayDiffers,
        otherDayExamples: Object.entries(T.differsEx).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, n]) => `${k} (${n})`),
        onDowntownDailyStreetsWithoutSignedSweeping: T.onDailyOnlyStreet, onUnsignedOnlyStreets: T.onUnsignedStreet, streetNotInTheSchedule: T.unknownStreet,
      },
    },
    assumptions: [
      `Hours: the City publishes none (they are on each sign). 8 AM to 2 PM is read from the tickets: ${inWindow} of ${T.total} street cleaning tickets were written between 8:00 and 2:00 PM (the first at ${hhmm(T.firstMinute)}, the last at ${hhmm(T.lastMinute)}); the other ${T.outside.length} are scattered (${T.outside.sort((a, b) => a - b).map(hhmm).join(', ')}). A sign with a longer window would be under-warned.`,
      'signed_area = Yes means regulatory (enforced NO PARKING) signs, per the dataset\'s field description ("enforcement signs"); advisory-signed and unsigned curbs are signed_area = No.',
      'City holidays (City Code Sec. 2-48) stop all sweeping, signed areas included, and are not made up there: closure notices for Feb 16, May 25 and Sep 7 2026 say "no ... street sweeping operations", a 2020 City post says Christmas Eve is a City holiday and that areas with regulatory signs cannot be made up, and the sweeping page says a missed regulatory route resumes the next month.',
      'Both sides of a block get their own dates from their own addresses; a side with addresses on two patterns keeps both (a driver who moves on every listed day is never ticketed).',
      'A block side is shown when any signed address lands on it, even when most of its addresses are unsigned (counted under placement).',
      'Tow: the City says regulatory signs carry "fines and/or towing", so every rule is marked towable and city.json says tow "sometimes".',
    ],
    unverified: [
      'The 8 AM to 2 PM window (no official page states hours).',
      'That Parking writes no street cleaning tickets on City holidays that fall on a signed day (Veterans Day, Juneteenth, the day after Thanksgiving, Christmas Eve): sweeping is off, but the signs do not name holidays.',
      '2027 Christmas: the City Code rule puts Christmas Day on Friday Dec 24, so the library table moves Christmas Eve to Thursday Dec 23; the City has not posted its 2027 dates.',
      'Address points sit on parcels; where the centerline ranges are mixed or missing, the side comes from which side of the line the point lies on, and on the 10 blocks whose ranges sit on the wrong sides of the line the points decide.',
      'Signed sides with fewer signed than unsigned addresses (see placement) are shown: the City marks those addresses signed, but some may sit just outside a signed area.',
      'The ticket check is street level only: the citation table gives a street name, no number and no point, and covers Jan 2022 to Mar 2024 with gaps (it holds about 45,000 tickets in all).',
    ],
    questionsForCity: [
      'What hours do the regulatory street sweeping signs post? Are they the same everywhere (8 AM to 2 PM?)',
      'Is street sweeping parking enforced on City holidays that fall on a signed day (Veterans Day Nov 11, the day after Thanksgiving, Christmas Eve)?',
      'Can the Street Sweeping Schedule carry the posted hours and the side of the street, and list 2027 dates in December?',
      'Walke St, E Charlotte St (800 to 1100 blocks) and Fenchurch St (500 block), 169 signed addresses near Resilience Dr, have no block in the Street Centerline layer: are they new streets of the St. Paul\'s area, and when will the layer have them?',
      'Downtown is listed as swept daily with signed_area = No: is there any posted no-parking window downtown?',
      'Trice Ter, Gatling Ave, Core Ave and Blow St were ticketed on first Thursdays in 2022 to 2024, but the 2026 schedule says first Wednesdays: did these move?',
      'Could the parking citation table add the block number or a point, and data after March 2024?',
    ],
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');
  log(`${counts.rows} schedule rows, ${addr.size} addresses, ${signedAddr.length} signed; ${lines.length} centerlines, ${districts.length} districts, ${tickets.length} tickets`);
  log(`placed ${snap.range + snap.nearest} signed addresses (${snap.range} by range, ${snap.nearest} nearest); sides from numbers ${snap.parityKnown} (agree with position ${snap.agree}, disagree ${snap.disagree}), position only ${snap.geoOnly}; skipped ${snap.skipped.reduce((n, x) => n + x.count, 0)}`);
  log(`${out.length} blocks, ${sideCount} sides, ${ruleCount} rules, ${dateEntries} date entries, ${dateList.length} distinct dates (${season.from} to ${season.to}); holiday dates dropped: ${JSON.stringify(dropped)}`);
  log(`tickets: ${T.onSignedStreet}/${T.total} on signed streets, same day ${T.dayMatches} (${(T.dayMatches / Math.max(1, T.onSignedStreet) * 100).toFixed(1)}%), ${inWindow} in ${WINDOW[0]} to ${WINDOW[1]} (first ${hhmm(T.firstMinute)}, last ${hhmm(T.lastMinute)}), outside: ${T.outside.map(hhmm).join(' ')}`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/norfolk/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
