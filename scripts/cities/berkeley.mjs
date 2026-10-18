#!/usr/bin/env node
// Berkeley for CURB (data build, 2026-10-18; docs/multi-city/city-build.md, research in docs/multi-city/berkeley.md).
// Builds data/berkeley/ from three City of Berkeley sources:
//
//   1. The Residential Street Sweeping Schedule, three PDFs on the City's street sweeping page (street names A-G and
//      numbered streets: February 2018; H-Z: September 2025). One row per street side and house number range: route,
//      street, side (N, S, E, W), numbers, week and weekday of the month, AM or PM, cross streets, and "Opt-Out" blocks
//      (blocks that left the program, which are not swept). The PDFs carry no hours: AM is 9 AM to 12 noon and PM 12:30
//      to 3:30 PM, as read on the posted signs (docs/multi-city/berkeley.md). Every block in the schedule is posted: the
//      program has "mandatory parking enforcement" (Resolution 54,513-N.S., 1987), $73 a ticket, no tow.
//   2. Street Sweep Status, a Public Works layer of the City's GIS (PubWorks MapServer layer 28): the City's street
//      centerline, 3,101 segments, with house number ranges on each side and a sweeping status per segment (enforced,
//      commercial, industrial, opted out, excluded). It gives the block lines and their cross streets; its status is a
//      check on the schedule (report.json), never a source of rules.
//   3. Addresses (GISportal layer 0): the City's address points, house number and street only (the layer also carries
//      owner names, which are never requested). They decide which side of each segment holds the odd numbers where the
//      centerline's left and right ranges are the wrong way round.
//
// A row goes on the segments of its street whose numbers on the row's side are at least half inside the row's range; the
// side is the one holding the row's parity (the PDFs: "even numbered addresses on the south and west sides of the
// streets, and odd numbered addresses on the north and east sides"). A row whose numbers find no segment is walked along
// its street between its two cross streets. The compass side of each placed line is checked against the row's word.
//
// Run: node scripts/cities/berkeley.mjs [--refresh]   (Node 18+; inputs cached in private/cache/berkeley/; the PDFs are
// read with pdfjs-dist, installed on first use into private/cache/berkeley/pdfjs/, never into the repo's package.json)
// Tests: npx vitest run scripts/cities/berkeley.test.mjs

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/berkeley/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/berkeley/';
const log = (...a) => console.error('[berkeley]', ...a);

const PAGE = 'https://berkeleyca.gov/city-services/streets-sidewalks-sewers-and-utilities/street-sweeping';
export const PDFS = [
  { file: 'StreetSweepingSchedule_StNamesA-G.pdf', url: 'https://berkeleyca.gov/sites/default/files/2022-03/StreetSweepingSchedule_StNamesA-G.pdf' },
  { file: 'StreetSweepingSchedule_StNamesH-Z.pdf', url: 'https://berkeleyca.gov/sites/default/files/2022-03/StreetSweepingSchedule_StNamesH-Z.pdf' },
  { file: 'StreetSweepingSchedule_StNumbered.pdf', url: 'https://berkeleyca.gov/sites/default/files/2022-03/StreetSweepingSchedule_StNumbered.pdf' },
];
const STATUS = 'https://gis.cityofberkeley.info/arcgis/rest/services/PublicWorks/PubWorks/MapServer/28';
const ADDRESSES = 'https://gis.cityofberkeley.info/arcgis/rest/services/Public/GISportal/MapServer/0';
const BOUNDARY = 'https://gis.cityofberkeley.info/arcgis/rest/services/Public/GISportal/MapServer/2';
const FINES = 'https://berkeleyca.gov/sites/default/files/Schedule%20of%20Parking%20Violations%20and%20Fines.pdf';
const HOLIDAYS_URL = 'https://berkeleyca.gov/your-government/city-holidays';
const PDFJS = 'pdfjs-dist@5.4.624';

// ---------- the schedule PDFs ------------------------------------------------------------------------
// Each PDF is an Excel sheet printed to pages: text items with an x, y position. A row is anchored on its route number
// (the first column); every other item goes to the row whose baseline is nearest (the 2018 files print "1st Tue" as
// "1", a raised "st" and "Tue", 2 to 3 points off the row's baseline). Columns are fixed x ranges, the same in all three
// files (the 2025 file is shifted a few points left; the ranges allow for it).

export const COLUMNS = [
  ['rte', 0, 40], ['street', 40, 135], ['side', 135, 166], ['from', 166, 205], ['to', 205, 255], ['day', 255, 320],
  ['ampm', 320, 352], ['fromSt', 352, 455], ['toSt', 455, 535], ['optOut', 535, 620],
];
const colOf = (x) => (COLUMNS.find(([, a, b]) => x >= a && x < b) || [null])[0];

/* One page's text items [{s, x, y}] → rows of cells {rte, street, side, …} (strings, words joined by one space). */
export function rowsFromItems(items) {
  const words = items.filter((it) => String(it.s).trim());
  const anchors = words.filter((it) => it.x < 40 && /^\d{2}$/.test(String(it.s).trim())).map((it) => ({ y: it.y, cells: {} }));
  if (!anchors.length) return [];
  for (const it of words) {
    const col = colOf(it.x);
    if (!col) continue;
    let best = null;
    for (const a of anchors) { const d = Math.abs(a.y - it.y); if (!best || d < best.d) best = { d, a }; }
    if (best.d > 6) continue;                                   // the title, the notes and the column headers
    (best.a.cells[col] ||= []).push(it);
  }
  return anchors.map((a) => Object.fromEntries(Object.entries(a.cells).map(([k, its]) =>
    [k, its.sort((p, q) => p.x - q.x).map((i) => String(i.s).trim()).join(' ').replace(/\s+/g, ' ').trim()])));
}

const DOW = { SUN: 0, MON: 1, TUE: 2, TUES: 2, WED: 3, THU: 4, THUR: 4, THURS: 4, FRI: 5, SAT: 6 };
// AM and PM as on the signs ("NO PARKING 9 AM TO 12 NOON", "NO PARKING 12:30 PM TO 3:30 PM").
export const WINDOWS = { AM: [9, 12], PM: ['12:30', '15:30'] };

/* A row's cells → { rte, street, side, from, to, week, dow, ampm, fromSt, toSt, optOut, problems, notes }. week: 1-5 (the
   nth weekday of the month), dow: JS weekday, side: 'N' | 'S' | 'E' | 'W' | 'BOTH' ("E/W"), optOut: hundred blocks [1300].
   problems: why the row can't be used; notes: what was assumed to use it. */
