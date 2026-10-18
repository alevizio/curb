#!/usr/bin/env node
// Philadelphia for CURB (built 2026-10-18, by docs/multi-city/city-build.md). Writes data/philadelphia/ from two City
// of Philadelphia sources:
//
//   1. SweepPHL "Route Locations" (Streets Department, the map behind SweepPHL on StreetSmartPHL): every block of the
//      Mechanical Street Cleaning routes, with its day, its two hour window and the day of each side (EVEN_SIDE_DAY,
//      ODD_SIDE_DAY). The segments are the City's street centerline segments (SEG_ID), with address ranges, so a side's
//      day goes on the side of the line that holds those house numbers.
//   2. Street Centerline (OpenDataPhilly): only its node ids and street names, to name each block's cross streets.
//
// The program: April 6 to October 29, 2026, Monday to Thursday, one posted two hour no parking window (9 to 11 AM,
// 11 AM to 1 PM or 1 to 3 PM), $31 ticket (PPA, Code 12-903(6)), no cleaning on City-observed holidays. The City posts
// no parking signs only on blocks wide enough to move cars, and the data does not say which: every route block is
// written, and the page says the sign wins (docs/multi-city/philadelphia.md).
//
// Run: node scripts/cities/philadelphia.mjs [--refresh]   (Node 18+; inputs cached in private/cache/philadelphia/)
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/philadelphia/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/philadelphia/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[philadelphia]', ...a);

export const ROUTES = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Broom_Routes_SweepPHL/FeatureServer/0';
export const CENTERLINE = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Street_Centerline/FeatureServer/0';
export const HOLIDAY_API = 'https://api.phila.gov/phila/trashday/v1';   // the City's list of City-observed holidays (current year)
export const SCHEDULE_URL = 'https://www.phila.gov/programs/mechanical-street-cleaning/cleaning-schedule/';
export const FINE_URL = 'https://philapark.org/enforcement/';
export const ROUTE_FIELDS = ['SEG_ID', 'STNAME', 'L_F_ADD', 'L_T_ADD', 'R_F_ADD', 'R_T_ADD', 'CLASS', 'FNODE_', 'TNODE_', 'Name', 'Day',
  'Time', 'EVEN_SIDE_DAY', 'ODD_SIDE_DAY'];

// ---------- the rule ------------------------------------------------------------------------------

// April to October (bit m-1). The 2026 season is April 6 to October 29: the mask also takes in April 1 and 2 (a Wednesday
// and a Thursday), the one known overreach, said in the report. Every week; not towable; a City holiday stops it.
export const MONTHS = 0b001111111000;   // 1016
export const WEEKS = 31, FLAGS = 0;
export const DOW = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

// City-observed holidays (the Department of Sanitation's list: phila.gov palm card and api.phila.gov/phila/trashday/v1,
// read 2026-10-18). 2026 is the City's own list, with weekend holidays on their own dates as the City lists them. 2027 is
// not published yet: the same 13 holidays by the same rule (to replace with the City's list once posted). Only Monday
// to Thursday dates in April to October stop a sweep: Memorial Day, Labor Day and Indigenous Peoples' Day.
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King, Jr. Day', '2026-02-16': "Presidents' Day",
  '2026-04-03': 'Good Friday', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-04': 'Independence Day',
  '2026-09-07': 'Labor Day', '2026-10-12': "Columbus Day/Indigenous Peoples' Day", '2026-11-11': 'Veterans Day',
  '2026-11-26': 'Thanksgiving', '2026-11-27': 'Thanksgiving Friday', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King, Jr. Day', '2027-02-15': "Presidents' Day",
  '2027-03-26': 'Good Friday', '2027-05-31': 'Memorial Day', '2027-06-19': 'Juneteenth', '2027-07-04': 'Independence Day',
  '2027-09-06': 'Labor Day', '2027-10-11': "Columbus Day/Indigenous Peoples' Day", '2027-11-11': 'Veterans Day',
  '2027-11-25': 'Thanksgiving', '2027-11-26': 'Thanksgiving Friday', '2027-12-25': 'Christmas Day',
};

// The 14 program areas, as the City's schedule page names them (the layer writes two of them short).
export const AREA_NAMES = { 'West Philly': 'West Philadelphia', 'South Philly': 'South Philadelphia' };
// Street classes that carry no parking (the City's centerline CLASS: 1 expressway, 6 driveway, 12 not travelable).
export const NO_PARKING_CLASS = { 1: 'expressway or its ramp', 12: 'street closed to traffic (City street class 12, not travelable)' };

// ---------- parsing --------------------------------------------------------------------------------

