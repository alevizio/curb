#!/usr/bin/env node
// Sacramento for CURB (data build, 2026-10-18; docs/multi-city/city-build.md, research in docs/multi-city/sacramento.md).
// Only parts of Downtown and Midtown have signed parking restrictions for street sweeping ("City Services": sweeping,
// garbage and leaf collection), 8 AM to noon on one weekday per side: Monday the south side of lettered streets, Tuesday the
// north side, Wednesday the west side of numbered streets, Thursday the east side. Weekly on blocks with weekly garbage
// service, the first week of the month on the others. Builds data/sacramento/ from:
//
//   1. City of Sacramento On-street Parking Data (Public Works, ArcGIS ONSTREETPARKING, edited daily): 45,738 points,
//      one per curb space or address; 7,497 carry a sweeping day (PKGSDAY) and hours (PKGSWBEG/PKGSWEND). Each point is
//      put on the County street centerline of its street that it sits beside, on the side it is on, and the points of one
//      block side make that side's rule (the day most of them give; disagreements are reported).
//   2. Sacramento County Street Centerlines (BASE_MAP_LABELS layer 7): the block lines, with address ranges, node ids
//      for the cross streets and UNIQUE_ID, the segment id the City's own sign inventory uses.
//   3. The City's Streetsweep Sign Inventory (StreetServicesSignInventory_VW, June 2018): every signed block face with its
//      service day and whether it stayed weekly or went monthly in the 2018 change. Today's parking data does not say
//      weekly or monthly, so this is where it comes from.
//   4. City of Sacramento Neighborhoods: the neighborhood of each block.
//
// Run: node scripts/cities/sacramento.mjs [--refresh]   (Node 18+; inputs cached in private/cache/sacramento/, ~80 MB)
// Tests: npx vitest run scripts/cities/sacramento.test.mjs

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/sacramento/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/sacramento/';
const log = (...a) => console.error('[sacramento]', ...a);

const CITY = 'https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services';
const PARKING = `${CITY}/ONSTREETPARKING/FeatureServer/0/query`;
const INVENTORY = `${CITY}/StreetServicesSignInventory_VW/FeatureServer/0/query`;
const NEIGHBORHOODS = `${CITY}/Neighborhoods/FeatureServer/0/query`;
const CENTERLINES = 'https://mapservices.gis.saccounty.net/arcgis/rest/services/BASE_MAP_LABELS/MapServer/7/query';

// ---------- the parking points --------------------------------------------------------------------

export const DOW = { MON: 1, TUES: 2, WED: 3, THUR: 4 };
// The City's scheme (CBS13, 2018-06-28, from the City's notice; the sign inventory's SERVICE_DAY says the same).
export const DAY_SIDE = { 1: 'South', 2: 'North', 3: 'West', 4: 'East' };
const SERVICE_DAY = { 1: 'MONDAY-SOUTH', 2: 'TUESDAY-NORTH', 3: 'WEDNESDAY-WEST', 4: 'THURSDAY-EAST' };
// "TUES" → { dow: 2, first: false }; "1ST WED" → { dow: 3, first: true }; anything else → null
export function dayOf(s) {
  const m = /^\s*(1ST\s+)?(MON|TUES|WED|THUR)\s*$/i.exec(String(s || ''));
  return m ? { dow: DOW[m[2].toUpperCase()], first: !!m[1] } : null;
}
// "8 am" → 8, "12 pm" → 12, "11 am" → 11, "9:30 am" → "9:30"; anything else → null
export function parseHour(s) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*$/i.exec(String(s || ''));
  if (!m) return null;
  const h = (+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  return m[2] && m[2] !== '00' ? `${h}:${m[2]}` : h;
}
const ORD = (n) => n + (/1[123]$/.test(n) ? 'TH' : { 1: 'ST', 2: 'ND', 3: 'RD' }[n.slice(-1)] || 'TH');
const TYPES = new Set(['ST', 'AVE', 'BLVD', 'WAY', 'MALL', 'DR', 'RD', 'CT', 'PL', 'LN', 'ALY']);
/* A parking point's street as the County spells it (FULLSTREET). The point keeps the street in three fields:
   STREET '23', SUFFIX 'RD', PREFIX 'ST' → "23RD ST"; STREET 'E', PREFIX 'ST' → "E ST"; STREET 'Capitol', PREFIX 'AVE'
   → "CAPITOL AVE"; a few have the type in SUFFIX ("O", "ST"), no ordinal ("11") or "North D" (the County's "N D ST"). */
