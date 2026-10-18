#!/usr/bin/env node
// Unincorporated Los Angeles County for CURB (2026-10-18; format in docs/multi-city/city-build.md, research in
// docs/multi-city/la-county.md). Builds data/la-county/ from three County of Los Angeles sources:
//
//   1. Street Sweeping Routes (Public Works, Road Maintenance Division, ArcGIS): 27,849 lines with the sweeping day, hours,
//      frequency and whether the street is posted. Each line is drawn along one CURB (a block face, rounded at the corners),
//      so the side of the street is in the geometry. Only posted lines are kept: on unposted streets nobody is ticketed.
//   2. CAMS Address Lines (eGIS, ArcGIS): the County's street centerlines with names and address ranges. Each curb line is
//      laid on the centerline it runs along, on the side it lies on, block by block.
//   3. Unincorporated communities (BOS boundaries, ArcGIS): the community name of each block.
//
// The County publishes no ticket data, so there is no ticket cross-check (report.json says so).
//
// Run: node scripts/cities/la-county.mjs [--refresh]   (Node 18+; inputs cached in private/cache/la-county/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { xy, lineLen, compass, simplify, PolygonIndex, ringsOf } from './los-angeles.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/la-county/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/la-county/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[la-county]', ...a);

const ROUTES = 'https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Los_Angeles_County_Public_Works_Road_Maintenance_Division_Street_Sweeping_Routes/FeatureServer/0/query';
const CAMS = 'https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/eGIS_Addressing_ROAD_LINES/FeatureServer/0/query';
const COMMUNITIES = 'https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Unincorporated_LA_County/FeatureServer/0/query';
// Only these fields are read: the layer also carries editors' user names and route labels that are first names, never kept.
const ROUTE_FIELDS = 'OBJECTID,GLOBALID,MD,RD,SCHEDULE,TIME,POSTED,STREET_TYPE,FREQUENCY,LAST_EDITED_DATE';
const CAMS_FIELDS = 'OBJECTID,SourceID,FullName,StPreDir,StName,StPostType,StPostDir,From_L,To_L,From_R,To_R,Parity_L,Parity_R,LCity_L,LCity_R,Type,Elevation';

// ---------- the County's fields ---------------------------------------------------------------------

const DOW = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 };
/** "Thursday" → [4]; "Monday Friday" → [1, 5] (twice weekly); "As Needed", "Any Day" → []. */
export function parseSchedule(s) {
  const w = String(s || '').trim().toUpperCase().split(/[\s,&]+/).filter(Boolean);
  return w.length && w.every((x) => x in DOW) ? w.map((x) => DOW[x]) : [];
}
const hm = (h, m, ap) => { let H = +h % 12; if (ap === 'PM') H += 12; return m && +m ? `${H}:${m}` : H; };
/** "8:00 AM - 12:00 PM" → [8, 12]; " 7:00 AM - 11:00AM" → [7, 11]; "5:00 AM - 7:30 AM" → [5, "7:30"]; "All Day" → null. */
export function parseTime(s) {
  const t = String(s || '').toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const m = /^(\d{1,2})(?::(\d{2}))? ?(AM|PM) ?- ?(\d{1,2})(?::(\d{2}))? ?(AM|PM)$/.exec(t);
  return m ? [hm(m[1], m[2], m[3]), hm(m[4], m[5], m[6])] : null;
}
/** WEEKLY and TWICE WEEKLY → every week (31); "TWICE MONTHLY - WEEK 2 AND WEEK 4" → 10; anything else → 0. */
export function parseFrequency(s) {
  const t = String(s || '').trim().toUpperCase();
  if (t === 'WEEKLY' || t === 'TWICE WEEKLY' || t === 'DAILY') return 31;
  const m = /TWICE MONTHLY - WEEK (\d) AND WEEK (\d)/.exec(t);
  return m ? (1 << (+m[1] - 1)) | (1 << (+m[2] - 1)) : 0;
}
export const isPosted = (p) => String(p.POSTED || '').trim().toUpperCase() === 'YES';

