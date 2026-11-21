#!/usr/bin/env node
// Cambridge, MA for CURB (researched 2026-10-18, built from the City's district schedule 2026-11-20; the spec is
// docs/multi-city/city-build.md, the research page docs/multi-city/cambridge.md). Builds data/cambridge/ from the City's
// own open data:
//
//   1. Street Sweeping Schedule (uvf3-2xt3, Public Works): 20 rows, one per street cleaning district (A to K, no I) and
//      side (odd or even house numbers), with the day on the signs ("1st Wed") and the date of each month's sweep, April
//      to December 2026, holiday make-up days included. No hours.
//   2. Master Addresses List (vup6-kpwv): the street cleaning district of every address.
//   3. Street Centerline (3d3q-sfd6): block lines with left and right address ranges. Each address goes on the side of its
//      street whose range holds its number, and a side takes the district of most of its addresses (MIN_SHARE).
//   4. Cambridge Parking Tickets (vnxa-cuyr): every 2025 street cleaning ticket (violation S1) with its date, time and the
//      address or corner it was written at.
//
// Hours: the City publishes none. Most streets are 8 AM to noon and a few differ (the City, October 2026), so every side
// gets 8 to 12 and the posted sign decides. The 2025 tickets fit: report.json ticketHours.
//
// The ticket check decides what ships: segments.json is written only when at least SHIP_SHARE of the 2025 tickets placed
// on a block side land on a side the schedule sweeps that day and hour. The 2026 dates are not 2025's, so the check reads
// each list's day on the signs ("1st Wed") on 2025's calendar and leaves out 5th weekdays, where only make-up days fall.
// When it fails, the build writes city.json and report.json and no segments.json, so no wrong map ships.
//
// Run: node scripts/cities/cambridge.mjs [--refresh]   (Node 18+; downloads cached in private/cache/cambridge/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------- the City's words ----------------------------------------------------------------------------------------

