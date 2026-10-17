#!/usr/bin/env node
// Boston for CURB (prototype, started 2026-10-16; plan in docs/multi-city/). Builds data/boston/ from
// three public City of Boston sources:
//
//   1. Street Sweeping Schedules (Public Works, Analyze Boston, ODC PDDL): which blocks are swept when.
//      It has no geometry: a row names a street, two cross streets and a side (Odd or Even), so each row
//      is attached to the City's street centerlines (2) by walking that street from one cross street to
//      the other, keeping the walk whose length is closest to the row's own length.
//   2. Boston Street Segments (SAM, ArcGIS): 19,440 centerlines with address ranges. They give the block
//      lines, the cross streets of each block and which side holds the odd house numbers.
//   3. The Curb Lab's Curbs API (Curb Data Specification): every curb zone with its posted policies, read
//      from sign photos. It gives the paid, resident permit, accessible and loading curbs, and a check of
//      its own sweeping signs against the schedule (report.json).
//
// Writes data/boston/segments.json (swept blocks + rules: the map, the sheet), data/boston/curbs.json (the
// Curb Lab layers) and data/boston/report.json (match and coverage numbers).
//
// Run: node scripts/cities/boston.mjs [--refresh]   (Node 18+, no deps; inputs cached in private/cache/boston/)

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clean, DOW3, isSweepSign, classifyPolicy } from './boston-curbs.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/boston/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/boston/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[boston]', ...a);

const SCHEDULE = 'https://data.boston.gov/api/3/action/datastore_search?resource_id=9fdbdcad-67c8-4b23-b6ec-861e77d56227&limit=10000';
const SAM = 'https://gisportal.boston.gov/arcgis/rest/services/SAM/Live_SAM_Address/FeatureServer/3/query';
// The Curb Lab's API. cds-curb-api.boston.gov serves the same API, but its certificate expired on
// 2026-07-28, so the build reads the Cloud Run address the City's own beta map (OETBoston/curb-atlas) uses.
const CDS = 'https://smart-curb-api-726931983438.us-east4.run.app';
const CITY_BBOX = 'min_lng=-71.20&min_lat=42.22&max_lng=-70.98&max_lat=42.40';

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-boston-build (+https://curb.guide)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 2000 * i));
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

// ---------- 1. inputs -----------------------------------------------------------------------------

const schedule = await cached('schedule.json', async () => {
  log('fetching the sweeping schedule…');
  return (await getJSON(SCHEDULE)).result.records;
});

const sam = await cached('sam-segments.json', async () => {
  log('fetching street segments…');
  const out = [];
  for (let off = 0; ; off += 2000) {
    const q = new URLSearchParams({ where: '1=1', outSR: '4326', f: 'geojson', resultOffset: off, resultRecordCount: 2000,
      orderByFields: 'OBJECTID', outFields: 'SEGMENT_ID,L_F_ADD,L_T_ADD,R_F_ADD,R_T_ADD,PRE_DIR,ST_NAME,ST_TYPE,SUF_DIR,NBHD_L,NBHD_R' });
    const page = (await getJSON(`${SAM}?${q}`)).features || [];
    out.push(...page);
    if (page.length < 2000) return out;
  }
});

const cdsZones = await cached('cds-zones.json', async () => {
  log('fetching Curb Lab zones…');
  const out = [];
  for (let off = 0; ; off += 10000) {
    const page = (await getJSON(`${CDS}/curbs/zones?${CITY_BBOX}&limit=10000&offset=${off}`)).data.zones;
    out.push(...page);
    if (page.length < 10000) return out;
  }
});

const cdsPolicies = await cached('cds-policies.json', async () => {
  log('fetching Curb Lab policies…');
  const ids = [...new Set(cdsZones.flatMap((z) => z.curb_policy_ids || []).filter(Boolean))].sort();
  const out = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...(await getJSON(`${CDS}/curbs/policies?ids=${ids.slice(i, i + 150).join(',')}`)).data.policies);
  return out;
});
log(`${schedule.length} schedule rows, ${sam.length} street segments, ${cdsZones.length} curb zones, ${cdsPolicies.length} policies`);

