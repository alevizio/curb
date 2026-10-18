#!/usr/bin/env node
// Oakland for CURB (2026-10-18; the format is docs/multi-city/city-build.md). Builds data/oakland/ from the City of
// Oakland's own published data:
//
//   1. Street Sweeping Routes (Oakland Public Works, ArcGIS StreetSweeping/FeatureServer/0, the layer behind the City's
//      "Map Your Street's Sweeping" map): 23,862 street centerlines with left and right address ranges and, per line, a
//      day code and a time code for the odd numbered side and for the even numbered side (DAY_ODD, TIME_ODD, DAY_EVEN,
//      TIME_EVEN), decoded from the layer's coded value domains. Last edited 2021-06-21.
//   2. OaklandDayRouteSweepingSegments (Public Works, Feb 2024): 7,512 of the same lines, daytime routes only. Read as a
//      second opinion per line (it turned out to hold no schedule the 2021 layer lacks; report.json, snapshot2024).
//   3. Citation Data Portal (OakDOT, data.oaklandca.gov 58em-y96b): every 10.28.240 ticket ("no parking certain hours,
//      used for street sweeping", $72) since 2025-01-01, with date, time, the written address and a point. Used to check
//      the schedule ticket by ticket, to choose between a line's duplicate records, and to correct lines whose odd and
//      even schedules are reversed (report.json, crossCheck). Only date, time and location are read.
//   4. Neighborhoods (data.oaklandca.gov sb4q-6bkc): each block's neighborhood, and the list for the welcome card.
//   5. Oakland Addresses (City GIS, address points): which side of each line its odd numbers stand on. They agree with
//      the layer's address ranges on 4,807 lines and win on the 21 where they clearly disagree (report.json, sidePlacement).
//
// Writes data/oakland/segments.json, city.json and report.json. Run: node scripts/cities/oakland.mjs [--refresh]
// [--as-published] [--keep-contradicted]  (Node 18+; inputs cached in private/cache/oakland/; --as-published skips the
// ticket corrections; --keep-contradicted keeps the sides the tickets contradict, left off by default).
// Fails loudly when the City's codes change meaning or a new code appears.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/oakland/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/oakland/';
const REFRESH = process.argv.includes('--refresh');
const AS_PUBLISHED = process.argv.includes('--as-published');
const KEEP_CONTRADICTED = process.argv.includes('--keep-contradicted');
const log = (...a) => console.error('[oakland]', ...a);

const AGOL = 'https://services.arcgis.com/9tC74aDHuml0x5Yz/arcgis/rest/services/';
export const SWEEP_LAYER = AGOL + 'StreetSweeping/FeatureServer/0';
export const DAY2024_LAYER = AGOL + 'OaklandDayRouteSweepingSegments/FeatureServer/0';
export const HOODS = 'https://data.oaklandca.gov/resource/sb4q-6bkc.geojson';
export const CITATIONS = 'https://data.oaklandca.gov/resource/58em-y96b.json';
export const ADDRESSES = AGOL + 'Oakland_Addresses_as_of_December_2022_revised_view/FeatureServer/0';
const CITES_FROM = '2025-01-01';
const UA = { 'User-Agent': 'curb-oakland-build (+https://curb.guide)', Accept: 'application/json' };

// ---------- 1. the City's codes ----------------------------------------------------------------------
// Day codes (domain StreetSweepingD): [the domain's own words, JS weekdays, weeks of the month (bit 0 = 1st)]. The
// tickets agree with the words: 98% of the tickets on a "2nd Wed" type side's weekday and hours fall in the 2nd week,
// 99.9% of "1st and 3rd" ones in the 1st or 3rd (report.json, codes.weeksCheck).
const EVERY = 31, ALL = [0, 1, 2, 3, 4, 5, 6], WEEKDAYS = [1, 2, 3, 4, 5];
export const DAY_CODES = {
  E: ['Everyday', ALL, EVERY], EEH: ['Everyday except Holidays', ALL, EVERY],
  EESSH: ['Everyday except Saturday, Sunday & Holidays', WEEKDAYS, EVERY], MF: ['Every Mon to Fri', WEEKDAYS, EVERY],
  MWF: ['Every Mon, Wed, Fri', [1, 3, 5], EVERY], TTHS: ['Every Tues, Thurs, Sat', [2, 4, 6], EVERY],
  TTH: ['Every Tues, Thurs', [2, 4], EVERY], TTHE: ['Every Tues and Thurs', [2, 4], EVERY], TFE: ['Every Tues and Fri', [2, 5], EVERY],
  MTHE: ['Every Mon and Thurs', [1, 4], EVERY], THFE: ['Every Thurs and Fri', [4, 5], EVERY], MFE: ['Every Mon and Fri', [1, 5], EVERY],
  ME: ['Every Mon', [1], EVERY], TE: ['Every Tues', [2], EVERY], WE: ['Every Wed', [3], EVERY], THE: ['Every Thurs', [4], EVERY],
  FE: ['Every Fri', [5], EVERY], S: ['Every Sat', [6], EVERY], SU: ['Every Sun', [0], EVERY],
  M13: ['1st and 3rd Mon', [1], 5], T13: ['1st and 3rd Tues', [2], 5], W13: ['1st and 3rd Wed', [3], 5],
  TH13: ['1st and 3rd Thurs', [4], 5], F13: ['1st and 3rd Fri', [5], 5],
  M24: ['2nd and 4th Mon', [1], 10], T24: ['2nd and 4th Tues', [2], 10],
  M1: ['1st Mon', [1], 1], T1: ['1st Tues', [2], 1], TH1: ['1st Thurs', [4], 1], F1: ['1st Fri', [5], 1], FW: ['First Wednesday', [3], 1],
  M2: ['2nd Mon', [1], 2], T2: ['2nd Tues', [2], 2], W2: ['2nd Wed', [3], 2], TH2: ['2nd Thurs', [4], 2], F2: ['2nd Fri', [5], 2],
  W4: ['4th Wed', [3], 8], TH4: ['4th Thurs', [4], 8], F4: ['4th Fri', [5], 8],
};
// Codes that put no posted sweeping on that side: [the domain's words (null: not in the domain), why it is left out].
export const NOT_SWEPT = {
  'N-S': ['No Signage', 'swept, but no signs: not enforced'],
  N: ['No Sweeping (Exempt)', 'not swept (exempt)'],
  NS: ['No Sweeping (Within City Of Oakland Limit)', 'not swept'],
  'NS-UC': ['No Sweeping (Uncontrol Condition)', 'not swept (uncontrolled condition)'],
  'NS-H': ['No Sweeping (HYW)', 'not swept (highway)'],
  'NS-O': ['No Sweeping (Outside Of The City Limit)', 'not swept (outside the city)'],
  'NS-A': ['No Sweeping(Alleyways)', 'not swept (alley)'],
  'N-O': ['No Odd Addresses', 'no odd addresses on this street'],
  'N-E': ['No Even Addresses', 'no even addresses on this street'],
  O: ['There is no this side of the street', 'no such side'],
  DM: ['It is shown in the different map.', 'shown on a different map (no schedule here)'],
  MS: ['It is a major street so it is not using Centerline, it uses 2 lines.', 'major street: this side is on the street\'s other line'],
  missing: [null, 'the code "missing" (not in the domain)'],
};
// Time codes (domain StreetSweepingT): [the domain's words, from, to] in CURB's rule format (whole hours as numbers,
// minutes as "H:MM"). NA: no time.
export const TIME_CODES = {
  M1: ['12:00AM-3:00AM', 0, 3], M2: ['3:00AM-6:00AM', 3, 6], M3: ['9:00AM-12:00PM', 9, 12],
  A1: ['12:30PM-3:30PM', '12:30', '15:30'], M23: ['2:00AM-3:00AM', 2, 3], M68: ['6:00AM-8:00AM', 6, 8],
};
const NO_TIME = 'NA';

// The layer's domains must still say what the tables above say; a changed or new code stops the build.
export function checkDomains(meta) {
  const dom = (field) => {
    const f = (meta.fields || []).find((x) => x.name === field);
    if (!f || !f.domain || !Array.isArray(f.domain.codedValues)) throw new Error(`field ${field} has no coded value domain any more`);
    return new Map(f.domain.codedValues.map((c) => [String(c.code), String(c.name)]));
  };
  const problems = [];
  for (const field of ['DAY_ODD', 'DAY_EVEN']) {
    const d = dom(field);
    for (const [code, name] of d) {
      const known = DAY_CODES[code] || NOT_SWEPT[code];
      if (!known) problems.push(`${field}: new code ${code} = "${name}"`);
      else if (known[0] !== name) problems.push(`${field}: ${code} now reads "${name}" (was "${known[0]}")`);
    }
  }
  for (const field of ['TIME_ODD', 'TIME_EVEN']) {
    const d = dom(field);
    for (const [code, name] of d) {
      if (code === NO_TIME) continue;
      if (!TIME_CODES[code]) problems.push(`${field}: new code ${code} = "${name}"`);
      else if (TIME_CODES[code][0] !== name) problems.push(`${field}: ${code} now reads "${name}" (was "${TIME_CODES[code][0]}")`);
    }
  }
  if (problems.length) throw new Error('the City\'s sweeping codes changed:\n  ' + problems.join('\n  '));
}

