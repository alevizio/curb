#!/usr/bin/env node
// San Mateo for CURB (data check, 2026-10-18; docs/multi-city/city-build.md, research in docs/multi-city/san-mateo.md).
// Writes data/san-mateo/report.json only: no segments.json, because which streets get tickets today, and when, can't be
// told from the City's data (the report says why and what to ask the City). Reads three public layers of the City of
// San Mateo's ArcGIS organization:
//
//   1. SignedNoParking_10_2019: the street sweeping "No Parking" signs as of October 2019, 406 line pieces drawn along the
//      curb, each with a route, a day, weeks and hours ("10B", "THU", "2/4", "8-10 AM"). The City says most residential
//      routes are unposted (residents move voluntarily) and only "some high traffic streets" are posted and ticketed,
//      $41. This is the only data that says which.
//   2. StreeSweep_Times (September 2026): today's sweeping schedule, one record per parcel (~25,700): route, day, weeks,
//      sweep time. Only the street name, route and schedule are read, with each parcel's centroid; no house numbers.
//   3. Streets_8_9_23: the City's street centerline (August 2023), the common reference: each signed piece and each
//      parcel is put on the nearest centerline segment of its own street, and on its side.
//
// Each signed side is then compared with today's schedule for the parcels on that side: same day, weeks and hours or not.
//
// Run: node scripts/cities/san-mateo.mjs [--refresh]   (Node 18+; inputs cached in private/cache/san-mateo/)
// Tests: npx vitest run scripts/cities/san-mateo.test.mjs

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/san-mateo/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/san-mateo/';
const log = (...a) => console.error('[san-mateo]', ...a);

const ORG = 'https://services2.arcgis.com/g26Y0m7OCdjU0ObA/arcgis/rest/services/';
const SIGNED = ORG + 'SignedNoParking_10_2019/FeatureServer/0';
const PARCELS = ORG + 'StreeSweep_Times/FeatureServer/2';
const STREETS = ORG + 'Streets_8_9_23/FeatureServer/0';
const PAGES = {
  residential: 'https://www.cityofsanmateo.org/2148/Residential-Street-Cleaning',
  improvements: 'https://www.cityofsanmateo.org/3688/Street-Sweeping-Program-Improvements',
  business: 'https://www.cityofsanmateo.org/2147/Business-Area-Street-Cleaning',
};

// ---------- the signs' words and the schedule's words ------------------------------------------------

const DAY = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3,
  THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 };
/* "THU" → [4], "MWF" or "M/W/F" → [1, 3, 5]; null when unknown. */
export function parseDays(s) {
  const v = String(s || '').toUpperCase().replace(/\s+/g, '');
  if (v === 'MWF' || v === 'M/W/F') return [1, 3, 5];
  return v in DAY ? [DAY[v]] : null;
}
/* "1/3" or "1st/3rd" → 5, "2/4" or "2nd/4th" → 10, "WEEKLY" → 31 (bit i = the (i+1)th weekday); "BI-WEEKLY" (every
   other week, El Camino Real) has no such pattern: null. */
export function parseWeeks(s) {
  const v = String(s || '').toUpperCase().replace(/\s+/g, '');
  if (v === 'WEEKLY') return 31;
  const m = /^([1-5])(?:ST|ND|RD|TH)?\/([1-5])(?:ST|ND|RD|TH)?$/.exec(v);
  return m ? (1 << (m[1] - 1)) | (1 << (m[2] - 1)) : null;
}
const hm = (h, min) => (min ? `${h}:${String(min).padStart(2, '0')}` : h);
/* A sign's hours: "7-9 AM" → [7, 9], "11-1 PM" → [11, 13], "12-2 PM" → [12, 14], "7-7:30 AM" → [7, "7:30"]. The meridiem
   is said once, for the end: a start after the end moves to the morning ("11-1 PM" is 11 AM to 1 PM). */
