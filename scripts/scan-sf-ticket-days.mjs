#!/usr/bin/env node
// Finds SF block sides where the City's published sweeping schedule (DataSF yhqp-riqs) is wrong, using the City's own
// street cleaning tickets (DataSF ab4h-6ztd, STR CLEAN + ST CLEANIN) from the last 12 months as evidence. Read only: it
// writes a candidate list to private/sf-ticket-scan.json and never touches CURB's data.
//
// The case that started it: Shotwell St, 16th to 17th (cnn 11834000). DataSF says the east side sweeps Wed 12 to 2 PM;
// its odd addresses are ticketed every Thursday around 8 AM and never on a Wednesday, and the posted sign there reads
// "No parking 8 AM to 10 AM Thursday".
//
// Method
// 1. Block (cnn): by the WRITTEN address, house number + street → EAS (3mea-di5p, full street name, so Buena Vista Ave
//    East and West stay apart) exact match; else the block EAS gives that hundred and parity; else (a side with no
//    addresses, like a park) the other parity's hundred. The feed's latitude/longitude geocode the same typed address
//    (not the officer's GPS; CLAUDE.md), so the point is only a fallback: nearest segment of the same street within 40 m,
//    if the number fits that block's EAS range, and never a point shared by 5+ addresses (the geocoder's fallback spots).
//    Houses on the Lower Great Hwy frontage are addressed GREAT HWY: they go to the frontage block when nearer to it.
// 2. Side (L/R of the line as digitized, the frame of cnnrightleft): EAS address points on the block vote which side each
//    parity is on; no clear vote → the point's side. Twin cnns (one curb each on the same line, like Lincoln Way's park
//    side) are read as one block. Per side, the share of tickets whose geocoded point lands on that side is a check.
// 3. Per side and weekday: tickets, distinct dates (holidays out), dates in the last 90 days, hours, best 2 hour window.
// 4. Flags (thresholds in T):
//    - unlisted-day: a weekday with no row on that side, ticketed on >= 8 dates, >= 75% of tickets in one 2 hour window,
//      >= 2 dates in the last 90 days;
//    - wrong-hours: a listed weekday whose tickets are >= 80% outside its window; extra-window when the listed window is
//      still ticketed on more than 15% as many dates (a second window, not a wrong one);
//    - wrong-weeks: >= 8 in-window dates in weeks the City says are free, or (>= 15 dates) a week pattern that beats the
//      City's by a likelihood ratio of e^6 with City weeks 1-4 never ticketed (a 5th week alone is never flagged);
//    each dropped by the noise checks: the other side lists that day and hour with twice the dates (mis-sided
//    addresses), a same-street neighbour lists it with 3x the dates (corner spill), the side's geocoded points agree
//    with its side < 70%, or < 2 dates in the last 90 days (stale).
// 5. Week of month: the DataSF pattern (11111, 01010, 10100, 10101, 01011, 10000) with the highest likelihood, on weeks
//    hit at the pattern's own rate, off weeks at 3%; days with almost no tickets citywide are left out.
// A listed row is contradicted (dropped from the proposal) only on a side with an unlisted-day flag, when its window was
// ticketed on <= 15% as many dates and <= 3 dates (0 for Sat/Sun). Swapped: each side's ticketed day is listed for the
// other side.
// Confidence: high = every flagged day has >= 15 dates, >= 80% in its window, >= 3 dates in the last 90 days, AND the
// City's version is contradicted: a listed weekday row practically never ticketed, wrong hours, tickets in weeks the City
// says are free, a swap, or a side with no rows whose other side barely sees tickets that day. Everything else is medium
// (often a day missing next to listed days that are also ticketed).
//
// Feed gotcha: tickets written 12:00 to 12:59 AM may show a wrong hour, the first digit of the minute (00:24 → 02:24;
// scripts/midnight-hour.mjs); dates are right. In the Nov 2025 to Nov 2026 feed 269 of 360 days already show real
// 00:01 to 00:59 times, and those days are left alone. Elsewhere a 1 to 5 AM ticket that looks misdated counts as 12 AM
// when the side's listed window that day holds 00:MM, or when >= 90% of that side-day's 1 to 5 AM tickets look misdated
// (a real 2 to 4 AM sweep has only ~1 in 6 that do).
//
// Run: node scripts/scan-sf-ticket-days.mjs [--refresh] [--since YYYY-MM-DD] [--cnn 11834000]
// Downloads are cached in private/cache/sf-scan/ (gitignored); --refresh downloads again.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../lib/sweep-core.js';   // side effect: HOL_DAY on globalThis (2026 on)
import { looksMisdated } from './midnight-hour.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE = path.join(ROOT, 'private', 'cache', 'sf-scan');
const OUT = path.join(ROOT, 'private', 'sf-ticket-scan.json');
const BASE = 'https://data.sf.gov/resource';
const PAGE = 50000;
const UA = { 'User-Agent': 'curb-scan-sf-ticket-days' };

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const REFRESH = flag('--refresh');
const DEBUG_CNN = opt('--cnn');
const isoDay = (d) => d.toISOString().slice(0, 10);
const SINCE = opt('--since') || isoDay(new Date(Date.now() - 365 * 864e5));

const T = {
  MIN_DATES: 8,          // distinct non-holiday dates a weekday must be ticketed on (of ~52 in a year; ~24 on a 1st+3rd)
  MIN_CONC: 0.75,        // share of that weekday's tickets inside its best 2 hour window
  MIN_RECENT: 2,         // dates in the last 90 days: older patterns may be a schedule the City already changed
  RECENT_DAYS: 90,
  OUT_OF_WINDOW: 0.8,    // wrong hours: share of a listed day's tickets outside the listed window
  OTHER_RATIO: 0.5,      // the other side lists the day and hour: need >= half its dates, else mis-sided addresses
  SPILL_RATIO: 3,        // a same-street neighbour lists the day and hour with 3x our dates: corner spill
  SIDE_AGREE: 0.7,       // share of the side's tickets whose geocoded point lands on the side we assigned
  CONTRADICTED: 0.15,    // listed day ticketed on <= 15% as many dates as the flagged day: the City row looks wrong
  CONTRADICTED_MAX_DATES: 3,   // ... and on 3 dates or fewer in a year (0 for a weekend row)
  CONFIRMED: 0.35,       // listed day ticketed on >= 35% as many dates: the City row holds, the flagged day is extra
  HIGH_DATES: 15, HIGH_CONC: 0.8, HIGH_RECENT: 3,
  WEEK_NOISE: 0.03,      // week of month: chance a date in an off week gets a ticket anyway (stray, mis-sided)
  WEEK_LLR_UNSURE: 2,    // best pattern beats the runner-up by < 2 log-likelihood (~7x): marked unsure
  WEEK_LLR_FEWER: 6,     // "fewer weeks" flag: the tickets' pattern beats the City's by >= 6 (~400x)
  NIGHT_MISDATED: 0.9,   // side-day: share of 1 to 5 AM tickets that look misdated before they all count as 12 AM
  TOL_M: 40,             // point fallback: ticket point → same-street segment
};

