#!/usr/bin/env node
// Washington, DC for CURB (built 2026-10-18, by docs/multi-city/city-build.md). Writes data/washington-dc/ from three public
// District sources (DCGIS REST services, open to scripts):
//
//   1. DDOT Parking Zones (Transportation_Parking_WebMercator/MapServer/156, CC BY 4.0, revised 2026-10-17): every posted curb
//      restriction, drawn as a line offset to its curb, built from DDOT's sign inventory. PARKINGGROUP 'Sweeping' is the
//      posted street cleaning ("No Parking ... Street Cleaning"). Each zone carries its route (ROUTEID + MEAS_FROM/TO, DC's
//      linear referencing), its side of the route (left/right), its days (STARTDAY..ENDDAY, 1 = Monday) and its hours
//      (STARTTIME/ENDTIME: DDOT's 15-minute codes, 1 = 4:00 AM, so minutes after midnight = 225 + 15 x code; codes 81-96 are
//      0:00 to 3:45 on the zone's own day; 100 = anytime, no hours).
//   2. DDOT Roadway Block (Transportation_WebMercator/MapServer/163): 13,833 street centerlines, block by block, drawn in
//      the direction of increasing route measure, with street names, cross streets and address ranges. A zone belongs to
//      the block of its route whose measure range overlaps it most; its left/right is the block's left/right.
//   3. Parking Violations Issued, 2026 (Violations_Parking_2026/MapServer/0-11, monthly tables): street cleaning tickets
//      (P173, $45) with date, time and block, for the cross-check in report.json. Plus the Office of Planning's
//      neighborhood name points (Administrative_Other_Boundaries_WebMercator/MapServer/18) for each block's neighborhood.
//
// Run: node scripts/cities/washington-dc.mjs [--refresh]   (Node 18+; inputs cached in private/cache/washington-dc/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/washington-dc/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/washington-dc/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[washington-dc]', ...a);

const DCGIS = 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/';
export const ZONES_URL = DCGIS + 'Transportation_Parking_WebMercator/MapServer/156';
export const BLOCKS_URL = DCGIS + 'Transportation_WebMercator/MapServer/163';
export const NAMES_URL = DCGIS + 'Administrative_Other_Boundaries_WebMercator/MapServer/18';
const TICKETS_URL = (year, month) => `${DCGIS}Violations_Parking_${year}/MapServer/${month - 1}`;
const TICKET_YEAR = 2026, TICKET_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// ---------- facts (checked 2026-10-18; sources in city.json and docs/multi-city/washington-dc.md) ----------------------

// The posted season: the signs' plaque reads "MARCH 1 THRU OCTOBER 31 EXCEPT HOLIDAYS" (DDOT's sign text on 22 zones), and
// DPW's 2026 season ran Monday March 2 to Friday October 30. Bits 2..9 = March to October.
export const SEASON = 0b001111111100;
// District of Columbia legal public holidays (DC Code 1-612.02 and 28-2701): no street cleaning tickets were written on
// any of the 2026 holidays inside the season, day or night (report.json), so a holiday stops every sweep.
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Washington's Birthday",
  '2026-04-16': 'DC Emancipation Day', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day', '2026-10-12': "Indigenous Peoples' Day",
  '2026-11-11': 'Veterans Day', '2026-11-26': 'Thanksgiving Day', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Washington's Birthday",
  '2027-04-16': 'DC Emancipation Day', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day', '2027-10-11': "Indigenous Peoples' Day",
  '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving Day', '2027-12-24': 'Christmas Day (observed)',
  '2027-12-31': "New Year's Day (observed)",
};
// 2 = towable: the R-NS-022 sign reads "TOW AWAY ZONE", and DPW: "violators will be subject to $45 fines and relocation, which
// carries a $100 fee" (dpw.dc.gov/spring). Holidays stop every sweep, day and night (holidayRule 'all').
const FLAGS = 2;

// city.json (bounds and holidays are added by the build)
export const CITY = { id: 'washington-dc', name: 'Washington, DC', region: 'District of Columbia', tz: 'America/New_York',
  center: [38.918, -77.025], zoom: 14 };   // Shaw, Logan Circle, U Street and Columbia Heights: the most posted blocks
