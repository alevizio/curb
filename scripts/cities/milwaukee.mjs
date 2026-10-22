#!/usr/bin/env node
// Milwaukee, Wisconsin for CURB (built 2026-10-18, by docs/multi-city/city-build.md). Writes data/milwaukee/ from the City of
// Milwaukee's public map services (open to scripts; the City's web pages sit behind a bot check, so the rule's words were
// read in a browser and are quoted in docs/multi-city/milwaukee.md):
//
//   1. Centerline - City Streets (milwaukeemaps.milwaukee.gov, reference/CenterlinDatasets/MapServer/1): 17,649 street
//      segments in the City with names and left and right address ranges. One block per official segment.
//   2. The City's Exception Streets map (the map on its Parking Regulations page, ArcGIS Online web map
//      6695832372454e918e0bb871959e85c9), two layers drawn on or near the centerlines:
//      TwoSidedParking: streets exempt from alternate side parking, "Level 2" (green on the map: both sides every night)
//      and "Level 1" (blue: both sides March to November, alternate side December 1 to March 1);
//      noNightParkingD1M1 (red: through highways and bus routes, no night parking on either side December 1 to March 1).
//      A centerline takes the class of the lines that run along at least half of it.
//   3. Neighborhoods (AGO/neighborhoods/MapServer/0) and the City boundary (the map's Milwaukee_City_Boundary layer).
//   4. Checks only, for report.json: the City's address points in a few areas (parcels_mprop/MapServer/22: house number and
//      street, no owner data) for the odd and even sides, and DPW's listing of winter regulations that are not posted
//      (mpw.milwaukee.gov/services/winterregs) against the map's classes.
//
// The rule (MCO 101-27): no parking on any street 2 to 6 AM without a night parking permit, and a car parked with one "shall
// be parked only on the even numbered side of the street on those nights bearing an even calendar date during the portion
// thereof before midnight, and on the odd numbered side ... odd calendar date". It runs all year on most streets; Sunday
// mornings and the mornings of and after seven holidays are free (101-27-7-a). This build writes the 2026-27 winter season,
// December 1 to March 1, as CURB's winter rule (rules flagged 4 on two date lists, like Madison), and the season's night ban on
// through highways and bus routes (101-27-8) as a plain rule on listed dates.
//
// Run: node scripts/cities/milwaukee.mjs [--refresh]   (Node 18+; inputs cached in private/cache/milwaukee/)

import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/milwaukee/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/milwaukee/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[milwaukee]', ...a);

const MAPS = 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/';
const AGOL = 'https://services1.arcgis.com/5ly0cVV70qsN8Soc/arcgis/rest/services/';
export const CENTERLINE_URL = MAPS + 'reference/CenterlinDatasets/MapServer/1';
export const EXCEPTIONS_URL = AGOL + 'TwoSidedParking/FeatureServer/0';
export const NO_NIGHT_URL = AGOL + 'noNightParkingD1M1/FeatureServer/0';
export const BOUNDARY_URL = AGOL + 'Milwaukee_City_Boundary/FeatureServer/0';
export const HOODS_URL = MAPS + 'AGO/neighborhoods/MapServer/0';
export const ADDRESS_URL = MAPS + 'property/parcels_mprop/MapServer/22';
export const LISTING_URL = 'https://mpw.milwaukee.gov/services/winterregs';
export const EXCEPTION_MAP = 'https://www.arcgis.com/home/item.html?id=6695832372454e918e0bb871959e85c9';
export const RULES_PAGE = 'https://city.milwaukee.gov/Parking/ParkingRegulations';
export const ORDINANCE = 'https://city.milwaukee.gov/ImageLibrary/Groups/ccClerk/Ordinances/Volume-1/CH101.pdf';

// ---------- facts (checked 2026-10-18; sources in city.json and docs/multi-city/milwaukee.md) ----------------------------

// Most streets alternate "throughout the year" (Parking Regulations page), 2 to 6 AM, for cars with a night permit, so the
// nights are listed for a year (YEAR: the mornings the data covers; rebuild before it runs out). Winter, "Dec 1- March 1":
// the exception streets in blue alternate only then, and through highways and bus routes (red) have "No overnight parking on
// either side of the street 2:00 a.m. - 6:00 a.m. from December 1 to March 1". The window's date is the morning's
// (lib/city.js); which side is closed that morning comes from the evening before (the date "before midnight":
// city.json winter.night = 'evening'). DPW Open Records, 2026-10-22: the winter restriction "begins at 8:00 p.m. on
// December 1 and remains in effect through March 1, inclusive" (101-27-8: "After 8 p.m. as of December 1 to March 1
// inclusive"), so its first morning is December 2 and its last March 1.
export const YEAR = { from: '2026-10-01', to: '2027-10-31' };
export const WINTER = { from: '2026-12-02', to: '2027-03-01' };
export const HOURS = { start: 2, end: 6 };
// Flags: 1 = runs on holidays, 2 = towable, 4 = a side-switching rule shown as tonight's side (lib/city.js; Milwaukee's
// switch, data/milwaukee/winter.json, is on: the ordinance applies every night), 8 = both sides closed (the winter ban).
// Towing: MCO 101-25-1-a lets the City tow any car parked against 101-27. The alternate rule doesn't run on Sunday mornings
// or the holiday mornings (101-27-7-a), left out of its lists, so it carries no flag 1. The winter ban keeps those mornings:
// the City's page states it with no exception, the cautious reading (a question for the City).
const ALTERNATE_FLAGS = 6;
const BAN_FLAGS = 14;