// ---------- 2. street names and the street graph ---------------------------------------------------

const LAT0 = 42.33, LON0 = -71.07, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const lineLen = (c) => { let s = 0; for (let i = 1; i < c.length; i++) { const a = xy(c[i - 1]), b = xy(c[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };

const TYPE = { STREET: 'ST', ST: 'ST', AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE', ROAD: 'RD', RD: 'RD', PLACE: 'PL', PL: 'PL',
  TERRACE: 'TER', TER: 'TER', COURT: 'CT', CT: 'CT', SQUARE: 'SQ', SQ: 'SQ', BOULEVARD: 'BLVD', BLVD: 'BLVD', DRIVE: 'DR',
  DR: 'DR', LANE: 'LN', LN: 'LN', CIRCLE: 'CIR', CIR: 'CIR', CR: 'CIR', PARKWAY: 'PKWY', PKWY: 'PKWY', HIGHWAY: 'HWY',
  HWY: 'HWY', WHARF: 'WHRF', WHRF: 'WHRF', PLAZA: 'PLZ', PLZ: 'PLZ', ALLEY: 'ALY', ALY: 'ALY', TURNPIKE: 'TPKE', TPKE: 'TPKE' };
const ORD = { FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH', SIXTH: '6TH', SEVENTH: '7TH',
  EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH', ELEVENTH: '11TH', TWELFTH: '12TH' };
const DIR = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };
// The schedule's spelling → SAM's, for names the rules below can't reconcile (typos, renamed streets).
const ALIAS = { 'THONRDIKE ST': 'THORNDIKE ST', 'WENOAH ST': 'WENONAH ST', 'PATSON AVE': 'PAYSON AVE', 'MERILL ST': 'MERRILL ST',
  'SCHULYER ST': 'SCHUYLER ST', 'HARBORVIEW ST': 'HARBOR VIEW ST', 'JOE L SMITH WAY': 'BISHOP JOE L SMITH WAY',
  'MARTIN LUTHER KING BLVD': 'MARTIN LUTHER KING JR BLVD', 'REV R A BURKE ST': 'REV RICHARD A BURKE ST', 'LA GRANGE ST': 'LAGRANGE ST',
  'DEVINE WAY': 'GENERAL WILLIAM H DEVINE WAY', 'SONGIN FATHER ANTHONY WAY': 'FATHER ANTHONY SONGIN WAY', 'YAWKEY WAY': 'JERSEY ST' };
// One spelling per street: "East Ninth Street" and "E 9TH ST" both become "E 9TH ST", "Mt Vernon St" is SAM's "MOUNT VERNON ST".
function streetKey(s) {
  const w = String(s || '').toUpperCase().replace(/[.,'’"]/g, '').trim().split(/\s+/).filter(Boolean).map((x) => ORD[x] || x);
  if (w.length > 1 && TYPE[w[w.length - 1]]) w[w.length - 1] = TYPE[w[w.length - 1]];
  if (w.length > 1 && w[w.length - 1] === 'GREEN') w[w.length - 1] = 'GRN';
  if (w.length > 1 && DIR[w[0]]) w[0] = DIR[w[0]];
  if (w.length > 1 && DIR[w[w.length - 1]]) w[w.length - 1] = DIR[w[w.length - 1]];
  if (w.length > 2 && w[0] === 'MT') w[0] = 'MOUNT';
  if (w.length > 2 && w[0] === 'ST') w[0] = 'SAINT';
  const k = w.join(' ');
  return ALIAS[k] || k;
}
const samKey = (p) => streetKey([p.PRE_DIR, p.ST_NAME, p.ST_TYPE, p.SUF_DIR].filter(Boolean).join(' '));
const title = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, n, x) => n + x.toLowerCase());
const samName = (p) => title([p.PRE_DIR, p.ST_NAME, p.ST_TYPE, p.SUF_DIR].filter(Boolean).join(' '));

const nodeId = ([lon, lat]) => lon.toFixed(5) + ',' + lat.toFixed(5);
const segs = [];
for (const f of sam) {
  const c = f.geometry && f.geometry.coordinates, p = f.properties;
  if (!c || c.length < 2 || !p.ST_NAME) continue;
  segs.push({ id: String(p.SEGMENT_ID), p, c, a: nodeId(c[0]), b: nodeId(c[c.length - 1]), key: samKey(p), name: samName(p), len: lineLen(c) });
}
const nodeStreets = new Map(), byStreet = new Map();
for (const s of segs) {
  for (const n of [s.a, s.b]) {
    if (!nodeStreets.has(n)) nodeStreets.set(n, new Map());
    nodeStreets.get(n).set(s.key, s.name);
  }
  if (!byStreet.has(s.key)) byStreet.set(s.key, []);
  byStreet.get(s.key).push(s);
}

// ---------- 3. schedule rows → blocks -------------------------------------------------------------

const adjCache = new Map();
function adjacency(key) {
  if (adjCache.has(key)) return adjCache.get(key);
  const adj = new Map();
  for (const s of byStreet.get(key) || []) for (const [n, m] of [[s.a, s.b], [s.b, s.a]]) {
    if (!adj.has(n)) adj.set(n, []);
    adj.get(n).push([m, s]);
  }
  adjCache.set(key, adj);
  return adj;
}
// Nodes of `key` where cross street `cross` meets it; for a missing or unknown cross street, the street's ends.
function crossNodes(key, cross) {
  const adj = adjacency(key), ck = streetKey(cross);
  const hits = ck ? [...adj.keys()].filter((n) => nodeStreets.get(n).has(ck)) : [];
  if (hits.length) return { nodes: hits, exact: true };
  return { nodes: [...adj.keys()].filter((n) => adj.get(n).length === 1), exact: false };
}
// The walk along `key` from a node in A to a node in B whose length is closest to `target` meters.
function walk(key, A, B, target) {
  const adj = adjacency(key);
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
      const err = Math.abs(dist.get(t) - target);
      if (best && err >= best.err) continue;
      const path = [];
      for (let n = t; n !== f;) { const [pn, s] = prev.get(n); path.unshift({ s, fwd: s.a === pn }); n = pn; }
      best = { err, len: dist.get(t), path };
    }
  }
  return best;
}

const flip = (side) => (side === 'L' ? 'R' : 'L');
const parity = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n % 2 : null; };
// Which side of the segment (looking from its first point to its last) holds the odd house numbers.
function oddSide(p) {
  const l = parity(p.L_F_ADD) ?? parity(p.L_T_ADD), r = parity(p.R_F_ADD) ?? parity(p.R_T_ADD);
  if (l === 1 && r !== 1) return 'L';
  if (r === 1 && l !== 1) return 'R';
  return null;
}
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const yes = (v) => String(v).toLowerCase() === 't' || v === true;
const hourOf = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? +m[1] : null; };

