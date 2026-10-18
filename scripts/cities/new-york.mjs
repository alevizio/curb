#!/usr/bin/env node
// New York City for CURB: alternate side parking (ASP), started 2026-10-18. The format is docs/multi-city/city-build.md,
// the research docs/multi-city/new-york.md. Builds data/new-york/ from the City's open data:
//
//   1. Parking Regulation Locations and Signs (DOT, data.cityofnewyork.us nfid-uabd, daily): every current sign order.
//      A broom sign ("NO PARKING (SANITATION BROOM SYMBOL) MONDAY THURSDAY 9AM-10:30AM") carries the ASP rule; its order
//      names a street, two cross streets and a compass side ("on E 115 St between Pleasant Ave and 1 Ave, north side").
//      No geometry, but 95% of signs have a point (State Plane feet, EPSG:2263) that sits on the street's centerline at
//      the sign's distance from the corner (about a meter from it), so it tells which line, never which side.
//   2. Centerline (CSCL, OTI, inkn-q76z, weekly): the street lines, with stable PHYSICALIDs, address ranges and the
//      DOF street code (b5sc) that parking tickets also carry.
//   3. 2020 Neighborhood Tabulation Areas (DCP, 9nt8-h7nd): the neighborhood name of each block.
//   4. The ASP suspension calendar (DOT, an .ics file per year): the days ASP is off.
//   5. Parking Violations Issued, Fiscal Year 2027 (DOF, pvqr-7yc4): a 1% sample of the code 21 (street cleaning)
//      tickets, to check the result against where and when tickets were written (report.json).
//
// The join: each block side (the signs of one order: street, cross streets, side) is a walk along its street's centerlines
// from the node where the first cross street meets it to the node where the second one does, choosing the walk that
// passes closest to the signs' points. Its rules go on the side of every line in the walk that faces the order's compass
// side. Street names CSCL spells differently are learned from where their signs stand. Block sides whose walk can't be
// found are placed sign by sign on the nearest line of their street.
//
// Writes data/new-york/segments.json (+ segments-<borough>.json, the same format one borough at a time, because the
// whole city is over the 6 MB the page should load at once), city.json and report.json.
//
// Run: node scripts/cities/new-york.mjs [--refresh]   (Node 18+; inputs cached in private/cache/new-york/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/new-york/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/new-york/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[new-york]', ...a);

const SODA = 'https://data.cityofnewyork.us/resource/';
const UA = 'curb-new-york-build (+https://curb.guide)';
// nyc.gov answers 403 to anything that does not look like a browser (checked 2026-10-18), so the calendar is read with one.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const ICS = (y) => `https://www.nyc.gov/html/dot/downloads/misc/${y}-alternate-side.ics`;
const ASP_PAGE = 'https://www.nyc.gov/html/dot/html/motorist/alternate-side-parking.shtml';

export const BOROUGHS = { 1: ['manhattan', 'Manhattan'], 2: ['bronx', 'Bronx'], 3: ['brooklyn', 'Brooklyn'], 4: ['queens', 'Queens'], 5: ['staten-island', 'Staten Island'] };
const BORO_CODE = { Manhattan: '1', Bronx: '2', Brooklyn: '3', Queens: '4', 'Staten Island': '5' };

// ---------- 1. sign texts → rules ------------------------------------------------------------------

const DAYW = { SUN: 0, SUNDAY: 0, MON: 1, MONDAY: 1, MODAY: 1, TUE: 2, TUES: 2, TUESDAY: 2, WED: 3, WEDNESDAY: 3, THU: 4,
  THUR: 4, THURS: 4, THURSDAY: 4, THURDAY: 4, THURSDA: 4, FRI: 5, FRIDAY: 5, FRIW: 5, SAT: 6, SATURDAY: 6 };
// Every other word a broom sign carries (typos included). A word outside this list and the days marks a design the
// parser has not seen: it is listed in report.json (parse.unknownWords) so a new kind of sign can't slip through.
const NOISE = new Set(['NO', 'NP', 'PARKING', 'SANITATION', 'SANITATIOJN', 'BROOM', 'BRROM', 'BROOMM', 'SYMBOL', 'SYMBOLS',
  'SYMB', 'OLS', 'MOON', 'STARS', 'STAR', 'HALF', 'NIGHT', 'REGULATION', 'W', 'SINGLE', 'ARROW', 'AND', 'DON', 'T', 'LITTER',
  'EXCEPT', 'THRU', 'TO']);

// A street cleaning sign: the broom symbol (also misspelled BRROM, BROOMM), or the old "(SANITATION SYMBOL)" wording.
export const isBroomSign = (desc) => /\bBR+O+M+\b|SANITATION SYMBOL/.test(String(desc || '').toUpperCase());

const TIME = String.raw`(MIDNIGHT|NOON|\d{1,2}(?::\d{2})?(?:\s*(?:A\s?M|P\s?M|M)\b)?)`;
const RANGE = new RegExp(TIME + String.raw`\s*(?:-|TO-?|\s)\s*` + TIME);
function clock(tok) {
  if (tok === 'MIDNIGHT') return { min: 0, mer: 'A', midnight: true };
  if (tok === 'NOON') return { min: 720, mer: 'P' };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(A\s?M|P\s?M|M)?$/.exec(tok.trim());
  if (!m || +m[1] > 12 || +(m[2] || 0) > 59) return null;
  return { h: +m[1], mi: +(m[2] || 0), mer: m[3] && m[3][0] !== 'M' ? m[3][0] : null };
}
const minutes = (c, mer) => (c.min !== undefined ? c.min : ((c.h % 12) + (mer === 'P' ? 12 : 0)) * 60 + c.mi);

// One broom sign's text → { days: [JS weekdays], from, to (minutes after midnight; to < from crosses midnight), night }
// or { error }. Days: "MONDAY THURSDAY", "TUES & FRI", "MONDAY-FRIDAY", "EXCEPT SUNDAY" (Monday to Saturday). Hours:
// "11:30AM-1PM", "11:30AM TO 1PM", "MIDNIGHT-3AM", "10:30AM-NOON"; a time without AM or PM ("8:30-10AM", the typo
// "11:30AM-1 M") takes the reading that gives the shortest window.
export function parseSign(desc) {
  const raw = String(desc || '').toUpperCase();
  if (!isBroomSign(raw)) return { error: 'not a broom sign' };
  const s = raw.split(/\(?\s*\b(?:SUPERSED|SUPESED|SEE\s+R7|DATED)/)[0]   // notes about other designs: "(SUPERSEDES SP-413C)"
    .replace(/\([^)]*\)/g, ' ')                                              // "(SANITATION BROOM SYMBOL)", "(MOON & STARS)"
    .replace(/<-+>?|-+>/g, ' ')                                              // arrows: <->, -->, <----->
    .replace(/THU RSDAY/g, 'THURSDAY').replace(/(\d)([AP]) M\b/g, '$1$2M');
  const r = RANGE.exec(s);
  const a = r && clock(r[1]), b = r && clock(r[2]);
  if (!a || !b) return { error: 'no hours' };
  let best = null;
  for (const ma of a.mer ? [a.mer] : ['A', 'P']) for (const mb of b.mer ? [b.mer] : ['A', 'P']) {
    const f = minutes(a, ma), t = b.midnight ? 1440 : minutes(b, mb), len = (((t - f) % 1440) + 1440) % 1440;
    if (len > 0 && (!best || len < best.len)) best = { f, t: t === 0 ? 1440 : t, len };
  }
  if (!best) return { error: 'no hours' };
  const rest = s.slice(0, r.index) + ' ' + s.slice(r.index + r[0].length);
  const words = rest.match(/[A-Z]+/g) || [];
  let days = new Set();
  const span = /\b([A-Z]+)\s*(?:-|THRU|TO)\s*([A-Z]+)\b/.exec(rest);
  if (span && DAYW[span[1]] !== undefined && DAYW[span[2]] !== undefined)
    for (let d = DAYW[span[1]]; ; d = (d + 1) % 7) { days.add(d); if (d === DAYW[span[2]]) break; }
  for (const w of words) if (DAYW[w] !== undefined) days.add(DAYW[w]);
  if (/\bEXCEPT\s+SUN(DAY)?\b/.test(rest)) days = new Set([1, 2, 3, 4, 5, 6]);
  const unknown = words.filter((w) => DAYW[w] === undefined && !NOISE.has(w));
  if (!days.size) return { error: 'no days', ...(unknown.length ? { unknown } : {}) };
  return { days: [...days].sort((x, y) => x - y), from: best.f, to: best.t, night: /MOON|NIGHT/.test(raw), ...(unknown.length ? { unknown } : {}) };
}

// Minutes → the format's time: whole hours as numbers (9, 13), others as "H:MM" ("9:30", "12:30"); 24 for a window
// that ends at midnight.
export const hm = (min) => (min % 60 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : min / 60);
// A parsed sign → its rules: [dow, from, to, every week, all year, flags 0 (ASP stops on the City's suspension days; a
// ticket, no tow)].
export const rulesOf = (p) => p.days.map((d) => [d, hm(p.from), hm(p.to), 31, 0, 0]);

// ---------- 2. street names ------------------------------------------------------------------------

