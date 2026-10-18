#!/usr/bin/env node
// Madison, Wisconsin for CURB (built 2026-10-18, by docs/multi-city/city-build.md). Writes data/madison/ from the City of
// Madison's public map services (maps.cityofmadison.com, open to scripts):
//
//   1. Street Sweeping Restrictions (Public/OPEN_DATA_TE/MapServer/5, Traffic Engineering): 1,712 posted "No Parking"
//      street sweeping signs, each a line along its curb (2 to 6 m off the street centerline), with the sign's full text
//      ("No Parking 8AM-12PM Thursdays", some with "May1-Nov15" or "Mar16-Nov30"), its day, hours and season flags.
//   2. Pavement Centerlines (Public/OPEN_DATA_ENGR/MapServer/1, City Engineering): 11,365 street segments with names, cross
//      streets, left and right address ranges, functional class and alder district. A sweeping line belongs to the
//      centerline it runs along, on the side it is drawn on.
//   3. Neighborhood Associations (Public/OPEN_DATA/MapServer/12): the registered association each block lies in.
//
// Plus the winter rule, from the City's own pages (no dataset): alternate side parking, November 15 to March 15, 1 to 7 AM,
// on every City street outside the Snow Emergency Zone, written as listed dates per side (odd or even house numbers).
//
// Run: node scripts/cities/madison.mjs [--refresh]   (Node 18+; inputs cached in private/cache/madison/)

import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/madison/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/madison/';
const REFRESH = process.argv.includes('--refresh');
// The winter rule waits for a design decision (a date-parity rule, alerts every other night for four months) and for the
// City's 2026-27 enforcement model; --with-winter builds it.
const WITH_WINTER = process.argv.includes('--with-winter');
const log = (...a) => console.error('[madison]', ...a);

const MAPS = 'https://maps.cityofmadison.com/arcgis/rest/services/Public/';
export const SWEEP_URL = MAPS + 'OPEN_DATA_TE/MapServer/5';
export const CENTERLINE_URL = MAPS + 'OPEN_DATA_ENGR/MapServer/1';
export const HOODS_URL = MAPS + 'OPEN_DATA/MapServer/12';
// The Snow Emergency Zone's official map: the City's Google My Maps embed on
// cityofmadison.com/live-work/winter/parking/declared-snow-emergencies, one polygon. No GIS layer has it, and the alder
// districts the City's page names ("2, 4, 6, 8 and 13, and part of 5") are the pre-2022 districts: MGO 12.1335(2) now draws
// the zone street by street (ORD-25-00061, 2025-09-02) without changing it.
export const SEZ_KML_URL = 'https://www.google.com/maps/d/kml?mid=1_AfemcsaUhB9B2HnEM4CZGGVjGSE3AMJ&forcekml=1';

// ---------- facts (checked 2026-10-18; sources in city.json and docs/multi-city/madison.md) ----------------------------

// MGO 12.1335(1): "From the dates of November 15 to March 15, between the hours of 1:00 a.m. and 7:00 a.m. all vehicles will
// be parked only on the even-numbered side of the street on even-numbered calendar days, and only on the odd side of the
// street on odd-numbered calendar days". The date is the morning's: the first window is 1 AM on November 15, the last ends
// 7 AM on March 15. Inside the Snow Emergency Zone it applies only in a declared snow emergency, so the zone is left out.
export const WINTER = { from: '2026-11-15', to: '2027-03-15', start: 1, end: 7 };
// Flags: 1 = holidays too, 2 = towable. The winter rule has no holiday exception and is towable (MGO 12.1335(4)(d)). The
// sweeping signs carry no holiday exception either and may be towed (Parking Enforcement FAQ); whether they are enforced on
// the City's eight parking holidays is not settled, so they keep running on holidays here (the cautious reading).
const SWEEP_FLAGS = 3;
const WINTER_FLAGS = 3;

// city.json (bounds and holidays are added by the build)
export const CITY = { id: 'madison', name: 'Madison', region: 'Wisconsin', tz: 'America/Chicago',
  center: [43.088, -89.355], zoom: 14 };   // the east isthmus and Schenk-Atwood: posted sweeping, inside and outside the zone