export function parseSignTime(s) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*$/i.exec(String(s || ''));
  if (!m) return null;
  const pm = /PM/i.test(m[5]);
  let to = (+m[3] % 12) + (pm ? 12 : 0), from = (+m[1] % 12) + (pm ? 12 : 0);
  if (from > to || (from === to && (m[2] || 0) > (m[4] || 0))) from -= 12;
  if (from < 0) return null;
  return [hm(from, +m[2] || 0), hm(to, +m[4] || 0)];
}
/* The schedule's sweep time: "5:00am to 7:00am" → [5, 7], "NOON to 2:00pm" → [12, 14], "11:30am to 2:00pm" → ["11:30", 14]. */
export function parseSweepTime(s) {
  const one = (t) => {
    const v = t.trim().toUpperCase();
    if (v === 'NOON') return [12, 0];
    const m = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/.exec(v);
    return m ? [(+m[1] % 12) + (m[3] === 'PM' ? 12 : 0), +m[2] || 0] : null;
  };
  const parts = String(s || '').split(/\s+TO\s+/i);
  if (parts.length !== 2) return null;
  const a = one(parts[0]), b = one(parts[1]);
  return a && b ? [hm(...a), hm(...b)] : null;
}
/* A sign's rules, CURB's shape: [dow, from, to, weeks, months, flags], one per day. null when a word can't be read. */
export function signRules(p) {
  const days = parseDays(p.Day_), weeks = parseWeeks(p.Week), win = parseSignTime(p.Time_);
  if (!days || !weeks || !win) return null;
  return days.map((d) => [d, win[0], win[1], weeks, 0, 0]);
}
/* The same for a parcel's schedule record (NEW_DAY, NEW_WEEK, SWEEP_TIME). */
export function scheduleRules(a) {
  const days = parseDays(a.NEW_DAY), weeks = parseWeeks(a.NEW_WEEK), win = parseSweepTime(a.SWEEP_TIME);
  if (!days || !weeks || !win) return null;
  return days.map((d) => [d, win[0], win[1], weeks, 0, 0]);
}

// ---------- streets and sides ------------------------------------------------------------------------

const TYPES = new Set(['ST', 'AVE', 'AV', 'BLVD', 'BL', 'DR', 'RD', 'WY', 'WAY', 'CT', 'CIR', 'LN', 'PL', 'TERR', 'TER',
  'PKWY', 'HWY', 'SQ', 'ROW', 'LANE', 'COURT', 'STREET', 'AVENUE', 'DRIVE', 'ROAD', 'TRL', 'PT', 'PLZ', 'ALY', 'WALK']);
/* One key per street for the three layers: "S CLAREMONT" + "ST", "CLAREMONT ST S", "01ST AVE", "1ST" → "CLAREMONT", "1ST". */
export function streetKey(name, type = '') {
  let w = `${name || ''} ${type || ''}`.toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (w.length > 1 && /^[NSEW]$/.test(w[0])) w = w.slice(1);
  if (w.length > 1 && /^[NSEW]$/.test(w[w.length - 1])) w = w.slice(0, -1);
  if (w.length > 1 && TYPES.has(w[w.length - 1])) w = w.slice(0, -1);
  return w.map((x) => x.replace(/^0+(\d)/, '$1')).join(' ');
}

const LAT0 = 37.55, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [lon * KX, lat * KY];
const lines = (g) => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

/* A spatial index of centerline pieces, and the nearest piece of a given street to a point: { si, side: 'L' | 'R', d }.
   L and R: the side of the centerline, looking from its first point to its last. */
export function streetIndex(streets) {
  const CELL = 50, grid = new Map(), cell = (v) => Math.floor(v / CELL);
  streets.forEach((s, si) => {
    for (const c of lines(s.geometry)) {
      const P = c.map(xy);
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], piece = { a, b, si, k: s.key };
        for (let x = cell(Math.min(a[0], b[0]) - 80); x <= cell(Math.max(a[0], b[0]) + 80); x++)
          for (let y = cell(Math.min(a[1], b[1]) - 80); y <= cell(Math.max(a[1], b[1]) + 80); y++) {
            const k = x + ',' + y;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(piece);
          }
      }
    }
  });
  return function nearest(pt, key, maxD) {
    const p = xy(pt);
    let best = null;
    for (const pc of grid.get(cell(p[0]) + ',' + cell(p[1])) || []) {
      if (key && pc.k !== key) continue;
      const dx = pc.b[0] - pc.a[0], dy = pc.b[1] - pc.a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - pc.a[0]) * dx + (p[1] - pc.a[1]) * dy) / l2)) : 0;
      const d = Math.hypot(p[0] - pc.a[0] - t * dx, p[1] - pc.a[1] - t * dy);
      if (d <= maxD && (!best || d < best.d)) best = { si: pc.si, d, side: dx * (p[1] - pc.a[1]) - dy * (p[0] - pc.a[0]) > 0 ? 'L' : 'R' };
    }
    return best;
  };
}

