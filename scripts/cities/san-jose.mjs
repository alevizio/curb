#!/usr/bin/env node
// San Jose for CURB (city build, docs/multi-city/city-build.md; research in docs/multi-city/san-jose.md).
// Builds data/san-jose/ from the City of San Jose's open data (geo.sanjoseca.gov, data.sanjoseca.gov, CC BY):
//
//   1. Residential Street Sweeping Routes (OPN_OpenDataService/MapServer/515): 18,810 centerline segments swept once a
//      month by the City's contractor ("1st Monday of the Month"). Only the 2,252 "Signed Route" segments have no
//      parking signs, so only they get tickets: the build keeps those. Their posted hours come in two windows around a
//      lunch break ("7AM to NOON  12:30PM to 5PM"), written as two rules on the same day.
//   2. Major Road Street Sweeping Routes (MapServer/516): 1,638 rows swept by City crews at night. The 526 signed rows
//      say per side what the sign says ("West Side: No Parking Tuesday 1am-6am, East Side: No Parking Wednesday
//      1am-6am"); the build keeps each side's no parking window and leaves out no stopping, time limits and loading.
//   3. Streets (MapServer/60): the City's centerlines. CENTERLINEID in 1 and 2 is a street's INTID here; it gives the
//      block line (one direction for every layer) and the house numbers on each side.
//   4. Neighborhoods (MapServer/549): the 297 neighborhoods the City drew in 2020, for `h` and the welcome card.
//
// Holidays: the City's own lookup tool (gis.sanjoseca.gov/maps/serviceslookuptool, its calendar API) moves a
// residential sweep one day later in the weeks of New Year's Day, Thanksgiving and Christmas, on and after the holiday
// ("Residential Street Sweep (Moved for Holiday)"), and cancels major road sweeps on City holidays.
//
// Run: node scripts/cities/san-jose.mjs [--refresh]   (Node 18+; inputs cached in private/cache/san-jose/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { partsOf, lineLen, compass, titleCase, addresses, hoodAt, midpoint, fetchLayer } from './santa-monica.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/san-jose/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/san-jose/';
const log = (...a) => console.error('[san-jose]', ...a);

const OPN = 'https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer/';
export const SOURCES = {
  residential: { url: OPN + '515', oid: 'OBJECTID', file: 'residential.json' },
  major: { url: OPN + '516', oid: 'OBJECTID', file: 'major.json' },
  streets: { url: OPN + '60', file: 'streets.json' },
  hoods: { url: OPN + '549', oid: 'OBJECTID', file: 'neighborhoods.json' },
};

const LAT0 = 37.33, LON0 = -121.89, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111000;
export const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];

// ---------- schedules -----------------------------------------------------------------------------

const DOW = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const ORD = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 };

/** "1st Monday of the Month" → { dow: 1, weeks: 1 } (weeks: bit n-1 = the nth time that weekday falls), or null. */
export function parseMonthly(s) {
  const m = /^\s*(1st|2nd|3rd|4th|5th)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+of\s+the\s+month\s*$/i.exec(s || '');
  return m ? { dow: DOW[m[2].toLowerCase()], weeks: 1 << (ORD[m[1].toLowerCase()] - 1) } : null;
}

// "7AM", "12:30PM", "NOON" → minutes after midnight
function clockMin(s) {
  const t = s.replace(/\s+/g, '').toUpperCase();
  if (t === 'NOON') return 720;
  const m = /^(\d{1,2})(?::(\d{2}))?(AM|PM)$/.exec(t);
  if (!m || +m[1] < 1 || +m[1] > 12) return null;
  return ((+m[1] % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + (m[2] ? +m[2] : 0);
}
const hm = (min) => (min % 60 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : min / 60);

/**
 * A residential sign's hours, "7AM to NOON  12:30PM to 5PM", → [[from, to], …] in 24 h (numbers, or "H:MM"). Some rows
 * list two signs' hours ("8AM to NOON  1PM to 5PM  9AM to NOON 1PM to 4PM"): windows that overlap or touch are merged,
 * so the result covers every hour any of them names.
 */
export function parseWindows(s) {
  const out = [];
  const re = /(\d{1,2}(?::\d{2})?\s*[AP]M|NOON)\s*to\s*(\d{1,2}(?::\d{2})?\s*[AP]M|NOON)/gi;
  for (let m; (m = re.exec(s || ''));) {
    const a = clockMin(m[1]), b = clockMin(m[2]);
    if (a !== null && b !== null && b > a) out.push([a, b]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const w of out) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]); else merged.push([...w]);
  }
  return merged.map(([a, b]) => [hm(a), hm(b)]);
}