export const CITY = { id: 'milwaukee', name: 'Milwaukee', region: 'Wisconsin', tz: 'America/Chicago',
  center: [42.99, -87.895], zoom: 14 };   // Bay View: alternate side blocks, with Kinnickinnic Ave and Howell Ave under the winter ban
// MCO 101-27-7-a: night parking rules are not "effective and in force" on "the morning of, and the morning following" New
// Year's Day, Martin Luther King Jr. Day, Memorial Day, Independence Day, Labor Day, Thanksgiving Day and Christmas Day (and
// on every Sunday morning). The dates are the mornings, as the windows' dates are.
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-02': "New Year's Day, the morning after",
  '2026-01-19': 'Martin Luther King Jr. Day', '2026-01-20': 'Martin Luther King Jr. Day, the morning after',
  '2026-05-25': 'Memorial Day', '2026-05-26': 'Memorial Day, the morning after',
  '2026-07-04': 'Independence Day', '2026-07-05': 'Independence Day, the morning after',
  '2026-09-07': 'Labor Day', '2026-09-08': 'Labor Day, the morning after',
  '2026-11-26': 'Thanksgiving Day', '2026-11-27': 'Thanksgiving Day, the morning after',
  '2026-12-25': 'Christmas Day', '2026-12-26': 'Christmas Day, the morning after',
  '2027-01-01': "New Year's Day", '2027-01-02': "New Year's Day, the morning after",
  '2027-01-18': 'Martin Luther King Jr. Day', '2027-01-19': 'Martin Luther King Jr. Day, the morning after',
  '2027-05-31': 'Memorial Day', '2027-06-01': 'Memorial Day, the morning after',
  '2027-07-04': 'Independence Day', '2027-07-05': 'Independence Day, the morning after',
  '2027-09-06': 'Labor Day', '2027-09-07': 'Labor Day, the morning after',
  '2027-11-25': 'Thanksgiving Day', '2027-11-26': 'Thanksgiving Day, the morning after',
  '2027-12-25': 'Christmas Day', '2027-12-26': 'Christmas Day, the morning after',
};
const CITY_LATE = {
  holidaysSource: RULES_PAGE,
  holidayRule: 'all',
  fine: '$30', tow: 'sometimes', fineSource: 'https://city.milwaukee.gov/Parking/ParkingCitations/Citation-Types',
  agency: 'City of Milwaukee Department of Public Works, Parking Services',
  scheduleUrl: RULES_PAGE,
  words: {
    what: 'night parking',   // the page's title and descriptions (scripts/cities/city-page.mjs): not a sweeping map
    rule: 'Night parking needs a City permit. With one, park on the side with even house numbers on nights with an even date (the date before midnight) and on the odd side on odd dates, 2 to 6 AM. Most streets alternate all year; from December 1 to March 1 through highways and bus routes have no night parking on either side.',
    afterpass: 'Wrong side: a $30 ticket ($25 with no night permit, $35 on a through highway or bus route in winter). Sunday mornings and the mornings of and after seven holidays are free. In a declared snow emergency the hours are 10 PM to 6 AM, tickets are $50 to $150, and cars can be towed.',
    dataNotes: 'Nights are listed from October 2026 to October 2027. Odd and even sides come from the address ranges on the City\'s street centerlines. Streets on the City\'s Exception Streets map that allow both sides every night are left off; its blue streets alternate only December 1 to March 1, and its through highways and bus routes show no night parking on either side then, and the standard rule the rest of the year. Posted signs, including streets signed for one side, are not in this data and always come first.',
  },
};

// ---------- decoding ---------------------------------------------------------------------------------------------------

// "W FOND DU LAC AV" → "W Fond du Lac Ave", "N 27TH ST" → "N 27th St", "W MC KINLEY AV" → "W McKinley Ave"
const TYPES = { ST: 'St', AV: 'Ave', DR: 'Dr', PL: 'Pl', RD: 'Rd', BL: 'Blvd', CT: 'Ct', LA: 'Ln', PK: 'Pkwy', WA: 'Way',
  TR: 'Ter', CR: 'Cir', SQ: 'Sq', SV: 'Service Dr', HY: 'Hwy' };
const KEEP_UP = new Set(['II', 'III', 'IV', 'N', 'S', 'E', 'W', 'US', 'UW']);
const word = (w) => (KEEP_UP.has(w) ? w : /^\d+(ST|ND|RD|TH)$/.test(w) ? w.toLowerCase()
  : w === 'DU' ? 'du' : w.charAt(0) + w.slice(1).toLowerCase());