const CITY_LATE = {
  holidaysSource: 'https://dchr.dc.gov/page/holiday-schedules',
  holidayRule: 'all',
  fine: '$45', tow: 'sometimes', fineSource: 'https://dpw.dc.gov/spring',
  agency: 'DC Department of Public Works (DPW)', scheduleUrl: 'https://dpw.dc.gov/page/street-and-alley-cleaning',
  words: {
    rule: 'Posted street cleaning: each side one weekday a week, 9:30 to 11:30 AM or 12:30 to 2:30 PM (overnight on some main roads), March to October.',
    afterpass: 'Not on DC holidays. A $45 ticket, and the car can be relocated for a $100 fee.',
    dataNotes: 'Sweeping rules come from DDOT\'s Parking Zones, the District\'s inventory of posted street cleaning signs, placed on DDOT\'s street blocks by route and side. Checked against the District\'s 2026 street cleaning tickets: 91% land on a side, day and window the data posts.',
  },
};

// ---------- decoding ---------------------------------------------------------------------------------------------------

// STARTTIME/ENDTIME slot → minutes after midnight (0..1439), or null (100 = "anytime": no hours on the sign).
// DDOT's code list (SignWorks_Hours, on DDOT/Signworks/MapServer/3): 1 = 4:00 AM, 2 = 4:15 AM .. 81 = 12:00 AM .. 96 = 3:45 AM;
// 0 = 12:00 AM; 97 to 99 = blank, 100 = anytime.
export function slotMinutes(slot) {
  if (slot === 0) return 0;
  if (!Number.isInteger(slot) || slot < 1 || slot > 96) return null;
  return (225 + 15 * slot) % 1440;
}
// Minutes after midnight → the rule format: whole hours as numbers, otherwise "H:MM".
export const hm = (min) => (min % 60 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : min / 60);
// DDOT day (1 = Monday .. 7 = Sunday; 8 = any day, 9 = school days) → JavaScript weekday, or null.
export const jsDow = (d) => (Number.isInteger(d) && d >= 1 && d <= 7 ? d % 7 : null);
const span = (from, to) => (to > from ? to - from : to + 1440 - from);   // minutes; a window ending at or before its start ends the next day

