#!/usr/bin/env node
// Toronto, Ontario for CURB (built 2026-10-20, by docs/multi-city/city-build.md). Writes data/toronto/ from the City of
// Toronto's open data (Toronto Open Data, CKAN at ckan0.cf.opendata.inter.prod-toronto.ca, Open Government Licence –
// Toronto):
//
//   1. Traffic and Parking By-Law Schedules: Municipal Code Chapter 950's schedules as data (Transportation Services,
//      refreshed with each by-law). Two of them are winter parking rules:
//      Schedule XVII-A (§ 950-1316A), "Parking and Standing during Major Snow Storm Conditions": the snow routes. While
//      a Major Snow Storm Condition is declared (§ 950-406), no parking or standing on them, where signed.
//      Schedule IV (§ 950-1303), "Former City of North York Winter Maintenance Parking Prohibited": § 950-400D(9), no
//      parking 2:00 to 6:00 AM, December 1 to March 31, unsigned. Council takes streets off it one by one (an entry
//      repealed, often with new entries for the parts or sides that keep the ban).
//      Each entry names a street and its limits ("Fairholme Avenue, between Dell Park Avenue (east intersection) and
//      Bathurst Street"), most with the coordinates of the intersections; the build places each on the centreline.
//   2. Toronto Centreline (TCL): every street segment, with CENTRELINE_ID (the block id), names, address ranges and the
//      intersections at its ends.
//   3. Former Municipality Boundaries: the former City of North York, where the winter ban is.
//   4. Parking Tickets 2025 (Revenue Services), for report.json only: where last winter's snow route and North York tickets
//      were written.
//
// The snow route rule applies only while the City declares a Major Snow Storm Condition. The City has no feed for it: it
// says so in a news release, and CURB's switch (data/toronto/winter.json, scripts/cities/winter.mjs) follows by hand,
// told by the news watcher (scripts/cities/winter-watch.mjs). The North York ban runs every night of its season.
//
// Run: node scripts/cities/toronto.mjs [--refresh]   (Node 18+; inputs cached in private/cache/toronto/, about 1.1 GB, as
// the schedules file is 0.8 GB; the system `unzip` reads the tickets)

import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/toronto/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/toronto/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[toronto]', ...a);

export const CKAN = 'https://ckan0.cf.opendata.inter.prod-toronto.ca';
export const LICENCE = 'Open Government Licence – Toronto';
export const LICENCE_URL = 'https://open.toronto.ca/open-data-licence/';
// The inputs: a CKAN package and the resource in it (by name, so a new resource id after a refresh is still found).
export const INPUTS = {
  schedules: { pkg: 'traffic-and-parking-by-law-schedules', resource: /schedules/i, file: 'bylaw-schedules.json',
    what: 'Traffic and Parking By-Law Schedules (Municipal Code Chapter 950)', page: 'https://open.toronto.ca/dataset/traffic-and-parking-by-law-schedules/' },
  centreline: { pkg: 'toronto-centreline-tcl', resource: /4326\.geojson$/i, file: 'centreline.geojson',
    what: 'Toronto Centreline (TCL)', page: 'https://open.toronto.ca/dataset/toronto-centreline-tcl/' },
  municipalities: { pkg: 'former-municipality-boundaries', resource: /4326\.geojson$/i, file: 'former-municipalities.geojson',
    what: 'Former Municipality Boundaries', page: 'https://open.toronto.ca/dataset/former-municipality-boundaries/' },
  tickets: { pkg: 'parking-tickets', resource: /^parking-tickets-2025$/i, file: 'tickets/parking-tickets-2025.zip',
    what: 'Parking Tickets (2025)', page: 'https://open.toronto.ca/dataset/parking-tickets/' },
};
export const CODE_URL = 'https://www.toronto.ca/legdocs/municode/1184_950.pdf';
export const SNOW_PAGE = 'https://www.toronto.ca/services-payments/streets-parking-transportation/road-maintenance/winter-maintenance/major-snow-event/';
export const SNOW_LIST_PDF = 'https://www.toronto.ca/wp-content/uploads/2026/01/8d15-Major-Snow-Storm-Condition-Routes-List.pdf';
export const SNOW_RELEASE = 'https://www.toronto.ca/news/city-of-toronto-activates-new-snow-event-response-plan-as-major-snowstorm-condition-and-significant-weather-event-declared/';

// ---------- facts (checked 2026-10-20; sources in city.json and docs/multi-city/toronto.md) ------------------------------

// The snow route rule is CURB's switch rule (city.json `winter` with `declared`: lib/city.js, lib/winter-ui.js,
// lib/notify-core.js winterPlan): it closes both sides at all hours on the days the switch is on. A declaration can come
// any day of the snow season, so its rules list every date from November 1 to April 30, in two lists of under 96 dates (a
// saved alert keeps 96 dates a rule: api/_spot.js), each day a window from midnight to midnight.
export const SNOW = { from: '2026-11-01', to: '2027-04-30', start: 0, end: 24, declared: true };
// § 950-400D(9): "In the former City of North York, from 2:00 a.m. to 6:00 a.m., from December 1 of one year to March 31 of
// the next following year". A weekly rule every day, December to March (months mask), so it needs no yearly rebuild.
export const NIGHT = { start: 2, end: 6, months: [12, 1, 2, 3] };
// Flags (docs/multi-city/city-build.md): 1 = runs on holidays (neither rule has a holiday exception), 2 = towable
// (§ 950-1200C: any vehicle parked in contravention of the chapter may be moved and stored), 4 = applies only while the
// switch is on (the declaration), 8 = closes both sides, 32 = a no parking rule, not a sweep (the page and the night push
// say "no parking").
export const SNOW_FLAGS = 15;
export const NIGHT_FLAGS = 35;
const monthsMask = (ms) => ms.reduce((m, x) => m | (1 << (x - 1)), 0);
// Street classes that carry parking: local streets, collectors and arterials. Expressways, ramps, lanes, trails, walkways
// and private or unbuilt roads are left out (counted in report.json).
export const STREET = new Set(['Local', 'Collector', 'Minor Arterial', 'Major Arterial']);

export const CITY = { id: 'toronto', name: 'Toronto', region: 'Ontario', tz: 'America/Toronto',
  center: [43.6588, -79.3925], zoom: 14 };   // downtown: the snow routes, every streetcar route among them
// Ontario's nine public holidays (HOLIDAYS_URL) plus the Civic Holiday, which the City also closes for. Neither rule stops
// for them (flag 1); listed for the time core.
export const HOLIDAYS_URL = 'https://www.ontario.ca/document/your-guide-employment-standards-act-0/public-holidays';
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-02-16': 'Family Day', '2026-04-03': 'Good Friday', '2026-05-18': 'Victoria Day',
  '2026-07-01': 'Canada Day', '2026-08-03': 'Civic Holiday', '2026-09-07': 'Labour Day', '2026-10-12': 'Thanksgiving',
  '2026-12-25': 'Christmas Day', '2026-12-26': 'Boxing Day',
  '2027-01-01': "New Year's Day", '2027-02-15': 'Family Day', '2027-03-26': 'Good Friday', '2027-05-24': 'Victoria Day',
  '2027-07-01': 'Canada Day', '2027-08-02': 'Civic Holiday', '2027-09-06': 'Labour Day', '2027-10-11': 'Thanksgiving',
  '2027-12-25': 'Christmas Day', '2027-12-26': 'Boxing Day',
};

// ---------- names ---------------------------------------------------------------------------------------------------------

// A street name in one form for matching the schedules' legal names ("St. Clair Avenue West", "Queen's Park") to the
// centreline's ("St Clair Avenue West", "Queen's Park"): capitals, no accents, periods or apostrophes, Saint as St, and a
// street type or direction the schedule shortened ("Roe Ave", "Armour Blvd") written out.
const TYPES = { AVE: 'AVENUE', AV: 'AVENUE', ST: 'STREET', RD: 'ROAD', DR: 'DRIVE', CRES: 'CRESCENT', BLVD: 'BOULEVARD', CRT: 'COURT',
  CT: 'COURT', PL: 'PLACE', TER: 'TERRACE', GDNS: 'GARDENS', GT: 'GATE', PKWY: 'PARKWAY', CIR: 'CIRCLE', SQ: 'SQUARE', HTS: 'HEIGHTS', GRV: 'GROVE' };