const DOWS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// "1st Wed" → { nth: 1, dow: 3 } (JavaScript weekday); "4th Friday" works too
export function parseDay(s) {
  const m = /^\s*([1-4])(?:st|nd|rd|th)\s+([a-z]{3})[a-z]*\s*$/i.exec(String(s || ''));
  const dow = m ? DOWS.indexOf(m[2].toLowerCase()) : -1;
  return dow >= 0 ? { nth: +m[1], dow } : null;
}
// The date of the nth weekday of a month: (2026, 9, { nth: 1, dow: 2 }) → "2026-09-01"
export function nthDate(y, mo, { nth, dow }) {
  const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  return `${y}-${String(mo).padStart(2, '0')}-${String(1 + ((dow - first + 7) % 7) + 7 * (nth - 1)).padStart(2, '0')}`;
}
// A local date's weekday and which one of the month it is: "2025-06-04" → { nth: 1, dow: 3 }
export function nthWeekday(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { nth: Math.floor((d - 1) / 7) + 1, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

const MONTH_COLS = ['april', 'may', 'june', 'july', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const DISTRICTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'];
// The schedule's rows → one date list per district and side ("A-odd": 9 dates), its day on the signs, and every date
// that is not that day: `moved` when it is a holiday's make-up day (makeUp: holiday → make-up day), `other` otherwise.
// Fails when the table changes shape.
export function scheduleLists(rows, makeUp) {
  const lists = {}, days = {}, moved = [], other = [];
  for (const r of rows) {
    const side = String(r.side || '').toLowerCase(), day = parseDay(r.day), key = `${r.district}-${side}`;
    if (!DISTRICTS.includes(r.district) || !['odd', 'even'].includes(side) || !day) throw new Error(`Cambridge schedule changed shape: ${JSON.stringify(r)}`);
    if (lists[key]) throw new Error(`Cambridge schedule lists ${key} twice`);
    days[key] = { ...day, words: r.day };
    lists[key] = MONTH_COLS.map((col, i) => {
      const iso = String(r[col] || '').slice(0, 10);
      if (!/^\d{4}-\d\d-\d\d$/.test(iso)) throw new Error(`Cambridge schedule: no ${col} date for ${key}`);
      const regular = nthDate(+iso.slice(0, 4), i + 4, day);
      if (iso !== regular) (makeUp[regular] === iso ? moved : other).push({ list: key, day: r.day, regular, listed: iso, holidayAdjustments: r.holiday_adjustments || '' });
      return iso;
    }).sort();
  }
  for (const d of DISTRICTS) for (const s of ['odd', 'even']) if (!lists[`${d}-${s}`]) throw new Error(`Cambridge schedule has no row for district ${d}, ${s} side`);
  if (rows.length !== 20) throw new Error(`Cambridge schedule: ${rows.length} rows, expected 20`);
  return { lists, days, moved, other };
}

const TYPE = { STREET: 'ST', ST: 'ST', AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE', ROAD: 'RD', RD: 'RD', PLACE: 'PL', PL: 'PL',
  TERRACE: 'TER', TERR: 'TER', TER: 'TER', COURT: 'CT', CT: 'CT', DRIVE: 'DR', DR: 'DR', LANE: 'LN', LN: 'LN', PARK: 'PK',
  PK: 'PK', CIRCLE: 'CIR', CIR: 'CIR', SQUARE: 'SQ', SQ: 'SQ', HIGHWAY: 'HWY', HWY: 'HWY', BOULEVARD: 'BLVD', BLVD: 'BLVD',
  PARKWAY: 'PKWY', PKWY: 'PKWY', WAY: 'WAY', WY: 'WAY' };
// The tickets' spellings → the centerline's, for what the rules in streetKey can't reconcile.
const ALIAS = { 'MASS AVE': 'MASSACHUSETTS AVE', 'FRESHPOND PKWY': 'FRESH POND PKWY', "O'BRIEN HWY": 'MONSIGNOR OBRIEN HWY',
  "O'BRIAN HWY": 'MONSIGNOR OBRIEN HWY', 'OBRIEN HWY': 'MONSIGNOR OBRIEN HWY', 'VASSALL LN': 'VASSAL LN', 'VASSELL LN': 'VASSAL LN',
  'CARDINAL MEDEIROS': 'CARDINAL MEDEIROS AVE', 'BAYSTATE RD': 'BAY STATE RD', WATERHOUSE: 'WATERHOUSE ST', 'MEACHUM RD': 'MEACHAM RD',
  'HAWTHORNE ST': 'HAWTHORN ST', 'UPLAND ST': 'UPLAND RD', 'AVONHILL ST': 'AVON HILL ST', 'BURNS RD': 'CORPORAL BURNS RD',
  'BUENA VISTA RD': 'BUENA VISTA PK', 'CLINTON AVE': 'CLINTON ST', 'COTTAGE PK AVE': 'COTTAGE PARK AVE', 'DOUGLAS ST': 'DOUGLASS ST',
  'CAMERON ST': 'CAMERON AVE', 'WILLIARD ST': 'WILLARD ST', 'FOUNTIAN TER': 'FOUNTAIN TER', ROSELAND: 'ROSELAND ST', TREMONT: 'TREMONT ST',
  'SEVILLE ST': 'SAVILLE ST', 'HUBBARD PK RD': 'HUBBARD PARK RD', 'FAIRWEATHER ST': 'FAYERWEATHER ST', 'ST SAVEUR CT': 'ST SAUVEUR CT',
  'ST SAUVER CT': 'ST SAUVEUR CT', 'COLUMBUS ST': 'COLUMBUS AVE', 'MCTERNAN ST': 'CORPORAL MCTERNAN ST', 'MERCIR CIR': 'MERCER CIR',
  'RAYMOND AVE': 'RAYMOND ST', 'RIEDISEL AVE': 'RIEDESEL AVE', 'SUMMER RD': 'SUMNER RD', 'SOMNER RD': 'SUMNER RD',
  'S NORMANDY AVE': 'SOUTH NORMANDY AVE', 'ACADIA ST': 'ACACIA ST', 'CAMBRIDGER TER': 'CAMBRIDGE TER', 'CHANING PL': 'CHANNING PL',
  'FAIROAKS ST': 'FAIR OAKS ST', 'JFK ST': 'JOHN F KENNEDY ST', 'MT AUBURN ST': 'MOUNT AUBURN ST', 'B RDWY': 'BROADWAY' };
const ORD = { '1ST': 'FIRST', '2ND': 'SECOND', '3RD': 'THIRD', '4TH': 'FOURTH', '5TH': 'FIFTH', '6TH': 'SIXTH', '7TH': 'SEVENTH',
  '8TH': 'EIGHTH', '9TH': 'NINTH' };
// One spelling per street: "Alberta Terr" and "ALBERTA TER" → "ALBERTA TER", "3rd St" → "THIRD ST" (the centerline's).
export function streetKey(s) {
  const w = String(s || '').toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).map((x) => ORD[x] || x);
  if (w.length > 1 && TYPE[w[w.length - 1]]) w[w.length - 1] = TYPE[w[w.length - 1]];
  const k = w.join(' ');
  return ALIAS[k] || k;
}
// The name without its type: "ELM ST N" and "ELM ST" → "ELM", "GROVE AVE" → "GROVE".
export const baseName = (key) => key.replace(/ [NSEW]$/, '').replace(/ (ST|AVE|RD|PL|TER|CT|DR|LN|PK|CIR|SQ|HWY|BLVD|PKWY|WAY)$/, '');

// A ticket's location: "127 willow st" → { num: 127, street: 'WILLOW ST' }; "plympton st&memorial dr" → { cross: [...] }
export function ticketPlace(loc) {
  const s = String(loc || '').trim();
  if (s.includes('&')) return { cross: s.split('&').map((x) => streetKey(x)).filter(Boolean) };
  const m = /^(\d+)[A-Z]?(?:-\d+[A-Z]?)?\s+(.+)$/i.exec(s);
  return m ? { num: +m[1], street: streetKey(m[2]) } : null;
}

// ---------- block sides ---------------------------------------------------------------------------------------------

const parity = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n % 2 : null; };
const RANGE = { L: ['l_from', 'l_to'], R: ['r_from', 'r_to'] };
const hasRange = (p, side) => parseInt(p[RANGE[side][0]], 10) > 0 && parseInt(p[RANGE[side][1]], 10) > 0;
// Which parity (1 odd, 0 even) a side's address range holds, from its first number (the centerline's), else null.
export const sideParity = (p, side) => parity(p[RANGE[side][0]]) ?? parity(p[RANGE[side][1]]);
// Which side of a centerline segment has the odd numbers, when the ranges say (L or R, looking first → last point).
export function oddSide(p) {
  const l = sideParity(p, 'L'), r = sideParity(p, 'R');
  return l === 1 && r !== 1 ? 'L' : r === 1 && l !== 1 ? 'R' : null;
}
// A house number → the segment and side whose range holds it, on the side of its parity. `slack`: how far outside a
// range a number may be (the tickets' numbers are typed); `near(s)`: meters from the address to a segment, to choose
// between ranges that both hold the number.
export function placeNumber(segs, num, { slack = 0, near = null } = {}) {
  let best = null;
  for (const s of segs) for (const side of ['L', 'R']) {
    if (!hasRange(s.p, side) || sideParity(s.p, side) !== num % 2) continue;
    const lo = parseInt(s.p[RANGE[side][0]], 10), hi = parseInt(s.p[RANGE[side][1]], 10);
    const d = Math.max(0, Math.min(lo, hi) - num, num - Math.max(lo, hi));
    if (d > slack) continue;
    const m = near ? near(s) : 0;
    if (!best || d < best.d || (d === best.d && m < best.m)) best = { d, m, s, side };
  }
  return best;
}
// The district of a side from its addresses' districts ({ D: 5, B: 2 }) and the number of its addresses with none: the
// district at least `min` of all its addresses have, else null.
export const MIN_SHARE = 0.75;
export function sideDistrict(counts, none = 0, min = MIN_SHARE) {
  const [top] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0) + none;
  return top && top[1] / total >= min ? { district: top[0], share: Math.round(top[1] / total * 1000) / 1000 } : null;
}