export function pointStreet(p) {
  let name = String(p.STREET || '').trim().toUpperCase().replace(/^NORTH\s+/, 'N ');
  let suf = String(p.SUFFIX || '').trim().toUpperCase(), type = String(p.PREFIX || '').trim().toUpperCase();
  if (!type && TYPES.has(suf)) { type = suf; suf = ''; }
  if (/^\d+$/.test(name)) name = suf && /^(ST|ND|RD|TH)$/.test(suf) ? name + suf : ORD(name);
  return name ? (type ? `${name} ${type}` : name) : '';
}

// ---------- geometry ----------------------------------------------------------------------------------

const LAT0 = 38.57, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [lon * KX, lat * KY];
/* The point's distance to a line ([[x, y]] in meters) and the side it is on, looking from the first point to the last. */
export function sideAt(pts, [px, py]) {
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    if (!l2) continue;
    const u = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)), d = Math.hypot(px - x1 - u * dx, py - y1 - u * dy);
    if (!best || d < best.d) best = { d, side: dx * (py - y1) - dy * (px - x1) > 0 ? 'L' : 'R' };
  }
  return best;
}
// The compass word for a side, from the direction its normal points (first to last point): Boston's compass().
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
// Does the side's compass word fit the City's word for its day? (The central grid is turned about 20° from north.)
export const fits = (word, cityWord) => word.includes(cityWord) || word.toLowerCase().includes(cityWord.toLowerCase());
function inPolygon([x, y], rings) {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- one block side from its points ----------------------------------------------------------

/* The points of one block side → { rule: [dow, from, to, weeks, months, flags], day, ... } with:
   - the day most points give (a tie goes to the day whose City side matches `word`, the side's compass word);
   - the hours most points of that day give (8 to noon when none);
   - weekly or the first week of the month: monthly if a point says "1ST", else the 2018 sign inventory (`inv`:
     'weekly' | 'monthly' | null), else weekly (the stricter reading, reported);
   - months 0 (all year: the signs name no season; sweeping runs February to October and leaf collection November to
     January on the same days), flags 1 (holidays don't stop it: the City collects garbage and leaves on holidays and
     enforces parking 7 days a week, including holidays). */
export function sideRule(points, word, inv) {
  const byDay = new Map();
  for (const p of points) { const d = dayOf(p.PKGSDAY); if (d) byDay.set(d.dow, [...(byDay.get(d.dow) || []), { ...p, first: d.first }]); }
  if (!byDay.size) return null;
  const score = (dow) => byDay.get(dow).length + (word && fits(word, DAY_SIDE[dow]) ? 0.5 : 0);
  const dow = [...byDay.keys()].sort((a, b) => score(b) - score(a))[0];
  const mine = byDay.get(dow);
  const wins = new Map();
  for (const p of mine) { const f = parseHour(p.PKGSWBEG), t = parseHour(p.PKGSWEND); if (f !== null && t !== null) { const k = f + '|' + t; wins.set(k, (wins.get(k) || 0) + 1); } }
  const [win] = [...wins.entries()].sort((a, b) => b[1] - a[1])[0] || ['8|12'];
  const [from, to] = win.split('|').map((v) => (/:/.test(v) ? v : +v));
  const first = mine.some((p) => p.first);
  const weekly = first ? false : inv === 'weekly' ? true : inv === 'monthly' ? false : true;
  return { rule: [dow, from, to, weekly ? 31 : 1, 0, 1], dow, points: points.length, onDay: mine.length,
    otherDays: [...byDay.entries()].filter(([d]) => d !== dow).map(([d, l]) => [d, l.length]),
    windows: wins.size, weeklyFrom: first ? '1ST in the parking data' : inv ? '2018 sign inventory' : 'no record: weekly assumed' };
}
// The 2018 inventory's record of a face → 'weekly' | 'monthly' | null
export function inventoryStatus(r) {
  if (!r) return null;
  if (r.Status === 'ToMonthly' || r.Status === 'NewMonthly') return 'monthly';
  if (r.Status === 'NewWeekly') return 'weekly';
  return r.STNEEDWKLY === 'YES' ? 'weekly' : r.STNEEDWKLY === 'NO' ? 'monthly' : null;
}

// ---------- city facts ------------------------------------------------------------------------------

// City of Sacramento holidays (cityofsacramento.gov/city-government/holiday-schedule, read 2026-10-18: the 2026 list and
// New Year's Day 2027; its two half days, Dec. 24 and Dec. 31, are left out). 2027 after New Year's Day is not posted:
// the same holidays by the City's rule (a Saturday holiday observed the Friday before, a Sunday one the Monday after, as
// July 3, 2026). The page says "Regular residential garbage, organic waste and recycling collection service will occur on
// holidays", so no rule here is suspended on them (flags 1): this list is for the holiday page only.
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Presidents' Day",
  '2026-03-31': 'Cesar Chavez Day', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day', '2026-11-11': 'Veterans Day',
  '2026-11-26': 'Thanksgiving Day', '2026-11-27': 'Thanksgiving (observed)', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Presidents' Day",
  '2027-03-31': 'Cesar Chavez Day', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day', '2027-11-11': 'Veterans Day',
  '2027-11-25': 'Thanksgiving Day', '2027-11-26': 'Thanksgiving (observed)', '2027-12-24': 'Christmas Day (observed)',
  '2027-12-31': "New Year's Day (observed)",
};