// One zone → its weekly rules (one per weekday), or { skip: reason }. `common` is the set of windows ("from-to" in
// minutes) that 20 or more zones use, for the AM/PM fixes below.
export function decodeZone(a, common = new Set()) {
  if (a.PARKINGGROUP !== 'Sweeping') return { skip: 'not sweeping' };
  const note = String(a.SIGNTEXT || '');
  // DDOT's inventory notes on the sign: "sign missing", "no sign posted", "sign and post mising", "#missing"
  if (/no sign posted|sign (and post )?mis+ing|#missing/i.test(note)) return { skip: 'no sign on the street (DDOT field note)' };
  // the plaque's season, when it says something other than March 1 to October 31 (one zone: "MARCH 1 THRU DECEMBER 31")
  const season = /MARCH\s*1\s*THRU\s*DECEMBER\s*31/i.test(note) ? 0b111111111100 : SEASON;
  let from = slotMinutes(a.STARTTIME), to = slotMinutes(a.ENDTIME);
  if (from === null || to === null) return { skip: 'no hours' };
  const d0 = jsDow(a.STARTDAY), d1 = jsDow(a.ENDDAY);
  if (d0 === null || d1 === null) return { skip: 'no weekday' };
  let fixed = null;
  if (span(from, to) > 12 * 60) {
    // An AM/PM slip: one end 12 hours off ("9:30 to 23:30"). Fixed only when exactly one way of moving one end by 12 hours
    // gives a window that many zones use; otherwise left out.
    const tries = [[from, (to + 720) % 1440], [(from + 720) % 1440, to]].filter(([f, t]) => common.has(f + '-' + t));
    if (tries.length !== 1) return { skip: 'window over 12 hours' };
    fixed = { was: [hm(from), hm(to)], now: [hm(tries[0][0]), hm(tries[0][1])] };
    [from, to] = tries[0];
  } else if (from >= 21 * 60 && to > from && common.has((from - 720) + '-' + (to - 720))) {
    // both ends PM: "21:30 to 23:30" is the 9:30 to 11:30 sign (every such zone shares its side with one, and that side's
    // tickets are all written in the morning; report.json)
    fixed = { was: [hm(from), hm(to)], now: [hm(from - 720), hm(to - 720)] };
    from -= 720; to -= 720;
  }
  const overnight = to <= from;
  let days;
  if (d0 === d1) days = [d0];
  else if (overnight && d1 === (d0 + 1) % 7) days = [d0];                     // Thursday 10 PM to Friday 5 AM
  else if (!overnight) {                                                      // Monday to Friday: the same window each day
    days = [d0];
    for (let d = d0; d !== d1; ) { d = (d + 1) % 7; days.push(d); }
  } else return { skip: 'night over several days' };
  return { rules: days.map((dow) => [dow, hm(from), hm(to), 31, season, FLAGS]), fixed };
}

// ---------- geometry and names -----------------------------------------------------------------------------------------

const LAT0 = 38.9, LON0 = -77.0, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
// The side's direction from the street, looking from the line's first point to its last (Boston's compass()).
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
// Which side of a point the line passes: 'L' or 'R' of the nearest piece of the line, with the distance in meters.
export function sideOf(c, p) {
  const [px, py] = xy(p);
  let best = null;
  for (let i = 1; i < c.length; i++) {
    const [x1, y1] = xy(c[i - 1]), [x2, y2] = xy(c[i]), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    if (!l2) continue;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)), d = Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
    if (!best || d < best.d) best = { d, side: dx * (py - y1) - dy * (px - x1) > 0 ? 'L' : 'R' };
  }
  return best;
}
const QUAD = new Set(['NW', 'NE', 'SW', 'SE']);
// "MARTIN LUTHER KING JR AVE SE" → "Martin Luther King Jr Ave SE", "3RD ST NW" → "3rd St NW", "O ST NW" → "O St NW". A street
// on a quadrant line ends in BN for "boundary" in DDOT's route names ("EAST CAPITOL ST BN"): people say "East Capitol St".
export function titleStreet(s) {
  const word = (w) => {
    if (QUAD.has(w)) return w;
    if (/^\d+(ST|ND|RD|TH)$/.test(w)) return w.toLowerCase();
    if (/^MC[A-Z]{2,}/.test(w)) return 'Mc' + w[2] + w.slice(3).toLowerCase();
    return w.split(/([-'])/).map((p) => (p.length ? p[0] + p.slice(1).toLowerCase() : p)).join('');
  };
  // "1ST ST NE/1ST ST SE" (a cross street on a quadrant line): each part of a slashed word is a word
  return String(s || '').trim().replace(/\s+BN$/, '').split(/\s+/).filter(Boolean)
    .map((w) => w.split('/').map((p) => (p ? word(p) : p)).join('/')).join(' ');
}
const parity = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n % 2 : null; };
// The side of the block (L/R along its line) with the odd house numbers, from the left and right address ranges.
export function oddSide(a) {
  const l = parity(a.ADDRESS_RANGE_LEFT_LOW) ?? parity(a.ADDRESS_RANGE_LEFT_HIGH);
  const r = parity(a.ADDRESS_RANGE_RIGHT_LOW) ?? parity(a.ADDRESS_RANGE_RIGHT_HIGH);
  if (l === 1 && r === 0) return 'L';
  if (r === 1 && l === 0) return 'R';
  return null;
}

// NAD83 / Maryland (EPSG:26985, meters) → [lng, lat]: the tickets' XCOORD/YCOORD. Lambert conformal conic, 2 parallels.
export function marylandToLngLat(x, y) {
  const a = 6378137, f = 1 / 298.257222101, e = Math.sqrt(2 * f - f * f), rad = Math.PI / 180;
  const m = (p) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
  const t = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const p1 = 39.45 * rad, p2 = 38.3 * rad, p0 = (37 + 40 / 60) * rad, l0 = -77 * rad;
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * t(p1) ** n), r0 = a * F * t(p0) ** n;
  const dx = x - 400000, dy = r0 - y, r = Math.sign(n) * Math.hypot(dx, dy), th = Math.atan2(dx, dy);
  const tt = (r / (a * F)) ** (1 / n);
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 8; i++) phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2));
  return [(th / n + l0) / rad, phi / rad];
}
// A ticket's LOCATION ("1300 BLOCK QUEEN ST NE WEST SIDE", "BLOCK OF 800 9TH ST NE WEST SI*") → street and side word.
export function parseLocation(loc) {
  const s = String(loc || '').toUpperCase();
  const side = (/\b(NORTH|SOUTH|EAST|WEST)\b(?=\s*(?:S(?:I(?:DE?)?)?)?\s*\*?\s*$)/.exec(s) || [])[1] || null;
  const q = /\b(NW|NE|SW|SE)\b/.exec(s);
  const street = q ? s.slice(0, q.index).replace(/\bBLOCK( OF)?\b/g, ' ').replace(/\b\d+\b/, ' ').replace(/\s+/g, ' ').trim() + ' ' + q[1] : null;
  return { street, side };
}

