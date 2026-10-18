#!/usr/bin/env node
// Pittsburgh for CURB (built 2026-10-18, by docs/multi-city/city-build.md). Writes data/pittsburgh/ from the City of
// Pittsburgh's Street Centerline (Public Works, the "PavementPublic" layer, mirrored on WPRDC under CC0), whose
// sweep_left and sweep_right fields carry each side's street sweeping route and day. WPRDC's data dictionary describes
// them: "the Street Sweeping Route identifier to the right and left of a segment, when facing the direction the line
// segment has been drawn", in three parts, e.g. "5SW8-2W": Public Works Division 5, route 8, the 2nd Wednesday of each
// month. So a code's side is the line's own left or right, and its last part is the day (decode() below).
//
// The rule: posted monthly, one day per side (the nth weekday of the month), April 1 to November 30. The City gives no
// hours per block: residential sweeping "begins after 8 AM and ends approximately at 2:30 PM" (the City's page), so every
// rule is 8 AM to 2:30 PM, said in the report and on the page (posted signs may read 8:30 AM to 2 PM: the sign wins).
// $30 ticket (Parking Authority, Code 541.01(c)(4)), mailed from camera cars since 2025. A holiday cancels that day's
// cleaning; it is not made up before the street's next signed day.
//
// Also reads the City's Neighborhoods layer for the official spelling of each neighborhood's name (names only).
//
// Run: node scripts/cities/pittsburgh.mjs [--refresh]   (Node 18+; inputs cached in private/cache/pittsburgh/)
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/pittsburgh/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/pittsburgh/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[pittsburgh]', ...a);

export const CENTERLINE = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PavementPublic/FeatureServer/0';
export const HOODS = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebNeighborhoods/FeatureServer/0';
export const DICTIONARY = 'https://data.wprdc.org/dataset/pittsburgh-street-centerlines';
export const SCHEDULE_URL = 'https://www.pittsburghpa.gov/Resident-Services/Road-Maintenance/Street-Maintenance/Street-Sweeping';
export const FINE_URL = 'https://www.pittsburghparking.com/files/sharedassets/public/v/1/enforcement-and-policies/documents/vehicle-infractions-2025.pdf';
export const HOLIDAYS_URL = 'https://www.pittsburghpa.gov/files/assets/city/v/2/clerk/documents/2026-annual-council-calendar.pdf';
export const FIELDS = ['carteid', 'streetname', 'fromstreet', 'tostreet', 'lleft', 'hleft', 'lrgt', 'hrgt', 'hood_left', 'hood_right',
  'sweep_left', 'sweep_right', 'retired', 'class'];

// ---------- the rule ------------------------------------------------------------------------------

export const FROM = 8, TO = '14:30';   // "begins after 8 AM and ends approximately at 2:30 PM" (the City); no hours per block
export const MONTHS = 0b011111111000;  // April to November (bit m-1) = 2040, the City's April 1 to November 30
export const FLAGS = 0;                // stops on City holidays; no tow
export const DAY_LETTER = { M: 1, T: 2, W: 3, R: 4, F: 5 };
// "<division>SW<route>[A|B]-<week><day letters>": 2SW10A-4M = Division 2, route 10A, the 4th Monday.
export const CODE = /^(\d)SW(\d+)([AB]?)-([1-5])([MTWRF]+)$/;

/** A side's code → { division, route, week, days } (days as JavaScript weekdays), or null when it doesn't parse. */
export function decode(code) {
  const m = CODE.exec(String(code || '').trim().toUpperCase());
  if (!m) return null;
  const days = [...new Set([...m[5]].map((c) => DAY_LETTER[c]))];
  return { division: +m[1], route: m[2] + m[3], week: +m[4], days };
}
/** The rules of one side's code: one per weekday, on its week of the month, April to November, 8 AM to 2:30 PM. */
export const rulesOf = (d) => d.days.map((dow) => [dow, FROM, TO, 1 << (d.week - 1), MONTHS, FLAGS]);