/* The centerline sides a signed piece lies along: points every 5 m, each on the nearest segment of the sign's street
   within 25 m; a side counts with 3 points, or a fifth of them. → [{ si, side, n }] */
export function signSides(feature, key, nearest) {
  const votes = new Map();
  let total = 0;
  for (const c of lines(feature.geometry)) for (let i = 1; i < c.length; i++) {
    const A = c[i - 1], B = c[i], L = Math.hypot((B[0] - A[0]) * KX, (B[1] - A[1]) * KY), n = Math.max(1, Math.round(L / 5));
    for (let j = 0; j <= n; j++) {
      const t = j / n, r = nearest([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])], key, 25);
      if (!r) continue;
      total++;
      const k = r.si + '|' + r.side;
      votes.set(k, (votes.get(k) || 0) + 1);
    }
  }
  return [...votes.entries()].filter(([, v]) => v >= 3 || v / total >= 0.2).map(([k, n]) => { const [si, side] = k.split('|'); return { si: +si, side, n }; });
}

/* A signed side against today's schedule on that side (the parcels' most common record): 'agree' (same days, weeks and
   hours), 'hours differ' (same days and weeks), 'days differ', or 'no schedule' (no parcel on that side). */
export function compare(sign, today) {
  if (!today) return 'no schedule';
  const key = (rs) => rs.map((r) => `${r[0]}|${r[3]}`).sort().join(',');
  if (key(sign) !== key(today)) return 'days differ';
  return sign.every((r, i) => String(r[1]) === String(today[i][1]) && String(r[2]) === String(today[i][2])) ? 'agree' : 'hours differ';
}