// ---------- curb lines onto centerlines ------------------------------------------------------------------

/** Points every `step` meters along a projected line with the line's direction there, `trim` meters left out at each end
 *  (a curb line rounds the corner into the cross street there). */
export function sampleWithDir(pts, step = 5, trim = 8) {
  const len = lineLen(pts), out = [];
  if (len < 2 * trim + step) trim = Math.max(0, (len - step) / 2);
  let acc = 0, next = trim;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], l = Math.hypot(x2 - x1, y2 - y1);
    if (!l) continue;
    while (next <= acc + l && next <= len - trim) {
      const t = (next - acc) / l;
      out.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, ux: (x2 - x1) / l, uy: (y2 - y1) / l });
      next += step;
    }
    acc += l;
  }
  return out;
}

/** A grid of centerline edges, for "the nearest parallel centerline within `maxD` meters". */
export class EdgeIndex {
  constructor(lines, cell = 50, pad = 25) {
    this.cell = cell; this.grid = new Map();
    for (const L of lines) for (let i = 1; i < L.pts.length; i++) {
      const [x1, y1] = L.pts[i - 1], [x2, y2] = L.pts[i];
      const e = { L, x1, y1, x2, y2 };
      for (let cx = Math.floor((Math.min(x1, x2) - pad) / cell); cx <= Math.floor((Math.max(x1, x2) + pad) / cell); cx++)
        for (let cy = Math.floor((Math.min(y1, y2) - pad) / cell); cy <= Math.floor((Math.max(y1, y2) + pad) / cell); cy++) {
          const k = cx + ',' + cy;
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(e);
        }
    }
  }
  /** The nearest edge to sample q running within ~30° of q's direction: { L, side: 'L' | 'R' of the centerline, d }. */
  nearest(q, maxD = 22, minCos = 0.85) {
    let best = null;
    for (const e of this.grid.get(Math.floor(q.x / this.cell) + ',' + Math.floor(q.y / this.cell)) || []) {
      const dx = e.x2 - e.x1, dy = e.y2 - e.y1, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const l = Math.sqrt(l2);
      if (Math.abs((dx * q.ux + dy * q.uy) / l) < minCos) continue;
      const t = Math.max(0, Math.min(1, ((q.x - e.x1) * dx + (q.y - e.y1) * dy) / l2));
      const d = Math.hypot(q.x - e.x1 - t * dx, q.y - e.y1 - t * dy);
      if (d > maxD || (best && d >= best.d)) continue;
      best = { L: e.L, d, side: dx * (q.y - e.y1) - dy * (q.x - e.x1) > 0 ? 'L' : 'R' };
    }
    return best;
  }
}

/** Lay curb lines on centerlines: per centerline side, the curb lines whose samples land there, with how much of the
 *  centerline they cover. A curb line counts on a side when it covers 35% of the block or 60 m of it, with 4 samples
 *  (20 m) at least, so the rounded corner of a curb that turns into a cross street doesn't count there (a block shorter
 *  than 25 m needs half its length). */
export function layCurbs(curbs, index, { step = 5, minShare = 0.35, minMeters = 60, minSamples = 4 } = {}) {
  const hits = new Map();   // centerline id → side → curb → samples
  const stats = { curbs: curbs.length, placed: 0, unplaced: [], samples: 0, samplesPlaced: 0 };
  for (const C of curbs) {
    const sp = sampleWithDir(C.pts, step);
    let placed = 0;
    for (const q of sp) {
      stats.samples++;
      const h = index.nearest(q);
      if (!h) continue;
      placed++; stats.samplesPlaced++;
      if (!hits.has(h.L.id)) hits.set(h.L.id, { L: new Map(), R: new Map(), line: h.L });
      const m = hits.get(h.L.id)[h.side];
      m.set(C, (m.get(C) || 0) + 1);
    }
    if (placed) stats.placed++; else stats.unplaced.push(C);
  }
  const sides = new Map();   // centerline id → { line, L: [curb], R: [curb] }
  for (const [id, h] of hits) {
    const len = lineLen(h.line.pts) || 1;
    const pick = (m) => [...m].filter(([, n]) => (n >= minSamples && (n * step / len >= minShare || n * step >= minMeters))
      || (len < 25 && n * step / len >= 0.5)).map(([C]) => C);
    const L = pick(h.L), R = pick(h.R);
    if (L.length || R.length) sides.set(id, { line: h.line, L, R });
  }
  return { sides, stats };
}

