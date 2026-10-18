#!/usr/bin/env node
// Glendale (California) for CURB (city build, docs/multi-city/city-build.md; research in docs/multi-city/glendale.md).
// Builds data/glendale/ from the City of Glendale's GIS server (gismap.glendaleca.gov, no license stated):
//
//   1. PW/StreetSweeping (MapServer/0, "SweepRoutes"): 12,596 lines with a weekday and a posted window ("Monday",
//      "8AM-12PM"), no names, no side field, no frequency. The lines are CURB lines: each runs 6 to 10 m off a street
//      centerline, one per side, and 1,039 street segments carry a different schedule on each side (on Street View,
//      E Harvard St's north curb, "Wednesday", has a Wednesday sign). So sides are told apart by geometry, as in Santa
//      Monica, with the same placement code (santa-monica.mjs).
//   2. Common/Streets (FeatureServer/0): 8,070 centerlines (LA County CAMS, edited by the City) with names and address
//      ranges. A block is one Primary, Secondary or Minor centerline (its OBJECTID is the block id). 978 of them have no
//      name: 151 take the name of the street they continue in a straight line (nameUnnamed); the rest, mostly alleys
//      swept down the middle, are left off the map.
//   3. Common/NeighborhoodZones (FeatureServer/1): the City's 37 neighborhoods, for `h` and the welcome card.
//
// 9,032 of the curb lines read 8 AM to 3 PM, a sweeping shift rather than a sign: it covers most of the hillside and low
// density streets, and Street View found no sweeping signs on the 4 such blocks checked, while a block with a 2 hour
// window had its sign. The City enforces "the day and timeframe posted on the street signage" (GMC 10.36.110: only
// where posted), so those curbs are left off the map until the City says they are posted (SHIFT_IS_POSTED).
//
// Run: node scripts/cities/glendale.mjs [--refresh]   (Node 18+; inputs cached in private/cache/glendale/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { partsOf, lineLen, compass, matchCurbs, keepRules, limits, crossStreets, titleCase, addresses, hoodAt, midpoint, fetchLayer } from './santa-monica.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/glendale/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/glendale/';
const log = (...a) => console.error('[glendale]', ...a);

export const SOURCES = {
  sweeping: { url: 'https://gismap.glendaleca.gov/arcgis/rest/services/PW/StreetSweeping/MapServer/0', oid: 'OBJECTID_12', file: 'sweeping.json' },
  streets: { url: 'https://gismap.glendaleca.gov/arcgis/rest/services/Common/Streets/FeatureServer/0', oid: 'OBJECTID', file: 'streets.json' },
  hoods: { url: 'https://gismap.glendaleca.gov/arcgis/rest/services/Common/NeighborhoodZones/FeatureServer/1', oid: 'OBJECTID', file: 'neighborhoods.json' },
};

// Local projection for Glendale (meters east and north of a point in town).
const LAT0 = 34.16, LON0 = -118.25, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110950;
export const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];

// ---------- schedule ------------------------------------------------------------------------------

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// "8AM", "630AM" (6:30), "12PM", "8" (meridiem from the other end), "10:30"
function clock(s) {
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/i.exec(s.trim());
  if (!m) return null;
  const h = +m[1], mi = m[2] ? +m[2] : 0, ap = m[3] ? m[3].toLowerCase() : null;
  if (h < 1 || h > 12 || mi > 59) return null;
  return { h, mi, ap };
}
const to24 = ({ h, mi }, ap) => ({ h: (h % 12) + (ap === 'pm' ? 12 : 0), mi });
const fmt = ({ h, mi }) => (mi ? `${h}:${String(mi).padStart(2, '0')}` : h);
const minutes = ({ h, mi }) => h * 60 + mi;

/** The posted window "8AM-3PM", "3AM-630AM", "8-12pm", "10-12" → { from, to } in 24 h (numbers or "H:MM"), or null. */
export function parseWindow(time) {
  const parts = String(time ?? '').replace(/\s+/g, '').split('-');
  if (parts.length !== 2) return null;
  const a = clock(parts[0]), b = clock(parts[1]);
  if (!a || !b) return null;
  // An end without AM or PM: "10-12" is the morning to noon. A start without one takes the end's, unless that puts it
  // after the end ("8-12pm" is 8 AM to noon).
  const bap = b.ap || (b.h === 12 ? 'pm' : 'am');
  let A = to24(a, a.ap || bap);
  const B = to24(b, bap);
  if (!a.ap && minutes(A) >= minutes(B)) A = to24(a, 'am');
  if (minutes(B) <= minutes(A)) return null;
  return { from: fmt(A), to: fmt(B) };
}