const WORD = { STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', ROAD: 'RD', BOULEVARD: 'BLVD', PLACE: 'PL', PARKWAY: 'PKWY', PWAY: 'PKWY',
  DRIVE: 'DR', COURT: 'CT', LANE: 'LN', TERRACE: 'TER', EXPRESSWAY: 'EXPY', HIGHWAY: 'HWY', TURNPIKE: 'TPKE', CONCOURSE: 'CONC',
  CRESCENT: 'CRES', CIRCLE: 'CIR', PLAZA: 'PLZ', SQUARE: 'SQ', FREEWAY: 'FWY', EXTENSION: 'EXT', PROMENADE: 'PROM',
  ESPLANADE: 'ESPL', BRIDGE: 'BRG', TUNNEL: 'TUNL', BEACH: 'BCH', SAINT: 'ST', FORT: 'FT', MOUNT: 'MT', BKLYN: 'BROOKLYN',
  BX: 'BRONX', EAST: 'E', WEST: 'W', NORTH: 'N', SOUTH: 'S', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
  FIRST: '1', SECOND: '2', THIRD: '3', FOURTH: '4', FIFTH: '5', SIXTH: '6', SEVENTH: '7', EIGHTH: '8', NINTH: '9', TENTH: '10',
  ELEVENTH: '11', TWELFTH: '12', QNS: 'QUEENS', MANH: 'MANHATTAN', IS: 'ISLAND', NY: 'NEWYORK', EXPRESS: 'EXPY', EXPWY: 'EXPY',
  EXPRESSWY: 'EXPY', HEIGHTS: 'HTS', VILLAGE: 'VLG', RIDGE: 'RDG', GARDENS: 'GDNS' };
const TYPE_WORDS = new Set(['ST', 'AVE', 'RD', 'BLVD', 'PL', 'PKWY', 'DR', 'CT', 'LN', 'TER', 'EXPY', 'HWY', 'TPKE', 'CONC', 'CRES',
  'CIR', 'PLZ', 'SQ', 'FWY', 'LOOP', 'WAY', 'WALK', 'PATH', 'RDG', 'HTS', 'ALY', 'EXT', 'SLIP', 'ROW', 'OVAL', 'PROM', 'ESPL']);
const ROADWAY = /^(CTR|CENTER|RDWY|ROADWAY|SR|SERVICE|SVC|MAIN|MN|LEG)$/;
// One spelling per street, for both datasets, as words: "EAST  115 STREET" (signs) and "E  115 ST" (CSCL) → E 115 ST;
// "B   69 STREET" (Beach 69th) → BCH 69 ST.
export function streetWords(name) {
  const w = String(name || '').toUpperCase().replace(/[.,'’"()]/g, '').replace(/[-/]/g, ' ').trim().split(/\s+/).filter(Boolean)
    .map((x) => WORD[x] || x.replace(/^(\d+)(ST|ND|RD|TH)$/, '$1'));
  if (w[0] === 'B' && /^\d/.test(w[1] || '')) w[0] = 'BCH';
  return w;
}
// ... and as one key without spaces, so "MC CLELLAN STREET" and "MCCLELLAN ST" meet: MCCLELLANST
export const streetKey = (name) => streetWords(name).join('');
// The keys to try for a street a sign names, best first: with the roadway its suffix names ("ASTORIA BOULEVARD" + "N" =
// ASTORIA BLVD N, which CSCL has), as written, and without roadway words ("37 AVENUE CENTER ROADWAY", "ASCH LOOP NORTH").
export function nameVariants(name, suffix) {
  const w = streetWords(name), out = [];
  const dir = (/^(N|S|E|W)\b/.exec(norm(suffix)) || [])[1];
  if (dir) out.push([...w, dir].join(''));
  out.push(w.join(''));
  const core = w.filter((x, i) => i === 0 || !(ROADWAY.test(x) || (x === 'RD' && w[i - 1] === 'SERVICE')));
  out.push(core.join(''));
  if (core.length > 2 && /^(N|S|E|W)$/.test(core[core.length - 1])) out.push(core.slice(0, -1).join(''));
  return [...new Set(out)];
}
// the words that tell two street names apart (not "ST", "AVE", "N"…)
const distinct = (name) => new Set(streetWords(name).filter((x) => !TYPE_WORDS.has(x) && !/^(N|S|E|W|NE|NW|SE|SW|OF|THE|AND)$/.test(x) && (x.length >= 3 || /\d/.test(x))));
const levenshtein = (a, b) => {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
};
// How alike two street keys are (0 to 1). Keys that differ in their numbers are never alike: E 18 St is not E 19 St.
export function likeness(a, b) {
  if ((a.match(/\d+/g) || []).join() !== (b.match(/\d+/g) || []).join()) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);
}
// Two keys for the same street written differently: alike (one or two letters off: BEVERLY RD, BEVERLEY RD), one inside
// the other (CONDUIT AVE in N CONDUIT AVE, GRANDCONCOURSE for GRAND CONC) or the same name with another type (MOWBRAY PL,
// MOWBRAY DR). Numbers must agree. Only used among the streets that really meet the street, where a near miss is rare.
export function sameStreet(a, b) {
  const l = likeness(a, b);
  if (l >= 0.8) return l;
  if (!l) return 0;
  const [s, t] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= 6 && t.includes(s)) return 0.78;
  const base = (k) => k.replace(new RegExp('(' + [...TYPE_WORDS].join('|') + ')$'), '');
  if (base(a).length >= 5 && base(a) === base(b)) return 0.77;
  return 0;
}

const SMALL = new Set(['OF', 'THE', 'AND', 'DE', 'LA', 'VAN', 'VON']);
const ord = (n) => n + (/1[123]$/.test(n) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n.slice(-1)] || 'th');
const TYPES = new Set(['ST', 'AVE', 'RD', 'PL', 'DR', 'LN', 'CT', 'TER', 'BLVD', 'PKWY', 'WALK', 'LOOP', 'WAY', 'PATH', 'CIR', 'CRES', 'EXPY', 'HWY']);
// A CSCL label for people: "W 115 ST" → "W 115th St", "3 AVE" → "3rd Ave", "BCH 116 ST" → "Beach 116th St",
// "AVE J" → "Avenue J", "MC DONALD AVE" → "McDonald Ave", "AVE OF THE AMERICAS" → "Avenue of the Americas".
export function streetLabel(label) {
  const w = String(label || '').trim().split(/\s+/).filter(Boolean);
  if (w[0] === 'BCH') w[0] = 'BEACH';
  if (w[0] === 'AVE' && w.length > 1) w[0] = 'AVENUE';
  const cap = (x) => x[0] + x.slice(1).toLowerCase();
  for (let i = 0; i < w.length - 1; i++) if ((w[i] === 'MC' || w[i] === 'MAC') && /^[A-Z]{3,}$/.test(w[i + 1])) w.splice(i, 2, cap(w[i]) + cap(w[i + 1]));
  return w.map((x, i) => {
    if (/[a-z]/.test(x)) return x;                                   // McDonald, MacDougal: done above
    if (/^\d+$/.test(x) && (TYPES.has(w[i + 1]) || i === w.length - 1 && i > 0 && w[i - 1] !== 'AVENUE')) return ord(x);
    if (/^\d/.test(x)) return x.toLowerCase();
    if (i > 0 && SMALL.has(x)) return x.toLowerCase();
    if (/^MC[A-Z]{3,}$/.test(x)) return 'Mc' + cap(x.slice(2));
    if (/^O'[A-Z]/.test(x)) return "O'" + x[2] + x.slice(3).toLowerCase();
    if (/^(N|S|E|W|NE|NW|SE|SW|FDR|JFK|US|NYS)$/.test(x)) return x;
    return x[0] + x.slice(1).toLowerCase();
  }).join(' ');
}

// ---------- 3. EPSG:2263 (NAD83 / New York Long Island, US feet) → WGS84 -------------------------------

// Lambert conformal conic with two standard parallels on GRS80 (Snyder, Map Projections, 1987, pp. 104-110). NAD83 and
// WGS84 differ by about a meter here, less than the signs' own precision (whole feet). Checked against proj4 to 1e-7 m.
const D2R = Math.PI / 180, A = 6378137, FL = 1 / 298.257222101, E2 = FL * (2 - FL), EC = Math.sqrt(E2), FT = 1200 / 3937;
const lccM = (p) => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
const lccT = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - EC * Math.sin(p)) / (1 + EC * Math.sin(p))) ** (EC / 2);
const P1 = (41 + 2 / 60) * D2R, P2 = (40 + 40 / 60) * D2R, P0 = (40 + 10 / 60) * D2R, L0 = -74 * D2R, X0 = 300000;
const LN = (Math.log(lccM(P1)) - Math.log(lccM(P2))) / (Math.log(lccT(P1)) - Math.log(lccT(P2)));
const LF = lccM(P1) / (LN * lccT(P1) ** LN), R0 = A * LF * lccT(P0) ** LN;
export function toLngLat(xFt, yFt) {
  const x = xFt * FT - X0, y = R0 - yFt * FT;
  const t = (Math.hypot(x, y) / (A * LF)) ** (1 / LN), lng = Math.atan2(x, y) / LN + L0;
  let lat = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 8; i++) { const es = EC * Math.sin(lat); lat = Math.PI / 2 - 2 * Math.atan(t * ((1 - es) / (1 + es)) ** (EC / 2)); }
  return [lng / D2R, lat / D2R];
}

// ---------- 4. the ASP suspension calendar ---------------------------------------------------------

