#!/usr/bin/env node
// Denver for CURB (built 2026-10-18, by docs/multi-city/city-build.md). Writes data/denver/ from the City and County of
// Denver's open data (ArcGIS Online, services1.arcgis.com/zdB7qR0BtYrg0Xpl, open to scripts):
//
//   1. ODC_TRANS_STREET_L (layer 145): 30,706 street centerlines with left and right address ranges and each side's
//      residential sweeping code, LEFTSWEEP and RIGHTSWEEP: two digits, the week of the month (1 to 4) then the weekday
//      (1 = Sunday .. 7 = Saturday; only 3 to 6, Tuesday to Friday, occur): "23" is the 2nd Tuesday. 10, 20, 30 and 40 are
//      a week with no set day (unposted, no need to move), N is night sweeping, NDM a street the City does not maintain,
//      2X no data. The City's lookup (denvergov.org/api/Streets/Sweeping) gives the same answers. LEFTSWEEP is the side
//      with the left address range, the left side looking along the line.
//   2. ODC_ADMN_STREETSWEEPSCHEDULE_A (layer 17): the 51 schedule areas, with MONTHS (April to November), WEEK, DAYS and
//      POSTED (Y: the schedule is on signs, so parking there on the sweep day gets a ticket).
//   3. Signs_12022025 (layer 0): the City's sign inventory (Cartegraph, December 2025 export). Every sweeping sign with its
//      sign type's description, its street segment (Street_Master_ID = MASTERID) and location. It gives the posted hours,
//      which no City page states ("STREET SWEEPING 1ST THURSDAY 8AM-5PM", "... APR THRU NOV 8AM-5PM (TAZ)"; a few blocks
//      "8AM-12NOON"), the overnight sweeping signs ("2AM-6AM MONDAY AND WEDNESDAY TAZ") and a check of the codes.
//   4. ODC_ADMN_NEIGHBORHOOD_A (layer 13): the 78 statistical neighborhoods.
//
// Day rules: sides in posted areas with a set week and weekday, 8 AM to 5 PM (8 AM to noon where that side's sign says so).
// Night rules: each overnight sweeping sign, on the side of the street it stands on.
//
// Run: node scripts/cities/denver.mjs [--refresh]   (Node 18+; inputs cached in private/cache/denver/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/denver/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/denver/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[denver]', ...a);

const AGO = 'https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/';
export const STREETS_URL = AGO + 'ODC_TRANS_STREET_L/FeatureServer/145';
export const AREAS_URL = AGO + 'ODC_ADMN_STREETSWEEPSCHEDULE_A/FeatureServer/17';
export const SIGNS_URL = AGO + 'Signs_12022025/FeatureServer/0';
export const HOODS_URL = AGO + 'ODC_ADMN_NEIGHBORHOOD_A/FeatureServer/13';

// ---------- facts (checked 2026-10-18; sources in city.json and docs/multi-city/denver.md) -----------------------------

// "Residential seasonal street sweeping season runs April through November" (denvergov.org Street Sweeping page); every
// posted schedule area's MONTHS reads "Apr-Nov".
export const SEASON = 0b011111111000;
// The posted hours of residential sweeping, from the City's sign inventory (no City page states them): of the daytime
// sweeping sign records whose sweeping panel states hours, 755 say 8AM-5PM and 38 say 8AM-12NOON (a few blocks in Sloan Lake
// and North Capitol Hill); none states other hours (the 7AM-6PM, 8AM-6PM and 12NOON-9PM on some records are loading,
// time-limit and permit panels of the same sign).
export const HOURS = [8, 17];
export const NOON_HOURS = [8, 12];
// Flags: 2 = towable (signs read TAZ, Tow Away Zone; DRMC 54-482(c), "may be relocated", $100). Day sweeps skip City
// holidays (the City's lookup leaves them out of each block's next dates: Veterans Day, Thanksgiving). The overnight signs
// name no season and no holiday exception, so night rules run all year and on holidays too (1).
const DAY_FLAGS = 2, NIGHT_FLAGS = 3;

// City and County of Denver holidays (denvergov.org Holiday Closures pages), with the observed dates.
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Presidents' Day",
  '2026-03-30': 'Cesar Chavez Day ("Sí, Se Puede" Day)', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day', '2026-10-12': "Indigenous Peoples' Day",
  '2026-11-11': 'Veterans Day', '2026-11-26': 'Thanksgiving Day', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Presidents' Day",
  '2027-03-29': 'Cesar Chavez Day ("Sí, Se Puede" Day)', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day', '2027-10-11': "Indigenous Peoples' Day",
  '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving Day', '2027-12-24': 'Christmas Day (observed)',
  '2027-12-31': "New Year's Day (observed)",
};