// ---------- fetching ----------------------------------------------------------------------------------------------------

async function post(url, params, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams(params),
        headers: { Accept: 'application/json', 'User-Agent': 'curb-city-build (+https://curb.guide)' } });
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
// Every feature of an ArcGIS layer matching `where`, 1,000 at a time, as the service returns them (f=json, WGS84).
async function features(url, where, outFields, extra = {}) {
  const out = [];
  for (let off = 0; ; ) {
    const j = await post(url + '/query', { where, outFields, returnGeometry: 'true', outSR: '4326', orderByFields: 'OBJECTID',
      resultOffset: off, resultRecordCount: 1000, f: 'json', ...extra });
    const page = j.features || [];
    out.push(...page);
    if (!page.length || (page.length < 1000 && !j.exceededTransferLimit)) return out;
    off += page.length;
  }
}
async function rows(url, where, outFields) {
  const out = [];
  for (let off = 0; ; ) {
    const j = await post(url + '/query', { where, outFields, returnGeometry: 'false', orderByFields: 'OBJECTID',
      resultOffset: off, resultRecordCount: 2000, f: 'json' });
    const page = (j.features || []).map((f) => f.attributes);
    out.push(...page);
    if (!page.length || (page.length < 2000 && !j.exceededTransferLimit)) return out;
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
  const a = list[0] && (list[0].attributes || list[0]);
  const missing = fields.filter((k) => !a || !(k in a));
  if (missing.length) throw new Error(`${what}: the City's data changed shape, missing ${missing.join(', ')}`);
}

// ---------- the build ---------------------------------------------------------------------------------------------------

async function build() {
  const ZONE_FIELDS = 'ZONEID,SIGNTEXT,ROUTEID,SIDE,MEAS_FROM,MEAS_TO,STARTDAY,ENDDAY,STARTTIME,ENDTIME,SIGNS,OFFSET,BLOCKFACEKEY,SIGNCODE,PARKINGGROUP,PARKINGDAYGROUP,PARKINGHOURGROUP,DATA_ERRORS,OBJECTID';
  const BLOCK_FIELDS = 'ROUTEID,FROMMEASURE,TOMEASURE,ROUTENAME,ROADTYPE,BLOCKKEY,TOTALPARKINGLANES,STREETNAME,STREETTYPE,QUADRANT,BLOCK_NAME,ADDRESS_RANGE_HIGH,ADDRESS_RANGE_LOW,ADDRESS_RANGE_RIGHT_HIGH,ADDRESS_RANGE_LEFT_HIGH,ADDRESS_RANGE_RIGHT_LOW,ADDRESS_RANGE_LEFT_LOW,BLOCKID,FROMSTREET,TOSTREET,WARD_ID,ANC_ID,SUMMARYDIRECTION,OBJECTID';
  const zones = await cached('sweeping-zones.json', () => { log('fetching sweeping zones…'); return features(ZONES_URL, "PARKINGGROUP='Sweeping'", ZONE_FIELDS); });
  const blocks = await cached('roadway-blocks.json', () => { log('fetching roadway blocks…'); return features(BLOCKS_URL, '1=1', BLOCK_FIELDS, { returnM: 'true' }); });
  const names = await cached('neighborhood-names.json', () => { log('fetching neighborhood names…'); return features(NAMES_URL, '1=1', 'NAME,OBJECTID'); });
  const tickets = await cached(`tickets-p173-${TICKET_YEAR}.json`, async () => {
    const out = [];
    for (const m of TICKET_MONTHS) {
      log(`fetching ${TICKET_YEAR}-${m} street cleaning tickets…`);
      out.push(...await rows(TICKETS_URL(TICKET_YEAR, m), "VIOLATION_CODE='P173'", 'OBJECTID,ISSUE_DATE,ISSUE_TIME,ISSUING_AGENCY_SHORT,VIOLATION_CODE,LOCATION,XCOORD,YCOORD,MAR_ID,FINE_AMOUNT'));
    }
    return out;
  });
  expectFields(zones, ZONE_FIELDS.split(','), 'Parking Zones');
  expectFields(blocks, ['ROUTEID', 'FROMMEASURE', 'TOMEASURE', 'ROUTENAME', 'BLOCKKEY', 'FROMSTREET', 'TOSTREET', 'ADDRESS_RANGE_LEFT_LOW', 'ADDRESS_RANGE_RIGHT_LOW'], 'Roadway Block');
  expectFields(tickets, ['ISSUE_DATE', 'ISSUE_TIME', 'LOCATION', 'XCOORD', 'YCOORD'], 'Parking Violations');
  if (zones.length < 3000 || zones.length > 12000) throw new Error(`${zones.length} sweeping zones: expected 3,000 to 12,000`);
  if (blocks.length < 12000) throw new Error(`${blocks.length} roadway blocks: expected over 12,000`);
  log(`${zones.length} sweeping zones, ${blocks.length} roadway blocks, ${names.length} neighborhood names, ${tickets.length} street cleaning tickets (${TICKET_YEAR})`);

  // blocks by route; each block's line must run in the direction of increasing measure (that is what makes left/right)
  const byRoute = new Map(), byKey = new Map();
  let backwards = 0;
  for (const f of blocks) {
    const a = f.attributes, path = f.geometry && f.geometry.paths && f.geometry.paths[0];
    if (!path || path.length < 2) continue;
    if (path[0].length > 2 && path[path.length - 1][2] < path[0][2]) backwards++;
    const b = { a, c: path.map((p) => [p[0], p[1]]) };
    byKey.set(a.BLOCKKEY, b);
    if (!byRoute.has(a.ROUTEID)) byRoute.set(a.ROUTEID, []);
    byRoute.get(a.ROUTEID).push(b);
  }
  if (backwards > blocks.length * 0.01) throw new Error(`${backwards} block lines run against their measures: left/right would be wrong`);

  // windows many zones use (20 or more), for the AM/PM fix. Every overnight zone carries DATA_ERRORS "Invalid Time Range"
  // (its end is before its start), so the count reads all zones, not only those without errors.
  const counts = new Map();
  for (const z of zones) {
    const a = z.attributes, f = slotMinutes(a.STARTTIME), t = slotMinutes(a.ENDTIME);
    if (f !== null && t !== null) counts.set(f + '-' + t, (counts.get(f + '-' + t) || 0) + 1);
  }
  const common = new Set([...counts].filter(([, n]) => n >= 20).map(([k]) => k));

  const report = { zones: zones.length, used: 0, skipped: {}, fixedAmPm: [], dataErrors: {}, notOnAStreet: 0, sideCheck: { agree: 0, differ: 0 }, mixedSides: 0, windows: {} };
  const skip = (why, a) => { const s = (report.skipped[why] ||= { n: 0, examples: [] }); s.n++; if (s.examples.length < 5) s.examples.push(a.ZONEID); };
  const sides = new Map();   // BLOCKKEY → Map(side → { rules: Map, zones: Set })
  for (const z of zones) {
    const a = z.attributes;
    report.dataErrors[a.DATA_ERRORS || 'none'] = (report.dataErrors[a.DATA_ERRORS || 'none'] || 0) + 1;
    const dec = decodeZone(a, common);
    if (dec.skip) { skip(dec.skip, a); continue; }
    // the block of this route that the zone overlaps most
    const [lo, hi] = [Math.min(a.MEAS_FROM, a.MEAS_TO), Math.max(a.MEAS_FROM, a.MEAS_TO)];
    let best = null;
    for (const b of byRoute.get(a.ROUTEID) || []) {
      const ov = Math.min(hi, b.a.TOMEASURE) - Math.max(lo, b.a.FROMMEASURE);
      if (!best || ov > best.ov) best = { ov, b };
    }
    if (!best || best.ov < -1) { report.notOnAStreet++; skip('on an alley or driveway route, not a street block', a); continue; }
    const side = a.SIDE === 'left' ? 'L' : a.SIDE === 'right' ? 'R' : null;
    if (!side) { skip('no side', a); continue; }
    // check: the zone's line is drawn on that side of the block's line
    const zp = z.geometry.paths[0], mid = zp[Math.floor(zp.length / 2)];
    const geo = sideOf(best.b.c, zp.length > 2 ? mid : [(zp[0][0] + zp[1][0]) / 2, (zp[0][1] + zp[1][1]) / 2]);
    if (geo) geo.side === side ? report.sideCheck.agree++ : report.sideCheck.differ++;
    if (dec.fixed) report.fixedAmPm.push({ zone: a.ZONEID, street: titleStreet(best.b.a.ROUTENAME), ...dec.fixed });
    report.used++;
    const key = best.b.a.BLOCKKEY;
    if (!sides.has(key)) sides.set(key, new Map());
    const s = sides.get(key);
    if (!s.has(side)) s.set(side, { rules: new Map(), zones: new Set() });
    const entry = s.get(side);
    entry.zones.add(dec.rules.map((r) => r.join('|')).sort().join(' '));   // this zone's rule set
    for (const r of dec.rules) {
      entry.rules.set(r.join('|'), r);
      const w = `${r[1]}-${r[2]}`;
      report.windows[w] = (report.windows[w] || 0) + 1;
    }
  }
  if (report.sideCheck.differ > report.sideCheck.agree * 0.01) throw new Error(`zone sides disagree with the block lines on ${report.sideCheck.differ} zones`);

  // neighborhood: the nearest Office of Planning neighborhood name point
  const hoodPts = names.map((f) => ({ name: f.attributes.NAME, p: xy([f.geometry.x, f.geometry.y]) })).filter((h) => h.name);
  const hoodAt = (c) => {
    const m = xy(c[Math.floor(c.length / 2)]);
    let best = null;
    for (const h of hoodPts) { const d = Math.hypot(h.p[0] - m[0], h.p[1] - m[1]); if (!best || d < best.d) best = { d, name: h.name }; }
    return best ? best.name : '';
  };
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const out = [];
  for (const [key, s] of sides) {
    const b = byKey.get(key), a = b.a;
    // zones on one side with different rules: all are kept (each holds on its own stretch of the curb)
    for (const e of s.values()) if (e.zones.size > 1) report.mixedSides++;
    const lo = Math.round(a.ADDRESS_RANGE_LOW), hi = Math.round(a.ADDRESS_RANGE_HIGH), odd = oddSide(a);
    const cross = [a.FROMSTREET, a.TOSTREET].filter((v) => v && !/block only/i.test(v)).map(titleStreet);
    out.push({ c: key, s: titleStreet(a.ROUTENAME), l: cross.join(' - '), h: hoodAt(b.c),
      ...(lo > 0 && hi >= lo ? { n: [lo, hi] } : {}), ...(odd ? { o: odd } : {}),
      g: b.c.map(([lo2, la]) => [r6(lo2), r6(la)]),
      d: ['L', 'R'].filter((sd) => s.has(sd)).map((sd) => [sd, compass(b.c, sd), [...s.get(sd).rules.values()].sort((x, y) => x[0] - y[0] || String(x[1]).localeCompare(String(y[1])))]) });
  }
  out.sort((x, y) => x.s.localeCompare(y.s, 'en', { numeric: true }) || (x.n ? x.n[0] : 0) - (y.n ? y.n[0] : 0) || x.c.localeCompare(y.c));

  // ---------- cross-check: the year's street cleaning tickets against the block sides -----------------------------------
  const check = crossCheck(tickets, blocks, out);

  // ---------- write -----------------------------------------------------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: 'Parking Zones (DDOT)', url: 'https://opendata.dc.gov/datasets/DCGIS::parking-zones', api: ZONES_URL, license: 'CC BY 4.0', fetched: today },
    { name: 'Roadway Block (DDOT)', url: 'https://opendata.dc.gov/datasets/DCGIS::roadway-block', api: BLOCKS_URL, license: 'CC BY 4.0', fetched: today },
    { name: `Parking Violations Issued, ${TICKET_YEAR} (DPW, DDOT)`, url: 'https://opendata.dc.gov/', api: TICKETS_URL(TICKET_YEAR, 1).replace(/\/0$/, ''), license: 'CC BY 4.0', fetched: today },
    { name: 'Neighborhood Names (Office of Planning)', url: 'https://opendata.dc.gov/', api: NAMES_URL, license: 'CC BY 4.0', fetched: today },
  ];
  const sideCount = out.reduce((n, b) => n + b.d.length, 0), ruleCount = out.reduce((n, b) => n + b.d.reduce((m, d) => m + d[2].length, 0), 0);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'washington-dc', time_zone: 'America/New_York', generated: new Date().toISOString(), sources, blocks: out.length, sides: sideCount,
      format: 'b[] = {c: DDOT BLOCKKEY, s: street, l: cross streets, h: neighborhood (nearest Office of Planning name point), n: [low, high] block address range, o: the side with odd numbers (L|R), g: centerline [[lng,lat]] in the direction of increasing route measure, d: [[side L|R, compass label, rules]]}; '
        + 'rule = [jsDow, from, to ("H:MM" when not on the hour; to < from ends the next morning), weeksMask (31 = every week), monthsMask (bit m-1: 1020 = March to October), flags (2 = towable: the signs read TOW AWAY ZONE)]' },
    b: out }));
  const rep = {
    generated: new Date().toISOString(),
    season: { months: 'March to October (bits 2-9, mask 1020)', posted: 'MARCH 1 THRU OCTOBER 31 EXCEPT HOLIDAYS (sign plaque text in DDOT data)', dpw2026: '2026-03-02 to 2026-10-30',
      partialMonths: 'none for 2026: March 1 is a Sunday and October 31 a Saturday, and DC sweeps Monday to Friday' },
    zones: { sweeping: report.zones, used: report.used, skipped: report.skipped, dataErrors: report.dataErrors,
      fixedAmPm: report.fixedAmPm.length, fixedAmPmZones: report.fixedAmPm, sideCheck: report.sideCheck, sidesWithSeveralZonesAndRules: report.mixedSides },
    output: { blocks: out.length, blockSides: sideCount, rules: ruleCount, windows: Object.fromEntries(Object.entries(report.windows).sort((x, y) => y[1] - x[1])) },
    tickets: check,
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(rep, null, 1));
  // city.json: the city's facts (CITY above), its holidays and the map's frame (every DDOT street block)
  let w = 180, s = 90, e = -180, n = -90;
  for (const b of byKey.values()) for (const [lo2, la] of b.c) { if (lo2 < w) w = lo2; if (lo2 > e) e = lo2; if (la < s) s = la; if (la > n) n = la; }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  fs.writeFileSync(OUT + 'city.json', JSON.stringify({ ...CITY, bounds: [[r4(s), r4(w)], [r4(n), r4(e)]], holidays: HOLIDAYS, ...CITY_LATE,
    sources: sources.map(({ api, ...src }) => ({ ...src, api })) }, null, 1));
  log(`zones: ${report.used}/${report.zones} used; skipped ${Object.entries(report.skipped).map(([k, v]) => `${v.n} ${k}`).join(', ')}; ${report.fixedAmPm.length} AM/PM fixes; side check ${report.sideCheck.agree} agree, ${report.sideCheck.differ} differ`);
  log(`wrote ${out.length} blocks, ${sideCount} block sides, ${ruleCount} rules; segments.json ${Math.round(fs.statSync(OUT + 'segments.json').size / 1024)} KB`);
  log(`tickets: ${check.located}/${check.tickets} located on a block; of ${check.withSide} with a side, ${check.onSideInWindow} (${check.shareOnSideInWindow}) on a posted side, weekday and window`);
}