// ---------- geometry ------------------------------------------------------------------------------------------------

const LAT0 = 42.375, LON0 = -71.11, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
// Meters from a point to a line, and which side of it the point lies on (L = left looking first → last point).
export function nearestOnLine(c, pt) {
  const [px, py] = xy(pt);
  let best = null;
  for (let i = 1; i < c.length; i++) {
    const [x1, y1] = xy(c[i - 1]), [x2, y2] = xy(c[i]), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    const d = Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
    if (!best || d < best.d) best = { d, side: dx * (py - y1) - dy * (px - x1) > 0 ? 'L' : 'R' };
  }
  return best;
}
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
// The compass word for side L or R of a line looking from its first point to its last (as in scripts/cities/boston.mjs).
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
const flip = (s) => (s === 'L' ? 'R' : 'L');
// A segment whose address ranges are on the wrong sides of its line (scripts/cities/norfolk.mjs): of its addresses
// within 40 m, at least 3 lie on the other side from the one their numbers give, and more than four times as many as agree.
export const flippedRanges = ({ ok, bad }) => bad >= 3 && bad > 4 * ok;

// ---------- the build -----------------------------------------------------------------------------------------------

export const SHIP_SHARE = 0.9;
export const WINDOW = [8, 12];    // the hours most streets post (the City, October 2026); the sign decides
const SOURCES = {
  schedule: 'https://data.cambridgema.gov/resource/uvf3-2xt3.json?$limit=1000',
  scheduleMeta: 'https://data.cambridgema.gov/api/views/uvf3-2xt3.json',
  centerline: 'https://data.cambridgema.gov/resource/3d3q-sfd6.geojson?$limit=50000&$order=:id',
  addresses: 'https://data.cambridgema.gov/resource/vup6-kpwv.json?$select=address_id,street_number,stname,latitude,longitude,type,neighborhood,street_sweeping_district&$limit=100000&$order=address_id',
  tickets: "https://data.cambridgema.gov/resource/vnxa-cuyr.json?$select=ticket_issue_date,issue_time,location,location_type&$where=violation_code='S1' AND ticket_issue_date>='2025-01-01' AND ticket_issue_date<'2026-01-01'&$order=:id&$limit=50000",
  cityPage: 'https://www.cambridgema.gov/services/streetcleaning',
};

// The City's street cleaning holidays (the "Holiday List and Closures" on the City's page, read 2026-10-18), with the
// make-up day each sweep moves to: the schedule's dates must agree. The day after Thanksgiving and Christmas Eve say
// "No changes": regular sweeping. 2027 is not posted yet: the same holidays by the same rules (observed on Friday or Monday).
const HOLIDAYS = [
  ['2026-04-20', "Patriots' Day", '2026-04-29'], ['2026-05-25', 'Memorial Day', '2026-05-29'], ['2026-06-19', 'Juneteenth', '2026-06-29'],
  ['2026-07-03', 'Independence Day (observed)', '2026-06-30'], ['2026-09-07', 'Labor Day', '2026-08-31'],
  ['2026-10-12', "Indigenous Peoples' Day", '2026-09-29'], ['2026-11-11', 'Veterans Day', '2026-10-29'],
  ['2026-11-26', 'Thanksgiving Day', '2026-11-30'], ['2026-12-25', 'Christmas Day', '2026-12-29'],
  ['2027-04-19', "Patriots' Day"], ['2027-05-31', 'Memorial Day'], ['2027-06-18', 'Juneteenth (observed)'],
  ['2027-07-05', 'Independence Day (observed)'], ['2027-09-06', 'Labor Day'], ['2027-10-11', "Indigenous Peoples' Day"],
  ['2027-11-11', 'Veterans Day'], ['2027-11-25', 'Thanksgiving Day'], ['2027-12-24', 'Christmas Day (observed)'],
];