// 2025 holidays inside the 12-month window (sweep-core's table starts in 2026). SFMTA: Veterans Day, Thanksgiving + the
// day after, Christmas.
const HOLIDAYS = new Set([...(globalThis.HOL_DAY || []), '2025-11-11', '2025-11-27', '2025-11-28', '2025-12-25']);
const DOW_LABEL = ['Sun', 'Mon', 'Tues', 'Wed', 'Thu', 'Fri', 'Sat'];   // DataSF's weekday spelling
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const log = (...a) => console.error('[scan]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------------- fetch
async function getJSON(url, params, tries = 5) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { headers: UA });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
    } catch (e) { if (i === tries - 1) throw e; await sleep(2000 * (i + 1)); }
  }
  throw new Error(`gave up on ${u}`);
}

// Pages a dataset with an :id cursor (deep $offset times out on the big tables) and caches the compacted rows.
async function cached(name, url, select, where, pack) {
  const file = path.join(CACHE, `${name}.json`);
  if (!REFRESH && fs.existsSync(file)) { const rows = JSON.parse(fs.readFileSync(file, 'utf8')); log(`${name}: ${rows.length} rows (cache)`); return rows; }
  const out = [];
  let last = null;
  for (;;) {
    const w = last ? `(${where}) AND :id > '${last}'` : where;
    const rows = await getJSON(url, { $select: `:id,${select}`, $where: w, $order: ':id', $limit: String(PAGE) });
    for (const r of rows) out.push(pack(r));
    log(`${name}: +${rows.length} (${out.length})`);
    if (rows.length < PAGE) break;
    last = rows[rows.length - 1][':id'];
  }
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

// ------------------------------------------------------------------------------------------------------------ geometry
const LAT0 = 37.7749, LON0 = -122.4194;
const KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110540;
const xy = (lon, lat) => [(lon - LON0) * KX, (lat - LAT0) * KY];

// Distance from (x, y) to a polyline and which side of it the point is on, relative to the digitized direction.
// cross > 0 = left. Checked on Shotwell (digitized north to south): west = R, as DataSF's cnnrightleft says.
function sideOf(pts, x, y) {
  let best = Infinity, off = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
    const d = Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
    if (d < best) { best = d; off = (dx * (y - y1) - dy * (x - x1)) / Math.sqrt(len2); }
  }
  return { d: best, off, side: off > 0 ? 'L' : 'R' };
}

// Compass name of a side: the outward normal at the line's middle.
function compass(pts, side) {
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const [nx, ny] = side === 'R' ? [dy, -dx] : [-dy, dx];
  const ang = (Math.atan2(nx, ny) * 180 / Math.PI + 360) % 360;   // 0 = north, clockwise
  return ['North', 'NorthEast', 'East', 'SouthEast', 'South', 'SouthWest', 'West', 'NorthWest'][Math.round(ang / 45) % 8];
}

// ------------------------------------------------------------------------------------------------------- street names
const TYPE_ALIAS = { STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR', ROAD: 'RD', LANE: 'LN',
  COURT: 'CT', PLACE: 'PL', TERRACE: 'TER', HIGHWAY: 'HWY', CIRCLE: 'CIR', ALLEY: 'ALY', PLAZA: 'PLZ', PARKWAY: 'PKWY' };
const TYPES = new Set(['ST', 'AVE', 'BLVD', 'DR', 'RD', 'LN', 'CT', 'PL', 'TER', 'HWY', 'CIR', 'ALY', 'PLZ', 'PKWY', 'WAY',
  'ROW', 'WALK', 'STWY', 'LOOP', 'EXPY']);