// Each ticket → its block (XCOORD/YCOORD are the block's address point on the centerline, within 5 m for 99% of them) and
// side (LOCATION's NORTH/SOUTH/EAST/WEST SIDE); then: is that side posted for that weekday and time?
export function crossCheck(tickets, blocks, out) {
  const all = new Map(), cellOf = (v) => Math.floor(v / 60), grid = new Map();
  for (const f of blocks) {
    const path = f.geometry && f.geometry.paths && f.geometry.paths[0];
    if (!path) continue;
    const c = path.map((p) => [p[0], p[1]]), key = f.attributes.BLOCKKEY;
    all.set(key, { c, name: String(f.attributes.ROUTENAME || '') });
    const pts = c.map(xy);
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      for (let cx = cellOf(Math.min(x1, x2) - 40); cx <= cellOf(Math.max(x1, x2) + 40); cx++)
        for (let cy = cellOf(Math.min(y1, y2) - 40); cy <= cellOf(Math.max(y1, y2) + 40); cy++) {
          const k = cx + ',' + cy;
          if (!grid.has(k)) grid.set(k, new Set());
          grid.get(k).add(key);
        }
    }
  }
  const posted = new Map(out.map((b) => [b.c, b]));
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const toMin = (v) => (typeof v === 'number' ? v * 60 : +v.split(':')[0] * 60 + +v.split(':')[1]);
  // does one of these rules hold at weekday `dow`, minute `t` (or the night before, for a window ending the next morning)?
  const holds = (rules, dow, t) => rules.some((r) => {
    const f = toMin(r[1]), e = toMin(r[2]);
    if (e > f) return r[0] === dow && t >= f && t <= e;
    return (r[0] === dow && t >= f) || ((r[0] + 1) % 7 === dow && t <= e);
  });
  const DIRV = { NORTH: [0, 1], SOUTH: [0, -1], EAST: [1, 0], WEST: [-1, 0] };
  const res = { tickets: tickets.length, unlocated: 0, located: 0, onPostedBlock: 0, blockInWindow: 0, withSide: 0, onSideInWindow: 0,
    onSideOtherTime: 0, otherSideInWindow: 0, sideNotPosted: 0, byMonth: {} };
  const perDay = new Map(), nightMorning = new Map();
  for (const t of tickets) {
    const day = dtf.format(new Date(t.ISSUE_DATE)), mo = day.slice(0, 7);
    res.byMonth[mo] = (res.byMonth[mo] || 0) + 1;
    perDay.set(day, (perDay.get(day) || 0) + 1);
    if (parseInt(t.ISSUE_TIME, 10) < 600) nightMorning.set(day, (nightMorning.get(day) || 0) + 1);
    if (!t.XCOORD || !t.YCOORD) { res.unlocated++; continue; }
    const p = marylandToLngLat(t.XCOORD, t.YCOORD), [px, py] = xy(p);
    const loc = parseLocation(t.LOCATION), first = loc.street ? loc.street.split(' ')[0] : null;
    let best = null;
    for (const key of grid.get(cellOf(px) + ',' + cellOf(py)) || []) {
      const b = all.get(key), s = sideOf(b.c, p);
      if (!s || s.d > 30) continue;
      const named = first && b.name.startsWith(first + ' ') ? 1 : 0;
      if (!best || named > best.named || (named === best.named && s.d < best.d)) best = { key, d: s.d, named };
    }
    if (!best) { res.unlocated++; continue; }
    res.located++;
    const blk = posted.get(best.key);
    if (!blk) continue;
    res.onPostedBlock++;
    const dow = new Date(day + 'T12:00:00Z').getUTCDay(), hhmm = parseInt(t.ISSUE_TIME, 10), tmin = Math.floor(hhmm / 100) * 60 + (hhmm % 100);
    const allRules = blk.d.flatMap((d) => d[2]);
    if (holds(allRules, dow, tmin)) res.blockInWindow++;
    if (!loc.side) continue;
    // the side whose outward direction is closest to the ticket's side word
    const c = all.get(best.key).c, a = xy(c[0]), z = xy(c[c.length - 1]), len = Math.hypot(z[0] - a[0], z[1] - a[1]) || 1;
    const left = [-(z[1] - a[1]) / len, (z[0] - a[0]) / len], v = DIRV[loc.side], dot = left[0] * v[0] + left[1] * v[1];
    if (Math.abs(dot) < 0.35) continue;
    res.withSide++;
    const side = dot > 0 ? 'L' : 'R', mine = blk.d.find((d) => d[0] === side), other = blk.d.find((d) => d[0] !== side);
    if (mine && holds(mine[2], dow, tmin)) res.onSideInWindow++;
    else if (mine) res.onSideOtherTime++;
    else if (other && holds(other[2], dow, tmin)) res.otherSideInWindow++;
    else res.sideNotPosted++;
  }
  // holidays in season, in months whose tickets are published: tickets that day against the same weekday a week before
  res.holidays = [];
  for (const [iso, name] of Object.entries(HOLIDAYS)) {
    const m = +iso.slice(5, 7);
    if (!iso.startsWith(String(TICKET_YEAR)) || !(SEASON & (1 << (m - 1))) || !res.byMonth[iso.slice(0, 7)]) continue;
    const before = new Date(Date.parse(iso + 'T12:00:00Z') - 7 * 864e5).toISOString().slice(0, 10);
    const next = new Date(Date.parse(iso + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
    res.holidays.push({ date: iso, name, tickets: perDay.get(iso) || 0, weekBefore: before, ticketsWeekBefore: perDay.get(before) || 0,
      nextMorningBefore6: nightMorning.get(next) || 0 });
  }
  const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : 'n/a');
  res.shareOnSideInWindow = pct(res.onSideInWindow, res.withSide);
  res.shareBlockInWindow = pct(res.blockInWindow, res.onPostedBlock);
  res.shareOnPostedBlock = pct(res.onPostedBlock, res.located);
  res.note = 'located = XCOORD/YCOORD within 30 m of a DDOT street block (preferring one named like LOCATION); withSide = located on a posted block and LOCATION names a side; '
    + 'onSideInWindow = that side has a rule for the ticket\'s weekday and time (windows ending the next morning count on the night before). The tickets\' points are block address points, not the officer\'s position.';
  return res;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await build();