const DIRS_SHORT = { N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST' };
export const normName = (s) => {
  const w = String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase()
    .replace(/\((NY|TO|SC|ET|EY|YK)\)/g, '').replace(/[.'’`]/g, '').replace(/\bSAINT\b/g, 'ST').replace(/\s+/g, ' ').trim().split(' ');
  if (w.length > 2 && DIRS_SHORT[w[w.length - 1]]) w[w.length - 1] = DIRS_SHORT[w[w.length - 1]];
  const t = DIRS[w[w.length - 1]] && w.length > 2 ? w.length - 2 : w.length - 1;
  if (t > 0 && TYPES[w[t]]) w[t] = TYPES[w[t]];
  return w.join(' ');
};
// The tickets write streets short and spaced their own way ("MC CAUL ST", "ST DENNIS DR"): letters and digits only.
export const shortKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const bare = (k) => k.replace(/ (NORTH|SOUTH|EAST|WEST)$/, '');   // "LAKE SHORE BOULEVARD WEST" → "LAKE SHORE BOULEVARD"
// Edit distance, for the schedules' typos ("Shappard Avenue West", "Hysel Rroad")
export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const DIRS = { NORTH: [0, 1], SOUTH: [0, -1], EAST: [1, 0], WEST: [-1, 0], NORTHEAST: [1, 1], NORTHWEST: [-1, 1], SOUTHEAST: [1, -1], SOUTHWEST: [-1, -1] };
const DIR_WORDS = 'northeast|northwest|southeast|southwest|north|south|east|west';
const unit = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
export const dirVec = (w) => unit(DIRS[String(w || '').toUpperCase()] || [0, 0]);

/** A schedule's Highway field: the street (two names for one route: "Spadina Avenue and Spadina Crescent"), the former
 *  municipality when names repeat ("Duplex Avenue (NY)"), and the sides it names ("Maxwell Street (east side)", "Bob Yuill
 *  Drive, east and south sides"). */
export function parseHighway(h) {
  let s = String(h || '').replace(/\s+/g, ' ').trim(), qual = null, sides = null, leg = null;
  const take = (re, fn) => { s = s.replace(re, (...m) => { fn(...m); return ''; }).trim(); };
  take(/\((NY|TO|SC|ET|EY|YK)\)/i, (_, q) => { qual = q.toUpperCase(); });
  take(/[,(]\s*((?:(?:north|south|east|west)[, ]*(?:and\s+)?)+)sides?\s*\)?/i, (_, w) => { sides = w.toLowerCase().match(/north|south|east|west/g); });
  take(/[,(]\s*([^)]*\bleg)\s*\)?/i, (_, l) => { leg = l.toLowerCase(); });
  s = s.replace(/[,\s]+$/, '');
  return { names: s.split(/\s+and\s+/i).map((x) => x.trim()).filter(Boolean), qual, sides, leg };
}

/** One end of a schedule's "Between": a cross street ("Dell Park Avenue (east intersection)", "Haddington Avenue/Greer
 *  Road"), an end of the street ("the north end of Frivick Court"), or a point some metres along from one ("a point 38.1
 *  metres east of Westgrove Crescent"; "a point 150 metres east", "... north thereof": from the other end). A leg of a
 *  street ("the north/south leg of Flaming Roseway") is read but not placed. null when it says something else. */
export function parseEnd(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim().replace(/^and\s+/i, '').replace(/\s+and$/i, '').replace(/[.,;]+$/, '');
  let m;
  if ((m = /^(?:a )?point (?:opposite|at) (.+)$/i.exec(s))) return parseEnd(m[1]);
  m = new RegExp(`^(?:a )?point (\\d+(?:\\.\\d+)?) ?met(?:re|er)s?(?: (?:further|farther))?(?: (${DIR_WORDS})(?:erly)?)?(?: (?:i?of|from) | )?(.*)$`, 'i').exec(s);
  if (m) {
    const rest = m[3].trim(), rel = !rest || /^(thereof|further|farther)$/i.test(rest);
    const ref = rel ? null : parseEnd(rest);
    if (!rel && (!ref || ref.type === 'offset')) return null;
    return { type: 'offset', dist: +m[1], dir: m[2] ? m[2].toLowerCase() : null, ref, rel };
  }
  if ((m = new RegExp(`^(?:the )?(${DIR_WORDS})(?:erly)? (?:end|side)(?: of (.+))?$`, 'i').exec(s))) return { type: 'end', dir: m[1].toLowerCase(), street: m[2] || null };
  if (/\bleg\b/i.test(s)) return { type: 'leg', text: s };
  m = new RegExp(`^(.+?)\\s*\\((${DIR_WORDS}|middle|central) intersect(?:ion|on)\\)$`, 'i').exec(s);
  const which = m && !/middle|central/i.test(m[2]) ? m[2].toLowerCase() : null;
  const name = (m ? m[1] : s).trim();
  if (!name || /\d+(\.\d+)? ?met(re|er)s?/i.test(name)) return null;
  return { type: 'cross', names: name.split('/').map((x) => x.trim()).filter(Boolean), which };
}

/** A schedule's "Between": its two ends (and sides named there: "West and north side, between ..."), or the street's
 *  entire length. null when it can't be read. */
export function parseBetween(b) {
  let s = String(b || '').replace(/\s+/g, ' ').trim().replace(/\s+and$/i, ''), sides = null;
  s = s.replace(/^((?:(?:north|south|east|west)[, ]*(?:and\s+)?)+)sides?,?\s*between\s+/i, (_, w) => { sides = w.toLowerCase().match(/north|south|east|west/g); return ''; });
  if (/^(the )?entire length$/i.test(s)) return { entire: true, sides };
  const parts = s.split(/\s+and\s+(?:and\s+)?/i);
  for (let i = 1; i < parts.length; i++) {
    const a = parseEnd(parts.slice(0, i).join(' and ')), z = parseEnd(parts.slice(i).join(' and '));
    if (a && z && !(a.type === 'offset' && a.rel)) return { a, z, sides };
  }
  return null;
}

// ---------- geometry ------------------------------------------------------------------------------------------------------

const LAT0 = 43.7, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
export const xy = ([lo, la]) => [lo * KX, la * KY];
const dist = (a, b) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);
export const lineLength = (c) => { let l = 0; for (let i = 1; i < c.length; i++) l += dist(c[i - 1], c[i]); return l; };
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
/** The side of a street looking from its first point to its last: its compass name ("North", "Southeast"). */
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
// The outward normal of a side (L or R), as a unit vector in metres
function sideNormal(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), d = unit([b[0] - a[0], b[1] - a[1]]);
  return side === 'L' ? [-d[1], d[0]] : [d[1], -d[0]];
}
/** Which sides (L, R) of a segment a schedule's side words name ("east", "north and west"): for each word, the side whose
 *  outward normal points that way (within about 70 degrees). A street running north and south has no "north side". */