// An .ics from DOT → { "YYYY-MM-DD": "Holiday name" }. Events are all-day, DTEND exclusive (Eid al-Fitr: Mar 20 to 22 =
// two days); a day with two events gets both names.
export function parseIcs(text) {
  const out = {};
  const unfolded = String(text || '').replace(/\r?\n[ \t]/g, '');
  for (const ev of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const get = (k) => (new RegExp('^' + k + '[^:\\n]*:(.*)$', 'm').exec(ev) || [])[1];
    const start = /(\d{4})(\d{2})(\d{2})/.exec(get('DTSTART') || ''), end = /(\d{4})(\d{2})(\d{2})/.exec(get('DTEND') || '');
    if (!start) continue;
    const desc = (get('DESCRIPTION') || '').replace(/\\,/g, ',').replace(/\\n/g, ' ');
    let name = (/suspended for (.+?)\.(\s|$)/i.exec(desc) || [])[1] || (get('SUMMARY') || 'ASP suspended').trim();
    name = name.replace(/^the /i, '').replace(/[’]/g, "'").replace(/^(\w+) and (\w+) days of (.+)$/i, (m, a, b, c) => `${c} (${a.toLowerCase()} and ${b.toLowerCase()} days)`);
    name = name[0].toUpperCase() + name.slice(1);
    const d0 = Date.UTC(+start[1], +start[2] - 1, +start[3]), d1 = end ? Date.UTC(+end[1], +end[2] - 1, +end[3]) : d0 + 864e5;
    for (let d = d0; d < Math.max(d1, d0 + 864e5); d += 864e5) {
      const iso = new Date(d).toISOString().slice(0, 10);
      out[iso] = out[iso] && !out[iso].includes(name) ? `${out[iso]} and ${name}` : name;
    }
  }
  return Object.fromEntries(Object.entries(out).sort());
}

// ---------- 5. the join -----------------------------------------------------------------------------

const LAT0 = 40.7, LON0 = -73.95, KX = Math.cos(LAT0 * D2R) * 111320, KY = 110950;
export const xy = ([lng, lat]) => [(lng - LON0) * KX, (lat - LAT0) * KY];
const nodeId = ([lng, lat]) => lng.toFixed(6) + ',' + lat.toFixed(6);
const flip = (s) => (s === 'L' ? 'R' : 'L');
const COMPASS = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };
export const SIDE_WORD = { N: 'North', S: 'South', E: 'East', W: 'West' };
const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
const STREET_END = /^(DEAD ?END( STREET)?|CUL ?DE ?SAC|END|CITY LINE|(NASSAU )?COUNTY LINE|CITY LIMIT)$/;

// CSCL rows → segments: one per row, multipart lines joined (every part starts where the last one ended).
export function prepSegments(rows) {
  const segs = [];
  for (const r of rows) {
    const parts = r.the_geom && r.the_geom.coordinates;
    if (!parts || !parts.length) continue;
    const c = [];
    for (const p of parts) for (const q of p) { const l = c[c.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) c.push(q); }
    if (c.length < 2) continue;
    const pts = c.map(xy);
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    segs.push({ id: String(r.physicalid), boro: String(r.boroughcode), label: norm(r.stname_label || r.full_street_name),
      key: streetKey(r.full_street_name), rw: +r.rw_type, b5sc: r.b5sc, c, pts, len, a: nodeId(c[0]), b: nodeId(c[c.length - 1]),
      hn: [r.l_low_hn, r.l_high_hn, r.r_low_hn, r.r_high_hn] });
  }
  return segs;
}

function heapPush(h, x) { h.push(x); for (let i = h.length - 1; i > 0;) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) { h[0] = last; for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } }
  return top;
}
// distance from p to a polyline (all in meters) and whether the nearest point is an end of it
function toLine(p, pts) {
  let best = Infinity, at = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], dx = pts[i][0] - x1, dy = pts[i][1] - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2)) : 0;
    const d = Math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy);
    if (d < best) { best = d; at = i === 1 && t === 0 ? -1 : i === pts.length - 1 && t === 1 ? 1 : 0; }
  }
  return { d: best, end: at };
}
// L or R, looking along direction v, for a compass side; conf = how clearly (|sin| of the angle between v and the side).
function sideFor(v, compass) {
  const c = COMPASS[compass], len = Math.hypot(v[0], v[1]);
  if (!c || !len) return null;
  const dot = (c[0] * -v[1] + c[1] * v[0]) / len;
  return { side: dot > 0 ? 'L' : 'R', conf: Math.abs(dot) };
}