export function parseRow(cells) {
  const problems = [], notes = [];
  const num = (v) => { const m = /^\d{1,5}$/.exec(String(v || '').trim()); return m ? +m[0] : null; };
  const street = String(cells.street || '').trim();
  if (!street) problems.push('no street');
  const sideRaw = String(cells.side || '').toUpperCase().replace(/\s+/g, '');
  const side = /^[NSEW]$/.test(sideRaw) ? sideRaw : /^(E\/W|W\/E|N\/S|S\/N|BOTH)$/.test(sideRaw) ? 'BOTH' : null;
  if (!side) problems.push(`side "${cells.side || ''}"`);
  const from = num(cells.from);
  let to = num(cells.to);
  if (from === null) problems.push(`numbers "${cells.from || ''}" to "${cells.to || ''}"`);
  else if (to === null && !String(cells.to || '').trim()) {           // 3 rows give one number: the rest of its hundred block
    to = from - (from % 100) + 99;
    notes.push(`no "to" number: ${from} to ${to} assumed`);
  } else if (to === null) problems.push(`numbers "${cells.from || ''}" to "${cells.to || ''}"`);
  // "1 st Tue" (2018 files), "1st Tue" (2025 file), "4thFri"
  const dm = /^([1-5])\s*(?:ST|ND|RD|TH)?\s*([A-Z]+)$/.exec(String(cells.day || '').toUpperCase().trim());
  const week = dm ? +dm[1] : null, dow = dm && dm[2] in DOW ? DOW[dm[2]] : null;
  if (week === null || dow === null) problems.push(`day "${cells.day || ''}"`);
  const ampm = String(cells.ampm || '').toUpperCase().trim();
  if (!(ampm in WINDOWS)) problems.push(`AM/PM "${cells.ampm || ''}"`);
  // "1300", or two blocks as "13/1400"
  const om = /^(\d{1,2})\/(\d{3,5})$/.exec(String(cells.optOut || '').trim());
  const optOut = om ? [+om[1] * 100, +om[2]] : num(cells.optOut) !== null ? [num(cells.optOut)] : [];
  if (cells.optOut && !optOut.length) problems.push(`opt-out "${cells.optOut}"`);
  return { rte: String(cells.rte || '').trim(), street, side, from, to, week, dow, ampm, fromSt: String(cells.fromSt || '').trim(),
    toSt: String(cells.toSt || '').trim(), optOut, problems, notes };
}

/* The rule of a parsed row: [dow, from, to, weeks, months, flags]. weeks: bit (week-1); all year; flags 0: a City
   holiday cancels the sweep (swept on the next scheduled day, a month later) and the City does not tow for sweeping. */
export const ruleOf = (row) => [row.dow, WINDOWS[row.ampm][0], WINDOWS[row.ampm][1], 1 << (row.week - 1), 0, 0];

// The route number says the weekday and the week ("61" = Friday, 1st week): a check on the parse, never used to place.
export const routeAgrees = (row) => /^[2-6][1-5]$/.test(row.rte) && +row.rte[0] - 1 === row.dow && +row.rte[1] === row.week;

// ---------- street names ---------------------------------------------------------------------------
// One key per street, the same for the schedule's words, the centerline's STR_NAM + STR_TYP and the address points'
// names: "6th Street" = "6TH ST" = "SIXTH", "M L King" = "MARTIN LUTHER KING JR WY", "Acton Crescent" = "ACTON CR".
const TYPE = { ST: 'ST', STREET: 'ST', AV: 'AV', AVE: 'AV', AVENUE: 'AV', WY: 'WY', WAY: 'WY', BL: 'BL', BLVD: 'BL',
  BOULEVARD: 'BL', DR: 'DR', DRIVE: 'DR', RD: 'RD', ROAD: 'RD', CT: 'CT', COURT: 'CT', PL: 'PL', PLACE: 'PL', LN: 'LN',
  LA: 'LN', LANE: 'LN', TER: 'TER', TERR: 'TER', TERRACE: 'TER', CIR: 'CIR', CI: 'CIR', CIRCLE: 'CIR', CR: 'CRES',
  CS: 'CRES', CRES: 'CRES', CRESC: 'CRES', CRESCENT: 'CRES', SQ: 'SQ', PATH: 'PATH', WALK: 'WALK', HWY: 'HWY' };
// The schedule's spelling → the centerline's, where the words differ.
export const ALIAS = { 'M L KING': 'MARTIN LUTHER KING JR', 'MARTIN LUTHER KING J': 'MARTIN LUTHER KING JR', MATTHEWS: 'MATHEWS',
  MCGEE: 'MC GEE', MCKINLEY: 'MC KINLEY', PIEDMONE: 'PIEDMONT', 'LE ROY': 'LEROY' };
