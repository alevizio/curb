#!/usr/bin/env node
// Cambridge, MA for CURB (started 2026-10-18; the spec is docs/multi-city/city-build.md, the research page
// docs/multi-city/cambridge.md). Builds data/cambridge/ from the City's own published data:
//
//   1. Traffic Regulation Schedule M, Section 16.7 Street Cleaning (PDF, revision 9/15/2014): the only street side
//      table the City publishes (946 rows: street, side N/S/E/W, from, to, "4th Wednesday", "8AM-2PM"). The schedule
//      dataset that replaced it on the open data portal (uvf3-2xt3) is private now.
//   2. Street Centerline (3d3q-sfd6): block lines with node ids and address ranges, to place each row and to tell
//      which side holds the odd numbers.
//   3. Master Addresses List (vup6-kpwv): the street cleaning district of every address, for the report.
//   4. Cambridge Parking Tickets (vnxa-cuyr): every 2025 street cleaning ticket (violation S1) with its date, time
//      and the address or corner it was written at. They check whether the 2014 table is still what the signs say.
//
// The ticket check decides what ships. segments.json is written only when at least SHIP_SHARE of the 2025 tickets
// that can be placed on a block side land on a side the table says is swept that day and hour. When the check fails
// (it does in 2026: the City moved one side of districts B, C and H to other weeks after 2014), the build writes
// city.json and report.json, and no segments.json, so no wrong map ships.
//
// Run: node scripts/cities/cambridge.mjs [--refresh]   (Node 18+; downloads cached in private/cache/cambridge/)

import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------- PDF text (Schedule M: TrueType WinAnsi fonts, one BT ... ET block per table cell) ---------------------