// The join. signs: rows of nfid-uabd (broom signs only); segs: prepSegments(). Returns the block sides found per segment
// index (`bySeg`), every block side's outcome (`orders`), and the street name aliases learned on the way.
export function joinSigns(signs, segs, { maxWalk = 3000 } = {}) {
  const nodeKeys = new Map(), atNode = new Map(), byKey = new Map(), boroKeys = new Set();
  segs.forEach((s, i) => {
    for (const n of [s.a, s.b]) {
      if (!nodeKeys.has(n)) { nodeKeys.set(n, new Set()); atNode.set(n, []); }
      nodeKeys.get(n).add(s.key); atNode.get(n).push(i);
    }
    if (!byKey.has(s.key)) byKey.set(s.key, []);
    byKey.get(s.key).push(i);
    boroKeys.add(s.boro + '|' + s.key);
  });
  // a grid of line pieces for "nearest line" lookups
  const CELL = 60, cell = (v) => Math.floor(v / CELL), grid = new Map();
  segs.forEach((s, si) => { for (let i = 1; i < s.pts.length; i++) {
    const [a, b] = [s.pts[i - 1], s.pts[i]];
    for (let cx = cell(Math.min(a[0], b[0])); cx <= cell(Math.max(a[0], b[0])); cx++)
      for (let cy = cell(Math.min(a[1], b[1])); cy <= cell(Math.max(a[1], b[1])); cy++) {
        const k = cx + ',' + cy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([si, i]);
      }
  } });
  function nearest(p, ok, R = 30) {
    let best = null;
    for (let cx = cell(p[0] - R); cx <= cell(p[0] + R); cx++) for (let cy = cell(p[1] - R); cy <= cell(p[1] + R); cy++)
      for (const [si, i] of grid.get(cx + ',' + cy) || []) {
        if (ok && !ok(segs[si])) continue;
        const a = segs[si].pts[i - 1], b = segs[si].pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
        const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
        if (d <= R && (!best || d < best.d)) best = { d, si, dir: [dx, dy] };
      }
    return best;
  }
  const nodeXY = (n) => xy(n.split(',').map(Number));

  // 5a. block sides: the signs of one place (borough, street, cross streets, side) together
  const places = new Map();
  for (const r of signs) {
    const k = [r.borough, norm(r.on_street), norm(r.on_street_suffix), norm(r.from_street), norm(r.from_street_suffix),
      norm(r.to_street), norm(r.to_street_suffix), r.side_of_street].join('|');
    if (!places.has(k)) places.set(k, { k, boro: BORO_CODE[r.borough], on: norm(r.on_street), onSuffix: norm(r.on_street_suffix),
      from: norm(r.from_street), fromSuffix: norm(r.from_street_suffix), to: norm(r.to_street), toSuffix: norm(r.to_street_suffix),
      side: r.side_of_street, orders: new Set(), signs: 0, pts: [], maxFt: 0, rules: new Map(), schedules: new Set() });
    const pl = places.get(k);
    pl.orders.add(r.order_number); pl.signs++;
    const p = parseSign(r.sign_description);
    if (!p.error) { pl.schedules.add(`${p.days.join('')}|${p.from}|${p.to}`); for (const rule of rulesOf(p)) pl.rules.set(rule.join('|'), rule); }
    if (+r.sign_x_coord && +r.sign_y_coord) pl.pts.push(xy(toLngLat(+r.sign_x_coord, +r.sign_y_coord)));
    pl.maxFt = Math.max(pl.maxFt, +r.distance_from_intersection || 0);
  }

  // 5b. street names the centerline spells differently ("ADAM C POWELL BOULEVARD" for ADAM CLAYTON POWELL JR BLVD, "6 AVENUE"
  // for AVE OF THE AMERICAS in Manhattan), learned from where that name's signs stand: each sign votes for the street of the
  // nearest line within 15 m. A name is taken when 70% of 2 or more signs agree and the two names share a word, or when 85%
  // of 8 or more agree (Willett St, renamed Bialystoker Pl). Every alias is listed in report.json.
  const known = (boro, k) => boroKeys.has(boro + '|' + k);
  const votes = new Map();
  for (const pl of places.values()) {
    if (nameVariants(pl.on, pl.onSuffix).some((k) => known(pl.boro, k))) continue;
    const id = pl.boro + '|' + streetKey(pl.on);
    if (!votes.has(id)) votes.set(id, { name: pl.on, n: 0, keys: new Map() });
    const v = votes.get(id);
    for (const p of pl.pts) { const h = nearest(p, null, 15); v.n++; if (h) v.keys.set(segs[h.si].key, (v.keys.get(segs[h.si].key) || 0) + 1); }
  }
  const alias = new Map(), aliases = [];
  for (const [id, v] of votes) {
    const top = [...v.keys].sort((x, y) => y[1] - x[1])[0];
    if (!top) continue;
    const label = segs[byKey.get(top[0])[0]].label, mine = distinct(v.name);
    const shares = [...distinct(label)].some((w) => mine.has(w)) || likeness(id.split('|')[1], top[0]) >= 0.6;
    if ((top[1] >= 2 && top[1] >= 0.7 * v.n && shares) || (top[1] >= 8 && top[1] >= 0.85 * v.n)) {
      alias.set(id, top[0]);
      aliases.push({ borough: BOROUGHS[id.split('|')[0]][1], sign: v.name, centerline: label, how: 'sign points', signs: v.n, agree: top[1] });
    }
  }
  // Names still unknown: the borough's one street with a near identical name (CHARLECOTTE RIDGE, CHARLECOTE RDG), when no
  // other comes close. Listed with the aliases. (The same name with another type is not enough: Belmont St in the Bronx is
  // not Belmont Ave.)
  const boroKeyList = new Map();
  for (const id of boroKeys) { const [b, k] = id.split('|'); if (!boroKeyList.has(b)) boroKeyList.set(b, []); boroKeyList.get(b).push(k); }
  for (const pl of places.values()) {
    const id = pl.boro + '|' + streetKey(pl.on);
    if (alias.has(id) || nameVariants(pl.on, pl.onSuffix).some((k) => known(pl.boro, k))) continue;
    const scored = (boroKeyList.get(pl.boro) || []).map((k) => [k, likeness(streetKey(pl.on), k)]).filter((x) => x[1] >= 0.85).sort((x, y) => y[1] - x[1]);
    if (scored.length && (scored.length === 1 || scored[0][1] - scored[1][1] >= 0.05)) {
      alias.set(id, scored[0][0]);
      aliases.push({ borough: BOROUGHS[pl.boro][1], sign: pl.on, centerline: segs[byKey.get(scored[0][0])[0]].label, how: 'similar name' });
    }
  }
  // a street name → the key to use: a variant the borough's centerline has, an alias, a variant anywhere in the city
  const resolve = (boro, name, suffix) => {
    const vs = nameVariants(name, suffix);
    for (const v of vs) if (known(boro, v)) return v;
    const a = alias.get(boro + '|' + streetKey(name));
    if (a) return a;
    return vs.find((v) => byKey.has(v)) || vs[0];
  };

  // 5c. each street's own graph: node → [[node, segment, cost, bridge]]. Bridges are short pieces of other streets (40 m or
  // less) between two nodes of this one: an offset intersection, where 141 St jogs 29 m along 78 Ave. A walk may cross them;
  // they never get the street's rules.
  const graphs = new Map();
  function graph(key) {
    if (graphs.has(key)) return graphs.get(key);
    const adj = new Map(), cross = new Map();
    for (const si of byKey.get(key) || []) {
      const s = segs[si];
      for (const [n, m] of [[s.a, s.b], [s.b, s.a]]) { if (!adj.has(n)) adj.set(n, []); adj.get(n).push([m, si, s.len, false]); }
    }
    const own = [...adj.keys()];
    for (const n of own) {
      for (const k of nodeKeys.get(n)) if (k !== key) { if (!cross.has(k)) cross.set(k, []); cross.get(k).push(n); }
      for (const si of atNode.get(n)) {
        const s = segs[si];
        if (s.key === key || s.len > 40) continue;
        const m = s.a === n ? s.b : s.a;
        if (m !== n && adj.has(m) && adj.get(m).some((e) => !e[3])) adj.get(n).push([m, si, s.len * 2, true]);
      }
    }
    const ends = own.filter((n) => adj.get(n).filter((e) => !e[3]).length === 1);
    const g = { key, adj, cross, ends, paths: new Map() };
    if (graphs.size > 400) graphs.clear();
    graphs.set(key, g);
    return g;
  }
  const boroOf = (n, g) => { const e = g.adj.get(n); return e && e.length ? segs[e[0][1]].boro : null; };
  const pieceGrids = new Map();
  // nodes of graph g within R meters of a line of street `key` (a cross street that passes near without meeting it: an
  // expressway in a trench, a street that stops a few meters short)
  function nearNodes(g, key, nodes, R = 60) {
    if (!pieceGrids.has(key)) {
      const pg = new Map();
      for (const si of byKey.get(key) || []) { const s = segs[si]; for (let i = 1; i < s.pts.length; i++) {
        const [a, b] = [s.pts[i - 1], s.pts[i]];
        for (let cx = cell(Math.min(a[0], b[0])); cx <= cell(Math.max(a[0], b[0])); cx++)
          for (let cy = cell(Math.min(a[1], b[1])); cy <= cell(Math.max(a[1], b[1])); cy++) { const k = cx + ',' + cy; if (!pg.has(k)) pg.set(k, []); pg.get(k).push([a, b]); }
      } }
      if (pieceGrids.size > 200) pieceGrids.clear();
      pieceGrids.set(key, pg);
    }
    const pg = pieceGrids.get(key), hits = [];
    for (const n of nodes) {
      const p = nodeXY(n);
      let best = Infinity;
      for (let cx = cell(p[0] - R); cx <= cell(p[0] + R); cx++) for (let cy = cell(p[1] - R); cy <= cell(p[1] + R); cy++)
        for (const [a, b] of pg.get(cx + ',' + cy) || []) {
          const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
          const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
          best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
        }
      if (best <= R) hits.push([n, best]);
    }
    if (!hits.length) return null;
    const min = Math.min(...hits.map((h) => h[1]));
    return hits.filter((h) => h[1] <= min + 15).map((h) => h[0]);
  }
  // where a cross street meets the street: by name, by a similar name among the streets that meet it, by the street's ends
  // ("DEAD END"), or as the node nearest a line of that street
  function crossNodes(g, name, suffix, boro, local) {
    if (STREET_END.test(name)) return g.ends.length ? { nodes: g.ends, how: 'street end' } : null;
    const vs = nameVariants(name, suffix), ali = alias.get(boro + '|' + streetKey(name));
    if (ali) vs.push(ali);
    for (const k of vs) if (g.cross.has(k)) return { nodes: g.cross.get(k), how: 'name' };
    let best = null;
    for (const [k2, nodes] of g.cross) {
      const l = Math.max(...vs.map((k) => sameStreet(k, k2)));
      if (l && (!best || l > best.l) && nodes.some(local)) best = { l, k2, nodes };
    }
    if (best) return { nodes: best.nodes, how: 'similar name', as: best.k2 };
    for (const k of vs) if (byKey.has(k)) {
      const nodes = nearNodes(g, k, [...g.adj.keys()].filter(local));
      if (nodes) return { nodes, how: 'near' };
    }
    return null;
  }
  function shortest(g, src) {
    if (g.paths.has(src)) return g.paths.get(src);
    const dist = new Map([[src, 0]]), prev = new Map(), heap = [[0, src]];
    while (heap.length) {
      const [d, n] = heapPop(heap);
      if (d > dist.get(n) || d > maxWalk) continue;
      for (const [m, si, cost] of g.adj.get(n)) {
        const nd = d + cost;
        if (nd < (dist.get(m) ?? Infinity)) { dist.set(m, nd); prev.set(m, [n, si]); heapPush(heap, [nd, m]); }
      }
    }
    const r = { dist, prev };
    g.paths.set(src, r);
    return r;
  }
  function walkTo(r, src, dst, key) {
    const path = [];
    for (let n = dst; n !== src;) { const [pn, si] = r.prev.get(n); path.unshift({ si, fwd: segs[si].a === pn, bridge: segs[si].key !== key }); n = pn; }
    return path;
  }
  const walkPts = (path) => {
    const out = [];
    for (const { si, fwd } of path) { const p = fwd ? segs[si].pts : [...segs[si].pts].reverse(); for (const q of (out.length ? p.slice(1) : p)) out.push(q); }
    return out;
  };

  // 5d. each block side → a walk → its lines and side
  const bySeg = new Map(), orders = [];
  const put = (si, side, label, pl) => {
    if (!bySeg.has(si)) bySeg.set(si, { L: null, R: null });
    const e = bySeg.get(si);
    if (!e[side]) e[side] = { labels: new Map(), rules: new Map(), places: [] };
    const t = e[side];
    t.labels.set(label, (t.labels.get(label) || 0) + 1);
    for (const [k, rule] of pl.rules) t.rules.set(k, rule);
    t.places.push(pl.k);
  };
  for (const pl of places.values()) pl.sortKey = streetKey(pl.on);
  const list = [...places.values()].sort((x, y) => (x.sortKey < y.sortKey ? -1 : x.sortKey > y.sortKey ? 1 : 0));
  const STRONG = new Set(['name', 'similar name', 'street end']);
  for (const pl of list) {
    const res = { k: pl.k, boro: pl.boro, on: pl.on, from: pl.from, to: pl.to, side: pl.side, signs: pl.signs, orders: pl.orders.size,
      withPoints: pl.pts.length, rules: pl.rules.size, schedules: pl.schedules.size };
    orders.push(res);
    if (!pl.rules.size) { res.how = 'none'; res.why = 'no readable schedule'; continue; }
    if (!COMPASS[pl.side]) { res.how = 'none'; res.why = 'no side of the street'; continue; }
    const key = resolve(pl.boro, pl.on, pl.onSuffix);
    if (!byKey.has(key)) { res.how = 'none'; res.why = 'street name not in the centerline'; continue; }
    const g = graph(key);
    // nodes worth considering: in the borough, or within 400 m of the block side's signs
    const local = (n) => {
      if (pl.pts.length) { const [x, y] = nodeXY(n); return pl.pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < 400); }
      return boroOf(n, g) === pl.boro;
    };
    const A = crossNodes(g, pl.from, pl.fromSuffix, pl.boro, local), B = crossNodes(g, pl.to, pl.toSuffix, pl.boro, local);
    // one end unknown: with sign points, walk from the known end to whichever node covers the signs
    const anyEnd = pl.pts.length ? { nodes: [...g.adj.keys()].filter(local), how: 'signs' } : null;
    const [EA, EB] = A && B ? [A, B] : A && anyEnd ? [A, anyEnd] : B && anyEnd ? [anyEnd, B] : [null, null];
    let best = null;
    // a block side is about as long as its farthest sign is from the corner: a walk far longer took a wrong turn
    const maxLen = 2.5 * pl.maxFt * 0.3048 + 250;
    if (EA && EB) {
      const minLen = pl.maxFt * 0.3048 - 20;
      const as = EA.nodes.filter(local).length ? EA.nodes.filter(local) : EA.nodes, bs = EB.nodes.filter(local).length ? EB.nodes.filter(local) : EB.nodes;
      for (const a of as) {
        const r = shortest(g, a);
        for (const b of bs) {
          if (b === a || !r.dist.has(b)) continue;
          const len = r.dist.get(b);
          if (len < minLen && !pl.pts.length) continue;
          const path = walkTo(r, a, b, key);
          if (path.every((x) => x.bridge)) continue;
          const pts = walkPts(path);
          let fit = 0, outside = 0;
          if (pl.pts.length) {
            const ds = pl.pts.map((p) => toLine(p, pts).d).sort((x, y) => x - y);
            fit = ds[ds.length >> 1];
            outside = ds.filter((d) => d > 25).length;
          }
          // a walk that turns back on itself has crossed to the other roadbed of a divided street and returned on it
          const v = [pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]], vl = Math.hypot(v[0], v[1]) || 1;
          let back = 0;
          for (const { si, fwd, bridge } of path) {
            if (bridge) continue;
            const q = segs[si].pts, d = [(q[q.length - 1][0] - q[0][0]) * (fwd ? 1 : -1), (q[q.length - 1][1] - q[0][1]) * (fwd ? 1 : -1)];
            if ((d[0] * v[0] + d[1] * v[1]) / (vl * (Math.hypot(d[0], d[1]) || 1)) < -0.3) back += segs[si].len;
          }
          const ok = !back && len <= maxLen;
          const score = fit + outside * 20 + len * 0.001 + (ok ? 0 : 1000);
          if (!best || score < best.score) best = { score, fit, outside, len, path, pts, ok, back };
        }
      }
    }
    const assign = (how) => {
      res.how = 'walk'; res.via = how;
      res.len = Math.round(best.len); res.fit = pl.pts.length ? +best.fit.toFixed(1) : null; res.segs = best.path.filter((x) => !x.bridge).length;
      if (best.path.some((x) => x.bridge)) res.bridged = true;
      const v = [best.pts[best.pts.length - 1][0] - best.pts[0][0], best.pts[best.pts.length - 1][1] - best.pts[0][1]];
      const along = sideFor(v, pl.side);
      res.conf = along ? +along.conf.toFixed(2) : 0;
      for (const { si, fwd, bridge } of best.path) {
        if (bridge) continue;
        // each line's own direction when it says clearly which side faces the compass side; the walk's when it doesn't
        // (a north-south piece of a block side the City calls "north")
        const p = segs[si].pts, own = sideFor([p[p.length - 1][0] - p[0][0], p[p.length - 1][1] - p[0][1]], pl.side);
        let side;
        if (own && own.conf >= 0.5) side = own.side;
        else if (along && along.conf >= 0.35) side = fwd ? along.side : flip(along.side);
        else { side = own ? own.side : 'L'; res.weakSide = true; }
        put(si, side, SIDE_WORD[pl.side], pl);
      }
      res.segIds = best.path.filter((x) => !x.bridge).map(({ si }) => segs[si].id);
    };
    const via = EA && EB ? [EA.how, EB.how].filter((h) => h !== 'name').join(', ') || 'names' : null;
    if (best && best.ok && (!pl.pts.length || (best.fit <= 25 && best.outside <= pl.pts.length / 2))) { assign(via); continue; }
    // the walk misses the signs: each sign on the nearest line of its street within 20 m (another roadbed of a divided road)
    const hits = new Map();
    for (const p of pl.pts) { const h = nearest(p, (s) => s.key === key, 20); if (h) hits.set(h.si, h.dir); }
    if (hits.size) {
      res.how = 'signs';
      res.why = !A || !B ? 'cross street not found' : !best ? 'no walk between the cross streets' : !best.ok ? (best.back ? 'the walk turns back on itself' : 'the walk is far longer than the signs reach')
        : 'the walk passes more than 25 m from the signs';
      res.missing = [!A && pl.from, !B && pl.to].filter(Boolean);
      for (const [si, dir] of hits) { const s = sideFor(dir, pl.side); if (s) put(si, s.side, SIDE_WORD[pl.side], pl); }
      res.segIds = [...hits.keys()].map((si) => segs[si].id);
      continue;
    }
    // no line of the street near the signs, but both cross streets meet it by name: the signs' points are off (some sit on
    // a neighboring street), the walk is right
    if (best && best.ok && A && B && STRONG.has(A.how) && STRONG.has(B.how) && best.fit <= 150) { assign((via === 'names' ? '' : via + ', ') + 'sign points off the street'); continue; }
    res.how = 'none';
    res.missing = [!A && pl.from, !B && pl.to].filter(Boolean);
    res.why = !A || !B ? (pl.pts.length ? 'cross street not found, and no line of the street near the signs' : 'cross street not found, and no sign points')
      : !best ? (pl.pts.length ? 'no walk between the cross streets, and no line of the street near the signs' : 'no walk between the cross streets, and no sign points')
        : !best.ok ? (best.back ? 'the only walk turns back on itself' : 'the only walk is far longer than the signs reach') : 'the walk passes more than 150 m from the signs';
  }
  return { bySeg, orders, aliases };
}