const ORDWORD = { FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH', SIXTH: '6TH', SEVENTH: '7TH',
  EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH' };
/* → { base, type }: base = the name without its type word ("ACTON"), type = a normalized type or '' when not said. */
export function streetKey(name, type = '') {
  let w = String(name || '').toUpperCase().replace(/[.,']/g, ' ').replace(/\b(\d+)\s+(ST|ND|RD|TH)\b/g, '$1$2')
    .replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).map((x) => ORDWORD[x] || x);
  let t = String(type || '').toUpperCase().trim();
  if (!t && w.length > 1 && TYPE[w[w.length - 1]]) t = w.pop();
  w = w.map((x) => x.replace(/^0+(\d)/, '$1'));
  const base = w.join(' ');
  return { base: ALIAS[base] || base, type: TYPE[t] || t };
}
const TYPE_WORD = { ST: 'St', AV: 'Ave', WY: 'Way', BL: 'Blvd', DR: 'Dr', RD: 'Rd', CT: 'Ct', PL: 'Pl', LN: 'Ln', TER: 'Ter',
  CIR: 'Cir', CRES: 'Crescent', SQ: 'Sq', PATH: 'Path', WALK: 'Walk', HWY: 'Hwy' };
/* "MARTIN LUTHER KING JR" + "WY" → "Martin Luther King Jr Way", "MC GEE" + "AV" → "McGee Ave", "6TH" → "6th St". */
export function streetName(base, type) {
  const w = base.replace(/^MC (\w)/, 'MC$1').split(' ').map((x) => {
    if (/^\d+(ST|ND|RD|TH)$/.test(x)) return x.toLowerCase();
    if (/^MC[A-Z]{2,}/.test(x)) return 'Mc' + x[2] + x.slice(3).toLowerCase();
    return x[0] + x.slice(1).toLowerCase();
  });
  return [w.join(' '), TYPE_WORD[type] || ''].filter(Boolean).join(' ');
}

// ---------- geometry ---------------------------------------------------------------------------------

const LAT0 = 37.87, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [lon * KX, lat * KY];
const ANGLE = { E: 0, NE: 45, N: 90, NW: 135, W: 180, SW: 225, S: 270, SE: 315 };
/* The side of the line (L or R, looking from its first point to its last) that faces compass direction `dir`, and how
   sure: each piece of the line votes with its length times the cosine between its left normal and `dir`. conf = 1 when
   the street runs square to `dir`, 0 when it runs along it. */
export function sideOf(coords, dir) {
  const a = ANGLE[dir] * Math.PI / 180, tx = Math.cos(a), ty = Math.sin(a);
  let vote = 0, len = 0;
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = xy(coords[i - 1]), [x2, y2] = xy(coords[i]), dx = x2 - x1, dy = y2 - y1;
    vote += -dy * tx + dx * ty;
    len += Math.hypot(dx, dy);
  }
  return { side: vote >= 0 ? 'L' : 'R', conf: len ? Math.abs(vote) / len : 0 };
}
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
/* The compass word for a side: the direction its normal points, first to last point (scripts/cities/boston.mjs). */
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
const WORD = { N: 'North', S: 'South', E: 'East', W: 'West' };

// ---------- the centerline: house numbers and sides --------------------------------------------------

const flip = (s) => (s === 'L' ? 'R' : 'L');
const parity = (n) => (n > 0 ? n % 2 : null);
/* A centerline segment's numbers. L = F_ADDL..T_ADDL, R = F_ADDR..T_ADDR (ArcGIS: left and right of the line's own
   direction); oddSpan / evenSpan = the same spans by parity; odd = the side the ranges put the odd numbers on;
   all = every number the segment holds. */
export function numbersOf(p) {
  const span = (a, b) => { const v = [a, b].map((x) => +x || 0).filter((x) => x > 0); return v.length ? [Math.min(...v), Math.max(...v)] : null; };
  const L = span(p.F_ADDL, p.T_ADDL), R = span(p.F_ADDR, p.T_ADDR);
  const par = (sp) => (sp && parity(sp[0]) === parity(sp[1]) ? parity(sp[0]) : null);
  const pl = par(L), pr = par(R);
  const odd = pl === 1 && pr !== 1 ? 'L' : pr === 1 && pl !== 1 ? 'R' : pl === 0 && pr !== 0 ? 'R' : pr === 0 && pl !== 0 ? 'L' : null;
  const all = [L, R].filter(Boolean).flat();
  return { L, R, odd, oddSpan: odd === 'L' ? L : odd === 'R' ? R : null, evenSpan: odd === 'L' ? R : odd === 'R' ? L : null,
    all: all.length ? [Math.min(...all), Math.max(...all)] : null };
}
/* How much of a segment side's numbers [lo, hi] a row's range [from, to] covers (0 to 1). */
export function coverage(span, from, to) {
  if (!span) return 0;
  const lo = Math.max(span[0], Math.min(from, to)), hi = Math.min(span[1], Math.max(from, to));
  return hi < lo ? 0 : (hi - lo + 2) / (span[1] - span[0] + 2);
}

/* A centerline feature → the segment the build works with. odd: the settled odd side (settleOddSides). */
export function segmentOf(f) {
  const p = f.properties, k = streetKey(p.STR_NAM, p.STR_TYP);
  const c = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat();
  const nums = numbersOf(p);
  let len = 0;
  for (let i = 1; i < c.length; i++) { const a = xy(c[i - 1]), b = xy(c[i]); len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return { id: String(p.OBJECTID), p, c, len, base: k.base, type: k.type, nums, odd: nums.odd, oddBy: nums.odd ? 'ranges' : null,
    status: String(p.mech_sweep || '').trim() };
}

// ---------- the odd side, from the City's address points -----------------------------------------------

/* An address point's street ("NINTH", "ACTON CRESCENT", "CLAREMONT CRES") → the same key as streetKey. */
export const pointKey = (name) => streetKey(name);

/* Which side of segment `s` holds the odd numbers, by the address points near it: { odd: 'L' | 'R' | null, n, share }.
   pts: [[number, lon, lat]] on the segment's street. A point counts when its number is inside the segment's numbers, it
   is within 45 m of the line and it projects onto the line, not past its ends. 4 points and 80% agreement decide. */
export function oddSideFromPoints(s, pts) {
  if (!s.nums.all || !pts.length) return { odd: null, n: 0, share: 0 };
  const [lo, hi] = s.nums.all;
  const P = s.c.map(xy);
  let forL = 0, forR = 0;                      // votes for "odd numbers on the left": odd points left, even points right
  for (const [n, lon, lat] of pts) {
    if (n < lo || n > hi) continue;
    const q = xy([lon, lat]);
    let best = null;
    for (let i = 1; i < P.length; i++) {
      const [x1, y1] = P[i - 1], [x2, y2] = P[i], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const t = ((q[0] - x1) * dx + (q[1] - y1) * dy) / l2, tc = Math.max(0, Math.min(1, t));
      const d = Math.hypot(q[0] - x1 - tc * dx, q[1] - y1 - tc * dy);
      const inside = (i > 1 || t >= -0.05) && (i < P.length - 1 || t <= 1.05);
      if (!best || d < best.d) best = { d, inside, left: dx * (q[1] - y1) - dy * (q[0] - x1) > 0 };
    }
    if (!best || best.d > 45 || !best.inside) continue;
    if ((n % 2 === 1) === best.left) forL++; else forR++;
  }
  const n = forL + forR;
  if (n < 4) return { odd: null, n, share: 0 };
  const share = Math.max(forL, forR) / n;
  return { odd: share >= 0.8 ? (forL > forR ? 'L' : 'R') : null, n, share: Math.round(share * 100) / 100 };
}

/* Settles each segment's odd side: the address points where they decide, else the centerline's ranges. Returns counts. */
export function settleOddSides(segs, points) {
  const byKey = new Map();
  for (const [n, name, lon, lat] of points) { const k = pointKey(name).base; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push([n, lon, lat]); }
  const out = { agree: 0, fixed: [], pointsOnly: 0, rangesOnly: 0, unclear: 0, none: 0 };
  for (const s of segs) {
    const r = oddSideFromPoints(s, byKey.get(s.base) || []);
    if (r.odd && s.nums.odd) {
      if (r.odd === s.nums.odd) { out.agree++; s.oddBy = 'ranges and points'; }
      else { out.fixed.push({ c: s.id, s: streetName(s.base, s.type), ranges: [s.p.F_ADDL, s.p.T_ADDL, s.p.F_ADDR, s.p.T_ADDR].join(' '), points: r.n }); s.odd = r.odd; s.oddBy = 'points'; }
    } else if (r.odd) { out.pointsOnly++; s.odd = r.odd; s.oddBy = 'points'; }
    else if (s.nums.odd) { out.rangesOnly++; if (r.n >= 4) out.unclear++; }
    else out.none++;
  }
  return out;
}

// ---------- the street graph: cross streets and walks -------------------------------------------------

const nodeId = ([lon, lat]) => lon.toFixed(5) + ',' + lat.toFixed(5);
export function buildGraph(segs) {
  const nodes = new Map();                     // node → { streets: Map(base → name), segs: [s] }
  for (const s of segs) {
    s.a = nodeId(s.c[0]); s.b = nodeId(s.c[s.c.length - 1]);
    for (const n of [s.a, s.b]) {
      if (!nodes.has(n)) nodes.set(n, { streets: new Map(), segs: [] });
      nodes.get(n).streets.set(s.base, streetName(s.base, s.type));
      nodes.get(n).segs.push(s);
    }
  }
  return nodes;
}
/* The cross street at node `n` of segment `s`: another street meeting there, else (a node inside a block, or a curve)
   the first one met walking on along the same street; '' at a dead end. */
export function crossAt(s, n, nodes) {
  let seg = s, node = n;
  for (let i = 0; i < 30; i++) {
    const nd = nodes.get(node);
    const others = [...nd.streets.entries()].filter(([k]) => k !== s.base).map(([, v]) => v).sort();
    if (others.length) return others[0];
    const next = nd.segs.filter((x) => x !== seg && x.base === s.base);
    if (next.length !== 1) return '';
    seg = next[0]; node = seg.a === node ? seg.b : seg.a;
  }
  return '';
}
/* Marks each node within 40 m of the City boundary (GISportal layer 2): a dead end there is where the street leaves
   Berkeley ("City Limit"), one elsewhere is a "Terminus". */
export function markCityLimit(nodes, paths) {
  const pieces = [];
  for (const p of paths) { const P = p.map(xy); for (let i = 1; i < P.length; i++) pieces.push([P[i - 1], P[i]]); }
  for (const [id, nd] of nodes) {
    const [lon, lat] = id.split(',').map(Number), q = xy([lon, lat]);
    nd.atLimit = pieces.some(([a, b]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
      return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy) <= 40;
    });
  }
}
const ENDS = /^([NSEW]\s*)?(TERMINUS|CUL DE SAC|END|DEAD END|CITY LIMITS?)$/;
const crossWord = (x) => String(x || '').toUpperCase().replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim();
/* The walk along the row's street between its two cross streets (rows whose numbers place nothing, and a check on those
   that do): segments of the street from a node where `fromSt` meets it to one where `toSt` does; "Terminus", "Cul De
   Sac" are the street's dead ends inside the City, "City Limit" those at its boundary (markCityLimit). Of the walks
   between them, the one whose numbers overlap the row's range the most, then the shortest. A walk to a dead end longer
   than two segments that shares no number with the row is no walk: a hill street has several dead ends, and nothing
   tells which one the row means (a cul-de-sac is fine). */
export function walkRow(row, cands, nodes) {
  if (!cands.length) return null;
  const adj = new Map();
  for (const s of cands) for (const [n, m] of [[s.a, s.b], [s.b, s.a]]) { if (!adj.has(n)) adj.set(n, []); adj.get(n).push([m, s]); }
  const deadEnds = [...adj.keys()].filter((n) => adj.get(n).length === 1);
  const at = (cross) => {
    const w = crossWord(cross);
    if (!w) return null;
    if (ENDS.test(w)) {
      // "City Limit": the street's last node at the City boundary (where it may meet a border street); "Terminus": a
      // node no other street reaches, inside the City. Any end of the street when that leaves none.
      const limit = /CITY LIMIT/.test(w);
      const some = deadEnds.filter((n) => (limit ? nodes.get(n).atLimit : !nodes.get(n).atLimit && nodes.get(n).streets.size === 1));
      const alone = deadEnds.filter((n) => nodes.get(n).streets.size === 1);
      return some.length ? some : alone.length ? alone : deadEnds;
    }
    const k = streetKey(cross).base;
    return [...adj.keys()].filter((n) => nodes.get(n).streets.has(k));
  };
  const A = at(row.fromSt), B = at(row.toSt);
  if (!A || !B || !A.length || !B.length) return null;
  const lo = Math.min(row.from, row.to), hi = Math.max(row.from, row.to);
  const overlap = (path) => path.reduce((n, s) => {
    const sp = s.nums.all; if (!sp) return n;
    const a = Math.max(sp[0], lo), b = Math.min(sp[1], hi);
    return n + (b >= a ? b - a + 1 : 0);
  }, 0);
  let best = null;
  for (const f of A) {
    const dist = new Map([[f, 0]]), prev = new Map(), queue = [[0, f]];
    while (queue.length) {
      queue.sort((x, y) => x[0] - y[0]);
      const [d, n] = queue.shift();
      if (d > dist.get(n)) continue;
      for (const [m, s] of adj.get(n) || []) {
        const nd = d + s.len;
        if (nd < (dist.get(m) ?? Infinity)) { dist.set(m, nd); prev.set(m, [n, s]); queue.push([nd, m]); }
      }
    }
    for (const t of B) {
      if (t === f || !dist.has(t)) continue;
      const path = [];
      for (let n = t; n !== f;) { const [pn, s] = prev.get(n); path.unshift(s); n = pn; }
      const ov = overlap(path), len = dist.get(t);
      if (!best || ov > best.ov || (ov === best.ov && len < best.len)) best = { ov, len, path };
    }
  }
  if (!best) return null;
  if (!best.ov && best.path.length > 2 && (ENDS.test(crossWord(row.fromSt)) || ENDS.test(crossWord(row.toSt)))) return null;
  return best.path;
}

// ---------- rows → block sides ---------------------------------------------------------------------

// How sure a placement is, best first (placeRow): a side two rows give different days goes to the better one.
export const RANK = { both: 0, numbers: 1, 'cross streets': 2, 'numbers past the cross streets': 3 };

// Types a row names only when it means them: a bare "Acton" is Acton St, never Acton Circle or Acton Crescent.
const MINOR = new Set(['CIR', 'CRES', 'CT', 'PL', 'LN', 'TER', 'PATH', 'WALK', 'SQ', 'HWY']);
const COVER = 0.5;   // a segment side belongs to a row when the row's range covers at least half its numbers

/* The segments of the row's street: its type when the row names one, else the street's main types. */
export function candidates(row, byBase) {
  const k = streetKey(row.street);
  let cands = byBase.get(k.base) || [];
  if (k.type) { const t = cands.filter((s) => s.type === k.type); if (t.length) cands = t; }
  else { const main = cands.filter((s) => !MINOR.has(s.type)); if (main.length) cands = main; }
  return cands;
}

/* The side of segment `s` a row means, and why: the side holding the row's parity (N and E sides odd, S and W even) by the
   segment's settled odd side, unless only the centerline's ranges say so and the row's own word points clearly the other
   way (the street runs within 45° of square to it): then the ranges are taken as the wrong way round, like the 56 the
   address points caught. With no odd side, or when the row's numbers aren't the segment's at all (a court numbered 1-99
   that the schedule calls 1600-1698), the side facing the row's word. → { side, span, by } */
const SURE = 0.7;
function sideFor(row, s, par, numbersMeanIt = true) {
  const cmp = row.side === 'BOTH' ? null : sideOf(s.c, row.side);
  if (cmp && (!numbersMeanIt || !s.odd) && cmp.conf >= 0.3) return { side: cmp.side, span: s.nums.all, by: 'compass' };
  if (s.odd) {
    const side = par ? s.odd : flip(s.odd), span = (par ? s.nums.oddSpan : s.nums.evenSpan) || s.nums.all;
    if (cmp && s.oddBy === 'ranges' && cmp.conf >= SURE && cmp.side !== side) return { side: cmp.side, span, by: 'compass over ranges' };
    return { side, span, by: s.oddBy };
  }
  if (cmp) return { side: cmp.side, span: s.nums.all, by: 'compass' };
  return { side: par ? 'L' : 'R', span: s.nums.all, by: 'both' };
}

/* The segment sides a parsed row covers: { hits: [{ s, side, by, how }], walked, why }. how: 'both' (the row's range covers
   the side's numbers and the segment lies on the street between the row's two cross streets), 'numbers' (the range does;
   the cross streets name no walk, or a walk elsewhere: a typo in one of them) or 'cross streets' (no segment holds the
   numbers: the walk alone). 'numbers past the cross streets': the range covers the side but the segment is off the walk
   the cross streets name, which holds others (the range runs a block past them, "Acton W 1651-2099, Lincoln -
   University"); kept unless another row gives that side a day. A segment on the walk whose numbers the range misses is
   left out: the numbers decide. */
export function placeRow(row, byBase, nodes) {
  const cands = candidates(row, byBase);
  if (!cands.length) return { hits: [], walked: false, why: 'street not on the centerline' };
  const pars = row.side === 'BOTH' ? [1, 0] : [row.side === 'N' || row.side === 'E' ? 1 : 0];
  const path = nodes ? walkRow(row, cands, nodes) : null;
  const onWalk = new Set((path || []).map((s) => s.id));
  let hits = [];
  for (const s of cands) for (const par of pars) {
    const { side, span, by } = sideFor(row, s, par);
    if (coverage(span, row.from, row.to) >= COVER) hits.push({ s, side, by, how: onWalk.has(s.id) ? 'both' : 'numbers' });
  }
  if (path && hits.some((h) => h.how === 'both')) for (const h of hits) if (h.how === 'numbers') h.how = 'numbers past the cross streets';
  if (!hits.length && path) for (const s of path) for (const par of pars) hits.push({ s, ...sideFor(row, s, par, false), how: 'cross streets' });
  const seen = new Set();
  hits = hits.filter((h) => { const k = h.s.id + h.side; return !seen.has(k) && seen.add(k); });
  return { hits, walked: !!path, why: hits.length ? '' : 'no segment of the street holds these numbers, and no walk between its cross streets' };
}

/* Hundred blocks that left the program, by street base name: every "Opt-Out" any row of the street names. */
export function optOuts(rows) {
  const m = new Map();
  for (const r of rows) for (const h of r.optOut || []) {
    const k = streetKey(r.street).base;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(h - (h % 100));
  }
  return m;
}
/* The opted-out hundred blocks a segment lies in (every hundred its numbers touch, both sides: "13/1400" takes 1300-1499),
   or null. */
export function inOptOut(s, blocks) {
  if (!blocks || !s.nums.all) return null;
  const [lo, hi] = s.nums.all, hs = [];
  for (let h = lo - (lo % 100); h <= hi; h += 100) { if (!blocks.has(h)) return null; hs.push(h); }
  return hs.join('/');
}

// ---------- city facts ------------------------------------------------------------------------------

// City of Berkeley holidays (berkeleyca.gov/your-government/city-holidays): 2026 as the page listed it on 2026-01-29
// (Internet Archive), 2027 as it lists it on 2026-10-18. The page's "Reduced Service Days" are left out: the City says
// streets are not swept on City holidays, and does not say so of reduced service days (a question for the City).
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': "Martin Luther King Jr.'s Birthday", '2026-02-12': "Lincoln's Birthday",
  '2026-02-16': "Washington's Birthday", '2026-03-30': 'César Chávez Day (observed)', '2026-05-18': "Malcolm X's Birthday (observed)",
  '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day',
  '2026-10-12': "Indigenous Peoples' Day", '2026-11-11': 'Veterans Day', '2026-11-26': 'Thanksgiving Day',
  '2026-11-27': 'Thanksgiving Holiday', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': "Martin Luther King Jr.'s Birthday (observed)", '2027-02-12': "Lincoln's Birthday",
  '2027-02-15': "Washington's Birthday (observed)", '2027-03-29': 'César Chávez Farmworkers Day (observed)', '2027-05-17': "Malcolm X's Birthday (observed)",
  '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)', '2027-07-05': 'Independence Day (observed)',
  '2027-09-06': 'Labor Day', '2027-10-11': "Indigenous Peoples' Day", '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving Day',
  '2027-11-26': 'Thanksgiving Holiday', '2027-12-24': 'Christmas (observed)',
};