const ABBR = new Set(['ST', 'AVE', 'RD', 'PL', 'LN', 'DR', 'BLVD', 'TER', 'CT', 'PKWY', 'SQ', 'CIR', 'WAY', 'WALK', 'ROW', 'ALY', 'PIKE', 'PLZ', 'MALL', 'DWY']);
/** "W YORK ST" → "W York St", "N 26TH ST" → "N 26th St", "MC KEAN ST" → "McKean St", the layer's padding removed. */
export function titleCase(s) {
  const w = String(s || '').toUpperCase().replace(/\s+/g, ' ').trim().replace(/\bMC (\w)/g, 'MC$1').split(' ').filter(Boolean);
  return w.map((t, i) => {
    if (t.length === 1) return t;                                   // N, S, E, W and the lettered streets (A St, O St)
    if (/^\d+(ST|ND|RD|TH)$/.test(t)) return t.toLowerCase();       // 26th
    if (/^MC\w/.test(t)) return 'Mc' + t[2] + t.slice(3).toLowerCase();
    if (ABBR.has(t) && i > 0) return t[0] + t.slice(1).toLowerCase();
    return t[0] + t.slice(1).toLowerCase();
  }).join(' ');
}
/** "9AM - 11AM" → [9, 11], "1PM - 3PM" → [13, 15]; trailing junk in the layer ("1PM - 3PMl") is ignored. */
export function parseWindow(s) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(String(s || ''));
  if (!m) return null;
  const h = (hh, mm, ap) => { let v = (+hh % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0); return mm && +mm ? `${v}:${mm}` : v; };
  return [h(m[1], m[2], m[3]), h(m[4], m[5], m[6])];
}
const dayOf = (s) => (s && Object.prototype.hasOwnProperty.call(DOW, String(s).trim().toUpperCase().slice(0, 3)) ? DOW[String(s).trim().toUpperCase().slice(0, 3)] : null);
/**
 * Each side's weekday. EVEN_SIDE_DAY and ODD_SIDE_DAY when both are there. The `Day` field ("MON", or "TUE - WED")
 * fills a blank side: with one day it is both sides' day, with two it is the one the other side doesn't have. Its order
 * is not even then odd (147 of the 281 two day rows put the odd side's day first), so it never says which side is which.
 */
export function sideDays(p) {
  let even = dayOf(p.EVEN_SIDE_DAY), odd = dayOf(p.ODD_SIDE_DAY), filled = null;
  if (even === null || odd === null) {
    const pair = String(p.Day || '').split('-').map(dayOf).filter((d) => d !== null);
    if (even === null && odd === null && pair.length === 1) { even = odd = pair[0]; filled = 'both sides from Day'; }
    else if (pair.length === 2 && (even === null) !== (odd === null)) {
      const known = even ?? odd, other = pair.find((d) => d !== known);
      if (other !== undefined && pair.includes(known)) {
        if (even === null) even = other; else odd = other;
        filled = (even === other ? 'even' : 'odd') + ' side from Day';
      }
    }
  }
  return { even, odd, filled };
}
const parity = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n % 2 : null; };
/** The side of the line (looking from its first point to its last) that holds the odd house numbers. */
export function oddSide(p) {
  const l = parity(p.L_F_ADD) ?? parity(p.L_T_ADD), r = parity(p.R_F_ADD) ?? parity(p.R_T_ADD);
  if (l === 1 && r !== 1) return 'L';
  if (r === 1 && l !== 1) return 'R';
  if (l === 0 && r === null) return 'R';
  if (r === 0 && l === null) return 'L';
  return null;
}
export function houseRange(p) {
  const n = ['L_F_ADD', 'L_T_ADD', 'R_F_ADD', 'R_T_ADD'].map((k) => parseInt(p[k], 10)).filter((v) => v > 0);
  return n.length ? [Math.min(...n), Math.max(...n)] : null;
}
/** Why a route row is left off the map, or null. */
export function skipReason(p) {
  if (NO_PARKING_CLASS[p.CLASS]) return NO_PARKING_CLASS[p.CLASS];
  if (p.CLASS === 6 && !houseRange(p)) return 'driveway with no house numbers (City street class 6)';
  return null;
}

// ---------- geometry -------------------------------------------------------------------------------

const LAT0 = 40.0, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
export const xy = ([lon, lat]) => [lon * KX, lat * KY];
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
/** What a side is called, "North" or "Southeast": the direction it faces, from the line's first point to its last. */
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
export const round6 = (c) => c.map(([lo, la]) => [Math.round(lo * 1e6) / 1e6, Math.round(la * 1e6) / 1e6]);