// ---------- the check -------------------------------------------------------------------------------

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-san-mateo-build (+https://curb.guide)' } });
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
async function layer(url, params) {
  const out = [];
  for (let off = 0; ; off += 2000) {
    const d = await getJSON(`${url}/query?${new URLSearchParams({ ...params, resultOffset: off, resultRecordCount: 2000 })}`);
    out.push(...(d.features || []));
    if ((d.features || []).length < 2000 && !d.exceededTransferLimit) return out;
  }
}
async function cached(file, refresh, fetcher) {
  const f = CACHE + file;
  if (!refresh && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fetcher();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}
async function edited(url) {
  const d = await getJSON(`${url}?f=json`);
  const t = d.editingInfo?.dataLastEditDate || d.editingInfo?.lastEditDate;
  return t ? new Date(t).toISOString().slice(0, 10) : null;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const signed = await cached('signed-no-parking-2019.json', refresh, () => layer(SIGNED, { where: '1=1', outFields: 'FID,Route,Day_,Week,Time_,ST_NAME,Type', outSR: 4326, f: 'geojson', orderByFields: 'FID' }));
  const parcels = await cached('parcel-schedule.json', refresh, async () => (await layer(PARCELS, { where: '1=1', outFields: 'FID,STNAME,S_ROUTE,NEW_DAY,NEW_WEEK,SWEEP_TIME,TrashCat',
    returnGeometry: 'false', returnCentroid: 'true', outSR: 4326, f: 'json', orderByFields: 'FID' }))
    .map((f) => ({ ...f.attributes, c: f.centroid ? [+f.centroid.x.toFixed(6), +f.centroid.y.toFixed(6)] : null })));
  const streets = await cached('streets-2023.json', refresh, () => layer(STREETS, { where: '1=1', outFields: 'FID,STREET_ID,FACILITYID,FULL_NAME,ST_NAME,TYPE,FROM_ST,TO_ST', outSR: 4326, f: 'geojson', orderByFields: 'FID' }));
  const dates = await cached('edited.json', refresh, async () => ({ signed: await edited(SIGNED), parcels: await edited(PARCELS), streets: await edited(STREETS) }));
  if (signed.length < 300 || parcels.length < 20000 || streets.length < 2000) throw new Error(`the layers changed: ${signed.length} signs, ${parcels.length} parcels, ${streets.length} streets`);
  for (const k of ['Route', 'Day_', 'Week', 'Time_', 'ST_NAME']) if (!(k in (signed[0].properties || {}))) throw new Error(`SignedNoParking has no ${k}`);

  for (const s of streets) s.key = streetKey(s.properties.FULL_NAME || s.properties.ST_NAME);
  const nearest = streetIndex(streets);

  // today's schedule, side by side: each parcel on the nearest segment of its own street (80 m), on its side
  const today = new Map();                      // si|side → Map(record → count)
  let placed = 0;
  for (const p of parcels) {
    if (!p.c) continue;
    const r = nearest(p.c, streetKey(p.STNAME), 80);
    if (!r) continue;
    placed++;
    const k = r.si + '|' + r.side, rec = [p.S_ROUTE, p.NEW_DAY, p.NEW_WEEK, p.SWEEP_TIME].map((v) => String(v || '').trim()).join('|');
    if (!today.has(k)) today.set(k, new Map());
    today.get(k).set(rec, (today.get(k).get(rec) || 0) + 1);
  }
  const todayOf = (k) => {
    const m = today.get(k);
    if (!m) return null;
    const [rec, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const [route, day, week, time] = rec.split('|');
    return { route, day, week, time, n, of: [...m.values()].reduce((a, b) => a + b, 0), rules: scheduleRules({ NEW_DAY: day, NEW_WEEK: week, SWEEP_TIME: time }) };
  };

  // the signs, side by side
  const sides = new Map();                      // si|side → { si, side, signs: [] }
  const unread = [], unplaced = [];
  for (const f of signed) {
    const p = f.properties, rules = signRules(p);
    if (!rules) { unread.push({ fid: p.FID, street: `${p.ST_NAME} ${p.Type}`.trim(), day: p.Day_, week: p.Week, time: p.Time_ }); continue; }
    const on = signSides(f, streetKey(p.ST_NAME, p.Type), nearest);
    if (!on.length) { unplaced.push({ fid: p.FID, street: `${p.ST_NAME} ${p.Type}`.trim() }); continue; }
    for (const { si, side } of on) {
      const k = si + '|' + side;
      if (!sides.has(k)) sides.set(k, { si, side, signs: [] });
      sides.get(k).signs.push({ route: String(p.Route || '').trim(), day: p.Day_, week: p.Week, time: p.Time_, rules });
    }
  }

  const classes = { agree: [], 'hours differ': [], 'days differ': [], 'no schedule': [], 'signs disagree': [] };
  const pairs = new Map();
  for (const [k, e] of sides) {
    const s = streets[e.si].properties;
    const signKeys = new Set(e.signs.map((x) => JSON.stringify(x.rules)));
    const item = { segment: s.FACILITYID || String(s.STREET_ID), street: s.FULL_NAME, between: [s.FROM_ST, s.TO_ST].filter((x) => String(x || '').trim()).join(' - '), side: e.side,
      sign: [...new Set(e.signs.map((x) => `${x.route} ${x.day} ${x.week} ${x.time}`))].join(' / ') };
    if (signKeys.size > 1) { classes['signs disagree'].push(item); continue; }
    const t = todayOf(k), cls = compare(e.signs[0].rules, t && t.rules);
    if (t) { item.today = `${t.route} ${t.day} ${t.week} ${t.time}`; item.parcels = `${t.n} of ${t.of}`; }
    classes[cls].push(item);
    if (t) { const pk = `${e.signs[0].time} | ${t.time}`; pairs.set(pk, (pairs.get(pk) || 0) + 1); }
  }
  const n = (c) => classes[c].length, total = sides.size;
  const byStreet = (list) => Object.entries(list.reduce((m, x) => { m[x.street] = (m[x.street] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s} (${c})`);

  const today2 = new Date().toISOString().slice(0, 10);
  const report = {
    generated: new Date().toISOString(),
    built: false,
    why: 'Which streets get tickets, and on which days and hours, cannot be told from the City\'s data today. The City says most residential routes are unposted and only "some high traffic streets" are posted; '
      + `its only data on which is the SignedNoParking layer, last edited ${dates.signed}, and today's schedule (StreeSweep_Times, edited ${dates.parcels}) disagrees with it on ${Math.round(100 * (n('days differ') + n('hours differ')) / Math.max(1, total - n('no schedule') - n('signs disagree')))}% `
      + `of the signed sides it reaches (other days on ${n('days differ')}, same days but other hours on ${n('hours differ')}, agreeing on ${n('agree')}). `
      + 'A map drawn from the 2019 signs would show a wrong day or wrong hours wherever the signs have changed since; one drawn from today\'s schedule would mark every street no parking, when most are not posted. No segments.json was written.',
    rule: { posted: 'Some high traffic streets are posted with a "No Parking" sign that states the time and day of the week the street vacuum comes through. The Police Department will issue citations for violations of the posted restrictions.',
      unposted: 'Most neighborhood routes do not have signage restricting parking during street cleaning ... We ask residents to voluntarily move their cars.',
      fine: '$41', tow: 'none mentioned', holidays: 'We street clean every day of the year except for City Holidays.', source: PAGES.residential,
      expansion: 'In 2018 the City changed routes by trash generation and proposed more parking restriction signs on red/high generation streets (' + PAGES.improvements + '); which signs went up is not published beyond the 2019 layer.' },
    sources: [
      { name: 'SignedNoParking_10_2019 (City of San Mateo ArcGIS)', url: SIGNED, edited: dates.signed, license: 'not stated', fetched: today2 },
      { name: 'StreeSweep_Times (City of San Mateo ArcGIS), parcels: street, route and schedule only', url: PARCELS, edited: dates.parcels, license: 'not stated', fetched: today2 },
      { name: 'Streets_8_9_23 (City of San Mateo ArcGIS), centerline', url: STREETS, edited: dates.streets, license: 'not stated', fetched: today2 },
    ],
    input: { signedPieces: signed.length, signedStreets: new Set(signed.map((f) => `${f.properties.ST_NAME} ${f.properties.Type}`.trim())).size,
      signsByHours: Object.fromEntries(Object.entries(signed.reduce((m, f) => { m[f.properties.Time_] = (m[f.properties.Time_] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1])),
      parcels: parcels.length, parcelsPlaced: placed, centerlineSegments: streets.length,
      scheduleByTime: Object.fromEntries(Object.entries(parcels.reduce((m, p) => { const k = String(p.SWEEP_TIME || '').trim() || '(blank)'; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1])) },
    signedSides: { method: 'Each signed piece is drawn 5 to 12 m off the centerline, along the curb: sampled every 5 m and put on the nearest centerline segment of its street (25 m) and on that side. '
      + 'Each parcel goes on the nearest segment of its street (80 m), on its side; today\'s schedule for a side is its parcels\' most common record. A signed side "agrees" when today\'s days, weeks and hours are the sign\'s.',
      sides: total, agree: n('agree'), hoursDiffer: n('hours differ'), daysDiffer: n('days differ'), noSchedule: n('no schedule'), signsDisagree: n('signs disagree'),
      unreadSigns: unread, unplacedSigns: unplaced,
      signHoursVsTodaysHours: Object.fromEntries([...pairs.entries()].sort((a, b) => b[1] - a[1])),
      agreeStreets: byStreet(classes.agree), hoursDifferStreets: byStreet(classes['hours differ']), daysDifferStreets: byStreet(classes['days differ']),
      examples: Object.fromEntries(Object.entries(classes).map(([c, l]) => [c, l.slice(0, 12)])) },
    ifBuilt: `With the City's word that the 2019 layer is still what the signs say, the ${total} signed sides could be built from it as they are (days, weeks and hours from the signs). `
      + `Taking only the ${n('agree')} sides where the 2019 sign and today's schedule agree would give a partial map: posted streets missing from it would look unswept.`,
    questionsForTheCity: [
      'Which streets are posted with street sweeping "No Parking" signs today? Is the SignedNoParking_10_2019 layer still current, or is there a newer one?',
      'On posted streets, do the signs show the hours in StreeSweep_Times (SWEEP_TIME) or other hours? Downtown signs in the 2019 layer say 4-6 AM, today\'s schedule 3-5 AM.',
      'Are the 2018 "proposed new signage" streets (red, high trash generation) all posted now?',
      'Which City holidays stop street sweeping and its ticketing, and is there a list for 2026 and 2027?',
      'Is the fine still $41, and are cars ever towed for street sweeping?',
    ],
    contact: 'StreetSweeping@cityofsanmateo.org',
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');
  log(`${signed.length} signed pieces on ${report.input.signedStreets} streets → ${total} signed sides: ${n('agree')} agree with today's schedule, ${n('hours differ')} other hours, ${n('days differ')} other days, ${n('no schedule')} no parcels, ${n('signs disagree')} two signs; ${unread.length} unread, ${unplaced.length} unplaced`);
  log(`${placed} of ${parcels.length} parcels placed; wrote data/san-mateo/report.json (${Math.round(fs.statSync(OUT + 'report.json').size / 1024)} KB), no segments.json`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