// ---------- the build -------------------------------------------------------------------------------

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-sacramento-build (+https://curb.guide)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const j = await r.json();
      if (j.error) throw new Error(`${url}: ${JSON.stringify(j.error)}`);
      return j;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 2000 * i));
    }
  }
}
// Every feature of an ArcGIS layer query, page by page, as GeoJSON in WGS84.
async function arcgisAll(url, params, page) {
  const out = [];
  for (let off = 0; ; off += page) {
    const q = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'geojson', orderByFields: 'OBJECTID', resultOffset: off, resultRecordCount: page, ...params });
    const feats = (await getJSON(`${url}?${q}`)).features || [];
    out.push(...feats);
    if (feats.length < page) return out;
  }
}
async function cached(name, refresh, fetcher) {
  const f = CACHE + name;
  if (!refresh && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  log(`fetching ${name}…`);
  const v = await fetcher();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const points = (await cached('onstreetparking.geojson', refresh, async () => ({ type: 'FeatureCollection', features: await arcgisAll(PARKING, {}, 2000) }))).features;
  const sweepPts = points.filter((f) => f.properties.PKGSDAY && f.geometry);
  // The centerlines around the sweeping points, with a margin for the cross streets at the edges.
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const f of sweepPts) { const [x, y] = f.geometry.coordinates; w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const env = { xmin: +(w - 0.006).toFixed(3), ymin: +(s - 0.006).toFixed(3), xmax: +(e + 0.006).toFixed(3), ymax: +(n + 0.006).toFixed(3), spatialReference: { wkid: 4326 } };
  const centerlines = (await cached('county-centerlines.geojson', refresh, async () => ({ type: 'FeatureCollection', features: await arcgisAll(CENTERLINES, {
    geometry: JSON.stringify(env), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: 'OBJECTID,UNIQUE_ID,FULLSTREET,FULLSTREET_PROPER,PREFIXDIR,STREETNAME,STREETTYPE,SUFFIXDIR,LF_ACTUAL,LT_ACTUAL,RF_ACTUAL,RT_ACTUAL,CITYLEFT,CITYRIGHT,CLASS,PRIVATE,ONEWAY,FROMNODE,TONODE,SEGMENT_RANGE_DESCRIPTION,CONSTRUCTION_STATUS' }, 2000) }))).features;
  const inventory = (await cached('sign-inventory.geojson', refresh, async () => ({ type: 'FeatureCollection', features: await arcgisAll(INVENTORY, {}, 1000) }))).features;
  const hoods = (await cached('neighborhoods.geojson', refresh, async () => ({ type: 'FeatureCollection', features: await arcgisAll(NEIGHBORHOODS, { outFields: 'NAME' }, 1000) }))).features;

  // The data must look like it did on 2026-10-18, or the build below means something else.
  const need = (feats, keys, what, min) => {
    const miss = keys.filter((k) => !(k in (feats[0]?.properties || {})));
    if (feats.length < min || miss.length) throw new Error(`${what} changed shape: ${feats.length} features, missing ${miss.join(', ') || 'none'}`);
  };
  need(points, ['PKGSDAY', 'PKGSWBEG', 'PKGSWEND', 'EVENODD', 'STREET', 'SUFFIX', 'PREFIX', 'ADDRESS'], 'on-street parking', 40000);
  need(centerlines, ['UNIQUE_ID', 'FULLSTREET', 'FULLSTREET_PROPER', 'LF_ACTUAL', 'LT_ACTUAL', 'RF_ACTUAL', 'RT_ACTUAL', 'FROMNODE', 'TONODE', 'CLASS'], 'county centerlines', 1000);
  need(inventory, ['UNIQUE_ID', 'SERVICE_DAY', 'STNEEDWKLY', 'Status'], 'sign inventory', 1000);
  const badDays = [...new Set(sweepPts.map((f) => f.properties.PKGSDAY))].filter((d) => !dayOf(d));
  if (badDays.length) throw new Error(`new sweeping day values: ${badDays.join(', ')}`);

  // ---- 1. every sweeping point onto its street's centerline, on its side ----
  const segs = centerlines.filter((f) => f.geometry?.type === 'LineString').map((f) => ({ p: f.properties, c: f.geometry.coordinates, pts: f.geometry.coordinates.map(xy) }));
  const byStreet = new Map();
  for (const sg of segs) { const k = sg.p.FULLSTREET; if (!byStreet.has(k)) byStreet.set(k, []); byStreet.get(k).push(sg); }
  const snap = { points: sweepPts.length, placed: 0, noStreet: [], tooFar: [], renamed: [], parityAgree: 0, parityDisagree: 0, parityUnknown: 0, dist: [] };
  const sides = new Map();   // UNIQUE_ID|L|R → { seg, side, points: [props] }
  for (const f of sweepPts) {
    const p = f.properties, k = pointStreet(p), P = xy(f.geometry.coordinates);
    // the street as named, else without a leading direction: the data's "North D" spaces are on D St (the County's
    // N D St is 800 m away, north of the rail yard)
    const keys = [k, k.replace(/^[NSEW] /, '')].filter((x, i, a) => x && a.indexOf(x) === i);
    if (!keys.some((x) => byStreet.has(x))) { snap.noStreet.push(k || '(none)'); continue; }
    let best = null;
    for (const key of keys) {
      for (const sg of byStreet.get(key) || []) { const h = sideAt(sg.pts, P); if (h && (!best || h.d < best.d)) best = { ...h, sg }; }
      if (best && best.d <= 30) break;
    }
    if (!best || best.d > 30) { snap.tooFar.push(k); continue; }
    if (best.sg.p.FULLSTREET !== k) snap.renamed.push(`${k} → ${best.sg.p.FULLSTREET}`);
    snap.placed++; snap.dist.push(best.d);
    const q = best.sg.p, first = (a, b) => (a > 0 ? a : b > 0 ? b : 0);
    const oddL = first(q.LF_ACTUAL, q.LT_ACTUAL), oddR = first(q.RF_ACTUAL, q.RT_ACTUAL);
    const sideNum = best.side === 'L' ? oddL : oddR;
    if (!sideNum || !p.EVENODD) snap.parityUnknown++;
    else if ((sideNum % 2 === 1) === (p.EVENODD === 'ODD')) snap.parityAgree++; else snap.parityDisagree++;
    const key = q.UNIQUE_ID + '|' + best.side;
    if (!sides.has(key)) sides.set(key, { sg: best.sg, side: best.side, points: [], P: [] });
    sides.get(key).points.push(p); sides.get(key).P.push(P);
  }

  // ---- 2. weekly or monthly: the 2018 inventory face the points sit on (same service day), else the same segment id ----
  const faces = inventory.filter((f) => f.geometry).map((f) => ({ r: f.properties, pts: (f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat()).map(xy) }));
  const facesByDay = new Map();
  for (const fc of faces) { if (!facesByDay.has(fc.r.SERVICE_DAY)) facesByDay.set(fc.r.SERVICE_DAY, []); facesByDay.get(fc.r.SERVICE_DAY).push(fc); }
  const invById = new Map(inventory.map((f) => [f.properties.UNIQUE_ID + '|' + f.properties.SERVICE_DAY, f.properties]));
  const invStats = { byFace: 0, byId: 0, none: 0, weekly: 0, monthly: 0, assumedWeekly: 0, faceIdDiffers: 0 };

  // ---- 3. each block side's rule ----
  const blocks = new Map(), conflicts = [], labelMisfits = [], fewPoints = [];
  for (const [key, sd] of sides) {
    const word = compass(sd.sg.c, sd.side);
    const first = sideRule(sd.points, word, null);
    if (!first) continue;
    // the inventory faces under this side's points, for its day
    const votes = new Map();
    sd.points.forEach((p, i) => {
      const d = dayOf(p.PKGSDAY); if (!d || d.dow !== first.dow) return;
      let best = null;
      for (const fc of facesByDay.get(SERVICE_DAY[d.dow]) || []) { const h = sideAt(fc.pts, sd.P[i]); if (h && h.d <= 25 && (!best || h.d < best.d)) best = { d: h.d, fc }; }
      if (best) { const st = inventoryStatus(best.fc.r); if (st) votes.set(st, (votes.get(st) || 0) + 1); if (best.fc.r.UNIQUE_ID !== sd.sg.p.UNIQUE_ID) invStats.faceIdDiffers++; }
    });
    let inv = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    if (inv) invStats.byFace++;
    else { inv = inventoryStatus(invById.get(sd.sg.p.UNIQUE_ID + '|' + SERVICE_DAY[first.dow])); inv ? invStats.byId++ : invStats.none++; }
    const r = sideRule(sd.points, word, inv);
    if (r.weeklyFrom.startsWith('no record')) invStats.assumedWeekly++;
    r.rule[3] === 31 ? invStats.weekly++ : invStats.monthly++;
    if (r.otherDays.length || r.windows > 1)
      conflicts.push({ c: String(sd.sg.p.UNIQUE_ID), s: sd.sg.p.FULLSTREET_PROPER, side: sd.side, points: r.points, kept: `${['', 'Mon', 'Tue', 'Wed', 'Thu'][r.dow]} ${r.rule[1]}-${r.rule[2]} (${r.onDay})`,
        others: r.otherDays.map(([d, k]) => `${['', 'Mon', 'Tue', 'Wed', 'Thu'][d]} (${k})`).join(', ') || null, windows: r.windows });
    if (r.points <= 2) fewPoints.push({ c: String(sd.sg.p.UNIQUE_ID), s: sd.sg.p.FULLSTREET_PROPER, side: sd.side, points: r.points, day: ['', 'Mon', 'Tue', 'Wed', 'Thu'][r.dow] });
    const cityWord = DAY_SIDE[r.dow], label = fits(word, cityWord) ? cityWord : word;
    if (label !== cityWord) labelMisfits.push({ c: String(sd.sg.p.UNIQUE_ID), s: sd.sg.p.FULLSTREET_PROPER, side: sd.side, day: cityWord, compass: word });
    if (!blocks.has(sd.sg.p.UNIQUE_ID)) blocks.set(sd.sg.p.UNIQUE_ID, { sg: sd.sg, d: [] });
    blocks.get(sd.sg.p.UNIQUE_ID).d.push([sd.side, label, [r.rule], r]);
  }

  // ---- 4. the blocks ----
  const nodes = new Map();   // County node id → the streets meeting there
  for (const sg of segs) for (const nd of [sg.p.FROMNODE, sg.p.TONODE]) { if (!nodes.has(nd)) nodes.set(nd, []); nodes.get(nd).push(sg.p); }
  const crossAt = (nd, self) => {
    const others = (nodes.get(nd) || []).filter((q) => q.FULLSTREET !== self.FULLSTREET && q.CLASS !== 'RAMP');
    const pick = others.filter((q) => q.CLASS !== 'ALLEY').map((q) => q.FULLSTREET_PROPER).sort()[0] || others.map((q) => q.FULLSTREET_PROPER).sort()[0];
    return pick || '';
  };
  const hoodPolys = hoods.filter((f) => f.geometry).map((f) => ({ name: f.properties.NAME, polys: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates }));
  const hoodOf = (c) => { const m = c[Math.floor(c.length / 2)], mid = c.length % 2 ? m : [(c[c.length / 2 - 1][0] + m[0]) / 2, (c[c.length / 2 - 1][1] + m[1]) / 2];
    return hoodPolys.find((h) => h.polys.some((rings) => inPolygon(mid, rings)))?.name || null; };
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const out = [...blocks.values()].map(({ sg, d }) => {
    const q = sg.p, nums = [q.LF_ACTUAL, q.LT_ACTUAL, q.RF_ACTUAL, q.RT_ACTUAL].filter((v) => v > 0);
    const lOdd = (q.LF_ACTUAL || q.LT_ACTUAL) ? (q.LF_ACTUAL || q.LT_ACTUAL) % 2 === 1 : null, rOdd = (q.RF_ACTUAL || q.RT_ACTUAL) ? (q.RF_ACTUAL || q.RT_ACTUAL) % 2 === 1 : null;
    const o = lOdd === true && rOdd !== true ? 'L' : rOdd === true && lOdd !== true ? 'R' : null;
    const h = hoodOf(sg.c);
    return { c: String(q.UNIQUE_ID), s: q.FULLSTREET_PROPER, l: [crossAt(q.FROMNODE, q), crossAt(q.TONODE, q)].filter(Boolean).join(' - '),
      ...(h ? { h } : {}), ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}), ...(o ? { o } : {}),
      g: sg.c.map(([lo, la]) => [r6(lo), r6(la)]), d: d.sort((x, y) => x[0].localeCompare(y[0])).map(([side, label, rules]) => [side, label, rules]) };
  }).sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));
  const sidesOut = out.reduce((k, b) => k + b.d.length, 0);

  // ---- 5. city facts ----
  const q = (arr, f) => arr[Math.floor(f * (arr.length - 1))];
  const allHood = hoods.flatMap((f) => (f.geometry?.type === 'Polygon' ? f.geometry.coordinates.flat() : f.geometry?.coordinates.flat(2) || []));
  const lons = allHood.map((p) => p[0]), lats = allHood.map((p) => p[1]);
  const bounds = [[+Math.min(...lats).toFixed(4), +Math.min(...lons).toFixed(4)], [+Math.max(...lats).toFixed(4), +Math.max(...lons).toFixed(4)]];
  const cells = new Map();   // the opening view: the ~1 km square holding the most restricted block sides
  for (const b of out) { const [lo, la] = b.g[0]; const k = Math.floor(lo / 0.0115) + ',' + Math.floor(la / 0.009); cells.set(k, (cells.get(k) || 0) + b.d.length); }
  const [[best]] = [...cells.entries()].sort((x, y) => y[1] - x[1]);
  const [cx, cy] = best.split(',').map(Number);
  const center = [+((cy + 0.5) * 0.009).toFixed(4), +((cx + 0.5) * 0.0115).toFixed(4)];
  const byHood = out.reduce((m, b) => { if (b.h) (m[b.h] ||= []).push(b); return m; }, {});
  const neighborhoods = Object.entries(byHood).filter(([, bs]) => bs.length >= 10).sort(([a], [b]) => a.localeCompare(b)).map(([name, bs]) => {
    const g = bs.flatMap((b) => b.g), lo = g.map((p) => p[0]).sort((a, b) => a - b), la = g.map((p) => p[1]).sort((a, b) => a - b);
    return { name, bbox: [q(lo, 0.02), q(la, 0.02), q(lo, 0.98), q(la, 0.98)].map((v) => v.toFixed(4)).join(',') };
  });

  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: 'City of Sacramento On-street Parking Data (Public Works)', url: 'https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/ONSTREETPARKING/FeatureServer/0', license: 'not stated (City open data)', fetched: today },
    { name: 'Sacramento County Street Centerlines', url: 'https://mapservices.gis.saccounty.net/arcgis/rest/services/BASE_MAP_LABELS/MapServer/7', license: 'not stated (County GIS)', fetched: today },
    { name: 'Streetsweep Sign Inventory (City of Sacramento, 2018)', url: 'https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/StreetServicesSignInventory_VW/FeatureServer/0', license: 'not stated (City open data)', fetched: today },
    { name: 'City of Sacramento Neighborhoods', url: 'https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/Neighborhoods/FeatureServer/0', license: 'not stated (City open data)', fetched: today },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'sacramento', time_zone: 'America/Los_Angeles', generated: new Date().toISOString(), sources, blocks: out.length, sides: sidesOut,
      format: 'b[] = {c: County centerline UNIQUE_ID, s: street, l: cross streets, h: City neighborhood, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, side label (the City\'s: Monday south, Tuesday north, Wednesday west, Thursday east), rules]]}; '
        + 'rule = [jsDow, fromH, toH, weeksMask (31 = weekly, 1 = the first week of the month), monthsMask (0 = all year), flags (1 = not suspended on holidays)]' },
    b: out }));

  const city = {
    id: 'sacramento', name: 'Sacramento', region: 'California', tz: 'America/Los_Angeles',
    center, zoom: 15, bounds,
    holidays: HOLIDAYS, holidaysSource: 'https://www.cityofsacramento.gov/city-government/holiday-schedule', holidayRule: 'all',
    fine: '$72.50', tow: 'no', fineSource: 'https://www.cityofsacramento.gov/public-works/parking/citation-services/citation-fines',
    agency: 'City of Sacramento Public Works', scheduleUrl: 'https://www.cityofsacramento.gov/public-works/recycling-solid-waste/Collectionservices/StreetSweeping',
    sources,
    words: {
      rule: 'In parts of Downtown and Midtown, signs say no parking 8 AM to noon for City services: Monday on the south side of lettered streets, Tuesday the north side, Wednesday the west side of numbered streets, Thursday the east side; every week on blocks with weekly garbage pickup, the first week of the month on the others.',
      afterpass: 'All year, holidays included · $72.50 ticket',
      dataNotes: `The City's on-street parking data (Public Works, updated daily): ${snap.placed.toLocaleString('en-US')} parking spaces with a City services day, placed on the County's street centerlines and grouped into ${sidesOut.toLocaleString('en-US')} block sides. `
        + 'Whether a block is restricted every week or the first week of the month comes from the City\'s 2018 sign inventory, the latest it publishes.',
    },
    neighborhoods,
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1) + '\n');

  snap.dist.sort((a, b) => a - b);
  const countBy = (arr) => Object.entries(arr.reduce((m, k) => { m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const rep = {
    generated: new Date().toISOString(),
    season: 'All year (monthsMask 0): the signs name no season. Sweeping runs February to October and leaf collection November to January, both on the same weekday, and weekly blocks also have weekly garbage pickup. Unverified: whether first week of the month signs are enforced November to January.',
    holidays: 'Not suspended (flags 1): the City says garbage, organics and recycling collection "will occur on holidays", leaf crews "work rain or shine, including holidays", and meters and time limits are enforced "7 days per week, including holidays". Unverified for street sweeping itself.',
    input: { parkingPoints: points.length, withSweepingDay: sweepPts.length, byDay: countBy(sweepPts.map((f) => f.properties.PKGSDAY)),
      byHours: countBy(sweepPts.map((f) => `${f.properties.PKGSWBEG} - ${f.properties.PKGSWEND}`)), centerlines: centerlines.length, inventoryFaces: inventory.length },
    snapping: { placed: snap.placed, noStreet: snap.noStreet.length, noStreetNames: countBy(snap.noStreet), tooFar: snap.tooFar.length, tooFarNames: countBy(snap.tooFar),
      placedOnAnotherName: countBy(snap.renamed),
      medianMeters: +snap.dist[snap.dist.length >> 1].toFixed(1), p95Meters: +snap.dist[Math.floor(snap.dist.length * 0.95)].toFixed(1),
      parity: { agree: snap.parityAgree, disagree: snap.parityDisagree, unknown: snap.parityUnknown,
        note: 'The side each point lands on, against its EVENODD and the County address range of that side.' } },
    output: { blocks: out.length, sides: sidesOut, rules: sidesOut, weekly: invStats.weekly, monthly: invStats.monthly,
      bothSides: out.filter((b) => b.d.length === 2).length, oneSide: out.filter((b) => b.d.length === 1).length,
      byDay: countBy(out.flatMap((b) => b.d.map(([, , [r]]) => ['', 'Mon', 'Tue', 'Wed', 'Thu'][r[0]] + (r[3] === 31 ? ' weekly' : ' 1st week') + ` ${r[1]}-${r[2]}`))) },
    weeklyOrMonthly: { method: 'The 2018 sign inventory face (same service day) under most of the side\'s points, within 25 m; else the inventory record with the same County segment id and day; a "1ST" day in the parking data means monthly; no record means weekly (the stricter reading).',
      ...invStats },
    conflicts: { note: 'Block sides whose points give more than one day or more than one window: the day and window most points give are kept (corner spaces often carry the cross street\'s day).', count: conflicts.length, list: conflicts },
    fewPoints: { note: 'Block sides made from one or two parking points (a whole side drawn from one or two spaces): kept, listed to check.',
      count: fewPoints.length, list: fewPoints },
    sideLabels: { note: 'The label is the City\'s word for the day (Monday south, …) when the side\'s compass direction fits it, else the compass word.', misfits: labelMisfits.length, list: labelMisfits },
    crossCheck: 'None: the City publishes no parking citations (its yearly Citation Data layers are police traffic citations without a place).',
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(rep, null, 1) + '\n');
  log(`${points.length} parking points, ${sweepPts.length} with a sweeping day: ${snap.placed} placed (median ${rep.snapping.medianMeters} m), ${snap.noStreet.length} street not found, ${snap.tooFar.length} too far; parity ${snap.parityAgree} agree, ${snap.parityDisagree} disagree`);
  log(`${out.length} blocks, ${sidesOut} sides: ${invStats.weekly} weekly, ${invStats.monthly} first week (inventory by face ${invStats.byFace}, by id ${invStats.byId}, none ${invStats.none}; weekly assumed ${invStats.assumedWeekly}); ${conflicts.length} sides with mixed points, ${labelMisfits.length} labels from the compass`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/sacramento/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