// ---------- one block ------------------------------------------------------------------------------

/** Cross streets at a segment's two nodes (the other streets there), "N 5th St - N 6th St". */
export function limitsOf(p, nodeStreets) {
  const own = titleCase(p.STNAME);
  const at = (n) => [...(nodeStreets.get(n) || [])].map(titleCase).filter((s) => s && s !== own && !/\bRamp\b/i.test(s)).sort()[0] || '';
  const a = at(p.FNODE_), b = at(p.TNODE_);
  return a && b ? (a === b ? a : `${a} - ${b}`) : a || b;
}

/**
 * One route row → a block of segments.json, or { skip } with the reason. Each side gets its own day; both sides share
 * the row's window. When the two sides' days differ and the address ranges don't say which side is odd, the row is
 * skipped rather than guessed.
 */
export function blockOf(f, nodeStreets = new Map()) {
  const p = f.properties, g = f.geometry;
  const why = skipReason(p);
  if (why) return { skip: why };
  if (!g || g.type !== 'LineString' || g.coordinates.length < 2) return { skip: 'no line geometry' };
  const win = parseWindow(p.Time);
  if (!win) return { skip: 'time window unreadable' };
  const { even, odd, filled } = sideDays(p);
  if (even === null || odd === null) return { skip: 'no day for a side' };
  const o = oddSide(p);
  let sides;
  if (even === odd) sides = [['L', even], ['R', even]];
  else if (o) sides = [[o, odd], [o === 'L' ? 'R' : 'L', even]];
  else return { skip: 'the two sides have different days and the address ranges do not say which side is odd' };
  const c = g.coordinates, n = houseRange(p), area = String(p.Name || '').trim();
  const block = {
    c: String(p.SEG_ID), s: titleCase(p.STNAME), l: limitsOf(p, nodeStreets), h: AREA_NAMES[area] || area,
    ...(n ? { n } : {}), ...(o ? { o } : {}), g: round6(c),
    d: sides.sort((a, b) => a[0].localeCompare(b[0])).map(([side, dow]) => [side, compass(c, side), [[dow, win[0], win[1], WEEKS, MONTHS, FLAGS]]]),
  };
  return { block, filled, typo: /\d(AM|PM)\S/i.test(String(p.Time || '')) || /\s{2}|^\s|\s$/.test(String(p.STNAME || '')) };
}