// ---------- holidays ------------------------------------------------------------------------------

// County holidays, from Public Works' street sweeping FAQ: "January 1, Martin Luther King Day, President's Day, Cesar Chavez
// Day (observed March), Memorial Day, July 4th, Labor Day, Columbus Day (observed October), Veteran's Day, Thanksgiving
// (Thursday and Friday), and Christmas", plus Juneteenth (a County holiday since 2022; not in that FAQ, unverified).
// César Chávez Day is March 31; weekend holidays move to the Friday before or the Monday after (assumed, as for the State).
export function countyHolidays(y) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const nth = (m, dow, n) => { const d = new Date(Date.UTC(y, m - 1, 1)); return new Date(Date.UTC(y, m - 1, 1 + ((dow - d.getUTCDay() + 7) % 7) + 7 * (n - 1))); };
  const last = (m, dow) => { const d = new Date(Date.UTC(y, m, 0)); return new Date(Date.UTC(y, m - 1, d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7))); };
  const obs = (yy, m, dd, name) => {
    const d = new Date(Date.UTC(yy, m - 1, dd)), w = d.getUTCDay();
    return w === 6 ? [new Date(d.getTime() - 864e5), name + ' (observed)'] : w === 0 ? [new Date(d.getTime() + 864e5), name + ' (observed)'] : [d, name];
  };
  const tg = nth(11, 4, 4);
  const list = [obs(y, 1, 1, "New Year's Day"), [nth(1, 1, 3), 'Martin Luther King Jr. Day'], [nth(2, 1, 3), "Presidents' Day"],
    obs(y, 3, 31, 'César Chávez Day'), [last(5, 1), 'Memorial Day'], obs(y, 6, 19, 'Juneteenth'), obs(y, 7, 4, 'Independence Day'),
    [nth(9, 1, 1), 'Labor Day'], [nth(10, 1, 2), "Indigenous Peoples' Day"], obs(y, 11, 11, 'Veterans Day'), [tg, 'Thanksgiving'],
    [new Date(tg.getTime() + 864e5), 'Day after Thanksgiving'], obs(y, 12, 25, 'Christmas Day'), obs(y + 1, 1, 1, "New Year's Day")];
  const out = {};
  for (const [d, name] of list.sort((a, b) => a[0] - b[0])) if (d.getUTCFullYear() === y) out[iso(d)] = name;
  return out;
}

// ---------- fetch ---------------------------------------------------------------------------------