// One side's day and time codes → CURB rules, or why there are none. Rules: [dow, from, to, weeks, months, flags];
// Oakland sweeps all year (months 0), no City page speaks of a tow (flag 2 off), and it stops on City holidays (flag 1
// off; the 2026 tickets agree, night routes included).
export function decodeSide(day, time) {
  const d = day == null ? null : String(day).trim(), t = time == null ? null : String(time).trim();
  if (!d) return { skip: 'no day code' };
  if (NOT_SWEPT[d]) return { skip: NOT_SWEPT[d][1], code: d };
  if (!DAY_CODES[d]) throw new Error(`unknown day code ${JSON.stringify(d)}`);
  if (!t || t === NO_TIME) return { skip: 'a day but no hours', code: d };
  if (!TIME_CODES[t]) throw new Error(`unknown time code ${JSON.stringify(t)}`);
  const [, days, weeks] = DAY_CODES[d], [, from, to] = TIME_CODES[t];
  return { rules: days.map((dow) => [dow, from, to, weeks, 0, 0]) };
}

// ---------- 2. small helpers ---------------------------------------------------------------------------
const LAT0 = 37.80, LON0 = -122.25, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
export const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const lineLen = (c) => { let s = 0; for (let i = 1; i < c.length; i++) { const a = xy(c[i - 1]), b = xy(c[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
const flip = (side) => (side === 'L' ? 'R' : 'L');
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const blank = (v) => v == null || String(v).trim() === '' || String(v).trim() === 'None';
const toMin = (h) => (typeof h === 'number' ? h * 60 : +h.split(':')[0] * 60 + +h.split(':')[1]);

// Compass word for side L or R of a line, from its first point to its last (as in scripts/cities/boston.mjs), or null
// when the line bends too much for one word to be right (its ends closer than half its length, or under 10 m apart);
// `loose` gives a word anyway.
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
export function compass(c, side, loose = false) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1], chord = Math.hypot(dx, dy);
  if (!loose && (chord < 10 || chord < 0.5 * lineLen(c))) return null;
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
// Distance in meters from point p (x, y) to a polyline of x, y points, and which side of it (looking along it) p is on.
function nearOnLine(p, pts) {
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2)) : 0;
    const d = Math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy);
    if (!best || d < best.d) best = { d, side: dx * (p[1] - y1) - dy * (p[0] - x1) > 0 ? 'L' : 'R' };
  }
  return best;
}
// The same, plus how far along the line (0 at its first point, 1 at its last) the nearest spot is.
function alongLine(p, pts) {
  let best = null, acc = 0, total = 0;
  const seg = [];
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); total += l; }
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2)) : 0;
    const d = Math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy);
    if (!best || d < best.d) best = { d, side: dx * (p[1] - y1) - dy * (p[0] - x1) > 0 ? 'L' : 'R', along: total ? (acc + t * seg[i - 1]) / total : 0 };
    acc += seg[i - 1];
  }
  return best;
}
function midpoint(pts) {
  let half = 0;
  for (let i = 1; i < pts.length; i++) half += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  half /= 2;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d && half <= d) { const t = half / d; return [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])]; }
    half -= d;
  }
  return pts[pts.length - 1];
}
// A line's coordinates: a MultiLineString counts only when its parts join end to end.
export function lineCoords(geom) {
  if (!geom || !Array.isArray(geom.coordinates)) return null;
  if (geom.type === 'LineString') return geom.coordinates.length >= 2 ? geom.coordinates : null;
  if (geom.type !== 'MultiLineString') return null;
  const out = [...geom.coordinates[0]];
  for (const part of geom.coordinates.slice(1)) {
    const end = out[out.length - 1];
    if (!part.length || Math.abs(part[0][0] - end[0]) > 1e-7 || Math.abs(part[0][1] - end[1]) > 1e-7) return null;
    out.push(...part.slice(1));
  }
  return out.length >= 2 ? out : null;
}

// ---------- 3. street names, ticket addresses and times -------------------------------------------------
const TYPE = { STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', BOULEVARD: 'BLVD', ROAD: 'RD', DRIVE: 'DR', PLACE: 'PL', COURT: 'CT',
  LANE: 'LN', TERRACE: 'TER', CIRCLE: 'CIR', PARKWAY: 'PKWY', HIGHWAY: 'HWY', SQUARE: 'SQ', TRAIL: 'TRL', PLAZA: 'PLZ',
  ALLEY: 'ALY', EXPRESSWAY: 'EXPY', CRESCENT: 'CRES', WY: 'WAY' };
const DIRS = { EAST: 'E', WEST: 'W', NORTH: 'N', SOUTH: 'S' };
const ORD = { FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH', SIXTH: '6TH', SEVENTH: '7TH', EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH' };
// Ticket spellings the layer spells otherwise.
const TICKET_ALIAS = { 'MLK JR WAY': 'MARTIN LUTHER KING JR WAY', 'M L K JR WAY': 'MARTIN LUTHER KING JR WAY', 'MLK WAY': 'MARTIN LUTHER KING JR WAY',
  'THOMAS L BERKELEY WAY': 'THOMAS L BERKLEY WAY' };
// One spelling per street, to match a ticket's address to the layer: "1200 EAST 17TH STREET" and "E 17th St" agree.
export function streetKey(s) {
  const w = String(s || '').toUpperCase().replace(/[.,'’"#]/g, ' ').trim().split(/\s+/).filter(Boolean).map((x) => ORD[x] || x);
  if (w.length > 1 && TYPE[w[w.length - 1]]) w[w.length - 1] = TYPE[w[w.length - 1]];
  if (w.length > 1 && DIRS[w[0]]) w[0] = DIRS[w[0]];
  if (w.length > 2 && w[0] === 'ST') w[0] = 'SAINT';
  if (w.length > 2 && w[0] === 'MT') w[0] = 'MOUNT';
  const k = w.join(' ');
  return TICKET_ALIAS[k] || k;
}
// The street as people write it: "E 12th St", "MacArthur Blvd", "Broadway".
export function streetName(p) {
  return ['PREFIX', 'NAME', 'TYPE', 'SUFFIX'].map((k) => (blank(p[k]) ? '' : String(p[k]).trim())).filter(Boolean).join(' ')
    .replace(/\bWY$/, 'Way');
}
// Names people never say for a city street, used only when the line has no other name.
const HIGHWAY = /^(State Hwy|Interstate|US Hwy|I-\d)|\b(Fwy|Expy|Ramp|Tunl|Opas)$|^Unnamed Street$|^Ramp$/i;
// "1971 89TH AVE" → { n: 1971, street: "89TH AVE" }. A letter right after the number is a unit ("1234A MAIN ST");
// "9424 D ST" is D Street.
export function parseLocation(s) {
  const m = /^\s*(\d+)(?:[A-Z](?=\s))?\s+(.+?)\s*$/.exec(String(s || '').toUpperCase());
  if (!m || /@/.test(m[2])) return null;
  return { n: +m[1], street: m[2] };
}
// Minutes after midnight: the portal writes "14:35", and in Sep and Oct 2025 "2:35:00 PM".
export function parseTime(t) {
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?\s*$/i.exec(String(t || ''));
  if (!m) return null;
  let h = +m[1];
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'AM' && h === 12) h = 0; else if (ap === 'PM' && h !== 12) h += 12;
  return h < 24 && +m[2] < 60 ? h * 60 + +m[2] : null;
}
// "2026-03-02" → { dow: 1, nth: 1 }: JS weekday and which occurrence of it in the month (1st Monday).
export function weekdayOf(date) {
  const [y, mo, d] = date.split('-').map(Number);
  return { dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(), nth: Math.floor((d - 1) / 7) + 1 };
}
// Does a rule cover this weekday, occurrence and minute? `grace` minutes on either side of the window.
export function covers(rule, dow, nth, min, grace = 0) {
  const [rd, from, to, weeks] = rule;
  if (rd !== dow || !(weeks & (1 << (nth - 1)))) return false;
  const a = toMin(from) - grace, b = toMin(to) + grace;
  return min >= a && min < b;
}
const sameDayHour = (rule, dow, min, grace) => covers([rule[0], rule[1], rule[2], EVERY], dow, 1, min, grace);

// ---------- 4. which side holds the odd numbers ------------------------------------------------------------
const parity = (v) => { const n = parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) && n > 0 ? n % 2 : null; };
// A vote of the four address fields: odd numbers on the left (or even on the right) say L.
export function oddSide(p) {
  let v = 0;
  for (const k of ['L_F_ADD', 'L_T_ADD']) { const x = parity(p[k]); if (x !== null) v += x ? 1 : -1; }
  for (const k of ['R_F_ADD', 'R_T_ADD']) { const x = parity(p[k]); if (x !== null) v += x ? -1 : 1; }
  return v > 0 ? 'L' : v < 0 ? 'R' : null;
}
// The side a one-sided line's house numbers are on (major streets drawn as two lines), or null.
export function numberedSide(p) {
  const l = ['L_F_ADD', 'L_T_ADD'].some((k) => parity(p[k]) !== null), r = ['R_F_ADD', 'R_T_ADD'].some((k) => parity(p[k]) !== null);
  return l && !r ? 'L' : r && !l ? 'R' : null;
}
const housesOf = (p) => ['L_F_ADD', 'L_T_ADD', 'R_F_ADD', 'R_T_ADD'].map((k) => parseInt(String(p[k] ?? ''), 10)).filter((v) => v > 0);