async function main() {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const OUT = ROOT + 'data/cambridge/', CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/cambridge/';
  const REFRESH = process.argv.includes('--refresh');
  const log = (...a) => console.error('[cambridge]', ...a);
  const UA = { 'User-Agent': 'curb-cambridge-build (+https://curb.guide)' };
  async function cached(name, url, kind = 'json') {
    const f = CACHE + name;
    if (REFRESH || !fs.existsSync(f)) {
      log(`fetching ${name}…`);
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    }
    const b = fs.readFileSync(f);
    return kind === 'json' ? JSON.parse(b.toString('utf8')) : b.toString('utf8');
  }
  const fetched = (name) => fs.statSync(CACHE + name).mtime.toISOString().slice(0, 10);   // when the cached copy was downloaded

  // 1. inputs
  const scheduleRows = await cached('schedule.json', SOURCES.schedule);
  const scheduleMeta = await cached('schedule-meta.json', SOURCES.scheduleMeta);
  const centerline = await cached('centerline.geojson', SOURCES.centerline);
  const addresses = await cached('addresses.json', SOURCES.addresses);
  const tickets = await cached('tickets-2025.json', SOURCES.tickets);
  const cityPage = await cached('city-page.html', SOURCES.cityPage, 'text');
  const pageText = cityPage.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  for (const [d, name, mk] of HOLIDAYS) {
    if (!mk) continue;
    const day = new Date(mk + 'T12:00:00Z'), month = day.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
    if (!new RegExp(`rescheduled (?:to )?${month} ${day.getUTCDate()}(?:st|nd|rd|th)?\\b`).test(pageText))
      throw new Error(`the City's holiday list changed (no make-up day ${mk} for ${name} ${d}): update HOLIDAYS`);
  }
  if (!/\$100 per violation/.test(pageText)) throw new Error('the City page no longer says "$100 per violation": check the fine');
  const makeUp = Object.fromEntries(HOLIDAYS.filter((h) => h[2]).map(([d, , mk]) => [d, mk]));
  const { lists, days, moved, other } = scheduleLists(scheduleRows, makeUp);
  const holidaySet = new Set(HOLIDAYS.map((h) => h[0]));
  for (const [k, v] of Object.entries(lists)) for (const iso of v) if (holidaySet.has(iso)) throw new Error(`the schedule sweeps ${k} on a City holiday, ${iso}: CURB would drop that date`);
  if (centerline.features.length < 2400 || centerline.features.length > 2900) throw new Error(`centerline: ${centerline.features.length} segments, expected about 2,628`);
  if (addresses.length < 19000 || addresses.length > 23000) throw new Error(`Master Addresses List: ${addresses.length} rows, expected about 20,874`);
  if (!addresses.some((a) => 'street_sweeping_district' in a)) throw new Error('Master Addresses List: no street_sweeping_district field');
  log(`${scheduleRows.length} schedule rows (${moved.length} make-up days, ${other.length} other moved dates), ${centerline.features.length} centerline segments, ${addresses.length} addresses, ${tickets.length} tickets`);

  // 2. the centerline
  const segs = [], byStreet = new Map(), nodeStreets = new Map(), idCount = new Map();
  const nid = (v, c) => (v != null && v !== '' ? String(parseFloat(v)) : c[0].toFixed(6) + ',' + c[1].toFixed(6));
  for (const f of centerline.features) {
    const p = f.properties, parts = f.geometry && f.geometry.coordinates;
    if (!parts || !parts.length || !p.street) continue;
    const c = parts.length === 1 ? parts[0] : parts.flat();                   // one segment has two touching parts
    if (c.length < 2) continue;
    const s = { id: p.id, p, c, key: streetKey(p.street), name: p.street, a: nid(p.fromnode, c[0]), b: nid(p.tonode, c[c.length - 1]) };
    segs.push(s);
    idCount.set(s.id, (idCount.get(s.id) || 0) + 1);
    if (!byStreet.has(s.key)) byStreet.set(s.key, []);
    byStreet.get(s.key).push(s);
    for (const n of [s.a, s.b]) {
      if (!nodeStreets.has(n)) nodeStreets.set(n, new Set());
      nodeStreets.get(n).add(s.key);
    }
  }
  // A ticket's street the centerline doesn't name → the one street with the same name and another type ("Grove St" → Grove Ave).
  const resolve = (key) => {
    if (byStreet.has(key)) return key;
    const hits = [...byStreet.keys()].filter((k) => baseName(k) === baseName(key));
    return hits.length === 1 ? hits[0] : null;
  };

  // 3. addresses → block sides
  const placed = [], addr = { noNumber: 0, streetNotOnCenterline: 0, numberInNoRange: 0, placed: 0 };
  const notOnCenterline = new Map();
  for (const a of addresses) {
    const num = parseInt(a.street_number, 10);
    if (!(num > 0)) { addr.noNumber++; continue; }
    const key = streetKey(a.stname), cands = byStreet.get(key);
    if (!cands) { addr.streetNotOnCenterline++; notOnCenterline.set(a.stname, (notOnCenterline.get(a.stname) || 0) + 1); continue; }
    const pt = [+a.longitude, +a.latitude], hasPt = pt.every((v) => Number.isFinite(v) && v !== 0);
    const at = placeNumber(cands, num, { near: hasPt ? (s) => nearestOnLine(s.c, pt).d : null });
    if (!at) { addr.numberInNoRange++; continue; }
    addr.placed++;
    placed.push({ a, at, geo: hasPt ? nearestOnLine(at.s.c, pt) : null });
  }
  // Segments whose ranges sit on the wrong sides of the line: there the address points decide, and the tickets follow.
  const vote = new Map();
  for (const { at, geo } of placed) {
    if (!geo || geo.d >= 40) continue;
    const v = vote.get(at.s) || { ok: 0, bad: 0 };
    geo.side === at.side ? v.ok++ : v.bad++;
    vote.set(at.s, v);
  }
  const flipped = new Set([...vote].filter(([, v]) => flippedRanges(v)).map(([s]) => s));
  const sideOf = (at) => (flipped.has(at.s) ? flip(at.side) : at.side);
  const sides = new Map();        // segment → L|R → { counts: { district: n }, none, parity }
  const hoods = new Map();        // segment → { neighborhood: addresses }
  for (const { a, at } of placed) {
    if (!sides.has(at.s)) { sides.set(at.s, {}); hoods.set(at.s, {}); }
    const t = (sides.get(at.s)[sideOf(at)] ||= { counts: {}, none: 0, parity: null }), d = a.street_sweeping_district, h = hoods.get(at.s);
    if (d) t.counts[d] = (t.counts[d] || 0) + 1; else t.none++;
    t.parity = parseInt(a.street_number, 10) % 2;
    if (a.neighborhood) h[a.neighborhood] = (h[a.neighborhood] || 0) + 1;
  }

  // 4. block sides → districts and rules
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const limitsOf = (s) => {
    const at = (n) => [...nodeStreets.get(n)].filter((k) => k !== s.key).map((k) => byStreet.get(k)[0].name).sort()[0] || '';
    const a = at(s.a), b = at(s.b);
    return a && b && a !== b ? `${a} - ${b}` : a || b;
  };
  const leftOut = {}, leftOutWhy = new Map();   // reason → examples; "segment id|side" → reason (for the tickets there)
  const leave = (s, side, why, more = '') => {
    (leftOut[why] ||= []).push(`${s.name} (${s.id}, ${side})${more}`);
    leftOutWhy.set(s.id + '|' + side, why);
  };
  const assigned = new Map();     // segment → L|R → { district, share, parity, list }
  const sideCounts = { withAddresses: 0, oneDistrict: 0, byMajority: 0 };
  for (const s of segs) {
    const t = sides.get(s) || {};
    for (const side of ['L', 'R']) {
      const x = t[side];
      if (!x) { if (hasRange(s.p, side)) leave(s, side, 'no address on this side'); continue; }
      sideCounts.withAddresses++;
      const pick = sideDistrict(x.counts, x.none);
      if (!pick) {
        const counts = [...Object.entries(x.counts).map(([d, n]) => `${d} ${n}`), ...(x.none ? [`none ${x.none}`] : [])].join(', ');
        leave(s, side, Object.keys(x.counts).length ? 'addresses split between districts' : "no street cleaning district on this side's addresses", ': ' + counts);
        continue;
      }
      if (idCount.get(s.id) > 1) { leave(s, side, 'segment id used twice in the centerline'); continue; }   // a block id must be unique
      pick.share === 1 ? sideCounts.oneDistrict++ : sideCounts.byMajority++;
      if (!assigned.has(s)) assigned.set(s, {});
      assigned.get(s)[side] = { district: pick.district, share: pick.share, parity: x.parity, list: `${pick.district}-${x.parity ? 'odd' : 'even'}` };
    }
  }
  const out = [...assigned].map(([s, by]) => {
    const nums = ['l_from', 'l_to', 'r_from', 'r_to'].map((k) => parseInt(s.p[k], 10)).filter((v) => v > 0);
    const o0 = oddSide(s.p), o = o0 && (flipped.has(s) ? flip(o0) : o0);
    const h = Object.entries(hoods.get(s)).sort((a, b) => b[1] - a[1])[0];
    return { c: s.id, s: s.name, l: limitsOf(s), ...(h ? { h: h[0] } : {}), ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}),
      ...(o ? { o } : {}), g: s.c.map(([lo, la]) => [r6(lo), r6(la)]),
      d: Object.entries(by).sort().map(([side, x]) => [side, compass(s.c, side), [[-1, WINDOW[0], WINDOW[1], 0, 0, 0, lists[x.list]]]]) };
  }).sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));
  const sideTotal = out.reduce((n, b) => n + b.d.length, 0);
  log(`addresses placed ${addr.placed}/${addresses.length}; ${flipped.size} segments with ranges on the wrong side; ${out.length} blocks, ${sideTotal} block sides with a district; left out: ${Object.entries(leftOut).map(([k, v]) => `${v.length} ${k}`).join(', ')}`);

  // 5. the 2025 tickets against the schedule
  const sweptDay = (x, when) => !!x && days[x.list].nth === when.nth && days[x.list].dow === when.dow;
  const sweptAt = (x, when, hour) => sweptDay(x, when) && hour >= WINDOW[0] && hour < WINDOW[1];
  const sidesByStreet = new Map();
  for (const [s, by] of assigned) for (const x of Object.values(by)) {
    if (!sidesByStreet.has(s.key)) sidesByStreet.set(s.key, []);
    sidesByStreet.get(s.key).push(x);
  }
  const hours = { all: {}, regularDays: {}, makeUpDays: {} };
  const check = { tickets: tickets.length, corner: 0, makeUpDay: 0, noNumber: 0,
    streetLevel: { tickets: 0, match: 0, streetNotSwept: 0 },
    sideLevel: { tickets: 0, match: 0 },
    blockLevel: { tickets: 0, match: 0, dayNotHour: 0, otherSide: 0, otherDay: 0, sideLeftOut: 0, sideLeftOutWhy: {} },
    notPlaced: 0 };
  const byDistrict = {}, byList = {}, misses = new Map();   // misses: street and what went wrong → tickets
  const miss = (k) => misses.set(k, (misses.get(k) || 0) + 1);
  for (const t of tickets) {
    const [hh, mm] = String(t.issue_time || '0:0').split(':').map(Number), hour = hh + (mm || 0) / 60;
    const when = nthWeekday(t.ticket_issue_date);
    const bucket = when.nth === 5 ? hours.makeUpDays : hours.regularDays;
    hours.all[hh] = (hours.all[hh] || 0) + 1;
    bucket[hh] = (bucket[hh] || 0) + 1;
    const pl = ticketPlace(t.location);
    if (pl && pl.cross) { check.corner++; continue; }
    if (!pl) { check.noNumber++; continue; }
    if (when.nth === 5) { check.makeUpDay++; continue; }                   // no regular sweep on a 5th weekday: a make-up day
    const key = resolve(pl.street), onStreet = (key && sidesByStreet.get(key)) || [];
    check.streetLevel.tickets++;
    if (!onStreet.length) check.streetLevel.streetNotSwept++;
    if (onStreet.some((x) => sweptAt(x, when, hour))) check.streetLevel.match++;
    const at = key && placeNumber(byStreet.get(key), pl.num, { slack: 20 });
    if (!at) { check.notPlaced++; continue; }
    const sideOn = onStreet.filter((x) => x.parity === pl.num % 2);
    if (sideOn.length) { check.sideLevel.tickets++; if (sideOn.some((x) => sweptAt(x, when, hour))) check.sideLevel.match++; }
    const b = check.blockLevel, side = sideOf(at), here = assigned.get(at.s)?.[side], there = assigned.get(at.s)?.[flip(side)];
    b.tickets++;
    if (!here) {
      b.sideLeftOut++;
      const why = leftOutWhy.get(at.s.id + '|' + side) || 'no address range on this side';
      b.sideLeftOutWhy[why] = (b.sideLeftOutWhy[why] || 0) + 1;
      miss(`${at.s.name}: a side not on the map (${why})`);
      continue;
    }
    const d = (byDistrict[here.district] ||= { tickets: 0, match: 0 }), l = (byList[here.list] ||= { tickets: 0, onItsDay: 0, otherDays: {} });
    d.tickets++; l.tickets++;
    if (sweptDay(here, when)) {
      l.onItsDay++;
      if (sweptAt(here, when, hour)) { b.match++; d.match++; } else b.dayNotHour++;
      continue;
    }
    const k = `${when.nth} ${DOWS[when.dow]}`;
    l.otherDays[k] = (l.otherDays[k] || 0) + 1;
    sweptAt(there, when, hour) ? b.otherSide++ : b.otherDay++;
    miss(`${at.s.name}, ${here.list} (${days[here.list].words}): ticketed on a ${k}`);
  }
  const pct = (a, b) => (b ? Math.round(a / b * 1000) / 1000 : null);
  const sl = check.streetLevel, sd = check.sideLevel, bl = check.blockLevel;
  const blockShare = pct(bl.match, bl.tickets), ship = blockShare >= SHIP_SHARE;
  log(`2025 tickets at an address, not on a make-up day: street ${sl.match}/${sl.tickets} (${(pct(sl.match, sl.tickets) * 100).toFixed(1)}%), street + side ${sd.match}/${sd.tickets} (${(pct(sd.match, sd.tickets) * 100).toFixed(1)}%), block side ${bl.match}/${bl.tickets} (${(blockShare * 100).toFixed(1)}%) land where the schedule sweeps that day, ${WINDOW[0]} to ${WINDOW[1]}`);
  const after = (h) => Object.entries(h).reduce((n, [k, v]) => n + (+k >= WINDOW[1] ? v : 0), 0);
  const before = (h) => Object.entries(h).reduce((n, [k, v]) => n + (+k < WINDOW[0] ? v : 0), 0);
  const total = (h) => Object.values(h).reduce((a, b) => a + b, 0);
  log(`ticket hours: ${JSON.stringify(hours.all)}; after noon on regular days ${after(hours.regularDays)}/${total(hours.regularDays)}, before 8 AM ${before(hours.all)}`);

  // 6. write
  const sources = [
    { name: 'Street Sweeping Schedule (Public Works, 2026)', url: 'https://data.cambridgema.gov/Public-Works/Street-Sweeping-Schedule/uvf3-2xt3', license: 'ODC PDDL', fetched: fetched('schedule.json') },
    { name: 'Master Addresses List (street cleaning district of each address)', url: 'https://data.cambridgema.gov/Addresses/Master-Addresses-List/vup6-kpwv', license: 'ODC PDDL', fetched: fetched('addresses.json') },
    { name: 'Street Centerline', url: 'https://data.cambridgema.gov/Basemap/Street-Centerline/3d3q-sfd6', license: 'ODC PDDL', fetched: fetched('centerline.geojson') },
    { name: 'Cambridge Parking Tickets (2025, street cleaning)', url: 'https://data.cambridgema.gov/Traffic-Parking-and-Transportation/Cambridge-Parking-Tickets/vnxa-cuyr', license: 'ODC PDDL', fetched: fetched('tickets-2025.json') },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  const segFile = OUT + 'segments.json';
  if (ship) {
    fs.writeFileSync(segFile, JSON.stringify({ _meta: { city: 'cambridge', time_zone: 'America/New_York', generated: new Date().toISOString(), sources: sources.slice(0, 3),
      blocks: out.length, sides: sideTotal, format: 'b[] = {c: centerline segment id, s: street, l: cross streets, h: neighborhood, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
        + `rule = [-1, fromH, toH, 0, 0, flags, [local dates YYYY-MM-DD]]: no parking ${WINDOW[0]} to ${WINDOW[1]} on each date the City lists for the side's street cleaning district and its odd or even numbers (2026, make-up days included)` }, b: out }));
  } else if (fs.existsSync(segFile)) fs.unlinkSync(segFile);                // never leave a map the check turned down
  const bb = segs.flatMap((s) => s.c).reduce((b, [lo, la]) => [Math.min(b[0], la), Math.min(b[1], lo), Math.max(b[2], la), Math.max(b[3], lo)], [90, 180, -90, -180]);
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const city = {
    id: 'cambridge', name: 'Cambridge', region: 'Massachusetts', tz: 'America/New_York',
    center: [42.3736, -71.1097], zoom: 14, bounds: [[r4(bb[0]), r4(bb[1])], [r4(bb[2]), r4(bb[3])]],
    holidays: Object.fromEntries(HOLIDAYS.map(([d, n]) => [d, n])),
    holidaysSource: SOURCES.cityPage, holidayRule: 'all',
    fine: '$100', tow: 'no', fineSource: SOURCES.cityPage,
    agency: 'Cambridge Department of Public Works', scheduleUrl: SOURCES.cityPage,
    sources,
    words: {
      rule: 'Each side of a residential street is swept once a month, April to December, on the day on its signs (like "2nd Thursday"), 8 AM to noon on most streets.',
      afterpass: 'April to December. $100 ticket, no tow. A sweep that falls on a City holiday moves to a make-up day, and the dates here include it. A few streets post other hours: the sign decides.',
      dataNotes: "Dates from the City's 2026 Street Sweeping Schedule (Public Works, on the City's open data), which gives each street cleaning district's odd and even sides their own day, holiday make-up days included. Each block side takes the district of its addresses in the City's Master Addresses List, placed by the City's street centerline address ranges. The City publishes no hours: most streets are 8 AM to noon, so the posted sign decides.",
    },
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1));
  const ex = (list) => ({ count: list.length, examples: list.slice(0, 8) });
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`);
  const report = {
    generated: new Date().toISOString(),
    verdict: ship ? 'shipped' : `not shipped: under ${SHIP_SHARE * 100}% of the 2025 tickets land where the schedule sweeps (see ticketCheck)`,
    shipRule: `segments.json is written only when at least ${SHIP_SHARE * 100}% of the 2025 street cleaning tickets placed on a block side land on a side the schedule sweeps that day, ${WINDOW[0]} to ${WINDOW[1]} (a side left off the map counts as a miss)`,
    inputs: { scheduleRows: scheduleRows.length, scheduleUpdated: scheduleMeta.rowsUpdatedAt ? new Date(scheduleMeta.rowsUpdatedAt * 1000).toISOString().slice(0, 10) : null,
      addresses: addresses.length, centerlineSegments: centerline.features.length, tickets2025: tickets.length },
    schedule: {
      what: 'One date list per street cleaning district and side (odd or even house numbers), April to December 2026, as the City lists them; every block side with that district and parity gets the list',
      days: Object.fromEntries(Object.entries(days).map(([k, v]) => [k, v.words])),
      makeUpDays: moved.map((m) => `${m.list} (${m.day}): ${m.regular} → ${m.listed}`),
      otherMovedDates: other.map((m) => `${m.list} (${m.day}): ${m.regular} → ${m.listed}, holiday_adjustments "${m.holidayAdjustments}", ${m.regular} is no City holiday`),
      hours: `${WINDOW[0]} to ${WINDOW[1]} everywhere: the City publishes no hours and says most streets are 8 AM to noon and a few differ; the posted sign decides`,
      dataCovers: '2026 only: the City posts each year\'s dates; after the last 2026 date the map has no next sweep until the 2027 schedule is built',
    },
    placement: {
      addresses: { ...addr, streetsNotOnCenterline: top(notOnCenterline, 12) },
      segmentsWithRangesOnTheWrongSide: [...flipped].map((s) => `${s.name} (${s.id}): ${vote.get(s).bad} addresses on the other side, ${vote.get(s).ok} on the numbers' side`),
      sideRule: `A block side takes the street cleaning district of at least ${MIN_SHARE * 100}% of its addresses (addresses with no district count against it); otherwise it is left off the map`,
      sidesWithAddresses: sideCounts.withAddresses, sidesOneDistrict: sideCounts.oneDistrict, sidesByMajority: sideCounts.byMajority,
      majorityExamples: [...assigned].flatMap(([s, by]) => Object.entries(by).filter(([, x]) => x.share < 1).map(([side, x]) => `${s.name} (${s.id}, ${side}): ${x.district} ${Math.round(x.share * 100)}%`)),
      leftOut: Object.fromEntries(Object.entries(leftOut).map(([k, v]) => [k, ex(v)])),
    },
    output: { blocks: out.length, sides: sideTotal, rules: sideTotal, dateLists: Object.keys(lists).length, written: ship, sizeBytes: ship ? fs.statSync(segFile).size : 0 },
    ticketHours: {
      what: 'Every 2025 street cleaning ticket by the hour it was written (local time)',
      byHour: hours.all, beforeWindow: before(hours.all), afterNoon: after(hours.all),
      regularDays: { tickets: total(hours.regularDays), afterNoon: after(hours.regularDays), afterNoonShare: pct(after(hours.regularDays), total(hours.regularDays)) },
      makeUpDays: { tickets: total(hours.makeUpDays), afterNoon: after(hours.makeUpDays) },
    },
    ticketCheck: {
      what: "2025 street cleaning tickets (violation S1) against the schedule: is the ticket on a street, a street side (its house number's parity) and a block side the schedule sweeps on that weekday of that week, 8 AM to noon? The 2026 lists are read by their day on the signs (\"1st Wed\") on 2025's calendar; 5th weekdays, where only make-up days fall, are left out.",
      ...check,
      shares: { street: pct(sl.match, sl.tickets), streetAndSide: pct(sd.match, sd.tickets), blockSide: blockShare },
      notes: 'corner = written at an intersection, side unknown; makeUpDay = written on a 5th weekday of a month (days 29 to 31); notPlaced = the house number is in no centerline address range, within 20 (counted at street level only); streetNotSwept = no side of that street is on the map; blockLevel: dayNotHour = swept that day, the ticket outside 8 to 12; otherSide = the other side of the block is swept then; otherDay = the side is swept on another day; sideLeftOut = the side is not on the map (see placement.leftOut)',
      byDistrict: Object.fromEntries(Object.entries(byDistrict).sort().map(([d, v]) => [d, { ...v, share: pct(v.match, v.tickets) }])),
      missesByStreet: top(misses, 20),
      byList: Object.fromEntries(Object.entries(byList).sort().map(([k, v]) => [k, { day: days[k].words, tickets: v.tickets, onItsDay: v.onItsDay, share: pct(v.onItsDay, v.tickets),
        otherDays: Object.fromEntries(Object.entries(v.otherDays).sort((a, b) => b[1] - a[1]).slice(0, 3)) }])),
    },
    holidays: { rule: 'all', makeUpDays: Object.fromEntries(HOLIDAYS.filter((h) => h[2]).map(([d, n, mk]) => [d, `${n} → ${mk}`])),
      note: "No sweeping on City holidays: the sweep moves to a make-up day (a 5th weekday), which the schedule's dates include. No listed date is a City holiday (the build checks)." },
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1));
  log(ship ? `wrote data/cambridge/segments.json (${out.length} blocks, ${Math.round(fs.statSync(segFile).size / 1024)} KB)` : `did NOT write segments.json: the ticket check is under ${SHIP_SHARE * 100}%`);
  for (const f of ['city.json', 'report.json']) log(`wrote data/cambridge/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