// city.json (bounds, holidays and neighborhoods are added by the build)
export const CITY = { id: 'denver', name: 'Denver', region: 'Colorado', tz: 'America/Denver',
  center: [39.745, -104.95], zoom: 14 };   // Capitol Hill, Cheesman Park, Congress Park, City Park: the densest posted blocks
const CITY_LATE = {
  holidaysSource: 'https://www.denvergov.org/Events-directory/Holiday-Closures',
  holidayRule: 'all',
  fine: '$50', tow: 'sometimes',
  fineSource: 'https://www.denvergov.org/files/assets/public/v/2/doti/documents/programsservices/parking/denver-parking-fine-schedule.pdf',
  agency: 'Denver Department of Transportation and Infrastructure (DOTI)',
  scheduleUrl: 'https://www.denvergov.org/Online-Services-Hub/Street-Sweeping-Schedules',
  words: {
    rule: 'Posted blocks are swept once a month, April to November: each side on its own week and weekday (the 2nd Tuesday, say), 8 AM to 5 PM. Some downtown streets are swept overnight, 2 to 6 AM.',
    afterpass: 'Day sweeps skip City holidays. A $50 ticket, and the car may be relocated for a $100 fee.',
    dataNotes: 'Schedules come from Denver\'s street centerline, which codes each side\'s week and weekday, for the areas the City posts. The hours and the overnight sweeps come from the City\'s sign inventory; 95% of its sweeping signs match the code of the side they stand on.',
  },
};

// ---------- decoding ---------------------------------------------------------------------------------------------------