// ---------- fetching -------------------------------------------------------------------------------------------
async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: UA });
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
async function layerFeatures(layer, order) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const q = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'geojson', resultOffset: off, resultRecordCount: 1000, orderByFields: order });
    const j = await getJSON(`${layer}/query?${q}`);
    const page = j.features || [];
    out.push(...page);
    if (!page.length || (page.length < 1000 && !(j.properties && j.properties.exceededTransferLimit))) return out;
  }
}
// The City's address points: house number, street and point of every current address (to see which side of a line the
// odd numbers are on). Kept as [number, street, lng, lat], one per number, street and place.
async function addressPoints() {
  const out = [], seen = new Set();
  for (let off = 0; ; off += 2000) {
    const q = new URLSearchParams({ where: "NotCurrent <> 'Y'", outFields: 'StreetNumb,PreDirecti,Street,StreetType,PostDirect', outSR: '4326',
      returnGeometry: 'true', f: 'json', resultOffset: off, resultRecordCount: 2000, orderByFields: 'FID' });
    const j = await getJSON(`${ADDRESSES}/query?${q}`);
    for (const f of j.features || []) {
      const a = f.attributes, g = f.geometry;
      if (!g || !(a.StreetNumb > 0) || blank(a.Street)) continue;
      const street = [a.PreDirecti, a.Street, a.StreetType, a.PostDirect].filter((v) => !blank(v)).map((v) => String(v).trim()).join(' ');
      const row = [a.StreetNumb, street, r6(g.x), r6(g.y)], k = row.join('|');
      if (!seen.has(k)) { seen.add(k); out.push(row); }
    }
    if ((j.features || []).length < 2000 && !j.exceededTransferLimit) return out;
  }
}
// Street sweeping tickets: date, time, the written address and its point. Nothing else is fetched.
async function citations(from) {
  const out = [];
  for (let last = ''; ;) {
    const q = new URLSearchParams({ $select: ':id,ticket_iss,ticket_i_1,location,the_geom', $order: ':id', $limit: '50000',
      $where: `violation='10.28.240' AND ticket_iss >= '${from}T00:00:00'${last ? ` AND :id > '${last}'` : ''}` });
    const page = await getJSON(`${CITATIONS}?${q}`);
    for (const r of page) {
      const c = r.the_geom && r.the_geom.coordinates;
      out.push([String(r.ticket_iss || '').slice(0, 10), r.ticket_i_1 || '', r.location || '', c ? r6(c[0]) : null, c ? r6(c[1]) : null]);
    }
    log(`citations: ${out.length}`);
    if (page.length < 50000) return out;
    last = page[page.length - 1][':id'];
  }
}

// ---------- the City's holidays and words ------------------------------------------------------------------------
// "Street sweeping will not occur on the following City of Oakland holidays" (oaklandca.gov Street Sweeping page, read
// 2026-10-18; both the holiday and its observed day are listed).
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': 'Presidents Day',
  '2026-03-31': 'Farmworkers Day', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (Observed)', '2026-07-04': 'Independence Day', '2026-09-07': 'Labor Day',
  '2026-09-09': 'California Admission Day', '2026-11-11': 'Veterans Day', '2026-11-26': 'Thanksgiving Day',
  '2026-11-27': 'Day After Thanksgiving', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': 'Presidents Day',
  '2027-03-31': 'Farmworkers Day', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (Observed)',
  '2027-06-19': 'Juneteenth', '2027-07-04': 'Independence Day', '2027-07-05': 'Independence Day (Observed)',
  '2027-09-06': 'Labor Day', '2027-09-09': 'California Admission Day', '2027-11-11': 'Veterans Day',
  '2027-11-25': 'Thanksgiving Day', '2027-11-26': 'Day After Thanksgiving', '2027-12-24': 'Christmas Day (Observed)',
  '2027-12-25': 'Christmas Day',
};
const SWEEPING_PAGE = 'https://www.oaklandca.gov/Public-Safety-Streets/Streets/Street-Sweeping';
const TICKETS_PAGE = 'https://www.oaklandca.gov/Public-Safety-Streets/Parking-Vehicles/Parking-Tickets';
const MAP_PAGE = 'https://www.oaklandca.gov/Public-Safety-Streets/Streets/Street-Sweeping/Map-Your-Streets-Sweeping';   // the layer's own map