export function sidesNamed(c, words) {
  const out = [];
  for (const w of words) {
    const v = dirVec(w), dots = ['L', 'R'].map((side) => { const n = sideNormal(c, side); return n[0] * v[0] + n[1] * v[1]; });
    const side = dots[0] >= dots[1] ? 'L' : 'R';
    if (Math.max(...dots) > 0.34 && !out.includes(side)) out.push(side);
  }
  return out;
}
export function inRing(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function ringDistance(ring, p) {
  const [px, py] = xy(p);
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const [x1, y1] = xy(ring[i - 1]), [x2, y2] = xy(ring[i]), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - x1 - t * dx, py - y1 - t * dy));
  }
  return best;
}
/** The part of a line between `d0` and `d1` metres from its first point. */
export function subLine(c, d0, d1) {
  const out = [];
  let at = 0;
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  for (let i = 1; i < c.length; i++) {
    const d = dist(c[i - 1], c[i]), a = at, b = at + d;
    if (d > 0 && b >= d0 && a <= d1) {
      if (!out.length) out.push(lerp(c[i - 1], c[i], Math.max(0, (d0 - a) / d)));
      out.push(lerp(c[i - 1], c[i], Math.min(1, (d1 - a) / d)));
    }
    at = b;
  }
  return out.length >= 2 ? out : c;
}
/** The point halfway along a line. */
export function midpoint(c) {
  let half = lineLength(c) / 2;
  for (let i = 1; i < c.length; i++) {
    const d = dist(c[i - 1], c[i]);
    if (d && half <= d) { const t = half / d; return [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t]; }
    half -= d;
  }
  return c[c.length - 1];
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const r6p = ([lo, la]) => [r6(lo), r6(la)];
// Drop points within 0.25 m of the straight line between their neighbours (invisible at any zoom), 6 decimals.
export function simplify(c, tol = 0.25) {
  if (c.length <= 2) return c.map(r6p);
  const keep = [c[0]];
  for (let i = 1; i < c.length - 1; i++) {
    const a = xy(keep[keep.length - 1]), b = xy(c[i]), z = xy(c[i + 1]), dx = z[0] - a[0], dy = z[1] - a[1], l = Math.hypot(dx, dy);
    if (!l || Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / l > tol) keep.push(c[i]);
  }
  keep.push(c[c.length - 1]);
  return keep.map(r6p);
}

// ---------- the street graph ------------------------------------------------------------------------------------------------

/** The centreline as a graph: segments (blocks) between intersections, each with its names, class and line. */
export function buildGraph(features) {
  const segs = [], nodes = new Map(), byName = new Map(), at = new Map();
  const nodeOf = (id, p) => { let n = nodes.get(id); if (!n) nodes.set(id, n = { id, p, segs: [] }); return n; };
  for (const f of features) {
    const p = f.properties, g = f.geometry;
    if (!g || !Array.isArray(g.coordinates) || !g.coordinates.length) continue;
    const c = g.type === 'MultiLineString' ? g.coordinates[0] : g.coordinates;
    if (!c || c.length < 2) continue;
    const s = { i: segs.length, id: String(p.CENTRELINE_ID), key: normName(p.LINEAR_NAME_FULL_LEGAL), legal: p.LINEAR_NAME_FULL_LEGAL || '',
      name: p.LINEAR_NAME_FULL || '', cls: p.FEATURE_CODE_DESC || '', jur: p.JURISDICTION || '', a: p.FROM_INTERSECTION_ID, b: p.TO_INTERSECTION_ID,
      c, len: lineLength(c), p };
    segs.push(s);
    nodeOf(s.a, c[0]).segs.push(s.i);
    nodeOf(s.b, c[c.length - 1]).segs.push(s.i);
    if (!byName.has(s.key)) byName.set(s.key, []);
    byName.get(s.key).push(s.i);
  }
  // nodes by coordinates, for the schedules' intersection points (the same points to the millimetre)
  for (const n of nodes.values()) at.set(n.p[0].toFixed(6) + ',' + n.p[1].toFixed(6), n.id);
  return { segs, nodes, byName, at };
}
const other = (s, nid) => (s.a === nid ? s.b : s.a);
const ends = (G, si) => [G.segs[si].a, G.segs[si].b];

// ---------- placing a schedule entry -------------------------------------------------------------------------------------------

// Classes a street's route may run through (its own ramps and split branches included: Brown's Line reaches Lake Shore
// Boulevard West as a "Major Arterial Ramp"); only STREET classes become blocks.
const NOT_ROAD = new Set(['Trail', 'Walkway', 'River', 'Creek/Tributary', 'Major Railway', 'Minor Railway', 'Hydro Line', 'Major Shoreline',
  'Minor Shoreline (Land locked)', 'Geostatistical line', 'Ferry Route']);
const ROADS = { has: (cls) => !!cls && !NOT_ROAD.has(cls) };
// Streets the City renamed after the schedule was written: the schedule's name → the centreline's. By-law 1258-2024
// replaced Lower Coxwell Avenue with Emdaabiimok Avenue in Schedule XVII; Eastern Avenue's entry still ends at "Coxwell
// Avenue", which meets it as Emdaabiimok Avenue.
export const RENAMED = { 'COXWELL AVENUE': 'EMDAABIIMOK AVENUE' };
// The segments of a street by name (road classes, within `region` when given): the exact name; else the centreline's
// variants of it ("Bloor Street" for Bloor Street East and West); else, for a typo, the one name within two letters.
function streetSegs(G, name, region) {
  const k = normName(name), ok = (si) => ROADS.has(G.segs[si].cls) && (!region || region(G.segs[si]));
  const pick = (list) => new Set(list.filter(ok));
  let s = pick(G.byName.get(k) || []);
  if (s.size) return { segs: s, how: 'name' };
  s = pick([...G.byName].filter(([key]) => key.startsWith(k + ' ')).flatMap(([, l]) => l));
  if (s.size) return { segs: s, how: 'name' };
  const flat = k.replace(/ /g, '');
  const near = [...G.byName].filter(([key, l]) => key.length > 5 && (key.replace(/ /g, '') === flat || (k.length >= 8 && editDistance(key, k) <= 2)) && l.some(ok));
  if (near.length === 1) return { segs: pick(near[0][1]), how: `spelled "${near[0][0]}" on the centreline` };
  return { segs: new Set(), how: null };
}
// Does a centreline name match a schedule's cross street name (exact, a variant of it, a typo, or the direction dropped)?
function nameMatch(key, want) {
  if (key === want || key.startsWith(want + ' ')) return 'exact';
  if (key.replace(/ /g, '') === want.replace(/ /g, '')) return 'spacing';
  if (want.length >= 8 && editDistance(key, want) <= 2) return 'typo';
  if (bare(key) === bare(want) && bare(want) !== want) return 'direction';
  return null;
}
// Nodes of the street (pool) where a cross street meets it, best match first: by name (exact, a variant, spacing, a typo,
// the direction dropped, a renamed street), else a ramp to it ("Bayview N Bloor E Ramp" for Bloor Street), else the
// street's node nearest to it: within 40 m (a river, a station), 120 m for a dead end (Vaughan Road stops short of
// Eglinton Avenue West), or 200 m for a cross street that stops short of the street (Labatt Avenue, a block from Bayview
// Avenue), noted in the report as placed by the nearest point.
function crossNodes(G, pool, names) {
  const want = names.map(normName);
  const all = [...want, ...want.filter((w) => RENAMED[w]).map((w) => RENAMED[w])];
  const rank = { exact: 0, spacing: 1, typo: 2, direction: 3, renamed: 4 };
  let best = 9, hits = new Set();
  for (const si of pool) for (const nid of ends(G, si)) for (const sj of G.nodes.get(nid).segs) {
    if (pool.has(sj)) continue;
    for (const w of all) {
      let m = nameMatch(G.segs[sj].key, w);
      if (m && !want.includes(w)) m = 'renamed';
      if (!m) continue;
      if (rank[m] < best) { best = rank[m]; hits = new Set(); }
      if (rank[m] === best) hits.add(nid);
    }
  }
  if (hits.size) return { nodes: hits, how: best === 0 ? null : ['', 'spacing', 'a typo', 'the direction', 'its new name'][best] };
  const word = (w) => w.split(' ').find((x) => x.length > 3 && !['THE', 'AVENUE', 'STREET', 'ROAD'].includes(x));
  for (const si of pool) for (const nid of ends(G, si)) for (const sj of G.nodes.get(nid).segs) {
    const s = G.segs[sj];
    if (/Ramp/.test(s.cls) && want.some((w) => word(w) && s.key.split(' ').includes(word(w)))) hits.add(nid);
  }
  if (hits.size) return { nodes: hits, how: 'a ramp to it' };
  const far = want.flatMap((w) => G.byName.get(w) || []);
  const deg = new Map();
  for (const si of pool) for (const nid of ends(G, si)) deg.set(nid, (deg.get(nid) || 0) + 1);
  let near = null, bd = Infinity;
  for (const [nid, d] of deg) {
    const p = G.nodes.get(nid).p, lim = d === 1 && G.nodes.get(nid).segs.length === 1 ? 120 : 40;
    for (const sj of far) for (const q of G.segs[sj].c) { const x = dist(p, q); if (x < lim && x < bd) { bd = x; near = nid; } }
  }
  if (near == null) for (const [nid] of deg) {
    const p = G.nodes.get(nid).p;
    for (const sj of far) for (const q of G.segs[sj].c) { const x = dist(p, q); if (x < 200 && x < bd) { bd = x; near = nid; } }
  }
  return { nodes: near != null ? new Set([near]) : new Set(), how: near != null ? `the nearest point (${Math.round(bd)} m)` : null };
}
// The extreme node in a direction (north: the largest latitude, northeast: the largest x + y)
function extreme(G, ids, dir) {
  const v = dirVec(dir);
  let best = null, bv = -Infinity;
  for (const nid of ids) { const [x, y] = xy(G.nodes.get(nid).p), s = x * v[0] + y * v[1]; if (s > bv) { bv = s; best = nid; } }
  return best;
}
// The ends of a street: its nodes with one of its segments (a dead end, or where it meets another street)
function streetEnds(G, pool) {
  const deg = new Map();
  for (const si of pool) for (const nid of ends(G, si)) deg.set(nid, (deg.get(nid) || 0) + 1);
  return [...deg].filter(([, d]) => d === 1).map(([nid]) => nid);
}
// Shortest route along the street between two node sets (Dijkstra by length). Only where the street has no route between
// them (interrupted by a park or a ravine, or another name for a stretch) may it jump to another piece of it within 500 m.
// { steps: [{ si, from } | { jump, from, to, len }], start, end } or null.
function route(G, pool, A, Z) {
  return routeWith(G, pool, A, Z, false) || routeWith(G, pool, A, Z, true);
}
function routeWith(G, pool, A, Z, jumps) {
  const nodes = jumps ? [...new Set([...pool].flatMap((si) => ends(G, si)))] : [];
  const bestD = new Map(), prev = new Map(), done = new Set(), targets = new Set(Z), queue = [];
  for (const nid of A) { bestD.set(nid, 0); queue.push([0, nid]); }
  while (queue.length) {
    let k = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[k][0]) k = i;
    const [d, nid] = queue.splice(k, 1)[0];
    if (done.has(nid)) continue;
    done.add(nid);
    if (targets.has(nid)) {
      const steps = [];
      for (let cur = nid; prev.has(cur); ) { const st = prev.get(cur); steps.unshift(st); cur = st.from; }
      return { steps, start: steps.length ? steps[0].from : nid, end: nid };
    }
    const relax = (to, nd, st) => { if (nd < (bestD.get(to) ?? Infinity)) { bestD.set(to, nd); prev.set(to, st); queue.push([nd, to]); } };
    for (const si of G.nodes.get(nid).segs) if (pool.has(si)) relax(other(G.segs[si], nid), d + G.segs[si].len, { si, from: nid });
    const p = G.nodes.get(nid).p;
    for (const to of nodes) {
      if (to === nid) continue;
      const j = dist(p, G.nodes.get(to).p);
      if (j <= 500 && j > 1) relax(to, d + 3 * j, { jump: true, from: nid, to, len: j });
    }
  }
  return null;
}
const stepLen = (G, st) => (st.jump ? st.len : G.segs[st.si].len);
const stepLine = (G, st) => (st.jump ? [G.nodes.get(st.from).p, G.nodes.get(st.to).p] : G.segs[st.si].a === st.from ? G.segs[st.si].c : [...G.segs[st.si].c].reverse());
// The direction a run of steps leaves its first node in (its first 25 m), as a unit vector
function heading(G, steps) {
  const pts = steps.flatMap((st) => stepLine(G, st));
  if (pts.length < 2) return [0, 0];
  let i = 1, d = 0;
  while (i < pts.length - 1 && d + dist(pts[i - 1], pts[i]) < 25) { d += dist(pts[i - 1], pts[i]); i++; }
  const a = xy(pts[0]), b = xy(pts[i]);
  return unit([b[0] - a[0], b[1] - a[1]]);
}
// Follow the street from a node for `metres`, keeping as straight as it goes (or in the direction `dirv` at the first
// node), never onto `avoid`. [{ si, from }].
function follow(G, pool, nid, dirv, metres, avoid) {
  const out = [], used = new Set(avoid);
  let cur = nid, want = dirv, left = metres;
  for (let guard = 0; left > 0 && guard < 60; guard++) {
    let best = null, bs = -Infinity;
    for (const si of G.nodes.get(cur).segs) {
      if (!pool.has(si) || used.has(si)) continue;
      const h = heading(G, [{ si, from: cur }]), s = h[0] * want[0] + h[1] * want[1];
      if (s > bs) { bs = s; best = si; }
    }
    if (best == null || (want[0] || want[1]) && bs < -0.3) break;
    out.push({ si: best, from: cur });
    used.add(best);
    const line = stepLine(G, { si: best, from: cur }), n = line.length;
    const a = xy(line[Math.max(0, n - 2)]), b = xy(line[n - 1]);
    want = unit([b[0] - a[0], b[1] - a[1]]);
    left -= G.segs[best].len;
    cur = other(G.segs[best], cur);
  }
  return out;
}