async function getJSON(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-la-county-build (+https://curb.guide)' } });
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
async function pages(url, params, label) {
  const out = [];
  for (let off = 0; ; off += 2000) {
    const q = new URLSearchParams({ ...params, outSR: '4326', f: 'geojson', orderByFields: 'OBJECTID', resultOffset: String(off), resultRecordCount: '2000' });
    const page = (await getJSON(`${url}?${q}`)).features || [];
    out.push(...page);
    if (off % 20000 === 0) log(`  ${label}: ${out.length}`);
    if (page.length < 2000) return { type: 'FeatureCollection', features: out };
  }
}
async function inputs() {
  const routes = await cached('routes.geojson', () => { log('fetching the sweeping routes…');
    return pages(ROUTES, { where: '1=1', outFields: ROUTE_FIELDS, returnGeometry: 'true', geometryPrecision: '6' }, 'routes'); });
  const cams = await cached('cams.geojson', () => { log('fetching CAMS centerlines in unincorporated areas…');
    return pages(CAMS, { where: "LCity_L='Unincorporated' OR LCity_R='Unincorporated'", outFields: CAMS_FIELDS, returnGeometry: 'true', geometryPrecision: '6' }, 'centerlines'); });
  const communities = await cached('communities.geojson', () => { log('fetching unincorporated communities…');
    return pages(COMMUNITIES, { where: '1=1', outFields: 'OBJECTID,COMMUNITY,LABEL', returnGeometry: 'true', geometryPrecision: '5' }, 'communities'); });
  return { routes, cams, communities };
}

// ---------- build ---------------------------------------------------------------------------------

const linesOf = (g) => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);
const SFX_WORD = { Avenue: 'Ave', Street: 'St', Boulevard: 'Blvd', Drive: 'Dr', Place: 'Pl', Road: 'Rd', Lane: 'Ln', Court: 'Ct' };

export async function main() {
  const { routes, cams, communities } = await inputs();
  log(`${routes.features.length} sweeping lines, ${cams.features.length} centerlines, ${communities.features.length} communities`);
  if (process.argv.includes('--fetch-only')) return null;
  const p0 = routes.features[0]?.properties || {};
  for (const k of ['SCHEDULE', 'TIME', 'POSTED', 'FREQUENCY']) if (!(k in p0)) throw new Error(`routes: field ${k} is missing`);
  if (routes.features.length < 20000 || cams.features.length < 50000) throw new Error('inputs look short');

  // 1. posted curb lines with a readable rule
  const skipped = {}, skip = (why, p) => { (skipped[why] ||= { lines: 0, examples: [] }).lines++; if (skipped[why].examples.length < 5) skipped[why].examples.push({ id: p.OBJECTID, schedule: p.SCHEDULE, time: p.TIME, frequency: p.FREQUENCY }); };
  const curbs = [];
  let posted = 0, unposted = 0;
  for (const f of routes.features) {
    const p = f.properties;
    if (!isPosted(p)) { unposted++; continue; }
    posted++;
    const days = parseSchedule(p.SCHEDULE), win = parseTime(p.TIME), weeks = parseFrequency(p.FREQUENCY);
    if (String(p.STREET_TYPE || '').toUpperCase() === 'MEDIAN') { skip('median curb', p); continue; }
    if (!days.length) { skip('no weekday', p); continue; }
    if (!win) { skip('no posted hours ("' + String(p.TIME || '').trim() + '")', p); continue; }
    if (!weeks) { skip('frequency', p); continue; }
    for (const c of linesOf(f.geometry)) if (c.length >= 2) curbs.push({ id: p.OBJECTID, p, c, pts: c.map(xy), days, win, weeks, md: p.MD });
  }
  log(`${posted} posted lines (${unposted} not posted), ${curbs.length} usable curb lines; skipped ${JSON.stringify(Object.fromEntries(Object.entries(skipped).map(([k, v]) => [k, v.lines])))}`);

  // 2. centerlines
  const lines = [];
  for (const f of cams.features) {
    const p = f.properties, cs = linesOf(f.geometry);
    if (!cs.length || !p.SourceID) continue;
    const c = cs.length === 1 ? cs[0] : cs.flat();
    if (c.length < 2) continue;
    lines.push({ id: String(p.SourceID).toUpperCase(), p, c, pts: c.map(xy) });
  }
  const index = new EdgeIndex(lines.filter((L) => String(L.p.Elevation || 'Surface') === 'Surface'));
  const { sides, stats } = layCurbs(curbs, index);
  log(`${stats.placed}/${stats.curbs} curb lines on a centerline (${stats.samplesPlaced}/${stats.samples} sample points); ${sides.size} centerlines with a swept side`);

  // 3. communities and cross streets
  const comm = communities.features.map((f) => ({ name: f.properties.COMMUNITY, idx: new PolygonIndex(ringsOf(f.geometry).map((r) => r.map(xy))) }));
  const communityAt = (q) => (comm.find((C) => C.idx.contains(q)) || {}).name || '';
  const nodeKey = ([lo, la]) => lo.toFixed(5) + ',' + la.toFixed(5);
  const nodes = new Map();
  const nameOf = (p) => { const n = String(p.FullName || '').trim(); return n.split(/\s+/).map((w) => SFX_WORD[w] || w).join(' '); };
  for (const L of lines) for (const e of [L.c[0], L.c[L.c.length - 1]]) {
    const k = nodeKey(e); if (!nodes.has(k)) nodes.set(k, new Set()); if (L.p.FullName) nodes.get(k).add(nameOf(L.p));
  }
  const limitsOf = (L) => {
    const own = nameOf(L.p), at = (e) => [...(nodes.get(nodeKey(e)) || [])].filter((n) => n && n !== own).sort()[0] || '';
    const a = at(L.c[0]), b = at(L.c[L.c.length - 1]);
    return a && b && a !== b ? `${a} - ${b}` : a || b;
  };

  // 4. blocks out
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const ruleOf = (C) => C.days.map((d) => [d, C.win[0], C.win[1], C.weeks, 0, 1]);   // flags 1: enforced on County holidays
  const hours = (v) => (typeof v === 'number' ? v : +v.split(':')[0] + +v.split(':')[1] / 60);
  const out = [], conflicts = [];
  let bothSame = 0, bothDiff = 0, oneSide = 0;
  for (const [id, s] of sides) {
    const L = s.line, d = [];
    for (const side of ['L', 'R']) {
      const rules = [], seen = new Set();
      for (const C of s[side]) for (const r of ruleOf(C)) { const k = r.join('|'); if (!seen.has(k)) { seen.add(k); rules.push(r); } }
      rules.sort((x, y) => x[0] - y[0] || hours(x[1]) - hours(y[1]));
      if (new Set(rules.map((r) => r[0])).size < rules.length) conflicts.push({ c: id, s: nameOf(L.p), side, rules });
      if (rules.length) d.push([side, compass(L.c, side), rules]);
    }
    if (!d.length) continue;
    if (d.length === 1) oneSide++;
    else if (JSON.stringify(d[0][2]) === JSON.stringify(d[1][2])) bothSame++; else bothDiff++;
    const nums = ['From_L', 'To_L', 'From_R', 'To_R'].map((k) => +L.p[k]).filter((v) => v > 0);
    const o = L.p.Parity_L === 'Odd' && L.p.Parity_R !== 'Odd' ? 'L' : L.p.Parity_R === 'Odd' && L.p.Parity_L !== 'Odd' ? 'R' : null;
    const mid = L.pts[Math.floor(L.pts.length / 2)];
    out.push({ c: id, s: nameOf(L.p) || 'Unnamed road', l: limitsOf(L), h: communityAt(mid), ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}),
      ...(o ? { o } : {}), g: simplify(L.c).map(([lo, la]) => [r6(lo), r6(la)]), d });
  }
  out.sort((a, b) => a.c.localeCompare(b.c));
  log(`blocks: ${out.length} (both sides ${bothSame + bothDiff}: ${bothDiff} with different days, ${bothSame} the same; one side ${oneSide}); sides with two rules on one weekday: ${conflicts.length}`);
  return { routes, cams, communities, curbs, lines, sides, stats, out, skipped, posted, unposted, conflicts, bothSame, bothDiff, oneSide };
}

