#!/usr/bin/env node
// Los Angeles for CURB (2026-10-18; format in docs/multi-city/city-build.md, research in docs/multi-city/los-angeles.md).
// Builds data/los-angeles/ from three City of Los Angeles sources:
//
//   1. Posted Street Sweeping Routes (StreetsLA, ArcGIS): 871 polygons, two per route, one per sweeping day. Each polygon is
//      a buffer around the streets of its route, with the day, the weeks of the month (1st & 3rd or 2nd & 4th) and the
//      posted window. The two polygons of a route cover the same streets; nothing says which side is swept on which day.
//   2. Streets (Centerline) (LA GeoHub, ArcGIS): 85,192 block lines with left and right address ranges. A block belongs to
//      a polygon when most of its line lies inside it (its ends left out: the intersections).
//   3. Parking Citations (LADOT, data.lacity.org, CC0): every street cleaning ticket since 2025-01-01 (violation 80.69BS),
//      only date, time and location read. Each ticket lands on a block by its address, and on a side by its house number.
//      The tickets decide which side gets which day, block by block (one route sweeps the north side of one street and
//      the south side of the next, so there is no rule per route); a block without tickets takes its side from the
//      nearest block of the same street and route that has them.
//
// Writes data/los-angeles/segments.json (swept blocks + rules), segments-<district>.json (the same blocks split by StreetsLA
// maintenance district, when segments.json is over 6 MB), city.json and report.json (counts, side confidence per route,
// the fixes and the ticket cross-checks).
//
// Run: node scripts/cities/los-angeles.mjs [--refresh]   (Node 18+; inputs cached in private/cache/los-angeles/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/los-angeles/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/los-angeles/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[los-angeles]', ...a);

const ROUTES = 'https://services1.arcgis.com/PTh9WC0Sf2WS7AAq/arcgis/rest/services/Posted_Street_Sweeping_Routes_Update/FeatureServer/0/query';
const CENTERLINE = 'https://maps.lacity.org/lahub/rest/services/Street_Information/MapServer/36/query';
const CITATIONS = 'https://data.lacity.org/resource/4f5p-udkv.json';
const COUNCILS = 'https://maps.lacity.org/lahub/rest/services/Boundaries/MapServer/18/query';   // Neighborhood Councils (Certified)
const CL_FIELDS = 'AutoID,ASSETID,INT_ID_FROM,INT_ID_TO,ADRF,ADRT,ADLF,ADLT,TDIR,STNAME,STSFX,SFXDIR,STATUS,TYPE,BSS_ST_CLASS,Street_Designation';
const CITE_FROM = '2025-01-01';

// ---------- geometry ------------------------------------------------------------------------------

// A local flat projection in meters around Los Angeles: within a few centimeters per 100 m across the City.
const LAT0 = 34.05, LON0 = -118.35, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
export const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
export const lineLen = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

/** Points every `step` meters along a projected line, leaving out `trim` meters at each end (the intersections). */
export function samplePoints(pts, step = 8, trim = 18) {
  const len = lineLen(pts);
  let a = trim, b = len - trim;
  if (b - a < step) { a = len * 0.4; b = len * 0.6; }        // a short block: its middle fifth
  const out = [], at = [], n = Math.max(1, Math.round((b - a) / step));
  for (let i = 0; i <= n; i++) at.push(a + (b - a) * i / n);
  let k = 0, acc = 0;
  for (let i = 1; i < pts.length && k < at.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], l = Math.hypot(x2 - x1, y2 - y1);
    while (k < at.length && at[k] <= acc + l + 1e-9) {
      const t = l ? (at[k] - acc) / l : 0;
      out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
      k++;
    }
    acc += l;
  }
  return out;
}

/** Even-odd point in polygon over every ring of a (multi)polygon, with its edges bucketed in horizontal bands. */
export class PolygonIndex {
  constructor(rings, band = 40) {
    this.band = band;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    this.bbox = [x0, y0, x1, y1];
    this.bands = new Map();
    for (const r of rings) for (let i = 0; i < r.length; i++) {
      const [ax, ay] = r[i], [bx, by] = r[(i + 1) % r.length];
      if (ay === by) continue;
      for (let k = Math.floor((Math.min(ay, by) - y0) / band); k <= Math.floor((Math.max(ay, by) - y0) / band); k++) {
        if (!this.bands.has(k)) this.bands.set(k, []);
        this.bands.get(k).push(ax, ay, bx, by);
      }
    }
  }
  contains([x, y]) {
    const [x0, y0, x1, y1] = this.bbox;
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const e = this.bands.get(Math.floor((y - y0) / this.band));
    if (!e) return false;
    let inside = false;
    for (let i = 0; i < e.length; i += 4) {
      const ax = e[i], ay = e[i + 1], bx = e[i + 2], by = e[i + 3];
      if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) inside = !inside;
    }
    return inside;
  }
}
export const ringsOf = (geom) => (geom.type === 'Polygon' ? geom.coordinates : geom.type === 'MultiPolygon' ? geom.coordinates.flat() : []);

/** Distance in meters from a projected point to a projected line. */
export function distToLine([px, py], pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    const d = Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
    if (d < best) best = d;
  }
  return best;
}

/** Douglas-Peucker on [lng, lat] points: drops points within `tol` meters of the line through their neighbors (the City's
 *  lines carry many points along straight curbs; 25 cm changes nothing on the map and halves the file). */
export function simplify(c, tol = 0.25) {
  if (c.length < 3) return c;
  const P = c.map(xy), keep = new Array(c.length).fill(false), stack = [[0, c.length - 1]];
  keep[0] = keep[c.length - 1] = true;
  while (stack.length) {
    const [a, b] = stack.pop(), [x1, y1] = P[a], [x2, y2] = P[b], dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy);
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = l ? Math.abs((P[i][0] - x1) * dy - (P[i][1] - y1) * dx) / l : Math.hypot(P[i][0] - x1, P[i][1] - y1);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = true; stack.push([a, mi], [mi, b]); }
  }
  return c.filter((_, i) => keep[i]);
}

const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
/** The compass word for the side of a line (looking from its first point to its last), as on a sign: "North". */
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
/** The side facing north or west: where Los Angeles puts the odd house numbers (95% of 2025-26 tickets). */
export function northWestSide(c) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  return dx + dy >= 0 ? 'L' : 'R';            // the left normal (-dy, dx) points north or west when dx + dy > 0
}

// ---------- the routes' fields ----------------------------------------------------------------------

const DOW = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 };
/** "Monday" → [1]; "Monday to Friday" → [1, 2, 3, 4, 5]. */
export function parseDays(s) {
  const t = String(s || '').trim().toUpperCase();
  const m = /^(\w+)\s+(?:TO|-|THROUGH)\s+(\w+)$/.exec(t);
  if (m && m[1] in DOW && m[2] in DOW) { const out = []; for (let d = DOW[m[1]]; d <= DOW[m[2]]; d++) out.push(d); return out; }
  return t in DOW ? [DOW[t]] : [];
}
/** "1 & 3" → 5 (bit 0 = the 1st of that weekday in the month), "2 & 4" → 10, "Weekly" → 31, "1" → 1. */
export function parseWeeks(s) {
  const t = String(s || '').trim().toLowerCase();
  if (t === 'weekly') return 31;
  const n = t.match(/\d/g);
  return n ? n.reduce((m, d) => m | (1 << (+d - 1)), 0) : 0;
}
const hourOf = (h, m, ap) => { let H = +h % 12; if (ap === 'pm') H += 12; return m && +m ? `${H}:${m}` : H; };
/** "8 am - 10 am" → [8, 10]; "12 pm - 2:30 pm" → [12, "14:30"]; "As Available" → null. */
export function parseWindow(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(String(s || '').trim());
  if (!m) return null;
  return [hourOf(m[1], m[2], m[3].toLowerCase()), hourOf(m[4], m[5], m[6].toLowerCase())];
}
export const hoursOf = (v) => (typeof v === 'number' ? v : +v.split(':')[0] + +v.split(':')[1] / 60);