const normType = (t) => { const u = String(t || '').toUpperCase().replace(/[^A-Z]/g, ''); return TYPE_ALIAS[u] || u; };
const DIRS = new Set(['NORTH', 'SOUTH', 'EAST', 'WEST']);
const normName = (s) => String(s || '').toUpperCase().replace(/'/g, '').replace(/[^A-Z0-9 ]/g, ' ').trim().split(/\s+/)
  .map((w) => w.replace(/^0+(?=\d)/, '')).join(' ').replace(/^ST (?=\S)/, 'SAINT ');
// "BUENA VISTA AVE EAST" -> { name: BUENA VISTA, type: AVE, dir: EAST }. The same split runs on ticket addresses, EAS full
// street names and DataSF corridors, so their keys line up (Buena Vista Ave East and West number separately).
function splitStreet(s) {
  const parts = normName(s).split(' ').filter(Boolean);
  let type = '', dir = '';
  if (parts.length > 2 && DIRS.has(parts[parts.length - 1]) && TYPES.has(normType(parts[parts.length - 2]))) dir = parts.pop();
  if (parts.length > 1 && TYPES.has(normType(parts[parts.length - 1]))) type = normType(parts.pop());
  return { name: parts.join(' '), type, dir };
}
const keyOf = ({ name, type, dir }) => `${name}|${type}|${dir}`;
function parseLoc(loc) {
  const m = String(loc || '').trim().toUpperCase().match(/^0*(\d{1,6})[A-Z]?\s+(.+)$/);
  if (!m) return null;
  const st = splitStreet(m[2].replace(/[#,].*$/, ''));
  return st.name ? { num: Number(m[1]), ...st } : null;
}

// -------------------------------------------------------------------------------------------------------------- load
async function load() {
  const sched = await cached('schedule', `${BASE}/yhqp-riqs.json`,
    'cnn,corridor,limits,cnnrightleft,blockside,weekday,fromhour,tohour,week1,week2,week3,week4,week5,line', 'cnn IS NOT NULL',
    (r) => ({ ...r, ':id': undefined }));
  const eas = await cached('eas-v2', `${BASE}/3mea-di5p.json`, 'address_number,street_full_street_name,cnn,longitude,latitude',
    'cnn IS NOT NULL', (r) => [r.address_number, r.street_full_street_name || '', r.cnn, r.longitude, r.latitude]);
  const tickets = await cached(`tickets-${SINCE}`, `${BASE}/ab4h-6ztd.json`,
    'citation_issued_datetime,citation_location,latitude,longitude',
    `violation_desc in('STR CLEAN','ST CLEANIN') AND citation_issued_datetime >= '${SINCE}T00:00:00'`,
    (r) => [r.citation_issued_datetime, r.citation_location || '', r.latitude || '', r.longitude || '']);
  return { sched, eas, tickets };
}

// --------------------------------------------------------------------------------------------------------- the model
function buildSegments(sched) {
  const seg = new Map();   // cnn -> { pts, corridor, limits, key, rows: { L: [], R: [] }, holiday: { L: [], R: [] } }
  let noSide = 0;
  for (const r of sched) {
    let s = seg.get(r.cnn);
    if (!s) {
      const g = r.line;
      const coords = g?.type === 'MultiLineString' ? g.coordinates.flat() : g?.coordinates;
      if (!coords?.length) continue;
      s = { cnn: r.cnn, pts: coords.map(([lo, la]) => xy(lo, la)), ends: [coords[0], coords[coords.length - 1]],
        corridor: r.corridor, limits: r.limits, key: keyOf(splitStreet(r.corridor)), rows: { L: [], R: [] }, holiday: { L: [], R: [] },
        blockside: { L: null, R: null } };
      seg.set(r.cnn, s);
    }
    const side = r.cnnrightleft;
    if (side !== 'L' && side !== 'R') { noSide++; continue; }
    if (r.blockside) s.blockside[side] = r.blockside;
    const wd = String(r.weekday || '').trim().toLowerCase();
    const row = { weekday: r.weekday, from: Number(r.fromhour), to: Number(r.tohour),
      weeks: [1, 2, 3, 4, 5].map((k) => (r[`week${k}`] === '1' ? 1 : 0)).join('') };
    if (wd.startsWith('hol')) { s.holiday[side].push(row); continue; }
    row.dow = DOW[wd.slice(0, 3)];
    if (row.dow === undefined || !Number.isFinite(row.from) || !Number.isFinite(row.to)) continue;
    s.rows[side].push(row);
  }
  // same-street neighbours: blocks of the same street sharing an end point (5 m grid)
  const ends = new Map();
  const ek = ([lo, la]) => `${Math.round(lo * 2e4)},${Math.round(la * 2e4)}`;
  for (const s of seg.values()) for (const e of s.ends) { const k = ek(e); (ends.get(k) || ends.set(k, []).get(k)).push(s); }
  // Twin blocks: one curb per cnn on the same line (Lincoln Way 44th to 45th is 8382101 for the south side and 8382201
  // for the park side). They are read as one block, the primary, with the twin's rows moved onto it (sides flipped when
  // the twin is digitized the other way); rowCnn names the cnn whose DataSF rows hold each side.
  const flip = (sd) => (sd === 'L' ? 'R' : 'L');
  // Twins: same street, both ends within TWIN_M of each other (either way round) and the middles within MID_M (two
  // halves of a loop share their ends but not their middles).
  const TWIN_M = 25, MID_M = 15;
  const middle = (pts) => {
    const len = pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc + d >= len / 2 && d) { const t = (len / 2 - acc) / d; return [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])]; }
      acc += d;
    }
    return pts[0];
  };
  const byStreet = new Map();
  for (const s of seg.values()) {
    s.rowCnn = { L: s.rows.L.length || s.holiday.L.length ? s.cnn : null, R: s.rows.R.length || s.holiday.R.length ? s.cnn : null };
    (byStreet.get(s.key) || byStreet.set(s.key, []).get(s.key)).push(s);
  }
  const P = (e) => xy(e[0], e[1]);
  const dE = (a, b) => { const [x1, y1] = P(a), [x2, y2] = P(b); return Math.hypot(x1 - x2, y1 - y2); };
  const groups = [];
  for (const list of byStreet.values()) {
    const taken = new Set();
    for (const s of list) {
      if (taken.has(s)) continue;
      const g = [s];
      for (const o of list) {
        if (o === s || taken.has(o)) continue;
        const same = Math.max(dE(s.ends[0], o.ends[0]), dE(s.ends[1], o.ends[1]));
        const rev = Math.max(dE(s.ends[0], o.ends[1]), dE(s.ends[1], o.ends[0]));
        const [m1, m2] = [middle(s.pts), middle(o.pts)];
        if (Math.min(same, rev) <= TWIN_M && Math.hypot(m1[0] - m2[0], m1[1] - m2[1]) <= MID_M) {
          o.reversed = rev < same; g.push(o); taken.add(o);
        }
      }
      if (g.length > 1) groups.push(g);
    }
  }
  let twins = 0;
  for (const g of groups) {
    const p = g[0];
    p.twins = [];
    for (const m of g.slice(1)) {
      twins++;
      m.primary = p.cnn;
      p.twins.push(m.cnn);
      for (const sd of ['L', 'R']) {
        const t = m.reversed ? flip(sd) : sd;
        p.rows[t].push(...m.rows[sd]); p.holiday[t].push(...m.holiday[sd]);
        if (m.rows[sd].length || m.holiday[sd].length) { p.rowCnn[t] = p.rowCnn[t] && p.rowCnn[t] !== m.cnn ? `${p.rowCnn[t]}+${m.cnn}` : m.cnn; }
        if (m.blockside[sd] && !p.blockside[t]) p.blockside[t] = m.blockside[sd];
      }
    }
  }
  const prim = (c) => seg.get(c)?.primary || c;
  for (const s of seg.values()) {
    s.nbrs = new Set();
    for (const e of s.ends) for (const o of ends.get(ek(e)) || []) if (o !== s && o.key === s.key && prim(o.cnn) !== prim(s.cnn)) s.nbrs.add(prim(o.cnn));
  }
  for (const s of seg.values()) if (s.primary) for (const n of s.nbrs) seg.get(s.primary).nbrs.add(n);
  log(`segments: ${seg.size} (rows without L/R: ${noSide}; ${twins} twin cnns merged onto their primary)`);
  return seg;
}

function buildAddresses(eas, seg) {
  const exact = new Map();       // "num|name|type|dir" -> [cnn, x, y]
  const byKey = new Map();       // "name|type|dir" -> [[], []] sorted [num, cnn] by parity
  const typesOf = new Map();     // name -> Set("type|dir")
  const votes = new Map();       // cnn -> [{L, R} even, {L, R} odd]
  for (const [numS, full, cnn, lo, la] of eas) {
    const num = Number(String(numS).replace(/\D.*$/, ''));
    if (!Number.isFinite(num) || !num) continue;
    const st = splitStreet(full), key = keyOf(st);
    if (!st.name) continue;
    const lon = Number(lo), lat = Number(la), ok = Number.isFinite(lon) && Number.isFinite(lat);
    const [x, y] = ok ? xy(lon, lat) : [NaN, NaN];
    if (!exact.has(`${num}|${key}`)) exact.set(`${num}|${key}`, [cnn, x, y]);
    (byKey.get(key) || byKey.set(key, [[], []]).get(key))[num % 2].push([num, cnn]);
    (typesOf.get(st.name) || typesOf.set(st.name, new Set()).get(st.name)).add(`${st.type}|${st.dir}`);
    const s = seg.get(cnn);
    if (!s || !ok) continue;
    const sd = sideOf(s.pts, x, y);
    if (sd.d > 80 || Math.abs(sd.off) < 1) continue;
    const v = votes.get(cnn) || votes.set(cnn, [{ L: 0, R: 0 }, { L: 0, R: 0 }]).get(cnn);
    v[num % 2][sd.side]++;
  }
  for (const v of byKey.values()) for (const a of v) a.sort((p, q) => p[0] - q[0]);
  // parity -> side per block, only when the vote is clear and the two parities land on different sides
  const parSide = new Map();
  for (const [cnn, v] of votes) {
    const pick = ({ L, R }) => (L + R && Math.max(L, R) / (L + R) >= 0.8 ? (L > R ? 'L' : 'R') : null);
    const even = pick(v[0]), odd = pick(v[1]);
    if (even && odd && even === odd) continue;
    parSide.set(cnn, [even || (odd && (odd === 'L' ? 'R' : 'L')), odd || (even && (even === 'L' ? 'R' : 'L'))]);
  }
  // each block's EAS number range per street, to sanity-check a point-placed ticket
  const range = new Map();
  for (const [key, par] of byKey) for (const arr of par) for (const [num, cnn] of arr) {
    const k = `${cnn}|${key}`, r = range.get(k);
    if (!r) range.set(k, [num, num]); else { if (num < r[0]) r[0] = num; if (num > r[1]) r[1] = num; }
  }
  log(`addresses: ${exact.size} exact keys, parity sides for ${parSide.size} blocks`);
  return { exact, byKey, typesOf, parSide, range };
}