/** One curb line's Day and Time → rule tuples [dow, from, to, weeks, months, flags], or { why } when they can't be read. */
export function parseSchedule(day, time) {
  const d = String(day ?? '').trim().toLowerCase();
  if (!d || d === 'null') return { rules: [], why: 'no day' };
  const dow = DAYS.indexOf(d);
  if (dow < 0) return { rules: [], why: `day "${day}"` };
  const w = parseWindow(time);
  if (!w) return { rules: [], why: `hours "${time}"` };
  return { rules: [[dow, w.from, w.to, 31, 0, 0]] };
}

// ---------- unnamed centerlines -------------------------------------------------------------------

const nodeKey = ([x, y]) => x.toFixed(5) + ',' + y.toFixed(5);
const angDiff = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
/**
 * Names for the centerlines the City's layer leaves unnamed: the name of the street each one continues in a straight
 * line (within 25°, walking through other unnamed pieces), when both ends agree or only one end finds a name. Sets
 * p.name and p.inferred on the pieces it names; returns how many.
 */
export function nameUnnamed(pieces, project = xy) {
  const at = new Map();
  for (const p of pieces) {
    p.a = nodeKey(p.coords[0]); p.b = nodeKey(p.coords[p.coords.length - 1]);
    for (const n of [p.a, p.b]) { if (!at.has(n)) at.set(n, []); at.get(n).push(p); }
  }
  // heading leaving node n along piece p, over its first 15 m
  const heading = (p, n) => {
    const c = p.a === n ? p.coords : [...p.coords].reverse(), p0 = project(c[0]);
    let k = 1;
    while (k < c.length - 1 && Math.hypot(project(c[k])[0] - p0[0], project(c[k])[1] - p0[1]) < 15) k++;
    const p1 = project(c[k]);
    return Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  };
  const straight = (p, n) => {
    const h = heading(p, n);
    let best = null;
    for (const q of at.get(n)) {
      if (q === p) continue;
      const d = Math.abs(Math.PI - angDiff(h, heading(q, n)));
      if (d < (25 * Math.PI) / 180 && (!best || d < best.d)) best = { q, d };
    }
    return best && best.q;
  };
  const known = new Map(pieces.filter((p) => p.name).map((p) => [p, p.name]));
  let named = 0;
  for (const p of pieces) {
    if (known.has(p)) continue;
    const found = [];
    for (const start of [p.a, p.b]) {
      for (let cur = p, n = start, i = 0; i < 12; i++) {
        const q = straight(cur, n);
        if (!q) break;
        if (known.has(q)) { found.push(known.get(q)); break; }
        n = q.a === n ? q.b : q.a; cur = q;
      }
    }
    if (found.length && found.every((f) => f === found[0])) { p.name = found[0]; p.inferred = true; named++; }
  }
  return named;
}

// ---------- holidays ------------------------------------------------------------------------------

// glendalerecycles.com/street-sweeping (the City's Integrated Waste Management site, which glendaleca.gov's street
// sweeping page now opens; read 2026-10-18): "Street sweeping does not occur on the following holidays: New Year's
// Day, President's Day, Memorial Day, Independence Day, Juneteenth, Labor Day, Veterans Day, Thanksgiving Day,
// Christmas Day", and "If your scheduled day falls on a holiday listed above, sweeping will resume on your next regular
// sweeping day ... Parking enforcement is also suspended for street sweeping on these holidays." No make-up day.
// The page names no observed day for a holiday on a weekend: the dates below are the holidays themselves, and the
// Fridays or Mondays a weekend holiday may be kept (2026-07-03, 2027-06-18, 2027-07-05, 2027-12-24) are left out.
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-02-16': "Presidents' Day", '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
  '2026-07-04': 'Independence Day', '2026-09-07': 'Labor Day', '2026-11-11': 'Veterans Day', '2026-11-26': 'Thanksgiving Day',
  '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-02-15': "Presidents' Day", '2027-05-31': 'Memorial Day', '2027-06-19': 'Juneteenth',
  '2027-07-04': 'Independence Day', '2027-09-06': 'Labor Day', '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving Day',
  '2027-12-25': 'Christmas Day',
};