const blocks = new Map();   // segment id → { s: segment, street, hood, sides: Map(side → Map(ruleKey → rule)) }
const report = { rows: schedule.length, matched: 0, exactBothEnds: 0, unmatched: [], sideUnknown: 0 };
for (const row of schedule) {
  const key = streetKey(row.st_name);
  const days = DAYS.map((d, i) => (yes(row.every_day) || yes(row[d]) ? i : -1)).filter((i) => i >= 0);
  let fromH = hourOf(row.start_time), toH = hourOf(row.end_time);
  if (!byStreet.has(key) || !days.length || fromH === null || toH === null) {
    report.unmatched.push({ id: row.main_id, st: row.st_name, from: row.from, to: row.to, why: !byStreet.has(key) ? 'street name' : 'schedule' });
    continue;
  }
  if (toH <= fromH && fromH >= 8) toH += 12;              // 5 rows read 12:00 to 04:00: 4 PM
  const A = crossNodes(key, row.from), B = crossNodes(key, row.to);
  // The row's length: `miles`, else its two stations along the street (hista - losta, in feet).
  const target = (parseFloat(row.miles) || 0) * 1609.34 || Math.max(0, (parseFloat(row.hista) || 0) - (parseFloat(row.losta) || 0)) * 0.3048;
  const w = walk(key, A.nodes, B.nodes, target);
  const lenOk = target > 0 ? w && w.err <= Math.max(80, 0.4 * target) : w && A.exact && B.exact;
  if (!lenOk) {
    report.unmatched.push({ id: row.main_id, st: row.st_name, from: row.from, to: row.to, why: w ? `length ${Math.round(w.len)} m vs ${Math.round(target)} m` : 'no walk' });
    continue;
  }
  report.matched++;
  if (A.exact && B.exact) report.exactBothEnds++;
  // Odd side along the walk: a vote of the segments that have house numbers.
  let vote = 0;
  for (const { s, fwd } of w.path) { const o = oddSide(s.p); if (o) vote += (fwd ? o : flip(o)) === 'L' ? 1 : -1; }
  const oddWalk = vote > 0 ? 'L' : vote < 0 ? 'R' : null;
  const sideWord = String(row.side || '').toLowerCase();
  const which = /odd/.test(sideWord) ? 'odd' : /even/.test(sideWord) ? 'even' : 'both';
  if (which !== 'both' && !oddWalk) report.sideUnknown++;
  const mask = [1, 2, 3, 4, 5].reduce((m, n, i) => m | (yes(row[`week_${n}`]) ? 1 << i : 0), 0);
  const months = yes(row.year_round) ? 0 : yes(row.north_end_pilot) ? 0b111111111100 : 0b011111111000; // bit m-1: Mar-Dec or Apr-Nov
  // overnight (1): runs on holidays, $90, no tow; daytime is towable (2), except in Charlestown ($90, no tow)
  const flags = fromH < 6 ? 1 : /charlestown/i.test(row.dist_name) ? 0 : 2;
  const walkSide = which === 'both' || !oddWalk ? null : which === 'odd' ? oddWalk : flip(oddWalk);   // the row's side, along the walk
  for (const { s, fwd } of w.path) {
    const sides = walkSide ? [fwd ? walkSide : flip(walkSide)] : ['L', 'R'];
    if (!blocks.has(s.id)) blocks.set(s.id, { s, street: row.st_name, hood: row.dist_name, sides: new Map() });
    const blk = blocks.get(s.id);
    for (const side of sides) {
      if (!blk.sides.has(side)) blk.sides.set(side, new Map());
      for (const dow of days) {
        const rule = [dow, fromH, toH, mask, months, flags];
        blk.sides.get(side).set(rule.join('|'), rule);
      }
    }
  }
}