// City of Pittsburgh holidays: the City Clerk's 2026 calendar marks these HOLIDAY (offices closed; Presidents' Day is
// not one). 2027 is not published: the same holidays by the same rule (a Saturday holiday observed the Friday before, a
// Sunday one the Monday after, as Independence Day 2026), to replace with the City's list once posted. In season
// (April to November), on a sweeping weekday (Monday to Thursday): Memorial Day, Labor Day, Veterans Day, Thanksgiving,
// and in 2027 Independence Day (observed Monday July 5).
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-04-03': 'Good Friday', '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth', '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day', '2026-11-11': 'Veterans Day',
  '2026-11-26': 'Thanksgiving Day', '2026-11-27': 'Day after Thanksgiving', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-03-26': 'Good Friday', '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth (observed)', '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day', '2027-11-11': 'Veterans Day',
  '2027-11-25': 'Thanksgiving Day', '2027-11-26': 'Day after Thanksgiving', '2027-12-24': 'Christmas Day (observed)',
};

// ---------- names ---------------------------------------------------------------------------------

const KEEP_UPPER = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'HOV', 'I', 'PA', 'US']);
const WORDS = { BRG: 'Bridge' };
/** "N ST CLAIR ST" → "N St Clair St", "MCKEE PL" → "McKee Pl", "UNNAMED97AB WAY" → "Unnamed Way", "BIRMINGHAM BRG" → "Birmingham Bridge". */
export function titleCase(s) {
  const t = String(s || '').toUpperCase().replace(/\s+/g, ' ').trim().replace(/^UNNAMED\w* WAY$/, 'UNNAMED WAY');
  return t.split(' ').filter(Boolean).map((w, i) => {
    if (WORDS[w]) return WORDS[w];
    if (i > 0 && (w === 'OF' || w === 'THE' || w === 'AND')) return w.toLowerCase();   // Blvd of the Allies
    if (KEEP_UPPER.has(w) || /^I-\d+$/.test(w)) return w;
    if (/^\d/.test(w)) return w.toLowerCase();                       // 43rd, 1/2
    if (/^MC[A-Z]{2,}/.test(w)) return 'Mc' + w[2] + w.slice(3).toLowerCase();
    if (/^O'[A-Z]/.test(w)) return "O'" + w[2] + w.slice(3).toLowerCase();
    return w.split('-').map((p) => p[0] + p.slice(1).toLowerCase()).join('-');
  }).join(' ');
}
/**
 * "fromstreet - tostreet" (the first point's cross street, then the last's, as the City's data dictionary says). The
 * dictionary lets an end that is not at a cross street carry the street's own name: that end is left out.
 */
export function limits(p) {
  const own = titleCase(p.streetname), end = (s) => { const t = titleCase(s); return t === own ? '' : t; };
  const a = end(p.fromstreet), b = end(p.tostreet);
  return a && b ? (a === b ? a : `${a} - ${b}`) : a || b;
}
const hoodKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');   // "SOUTHSIDE FLATS" = "South Side Flats"
/** The block's neighborhood, in the City's own spelling (its Neighborhoods layer); "South Side Flats" for SOUTHSIDE FLATS. */
export function hoodOf(p, official = new Map()) {
  const pick = [p.hood_left, p.hood_right].map((h) => String(h || '').trim()).find((h) => h && !/OUTSIDE OF CITY/i.test(h));
  if (!pick) return '';
  return official.get(hoodKey(pick)) || titleCase(pick);
}
export const officialHoods = (names) => new Map(names.map((n) => [hoodKey(n), n]));

// ---------- geometry -------------------------------------------------------------------------------

const LAT0 = 40.44, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
export const xy = ([lon, lat]) => [lon * KX, lat * KY];
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
export const round6 = (c) => c.map(([lo, la]) => [Math.round(lo * 1e6) / 1e6, Math.round(la * 1e6) / 1e6]);
const gap = (a, b) => { const p = xy(a), q = xy(b); return Math.hypot(p[0] - q[0], p[1] - q[1]); };
/** A segment's line: a LineString as is; a MultiLineString whose parts meet end to start (within 2 m) as one line. */
export function lineOf(g) {
  if (!g) return null;
  if (g.type === 'LineString') return g.coordinates;
  if (g.type !== 'MultiLineString') return null;
  const parts = g.coordinates.filter((p) => p.length >= 2);
  const line = [...parts[0]];
  for (const p of parts.slice(1)) {
    if (gap(line[line.length - 1], p[0]) > 2) return null;
    line.push(...p.slice(1));
  }
  return line;
}
const parity = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n % 2 : null; };
export function oddSide(p) {
  const l = parity(p.lleft) ?? parity(p.hleft), r = parity(p.lrgt) ?? parity(p.hrgt);
  if (l === 1 && r !== 1) return 'L';
  if (r === 1 && l !== 1) return 'R';
  return null;
}
export function houseRange(p) {
  const n = ['lleft', 'hleft', 'lrgt', 'hrgt'].map((k) => parseInt(p[k], 10)).filter((v) => v > 0);
  return n.length ? [Math.min(...n), Math.max(...n)] : null;
}