// ---------- fetching -------------------------------------------------------------------------------

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-philadelphia-build (+https://curb.guide)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const j = await r.json();
      if (j && j.error) throw new Error(`${url}: ${JSON.stringify(j.error)}`);
      return j;
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
async function pages(layer, params, size = 2000) {
  const out = [];
  for (let off = 0; ; off += size) {
    const q = new URLSearchParams({ where: '1=1', f: 'json', resultOffset: off, resultRecordCount: size, ...params });
    const page = await getJSON(`${layer}/query?${q}`);
    out.push(...(page.features || []));
    if (!(page.exceededTransferLimit || (page.properties && page.properties.exceededTransferLimit)) && (page.features || []).length < size) return out;
  }
}

// ---------- the build ------------------------------------------------------------------------------

async function main() {
  const meta = await cached('routes-meta.json', () => getJSON(`${ROUTES}?f=json`));
  const fields = new Set((meta.fields || []).map((x) => x.name));
  const missing = ROUTE_FIELDS.filter((k) => !fields.has(k));
  if (missing.length) throw new Error(`the SweepPHL layer changed shape: no ${missing.join(', ')}`);
  const routes = await cached('routes.json', async () => {
    log('fetching the SweepPHL routes…');
    return pages(ROUTES, { outFields: ROUTE_FIELDS.join(','), outSR: '4326', f: 'geojson', orderByFields: 'OBJECTID' });
  });
  const nodes = await cached('centerline-nodes.json', async () => {
    log('fetching street centerline node names…');
    const rows = await pages(CENTERLINE, { outFields: 'seg_id,fnode_,tnode_,stname', returnGeometry: 'false', orderByFields: 'objectid' });
    return rows.map((r) => [r.attributes.seg_id, r.attributes.fnode_, r.attributes.tnode_, r.attributes.stname]);
  });
  const api = await cached('holidays-api.json', () => getJSON(HOLIDAY_API));
  if (routes.length < 6000 || routes.length > 12000) throw new Error(`expected about 8,200 route rows, got ${routes.length}`);
  if (nodes.length < 35000) throw new Error(`expected about 41,000 centerline rows, got ${nodes.length}`);
  // The City's holiday list must be in ours (the API lists the current year).
  const apiDates = (api.holidays || []).map((h) => String(h.start_date).slice(0, 10));
  const notOurs = apiDates.filter((d) => !HOLIDAYS[d]);
  if (!apiDates.length || notOurs.length) throw new Error(`City holiday list differs from HOLIDAYS: ${notOurs.join(', ') || 'empty'}`);
  log(`${routes.length} route rows, ${nodes.length} centerline segments, ${apiDates.length} City holidays this year`);

  const nodeStreets = new Map();
  for (const [, a, b, name] of nodes) for (const n of [a, b]) {
    if (!nodeStreets.has(n)) nodeStreets.set(n, new Set());
    if (name) nodeStreets.get(n).add(String(name).replace(/\s+/g, ' ').trim());
  }

  const out = [], skipped = new Map(), seen = new Set(), dupes = [];
  const fixes = { bothSidesFromDay: 0, oneSideFromDay: 0, typos: 0 };
  let differ = 0, noOdd = 0;
  // Are the City's left and right the line's own? Addresses should rise from the first point to the last, and the odd
  // side should face north or east (Philadelphia's rule) whatever way the street runs.
  const parityCheck = { withNumbers: 0, rising: 0, oddFaces: {} };
  for (const f of routes) {
    const p = f.properties, o = oddSide(p), c = f.geometry && f.geometry.coordinates;
    const lo = ['L_F_ADD', 'R_F_ADD'].map((k) => +p[k]).filter((v) => v > 0), hi = ['L_T_ADD', 'R_T_ADD'].map((k) => +p[k]).filter((v) => v > 0);
    if (!lo.length || !hi.length || !o || !c) continue;
    parityCheck.withNumbers++;
    if (Math.max(...hi) > Math.min(...lo)) parityCheck.rising++;
    const face = compass(c, o);
    parityCheck.oddFaces[face] = (parityCheck.oddFaces[face] || 0) + 1;
  }
  for (const f of routes) {
    const p = f.properties;
    if (seen.has(String(p.SEG_ID))) { dupes.push(p.SEG_ID); continue; }
    seen.add(String(p.SEG_ID));
    const r = blockOf(f, nodeStreets);
    if (r.skip) {
      if (!skipped.has(r.skip)) skipped.set(r.skip, []);
      skipped.get(r.skip).push({ id: String(p.SEG_ID), street: titleCase(p.STNAME), area: p.Name, day: p.Day, time: p.Time, class: p.CLASS });
      continue;
    }
    if (r.filled === 'both sides from Day') fixes.bothSidesFromDay++; else if (r.filled) fixes.oneSideFromDay++;
    if (r.typo) fixes.typos++;
    if (r.block.d.length === 2 && r.block.d[0][2][0][0] !== r.block.d[1][2][0][0]) differ++;
    if (!r.block.o) noOdd++;
    out.push(r.block);
  }
  out.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));
  const sides = out.reduce((n, b) => n + b.d.length, 0);

  // Map view: the swept blocks' extent (with a margin) and the North Philadelphia areas at the opening zoom.
  let w = 180, s = 90, e = -180, nn = -90;
  for (const b of out) for (const [lo, la] of b.g) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); nn = Math.max(nn, la); }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const bounds = [[r4(s - 0.01), r4(w - 0.01)], [r4(nn + 0.01), r4(e + 0.01)]];
  const areas = new Map();
  for (const b of out) {
    if (!areas.has(b.h)) areas.set(b.h, [180, 90, -180, -90, 0]);
    const q = areas.get(b.h);
    for (const [lo, la] of b.g) { q[0] = Math.min(q[0], lo); q[1] = Math.min(q[1], la); q[2] = Math.max(q[2], lo); q[3] = Math.max(q[3], la); }
    q[4]++;
  }
  const neighborhoods = [...areas.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, q]) => ({ name, bbox: q.slice(0, 4).map((v) => v.toFixed(4)).join(',') }));

  const fetched = new Date().toISOString().slice(0, 10);
  const editDate = (meta.editingInfo && meta.editingInfo.dataLastEditDate) ? new Date(meta.editingInfo.dataLastEditDate).toISOString().slice(0, 10) : 'unknown';
  const sources = [
    { name: 'SweepPHL Route Locations (Streets Department, Mechanical Broom Routes)', url: ROUTES,
      license: 'No license stated (a public City of Philadelphia layer, not in the OpenDataPhilly catalog)', fetched, updated: editDate },
    { name: 'Street Centerline (OpenDataPhilly), node ids and street names only, for cross streets', url: CENTERLINE,
      license: 'City of Philadelphia open data terms (OpenDataPhilly)', fetched },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'philadelphia', time_zone: 'America/New_York', generated: new Date().toISOString(), sources, blocks: out.length, sides,
      format: 'b[] = {c: City street segment id (SEG_ID), s: street, l: cross streets, h: program area, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]] first point to last, d: [[side L|R, compass label, rules]]}; '
        + 'rule = [jsDow, fromH, toH, weeksMask (bit i = week i+1; 31 = every week), monthsMask (bit m-1; 1016 = April to October), flags (0 = stops on City holidays, not towable)]' },
    b: out }));

  const city = {
    id: 'philadelphia', name: 'Philadelphia', region: 'Pennsylvania', tz: 'America/New_York',
    center: [39.9905, -75.155], zoom: 14, bounds,
    holidays: HOLIDAYS, holidaysSource: 'https://www.phila.gov/media/20251202123436/Final-NPhilly-Twice-a-Week-Collections-Palmcard-6x9-3.pdf',
    holidayRule: 'all', fine: '$31', tow: 'no', fineSource: FINE_URL,
    agency: 'Philadelphia Department of Sanitation', scheduleUrl: SCHEDULE_URL, sources,
    words: {
      rule: 'Mechanical street cleaning, April 6 to October 29, Monday to Thursday: on signed blocks, no parking during the posted two hour window (9 to 11 AM, 11 AM to 1 PM, or 1 to 3 PM).',
      afterpass: 'Signs are posted on select blocks only. A $31 ticket, no tow. No cleaning on City holidays.',
      dataNotes: 'Days and windows come from the City\'s SweepPHL route map (Streets Department), placed on each side of the street by its even or odd house numbers. The City posts no parking signs only on blocks wide enough to move cars and the data does not say which, so every route block is shown: the sign on the block wins.',
    },
    neighborhoods,
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1));

  const ex = (list) => list.slice(0, 5);
  const report = {
    generated: new Date().toISOString(),
    inputs: { routeRows: routes.length, routeLayerUpdated: editDate, centerlineSegments: nodes.length, duplicateSegIds: dupes.length },
    output: { blocks: out.length, sides, rules: sides, sidesWithDifferentDays: differ, blocksWithoutOddSide: noOdd,
      sizeBytes: fs.statSync(OUT + 'segments.json').size },
    cleaned: {
      timeTypos: 'Time "1PM - 3PMl" read as 1 to 3 PM; padded street names trimmed (' + fixes.typos + ' rows touched by either)',
      bothSidesFromDayField: fixes.bothSidesFromDay, oneSideFromDayField: fixes.oneSideFromDay,
      areaNames: AREA_NAMES,
    },
    skipped: [...skipped.entries()].map(([why, list]) => ({ why, count: list.length, examples: ex(list) })),
    season: { months: 'April to October (mask 1016)', programDates: '2026-04-06 to 2026-10-29', enforcementFrom: '2026-04-20',
      overreach: 'The months mask also marks 2026-04-01 and 2026-04-02 (Wed, Thu) as swept; the 2027 dates are not published (April 1, 2027 is a Thursday).',
      holidaysInSeason: Object.entries(HOLIDAYS).filter(([d]) => { const m = +d.slice(5, 7), w = new Date(d + 'T12:00:00Z').getUTCDay(); return m >= 4 && m <= 10 && w >= 1 && w <= 4; }).map(([d, n]) => `${d} ${n}`) },
    checks: {
      sideByParity: { ...parityCheck, note: 'Odd numbers are on the north and east sides in Philadelphia (520 Chestnut St, south side, is even). Rising addresses and an odd side facing north or east (or between, where the grid turns) mean the layer\'s L/R are the line\'s own left and right.' },
      cityMaps: 'Checked by hand on 2026-10-18 against the route maps (PDF) linked from the City\'s 2026 schedule page: South Philadelphia (map dated March 2020: every street\'s day and the 9 to 11 AM window match) and Port Richmond (map dated March 2026: 1 to 3 PM, and the two day streets, Frankford Ave, Aramingo Ave and E Allegheny Ave, are drawn in both days\' colors). The maps cannot say which side is which.',
      postedSigns: 'Not checkable from the data: the City posts no parking signs only on select blocks (by width).',
      tickets: 'No cross check: the City\'s parking violation data on OpenDataPhilly stops in 2017, before these routes.',
    },
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1));
  log(`${out.length} blocks, ${sides} sides (${differ} blocks with a different day per side, ${noOdd} without an odd side)`);
  log(`skipped: ${report.skipped.map((x) => `${x.count} ${x.why}`).join('; ') || 'none'}`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/philadelphia/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