/** The route a polygon belongs to: its name without the day ("10P136 Th" → "10P136", "Skid Row F" → "Skid Row"). */
export const routeBase = (route) => String(route).trim().replace(/\s+(M|Tu|W|Th|F|Sa|Su)$/, '');

// ---------- street names and addresses -------------------------------------------------------------

const SFX = { ST: 'ST', STREET: 'ST', AVE: 'AVE', AV: 'AVE', AVENUE: 'AVE', BLVD: 'BLVD', BL: 'BLVD', BOULEVARD: 'BLVD',
  DR: 'DR', DRIVE: 'DR', PL: 'PL', PLACE: 'PL', RD: 'ROAD', ROAD: 'ROAD', WAY: 'WAY', WY: 'WAY', LN: 'LANE', LANE: 'LANE',
  CT: 'CT', COURT: 'CT', TER: 'TER', TERR: 'TER', TERRACE: 'TER', CIR: 'CIR', CIRCLE: 'CIR', HWY: 'HWY', HIGHWAY: 'HWY',
  TR: 'TR', TRL: 'TR', TRAIL: 'TR', WALK: 'WALK', WK: 'WALK', PKWY: 'PKWY', PARKWAY: 'PKWY', PY: 'PKWY', CL: 'CL', PZ: 'PZ',
  PLZ: 'PZ', PLAZA: 'PZ', ROW: 'ROW', LOOP: 'LOOP', PASS: 'PASS', SQ: 'SQ', CRES: 'CRES', MALL: 'MALL' };