// ---------- one block ------------------------------------------------------------------------------

/** One centerline segment → a block of segments.json, or { skip }. Each side keeps its own code's day. */
export function blockOf(f, official) {
  const p = f.properties;
  if (p.retired) return { skip: 'retired segment (replaced in the centerline)' };
  const c = lineOf(f.geometry);
  if (!c || c.length < 2) return { skip: 'no usable line geometry' };
  const codes = { L: String(p.sweep_left || '').trim(), R: String(p.sweep_right || '').trim() };
  const d = [], bad = [];
  for (const side of ['L', 'R']) {
    if (!codes[side]) continue;
    const dec = decode(codes[side]);
    if (!dec) { bad.push(codes[side]); continue; }
    d.push([side, compass(c, side), rulesOf(dec)]);
  }
  if (!d.length) return { skip: bad.length ? `sweep code not readable (${bad.join(', ')})` : 'no sweep code' };
  const n = houseRange(p), o = oddSide(p), h = hoodOf(p, official);
  return { block: { c: String(p.carteid), s: titleCase(p.streetname), l: limits(p), ...(h ? { h } : {}), ...(n ? { n } : {}),
    ...(o ? { o } : {}), g: round6(c), d }, bad, codes };
}

// Oakland's street cleaning list by odd and even side, published by the Oakland Planning and Development Corporation
// (opdc.org/street-cleaning-2025, "Street Cleaning 2026", read 2026-10-18): not the City's, but the only street by
// street list found. The check below says how often a code's side holds the side OPDC names. Rows: street, a block (the
// hundred) or C|S for its Central or South Oakland part or '' for all of it, then the odd and the even side's day.
export const OPDC = [
  ['ATWOOD ST', '300', '3M', '3T'], ['ATWOOD ST', '400', '3R', '3T'], ['BATES ST', '3400', '', '3R'], ['BATES ST', '3800', '3R', ''],
  ['COLTART AVE', '', '3R', '3W'], ['DAWSON ST', 'C', '3W', '3R'], ['HALKET ST', '', '3W', ''], ['MCKEE PL', '', '3T', '3M'],
  ['MEYRAN AVE', '', '3R', '3W'], ['OAKLAND AVE', '', '3W', '3R'], ['OAKLAND SQ', '', '3W', '3W'], ['PARKVIEW AVE', 'C', '3W', '3R'],
  ['SEMPLE ST', '', '3W', '3R'], ['S BOUQUET ST', '', '3W', '3R'], ['WARD ST', 'C', '3R', '3W'], ['DAWSON ST', 'S', '3R', '3W'],
  ['FRAZIER ST', '', '3W', '3R'], ['JULIET ST', '', '3W', '3R'], ['PARKVIEW AVE', 'S', '3R', '3W'], ['WARD ST', 'S', '3W', '3R'],
  ['JOE HAMMER SQ', '', '3W', ''], ['CRAFT AVE', '', '3R', '3W'], ['LAWN ST', '', '3W', '3W'], ['NIAGARA ST', '', '3W', ''],
  ['NIAGARA ST', '3300', '3R', ''], ['OPHELIA ST', '', '', '3W'], ['BIGELOW BLVD', '', '3M', '2T'], ['DEVONSHIRE ST', '', '1M', '1T'],
  ['ELLSWORTH AVE', '', '1M', '1T'], ['N BELLEFIELD AVE', '', '3T', '2M'], ['N DITHRIDGE ST', '', '3T', '2M'], ['N NEVILLE ST', '', '1M', '1T'],
  ['RUSKIN AVE', '', '3T', '2M'], ['WALLINGFORD ST', '', '1T', '1M'],
];
/** Each OPDC row against the codes on Oakland's segments: does the code on the odd (even) side read as OPDC's day? */
export function opdcCheck(features) {
  const short = (code) => { const m = CODE.exec(String(code || '').trim()); return m ? m[4] + m[5] : null; };
  const out = { sides: 0, agree: 0, otherSide: 0, differ: 0, rows: [] };
  for (const [street, part, oddDay, evenDay] of OPDC) {
    const r = { street, part, agree: 0, otherSide: 0, differ: 0 };
    for (const f of features) {
      const p = f.properties, hood = `${p.hood_left || ''}|${p.hood_right || ''}`;
      if (String(p.streetname || '').trim() !== street || !/OAKLAND|OAKCLIFFE/.test(hood)) continue;
      if (part === 'C' && !/CENTRAL/.test(hood)) continue;
      if (part === 'S' && !/SOUTH/.test(hood)) continue;
      if (/^\d+$/.test(part) && !(+p.lleft >= +part && +p.lleft < +part + 100)) continue;
      const o = oddSide(p); if (!o) continue;
      const odd = short(o === 'L' ? p.sweep_left : p.sweep_right), even = short(o === 'L' ? p.sweep_right : p.sweep_left);
      for (const [want, got, other] of [[oddDay, odd, even], [evenDay, even, odd]]) {
        if (!want || !got) continue;
        const k = want === got ? 'agree' : want === other ? 'otherSide' : 'differ';
        r[k]++; out[k]++; out.sides++;
      }
    }
    out.rows.push(r);
  }
  return out;
}

