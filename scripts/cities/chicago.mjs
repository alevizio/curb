#!/usr/bin/env node
// Chicago for CURB (started 2026-10-18; format in docs/multi-city/city-build.md, research in docs/multi-city/chicago.md).
// Builds data/chicago/ from five City of Chicago Data Portal datasets:
//
//   1. Street Sweeping Zones - 2026 (2r7q-emq3, Streets and Sanitation): the 838 ward sections as polygons, each with
//      the days of each month, April to November, it is swept. A section is swept on two weekdays in a row: one side
//      of every street on the first day, the other side on the second. The data does not say which side goes first,
//      so both sides of a block get every date (a driver who moves on both days never gets a ticket).
//   2. Street Sweeping Schedule - 2026 (u5ai-3efk): the same dates as a table, checked against 1. Where they differ,
//      a side gets the dates of both (report.json lists each difference).
//   3. Street Center Lines (pr57-gg9e, the table behind 6imu-meau): the block lines, house numbers, cross streets and
//      street class. Residential streets (class 4) take the dates of the section each side sits in: a point 7 m to
//      each side of the line, at a quarter, half and three quarters of its length, is looked up in 1. Main streets
//      (arterials, class 2, and collectors, class 3) are left out: they are swept on their own schedule, under
//      permanent signs where they are posted.
//   4. Winter Overnight Parking Restrictions (mcad-r2g5): the 20 routes where parking is banned 3 to 7 AM, December 1
//      to April 1, whatever the weather, and cars are towed. Matched to the centerlines by name and distance.
//   5. Boundaries - Community Areas (igwz-8jzy): the 77 community areas, for each block's neighborhood, the city
//      limits, and the welcome card's list.
//
// Writes data/chicago/segments.json, city.json and report.json. Inputs are cached in private/cache/chicago/.
//
// Run: node scripts/cities/chicago.mjs [--refresh]   (Node 18+). Tests: npx vitest run scripts/cities/chicago.test.mjs

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/chicago/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/chicago/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[chicago]', ...a);

export const PORTAL = 'https://data.cityofchicago.org';
export const DATASETS = { zones: '2r7q-emq3', schedule: 'u5ai-3efk', centerlines: 'pr57-gg9e', winter: 'mcad-r2g5', areas: 'igwz-8jzy' };
export const YEAR = 2026;                       // the zones dataset is published once a year, under a new id
export const MONTHS = ['april', 'may', 'june', 'july', 'august', 'september', 'october', 'november'];   // months 4 to 11
export const SWEEP_FROM = 9, SWEEP_TO = 14;     // weekdays 9 AM to 2 PM (the City's Sweeper Tracker page)
export const SWEEP_FLAGS = 0;                   // a $60 ticket: the City's words for street sweeping never mention a tow
export const WINTER_FLAGS = 3;                  // 1 = runs on holidays, 2 = towed ("will be towed", the City's winter page)
export const WINTER_MONTHS = (1 << 11) | (1 << 0) | (1 << 1) | (1 << 2);   // December to March = 2055
export const RESIDENTIAL_CLASS = '4';
export const OPEN_STATUS = new Set(['N', 'UC']);   // N = open, UC = under construction in 2016 (open since); P private, V vacated, C closed
export const RAMP_TYPES = new Set(['ER', 'XR', 'SR']);   // entrance, exit and service ramps (a few are class 4)
export const OFFSET_M = 7;                      // side sample points: past the curb (residential streets are ~9 m curb to curb)

// City of Chicago holidays (offices closed): https://www.chicago.gov/city/en/narr/misc/city-holidays.html, read 2026-10-18.
// 2027 is not posted yet: the same holidays, on the same rules, with a Saturday holiday on the Friday before and a Sunday
// one on the Monday after (as the City kept Independence Day 2026 on Friday July 3).
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': "Dr. Martin Luther King Jr.'s Birthday", '2026-02-12': "Lincoln's Birthday",
  '2026-02-16': "Washington's Birthday", '2026-03-02': 'Pulaski Day', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth Day',
  '2026-07-03': 'Independence Day', '2026-09-07': 'Labor Day', '2026-10-12': 'Columbus Day', '2026-11-11': 'Veterans Day',
  '2026-11-26': 'Thanksgiving Day', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': "Dr. Martin Luther King Jr.'s Birthday", '2027-02-12': "Lincoln's Birthday",
  '2027-02-15': "Washington's Birthday", '2027-03-01': 'Pulaski Day', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth Day',
  '2027-07-05': 'Independence Day', '2027-09-06': 'Labor Day', '2027-10-11': 'Columbus Day', '2027-11-11': 'Veterans Day',
  '2027-11-25': 'Thanksgiving Day', '2027-12-24': 'Christmas Day',
};