// The City's parking holidays: "On-street meters and time-related parking restrictions are not enforced on the following
// City Holidays" (Parking Utility; MGO 12.01). Calendar dates, as the City lists them. Ho-Chunk Day, Christmas Eve and New
// Year's Eve close City offices but parking is enforced.
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
  '2026-07-04': 'Independence Day', '2026-09-07': 'Labor Day', '2026-11-26': 'Thanksgiving Day', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-05-31': 'Memorial Day', '2027-06-19': 'Juneteenth',
  '2027-07-04': 'Independence Day', '2027-09-06': 'Labor Day', '2027-11-25': 'Thanksgiving Day', '2027-12-25': 'Christmas Day',
};
const CITY_LATE = {
  holidaysSource: 'https://www.cityofmadison.com/parking/parking-enforcement/frequently-asked-questions',
  holidayRule: 'all',
  fine: '$35', tow: 'sometimes', fineSource: 'https://parkingtickets.cityofmadison.com/',
  agency: 'City of Madison Parking Utility and Streets Division',
  scheduleUrl: 'https://www.cityofmadison.com/streets/street-maintenance/clean-streets-clean-lakes',
  words: WITH_WINTER ? {
    rule: 'Posted street sweeping (Clean Streets Clean Lakes), one weekday morning or midday a week per side; and from November 15 to March 15, 1 to 7 AM, park on the odd-numbered side on odd dates and the even side on even dates, outside the Snow Emergency Zone.',
    afterpass: 'Sweeping signs: a $35 ticket. Winter alternate side: $20, $60 in a declared snow emergency, and the car can be towed ($115). Last winter the City enforced it from its first plowing and paused it in dry spells.',
    dataNotes: 'Sweeping rules come from the City\'s Street Sweeping Restrictions (the posted signs), placed on the City\'s street centerlines by the curb side they are drawn on. The winter rule follows the ordinance on every City street with house numbers outside the Snow Emergency Zone, on the side the address ranges give.',
  } : {
    rule: 'Posted street sweeping (Clean Streets Clean Lakes): one weekday morning or midday a week on each signed side.',
    afterpass: 'Sweeping signs: a $35 ticket, and the car can be towed. Winter alternate side parking (November 15 to March 15) is not on this map.',
    dataNotes: 'Sweeping rules come from the City\'s Street Sweeping Restrictions (the posted signs), placed on the City\'s street centerlines by the curb side they are drawn on. Winter alternate side parking is not shown: the City has not said how it will enforce it this winter.',
  },
};

// ---------- decoding ---------------------------------------------------------------------------------------------------

const DAYS = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 };
// "8AM", "10:30AM", "12PM", "Noon", "9:30 am" → minutes after midnight, or null.
export function clockMinutes(s) {
  const t = String(s || '').trim().toUpperCase().replace(/\./g, '');
  if (t === 'NOON') return 720;
  if (t === 'MIDNIGHT') return 0;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/.exec(t);
  if (!m) return null;
  let h = +m[1] % 12;
  if (m[3] === 'PM') h += 12;
  return h * 60 + (m[2] ? +m[2] : 0);
}
export const hm = (min) => (min % 60 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : min / 60);
const monthsMask = (a, b) => { let m = 0; for (let i = a; i <= b; i++) m |= 1 << (i - 1); return m; };
export const SEASONS = { 'MAY1-NOV15': monthsMask(5, 11), 'MAR16-NOV30': monthsMask(3, 11) };