// "23" → { week: 2, dow: 2 } (2nd Tuesday). Week only (10/20/30/40), N (night), NDM, 2X or empty → null.
export function decodeSweep(code) {
  const m = /^([1-4])([1-7])$/.exec(String(code || '').trim());
  return m ? { week: +m[1], dow: +m[2] - 1 } : null;
}
export const hm = (h) => (Number.isInteger(h) ? h : `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);
export const dayRule = (d, hours = HOURS) => [d.dow, hm(hours[0]), hm(hours[1]), 1 << (d.week - 1), SEASON, DAY_FLAGS];

const WD = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const WK = { '1ST': 1, '2ND': 2, '3RD': 3, '4TH': 4 };
// The sweeping panel of a sign's description: combination signs join panels with "/" or "+" ("3 HR PAID PARK 8AM-7PM
// (LEFT) / STREET SWEEPING THURSDAY 2AM-6AM"), so another panel's hours are never read as the sweep's.
export function sweepPart(desc) {
  return String(desc || '').toUpperCase().replace(/[\u2013\u2014]/g, '-').split(/\s*[/+]\s*/).filter((p) => /SWEEP/.test(p)).join(' / ');
}
// A daytime sweeping sign: one week and weekday ("STREET SWEEPING 2ND TUESDAY"), and its hours when it states them.
export function parseDaySign(desc) {
  const s = sweepPart(desc), hits = [...s.matchAll(/\b(1ST|2ND|3RD|4TH)\s+(MON|TUE|WED|THU|FRI)[A-Z]*/g)];
  if (hits.length !== 1) return null;
  const h = /\b8\s*AM\s*-\s*(5\s*PM|12\s*NOON|NOON|12\s*PM)\b/.exec(s);
  return { week: WK[hits[0][1]], dow: WD[hits[0][2]], to: h ? (/5/.test(h[1]) ? 17 : 12) : null };
}
// An overnight sweeping sign: its nights, weeks and hours ("STREET SWEEPING 2AM-6AM MONDAY AND WEDNESDAY TAZ",
// "STREET SWEEPING 2ND AND 4TH MONDAY 2AM-8AM", "SWEEP, MONDAY AND WEDNESDAY, 0206, TAZ"), or null.
export function parseNightSign(desc) {
  const s = sweepPart(desc);
  if (!s) return null;
  let from = null, to = null, fixed = false;
  // the first window starting 1 to 4 AM (a panel without a separator may come first: "PASS LOADING 5AM-2AM ... 2AM-6AM")
  const m = [...s.matchAll(/\b(\d{1,2})(?::00)?\s*AM\s*-\s*(\d{1,2})(?::00)?\s*(AM|PM)\b/g)].find((x) => +x[1] >= 1 && +x[1] <= 4);
  if (m) {
    from = +m[1]; to = +m[2];
    if (m[3] === 'PM') { if (to === 6) { fixed = true; } else return null; }   // "2AM-6PM MONDAY & WEDNESDAY": 6 AM
  } else if (/\b0206\b/.test(s)) { from = 2; to = 6; }
  if (from === null || !(to > from)) return null;
  const days = [...new Set([...s.matchAll(/\b(MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*/g)].map((x) => WD[x[1]]))].sort();
  if (!days.length) return null;
  let weeks = [...s.matchAll(/\b(1ST|2ND|3RD|4TH)\b/g)].map((x) => WK[x[1]]);
  const short = /SWEEP,\s*([1-4])\s+(?:MON|TUE|WED|THU|FRI)/.exec(s);                          // "SWEEP, 1 MONDAY, 0206"
  if (short) weeks.push(+short[1]);
  const mask = weeks.length ? weeks.reduce((a, w) => a | (1 << (w - 1)), 0) : 31;
  return { days, weeks: mask, from, to, fixed };
}
export const nightRules = (n) => n.days.map((dow) => [dow, n.from, n.to, n.weeks, 0, NIGHT_FLAGS]);

const DIRS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const TYPES = { AVE: 'Ave', ST: 'St', BLVD: 'Blvd', PKWY: 'Pkwy', DR: 'Dr', CT: 'Ct', PL: 'Pl', WAY: 'Way', RD: 'Rd', LN: 'Ln', CIR: 'Cir', TER: 'Ter' };
// "E 17TH AVENUE PKWY" → "E 17th Avenue Pkwy", "N UTICA ST" → "N Utica St"; "TRAFFIC SIGNAL BTWN …" cross names stay readable.
export function titleStreet(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).map((w, i, all) => {
    if (DIRS.has(w) && (i === 0 || i === all.length - 1)) return w;
    if (/^\d+(ST|ND|RD|TH)$/.test(w)) return w.toLowerCase();
    if (TYPES[w] && i === all.length - 1) return TYPES[w];
    if (/^MC[A-Z]{2,}/.test(w)) return 'Mc' + w[2] + w.slice(3).toLowerCase();
    return w.split(/([-'/])/).map((p) => (p.length ? p[0] + p.slice(1).toLowerCase() : p)).join('');
  }).join(' ');
}
const parity = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n % 2 : null; };
// The side (L/R along the line) with the odd house numbers; a street numbered on one side only still has an odd side.
export function oddSide(a) {
  const l = parity(a.L_F_ADD) ?? parity(a.L_T_ADD), r = parity(a.R_F_ADD) ?? parity(a.R_T_ADD);
  if (l === 1 && r !== 1) return 'L';
  if (r === 1 && l !== 1) return 'R';
  if (l === 0 && r === null) return 'R';
  if (r === 0 && l === null) return 'L';
  return null;
}

// ---------- geometry ----------------------------------------------------------------------------------------------------

const LAT0 = 39.74, LON0 = -104.99, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
// The side of the line a point is on (L/R of its nearest piece), with its distance in meters.
export function sideOf(c, p) {
  const [px, py] = xy(p);
  let best = null;
  for (let i = 1; i < c.length; i++) {
    const [x1, y1] = xy(c[i - 1]), [x2, y2] = xy(c[i]), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    if (!l2) continue;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)), d = Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
    if (!best || d < best.d) best = { d, side: dx * (py - y1) - dy * (px - x1) > 0 ? 'L' : 'R' };
  }
  return best;
}
function inRings(rings, [x, y]) {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- fetching ----------------------------------------------------------------------------------------------------

async function post(url, params, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams(params),
        headers: { Accept: 'application/json', 'User-Agent': 'curb-city-build (+https://curb.guide)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const j = await r.json();
      if (j.error) throw new Error(`${url}: ${JSON.stringify(j.error)}`);
      return j;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 2500 * i));
    }
  }
}
async function features(url, where, outFields) {
  const out = [];
  for (let off = 0; ; ) {
    const j = await post(url + '/query', { where, outFields, returnGeometry: 'true', outSR: '4326', orderByFields: 'OBJECTID',
      resultOffset: off, resultRecordCount: 1000, f: 'json' });
    const page = j.features || [];
    out.push(...page);
    if (!page.length || (page.length < 1000 && !j.exceededTransferLimit)) return out;
    off += page.length;
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
function expectFields(list, fields, what) {
  const a = list[0] && list[0].attributes;
  const missing = fields.filter((k) => !a || !(k in a));
  if (missing.length) throw new Error(`${what}: the City's data changed shape, missing ${missing.join(', ')}`);
}