const SIDE_WORD = { north: 'N', south: 'S', east: 'E', west: 'W', both: 'B' };
const NOT_SWEEPING = /no stopping|hour parking|minute parking|loading|anytime|permit|sat-sun|10pm/i;
/**
 * A major road's public posted text → { rules: [{ side: 'N'|'S'|'E'|'W'|'B', dows, weeks, from, to }], other: [text] }.
 * Clauses are "<North|South|East|West|Both> Side(s): <sign>"; a sign that is not a sweeping window (no stopping, time
 * limits, loading, permits, a weekend daytime ban) goes to `other`.
 */
export function parsePosted(text) {
  const rules = [], other = [];
  const re = /(North|South|East|West|Both)\s+Sides?:\s*(.*?)(?=,\s*(?:North|South|East|West|Both)\s+Sides?:|$)/gi;
  for (let m; (m = re.exec(String(text || '').replace(/\([^)]*\)/g, '').trim()));) {
    const side = SIDE_WORD[m[1].toLowerCase()], sign = m[2].trim().replace(/[,\s]+$/, '');
    if (!sign) continue;
    if (NOT_SWEEPING.test(sign)) { other.push(`${m[1]}: ${sign}`); continue; }
    const t = /(\d{1,2}(?::\d{2})?\s*[ap]m)\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i.exec(sign);
    const a = t && clockMin(t[1]), b = t && clockMin(t[2]);
    let dows = [];
    if (/any\s*day/i.test(sign)) dows = [0, 1, 2, 3, 4, 5, 6];
    else for (const [w, d] of Object.entries(DOW)) if (new RegExp(`\\b${w}s?\\b`, 'i').test(sign)) dows.push(d);
    const ords = [...sign.matchAll(/\b(1st|2nd|3rd|4th|5th)\b/gi)].map((x) => ORD[x[1].toLowerCase()]);
    const weeks = ords.length ? ords.reduce((s, n) => s | (1 << (n - 1)), 0) : 31;
    // a window ending at or before it starts runs past midnight ("6pm-8am"): the format writes it with `to` < `from`
    if (a === null || b === null || !t || b === a || !dows.length) { other.push(`${m[1]}: ${sign}`); continue; }
    rules.push({ side, dows, weeks, from: hm(a), to: hm(b) });
  }
  return { rules, other };
}