export function streetName(a) {
  const name = String(a.StreetName || '').replace(/\s+/g, ' ').trim().replace(/\bMC (\w)/g, 'MC$1');
  const words = name.split(' ').filter(Boolean).map(word).map((w) => w.replace(/^Mc(\w)/, (m, c) => 'Mc' + c.toUpperCase()));
  const dir = String(a.StreetDirection || '').trim(), type = String(a.StreetType || '').trim();
  return [dir, ...words, TYPES[type] || (type ? word(type) : '')].filter(Boolean).join(' ');
}
// The City's label for matching ("S 1ST PL"), spaces squeezed
const labelOf = (a) => String(a.Label || [a.StreetDirection, a.StreetName, a.StreetType].join(' ')).replace(/\s+/g, ' ').trim().toUpperCase();

const parity = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n % 2 : null; };
// The side with odd house numbers from the left and right ranges; a street numbered on one side only (along a park) still
// has an odd and an even side: the other one is the other parity.
export function oddSide(a) {
  const l = parity(a.FromLeftAddress) ?? parity(a.ToLeftAddress), r = parity(a.FromRightAddress) ?? parity(a.ToRightAddress);
  if (l === 1 && r !== 1) return 'L';
  if (r === 1 && l !== 1) return 'R';
  if (l === 0 && r === null) return 'R';
  if (r === 0 && l === null) return 'L';
  return null;
}

const DAY = 864e5;
const isoAt = (t) => new Date(t).toISOString().slice(0, 10);
// The mornings with a rule, split by the date of the evening before: `odd` = the mornings after an odd date, when cars park
// on the odd side and the even side is closed 2 to 6 AM; `even` the other way. Sunday mornings and the holiday mornings have
// none. Dec 31 and Jan 1 are both odd: the side follows the evening. The lists, all named for the side cars park on:
//   odd, even     the year (YEAR): the standard rule
//   wodd, weven   winter only (WINTER): the blue exception streets
//   sodd, seven   the year but winter: through highways and bus routes, outside their winter ban
//   ban           every winter morning, Sundays and holidays too: the through highway and bus route ban, both sides
export function nightLists(holidays = HOLIDAYS) {
  const L = { odd: [], even: [], wodd: [], weven: [], sodd: [], seven: [], ban: [] };
  for (let t = Date.parse(YEAR.from + 'T12:00:00Z'); t <= Date.parse(YEAR.to + 'T12:00:00Z'); t += DAY) {
    const iso = isoAt(t), winter = iso >= WINTER.from && iso <= WINTER.to;
    if (winter) L.ban.push(iso);
    if (new Date(t).getUTCDay() === 0 || holidays[iso]) continue;
    const p = +isoAt(t - DAY).slice(8, 10) % 2 ? 'odd' : 'even';
    L[p].push(iso);
    L[(winter ? 'w' : 's') + p].push(iso);
  }
  return L;
}
// A side's rule on one of the lists: the odd side is closed on the mornings after an even date (cars park on the even side)
export const alternateRule = (list) => [-1, HOURS.start, HOURS.end, 0, 0, ALTERNATE_FLAGS, list];
export const banRule = () => [-1, HOURS.start, HOURS.end, 0, 0, BAN_FLAGS, 'ban'];

// A centerline's class from how much of it each of the map's layers runs along (0 to 1): the winter ban on through highways
// and bus routes first ("If a street is also red, follow red instructions December 1 to March 1"), then the streets with both
// sides every night, then the ones that alternate only in winter, else the standard rule.
export const COVER = 0.5;
export function classify({ red = 0, green = 0, blue = 0 }) {
  if (red >= COVER) return 'ban';
  if (green >= COVER) return 'both sides';
  if (blue >= COVER) return 'winter alternate';
  return 'alternate';
}