// ---------- the build ---------------------------------------------------------------------------------------------------

async function build() {
  // created_user / last_edited_user (streets) hold City staff accounts: never requested; nor the signs' notes
  const STREET_FIELDS = 'OBJECTID,FNODE,TNODE,STREETID,MASTERID,L_F_ADD,L_T_ADD,R_F_ADD,R_T_ADD,PREFIX,NAME,TYPE,POSTMODIFIER,FULLNAME,FROMNAME,TONAME,JURISID,MAINTNCE,CITYID,COUNTYID,RCITYID,RCOUNTYID,STATUS,ONEWAY,HUNDBLKNUM,HUNDBLKNAME,VOLCLASS,FUNCLASS,TT_SEGTYPE,LEFTSWEEP,RIGHTSWEEP,SSSID,NIGHTSWEEP,SEGMID,last_edited_date';
  const SIGN_FIELDS = 'OBJECTID,ID,MUTCD_Code,MUTCD_Code_Description,Installed,Replaced,Retired,Address_Number,Street,Intersecting_Street,Neighborhood,Street_Master_ID';
  const streets = await cached('streets.json', () => { log('fetching street centerlines…'); return features(STREETS_URL, '1=1', STREET_FIELDS); });
  const areas = await cached('sweep-areas.json', () => { log('fetching sweep schedule areas…'); return features(AREAS_URL, '1=1', 'OBJECTID,MONTHS,WEEK,DAYS,POSTED,SSSID'); });
  const signs = await cached('signs-sweeping-2025-12.json', () => { log('fetching sweeping signs…'); return features(SIGNS_URL, "UPPER(MUTCD_Code_Description) LIKE '%SWEEP%'", SIGN_FIELDS); });
  const hoods = await cached('neighborhoods.json', () => { log('fetching statistical neighborhoods…'); return features(HOODS_URL, '1=1', 'OBJECTID,NBHD_ID,NBHD_NAME'); });
  expectFields(streets, ['MASTERID', 'FULLNAME', 'FROMNAME', 'TONAME', 'L_F_ADD', 'R_F_ADD', 'LEFTSWEEP', 'RIGHTSWEEP', 'SSSID', 'NIGHTSWEEP'], 'ODC_TRANS_STREET_L');
  expectFields(areas, ['MONTHS', 'WEEK', 'DAYS', 'POSTED', 'SSSID'], 'ODC_ADMN_STREETSWEEPSCHEDULE_A');
  expectFields(signs, ['MUTCD_Code_Description', 'Street_Master_ID', 'Retired'], 'Signs_12022025');
  if (streets.length < 25000) throw new Error(`${streets.length} street segments: expected over 25,000`);
  if (signs.length < 20000) throw new Error(`${signs.length} sweeping signs: expected over 20,000`);
  log(`${streets.length} street segments, ${areas.length} schedule areas, ${signs.length} sweeping signs, ${hoods.length} neighborhoods`);

  const area = new Map(areas.map((f) => [f.attributes.SSSID, f.attributes]));
  const posted = new Set([...area].filter(([, a]) => a.POSTED === 'Y').map(([k]) => k));
  for (const k of posted) if (!/^Apr\s*-\s*Nov$/i.test(area.get(k).MONTHS || '')) throw new Error(`posted area ${k} runs ${area.get(k).MONTHS}, not April to November`);
  const seg = new Map();
  for (const f of streets) {
    const path = f.geometry && f.geometry.paths && f.geometry.paths[0];
    if (path && path.length > 1) seg.set(f.attributes.MASTERID, { a: f.attributes, c: path.map((p) => [p[0], p[1]]) });
  }

  // ---- signs → the side of their segment they stand on
  const report = { segments: streets.length, inPostedArea: 0, codes: {}, sides: { posted: 0, set: 0, weekOnly: 0, night: 0, notCityStreet: 0, other: 0 },
    weekDiffersFromArea: 0, unposted: { segments: 0, withSetDay: 0 },
    signs: { sweeping: signs.length, retired: 0, byNearestStreet: 0, noSegment: 0, onCenterline: 0, day: 0, night: 0, nightFixedPM: 0, nightUnread: 0 },
    check: { daySignsOnCodedSide: 0, agree: 0, otherSide: 0, differ: 0, differExamples: [] }, noon: { sides: 0, conflicts: 0 },
    night: { sides: 0, blocks: 0, majoritySides: 0, tiedSides: 0, onNightCodedSides: 0, onDayCodedSides: 0 }, byNeighborhood: {} };
  // a sign whose Street_Master_ID is empty or unknown goes to the nearest centerline within 20 m, one of its street's if any
  const CELL = 50, cell = (v) => Math.floor(v / CELL), grid = new Map();
  for (const s of seg.values()) {
    const pts = s.c.map(xy);
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      for (let cx = cell(Math.min(x1, x2) - 20); cx <= cell(Math.max(x1, x2) + 20); cx++)
        for (let cy = cell(Math.min(y1, y2) - 20); cy <= cell(Math.max(y1, y2) + 20); cy++) {
          const k = cx + ',' + cy;
          if (!grid.has(k)) grid.set(k, new Set());
          grid.get(k).add(s);
        }
    }
  }
  const streetKey = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  function nearestSeg(p, street) {
    const [px, py] = xy(p), want = streetKey(street);
    let best = null;
    for (const s of grid.get(cell(px) + ',' + cell(py)) || []) {
      const w = sideOf(s.c, p);
      if (!w || w.d > 20) continue;
      const named = want && streetKey(s.a.FULLNAME).includes(want) ? 1 : 0;
      if (!best || named > best.named || (named === best.named && w.d < best.d)) best = { s, d: w.d, named };
    }
    return best && best.s;
  }
  const signAt = new Map();   // "MASTERID|side" → { day: [parsed], night: [parsed] }
  for (const f of signs) {
    const a = f.attributes, desc = a.MUTCD_Code_Description;
    if (a.Retired) { report.signs.retired++; continue; }
    if (!f.geometry) { report.signs.noSegment++; continue; }
    let s = seg.get(a.Street_Master_ID);
    if (!s) { s = nearestSeg([f.geometry.x, f.geometry.y], a.Street); if (s) report.signs.byNearestStreet++; }
    if (!s) { report.signs.noSegment++; continue; }
    const where = sideOf(s.c, [f.geometry.x, f.geometry.y]);
    if (!where || where.d < 1.5 || where.d > 25) { report.signs.onCenterline++; continue; }
    const k = s.a.MASTERID + '|' + where.side;
    if (!signAt.has(k)) signAt.set(k, { day: [], night: [] });
    const n = parseNightSign(desc);
    if (n) { report.signs.night++; if (n.fixed) report.signs.nightFixedPM++; signAt.get(k).night.push(n); continue; }
    if (/\b2\s*AM\b|\b0206\b/.test(sweepPart(desc))) report.signs.nightUnread++;
    const d = parseDaySign(desc);
    if (d) { report.signs.day++; signAt.get(k).day.push(d); }
  }

  const hoodPolys = hoods.filter((h) => h.geometry && h.geometry.rings).map((h) => ({ name: h.attributes.NBHD_NAME, rings: h.geometry.rings }));
  const hoodAt = (c) => { const m = c[Math.floor(c.length / 2)]; const h = hoodPolys.find((p) => inRings(p.rings, m)); return h ? h.name : ''; };
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const out = [];
  for (const { a, c } of seg.values()) {
    const inPosted = posted.has(a.SSSID);
    if (inPosted) report.inPostedArea++;
    else if (a.SSSID && a.SSSID !== 'NightSwp') { report.unposted.segments++; if (decodeSweep(a.LEFTSWEEP) || decodeSweep(a.RIGHTSWEEP)) report.unposted.withSetDay++; }
    const d = [];
    for (const [side, field] of [['L', 'LEFTSWEEP'], ['R', 'RIGHTSWEEP']]) {
      const code = String(a[field] || '').trim(), here = signAt.get(a.MASTERID + '|' + side) || { day: [], night: [] };
      const rules = [];
      const dec = decodeSweep(code);
      if (inPosted) {
        report.codes[code || 'empty'] = (report.codes[code || 'empty'] || 0) + 1;
        report.sides.posted++;
        if (!dec) { /^[1-4]0$/.test(code) ? report.sides.weekOnly++ : code === 'N' ? report.sides.night++ : code === 'NDM' ? report.sides.notCityStreet++ : report.sides.other++; }
        else {
          report.sides.set++;
          if (+a.SSSID[1] !== dec.week) report.weekDiffersFromArea++;
          // the side's own signs: do they say the same week and day, and what hours?
          const same = here.day.filter((s) => s.week === dec.week && s.dow === dec.dow);
          const hrs = new Set(same.map((s) => s.to).filter(Boolean));
          let hours = HOURS;
          if (hrs.has(12)) { if (hrs.has(17)) report.noon.conflicts++; else { hours = NOON_HOURS; report.noon.sides++; } }
          rules.push(dayRule(dec, hours));
        }
      }
      // the cross-check: each daytime sign against the codes of the side it stands on and the other side
      if (dec || decodeSweep(a[side === 'L' ? 'RIGHTSWEEP' : 'LEFTSWEEP'])) {
        const other = decodeSweep(a[side === 'L' ? 'RIGHTSWEEP' : 'LEFTSWEEP']);
        for (const s of here.day) {
          report.check.daySignsOnCodedSide++;
          if (dec && s.week === dec.week && s.dow === dec.dow) report.check.agree++;
          else if (other && s.week === other.week && s.dow === other.dow) report.check.otherSide++;
          else { report.check.differ++; if (report.check.differExamples.length < 10) report.check.differExamples.push({ masterid: a.MASTERID, street: titleStreet(a.FULLNAME), side, code, sign: `${s.week}${s.dow + 1}` }); }
        }
      }
      // night rules from the overnight signs on this side
      if (here.night.length) {
        // one schedule per side: the one most of the side's signs show (a sign placed on the wrong side is outvoted); on a
        // tie, every tied schedule is kept, so the side shows each
        const votes = new Map();
        for (const n of here.night) { const k = `${n.days}|${n.weeks}|${n.from}|${n.to}`; votes.set(k, { n, v: ((votes.get(k) || {}).v || 0) + 1 }); }
        const top = Math.max(...[...votes.values()].map((x) => x.v)), keep = [...votes.values()].filter((x) => x.v === top);
        if (votes.size > 1) keep.length > 1 ? report.night.tiedSides++ : report.night.majoritySides++;
        const nr = new Map();
        for (const { n } of keep) for (const r of nightRules(n)) nr.set(r.join('|'), r);
        rules.push(...nr.values());
        report.night.sides++;
        if (code === 'N') report.night.onNightCodedSides++; else if (dec) report.night.onDayCodedSides++;
      }
      if (rules.length) d.push([side, compass(c, side), rules.sort((x, y) => x[0] - y[0] || String(x[1]).localeCompare(String(y[1])))]);
    }
    if (!d.length) continue;
    if (d.some(([, , rs]) => rs.some((r) => r[1] === 2 || r[1] === 1 || r[1] === 3 || r[1] === 4))) report.night.blocks++;
    const nums = ['L_F_ADD', 'L_T_ADD', 'R_F_ADD', 'R_T_ADD'].map((k) => Math.round(a[k])).filter((v) => v > 0), odd = oddSide(a);
    const h = hoodAt(c);
    report.byNeighborhood[h || '(none)'] = (report.byNeighborhood[h || '(none)'] || 0) + 1;
    out.push({ c: String(a.MASTERID), s: titleStreet(a.FULLNAME), l: [a.FROMNAME, a.TONAME].filter(Boolean).map(titleStreet).join(' - '), h,
      ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}), ...(odd ? { o: odd } : {}),
      g: c.map(([lo, la]) => [r6(lo), r6(la)]), d });
  }
  const ids = new Set();
  for (const b of out) { if (ids.has(b.c)) throw new Error(`MASTERID ${b.c} repeats`); ids.add(b.c); }
  out.sort((x, y) => x.s.localeCompare(y.s, 'en', { numeric: true }) || (x.n ? x.n[0] : 0) - (y.n ? y.n[0] : 0) || x.c.localeCompare(y.c));
  const pct = (n, dd) => (dd ? (100 * n / dd).toFixed(1) + '%' : 'n/a');
  report.check.shareAgree = pct(report.check.agree, report.check.daySignsOnCodedSide);

  // ---------- write -----------------------------------------------------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: 'Street Centerline (ODC_TRANS_STREET_L)', url: 'https://opendata-geospatialdenver.hub.arcgis.com/', api: STREETS_URL, license: 'CC BY 3.0 (City of Denver Open Data Catalog)', fetched: today },
    { name: 'Street Sweep Schedule areas (ODC_ADMN_STREETSWEEPSCHEDULE_A)', url: 'https://opendata-geospatialdenver.hub.arcgis.com/', api: AREAS_URL, license: 'CC BY 3.0 (City of Denver Open Data Catalog)', fetched: today },
    { name: 'Sign inventory, December 2025 export (Signs_12022025)', url: 'https://opendata-geospatialdenver.hub.arcgis.com/', api: SIGNS_URL, license: 'not stated', fetched: today },
    { name: 'Statistical Neighborhoods (ODC_ADMN_NEIGHBORHOOD_A)', url: 'https://opendata-geospatialdenver.hub.arcgis.com/', api: HOODS_URL, license: 'CC BY 3.0 (City of Denver Open Data Catalog)', fetched: today },
  ];
  const sideCount = out.reduce((n, b) => n + b.d.length, 0), ruleCount = out.reduce((n, b) => n + b.d.reduce((m, x) => m + x[2].length, 0), 0);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'denver', time_zone: 'America/Denver', generated: new Date().toISOString(), sources, blocks: out.length, sides: sideCount,
      format: 'b[] = {c: MASTERID, s: street, l: cross streets, h: statistical neighborhood, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
        + 'rule = [jsDow, from, to, weeksMask (bit i = week i+1; 31 = every week), monthsMask (2040 = April to November, 0 = all year), flags (2 = towable; 3 = towable and on holidays too)]. '
        + 'Day sweeps: one week of the month, 8 to 17 (8 to 12 where the sign says so), April to November. Night sweeps: from the overnight signs, 2 to 6 AM, all year' },
    b: out }));
  const rep = { generated: new Date().toISOString(), hours: { day: '8 AM to 5 PM', noon: '8 AM to noon where the side\'s sign says so', night: 'as each overnight sign says (2 to 6 AM, a few 2 to 8 AM)',
    source: 'the City\'s sign inventory (no City page states hours)' }, postedAreas: [...posted].sort(), ...report,
    output: { blocks: out.length, blockSides: sideCount, rules: ruleCount, bytes: fs.statSync(OUT + 'segments.json').size } };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(rep, null, 1));
  // city.json: the city's facts, its holidays, the map's frame (Denver's streets) and its official neighborhoods
  let w = 180, so = 90, e = -180, n = -90;
  for (const { a, c } of seg.values()) if (a.CITYID === 'Denver') for (const [lo, la] of c) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < so) so = la; if (la > n) n = la; }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const used = new Set(out.map((b) => b.h).filter(Boolean));
  const neighborhoods = hoodPolys.filter((h) => used.has(h.name)).map((h) => {
    let hw = 180, hs = 90, he = -180, hn = -90;
    for (const ring of h.rings) for (const [lo, la] of ring) { if (lo < hw) hw = lo; if (lo > he) he = lo; if (la < hs) hs = la; if (la > hn) hn = la; }
    return { name: h.name, bbox: [hw, hs, he, hn].map((v) => v.toFixed(4)).join(',') };
  }).sort((x, y) => x.name.localeCompare(y.name));
  fs.writeFileSync(OUT + 'city.json', JSON.stringify({ ...CITY, bounds: [[r4(so), r4(w)], [r4(n), r4(e)]], holidays: HOLIDAYS, ...CITY_LATE, sources, neighborhoods }, null, 1));
  log(`${report.inPostedArea} segments in posted areas; sides: ${report.sides.set} with a set week and day, ${report.sides.weekOnly} week only, ${report.sides.night} night (N), ${report.sides.notCityStreet} not City streets, ${report.sides.other} other`);
  log(`signs: ${report.signs.day} day and ${report.signs.night} night signs placed; day signs agree with their side's code on ${report.check.agree}/${report.check.daySignsOnCodedSide} (${report.check.shareAgree}), the other side's on ${report.check.otherSide}, neither on ${report.check.differ}`);
  log(`8 AM to noon on ${report.noon.sides} sides; night rules on ${report.night.sides} sides (${report.night.blocks} blocks)`);
  log(`wrote ${out.length} blocks, ${sideCount} block sides, ${ruleCount} rules; segments.json ${Math.round(rep.output.bytes / 1024)} KB`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await build();