// ---------- 6. house numbers, neighborhoods, cross streets ------------------------------------------

// "22-001" (Queens: block 22, lot 1) → 22001; "145" → 145; anything else → null
export const houseNumber = (v) => {
  const m = /^\s*(\d+)(?:-(\d+))?\s*$/.exec(String(v ?? ''));
  return m ? (m[2] !== undefined ? +m[1] * 1000 + +m[2] : +m[1]) : null;
};
const parityOf = (v) => { const m = /(\d+)\s*$/.exec(String(v ?? '')); return m && +m[1] > 0 ? +m[1] % 2 : null; };
// which side of the line (looking from its first point to its last) has the odd house numbers
export function oddSide([ll, lh, rl, rh]) {
  const l = parityOf(ll) ?? parityOf(lh), r = parityOf(rl) ?? parityOf(rh);
  if (l === 1 && r !== 1) return 'L';
  if (r === 1 && l !== 1) return 'R';
  return null;
}
function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function neighborhoodIndex(ntas) {
  const list = ntas.map((n) => {
    const polys = n.the_geom.coordinates;
    let w = 180, s = 90, e = -180, no = -90;
    for (const poly of polys) for (const [lo, la] of poly[0]) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); no = Math.max(no, la); }
    return { name: n.ntaname, polys, bb: [w, s, e, no] };
  });
  return (p) => {
    for (const n of list) {
      if (p[0] < n.bb[0] || p[0] > n.bb[2] || p[1] < n.bb[1] || p[1] > n.bb[3]) continue;
      for (const poly of n.polys) if (inRing(p, poly[0]) && !poly.slice(1).some((h) => inRing(p, h))) return n.name;
    }
    return null;
  };
}
function midpoint(c) {
  const pts = c.map(xy);
  let total = 0; for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + l >= total / 2 && l) { const t = (total / 2 - acc) / l; return [c[i - 1][0] + t * (c[i][0] - c[i - 1][0]), c[i - 1][1] + t * (c[i][1] - c[i - 1][1])]; }
    acc += l;
  }
  return c[0];
}

// ---------- 7. the build ------------------------------------------------------------------------------