/** Place a schedule entry ({ Highway, Between, geo }) on the centreline. `region` limits the street to an area (Schedule
 *  IV is the former North York's). { ok: true, segs: Map(si → { frac, sides }), notes: [...] } or { ok: false, why }. */
export function placeEntry(G, entry, region) {
  const hw = parseHighway(entry.Highway), between = parseBetween(entry.Between), notes = [];
  if (!between) return { ok: false, why: 'limits not read' };
  const pool = new Set();
  for (const n of hw.names) { const r = streetSegs(G, n, region); for (const si of r.segs) pool.add(si); if (r.how && r.how !== 'name') notes.push(r.how); }
  if (!pool.size) return { ok: false, why: 'street not on the centreline' };
  if (hw.leg) notes.push(`"${hw.leg}": the whole street`);
  const sides = hw.sides || between.sides;
  const out = new Map();
  // a segment covered (`frac` of it), its sides by the direction of the part covered (`part`, in the segment's own direction)
  const put = (si, frac, part) => {
    const sd = sides ? sidesNamed(part || G.segs[si].c, sides) : ['L', 'R'];
    if (!sd.length) return;
    const o = out.get(si);
    if (!o) out.set(si, { frac, sides: sd });
    else { o.frac = Math.max(o.frac, frac); for (const x of sd) if (!o.sides.includes(x)) o.sides.push(x); }
  };
  if (between.entire) { for (const si of pool) put(si, 1); return { ok: true, segs: out, notes: [...notes, 'entire street'] }; }

  // The schedule's intersection points: nodes of the street, each with the cross street the point names
  const geo = (entry.geo || []).map((g) => {
    let id = G.at.get(g.lon.toFixed(6) + ',' + g.lat.toFixed(6));
    if (id == null || ![...pool].some((si) => G.segs[si].a === id || G.segs[si].b === id)) {
      id = null; let bd = 25;
      for (const si of pool) for (const nid of ends(G, si)) { const d = dist(G.nodes.get(nid).p, [g.lon, g.lat]); if (d < bd) { bd = d; id = nid; } }
    }
    return { to: normName(g.to), id };
  }).filter((g) => g.id != null);
  // An end's anchor nodes (never the other end's, `not`)
  const anchor = (e, not = new Set()) => {
    if (e.type === 'leg') return null;
    if (e.type === 'offset') return e.ref ? anchor(e.ref, not) : null;
    if (e.type === 'end') {
      // the end of another street, where it is on this one; else (most often the schedule naming the wrong street) this one's
      let own = pool;
      if (e.street && hw.names.every((n) => normName(n) !== normName(e.street))) {
        const r = streetSegs(G, e.street, region), poolNodes = new Set([...pool].flatMap((si) => ends(G, si)));
        if (r.segs.size && streetEnds(G, r.segs).some((nid) => poolNodes.has(nid))) own = r.segs;
        else notes.push(`"the ${e.dir} end of ${e.street}": this street's end`);
      }
      // the street's ends, a true dead end first (no other road there), else where it meets another street
      const cands = streetEnds(G, own).filter((nid) => !not.has(nid));
      const dead = cands.filter((nid) => G.nodes.get(nid).segs.filter((sj) => ROADS.has(G.segs[sj].cls)).length === 1);
      const all = [...new Set([...own].flatMap((si) => ends(G, si)))].filter((nid) => !not.has(nid));
      const pick = extreme(G, dead.length ? dead : cands.length ? cands : all, e.dir);
      return pick != null ? new Set([pick]) : null;
    }
    const r = crossNodes(G, pool, e.names);
    let ids = r.nodes;
    if (r.how) notes.push(`${e.names.join('/')} matched by ${r.how}`);
    // prefer the schedule's own points where they name this cross street
    const g = geo.filter((x) => e.names.some((n) => { const w = normName(n); return x.to && (w.startsWith(x.to.split(' ')[0] + ' ') || w === x.to); }) && (!ids.size || ids.has(x.id)));
    if (g.length && !e.which) ids = new Set(g.map((x) => x.id));
    if (!ids.size) return null;
    if (e.which && ids.size > 1) return new Set([extreme(G, [...ids], e.which)]);
    return ids;
  };
  const { a, z } = between;
  const zRel = z.type === 'offset' && z.rel;
  // a street's end is found last, so it is never the other end's node
  let A, Z;
  if (a.type === 'end' && z.type !== 'end' && !zRel) { Z = anchor(z); A = anchor(a, Z || new Set()); }
  else { A = anchor(a); Z = zRel ? null : anchor(z, A || new Set()); }
  // an end not found by name: the schedule's point for it, when one is left over
  const spare = (taken) => geo.filter((g) => !taken || !taken.has(g.id));
  if (!A && a.type !== 'leg' && !(a.type === 'offset' && !a.ref)) { const s = spare(Z); if (s.length === 1 || (s.length && !Z)) { A = new Set([s[0].id]); notes.push('first end from the schedule\'s point'); } }
  if (!Z && z.type !== 'leg' && !zRel) { const s = spare(A); if (s.length) { Z = new Set([s[s.length - 1].id]); notes.push('second end from the schedule\'s point'); } }
  if (a.type === 'leg' || z.type === 'leg') return { ok: false, why: 'a leg of a street (not placed)' };
  if (!A) return { ok: false, why: `first end not found (${entry.Between.split(/ and /i)[0]})` };
  if (!Z && !zRel) return { ok: false, why: `second end not found (${entry.Between.split(/ and /i).slice(1).join(' and ')})` };

  // The line: the route between the anchors, extended 600 m past each along the street, measured from the first anchor
  let r;
  if (Z) {
    // the same cross street at both ends with the qualifiers wrong or missing ("Betty Ann Drive and Betty Ann Drive", "(west
    // intersection) and (west intersection)"): a crescent between its two corners on it
    if (a.type === 'cross' && z.type === 'cross' && A.size === 1 && Z.size === 1 && [...A][0] === [...Z][0]
      && a.names.join() === z.names.join()) { const both = crossNodes(G, pool, a.names).nodes; if (both.size > 1) { A = both; Z = both; notes.push('the same corner twice: the crescent between its corners'); } }
    // two cross streets meeting at one corner of the street: the ends are different corners
    const A2 = new Set([...A].filter((n) => !Z.has(n))), Z2 = new Set([...Z].filter((n) => !A.has(n)));
    if (A2.size && Z2.size) { A = A2; Z = Z2; } else if (A2.size) A = A2; else if (Z2.size) Z = Z2;
    if ([...A].every((n) => Z.has(n)) && A.size > 1) {
      // one set of corners for both ends (a crescent on one cross street): the shortest route between two different ones
      let bestR = null;
      for (const x of A) for (const y of Z) {
        if (x === y) continue;
        const rr = route(G, pool, new Set([x]), new Set([y]));
        const len = rr ? rr.steps.reduce((s, st) => s + stepLen(G, st), 0) : Infinity;
        if (rr && (!bestR || len < bestR.len)) bestR = { rr, len };
      }
      r = bestR && bestR.rr;
    } else r = route(G, pool, A, Z);
    if (!r) return { ok: false, why: 'no route along the street between the ends' };
  }
  else r = { steps: [], start: [...A][0], end: [...A][0] };
  if (r.steps.some((st) => st.jump)) notes.push('the street is interrupted: jumped a gap');
  const core = r.steps, inCore = new Set(core.filter((st) => !st.jump).map((st) => st.si));
  const coreLen = core.reduce((s, st) => s + stepLen(G, st), 0);
  const h0 = core.length ? heading(G, core) : null;
  // back from the first anchor: against the route, else against the end's own direction (none: [0, 0])
  const backDir = h0 ? [-h0[0], -h0[1]] : dirVec(a.dir);
  const before = follow(G, pool, r.start, backDir, 600, inCore);
  // on from the last anchor: the route's last heading, else away from `before`
  let h1 = [0, 0];
  if (core.length) { const last = stepLine(G, core[core.length - 1]), n = last.length, p = xy(last[n - 2]), q = xy(last[n - 1]); h1 = unit([q[0] - p[0], q[1] - p[1]]); }
  else if (before.length) { const hb = heading(G, before); h1 = [-hb[0], -hb[1]]; }
  const after = follow(G, pool, r.end, h1, 600, new Set([...inCore, ...before.map((st) => st.si)]));
  const beforeLen = before.reduce((s, st) => s + stepLen(G, st), 0);
  // the whole line in order, from the far end of `before` to the far end of `after`; position 0 = the first anchor
  const line = [...before.slice().reverse().map((st) => ({ si: st.si, from: other(G.segs[st.si], st.from) })), ...core, ...after];
  // which way along the line a compass direction goes, at a position (by the line's heading there)
  const sense = (pos, dir) => {
    let at = -beforeLen;
    for (const st of line) {
      const L = stepLen(G, st);
      if (pos <= at + L + 1e-6 || st === line[line.length - 1]) { const h = heading(G, [st]), v = dirVec(dir); const d = h[0] * v[0] + h[1] * v[1]; return d >= 0 ? 1 : -1; }
      at += L;
    }
    return 1;
  };
  const posOf = (e, anchorPos, otherPos) => {
    if (e.type !== 'offset') return anchorPos;
    if (!e.dir) { notes.push('a point with no direction: placed at its cross street'); return anchorPos; }
    const base = e.rel ? otherPos : anchorPos;
    return base + sense(base, e.dir) * e.dist;
  };
  const pa = posOf(a, 0, null);
  const pz = Z ? posOf(z, coreLen, pa) : posOf(z, 0, pa);
  let from = Math.min(pa, pz), to = Math.max(pa, pz);
  if (to - from < 0.5) return { ok: false, why: 'the points leave nothing between them' };
  if (from < -beforeLen - 1 || to > coreLen + after.reduce((s, st) => s + stepLen(G, st), 0) + 1) notes.push('a point past where the street goes');
  let at = -beforeLen;
  for (const st of line) {
    const L = stepLen(G, st), s0 = Math.max(from, at), s1 = Math.min(to, at + L);
    if (!st.jump && s1 > s0 && L > 0) {
      // the covered part in the segment's own direction (the step may run it backwards)
      const fwd = G.segs[st.si].a === st.from, d0 = fwd ? s0 - at : L - (s1 - at), d1 = fwd ? s1 - at : L - (s0 - at);
      put(st.si, (s1 - s0) / L, subLine(G.segs[st.si].c, d0, d1));
    }
    at += L;
  }
  if (!out.size) return { ok: false, why: 'nothing on the named side' };
  return { ok: true, segs: out, notes };
}