/** Which side of a line (L|R, looking from its first point to its last) faces the compass word N, S, E or W. */
export function sideFacing(coords, dir, project = xy) {
  const a = project(coords[0]), b = project(coords[coords.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const left = Math.atan2(dx, -dy), want = { E: 0, N: Math.PI / 2, W: Math.PI, S: -Math.PI / 2 }[dir];
  const diff = Math.abs(((left - want + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  return diff < Math.PI / 2 ? 'L' : 'R';
}

// "MT KENYA DR" → "Mt Kenya Dr", "EOS" → "End"; the residential data abbreviates street types (AV, WY, BL, CR, EX)
const TYPE = { AV: 'Ave', WY: 'Way', BL: 'Blvd', CR: 'Cir', CL: 'Cir', TR: 'Ter', EX: 'Expy', PY: 'Pkwy', LP: 'Loop', HY: 'Hwy', RP: 'Ramp' };
export function crossName(s) {
  const t = String(s || '').trim();
  if (!t || /^EOS$/i.test(t)) return t ? 'End' : '';
  const w = t.split(/\s+/);
  const last = w[w.length - 1].toUpperCase();
  if (w.length > 1 && TYPE[last]) w[w.length - 1] = TYPE[last];
  return t === t.toUpperCase() ? titleCase(w.join(' ')) : w.join(' ');
}

// ---------- holidays ------------------------------------------------------------------------------

// The posted day of a residential sweep that the City moves for a holiday: the City's lookup calendar
// (sanjoseserviceslookup.herokuapp.com, behind gis.sanjoseca.gov/maps/serviceslookuptool, read 2026-10-18) shows
// "Residential Street Sweep (Moved for Holiday)" on Sat 2026-11-28 (4th Friday), Sat 2026-12-26 (4th Friday) and Sat
// 2027-01-02 (1st Friday): in the weeks of New Year's Day, Thanksgiving and Christmas, a sweep on or after the holiday
// moves one day later, like garbage collection (greenwaste.com/service-areas/san-jose), and the signs name no such day.
// Other City holidays (Indigenous Peoples Day 2026-10-12, Veterans Day 2026-11-11, MLK Day 2027-01-18, Presidents' Day
// 2027-02-15) keep their residential sweeps. 2026-01-01/02 and 2027-11-25/26 are derived by the same rule; Christmas
// 2027 and New Year's Day 2028 fall on Saturdays and move nothing (unverified: past the calendar's 12 months).
// Major road sweeps (City crews) are canceled on every City holiday; only these dates are listed, so on the other City
// holidays the map still shows a major road sweep the City cancels.
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-02': "New Year's week (Friday sweeps move to Saturday)",
  '2026-11-26': 'Thanksgiving Day', '2026-11-27': 'Thanksgiving week (Friday sweeps move to Saturday)',
  '2026-12-25': 'Christmas Day', '2027-01-01': "New Year's Day",
  '2027-11-25': 'Thanksgiving Day', '2027-11-26': 'Thanksgiving week (Friday sweeps move to Saturday)',
};

// ---------- build ---------------------------------------------------------------------------------

async function getJSON(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-city-build (+https://curb.guide)' } });
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
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const DAY3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function main() {
  const refresh = process.argv.includes('--refresh');
  const residential = await cached(SOURCES.residential.file, () => { log('fetching residential routes…'); return fetchLayer(SOURCES.residential); }, refresh);
  const major = await cached(SOURCES.major.file, () => { log('fetching major road routes…'); return fetchLayer(SOURCES.major); }, refresh);
  const hoods = await cached(SOURCES.hoods.file, () => { log('fetching neighborhoods…'); return fetchLayer(SOURCES.hoods); }, refresh);
  const ROUTE = ['CENTERLINEID', 'ROUTETYPE', 'SIDEOFROAD', 'ROADNAME', 'ROADFROM', 'ROADTO', 'APPWEEKDAY', 'POSTEDTIME', 'APPPUBLICPOSTEDTIMES', 'LASTUPDATE'];
  expectShape('residential', residential, ROUTE, 15000);
  expectShape('major', major, ROUTE, 1000);
  expectShape('neighborhoods', hoods, ['NAME'], 200);
  const signedRes = residential.filter((f) => f.properties.ROUTETYPE === 'Signed Route');
  const signedMajor = major.filter((f) => f.properties.ROUTETYPE === 'Signed Route');
  const ids = [...new Set([...signedRes, ...signedMajor].map((f) => f.properties.CENTERLINEID))].sort((a, b) => a - b);
  const streets = await cached(SOURCES.streets.file, async () => {
    log(`fetching ${ids.length} street centerlines…`);
    const out = [];
    for (let i = 0; i < ids.length; i += 200) {
      const q = new URLSearchParams({ where: `INTID IN (${ids.slice(i, i + 200).join(',')})`, outFields: 'INTID,FULLNAME,FROMLEFT,TOLEFT,FROMRIGHT,TORIGHT,LASTUPDATE',
        outSR: '4326', f: 'geojson' });
      out.push(...((await getJSON(`${SOURCES.streets.url}/query?${q}`)).features || []));
    }
    return out;
  }, refresh);
  expectShape('streets', streets, ['INTID', 'FULLNAME', 'FROMLEFT', 'TOLEFT', 'FROMRIGHT', 'TORIGHT'], 1000);
  log(`${residential.length} residential rows (${signedRes.length} signed), ${major.length} major road rows (${signedMajor.length} signed), ${streets.length} centerlines, ${hoods.length} neighborhoods`);

  const streetById = new Map(streets.map((f) => [f.properties.INTID, f]));
  const blocks = new Map();   // CENTERLINEID → { coords, name, from, to, sides: Map(L|R → Map(ruleKey → rule)), kinds }
  const block = (p, f) => {
    if (!blocks.has(p.CENTERLINEID)) {
      const st = streetById.get(p.CENTERLINEID), g = (st && partsOf(st.geometry)[0]) || partsOf(f.geometry)[0];
      blocks.set(p.CENTERLINEID, { coords: g, st, name: p.ROADNAME, from: p.ROADFROM, to: p.ROADTO, sides: new Map(), kinds: new Set() });
    }
    return blocks.get(p.CENTERLINEID);
  };
  const add = (b, side, rule) => {
    if (!b.sides.has(side)) b.sides.set(side, new Map());
    b.sides.get(side).set(rule.join('|'), rule);
  };
  const skipped = { residential: [], major: [] }, otherSigns = {};

  // 1. residential signed routes: the posted nth weekday, both sides (one row says West side only)
  for (const f of signedRes) {
    const p = f.properties, mo = parseMonthly(p.APPWEEKDAY), wins = parseWindows(p.POSTEDTIME);
    if (!mo || !wins.length) { skipped.residential.push({ c: String(p.CENTERLINEID), s: p.ROADNAME, l: `${p.ROADFROM} - ${p.ROADTO}`, why: !mo ? `day "${p.APPWEEKDAY}"` : `posted time "${(p.POSTEDTIME || '').trim()}"` }); continue; }
    const b = block(p, f);
    b.kinds.add('residential');
    const sides = p.SIDEOFROAD === 'Both' ? ['L', 'R'] : [sideFacing(b.coords, SIDE_WORD[String(p.SIDEOFROAD).toLowerCase()])];
    for (const side of sides) for (const [from, to] of wins) add(b, side, [mo.dow, from, to, mo.weeks, 0, 0]);
  }
  // 2. major road signed rows: each side's posted no parking window
  for (const f of signedMajor) {
    const p = f.properties, { rules, other } = parsePosted(p.APPPUBLICPOSTEDTIMES);
    for (const o of other) otherSigns[o.replace(/^\w+: /, '')] = (otherSigns[o.replace(/^\w+: /, '')] || 0) + 1;
    if (!rules.length) { skipped.major.push({ c: String(p.CENTERLINEID), s: p.ROADNAME, posted: (p.APPPUBLICPOSTEDTIMES || '').trim() }); continue; }
    const b = block(p, f);
    b.kinds.add('major');
    for (const r of rules) {
      const sides = r.side === 'B' ? ['L', 'R'] : [sideFacing(b.coords, r.side)];
      for (const side of sides) for (const dow of r.dows) add(b, side, [dow, r.from, r.to, r.weeks, 0, 0]);
    }
  }

  // 3. blocks out
  const out = [], hoodBoxes = new Map(), hoodCount = {};
  for (const [id, b] of blocks) {
    if (!b.sides.size) continue;
    const props = b.st && b.st.properties;
    const { n, o } = props ? addresses([{ piece: props, fwd: true }], ['FROMLEFT', 'TOLEFT', 'FROMRIGHT', 'TORIGHT']) : { n: null, o: null };
    const hood = hoodAt(midpoint(b.coords), hoods, 'NAME');
    const d = [...b.sides.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([side, rules]) => [side, compass(b.coords, side, xy),
      [...rules.values()].sort((x, y) => x[0] - y[0] || x[3] - y[3] || String(x[1]).localeCompare(String(y[1]), 'en', { numeric: true }))]);
    const blk = { c: String(id), s: b.name || (props && props.FULLNAME) || '', l: [crossName(b.from), crossName(b.to)].filter(Boolean).join(' - '),
      ...(hood ? { h: hood } : {}), ...(n ? { n } : {}), ...(o ? { o } : {}), g: b.coords.map(([lo, la]) => [r6(lo), r6(la)]), d };
    out.push(blk);
    if (hood) {
      hoodCount[hood] = (hoodCount[hood] || 0) + 1;
      const bb = hoodBoxes.get(hood) || [180, 90, -180, -90];
      for (const [lo, la] of blk.g) { bb[0] = Math.min(bb[0], lo); bb[1] = Math.min(bb[1], la); bb[2] = Math.max(bb[2], lo); bb[3] = Math.max(bb[3], la); }
      hoodBoxes.set(hood, bb);
    }
  }
  out.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));

  // 4. counts
  const sideCount = out.reduce((s, b) => s + b.d.length, 0), ruleCount = out.reduce((s, b) => s + b.d.reduce((t, [, , r]) => t + r.length, 0), 0);
  const kinds = { residential: 0, major: 0, both: 0 };
  for (const b of blocks.values()) if (b.sides.size) { if (b.kinds.size === 2) kinds.both++; else kinds[[...b.kinds][0]]++; }
  const byRule = {};
  for (const b of out) for (const [, , rs] of b.d) for (const r of rs) {
    const k = `${DAY3[r[0]]} ${r[1]}-${r[2]} weeks ${r[3]}`;
    byRule[k] = (byRule[k] || 0) + 1;
  }
  const noStreet = [...blocks.keys()].filter((id) => !streetById.has(id)).length;
  const lastUpdate = (fs2) => new Date(Math.max(...fs2.map((f) => f.properties.LASTUPDATE || 0))).toISOString().slice(0, 10);

  // 5. write
  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: 'Residential Street Sweeping Routes (Department of Transportation)', url: 'https://data.sanjoseca.gov/dataset/residential-street-sweeping-routes', license: 'CC BY', fetched: today },
    { name: 'Major Road Street Sweeping Routes (Department of Transportation)', url: 'https://data.sanjoseca.gov/dataset/major-road-street-sweeping-routes', license: 'CC BY', fetched: today },
    { name: 'Streets', url: SOURCES.streets.url, license: 'CC BY', fetched: today },
    { name: 'Neighborhoods', url: SOURCES.hoods.url, license: 'CC BY', fetched: today },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  let w = 180, s = 90, e = -180, nn = -90;
  for (const b of out) for (const [lo, la] of b.g) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); nn = Math.max(nn, la); }
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'san-jose', time_zone: 'America/Los_Angeles', generated: new Date().toISOString(), sources, blocks: out.length, sides: sideCount,
      format: 'b[] = {c: CENTERLINEID (the Streets layer INTID), s: street, l: cross streets, h: neighborhood (2020 boundaries), n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
        + 'rule = [jsDow, from, to, weeksMask (bit i = week i+1; 31 = every week), monthsMask (0 = all year), flags (0: holidays stop it, no tow)]; a residential side has two rules on its day, one per window around the lunch break' },
    b: out }));

  const city = {
    id: 'san-jose', name: 'San Jose', region: 'California', tz: 'America/Los_Angeles',
    center: [37.3455, -121.8332], zoom: 15,   // the most signed blocks within 600 m (east San Jose, around Alum Rock Ave)
    bounds: [[+(s - 0.003).toFixed(4), +(w - 0.003).toFixed(4)], [+(nn + 0.003).toFixed(4), +(e + 0.003).toFixed(4)]],
    holidays: HOLIDAYS, holidaysSource: 'https://gis.sanjoseca.gov/maps/serviceslookuptool/', holidayRule: 'all',
    fine: '$65', tow: 'no', fineSource: 'https://sanjoseca.govnita.com/workspaces/Resolutions?query=RES2025-272',
    agency: 'City of San Jose Department of Transportation', scheduleUrl: 'https://www.sanjoseca.gov/your-government/departments-offices/transportation/streets/street-sweeping',
    sources,
    words: {
      rule: 'Residential streets with no parking signs: once a month, on the weekday and hours on the sign, both sides the same day. Downtown and major streets with signs: the night or morning on the sign, often a different day for each side.',
      afterpass: 'All year · residential sweeps in the weeks of Thanksgiving, Christmas and New Year\'s Day move one day later · $65 ticket, no tow',
      dataNotes: 'The City\'s street sweeping routes (Department of Transportation, data.sanjoseca.gov, CC BY 4.0): only the routes with no parking signs, where tickets are written; streets without signs are swept monthly too but get no tickets. Residential hours are the sign\'s two windows around a lunch break; the major road windows come from the City\'s posted text for each side, placed by compass.',
    },
    neighborhoods: [...hoodBoxes.entries()].filter(([h]) => hoodCount[h] >= 30).sort((x, y) => x[0].localeCompare(y[0]))
      .map(([name, bb]) => ({ name, bbox: bb.map((v) => v.toFixed(4)).join(',') })),
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1));

  const report = {
    generated: new Date().toISOString(),
    season: 'All year. Residential: once a month on the nth weekday (posted). Major roads: weekly or 1st and 3rd / 2nd and 4th weekdays, at night or early morning (posted). Residential sweeps in the weeks of New Year\'s Day, Thanksgiving and Christmas move one day later from the holiday on (City lookup calendar); major road sweeps are canceled on City holidays, of which only those dates are in holidays.',
    input: {
      residentialRows: residential.length, residentialSigned: signedRes.length, residentialNotSigned: residential.length - signedRes.length,
      residentialByType: residential.reduce((o, f) => ((o[f.properties.ROUTETYPE] = (o[f.properties.ROUTETYPE] || 0) + 1), o), {}),
      majorRows: major.length, majorSigned: signedMajor.length, majorByType: major.reduce((o, f) => ((o[f.properties.ROUTETYPE] = (o[f.properties.ROUTETYPE] || 0) + 1), o), {}),
      residentialLastUpdate: lastUpdate(residential), majorLastUpdate: lastUpdate(major),
      centerlinesFound: streets.length, centerlinesMissing: noStreet,
    },
    output: { blocks: out.length, sides: sideCount, rules: ruleCount, blocksResidential: kinds.residential, blocksMajor: kinds.major, blocksBoth: kinds.both,
      rulesByDayAndHours: byRule, oddSideKnown: out.filter((b) => b.o).length, withNeighborhood: out.filter((b) => b.h).length, blocksByNeighborhood: hoodCount },
    skipped: {
      notSigned: `${residential.length - signedRes.length} residential rows (Non-Signed Route and Median Island) and ${major.length - signedMajor.length} major road rows are swept without no parking signs: no tickets, left out.`,
      residentialUnreadable: skipped.residential,
      majorWithoutASweepingWindow: { rows: skipped.major.length, examples: skipped.major.slice(0, 15) },
      majorSignsThatAreNotSweeping: otherSigns,
    },
    ticketCheck: 'San Jose publishes parking citations only as a dashboard (app.powerbigov.us, linked from the Parking Compliance page), not as data with time and place, so no cross-check.',
    towPilot: 'May and June 2026: two neighborhoods (Council Districts 7 and 10) had sweeping enforced by towing on four dates (sanjoseca.gov news, 2026-04-07). Over; no tow flag.',
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1));
  log(`${out.length} blocks (${kinds.residential} residential, ${kinds.major} major, ${kinds.both} both), ${sideCount} sides, ${ruleCount} rules`);
  log(`skipped: ${skipped.residential.length} residential unreadable, ${skipped.major.length} major rows without a sweeping window; ${noStreet} blocks without a Streets centerline`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/san-jose/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
