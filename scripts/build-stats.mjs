#!/usr/bin/env node
// Aggregate SF parking-citation history for the /tickets data story.
//   data/stats.json = { yearly, yearlySweep, byViolation, sweepHour, sweepDow,
//                       hoods, topStreets, _meta }
// Server-side SoQL group-bys where possible; the neighborhood breakdown streams
// ~2yr of street-cleaning rows and joins addresses → EAS analysis_neighborhood.
// Run: npm run build:stats   (Node 18+, no deps; ~6-8 min, mostly the stream)

const CITES = 'https://data.sfgov.org/resource/ab4h-6ztd.json';
const ADDR = 'https://data.sfgov.org/resource/3mea-di5p.json';
const SINCE = '2024-06-01T00:00:00';
const log = (...a) => console.error('[stats]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function soda(base, params, tries = 4) {
  const u = new URL(base);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'curb-stats-build' } });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      throw new Error(`${r.status} ${await r.text()}`);
    } catch (e) { if (i === tries - 1) throw e; await sleep(2000 * (i + 1)); }
  }
}

const SWEEP_WHERE = "violation_desc in('STR CLEAN','ST CLEANIN')";
const YEARS_WHERE = "citation_issued_datetime between '2008-01-01' and '2026-12-31'";

log('yearly totals…');
const yearly = (await soda(CITES, {
  '$select': 'date_extract_y(citation_issued_datetime) as y, count(*) as n, sum(fine_amount) as rev',
  '$where': YEARS_WHERE, '$group': 'y', '$order': 'y',
})).map(r => ({ y: +r.y, n: +r.n, rev: Math.round(+r.rev) }));

log('yearly street-cleaning…');
const yearlySweep = (await soda(CITES, {
  '$select': 'date_extract_y(citation_issued_datetime) as y, count(*) as n, sum(fine_amount) as rev, avg(fine_amount) as avg',
  '$where': `${YEARS_WHERE} AND ${SWEEP_WHERE}`, '$group': 'y', '$order': 'y',
})).map(r => ({ y: +r.y, n: +r.n, rev: Math.round(+r.rev), avg: Math.round(+r.avg * 10) / 10 }));

log('violation breakdown (since 2021)…');
const byViolation = (await soda(CITES, {
  '$select': 'violation_desc as v, count(*) as n, sum(fine_amount) as rev',
  '$where': "citation_issued_datetime >= '2021-01-01'", '$group': 'v', '$order': 'n DESC', '$limit': 14,
})).map(r => ({ v: r.v || 'Other', n: +r.n, rev: Math.round(+r.rev || 0) }));

log('sweep hour/dow histograms (since 2024)…');
const sweepHour = (await soda(CITES, {
  '$select': 'date_extract_hh(citation_issued_datetime) as h, count(*) as n',
  '$where': `${SWEEP_WHERE} AND citation_issued_datetime >= '2024-01-01'`, '$group': 'h', '$order': 'h',
})).map(r => ({ h: +r.h, n: +r.n }));
const sweepDow = (await soda(CITES, {
  '$select': 'date_extract_dow(citation_issued_datetime) as d, count(*) as n',
  '$where': `${SWEEP_WHERE} AND citation_issued_datetime >= '2024-01-01'`, '$group': 'd', '$order': 'd',
})).map(r => ({ d: +r.d, n: +r.n }));

// ---- neighborhood + street breakdown: stream the 2yr sweep rows, join EAS ----
log('loading EAS address → neighborhood map…');
const TYPES = new Set(['ST','STREET','AVE','AVENUE','BLVD','BOULEVARD','RD','ROAD','DR','DRIVE','WAY','LN','LANE',
  'CT','COURT','PL','PLACE','TER','TERRACE','HWY','HIGHWAY','PKWY','CIR','CIRCLE','ALY','ALLEY','PLZ','PLAZA','ROW']);