// ---------- the schedules file -----------------------------------------------------------------------------------------------

/** Read a JSON file of the shape {"...":..., "value":[{record},{record},...]} one record at a time (the schedules file is
 *  0.8 GB, past what one string can hold): calls keep(text) with each record's raw text and parses those it keeps. */
export async function eachRecord(file, keep, onRecord) {
  let depth = 0, inStr = false, esc = false, open = false, parts = [];
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 22 })) {
    let from = 0;
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (inStr) { if (esc) esc = false; else if (ch === 92) esc = true; else if (ch === 34) inStr = false; continue; }
      if (ch === 34) { inStr = true; continue; }
      if (ch === 123 || ch === 91) { depth++; if (depth === 3 && ch === 123) { open = true; from = i; parts = []; } continue; }
      if (ch === 125 || ch === 93) {
        depth--;
        if (depth === 2 && ch === 125 && open) {
          parts.push(chunk.subarray(from, i + 1));
          const text = Buffer.concat(parts).toString('utf8');
          open = false; parts = [];
          if (keep(text)) onRecord(JSON.parse(text));
        }
      }
    }
    if (open) parts.push(chunk.subarray(from));
  }
  if (depth !== 0) throw new Error(`${file}: the file ended inside a record (depth ${depth}): a truncated download?`);
}

const SCHEDULES = { '950-04': 'night', '950-17A': 'snow' };
/** A schedule record → the fields the build uses (never the record's owner or staff fields). */
export function scheduleEntry(r) {
  const t = Object.fromEntries((r.tableData || []).map((x) => [x.key, x.value]));
  return { id: r.id, schedule: r.templateId, Highway: t.Highway || '', Between: t.Between || '',
    status: r.latestRegulationActionByStatus || 'In force', bylaw: r.latestRegulationActionByLaw || null,
    effective: r.latestRegulationActionEffectiveDate || null, expiry: r.latestRegulationActionExpiryDate || null,
    geo: (r.geoData || []).map((g) => ({ to: g.to || '', lat: +g.lat, lon: +g.lon })).filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon)) };
}
/** In force on a date: not repealed, in effect, not expired. */
export const inForce = (e, today) => e.status !== 'Repealed' && (!e.effective || e.effective <= today) && (!e.expiry || e.expiry > today);

// ---------- fetching ------------------------------------------------------------------------------------------------------

