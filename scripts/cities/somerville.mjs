#!/usr/bin/env node
// Somerville, MA for CURB (started 2026-10-18; the spec is docs/multi-city/city-build.md, the research page
// docs/multi-city/somerville.md). Builds data/somerville/ from:
//
//   1. The City's street sweeping section pages (somervillema.gov/content/street-sweeping-section…): one page per
//      street side or stretch, with the street, the side (odd, even or "either"), the day ("1st and 3rd Wednesday",
//      "Monday Night"), the hours and sometimes the stretch ("from Broadway to Morrison"). The City's own index of
//      them (somervillema.gov/sweeper in 2014, /street-sweeping-data in 2015, both in the Wayback Machine) is gone, so
//      the pages are read by their node ids, one batch of 1,042 (FIRST_NODE to LAST_NODE). At most one request every
//      1.2 s; every page is cached in private/cache/somerville/pages/ and never fetched again (--refresh-pages does).
//   2. MassGIS Roads (the state's NG911 road centerlines, MassGIS): block lines with address ranges.
//   3. MassGIS Master Address Points: which side of each block holds the odd house numbers.
//
// The City's rule: odd side on the 1st and 3rd <weekday> of the month, even side on the 2nd and 4th, 8 AM to noon,
// April to December; main streets and squares are also swept at night (12 to 6 AM, Saturdays to 7:30 AM) every
// week. $50 ticket and tow; no sweeping on City holidays.
//
// Run: node scripts/cities/somerville.mjs [--refresh] [--refresh-pages]   (Node 18+; downloads in private/cache/somerville/)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------- the section pages -------------------------------------------------------------------------------------

export const FIRST_NODE = 26349, LAST_NODE = 27390;