// ---------- the build --------------------------------------------------------------------------------------------
export async function build() {
  const meta = await cached('layer-meta.json', () => getJSON(`${SWEEP_LAYER}?f=json`));
  const feats = await cached('street-sweeping.json', () => layerFeatures(SWEEP_LAYER, 'OBJECTID'));
  const snap = await cached('day-routes-2024.json', () => layerFeatures(DAY2024_LAYER, 'FID'));
  const hoods = await cached('neighborhoods.json', () => getJSON(`${HOODS}?$limit=1000`));
  const cites = await cached('citations-2025-2026.json', () => citations(CITES_FROM));
  const addrs = await cached('address-points.json', addressPoints);
  log(`${feats.length} lines, ${snap.length} in the 2024 snapshot, ${hoods.features.length} neighborhoods, ${cites.length} tickets, ${addrs.length} address points`);
  checkDomains(meta);
  const editedAt = new Date(meta.editingInfo.lastEditDate).toISOString().slice(0, 10);

  // 4a. lines, and one group per line: the layer repeats a line once per name it has (51st St and Pleasant Valley Ave;
  // San Pablo Ave and State Hwy 123), sometimes with a different schedule on each copy.
  const rec = [], skipped = { noGeometry: 0, brokenMultiLine: 0 };
  for (const f of feats) {
    const p = f.properties, c = lineCoords(f.geometry);
    if (!c) { skipped[f.geometry ? 'brokenMultiLine' : 'noGeometry']++; continue; }
    for (const k of ['DAY_ODD', 'DAY_EVEN']) if (p[k] != null && !DAY_CODES[p[k]] && !NOT_SWEPT[p[k]]) throw new Error(`unknown ${k} ${p[k]} on OBJECTID ${p.OBJECTID}`);
    for (const k of ['TIME_ODD', 'TIME_EVEN']) if (p[k] != null && p[k] !== NO_TIME && !TIME_CODES[p[k]]) throw new Error(`unknown ${k} ${p[k]} on OBJECTID ${p.OBJECTID}`);
    rec.push({ p, c, name: streetName(p) });
  }
  const geoKey = (c) => { const a = c.map(([x, y]) => r6(x) + ',' + r6(y)), b = [...a].reverse(), s = a.join(';'), t = b.join(';'); return s < t ? s : t; };
  const groupsByKey = new Map();
  for (const r of rec) {
    const k = geoKey(r.c);
    if (!groupsByKey.has(k)) groupsByKey.set(k, []);
    groupsByKey.get(k).push(r);
  }
  const rank = (r) => (r.p.NAME_TYPE === 'R' ? 0 : r.p.NAME_TYPE === 'G' ? 1 : 2);
  const groups = [];
  for (const members of groupsByKey.values()) {
    members.sort((a, b) => rank(a) - rank(b) || a.p.OBJECTID - b.p.OBJECTID);
    const prim = members[0];
    const named = members.filter((m) => m.name && !HIGHWAY.test(m.name));
    const display = (named[0] || prim).name || 'Unnamed street';
    const same = (m) => m.c[0][0] === prim.c[0][0] && m.c[0][1] === prim.c[0][1];   // drawn the same way as the primary
    groups.push({ members, prim, c: prim.c, name: display, keys: new Set(members.map((m) => streetKey(m.name)).filter(Boolean)),
      route: (members.find((m) => !blank(m.p.ROUTE)) || prim).p.ROUTE, dyn: prim.p.DYNAMAP_ID, same,
      pts: prim.c.map(xy) });
  }
  log(`${rec.length} lines with geometry in ${groups.length} groups (${rec.length - groups.length} repeated names)`);

  // 4b. the 2024 snapshot: same lines, so its schedule joins each group's candidates.
  const byGeo = new Map(groups.map((g) => [geoKey(g.c), g]));
  const snapCmp = { segments: snap.length, matched: 0, sameAsPrimary: 0, otherCopy: 0, notIn2021: 0, notInExamples: [] };
  for (const f of snap) {
    const c = lineCoords(f.geometry), g = c && byGeo.get(geoKey(c));
    if (!g) continue;
    snapCmp.matched++;
    const p = f.properties, s = [p.DAY_ODD, p.TIME_ODD, p.DAY_EVEN, p.TIME_EVEN].map((v) => (blank(v) ? null : String(v).trim())).join('|');
    const sched = (q) => [q.DAY_ODD, q.TIME_ODD, q.DAY_EVEN, q.TIME_EVEN].map((v) => (blank(v) ? null : String(v).trim())).join('|');
    if (s === sched(g.prim.p)) snapCmp.sameAsPrimary++;
    else if (g.members.some((m) => sched(m.p) === s)) snapCmp.otherCopy++;
    else { snapCmp.notIn2021++; if (snapCmp.notInExamples.length < 10) snapCmp.notInExamples.push({ c: String(g.dyn), s: g.name, was: sched(g.prim.p), snap: s }); }
    (g.snaps ||= []).push(p);
  }

  // 4c. candidates per side: every swept (day, time) any copy of the line gives that side.
  for (const g of groups) {
    g.cand = { odd: new Map(), even: new Map() };
    g.code = { odd: null, even: null };
    const all = [...g.members.map((m) => ({ p: m.p, from: m === g.prim ? 'primary' : 'copy' })), ...(g.snaps || []).map((p) => ({ p, from: '2024' }))];
    for (const { p, from } of all) for (const [side, dk, tk] of [['odd', 'DAY_ODD', 'TIME_ODD'], ['even', 'DAY_EVEN', 'TIME_EVEN']]) {
      const dec = decodeSide(p[dk], p[tk]);
      if (g.code[side] === null) g.code[side] = blank(p[dk]) ? null : String(p[dk]).trim();
      if (!dec.rules) continue;
      const k = `${String(p[dk]).trim()}|${String(p[tk]).trim()}`;
      if (!g.cand[side].has(k)) g.cand[side].set(k, { rules: dec.rules, from: new Set() });
      g.cand[side].get(k).from.add(from);
    }
    // a side is on the street's other line when every copy says MS and none sweeps it here
    g.ms = { odd: !g.cand.odd.size && g.members.every((m) => m.p.DAY_ODD === 'MS'), even: !g.cand.even.size && g.members.every((m) => m.p.DAY_EVEN === 'MS') };
    g.ranges = g.members.flatMap((m) => [['L_F_ADD', 'L_T_ADD'], ['R_F_ADD', 'R_T_ADD']].map(([a, b]) => {
      const x = parseInt(String(m.p[a] ?? ''), 10), y = parseInt(String(m.p[b] ?? ''), 10);
      const lo = Math.min(x > 0 ? x : Infinity, y > 0 ? y : Infinity), hi = Math.max(x > 0 ? x : -Infinity, y > 0 ? y : -Infinity);
      return lo <= hi ? [lo, hi] : null;
    }).filter(Boolean));
  }

  // 5. which side of each line is the curb of the odd and the even numbers
  const nodeId = ([lon, lat]) => lon.toFixed(5) + ',' + lat.toFixed(5);
  const atNode = new Map();
  for (const g of groups) for (const [end, pt] of [['a', g.c[0]], ['b', g.c[g.c.length - 1]]]) {
    const n = nodeId(pt);
    if (!atNode.has(n)) atNode.set(n, []);
    atNode.get(n).push([g, end]);
  }
  const cell = (v) => Math.floor(v / 100), grid = new Map();
  for (const g of groups) {
    g.mid = midpoint(g.pts);
    const k = cell(g.mid[0]) + ',' + cell(g.mid[1]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(g);
  }
  const near = (p, r = 1) => { const out = []; for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) out.push(...(grid.get((cell(p[0]) + i) + ',' + (cell(p[1]) + j)) || [])); return out; };
  const sideStats = { byNumbers: 0, byNeighbors: 0, unknown: 0, msByNumbers: 0, msByOtherLine: 0, msUnknown: 0, msBoth: 0, msNumbersVsOtherLine: 0,
    pointsAgree: 0, pointsOppose: 0, pointsSilent: 0, byPoints: 0, fixedByPoints: [], msPointsAgree: 0, msPointsOppose: 0, msPointsSilent: 0 };
  // The City's address points: which side of a line its odd numbers stand on. A point counts when it is on the line's
  // street, its number is in the line's range, it stands 2 to 60 m from the line and not past its ends. Clear means at
  // least 3 points of a parity, three to one on one side (and the two parities on opposite sides when both show).
  const ptsByKey = new Map();
  for (const [num, street, lon, lat] of addrs) { const k = streetKey(street); if (!ptsByKey.has(k)) ptsByKey.set(k, []); ptsByKey.get(k).push([num, xy([lon, lat])]); }
  const pointsBySide = (g) => {
    const c = { odd: { L: 0, R: 0 }, even: { L: 0, R: 0 } };
    for (const k of g.keys) for (const [num, p] of ptsByKey.get(k) || []) {
      if (g.ranges.length && !g.ranges.some(([lo, hi]) => num >= lo - 2 && num <= hi + 2)) continue;
      const at = alongLine(p, g.pts);
      if (at.d < 2 || at.d > 60 || at.along <= 0.01 || at.along >= 0.99) continue;
      c[num % 2 ? 'odd' : 'even'][at.side]++;
    }
    return c;
  };
  const clear = (s) => (s.L >= 3 && s.L >= 3 * s.R ? 'L' : s.R >= 3 && s.R >= 3 * s.L ? 'R' : null);
  const pointsOddSide = (g) => {
    const c = pointsBySide(g), o = clear(c.odd), e = clear(c.even);
    if (o && e) return o !== e ? o : null;
    return o || (e ? flip(e) : null);
  };
  // Major streets drawn as two lines (MS): each line carries one side, whose curb is on the side of its house numbers,
  // else on the side away from the street's other line (where a line has both, they agree: report.json, sidePlacement).
  for (const g of groups) {
    const carries = g.ms.even && !g.ms.odd ? 'odd' : g.ms.odd && !g.ms.even ? 'even' : null;
    if (!carries) continue;
    g.carries = carries;
    const votes = g.members.map((m) => { const s = numberedSide(m.p); return s && (g.same(m) ? s : flip(s)); }).filter(Boolean);
    const byNum = votes.length ? votes[0] : null;
    let partner = null;
    for (const h of near(g.mid)) {
      if (h === g || !(h.ms.odd !== h.ms.even) || (h.ms.even ? 'odd' : 'even') === carries) continue;
      const d = nearOnLine(g.mid, h.pts).d;
      if (d > 40) continue;
      const shared = [...h.keys].some((k) => g.keys.has(k));
      if (!partner || (shared && !partner.shared) || (shared === partner.shared && d < partner.d)) partner = { h, d, shared };
    }
    const away = partner ? flip(nearOnLine(partner.h.mid, g.pts).side) : null;
    if (partner) g.partner = partner.h;
    if (byNum && away) { sideStats.msBoth++; if (byNum !== away) sideStats.msNumbersVsOtherLine++; }
    g.curb = byNum || away;
    if (byNum) sideStats.msByNumbers++; else if (away) sideStats.msByOtherLine++; else sideStats.msUnknown++;
    if (g.curb) g.odd = carries === 'odd' ? g.curb : flip(g.curb);
    if (g.curb && g.cand[carries].size) { const v = clear(pointsBySide(g)[carries]); sideStats[v == null ? 'msPointsSilent' : v === g.curb ? 'msPointsAgree' : 'msPointsOppose']++; }
  }
  // Other lines: the address ranges' vote, checked against the address points, which win when they clearly disagree
  // (31 lines) and place the lines with no ranges; then a line still without a side takes it from the next line of the
  // same street.
  for (const g of groups) {
    if (g.carries) continue;
    let v = 0;
    for (const m of g.members) { const s = oddSide(m.p); if (s) v += (g.same(m) ? s : flip(s)) === 'L' ? 1 : -1; }
    const byRanges = v > 0 ? 'L' : v < 0 ? 'R' : null;
    const swept = [...g.cand.odd.keys(), ...g.cand.even.keys()].length > 0;
    const byPoints = swept ? pointsOddSide(g) : null;
    if (byRanges && swept) sideStats[byPoints == null ? 'pointsSilent' : byPoints === byRanges ? 'pointsAgree' : 'pointsOppose']++;
    if (byRanges && byPoints && byPoints !== byRanges) { g.odd = byPoints; g.oddFromPoints = true; sideStats.fixedByPoints.push(g); }
    else if (byRanges) { g.odd = byRanges; sideStats.byNumbers++; }
    else if (byPoints) { g.odd = byPoints; g.oddFromPoints = true; sideStats.byPoints++; }
  }
  for (let pass = 0; pass < 30; pass++) {
    let changed = 0;
    for (const g of groups) {
      if (g.carries || g.odd) continue;
      let v = 0;
      for (const [end, pt] of [['a', g.c[0]], ['b', g.c[g.c.length - 1]]]) for (const [h, hend] of atNode.get(nodeId(pt)) || []) {
        if (h === g || !h.odd || h.carries || ![...h.keys].some((k) => g.keys.has(k))) continue;
        const sameWay = end !== hend;   // my end meets its other end: drawn the same way
        v += (sameWay ? h.odd : flip(h.odd)) === 'L' ? 1 : -1;
      }
      if (v) { g.odd = v > 0 ? 'L' : 'R'; g.oddFromNeighbors = true; changed++; }
    }
    if (!changed) break;
  }

  // 6. tickets → lines: the street of the written address, a line of that street whose house numbers hold it (on a
  // major street, the line that carries that side), the nearest to the ticket's point; else the nearest of that street
  // within 100 m.
  const byKey = new Map();
  for (const g of groups) for (const k of g.keys) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(g); }
  const tk = { tickets: cites.length, noAddress: 0, badTime: 0, streetNotInLayer: 0, tooFar: 0, matched: 0 };
  const unknownStreets = new Map(), matched = [];
  for (const [date, time, loc, lon, lat] of cites) {
    const a = parseLocation(loc);
    if (!a || lon == null) { tk.noAddress++; continue; }
    const min = parseTime(time);
    if (min == null) { tk.badTime++; continue; }
    const k = streetKey(a.street), cands = byKey.get(k);
    if (!cands) { tk.streetNotInLayer++; unknownStreets.set(k, (unknownStreets.get(k) || 0) + 1); continue; }
    const par = a.n % 2 ? 'odd' : 'even';
    const own = cands.filter((g) => !g.ms[par]);
    const pool0 = own.length ? own : cands;
    const inRange = pool0.filter((g) => g.ranges.some(([lo, hi]) => a.n >= lo && a.n <= hi));
    const pool = inRange.length ? inRange : pool0, p = xy([lon, lat]);
    let best = null;
    for (const g of pool) { const d = nearOnLine(p, g.pts).d; if (!best || d < best.d) best = { g, d }; }
    if (!inRange.length && best.d > 100) { tk.tooFar++; continue; }
    tk.matched++;
    const { dow, nth } = weekdayOf(date);
    matched.push({ g: best.g, par, dow, nth, min, date, p, n: a.n });
  }
  const ticketsOf = new Map();
  for (const t of matched) { if (!ticketsOf.has(t.g)) ticketsOf.set(t.g, []); ticketsOf.get(t.g).push(t); }
  const GRACE = 10;
  const fits = (rules, t, grace = GRACE) => !!rules && rules.some((r) => covers(r, t.dow, t.nth, t.min, grace));

  // 7. each side's schedule: the one candidate, or among several the one the tickets on that side back (else the
  // primary record's). A side of a major street drawn as two lines takes its rules from the line that carries it.
  const choice = { oneCandidate: 0, byTickets: 0, byPrimary: 0, examples: [] };
  for (const g of groups) {
    g.rules = { odd: null, even: null };
    for (const side of ['odd', 'even']) {
      const c = [...g.cand[side].entries()];
      if (!c.length) continue;
      if (c.length === 1) { g.rules[side] = c[0][1].rules; choice.oneCandidate++; continue; }
      const ts = (ticketsOf.get(g) || []).filter((t) => t.par === side);
      const scored = c.map(([k, v]) => ({ k, v, n: ts.filter((t) => fits(v.rules, t)).length })).sort((x, y) => y.n - x.n);
      const prim = scored.find((s) => s.v.from.has('primary'));
      const pick = scored[0].n > (scored[1] ? scored[1].n : 0) ? scored[0] : prim || scored[0];
      g.rules[side] = pick.v.rules;
      if (pick === scored[0] && scored[0].n > (scored[1] ? scored[1].n : 0)) choice.byTickets++; else choice.byPrimary++;
      if (choice.examples.length < 25) choice.examples.push({ c: String(g.dyn), s: g.name, side, chose: pick.k, from: [...pick.v.from], tickets: Object.fromEntries(scored.map((s) => [s.k, s.n])) });
    }
  }
  const sideRules = (g, side) => (g.ms[side] && g.partner ? g.partner.rules[side] : g.rules[side]);

  // 8. odd and even reversed: a block whose odd numbered tickets fall in the even side's windows AND whose even numbered
  // tickets fall in the odd side's (each at least 3, three times those in their own window, and 40% of that side's
  // tickets) gets the two schedules swapped. The City's own notes on the layer say some routes show the dates reversed
  // for odd and even. A major street's two lines are judged and swapped together. Evidence from one parity only (a block
  // with house numbers on one side, where every ticket carries that side's number) changes nothing; it is listed.
  for (const g of groups) g.pub = { odd: sideRules(g, 'odd'), even: sideRules(g, 'even') };
  const evidence = (ts, pub) => {
    const c = { odd: { n: 0, own: 0, other: 0 }, even: { n: 0, own: 0, other: 0 } };
    for (const t of ts) {
      const a = fits(pub[t.par], t), b = fits(pub[t.par === 'odd' ? 'even' : 'odd'], t), s = c[t.par];
      s.n++; if (a && !b) s.own++; else if (b && !a) s.other++;
    }
    return c;
  };
  const leans = (s) => s.other >= 3 && s.other >= 3 * s.own && s.other >= 0.4 * s.n;
  const swaps = [], oneSided = [], seen = new Set();
  for (const g of groups) {
    if (seen.has(g)) continue;
    const pair = g.carries ? (g.partner ? [g, g.partner] : null) : [g];
    if (!pair) continue;
    pair.forEach((x) => seen.add(x));
    const { odd: ro, even: re } = g.pub;
    if (!ro || !re || JSON.stringify(ro) === JSON.stringify(re)) continue;
    const ts = pair.flatMap((x) => ticketsOf.get(x) || []);
    if (ts.length < 6) continue;
    const ev = evidence(ts, g.pub);
    if (leans(ev.odd) && leans(ev.even)) swaps.push({ pair, ev });
    else if (leans(ev.odd) || leans(ev.even)) oneSided.push({ pair, ev });
  }
  if (!AS_PUBLISHED) {
    const next = new Map();
    for (const { pair: [g, h] } of swaps) {
      if (!h) { next.set(g, { odd: g.pub.even, even: g.pub.odd }); continue; }
      const o = g.carries === 'odd' ? 'even' : 'odd';
      next.set(g, { [g.carries]: g.pub[o] });
      next.set(h, { [o]: g.pub[g.carries] });
    }
    for (const [g, r] of next) { Object.assign(g.rules, r); g.swapped = true; }
  }
  for (const g of groups) g.fin = { odd: sideRules(g, 'odd'), even: sideRules(g, 'even') };

  // 9. the check: of the tickets, how many fall in a window the data gives their side, that weekday, week and hour
  const verdict = (t, own, other) => {
    if (!own) return 'side not swept in the data';
    if (fits(own, t)) return 'agree';
    if (fits(other, t)) return 'other side\'s window';
    if (own.some((r) => sameDayHour(r, t.dow, t.min, GRACE))) return 'right day and hours, other week';
    if (own.some((r) => r[0] === t.dow)) return 'right day, other hours';
    return 'other day';
  };
  const routeKey = (g) => (blank(g.route) ? '(none)' : String(g.route).trim());
  const cc = { tickets: matched.length, asPublished: {}, final: {}, strictAgree: 0 }, routeStat = new Map(), sideEv = new Map();
  const weekEv = new Map();   // weeks mask of the rule a ticket's weekday and hours fall in → [in those weeks, all]
  const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (const t of matched) {
    const g = t.g, o = t.par === 'odd' ? 'even' : 'odd';
    const v0 = verdict(t, g.pub[t.par], g.pub[o]), v1 = verdict(t, g.fin[t.par], g.fin[o]);
    cc.asPublished[v0] = (cc.asPublished[v0] || 0) + 1;
    cc.final[v1] = (cc.final[v1] || 0) + 1;
    if (g.fin[t.par] && fits(g.fin[t.par], t, 0)) cc.strictAgree++;
    const rk = routeKey(g);
    if (!routeStat.has(rk)) routeStat.set(rk, { tickets: 0, agreeAsPublished: 0, agree: 0, otherSide: 0, otherTimes: 0, notSwept: 0 });
    const rs = routeStat.get(rk);
    rs.tickets++; if (v0 === 'agree') rs.agreeAsPublished++;
    if (v1 === 'agree') rs.agree++; else if (v1 === 'other side\'s window') rs.otherSide++; else if (v1 === 'side not swept in the data') rs.notSwept++; else rs.otherTimes++;
    if (!sideEv.has(g)) sideEv.set(g, { odd: { n: 0, agree: 0, otherSide: 0, neither: 0, when: new Map() }, even: { n: 0, agree: 0, otherSide: 0, neither: 0, when: new Map() } });
    const se = sideEv.get(g)[t.par];
    se.n++;
    if (v1 === 'agree') se.agree++; else if (v1 === 'other side\'s window') se.otherSide++;
    else if (v1 !== 'side not swept in the data') { se.neither++; const k = `${DN[t.dow]} ${Math.floor(t.min / 60)}h`; se.when.set(k, (se.when.get(k) || 0) + 1); }
    else { const k = `${DN[t.dow]} ${Math.floor(t.min / 60)}h`; se.when.set(k, (se.when.get(k) || 0) + 1); }
    const r = g.fin[t.par] && g.fin[t.par].find((x) => sameDayHour(x, t.dow, t.min, GRACE));
    if (r) { const w = weekEv.get(r[3]) || [0, 0]; w[1]++; if (r[3] & (1 << (t.nth - 1))) w[0]++; weekEv.set(r[3], w); }
  }

  // 10. blocks: one per line with a posted schedule on at least one side
  const lonlat = ([x, y]) => [x / KX + LON0, y / KY + LAT0];
  const nameAt = new Map();
  for (const g of groups) for (const pt of [g.c[0], g.c[g.c.length - 1]]) {
    const n = nodeId(pt);
    if (!nameAt.has(n)) nameAt.set(n, new Map());
    if (g.name && !HIGHWAY.test(g.name)) nameAt.get(n).set(streetKey(g.name), g.name);
  }
  // Cross streets: the other streets at each end of the line ("Telegraph Ave - 51st St"). The street base breaks a street
  // where nothing crosses it too, so an end with no other street walks on along the same street (up to 12 lines).
  const limitsOf = (g) => {
    const other = (n) => [...(nameAt.get(n) || new Map()).entries()].filter(([k]) => !g.keys.has(k)).map(([, v]) => v).sort()[0] || '';
    const walkFrom = (pt) => {
      let n = nodeId(pt), cur = g;
      for (let i = 0; i < 12; i++) {
        const found = other(n);
        if (found) return found;
        const next = (atNode.get(n) || []).filter(([h]) => h !== cur && [...h.keys].some((k) => g.keys.has(k)));
        if (next.length !== 1) return '';
        const [h, end] = next[0];
        cur = h; n = nodeId(end === 'a' ? h.c[h.c.length - 1] : h.c[0]);
      }
      return '';
    };
    const a = walkFrom(g.c[0]), b = walkFrom(g.c[g.c.length - 1]);
    return a && b ? (a === b ? a : `${a} - ${b}`) : a || b;
  };
  const hoodList = (hoods.features || []).filter((f) => f.geometry).map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let w = 180, s = 90, e = -180, n = -90;
    for (const poly of polys) for (const [x, y] of poly[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    return { name: String(f.properties.neighbhd || '').trim(), polys, bb: [w, s, e, n] };
  }).filter((h) => h.name);
  const inRing = ([x, y], ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const hoodAt = (pt) => {
    for (const h of hoodList) {
      if (pt[0] < h.bb[0] || pt[0] > h.bb[2] || pt[1] < h.bb[1] || pt[1] > h.bb[3]) continue;
      for (const poly of h.polys) if (inRing(pt, poly[0]) && !poly.slice(1).some((hole) => inRing(pt, hole))) return h.name;
    }
    return null;
  };
  const sameRules = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sideTally = new Map();   // why a line's side has no rules → count
  const tally = (why) => sideTally.set(why, (sideTally.get(why) || 0) + 1);
  const out = [], sideUnknown = [], placed = { byNumbers: 0, byAddressPoints: 0, byNeighbors: 0, bothSidesSame: 0, msByNumbers: 0, msByOtherLine: 0 };
  for (const g of groups) {
    for (const side of ['odd', 'even']) {
      if (g.carries && side !== g.carries) continue;
      if (g.fin[side]) tally('posted schedule');
      else { const p = g.prim.p, d = decodeSide(p[side === 'odd' ? 'DAY_ODD' : 'DAY_EVEN'], p[side === 'odd' ? 'TIME_ODD' : 'TIME_EVEN']); tally(d.skip || 'posted schedule'); }
    }
    const sides = [];
    if (g.carries) {
      const rules = g.fin[g.carries];
      if (!rules) continue;
      if (!g.curb) { sideUnknown.push(g); continue; }
      sides.push([g.curb, g.carries, rules]);
      placed[numberedSideOf(g) ? 'msByNumbers' : 'msByOtherLine']++;
    } else {
      const { odd, even } = g.fin;
      if (!odd && !even) continue;
      if (g.odd) {
        if (odd) sides.push([g.odd, 'odd', odd]);
        if (even) sides.push([flip(g.odd), 'even', even]);
        placed[g.oddFromNeighbors ? 'byNeighbors' : g.oddFromPoints ? 'byAddressPoints' : 'byNumbers']++;
      } else if (odd && even && sameRules(odd, even)) {
        sides.push(['L', null, odd], ['R', null, even]);
        placed.bothSidesSame++;
      } else { sideUnknown.push(g); continue; }
    }
    const nums = g.members.flatMap((m) => housesOf(m.p));
    const hood = hoodAt(lonlat(g.mid));
    out.push({ g, b: {
      c: null, s: g.name, l: limitsOf(g), ...(hood ? { h: hood } : {}),
      ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}), ...(g.odd ? { o: g.odd } : {}),
      g: g.c.map(([x, y]) => [r6(x), r6(y)]),
      d: sides.sort((a, b) => a[0].localeCompare(b[0])).map(([lr, par, rules]) => [lr,
        compass(g.c, lr) || (par === 'odd' ? 'Odd side' : par === 'even' ? 'Even side' : compass(g.c, lr, true)),
        [...rules].sort((a, b) => a[0] - b[0] || toMin(a[1]) - toMin(b[1]))]),
    } });
  }
  function numberedSideOf(g) { return g.members.some((m) => numberedSide(m.p)); }
  // The City's DYNAMAP_ID (from the street base map; it survived the 2024 re-export) is the block id. The few lines
  // that share one, or have none, get -1, -2… in the order of their first point, which stays put between refreshes.
  const byDyn = new Map();
  for (const o of out) { const k = o.g.dyn ? String(o.g.dyn) : '0'; if (!byDyn.has(k)) byDyn.set(k, []); byDyn.get(k).push(o); }
  let sharedIds = 0;
  for (const [k, list] of byDyn) {
    if (list.length === 1 && k !== '0') { list[0].b.c = k; continue; }
    sharedIds += list.length;
    list.sort((a, b) => a.b.g[0][0] - b.b.g[0][0] || a.b.g[0][1] - b.b.g[0][1]).forEach((o, i) => { o.b.c = `${k}-${i + 1}`; });
  }
  out.sort((x, y) => x.b.c.localeCompare(y.b.c, 'en', { numeric: true }));
  const blocks = out.map((o) => o.b);
  const sides = blocks.reduce((n, b) => n + b.d.length, 0), rules = blocks.reduce((n, b) => n + b.d.reduce((m, d) => m + d[2].length, 0), 0);
  const idOf = new Map(out.map((o) => [o.g, o.b.c]));

  // 11. sides the tickets contradict: most of their tickets fall outside any window the data gives either side
  const contradicted = [];
  for (const [g, ev] of sideEv) for (const side of ['odd', 'even']) {
    const s = ev[side];
    if (!g.fin[side] || s.neither < 8 || s.agree >= 0.25 * (s.agree + s.neither)) continue;
    contradicted.push({ c: idOf.get(g) || String(g.dyn), s: g.name, l: limitsOf(g), route: routeKey(g), side, tickets: s.n, agree: s.agree,
      otherSide: s.otherSide, elsewhere: s.neither, mostlyAt: [...s.when.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${v})`) });
  }
  contradicted.sort((a, b) => b.elsewhere - a.elsewhere);
  const notSweptTicketed = [];
  for (const [g, ev] of sideEv) for (const side of ['odd', 'even']) {
    const s = ev[side];
    if (g.fin[side] || s.n < 10) continue;
    notSweptTicketed.push({ c: String(g.dyn), s: g.name, l: limitsOf(g), route: routeKey(g), side, code: g.code[side], tickets: s.n,
      mostlyAt: [...s.when.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${v})`) });
  }
  notSweptTicketed.sort((a, b) => b.tickets - a.tickets);

  // 12. holidays: tickets on the City's 2026 holidays against the same weekday the weeks around
  const perDay = new Map();
  for (const [date, time] of cites) { const m = parseTime(time); if (m == null) continue; const d = perDay.get(date) || [0, 0]; d[0]++; if (m < 360) d[1]++; perDay.set(date, d); }
  const lastDay = [...perDay.keys()].sort().pop();
  const shift = (date, days) => { const t = new Date(date + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); };
  const holidayCheck = Object.entries(HOLIDAYS).filter(([d]) => d <= lastDay && weekdayOf(d).dow !== 0).map(([date, name]) => {
    const around = [-28, -21, -14, -7, 7, 14, 21, 28].map((k) => shift(date, k)).filter((d) => !HOLIDAYS[d] && d <= lastDay).map((d) => perDay.get(d) || [0, 0]);
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const day = perDay.get(date) || [0, 0];
    return { date, name, tickets: day[0], before6am: day[1], sameWeekdayMedian: med(around.map((d) => d[0])), sameWeekdayBefore6amMedian: med(around.map((d) => d[1])) };
  });

  return { meta, editedAt, groups, skipped, sideStats, placed, sideUnknown, sideTally, snapCmp, choice, swaps, oneSided, tk, unknownStreets,
    matched, cc, routeStat, weekEv, contradicted, notSweptTicketed, holidayCheck, blocks, sides, rules, sharedIds, idOf, limitsOf, hoodList,
    lastDay, perDay, addrs };
}