async function resourceUrl(input) {
  const r = await fetch(`${CKAN}/api/3/action/package_show?id=${input.pkg}`, { headers: { 'User-Agent': 'curb-city-build (+https://curb.guide)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for the ${input.pkg} package`);
  const res = (await r.json()).result.resources.find((x) => input.resource.test(x.name) || input.resource.test(x.url));
  if (!res) throw new Error(`${input.pkg}: no resource matching ${input.resource}: the City's data changed shape`);
  return res.url;
}
// The cached copy of an input, downloaded (streamed to disk) on the first run or with --refresh.
async function cachedInput(input) {
  const f = CACHE + input.file;
  if (!REFRESH && fs.existsSync(f)) return f;
  const url = await resourceUrl(input);
  log(`fetching ${input.what}…`);
  fs.mkdirSync(f.replace(/[^/]*$/, ''), { recursive: true });
  const r = await fetch(url, { headers: { 'User-Agent': 'curb-city-build (+https://curb.guide)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(f + '.part'));
  fs.renameSync(f + '.part', f);
  return f;
}
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const fetchedOn = (f) => new Date(fs.statSync(f).mtimeMs).toISOString().slice(0, 10);

// The two schedules, cut from the 0.8 GB file once (bylaw-schedules-slim.json, refreshed with it)
async function schedules() {
  const raw = await cachedInput(INPUTS.schedules);
  const slim = CACHE + 'bylaw-schedules-slim.json';
  if (!REFRESH && fs.existsSync(slim) && fs.statSync(slim).mtimeMs >= fs.statSync(raw).mtimeMs) return { entries: readJSON(slim), raw };
  log('reading the by-law schedules (0.8 GB)…');
  const out = [];
  let records = 0;
  await eachRecord(raw, (text) => { records++; return /"templateId":"950-(04|17A)"/.test(text); }, (r) => out.push(scheduleEntry(r)));
  const fd = fs.openSync(raw, 'r'), buf = Buffer.alloc(200);
  fs.readSync(fd, buf, 0, 200, 0);
  fs.closeSync(fd);
  const m = /"@odata\.count":(\d+)/.exec(buf.toString('utf8'));
  if (!m || +m[1] !== records) throw new Error(`the schedules file says ${m ? m[1] : 'no'} records, ${records} read: a truncated download or a new shape?`);
  fs.writeFileSync(slim, JSON.stringify(out));
  return { entries: out, raw };
}

// ---------- the tickets cross-check --------------------------------------------------------------------------------------------

// A CSV line → fields (quoted fields with "" escapes)
export function csvFields(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
export const TICKET_CODES = { night: ['28'], snow: ['94', '95', '220', '222', '223', '224'] };
/** A ticket's address ("390 SENTINEL RD") → { number, key } or null. */
export function ticketAddress(loc2) {
  const m = /^(\d+)[A-Z]?\s+(.+)$/.exec(String(loc2 || '').trim().toUpperCase());
  return m ? { number: +m[1], key: shortKey(m[2]) } : null;
}

// ---------- the build -----------------------------------------------------------------------------------------------------------

export async function build() {
  const today = new Date().toISOString().slice(0, 10);
  const tclFile = await cachedInput(INPUTS.centreline), fmFile = await cachedInput(INPUTS.municipalities);
  const { entries, raw: schedFile } = await schedules();
  const tcl = readJSON(tclFile).features, fm = readJSON(fmFile).features;
  // shape checks: fail loudly when the City's data changes
  const need = ['CENTRELINE_ID', 'LINEAR_NAME_FULL', 'LINEAR_NAME_FULL_LEGAL', 'FROM_INTERSECTION_ID', 'TO_INTERSECTION_ID', 'FEATURE_CODE_DESC',
    'JURISDICTION', 'LO_NUM_L', 'HI_NUM_L', 'LO_NUM_R', 'HI_NUM_R', 'PARITY_L', 'PARITY_R'];
  const miss = need.filter((k) => !tcl[0] || !(k in tcl[0].properties));
  if (miss.length) throw new Error(`Toronto Centreline: the City's data changed shape, missing ${miss.join(', ')}`);
  if (tcl.length < 50000 || tcl.length > 90000) throw new Error(`${tcl.length} centreline segments: expected 50,000 to 90,000`);
  const nyF = fm.find((f) => f.properties && f.properties.AREA_NAME === 'NORTH YORK');
  if (!nyF || nyF.geometry.type !== 'MultiPolygon') throw new Error('Former Municipality Boundaries: no NORTH YORK polygon');
  const counts = entries.reduce((m, e) => (m[e.schedule] = (m[e.schedule] || 0) + 1, m), {});
  if (!(counts['950-04'] >= 2000 && counts['950-04'] <= 4000)) throw new Error(`Schedule IV has ${counts['950-04']} entries: expected 2,000 to 4,000`);
  if (!(counts['950-17A'] >= 100 && counts['950-17A'] <= 400)) throw new Error(`Schedule XVII-A has ${counts['950-17A']} entries: expected 100 to 400`);
  if (entries.some((e) => !e.Highway || !e.Between)) throw new Error('a schedule entry has no Highway or Between: the City\'s data changed shape');
  log(`${tcl.length} centreline segments, Schedule IV ${counts['950-04']} entries, Schedule XVII-A ${counts['950-17A']}`);

  const G = buildGraph(tcl);
  const nyRing = nyF.geometry.coordinates[0][0];
  const muni = fm.map((f) => ({ name: f.properties.AREA_NAME, ring: f.geometry.coordinates[0][0] }));
  const mids = new Map();
  const midOf = (s) => { let m = mids.get(s.i); if (!m) mids.set(s.i, m = midpoint(s.c)); return m; };
  // North York: a segment whose midpoint is inside it, or within 15 m of its boundary (the boundary streets)
  const inNY = (s) => inRing(nyRing, midOf(s)) || ringDistance(nyRing, midOf(s)) < 15;
  const muniOf = (s) => { const m = midOf(s); const f = muni.find((x) => inRing(x.ring, m)); return f ? f.name : null; };

  // ---- place every entry ----
  const placed = { night: [], snow: [] };
  for (const e of entries) {
    const kind = SCHEDULES[e.schedule];
    placed[kind].push({ e, r: placeEntry(G, e, kind === 'night' ? inNY : null), live: inForce(e, today) });
  }
  for (const e of CITY_LIST_ONLY) placed.snow.push({ e, r: placeEntry(G, e, null), live: true, cityList: true });
  return { G, placed, inNY, muniOf, midOf, entries, today, tcl, nyRing, files: { tclFile, fmFile, schedFile } };
}
// Snow routes on the City's own list (the Schedule XVII-A extract linked from its snow event page, current to December 31,
// 2025) that the dataset marks repealed: kept, as the City's page still lists them. The dataset's records: "Lower Coxwell
// Avenue" repealed by 1258-2024, and its new name "Emdaabiimok Avenue ... [PURGE]".
export const CITY_LIST_ONLY = [
  { id: 'city-list-lower-coxwell', schedule: '950-17A', Highway: 'Emdaabiimok Avenue', Between: 'Eastern Avenue and Queen Street East', status: 'In force',
    bylaw: null, effective: null, expiry: null, geo: [], note: 'On the City\'s list as "Lower Coxwell Avenue, Eastern Avenue and Queen Street East"; the dataset marks it repealed (1258-2024) and its new name purged' },
];

// A block side a placed entry covers: half the block or more (a schedule's limits can stop mid block).
const HALF = 0.5;
const sideKeys = (r) => (r.ok ? [...r.segs].filter(([, v]) => v.frac >= HALF).flatMap(([si, v]) => v.sides.map((sd) => si + sd)) : []);
const label = (e) => `${e.Highway}, ${e.Between}`;

/** From the placed entries, the rule on every block side: the snow routes (in force Schedule XVII-A entries, both sides) and
 *  the North York ban (every City street of the former North York, less the sides Council took off Schedule IV: covered by a
 *  repealed entry and by no entry in force). Also what the report says about it. */
export function assemble({ G, placed, inNY, muniOf, midOf, nyRing }) {
  const street = (s) => STREET.has(s.cls);
  // snow routes
  const snow = new Set();
  for (const x of placed.snow) if (x.live) for (const k of sideKeys(x.r)) if (street(G.segs[+k.slice(0, -1)])) snow.add(k);
  // Schedule IV: sides listed in force, and sides of repealed entries
  const listed = new Map(), repealed = new Map();
  for (const x of placed.night) for (const k of sideKeys(x.r)) {
    const m = x.live ? listed : repealed;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x.e);
  }
  // the former North York's City streets; a street on its boundary only where Schedule IV lists it
  const leftOut = {}, out1 = (why) => { leftOut[why] = (leftOut[why] || 0) + 1; };
  const nySides = new Set(), boundary = [];
  for (const s of G.segs) {
    if (!inNY(s)) continue;
    if (!street(s)) { out1(`class ${s.cls || 'none'}`); continue; }
    if (s.jur !== 'CITY OF TORONTO') { out1(`jurisdiction ${s.jur || 'none'}`); continue; }
    const inside = inRing(nyRing, midOf(s));
    for (const sd of ['L', 'R']) {
      const k = s.i + sd;
      if (!inside && !listed.has(k)) { boundary.push(k); continue; }
      nySides.add(k);
    }
  }
  // exemptions: a side a repealed entry covered that no entry in force covers
  const exempt = new Map();
  for (const [k, es] of repealed) if (nySides.has(k) && !listed.has(k)) exempt.set(k, es);
  const night = new Set([...nySides].filter((k) => !exempt.has(k)));
  return { snow, night, listed, repealed, exempt, nySides, boundary, leftOut };
}

// The cross street at a block's end: another street meeting it there, else (the same street continues, or a lane) the next
// corner along it. '' at a dead end.
function crossAt(G, s, nid, depth = 0) {
  const n = G.nodes.get(nid);
  const names = n.segs.map((sj) => G.segs[sj]).filter((o) => o.key !== s.key && STREET.has(o.cls) && o.name).map((o) => o.name);
  if (names.length) return names[0];
  if (depth > 8) return '';
  const next = n.segs.map((sj) => G.segs[sj]).find((o) => o.i !== s.i && o.key === s.key && STREET.has(o.cls));
  return next ? crossAt(G, next, other(next, nid), depth + 1) : '';
}
const parity = (v) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x > 0 ? x % 2 : null; };
/** The side with odd house numbers: the centreline's parity fields, else the numbers; one numbered side gives the other. */
export function oddSide(p) {
  const l = p.PARITY_L === 'O' ? 1 : p.PARITY_L === 'E' ? 0 : parity(p.LO_NUM_L);
  const r = p.PARITY_R === 'O' ? 1 : p.PARITY_R === 'E' ? 0 : parity(p.LO_NUM_R);
  if (l === 1 && r !== 1) return 'L';
  if (r === 1 && l !== 1) return 'R';
  if (l === 0 && r == null) return 'R';
  if (r === 0 && l == null) return 'L';
  return null;
}
const MUNI_NAMES = { 'NORTH YORK': 'North York', TORONTO: 'Old Toronto', YORK: 'York', 'EAST YORK': 'East York', ETOBICOKE: 'Etobicoke', SCARBOROUGH: 'Scarborough' };

/** The season's dates, in two lists of under 96 (a saved alert keeps 96 dates a rule). */
export function snowDates(from = SNOW.from, to = SNOW.to) {
  const all = [];
  for (let t = Date.parse(from + 'T12:00:00Z'); t <= Date.parse(to + 'T12:00:00Z'); t += 864e5) all.push(new Date(t).toISOString().slice(0, 10));
  const half = Math.ceil(all.length / 2);
  return { snow1: all.slice(0, half), snow2: all.slice(half) };
}
export const snowRules = () => [[-1, SNOW.start, SNOW.end, 0, 0, SNOW_FLAGS, 'snow1'], [-1, SNOW.start, SNOW.end, 0, 0, SNOW_FLAGS, 'snow2']];
export const nightRules = () => [0, 1, 2, 3, 4, 5, 6].map((d) => [d, NIGHT.start, NIGHT.end, 31, monthsMask(NIGHT.months), NIGHT_FLAGS]);

/** The blocks of segments.json: every segment with a rule on a side. */
export function blocks(G, { snow, night }, muniOf) {
  const byBlock = new Map();
  for (const k of [...snow, ...night]) { const si = +k.slice(0, -1); if (!byBlock.has(si)) byBlock.set(si, new Set()); byBlock.get(si).add(k.slice(-1)); }
  const out = [];
  for (const [si, sides] of byBlock) {
    const s = G.segs[si], p = s.p;
    const nums = ['LO_NUM_L', 'HI_NUM_L', 'LO_NUM_R', 'HI_NUM_R'].map((k) => Math.round(Number(p[k]))).filter((v) => v > 0);
    const o = oddSide(p);
    const cross = [crossAt(G, s, s.a), crossAt(G, s, s.b)].filter(Boolean);
    const m = muniOf(s);
    out.push({ c: s.id, s: s.name, l: [...new Set(cross)].join(' - '), ...(m ? { h: MUNI_NAMES[m] || m } : {}),
      ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}), ...(o ? { o } : {}),
      g: simplify(s.c),
      d: ['L', 'R'].filter((sd) => sides.has(sd)).map((sd) => [sd, compass(s.c, sd),
        [...(snow.has(si + sd) ? snowRules() : []), ...(night.has(si + sd) ? nightRules() : [])]]) });
  }
  out.sort((x, y) => x.s.localeCompare(y.s, 'en', { numeric: true }) || (x.n ? x.n[0] : 0) - (y.n ? y.n[0] : 0) || x.c.localeCompare(y.c, 'en', { numeric: true }));
  return out;
}

/** Last winter's tickets on the map: of the 2025 North York ban and snow route tickets, how many land on a block side with
 *  that rule (by address: house number and street, on the centreline's address ranges). */
export async function ticketCheck(G, sets, file) {
  const dir = CACHE + 'tickets/';
  const csvIn = () => fs.readdirSync(dir).find((f) => /^Parking_Tags_Data_2025.*\.csv$/i.test(f));
  if (!csvIn()) execFileSync('unzip', ['-o', '-q', file, '-d', dir]);
  const name = csvIn();
  if (!name) throw new Error('the 2025 tickets archive holds no Parking_Tags_Data_2025 CSV: the City\'s data changed shape');
  // address ranges by street: key → [{ si, lo, hi, parity, side }]
  const idx = new Map();
  for (const s of G.segs) {
    if (!STREET.has(s.cls)) continue;
    const k = shortKey(s.name);
    for (const sd of ['L', 'R']) {
      const lo = Number(s.p['LO_NUM_' + sd]), hi = Number(s.p['HI_NUM_' + sd]);
      if (!(lo > 0 && hi > 0)) continue;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push({ si: s.i, lo: Math.min(lo, hi), hi: Math.max(lo, hi), odd: lo % 2, side: sd });
    }
  }
  const find = (a) => (idx.get(a.key) || []).find((x) => a.number >= x.lo && a.number <= x.hi && a.number % 2 === x.odd) || null;
  const res = { night: { tickets: 0, placed: 0, onRule: 0, onListed: 0, onExempt: 0, outside: 0, hours: {}, months: {}, exemptExamples: {} },
    snow: { tickets: 0, placed: 0, onRule: 0, dates: {}, offExamples: {} } };
  const rl = readline.createInterface({ input: fs.createReadStream(dir + name, { encoding: 'utf8' }), crlfDelay: Infinity });
  let head = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const f = csvFields(line);
    if (!head) { head = Object.fromEntries(f.map((k, i) => [k.trim(), i])); for (const k of ['INFRACTION_CODE', 'DATE_OF_INFRACTION', 'TIME_OF_INFRACTION', 'LOCATION1', 'LOCATION2']) if (!(k in head)) throw new Error(`tickets: no ${k} column: the City's data changed shape`); continue; }
    const code = f[head.INFRACTION_CODE], kind = TICKET_CODES.night.includes(code) ? 'night' : TICKET_CODES.snow.includes(code) ? 'snow' : null;
    if (!kind) continue;
    const r = res[kind], date = f[head.DATE_OF_INFRACTION], a = ticketAddress(f[head.LOCATION2]);
    r.tickets++;
    if (kind === 'night') { const h = String(f[head.TIME_OF_INFRACTION]).padStart(4, '0').slice(0, 2); r.hours[h] = (r.hours[h] || 0) + 1; r.months[date.slice(4, 6)] = (r.months[date.slice(4, 6)] || 0) + 1; }
    else r.dates[date] = (r.dates[date] || 0) + 1;
    const hit = a && find(a);
    if (!hit) continue;
    r.placed++;
    // the side of the street: the address's, the other one for a ticket written "OPP" (opposite)
    const side = f[head.LOCATION1] === 'OPP' ? (hit.side === 'L' ? 'R' : 'L') : hit.side, k = hit.si + side;
    if (kind === 'night') {
      if (sets.night.has(k)) r.onRule++;
      if (sets.listed.has(k)) r.onListed++;
      if (sets.exempt.has(k)) { r.onExempt++; const st = G.segs[hit.si].name; r.exemptExamples[st] = (r.exemptExamples[st] || 0) + 1; }
      if (!sets.nySides.has(k)) r.outside++;
    } else if (sets.snow.has(hit.si + 'L') || sets.snow.has(hit.si + 'R')) r.onRule++;   // both sides close: the block decides
    else { const st = G.segs[hit.si].name; r.offExamples[st] = (r.offExamples[st] || 0) + 1; }
  }
  const top = (o, n = 15) => Object.fromEntries(Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n));
  res.night.exemptExamples = top(res.night.exemptExamples);
  res.snow.offExamples = top(res.snow.offExamples, 25);
  return res;
}

// city.json's words: what a resident reads on the page (the welcome card, the line under a sheet's schedule, the data notes)
export const WORDS = {
  what: 'winter parking',   // the page's title and descriptions (scripts/cities/city-page.mjs): not a sweeping map
  tagline: 'snow routes and the North York night ban',   // the descriptions, share text and card of a map without sweeping
  alerts: 'Alerts and calendar reminders run on Toronto time: a North York ban night gets one alert around 9 PM the evening before, and a snow route gets one alert when the City declares a Major Snowstorm Condition.',
  rule: 'Two winter rules: no parking on snow routes while the City declares a Major Snowstorm Condition, and no parking 2 to 6 AM from December 1 to March 31 in the former North York.',
  afterpass: 'Snow routes: fines up to $500 and a tow while a snowstorm is declared. North York ban: a $50 ticket, and the car can be towed. It has no signs.',
  dataNotes: 'Snow routes come from the City\'s traffic and parking by-law (Chapter 950, Schedule XVII-A), placed on the Toronto Centreline. The North York ban covers every City street in the former City of North York, except the parts Council took off Schedule IV.',
};

export async function run() {
  const ctx = await build();
  const { G, placed, today } = ctx;
  const sets = assemble(ctx);
  const out = blocks(G, sets, ctx.muniOf);
  const tickets = await ticketCheck(G, sets, await cachedInput(INPUTS.tickets));

  // ---- report ----
  const side = (k) => { const s = G.segs[+k.slice(0, -1)]; return { block: s.id, street: s.name, side: compass(s.c, k.slice(-1)) }; };
  const blocksOf = (set) => new Set([...set].map((k) => k.slice(0, -1))).size;
  const notPlaced = (list) => list.filter((x) => !x.r.ok).map((x) => ({ highway: x.e.Highway, between: x.e.Between, why: x.r.why, ...(x.e.bylaw ? { bylaw: x.e.bylaw } : {}) }));
  const notes = (list) => list.filter((x) => x.r.ok && x.r.notes.length).map((x) => ({ entry: label(x.e), notes: x.r.notes }));
  const live = (k) => placed[k].filter((x) => x.live && !x.cityList);
  // exemptions: each repealed entry, what of it stays off the map (sides no entry in force covers), what stays on
  const exemptions = placed.night.filter((x) => !x.live).map((x) => {
    const keys = sideKeys(x.r), off = keys.filter((k) => sets.exempt.has(k)), still = keys.filter((k) => sets.night.has(k));
    return { entry: label(x.e), bylaw: x.e.bylaw, effective: x.e.effective, placed: x.r.ok,
      applied: x.r.ok && off.length > 0, blockSidesOff: off.length, blockSidesStillBanned: still.length,
      ...(off.length ? { off: off.map(side) } : {}),
      ...(!x.r.ok ? { why: x.r.why } : off.length ? {}
        : !keys.some((k) => sets.nySides.has(k)) ? { why: 'it covers no City street block on the map (a private, unbuilt or renamed street, or under half a block)' }
          : { why: 'every block side it covered is still covered by an entry in force (the by-law moved the limits or kept a side; what is left is under half a block)' }) };
  });
  const unlistedByClass = {}, unlistedStreets = {};
  for (const k of sets.nySides) if (!sets.listed.has(k) && !sets.exempt.has(k)) {
    const s = G.segs[+k.slice(0, -1)];
    unlistedByClass[s.cls] = (unlistedByClass[s.cls] || 0) + 1;
    unlistedStreets[s.name] = (unlistedStreets[s.name] || 0) + 1;
  }
  const sideCount = out.reduce((n, b) => n + b.d.length, 0);
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const dates = snowDates();
  const sources = [
    { name: INPUTS.schedules.what, url: INPUTS.schedules.page, license: LICENCE, fetched: fetchedOn(ctx.files.schedFile) },
    { name: INPUTS.centreline.what, url: INPUTS.centreline.page, license: LICENCE, fetched: fetchedOn(ctx.files.tclFile) },
    { name: INPUTS.municipalities.what, url: INPUTS.municipalities.page, license: LICENCE, fetched: fetchedOn(ctx.files.fmFile) },
    { name: 'Parking Tickets 2025 (the cross-check in report.json)', url: INPUTS.tickets.page, license: LICENCE, fetched: fetchedOn(CACHE + INPUTS.tickets.file) },
    { name: 'Municipal Code Chapter 950, Traffic and Parking (§ 950-400D(9), § 950-406)', url: CODE_URL, license: 'City of Toronto by-law', fetched: today },
    { name: 'Snow routes list, Schedule XVII-A (current to December 31, 2025)', url: SNOW_LIST_PDF, license: 'City page', fetched: today },
    { name: 'Major Snowstorm Condition news release (January 15, 2026)', url: SNOW_RELEASE, license: 'City page', fetched: today },
  ];
  const report = {
    generated: new Date().toISOString(),
    snowRoutes: {
      rule: '§ 950-406A: no parking or standing on a Schedule XVII-A highway while a Major Snow Storm Condition is declared, where signed. Both sides, all hours. Switch: data/toronto/winter.json.',
      season: `${SNOW.from} to ${SNOW.to} (the dates a declaration can switch on; two lists, ${dates.snow1.length} and ${dates.snow2.length} dates)`,
      entries: placed.snow.filter((x) => !x.cityList).length, inForce: live('snow').length, placed: live('snow').filter((x) => x.r.ok).length,
      fromTheCityListOnly: placed.snow.filter((x) => x.cityList).map((x) => ({ entry: label(x.e), placed: x.r.ok, note: x.e.note })),
      notPlaced: notPlaced(live('snow')), placedWithNotes: notes(placed.snow.filter((x) => x.live)),
      blocks: blocksOf(sets.snow), blockSides: sets.snow.size,
      schedule17B: 'Schedule XVII-B (parking on or blocking streetcar tracks in a Major Snow Storm Condition) lists 29 streetcar streets, all within the Schedule XVII-A routes: not drawn separately.',
      cityListCheck: 'The City\'s list (PDF, current to 2025-12-31) has every in force entry; it also lists Lower Coxwell Avenue (kept, above), and writes Richmond Street East as Yonge to Parliament only (the dataset adds Yonge to Church, inside it).',
    },
    northYork: {
      rule: '§ 950-400D(9): no parking 2:00 to 6:00 AM, December 1 to March 31, in the former City of North York, on the highways in Schedule IV (§ 950-1303). Not signed.',
      howMapped: 'Every City street (local, collector, arterial; City jurisdiction) whose middle is in the former North York (boundary data), both sides; a street on the boundary only where Schedule IV lists it. Less the exemptions: block sides a repealed Schedule IV entry covered that no entry in force covers.',
      schedule: { entries: placed.night.length, inForce: live('night').length, placed: live('night').filter((x) => x.r.ok).length, repealed: placed.night.filter((x) => !x.live).length },
      citySideStreets: { blockSides: sets.nySides.size, listedInForce: [...sets.nySides].filter((k) => sets.listed.has(k)).length,
        notListed: { byClass: unlistedByClass, topStreets: Object.fromEntries(Object.entries(unlistedStreets).sort((a, b) => b[1] - a[1]).slice(0, 30)) } },
      leftOut: sets.leftOut, boundarySidesNotListed: sets.boundary.length,
      exemptionsApplied: exemptions.filter((x) => x.applied).length, exemptionsNotApplied: exemptions.filter((x) => !x.applied).length,
      exemptions, blocks: blocksOf(sets.night), blockSides: sets.night.size,
      notPlaced: notPlaced(live('night')), placedWithNotes: notes(placed.night),
    },
    tickets2025: {
      note: 'Parking Tickets 2025: tickets placed by house number on the centreline\'s address ranges (a ticket written "OPP" on the other side). The schedules changed after (1494-2025, December 2025: routes added and moved, Yonge Street north of St. Clair among them), so a 2025 ticket can be off today\'s routes.',
      northYork: { ...tickets.night, onRulePct: pct(tickets.night.onRule, tickets.night.placed), onListedPct: pct(tickets.night.onListed, tickets.night.placed),
        hours2to5Pct: pct(['02', '03', '04', '05'].reduce((n, h) => n + (tickets.night.hours[h] || 0), 0), tickets.night.tickets) },
      snowRoutes: { ...tickets.snow, onRulePct: pct(tickets.snow.onRule, tickets.snow.placed) },
    },
    output: { blocks: out.length, blockSides: sideCount, bothRules: out.filter((b) => b.d.some(([, , r]) => r.some((x) => x[5] & 4)) && b.d.some(([, , r]) => r.some((x) => x[5] & 32))).length },
  };

  // ---- write ----
  const body = JSON.stringify({
    _meta: { city: 'toronto', time_zone: CITY.tz, generated: new Date().toISOString(), sources, blocks: out.length, sides: sideCount,
      format: 'b[] = {c: CENTRELINE_ID, s: street, l: cross streets, h: former municipality, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centreline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
        + `rule = [-1, 0, 24, 0, 0, ${SNOW_FLAGS}, "snow1"|"snow2"] for a snow route (all day on the dates of that list in \`dates\`, applied only while data/toronto/winter.json says a Major Snow Storm Condition is declared), `
        + `or [jsDow, 2, 6, 31, ${monthsMask(NIGHT.months)} (December to March), ${NIGHT_FLAGS}] for the North York ban, one per weekday; `
        + 'flags 1 = holidays too, 2 = towable, 4 = applies only while the switch is on, 8 = both sides close, 32 = a no parking rule, not a sweep' },
    dates,
    b: out });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', body);
  const gz = zlib.gzipSync(body).length;
  report.output.bytes = body.length;
  report.output.gzipBytes = gz;
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');
  // city.json: the facts, the map's frame (every centreline street), the switch rule's season, the words
  let w = 180, so = 90, e = -180, n = -90;
  for (const s of G.segs) if (STREET.has(s.cls)) for (const [lo, la] of s.c) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < so) so = la; if (la > n) n = la; }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  fs.writeFileSync(OUT + 'city.json', JSON.stringify({ ...CITY, bounds: [[r4(so), r4(w)], [r4(n), r4(e)]], holidays: HOLIDAYS,
    holidaysSource: HOLIDAYS_URL, holidayRule: 'all',
    // the North York ban's ticket ("PARK-N.YORK 2AM-6AM DEC1-MAR31", $50 in every 2025 ticket); a snow route ticket is $100
    // ("PARK VEHICLE - SNOW ROUTE"), and the City says fines go up to $500, with towing
    fine: '$50', tow: 'sometimes', fineSource: INPUTS.tickets.page,
    agency: 'City of Toronto Transportation Services', scheduleUrl: SNOW_PAGE, portal: 'https://open.toronto.ca/',
    credit: `Uses City of Toronto data under the ${LICENCE}.`, creditUrl: LICENCE_URL,
    winter: { from: SNOW.from, to: SNOW.to, start: SNOW.start, end: SNOW.end, declared: true },
    words: WORDS, sources }, null, 1) + '\n');
  // The switch (data/toronto/winter.json): written once, then only by scripts/cities/winter.mjs
  if (!fs.existsSync(OUT + 'winter.json')) fs.writeFileSync(OUT + 'winter.json', JSON.stringify({ state: 'waiting' }, null, 1) + '\n');
  log(`snow routes: ${report.snowRoutes.placed}/${report.snowRoutes.inForce} entries placed, ${report.snowRoutes.blocks} blocks, ${report.snowRoutes.blockSides} sides`);
  log(`North York: ${report.northYork.blocks} blocks, ${report.northYork.blockSides} sides; ${report.northYork.exemptionsApplied} exemptions applied, ${report.northYork.exemptionsNotApplied} not`);
  log(`tickets 2025: North York ${report.tickets2025.northYork.onRulePct}% on the map (${report.tickets2025.northYork.onListedPct}% on listed sides), snow routes ${report.tickets2025.snowRoutes.onRulePct}%`);
  log(`wrote ${out.length} blocks, ${sideCount} sides; segments.json ${Math.round(body.length / 1024)} KB (${Math.round(gz / 1024)} KB gzip)`);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await run();