// A section page → { node, street, suffix, stretch, side, day, hours }, or null for any other page.
export function parseSection(html, node) {
  const m = /<article[^>]*class="node street-sweeping-section[^"]*"[^>]*>([\s\S]*?)<\/article>/.exec(html);
  if (!m) return null;
  const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const f = {};
  for (const part of m[1].split(/(?=<div\s+data-component-id="radix:field" class="field field--name-)/)) {
    const n = /^<div\s+data-component-id="radix:field" class="field field--name-([a-z-]+)/.exec(part);
    if (!n) continue;
    const item = /<div\s+class="field__item"[^>]*>([\s\S]*?)<\/div>/.exec(part);
    f[n[1]] = text(item ? item[1] : part);
  }
  const need = ['field-street-name', 'field-sweeping-side', 'field-sweeping-day', 'field-sweeping-hours'];
  for (const k of need) if (!f[k]) throw new Error(`section ${node}: no ${k} (the page layout changed)`);
  return { node, street: f['field-street-name'], suffix: f['field-street-suffix'] && f['field-street-suffix'] !== 'None' ? f['field-street-suffix'] : '',
    stretch: f.body || '', side: f['field-sweeping-side'].toLowerCase(), day: f['field-sweeping-day'], hours: f['field-sweeping-hours'] };
}

const DOWS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// "8 a.m. - 12 p.m." → [8, 12]; "12 a.m. - 7:30 a.m." → [0, "7:30"]
export function parseHours(s) {
  const m = /^\s*(\d{1,2})(?::(\d\d))?\s*([ap])\.?m\.?\s*-\s*(\d{1,2})(?::(\d\d))?\s*([ap])\.?m\.?\s*$/i.exec(String(s || ''));
  if (!m) return null;
  const h = (hh, mm, ap) => { const v = (+hh % 12) + (/p/i.test(ap) ? 12 : 0); return mm && +mm ? `${v}:${mm}` : v; };
  return [h(m[1], m[2], m[3]), h(m[4], m[5], m[6])];
}
// A section's day and hours → the rule and which side it belongs to. "1st and 3rd Friday" is the odd side, "2nd and
// 4th Friday" the even side (the City's rule, whatever the page's side says). "Monday Night" with 12 to 6 AM is every
// Monday from midnight to 6 AM (the City's reminder tool lists it on Mondays as "Monday 12AM-6AM"); a bare weekday
// with night hours is the same (one page says "Wednesday").
export function parseSchedule(day, hours, side) {
  const hrs = parseHours(hours);
  if (!hrs) return null;
  const d = String(day || '').trim().toLowerCase();
  let m = /^(1st and 3rd|2nd and 4th)\s+(\w+)$/.exec(d);
  if (m && DOWS.includes(m[2])) {
    const odd = m[1] === '1st and 3rd';
    return { kind: 'day', side: odd ? 'odd' : 'even', sideOnPage: side, rule: [DOWS.indexOf(m[2]), hrs[0], hrs[1], odd ? 5 : 10, MONTHS, TOW] };
  }
  m = /^(\w+)(\s+night)?$/.exec(d);
  if (m && DOWS.includes(m[1]) && (m[2] || hrs[0] === 0)) {
    return { kind: 'night', side: side === 'either' ? 'both' : side, sideOnPage: side, rule: [DOWS.indexOf(m[1]), hrs[0], hrs[1], 31, MONTHS, TOW] };
  }
  return null;
}
export const MONTHS = 0b111111111000, TOW = 2;                              // April to December; towable

// ---------- names -------------------------------------------------------------------------------------------------

const TYPE = { STREET: 'ST', ST: 'ST', STS: 'ST', AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE', ROAD: 'RD', RD: 'RD', PLACE: 'PL', PL: 'PL',
  TERRACE: 'TER', TER: 'TER', COURT: 'CT', CT: 'CT', DRIVE: 'DR', DR: 'DR', LANE: 'LN', LN: 'LN', PARK: 'PARK', SQUARE: 'SQ', SQ: 'SQ',
  CIRCLE: 'CIR', CIR: 'CIR', HIGHWAY: 'HWY', HWY: 'HWY', BOULEVARD: 'BLVD', BLVD: 'BLVD', PARKWAY: 'PKWY', PKWY: 'PKWY', WAY: 'WAY',
  ROW: 'ROW', EXTENSION: 'EXT' };
// The pages' spellings → MassGIS's.
const ALIAS = { 'PROPERZZI WAY': 'REV NAZARENO PROPERZI WAY', 'SEWELL ST': 'SEWALL ST', 'GRANDVIEW AVE': 'GRAND VIEW AVE',
  'ST JAMES AVE': 'SAINT JAMES AVE', 'LOMBARDI ST': 'A ALFRED LOMBARDI ST', 'INNERBELT RD': 'INNER BELT RD', 'SOMMERVILLE AVE': 'SOMERVILLE AVE',
  'WAHINGTON ST': 'WASHINGTON ST', 'ASSEMBLY SQ': 'ASSEMBLY SQUARE DR', 'MCGRATH': 'MCGRATH HWY', 'TUFTS': 'TUFTS ST',
  'POWDER HOUSE CIR': 'POWDERHOUSE SQ' };
// One spelling per street: "Mt. Vernon St" and "MOUNT VERNON STREET" → "MOUNT VERNON ST".
export function streetKey(s) {
  const w = String(s || '').toUpperCase().replace(/[.,']/g, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (w.length > 1 && w[0] === 'MT') w[0] = 'MOUNT';
  if (w.length > 1 && TYPE[w[w.length - 1]]) w[w.length - 1] = TYPE[w[w.length - 1]];
  const k = w.join(' ');
  return ALIAS[k] || k;
}
export const baseName = (key) => key.replace(/ (ST|AVE|RD|PL|TER|CT|DR|LN|PARK|SQ|CIR|HWY|BLVD|PKWY|WAY|ROW|EXT)$/, '');

// A page's stretch text → what it covers: { whole } | { from, to } | { end } (from a cross street to the dead end)
// | { square } | { skip: reason }, plus { banned } when it says parking is not allowed on that page's side anyway.
export function parseStretch(s, side) {
  const t = String(s || '').trim();
  if (!t || /^\((paved street|excluding meters)\)$/i.test(t) || /^(somerville side of street|mall area|under 93|to city line)$/i.test(t)) return { whole: true };
  if (/^at \w+ city line$/i.test(t)) return { atCityLine: true };
  if (/^no parking (anytime|either side)$/i.test(t)) return { skip: 'no parking anytime on this side' };
  const banned = /^odd side no parking anytime$/i.test(t) ? 'odd' : /^parking allowed on the odd side only$/i.test(t) || /no parking anytime on the even side/i.test(t) ? 'even' : null;
  if (banned) return banned === side ? { skip: 'no parking anytime on this side' } : { whole: true };
  if (/\bsq\b\.?|square/i.test(t) && !/\bto\b/i.test(t)) return { square: t.split(/,\s*/).map((x) => x.replace(/\.$/, '').trim()) };
  let m = /^(?:short end-\s*)?(?:from\s+)?(.+?)\s+to\s+(.+?)\.?$/i.exec(t);
  if (m) {
    const clean = (x) => x.replace(/\s+Sts?\.?$/i, (y) => (/s\.?$/i.test(y) && !/st\.?$/i.test(y) ? ' St' : y)).replace(/\.$/, '').trim();
    return { from: clean(m[1]), to: clean(m[2]) };
  }
  m = /^(.+?)\s+end$/i.exec(t);
  if (m) return { end: m[1].replace(/\.$/, '').trim() };
  return { skip: `stretch not understood: "${t}"` };
}
// Cross street words that name the street's own end, not a street.
const CITY_LINE = /city line/i;
const RAIL = /^r\.?r\.? bridge$/i;

// ---------- geometry ----------------------------------------------------------------------------------------------

const LAT0 = 42.39, LON0 = -71.10, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const lineLen = (c) => { let s = 0; for (let i = 1; i < c.length; i++) { const a = xy(c[i - 1]), b = xy(c[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
// The compass word for side L or R of a line looking from its first point to its last (as in scripts/cities/boston.mjs).
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
// Which side of a line (first → last point) a point is on, its distance from it and how far along it lies (0..1).
export function sideOfPoint(c, pt) {
  const [px, py] = xy(pt);
  let best = null, run = 0;
  const total = lineLen(c) || 1;
  for (let i = 1; i < c.length; i++) {
    const [x1, y1] = xy(c[i - 1]), [x2, y2] = xy(c[i]), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy, len = Math.sqrt(l2);
    const t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0, tc = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - x1 - tc * dx, py - y1 - tc * dy);
    if (!best || d < best.d) best = { d, side: dx * (py - y1) - dy * (px - x1) > 0 ? 'L' : 'R', along: (run + t * len) / total };
    run += len;
  }
  return best;
}
const flip = (s) => (s === 'L' ? 'R' : 'L');

// Where the City's reminder tool (ReCollect) disagreed with the pages at the addresses spot-checked by hand on 2026-10-18
// (17 address lookups in Somerville, 13 answered: a spot check, never more). The map takes the tool's word on three points:
// - Broadway's night sweeps end at 8 AM: "Odd Side Monday 12AM-8AM" / "Even Side Wednesday 12AM-8AM" at both Broadway
//   addresses checked; the pages say 12 to 6 a.m. (the longer window is also the safe mistake).
// - College Ave's even side: its page says "Wednesday", 12 to 6 a.m., with no weeks and no "Night" (node 26495); the
//   tool has that side on the 2nd and 4th Wednesday, 8 AM to noon.
// - "Either side" Friday and Saturday night sweeps on streets that also have odd and even sweeps (Broadway, Highland
//   Ave, Holland St, Medford St, Central St, Somerville Ave, Walnut St, Cedar St, College Ave, Elm St) are left out:
//   the tool shows only the odd and even sweeps at all ten addresses checked on those streets. Squares and streets
//   swept only that way keep theirs (not checked: the tool has no addresses there). See the section loop.
export const NIGHT_ENDS = { BROADWAY: 8 };
export const PAGE_FIXES = { 26495: { day: '2nd and 4th Wednesday', hours: '8 a.m. - 12 p.m.' } };
// The squares the pages name without a stretch: MassGIS's own square streets, or the blocks of the square's streets
// within SQUARE_M of where they meet (an assumption: the pages give no extent).
const SQUARE_M = 120;
const SQUARES = {
  'UNION SQ': { named: 'UNION SQ' }, 'DAVIS SQ': { named: 'DAVIS SQ', streets: ['HOLLAND ST', 'ELM ST', 'COLLEGE AVE', 'HIGHLAND AVE'] },
  'TEELE SQ': { meet: ['BROADWAY', 'HOLLAND ST'] }, 'BALL SQ': { meet: ['BROADWAY', 'BOSTON AVE'] }, 'MAGOUN SQ': { meet: ['BROADWAY', 'MEDFORD ST'] },
  'ASSEMBLY SQUARE DR': { named: 'ASSEMBLY SQUARE DR' },
};

// ---------- the build ---------------------------------------------------------------------------------------------

const ROADS = 'https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/MassGIS_Roads_Hosted_Feature_Layer/FeatureServer/0';
const POINTS = 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/MassGIS_Master_Address_Points/FeatureServer/0';
const PAGE = (n) => `https://www.somervillema.gov/node/${n}`;
const SWEEPING = 'https://www.somervillema.gov/departments/sweeping';
const NEWS_2026 = 'https://www.somervillema.gov/news/somerville-street-sweeping-yard-waste-and-hazardous-waste-services-restart-april';

// The City's holidays with no sweeping: its calendar's "Holiday: …" days (all City offices closed, read 2026-10-18), the
// same nine the City's reminder tool marks in the 2026 season. Thanksgiving Friday is a City holiday but not a
// sweeping holiday in the reminder tool, so it is left out (a sweep shown that day is the safe mistake). Holidays on a
// weekend are the date itself, as the City lists Independence Day 2026 (a Saturday). 2027 after New Year's Day is not
// posted yet: the same holidays by the same rules.
const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Presidents' Day", '2026-04-20': "Patriots' Day",
  '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-04': 'Independence Day', '2026-09-07': 'Labor Day',
  '2026-10-12': "Indigenous Peoples' Day", '2026-11-11': 'Veterans Day', '2026-11-26': 'Thanksgiving', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Presidents' Day", '2027-04-19': "Patriots' Day",
  '2027-05-31': 'Memorial Day', '2027-06-19': 'Juneteenth', '2027-07-04': 'Independence Day', '2027-09-06': 'Labor Day',
  '2027-10-11': "Indigenous Peoples' Day", '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving', '2027-12-25': 'Christmas Day',
};

async function main() {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const OUT = ROOT + 'data/somerville/', CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/somerville/';
  const REFRESH = process.argv.includes('--refresh'), REFRESH_PAGES = process.argv.includes('--refresh-pages');
  const log = (...a) => console.error('[somerville]', ...a);
  const UA = { 'User-Agent': 'curb-somerville-build (+https://curb.guide)' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(CACHE + 'pages/', { recursive: true });

  // 1. the section pages, one request every 1.2 s, each cached
  let last = 0;
  async function page(n) {
    const f = `${CACHE}pages/node-${n}.html`;
    if (!REFRESH_PAGES && fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
    const wait = last + 1200 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const r = await fetch(PAGE(n), { headers: UA });
    const t = r.ok ? await r.text() : `<!-- HTTP ${r.status} -->`;
    fs.writeFileSync(f, t);
    return t;
  }
  const sections = [];
  const pageFixes = [];
  for (let n = FIRST_NODE; n <= LAST_NODE; n++) {
    const s = parseSection(await page(n), n);
    if (s && PAGE_FIXES[n]) { pageFixes.push({ node: n, street: [s.street, s.suffix].filter(Boolean).join(' '), side: s.side, page: `${s.day}, ${s.hours}`, used: `${PAGE_FIXES[n].day}, ${PAGE_FIXES[n].hours}` }); Object.assign(s, PAGE_FIXES[n]); }
    if (s) sections.push(s);
  }
  for (const n of [FIRST_NODE - 1, LAST_NODE + 1]) if (parseSection(await page(n), n)) throw new Error(`node ${n} is a sweeping section too: the batch grew, move FIRST_NODE/LAST_NODE`);
  if (sections.length < 1000) throw new Error(`only ${sections.length} section pages: the City changed its site`);

  // 2. MassGIS roads and address points for Somerville
  async function arcgis(name, base, where, fields) {
    const f = CACHE + name;
    if (!REFRESH && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
    log(`fetching ${name}…`);
    const out = [];
    for (let off = 0; ; off += 2000) {
      const q = new URLSearchParams({ where, outFields: fields, outSR: '4326', f: 'json', resultOffset: off, resultRecordCount: 2000, orderByFields: 'OBJECTID' });
      const d = await (await fetch(`${base}/query?${q}`, { headers: UA })).json();
      if (d.error) throw new Error(`${name}: ${JSON.stringify(d.error)}`);
      out.push(...d.features);
      if (!d.exceededTransferLimit && d.features.length < 2000) break;
      await sleep(1000);
    }
    fs.writeFileSync(f, JSON.stringify(out));
    return out;
  }
  const roads = await arcgis('massgis-roads.json', ROADS, "MUNI_L='SOMERVILLE' OR MUNI_R='SOMERVILLE'", '*');
  const points = await arcgis('massgis-address-points.json', POINTS, "GEOGRAPHIC_TOWN='SOMERVILLE'",
    'OBJECTID,ADDRESS_NUMBER,ADDRESS_NUMBER_SUFFIX,STREET_NAME,STR_NAME_BASE,POST_TYPE,PRE_DIR,POST_DIR,POINT_TYPE,UNIT,MASTER_ADDRESS_ID');
  log(`${sections.length} section pages, ${roads.length} MassGIS road segments, ${points.length} address points`);

  // 3. the street graph (MassGIS roads have no node ids: a node is an end point, to 6 decimals)
  const nid = ([lo, la]) => lo.toFixed(6) + ',' + la.toFixed(6);
  const segs = [], byStreet = new Map(), nodeStreets = new Map(), nodeAt = new Map();
  for (const f of roads) {
    const p = f.attributes, c = f.geometry && f.geometry.paths && f.geometry.paths[0];
    if (!c || c.length < 2 || !p.ST_NAME_STD) continue;
    const s = { id: String(p.RCL_UNQ_ID || '').replace(/[{}]/g, ''), p, c, key: streetKey(p.ST_NAME_STD), name: '', a: nid(c[0]), b: nid(c[c.length - 1]), len: lineLen(c),
      inL: p.MUNI_L === 'SOMERVILLE', inR: p.MUNI_R === 'SOMERVILLE' };
    if (!s.id) continue;
    segs.push(s);
    if (!byStreet.has(s.key)) byStreet.set(s.key, []);
    byStreet.get(s.key).push(s);
    for (const [n, pt] of [[s.a, c[0]], [s.b, c[c.length - 1]]]) { if (!nodeStreets.has(n)) nodeStreets.set(n, new Set()); nodeStreets.get(n).add(s.key); nodeAt.set(n, pt); }
  }
  // "FRANKLIN STREET" → "Franklin St"
  const nice = (key) => key.toLowerCase().replace(/\b[a-z]/g, (x) => x.toUpperCase()).replace(/\bMc([a-z])/g, (m, x) => 'Mc' + x.toUpperCase());
  for (const s of segs) s.name = nice(s.key);
  const resolve = (key) => {
    if (byStreet.has(key)) return key;
    const hits = [...byStreet.keys()].filter((k) => baseName(k) === baseName(key));
    return hits.length === 1 ? hits[0] : null;
  };
  const apart = (n, m) => { const [x1, y1] = xy(nodeAt.get(n)), [x2, y2] = xy(nodeAt.get(m)); return Math.hypot(x2 - x1, y2 - y1); };
  const adjOf = new Map();
  const SNAP = 15;                // meters: ends of one street this close are one corner
  const adjacency = (key) => {
    if (adjOf.has(key)) return adjOf.get(key);
    const adj = new Map(), link = (n, m, s, len) => { if (!adj.has(n)) adj.set(n, []); adj.get(n).push([m, s, len]); };
    for (const s of byStreet.get(key) || []) { link(s.a, s.b, s, s.len); link(s.b, s.a, s, s.len); }
    const ends = [...adj.keys()], part = new Map();
    for (const n of ends) {
      if (part.has(n)) continue;
      const stack = [n]; part.set(n, n);
      while (stack.length) for (const [m] of adj.get(stack.pop())) if (!part.has(m)) { part.set(m, n); stack.push(m); }
    }
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      if (part.get(ends[i]) === part.get(ends[j])) continue;
      const d = apart(ends[i], ends[j]);
      if (d <= SNAP) { link(ends[i], ends[j], null, d); link(ends[j], ends[i], null, d); }
    }
    adjOf.set(key, adj);
    return adj;
  };
  const degree = (adj, n) => adj.get(n).filter(([, s]) => s).length;
  // the street's ends at the city line: loose ends that meet no other street
  const lineEnds = (key) => { const adj = adjacency(key); return [...adj.keys()].filter((n) => degree(adj, n) === 1 && nodeStreets.get(n).size === 1); };
  function crossNodes(key, cross) {
    const adj = adjacency(key);
    if (CITY_LINE.test(cross)) return lineEnds(key);
    const ck = streetKey(cross);
    const exact = [...adj.keys()].filter((n) => nodeStreets.get(n).has(ck));
    if (exact.length) return exact;
    return [...adj.keys()].filter((n) => [...nodeStreets.get(n)].some((k) => k !== key && (baseName(k) === baseName(ck) || baseName(k) === ck)));
  }
  function walk(key, A, B) {
    const adj = adjacency(key);
    let best = null;
    for (const f of A) {
      const dist = new Map([[f, 0]]), prev = new Map(), queue = [[0, f]];
      while (queue.length) {
        queue.sort((x, y) => x[0] - y[0]);
        const [d, n] = queue.shift();
        if (d > dist.get(n)) continue;
        for (const [m, s, len] of adj.get(n) || []) {
          const nd = d + len;
          if (nd < (dist.get(m) ?? Infinity)) { dist.set(m, nd); prev.set(m, [n, s]); queue.push([nd, m]); }
        }
      }
      for (const t of B) {
        if (t === f || !dist.has(t) || (best && dist.get(t) >= best.len)) continue;
        const path = [];
        for (let n = t; n !== f;) { const [pn, s] = prev.get(n); if (s) path.unshift(s); n = pn; }
        if (path.length) best = { len: dist.get(t), path };
      }
    }
    return best;
  }

  // 4. the odd side of each block, from the address points (MassGIS's ranges where the points can't tell)
  const ptsByStreet = new Map(), seenPt = new Set();
  for (const f of points) {
    const a = f.attributes, n = a.ADDRESS_NUMBER;
    if (!(n > 0) || !f.geometry) continue;
    const key = streetKey(a.STREET_NAME), id = key + '|' + n + '|' + f.geometry.x.toFixed(5) + ',' + f.geometry.y.toFixed(5);
    if (seenPt.has(id)) continue;                                          // one point per address and place (units share one)
    seenPt.add(id);
    if (!ptsByStreet.has(key)) ptsByStreet.set(key, []);
    ptsByStreet.get(key).push({ n, pt: [f.geometry.x, f.geometry.y] });
  }
  const rangeOdd = (p) => (p.PARITY_L === 'O' && p.PARITY_R !== 'O' ? 'L' : p.PARITY_R === 'O' && p.PARITY_L !== 'O' ? 'R' : null);
  const oddCheck = { fromPoints: 0, fromRanges: 0, unknown: 0, pointsAgreeWithRanges: 0, pointsDisagreeWithRanges: 0, disagreeExamples: [] };
  const oddOf = new Map();
  for (const s of segs) {
    let l = 0, r = 0;                                                       // points saying odd is on L / on R
    for (const { n, pt } of ptsByStreet.get(s.key) || []) {
      const h = sideOfPoint(s.c, pt);
      if (!h || h.d > 45 || h.along < -0.05 || h.along > 1.05) continue;
      if ((n % 2 === 1) === (h.side === 'L')) l++; else r++;
    }
    const byPts = l >= 2 && l >= 3 * r ? 'L' : r >= 2 && r >= 3 * l ? 'R' : null, byRange = rangeOdd(s.p);
    if (byPts && byRange) {
      if (byPts === byRange) oddCheck.pointsAgreeWithRanges++;
      else { oddCheck.pointsDisagreeWithRanges++; if (oddCheck.disagreeExamples.length < 5) oddCheck.disagreeExamples.push({ id: s.id, street: s.name, points: { oddLeft: l, oddRight: r } }); }
    }
    const odd = byPts || byRange;
    byPts ? oddCheck.fromPoints++ : byRange ? oddCheck.fromRanges++ : 0;
    if (odd) oddOf.set(s.id, odd);
  }
  // A block with neither: its neighbors on the same street (house numbers keep their side along a street), turned when
  // the two lines run opposite ways.
  for (let changed = true; changed;) {
    changed = false;
    for (const s of segs) {
      if (oddOf.has(s.id)) continue;
      for (const t of byStreet.get(s.key)) {
        if (t === s || !oddOf.has(t.id)) continue;
        const same = s.a === t.b || s.b === t.a, opposite = s.a === t.a || s.b === t.b;
        if (!same && !opposite) continue;
        oddOf.set(s.id, same ? oddOf.get(t.id) : flip(oddOf.get(t.id)));
        oddCheck.fromNeighbors = (oddCheck.fromNeighbors || 0) + 1;
        changed = true;
        break;
      }
    }
  }
  oddCheck.unknown = segs.filter((s) => !oddOf.has(s.id)).length;

  // 5. sections → block sides
  const blocks = new Map();       // segment id → { s, sides: Map(side → Map(ruleKey → { rule, kind, specific })) }
  const skipped = [], fixedSide = [];
  const skip = (sec, why) => skipped.push({ why, section: { node: sec.node, street: [sec.street, sec.suffix].filter(Boolean).join(' '), side: sec.side, day: sec.day, hours: sec.hours, stretch: sec.stretch } });
  const usedSquares = {};
  let placed = 0, sidesUnknown = 0, notInSomerville = 0;
  const near = (s, pt, m) => { const h = sideOfPoint(s.c, pt); return h && h.d <= m; };
  // the blocks a square covers
  function squareBlocks(name, onStreet) {
    const sq = SQUARES[streetKey(name)] || SQUARES[streetKey(name) + ' SQ'] || null;
    if (!sq) return null;
    let centers = [];
    if (sq.named) centers = (byStreet.get(sq.named) || []).flatMap((s) => [s.c[0], s.c[s.c.length - 1]]);
    if (sq.meet) centers = [...(adjacency(sq.meet[0]).keys())].filter((n) => nodeStreets.get(n).has(sq.meet[1])).map((n) => nodeAt.get(n));
    if (!centers.length) return null;
    const streets = onStreet ? [onStreet] : [...(sq.named ? [sq.named] : []), ...(sq.streets || sq.meet || [])];
    const out = new Set();
    for (const k of streets) for (const s of byStreet.get(k) || []) {
      const mid = s.c[Math.floor(s.c.length / 2)];
      if (sq.named && k === sq.named && !onStreet) { out.add(s); continue; }
      if (centers.some((c) => near(s, c, 25)) || centers.some((c) => { const [x1, y1] = xy(c), [x2, y2] = xy(mid); return Math.hypot(x2 - x1, y2 - y1) <= SQUARE_M; })) out.add(s);
    }
    const seen = (usedSquares[nice(streetKey(name)) + (onStreet ? ` (${nice(onStreet)})` : '')] ||= new Set());
    for (const x of out) seen.add(x.id);
    return [...out];
  }
  // "Central St from Broadway to R.R. bridge" + "from Summer St. to R.R. bridge" with the same day: Broadway to Summer St
  const railPairs = new Map();
  for (const sec of sections) {
    const st = parseStretch(sec.stretch, sec.side);
    if (st.from && (RAIL.test(st.to) || RAIL.test(st.from))) {
      const k = [streetKey([sec.street, sec.suffix].join(' ')), sec.side, sec.day, sec.hours].join('|');
      if (!railPairs.has(k)) railPairs.set(k, []);
      railPairs.get(k).push(RAIL.test(st.to) ? st.from : st.to);
    }
  }
  // streets with odd or even sections (for the either-side rule above)
  const sidedStreets = new Set(sections.filter((x) => x.side === 'odd' || x.side === 'even').map((x) => resolve(streetKey([x.street, x.suffix].filter(Boolean).join(' ')))).filter(Boolean));
  // whole streets first, then stretches and squares, which replace a whole street's rule of the same kind on their blocks
  const order = sections.map((sec) => ({ sec, st: parseStretch(sec.stretch, sec.side) })).sort((x, y) => (x.st.whole ? 0 : 1) - (y.st.whole ? 0 : 1) || x.sec.node - y.sec.node);
  for (const { sec, st } of order) {
    const sched = parseSchedule(sec.day, sec.hours, sec.side);
    if (!sched) { skip(sec, 'day or hours not understood'); continue; }
    if (st.skip) { skip(sec, st.skip); continue; }
    if (sched.kind === 'day' && sched.side !== sec.side) fixedSide.push({ node: sec.node, street: [sec.street, sec.suffix].filter(Boolean).join(' '), pageSide: sec.side, day: sec.day, used: sched.side });
    const rawKey = streetKey([sec.street, sec.suffix].filter(Boolean).join(' '));
    if (sched.side === 'both' && sched.kind === 'night' && !st.square && !SQUARES[rawKey] && sidedStreets.has(resolve(rawKey))) {
      skip(sec, "either-side night sweep on a street with odd and even sweeps: not in the City's reminder tool (spot-checked)");
      continue;
    }
    if (sched.kind === 'night' && NIGHT_ENDS[resolve(rawKey)]) sched.rule[2] = NIGHT_ENDS[resolve(rawKey)];
    let target = null;
    if (SQUARES[rawKey] && st.whole) target = squareBlocks(rawKey);
    else {
      const key = resolve(rawKey);
      if (!key) { skip(sec, 'street not in MassGIS roads'); continue; }
      if (st.whole) target = byStreet.get(key);
      else if (st.atCityLine) {
        const ends = lineEnds(key);
        if (ends.length !== 1) { skip(sec, `"${sec.stretch}": ${ends.length} street ends at a city line`); continue; }
        target = (byStreet.get(key) || []).filter((x) => x.a === ends[0] || x.b === ends[0]);
      } else if (st.square) target = st.square.flatMap((q) => squareBlocks(q.replace(/\s+sq$/i, ' Sq'), key) || []);
      else {
        let from = st.from, to = st.to;
        if (from && (RAIL.test(from) || RAIL.test(to))) {
          const ends = railPairs.get([rawKey, sec.side, sec.day, sec.hours].join('|')) || [];
          if (ends.length !== 2) { skip(sec, 'ends at a railroad bridge, with no matching other half'); continue; }
          [from, to] = ends;
        }
        const A = st.end ? crossNodes(key, st.end) : crossNodes(key, from);
        const B = st.end ? [...adjacency(key).keys()].filter((n) => degree(adjacency(key), n) === 1) : crossNodes(key, to);
        if (!A.length || !B.length) { skip(sec, 'cross street not found on the street'); continue; }
        const w = walk(key, A, B);
        if (!w) { skip(sec, 'no walk between the cross streets'); continue; }
        target = w.path;
      }
    }
    if (!target || !target.length) { skip(sec, 'square not found'); continue; }
    placed++;
    const specific = !st.whole;
    for (const s of target) {
      const odd = oddOf.get(s.id);
      const sides = sched.side === 'both' ? ['L', 'R'] : odd ? [sched.side === 'odd' ? odd : flip(odd)] : [];
      if (!sides.length) { sidesUnknown++; continue; }
      for (const side of sides) {
        if (!(side === 'L' ? s.inL : s.inR)) { notInSomerville++; continue; }  // the other city's side of a boundary street
        if (!blocks.has(s.id)) blocks.set(s.id, { s, sides: new Map() });
        const blk = blocks.get(s.id);
        if (!blk.sides.has(side)) blk.sides.set(side, new Map());
        const m = blk.sides.get(side);
        // a stretch replaces the whole street's rule of the same kind and side ("odd", "even" or "both"): a square's
        // nightly sweep of both sides leaves a street's odd and even night sweeps alone
        const same = (v) => v.kind === sched.kind && v.cls === sched.side;
        if (specific) {
          for (const [k, v] of m) if (!v.specific && same(v)) m.delete(k);
        } else if ([...m.values()].some((v) => v.specific && same(v))) continue;
        m.set(sched.rule.join('|'), { rule: sched.rule, kind: sched.kind, cls: sched.side, specific });
      }
    }
  }

  // 6. blocks out
  // Cross streets of a block: the other street at each end, walking on along the street past ends that meet none (a
  // block split mid-way).
  const limitsOf = (s) => {
    const at = (n, from) => {
      for (let hop = 0, cur = n, prev = from; hop < 12; hop++) {
        const other = [...nodeStreets.get(cur)].filter((k) => k !== s.key).map(nice).sort()[0];
        if (other) return other;
        const next = (adjacency(s.key).get(cur) || []).find(([m, sg]) => sg && m !== prev);
        if (!next) return '';
        [prev, cur] = [cur, next[0]];
      }
      return '';
    };
    const a = at(s.a, s.b), b = at(s.b, s.a);
    return a && b && a !== b ? `${a} - ${b}` : a || b;
  };
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const out = [];
  for (const { s, sides } of blocks.values()) {
    const d = [...sides.entries()].filter(([, m]) => m.size).sort().map(([side, m]) => [side, compass(s.c, side),
      [...m.values()].map((v) => v.rule).sort((x, y) => x[0] - y[0] || x[3] - y[3] || String(x[1]).localeCompare(String(y[1])))]);
    if (!d.length) continue;
    const nums = ['L_FROM', 'L_TO', 'R_FROM', 'R_TO'].map((k) => parseInt(s.p[k], 10)).filter((v) => v > 0);
    const odd = oddOf.get(s.id);
    out.push({ c: s.id, s: s.name, l: limitsOf(s), ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}), ...(odd ? { o: odd } : {}),
      g: s.c.map(([lo, la]) => [r6(lo), r6(la)]), d });
  }
  out.sort((x, y) => x.s.localeCompare(y.s) || x.c.localeCompare(y.c));
  const sides = out.reduce((n, b) => n + b.d.length, 0), ruleCount = out.reduce((n, b) => n + b.d.reduce((m, x) => m + x[2].length, 0), 0);
  log(`sections placed ${placed}/${sections.length}, ${out.length} blocks, ${sides} sides, ${ruleCount} rules; ${skipped.length} sections skipped, ${sidesUnknown} block sides with no odd side, ${notInSomerville} sides outside Somerville`);

  // 7. write
  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: 'Street sweeping section pages (City of Somerville)', url: SWEEPING, license: 'City of Somerville public web pages (no license stated)', fetched: today },
    { name: 'MassGIS Roads (NG911 road centerlines)', url: ROADS.replace(/\/0$/, ''), license: 'MassGIS (Commonwealth of Massachusetts), public data', fetched: today },
    { name: 'MassGIS Master Address Points', url: POINTS.replace(/\/0$/, ''), license: 'MassGIS (Commonwealth of Massachusetts), public data', fetched: today },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({ _meta: { city: 'somerville', time_zone: 'America/New_York', generated: new Date().toISOString(), sources,
    blocks: out.length, sides, format: 'b[] = {c: MassGIS road centerline id (RCL_UNQ_ID), s: street, l: cross streets, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; rule = [jsDow, fromH, toH, weeksMask (bit i = week i+1), monthsMask (bit m-1), flags (2 = towable)]' }, b: out }));
  const bb = out.flatMap((b) => b.g).reduce((b, [lo, la]) => [Math.min(b[0], la), Math.min(b[1], lo), Math.max(b[2], la), Math.max(b[3], lo)], [90, 180, -90, -180]);
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  fs.writeFileSync(OUT + 'city.json', JSON.stringify({
    id: 'somerville', name: 'Somerville', region: 'Massachusetts', tz: 'America/New_York',
    center: [42.3876, -71.0995], zoom: 15, bounds: [[r4(bb[0]), r4(bb[1])], [r4(bb[2]), r4(bb[3])]],
    holidays: HOLIDAYS, holidaysSource: 'https://www.somervillema.gov/calendar', holidayRule: 'all',
    fine: '$50', tow: 'yes', fineSource: SWEEPING,
    agency: 'Somerville Department of Public Works', scheduleUrl: SWEEPING,
    sources,
    words: {
      rule: 'The odd side is swept on the 1st and 3rd of its weekday each month and the even side on the 2nd and 4th, 8 AM to noon, as the signs say; main streets and squares are also swept at night.',
      afterpass: 'April 1 to December 31. $50 ticket, and the car can be towed. No sweeping on City holidays.',
      dataNotes: "Schedules come from the City's street sweeping pages, one per street side or stretch, placed on MassGIS street centerlines; the odd side of each block comes from MassGIS address points. The day sweeps match the City's 2025 sweeping contract, and the City's reminder tool at 13 addresses.",
    },
  }, null, 1));
  const reasons = [...new Set(skipped.map((x) => x.why))].map((why) => ({ why, count: skipped.filter((x) => x.why === why).length,
    examples: skipped.filter((x) => x.why === why).slice(0, 6).map((x) => x.section) }));
  const kinds = { day: 0, night: 0 };
  for (const b of out) for (const [, , rules] of b.d) for (const r of rules) kinds[r[3] === 31 ? 'night' : 'day']++;
  fs.writeFileSync(OUT + 'report.json', JSON.stringify({
    generated: new Date().toISOString(),
    inputs: { sectionPages: sections.length, nodes: `${FIRST_NODE}-${LAST_NODE}`, massgisRoadSegments: roads.length, addressPoints: points.length, uniqueAddressPlaces: seenPt.size,
      sides: Object.fromEntries(['odd', 'even', 'either'].map((k) => [k, sections.filter((s) => s.side === k).length])),
      days: [...new Set(sections.map((s) => s.day))].length, hours: [...new Set(sections.map((s) => s.hours))] },
    output: { sectionsPlaced: placed, sectionsSkipped: skipped.length, blocks: out.length, sides, rules: ruleCount, dayRules: kinds.day, nightRules: kinds.night,
      blockSidesWithNoOddSide: sidesUnknown, sidesOutsideSomerville: notInSomerville, sizeBytes: fs.statSync(OUT + 'segments.json').size },
    season: 'April 1 to December 31 (months mask 4088), from the City: "Regular street sweeping schedules resume Wednesday, April 1, and will continue through December 31, 2026" (' + NEWS_2026 + '). Night sweeps are given the same season (assumption).',
    oddSide: { ...oddCheck, method: 'Address points of the same street within 45 m of a block, by side: odd decided when at least 2 points and 3 to 1 agree; else MassGIS PARITY_L/PARITY_R; else the next block of the same street (fromNeighbors).' },
    sideFixes: { what: 'Day sweeps whose page side disagrees with its weeks: the weeks win (1st and 3rd = odd, 2nd and 4th = even, the City rule; for McGrath Highway the City\'s street sweeping contract of December 2025 (IFB #26-30) lists that route as "1st & 3rd Monday odd side, 2nd & 4th Tuesday even side").', list: fixedSide },
    squares: { what: `Squares the pages name without a stretch: MassGIS's own square streets (Union Square, Davis Square, Assembly Square Drive), or the blocks of the square's streets within ${SQUARE_M} m of where they meet (Teele: Broadway and Holland St; Ball: Broadway and Boston Ave; Magoun: Broadway and Medford St). An assumption: the pages give no extent.`, blocksPerSquare: Object.fromEntries(Object.entries(usedSquares).map(([k, v]) => [k, v.size])) },
    skipped: reasons,
    ticketCheck: 'none: Somerville does not publish parking tickets (its open data has moving violations only).',
    spotCheck: {
      what: "By hand on 2026-10-18, not part of the build: the City's reminder tool (ReCollect) at 13 addresses on Highland Ave (2), Broadway (2), Holland St, Medford St, Somerville Ave, College Ave, Central St, Walnut St, Cedar St, Bow St and Evergreen Ave; 4 more lookups gave nothing usable (3 found no address, 1 no answer). One lookup per address, never more.",
      agree: 'After the fixes below, the map gives all 13 addresses the days, hours and side the tool gives them (the address on the side its number puts it, by the MassGIS address points).',
      differ: ['Broadway: the tool says its night sweeps end at 8 AM (two addresses); the pages say 6 AM. The map uses 8 AM (NIGHT_ENDS).',
        'No "either side" Friday or Saturday night sweep shows at any of the 10 addresses on streets the pages give one: those 12 pages are left out (skipped).',
        'College Ave even side: the page says "Wednesday, 12 a.m. - 6 a.m." (no weeks, no "Night"); the tool says the 2nd and 4th Wednesday, 8 AM to noon. The map uses the tool (PAGE_FIXES, pageFixes below).',
        'Somerville Ave by Union Square: the map adds the square\'s Friday night sweep (a square, not checked), which the tool does not show there.'],
      pageFixes,
      nights: 'The tool lists night sweeps as "<weekday> 12AM-6AM" on that weekday (Monday Night = Monday 12 to 6 AM), as the map does.',
      holidays: 'The tool marks the nine City holidays of the season and drops the sweeps on them, with no make-up day; it does not mark Thanksgiving Friday.',
    },
    contractCheck: {
      what: "By hand on 2026-10-18, not part of the build: the street lists of the City's 2025 street sweeping contract (IFB #26-30, Attachment A, December 2025: five routes, each \"1st & 3rd <day> odd side, 2nd & 4th <day> even side\", 8 AM to noon), read with pdfplumber and matched to the pages by street name.",
      url: 'https://s3.amazonaws.com/somervillema-live/s3fs-public/2025-12/IFB%2026-30%20Street%20Sweeping%20Services.pdf',
      streetsInBoth: 368, bothSidesAgree: 367, oneSideAgrees: 1, oneSideExample: 'Linwood St: the contract has odd 1st & 3rd Monday, even 2nd & 4th Tuesday; the pages have even 2nd & 4th Monday',
      inContractNotOnPages: ['Assembly Row', 'Foley St', 'Revolution Way (New St)', 'Artisan Way', 'Canal St', 'Grand Union Blvd (and the other new Assembly Square streets)'],
      note: 'The streets the contract adds are new Assembly Square streets with no page: they are not on the map. About 70 page streets were not found in the contract text (two-column lines the reader splits badly, or streets the City sweeps itself).',
    },
    holidays: { rule: 'all', source: "the City's calendar (Holiday: …, all City offices closed) and the holidays the City's reminder tool marks in the sweeping season", note: 'Sweeping is skipped on City holidays, with no make-up day. Thanksgiving Friday (a City holiday) is not a sweeping holiday in the reminder tool and is left out. Independence Day 2026 falls on a Saturday: only Saturday-morning night sweeps are affected. 2027 after New Year\'s Day is derived (same holidays, same rules).' },
  }, null, 1));
  log(`wrote data/somerville/segments.json (${Math.round(fs.statSync(OUT + 'segments.json').size / 1024)} KB), city.json, report.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