// Segment grid for the point fallback.
function buildGrid(seg) {
  const CELL = 100, grid = new Map(), cell = (v) => Math.floor(v / CELL);
  for (const s of seg.values()) {
    for (let i = 1; i < s.pts.length; i++) {
      const [x1, y1] = s.pts[i - 1], [x2, y2] = s.pts[i];
      for (let cx = cell(Math.min(x1, x2) - T.TOL_M); cx <= cell(Math.max(x1, x2) + T.TOL_M); cx++)
        for (let cy = cell(Math.min(y1, y2) - T.TOL_M); cy <= cell(Math.max(y1, y2) + T.TOL_M); cy++) {
          const k = `${cx},${cy}`; const a = grid.get(k) || grid.set(k, new Set()).get(k); a.add(s);
        }
    }
  }
  return (x, y, key) => {
    let best = null, bd = T.TOL_M;
    for (const s of grid.get(`${cell(x)},${cell(y)}`) || []) {
      if (key && s.key !== key) continue;
      const sd = sideOf(s.pts, x, y);
      if (sd.d <= bd) { bd = sd.d; best = { s, sd }; }
    }
    return best;
  };
}

// The EAS street a written address names. Tries the spelling as written, then a direction moved behind the type
// ("WILLARD NORTH ST" = WILLARD ST NORTH), then THE ("EMBARCADERO NORTH" = THE EMBARCADERO); a missing type is fine when
// the name has one variant.
function streetKey(addr, A) {
  const words = addr.name.split(' ');
  const dirWord = words.find((w) => DIRS.has(w)) || '';
  const bare = words.filter((w) => !DIRS.has(w)).join(' ');
  const tries = [[addr.name, addr.type, addr.dir], [bare, addr.type, dirWord || addr.dir], [bare, addr.type, addr.dir],
    [`THE ${addr.name}`, addr.type, addr.dir], [`THE ${bare}`, addr.type, '']];
  for (const [name, type, dir] of tries) {
    const v = A.typesOf.get(name);
    if (!v || !name) continue;
    if (v.has(`${type}|${dir}`)) return `${name}|${type}|${dir}`;
    if (!type && !dir && v.size === 1) return `${name}|${[...v][0]}`;
  }
  return null;
}

// A number EAS doesn't have: the block its hundred and parity belong to (SF numbers each block from a new hundred), when
// EAS puts that hundred on one block; else an EAS number within 4 of it.
function nearNumber(arr, num, hundredOnly = false) {
  if (!arr.length) return null;
  const h = Math.floor(num / 100), seen = new Map();
  let lo = 0, hi = arr.length - 1, below = null, above = null, i0 = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][0] <= num) { below = arr[m]; i0 = m; lo = m + 1; } else { above = arr[m]; hi = m - 1; } }
  for (let i = i0; i >= 0 && Math.floor(arr[i][0] / 100) === h; i--) seen.set(arr[i][1], (seen.get(arr[i][1]) || 0) + 1);
  for (let i = i0 + 1; i < arr.length && Math.floor(arr[i][0] / 100) === h; i++) seen.set(arr[i][1], (seen.get(arr[i][1]) || 0) + 1);
  if (seen.size) {
    const tot = [...seen.values()].reduce((a, b) => a + b, 0);
    const [cnn, c] = [...seen].sort((p, q) => q[1] - p[1])[0];
    if (c / tot >= 0.8) return cnn;
  }
  if (hundredOnly) return null;
  const c = [below, above].filter(Boolean).sort((p, q) => Math.abs(p[0] - num) - Math.abs(q[0] - num))[0];
  return c && Math.abs(c[0] - num) <= 4 ? c[1] : null;
}