async function get(url, { ua = UA, tries = 4, type = 'json' } = {}) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: type === 'json' ? 'application/json' : '*/*', 'User-Agent': ua } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return type === 'json' ? await r.json() : await r.text();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 3000 * i));
    }
  }
}
// Every row of a Socrata query, 50,000 at a time, in a stable order.
async function soda(id, params) {
  const out = [];
  for (let off = 0; ; off += 50000) {
    const q = new URLSearchParams({ ...params, $order: params.$order || ':id', $limit: 50000, $offset: off });
    const page = await get(`${SODA}${id}.json?${q}`);
    if (!Array.isArray(page)) throw new Error(`${id}: unexpected answer ${JSON.stringify(page).slice(0, 200)}`);
    for (const r of page) out.push(r);
    log(`  ${id}: ${out.length} rows`);
    if (page.length < 50000) return out;
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
const need = (ok, msg) => { if (!ok) throw new Error(`[new-york] the City's data changed shape: ${msg}`); };

async function main() {
  // ---- inputs
  const codes = await cached('sign-codes.json', async () => {
    log('fetching sign designs…');
    return get(`${SODA}nfid-uabd.json?${new URLSearchParams({ $select: 'sign_code,sign_description,count(*) as n', $group: 'sign_code,sign_description', $order: 'n DESC', $limit: 50000 })}`);
  });
  const broomCodes = codes.filter((c) => isBroomSign(c.sign_description)).map((c) => c.sign_code);
  const signs = await cached('signs.json', async () => {
    log(`fetching broom signs (${broomCodes.length} designs)…`);
    const out = [];
    for (let i = 0; i < broomCodes.length; i += 60) {
      const list = broomCodes.slice(i, i + 60).map((c) => `'${c.replace(/'/g, "''")}'`).join(',');
      const rows = await soda('nfid-uabd', { $where: `sign_code in(${list})`,
        $select: 'order_number,order_type,borough,on_street,on_street_suffix,from_street,from_street_suffix,to_street,to_street_suffix,side_of_street,order_completed_on_date,sign_code,sign_description,distance_from_intersection,arrow_direction,sign_x_coord,sign_y_coord' });
      for (const r of rows) out.push(r);
    }
    return out;
  });
  const cscl = await cached('centerline.json', async () => {
    log('fetching street centerlines…');
    return soda('inkn-q76z', { $select: 'the_geom,physicalid,objectid,l_low_hn,l_high_hn,r_low_hn,r_high_hn,status,trafdir,rw_type,l_blockfaceid,r_blockfaceid,boroughcode,number_park_lanes,full_street_name,stname_label,b5sc,segmentlength,streetwidth,from_level_code,to_level_code' });
  });
  const ntas = await cached('ntas.json', async () => {
    log('fetching neighborhoods…');
    return soda('9nt8-h7nd', { $select: 'the_geom,boroname,ntaname,nta2020,ntatype' });
  });
  const tickets = await cached('tickets-sample.json', async () => {
    log('fetching a sample of street cleaning tickets…');
    // summons numbers end in effectively random digits, so % 100 = 37 is a reproducible 1% sample (no plates, no names)
    return soda('pvqr-7yc4', { $where: 'violation_code=21 AND summons_number % 100 = 37', $order: 'summons_number',
      $select: 'summons_number,issue_date,violation_time,violation_county,violation_precinct,house_number,street_name,intersecting_street,street_code1,street_code2,street_code3,days_parking_in_effect,from_hours_in_effect,to_hours_in_effect,violation_in_front_of_or_opposite' });
  });
  const year = new Date().getUTCFullYear(), calendars = {};
  for (const y of [year, year + 1]) {
    calendars[y] = (await cached(`asp-${y}.json`, async () => ({ text: await get(ICS(y), { ua: BROWSER_UA, type: 'text' }) }))).text;
    if (!calendars[y]) {   // not published when last checked: ask again (one small request; offline, keep going without it)
      try { calendars[y] = await get(ICS(y), { ua: BROWSER_UA, type: 'text', tries: 1 }); } catch { calendars[y] = null; }
      if (calendars[y]) { fs.writeFileSync(CACHE + `asp-${y}.json`, JSON.stringify({ text: calendars[y] })); log(`the ${y} ASP calendar is out: added`); }
    }
  }
  log(`${codes.length} sign designs (${broomCodes.length} broom), ${signs.length} broom signs, ${cscl.length} centerline rows, ${ntas.length} neighborhoods, ${tickets.length} tickets`);
  need(signs.length > 150000 && signs.every((r) => r.on_street !== undefined && r.side_of_street !== undefined), 'broom signs: fewer than 150,000 or fields renamed');
  need(cscl.length > 100000 && cscl[0].the_geom && cscl[0].physicalid, 'centerline: fewer rows or no geometry/physicalid');

  // ---- signs
  const parse = { designs: broomCodes.length, signs: signs.length, read: 0, unreadable: [], unknownWords: [] };
  const seenCode = new Map();
  for (const r of signs) {
    const p = parseSign(r.sign_description);
    if (!p.error) parse.read++;
    if (!seenCode.has(r.sign_code)) seenCode.set(r.sign_code, { p, desc: r.sign_description, n: 0 });
    seenCode.get(r.sign_code).n++;
  }
  for (const [code, { p, desc, n }] of seenCode) {
    if (p.error) parse.unreadable.push({ code, signs: n, why: p.error, text: desc });
    else if (p.unknown) parse.unknownWords.push({ code, signs: n, words: p.unknown, text: desc });
  }
  parse.share = +(parse.read / parse.signs).toFixed(5);
  need(parse.share > 0.99, `only ${(parse.share * 100).toFixed(2)}% of broom signs parse`);

  // ---- join
  const segs = prepSegments(cscl);
  const { bySeg, orders, aliases } = joinSigns(signs, segs);
  if (process.env.CURB_NY_DEBUG) fs.writeFileSync(CACHE + 'debug-orders.json', JSON.stringify(orders));
  const hood = neighborhoodIndex(ntas);

  // cross streets of a line: the other streets at each end (streets for cars first), as people write them
  const atNode = new Map();
  segs.forEach((s, i) => { for (const n of [s.a, s.b]) { if (!atNode.has(n)) atNode.set(n, []); atNode.get(n).push(i); } });
  // CSCL RW_TYPE: 1 street, 2 highway, 3 bridge, 4 tunnel, 5 boardwalk, 7 step street, 10 alley count as cross streets;
  // paths, driveways, ramps, ferry routes don't. An end with none (a path, a bend) looks further along the street.
  const CROSS_RW = new Set([1, 2, 3, 4, 5, 7, 10]);
  const crossName = (s, n, hops = 0) => {
    const names = new Map();
    for (const i of atNode.get(n) || []) {
      const o = segs[i];
      if (o.key === s.key || !o.label || !CROSS_RW.has(o.rw) || /^(ALLEY|DRIVEWAY|UNNAMED)/.test(o.label)
        || /\b(PATH|PTH|PED|PEDESTRIAN|BIKE|GREENWAY|OPAS|FOOTBRIDGE|STEPS|EN|ET|ENTRANCE|EXIT)\b/.test(o.label)) continue;
      names.set(o.label, (names.get(o.label) || 0) + (o.rw === 1 ? 10 : o.rw <= 3 ? 3 : 1));
    }
    const top = [...names].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0];
    if (top) return streetLabel(top[0]);
    const next = hops < 4 && (atNode.get(n) || []).map((i) => segs[i]).filter((o) => o !== s && o.key === s.key);
    return next && next.length === 1 ? crossName(next[0], next[0].a === n ? next[0].b : next[0].a, hops + 1) : '';
  };
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const blocks = [], dupIds = new Map();
  for (const [si, e] of bySeg) {
    const s = segs[si];
    const d = [];
    for (const side of ['L', 'R']) {
      const t = e[side]; if (!t) continue;
      const label = [...t.labels].sort((x, y) => y[1] - x[1])[0][0];
      const rules = [...t.rules.values()].sort((x, y) => x[0] - y[0] || String(x[1]).localeCompare(String(y[1]), 'en', { numeric: true }));
      d.push([side, label, rules]);
    }
    const a = crossName(s, s.a), b = crossName(s, s.b);
    const nums = s.hn.map((v) => (/^\s*\d+\s*$/.test(String(v ?? '')) ? +v : null));
    const plain = s.hn.every((v) => v == null || /^\s*\d+\s*$/.test(String(v))) && nums.some((v) => v > 0);
    const odd = oddSide(s.hn);
    const h = hood(midpoint(s.c));
    const blk = { c: s.id, s: streetLabel(s.label), l: a && b ? `${a} - ${b}` : a || b, ...(h ? { h } : {}),
      ...(plain ? { n: [Math.min(...nums.filter((v) => v > 0)), Math.max(...nums.filter((v) => v > 0))] } : {}),
      ...(odd ? { o: odd } : {}), g: s.c.map(([lo, la]) => [r6(lo), r6(la)]), d };
    if (dupIds.has(s.id)) {   // two CSCL rows with one PHYSICALID: one record, the longer line, both sides' rules
      const other = dupIds.get(s.id);
      if (s.c.length > other.g.length) other.g = blk.g;
      for (const [side, label, rules] of d) {
        const at = other.d.find((x) => x[0] === side);
        if (!at) other.d.push([side, label, rules]); else for (const r of rules) if (!at[2].some((x) => x.join() === r.join())) at[2].push(r);
      }
      continue;
    }
    dupIds.set(s.id, blk);
    blocks.push(Object.assign(blk, { _boro: s.boro }));
  }
  blocks.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));

  // ---- ticket cross-check (report.json): where and when code 21 tickets were written, against the rules
  const check = crossCheck(tickets, segs, bySeg, new Map(orders.map((o) => [o.k, o.how === 'walk' ? (/sign points off/.test(o.via) ? 'walk, sign points off the street' : 'walk') : 'sign points'])));

  // ---- write
  const today = new Date().toISOString().slice(0, 10), now = new Date().toISOString();
  const sources = [
    { name: 'Parking Regulation Locations and Signs (NYC DOT)', url: 'https://data.cityofnewyork.us/d/nfid-uabd', license: 'NYC Open Data Terms of Use', fetched: today },
    { name: 'Centerline, CSCL (NYC Office of Technology and Innovation)', url: 'https://data.cityofnewyork.us/d/inkn-q76z', license: 'NYC Open Data Terms of Use', fetched: today },
    { name: '2020 Neighborhood Tabulation Areas (NYC Department of City Planning)', url: 'https://data.cityofnewyork.us/d/9nt8-h7nd', license: 'NYC Open Data Terms of Use', fetched: today },
    { name: 'Alternate Side Parking suspension calendar (NYC DOT)', url: ASP_PAGE, license: 'NYC.gov terms of use', fetched: today },
    { name: 'Parking Violations Issued, Fiscal Year 2027 (NYC Department of Finance), cross-check only', url: 'https://data.cityofnewyork.us/d/pvqr-7yc4', license: 'NYC Open Data Terms of Use', fetched: today },
  ];
  const FORMAT = 'b[] = {c: CSCL PHYSICALID, s: street, l: cross streets, h: neighborhood (2020 NTA), n: [lowest, highest house number] (left out where Queens numbers are hyphenated), o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label from the sign order, rules]]}; '
    + 'rule = [jsDow, from, to (hours, "H:MM" with minutes; to < from crosses midnight), weeksMask (31 = every week), monthsMask (0 = all year), flags (0: suspended on ASP holidays, a ticket, no tow)]';
  fs.mkdirSync(OUT, { recursive: true });
  const strip = (b) => { const { _boro, ...rest } = b; return rest; };
  const sidesOf = (list) => list.reduce((n, b) => n + b.d.length, 0);
  const write = (file, list, extra = {}) => {
    fs.writeFileSync(OUT + file, JSON.stringify({ _meta: { city: 'new-york', time_zone: 'America/New_York', generated: now, ...extra,
      sources: sources.slice(0, 3), blocks: list.length, sides: sidesOf(list), format: FORMAT }, b: list.map(strip) }));
    return fs.statSync(OUT + file).size;
  };
  const sizes = { 'segments.json': write('segments.json', blocks) };
  const parts = [];
  for (const [code, [id, name]] of Object.entries(BOROUGHS)) {
    const list = blocks.filter((b) => b._boro === code);
    if (!list.length) { if (fs.existsSync(OUT + `segments-${id}.json`)) fs.unlinkSync(OUT + `segments-${id}.json`); continue; }
    const file = `segments-${id}.json`;
    sizes[file] = write(file, list, { borough: name });
    let w = 180, s = 90, e = -180, n = -90;
    for (const b of list) for (const [lo, la] of b.g) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
    parts.push({ id, name, file, bbox: [r6(w), r6(s), r6(e), r6(n)].join(','), blocks: list.length, sides: sidesOf(list), bytes: sizes[file] });
  }

  // neighborhoods for the welcome card: in each borough, the 4 with the most ASP block sides
  const hoodCount = new Map();
  for (const b of blocks) if (b.h) { const e = hoodCount.get(b.h) || { n: 0, w: 180, s: 90, e: -180, no: -90, boro: b._boro }; e.n += b.d.length;
    for (const [lo, la] of b.g) { e.w = Math.min(e.w, lo); e.e = Math.max(e.e, lo); e.s = Math.min(e.s, la); e.no = Math.max(e.no, la); } hoodCount.set(b.h, e); }
  const neighborhoods = Object.keys(BOROUGHS).flatMap((code) => [...hoodCount].filter(([, e]) => e.boro === code && e.n >= 100)
    .sort((x, y) => y[1].n - x[1].n).slice(0, 4))
    .map(([name, e]) => ({ name, borough: BOROUGHS[e.boro][1], sides: e.n, bbox: [e.w, e.s, e.e, e.no].map(r6).join(',') }));

  const holidays = {};
  for (const [y, text] of Object.entries(calendars)) if (text) Object.assign(holidays, parseIcs(text));
  need(Object.keys(holidays).some((d) => d.startsWith(String(year))), `no ASP suspension days for ${year}`);
  const missingYears = Object.entries(calendars).filter(([, t]) => !t).map(([y]) => +y);
  // the map frames all of the City's streets (CSCL), Staten Island included, though it has no ASP
  let bw = 180, bs = 90, be = -180, bn = -90;
  for (const sg of segs) if (sg.rw === 1) for (const [lo, la] of sg.c) { bw = Math.min(bw, lo); be = Math.max(be, lo); bs = Math.min(bs, la); bn = Math.max(bn, la); }
  const city = {
    id: 'new-york', name: 'New York City', region: 'New York', tz: 'America/New_York',
    center: [40.7835, -73.9765], zoom: 15, bounds: [[r6(bs), r6(bw)], [r6(bn), r6(be)]],
    holidays, holidaysSource: ASP_PAGE, holidayRule: 'all',
    fine: '$65', tow: 'no', fineSource: 'https://www.nyc.gov/site/finance/vehicles/services-violation-codes.page',
    agency: 'NYC Department of Sanitation (the brooms) and NYC DOT (the signs)', scheduleUrl: ASP_PAGE,
    sources: sources.slice(0, 4),
    words: {
      rule: 'Alternate side parking: no parking on the side of the street and at the hours the broom sign shows, Monday to Saturday, all year, so the sweeper can pass.',
      afterpass: 'All year, Monday to Saturday. A $65 ticket, no tow. No ASP on the City\'s suspension days (holidays, and some snow days).',
      dataNotes: 'The rules are the broom signs in NYC DOT\'s sign inventory (Parking Regulation Locations and Signs), read from their text. Each sign order names its street, cross streets and side; CURB walks the City\'s street centerlines (CSCL) between the two cross streets, guided by the signs\' own points, and puts the rule on that side. ASP is also suspended for snow and emergencies, announced the same day by 311 and Notify NYC.',
    },
    neighborhoods,
    parts: { note: 'segments.json is the whole city; the same blocks one borough at a time, for loading what the map shows', files: parts },
    ...(missingYears.length ? { holidaysMissing: `The City has not published the ${missingYears.join(', ')} ASP suspension calendar yet (checked ${today}); the next build after it appears at ${ICS(missingYears[0])} adds it` } : {}),
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1) + '\n');

  // ---- report
  const by = (f) => { const m = {}; for (const o of orders) { const k = f(o); if (k) m[k] = (m[k] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort((x, y) => y[1] - x[1])); };
  const examples = (why, n = 6) => orders.filter((o) => o.why === why).slice(0, n).map((o) => `${BOROUGHS[o.boro]?.[1] || '?'}: ${o.on} between ${o.from} and ${o.to}, ${o.side} side`);
  const placedSides = orders.filter((o) => o.how !== 'none');
  const multiSched = [...bySeg.values()].reduce((n, e) => n + ['L', 'R'].filter((s) => e[s] && new Set([...e[s].rules.values()].map((r) => `${r[1]}-${r[2]}`)).size > 1).length, 0);
  const dayCount = [...bySeg.values()].reduce((m, e) => { for (const s of ['L', 'R']) if (e[s]) { const n = new Set([...e[s].rules.values()].map((r) => r[0])).size; m[n] = (m[n] || 0) + 1; } return m; }, {});
  const walks = orders.filter((o) => o.how === 'walk');
  const q = (arr, f) => { const v = arr.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(f * (v.length - 1))] : null; };
  const report = {
    generated: now,
    signs: parse,
    blockSides: {
      total: orders.length, byBorough: Object.fromEntries(Object.entries(by((o) => o.boro)).map(([k, v]) => [BOROUGHS[k]?.[1] || k, v])),
      placed: placedSides.length, placedShare: +(placedSides.length / orders.length).toFixed(4),
      byWalk: walks.length, bySignPoints: orders.filter((o) => o.how === 'signs').length, notPlaced: orders.filter((o) => o.how === 'none').length,
      withoutSignPoints: orders.filter((o) => !o.withPoints).length,
      walkCrossStreets: by((o) => o.how === 'walk' && o.via),
      walkLengthMeters: { median: q(walks.map((o) => o.len), 0.5), p95: q(walks.map((o) => o.len), 0.95), max: q(walks.map((o) => o.len), 1) },
      signDistanceToWalkMeters: { median: q(walks.map((o) => o.fit), 0.5), p95: q(walks.map((o) => o.fit), 0.95) },
      sideFromCompass: { clear: walks.filter((o) => o.conf >= 0.7).length, fair: walks.filter((o) => o.conf >= 0.35 && o.conf < 0.7).length,
        unclear: walks.filter((o) => o.weakSide).length },
      withMoreThanOneSchedule: orders.filter((o) => o.schedules > 1).length,
      notPlacedWhy: by((o) => o.how === 'none' && o.why), placedBySignPointsWhy: by((o) => o.how === 'signs' && o.why),
      notPlacedExamples: Object.fromEntries(Object.keys(by((o) => o.how === 'none' && o.why)).map((w) => [w, examples(w)])),
      crossStreetsNotFound: Object.entries(orders.filter((o) => o.missing && o.missing.length).flatMap((o) => o.missing.map((m) => `${BOROUGHS[o.boro]?.[1]}: ${m}`))
        .reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {})).sort((x, y) => y[1] - x[1]).slice(0, 40).map(([k, v]) => `${k} (${v})`),
      walksThatCrossAShortPieceOfAnotherStreet: orders.filter((o) => o.bridged).length,
    },
    output: { blocks: blocks.length, sides: sidesOf(blocks), rules: blocks.reduce((n, b) => n + b.d.reduce((m, x) => m + x[2].length, 0), 0),
      sidesWithMoreThanOneWindow: multiSched, sidesByWeekdaysSwept: dayCount,
      noHouseNumbers: blocks.filter((b) => !b.n).length, noNeighborhood: blocks.filter((b) => !b.h).length, sizes, parts },
    streetNameAliases: aliases.sort((x, y) => (y.signs || 0) - (x.signs || 0)),
    holidays: { days: Object.keys(holidays).length, years: Object.keys(calendars).map(Number).filter((y) => calendars[y]), missing: missingYears, rule: 'all: ASP is off for the whole day citywide (overnight signs too)' },
    ticketCheck: check,
    notes: {
      season: 'All year, Monday to Saturday (8 signs also name Sunday). No season, so every rule has months 0.',
      holidays: `The City's ${Object.keys(calendars).filter((y) => calendars[y]).join(', ')} ASP suspension calendar (DOT's .ics, read with a browser user agent: nyc.gov answers 403 otherwise). ${missingYears.length ? `The ${missingYears.join(', ')} calendar is not published yet (checked ${today}); every build asks again and adds it once it is.` : ''} Snow and emergency suspensions are announced the same day (311, Notify NYC) and are in no calendar.`,
      sides: 'Sign points lie on the centerline (median 1.2 m from the walk), at the sign\'s distance from the corner, so they tell the line, never the side. The side is the order\'s compass side, taken against each line\'s own direction, or the walk\'s where a line runs along that compass direction.',
      partialBlocks: 'A sign order covers one block side, sometimes a few blocks. Some carry a second schedule on part of the block (a daily "except Sunday" sign by a commercial corner, with its arrow and distance). The format has no extent shorter than a block, so the side shows every schedule its signs carry.',
      dividedRoads: 'Divided streets (Queens Blvd, Ocean Pkwy, Grand Concourse, Delancey St) keep one name on every roadbed in CSCL; the sign points choose the roadbed, and a walk that crosses to the other roadbed and back is refused. Without sign points the shortest walk is taken, which can be the main roadbed.',
      houseNumbers: 'n is left out where CSCL writes Queens hyphenated numbers ("22-001"): the format holds plain numbers only.',
      tickets: 'The FY2027 file holds tickets from June to September 2026. Its days_parking_in_effect arrives with leading blanks trimmed ("Y  Y" for Tuesday and Friday), so only the number of days is compared. 22% of the tickets were written opposite the house number (O).',
      sweepNYC: 'SweepNYC (c23c-uwsm) logs DSNY broom GPS visits per CSCL physical id and day since 2023-10-27: the same ids as c here, so a "when the broom passed" layer can join on them directly. Not used yet.',
    },
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');

  log(`signs: ${parse.read}/${parse.signs} read (${(parse.share * 100).toFixed(2)}%), ${parse.unreadable.length} designs unreadable`);
  log(`block sides: ${placedSides.length}/${orders.length} placed (${walks.length} by walk, ${report.blockSides.bySignPoints} by sign points), ${report.blockSides.notPlaced} not placed`);
  log(`output: ${blocks.length} blocks, ${report.output.sides} sides, ${report.output.rules} rules; ${aliases.length} street name aliases`);
  log(`tickets: ${JSON.stringify(check.summary)}`);
  for (const [f, n] of Object.entries(sizes)) log(`wrote data/new-york/${f} (${(n / 1048576).toFixed(2)} MB)`);
}