// Cross streets of a block: the other streets at each end ("Milk St - Summer St").
function limitsOf(s) {
  const at = (n) => [...nodeStreets.get(n).entries()].filter(([k]) => k !== s.key).map(([, v]) => v).sort()[0] || '';
  const a = at(s.a), b = at(s.b);
  return a && b ? `${a} - ${b}` : a || b;
}
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const out = [];
for (const [id, blk] of blocks) {
  const s = blk.s, hood = blk.hood || title(s.p.NBHD_L || s.p.NBHD_R || '');
  const nums = ['L_F_ADD', 'L_T_ADD', 'R_F_ADD', 'R_T_ADD'].map((k) => parseInt(s.p[k], 10)).filter((v) => v > 0);
  const odd = oddSide(s.p);
  out.push({ c: id, s: blk.street, l: limitsOf(s), h: hood, ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}),
    ...(odd ? { o: odd } : {}),
    g: s.c.map(([lo, la]) => [r5(lo), r5(la)]),
    d: [...blk.sides.entries()].map(([side, rules]) => [side, compass(s.c, side), [...rules.values()]]) });
}
out.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));

// ---------- 4. the Curb Lab layers and its sweeping signs -----------------------------------------

const pol = new Map(cdsPolicies.map((p) => [p.curb_policy_id, p]));