// DPW's listing of winter regulations that are not posted: rows of "100 - 745 | S 1ST ST | No Winter Parking/48 Hour Exception"
export function parseListing(html) {
  const rows = [];
  for (const tr of String(html).match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const cells = (tr.match(/<td[\s\S]*?<\/td>/g) || []).map((c) => c.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
    if (cells.length !== 3) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(cells[0]);
    if (m) rows.push({ lo: +m[1], hi: +m[2], street: cells[1].toUpperCase(), type: cells[2] });
  }
  return rows;
}
// What each listing type means on the map, in winter (the types' own pages: mpw.milwaukee.gov/park_info.htm)
export const LISTING_CLASS = { '48 Hour Exception': 'both sides', 'No Winter Night Parking': 'ban',
  'No Winter Parking/48 Hour Exception': 'ban', 'Non Winter Exception to Alternate Side Night Parking': 'winter alternate',
  'Special Case': 'ban' };   // "From December 1 to March 1 no overnight parking is allowed"

// ---------- geometry ----------------------------------------------------------------------------------------------------

const LAT0 = 43.04, LON0 = -87.95, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
const lengthOf = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
// Points every `step` meters along a line (in meters), ends trimmed, each with the line's direction there.
export function samples(pts, step = 5, trim = 4) {
  const total = lengthOf(pts), out = [];
  if (total < 2 * trim + 2) trim = total / 4;
  let i = 1, done = 0;
  for (let s = trim; s <= total - trim + 1e-9; s += step) {
    while (i < pts.length - 1 && done + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < s) { done += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); i++; }
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], len = Math.hypot(x2 - x1, y2 - y1) || 1, t = Math.min(1, (s - done) / len);
    out.push({ p: [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t], d: [(x2 - x1) / len, (y2 - y1) / len] });
  }
  return out;
}
// A grid of line pieces, to find the pieces near a point
function pieceGrid(lines, margin, CELL = 50) {
  const cell = (v) => Math.floor(v / CELL), grid = new Map();
  lines.forEach((pts, li) => {
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      for (let cx = cell(Math.min(x1, x2) - margin); cx <= cell(Math.max(x1, x2) + margin); cx++)
        for (let cy = cell(Math.min(y1, y2) - margin); cy <= cell(Math.max(y1, y2) + margin); cy++) {
          const k = cx + ',' + cy;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([x1, y1, x2, y2, li]);
        }
    }
  });
  return (p) => grid.get(cell(p[0]) + ',' + cell(p[1])) || [];
}
// The nearest piece within `max` meters of p (parallel to d within about 30 degrees, when d is given): { li, dist, side }
function nearest(near, p, max, d) {
  let best = null;
  for (const [x1, y1, x2, y2, li] of near(p)) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    if (!l2) continue;
    if (d && Math.abs((dx * d[0] + dy * d[1]) / Math.sqrt(l2)) < 0.87) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2)), dist = Math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy);
    if (dist <= max && (!best || dist < best.dist)) best = { li, dist, side: dx * (p[1] - y1) - dy * (p[0] - x1) > 0 ? 'L' : 'R' };
  }
  return best;
}
// point in polygon (rings in [x, y]), even-odd
export function inRings(rings, [x, y]) {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function ringDistance(rings, p) {
  let best = Infinity;
  for (const ring of rings) for (let i = 1; i < ring.length; i++) {
    const [x1, y1] = ring[i - 1], [x2, y2] = ring[i], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy));
  }
  return best;
}
// Halfway along a line (in meters) and the line's direction there
function middle(pts) {
  const half = lengthOf(pts) / 2;
  let done = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], len = Math.hypot(x2 - x1, y2 - y1);
    if (len && done + len >= half) { const t = (half - done) / len; return { p: [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t], d: [(x2 - x1) / len, (y2 - y1) / len] }; }
    done += len;
  }
  return { p: pts[pts.length - 1], d: [1, 0] };
}

// ---------- fetching ----------------------------------------------------------------------------------------------------