// ---------- inputs -----------------------------------------------------------------------------------

const UA = { 'User-Agent': 'curb-berkeley-build (+https://curb.guide)' };
async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { ...UA, Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const d = await r.json();
      if (d.error) throw new Error(`${url}: ${JSON.stringify(d.error)}`);
      return d;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 2000 * i));
    }
  }
}
async function download(url, file, refresh) {
  const f = CACHE + file;
  if (!refresh && fs.existsSync(f)) return f;
  log(`fetching ${url}…`);
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return f;
}
async function cached(file, refresh, fetcher) {
  const f = CACHE + file;
  if (!refresh && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fetcher();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}
// An ArcGIS layer, page by page (1,000 a page on these MapServers).
async function layer(url, params) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const q = new URLSearchParams({ ...params, orderByFields: 'OBJECTID', resultOffset: off, resultRecordCount: 1000 });
    const page = (await getJSON(`${url}/query?${q}`)).features || [];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

// pdfjs-dist, installed once into the cache (never the repo's package.json); PDFJS_DIR points at another install.
async function pdfjs() {
  const dir = process.env.PDFJS_DIR || CACHE + 'pdfjs/';
  const entry = dir + 'node_modules/pdfjs-dist/legacy/build/pdf.mjs';
  if (!fs.existsSync(entry)) {
    log(`installing ${PDFJS} into ${dir}…`);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('npm', ['install', '--prefix', dir, '--no-save', '--no-package-lock', '--no-audit', '--no-fund', PDFJS], { stdio: 'inherit' });
  }
  return import(pathToFileURL(entry).href);
}
/* A PDF → { created, modified, pages: [[{s, x, y}]] }, cached next to the PDF as <file>.items.json. */
async function pdfItems(file, refresh) {
  const cache = file + '.items.json';
  if (!refresh && fs.existsSync(cache) && fs.statSync(cache).mtimeMs >= fs.statSync(file).mtimeMs) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, verbosity: 0 }).promise;
  const meta = (await doc.getMetadata()).info || {};
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(tc.items.filter((i) => i.str !== undefined && i.str.trim()).map((i) => ({ s: i.str, x: +i.transform[4].toFixed(1), y: +i.transform[5].toFixed(1) })));
  }
  const out = { created: meta.CreationDate || null, modified: meta.ModDate || null, pages };
  fs.writeFileSync(cache, JSON.stringify(out));
  return out;
}
const pdfDate = (d) => { const m = /^D:(\d{4})(\d{2})(\d{2})/.exec(d || ''); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthYear = (iso) => (iso ? `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : 'an unknown date');

// ---------- the build -------------------------------------------------------------------------------

async function main() {
  const refresh = process.argv.includes('--refresh');
  const today = new Date().toISOString().slice(0, 10);

  // 1. inputs, and a check that they still look the way this build reads them
  const pdfs = [];
  for (const p of PDFS) {
    const path = await download(p.url, p.file, refresh);
    pdfs.push({ ...p, ...(await pdfItems(path, refresh)) });
  }
  const status = await cached('sweep-status.geojson', refresh, async () => {
    log('fetching Street Sweep Status…');
    return { type: 'FeatureCollection', features: await layer(STATUS, { where: '1=1', outSR: 4326, f: 'geojson',
      outFields: 'OBJECTID,F_ADDR,T_ADDR,F_ADDL,T_ADDL,STR_NAM,STR_TYP,mech_sweep,Code,Opt_In_Stage,Route' }) };
  });
  const points = await cached('address-points.json', refresh, async () => {
    log('fetching address points (house number and street only)…');
    const f = await layer(ADDRESSES, { where: "AddressType='M'", outFields: 'StreetNumber,StreetName', outSR: 4326, f: 'json' });
    return f.filter((x) => x.geometry && x.attributes.StreetNumber > 0)
      .map((x) => [x.attributes.StreetNumber, String(x.attributes.StreetName || '').trim(), +x.geometry.x.toFixed(6), +x.geometry.y.toFixed(6)]);
  });
  const boundary = await cached('boundary.json', refresh, async () => {
    log('fetching the City boundary…');
    return (await layer(BOUNDARY, { where: '1=1', outFields: 'OBJECTID', outSR: 4326, f: 'json' })).flatMap((f) => f.geometry?.paths || []);
  });
  const F = status.features || [];
  const need = ['OBJECTID', 'F_ADDR', 'T_ADDR', 'F_ADDL', 'T_ADDL', 'STR_NAM', 'STR_TYP', 'mech_sweep'];
  const missing = need.filter((k) => !(k in (F[0]?.properties || {})));
  if (F.length < 2500 || missing.length) throw new Error(`Street Sweep Status changed shape: ${F.length} segments, missing ${missing.join(', ') || 'none'}`);
  if (points.length < 25000) throw new Error(`address points: only ${points.length}`);

  // 2. the schedule rows
  const rows = [];
  for (const p of pdfs) p.pages.forEach((items, i) => {
    const head = ['Rte', 'Street Name', 'Opt-Out'].every((h) => items.some((it) => it.s.trim() === h));
    const found = rowsFromItems(items);
    if (!head && found.length) throw new Error(`${p.file} page ${i + 1}: the column headers moved`);
    for (const cells of found) rows.push({ file: p.file, page: i + 1, cells, ...parseRow(cells) });
  });
  const usable = rows.filter((r) => !r.problems.length);
  const routeOff = usable.filter((r) => !routeAgrees(r));
  if (rows.length < 650 || usable.length < 0.97 * rows.length || routeOff.length > 0.02 * usable.length)
    throw new Error(`the schedule PDFs changed shape: ${rows.length} rows, ${usable.length} usable, ${routeOff.length} with a route that disagrees`);

  // 3. the centerline
  const all = F.filter((f) => f.geometry && String(f.properties.STR_NAM || '').trim()).map(segmentOf);
  const segs = all.filter((s) => s.len >= 3);              // a few zero-length duplicates (6th St 1900-1998 has three copies)
  const oddCheck = settleOddSides(segs, points);
  const nodes = buildGraph(segs);
  markCityLimit(nodes, boundary);
  const byBase = new Map();
  for (const s of segs) { if (!byBase.has(s.base)) byBase.set(s.base, []); byBase.get(s.base).push(s); }
  const opt = optOuts(usable);

  // 4. rows → block sides
  const sides = new Map();   // segment id → Map(L|R → [{ rule, how, width, word, row }])
  const doubtOdd = new Set(); // segments whose odd side a row's word overruled: no "o" for them
  const rep = { unplaced: [], optedOut: [], placedRows: 0, how: {}, oddBy: {},
    side: { agree: 0, differ: [], lowConfidence: 0 } };
  const rowRef = (r) => ({ street: r.street, side: r.side, numbers: `${r.from}-${r.to}`, between: `${r.fromSt} - ${r.toSt}`,
    day: `${['', '1st', '2nd', '3rd', '4th', '5th'][r.week]} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][r.dow]} ${r.ampm}`, pdf: r.file.replace('StreetSweepingSchedule_', '').replace('.pdf', ''), page: r.page });
  for (const r of usable) {
    const { hits, why } = placeRow(r, byBase, nodes);
    if (!hits.length) { rep.unplaced.push({ ...rowRef(r), why }); continue; }
    let kept = 0;
    for (const h of hits) {
      const oo = inOptOut(h.s, opt.get(h.s.base));
      if (oo !== null) { rep.optedOut.push({ c: h.s.id, street: streetName(h.s.base, h.s.type), block: oo, status: h.s.status, row: `${r.street} ${r.side} ${r.from}-${r.to}` }); continue; }
      kept++;
      rep.oddBy[h.by] = (rep.oddBy[h.by] || 0) + 1;
      if (h.by === 'compass over ranges') doubtOdd.add(h.s.id);
      if (!sides.has(h.s.id)) sides.set(h.s.id, new Map());
      const m = sides.get(h.s.id);
      if (!m.has(h.side)) m.set(h.side, []);
      m.get(h.side).push({ rule: ruleOf(r), how: h.how, width: Math.abs(r.to - r.from), word: r.side, row: `${r.street} ${r.side} ${r.from}-${r.to} (${r.fromSt} - ${r.toSt})` });
      if (r.side !== 'BOTH') {                   // the side the numbers chose, against the compass side of the row's word
        const cmp = sideOf(h.s.c, r.side);
        if (cmp.conf < 0.5) rep.side.lowConfidence++;
        else if (cmp.side === h.side) rep.side.agree++;
        else rep.side.differ.push({ c: h.s.id, street: streetName(h.s.base, h.s.type), word: r.side, placed: compass(h.s.c, h.side), by: h.by, row: `${r.from}-${r.to}` });
      }
    }
    if (kept) {
      rep.placedRows++;
      const how = hits.map((h) => h.how).sort((a, b) => RANK[a] - RANK[b])[0];
      rep.how[how] = (rep.how[how] || 0) + 1;
    }
  }
  const optedOutRows = usable.length - rep.placedRows - rep.unplaced.length;

  // 5. blocks
  // A side that two rows give different days: the row placed by numbers and cross streets both wins over one placed by
  // numbers alone, then the row with the narrower range (the schedule repeats a block in a wide row now and then: "Acton E
  // 1329-1949" against "Acton E 1601-1699", whose day the posted sign confirms). Still tied: both rules stay.
  const segById = new Map(segs.map((s) => [s.id, s]));
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const out = [], twoRules = [], settled = [], won = {}, pastCross = [];
  const uniq = (list) => [...new Map(list.map((x) => [x.rule.join('|'), x.rule])).values()];
  for (const [id, m] of sides) {
    const s = segById.get(id);
    const d = ['L', 'R'].filter((k) => m.has(k)).map((k) => {
      const cands = m.get(k);
      const best = cands.reduce((a, c) => (RANK[c.how] < RANK[a.how] || (RANK[c.how] === RANK[a.how] && c.width < a.width) ? c : a));
      const keep = cands.filter((c) => RANK[c.how] === RANK[best.how] && c.width === best.width);
      const rules = uniq(keep).sort((a, b) => a[3] - b[3] || a[0] - b[0]);
      if (uniq(cands).length > rules.length) settled.push({ c: id, street: streetName(s.base, s.type), side: k, kept: keep.map((x) => x.row),
        dropped: cands.filter((x) => !keep.includes(x) && !rules.some((r) => r.join('|') === x.rule.join('|'))).map((x) => `${x.row} [${x.how}]`) });
      if (rules.length > 1) twoRules.push({ c: id, street: streetName(s.base, s.type), side: k, rules, rows: keep.map((x) => x.row) });
      won[best.how] = (won[best.how] || 0) + 1;
      if (best.how === 'numbers past the cross streets') pastCross.push({ c: id, street: streetName(s.base, s.type), side: k, n: s.nums.all, row: best.row });
      const words = [...new Set(keep.map((x) => x.word))].filter((w) => w !== 'BOTH');
      return [k, words.length === 1 ? WORD[words[0]] : compass(s.c, k), rules];
    });
    const l = [crossAt(s, s.a, nodes), crossAt(s, s.b, nodes)].filter(Boolean);
    out.push({ c: id, s: streetName(s.base, s.type), l: [...new Set(l)].join(' - '), ...(s.nums.all ? { n: s.nums.all } : {}),
      ...(s.odd && !doubtOdd.has(id) ? { o: s.odd } : {}), g: s.c.map(([lo, la]) => [r6(lo), r6(la)]), d });
  }
  out.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));
  const sidesOut = out.reduce((n, b) => n + b.d.length, 0), rulesOut = out.reduce((n, b) => n + b.d.reduce((k, x) => k + x[2].length, 0), 0);

  // 6. the City's own status layer against the schedule
  const statusOf = new Map(); for (const b of out) { const st = segById.get(b.c).status || '(blank)'; statusOf.set(st, (statusOf.get(st) || 0) + 1); }
  const placedIds = new Set(out.map((b) => b.c)), optIds = new Set(rep.optedOut.map((o) => o.c));
  const enforcedNoRow = segs.filter((s) => s.status === 'enforced' && !placedIds.has(s.id) && !optIds.has(s.id));
  const exemptWithRow = out.filter((b) => segById.get(b.c).status === 'exempt')
    .map((b) => ({ c: b.c, s: b.s, n: b.n, optInStage: segById.get(b.c).p.Opt_In_Stage || null }));

  // 7. city facts: the City's streets frame the map; the opening view is the 1.5 km square with the most swept sides
  const allPts = segs.flatMap((s) => s.c);
  const lons = allPts.map((p) => p[0]).sort((a, b) => a - b), lats = allPts.map((p) => p[1]).sort((a, b) => a - b);
  const bounds = [[+lats[0].toFixed(4), +lons[0].toFixed(4)], [+lats[lats.length - 1].toFixed(4), +lons[lons.length - 1].toFixed(4)]];
  const cells = new Map(), CW = 0.004, CH = 0.003;          // ~350 m cells; the opening view centers the busiest 3 by 3
  for (const b of out) { const [lo, la] = b.g[Math.floor(b.g.length / 2)]; const k = Math.floor(lo / CW) + ',' + Math.floor(la / CH); cells.set(k, (cells.get(k) || 0) + b.d.length); }
  let top = null;
  for (const k of cells.keys()) {
    const [x, y] = k.split(',').map(Number);
    let n = 0; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += cells.get((x + i) + ',' + (y + j)) || 0;
    if (!top || n > top.n) top = { n, x, y };
  }
  const center = [+((top.y + 0.5) * CH).toFixed(4), +((top.x + 0.5) * CW).toFixed(4)];

  // 8. write
  const dates = Object.fromEntries(pdfs.map((p) => [p.file, pdfDate(p.created)]));
  const sources = [
    { name: 'Residential Street Sweeping Schedule (Public Works): three PDFs, streets A-G and numbered streets (created '
      + `${dates[PDFS[0].file]}), H-Z (created ${dates[PDFS[1].file]})`, url: PAGE, license: 'not stated (City of Berkeley public document)', fetched: today },
    { name: 'Street Sweep Status (Public Works GIS): street centerline with house number ranges', url: STATUS, license: 'not stated', fetched: today },
    { name: 'Addresses (City GIS portal), house number and street only, to tell the odd side', url: ADDRESSES, license: 'not stated', fetched: today },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'berkeley', time_zone: 'America/Los_Angeles', generated: new Date().toISOString(), sources, blocks: out.length, sides: sidesOut,
      format: 'b[] = {c: Street Sweep Status OBJECTID, s: street, l: cross streets, n: [lowest, highest house number], o: the side with odd numbers (L|R), '
        + 'g: centerline [[lng,lat]], d: [[side L|R, the City\'s side word or compass label, rules]]}; rule = [jsDow, from, to ("H:MM" with minutes), '
        + 'weeksMask (bit i = week i+1), monthsMask (0 = all year), flags (0: holidays cancel, no tow)]' },
    b: out }));

  const k = (n) => n.toLocaleString('en-US');
  const city = {
    id: 'berkeley', name: 'Berkeley', region: 'California', tz: 'America/Los_Angeles', center, zoom: 15, bounds,
    holidays: HOLIDAYS, holidaysSource: HOLIDAYS_URL, holidayRule: 'all',
    fine: '$73', tow: 'no', fineSource: FINES,
    agency: 'Berkeley Public Works', scheduleUrl: PAGE,
    sources,
    words: {
      rule: 'Each side of a residential block is swept once a month on a set day, like the 2nd Tuesday: no parking 9 AM to noon or 12:30 to 3:30 PM, as the signs say.',
      afterpass: 'All year · not on City holidays (swept on the next scheduled day) · $73 ticket, no tow',
      dataNotes: `The City's Residential Street Sweeping Schedule (Public Works; streets A to G and numbered streets from ${monthYear(dates[PDFS[0].file])}, H to Z from ${monthYear(dates[PDFS[1].file])}), `
        + `${k(sidesOut)} block sides placed on the City's street centerline by house number; the City's address points tell which side holds the odd numbers. `
        + 'The schedule says only AM or PM: the hours are the ones on the posted signs. Blocks that opted out of the program are not swept and are left off.',
    },
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1) + '\n');

  const report = {
    generated: new Date().toISOString(),
    season: 'All year, once a month per side (the nth weekday of the month). A City holiday cancels that day\'s sweep; the City says the streets are swept "on their next regularly scheduled day", which is the next month\'s. No make-up day.',
    hours: { AM: '9 AM to 12 noon', PM: '12:30 PM to 3:30 PM',
      source: 'Not in the City\'s schedule, which says only AM or PM. Read on posted signs in Google Street View: "NO PARKING 9 AM TO 12 NOON, 1ST TUESDAY EACH MONTH, STREET SWEEPING" '
        + '(Ward St, 1600 block, south side, imagery Jan 2015) and "NO PARKING 12:30 PM TO 3:30 PM, 1ST WEDNESDAY EACH MONTH" (Acton St, 1600 block, east side, imagery Mar 2025); '
        + 'both match the schedule\'s day for that side. To confirm with the City that every AM and PM sign reads the same.' },
    input: { pdfs: PDFS.map((p) => ({ file: p.file, url: p.url, created: dates[p.file], pages: pdfs.find((x) => x.file === p.file).pages.length,
      rows: rows.filter((r) => r.file === p.file).length })),
    rows: rows.length, usable: usable.length, routeAgrees: usable.length - routeOff.length,
    unreadable: rows.filter((r) => r.problems.length).map((r) => ({ cells: r.cells, why: r.problems })),
    assumed: rows.filter((r) => r.notes.length).map((r) => ({ ...rowRef(r), note: r.notes.join('; ') })),
    centerline: { segments: F.length, withName: all.length, shorterThan3m: all.length - segs.length }, addressPoints: points.length },
    output: { blocks: out.length, sides: sidesOut, rules: rulesOut, oneSideOnly: out.filter((b) => b.d.length === 1).length,
      am: out.reduce((n, b) => n + b.d.filter(([, , rs]) => rs.some((r) => r[1] === 9)).length, 0),
      pm: out.reduce((n, b) => n + b.d.filter(([, , rs]) => rs.some((r) => r[1] === '12:30')).length, 0),
      sidesWithTwoRules: twoRules.length },
    placement: {
      method: `A row goes on each segment of its street (its type if the row names one, else the street's main types) whose numbers on the row's side are at least ${COVER * 100}% inside the row's range, `
        + 'on the side holding the row\'s parity (N and E odd, S and W even, as the PDFs say). A segment\'s odd side is the address points\' (4 points, 80%) where they decide, else the centerline\'s ranges; '
        + 'when only the ranges say it and the row\'s word points clearly the other way (conf >= 0.7), the word wins ("compass over ranges"); with no odd side, or numbers that are not the segment\'s at all, the side facing the row\'s word. '
        + 'A row whose numbers place nothing is walked along its street between its two cross streets ("Terminus", "Cul De Sac" = a dead end inside the City, "City Limit" = one at the City boundary). '
        + 'A side two rows give different days keeps the row whose numbers and cross streets both put it there, then the row with the narrower range; still tied, both rules stay.',
      rowsPlaced: rep.placedRows, rowsPlacedBy: { numbersAndCrossStreets: rep.how.both || 0, numbersOnly: rep.how.numbers || 0, crossStreetsOnly: rep.how['cross streets'] || 0 },
      sidesBy: won, sidesPastTheCrossStreets: pastCross,
      rowsOnlyInOptedOutBlocks: optedOutRows,
      rowsUnplaced: rep.unplaced.length, unplaced: rep.unplaced,
      sideFrom: rep.oddBy,
      oddSide: { agree: oddCheck.agree, rangesWrongWayRound: oddCheck.fixed.length, fixed: oddCheck.fixed, pointsOnly: oddCheck.pointsOnly, rangesOnly: oddCheck.rangesOnly, pointsUnclear: oddCheck.unclear, noNumbers: oddCheck.none },
      compassCheck: { note: 'Each placed side against the compass side of the row\'s word (N, S, E, W), where the street runs within 60° of square to it (conf >= 0.5).',
        agree: rep.side.agree, differ: rep.side.differ.length, lowConfidence: rep.side.lowConfidence, differences: rep.side.differ },
      settledBetweenRows: { note: 'Sides two rows gave different days, settled as above (kept: the winning row; dropped: the others).', sides: settled.length, list: settled },
      sidesWithTwoRules: twoRules,
    },
    optOut: { note: 'Blocks named in the schedule\'s Opt-Out column left the program (Resolution 54,513-N.S., 1987) and are not swept. A segment whose numbers lie wholly inside opted-out hundred blocks of its street (any row of the street naming them) is left off, both sides. status = the City layer\'s own status for it.',
      blocks: [...opt.entries()].map(([s, hs]) => `${s} ${[...hs].sort((a, b) => a - b).join(', ')}`), segmentsLeftOff: rep.optedOut.length, list: rep.optedOut },
    cityStatusLayer: { note: 'The Street Sweep Status layer\'s own status for the segments the schedule placed. Not used to place rules; the schedule wins.',
      placedByStatus: Object.fromEntries(statusOf),
      exemptButScheduled: exemptWithRow,
      enforcedWithoutScheduleRow: enforcedNoRow.length,
      enforcedWithoutScheduleRowExamples: enforcedNoRow.slice(0, 40).map((s) => ({ c: s.id, s: streetName(s.base, s.type), n: s.nums.all })) },
    crossCheck: 'None: the City of Berkeley publishes no parking citation data (open data portal checked 2026-10-18).',
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');

  log(`${rows.length} rows (${usable.length} usable, ${routeOff.length} with a disagreeing route); placed ${rep.placedRows} (${rep.how.both || 0} by numbers and cross streets, ${rep.how.numbers || 0} numbers only, ${rep.how['cross streets'] || 0} cross streets only), ${optedOutRows} only in opted-out blocks, ${rep.unplaced.length} unplaced`);
  log(`${out.length} blocks, ${sidesOut} sides, ${rulesOut} rules; ${settled.length} sides settled between rows, ${twoRules.length} left with two rules; odd side: ${oddCheck.agree} agree, ${oddCheck.fixed.length} fixed by address points`);
  log(`compass check: ${rep.side.agree} agree, ${rep.side.differ.length} differ, ${rep.side.lowConfidence} low confidence; ${rep.optedOut.length} segments left off as opted out`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/berkeley/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