// One sign → { dow, from, to, season, text } from its full text ("No Parking 8AM-12PM Thursdays May1-Nov15"), else from its
// fields; or { skip: reason }.
export function parseSign(a) {
  if (a.DateRemoved) return { skip: 'sign removed' };
  const text = String(a.Restr_txt_full || '').replace(/\s+/g, ' ').trim();
  const T = '(\\d{1,2}(?::\\d{2})?\\s*(?:AM|PM)|NOON)';
  const m = new RegExp(`NO PARKING\\s*${T}\\s*-\\s*${T}\\s+(SUN|MON|TUE|WED|THU|FRI|SAT)[A-Z]*\\s*(MAY\\s*1\\s*-\\s*NOV\\s*15|MAR\\s*16\\s*-\\s*NOV\\s*30)?`, 'i').exec(text);
  let from, to, day, season = null;
  if (m) {
    from = clockMinutes(m[1]); to = clockMinutes(m[2]);
    day = Object.entries(DAYS).find(([k]) => k.startsWith(m[3].toUpperCase()))[1];
    if (m[4]) season = m[4].toUpperCase().replace(/\s+/g, '');
  } else {
    from = clockMinutes(a.StartTime); to = clockMinutes(a.EndTime);
    const d = String(a.Day || '').toUpperCase();
    day = Object.entries(DAYS).find(([k]) => d.startsWith(k.slice(0, 3)))?.[1];
  }
  if (from === null || to === null || from === undefined || to === undefined) return { skip: 'no hours' };
  if (day === undefined) return { skip: 'no day' };
  if (!season && a.May1_Nov15 === 'True') season = 'MAY1-NOV15';
  if (!season && a.Mar16_Nov30 === 'True') season = 'MAR16-NOV30';
  let fixed = null;
  if (to - from > 8 * 60) {
    // "No Parking 8AM-9:30PM": a 9:30 AM end with PM typed (the only window over 8 hours; 8AM-9:30AM is on 29 signs)
    if (to - 720 > from) { fixed = { was: [hm(from), hm(to)], now: [hm(from), hm(to - 720)] }; to -= 720; } else return { skip: 'window over 8 hours' };
  }
  if (to <= from) return { skip: 'window ends before it starts' };
  return { dow: day, from, to, season, text, fixed };
}
export const sweepRule = (s) => [s.dow, hm(s.from), hm(s.to), 31, s.season ? SEASONS[s.season] : 0, SWEEP_FLAGS];

// Every date of the winter season, split by the day of the month: odd dates and even dates ("YYYY-MM-DD").
export function winterDates(from = WINTER.from, to = WINTER.to) {
  const odd = [], even = [];
  for (let t = Date.parse(from + 'T12:00:00Z'); t <= Date.parse(to + 'T12:00:00Z'); t += 864e5) {
    const iso = new Date(t).toISOString().slice(0, 10);
    (+iso.slice(8, 10) % 2 ? odd : even).push(iso);
  }
  return { odd, even };
}

// ---------- geometry ----------------------------------------------------------------------------------------------------