const layers = { paid: [], permit: [], accessible: [], loading: [], limit: [], snow: [], nostop: [] };
const signSweep = [];       // {c: zone line, spans} of every sweeping sign, for the check below
let unreadable = 0, noPolicy = 0;
for (const z of cdsZones) {
  const ps = (z.curb_policy_ids || []).map((i) => pol.get(i)).filter(Boolean);
  if (!ps.length) { noPolicy++; continue; }
  if (ps.every((p) => (p.rules || []).every((r) => r.activity === 'unusable image'))) { unreadable++; continue; }
  if (!z.geometry || z.geometry.type !== 'LineString') continue;
  const g = z.geometry.coordinates.map(([lo, la]) => [r5(lo), r5(la)]);
  for (const p of ps) for (const [k, fields] of classifyPolicy(p)) layers[k].push({ g, ...fields });
  const sw = ps.filter(isSweepSign);
  if (sw.length) signSweep.push({ c: z.geometry.coordinates, spans: sw.flatMap((p) => p.time_spans || []).filter(Boolean) });
}
for (const k of Object.keys(layers)) {   // one entry per zone and layer (a zone can repeat a policy)
  const seen = new Set();
  layers[k] = layers[k].filter((e) => { const id = JSON.stringify(e); return !seen.has(id) && seen.add(id); });
}

// Each sweeping sign → the nearest block side; does the schedule agree there?
const CELL = 60, TOL = 25, cell = (v) => Math.floor(v / CELL), grid = new Map();
for (const s of segs) {
  const pts = s.c.map(xy);
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    for (let cx = cell(Math.min(x1, x2) - TOL); cx <= cell(Math.max(x1, x2) + TOL); cx++)
      for (let cy = cell(Math.min(y1, y2) - TOL); cy <= cell(Math.max(y1, y2) + TOL); cy++) {
        const k = cx + ',' + cy;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([x1, y1, x2, y2, s]);
      }
  }
}
function nearestSide(c) {
  const pts = c.map(xy), a = pts[0], b = pts[pts.length - 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const [px, py] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let best = null;
  for (const [x1, y1, x2, y2, s] of grid.get(cell(px) + ',' + cell(py)) || []) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy; if (!l2) continue;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
    const d = Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
    const along = Math.abs((dx * (b[0] - a[0]) + dy * (b[1] - a[1])) / (Math.sqrt(l2) * len));
    if (d <= TOL && along > 0.85 && (!best || d < best.d)) best = { d, s, side: dx * (py - y1) - dy * (px - x1) > 0 ? 'L' : 'R' };
  }
  return best;
}
const check = { signSides: 0, agree: 0, differ: 0, signOnly: 0, weeksAgree: 0, weeksOtherSide: 0 };
// a sign span matches a rule on its weekday and start hour, and on its weeks when `weeks` and the sign has them
const matches = (spans, rules, weeks) => !!rules && spans.some((t) => clean(t.days_of_week).some((d) => [...rules.values()].some((r) =>
  DOW3[r[0]] === d && r[1] === hourOf(t.time_of_day_start) && (!weeks || !t.weeks_of_month || t.weeks_of_month.every((n) => r[3] & (1 << (n - 1)))))));
const signed = new Set();
for (const z of signSweep) {
  const hit = nearestSide(z.c); if (!hit) continue;
  const k = hit.s.id + '|' + hit.side; if (signed.has(k)) continue;
  signed.add(k); check.signSides++;
  const sides = blocks.get(hit.s.id)?.sides, rules = sides?.get(hit.side);
  if (!rules) { check.signOnly++; continue; }
  matches(z.spans, rules, false) ? check.agree++ : check.differ++;
  // Odd and even: the sign's weeks (1st & 3rd vs 2nd & 4th) on this side, or only on the other side of the street?
  if (matches(z.spans, rules, true)) check.weeksAgree++;
  else if (matches(z.spans, sides.get(flip(hit.side)), true)) check.weeksOtherSide++;
}
const schedSides = out.reduce((n, b) => n + b.d.length, 0);

// Every curb zone → the swept block side it sits on, so a tapped curb lists its posted rules without loading the
// zones' geometry (curbs.json, for the map layers). rules.json: t = each distinct [layer, fields] once, s = side → t indexes.
const ruleAt = new Map(), ruleList = [], sideRules = {};
for (const [k, list] of Object.entries(layers)) for (const { g, ...fields } of list) {
  const hit = nearestSide(g); if (!hit || !blocks.get(hit.s.id)?.sides.has(hit.side)) continue;
  const id = JSON.stringify([k, fields]);
  if (!ruleAt.has(id)) { ruleAt.set(id, ruleList.length); ruleList.push([k, fields]); }
  const at = (sideRules[hit.s.id + '|' + hit.side] ||= []);
  if (!at.includes(ruleAt.get(id))) at.push(ruleAt.get(id));
}