const stripZeros = s => String(s).replace(/^0+(?=\d)/, '');
function parseLoc(loc) {
  const m = String(loc || '').trim().toUpperCase().match(/^(\d{1,6})\s+(.+)$/);
  if (!m) return null;
  const parts = m[2].replace(/[.,#].*$/, '').replace(/[^A-Z0-9 ]/g, '').trim().split(/\s+/);
  if (parts.length > 1 && TYPES.has(parts[parts.length - 1])) parts.pop();
  const name = parts.join(' ').trim();
  return name ? { num: stripZeros(m[1]), name } : null;
}
const hoodOf = new Map();
{
  const PAGE = 50000;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await soda(ADDR, { '$select': 'address_number,street_name,nhood',
      '$where': 'nhood IS NOT NULL', '$order': ':id', '$limit': PAGE, '$offset': offset });
    rows.forEach(r => hoodOf.set(`${stripZeros(r.address_number)}|${String(r.street_name).toUpperCase().trim()}`, r.nhood));
    log(`  EAS +${rows.length} (${hoodOf.size})`);
    if (rows.length < PAGE) break;
  }
}

log('streaming 2yr street-cleaning rows for hoods/streets…');
// hoods: citywide rollup (n, rev). hoodDetail: per-hood histograms for the neighborhood SEO
// pages (sweep hour/dow distribution, mean minute-of-day, heaviest streets IN that hood).
const hoods = new Map(), streets = new Map(), hoodDetail = new Map();
const newDetail = () => ({ n: 0, rev: 0, minSum: 0, minN: 0, hours: Array(24).fill(0), dows: Array(7).fill(0), streets: new Map() });
let cursor = '', seen = 0;
for (;;) {
  const rows = await soda(CITES, {
    '$select': ':id,citation_location,fine_amount,citation_issued_datetime',
    '$where': `${SWEEP_WHERE} AND citation_issued_datetime > '${SINCE}'` + (cursor ? ` AND :id > '${cursor}'` : ''),
    '$order': ':id', '$limit': 50000,
  });
  if (!rows.length) break;
  for (const r of rows) {
    seen++;
    const p = parseLoc(r.citation_location); if (!p) continue;
    const fine = +r.fine_amount || 0;
    const hood = hoodOf.get(`${p.num}|${p.name}`);
    // citation_issued_datetime is SF local wall time (no offset) — parse the fields directly.
    const m = String(r.citation_issued_datetime || '').match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/);
    const hh = m ? +m[4] : null, mi = m ? +m[5] : null;
    const dow = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : null;
    if (hood) {
      const h = hoods.get(hood) || { n: 0, rev: 0 }; h.n++; h.rev += fine; hoods.set(hood, h);
      const d = hoodDetail.get(hood) || newDetail(); d.n++; d.rev += fine;
      if (hh !== null) { d.hours[hh]++; d.dows[dow]++; d.minSum += hh * 60 + mi; d.minN++; }
      d.streets.set(p.name, (d.streets.get(p.name) || 0) + 1);
      hoodDetail.set(hood, d);
    }
    const s = streets.get(p.name) || { n: 0, rev: 0 }; s.n++; s.rev += fine; streets.set(p.name, s);
  }
  cursor = rows[rows.length - 1][':id'];
  log(`  ${seen} streamed (${hoods.size} hoods)`);
  if (rows.length < 50000) break;
}

// ---- neighborhood surge: same six-month window five years apart (all violation types) ----
// Mirrors SF Standard's June 2026 analysis (Dec-May 2020-21 vs 2025-26, SFMTA citations).
log('neighborhood surge: streaming two six-month windows…');
const SURGE_WINDOWS = [['2020-12-01', '2021-06-01', 'then'], ['2025-12-01', '2026-06-01', 'now']];
const surge = new Map(); // hood -> { then, now }
for (const [a, b, key] of SURGE_WINDOWS) {
  let cur = '', n = 0;
  for (;;) {
    const rows = await soda(CITES, {
      '$select': ':id,citation_location',
      '$where': `citation_issued_datetime >= '${a}' AND citation_issued_datetime < '${b}'`
        + (cur ? ` AND :id > '${cur}'` : ''),
      '$order': ':id', '$limit': 50000,
    });
    if (!rows.length) break;
    for (const r of rows) {
      n++;
      const p = parseLoc(r.citation_location); if (!p) continue;
      const hood = hoodOf.get(`${p.num}|${p.name}`); if (!hood) continue;
      const h = surge.get(hood) || { then: 0, now: 0 }; h[key]++; surge.set(hood, h);
    }
    cur = rows[rows.length - 1][':id'];
    log(`  surge ${key}: ${n}`);
    if (rows.length < 50000) break;
  }
}
const SURGE_MIN = 1000; // under this in either window the % is noise — grayed out, pct null
const hoodSurge = {
  windows: { then: 'Dec 2020 – May 2021', now: 'Dec 2025 – May 2026' }, minN: SURGE_MIN,
  rows: [...surge.entries()].map(([hood, v]) => ({ hood, then: v.then, now: v.now,
    pct: (v.then >= SURGE_MIN && v.now >= SURGE_MIN) ? Math.round((v.now - v.then) / v.then * 100) : null }))
    .sort((p, q) => (q.pct ?? -999) - (p.pct ?? -999)),
};

const out = {
  _meta: { generated: new Date().toISOString(), source: 'DataSF ab4h-6ztd ⋈ 3mea-di5p',
    note: 'rev = fines ISSUED (assessed), not collected. hoods/topStreets = street-cleaning only, last ~2yr.',
    hood_window_since: SINCE },
  yearly, yearlySweep, byViolation, sweepHour, sweepDow, hoodSurge,
  hoods: [...hoods.entries()].map(([k, v]) => ({ hood: k, n: v.n, rev: Math.round(v.rev) }))
    .sort((a, b) => b.n - a.n),
  topStreets: [...streets.entries()].map(([k, v]) => ({ street: k, n: v.n, rev: Math.round(v.rev) }))
    .sort((a, b) => b.n - a.n).slice(0, 25),
  // Per-hood detail for the neighborhood SEO pages (scripts/build-hood-pages.mjs).
  hoodDetail: Object.fromEntries([...hoodDetail.entries()].map(([k, v]) => [k, {
    n: v.n, rev: Math.round(v.rev),
    avgMin: v.minN ? Math.round(v.minSum / v.minN) : null,
    hours: v.hours, dows: v.dows,
    topStreets: [...v.streets.entries()].map(([street, n]) => ({ street, n }))
      .sort((a, b) => b.n - a.n).slice(0, 6),
  }])),
};
const fs = await import('node:fs');
const url = new URL('../data/stats.json', import.meta.url);
fs.writeFileSync(url, JSON.stringify(out));
log(`done — ${(fs.statSync(url).size / 1024).toFixed(0)}KB, ${out.hoods.length} hoods, ${seen} rows streamed`);