const DIRS = { N: 'N', S: 'S', E: 'E', W: 'W', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };
const nameKey = (toks) => {
  const w = toks.slice();
  if (w.length > 1 && w[0] === 'SAINT') w[0] = 'ST';
  if (w.length > 1 && w[0] === 'MOUNT') w[0] = 'MT';
  return w.join(' ');
};
/** A centerline's street: { dir, name, sfx }, the name normalized the way ticket addresses are. */
export function centerlineStreet(p) {
  const name = String(p.STNAME || '').toUpperCase().replace(/[.,]/g, '').trim();
  const sfx = String(p.STSFX || '').trim().toUpperCase();
  return { dir: DIRS[String(p.TDIR || '').toUpperCase()] || '', name: nameKey(name.split(/\s+/).filter(Boolean)), sfx: SFX[sfx] || sfx };
}
/** A ticket's location, "2625 12TH ST W" or "3818 WEST 59TH STREET" → { num: 2625, dir: 'W', name: '12TH', sfx: 'ST' }. */
export function parseLocation(s) {
  const t = String(s || '').toUpperCase().replace(/[.,#]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const m = /^(\d+)[A-Z]?$/.exec(t[0] || '');
  if (!m) return null;
  const num = +m[1];
  let w = t.slice(1);
  if (w[0] === '1/2') w = w.slice(1);
  let dir = '';
  if (w.length > 1 && DIRS[w[w.length - 1]]) dir = DIRS[w.pop()];
  if (w.length > 2 && DIRS[w[0]] && !SFX[w[1]]) { dir = dir || DIRS[w[0]]; w = w.slice(1); }
  else if (w.length === 2 && DIRS[w[0]] && !SFX[w[1]] && !dir) { dir = DIRS[w[0]]; w = w.slice(1); }
  let sfx = '';
  if (w.length > 1 && SFX[w[w.length - 1]]) sfx = SFX[w.pop()];
  if (!w.length || !num) return null;
  return { num, dir, name: nameKey(w), sfx };
}

const SFX_WORD = { AVE: 'Ave', ST: 'St', BLVD: 'Blvd', DR: 'Dr', PL: 'Pl', ROAD: 'Rd', WAY: 'Way', LANE: 'Ln', CT: 'Ct', TER: 'Ter',
  CIR: 'Cir', HWY: 'Hwy', TR: 'Trl', WALK: 'Walk', PKWY: 'Pkwy' };
const word = (w) => (/^\d+(ST|ND|RD|TH)$/.test(w) ? w.toLowerCase().replace(/^(\d+)/, '$1')
  : /^MC[A-Z]{2,}/.test(w) ? 'Mc' + w[2] + w.slice(3).toLowerCase()
  : w.charAt(0) + w.slice(1).toLowerCase().replace(/(['-])([a-z])/g, (m, p, c) => p + (p === '-' ? c.toUpperCase() : c)));
/** A street as people say it: "W 9th St", "S St Andrews Pl", "N McCadden Pl". */
export function streetLabel(p) {
  const name = String(p.STNAME || '').trim().split(/\s+/).filter(Boolean).map(word).join(' ');
  const sfx = String(p.STSFX || '').trim().toUpperCase(), dir = String(p.TDIR || '').trim().toUpperCase();
  const post = DIRS[String(p.SFXDIR || '').trim().toUpperCase()] || '';
  return [DIRS[dir] || '', name, SFX_WORD[sfx] || (sfx ? word(sfx) : ''), post].filter(Boolean).join(' ');
}

const parity = (v) => (Number.isFinite(v) && v > 0 ? v % 2 : null);
/** Which side (L or R, looking from the first point to the last) holds the odd house numbers, from the address ranges. */
export function oddSide(p) {
  const l = parity(p.ADLF) ?? parity(p.ADLT), r = parity(p.ADRF) ?? parity(p.ADRT);
  if (l === 1 && r !== 1) return 'L';
  if (r === 1 && l !== 1) return 'R';
  if (l === 0 && r === null) return 'R';
  if (r === 0 && l === null) return 'L';
  return null;
}
const inRange = (n, a, b) => a > 0 && b > 0 && n >= Math.min(a, b) && n <= Math.max(a, b);
/** The side of a centerline whose address range holds house number n (same parity), or null. */
export function sideOfNumber(p, n) {
  const l = inRange(n, p.ADLF, p.ADLT) && n % 2 === p.ADLF % 2;
  const r = inRange(n, p.ADRF, p.ADRT) && n % 2 === p.ADRF % 2;
  if (l && !r) return 'L';
  if (r && !l) return 'R';
  return null;
}

/** A ticket's block and side: the block of that street whose address range holds the house number (the one nearest the
 *  ticket's coordinates when several do: N and S Main St share numbers), unless it is over 150 m from the ticket and another
 *  block of the street is within 60 m; then that block, its side from the number's parity. */
export function matchTicket(loc, lat, lon, byName) {
  const a = parseLocation(loc);
  if (!a) return { why: 'address' };
  const list = byName.get(a.name);
  if (!list) return { why: 'street' };
  const q = Number.isFinite(lat) && Number.isFinite(lon) && lat ? xy([lon, lat]) : null;
  let best = null, near = null;
  for (const s of list) {
    const d = q ? distToLine(q, s.pts) : 0;
    if (q && d <= 60 && (!near || d < near.d) && (!a.sfx || !s.st.sfx || a.sfx === s.st.sfx)) near = { s, d, how: 'near' };
    const side = sideOfNumber(s.p, a.num);
    if (!side) continue;
    const score = d + (a.dir && s.st.dir && a.dir !== s.st.dir ? 1000 : 0) + (a.sfx && s.st.sfx && a.sfx !== s.st.sfx ? 500 : 0);
    if (!best || score < best.score) best = { s, side, score, d, how: 'range' };
  }
  if (best && (best.d <= 150 || !near)) return { ...best, num: a.num };
  if (!near) return { why: 'range' };
  const o = oddSide(near.s.p);
  if (!o) return { why: 'side' };
  return { ...near, side: a.num % 2 === 1 ? o : o === 'L' ? 'R' : 'L', num: a.num };
}

// ---------- which side gets which day ------------------------------------------------------------------

const TOL = 15;   // minutes around the posted window that still count as that rule's ticket
/** Does a ticket ({ dow, occ, min }) fall on a polygon's rule: its weekday, its weeks of the month, inside its window? */
export const fits = (P, t) => P.days.includes(t.dow) && (P.weeks & (1 << (t.occ - 1))) !== 0 && !!P.win && t.min != null
  && t.min >= hoursOf(P.win[0]) * 60 - TOL && t.min <= hoursOf(P.win[1]) * 60 + TOL;
const flip = (side) => (side === 'L' ? 'R' : 'L');

/** The rule groups on a block: a route whose two polygons (two days) both hold it is a pair, to split between the sides;
 *  any other polygon is a single (one day, or Monday to Friday downtown) that goes on one side or both. */
export function groupsOf(polys) {
  const by = new Map();
  for (const P of polys) { if (!by.has(P.base)) by.set(P.base, []); by.get(P.base).push(P); }
  const out = [];
  for (const [base, ps] of by) {
    if (ps.length === 2 && ps.every((P) => P.days.length === 1) && ps[0].days[0] !== ps[1].days[0]) {
      const [A, B] = ps.slice().sort((x, y) => x.id - y.id);
      out.push({ key: base, kind: 'pair', A, B });
    } else for (const P of ps) out.push({ key: P.route, kind: 'single', P, solo: !!P.solo });
  }
  return out;
}

/** Ticket counts of a group on a block, by side. Pair: aL = tickets on A's day on the left side, and so on. */
export function evidence(g, tix) {
  if (g.kind === 'pair') {
    const e = { aL: 0, aR: 0, bL: 0, bR: 0 };
    for (const t of tix) {
      const a = fits(g.A, t), b = fits(g.B, t);
      if (a === b) continue;
      e[(a ? 'a' : 'b') + t.side]++;
    }
    e.n = e.aL + e.aR + e.bL + e.bR;
    return e;
  }
  const e = { L: 0, R: 0 };
  for (const t of tix) if (fits(g.P, t)) e[t.side]++;
  e.n = e.L + e.R;
  return e;
}

/** A pair's decision on a block from its tickets: which side A's day goes on. Strong when it leads by 2 tickets and 70%. */
export function decidePair(e) {
  const m1 = e.aL + e.bR, m2 = e.aR + e.bL, n = m1 + m2;
  if (!n || m1 === m2) return { level: n ? 'mixed' : 'none', n };
  const aSide = m1 > m2 ? 'L' : 'R', share = Math.max(m1, m2) / n;
  return { level: Math.abs(m1 - m2) >= 2 && share >= 0.7 ? 'tickets' : 'weak', aSide, share, n, agree: Math.max(m1, m2) };
}
/** A single's decision: the sides holding at least a quarter of its tickets (strong from 2 tickets). */
export function decideSingle(e) {
  if (!e.n) return { level: 'none', n: 0 };
  const sides = ['L', 'R'].filter((s) => e[s] > 0 && e[s] / e.n >= 0.25);
  return { level: e.n >= 2 ? 'tickets' : 'weak', sides, n: e.n, agree: sides.reduce((a, s) => a + e[s], 0) };
}

// A decision in a form that holds along a street: by house number parity (the odd side stays the same side along a street
// whatever way each block line was drawn). Pair: the route name of the polygon on the odd side; single: 'odd' | 'even' | 'both'.
const toOdd = (g, d, odd) => (g.kind === 'pair' ? (d.aSide === odd ? g.A.route : g.B.route)
  : d.sides.length === 2 ? 'both' : d.sides[0] === odd ? 'odd' : 'even');

const ARTERIAL = /avenue|boulevard/i;
/**
 * Every block's rules by side. `blocks`: [{ id, street, ends: [nodeA, nodeB], odd: 'L'|'R', arterial, tix, groups }].
 * Steps: (1) each block's own tickets; on a block held by several routes, a route with no tickets there is dropped when
 * another has them; (2) a block without a decision takes the nearest decided block of the same street and route, up to
 * `maxHops` blocks away; (3) its own single ticket; (4) otherwise both days on both sides (flagged), except a block with no
 * ticket at all that is an arterial or held by several routes: left out (no tickets in 21 months: likely not posted).
 * Returns block id → { sides: { L: [P...], R: [P...] }, how: { groupKey: 'tickets' | 'street' | 'weak' | 'both sides' |
 * 'unknown' | 'dropped' }, unknown, hops, st (each group's evidence and decision) }.
 */
export function inferSides(blocks, { maxHops = 8 } = {}) {
  const res = new Map();
  for (const b of blocks) {
    const st = b.groups.map((g) => {
      const e = evidence(g, b.tix);
      return { g, e, d: g.kind === 'pair' ? decidePair(e) : decideSingle(e) };
    });
    const top = Math.max(0, ...st.map((x) => x.e.n)), total = st.reduce((a, x) => a + x.e.n, 0);
    // a route that wrote no ticket here while another one did is the other route's boundary street (one stray ticket
    // against 20 or more counts as none)
    for (const x of st) x.drop = st.length > 1 && ((x.e.n === 0 && top >= 2) || (x.e.n === 1 && top >= 20));
    res.set(b, { st, ticketless: total === 0 });
  }
  // (2) along streets: blocks sharing an intersection, with the same street name and the same route group
  const nodes = new Map();
  for (const b of blocks) for (const n of b.ends) { if (!nodes.has(n)) nodes.set(n, []); nodes.get(n).push(b); }
  const value = new Map(), hops = new Map(), key = (b, g) => b.id + '|' + g;
  let frontier = [];
  for (const b of blocks) for (const x of res.get(b).st) if (!x.drop && x.d.level === 'tickets') {
    value.set(key(b, x.g.key), toOdd(x.g, x.d, b.odd)); hops.set(key(b, x.g.key), 0); frontier.push([b, x.g.key]);
  }
  for (let h = 1; h <= maxHops && frontier.length; h++) {
    const votes = new Map();
    for (const [b, gk] of frontier) for (const n of b.ends) for (const o of nodes.get(n) || []) {
      if (o === b || o.street !== b.street) continue;
      const x = res.get(o).st.find((y) => y.g.key === gk);
      if (!x || x.drop || value.has(key(o, gk))) continue;
      const k = key(o, gk);
      if (!votes.has(k)) votes.set(k, { o, gk, v: new Map() });
      const vv = votes.get(k).v, val = value.get(key(b, gk));
      vv.set(val, (vv.get(val) || 0) + 1);
    }
    frontier = [];
    for (const [k, { o, gk, v }] of votes) {
      const sorted = [...v].sort((a, c) => c[1] - a[1]);
      if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) continue;    // neighbors disagree: leave it
      value.set(k, sorted[0][0]); hops.set(k, h); frontier.push([o, gk]);
    }
  }
  // (3), (4) and the rules per side
  const out = new Map();
  for (const b of blocks) {
    const { st, ticketless } = res.get(b);
    const sides = { L: [], R: [] }, how = {};
    let unknown = false;
    const kept = st.filter((x) => !x.drop);
    for (const x of kept) {
      const k = key(b, x.g.key), polysOf = x.g.kind === 'pair' ? [x.g.A, x.g.B] : [x.g.P];
      let v = value.get(k), level = v === undefined ? null : hops.get(k) === 0 ? 'tickets' : 'street';
      if (v === undefined && x.d.level === 'weak') { v = toOdd(x.g, x.d, b.odd); level = 'weak'; }
      if (v === undefined) {
        // no evidence anywhere along the street: a block nobody was ticketed on in 21 months, on an arterial or a route
        // boundary, is left out; anything else gets every day of the group on both sides
        if (ticketless && (b.arterial || st.length > 1)) { how[x.g.key] = 'dropped'; continue; }
        for (const P of polysOf) { sides.L.push(P); sides.R.push(P); }
        // a route of one polygon (downtown's weeknights, a night route) sweeps both sides: that is its rule, not a guess
        if (x.g.kind === 'single' && x.g.solo) { how[x.g.key] = 'both sides'; continue; }
        level = 'unknown'; unknown = true;
        how[x.g.key] = level;
        continue;
      }
      how[x.g.key] = level;
      if (x.g.kind === 'pair') {
        const oddP = v === x.g.A.route ? x.g.A : x.g.B, evenP = oddP === x.g.A ? x.g.B : x.g.A;
        sides[b.odd].push(oddP); sides[flip(b.odd)].push(evenP);
      } else {
        if (v === 'both' || v === 'odd') sides[b.odd].push(x.g.P);
        if (v === 'both' || v === 'even') sides[flip(b.odd)].push(x.g.P);
      }
    }
    out.set(b.id, { sides, how, unknown, hops: Object.fromEntries(kept.map((x) => [x.g.key, hops.get(key(b, x.g.key))])), st });
  }
  return out;
}

// ---------- the City's rows as objects ------------------------------------------------------------------

/** A route polygon: its rule (days, weeks, window), its route and an index for point in polygon tests. */
export function polygonOf(f) {
  const p = f.properties, route = String(p.Route || '').trim();
  const P = { id: p.OBJECTID, route, base: routeBase(route), days: parseDays(p.Posted_Day), weeks: parseWeeks(p.Weeks),
    win: parseWindow(p.Posted_Time), p, district: String(p.Maint_District || ''), districtName: p.MD_Name || '',
    idx: new PolygonIndex(ringsOf(f.geometry).map((r) => r.map(xy))), fixes: [] };
  if (!P.days.length || !P.weeks) P.excluded = `no weekday or weeks ("${p.Posted_Day}", "${p.Weeks}")`;
  else if (!P.win) P.excluded = `no posted time ("${p.Posted_Time}")`;
  return P;
}
/** A centerline block: its id (ASSETID), attributes, line and street. */
export function segmentOf(p) {
  if (!p.paths || !p.paths.length) return null;
  const c = p.paths.length === 1 ? p.paths[0] : p.paths.flat();
  if (c.length < 2) return null;
  const pts = c.map(xy);
  return { id: String(p.ASSETID), p, c, pts, len: lineLen(pts), st: centerlineStreet(p), tix: [] };
}
export const INSIDE = 0.6;   // a block lies in a polygon when 60% of its sample points do
/** The share of a block's sample points (samplePoints) inside a polygon. */
export const shareInside = (sp, P) => { let k = 0; for (const q of sp) if (P.idx.contains(q)) k++; return sp.length ? k / sp.length : 0; };
/** A block as inferSides reads it: its street, its two intersections, its odd side, its tickets and its rule groups. */
export const blockOf = (s, polys, tix) => ({ id: s.id, street: s.st.dir + ' ' + s.st.name + ' ' + s.st.sfx, ends: [s.p.INT_ID_FROM, s.p.INT_ID_TO],
  odd: oddSide(s.p) || northWestSide(s.c), arterial: ARTERIAL.test(s.p.Street_Designation || ''), tix,
  groups: groupsOf(polys.filter((P) => !P.excluded)), s });

// ---------- holidays ------------------------------------------------------------------------------

// City holidays (Los Angeles Administrative Code Sec. 4.119; a Saturday holiday is observed on the Friday before, a Sunday
// one on the Monday after). 2026 is StreetsLA's own calendar (Sweeping2026.pdf); 2027 follows the same rules and is not yet
// posted by StreetsLA.
export function cityHolidays(y) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const nth = (m, dow, n) => { const d = new Date(Date.UTC(y, m - 1, 1)); return new Date(Date.UTC(y, m - 1, 1 + ((dow - d.getUTCDay() + 7) % 7) + 7 * (n - 1))); };
  const last = (m, dow) => { const d = new Date(Date.UTC(y, m, 0)); return new Date(Date.UTC(y, m - 1, d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7))); };
  // a fixed date, moved off a weekend: [date, name]
  const obs = (yy, m, dd, name) => {
    const d = new Date(Date.UTC(yy, m - 1, dd)), w = d.getUTCDay();
    return w === 6 ? [new Date(d.getTime() - 864e5), name + ' (observed)'] : w === 0 ? [new Date(d.getTime() + 864e5), name + ' (observed)'] : [d, name];
  };
  const tg = nth(11, 4, 4);
  const list = [obs(y, 1, 1, "New Year's Day"), [nth(1, 1, 3), 'Martin Luther King Jr. Day'], [nth(2, 1, 3), "Presidents' Day"],
    [last(3, 1), 'César Chávez Day'], [last(5, 1), 'Memorial Day'], obs(y, 6, 19, 'Juneteenth'), obs(y, 7, 4, 'Independence Day'),
    [nth(9, 1, 1), 'Labor Day'], [nth(10, 1, 2), "Indigenous Peoples' Day"], obs(y, 11, 11, 'Veterans Day'), [tg, 'Thanksgiving'],
    [new Date(tg.getTime() + 864e5), 'Day after Thanksgiving'], obs(y, 12, 25, 'Christmas Day'), obs(y + 1, 1, 1, "New Year's Day")];
  const out = {};
  for (const [d, name] of list) if (d.getUTCFullYear() === y) out[iso(d)] = name;
  return out;
}

// ---------- fetch ---------------------------------------------------------------------------------

async function getJSON(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-los-angeles-build (+https://curb.guide)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const j = await r.json();
      if (j && j.error) throw new Error(`${JSON.stringify(j.error)} for ${url}`);
      return j;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 3000 * i));
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

async function inputs() {
  const routes = await cached('routes.geojson', async () => {
    log('fetching the posted sweeping routes…');
    const q = new URLSearchParams({ where: '1=1', outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'geojson',
      resultRecordCount: '2000', geometryPrecision: '6' });
    return getJSON(`${ROUTES}?${q}`);
  });
  const centerlines = await cached('centerlines.json', async () => {
    log('fetching street centerlines…');
    const out = [];
    for (let off = 0; ; off += 1000) {
      const q = new URLSearchParams({ where: '1=1', outFields: CL_FIELDS, returnGeometry: 'true', outSR: '4326', geometryPrecision: '6',
        f: 'json', resultOffset: String(off), resultRecordCount: '1000', orderByFields: 'AutoID' });
      const page = (await getJSON(`${CENTERLINE}?${q}`)).features || [];
      out.push(...page.map((f) => ({ ...f.attributes, paths: f.geometry ? f.geometry.paths : null })));
      if (off % 10000 === 0) log(`  ${out.length} centerlines`);
      if (page.length < 1000) return out;
    }
  });
  // Street cleaning tickets (violation 80.69BS, "NO PARK/STREET CLEAN") since 2025-01-01, one month per request. Only the
  // date, time, location and coordinates are kept: no ticket numbers, plates or vehicles.
  const citations = await cached('citations.json', async () => {
    const months = [];
    for (let d = new Date(CITE_FROM + 'T00:00:00Z'); d < new Date(); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
    const fetchMonth = async (m) => {
      const [y, mo] = m.split('-').map(Number), next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
      const q = new URLSearchParams({ $select: 'issue_date,issue_time,location,loc_lat,loc_long',
        $where: `violation_code='80.69BS' AND issue_date >= '${m}-01' AND issue_date < '${next}'`, $limit: '200000' });
      const page = await getJSON(`${CITATIONS}?${q}`);
      if (page.length >= 200000) throw new Error(`citations: ${m} hit the page limit`);
      log(`  citations ${m}: ${page.length}`);
      return page.map((r) => [String(r.issue_date || '').slice(0, 10), r.issue_time == null ? null : +r.issue_time, r.location || '',
        r.loc_lat == null ? null : +r.loc_lat, r.loc_long == null ? null : +r.loc_long]);
    };
    log(`fetching street cleaning citations, ${months.length} months…`);
    const rows = [];
    for (let i = 0; i < months.length; i += 4) for (const part of await Promise.all(months.slice(i, i + 4).map(fetchMonth))) rows.push(...part);
    return { fetched: new Date().toISOString(), from: CITE_FROM, violation: '80.69BS NO PARK/STREET CLEAN', rows };
  });
  const councils = await cached('neighborhood-councils.geojson', async () => {
    log('fetching neighborhood council boundaries…');
    const q = new URLSearchParams({ where: '1=1', outFields: 'NAME,NC_ID', returnGeometry: 'true', outSR: '4326', f: 'geojson', geometryPrecision: '5' });
    return getJSON(`${COUNCILS}?${q}`);
  });
  return { routes, centerlines, citations, councils };
}

// ---------- build ---------------------------------------------------------------------------------

const ROUTE_FIELDS = ['Route', 'Posted_Day', 'Weeks', 'Posted_Time', 'Boundaries', 'Maint_District', 'MD_Name', 'Route_Type'];

export async function main() {
  const { routes, centerlines, citations, councils } = await inputs();
  log(`${routes.features.length} route polygons, ${centerlines.length} centerlines, ${citations.rows.length} citations`);
  if (process.argv.includes('--fetch-only')) return null;

  // Fail loudly when the City's data changes shape.
  const f0 = routes.features[0]?.properties || {};
  for (const k of ROUTE_FIELDS) if (!(k in f0)) throw new Error(`routes: field ${k} is missing`);
  for (const k of ['ASSETID', 'ADLF', 'ADLT', 'ADRF', 'ADRT', 'STNAME', 'INT_ID_FROM', 'INT_ID_TO']) if (!(k in centerlines[0])) throw new Error(`centerlines: field ${k} is missing`);
  if (routes.features.length < 700 || centerlines.length < 80000 || citations.rows.length < 500000)
    throw new Error(`inputs look short: ${routes.features.length} polygons, ${centerlines.length} centerlines, ${citations.rows.length} tickets`);

  // 1. routes → polygons with their rule
  const polys = routes.features.map(polygonOf);
  const perBase = new Map();
  for (const P of polys) perBase.set(P.base, (perBase.get(P.base) || 0) + 1);
  for (const P of polys) P.solo = perBase.get(P.base) === 1;
  const G = 400, pgrid = new Map();
  for (const P of polys) {
    const [x0, y0, x1, y1] = P.idx.bbox;
    for (let cx = Math.floor(x0 / G); cx <= Math.floor(x1 / G); cx++) for (let cy = Math.floor(y0 / G); cy <= Math.floor(y1 / G); cy++) {
      const k = cx + ',' + cy; if (!pgrid.has(k)) pgrid.set(k, []); pgrid.get(k).push(P);
    }
  }

  // 2. centerlines, one per ASSETID (85 ids appear twice, with the same line), and the polygons each one lies in
  const seen = new Set(), segs = [];
  for (const p of centerlines) {
    if (seen.has(p.ASSETID)) continue;
    const seg = segmentOf(p);
    if (seg) { seen.add(p.ASSETID); segs.push(seg); }
  }
  const shareHist = new Array(11).fill(0);
  for (const s of segs) {
    const sp = samplePoints(s.pts), cand = new Set();
    for (const q of sp) for (const P of pgrid.get(Math.floor(q[0] / G) + ',' + Math.floor(q[1] / G)) || []) cand.add(P);
    s.in = [];
    let best = 0;
    for (const P of cand) {
      const share = shareInside(sp, P);
      if (share > best) best = share;
      if (share >= INSIDE) s.in.push(P);
    }
    shareHist[Math.round(best * 10)]++;
  }
  const inRoutes = segs.filter((s) => s.in.length);
  log(`${segs.length} centerlines, ${inRoutes.length} inside a route polygon`);

  // 3. tickets → block and side
  const byName = new Map();
  for (const s of segs) { if (!byName.has(s.st.name)) byName.set(s.st.name, []); byName.get(s.st.name).push(s); }
  const unmatched = {}, holidayDates = new Set([...Object.keys(cityHolidays(2025)), ...Object.keys(cityHolidays(2026))]);
  let matched = 0, onHoliday = 0, fifth = 0, weekend = 0;
  for (const [date, hhmm, loc, lat, lon] of citations.rows) {
    const m = matchTicket(loc, lat, lon, byName);
    if (!m.s) { unmatched[m.why] = (unmatched[m.why] || 0) + 1; continue; }
    matched++;
    const [y, mo, d] = date.split('-').map(Number), dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(), occ = Math.floor((d - 1) / 7) + 1;
    if (holidayDates.has(date)) onHoliday++;
    if (occ === 5) fifth++;
    if (dow === 0 || dow === 6) weekend++;
    m.s.tix.push({ date, dow, occ, min: hhmm == null ? null : Math.floor(hhmm / 100) * 60 + hhmm % 100, side: m.side, how: m.how });
  }
  log(`${matched}/${citations.rows.length} tickets on a block side; not placed: ${JSON.stringify(unmatched)}`);

  // 4. each polygon against its tickets: the weeks and the window it lists, and whether it is ticketed at all. Counted on
  // the blocks where it is the only polygon with its weekday, so a neighbor's tickets don't count against it.
  for (const P of polys) P.chk = { fit: 0, n: 0, listedWeeks: 0, otherWeeks: 0, fifth: 0, inWin: 0, all: 0 };
  for (const s of inRoutes) for (const t of s.tix) {
    for (const P of s.in) if (fits(P, t)) P.chk.fit++;        // every ticket on its day, weeks and hours, on any of its blocks
    const hits = s.in.filter((P) => P.days.includes(t.dow));
    if (hits.length !== 1) continue;
    const P = hits[0], c = P.chk;
    c.all++;
    if (!P.win || t.min == null) continue;
    const inWin = t.min >= hoursOf(P.win[0]) * 60 - TOL && t.min <= hoursOf(P.win[1]) * 60 + TOL;
    if (inWin) c.inWin++;
    if (!inWin) continue;
    c.n++;
    if (t.occ === 5) c.fifth++;
    else if (P.weeks & (1 << (t.occ - 1))) c.listedWeeks++;
    else c.otherWeeks++;
  }
  for (const P of polys) {
    if (P.excluded) continue;
    const c = P.chk;
    if (c.fit < 5) { P.excluded = `${c.fit} tickets on its day and hours in 21 months: not enforced`; continue; }
    if (c.all >= 100 && c.inWin / c.all < 0.1) { P.excluded = `${c.all - c.inWin} of ${c.all} tickets on its day fall outside its posted window (${P.p.Posted_Time})`; continue; }
    // Tickets on the other weeks of the month too (often on a route where the City says 1st & 3rd): warn on all four weeks.
    if (P.weeks !== 31 && c.n >= 100 && c.otherWeeks / c.n >= 0.2) {
      P.fixes.push({ what: 'weeks', was: P.p.Weeks, now: '1st to 4th', why: `${c.otherWeeks} of ${c.n} tickets on its day and hours fall on the other weeks of the month` });
      P.weeks |= 15;
    }
  }
  const excluded = polys.filter((P) => P.excluded);
  log(`${excluded.length} polygons left out: ${excluded.map((P) => `${P.route} (${P.excluded})`).join('; ')}`);
  log(`weeks widened: ${polys.filter((P) => P.fixes.length).map((P) => `${P.route} (${P.fixes[0].why})`).join('; ') || 'none'}`);

  // 5. sides
  const nodeStreets = new Map();   // intersection id → street labels, for the cross streets
  for (const s of segs) for (const n of [s.p.INT_ID_FROM, s.p.INT_ID_TO]) {
    if (!nodeStreets.has(n)) nodeStreets.set(n, new Map());
    nodeStreets.get(n).set(s.st.dir + ' ' + s.st.name + ' ' + s.st.sfx, streetLabel(s.p));
  }
  const blocks = inRoutes.map((s) => blockOf(s, s.in, s.tix)).filter((b) => b.groups.length);
  const result = inferSides(blocks);

  // out of sample: sides from the 2025 tickets only, checked against 2026's
  const blocks25 = blocks.map((b) => ({ ...b, tix: b.tix.filter((t) => t.date < '2026-01-01') }));
  const result25 = inferSides(blocks25);

  // 6. blocks out
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const limitsOf = (s) => {
    const k = s.st.dir + ' ' + s.st.name + ' ' + s.st.sfx;
    const at = (n) => [...(nodeStreets.get(n) || new Map()).entries()].filter(([kk]) => kk !== k).map(([, v]) => v).filter(Boolean).sort()[0] || '';
    const a = at(s.p.INT_ID_FROM), b = at(s.p.INT_ID_TO);
    return a && b && a !== b ? `${a} - ${b}` : a || b;
  };
  const ruleOf = (P) => P.days.map((d) => [d, P.win[0], P.win[1], P.weeks, 0, 0]);
  const out = [], segDistrict = new Map();
  const how = { tickets: 0, street: 0, weak: 0, 'both sides': 0, unknown: 0, dropped: 0 }, hopHist = {};
  for (const b of blocks) {
    const r = result.get(b.id), s = b.s;
    for (const [gk, lv] of Object.entries(r.how)) { how[lv]++; if (lv === 'street') hopHist[r.hops[gk]] = (hopHist[r.hops[gk]] || 0) + 1; }
    const d = [];
    for (const side of ['L', 'R']) {
      const rules = [], seenR = new Set();
      for (const P of r.sides[side]) for (const rule of ruleOf(P)) { const k = rule.join('|'); if (!seenR.has(k)) { seenR.add(k); rules.push(rule); } }
      rules.sort((x, y) => x[0] - y[0] || hoursOf(x[1]) - hoursOf(y[1]));
      if (rules.length) d.push([side, compass(s.c, side), rules]);
    }
    if (!d.length) continue;
    const nums = ['ADLF', 'ADLT', 'ADRF', 'ADRT'].map((k) => s.p[k]).filter((v) => v > 0);
    const o = oddSide(s.p);
    const blk = { c: s.id, s: streetLabel(s.p), l: limitsOf(s), ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}),
      ...(o ? { o } : {}), g: simplify(s.c).map(([lo, la]) => [r6(lo), r6(la)]), d, ...(r.unknown ? { u: 1 } : {}) };
    out.push(blk);
    const kept = [...r.sides.L, ...r.sides.R];
    segDistrict.set(s.id, (kept[0] || b.groups[0].A || b.groups[0].P).district);
  }
  out.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));
  const outIds = new Map(out.map((b) => [b.c, b]));
  log(`blocks: ${out.length}; route groups decided by own tickets ${how.tickets}, along the street ${how.street}, by one ticket ${how.weak}, one polygon on both sides ${how['both sides']}, both sides (unknown) ${how.unknown}, left out ${how.dropped}`);

  // 7. cross-checks: does each ticket land on a block side the data says is swept that day and hour?
  const fitsRule = (rule, t) => rule[0] === t.dow && (rule[3] & (1 << (t.occ - 1))) !== 0 && t.min != null
    && t.min >= hoursOf(rule[1]) * 60 - TOL && t.min <= hoursOf(rule[2]) * 60 + TOL;
  const checkWith = (res, filter) => {
    const c = { tickets: 0, sameSide: 0, otherSideOnly: 0, blockNoRuleThen: 0, blockNotInData: 0, unknownSides: 0 };
    for (const s of segs) for (const t of s.tix) {
      if (!filter(t)) continue;
      c.tickets++;
      const r = res && res.get(s.id);
      if (!r || (!r.sides.L.length && !r.sides.R.length)) { c.blockNotInData++; continue; }
      const on = (side) => r.sides[side].some((P) => ruleOf(P).some((rule) => fitsRule(rule, t)));
      if (on(t.side)) { c.sameSide++; if (r.unknown) c.unknownSides++; } else if (on(flip(t.side))) c.otherSideOnly++; else c.blockNoRuleThen++;
    }
    for (const k of ['sameSide', 'otherSideOnly', 'blockNoRuleThen', 'blockNotInData']) c[k + 'Pct'] = +(100 * c[k] / Math.max(1, c.tickets)).toFixed(1);
    return c;
  };
  const crossAll = checkWith(result, () => true);
  const cross2026 = checkWith(result25, (t) => t.date >= '2026-01-01');
  log(`cross-check, all tickets: ${crossAll.sameSidePct}% on a side swept that day and hour, ${crossAll.otherSideOnlyPct}% only the other side, ${crossAll.blockNoRuleThenPct}% no rule then, ${crossAll.blockNotInDataPct}% block not in data`);
  log(`out of sample (sides from 2025, 2026 tickets): ${cross2026.sameSidePct}% same side, ${cross2026.otherSideOnlyPct}% other side only, ${cross2026.blockNoRuleThenPct}% no rule then, ${cross2026.blockNotInDataPct}% block not in data`);

  // 8. confidence per route: of the tickets on its blocks that decide a side, the share that agree with the side chosen
  const perRoute = new Map();
  for (const b of blocks) {
    const r = result.get(b.id);
    for (const x of r.st) {
      if (x.g.kind !== 'pair') continue;
      const R = perRoute.get(x.g.key) || { route: x.g.key, days: `${x.g.A.p.Day_Short} / ${x.g.B.p.Day_Short}`, blocks: 0, tickets: 0, agree: 0,
        byTickets: 0, alongStreet: 0, oneTicket: 0, unknown: 0, dropped: 0 };
      const lv = r.how[x.g.key];
      if (!lv) { perRoute.set(x.g.key, R); continue; }
      R.blocks++;
      if (lv === 'tickets') R.byTickets++; else if (lv === 'street') R.alongStreet++; else if (lv === 'weak') R.oneTicket++; else if (lv === 'unknown') R.unknown++; else if (lv === 'dropped') R.dropped++;
      if (lv !== 'dropped' && lv !== 'unknown') {
        // agreement against the side used, whichever way it was decided
        const aSide = r.sides.L.includes(x.g.A) && !r.sides.R.includes(x.g.A) ? 'L' : r.sides.R.includes(x.g.A) && !r.sides.L.includes(x.g.A) ? 'R' : null;
        if (aSide) { const e = x.e; R.tickets += e.n; R.agree += aSide === 'L' ? e.aL + e.bR : e.aR + e.bL; }
      }
      perRoute.set(x.g.key, R);
    }
  }
  const routeConf = [...perRoute.values()].map((R) => ({ ...R, confidence: R.tickets ? +(R.agree / R.tickets).toFixed(3) : null }))
    .sort((a, b) => (a.confidence ?? -1) - (b.confidence ?? -1) || a.route.localeCompare(b.route));

  return { polys, segs, blocks, result, out, outIds, segDistrict, how, hopHist, crossAll, cross2026, routeConf, excluded, shareHist,
    matched, unmatched, onHoliday, fifth, weekend, citations, routes, centerlines, councils };
}