// ---------- 8. the ticket cross-check -----------------------------------------------------------------

// A ticket's time: "0910A" → 550 minutes, "0942P" → 1302; "0909" (no A or P) → 549 with mer null.
export function ticketTime(v) {
  const m = /^(\d{2})(\d{2})([AP])?$/.exec(String(v || '').trim());
  if (!m || +m[1] > 12 || +m[2] > 59) return null;
  const h = +m[1] % 12 + (m[3] === 'P' ? 12 : 0);
  return { min: h * 60 + +m[2], mer: m[3] || null };
}
const PRECINCT_BORO = (p) => (p >= 1 && p <= 34 ? '1' : p >= 40 && p <= 52 ? '2' : p >= 60 && p <= 94 ? '3' : p >= 100 && p <= 115 ? '4' : p >= 120 && p <= 123 ? '5' : null);
const COUNTY_BORO = { NY: '1', MN: '1', BX: '2', BRONX: '2', K: '3', BK: '3', KINGS: '3', Q: '4', QN: '4', QNS: '4', R: '5', ST: '5', RICH: '5' };
const minOf = (v) => (typeof v === 'number' ? v * 60 : +v.split(':')[0] * 60 + +v.split(':')[1]);
// does a rule cover weekday dow at minute t?
export const ruleCovers = (r, dow, t, slack = 0) => {
  const f = minOf(r[1]), e = minOf(r[2]);
  if (e > f) return r[0] === dow && t >= f - slack && t < e + slack;
  return (r[0] === dow && t >= f - slack) || (r[0] === (dow + 6) % 7 && t < e + slack);   // crosses midnight
};

