#!/usr/bin/env node
// Precompute per-block "real-world" street-cleaning enforcement times for CURB.
//
// The posted sweeping window (yhqp-riqs) is a 2-hour band, but the ticket car
// passes each block in a much narrower window inside it. SFMTA parking citations
// (ab4h-6ztd) carry minute-resolution timestamps + an address — joining those to
// the block (CNN) via the address dataset (3mea-di5p) lets us show when a block is
// ACTUALLY ticketed. Output is a compact static JSON the app loads at runtime.
//
//   data/enforcement.json  =  { "<cnn>": { "<jsDow 0-6>": [n, avgMin, loMin, hiMin] }, "_meta": {...} }
//
// Run: npm run build:enforcement   (Node 18+, no deps — uses global fetch)
//
// Method notes:
// - Citations aggregated SERVER-SIDE by (citation_location, dow) so we move ~350k
//   rows, not ~1.2M. Paged with a cursor on citation_location (no deep offsets).
// - dow from Socrata date_extract_dow is Postgres DOW (0=Sun..6=Sat) == JS getDay();
//   we map a stray 7 -> 0 defensively.
// - A group is only credited to a block if its avg time lands near that block's
//   posted window (drops wrong-address matches and outlier typos).

const BASE = 'https://data.sfgov.org/resource';
const SWEEP = `${BASE}/yhqp-riqs.json`;
const ADDR  = `${BASE}/3mea-di5p.json`;
const CITES = `${BASE}/ab4h-6ztd.json`;
const SINCE = '2024-06-01T00:00:00';   // ~2 years; keeps it current as fines/patterns shift
const MIN_N = 5;                        // prune blocks with too few tickets to be meaningful

const TYPES = new Set(['ST','STREET','AVE','AVENUE','BLVD','BOULEVARD','RD','ROAD','DR','DRIVE',
  'WAY','LN','LANE','CT','COURT','PL','PLACE','TER','TERRACE','HWY','HIGHWAY','PKWY','CIR','CIRCLE',
  'ALY','ALLEY','PLZ','PLAZA','ROW','PARK','WALK','STPS','STEPS','BLVD.']);

const stripZeros = s => String(s).replace(/^0+(?=\d)/, '');
// "0121 STEINER ST" -> { num:"121", name:"STEINER" }   (drops the type token)
function parseCitationLoc(loc) {
  if (!loc) return null;
  const m = String(loc).trim().toUpperCase().match(/^(\d{1,6})\s+(.+)$/);
  if (!m) return null;
  const parts = m[2].replace(/[.,#].*$/, '').replace(/[^A-Z0-9 ]/g, '').trim().split(/\s+/);
  if (parts.length > 1 && TYPES.has(parts[parts.length - 1])) parts.pop();
  const name = parts.join(' ').trim();
  return name ? { num: stripZeros(m[1]), name } : null;
}
const easKey = (num, name) => `${stripZeros(num)}|${String(name).toUpperCase().trim()}`;

async function getJSON(url, params, tries = 4) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'curb-enforcement-build' } });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      throw new Error(`${r.status} ${await r.text()}`);
    } catch (e) { if (i === tries - 1) throw e; await sleep(1500 * (i + 1)); }
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.error('[enforcement]', ...a);

async function buildAddrMap() {
  log('loading EAS address->cnn map…');
  const map = new Map();
  const PAGE = 50000;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await getJSON(ADDR, {
      '$select': 'address_number,street_name,cnn', '$where': 'cnn IS NOT NULL',
      '$order': ':id', '$limit': PAGE, '$offset': offset,
    });
    rows.forEach(r => { if (r.address_number && r.street_name && r.cnn)
      map.set(easKey(r.address_number, r.street_name), r.cnn); });
    log(`  EAS +${rows.length} (total keys ${map.size})`);
    if (rows.length < PAGE) break;
  }
  return map;
}

async function buildSchedule() {
  log('loading sweeping schedule…');
  const DAY = { sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6 };
  const byCnn = new Map(); // cnn -> Map(dow -> {fromMin,toMin})
  const rows = await getJSON(SWEEP, {
    '$select': 'cnn,weekday,fromhour,tohour', '$where': 'cnn IS NOT NULL', '$limit': 60000,
  });
  rows.forEach(r => {
    const k = r.weekday && DAY[r.weekday.trim().toLowerCase().slice(0,3)];
    const dow = (k === undefined) ? null : k;
    const fromH = parseInt(r.fromhour, 10), toH = parseInt(r.tohour, 10);
    if (dow === null || isNaN(fromH)) return;
    if (!byCnn.has(r.cnn)) byCnn.set(r.cnn, new Map());
    byCnn.get(r.cnn).set(dow, { fromMin: fromH * 60, toMin: (isNaN(toH) ? fromH + 2 : toH) * 60 });
  });
  log(`  schedule: ${byCnn.size} blocks`);
  return byCnn;
}