// ------------------------------------------------------------------------------------------------------------ assign
function assign(tickets, seg, A, nearest) {
  const sides = new Map();   // "cnn|L" -> { cnn, side, t: [[date, hh, mi, dow]], pt: [n, agree] }
  const st = { total: tickets.length, parsed: 0, exact: 0, near: 0, point: 0, noBlock: 0, notSwept: 0,
    sideParity: 0, sidePoint: 0, noSide: 0, bothSides: 0, agree: 0 };
  const fixedDays = new Set(), perDate = new Map();
  let lastDate = '';
  // The feed geocodes the typed address; one it can't place lands on a fallback point shared by many addresses
  // (90 on one spot in Hunters Point, all the even Buena Vista Ave East numbers on one block). Those points are ignored.
  const atPoint = new Map();
  for (const [, loc, la, lo] of tickets) {
    if (!la || !lo) continue;
    const k = `${la}|${lo}`, s = atPoint.get(k) || atPoint.set(k, new Set()).get(k);
    if (s.size < 5) s.add(loc.replace(/\s+/g, ' ').trim());
  }
  for (const [dt, loc, la, lo] of tickets) {
    const date = dt.slice(0, 10), hh = Number(dt.slice(11, 13)), mi = Number(dt.slice(14, 16));
    if (date > lastDate) lastDate = date;
    perDate.set(date, (perDate.get(date) || 0) + 1);
    if (hh === 0 && mi >= 1) fixedDays.add(date);
    const addr = parseLoc(loc);
    if (addr) st.parsed++;
    const key = addr && streetKey(addr, A);
    let cnn = null, ref = null;
    if (key) {
      const ex = A.exact.get(`${addr.num}|${key}`);
      if (ex) { cnn = ex[0]; if (Number.isFinite(ex[1])) ref = [ex[1], ex[2]]; st.exact++; }
      else {
        const par = A.byKey.get(key);
        // same parity first; a side with no addresses at all (a park) takes the block of the other parity's hundred
        cnn = nearNumber(par[addr.num % 2], addr.num) || (par[addr.num % 2].length ? null : nearNumber(par[1 - (addr.num % 2)], addr.num, true));
        if (cnn) st.near++;
      }
    }
    const lat = Number(la), lon = Number(lo);
    const hasPt = la && lo && Number.isFinite(lat) && Number.isFinite(lon) && atPoint.get(`${la}|${lo}`).size < 5;
    const [px, py] = hasPt ? xy(lon, lat) : [0, 0];
    if (!cnn && hasPt) {
      const hit = nearest(px, py, key || (addr && keyOf(addr)));
      // the point's block must be plausible for the number: within 100 of the block's EAS numbers on that street
      const r = hit && addr && A.range.get(`${hit.s.cnn}|${key || keyOf(addr)}`);
      if (hit && (!r || (addr.num >= r[0] - 100 && addr.num <= r[1] + 100))) { cnn = hit.s.cnn; st.point++; }
    }
    if (!cnn) { st.noBlock++; continue; }
    // Houses on the Lower Great Hwy frontage are addressed GREAT HWY and EAS gives them the Great Hwy block: park them
    // on the frontage block when the address point is nearer to it.
    let frontage = false;
    if (seg.get(cnn)?.key === 'GREAT|HWY|') {
      const [rx, ry] = ref || (hasPt ? [px, py] : [NaN, NaN]);
      const low = Number.isFinite(rx) ? nearest(rx, ry, 'LOWER GREAT|HWY|') : null;
      if (low && low.sd.d < sideOf(seg.get(cnn).pts, rx, ry).d) { cnn = low.s.cnn; frontage = true; st.frontage = (st.frontage || 0) + 1; }
    }
    const s = seg.get(cnn);
    if (!s) { st.notSwept++; continue; }
    let side = addr && !frontage ? A.parSide.get(cnn)?.[addr.num % 2] || null : null;
    if (frontage && ref) side = sideOf(s.pts, ref[0], ref[1]).side;
    const ptSide = hasPt ? sideOf(s.pts, px, py) : null;
    const ptOk = ptSide && ptSide.d <= T.TOL_M && Math.abs(ptSide.off) >= 0.3 ? ptSide.side : null;
    if (side) st.sideParity++;
    else if (ptOk) { side = ptOk; st.sidePoint++; }
    else { st.noSide++; continue; }
    const agree = ptOk ? ptOk === side : null;
    if (s.primary) { if (s.reversed) side = side === 'L' ? 'R' : 'L'; cnn = s.primary; }   // a twin: read on its primary
    const k = `${cnn}|${side}`;
    if (DEBUG_CNN === cnn) { const m = st.debug || (st.debug = {}); const dk = `${side} ${loc} ${new Date(`${date}T12:00:00Z`).toUTCString().slice(0, 3)}`; m[dk] = (m[dk] || 0) + 1; }
    const rec = sides.get(k) || sides.set(k, { cnn, side, t: [], pt: [0, 0] }).get(k);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    rec.t.push([date, hh, mi, dow]);
    if (agree !== null) { rec.pt[0]++; if (agree) rec.pt[1]++; st.bothSides++; if (agree) st.agree++; }
  }
  return { sides, st, fixedDays, lastDate, perDate };
}

// ------------------------------------------------------------------------------------------------------------- stats
const fmtT = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const inWin = (min, row) => min >= row.from * 60 && min < (row.to > row.from ? row.to : row.to + 24) * 60;
const overlaps = (a0, a1, row) => a0 < (row.to > row.from ? row.to : row.to + 24) && row.from < a1;

function dayStats(rec, dow, rows, fixedDays, recentFrom) {
  const tk = rec.t.filter((t) => t[3] === dow);
  if (!tk.length) return null;
  // the midnight fix
  const night = tk.filter(([d, hh]) => hh >= 1 && hh <= 5 && !fixedDays.has(d));
  const nightMis = night.filter(([, hh, mi]) => looksMisdated(hh, mi)).length;
  const allNight = night.length >= 3 && nightMis / night.length >= T.NIGHT_MISDATED;
  const mins = tk.map(([d, hh, mi]) => {
    if (hh >= 1 && hh <= 5 && !fixedDays.has(d) && looksMisdated(hh, mi)) {
      if (allNight || rows.some((r) => r.dow === dow && r.from === 0 && inWin(mi, r))) return mi;
    }
    return hh * 60 + mi;
  });
  const hours = Array(24).fill(0);
  for (const m of mins) hours[Math.floor(m / 60)]++;
  let bh = 0, bc = -1;
  for (let h = 0; h < 24; h++) {
    const c = hours[h] + hours[(h + 1) % 24];
    if (c > bc || (c === bc && hours[h] > hours[bh])) { bc = c; bh = h; }
  }
  const dates = new Set(), hol = new Set(), recent = new Set(), datesIn = new Set();
  const clusterMins = [];
  tk.forEach(([d], i) => {
    if (HOLIDAYS.has(d)) { hol.add(d); return; }
    dates.add(d);
    if (d >= recentFrom) recent.add(d);
    const m = mins[i], h = Math.floor(m / 60);
    if (h === bh || h === (bh + 1) % 24) { datesIn.add(d); clusterMins.push(m); }
  });
  clusterMins.sort((a, b) => a - b);
  const q = (p) => clusterMins[Math.min(clusterMins.length - 1, Math.floor(p * clusterMins.length))];
  return { dow, n: tk.length, tdates: tk.map((t) => t[0]), mins, hours, bh, conc: bc / tk.length, dates, hol, recent, datesIn,
    cluster: clusterMins.length ? `${fmtT(q(0.1))}-${fmtT(q(0.9))}` : '', lastDate: [...dates].sort().pop() || '',
    midnightFixed: allNight || night.some(([d, hh, mi]) => looksMisdated(hh, mi) && rows.some((r) => r.dow === dow && r.from === 0 && inWin(mi, r))) };
}