// ---------- dates --------------------------------------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const utc = (iso) => new Date(iso + 'T12:00:00Z');
export const weekday = (iso) => utc(iso).getUTCDay();
const addDays = (iso, n) => { const t = utc(iso); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// One month's cell of the zones table ("1,2", "26,29", null) → day numbers. Anything else throws: a changed format must
// stop the build, never turn into wrong dates.
export function parseDays(v) {
  if (v === null || v === undefined) return [];
  const s = String(v).trim();
  if (!s) return [];
  return s.split(',').map((x) => {
    const t = x.trim();
    if (!/^\d{1,2}$/.test(t) || +t < 1 || +t > 31) throw new Error(`unreadable day list "${v}"`);
    return +t;
  });
}
// A zone's (or a schedule row set's) month cells → sorted, unique local dates. Throws on a day the month doesn't have.
export function sectionDates(cells, year = YEAR) {
  const out = new Set();
  MONTHS.forEach((name, i) => {
    for (const d of parseDays(cells[name])) {
      const iso = isoDate(year, i + 4, d);
      if (utc(iso).getUTCMonth() !== i + 3) throw new Error(`no ${name} ${d}`);
      out.add(iso);
    }
  });
  return [...out].sort();
}
const workday = (iso, holidays) => weekday(iso) % 6 !== 0 && !holidays[iso];
export const nextWorkday = (iso, holidays) => { let d = addDays(iso, 1); while (!workday(d, holidays)) d = addDays(d, 1); return d; };
// Dates that are not part of a two day pair (a working day and the next one): a section the City schedules on one
// lone day, or on more than two days in a row. Both sides get every date anyway; the report lists these.
export function unpaired(dates, holidays) {
  const set = new Set(dates), out = [];
  for (const d of dates) {
    const prev = dates.find((x) => x < d && nextWorkday(x, holidays) === d);
    const next = set.has(nextWorkday(d, holidays));
    if (!prev && !next) out.push(d);
  }
  return out;
}
// The April 1 mornings the winter ban still covers (it runs "through April 1"): the coming one and the one after.
export function aprilFirsts(today) {
  const y = +today.slice(0, 4), first = today <= `${y}-04-01` ? y : y + 1;
  return [isoDate(first, 4, 1), isoDate(first + 1, 4, 1)];
}

// ---------- rules --------------------------------------------------------------------------------------------------------

export const sweepRule = (dates) => [-1, SWEEP_FROM, SWEEP_TO, 0, 0, SWEEP_FLAGS, [...new Set(dates)].sort()];
// Every night 3 to 7 AM from December to March, plus the April 1 mornings as dates.
export const winterRules = (april) => [
  ...[0, 1, 2, 3, 4, 5, 6].map((dow) => [dow, 3, 7, 31, WINTER_MONTHS, WINTER_FLAGS]),
  [-1, 3, 7, 0, 0, WINTER_FLAGS, [...april].sort()],
];
// One date list rule per window and flags on a side (the union of their dates); weekly rules once each.
export function mergeRules(rules) {
  const out = [], byKey = new Map(), seen = new Set();
  for (const r of rules) {
    if (r[0] === -1) {
      const k = `${r[1]}|${r[2]}|${r[5]}`;
      if (byKey.has(k)) { const m = byKey.get(k); m[6] = [...new Set([...m[6], ...r[6]])].sort(); continue; }
      const m = [-1, r[1], r[2], 0, 0, r[5], [...new Set(r[6])].sort()];
      byKey.set(k, m); out.push(m);
    } else {
      const k = r.join('|');
      if (!seen.has(k)) { seen.add(k); out.push(r.slice()); }
    }
  }
  return out;
}

// ---------- geometry -----------------------------------------------------------------------------------------------------

const LAT0 = 41.84, LON0 = -87.68, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
export const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
export const lonlat = ([x, y]) => [x / KX + LON0, y / KY + LAT0];
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
// The side of the street a curb is on, looking from the line's first point to its last (scripts/cities/boston.mjs).
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
export function inRing(x, y, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// polygons: [[outer, ...holes], ...] in xy
export const inPolygons = (x, y, polys) => polys.some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)));
// Point lookup over (multi)polygon features: at(lon, lat) → the keys of the features holding the point.
export function polygonIndex(items, CELL = 500) {
  const grid = new Map(), list = [];
  for (const { key, geometry } of items) {
    const polys = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).map((p) => p.map((r) => r.map(xy)));
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const p of polys) for (const [x, y] of p[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    const it = { key, polys, bb: [w, s, e, n] };
    list.push(it);
    for (let cx = Math.floor(w / CELL); cx <= Math.floor(e / CELL); cx++) for (let cy = Math.floor(s / CELL); cy <= Math.floor(n / CELL); cy++) {
      const k = cx + ',' + cy;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(it);
    }
  }
  return {
    size: list.length,
    at(lon, lat) {
      const [x, y] = xy([lon, lat]);
      return (grid.get(Math.floor(x / CELL) + ',' + Math.floor(y / CELL)) || [])
        .filter(({ bb, polys }) => x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3] && inPolygons(x, y, polys)).map((it) => it.key);
    },
  };
}
// Points `off` meters to the left and right of the line at fractions `at` of its length.
export function sidePoints(c, off = OFFSET_M, at = [0.25, 0.5, 0.75]) {
  const p = c.map(xy), seg = [];
  let L = 0;
  for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); seg.push(d); L += d; }
  const out = { L: [], R: [] };
  for (const f of at) {
    let rest = f * L, i = 0;
    while (i < seg.length - 1 && rest > seg[i]) { rest -= seg[i]; i++; }
    const d = seg[i] || 1, t = Math.min(1, rest / d), ux = (p[i + 1][0] - p[i][0]) / d, uy = (p[i + 1][1] - p[i][1]) / d;
    const mx = p[i][0] + (p[i + 1][0] - p[i][0]) * t, my = p[i][1] + (p[i + 1][1] - p[i][1]) * t;
    out.L.push(lonlat([mx - uy * off, my + ux * off]));
    out.R.push(lonlat([mx + uy * off, my - ux * off]));
  }
  return out;
}
// The most common non-empty value; a tie goes to the middle sample, then to the first.
export function vote(values) {
  const n = new Map();
  for (const v of values) if (v) n.set(v, (n.get(v) || 0) + 1);
  if (!n.size) return null;
  const top = Math.max(...n.values()), best = [...n].filter(([, c]) => c === top).map(([v]) => v);
  if (best.length === 1) return best[0];
  const mid = values[Math.floor(values.length / 2)];
  return best.includes(mid) ? mid : best.find((v) => values.includes(v));
}
// Which section each side of a block belongs to. kind: inside (one section), boundary (each side its own), edge (one
// side outside every section but inside the city: it takes the other side's section; the street runs along the edge of
// the swept area, e.g. beside a rail embankment), cityLimit (the outer side is outside Chicago: left out), outside.
export function resolveSides(left, right, leftInCity, rightInCity) {
  const L = vote(left), R = vote(right);
  if (L && R) return { L, R, kind: L === R ? 'inside' : 'boundary' };
  if (!L && !R) return { L: null, R: null, kind: 'outside' };
  if (L) return rightInCity ? { L, R: L, kind: 'edge' } : { L, R: null, kind: 'cityLimit' };
  return leftInCity ? { L: R, R, kind: 'edge' } : { L: null, R, kind: 'cityLimit' };
}
// The sections whose dates each side gets: every section its sample points fall in (a section boundary that crosses the
// block gives that side the dates of both), or, for an edge side, the other side's.
export function sideSections(left, right, r) {
  const L = [...new Set(left.filter(Boolean))], R = [...new Set(right.filter(Boolean))];
  if (r.kind === 'edge') return { L: L.length ? L : R, R: R.length ? R : L };
  return { L: r.L ? L : [], R: r.R ? R : [] };
}
// What the build does with a centerline row: 'residential' (placed in its sections), 'mainStreet' (arterial or collector,
// left out), 'otherClass' (expressways, ramps, lower level streets, rivers, undocumented classes), 'status' (private,
// vacated, closed) or 'unnamed'.
export function classify(p) {
  const cls = p.class || '-';
  if (cls === '2' || cls === '3') return 'mainStreet';
  if (cls !== RESIDENTIAL_CLASS || RAMP_TYPES.has(p.street_typ)) return 'otherClass';
  if (!OPEN_STATUS.has(p.status)) return 'status';
  if (!streetName(p)) return 'unnamed';
  return 'residential';
}
// A residential block's sides → their street sweeping rules. left/right: the section at each side's sample points;
// datesOf(section) → its dates. Both sides of a section get all of its dates (both days of each pair).
export function placeBlock(left, right, leftInCity, rightInCity, datesOf) {
  const r = resolveSides(left, right, leftInCity, rightInCity), sets = sideSections(left, right, r), sides = {};
  let noDates = 0;
  for (const side of ['L', 'R']) {
    if (!sets[side].length) continue;
    const dates = [...new Set(sets[side].flatMap((k) => datesOf(k) || []))];
    if (dates.length) sides[side] = [sweepRule(dates)]; else noDates++;
  }
  return { ...r, sets, sides, noDates };
}
// A section's dates from the zones layer and from the schedule table: the union, plus what differs.
export function mergeSectionDates(zoneCells, tableCells, year = YEAR) {
  const z = sectionDates(zoneCells, year), t = tableCells ? sectionDates(tableCells, year) : null;
  const diff = t && t.join() !== z.join() ? { zones: z.filter((d) => !t.includes(d)), table: t.filter((d) => !z.includes(d)) } : null;
  return { dates: [...new Set([...z, ...(t || [])])].sort(), diff };
}
// Douglas-Peucker in meters. At tol 0.25 m it only drops points that sit on a straight line (less than a pixel at z19).
export function simplify(c, tol = 0.25) {
  if (c.length <= 2) return c.slice();
  const p = c.map(xy), keep = new Uint8Array(c.length);
  keep[0] = keep[c.length - 1] = 1;
  const stack = [[0, c.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x1, y1] = p[a], [x2, y2] = p[b], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const t = l2 ? Math.max(0, Math.min(1, ((p[i][0] - x1) * dx + (p[i][1] - y1) * dy) / l2)) : 0;
      const d = Math.hypot(p[i][0] - x1 - t * dx, p[i][1] - y1 - t * dy);
      if (d > fd) { fd = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return c.filter((_, i) => keep[i]);
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;
export const round6 = (c) => c.map(([lo, la]) => [r6(lo), r6(la)]);
export function lineLength(c) { let s = 0; for (let i = 1; i < c.length; i++) { const a = xy(c[i - 1]), b = xy(c[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; }

// ---------- names --------------------------------------------------------------------------------------------------------

// "DR MARTIN LUTHER KING JR" → "Dr Martin Luther King Jr", "82ND" → "82nd", "MCCLELLAN" → "McClellan", "O'BRIEN" → "O'Brien"
export function titleCase(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).map((w) => {
    if (/^\d+(ST|ND|RD|TH)$/i.test(w)) return w.toLowerCase();
    if (/^[NSEW]$/.test(w)) return w;
    return w.toLowerCase().replace(/(^|['’-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/^Mc([a-z])/, (m, b) => 'Mc' + b.toUpperCase());
  }).join(' ');
}
const SPECIAL_AREAS = { OHARE: "O'Hare" };
export const areaName = (s) => SPECIAL_AREAS[String(s).toUpperCase()] || titleCase(s);
// A centerline row → the street as it is signed: "W 82nd St", "S Dr Martin Luther King Jr Dr".
export const streetName = (p) => [p.pre_dir, titleCase(p.street_nam), titleCase(p.street_typ), p.suf_dir].filter((x) => x && String(x).trim()).join(' ');
// f_cross / t_cross: "8200|S|MAY|ST|" → "S May St"; "||DEAD END||" → "Dead End"; "1837|N|||" (no name) → ''
export function crossName(v) {
  const [, dir, name, type, suf] = String(v || '').split('|').map((x) => (x || '').trim());
  if (!name || RAMP_TYPES.has(type) || /^(EXPY|TOLL)$/.test(type)) return '';   // a ramp or an expressway is not a corner people name
  return [dir, titleCase(name), titleCase(type), suf].filter(Boolean).join(' ');
}
// The street without its direction, for matching the winter routes ("N KEDZIE AVE" and "S KEDZIE AVE" → "KEDZIE AVE").
const TYPES = { AV: 'AVE', AVENUE: 'AVE', STREET: 'ST', ROAD: 'RD', DRIVE: 'DR', BOULEVARD: 'BLVD', PARKWAY: 'PKWY', PLACE: 'PL' };
export function coreName(s) {
  const w = String(s || '').toUpperCase().replace(/[.,]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (w.length > 1 && /^[NSEW]$/.test(w[0])) w.shift();
  if (w.length > 1 && TYPES[w[w.length - 1]]) w[w.length - 1] = TYPES[w[w.length - 1]];
  return w.join(' ');
}

// ---------- the build ----------------------------------------------------------------------------------------------------

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-chicago-build (+https://curb.guide)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 2000 * i));
    }
  }
}
async function cached(name, fetcher) {
  const f = CACHE + name;
  if (!REFRESH && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fetcher();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}
// Socrata, paged on a stable order. kind 'geojson' returns features, 'json' rows.
async function soda(id, kind, select, order, page = 25000) {
  const out = [];
  for (let off = 0; ; off += page) {
    const q = new URLSearchParams({ $select: select, $order: order, $limit: String(page), $offset: String(off) });
    const d = await getJSON(`${PORTAL}/resource/${id}.${kind}?${q}`);
    const rows = kind === 'geojson' ? d.features : d;
    out.push(...rows);
    if (rows.length < page) return out;
  }
}
const need = (cond, msg) => { if (!cond) throw new Error(`[chicago] the City's data changed shape: ${msg}`); };

export async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // ---- 1. inputs ----
  const zones = await cached('zones.geojson', () => { log('fetching the sweeping zones…');
    return soda(DATASETS.zones, 'geojson', ['the_geom', 'ward', 'section', 'ward_section', ...MONTHS].join(','), 'ward_section'); });
  const schedule = await cached('schedule.json', () => { log('fetching the sweeping schedule…');
    return soda(DATASETS.schedule, 'json', 'ward_section_concatenated,month_number,dates', 'ward_section_concatenated,month_number'); });
  const lines = await cached('centerlines.geojson', () => { log('fetching the street centerlines…');
    return soda(DATASETS.centerlines, 'geojson', ['the_geom', 'trans_id', 'fnode_id', 'tnode_id', 'pre_dir', 'street_nam', 'street_typ', 'suf_dir',
      'l_f_add', 'l_t_add', 'r_f_add', 'r_t_add', 'class', 'status', 'l_parity', 'r_parity', 'f_cross', 't_cross'].join(','), 'trans_id'); });
  const winter = await cached('winter.geojson', () => { log('fetching the winter overnight parking routes…');
    return soda(DATASETS.winter, 'geojson', 'the_geom,objectid,on_street,from_stree,to_street,restrict_t,shape_len', 'objectid'); });
  const areas = await cached('community-areas.geojson', () => { log('fetching the community areas…');
    return soda(DATASETS.areas, 'geojson', 'the_geom,community,area_numbe', 'area_numbe'); });
  log(`${zones.length} zones, ${schedule.length} schedule rows, ${lines.length} centerlines, ${winter.length} winter routes, ${areas.length} community areas`);

  need(zones.length >= 700 && zones.length <= 1000, `${zones.length} sweeping zones (expected about 838)`);
  need(zones.every((f) => f.geometry && /Polygon$/.test(f.geometry.type) && f.properties.ward_section), 'a zone without geometry or ward_section');
  need(zones.some((f) => MONTHS.some((m) => f.properties[m])), 'no zone has dates in its month fields');
  need(schedule.length >= 3000 && schedule.length <= 6000, `${schedule.length} schedule rows`);
  need(schedule.every((r) => r.ward_section_concatenated && r.month_number), 'a schedule row without section or month');
  need(lines.length >= 50000 && lines.length <= 65000, `${lines.length} centerlines (expected about 56,000)`);
  need(lines.filter((f) => f.properties.trans_id && f.properties.class).length > 50000, 'centerlines without trans_id or class');
  need(winter.length >= 10 && winter.length <= 60, `${winter.length} winter routes (expected 20)`);
  need(winter.every((f) => f.properties.on_street && f.geometry), 'a winter route without a street or geometry');
  need(areas.length === 77, `${areas.length} community areas (expected 77)`);

  // ---- 2. dates per section, and the check against the schedule table ----
  const holidays = HOLIDAYS;
  const zoneDates = new Map(), tableCells = new Map(), diffs = [];
  for (const f of zones) zoneDates.set(f.properties.ward_section, sectionDates(f.properties));
  need(zoneDates.size === zones.length, 'two zones with the same ward_section');
  for (const r of schedule) {
    const k = r.ward_section_concatenated, m = +r.month_number;
    need(m >= 4 && m <= 11, `schedule month ${m}`);
    if (!tableCells.has(k)) tableCells.set(k, {});
    tableCells.get(k)[MONTHS[m - 4]] = r.dates;
  }
  const sectionsOut = new Map();   // ward_section → final dates (zones ∪ table where they differ)
  for (const f of zones) {
    const k = f.properties.ward_section, m = mergeSectionDates(f.properties, tableCells.get(k));
    if (m.diff) diffs.push({ section: k, ...m.diff });
    sectionsOut.set(k, m.dates);
  }
  const tableOnly = [...tableCells.keys()].filter((k) => !zoneDates.has(k));
  const allDates = [...new Set([...sectionsOut.values()].flat())].sort();
  need(allDates.length && allDates[0] >= `${YEAR}-04-01` && allDates[allDates.length - 1] <= `${YEAR}-11-30`, `dates outside April to November ${YEAR}`);
  const onHoliday = allDates.filter((d) => holidays[d]), onWeekend = allDates.filter((d) => weekday(d) % 6 === 0);
  if (onHoliday.length || onWeekend.length) throw new Error(`[chicago] sweeping dates on holidays ${onHoliday} or weekends ${onWeekend}: check the holiday list before publishing`);
  const noDates = [...sectionsOut].filter(([, d]) => !d.length).map(([k]) => k);
  const oddSections = [...sectionsOut].map(([k, d]) => ({ section: k, dates: unpaired(d, holidays) })).filter((x) => x.dates.length);
  // working days in season with no section swept: the holidays the City skipped
  const skippedDays = [];
  for (let d = allDates[0]; d <= allDates[allDates.length - 1]; d = addDays(d, 1)) if (weekday(d) % 6 && !allDates.includes(d)) skippedDays.push(d);

  // ---- 3. block sides → sections ----
  const zoneIndex = polygonIndex(zones.map((f) => ({ key: f.properties.ward_section, geometry: f.geometry })));
  const areaIndex = polygonIndex(areas.map((f) => ({ key: areaName(f.properties.community), geometry: f.geometry })));
  const inCity = (pt) => areaIndex.at(pt[0], pt[1]).length > 0;
  const nodeNames = new Map();   // node id → street names meeting there (cross street fallback)
  const nodeSegs = new Map();    // node id → segments ending there
  const segs = [];
  let noGeom = 0, multiPart = 0;
  for (const f of lines) {
    const p = f.properties, parts = (f.geometry && f.geometry.coordinates || []).filter((x) => x && x.length >= 2);
    if (!parts.length || !p.trans_id || p.trans_id === '0') { noGeom++; continue; }
    if (parts.length > 1) multiPart++;
    const c = parts.reduce((a, b) => (lineLength(b) > lineLength(a) ? b : a));
    const s = { p, c, id: String(p.trans_id), name: streetName(p), core: coreName([p.street_nam, p.street_typ].filter(Boolean).join(' ')) };
    segs.push(s);
    for (const n of [p.fnode_id, p.tnode_id]) {
      if (!n || n === '0') continue;
      if (!nodeNames.has(n)) { nodeNames.set(n, new Map()); nodeSegs.set(n, []); }
      if (s.name && !RAMP_TYPES.has(p.street_typ) && !['1', '9', 'RIV', '99'].includes(p.class)) nodeNames.get(n).set(s.core, s.name);
      nodeSegs.get(n).push(s);
    }
  }
  need(new Set(segs.map((s) => s.id)).size === segs.length, 'duplicate trans_id');
  const crossAt = (node, own) => [...(nodeNames.get(node) || new Map())].filter(([k]) => k !== own).map(([, v]) => v).sort()[0] || '';
  // The first other street met walking along this street from `node` (a block split where only the street itself
  // continues, at a bend or the city limits, takes the cross street of the next corner).
  const crossFrom = (node, s) => {
    const seen = new Set([s.id]);
    for (let cur = node, i = 0; cur && i < 12; i++) {
      const other = crossAt(cur, s.core);
      if (other) return other;
      const next = (nodeSegs.get(cur) || []).find((t) => !seen.has(t.id) && t.core === s.core);
      if (!next) return '';
      seen.add(next.id);
      cur = next.p.fnode_id === cur ? next.p.tnode_id : next.p.fnode_id;
    }
    return '';
  };

  const stats = { byClass: {}, kinds: { inside: 0, boundary: 0, edge: 0, cityLimit: 0, outside: 0 }, splitAlong: 0, sideNoDates: 0 };
  const skipped = { mainStreet: [], otherClass: [], status: [], unnamed: [], outside: [], noDates: [] };
  const blocks = new Map();      // trans_id → { s, sides: { L: rules[], R: rules[] } }
  const addRules = (s, side, rules) => {
    if (!blocks.has(s.id)) blocks.set(s.id, { s, sides: {} });
    const b = blocks.get(s.id);
    b.sides[side] = mergeRules([...(b.sides[side] || []), ...rules]);
  };
  const ex = (s, extra = {}) => ({ c: s.id, s: s.name, l: [crossName(s.p.f_cross), crossName(s.p.t_cross)].filter(Boolean).join(' - '), ...extra });
  const boundaryExamples = [], edgeExamples = [];
  for (const s of segs) {
    const cls = s.p.class || '-';
    stats.byClass[cls] = (stats.byClass[cls] || 0) + 1;
    const what = classify(s.p);
    if (what !== 'residential') { skipped[what].push(s); continue; }
    const pts = sidePoints(s.c);
    const at = (pt) => zoneIndex.at(pt[0], pt[1])[0] || null;
    const left = pts.L.map(at), right = pts.R.map(at);
    if (new Set(left.filter(Boolean)).size > 1 || new Set(right.filter(Boolean)).size > 1) stats.splitAlong++;
    const r = placeBlock(left, right, inCity(pts.L[1]), inCity(pts.R[1]), (k) => sectionsOut.get(k));
    stats.kinds[r.kind]++;
    stats.sideNoDates += r.noDates;
    if (r.kind === 'outside') { skipped.outside.push(s); continue; }
    if (r.kind === 'boundary' && boundaryExamples.length < 8) boundaryExamples.push(ex(s, { L: r.L, R: r.R }));
    if (r.kind === 'edge' && edgeExamples.length < 8) edgeExamples.push(ex(s, { section: r.L }));
    if (!r.sides.L && !r.sides.R) { skipped.noDates.push(s); continue; }
    for (const side of ['L', 'R']) if (r.sides[side]) addRules(s, side, r.sides[side]);
  }

  // ---- 4. the winter overnight parking ban ----
  const april = aprilFirsts(today), wRules = winterRules(april);
  const CELL = 50, TOL = 15, wgrid = new Map(), cellOf = (v) => Math.floor(v / CELL);
  const routes = winter.map((f, i) => ({ i, p: f.properties, core: coreName(f.properties.on_street), parts: (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates) }));
  for (const rt of routes) for (const part of rt.parts) {
    const q = part.map(xy);
    for (let j = 1; j < q.length; j++) {
      const [x1, y1] = q[j - 1], [x2, y2] = q[j];
      for (let cx = cellOf(Math.min(x1, x2) - TOL); cx <= cellOf(Math.max(x1, x2) + TOL); cx++)
        for (let cy = cellOf(Math.min(y1, y2) - TOL); cy <= cellOf(Math.max(y1, y2) + TOL); cy++) {
          const k = cx + ',' + cy;
          if (!wgrid.has(k)) wgrid.set(k, []);
          wgrid.get(k).push([x1, y1, x2, y2, rt]);
        }
    }
  }
  // the closest route within `tol` of the point (with this street's name, when `core` is given), or null
  const nearRoute = (pt, core, tol = TOL) => {
    const [x, y] = xy(pt);
    let best = null, bd = tol;
    for (const [x1, y1, x2, y2, rt] of wgrid.get(cellOf(x) + ',' + cellOf(y)) || []) {
      if (core && rt.core !== core) continue;
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)) : 0;
      const d = Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
      if (d <= bd) { bd = d; best = rt; }
    }
    return best;
  };
  const routeHits = new Map(routes.map((r) => [r.i, { segs: 0, meters: 0, byGeometryM: 0 }]));
  const byGeometry = [];       // segments on a route whose name differs from the route's label
  let winterSegs = 0;
  for (const s of segs) {
    if (['1', '9', 'RIV', '99'].includes(s.p.class) || !s.name) continue;
    // samples along the line (ends, quarters, middle): 4 of 5 within 15 m of a route with the same name, or all 5
    // within 3 m of any route (the City's route lines are drawn on these centerlines; one is labeled with the wrong street)
    const samples = [0, 0.25, 0.5, 0.75, 1].map((f) => sidePoints(s.c, 0, [Math.min(0.999, Math.max(0.001, f))]).L[0]);
    let hits = samples.map((pt) => nearRoute(pt, s.core)), geo = false;
    if (hits.filter(Boolean).length < 4) {
      hits = samples.map((pt) => nearRoute(pt, null, 3));
      if (hits.filter(Boolean).length < 5) continue;
      byGeometry.push(s);
      geo = true;
    }
    const rt = routes[+vote(hits.map((h) => (h ? String(h.i) : null)))];
    const h = routeHits.get(rt.i), len = lineLength(s.c);
    h.segs++; h.meters += len; if (geo) h.byGeometryM += len;
    winterSegs++;
    for (const side of ['L', 'R']) addRules(s, side, wRules);
  }
  const relabeled = [...new Set(byGeometry.map((s) => s.name))].map((name) => ({ street: name,
    route: [...new Set(byGeometry.filter((s) => s.name === name).map((s) => { const xy0 = sidePoints(s.c, 0, [0.5]).L[0]; return nearRoute(xy0, null, 3)?.p.on_street; }))].join(', '),
    segments: byGeometry.filter((s) => s.name === name).length }));
  const winterReport = routes.map((rt) => ({ street: rt.p.on_street, from: rt.p.from_stree, to: rt.p.to_street,
    routeM: Math.round((+rt.p.shape_len || 0) * 0.3048), matchedM: Math.round(routeHits.get(rt.i).meters),
    byGeometryOnlyM: Math.round(routeHits.get(rt.i).byGeometryM), segments: routeHits.get(rt.i).segs }));
  for (const w of winterReport) need(w.matchedM >= 0.8 * w.routeM, `winter route ${w.street} (${w.from} to ${w.to}) matched ${w.matchedM} m of ${w.routeM} m`);

  // ---- 5. blocks ----
  const out = [];
  for (const [id, b] of blocks) {
    const s = b.s, g = round6(simplify(s.c));
    const mid = sidePoints(s.c, 0, [0.5]).L[0];
    const hood = areaIndex.at(mid[0], mid[1])[0];
    const nums = ['l_f_add', 'l_t_add', 'r_f_add', 'r_t_add'].map((k) => parseInt(s.p[k], 10)).filter((v) => v > 0);
    const odd = s.p.l_parity === 'O' && s.p.r_parity === 'E' ? 'L' : s.p.r_parity === 'O' && s.p.l_parity === 'E' ? 'R' : null;
    const from = crossName(s.p.f_cross) || crossFrom(s.p.fnode_id, s), to = crossName(s.p.t_cross) || crossFrom(s.p.tnode_id, s);
    out.push({ c: id, s: s.name, l: from && to ? `${from} - ${to}` : from || to,
      ...(hood ? { h: hood } : {}), ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}), ...(odd ? { o: odd } : {}),
      g, d: ['L', 'R'].filter((side) => b.sides[side]).map((side) => [side, compass(g, side), b.sides[side]]) });
  }
  out.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));

  // ---- 6. checks on the output ----
  const sides = out.reduce((n, b) => n + b.d.length, 0);
  const rules = out.reduce((n, b) => n + b.d.reduce((m, d) => m + d[2].length, 0), 0);
  const dateEntries = out.reduce((n, b) => n + b.d.reduce((m, d) => m + d[2].reduce((k, r) => k + (r[0] === -1 ? r[6].length : 0), 0), 0), 0);
  const listed = new Set(out.flatMap((b) => b.d.flatMap((d) => d[2].filter((r) => r[0] === -1 && r[1] === SWEEP_FROM).flatMap((r) => r[6]))));
  need(![...listed].some((d) => holidays[d]), 'a listed sweeping date is a City holiday');
  const sweptBlocks = out.filter((b) => b.d.some((d) => d[2].some((r) => r[1] === SWEEP_FROM))).length;
  const winterBlocks = out.filter((b) => b.d.some((d) => d[2].some((r) => r[1] === 3))).length;
  const vertsIn = [...blocks.values()].reduce((n, b) => n + b.s.c.length, 0), vertsOut = out.reduce((n, b) => n + b.g.length, 0);

  // center: the point (on a 500 m grid) with the most swept blocks within 2 km
  const bins = new Map();
  for (const b of out) {
    if (!b.d.some((d) => d[2].some((r) => r[1] === SWEEP_FROM))) continue;
    const [x, y] = xy(b.g[Math.floor(b.g.length / 2)]), k = Math.round(x / 500) + ',' + Math.round(y / 500);
    bins.set(k, (bins.get(k) || 0) + 1);
  }
  let center = null, most = -1;
  for (const k of bins.keys()) {
    const [i, j] = k.split(',').map(Number);
    let n = 0;
    for (let di = -4; di <= 4; di++) for (let dj = -4; dj <= 4; dj++) if (di * di + dj * dj <= 16) n += bins.get((i + di) + ',' + (j + dj)) || 0;
    if (n > most || (n === most && k < center.k)) { most = n; center = { k, at: lonlat([i * 500, j * 500]) }; }
  }
  center = center.at;
  let w = 180, so = 90, e = -180, n = -90;
  for (const b of out) for (const [lo, la] of b.g) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < so) so = la; if (la > n) n = la; }
  const fl3 = (v) => Math.floor(v * 1000) / 1000, ce3 = (v) => Math.ceil(v * 1000) / 1000;

  // ---- 7. write ----
  const sources = [
    { name: 'Street Sweeping Zones - 2026 (Streets and Sanitation)', url: `${PORTAL}/d/${DATASETS.zones}`, license: 'City of Chicago Data Portal terms of use', fetched: today },
    { name: 'Street Sweeping Schedule - 2026 (Streets and Sanitation)', url: `${PORTAL}/d/${DATASETS.schedule}`, license: 'City of Chicago Data Portal terms of use', fetched: today },
    { name: 'Street Center Lines', url: `${PORTAL}/d/6imu-meau`, license: 'City of Chicago Data Portal terms of use', fetched: today },
    { name: 'Winter Overnight Parking Restrictions (Streets and Sanitation)', url: `${PORTAL}/d/${DATASETS.winter}`, license: 'City of Chicago Data Portal terms of use', fetched: today },
    { name: 'Boundaries - Community Areas', url: `${PORTAL}/d/${DATASETS.areas}`, license: 'City of Chicago Data Portal terms of use', fetched: today },
  ];
  const season = { from: allDates[0], to: allDates[allDates.length - 1] };
  fs.mkdirSync(OUT, { recursive: true });
  const segJSON = JSON.stringify({
    _meta: { city: 'chicago', time_zone: 'America/Chicago', generated: new Date().toISOString(), sources, blocks: out.length, sides, season,
      format: 'b[] = {c: Street Center Lines trans_id, s: street, l: cross streets, h: community area, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
        + 'rule = [-1, fromH, toH, 0, 0, flags, [local dates YYYY-MM-DD]] (street sweeping: the dates of the side\'s ward section, both days of each pair on both sides; the April 1 end of the winter ban) '
        + 'or [jsDow, fromH, toH, weeksMask (bit i = week i+1), monthsMask (bit m-1; 0 = all year), flags] (the winter overnight parking ban); flags: 1 = not suspended on holidays, 2 = towable' },
    b: out });
  fs.writeFileSync(OUT + 'segments.json', segJSON);

  const neighborhoods = areas.map((f) => {
    let aw = 180, as = 90, ae = -180, an = -90;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) for (const [lo, la] of p[0]) { if (lo < aw) aw = lo; if (lo > ae) ae = lo; if (la < as) as = la; if (la > an) an = la; }
    return { name: areaName(f.properties.community), bbox: [aw, as, ae, an].map((v) => v.toFixed(4)).join(',') };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const city = {
    id: 'chicago', name: 'Chicago', region: 'Illinois', tz: 'America/Chicago',
    center: [+center[1].toFixed(4), +center[0].toFixed(4)], zoom: 15,   // street zoom: the citywide view of 37k blocks waits until someone zooms out
    bounds: [[fl3(so), fl3(w)], [ce3(n), ce3(e)]],
    holidays, holidaysSource: 'https://www.chicago.gov/city/en/narr/misc/city-holidays.html', holidayRule: 'all',
    fine: '$60', tow: 'sometimes', fineSource: 'https://www.chicago.gov/city/en/depts/fin/provdrs/parking_and_redlightcitationadministration/supp_info/ParkingStandingandComplianceViolations.html',
    agency: 'Chicago Department of Streets and Sanitation',
    scheduleUrl: 'https://www.chicago.gov/city/en/depts/streets/provdrs/streets_san/svcs/street_sweeping2026.html',
    sources,
    words: {
      rule: 'Residential streets are swept ward section by ward section on two weekdays a month, April to November, between 9 AM and 2 PM; bright orange signs go up two days before.',
      afterpass: 'One side is swept on each of the two days; the orange signs say which. Both days show on both sides. Season April 1 to November 20, $60 ticket. On the winter overnight ban streets, no parking 3 to 7 AM, December 1 to April 1: cars are towed.',
      dataNotes: 'Dates from the City\'s 2026 street sweeping zones (Streets and Sanitation), placed on the City\'s street centerlines: each side of a block takes the dates of the ward section it sits in. The data doesn\'t say which side is swept first, so both sides list both days. Main streets (arterials and collectors) are left out: they run on their own posted schedules. Winter ban streets come from the City\'s list of 20 routes.',
    },
    neighborhoods,
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1) + '\n');

  const exList = (list, k = 5) => list.slice(0, k).map((s) => ex(s));
  const report = {
    generated: new Date().toISOString(),
    inputs: { zones: zones.length, scheduleRows: schedule.length, centerlines: lines.length, centerlinesWithGeometry: segs.length, centerlinesMultiPart: multiPart,
      winterRoutes: winter.length, communityAreas: areas.length, centerlinesByClass: stats.byClass },
    output: { blocks: out.length, sides, rules, dateEntries, sizeBytes: Buffer.byteLength(segJSON), sweptBlocks, winterBlocks,
      verticesIn: vertsIn, verticesOut: vertsOut },
    placement: { residentialSegments: Object.values(stats.kinds).reduce((a, b) => a + b, 0), ...stats.kinds, splitAlongBlock: stats.splitAlong,
      sidesInSectionWithoutDates: stats.sideNoDates, boundaryExamples, edgeExamples,
      method: `Residential centerlines (class ${RESIDENTIAL_CLASS}, status open or under construction in 2016) only. Each side is looked up at three points ${OFFSET_M} m off the line, at a quarter, half and three quarters of its length; the side takes the dates of every section they fall in (one, except where a section boundary crosses the block: splitAlongBlock, which get both). Moving the points to 5 or 10 m changes about 105 assignments (0.3%). inside = both sides in one section; boundary = the street is a section boundary and each side takes its own section's dates; edge = one side falls in no section but inside the city (rail embankments, channels, expressways, parks along the street) and takes the other side's section; cityLimit = the outer side is outside Chicago and is left out; outside = no section on either side (downtown, parks, the airports).` },
    skipped: [
      { why: 'main street: centerline class 2 (arterial) or 3 (collector); these run on their own posted schedules (permanent signs), not the ward section dates', count: skipped.mainStreet.length,
        arterial: skipped.mainStreet.filter((s) => s.p.class === '2').length, collector: skipped.mainStreet.filter((s) => s.p.class === '3').length, examples: exList(skipped.mainStreet.filter((s) => s.p.class === '3')) },
      { why: 'not a residential street: expressways (1), small downtown courts (5), lower level streets (7), ramps (9, and class 4 rows typed ER, XR or SR), unclassed (99), class E (undocumented: dead ends, connectors, campus and park drives), rivers, S', count: skipped.otherClass.length,
        byClass: Object.fromEntries(Object.entries(stats.byClass).filter(([k]) => !['2', '3', RESIDENTIAL_CLASS].includes(k))), examples: exList(skipped.otherClass.filter((s) => s.p.class === 'E')) },
      { why: 'residential class but private (P), vacated (V), closed (C) or no status', count: skipped.status.length, examples: exList(skipped.status) },
      { why: 'residential class but no street name in the City\'s data (unnamed connectors, service roads and dead end stubs): a block needs a street to show', count: skipped.unnamed.length,
        examples: skipped.unnamed.slice(0, 6).map((s) => ({ c: s.id, l: [crossName(s.p.f_cross), crossName(s.p.t_cross)].filter(Boolean).join(' - ') })) },
      { why: 'outside every sweeping section (the Loop and downtown, lakefront and park drives, the airports, industrial areas)', count: skipped.outside.length, examples: exList(skipped.outside, 8) },
      { why: `in a section with no sweeping dates (${noDates.join(', ') || 'none'})`, count: skipped.noDates.length, examples: exList(skipped.noDates) },
      { why: 'no geometry or no trans_id', count: noGeom, examples: [] },
    ],
    season: { sweeping: season, sweepingWindow: '9 AM to 2 PM, weekdays', winterBan: 'every night 3 to 7 AM, December 1 to April 1 (April 1 mornings listed as dates: ' + april.join(', ') + ')',
      nextYear: `The zones dataset is republished every spring under a new id (2025: utb4-q645, 2026: ${DATASETS.zones}); 2027 dates appear when the City publishes it.` },
    checks: {
      zonesVsTable: { sectionsInZones: zoneDates.size, sectionsInTable: tableCells.size, tableOnly, differ: diffs,
        note: 'Where the two disagree a side gets the dates of both. The ward PDF agrees with the table on 3905 (September 16 and 17).' },
      sectionsWithoutDates: noDates,
      blocksWithoutCrossStreets: out.filter((b) => !b.l).map((b) => ({ c: b.c, s: b.s })),
      datesNotInATwoDayPair: { sections: oddSections.length, examples: oddSections.slice(0, 10),
        note: 'Sections the City schedules weekly (Tuesday and Wednesday every week: 0204, 0205, 4205, 4308), on four days in a row, or with a lone day. Both sides get every date.' },
      workdaysWithNoSweeping: skippedDays, holidaysInSeason: Object.keys(holidays).filter((d) => d >= season.from && d <= season.to),
      noListedDateIsAHoliday: true, noListedDateOnAWeekend: true,
      winterRoutes: winterReport, winterMatchedByGeometryOnly: relabeled,
      citations: 'Chicago publishes no current parking citations (only the 1996 to 2018 records released under FOIA, via ProPublica), so there is no ticket cross-check.',
    },
    assumptions: [
      'Both sides of a block get both days of each pair: the City says one side is swept on the first date and the other side on the second, without saying which.',
      'Sweeping hours 9 AM to 2 PM, weekdays: the City\'s Sweeper Tracker page; the orange signs carry the hours.',
      'Main streets (centerline class 2 arterial and 3 collector) are left out: the City says some streets have permanently posted signs (once a week or two days a month), and its own winter ban list calls class 3 streets (Milwaukee, Clark, Foster, Division) arterials.',
      'Section boundaries follow street centerlines, so on a boundary street each side takes the dates of the section it faces.',
      'A residential side outside every section but inside the city takes the other side\'s section (streets along rail lines, channels and parks).',
      'Street sweeping is a ticket, not a tow (rule flags 0): the City\'s own words for street sweeping never mention towing. Its fine schedule lists "9-64-040(b) Street Cleaning $60.00", and its 2026 release says only "Residents are reminded to check for the bright orange signs announcing temporary parking restrictions. These signs are posted two days prior to scheduled street sweeping events." News reports say a tow is possible; the City does not.',
      'city.json tow is "sometimes": sweeping is ticket only, but the winter ban streets on the same map tow. The winter ban tows (flags 2) and runs on holidays (flags 1): "Violators of the parking ban will be towed" and it is "enforced ... from 3 am to 7 am starting December 1st through April 1st, regardless of snow" (the City\'s winter page; the 2025 release: "in effect through April 1, 2026"; the posted sign: "NO PARKING 3AM-7AM DEC 1-APR 1"), so the April 1 morning is in.',
      '2027 holidays follow the City\'s 2026 list and its observed date rule (not posted yet).',
      'Centerlines are the City\'s 2016 street network (last updated 2021-06-11); newer streets are missing.',
    ],
    unverified: [
      'Which side is swept on the first day of each pair (the orange signs say).',
      'The posted window: 9 AM to 2 PM is when the City says its sweepers run ("On weekdays, from 9am to 2pm", the Sweeper Tracker page); the hours printed on the orange signs are not on any City page.',
      'Whether collector streets (class 3) inside a section are swept on the section dates or on their own schedule.',
      'Whether boundary streets are swept side by side with each section, or wholly with one of them.',
      'Whether street sweeping cars are ever towed.',
      `The winter ban list (mcad-r2g5, 2021) matches the map the City's winter page links (2017), but the City says 107 miles and the 20 routes measure ${Math.round(winterReport.reduce((a, r) => a + r.routeM, 0) / 1609.34)} miles.`,
    ],
    questionsForCity: [
      'Is there a list of the block sides swept on the first and on the second day of each pair, or a rule (for example north and east sides first)?',
      'Are collector streets (such as Grand Ave, Addison St, Damen Ave) swept on their ward section\'s dates, or are they on the arterial program with permanent signs?',
      'On a street that is the boundary of two sections, which section sweeps each side?',
      'Can the streets with permanent street cleaning signs (once a week or two days a month) be published, with their days and hours?',
      'Is the Winter Overnight Parking Restrictions dataset (2021) the current list of the 107 miles? It measures about 98 miles.',
      'What hours do the orange street sweeping signs post: 9 AM to 2 PM everywhere?',
      'Are cars towed for street sweeping, or only ticketed?',
      `What does street class E mean in Street Center Lines? Its ${stats.byClass.E || 0} segments (dead ends, connectors, campus and park drives, a few ordinary looking blocks) are left out.`,
      'Section 3905 reads "16,15" for September in the 2026 zones; the table and the ward PDF say 16 and 17. Can the zones be corrected?',
    ],
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');

  log(`sections: ${zoneDates.size} (${noDates.length} without dates), ${allDates.length} sweeping days ${season.from} to ${season.to}; zones vs table: ${diffs.length} differ, ${tableOnly.length} only in the table`);
  log(`residential segments: ${report.placement.residentialSegments} (inside ${stats.kinds.inside}, boundary ${stats.kinds.boundary}, edge ${stats.kinds.edge}, city limit ${stats.kinds.cityLimit}, outside ${stats.kinds.outside}); main streets left out ${skipped.mainStreet.length}`);
  log(`winter ban: ${winterSegs} segments on ${winter.length} routes`);
  log(`wrote data/chicago/segments.json: ${out.length} blocks, ${sides} sides, ${rules} rules, ${dateEntries} dates, ${(Buffer.byteLength(segJSON) / 1e6).toFixed(1)} MB (vertices ${vertsIn} → ${vertsOut})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