// ---------- 5. write -------------------------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);
const sources = [
  { name: 'Street Sweeping Schedules (Public Works)', url: 'https://data.boston.gov/dataset/street-sweeping-schedules', license: 'ODC PDDL', fetched: today },
  { name: 'Boston Street Segments (SAM)', url: 'https://data.boston.gov/dataset/boston-street-segments-sam-system', license: 'ODC PDDL', fetched: today },
  { name: 'Curb Lab Curbs API (Curb Data Specification, beta)', url: 'https://www.boston.gov/curb-lab', license: 'not stated', fetched: today },
];
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
  _meta: { city: 'boston', time_zone: 'America/New_York', generated: new Date().toISOString(), sources,
    blocks: out.length, sides: schedSides,
    format: 'b[] = {c: SAM segment id, s: street, l: cross streets, h: neighborhood, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
      + 'rule = [jsDow, fromH, toH, weeksMask (bit i = week i+1), monthsMask (bit m-1; 0 = all year), flags (1 = overnight program, not suspended on holidays; 2 = towable)]' },
  b: out }));
fs.writeFileSync(OUT + 'curbs.json', JSON.stringify({
  _meta: { generated: new Date().toISOString(), source: sources[2], zones: cdsZones.length, unreadable, noPolicy,
    note: 'Curb zones read from sign photos by the Curb Lab (beta), sorted by scripts/cities/boston-curbs.mjs. paid = parking with a rate (zone = ParkBoston zone), '
      + 'permit = resident permit (only = residents only, max = everyone else\'s limit), accessible, loading (who = commercial|passenger|bus|rideshare|valet|short), '
      + 'limit = free parking with a time limit over 30 min, snow = no parking in a declared snow emergency, nostop = no stopping (stop) or no parking, anytime when "when" is empty.' },
  ...layers }));
fs.writeFileSync(OUT + 'rules.json', JSON.stringify({
  _meta: { generated: new Date().toISOString(), source: sources[2], sides: Object.keys(sideRules).length,
    format: 't = [[layer, fields]] (fields as in curbs.json, without g); s = {"<block c>|<side L|R>": [indexes into t]}' },
  t: ruleList, s: sideRules }));
const rep = {
  generated: new Date().toISOString(),
  schedule: { rows: report.rows, matched: report.matched, exactBothEnds: report.exactBothEnds, sideUnknown: report.sideUnknown,
    unmatched: report.unmatched.length, blocks: out.length, blockSides: schedSides },
  curbLab: { zones: cdsZones.length, unreadableOnly: unreadable, noPolicy, paid: layers.paid.length, permit: layers.permit.length,
    accessible: layers.accessible.length, loading: layers.loading.length, limit: layers.limit.length, snow: layers.snow.length,
    nostop: layers.nostop.length, sweepingSignSides: check.signSides,
    signAgreesWithSchedule: check.agree, signDiffers: check.differ, signWhereScheduleHasNone: check.signOnly,
    scheduleSidesWithASign: check.agree + check.differ, signWeeksAgree: check.weeksAgree, signWeeksOnlyOtherSide: check.weeksOtherSide },
  unmatchedRows: report.unmatched,
};
fs.writeFileSync(OUT + 'report.json', JSON.stringify(rep, null, 1));
log(`schedule: ${report.matched}/${report.rows} rows matched (${report.exactBothEnds} at both cross streets), ${out.length} blocks, ${schedSides} block sides, side unknown on ${report.sideUnknown} rows`);
log(`curb lab: ${cdsZones.length} zones (${unreadable} unreadable only, ${noPolicy} without policy); ${Object.entries(layers).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
log(`sweeping signs on ${check.signSides} block sides: ${check.agree} agree with the schedule, ${check.differ} differ, ${check.signOnly} where the schedule has none; weeks agree on ${check.weeksAgree}, match only the other side on ${check.weeksOtherSide}`);
for (const f of ['segments.json', 'curbs.json', 'rules.json', 'report.json']) log(`wrote data/boston/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