// ---------- writing --------------------------------------------------------------------------------------------
const WEEKS_WORDS = { 31: 'every week', 5: '1st and 3rd', 10: '2nd and 4th', 1: '1st', 2: '2nd', 8: '4th' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;
const monthYear = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);

function write(r) {
  const today = new Date().toISOString().slice(0, 10);
  // Sides the tickets contradict (step 11) stay off the map: most of their tickets fall outside every window the
  // data gives, so the map would call a curb clear at the hours people get tickets there (the weekend routes now
  // ticketed Thursday and Friday, night routes swept more nights than the layer says). --keep-contradicted keeps them.
  const hide = !AS_PUBLISHED && !KEEP_CONTRADICTED ? new Set(r.contradicted.map((x) => x.c + '|' + x.side)) : new Set();
  let hidden = 0;
  const blocks = r.blocks.map((b) => {
    if (!b.o || !(hide.has(b.c + '|odd') || hide.has(b.c + '|even'))) return b;
    const gone = new Set([hide.has(b.c + '|odd') && b.o, hide.has(b.c + '|even') && (b.o === 'L' ? 'R' : 'L')].filter(Boolean));
    const d = b.d.filter((x) => !gone.has(x[0]));
    hidden += b.d.length - d.length;
    return { ...b, d };
  }).filter((b) => b.d.length);
  r.sides = blocks.reduce((n, b) => n + b.d.length, 0);
  r.rules = blocks.reduce((n, b) => n + b.d.reduce((m, d) => m + d[2].length, 0), 0);
  const sources = [
    { name: 'Street Sweeping Routes (Oakland Public Works)', url: SWEEP_LAYER, page: MAP_PAGE, license: 'not stated', fetched: today, edited: r.editedAt },
    { name: 'OaklandDayRouteSweepingSegments (Public Works, daytime routes as of Feb 2024)', url: DAY2024_LAYER, license: 'not stated', fetched: today },
    { name: 'Citation Data Portal (OakDOT), violation 10.28.240', url: 'https://data.oaklandca.gov/d/58em-y96b', license: 'not stated', fetched: today },
    { name: 'Neighborhoods (City of Oakland)', url: 'https://data.oaklandca.gov/d/sb4q-6bkc', license: 'not stated', fetched: today },
    { name: 'Oakland Addresses as of December 2022, revised view (City GIS)', url: ADDRESSES, license: 'not stated', fetched: today },
    { name: 'Street Sweeping page (holidays)', url: SWEEPING_PAGE, license: 'City web page', fetched: today },
  ];
  // map view: Adams Point, between Lake Merritt, Grand Lake and Piedmont Ave, with Temescal at the top of a phone
  let w = 180, s = 90, e = -180, n = -90;
  for (const b of blocks) for (const [x, y] of b.g) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const shareFinal = pct(r.cc.final.agree || 0, r.cc.tickets), sharePub = pct(r.cc.asPublished.agree || 0, r.cc.tickets);
  const hoodBlocks = new Map();
  for (const b of blocks) if (b.h) hoodBlocks.set(b.h, (hoodBlocks.get(b.h) || 0) + 1);
  const hoods = new Map();
  for (const h of r.hoodList) {
    if (!hoodBlocks.has(h.name)) continue;
    const bb = hoods.get(h.name);
    hoods.set(h.name, bb ? [Math.min(bb[0], h.bb[0]), Math.min(bb[1], h.bb[1]), Math.max(bb[2], h.bb[2]), Math.max(bb[3], h.bb[3])] : [...h.bb]);
  }
  const city = {
    id: 'oakland', name: 'Oakland', region: 'California', tz: 'America/Los_Angeles',
    center: [37.8135, -122.2555], zoom: 14, bounds: [[r6(s), r6(w)], [r6(n), r6(e)]],
    holidays: HOLIDAYS, holidaysSource: SWEEPING_PAGE, holidayRule: 'all',
    fine: '$72', tow: 'no', fineSource: TICKETS_PAGE,
    agency: 'Oakland Public Works', scheduleUrl: SWEEPING_PAGE,
    sources,
    words: {
      rule: 'Each side of the street has its own posted sweeping day, one for the odd house numbers and one for the even, most often the 1st and 3rd or the 2nd and 4th time that weekday comes in the month; main streets are swept at night.',
      afterpass: 'All year. A $72 ticket, no tow. No sweeping on City holidays.',
      dataNotes: `Schedule from Oakland Public Works' street sweeping map (last edited ${longDate(r.editedAt)}), the data behind the City's Map Your Street's Sweeping; each side is placed by its house numbers. `
        + `Checked against ${r.cc.tickets.toLocaleString('en-US')} of the City's street sweeping tickets (${monthYear(CITES_FROM)} to ${monthYear(r.lastDay)}): ${shareFinal}% fall in the window shown for that side. `
        + (AS_PUBLISHED ? `The schedule is shown as the City publishes it.` : `On ${r.swaps.length} blocks whose tickets show the odd and even days reversed, the two are swapped.`)
        + (hidden ? ` ${hidden} sides whose tickets mostly fall outside the posted window are left off the map.` : ''),
    },
    neighborhoods: [...hoods.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, bb]) => ({ name, bbox: bb.map((v) => r6(v)).join(',') })),
  };
  const segMeta = { city: 'oakland', time_zone: 'America/Los_Angeles', generated: new Date().toISOString(), sources, blocks: blocks.length, sides: r.sides,
    format: 'b[] = {c: block id (the City\'s DYNAMAP_ID), s: street, l: cross streets, h: neighborhood, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]] (L/R = left/right looking from the first point to the last), d: [[side L|R, label, rules]]}; '
      + 'rule = [jsDow, from, to, weeksMask (bit i = week i+1), monthsMask (0 = all year), flags (1 = not suspended on holidays; 2 = towable)]; from/to are hours, "H:MM" when the window has minutes' };
  const routes = [...r.routeStat.entries()].map(([route, x]) => ({ route, tickets: x.tickets, agreeAsPublished: pct(x.agreeAsPublished, x.tickets), agree: pct(x.agree, x.tickets),
    otherSide: pct(x.otherSide, x.tickets), otherTimes: pct(x.otherTimes, x.tickets), notSwept: pct(x.notSwept, x.tickets) })).sort((a, b) => b.tickets - a.tickets);
  const swapRow = ({ pair, ev }) => ({ c: pair.map((g) => r.idOf.get(g) || String(g.dyn)), s: pair[0].name, l: r.limitsOf(pair[0]), route: String(pair[0].route ?? '').trim(),
    odd: `${ev.odd.other} of ${ev.odd.n} odd numbered tickets in the even side's window, ${ev.odd.own} in their own`,
    even: `${ev.even.other} of ${ev.even.n} even numbered tickets in the odd side's window, ${ev.even.own} in their own` });
  const byRoute = (list) => [...list.reduce((m, x) => m.set(x.route, (m.get(x.route) || 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([route, n]) => ({ route, n }));
  const skippedCodes = Object.fromEntries([...r.sideTally.entries()].sort((a, b) => b[1] - a[1]));
  const report = {
    generated: new Date().toISOString(),
    counts: { features: r.groups.reduce((n, g) => n + g.members.length, 0) + r.skipped.noGeometry + r.skipped.brokenMultiLine,
      noGeometry: r.skipped.noGeometry, multiLineNotJoined: r.skipped.brokenMultiLine, lines: r.groups.length,
      repeatedNameCopies: r.groups.reduce((n, g) => n + g.members.length - 1, 0), blocks: blocks.length, blockSides: r.sides, rules: r.rules,
      sideUnknown: r.sideUnknown.length, sharedOrMissingIds: r.sharedIds, segmentsKB: null },
    season: 'none: all year (the layer has no season and the City names none)',
    holidays: { rule: 'all', note: 'The City: "Street sweeping will not occur on the following City of Oakland holidays." The tickets agree, night sweeps included (holidayCheck).', holidayCheck: r.holidayCheck },
    lineSides: { note: 'Each line\'s odd and even side (a major street drawn as two lines counts its one side): why it has rules or not, from the City\'s codes.', ...skippedCodes },
    leftOut: {
      notPosted: { sides: r.sideTally.get(NOT_SWEPT['N-S'][1]) || 0, why: 'code N-S, "No Signage": swept, but no signs, so not enforced' },
      noHours: { sides: r.sideTally.get('a day but no hours') || 0, why: 'a day code with time NA' },
      sideUnknown: { lines: r.sideUnknown.length, why: 'two different schedules and no way to tell which side holds the odd numbers', examples: r.sideUnknown.slice(0, 8).map((g) => ({ c: String(g.dyn), s: g.name, l: r.limitsOf(g) })) },
      contradicted: { sides: hidden, why: hidden ? 'the tickets contradict the schedule (crossCheck.contradictedSides): left off the map, --keep-contradicted keeps them' : 'kept (--as-published or --keep-contradicted)' },
    },
    sidePlacement: { ...r.placed, majorStreetLinesWithBoth: r.sideStats.msBoth, majorStreetNumbersVsOtherLine: r.sideStats.msNumbersVsOtherLine,
      addressPoints: { agreeWithRanges: r.sideStats.pointsAgree, disagree: r.sideStats.pointsOppose, notEnoughPoints: r.sideStats.pointsSilent,
        majorStreetLines: { agree: r.sideStats.msPointsAgree, disagree: r.sideStats.msPointsOppose, notEnoughPoints: r.sideStats.msPointsSilent, note: 'checked only, not changed' },
        correctedLines: r.sideStats.fixedByPoints.map((g) => ({ c: r.idOf.get(g) || String(g.dyn), s: g.name, l: r.limitsOf(g) })) },
      note: 'byNumbers: the address ranges say which side is odd (checked against the City\'s address points, which win where they clearly disagree); byAddressPoints: no ranges, the address points say; byNeighbors: the next line of the same street does; bothSidesSame: unknown, but both sides share one schedule; major streets (MS, two lines, one side each): the curb is on the side of the line\'s house numbers, else the side away from the street\'s other line. The tickets\' own points were not used: they sit on the side the address points give on only about 80% of blocks.' },
    repeatedNames: { note: 'The layer repeats a line once per name; when its copies give a side different schedules, the tickets on that side choose, else the primary record.',
      sidesWithOneSchedule: r.choice.oneCandidate, choseByTickets: r.choice.byTickets, choseByPrimary: r.choice.byPrimary, examples: r.choice.examples },
    snapshot2024: { ...r.snapCmp, note: 'Every 2024 line is a 2021 line (same geometry). Its schedule equals the 2021 primary record\'s, or another copy of the same line in the 2021 layer; it holds no schedule the 2021 layer lacks, so it changes nothing by itself. Where it differs, the tickets chose (repeatedNames).' },
    codes: {
      day: Object.fromEntries(Object.entries(DAY_CODES).map(([k, [words, days, weeks]]) => [k, `${words}: ${days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(' ')}, ${WEEKS_WORDS[weeks]}`])),
      notSwept: Object.fromEntries(Object.entries(NOT_SWEPT).map(([k, [words, why]]) => [k, `${words || '(not in the domain)'}: ${why}`])),
      time: Object.fromEntries(Object.entries(TIME_CODES).map(([k, [words, from, to]]) => [k, `${words}: ${from} to ${to}`])),
      undecoded: 'none: every code in the data is in the domain, except "missing" (85 even sides), left out',
      weeksCheck: Object.fromEntries([...r.weekEv.entries()].sort((a, b) => a[0] - b[0]).map(([mask, [inW, all]]) => [WEEKS_WORDS[mask] || String(mask), `${pct(inW, all)}% of ${all} tickets on that weekday and hours fall in those weeks`])),
    },
    crossCheck: {
      tickets: { fetched: r.tk.tickets, from: CITES_FROM, to: r.lastDay, violation: '10.28.240 NO PARK CERTAIN HRS ($72)', matchedToALine: r.tk.matched,
        noHouseNumber: r.tk.noAddress, streetNotInLayer: r.tk.streetNotInLayer, numberNotOnStreetAndOver100m: r.tk.tooFar,
        streetsNotInLayer: [...r.unknownStreets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} (${v})`) },
      method: 'Each ticket goes to the line of its written street whose house numbers hold its number (on a major street, the line that carries that side), nearest the ticket\'s point; its side is odd or even by the number. It agrees when the side has a rule for that weekday, that week of the month and that hour (10 minute grace at both ends of the window).',
      share: { asPublished: sharePub, final: shareFinal, finalStrict: pct(r.cc.strictAgree, r.cc.tickets) },
      verdictsAsPublished: r.cc.asPublished, verdictsFinal: r.cc.final,
      reading: 'Daytime residential routes agree (most 80 to 92%). The night routes on main streets (10 to 14) and the weekend routes (W2 to W6) do not: blocks with odd and even reversed, other hours, and weekend sweeps that tickets now show on Thursday and Friday. About 6% of tickets land on sides the layer marks as not swept, mostly downtown and night streets.',
      routes, contradictingRoutes: routes.filter((x) => x.tickets >= 300 && x.agree < 70).map((x) => x.route),
      swapped: { blocks: r.swaps.length, applied: !AS_PUBLISHED, rule: 'odd numbered tickets in the even side\'s windows AND even numbered tickets in the odd side\'s (each at least 3, three times those in their own window, and 40% of that side\'s tickets); a major street\'s two lines together', byRoute: byRoute(r.swaps.map((x) => ({ route: String(x.pair[0].route ?? '').trim() }))), list: r.swaps.map(swapRow) },
      oneSidedReversal: { blocks: r.oneSided.length, note: 'one parity\'s tickets fall in the other side\'s window, the other parity\'s do not show it: not changed (a block with houses on one side gives every ticket that side\'s number)', byRoute: byRoute(r.oneSided.map((x) => ({ route: String(x.pair[0].route ?? '').trim() }))), top: r.oneSided.sort((a, b) => (b.ev.odd.other + b.ev.even.other) - (a.ev.odd.other + a.ev.even.other)).slice(0, 40).map(swapRow) },
      contradictedSides: { sides: r.contradicted.length, note: `${hidden ? 'left off the map' : 'kept as the City publishes them'}: sides with 8 or more tickets outside any window of the data, and under a quarter of their tickets in their own window. mostlyAt = when those tickets fall (weekday, hour).`, byRoute: byRoute(r.contradicted), list: r.contradicted.slice(0, 150) },
      ticketedButNotSwept: { sides: r.notSweptTicketed.length, note: 'sides the layer marks as not swept with 10 or more tickets: not on the map (no schedule to show)', top: r.notSweptTicketed.slice(0, 40) },
    },
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({ _meta: segMeta, b: blocks }));
  report.counts.segmentsKB = Math.round(fs.statSync(OUT + 'segments.json').size / 1024);
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1) + '\n');
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');
  log(`${blocks.length} blocks, ${r.sides} sides, ${r.rules} rules (${hidden} contradicted sides left off); tickets agree ${sharePub}% as published, ${shareFinal}% ${AS_PUBLISHED ? `as written (${r.swaps.length} swaps found, not applied)` : `after ${r.swaps.length} swaps`} (${report.crossCheck.share.finalStrict}% with no grace)`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/oakland/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) write(await build());