// Every text run of a PDF with its page and position: [{ p, x, y, t }]. Enough for this table, not a general reader.
export function pdfCells(buf) {
  const s = buf.toString('latin1');
  const objAt = (n) => {
    const m = new RegExp('(?:^|\\s)' + n + ' 0 obj\\b').exec(s);
    if (!m) throw new Error(`PDF: no object ${n}`);
    const start = m.index + m[0].length;
    return { start, body: s.slice(start, s.indexOf('endobj', start)) };
  };
  const ref = (body, key) => { const m = new RegExp('/' + key + '\\s+(\\d+) 0 R').exec(body); return m ? +m[1] : null; };
  const stream = (n) => {
    const o = objAt(n), m = /^\s*<<([\s\S]*?)>>\s*stream\r?\n/.exec(o.body);
    if (!m) throw new Error(`PDF: object ${n} is not a stream`);
    const lenRef = /\/Length\s+(\d+) 0 R/.exec(m[1]);
    const len = lenRef ? +/^\s*(\d+)/.exec(objAt(+lenRef[1]).body)[1] : +/\/Length\s+(\d+)/.exec(m[1])[1];
    const raw = buf.subarray(o.start + m[0].length, o.start + m[0].length + len);
    return (/FlateDecode/.test(m[1]) ? zlib.inflateSync(raw) : raw).toString('latin1');
  };
  const root = /\/Root\s+(\d+) 0 R/.exec(s);
  const pagesOf = (n) => {
    const b = objAt(n).body;
    if (/\/Type\s*\/Pages/.test(b)) return /\/Kids\s*\[([^\]]*)\]/.exec(b)[1].match(/\d+(?= 0 R)/g).map(Number).flatMap(pagesOf);
    return [n];
  };
  const pages = pagesOf(ref(objAt(root ? +root[1] : 1).body, 'Pages'));
  const unesc = (t) => t.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, c) =>
    ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[c] ?? String.fromCharCode(parseInt(c, 8)));
  const out = [];
  pages.forEach((pn, i) => {
    const b = objAt(pn).body, arr = /\/Contents\s*\[([^\]]*)\]/.exec(b);
    const ids = arr ? arr[1].match(/\d+(?= 0 R)/g).map(Number) : [ref(b, 'Contents')];
    const txt = ids.map(stream).join('\n');
    for (const bt of txt.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
      const tm = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm/.exec(bt[1]);
      if (!tm) continue;
      let t = '';
      for (const tj of bt[1].matchAll(/\[((?:\((?:\\.|[^\\)])*\)|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
        if (tj[1] !== undefined) for (const p of tj[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) t += unesc(p[1]);
        else t += unesc(tj[2]);
      }
      out.push({ p: i + 1, x: +tm[5], y: +tm[6], t });
    }
  });
  return out;
}

// Schedule M's columns by the x where a cell's text starts (cells are centered, so short texts start further right).
const COLS = [[140, 'street'], [170, 'side'], [265, 'from'], [360, 'to'], [440, 'days'], [500, 'hours'], [570, 'installed'],
  [630, 'installReg'], [690, 'removed'], [Infinity, 'removeReg']];
const colOf = (x) => COLS.find(([edge]) => x < edge)[1];
const HEADER = { Street: 'street', Side: 'side', From: 'from', To: 'to', Days: 'days', Hours: 'hours' };

// Positioned cells → table rows { page, street, side, from, to, days, hours, ... }. Fails when the layout changes.
export function scheduleRows(cells) {
  const lines = new Map();
  for (const c of cells) {
    if (c.y < 100) continue;                                                // page footer: CITY OF CAMBRIDGE … N of 28
    const k = c.p + '|' + c.y;
    if (!lines.has(k)) lines.set(k, { p: c.p, y: c.y, cells: [] });
    lines.get(k).cells.push(c);
  }
  const rows = [];
  let header = 0, pending = null;
  for (const l of [...lines.values()].sort((a, b) => a.p - b.p || b.y - a.y)) {
    const texts = l.cells.map((c) => c.t.trim());
    if (texts.includes('Street') && texts.includes('Side')) {               // the header row: check the columns
      for (const c of l.cells) if (HEADER[c.t.trim()] && colOf(c.x) !== HEADER[c.t.trim()]) throw new Error(`Schedule M: header "${c.t}" moved to x=${c.x}`);
      header++;
      continue;
    }
    if (texts.some((t) => /^(Install|Removal|Regulation)$/.test(t))) continue;  // the two header lines above it
    const r = {};
    for (const c of l.cells.sort((a, b) => a.x - b.x)) { const k = colOf(c.x); r[k] = ((r[k] || '') + ' ' + c.t).replace(/\s+/g, ' ').trim(); }
    if (!r.street) { pending = r; continue; }                               // a wrapped cell's first line, above its row
    if (pending) {
      for (const [k, v] of Object.entries(pending)) r[k] = (v + ' ' + (r[k] || '')).replace(/\s+/g, ' ').trim();
      pending = null;
    }
    rows.push({ page: l.p, ...r });
  }
  if (!header) throw new Error('Schedule M: no header row (the PDF changed)');
  return rows;
}

// ---------- the table's words -------------------------------------------------------------------------------------

const DOWS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// "4th Wednesday" → { nth: 4, dow: 3 } (JavaScript weekday)
export function parseDays(s) {
  const m = /^\s*([1-5])(?:st|nd|rd|th)\s+(\w+)\s*$/i.exec(String(s || ''));
  const dow = m ? DOWS.indexOf(m[2].toLowerCase()) : -1;
  return dow >= 0 ? { nth: +m[1], dow } : null;
}
// "8AM-2PM" → [8, 14]; "7am-10am" → [7, 10]
export function parseHours(s) {
  const m = /^\s*(\d{1,2})(?::(\d\d))?\s*(am|pm)\s*-\s*(\d{1,2})(?::(\d\d))?\s*(am|pm)\s*$/i.exec(String(s || ''));
  if (!m) return null;
  const h = (hh, mm, ap) => { let v = +hh % 12 + (/pm/i.test(ap) ? 12 : 0); return mm && +mm ? `${v}:${mm}` : v; };
  return [h(m[1], m[2], m[3]), h(m[4], m[5], m[6])];
}
const toHours = (v) => typeof v === 'number' ? v : +v.split(':')[0] + +v.split(':')[1] / 60;

const TYPE = { STREET: 'ST', ST: 'ST', AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE', ROAD: 'RD', RD: 'RD', PLACE: 'PL', PL: 'PL',
  TERRACE: 'TER', TERR: 'TER', TER: 'TER', COURT: 'CT', CT: 'CT', DRIVE: 'DR', DR: 'DR', LANE: 'LN', LN: 'LN', PARK: 'PK',
  PK: 'PK', CIRCLE: 'CIR', CIR: 'CIR', SQUARE: 'SQ', SQ: 'SQ', HIGHWAY: 'HWY', HWY: 'HWY', BOULEVARD: 'BLVD', BLVD: 'BLVD',
  PARKWAY: 'PKWY', PKWY: 'PKWY', WAY: 'WAY', WY: 'WAY' };
// Schedule M's and the tickets' spellings → the centerline's, for what the rules in streetKey can't reconcile.
const ALIAS = { 'MASS AVE': 'MASSACHUSETTS AVE', 'FRESHPOND PKWY': 'FRESH POND PKWY', "O'BRIEN HWY": 'MONSIGNOR OBRIEN HWY',
  "O'BRIAN HWY": 'MONSIGNOR OBRIEN HWY', 'OBRIEN HWY': 'MONSIGNOR OBRIEN HWY', 'VASSALL LN': 'VASSAL LN', 'VASSELL LN': 'VASSAL LN',
  'CARDINAL MEDEIROS': 'CARDINAL MEDEIROS AVE', 'BAYSTATE RD': 'BAY STATE RD', WATERHOUSE: 'WATERHOUSE ST', 'MEACHUM RD': 'MEACHAM RD',
  'HAWTHORNE ST': 'HAWTHORN ST', 'UPLAND ST': 'UPLAND RD', 'AVONHILL ST': 'AVON HILL ST', 'BURNS RD': 'CORPORAL BURNS RD',
  'BUENA VISTA RD': 'BUENA VISTA PK', 'CLINTON AVE': 'CLINTON ST', 'COTTAGE PK AVE': 'COTTAGE PARK AVE', 'DOUGLAS ST': 'DOUGLASS ST',
  'CAMERON ST': 'CAMERON AVE', 'WILLIARD ST': 'WILLARD ST', 'FOUNTIAN TER': 'FOUNTAIN TER', ROSELAND: 'ROSELAND ST', TREMONT: 'TREMONT ST',
  'SEVILLE ST': 'SAVILLE ST', 'HUBBARD PK RD': 'HUBBARD PARK RD', 'FAIRWEATHER ST': 'FAYERWEATHER ST', 'ST SAVEUR CT': 'ST SAUVEUR CT',
  'ST SAUVER CT': 'ST SAUVEUR CT', 'COLUMBUS ST': 'COLUMBUS AVE', 'MCTERNAN ST': 'CORPORAL MCTERNAN ST', 'MERCIR CIR': 'MERCER CIR',
  'RAYMOND AVE': 'RAYMOND ST', 'RIEDISEL AVE': 'RIEDESEL AVE', 'SUMMER RD': 'SUMNER RD', 'SOMNER RD': 'SUMNER RD',
  'S NORMANDY AVE': 'SOUTH NORMANDY AVE', 'ACADIA ST': 'ACACIA ST', 'CAMBRIDGER TER': 'CAMBRIDGE TER', 'CHANING PL': 'CHANNING PL',
  'FAIROAKS ST': 'FAIR OAKS ST', 'JFK ST': 'JOHN F KENNEDY ST', 'MT AUBURN ST': 'MOUNT AUBURN ST', 'B RDWY': 'BROADWAY' };
const ORD = { '1ST': 'FIRST', '2ND': 'SECOND', '3RD': 'THIRD', '4TH': 'FOURTH', '5TH': 'FIFTH', '6TH': 'SIXTH', '7TH': 'SEVENTH',
  '8TH': 'EIGHTH', '9TH': 'NINTH' };
// One spelling per street: "Alberta Terr" and "ALBERTA TER" → "ALBERTA TER", "3rd St" → "THIRD ST" (the centerline's).
export function streetKey(s) {
  const w = String(s || '').toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).map((x) => ORD[x] || x);
  if (w.length > 1 && TYPE[w[w.length - 1]]) w[w.length - 1] = TYPE[w[w.length - 1]];
  const k = w.join(' ');
  return ALIAS[k] || k;
}
// The name without its type: "ELM ST N" and "ELM ST" → "ELM", "GROVE AVE" → "GROVE".
export const baseName = (key) => key.replace(/ [NSEW]$/, '').replace(/ (ST|AVE|RD|PL|TER|CT|DR|LN|PK|CIR|SQ|HWY|BLVD|PKWY|WAY)$/, '');
// Cross street words that are not streets: the street's own ends.
export function crossKind(s) {
  const k = String(s || '').toUpperCase().trim();
  if (!k || k === 'NONE') return 'none';
  if (/^(DEAD END|END|TURN AROUND)$/.test(k)) return 'deadEnd';
  if (/\bLINE\b|\(SOMERVILLE\)|^RR\b|^BRIDGE$/.test(k)) return 'cityLine';     // Somerville Line, Belmont City Line, RR tracks
  return 'street';
}
const crossStreet = (s) => String(s || '').replace(/^\s*\d+'\s*[NSEW]\s+of\s+/i, '');   // "26'W of Cameron Ave" → Cameron Ave

// A ticket's location: "127 willow st" → { num: 127, street: 'WILLOW ST' }; "plympton st&memorial dr" → { cross: [...] }
export function ticketPlace(loc) {
  const s = String(loc || '').trim();
  if (s.includes('&')) return { cross: s.split('&').map((x) => streetKey(x)).filter(Boolean) };
  const m = /^(\d+)[A-Z]?(?:-\d+[A-Z]?)?\s+(.+)$/i.exec(s);
  return m ? { num: +m[1], street: streetKey(m[2]) } : null;
}
// A local date's weekday and which one of the month it is: "2025-06-04" → { nth: 1, dow: 3 }
export function nthWeekday(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { nth: Math.floor((d - 1) / 7) + 1, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

// ---------- geometry ----------------------------------------------------------------------------------------------

const LAT0 = 42.375, LON0 = -71.11, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const lineLen = (c) => { let s = 0; for (let i = 1; i < c.length; i++) { const a = xy(c[i - 1]), b = xy(c[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
// The compass word for side L or R of a line looking from its first point to its last (as in scripts/cities/boston.mjs).
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
const LETTER = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };
// Which side (L or R, looking first → last point) a sign's N, S, E or W names; null when the line runs that way.
export function sideFor(letter, c, min = 0.25) {
  const v = LETTER[String(letter || '').toUpperCase()];
  if (!v) return null;
  const a = xy(c[0]), b = xy(c[c.length - 1]), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!len) return null;
  const dot = (-(b[1] - a[1]) * v[0] + (b[0] - a[0]) * v[1]) / len;        // left normal · the letter's direction
  return dot > min ? 'L' : dot < -min ? 'R' : null;
}
const flip = (s) => (s === 'L' ? 'R' : 'L');

// ---------- the build ---------------------------------------------------------------------------------------------

export const SHIP_SHARE = 0.9;
const SIDE_CLEAR = 0.35;          // sin of the angle between the street and the letter's axis below which N/S/E/W can't be told
const SOURCES = {
  scheduleM: 'https://www.cambridgema.gov/~/media/Files/Traffic/trafficregulations/schedules/mschedulejuly2014.pdf',
  centerline: 'https://data.cambridgema.gov/resource/3d3q-sfd6.geojson?$limit=50000&$order=:id',
  addresses: 'https://data.cambridgema.gov/resource/vup6-kpwv.json?$select=address_id,street_number,stname,latitude,longitude,type,street_sweeping_district&$limit=100000&$order=address_id',
  tickets: "https://data.cambridgema.gov/resource/vnxa-cuyr.json?$select=ticket_issue_date,issue_time,location,location_type&$where=violation_code='S1' AND ticket_issue_date>='2025-01-01' AND ticket_issue_date<'2026-01-01'&$order=:id&$limit=50000",
  cityPage: 'https://www.cambridgema.gov/services/streetcleaning',
};

// The City's street cleaning holidays (the "Holiday List and Closures" on the City's page, read 2026-10-18), with the
// make-up day each sweep moves to. The day after Thanksgiving and Christmas Eve say "No changes": regular sweeping.
// 2027 is not posted yet: the same holidays by the same rules (observed on Friday or Monday), make-up days unknown.
const HOLIDAYS = [
  ['2026-04-20', "Patriots' Day", '2026-04-29'], ['2026-05-25', 'Memorial Day', '2026-05-29'], ['2026-06-19', 'Juneteenth', '2026-06-29'],
  ['2026-07-03', 'Independence Day (observed)', '2026-06-30'], ['2026-09-07', 'Labor Day', '2026-08-31'],
  ['2026-10-12', "Indigenous Peoples' Day", '2026-09-29'], ['2026-11-11', 'Veterans Day', '2026-10-29'],
  ['2026-11-26', 'Thanksgiving Day', '2026-11-30'], ['2026-12-25', 'Christmas Day', '2026-12-29'],
  ['2027-04-19', "Patriots' Day"], ['2027-05-31', 'Memorial Day'], ['2027-06-18', 'Juneteenth (observed)'],
  ['2027-07-05', 'Independence Day (observed)'], ['2027-09-06', 'Labor Day'], ['2027-10-11', "Indigenous Peoples' Day"],
  ['2027-11-11', 'Veterans Day'], ['2027-11-25', 'Thanksgiving Day'], ['2027-12-24', 'Christmas Day (observed)'],
];

async function main() {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const OUT = ROOT + 'data/cambridge/', CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/cambridge/';
  const REFRESH = process.argv.includes('--refresh');
  const log = (...a) => console.error('[cambridge]', ...a);
  const UA = { 'User-Agent': 'curb-cambridge-build (+https://curb.guide)' };
  async function cached(name, url, kind = 'json') {
    const f = CACHE + name;
    if (REFRESH || !fs.existsSync(f)) {
      log(`fetching ${name}…`);
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    }
    const b = fs.readFileSync(f);
    return kind === 'json' ? JSON.parse(b.toString('utf8')) : kind === 'text' ? b.toString('utf8') : b;
  }

  // 1. inputs
  const pdf = await cached('schedule-m-2014.pdf', SOURCES.scheduleM, 'buffer');
  const centerline = await cached('centerline.geojson', SOURCES.centerline);
  const addresses = await cached('addresses.json', SOURCES.addresses);
  const tickets = await cached('tickets-2025.json', SOURCES.tickets);
  const cityPage = await cached('city-page.html', SOURCES.cityPage, 'text');
  const pageText = cityPage.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  for (const [d, name, mk] of HOLIDAYS) {
    if (!mk) continue;
    const day = new Date(mk + 'T12:00:00Z'), month = day.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
    if (!new RegExp(`rescheduled (?:to )?${month} ${day.getUTCDate()}(?:st|nd|rd|th)?\\b`).test(pageText))
      throw new Error(`the City's holiday list changed (no make-up day ${mk} for ${name} ${d}): update HOLIDAYS`);
  }
  if (!/\$100 per violation/.test(pageText)) throw new Error('the City page no longer says "$100 per violation": check the fine');

  const rows = scheduleRows(pdfCells(pdf));
  if (rows.length < 900 || rows.length > 1000) throw new Error(`Schedule M: ${rows.length} rows, expected about 946`);
  log(`${rows.length} Schedule M rows, ${centerline.features.length} centerline segments, ${addresses.length} addresses, ${tickets.length} tickets`);

  // 2. the street graph
  const segs = [], byStreet = new Map(), nodeStreets = new Map(), nodeAt = new Map();
  const nid = (v, c) => (v != null && v !== '' ? String(parseFloat(v)) : c[0].toFixed(6) + ',' + c[1].toFixed(6));
  for (const f of centerline.features) {
    const p = f.properties, parts = f.geometry && f.geometry.coordinates;
    if (!parts || !parts.length || !p.street) continue;
    const c = parts.length === 1 ? parts[0] : parts.flat();                   // one segment has two touching parts
    if (c.length < 2) continue;
    const s = { id: p.id, p, c, key: streetKey(p.street), name: p.street, a: nid(p.fromnode, c[0]), b: nid(p.tonode, c[c.length - 1]), len: lineLen(c) };
    segs.push(s);
    if (!byStreet.has(s.key)) byStreet.set(s.key, []);
    byStreet.get(s.key).push(s);
    for (const [n, pt] of [[s.a, c[0]], [s.b, c[c.length - 1]]]) {
      if (!nodeStreets.has(n)) nodeStreets.set(n, new Set());
      nodeStreets.get(n).add(s.key);
      nodeAt.set(n, pt);
    }
  }
  // A name the centerline doesn't have → the one street with the same name and another type ("Grove St" → Grove Ave).
  const resolve = (key) => {
    if (byStreet.has(key)) return key;
    const hits = [...byStreet.keys()].filter((k) => baseName(k) === baseName(key));
    return hits.length === 1 ? hits[0] : null;
  };
  const adjOf = new Map();
  // The street's own graph. Two kinds of links with no block on them mend the City's lines: ends of the street within
  // SNAP meters (an offset corner), and loose ends within GAP meters (a block missing from the centerline).
  const SNAP = 30, GAP = 200;
  const apart = (n, m) => { const [x1, y1] = xy(nodeAt.get(n)), [x2, y2] = xy(nodeAt.get(m)); return Math.hypot(x2 - x1, y2 - y1); };
  const adjacency = (key) => {
    if (adjOf.has(key)) return adjOf.get(key);
    const adj = new Map(), link = (n, m, s, len) => { if (!adj.has(n)) adj.set(n, []); adj.get(n).push([m, s, len]); };
    for (const s of byStreet.get(key) || []) { link(s.a, s.b, s, s.len); link(s.b, s.a, s, s.len); }
    const ends = [...adj.keys()], loose = new Set(ends.filter((n) => adj.get(n).length === 1));
    const part = new Map();                                                 // connected piece of the street, per node
    for (const n of ends) {
      if (part.has(n)) continue;
      const stack = [n];
      part.set(n, n);
      while (stack.length) for (const [m] of adj.get(stack.pop())) if (!part.has(m)) { part.set(m, n); stack.push(m); }
    }
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      if (part.get(ends[i]) === part.get(ends[j])) continue;               // only mend breaks between pieces
      const d = apart(ends[i], ends[j]);
      if (d <= SNAP || (d <= GAP && loose.has(ends[i]) && loose.has(ends[j]))) { link(ends[i], ends[j], null, d); link(ends[j], ends[i], null, d); }
    }
    adjOf.set(key, adj);
    return adj;
  };
  const degree = (adj, n) => adj.get(n).filter(([, s]) => s).length;
  // How far a point is from a street's lines, in meters.
  const distToStreet = (pt, key) => {
    const [px, py] = xy(pt);
    let best = Infinity;
    for (const s of byStreet.get(key) || []) for (let i = 1; i < s.c.length; i++) {
      const [x1, y1] = xy(s.c[i - 1]), [x2, y2] = xy(s.c[i]), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(px - x1 - t * dx, py - y1 - t * dy));
    }
    return best;
  };
  // Nodes of `key` that a cross street names: where it meets that street (by its name, else by the name without the
  // type, else within 25 m of its line), or the street's ends for a dead end or the city line.
  function crossNodes(key, cross) {
    const adj = adjacency(key), kind = crossKind(cross);
    if (kind === 'none') return [];
    if (kind !== 'street') return [...adj.keys()].filter((n) => degree(adj, n) === 1);
    const ck = streetKey(crossStreet(cross));
    const exact = [...adj.keys()].filter((n) => nodeStreets.get(n).has(ck));
    if (exact.length) return exact;
    const base = [...adj.keys()].filter((n) => [...nodeStreets.get(n)].some((k) => k !== key && baseName(k) === baseName(ck)));
    if (base.length) return base;
    const rk = resolve(ck);
    return rk ? [...adj.keys()].filter((n) => distToStreet(nodeAt.get(n), rk) <= 25) : [];
  }
  // The shortest walk along `key` from a node in A to a node in B (the blocks on it, in order).
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
        for (let n = t; n !== f;) { const [pn, s] = prev.get(n); if (s) path.unshift({ s, fwd: s.a === pn }); n = pn; }
        if (path.length) best = { len: dist.get(t), path, from: nodeAt.get(f), to: nodeAt.get(t) };
      }
    }
    return best;
  }

  // 3. rows → block sides
  const parity = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n % 2 : null; };
  const oddSide = (p) => {
    const l = parity(p.l_from) ?? parity(p.l_to), r = parity(p.r_from) ?? parity(p.r_to);
    return l === 1 && r !== 1 ? 'L' : r === 1 && l !== 1 ? 'R' : null;
  };
  const MONTHS = 0b111111111000;                                            // April to December (bits 3..11)
  const sameSideTwice = new Set();
  {
    const seen = new Map();
    for (const r of rows) {
      const k = [streetKey(r.street), streetKey(r.from), streetKey(r.to), String(r.side || '').toUpperCase()].join('|');
      const d = r.days + ' ' + r.hours;
      if (seen.has(k) && seen.get(k) !== d) sameSideTwice.add(k);
      seen.set(k, d);
    }
  }
  const blocks = new Map();       // segment id → { s, rules: Map(side → Map(key → rule)), rows: [] }
  const skipped = [];
  const skip = (r, why) => skipped.push({ why, row: { street: r.street, side: r.side, from: r.from, to: r.to, days: r.days, hours: r.hours } });
  let rowsPlaced = 0, sidesUnclear = 0;
  const letterParity = {};        // street → letter → [even blocks, odd blocks]: which numbers the table's N, S, E or W holds
  for (const r of rows) {
    const key = resolve(streetKey(r.street)), days = parseDays(r.days), hours = parseHours(r.hours), letter = String(r.side || '').toUpperCase();
    if (!key) { skip(r, 'street not on the centerline'); continue; }
    if (!days || !hours) { skip(r, 'no day or hours'); continue; }
    if (!LETTER[letter]) { skip(r, 'no side'); continue; }
    if (sameSideTwice.has([streetKey(r.street), streetKey(r.from), streetKey(r.to), letter].join('|'))) { skip(r, 'same side listed twice with different days'); continue; }
    const A = crossNodes(key, r.from), B = crossNodes(key, r.to);
    if (!A.length || !B.length) { skip(r, crossKind(r.from) === 'none' || crossKind(r.to) === 'none' ? 'no cross streets' : 'cross street not found on the street'); continue; }
    const w = walk(key, A, B);
    if (!w) { skip(r, 'no walk between the cross streets'); continue; }
    // The side: the City names one side for the whole stretch, so the letter is read against the stretch's direction
    // (from one cross street to the other) and carried along it to each block. A stretch that runs within about 20° of
    // the letter's own axis (an "N side" on a street running north) can't be told: those rows are left out (68 of 875
    // in 2026, many in Riverside and East Cambridge).
    const walkSide = sideFor(letter, [w.from, w.to], SIDE_CLEAR);
    if (!walkSide) { sidesUnclear += w.path.length; skip(r, 'side letter runs along the street'); continue; }
    rowsPlaced++;
    const rule = [days.dow, hours[0], hours[1], 1 << (days.nth - 1), MONTHS, 0];
    for (const { s, fwd } of w.path) {
      const side = fwd ? walkSide : flip(walkSide);
      const odd = oddSide(s.p);
      if (odd) { const lp = ((letterParity[key] ||= {})[letter] ||= [0, 0]); lp[side === odd ? 1 : 0]++; }
      if (!blocks.has(s.id)) blocks.set(s.id, { s, rules: new Map(), rows: [] });
      const blk = blocks.get(s.id);
      if (!blk.rules.has(side)) blk.rules.set(side, new Map());
      blk.rules.get(side).set(rule.join('|'), rule);
      blk.rows.push(r);
    }
  }
  const limitsOf = (s) => {
    const at = (n) => [...nodeStreets.get(n)].filter((k) => k !== s.key).map((k) => byStreet.get(k)[0].name).sort()[0] || '';
    const a = at(s.a), b = at(s.b);
    return a && b ? `${a} - ${b}` : a || b;
  };
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const out = [...blocks.values()].map(({ s, rules }) => {
    const nums = ['l_from', 'l_to', 'r_from', 'r_to'].map((k) => parseInt(s.p[k], 10)).filter((v) => v > 0);
    const odd = oddSide(s.p);
    return { c: s.id, s: s.name, l: limitsOf(s), ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}),
      ...(odd ? { o: odd } : {}), g: s.c.map(([lo, la]) => [r6(lo), r6(la)]),
      d: [...rules.entries()].sort().map(([side, m]) => [side, compass(s.c, side), [...m.values()]]) };
  }).sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));
  const sides = out.reduce((n, b) => n + b.d.length, 0), ruleCount = out.reduce((n, b) => n + b.d.reduce((m, d) => m + d[2].length, 0), 0);
  log(`rows placed ${rowsPlaced}/${rows.length}, ${out.length} blocks, ${sides} sides, ${ruleCount} rules; ${skipped.length} rows skipped, ${sidesUnclear} block sides unclear`);

  // 4. the 2025 tickets against the table
  const segsByStreet = byStreet;
  // a house number → the block and side whose address range holds it (the range on the number's parity side)
  function placeAddress(key, num) {
    let best = null;
    for (const s of segsByStreet.get(key) || []) for (const side of ['L', 'R']) {
      const lo = parseInt(s.p[side === 'L' ? 'l_from' : 'r_from'], 10), hi = parseInt(s.p[side === 'L' ? 'l_to' : 'r_to'], 10);
      if (!(lo > 0 && hi > 0) || lo % 2 !== num % 2) continue;
      const d = num < Math.min(lo, hi) ? Math.min(lo, hi) - num : num > Math.max(lo, hi) ? num - Math.max(lo, hi) : 0;
      if (!best || d < best.d) best = { d, s, side };
    }
    return best && best.d <= 20 ? best : null;
  }
  const addrDistrict = new Map();
  for (const a of addresses) {
    const n = parseInt(a.street_number, 10);
    if (n > 0 && a.street_sweeping_district) addrDistrict.set(streetKey(a.stname) + '|' + n, a.street_sweeping_district);
  }
  const districtOf = (key, num) => {
    for (let d = 0; d <= 8; d += 2) for (const n of d ? [num - d, num + d] : [num]) { const v = addrDistrict.get(key + '|' + n); if (v) return v; }
    return null;
  };
  const sweptAt = (rules, when, hour) => [...(rules || new Map()).values()].some((r) => r[0] === when.dow && (r[3] & (1 << (when.nth - 1))) && hour >= toHours(r[1]) && hour < toHours(r[2]));
  const sweptDay = (rules, when) => [...(rules || new Map()).values()].some((r) => r[0] === when.dow && (r[3] & (1 << (when.nth - 1))));
  // The table by street, for the street and street + side levels (from and to left out): { letter, nth, dow, from, to }
  const tableByStreet = new Map();
  for (const r of rows) {
    const key = resolve(streetKey(r.street)), days = parseDays(r.days), hours = parseHours(r.hours);
    if (!key || !days || !hours) continue;
    if (!tableByStreet.has(key)) tableByStreet.set(key, []);
    tableByStreet.get(key).push({ letter: String(r.side || '').toUpperCase(), ...days, from: toHours(hours[0]), to: toHours(hours[1]) });
  }
  // A ticket's side from its house number: the table's letter on that street that holds those numbers (odd or even), as
  // the placed rows show it (most of that letter's blocks).
  const parityOf = (key, letter) => { const lp = letterParity[key] && letterParity[key][letter]; return lp && lp[0] !== lp[1] ? (lp[1] > lp[0] ? 1 : 0) : null; };
  const check = { tickets: tickets.length, corner: 0, makeUpDay: 0,
    streetLevel: { tickets: 0, streetNotInTable: 0, match: 0 },
    sideLevel: { tickets: 0, match: 0, sideUnclear: 0 },
    blockLevel: { tickets: 0, match: 0, dayNotHour: 0, otherSide: 0, sideNotThatDay: 0, blockNotInTable: 0 }, notPlaced: 0 };
  const byDistrict = {}, tally = (d, k) => { const t = (byDistrict[d || '?'] ||= { tickets: 0, sideTickets: 0, streetSide: 0, block: 0 }); t[k]++; };
  const slotCount = {};             // district|parity → "nth dow" → tickets (the pattern the tickets show)
  const placedTickets = [];
  for (const t of tickets) {
    const pl = ticketPlace(t.location);
    const when = nthWeekday(t.ticket_issue_date), [hh, mm] = String(t.issue_time || '0:0').split(':').map(Number), hour = hh + (mm || 0) / 60;
    if (!pl || pl.cross) { check.corner++; continue; }
    if (when.nth === 5) { check.makeUpDay++; continue; }                   // no regular sweep on a 5th weekday: a make-up day
    const key = resolve(pl.street), table = (key && tableByStreet.get(key)) || [];
    const onDay = table.filter((x) => x.nth === when.nth && x.dow === when.dow && hour >= x.from && hour < x.to);
    check.streetLevel.tickets++;
    if (!table.length) check.streetLevel.streetNotInTable++;
    if (onDay.length) check.streetLevel.match++;
    const at = key && placeAddress(key, pl.num);
    if (!at) { check.notPlaced++; continue; }
    const district = districtOf(pl.street, pl.num), par = pl.num % 2;
    if (district) { const k = district + '|' + par; (slotCount[k] ||= {})[when.nth + ' ' + when.dow] = (slotCount[k][when.nth + ' ' + when.dow] || 0) + 1; }
    placedTickets.push({ district, par, when, hour, at });
    tally(district, 'tickets');
    const clear = onDay.filter((x) => parityOf(key, x.letter) !== null);
    if (onDay.length && !clear.length) check.sideLevel.sideUnclear++;      // swept that day, on a side this build can't tell
    else {
      check.sideLevel.tickets++;
      tally(district, 'sideTickets');
      if (clear.some((x) => parityOf(key, x.letter) === par)) { check.sideLevel.match++; tally(district, 'streetSide'); }
    }
    check.blockLevel.tickets++;
    const blk = blocks.get(at.s.id), here = blk && blk.rules.get(at.side), there = blk && blk.rules.get(flip(at.side)), b = check.blockLevel;
    if (sweptAt(here, when, hour)) { b.match++; tally(district, 'block'); }
    else if (sweptDay(here, when)) b.dayNotHour++;
    else if (sweptAt(there, when, hour)) b.otherSide++;
    else if (blk) b.sideNotThatDay++;
    else b.blockNotInTable++;
  }
  const pct = (a, b) => Math.round(a / b * 1000) / 1000;
  const share = pct(check.sideLevel.match, check.sideLevel.tickets);
  // The pattern the tickets show: each district's odd side and even side on one weekday of one week.
  const W = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ORDW = ['', '1st', '2nd', '3rd', '4th'];
  const pattern = {};
  for (const [k, c] of Object.entries(slotCount)) {
    const [slot, n] = Object.entries(c).sort((a, b) => b[1] - a[1])[0], tot = Object.values(c).reduce((a, b) => a + b, 0);
    const [d, par] = k.split('|'), [nth, dow] = slot.split(' ').map(Number);
    (pattern[d] ||= {})[par === '1' ? 'odd' : 'even'] = { day: `${ORDW[nth]} ${W[dow]}`, nth, dow, tickets: tot, share: pct(n, tot) };
  }
  let patternMatch = 0, patternTickets = 0;
  for (const t of placedTickets) {
    const p = t.district && pattern[t.district] && pattern[t.district][t.par ? 'odd' : 'even'];
    if (!p) continue;
    patternTickets++;
    if (p.nth === t.when.nth && p.dow === t.when.dow) patternMatch++;
  }
  // Schedule M's rows against that pattern: does the row's day match its district's day for that side's parity?
  const rowVsPattern = { rows: 0, agree: 0, differ: 0, byDistrict: {} };
  for (const { s, rules } of blocks.values()) {
    const odd = oddSide(s.p);
    if (!odd) continue;
    for (const [side, m] of rules) {
      const lo = parseInt(s.p[side === 'L' ? 'l_from' : 'r_from'], 10);
      const district = lo > 0 ? districtOf(s.key, lo) : null, p = district && pattern[district] && pattern[district][side === odd ? 'odd' : 'even'];
      if (!p) continue;
      for (const r of m.values()) {
        rowVsPattern.rows++;
        const ok = r[0] === p.dow && r[3] === 1 << (p.nth - 1);
        ok ? rowVsPattern.agree++ : rowVsPattern.differ++;
        const t = (rowVsPattern.byDistrict[district] ||= { blockSides: 0, differ: 0 });
        t.blockSides++; if (!ok) t.differ++;
      }
    }
  }
  const blockShare = pct(check.blockLevel.match, check.blockLevel.tickets);
  const ship = share >= SHIP_SHARE && blockShare >= SHIP_SHARE;
  const sl = check.streetLevel;
  log(`tickets at an address, not on a make-up day: street ${sl.match}/${sl.tickets} (${(pct(sl.match, sl.tickets) * 100).toFixed(1)}%), street + side ${check.sideLevel.match}/${check.sideLevel.tickets} (${(share * 100).toFixed(1)}%), block side ${check.blockLevel.match}/${check.blockLevel.tickets} (${(blockShare * 100).toFixed(1)}%) land where the 2014 table sweeps that day and hour`);
  log(`district pattern: ${patternMatch}/${patternTickets} (${(pct(patternMatch, patternTickets) * 100).toFixed(1)}%) on their district's day for that side`);

  // 5. write
  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: 'Traffic Regulation Schedule M, Section 16.7 Street Cleaning (revision 9/15/2014)', url: SOURCES.scheduleM, license: 'City of Cambridge public record (no license stated)', fetched: today },
    { name: 'Street Centerline', url: 'https://data.cambridgema.gov/Basemap/Street-Centerline/3d3q-sfd6', license: 'ODC PDDL', fetched: today },
    { name: 'Master Addresses List', url: 'https://data.cambridgema.gov/Addresses/Master-Addresses-List/vup6-kpwv', license: 'ODC PDDL', fetched: today },
    { name: 'Cambridge Parking Tickets (2025, street cleaning)', url: 'https://data.cambridgema.gov/Traffic-Parking-and-Transportation/Cambridge-Parking-Tickets/vnxa-cuyr', license: 'ODC PDDL', fetched: today },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  const segFile = OUT + 'segments.json';
  if (ship) {
    fs.writeFileSync(segFile, JSON.stringify({ _meta: { city: 'cambridge', time_zone: 'America/New_York', generated: new Date().toISOString(), sources,
      blocks: out.length, sides, format: 'b[] = {c: centerline segment id, s: street, l: cross streets, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; rule = [jsDow, fromH, toH, weeksMask (bit i = week i+1), monthsMask (bit m-1), flags (2 = towable)]' }, b: out }));
  } else if (fs.existsSync(segFile)) fs.unlinkSync(segFile);                // never leave a map the check turned down
  const bb = segs.flatMap((s) => s.c).reduce((b, [lo, la]) => [Math.min(b[0], la), Math.min(b[1], lo), Math.max(b[2], la), Math.max(b[3], lo)], [90, 180, -90, -180]);
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const city = {
    id: 'cambridge', name: 'Cambridge', region: 'Massachusetts', tz: 'America/New_York',
    center: [42.3736, -71.1097], zoom: 14, bounds: [[r4(bb[0]), r4(bb[1])], [r4(bb[2]), r4(bb[3])]],
    holidays: Object.fromEntries(HOLIDAYS.map(([d, n]) => [d, n])),
    holidaysSource: SOURCES.cityPage, holidayRule: 'all',
    fine: '$100', tow: 'no', fineSource: SOURCES.cityPage,
    agency: 'Cambridge Department of Public Works', scheduleUrl: SOURCES.cityPage,
    sources,
    words: {
      rule: 'Each side of a residential street is swept once a month, April to December, on the day on its signs (for example "4th Wednesday"), usually 8 AM to 2 PM.',
      afterpass: 'April 1 to December 31. $100 ticket, no tow. A sweep that falls on a City holiday moves to a make-up day, which CURB does not show yet.',
      dataNotes: "The only street-by-street table the City publishes is Traffic Regulation Schedule M from 2014, placed on the City's street centerlines. The City's 2025 tickets show that one side of three districts has moved to another week since then, so CURB does not show Cambridge until the City publishes the current table.",
    },
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1));
  const examples = (why) => skipped.filter((x) => x.why === why).slice(0, 5).map((x) => x.row);
  const reasons = [...new Set(skipped.map((x) => x.why))].map((why) => ({ why, count: skipped.filter((x) => x.why === why).length, examples: examples(why) }));
  const report = {
    generated: new Date().toISOString(),
    verdict: ship ? 'shipped' : 'not shipped: the 2014 table is no longer what the signs say (see ticketCheck)',
    shipRule: `segments.json is written only when at least ${SHIP_SHARE * 100}% of the 2025 street cleaning tickets land where the table sweeps that day and hour, both on the street and side (from the house number) and on the block side`,
    inputs: { scheduleRows: rows.length, centerlineSegments: segs.length, addresses: addresses.length, tickets2025: tickets.length },
    schedule: { rowsPlaced, rowsSkipped: skipped.length, blocks: out.length, sides, rules: ruleCount, blockSidesUnclear: sidesUnclear, written: ship,
      season: 'April 1 to December 31 (months mask 4088)', windows: [...new Set(rows.map((r) => r.hours))].sort() },
    skipped: reasons,
    ticketCheck: {
      what: '2025 street cleaning tickets (violation S1) against the 2014 table: is the ticket on a street, a street side and a block side the table sweeps on that weekday of that week, at that hour? The side comes from the house number: odd or even, and the letter in the table (N, S, E or W) that holds those numbers on that street, as the placed rows show it.',
      ...check,
      shares: { street: pct(sl.match, sl.tickets), streetAndSide: share, blockSide: blockShare },
      notes: 'corner = written at an intersection, side unknown; makeUpDay = written on a 5th weekday of a month (days 29 to 31), when no regular sweep is scheduled: the City moves holiday sweeps there; notPlaced = the house number is in no centerline address range (counted at street level only); blockLevel: dayNotHour = that side is swept that day but the ticket time is outside the window, otherSide = the other side of the block is swept then, sideNotThatDay = the side is in the table for another day, blockNotInTable = no row of the table reaches that block (a street or a stretch the 2014 table does not list, or a row this build could not place)',
      byDistrict: Object.fromEntries(Object.entries(byDistrict).sort().map(([d, v]) => [d, { ...v, streetSideShare: pct(v.streetSide, v.sideTickets), blockShare: pct(v.block, v.tickets) }])),
    },
    districtPattern: {
      what: "The day the 2025 tickets show for each street cleaning district (from the Master Addresses List) and side parity: the most common weekday and week among the placed tickets, its ticket count and the share on that day.",
      pattern: Object.fromEntries(Object.entries(pattern).sort()),
      ticketsOnTheirDistrictDay: patternMatch, ticketsWithADistrict: patternTickets, share: pct(patternMatch, patternTickets),
      spotCheck: "By hand on 2026-10-18, not part of the build: the City's reminder tool (ReCollect) for one address in each of the 10 districts gives the same odd side and even side days as this pattern, for 2025 and 2026 (10 of 10).",
      tableVsPattern: rowVsPattern,
    },
    holidays: { rule: 'all', makeUpDays: Object.fromEntries(HOLIDAYS.filter((h) => h[2]).map(([d, n, mk]) => [d, `${n} → ${mk}`])),
      note: 'A sweep on a City holiday moves to a make-up day (a 5th weekday). CURB does not model make-up days yet: the holiday shows as no sweep.' },
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1));
  log(ship ? `wrote data/cambridge/segments.json (${out.length} blocks)` : `did NOT write segments.json: the ticket check is under ${SHIP_SHARE * 100}%`);
  for (const f of ['city.json', 'report.json']) log(`wrote data/cambridge/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