// ---------- build ---------------------------------------------------------------------------------

const BLOCK_TYPES = new Set(['Primary', 'Secondary', 'Minor']);   // streets people park on; not freeways, ramps, driveways
// 8 AM to 3 PM, the sweeping shift on unposted streets (see the top of this file). true puts those curbs on the map.
export const SHIFT_IS_POSTED = false;
export const isShiftWindow = (rule) => rule[1] === 8 && rule[2] === 15;
const STUB_M = 20;
const r6 = (v) => Math.round(v * 1e6) / 1e6;

async function cached(name, fetcher, refresh) {
  const f = CACHE + name;
  if (!refresh && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fetcher();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}
function expectShape(name, features, fields, min) {
  if (features.length < min) throw new Error(`${name}: ${features.length} features, expected at least ${min}`);
  const missing = fields.filter((k) => !(k in (features[0].properties || {})));
  if (missing.length) throw new Error(`${name}: no field ${missing.join(', ')} (the layer changed)`);
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const sweeping = await cached(SOURCES.sweeping.file, () => { log('fetching the sweeping curbs…'); return fetchLayer(SOURCES.sweeping); }, refresh);
  const streets = await cached(SOURCES.streets.file, () => { log('fetching the streets…'); return fetchLayer(SOURCES.streets); }, refresh);
  const hoods = await cached(SOURCES.hoods.file, () => { log('fetching the neighborhoods…'); return fetchLayer(SOURCES.hoods); }, refresh);
  expectShape('sweeping', sweeping, ['OBJECTID_12', 'Day', 'Time'], 10000);
  expectShape('streets', streets, ['OBJECTID', 'FullName', 'Type', 'From_L', 'To_L', 'From_R', 'To_R'], 6000);
  expectShape('neighborhoods', hoods, ['NAME'], 30);
  log(`${sweeping.length} curb lines, ${streets.length} street centerlines, ${hoods.length} neighborhoods`);

  // 1. curb lines and their rules
  const curbs = [], noDay = { n: 0, m: 0, byTime: {} }, unreadable = [], windows = {};
  for (const f of sweeping) {
    const p = f.properties, coords = partsOf(f.geometry).filter((c) => c.length > 1);
    if (!coords.length) continue;
    const len = coords.reduce((s, c) => s + lineLen(c), 0);
    const { rules, why } = parseSchedule(p.Day, p.Time);
    if (why === 'no day') { noDay.n++; noDay.m += len; noDay.byTime[p.Time] = (noDay.byTime[p.Time] || 0) + 1; continue; }
    if (!rules.length) { unreadable.push({ id: p.OBJECTID_12, day: p.Day, time: p.Time, why, m: Math.round(len) }); continue; }
    const label = `${p.Day} ${p.Time}`;
    windows[`${rules[0][1]}-${rules[0][2]}`] = (windows[`${rules[0][1]}-${rules[0][2]}`] || { lines: 0, km: 0 });
    windows[`${rules[0][1]}-${rules[0][2]}`].lines++; windows[`${rules[0][1]}-${rules[0][2]}`].km += len / 1000;
    curbs.push({ id: p.OBJECTID_12, coords, rules, label });
  }

  // 2. blocks: Primary, Secondary and Minor centerlines; the unnamed ones take the name of the street they continue
  const pieces = [];
  for (const f of streets) {
    const p = f.properties, parts = partsOf(f.geometry).filter((c) => c.length > 1);
    if (!BLOCK_TYPES.has(p.Type) || !parts.length) continue;
    pieces.push({ id: p.OBJECTID, name: p.FullName ? p.FullName.trim() : null, coords: parts.flat(), props: p });
  }
  const unnamedBefore = pieces.filter((p) => !p.name).length, inferred = nameUnnamed(pieces);
  const ends = limits(pieces.filter((p) => p.name), { project: xy }), byId = new Map(pieces.map((p) => [p.id, p]));
  const crossNear = crossStreets(pieces, { project: xy });
  const crossing = (p) => lineLen(p.coords) < STUB_M && crossNear(p.coords[0], p.name) && crossNear(p.coords[p.coords.length - 1], p.name);
  const stubs = pieces.filter(crossing), blocks = pieces.filter((p) => !crossing(p));

  // 3. curbs → block sides
  const m = matchCurbs(curbs, blocks, { project: xy });
  const sidesByBlock = new Map(), multi = [], dropped = { sides: 0, m: 0 }, nameless = { sides: 0, km: 0, middle: 0, middleKm: 0 };
  const shiftOnly = { sides: 0, km: 0, blocks: new Set() };
  for (const [key, side] of m.sides) {
    const [id, lr] = key.split('|'), b = byId.get(+id);
    if (!b.name) {
      // a centerline with no name: mostly alleys, whose sweeping line runs down the middle (within 4 m), not along a curb
      nameless.sides++; nameless.km += side.len / 1000;
      if (side.dist / side.len < 4) { nameless.middle++; nameless.middleKm += side.len / 1000; }
      continue;
    }
    const kept0 = keepRules(side, lineLen(b.coords));
    if (!kept0.rules.length) { dropped.sides++; dropped.m += side.len; continue; }
    const rules = SHIFT_IS_POSTED ? kept0.rules : kept0.rules.filter((r) => !isShiftWindow(r)), kept = kept0.kept - (kept0.rules.length - rules.length);
    if (!rules.length) { shiftOnly.sides++; shiftOnly.km += side.len / 1000; shiftOnly.blocks.add(b.id); continue; }
    const label = compass(b.coords, lr, xy);
    if (kept > 1) multi.push({ c: String(b.id), s: titleCase(b.name), side: label, rules });
    if (!sidesByBlock.has(b.id)) sidesByBlock.set(b.id, []);
    sidesByBlock.get(b.id).push([lr, label, rules]);
  }
  const out = [];
  for (const [id, d] of sidesByBlock) {
    const b = byId.get(id), [a, z] = ends.get(b);
    const { n, o } = addresses([{ piece: b, fwd: true }], ['From_L', 'To_L', 'From_R', 'To_R']);
    const hood = hoodAt(midpoint(b.coords), hoods, 'NAME');
    out.push({ c: String(id), s: titleCase(b.name), l: [a, z].filter(Boolean).map(titleCase).join(' - '),
      ...(hood ? { h: hood } : {}), ...(n ? { n } : {}), ...(o ? { o } : {}),
      g: b.coords.map(([lo, la]) => [r6(lo), r6(la)]),
      d: d.sort((x, y) => x[0].localeCompare(y[0])) });
  }
  out.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));

  // 4. counts
  const sideCount = out.reduce((s, b) => s + b.d.length, 0);
  const ruleCount = out.reduce((s, b) => s + b.d.reduce((t, [, , r]) => t + r.length, 0), 0);
  const both = out.filter((b) => b.d.length === 2);
  const sameBoth = both.filter((b) => JSON.stringify(b.d[0][2]) === JSON.stringify(b.d[1][2])).length;
  const shownBlocks = new Set(out.map((b) => b.c));
  const shiftBlocksOff = [...shiftOnly.blocks].filter((id) => !shownBlocks.has(String(id))).length;
  const unplaced = new Set(m.unassigned.map((u) => u.id));
  const unplacedByWindow = {};
  for (const c of curbs) if (unplaced.has(c.id)) {
    const k = `${c.rules[0][1]}-${c.rules[0][2]}`;
    unplacedByWindow[k] = +((unplacedByWindow[k] || 0) + c.coords.reduce((t, x) => t + lineLen(x), 0) / 1000).toFixed(1);
  }
  const unplacedExamples = curbs.filter((c) => unplaced.has(c.id)).map((c) => ({ id: c.id, label: c.label,
    m: Math.round(c.coords.reduce((s, x) => s + lineLen(x), 0)), at: midpoint(c.coords[0]).map(r6) })).sort((x, y) => y.m - x.m);
  const hoodBoxes = new Map();
  for (const b of out) if (b.h) {
    const bb = hoodBoxes.get(b.h) || [180, 90, -180, -90];
    for (const [lo, la] of b.g) { bb[0] = Math.min(bb[0], lo); bb[1] = Math.min(bb[1], la); bb[2] = Math.max(bb[2], lo); bb[3] = Math.max(bb[3], la); }
    hoodBoxes.set(b.h, bb);
  }
  const hoodCount = {};
  for (const b of out) if (b.h) hoodCount[b.h] = (hoodCount[b.h] || 0) + 1;

  // 5. write
  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: 'Street Sweeping routes (Public Works)', url: SOURCES.sweeping.url, license: 'not stated', fetched: today },
    { name: 'Streets (from LA County CAMS, edited by the City)', url: SOURCES.streets.url, license: 'not stated', fetched: today },
    { name: 'Neighborhood Zones', url: SOURCES.hoods.url, license: 'not stated', fetched: today },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  let w = 180, s = 90, e = -180, nn = -90;
  for (const b of out) for (const [lo, la] of b.g) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); nn = Math.max(nn, la); }
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'glendale', time_zone: 'America/Los_Angeles', generated: new Date().toISOString(), sources, blocks: out.length, sides: sideCount,
      format: 'b[] = {c: Streets OBJECTID, s: street, l: cross streets, h: neighborhood zone, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
        + 'rule = [jsDow, from, to, weeksMask (31 = every week), monthsMask (0 = all year), flags (0: holidays stop it, no tow)]' },
    b: out }));

  const city = {
    id: 'glendale', name: 'Glendale', region: 'California', tz: 'America/Los_Angeles',
    center: [34.1469, -118.2469], zoom: 15,   // the most posted blocks within 600 m (City Center and Citrus Grove, east of Brand Blvd)
    bounds: [[+(s - 0.002).toFixed(4), +(w - 0.002).toFixed(4)], [+(nn + 0.002).toFixed(4), +(e + 0.002).toFixed(4)]],
    holidays: HOLIDAYS, holidaysSource: 'https://glendalerecycles.com/street-sweeping/', holidayRule: 'all',
    fine: null, tow: 'no', fineSource: null,
    agency: 'City of Glendale Public Works, Integrated Waste Management', scheduleUrl: 'https://glendalerecycles.com/street-sweeping/',
    sources,
    words: {
      rule: 'Where street sweeping signs are posted, no parking on the day and hours on the sign, every week; the two sides of a street often have different days.',
      afterpass: 'All year · not on the 9 sweeping holidays · a ticket where signs are posted, no tow',
      dataNotes: 'The City\'s street sweeping map data (Public Works) gives each curb its own line with a day and hours, put on the side of the street centerline it runs along. Streets whose hours read 8 AM to 3 PM, the sweeping shift, are swept weekly too but look unposted, so they are left off; the City tickets only where signs are posted.',
    },
    neighborhoods: [...hoodBoxes.entries()].filter(([h]) => hoodCount[h] >= 20).sort((x, y) => x[0].localeCompare(y[0]))
      .map(([name, bb]) => ({ name, bbox: bb.map((v) => v.toFixed(4)).join(',') })),
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1));

  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { lines: v.lines, km: +v.km.toFixed(1) }]));
  const report = {
    generated: new Date().toISOString(),
    season: 'All year, weekly. No sweeping and no sweeping enforcement on the 9 holidays of glendalerecycles.com/street-sweeping; no make-up day.',
    input: { curbLines: sweeping.length, withDayAndHours: curbs.length, noDay: noDay.n, noDayKm: +(noDay.m / 1000).toFixed(1), noDayByTime: noDay.byTime,
      unreadable: unreadable.length, windows: round(windows), streets: streets.length, blockCenterlines: pieces.length,
      unnamedCenterlines: unnamedBefore, unnamedNamedByContinuation: inferred, intersectionPiecesLeftOut: stubs.length },
    placement: {
      method: 'Each curb line sampled every 5 m; a sample goes to the nearest Primary, Secondary or Minor street centerline within 30 m whose direction is within about 37 degrees of the curb, on the side where it lies (code shared with santa-monica.mjs). A side keeps a schedule carried by at least 15% of the block length and 15 m of curb (60% of a block shorter than 25 m).',
      sampledKm: +(m.sampled / 1000).toFixed(1), placedKm: +(m.placed / 1000).toFixed(1), placedShare: +(m.placed / m.sampled).toFixed(4),
      curbLinesMostlyUnplaced: m.unassigned.length, curbLinesMostlyUnplacedKm: +(m.unassigned.reduce((t, u) => t + u.len, 0) / 1000).toFixed(1),
      unplacedKmByWindow: unplacedByWindow,
      unplacedNote: 'Curb lines with no street centerline of the right kind within 30 m: along the railroad, inside business parks whose streets are not in the layer (Grand Central), or where the curb line strays from the centerline.',
      unplacedExamples: unplacedExamples.slice(0, 15),
      sidesBelowThreshold: dropped.sides, sidesBelowThresholdKm: +(dropped.m / 1000).toFixed(2),
      sidesWithSeveralSchedules: multi.length, severalSchedulesExamples: multi.slice(0, 15),
      onUnnamedCenterlines: { sides: nameless.sides, km: +nameless.km.toFixed(1), downTheMiddle: nameless.middle, downTheMiddleKm: +nameless.middleKm.toFixed(1),
        note: 'Lines placed on a centerline the City leaves unnamed, and that no named street continues: left off the map. Those within 4 m of the centerline on average are sweeping routes down the middle of alleys and lanes, not curbs.' },
    },
    sides: { blocksWithTwoSides: both.length, sameRulesBothSides: sameBoth, differentRulesBothSides: both.length - sameBoth,
      oneSideOnly: out.length - both.length,
      note: 'The data has no side field, but its lines are curbs, one per side: the two sides are told apart by where each line lies.' },
    shiftWindow: { shown: SHIFT_IS_POSTED, curbLines: windows['8-15'] ? windows['8-15'].lines : 0, curbKm: windows['8-15'] ? +windows['8-15'].km.toFixed(1) : 0,
      sidesLeftOff: shiftOnly.sides, sidesLeftOffKm: +shiftOnly.km.toFixed(1), blocksLeftOffEntirely: shiftBlocksOff,
      note: '8 AM to 3 PM, the sweeping shift, is the window on most residential streets, mostly hillside and low density neighborhoods. Street View (2022 to 2025 imagery) showed no sweeping signs on the 4 such blocks checked (Cordova Ave, E Palmer Ave, W Windsor Rd, W Harvard St), while E Harvard St, with a 2 hour window, had its sign on the side the data says. Glendale enforces only posted signs (GMC 10.36.110; "the day and timeframe posted on the street signage"), so these curbs are left off until the City confirms they are posted; SHIFT_IS_POSTED = true in scripts/cities/glendale.mjs puts them on the map.' },
    output: { blocks: out.length, sides: sideCount, rules: ruleCount, oddSideKnown: out.filter((b) => b.o).length, withNeighborhood: out.filter((b) => b.h).length,
      blocksByNeighborhood: hoodCount },
    skipped: { noDay: `${noDay.n} curb lines (${(noDay.m / 1000).toFixed(1)} km) have hours but no day`, unreadable },
    ticketCheck: 'Glendale publishes no parking citations with time and place, so no cross-check.',
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1));
  log(`curbs: ${curbs.length} with a day and hours, ${noDay.n} without a day, ${unreadable.length} unreadable`);
  log(`placed ${(m.placed / 1000).toFixed(1)} of ${(m.sampled / 1000).toFixed(1)} km; ${m.unassigned.length} curb lines mostly unplaced; ${dropped.sides} sides under the threshold`);
  log(`${out.length} blocks, ${sideCount} sides (${both.length} blocks with two: ${both.length - sameBoth} differ), ${ruleCount} rules, ${multi.length} sides with several schedules`);
  log(`8 AM to 3 PM: ${shiftOnly.sides} sides (${shiftOnly.km.toFixed(1)} km) ${SHIFT_IS_POSTED ? 'shown' : 'left off'}, ${shiftBlocksOff} blocks with nothing else`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/glendale/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