// ---------- fetching -------------------------------------------------------------------------------

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-pittsburgh-build (+https://curb.guide)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const j = await r.json();
      if (j && j.error) throw new Error(`${url}: ${JSON.stringify(j.error)}`);
      return j;
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
async function pages(layer, params, size = 2000) {
  const out = [];
  for (let off = 0; ; off += size) {
    const q = new URLSearchParams({ where: '1=1', f: 'json', resultOffset: off, resultRecordCount: size, ...params });
    const page = await getJSON(`${layer}/query?${q}`);
    out.push(...(page.features || []));
    if (!(page.exceededTransferLimit || (page.properties && page.properties.exceededTransferLimit)) && (page.features || []).length < size) return out;
  }
}

// ---------- the build ------------------------------------------------------------------------------

async function main() {
  const meta = await cached('centerline-meta.json', () => getJSON(`${CENTERLINE}?f=json`));
  const have = new Set((meta.fields || []).map((x) => x.name));
  const missing = FIELDS.filter((k) => !have.has(k));
  if (missing.length) throw new Error(`the centerline layer changed shape: no ${missing.join(', ')}`);
  const total = await cached('centerline-count.json', () => getJSON(`${CENTERLINE}/query?where=1%3D1&returnCountOnly=true&f=json`));
  const segs = await cached('swept-segments.json', async () => {
    log('fetching swept centerline segments…');
    return pages(CENTERLINE, { where: "(sweep_left IS NOT NULL AND sweep_left <> '') OR (sweep_right IS NOT NULL AND sweep_right <> '')",
      outFields: FIELDS.join(','), outSR: '4326', f: 'geojson', orderByFields: 'OBJECTID_1' });
  });
  const hoodRows = await cached('neighborhoods.json', async () => {
    log('fetching neighborhood names…');
    return (await pages(HOODS, { outFields: 'hood', returnGeometry: 'false' })).map((r) => r.attributes.hood);
  });
  if (segs.length < 3000 || segs.length > 6000) throw new Error(`expected about 3,800 swept segments, got ${segs.length}`);
  if (hoodRows.length < 80) throw new Error(`expected 90 neighborhoods, got ${hoodRows.length}`);
  const official = officialHoods(hoodRows.filter(Boolean));
  log(`${segs.length} of ${total.count} centerline segments carry a sweep code; ${official.size} neighborhoods`);

  const out = [], skipped = new Map(), codeCount = new Map(), unread = new Map();
  let sameBoth = 0, oneSide = 0, multiDay = 0;
  for (const f of segs) {
    const r = blockOf(f, official), p = f.properties;
    if (r.skip) {
      if (!skipped.has(r.skip)) skipped.set(r.skip, []);
      skipped.get(r.skip).push({ id: String(p.carteid), street: titleCase(p.streetname), from: titleCase(p.fromstreet), to: titleCase(p.tostreet),
        left: p.sweep_left || '', right: p.sweep_right || '' });
      continue;
    }
    for (const code of r.bad) unread.set(code, (unread.get(code) || 0) + 1);
    for (const code of [r.codes.L, r.codes.R].filter(Boolean)) codeCount.set(code, (codeCount.get(code) || 0) + 1);
    if (r.codes.L && r.codes.L === r.codes.R) sameBoth++;
    if (!r.codes.L || !r.codes.R) oneSide++;
    if (r.block.d.some(([, , rules]) => rules.length > 1)) multiDay++;
    out.push(r.block);
  }
  out.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));
  const sides = out.reduce((n, b) => n + b.d.length, 0), rules = out.reduce((n, b) => n + b.d.reduce((m, x) => m + x[2].length, 0), 0);

  // Checks of the side: addresses rise along the drawn line, the odd side's compass, and OPDC's Oakland list.
  const parityCheck = { withNumbers: 0, rising: 0, oddOnLeft: 0, oddOnRight: 0 };
  for (const f of segs) {
    const p = f.properties, lo = [+p.lleft, +p.lrgt].filter((v) => v > 0), hi = [+p.hleft, +p.hrgt].filter((v) => v > 0), o = oddSide(p);
    if (!lo.length || !hi.length || !o) continue;
    parityCheck.withNumbers++;
    if (Math.max(...hi) > Math.min(...lo)) parityCheck.rising++;
    parityCheck[o === 'L' ? 'oddOnLeft' : 'oddOnRight']++;
  }
  const opdc = opdcCheck(segs);

  // Map view and neighborhoods (the official names, framed by each one's swept blocks).
  let w = 180, s = 90, e = -180, nn = -90;
  for (const b of out) for (const [lo, la] of b.g) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); nn = Math.max(nn, la); }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const bounds = [[r4(s - 0.01), r4(w - 0.01)], [r4(nn + 0.01), r4(e + 0.01)]];
  const boxes = new Map();
  for (const b of out) {
    if (!b.h) continue;
    if (!boxes.has(b.h)) boxes.set(b.h, [180, 90, -180, -90]);
    const q = boxes.get(b.h);
    for (const [lo, la] of b.g) { q[0] = Math.min(q[0], lo); q[1] = Math.min(q[1], la); q[2] = Math.max(q[2], lo); q[3] = Math.max(q[3], la); }
  }
  const neighborhoods = [...boxes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, q]) => ({ name, bbox: q.map((v) => v.toFixed(4)).join(',') }));

  const fetched = new Date().toISOString().slice(0, 10);
  const editDate = meta.editingInfo && meta.editingInfo.dataLastEditDate ? new Date(meta.editingInfo.dataLastEditDate).toISOString().slice(0, 10) : 'unknown';
  const sources = [
    { name: 'Pittsburgh Street Centerline (Public Works; sweep_left and sweep_right)', url: DICTIONARY, api: CENTERLINE,
      license: 'Creative Commons CCZero (WPRDC)', fetched, updated: editDate },
    { name: 'Neighborhoods (City of Pittsburgh), names only', url: HOODS,
      license: 'City of Pittsburgh GIS data, provided as is (no license named)', fetched },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'pittsburgh', time_zone: 'America/New_York', generated: new Date().toISOString(), sources, blocks: out.length, sides,
      format: 'b[] = {c: City Cartegraph segment id (carteid), s: street, l: cross streets (from - to, first point to last), h: neighborhood, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]] first point to last, d: [[side L|R, compass label, rules]]}; '
        + 'rule = [jsDow, fromH, toH ("H:MM" with minutes), weeksMask (bit i = week i+1), monthsMask (bit m-1; 2040 = April to November), flags (0 = stops on City holidays, not towable)]' },
    b: out }));

  const city = {
    id: 'pittsburgh', name: 'Pittsburgh', region: 'Pennsylvania', tz: 'America/New_York',
    center: [40.462, -79.948], zoom: 14, bounds,
    holidays: HOLIDAYS, holidaysSource: HOLIDAYS_URL, holidayRule: 'all',
    fine: '$30', tow: 'no', fineSource: FINE_URL,
    agency: 'Pittsburgh Department of Public Works', scheduleUrl: SCHEDULE_URL, sources,
    words: {
      rule: 'Posted street cleaning once a month on each side, April 1 to November 30: no parking on the side\'s signed day (for example the 2nd Monday), from 8 AM to about 2:30 PM.',
      afterpass: 'A $30 ticket, mailed after a Parking Authority camera car records the plate. A City holiday cancels that day\'s cleaning until the next signed day.',
      dataNotes: 'Days come from the sweep codes on the City\'s street centerlines (Public Works): 2SW10A-4M means the 4th Monday of the month. The City publishes no hours per block; it says neighborhood sweeping runs from after 8 AM to about 2:30 PM, so that is the window shown. The sign on the block wins.',
    },
    neighborhoods,
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1));

  const decodeTable = [...codeCount.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([code, sidesN]) => {
    const d = decode(code);
    return { code, sides: sidesN, division: d.division, route: d.route, week: d.week, days: d.days.map((x) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x]).join(' and ') };
  });
  const report = {
    generated: new Date().toISOString(),
    inputs: { centerlineSegments: total.count, withSweepCode: segs.length, layerUpdated: editDate },
    output: { blocks: out.length, sides, rules, blocksWithSameCodeBothSides: sameBoth, blocksSweptOnOneSideOnly: oneSide,
      blocksWithTwoDaysOnASide: multiDay, sizeBytes: fs.statSync(OUT + 'segments.json').size },
    decoding: {
      source: `WPRDC data dictionary (${DICTIONARY}): "the Street Sweeping Route identifier to the right and left of a segment, when facing the direction the line segment has been drawn"; e.g. 5SW8-2W = 5th Division, route 8, the 2nd Wednesday of each month.`,
      pattern: '<division>SW<route>[A|B]-<week><day letters>, day letters M Mon, T Tue, W Wed, R Thu, F Fri. A and B pair two routes on the same blocks (A one side, B the other, consecutive days of the same week).',
      uncertain: '3SW1-3MW (Oakland: Fifth Ave, Forbes Ave, Bigelow Blvd and side streets near them) is read literally as the 3rd Monday and the 3rd Wednesday on that side; the dictionary has no two letter example.',
      codes: decodeTable,
      unreadable: Object.fromEntries(unread),
    },
    hours: { from: '8:00', to: '14:30', source: SCHEDULE_URL, quote: 'Neighborhood and residential street sweeping begins after 8 AM and ends approximately at 2:30 PM.',
      unverified: 'Hours are not in the data and the City publishes no sign text; older signs are reported to read 8:30 AM to 2 PM. 8 AM to 2:30 PM covers both.' },
    season: { months: 'April to November (mask 2040)', cityDates: 'April 1 to November 30',
      holidaysInSeason: Object.entries(HOLIDAYS).filter(([d]) => { const m = +d.slice(5, 7), w = new Date(d + 'T12:00:00Z').getUTCDay(); return m >= 4 && m <= 11 && w >= 1 && w <= 4; }).map(([d, n]) => `${d} ${n}`) },
    skipped: [...skipped.entries()].map(([why, list]) => ({ why, count: list.length, examples: list.slice(0, 5) })),
    checks: {
      sideByAddress: { ...parityCheck, note: 'Addresses rise from the first point to the last, and the odd numbers sit on the left in most of the City: the City\'s left and right are the drawn line\'s, as the dictionary says. Grant St downtown: 437 (Frick Building) is on its northwest side, 436 (County Courthouse) on its southeast, as the data puts them.' },
      opdcOakland: { source: 'https://www.opdc.org/street-cleaning-2025', ...opdc },
      tickets: 'No cross check: the City publishes no parking citations with time and place.',
    },
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1));
  log(`${out.length} blocks, ${sides} sides, ${rules} rules (${sameBoth} with one code on both sides, ${oneSide} swept on one side only)`);
  log(`OPDC Oakland list: ${opdc.agree} of ${opdc.sides} side days agree, ${opdc.otherSide} are the other side's, ${opdc.differ} differ`);
  log(`skipped: ${report.skipped.map((x) => `${x.count} ${x.why}`).join('; ') || 'none'}; unreadable codes: ${unread.size}`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/pittsburgh/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