// ---------- write ---------------------------------------------------------------------------------

const CENTER = [34.0635, -118.301];   // Koreatown: among the most ticketed square miles of street cleaning in the City
const MAX_FILE = 6 * 1024 * 1024;

async function write(r) {
  const { polys, segs, blocks, result, out, segDistrict, how, hopHist, crossAll, cross2026, routeConf, excluded, citations } = r;
  const today = new Date().toISOString().slice(0, 10), generated = new Date().toISOString();
  const lastTicket = citations.rows.reduce((m, x) => (x[0] > m ? x[0] : m), '');
  const sources = [
    { name: 'Posted Street Sweeping Routes (StreetsLA)', url: 'https://services1.arcgis.com/PTh9WC0Sf2WS7AAq/arcgis/rest/services/Posted_Street_Sweeping_Routes_Update/FeatureServer/0',
      license: 'not stated', fetched: today },
    { name: 'Streets (Centerline) (Bureau of Engineering, LA GeoHub)', url: 'https://maps.lacity.org/lahub/rest/services/Street_Information/MapServer/36',
      license: 'not stated', fetched: today },
    { name: 'Parking Citations (LADOT, Los Angeles Open Data)', url: 'https://data.lacity.org/Transportation/Parking-Citations/4f5p-udkv',
      license: 'CC0 1.0', fetched: citations.fetched.slice(0, 10), used: `street cleaning tickets (80.69BS) ${CITE_FROM} to ${lastTicket}: date, time, location` },
    { name: 'Street Sweeping 2026 Biweekly Schedule (StreetsLA)', url: 'https://streets.lacity.gov/sites/default/files/2025-12/Sweeping2026.pdf',
      license: 'City web page', fetched: today },
    { name: 'Neighborhood Councils (Certified) (LA GeoHub)', url: 'https://maps.lacity.org/lahub/rest/services/Boundaries/MapServer/18',
      license: 'not stated', fetched: today, used: 'the welcome card\'s neighborhood list' },
  ];
  const sidesCount = out.reduce((n, b) => n + b.d.length, 0), rulesCount = out.reduce((n, b) => n + b.d.reduce((m, d) => m + d[2].length, 0), 0);
  const format = 'b[] = {c: centerline ASSETID, s: street, l: cross streets, n: [lowest, highest house number], o: the side with odd numbers (L|R), '
    + 'g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]], u: 1 when which side gets which day is not known (every day of the route on both sides)}; '
    + 'rule = [jsDow, from, to, weeksMask (bit i = week i+1), monthsMask (0 = all year), flags (0: suspended on City holidays, no tow)]';
  const meta = (extra) => ({ city: 'los-angeles', time_zone: 'America/Los_Angeles', generated, sources, ...extra, format });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({ _meta: meta({ blocks: out.length, sides: sidesCount }), b: out }));
  const size = fs.statSync(OUT + 'segments.json').size;

  // bounds of every block, and per StreetsLA maintenance district when the whole file is too big for one load
  const bboxOf = (list) => {
    let w = 180, s = 90, e = -180, n = -90;
    for (const b of list) for (const [lo, la] of b.g) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < s) s = la; if (la > n) n = la; }
    return [w, s, e, n].map((v) => Math.round(v * 1e5) / 1e5);
  };
  const files = { 'segments.json': size };
  let districts = [];
  for (const f of fs.readdirSync(OUT)) if (/^segments-.+\.json$/.test(f)) fs.unlinkSync(OUT + f);
  if (size > MAX_FILE) {
    const names = new Map(polys.map((P) => [P.district, P.districtName]));
    const by = new Map();
    for (const b of out) { const d = segDistrict.get(b.c) || 'other'; if (!by.has(d)) by.set(d, []); by.get(d).push(b); }
    for (const [d, list] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
      const file = `segments-${d}.json`, bbox = bboxOf(list);
      fs.writeFileSync(OUT + file, JSON.stringify({ _meta: meta({ district: d, districtName: names.get(d) || '', bbox, blocks: list.length,
        sides: list.reduce((n, b) => n + b.d.length, 0) }), b: list }));
      const bytes = fs.statSync(OUT + file).size;
      files[file] = bytes;
      districts.push({ id: d, name: names.get(d) || '', file, bbox: bbox.join(','), blocks: list.length, bytes });
    }
  }
  const [w, s, e, n] = bboxOf(out);

  // the welcome card: the neighborhood councils with the most swept block sides, by their place names (the councils named
  // after something else, such as "Empowerment Congress Central Area" or "Voices", are left out)
  const councilIdx = (r.councils.features || []).map((f) => ({ name: f.properties.NAME, idx: new PolygonIndex(ringsOf(f.geometry).map((ring) => ring.map(xy))) }));
  const NOT_A_PLACE = /EMPOWERMENT|UNITED NEIGHBORHOODS|VOICES|LA-32|P\.I\.C\.O|CANNDU|ZAPATA|HISTORIC CULTURAL|FOOTHILL TRAILS|SOUTH CENTRAL|CENTRAL ALAMEDA|PARK MESA/;
  const placeName = (n) => String(n).replace(/\s+(NC|NDC|CC)$/, '').replace(/^NC\s+/, '').split(/\s+/)
    .map((w) => w.split('-').map((x) => x.charAt(0) + x.slice(1).toLowerCase()).join('-')).join(' ').replace(/\bNoho\b/, 'NoHo');
  const byCouncil = new Map();
  for (const b of out) {
    const q = xy(b.g[Math.floor(b.g.length / 2)]), C = councilIdx.find((x) => x.idx.contains(q));
    if (!C || NOT_A_PLACE.test(C.name)) continue;
    const x = byCouncil.get(C.name) || { n: 0, w: 180, s: 90, e: -180, nn: -90 };
    x.n += b.d.length;
    for (const [lo, la] of b.g) { x.w = Math.min(x.w, lo); x.e = Math.max(x.e, lo); x.s = Math.min(x.s, la); x.nn = Math.max(x.nn, la); }
    byCouncil.set(C.name, x);
  }
  const neighborhoods = [...byCouncil].sort((a, b) => b[1].n - a[1].n).slice(0, 12)
    .map(([name, x]) => ({ name: placeName(name), bbox: [x.w, x.s, x.e, x.nn].map((v) => Math.round(v * 1e4) / 1e4).join(',') }));
  const holidays = { ...cityHolidays(2026), ...cityHolidays(2027) };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify({
    id: 'los-angeles', name: 'Los Angeles', region: 'California', tz: 'America/Los_Angeles',
    center: CENTER, zoom: 15, bounds: [[s, w], [n, e]],
    holidays, holidaysSource: 'https://streets.lacity.gov/sites/default/files/2025-12/Sweeping2026.pdf',
    holidaysNote: '2026 from StreetsLA\'s calendar; 2027 not yet posted by StreetsLA, derived from the same City holiday rules (Administrative Code Sec. 4.119)',
    holidayRule: 'all',
    fine: '$73', tow: 'no', fineSource: 'https://data.lacity.org/Transportation/Parking-Citations/4f5p-udkv',
    agency: 'StreetsLA (Bureau of Street Services)', ticketAgency: 'LADOT',
    scheduleUrl: 'https://streets.lacity.gov/services/street-sweeping',
    sources,
    words: {
      rule: 'Posted streets are swept every other week, on the 1st and 3rd or the 2nd and 4th time that weekday comes in the month: one side of the street on one day, the other side on another, during the hours on the sign.',
      afterpass: 'All year. No sweeping on City holidays, and no make-up day. $73 ticket, no tow.',
      dataNotes: `Days, weeks and hours come from StreetsLA's posted sweeping routes. StreetsLA doesn't publish which side of the street is swept on which day, so CURB placed the ${r.matched.toLocaleString('en-US')} street cleaning tickets written since January 2025 on their block and side by address, and gave each side the day its tickets fall on; a block with no tickets takes the side of the nearest ticketed block on its street. Where neither tells, both days show on both sides.`,
    },
    neighborhoods,
    ...(districts.length ? { segmentFiles: districts.map(({ id, name, file, bbox, blocks: nb }) => ({ id, name, file, bbox, blocks: nb })) } : {}),
  }, null, 1));

  // the report
  // blocks inside a route polygon that got no rules, and why
  const leftOut = {};
  const addLeft = (k, s, routes) => {
    const x = (leftOut[k] ||= { blocks: 0, examples: [] });
    x.blocks++;
    if (x.examples.length < 6) x.examples.push({ c: s.id, s: streetLabel(s.p), routes });
  };
  const inBlocks = new Set(blocks.map((b) => b.id));
  for (const s of segs) if (s.in.length && !inBlocks.has(s.id)) addLeft('only in polygons left out (see polygons.leftOut)', s, s.in.map((P) => P.route));
  for (const b of blocks) {
    if (r.outIds.has(b.id)) continue;
    const k = b.tix.length === 0 ? (b.arterial ? 'no street cleaning ticket in 21 months, arterial' : 'no street cleaning ticket in 21 months, on a route boundary')
      : 'on a route boundary, no ticket fits its rules';
    addLeft(k, b.s, b.groups.map((g) => g.key));
  }
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const ticketlessKept = out.filter((x) => blockById.get(x.c)?.tix.length === 0).length;
  const routeBases = new Set(polys.map((P) => P.base));
  const low = routeConf.filter((x) => x.tickets < 30 || (x.confidence !== null && x.confidence < 0.8));
  const conf = routeConf.filter((x) => x.tickets >= 30);
  const pooled = conf.reduce((a, x) => [a[0] + x.agree, a[1] + x.tickets], [0, 0]);
  const confHist = {};
  for (const x of conf) { const k = x.confidence >= 0.95 ? '>=0.95' : x.confidence >= 0.9 ? '0.90-0.95' : x.confidence >= 0.8 ? '0.80-0.90' : x.confidence >= 0.7 ? '0.70-0.80' : '<0.70'; confHist[k] = (confHist[k] || 0) + 1; }
  const polyChecks = polys.filter((P) => !P.excluded && P.chk.all >= 50 && P.chk.inWin / P.chk.all < 0.8)
    .map((P) => ({ route: P.route, time: P.p.Posted_Time, ticketsOnItsDay: P.chk.all, insideWindow: P.chk.inWin }));
  const rep = {
    generated,
    inputs: { polygons: polys.length, routes: routeBases.size, centerlines: r.centerlines.length, uniqueCenterlines: segs.length,
      tickets: citations.rows.length, ticketsFrom: CITE_FROM, ticketsTo: lastTicket },
    polygons: {
      used: polys.length - excluded.length,
      leftOut: excluded.map((P) => ({ route: P.route, day: P.p.Posted_Day, weeks: P.p.Weeks, time: P.p.Posted_Time, boundaries: P.p.Boundaries, why: P.excluded })),
      weeksWidened: polys.filter((P) => P.fixes.length).map((P) => ({ route: P.route, day: P.p.Posted_Day, ...P.fixes[0] })),
      windowDoubts: polyChecks,
      membership: 'a block belongs to a polygon when 60% of its line (18 m left out at each end) lies inside; share of each block\'s best polygon, by tenths: ' + r.shareHist.join(' '),
    },
    blocks: {
      inRoutePolygons: segs.filter((x) => x.in.length).length, withoutTicketsButKept: ticketlessKept,
      withRules: out.length, sides: sidesCount, rules: rulesCount, unknownSides: out.filter((b) => b.u).length,
      leftOut,
      curbMiles: +(out.reduce((a, b) => a + lineLen(b.g.map(xy)) * b.d.length, 0) / 1609.34).toFixed(0),
      curbMilesKnownSide: +(out.reduce((a, b) => a + (b.u ? 0 : lineLen(b.g.map(xy)) * b.d.length), 0) / 1609.34).toFixed(0),
      curbMilesNote: 'StreetsLA: "more than 4,700 curb miles" posted for sweeping (streets.lacity.gov/services/street-sweeping)',
      sizeBytes: size,
    },
    sides: {
      method: 'per block from its own tickets (house number parity, 2+ ticket lead and 70%), else the nearest decided block of the same street and route (up to 8 blocks), else its single ticket, else both days on both sides',
      routeGroups: how, alongStreetByHops: hopHist,
      holdout: 'hiding a decided block and copying its nearest decided neighbor on the street was right 97.7% of the time one block away, 93% two or three away, 89% four away (2026-10-18 run)',
    },
    tickets: {
      placed: r.matched, unplaced: r.unmatched, onCityHolidays2025and2026: r.onHoliday, onFifthWeekday: r.fifth, onWeekends: r.weekend,
      note: 'placed by address: the block whose address range holds the house number, its side by the number; 5th weekdays are for unposted routes only',
    },
    crossCheck: {
      allTickets: crossAll,
      outOfSample: { ...cross2026, how: 'sides inferred from 2025 tickets only, checked against 2026 tickets' },
      reading: 'sameSide = the ticket\'s side is swept that weekday, week and hour (15 min slack); otherSideOnly = only the opposite side is (mostly an address written for the other side of the street); blockNoRuleThen = the block is in the data but nothing is swept then; blockNotInData = the block has no rules',
    },
    routeConfidence: { pooledAgreement: pooled[1] ? +(pooled[0] / pooled[1]).toFixed(3) : null, routesWith30Tickets: conf.length, histogram: confHist,
      lowOrThin: low.map((x) => ({ route: x.route, days: x.days, blocks: x.blocks, tickets: x.tickets, confidence: x.confidence })),
      all: routeConf },
    season: 'none: all year',
    holidays: 'City holidays: no sweeping and no make-up day (StreetsLA calendar). Tickets on the 26 City holidays of 2025-26: ' + r.onHoliday,
    files,
    districts,
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(rep, null, 1));
  for (const [f, b] of Object.entries(files)) log(`wrote data/los-angeles/${f} (${Math.round(b / 1024)} KB)`);
  log(`wrote data/los-angeles/city.json, report.json (${Math.round(fs.statSync(OUT + 'report.json').size / 1024)} KB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await main();
  if (r) await write(r);
}
