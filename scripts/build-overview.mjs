#!/usr/bin/env node
// Citywide overview layer for CURB: every swept block reduced to its centerline
// ENDPOINTS plus condensed sweep rules, so the client can draw the whole city at
// low zoom (canvas) and color it live with the same clear/soon/now logic.
//
//   data/overview.json = { "_meta": {...}, "b": [ [lng1,lat1,lng2,lat2, [[dow,fromH,toH,weeksMask],...]], ... ] }
//   (coords 5-decimal; weeksMask bit i = week i+1 active; dow is JS getDay 0-6)
//
// Run: npm run build:overview   (Node 18+, no deps)

const SWEEP = 'https://data.sfgov.org/resource/yhqp-riqs.json';
const DAY = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };
const log = (...a) => console.error('[overview]', ...a);

async function fetchAll() {
  const PAGE = 20000, rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const u = new URL(SWEEP);
    u.searchParams.set('$select', 'cnn,weekday,fromhour,tohour,week1,week2,week3,week4,week5,line');
    u.searchParams.set('$order', 'cnn');
    u.searchParams.set('$limit', PAGE);
    u.searchParams.set('$offset', offset);
    const r = await fetch(u, { headers: { 'User-Agent': 'curb-overview-build' } });
    if (!r.ok) throw new Error('fetch ' + r.status);
    const page = await r.json();
    rows.push(...page);
    log(`  +${page.length} rows (${rows.length})`);
    if (page.length < PAGE) break;
  }
  return rows;
}

function main(rows) {
  const byCnn = new Map();
  rows.forEach(r => {
    const dow = r.weekday && DAY[r.weekday.trim().toLowerCase().slice(0, 3)];
    const fromH = parseInt(r.fromhour, 10);
    if (dow === undefined || dow === null || isNaN(fromH)) return;
    let toH = parseInt(r.tohour, 10); if (isNaN(toH)) toH = fromH + 2;
    let mask = 0;
    [r.week1, r.week2, r.week3, r.week4, r.week5].forEach((w, i) => { if (String(w) === '1') mask |= 1 << i; });
    let e = byCnn.get(r.cnn);
    if (!e) {
      const c = r.line && r.line.coordinates;
      if (!c || c.length < 2) return;
      const f = c[0], l = c[c.length - 1];
      e = { ends: [f[0], f[1], l[0], l[1]].map(v => +v.toFixed(5)), rules: new Map() };
      byCnn.set(r.cnn, e);
    }
    e.rules.set(`${dow}|${fromH}|${toH}|${mask}`, [dow, fromH, toH, mask]);
  });
  const blocks = [];
  for (const e of byCnn.values()) blocks.push([...e.ends, [...e.rules.values()]]);
  return blocks;
}

const rows = await fetchAll();
log(`condensing ${rows.length} rows…`);
const blocks = main(rows);
const out = {
  _meta: { generated: new Date().toISOString(), blocks: blocks.length,
    note: 'endpoints-only centerlines + [dow,fromH,toH,weeksMask] rules; colored client-side' },
  b: blocks,
};
const fs = await import('node:fs');
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const url = new URL('../data/overview.json', import.meta.url);
fs.writeFileSync(url, JSON.stringify(out));
log(`done — ${blocks.length} blocks, ${(fs.statSync(url).size / 1024).toFixed(0)}KB`);