// Days with almost no street cleaning tickets citywide (< 50% of that weekday's median: holidays, 2-6 Feb 2026, the last
// partial day of the feed): no evidence either way, so they don't count as occurrences of a week.
let DEAD = new Set();
function weeksOf(dates, dow, since, last) {
  const occ = [0, 0, 0, 0, 0, 0], hit = [0, 0, 0, 0, 0, 0];
  for (let t = Date.parse(`${since}T12:00:00Z`); t <= Date.parse(`${last}T12:00:00Z`); t += 864e5) {
    const d = new Date(t);
    if (d.getUTCDay() !== dow) continue;
    const iso = isoDay(d);
    if (HOLIDAYS.has(iso) || DEAD.has(iso)) continue;
    const k = Math.ceil(d.getUTCDate() / 7);
    occ[k]++;
    if (dates.has(iso)) hit[k]++;
  }
  // Only the patterns DataSF uses (every week 23,084 rows, 2nd + 4th 6,880, 1st + 3rd 4,367, 1st + 3rd + 5th 2,287,
  // 2nd + 4th + 5th 334, 1st 102): ticketing varies month to month, so a free-form week-by-week read turns a quiet
  // month into a fake "off" week. Pick the pattern with the highest likelihood: on weeks hit at the pattern's own rate,
  // off weeks at WEEK_NOISE (a stray or mis-sided ticket).
  const ll = (pat) => llPattern(pat, occ, hit);
  const ranked = WEEK_PATTERNS.map((pat) => [pat, ll(pat)]).sort((a, b) => b[1] - a[1]);
  const [weeks, best] = ranked[0];
  return { weeks, ll, margin: Math.round((best - ranked[1][1]) * 10) / 10, unsure: best - ranked[1][1] < T.WEEK_LLR_UNSURE,
    rates: occ.slice(1).map((o, i) => `${hit[i + 1]}/${o}`) };
}

const WEEK_PATTERNS = ['11111', '01010', '10100', '10101', '01011', '10000'];
function llPattern(pat, occ, hit) {
  let on = 0, onOcc = 0;
  for (let k = 1; k <= 5; k++) if (pat[k - 1] === '1') { on += hit[k]; onOcc += occ[k]; }
  const p = Math.min(0.99, Math.max(0.01, onOcc ? on / onOcc : 0.01)), e = T.WEEK_NOISE;
  let s = 0;
  for (let k = 1; k <= 5; k++) {
    const q = pat[k - 1] === '1' ? p : e;
    s += hit[k] * Math.log(q) + (occ[k] - hit[k]) * Math.log(1 - q);
  }
  return s;
}

// The window for a ticket-proposed day: a listed window that already holds >= 85% of its tickets (this side's rows first,
// then the other side's, the tightest first, then the one starting nearest the best 2 hours), else the best 2 hours.
function pickWindow(ds, own, other) {
  const len = (r) => (r.to > r.from ? r.to - r.from : r.to + 24 - r.from);
  const by = (a, b) => len(a) - len(b) || Math.abs(a.from - ds.bh) - Math.abs(b.from - ds.bh);
  for (const set of [own, other]) {
    for (const r of [...set].sort(by)) {
      if (ds.mins.filter((m) => inWin(m, r)).length / ds.n >= 0.85) return [r.from, r.to];
    }
  }
  return [ds.bh, ds.bh + 2];
}