const UA = 'curb-city-build (+https://curb.guide)';
async function post(url, params, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams(params), headers: { Accept: 'application/json', 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const j = await r.json();
      if (j.error) throw new Error(`${url}: ${JSON.stringify(j.error)}`);
      return j;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 2500 * i));
    }
  }
}
async function features(url, oid, outFields, extra = {}) {
  const out = [];
  for (let off = 0; ; ) {
    const j = await post(url + '/query', { where: '1=1', outFields, returnGeometry: 'true', outSR: '4326', orderByFields: oid,
      resultOffset: off, resultRecordCount: 1000, f: 'json', ...extra });
    const page = j.features || [];
    out.push(...page);
    if (!page.length || (page.length < 1000 && !j.exceededTransferLimit)) return out;
    off += page.length;
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
function expectFields(list, fields, what) {
  const a = list[0] && list[0].attributes;
  const missing = fields.filter((k) => !a || !(k in a));
  if (missing.length) throw new Error(`${what}: the City's data changed shape, missing ${missing.join(', ')}`);
}
// Address points for the parity check: boxes of about 650 by 670 m, in neighborhoods all over the City
const CHECK_BOXES = [[-87.985, 42.995], [-87.900, 42.985], [-87.965, 43.075], [-88.020, 43.150], [-87.935, 42.945],
  [-87.990, 43.035], [-87.940, 43.105], [-88.030, 43.090]];

// ---------- the build ---------------------------------------------------------------------------------------------------

async function build() {
  const LINE_FIELDS = 'OBJECTID,FromLeftAddress,FromRightAddress,ToLeftAddress,ToRightAddress,StreetDirection,StreetName,StreetType,SegmentType,Label';
  const lines = await cached('centerlines.json', () => { log('fetching City street centerlines…'); return features(CENTERLINE_URL, 'OBJECTID', LINE_FIELDS); });
  // the CAD fields Entity, Color, Linetype, Q1, Q2 are not read; created/edited user fields are never requested
  const exceptions = await cached('exception-streets.json', () => { log('fetching the exception streets…'); return features(EXCEPTIONS_URL, 'FID', 'FID,Layer,RefName,Questionable'); });
  const noNight = await cached('no-night-parking.json', () => { log('fetching the winter night parking ban…'); return features(NO_NIGHT_URL, 'FID', 'FID,Street,Start,End'); });
  const boundary = await cached('city-boundary.json', () => { log('fetching the City boundary…'); return features(BOUNDARY_URL, 'FID', 'FID'); });
  const hoods = await cached('neighborhoods.json', () => { log('fetching neighborhoods…'); return features(HOODS_URL, 'OBJECTID', 'OBJECTID,NEIGHBORHD'); });
  const points = await cached('address-points-sample.json', async () => {
    log('fetching address points for the parity check…');
    const all = [];
    for (const [lon, lat] of CHECK_BOXES) {
      const env = { xmin: lon - 0.004, ymin: lat - 0.003, xmax: lon + 0.004, ymax: lat + 0.003, spatialReference: { wkid: 4326 } };
      all.push(...await features(ADDRESS_URL, 'ID', 'ID,HouseNumber,Direction,StreetName,StreetType',
        { geometry: JSON.stringify(env), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }));
    }
    return all;
  });
  const listingHtml = await cached('winter-listing.json', async () => {
    log('fetching DPW\'s winter regulations listing…');
    const r = await fetch(LISTING_URL, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${LISTING_URL}`);
    return r.text();
  });
  expectFields(lines, LINE_FIELDS.split(','), 'Centerline - City Streets');
  expectFields(exceptions, ['Layer', 'RefName'], 'TwoSidedParking');
  expectFields(noNight, ['Street', 'Start', 'End'], 'noNightParkingD1M1');
  if (lines.length < 15000) throw new Error(`${lines.length} centerlines: expected over 15,000`);
  const green = exceptions.filter((f) => f.attributes.Layer === 'Level 2'), blue = exceptions.filter((f) => f.attributes.Layer === 'Level 1');
  if (green.length < 1000 || blue.length < 10 || noNight.length < 1000) throw new Error(`the Exception Streets map changed shape: ${green.length} Level 2, ${blue.length} Level 1, ${noNight.length} no night parking lines`);
  const listing = parseListing(listingHtml);
  log(`${lines.length} centerlines; exception streets ${green.length} both sides, ${blue.length} winter only (${exceptions.length - green.length - blue.length} other lines not on the map); ${noNight.length} no night parking lines; ${listing.length} listing rows`);

  // the City, in meters
  const cityRings = boundary.flatMap((f) => (f.geometry && f.geometry.rings) || []).map((r) => r.map(xy));
  if (!cityRings.length) throw new Error('no City boundary');

  // centerlines: one block per official segment in the City, keyed by OBJECTID (the only segment id the City publishes;
  // the same in the map service and the nightly open data shapefile)
  const report = { centerlines: lines.length, leftOut: {}, examples: {} };
  const out1 = (why, a) => { report.leftOut[why] = (report.leftOut[why] || 0) + 1; const e = (report.examples[why] ||= []); if (e.length < 5) e.push(a.OBJECTID); };
  const segs = [];
  for (const f of lines) {
    const a = f.attributes, path = f.geometry && f.geometry.paths && f.geometry.paths.length === 1 ? f.geometry.paths[0] : null;
    if (!path || path.length < 2) { out1('no single line', a); continue; }
    if (a.SegmentType !== 'OFFICIAL') { out1(`not an official City street (${String(a.SegmentType || 'none').toLowerCase()})`, a); continue; }
    const c = path.map((p) => [p[0], p[1]]), pts = c.map(xy);
    segs.push({ a, c, pts, label: labelOf(a) });
  }
  const ids = new Set();
  for (const s of segs) { if (ids.has(s.a.OBJECTID)) throw new Error(`OBJECTID ${s.a.OBJECTID} repeats`); ids.add(s.a.OBJECTID); }

  // which sides are the City's: where the City line runs down the street (within 4 m of its midpoint), only the curb inside
  // the City (5 m off the centerline); any other street is the City's when its midpoint is
  const inCity = [];
  let boundarySides = 0;
  for (const s of segs) {
    const { p, d } = middle(s.pts);
    s.sides = ['L', 'R'];
    if (ringDistance(cityRings, p) <= 4) {
      const curb = (sd) => [p[0] + (sd === 'L' ? -d[1] : d[1]) * 5, p[1] + (sd === 'L' ? d[0] : -d[0]) * 5];
      s.sides = s.sides.filter((sd) => inRings(cityRings, curb(sd)));
      if (s.sides.length === 1) boundarySides++;
    } else if (!inRings(cityRings, p)) s.sides = [];
    if (!s.sides.length) { out1('outside the City', s.a); continue; }
    inCity.push(s);
  }

  // the map's classes: how much of each centerline the green, blue and red lines run along (parallel, within 10 m for the
  // exception lines, which are drawn on the centerlines, and 15 m for the red ones, drawn up to 10 m off)
  const toPts = (f) => (f.geometry && f.geometry.paths ? f.geometry.paths.map((p) => p.map(xy)) : []);
  const layers = { green: [green.flatMap(toPts), 10], blue: [blue.flatMap(toPts), 10], red: [noNight.flatMap(toPts), 15] };
  const grids = Object.fromEntries(Object.entries(layers).map(([k, [ls, tol]]) => [k, { near: pieceGrid(ls, tol), tol }]));
  const classes = {}, partial = [];
  let partialCount = 0;
  for (const s of inCity) {
    const smp = samples(s.pts), cov = {};
    for (const [k, { near, tol }] of Object.entries(grids)) cov[k] = smp.length ? smp.filter(({ p, d }) => nearest(near, p, tol, d)).length / smp.length : 0;
    s.cls = classify(cov);
    classes[s.cls] = (classes[s.cls] || 0) + 1;
    const top = Math.max(cov.red, cov.green, cov.blue);
    if (top < 0.2 || top >= 0.8) continue;
    partialCount++;
    if (partial.length < 25) partial.push({ id: s.a.OBJECTID, street: s.label, class: s.cls, cover: Object.fromEntries(Object.entries(cov).map(([k, v]) => [k, Math.round(v * 100) / 100])) });
  }

  // the rules
  const lists = nightLists();
  const winter = { segments: 0, sides: 0, ban: { segments: 0, sides: 0, noRangesSides: 0 }, winterOnlyStreets: 0 };
  for (const s of inCity) {
    s.rules = new Map();
    if (s.cls === 'both sides') { out1('both sides every night (Exception Streets map, Level 2)', s.a); continue; }
    const o = oddSide(s.a), park = (sd) => (sd === o ? 'even' : 'odd');   // the list a side is closed on: the other side's
    if (s.cls === 'ban') {
      // no night parking on either side in winter; the standard rule the rest of the year, where the sides are known
      for (const sd of s.sides) s.rules.set(sd, o ? [banRule(), alternateRule('s' + park(sd))] : [banRule()]);
      winter.ban.segments++; winter.ban.sides += s.sides.length;
      if (!o) winter.ban.noRangesSides += s.sides.length;
      continue;
    }
    if (!o) { out1('no odd and even address ranges', s.a); continue; }
    const pre = s.cls === 'winter alternate' ? 'w' : '';
    for (const sd of s.sides) s.rules.set(sd, [alternateRule(pre + park(sd))]);
    winter.segments++; winter.sides += s.sides.length;
    if (pre) winter.winterOnlyStreets++;
  }

  // cross streets: at each end, the other street that meets it there (most nearly at a right angle, within 3 m, else 10 m).
  // Where the City splits a street mid-block, the end meets only the same street: follow it to the next corner (up to 4
  // segments and 400 m), so the block reads by its corners
  const ends = new Map(), key = ([x, y]) => Math.round(x / 10) + ',' + Math.round(y / 10);
  const allSegs = lines.filter((f) => f.geometry && f.geometry.paths && f.geometry.paths[0] && f.geometry.paths[0].length > 1)
    .map((f) => { const pts = f.geometry.paths[0].map(xy); return { a: f.attributes, label: labelOf(f.attributes), pts, len: lengthOf(pts) }; });
  const endOf = (s, atStart) => (atStart ? s.pts[0] : s.pts[s.pts.length - 1]);
  const dirAt = (pts, atStart) => { const [p, q] = atStart ? [pts[0], pts[1]] : [pts[pts.length - 1], pts[pts.length - 2]]; const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [(q[0] - p[0]) / L, (q[1] - p[1]) / L]; };
  for (const s of allSegs) for (const atStart of [true, false]) {
    const k = key(endOf(s, atStart));
    if (!ends.has(k)) ends.set(k, []);
    ends.get(k).push({ s, atStart, p: endOf(s, atStart), d: dirAt(s.pts, atStart) });
  }
  const meeting = (p, max) => { const [kx, ky] = key(p).split(',').map(Number), out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const e of ends.get((kx + dx) + ',' + (ky + dy)) || []) if (Math.hypot(e.p[0] - p[0], e.p[1] - p[1]) <= max) out.push(e);
    return out; };
  function crossAt(s0, atStart0) {
    let s = s0, atStart = atStart0, walked = 0;
    for (let hop = 0; hop < 5; hop++) {
      const p = endOf(s, atStart), d = dirAt(s.pts, atStart);
      for (const max of [3, 10]) {
        let best = null;
        for (const e of meeting(p, max)) {
          if (e.s.label === s.label) continue;
          const turn = 1 - Math.abs(d[0] * e.d[0] + d[1] * e.d[1]);
          if (!best || turn > best.turn) best = { turn, name: streetName(e.s.a) };
        }
        if (best) return best.name;
      }
      const next = meeting(p, 3).find((e) => e.s.a.OBJECTID !== s.a.OBJECTID && e.s.a.OBJECTID !== s0.a.OBJECTID && e.s.label === s.label);
      if (!next || (walked += next.s.len) > 400) return '';
      s = next.s; atStart = !next.atStart;   // on to that segment's far end
    }
    return '';
  }

  // neighborhoods: the smallest one around the block's midpoint
  const titled = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/(^|[\s(/-])(\w)/g, (m, b, c) => b + c.toUpperCase());
  const hoodPolys = hoods.filter((h) => h.geometry && h.geometry.rings && h.attributes.NEIGHBORHD)
    .map((h) => { const rings = h.geometry.rings.map((r) => r.map(xy)); return { name: titled(h.attributes.NEIGHBORHD), rings,
      area: Math.abs(rings[0].reduce((sum, p, i, r) => sum + (i ? (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : 0), 0)) }; })
    .sort((x, y) => x.area - y.area);
  const hoodAt = (pts) => { const { p } = middle(pts); const h = hoodPolys.find((q) => inRings(q.rings, p)); return h ? h.name : ''; };

  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const blocks = [];
  for (const s of inCity) {
    if (!s.rules.size) continue;
    const a = s.a;
    const nums = ['FromLeftAddress', 'ToLeftAddress', 'FromRightAddress', 'ToRightAddress'].map((k) => Math.round(a[k])).filter((v) => v > 0);
    const o = oddSide(a), cross = [crossAt(s, true), crossAt(s, false)].filter(Boolean);
    blocks.push({ c: String(a.OBJECTID), s: streetName(a), l: [...new Set(cross)].join(' - '), h: hoodAt(s.pts),
      ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}), ...(o ? { o } : {}),
      g: s.c.map(([lo, la]) => [r6(lo), r6(la)]),
      d: ['L', 'R'].filter((sd) => s.rules.has(sd)).map((sd) => [sd, compass(s.c, sd), s.rules.get(sd)]) });
  }
  blocks.sort((x, y) => x.s.localeCompare(y.s, 'en', { numeric: true }) || (x.n ? x.n[0] : 0) - (y.n ? y.n[0] : 0) || x.c.localeCompare(y.c));

  // ---------- checks ----------------------------------------------------------------------------------------------------
  // 1. odd and even sides: an address point should lie on the side its number's parity says, along the nearest block of its
  //    street (within 60 m)
  const byLabel = new Map();
  inCity.forEach((s, i) => { if (!byLabel.has(s.label)) byLabel.set(s.label, []); byLabel.get(s.label).push(i); });
  const parityCheck = { points: points.length, used: 0, agree: 0, disagree: 0, examples: [] };
  const segNear = pieceGrid(inCity.map((s) => s.pts), 60);
  for (const f of points) {
    const a = f.attributes, n = Math.round(a.HouseNumber);
    if (!f.geometry || !(n > 0)) continue;
    const label = [a.Direction, a.StreetName, a.StreetType].map((v) => String(v || '').trim()).filter(Boolean).join(' ').toUpperCase();
    const cand = new Set(byLabel.get(label) || []);
    if (!cand.size) continue;
    const p = xy([f.geometry.x, f.geometry.y]);
    let best = null;
    for (const [x1, y1, x2, y2, li] of segNear(p)) {
      if (!cand.has(li)) continue;
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const t = ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2;
      if (t < 0 || t > 1) continue;   // beside the piece, not past its end
      const dist = Math.abs(dx * (p[1] - y1) - dy * (p[0] - x1)) / Math.sqrt(l2);
      if (dist <= 60 && (!best || dist < best.dist)) best = { li, dist, side: dx * (p[1] - y1) - dy * (p[0] - x1) > 0 ? 'L' : 'R' };
    }
    if (!best) continue;
    const o = oddSide(inCity[best.li].a);
    if (!o) continue;
    parityCheck.used++;
    const want = n % 2 ? o : o === 'L' ? 'R' : 'L';
    if (want === best.side) parityCheck.agree++;
    else { parityCheck.disagree++; if (parityCheck.examples.length < 10) parityCheck.examples.push({ segment: inCity[best.li].a.OBJECTID, street: label, number: n % 2 ? 'odd' : 'even' }); }
  }
  parityCheck.share = parityCheck.used ? Math.round(1000 * parityCheck.agree / parityCheck.used) / 10 : null;

  // 2. DPW's listing against the map: the listed blocks of each type (by street and overlapping house numbers), and the class
  //    the map gives them
  const listingCheck = {};
  for (const row of listing) {
    const want = LISTING_CLASS[row.type] || null;
    const t = (listingCheck[row.type] ||= { rows: 0, segments: 0, sameClass: 0, classes: {} });
    t.rows++;
    for (const i of byLabel.get(row.street.replace(/\s+/g, ' ')) || []) {
      const s = inCity[i];
      const nums = ['FromLeftAddress', 'ToLeftAddress', 'FromRightAddress', 'ToRightAddress'].map((k) => Math.round(s.a[k])).filter((v) => v > 0);
      if (!nums.length || Math.max(...nums) < row.lo || Math.min(...nums) > row.hi) continue;
      t.segments++;
      t.classes[s.cls] = (t.classes[s.cls] || 0) + 1;
      if (want && s.cls === want) t.sameClass++;
    }
  }
  for (const t of Object.values(listingCheck)) t.share = t.segments ? Math.round(1000 * t.sameClass / t.segments) / 10 : null;

  // ---------- write -----------------------------------------------------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: 'Centerline - City Streets (City of Milwaukee ITMD)', url: 'https://data.milwaukee.gov/dataset/streets', api: CENTERLINE_URL, license: 'Creative Commons Attribution', fetched: today },
    { name: 'Exception Streets map: TwoSidedParking and noNightParkingD1M1 (DPW)', url: EXCEPTION_MAP, api: EXCEPTIONS_URL + ' ; ' + NO_NIGHT_URL, license: 'public City map (no license stated)', fetched: today },
    { name: 'Neighborhoods (City of Milwaukee)', url: 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/AGO/neighborhoods/MapServer', api: HOODS_URL, license: 'public City map service', fetched: today },
    { name: 'Parking Regulations (night parking, alternate side, winter)', url: RULES_PAGE, license: 'facts', fetched: today },
    { name: 'Milwaukee Code of Ordinances, ch. 101 (101-26, 101-27)', url: ORDINANCE, license: 'facts', fetched: today },
  ];
  const sideCount = blocks.reduce((n, b) => n + b.d.length, 0);
  fs.mkdirSync(OUT, { recursive: true });
  const body = JSON.stringify({
    _meta: { city: 'milwaukee', time_zone: 'America/Chicago', generated: new Date().toISOString(), winter: true, sources, blocks: blocks.length, sides: sideCount,
      format: 'b[] = {c: City centerline OBJECTID, s: street, l: cross streets, h: neighborhood, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
        + 'rule = [-1, 2, 6, 0, 0, 6, list] for alternate side night parking, or [-1, 2, 6, 0, 0, 14, "ban"] for the winter ban on both sides (no parking 2 to 6 AM on the mornings of that list in `dates`; '
        + 'the list is named for the side cars park on that night, from the date of the evening before, so the odd side carries "even"), '
        + 'or [-1, 2, 6, 0, 0, 2, "all"] for the winter night ban on through highways and bus routes (both sides); '
        + 'flags 2 = towable, 4 = a side-switching rule shown as tonight\'s side (data/milwaukee/winter.json), 8 = both sides closed; '
        + 'lists are named for the side cars park on that night: odd/even all year, wodd/weven winter only, sodd/seven all year but winter, ban every winter morning' },
    dates: lists,
    b: blocks });
  fs.writeFileSync(OUT + 'segments.json', body);
  const gz = zlib.gzipSync(body).length;
  const rep = {
    generated: new Date().toISOString(),
    centerlines: { fetched: report.centerlines, official: segs.length, inTheCity: inCity.length, boundaryStreetsOneSide: boundarySides },
    exceptionStreetsMap: { level2BothSides: green.length, level1WinterOnly: blue.length, otherLinesNotOnTheMap: exceptions.length - green.length - blue.length,
      questionable: exceptions.filter((f) => f.attributes.Questionable === 'Y').length, noNightParking: noNight.length,
      classes, coverRule: `a centerline takes a class when that layer runs along ${COVER * 100}% of it (red first, then green, then blue)`,
      partial: { count: partialCount, examples: partial } },
    winter: { year: `${YEAR.from} to ${YEAR.to} (mornings), ${HOURS.start} to ${HOURS.end} AM, except Sunday mornings and the holiday mornings`,
      winter: `${WINTER.from} to ${WINTER.to}: blue streets alternate, through highways and bus routes have no night parking (every morning)`,
      dates: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length])),
      alternate: { segments: winter.segments, blockSides: winter.sides, winterOnlyStreets: winter.winterOnlyStreets },
      ban: winter.ban },
    leftOut: Object.fromEntries(Object.entries(report.leftOut).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, { n: v, examples: report.examples[k] }])),
    checks: { addressParity: parityCheck, dpwListing: listingCheck },
    sweeping: 'not included: the City publishes sweeping route areas (DPW_Sanitation/MapServer/19, a route name only) and a 2008 frequency map, no days and hours by block side; posted sweeping tow away streets (MCO 101-26.7) are listed only in Common Council proceedings',
    tickets: 'not published: no citation data with time and place on data.milwaukee.gov',
    output: { blocks: blocks.length, blockSides: sideCount, bytes: body.length, gzipBytes: gz },
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(rep, null, 1));
  // city.json: the city's facts, its holidays and the map's frame (every centerline in the City)
  let w = 180, so = 90, e = -180, n = -90;
  for (const s of inCity) for (const [lo, la] of s.c) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < so) so = la; if (la > n) n = la; }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  // winter: the rule's frame for the page and the alert server (lib/city.js): the mornings the lists cover, the hours, the side
  // named by the evening's date, and that it is for cars with a night permit
  fs.writeFileSync(OUT + 'city.json', JSON.stringify({ ...CITY, bounds: [[r4(so), r4(w)], [r4(n), r4(e)]], holidays: HOLIDAYS, ...CITY_LATE,
    winter: { ...YEAR, ...HOURS, night: 'evening', permit: true }, sources }, null, 1));
  // The rule's switch (data/milwaukee/winter.json): on, from the lists' first morning, since the ordinance applies every night
  // (scripts/cities/winter.mjs). A build never touches it once it exists.
  if (!fs.existsSync(OUT + 'winter.json')) fs.writeFileSync(OUT + 'winter.json', JSON.stringify({ state: 'on', from: YEAR.from, at: YEAR.from + 'T05:00:00.000Z', reason: 'By ordinance, every night of the year.' }, null, 1) + '\n');
  log(`classes: ${Object.entries(classes).map(([k, v]) => `${v} ${k}`).join(', ')}; ${partialCount} partly covered`);
  log(`winter: ${winter.segments} alternate side segments (${winter.sides} sides), ${winter.ban.segments} banned (${winter.ban.sides} sides); left out ${Object.entries(report.leftOut).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  log(`address parity: ${parityCheck.agree}/${parityCheck.used} (${parityCheck.share}%); listing: ${Object.entries(listingCheck).map(([k, v]) => `${k} ${v.share}%`).join(', ')}`);
  log(`wrote ${blocks.length} blocks, ${sideCount} block sides; segments.json ${Math.round(body.length / 1024)} KB (${Math.round(gz / 1024)} KB gzip)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await build();