async function aggregateCitations(addrMap, sched) {
  log('streaming citations (:id cursor)…');
  const acc = new Map();           // `${cnn}|${dow}` -> {n, sum, lo, hi}
  const PAGE = 50000;
  let cursor = '', pages = 0, seen = 0, matched = 0;
  for (;;) {
    const where = `violation_desc in('STR CLEAN','ST CLEANIN') AND citation_issued_datetime > '${SINCE}'`
      + (cursor ? ` AND :id > '${cursor}'` : '');
    const rows = await getJSON(CITES, {
      '$select': ':id,citation_location,citation_issued_datetime',
      '$where': where, '$order': ':id', '$limit': PAGE,
    });
    if (!rows.length) break;
    for (const r of rows) {
      seen++;
      const t = r.citation_issued_datetime; if (!t || t.length < 16) continue;
      // tz-independent: read components straight off the "YYYY-MM-DDThh:mm" string
      const y = +t.slice(0,4), mo = +t.slice(5,7), d = +t.slice(8,10), hh = +t.slice(11,13), mm = +t.slice(14,16);
      if (!y || y > 2026) continue;          // drop typo'd future dates (e.g. 2027-04-23)
      const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
      const minute = hh * 60 + mm;
      const p = parseCitationLoc(r.citation_location); if (!p) continue;
      const cnn = addrMap.get(easKey(p.num, p.name)); if (!cnn) continue;
      const rule = sched.get(cnn) && sched.get(cnn).get(dow); if (!rule) continue; // not a sweep day here
      if (minute < rule.fromMin - 60 || minute > rule.toMin + 120) continue;        // outlier/wrong match
      matched++;
      const key = `${cnn}|${dow}`;
      const a = acc.get(key) || { n: 0, sum: 0, lo: 1440, hi: 0 };
      a.n++; a.sum += minute;
      a.lo = Math.min(a.lo, Math.max(minute, rule.fromMin - 30));
      a.hi = Math.max(a.hi, Math.min(minute, rule.toMin + 60));
      acc.set(key, a);
    }
    pages++;
    cursor = rows[rows.length - 1][':id'];
    log(`  page ${pages}: ${seen} seen, ${matched} matched, ${acc.size} block-days`);
    if (rows.length < PAGE) break;
    if (pages > 80) { log('  WARN: page cap hit — output may be partial'); break; }
  }
  log(`  streamed ${seen} citations, ${matched} matched to a swept block-day`);
  return acc;
}

async function main() {
  const t0 = Date.now();
  const [addrMap, sched] = await Promise.all([buildAddrMap(), buildSchedule()]);
  const acc = await aggregateCitations(addrMap, sched);

  const out = {};
  let blocks = 0, kept = 0, dropped = 0;
  const seenCnn = new Set();
  for (const [key, a] of acc) {
    if (a.n < MIN_N) { dropped++; continue; }
    const [cnn, dow] = key.split('|');
    (out[cnn] = out[cnn] || {})[dow] = [a.n, Math.round(a.sum / a.n), a.lo, a.hi];
    kept++; seenCnn.add(cnn);
  }
  blocks = seenCnn.size;
  out._meta = {
    generated: new Date().toISOString(), window_since: SINCE, min_samples: MIN_N,
    blocks, side_days: kept, dropped_lowsample: dropped,
    source: 'DataSF ab4h-6ztd (citations) ⋈ 3mea-di5p (addresses) ⋈ yhqp-riqs (schedule)',
    note: 'avgMin/loMin/hiMin are local minutes-of-day; dow is JS getDay (0=Sun).',
  };

  const fs = await import('node:fs');
  const url = new URL('../data/enforcement.json', import.meta.url);
  fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  fs.writeFileSync(url, JSON.stringify(out));
  const kb = (fs.statSync(url).size / 1024).toFixed(0);
  log(`done in ${((Date.now()-t0)/1000).toFixed(0)}s — ${blocks} blocks, ${kept} side-days, ${kb}KB`);
}
main().catch(e => { console.error(e); process.exit(1); });