const LAT0 = 43.07, LON0 = -89.4, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
const parity = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n % 2 : null; };
// A street with house numbers on one side only (along a park) still has an odd and an even side: the other one.
export function oddSide(a) {
  const l = parity(a.l_lo_addr) ?? parity(a.l_hi_addr), r = parity(a.r_lo_addr) ?? parity(a.r_hi_addr);
  if (l === 1 && r !== 1) return 'L';
  if (r === 1 && l !== 1) return 'R';
  if (l === 0 && r === null) return 'R';
  if (r === 0 && l === null) return 'L';
  return null;
}
// Points every `step` meters along a line (ends trimmed by `trim` meters), each with the line's direction there.
export function samples(c, step = 4, trim = 2) {
  const pts = c.map(xy), segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); total += d; }
  const out = [];
  if (total < 2 * trim + 1) trim = 0;
  for (let s = trim; s <= total - trim + 1e-9; s += Math.min(step, Math.max(1, (total - 2 * trim) / 2))) {
    let rest = s, i = 0;
    while (i < segs.length - 1 && rest > segs[i]) { rest -= segs[i]; i++; }
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], t = segs[i] ? rest / segs[i] : 0, len = segs[i] || 1;
    out.push({ p: [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t], d: [(x2 - x1) / len, (y2 - y1) / len] });
  }
  return out;
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
async function cachedText(name, fetcher) {
  const f = CACHE + name;
  if (!REFRESH && fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const v = await fetcher();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, v);
  return v;
}
// The polygons of a KML file: each <coordinates> list ("lng,lat,alt lng,lat,alt ...") → a ring of [lng, lat]. Only the
// coordinates are read (the map's description text is not used).
export function kmlRings(kml) {
  return [...String(kml).matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)]
    .map((m) => m[1].trim().split(/\s+/).map((t) => t.split(',').slice(0, 2).map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite)));
}
// Is a point within `m` meters of a ring's edge?
function nearRing(ring, p, m) {
  const [px, py] = xy(p);
  for (let i = 1; i < ring.length; i++) {
    const [x1, y1] = xy(ring[i - 1]), [x2, y2] = xy(ring[i]), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    if (Math.hypot(px - x1 - t * dx, py - y1 - t * dy) <= m) return true;
  }
  return false;
}
function expectFields(list, fields, what) {
  const a = list[0] && list[0].attributes;
  const missing = fields.filter((k) => !a || !(k in a));
  if (missing.length) throw new Error(`${what}: the City's data changed shape, missing ${missing.join(', ')}`);
}
// point in polygon (rings in [lng, lat]), even-odd
export function inRings(rings, [x, y]) {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- the build ---------------------------------------------------------------------------------------------------

async function build() {
  // created_user / last_edited_user name City staff: never requested
  const SWEEP_FIELDS = 'OBJECTID,Type,Restriction,Day,StartTime,EndTime,May1_Nov15,Mar16_Nov30,Restr_txt_full,DateInstalled,DateRemoved,Status,Note,last_edited_date';
  const LINE_FIELDS = 'OBJECTID,segment_id,Asset_ID,segment_name,from_segment,to_segment,municipality,funct_class,oneway,alternate_name,r_lo_addr,r_hi_addr,l_lo_addr,l_hi_addr,ald_dist,Status,Owner,maintained_by';
  const signs = await cached('sweeping-signs.json', () => { log('fetching street sweeping restrictions…'); return features(SWEEP_URL, '1=1', SWEEP_FIELDS); });
  const lines = await cached('pavement-centerlines.json', () => { log('fetching pavement centerlines…'); return features(CENTERLINE_URL, '1=1', LINE_FIELDS); });
  const hoods = await cached('neighborhood-associations.json', () => { log('fetching neighborhood associations…'); return features(HOODS_URL, '1=1', 'OBJECTID,NA_ID,NEIGHB_NAME,STATUS,CLASSIFICA'); });
  const kml = await cachedText('snow-emergency-zone.kml', async () => {
    log('fetching the Snow Emergency Zone map…');
    const r = await fetch(SEZ_KML_URL, { headers: { 'User-Agent': 'curb-city-build (+https://curb.guide)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for the Snow Emergency Zone map`);
    return r.text();
  });
  const sez = kmlRings(kml);
  if (sez.length !== 1 || sez[0].length < 50) throw new Error(`the Snow Emergency Zone map changed shape: ${sez.length} rings`);
  expectFields(signs, SWEEP_FIELDS.split(','), 'Street Sweeping Restrictions');
  expectFields(lines, LINE_FIELDS.split(','), 'Pavement Centerlines');
  if (signs.length < 1000 || signs.length > 4000) throw new Error(`${signs.length} sweeping signs: expected 1,000 to 4,000`);
  if (lines.length < 10000) throw new Error(`${lines.length} centerlines: expected over 10,000`);
  log(`${signs.length} sweeping signs, ${lines.length} centerline segments, ${hoods.length} neighborhood associations`);

  // centerlines: one block per feature, keyed by Asset_ID ("ST20575")
  const segs = [];
  const ids = new Map();
  for (const f of lines) {
    const a = f.attributes, path = f.geometry && f.geometry.paths && f.geometry.paths.length === 1 ? f.geometry.paths[0] : null;
    if (!path || path.length < 2 || !a.Asset_ID) continue;
    ids.set(a.Asset_ID, (ids.get(a.Asset_ID) || 0) + 1);
    segs.push({ a, c: path.map((p) => [p[0], p[1]]) });
  }
  const dupIds = [...ids].filter(([, n]) => n > 1).map(([k]) => k);
  if (dupIds.length > 20) throw new Error(`${dupIds.length} centerline Asset_IDs repeat: block ids would not be unique`);
  const usable = segs.filter((s) => ids.get(s.a.Asset_ID) === 1);

  // grid of centerline pieces
  const CELL = 40, cell = (v) => Math.floor(v / CELL), grid = new Map();
  usable.forEach((s, si) => {
    const pts = s.c.map(xy);
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      for (let cx = cell(Math.min(x1, x2) - 15); cx <= cell(Math.max(x1, x2) + 15); cx++)
        for (let cy = cell(Math.min(y1, y2) - 15); cy <= cell(Math.max(y1, y2) + 15); cy++) {
          const k = cx + ',' + cy;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([x1, y1, x2, y2, si]);
        }
    }
  });
  // the centerline piece a curb point lies along: within 15 m, parallel within ~30 degrees
  function along(p, d) {
    let best = null;
    for (const [x1, y1, x2, y2, si] of grid.get(cell(p[0]) + ',' + cell(p[1])) || []) {
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2)), dist = Math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy);
      if (dist > 15 || Math.abs((dx * d[0] + dy * d[1]) / Math.sqrt(l2)) < 0.87) continue;
      if (!best || dist < best.dist) best = { si, dist, side: dx * (p[1] - y1) - dy * (p[0] - x1) > 0 ? 'L' : 'R' };
    }
    return best;
  }

  const report = { signs: signs.length, used: 0, skipped: {}, unmatched: [], fixed: [], seasons: {}, offset: [], review: 0, sideAmbiguous: [], inZone: 0, windows: {}, centerlinesPerSign: {} };
  const skip = (why, a) => { const s = (report.skipped[why] ||= { n: 0, examples: [] }); s.n++; if (s.examples.length < 5) s.examples.push(a.OBJECTID); };
  const sides = new Map();   // segment index → Map(side → Map(ruleKey → rule))
  const put = (si, side, rule) => {
    if (!sides.has(si)) sides.set(si, new Map());
    const m = sides.get(si);
    if (!m.has(side)) m.set(side, new Map());
    m.get(side).set(rule.join('|'), rule);
  };
  for (const f of signs) {
    const a = f.attributes, s = parseSign(a);
    if (s.skip) { skip(s.skip, a); continue; }
    const path = f.geometry && f.geometry.paths && f.geometry.paths[0];
    if (!path || path.length < 2) { skip('no line', a); continue; }
    const votes = new Map();   // segment → { L, R } samples
    const pts = samples(path.map((p) => [p[0], p[1]]));
    for (const { p, d } of pts) {
      const hit = along(p, d);
      if (!hit) continue;
      if (!votes.has(hit.si)) votes.set(hit.si, { L: 0, R: 0 });
      votes.get(hit.si)[hit.side]++;
      report.offset.push(hit.dist);
    }
    // every centerline the sign runs along for at least 2 samples (8 m) or a third of its length, on the side most of its
    // samples are on (a sign drawn on the centerline itself splits them: counted as ambiguous)
    const hits = [...votes].filter(([, v]) => v.L + v.R >= 2 || v.L + v.R >= pts.length / 3);
    if (!hits.length) { report.unmatched.push({ id: a.OBJECTID, text: s.text }); continue; }
    report.used++;
    if (inRings(sez, path[Math.floor(path.length / 2)])) report.inZone++;
    if (a.Note === 'Review') report.review++;
    if (s.fixed) report.fixed.push({ id: a.OBJECTID, text: s.text, ...s.fixed });
    const win = `${hm(s.from)}-${hm(s.to)}`;
    report.windows[win] = (report.windows[win] || 0) + 1;
    report.centerlinesPerSign[hits.length] = (report.centerlinesPerSign[hits.length] || 0) + 1;
    const sea = s.season || 'all year';
    report.seasons[sea] = (report.seasons[sea] || 0) + 1;
    for (const [si, v] of hits) {
      if (Math.min(v.L, v.R) > 0.4 * Math.max(v.L, v.R)) report.sideAmbiguous.push({ id: a.OBJECTID, text: s.text, samples: v });
      put(si, v.L >= v.R ? 'L' : 'R', sweepRule(s));
    }
  }
  const sweptSides = [...sides.values()].reduce((n, m) => n + m.size, 0), sweptBlocks = sides.size;

  // the winter rule: every City street with house numbers outside the Snow Emergency Zone, both sides
  const { odd, even } = winterDates();
  const winter = { segments: 0, sides: 0, leftOut: {}, nearZoneEdge: 0 };
  const out1 = (why) => { winter.leftOut[why] = (winter.leftOut[why] || 0) + 1; };
  if (WITH_WINTER) usable.forEach((s, si) => {
    const a = s.a, fc = String(a.funct_class || '');
    const mid = s.c[Math.floor(s.c.length / 2)];
    if (inRings(sez, mid)) return out1('in the Snow Emergency Zone');
    if (!['1', '2', '3', '4', '5'].includes(fc)) return out1(`functional class ${fc || 'none'} (ramp, alley, private or unbuilt)`);
    // City, state (WIDOT) and county (DANE) maintained streets are public streets of the City; private, University and
    // neighboring towns' streets are not the City's to sign
    if (a.maintained_by && !['MAD-C', 'WIDOT', 'DANE'].includes(a.maintained_by)) return out1(`maintained by ${a.maintained_by}`);
    if (nearRing(sez[0], mid, 25)) winter.nearZoneEdge++;
    const o = oddSide(a);
    if (!o) return out1('no odd and even address ranges');
    winter.segments++;
    // odd dates: park on the odd side, so the even side is closed 1 to 7 AM; even dates: the odd side is closed
    const evenSide = o === 'L' ? 'R' : 'L';
    put(si, o, [-1, WINTER.start, WINTER.end, 0, 0, WINTER_FLAGS, even]);
    put(si, evenSide, [-1, WINTER.start, WINTER.end, 0, 0, WINTER_FLAGS, odd]);
    winter.sides += 2;
  });

  // neighborhoods: the smallest active Neighborhood Association around the block's midpoint
  const hoodPolys = hoods.filter((h) => h.geometry && h.geometry.rings && /^active$/i.test(String(h.attributes.STATUS || '')))
    .map((h) => ({ name: String(h.attributes.NEIGHB_NAME || '').replace(/\s+/g, ' ').trim(), rings: h.geometry.rings,
      area: Math.abs(h.geometry.rings[0].reduce((s, p, i, r) => s + (i ? (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : 0), 0)) }))
    .filter((h) => h.name).sort((x, y) => x.area - y.area);
  const hoodAt = (c) => { const m = c[Math.floor(c.length / 2)]; const h = hoodPolys.find((p) => inRings(p.rings, m)); return h ? h.name : ''; };

  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const out = [];
  for (const [si, m] of sides) {
    const { a, c } = usable[si];
    const nums = ['l_lo_addr', 'l_hi_addr', 'r_lo_addr', 'r_hi_addr'].map((k) => Math.round(a[k])).filter((v) => v > 0);
    const odd2 = oddSide(a), cross = [a.from_segment, a.to_segment].filter(Boolean).map((v) => String(v).trim());
    out.push({ c: a.Asset_ID, s: String(a.segment_name || '').trim(), l: cross.join(' - '), h: hoodAt(c),
      ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}), ...(odd2 ? { o: odd2 } : {}),
      g: c.map(([lo, la]) => [r6(lo), r6(la)]),
      d: ['L', 'R'].filter((sd) => m.has(sd)).map((sd) => [sd, compass(c, sd), [...m.get(sd).values()].sort((x, y) => x[0] - y[0])]) });
  }
  out.sort((x, y) => x.s.localeCompare(y.s, 'en', { numeric: true }) || (x.n ? x.n[0] : 0) - (y.n ? y.n[0] : 0) || x.c.localeCompare(y.c));

  // ---------- write -----------------------------------------------------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: 'Street Sweeping Restrictions (Parking Utility, Clean Streets Clean Lakes)', url: 'https://data-cityofmadison.opendata.arcgis.com/', api: SWEEP_URL, license: 'City of Madison Data Policy (MGO 3.72: no use restrictions)', fetched: today },
    { name: 'Pavement Centerlines (City Engineering)', url: 'https://data-cityofmadison.opendata.arcgis.com/', api: CENTERLINE_URL, license: 'City of Madison Data Policy (MGO 3.72: no use restrictions)', fetched: today },
    { name: 'Neighborhood Associations', url: 'https://data-cityofmadison.opendata.arcgis.com/', api: HOODS_URL, license: 'City of Madison Data Policy (MGO 3.72: no use restrictions)', fetched: today },
    { name: 'Snow Emergency Zone map (City of Madison)', url: 'https://www.cityofmadison.com/live-work/winter/parking/declared-snow-emergencies', api: SEZ_KML_URL, license: 'City page', fetched: today },
    { name: 'Winter parking rules, MGO 12.1335', url: 'https://www.cityofmadison.com/live-work/winter/parking', license: 'facts', fetched: today },
  ];
  const sideCount = out.reduce((n, b) => n + b.d.length, 0);
  fs.mkdirSync(OUT, { recursive: true });
  const body = JSON.stringify({
    _meta: { city: 'madison', time_zone: 'America/Chicago', generated: new Date().toISOString(), winter: WITH_WINTER, sources, blocks: out.length, sides: sideCount,
      format: 'b[] = {c: Pavement Centerlines Asset_ID, s: street, l: cross streets, h: neighborhood association, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
        + 'rule = [jsDow, from, to ("H:MM" when not on the hour), weeksMask (31 = every week), monthsMask (bit m-1; 0 = all year), flags] for posted street sweeping, '
        + 'or [-1, 1, 7, 0, 0, 1, [dates]] for winter alternate side parking (1 to 7 AM on the listed dates; flags 1 = holidays too)' },
    b: out });
  fs.writeFileSync(OUT + 'segments.json', body);
  const gz = zlib.gzipSync(body).length;
  const rep = {
    generated: new Date().toISOString(),
    sweeping: { signs: report.signs, used: report.used, skipped: report.skipped, unmatched: report.unmatched.length, unmatchedSigns: report.unmatched,
      fixed: report.fixed, seasons: report.seasons, windows: Object.fromEntries(Object.entries(report.windows).sort((x, y) => y[1] - x[1])),
      centerlinesPerSign: report.centerlinesPerSign, markedReview: report.review, sideAmbiguous: report.sideAmbiguous, blocks: sweptBlocks, blockSides: sweptSides,
      curbOffsetMeters: quantiles(report.offset) },
    winter: { season: `${WINTER.from} to ${WINTER.to}, ${WINTER.start} to ${WINTER.end} AM`, dates: { odd: odd.length, even: even.length },
      segments: winter.segments, blockSides: winter.sides, leftOut: winter.leftOut, snowEmergencyZone: { source: SEZ_KML_URL, vertices: sez[0].length,
        note: 'the City\'s official map (a Google My Maps embed on its declared snow emergencies page); a block is in the zone when its midpoint is',
        sweepingSignsInZone: report.inZone, segmentsOutsideTheZoneWithin25mOfItsEdge: winter.nearZoneEdge } },
    output: { blocks: out.length, blockSides: sideCount, bytes: body.length, gzipBytes: gz },
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(rep, null, 1));
  // city.json: the city's facts (CITY above), its holidays and the map's frame (every City street centerline)
  let w = 180, so = 90, e = -180, n = -90;
  for (const sg of segs) for (const [lo, la] of sg.c) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < so) so = la; if (la > n) n = la; }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  fs.writeFileSync(OUT + 'city.json', JSON.stringify({ ...CITY, bounds: [[r4(so), r4(w)], [r4(n), r4(e)]], holidays: HOLIDAYS, ...CITY_LATE, sources }, null, 1));
  log(`sweeping: ${report.used}/${report.signs} signs on ${sweptSides} block sides (${sweptBlocks} blocks); skipped ${Object.entries(report.skipped).map(([k, v]) => `${v.n} ${k}`).join(', ')}; ${report.unmatched.length} not along a centerline`);
  log(`winter: ${winter.segments} segments, ${winter.sides} sides; left out ${Object.entries(winter.leftOut).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  log(`wrote ${out.length} blocks, ${sideCount} block sides; segments.json ${Math.round(body.length / 1024)} KB (${Math.round(gz / 1024)} KB gzip)`);
}
function quantiles(v) {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), q = (p) => Math.round(s[Math.floor(p * (s.length - 1))] * 10) / 10;
  return { p10: q(0.1), median: q(0.5), p90: q(0.9), max: q(1) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await build();