function crossCheck(tickets, segs, bySeg, howOf = new Map()) {
  const byCode = new Map();
  segs.forEach((s, i) => { if (s.b5sc) { if (!byCode.has(s.b5sc)) byCode.set(s.b5sc, []); byCode.get(s.b5sc).push(i); } });
  const n = { tickets: tickets.length, withHouseNumber: 0, onACenterlineBlock: 0, opposite: 0, onABlockWithRules: 0, dayAndHourMatch: 0,
    dayAndHourMatchWithin15min: 0, aOrPLikelySwapped: 0, matchOnlyOnOtherSide: 0, dayMatchOnly: 0, noMatch: 0, noRuleOnThatSide: 0,
    postedHoursOnTicket: 0, postedHoursMatchARule: 0, postedHoursMatchIgnoringAMPM: 0, postedDayCountMatches: 0 };
  const misses = [], parts = {};
  const tally = (k, ok) => { const e = (parts[k] ||= { tickets: 0, match: 0 }); e.tickets++; if (ok) e.match++; };
  for (const t of tickets) {
    const hn = houseNumber(t.house_number);
    if (hn == null) continue;
    n.withHouseNumber++;
    const boro = PRECINCT_BORO(+t.violation_precinct) || COUNTY_BORO[String(t.violation_county || '').toUpperCase()];
    const code = boro && t.street_code1 && +t.street_code1 ? boro + String(+t.street_code1).padStart(5, '0') : null;
    let hit = null;
    for (const si of (code && byCode.get(code)) || []) {
      const [ll, lh, rl, rh] = segs[si].hn.map(houseNumber);
      // a range's parity is its numbers': CSCL writes some ranges from 0 ("0" to "299" holds 1 to 299)
      const inL = ll != null && lh != null && hn >= Math.min(ll, lh) && hn <= Math.max(ll, lh) && ((ll || lh) % 2) === (hn % 2);
      const inR = rl != null && rh != null && hn >= Math.min(rl, rh) && hn <= Math.max(rl, rh) && ((rl || rh) % 2) === (hn % 2);
      if (inL || inR) { hit = { si, side: inL ? 'L' : 'R' }; if (bySeg.has(si)) break; }
    }
    if (!hit) continue;
    // "O": the car was opposite that house number, on the other side of the street (22% of the sample)
    if (String(t.violation_in_front_of_or_opposite).toUpperCase() === 'O') { hit.side = flip(hit.side); n.opposite++; }
    n.onACenterlineBlock++;
    const e = bySeg.get(hit.si);
    if (!e) continue;
    const date = new Date(String(t.issue_date).slice(0, 10) + 'T12:00:00Z'), dow = date.getUTCDay();
    const tt = ticketTime(t.violation_time);
    const here = e[hit.side] ? [...e[hit.side].rules.values()] : [], there = e[flip(hit.side)] ? [...e[flip(hit.side)].rules.values()] : [];
    n.onABlockWithRules++;
    if (!here.length) n.noRuleOnThatSide++;
    const ok = tt && here.some((r) => ruleCovers(r, dow, tt.min));
    tally(BOROUGHS[segs[hit.si].boro][1], ok);
    for (const how of new Set((e[hit.side] ? e[hit.side].places : []).map((k) => howOf.get(k)).filter(Boolean))) tally('placed by ' + how, ok);
    if (ok) n.dayAndHourMatch++;
    else if (tt && here.some((r) => ruleCovers(r, dow, tt.min, 15))) n.dayAndHourMatchWithin15min++;
    else if (tt && tt.mer && here.some((r) => ruleCovers(r, dow, (tt.min + 720) % 1440))) n.aOrPLikelySwapped++;
    else if (tt && there.some((r) => ruleCovers(r, dow, tt.min, 15))) n.matchOnlyOnOtherSide++;
    else if (here.some((r) => r[0] === dow)) n.dayMatchOnly++;
    else { n.noMatch++; if (misses.length < 12) misses.push({ street: t.street_name, day: dow, time: t.violation_time, posted: [t.days_parking_in_effect, t.from_hours_in_effect, t.to_hours_in_effect].join(' '), rulesHere: here, rulesOtherSide: there }); }
    // the hours posted on the sign, as the officer entered them ("0830A" "1000A"; A and P are often swapped: "1100A" "1230A")
    const pf = ticketTime(t.from_hours_in_effect), pt = ticketTime(t.to_hours_in_effect);
    if (pf && pt && pf.mer && pt.mer) {
      n.postedHoursOnTicket++;
      const win = here.filter((r) => minOf(r[1]) === pf.min && minOf(r[2]) % 1440 === pt.min);
      const win12 = here.filter((r) => minOf(r[1]) % 720 === pf.min % 720 && minOf(r[2]) % 720 === pt.min % 720);
      if (win.length) n.postedHoursMatchARule++;
      if (win12.length) n.postedHoursMatchIgnoringAMPM++;
      // the posted days arrive with their leading blanks trimmed ("Y  Y" for Tuesday and Friday), so only the number of
      // days can be compared: as many Y as the side has weekdays at those hours
      const ys = (String(t.days_parking_in_effect || '').match(/Y/gi) || []).length;
      if (win12.length && ys && new Set(win12.map((r) => r[0])).size === ys) n.postedDayCountMatches++;
    }
  }
  const share = (a, b) => (b ? +(a / b).toFixed(4) : null);
  return {
    method: 'A 1% sample of FY2027 code 21 tickets (summons number % 100 = 37). Each ticket with a house number goes to the centerline block of its DOF street code (street_code1 = CSCL b5sc) whose address range on one side holds that number, and so to a side (the other side when the ticket says O, opposite). On a block side the build has rules for, it counts whether a rule there covers the ticket\'s weekday and minute: exactly, within 15 minutes, or with the ticket\'s A and P swapped (a common entry error).',
    counts: n,
    summary: {
      sample: n.tickets, onABlockWithRules: n.onABlockWithRules,
      dayAndHourMatch: share(n.dayAndHourMatch, n.onABlockWithRules),
      dayAndHourWithin15minOrAPSwapped: share(n.dayAndHourMatch + n.dayAndHourMatchWithin15min + n.aOrPLikelySwapped, n.onABlockWithRules),
      matchOnlyOnOtherSide: share(n.matchOnlyOnOtherSide, n.onABlockWithRules),
      postedHoursMatch: share(n.postedHoursMatchARule, n.postedHoursOnTicket),
      postedHoursMatchIgnoringAMPM: share(n.postedHoursMatchIgnoringAMPM, n.postedHoursOnTicket),
      postedDayCountMatch: share(n.postedDayCountMatches, n.postedHoursMatchIgnoringAMPM),
    },
    byBoroughAndMethod: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, { ...v, share: share(v.match, v.tickets) }])),
    noMatchExamples: misses,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