const TERMS = 'LA County eGIS terms of use (https://egis-lacounty.hub.arcgis.com/pages/terms-of-use)';

async function write(r) {
  const { out, stats, skipped, posted, unposted, conflicts, curbs, routes } = r;
  const today = new Date().toISOString().slice(0, 10), generated = new Date().toISOString();
  const sources = [
    { name: 'Street Sweeping Routes (Public Works, Road Maintenance Division)', url: 'https://data.lacounty.gov/datasets/los-angeles-county-public-works-road-maintenance-division-street-sweeping-routes',
      license: TERMS, fetched: today },
    { name: 'CAMS Address Lines (LA County eGIS)', url: 'https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/eGIS_Addressing_ROAD_LINES/FeatureServer/0', license: TERMS, fetched: today },
    { name: 'Unincorporated LA County communities (Board of Supervisors boundaries)', url: 'https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Unincorporated_LA_County/FeatureServer/0', license: TERMS, fetched: today },
  ];
  const sidesCount = out.reduce((n, b) => n + b.d.length, 0);
  const format = 'b[] = {c: CAMS SourceID, s: street, l: cross streets, h: unincorporated community, n: [lowest, highest house number], o: the side with odd numbers (L|R), '
    + 'g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; rule = [jsDow, from, to, weeksMask (31 = every week), monthsMask (0 = all year), '
    + 'flags (1: the Sheriff enforces posted hours on County holidays, when the sweeper does not come)]';
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({ _meta: { city: 'la-county', time_zone: 'America/Los_Angeles', generated, sources,
    blocks: out.length, sides: sidesCount, format }, b: out }));
  const size = fs.statSync(OUT + 'segments.json').size;

  let w = 180, s = 90, e = -180, n = -90;
  for (const b of out) for (const [lo, la] of b.g) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < s) s = la; if (la > n) n = la; }
  // the busiest communities for the welcome card: most swept block sides
  const byComm = new Map();
  for (const b of out) if (b.h) { const x = byComm.get(b.h) || { n: 0, w: 180, s: 90, e: -180, nn: -90 }; x.n += b.d.length;
    for (const [lo, la] of b.g) { x.w = Math.min(x.w, lo); x.e = Math.max(x.e, lo); x.s = Math.min(x.s, la); x.nn = Math.max(x.nn, la); } byComm.set(b.h, x); }
  const hoods = [...byComm].sort((a, b) => b[1].n - a[1].n).slice(0, 12)
    .map(([name, x]) => ({ name, bbox: [x.w, x.s, x.e, x.nn].map((v) => Math.round(v * 1e4) / 1e4).join(','), sides: x.n }));
  const top = hoods[0];
  const center = top ? (() => { const [a, b, c, d] = top.bbox.split(',').map(Number); return [+((b + d) / 2).toFixed(4), +((a + c) / 2).toFixed(4)]; })() : [34.03, -118.16];
  const holidays = { ...countyHolidays(2026), ...countyHolidays(2027) };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify({
    id: 'la-county', name: 'Unincorporated LA County', region: 'California', tz: 'America/Los_Angeles',
    center, zoom: 15, bounds: [[s, w], [n, e]].map((p) => p.map((v) => Math.round(v * 1e5) / 1e5)),
    holidays, holidaysSource: 'https://pw.lacounty.gov/general/faq/index.cfm?Action=getAnswers&FaqID=JiNNNzBRTV9cCg%3D%3D',
    holidaysNote: 'Public Works does not sweep on County holidays, but the Sheriff still enforces posted parking rules: every rule carries flag 1 (not suspended). Dates by the County\'s holiday rules; Juneteenth and the weekend shifts unverified',
    holidayRule: 'all',
    fine: '$60', tow: 'no', fineSource: 'https://library.municode.com/ca/los_angeles_county/codes/code_of_ordinances?nodeId=TIT15VETR_DIV3PEFEREVISTPALA',
    fineNote: '$50 civil penalty for failure to obey signs (County Code 15.20.070, under which the Sheriff writes street sweeping tickets) plus $10 of court assessments (15.200.020)',
    agency: 'LA County Public Works (Road Maintenance)', ticketAgency: 'LA County Sheriff (Parking Enforcement Detail)',
    scheduleUrl: 'https://pw.lacounty.gov/rmd/streetsweeping/faqs.shtml',
    sources,
    words: {
      rule: 'Posted streets are swept once a week, on the day and in the hours on the sign, one curb at a time: each side of a street has its own sign.',
      afterpass: 'All year. On County holidays the sweeper skips, but the Sheriff still tickets during posted hours. About $60, no tow.',
      dataNotes: `Days and hours are Public Works' street sweeping map, which draws each curb as its own line; CURB laid each posted curb on the County's street centerline on the side it runs along. Streets without sweeping signs (${unposted.toLocaleString('en-US')} of the map's lines) are left out: nobody is ticketed there.`,
    },
    neighborhoods: hoods.map(({ name, bbox }) => ({ name, bbox })),
  }, null, 1));

  const rep = {
    generated,
    inputs: { sweepingLines: routes.features.length, posted, notPosted: unposted, curbLinesUsed: curbs.length, centerlines: r.cams.features.length },
    skippedPostedLines: skipped,
    placement: {
      method: 'curb lines sampled every 5 m (8 m left out at each end); each sample goes to the nearest centerline within 22 m running within ~30 degrees; a curb counts on a centerline side when it covers 35% of the block or 60 m, with 20 m at least (half of a block shorter than 25 m)',
      curbsPlaced: stats.placed, curbsNotPlaced: stats.unplaced.length, notPlacedExamples: stats.unplaced.slice(0, 8).map((C) => ({ id: C.id, schedule: C.p.SCHEDULE, time: C.p.TIME, at: C.c[0] })),
      samples: stats.samples, samplesPlaced: stats.samplesPlaced,
    },
    blocks: { withRules: out.length, sides: sidesCount, bothSides: r.bothSame + r.bothDiff, bothSidesDifferentDays: r.bothDiff, bothSidesSameRules: r.bothSame, oneSideOnly: r.oneSide,
      sidesWithTwoRulesOnOneWeekday: conflicts.length, conflictExamples: conflicts.slice(0, 8),
      curbMiles: +(out.reduce((a, b) => a + lineLen(b.g.map(xy)) * b.d.length, 0) / 1609.34).toFixed(0),
      postedCurbMilesInTheMap: +(curbs.reduce((a, C) => a + lineLen(C.pts), 0) / 1609.34).toFixed(0), sizeBytes: size },
    postedFieldIncomplete: (() => {
      // The layer's description: "*The contents of this field are incomplete. All posted street regulations apply regardless of
      // contents shown in this layer." Lines with no posting status but a full weekly schedule, by maintenance district.
      const by = {};
      for (const f of routes.features) {
        const p = f.properties, st = String(p.POSTED ?? '').trim();
        if (st) continue;
        const full = parseSchedule(p.SCHEDULE).length && parseTime(p.TIME) && parseFrequency(p.FREQUENCY);
        const k = 'MD ' + (p.MD ?? '?');
        (by[k] ||= { lines: 0, withDayHoursWeekly: 0 }).lines++;
        if (full) by[k].withDayHoursWeekly++;
      }
      return { note: 'left out: POSTED is empty, and the County says the field is incomplete (all of district 3: View Park/Windsor Hills, Athens-Westmont, West Carson, Ladera Heights, Lennox...; parts of district 1: Valinda, Bassett, San Jose Hills)', byDistrict: by };
    })(),
    timeField: 'the layer describes TIME as "time route is typically swept"; taken as the posted no-parking hours (Board traffic orders read the same, e.g. 7 to 11 a.m.)',
    crossCheck: 'none: the County publishes no parking citations (the Sheriff writes over 24,000 a month; street sweeping heads its list of citations to be aware of)',
    season: 'none: all year',
    holidays: 'no sweeping on County holidays, but the Sheriff enforces posted parking regulations then (Public Works FAQ): rules carry flag 1',
    privacy: 'the layer\'s editor user names and ROUTE_NUMBER (some route labels are first names) are not read',
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(rep, null, 1));
  log(`wrote data/la-county/segments.json (${Math.round(size / 1024)} KB), city.json, report.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await main();
  if (r) await write(r);
}