// -------------------------------------------------------------------------------------------------------------- main
async function main() {
  const { sched, eas, tickets } = await load();
  const seg = buildSegments(sched);
  const A = buildAddresses(eas, seg);
  const nearest = buildGrid(seg);
  const { sides, st, fixedDays, lastDate, perDate } = assign(tickets, seg, A, nearest);
  const recentFrom = isoDay(new Date(Date.parse(`${lastDate}T12:00:00Z`) - T.RECENT_DAYS * 864e5));
  {
    const byDow = [[], [], [], [], [], [], []], all = [];
    for (let t = Date.parse(`${SINCE}T12:00:00Z`); t <= Date.parse(`${lastDate}T12:00:00Z`); t += 864e5) {
      const iso = isoDay(new Date(t)); all.push(iso); byDow[new Date(t).getUTCDay()].push(perDate.get(iso) || 0);
    }
    const med = byDow.map((v) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]);
    DEAD = new Set(all.filter((iso) => (perDate.get(iso) || 0) < 0.5 * med[new Date(`${iso}T12:00:00Z`).getUTCDay()]));
    log(`days with almost no tickets citywide (left out of week-of-month counts): ${[...DEAD].join(' ')}`);
  }
  log(`tickets: ${st.total}; block by address ${st.exact} exact + ${st.near} nearest number, ${st.point} by point; ` +
    `no block ${st.noBlock}, block not swept ${st.notSwept}; side by parity ${st.sideParity}, by point ${st.sidePoint}, ` +
    `no side ${st.noSide}; parity vs point agree ${(100 * st.agree / st.bothSides).toFixed(1)}% of ${st.bothSides}`);

  if (st.debug) {
    for (const [dk, n] of Object.entries(st.debug).sort((a, b) => b[1] - a[1]).slice(0, 40)) log(`debug ${DEBUG_CNN} ${dk}: ${n}`);
    delete st.debug;
  }
  const statsCache = new Map();
  const statsFor = (cnn, side) => {
    const k = `${cnn}|${side}`;
    if (statsCache.has(k)) return statsCache.get(k);
    const rec = sides.get(k), s = seg.get(cnn);
    const out = Array(7).fill(null);
    if (rec) for (let d = 0; d < 7; d++) out[d] = dayStats(rec, d, s.rows[side], fixedDays, recentFrom);
    statsCache.set(k, out);
    return out;
  };
  const nd = (ds) => (ds ? ds.dates.size : 0);

  const results = [];
  const rejected = { otherSide: 0, spill: 0, sideCheck: 0, stale: 0 };
  for (const [k, rec] of sides) {
    const s = seg.get(rec.cnn), side = rec.side, other = side === 'L' ? 'R' : 'L';
    const rows = s.rows[side], orows = s.rows[other];
    const S = statsFor(rec.cnn, side), O = statsFor(rec.cnn, other);
    const debug = DEBUG_CNN === rec.cnn;
    const flagged = [];
    for (let dow = 0; dow < 7; dow++) {
      const ds = S[dow];
      if (!ds || ds.dates.size < T.MIN_DATES || ds.conc < T.MIN_CONC) continue;
      const listed = rows.filter((r) => r.dow === dow);
      const a0 = ds.bh, a1 = ds.bh + 2;
      let kind = null, evidence = ds.dates.size, recentN = ds.recent.size, weeks = null;
      if (!listed.length) kind = 'unlisted-day';
      else {
        const inside = ds.mins.filter((m) => listed.some((r) => inWin(m, r))).length;
        if (1 - inside / ds.n >= T.OUT_OF_WINDOW && !listed.some((r) => overlaps(a0, a1, r))) {
          // the listed window still ticketed on more than a few dates: a second window the City leaves out, not wrong hours
          const inDates = new Set();
          ds.tdates.forEach((d, i) => { if (!HOLIDAYS.has(d) && listed.some((r) => inWin(ds.mins[i], r))) inDates.add(d); });
          kind = inDates.size > T.CONTRADICTED * ds.datesIn.size ? 'extra-window' : 'wrong-hours';
          evidence = ds.datesIn.size; recentN = [...ds.datesIn].filter((d) => d >= recentFrom).length;
        } else {
          // right day and hours: do the weeks of the month hold? (in-window dates only)
          const cityWeeks = [0, 1, 2, 3, 4].map((i) => listed.some((r) => r.weeks[i] === '1'));
          const inDates = new Set();
          ds.tdates.forEach((d, i) => { if (!HOLIDAYS.has(d) && listed.some((r) => inWin(ds.mins[i], r))) inDates.add(d); });
          const off = [...inDates].filter((d) => !cityWeeks[Math.ceil(Number(d.slice(8, 10)) / 7) - 1]);
          const cityPat = cityWeeks.map(Number).join('');
          const w = weeksOf(inDates, dow, SINCE, lastDate);
          if (off.length >= T.MIN_DATES && w.weeks !== cityPat) {
            // ticketed in weeks the City says are free
            kind = 'wrong-weeks'; evidence = off.length; recentN = off.filter((d) => d >= recentFrom).length;
            weeks = w; weeks.extra = true;
          } else if (inDates.size >= T.HIGH_DATES && w.weeks.slice(0, 4) !== cityPat.slice(0, 4)
            && [...w.weeks].every((b, i) => b <= cityPat[i]) && w.ll(w.weeks) - w.ll(cityPat) >= T.WEEK_LLR_FEWER) {
            // the City lists weeks 1-4 that are never ticketed (a 5th week alone is left out: 4 or 5 a year, and
            // 5th-week tickets are rare citywide, so it can't tell a schedule from a habit)
            kind = 'wrong-weeks'; evidence = inDates.size; recentN = [...inDates].filter((d) => d >= recentFrom).length; weeks = w;
          }
        }
      }
      if (!kind) continue;
      const why = [];
      if (recentN < T.MIN_RECENT) why.push('stale');
      // the other side lists this day and hour: addresses written on the wrong side?
      const oListed = orows.some((r) => r.dow === dow && overlaps(a0, a1, r));
      if (oListed && evidence < T.OTHER_RATIO * nd(O[dow])) why.push('otherSide');
      // a neighbour of the same street lists it with many more dates: corner spill?
      for (const nc of s.nbrs) {
        const ns = seg.get(nc);
        for (const sd of ['L', 'R']) {
          if (!ns.rows[sd].some((r) => r.dow === dow && overlaps(a0, a1, r))) continue;
          if (nd(statsFor(nc, sd)[dow]) >= T.SPILL_RATIO * evidence) why.push('spill');
        }
      }
      if (rec.pt[0] >= 10 && rec.pt[1] / rec.pt[0] < T.SIDE_AGREE) why.push('sideCheck');
      if (debug) log(`debug ${k} ${DOW_LABEL[dow]}: ${kind} evidence ${evidence} conc ${ds.conc.toFixed(2)} recent ${recentN} ${why.join(',')}`);
      if (why.length) { for (const w of new Set(why)) rejected[w]++; continue; }
      flagged.push({ dow, kind, ds, oListed, evidence, recentN, weeks });
    }
    if (!flagged.length) continue;

    const maxFlag = Math.max(...flagged.map((f) => f.evidence));
    // each listed row: dates its own window was ticketed on
    const cityRows = rows.map((r) => {
      const ds = S[r.dow];
      const dIn = new Set();
      if (ds) {
        let i = 0;
        for (const t of rec.t) if (t[3] === r.dow) { if (!HOLIDAYS.has(t[0]) && inWin(ds.mins[i], r)) dIn.add(t[0]); i++; }
      }
      const ratio = dIn.size / maxFlag;
      const fk = flagged.find((f) => f.dow === r.dow && (f.kind === 'wrong-hours' || f.kind === 'wrong-weeks'))?.kind;
      // A row is contradicted (dropped from the proposal) only on a side ticketed on a day the City doesn't list, and
      // only when its own window is practically never ticketed. Weekend rows are often lightly ticketed: only none at all.
      const weekend = r.dow === 0 || r.dow === 6;
      const replaced = flagged.some((f) => f.kind === 'unlisted-day') && ratio <= T.CONTRADICTED
        && dIn.size <= (weekend ? 0 : T.CONTRADICTED_MAX_DATES);
      const status = fk || (replaced ? 'contradicted' : ratio >= T.CONFIRMED ? 'confirmed' : 'unclear');
      return { weekday: r.weekday, fromhour: r.from, tohour: r.to, weeks: r.weeks, dates_in_window: dIn.size, status };
    });

    const proposed = [];
    for (const f of flagged) {
      const own = rows.filter((r) => r.dow === f.dow);
      const win = f.kind === 'wrong-weeks' ? [own[0].from, own[0].to]
        : pickWindow(f.ds, rows.filter((r) => r.dow !== f.dow || f.kind !== 'wrong-hours'), orows);
      f.window = win;
      f.weeks = f.weeks || weeksOf(f.ds.datesIn, f.dow, SINCE, lastDate);
      proposed.push({ weekday: DOW_LABEL[f.dow], fromhour: win[0], tohour: win[1], weeks: f.weeks.weeks, source: 'tickets' });
    }
    for (const r of cityRows) {
      if (r.status !== 'confirmed' && r.status !== 'unclear') continue;
      proposed.push({ weekday: r.weekday, fromhour: r.fromhour, tohour: r.tohour, weeks: r.weeks, source: `city (${r.status})` });
    }
    const order = (w) => DOW_LABEL.indexOf(w);
    proposed.sort((a, b) => order(a.weekday) - order(b.weekday) || a.fromhour - b.fromhour);

    // High: strong evidence AND the City's version is contradicted, not just incomplete: a listed weekday row that is
    // practically never ticketed, tickets outside the listed hours, tickets in weeks the City says are free, or a side
    // with no rows whose other side barely sees tickets that day. (Swaps are upgraded after both sides are read.)
    const noRows = !rows.length;
    const contradicted = cityRows.some((r) => r.status === 'contradicted');
    for (const f of flagged) {
      f.strong = f.evidence >= T.HIGH_DATES && f.ds.conc >= T.HIGH_CONC && f.recentN >= T.HIGH_RECENT;
      const otherQuiet = nd(O[f.dow]) <= T.CONTRADICTED * f.evidence || !orows.some((r) => r.dow === f.dow);
      f.high = f.strong && (f.kind === 'wrong-hours' || (f.kind === 'wrong-weeks' && Boolean(f.weeks.extra))
        || (f.kind === 'unlisted-day' && (contradicted || (noRows && otherQuiet))));
    }
    const confidence = flagged.every((f) => f.high) ? 'high' : 'medium';

    const kinds = new Set(flagged.map((f) => f.kind));
    if (noRows) {
      kinds.add('side-not-listed');
      // the City lists that day on the other side, which is barely ticketed then: the row sits on the wrong side
      if (flagged.some((f) => orows.some((r) => r.dow === f.dow) && nd(O[f.dow]) <= T.CONTRADICTED * f.evidence)) kinds.add('row-on-other-side');
    } else if (flagged.some((f) => f.kind === 'unlisted-day')) kinds.add(contradicted ? 'wrong-day' : 'missing-day');

    const byWeekday = {};
    for (let d = 0; d < 7; d++) {
      const ds = S[d];
      if (!ds) continue;
      const hours = {};
      ds.hours.forEach((c, h) => { if (c) hours[h] = c; });
      byWeekday[DOW_LABEL[d]] = { tickets: ds.n, dates: ds.dates.size, dates_90d: ds.recent.size, holiday_dates: ds.hol.size,
        best_2h: `${ds.bh}-${ds.bh + 2}`, in_best_2h: Math.round(ds.conc * 100) / 100, hours,
        ...(ds.midnightFixed ? { midnight_fix: true } : {}) };
    }
    const otherByWeekday = {};
    for (let d = 0; d < 7; d++) if (O[d]) otherByWeekday[DOW_LABEL[d]] = { tickets: O[d].n, dates: O[d].dates.size };

    const [from, to] = String(s.limits || '').split(/\s+-\s+/).map((x) => x.trim());
    const fmtRows = (rs) => rs.map((r) => `${r.weekday} ${r.fromhour}-${r.tohour}${r.weeks === '11111' ? '' : ` wk${r.weeks}`}`).join(', ') || 'nothing';
    results.push({
      cnn: s.rowCnn[side] || rec.cnn, ...(s.twins ? { block_cnns: [rec.cnn, ...s.twins] } : {}),
      street: s.corridor, from: from || '', to: to || '', side, blockside: s.blockside[side] || compass(s.pts, side),
      confidence, kind: [...kinds], swapped_with_other_side: false,
      city_says: fmtRows(cityRows),
      tickets_say: flagged.map((f) => `${DOW_LABEL[f.dow]} ${f.window[0]}-${f.window[1]}${f.weeks.weeks === '11111' ? '' : ` wk${f.weeks.weeks}`} (${f.kind === 'wrong-weeks' ? `${f.evidence} dates against the City's weeks` : `${f.ds.dates.size} dates, ${Math.round(f.ds.conc * 100)}% at ${f.ds.cluster}`})`).join(', '),
      proposed_says: fmtRows(proposed),
      city_rows: cityRows,
      city_holiday_rows: s.holiday[side].map((r) => ({ fromhour: r.from, tohour: r.to })),
      other_side: { side: other, blockside: s.blockside[other] || compass(s.pts, other), city_rows: fmtRows(orows.map((r) => ({ weekday: r.weekday, fromhour: r.from, tohour: r.to, weeks: r.weeks }))), tickets_by_weekday: otherByWeekday },
      flagged: flagged.map((f) => ({ weekday: DOW_LABEL[f.dow], kind: f.kind, evidence_dates: f.evidence, evidence_dates_90d: f.recentN,
        tickets: f.ds.n, dates: f.ds.dates.size, dates_90d: f.ds.recent.size,
        last_date: f.ds.lastDate, in_best_2h: Math.round(f.ds.conc * 100) / 100, middle_80pct: f.ds.cluster, window: f.window,
        strong: f.strong, weeks: f.weeks.weeks, weeks_margin: f.weeks.margin, ...(f.weeks.unsure ? { weeks_unsure: true } : {}),
        dates_per_week_of_month: f.weeks.rates })),
      tickets: { total: rec.t.length, by_weekday: byWeekday, point_side_check: { with_point: rec.pt[0], agree: rec.pt[1] } },
      distinct_dates: Object.fromEntries(flagged.map((f) => [DOW_LABEL[f.dow], [...f.ds.dates].sort()])),
      proposed,
      score: Math.round(Math.max(...flagged.map((f) => f.evidence * f.ds.conc)) * 10) / 10,
    });
  }
  // swapped: each side's ticketed day is a day the City lists for the other side
  const blockOf = (r) => (r.block_cnns ? r.block_cnns[0] : r.cnn);
  const byKey = new Map(results.map((r) => [`${blockOf(r)}|${r.side}`, r]));
  for (const r of results) {
    const o = byKey.get(`${blockOf(r)}|${r.side === 'L' ? 'R' : 'L'}`);
    if (!o) continue;
    const listedOn = (x, wd) => x.city_rows.some((c) => c.weekday === wd);
    const mine = r.flagged.filter((f) => f.kind === 'unlisted-day' && listedOn(o, f.weekday));
    const theirs = o.flagged.filter((f) => f.kind === 'unlisted-day' && listedOn(r, f.weekday));
    if (mine.length && theirs.length) {
      r.swapped_with_other_side = true;
      if (!r.kind.includes('swapped')) r.kind.push('swapped');
      if ([...r.flagged, ...o.flagged].every((f) => f.strong)) r.confidence = 'high';
    }
  }
  results.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1) || b.score - a.score);

  const meta = {
    generated: new Date().toISOString(), since: SINCE, until: lastDate, recent_from: recentFrom,
    sources: { schedule: 'DataSF yhqp-riqs', tickets: "DataSF ab4h-6ztd, violation_desc in ('STR CLEAN','ST CLEANIN')", addresses: 'DataSF 3mea-di5p (EAS)' },
    thresholds: T, assignment: st, rejected_by_noise_checks: rejected,
    flagged: { sides: results.length, high: results.filter((r) => r.confidence === 'high').length,
      medium: results.filter((r) => r.confidence === 'medium').length },
    notes: [
      'side = L/R of the DataSF line as digitized (same frame as cnnrightleft); blockside is the City name, else the compass side.',
      'cnn = the cnn whose DataSF rows hold that side (twin cnns joined with +); block_cnns lists a twin pair read as one block.',
      'weeks = week1..week5 flags as in DataSF; for ticket-proposed days, the DataSF pattern that best fits dates_per_week_of_month (ticketed dates / occurrences; holidays and days with almost no tickets citywide out). weeks_unsure = the runner-up pattern is close.',
      'window for a ticket-proposed day: a listed window (this side first, then the other side) holding >= 85% of the tickets, else the best 2 hour window. Ticket times sit early in a window, so check the posted sign.',
      'kind: unlisted-day (ticketed on a day the side has no row), wrong-day (and a listed weekday is practically never ticketed), missing-day (the listed days are ticketed too), side-not-listed (no rows at all), row-on-other-side (that day is listed for the other side, which is barely ticketed then), swapped, wrong-hours, extra-window, wrong-weeks.',
      'proposed = ticket-proposed rows + the City rows still ticketed (confirmed) or not clearly wrong (unclear); contradicted / wrong-hours / wrong-weeks rows are left out.',
      'Read only: nothing in CURB changes from this file.',
    ],
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ _meta: meta, sides: results }, null, 1));
  log(`flagged ${results.length} sides (${meta.flagged.high} high, ${meta.flagged.medium} medium); rejected ${JSON.stringify(rejected)}`);
  log(`wrote ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
