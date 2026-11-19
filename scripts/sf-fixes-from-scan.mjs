#!/usr/bin/env node
// Turns the high confidence sides of scripts/scan-sf-ticket-days.mjs (private/sf-ticket-scan.json) into lib/sf-fixes.js
// entries, written between its "scan:start" and "scan:end" lines. `was` is read from DataSF right now, every row of the
// side including its Holiday row, so a fix matches the City's rows exactly; `now` is the scan's proposal plus that
// Holiday row unchanged. Sides already fixed by hand above the markers are left alone.
//
// Run: node scripts/sf-fixes-from-scan.mjs   (Node 18+, no deps; after the scan)
import { readFileSync, writeFileSync } from 'node:fs';
import '../lib/sf-fixes.js';

const ROOT = new URL('../', import.meta.url);
const LIB = new URL('lib/sf-fixes.js', ROOT);
const SWEEP = 'https://data.sf.gov/resource/yhqp-riqs.json';
const log = (...a) => console.error('[sf-fixes]', ...a);

const scan = JSON.parse(readFileSync(new URL('private/sf-ticket-scan.json', ROOT), 'utf8'));
const src = readFileSync(LIB, 'utf8');
const START = src.indexOf('    // scan:start');
const END = src.indexOf('    // scan:end');
if (START < 0 || END < START) throw new Error('scan:start / scan:end markers missing in lib/sf-fixes.js');
const head = src.slice(0, src.indexOf('\n', START) + 1);
const byHand = new Set(globalThis.SF_SWEEP_FIXES.filter((f) => src.indexOf(`cnn: '${f.cnn}'`) < START).map((f) => f.cnn + '|' + f.side));

const sides = scan.sides.filter((s) => s.confidence === 'high' && !byHand.has(s.cnn + '|' + s.blockside));
const cnns = [...new Set(sides.map((s) => s.cnn))];
const live = [];
for (let i = 0; i < cnns.length; i += 100) {
  const u = new URL(SWEEP);
  u.searchParams.set('$select', 'cnn,blockside,weekday,fromhour,tohour,week1,week2,week3,week4,week5');
  u.searchParams.set('$where', `cnn in(${cnns.slice(i, i + 100).map((c) => `'${c}'`).join(',')})`);
  u.searchParams.set('$limit', '5000');
  const r = await fetch(u, { headers: { 'User-Agent': 'curb-sf-fixes-build' } });
  if (!r.ok) throw new Error('DataSF ' + r.status);
  live.push(...await r.json());
}

const weeks = (r) => ['week1', 'week2', 'week3', 'week4', 'week5'].map((k) => r[k]).join('');
const row = (weekday, from, to, w) => `['${weekday}', ${+from}, ${+to}, '${w}']`;
const plain = (s) => String(s).replace(/'/g, '’');
const lines = [];
for (const s of sides) {
  const cur = live.filter((r) => r.cnn === s.cnn && r.blockside === s.blockside);
  const hol = cur.filter((r) => /^hol/i.test(r.weekday));
  const scanWeekly = s.city_rows.map((c) => row(c.weekday, c.fromhour, c.tohour, c.weeks)).sort().join();
  const liveWeekly = cur.filter((r) => !/^hol/i.test(r.weekday)).map((r) => row(r.weekday, r.fromhour, r.tohour, weeks(r))).sort().join();
  if (scanWeekly !== liveWeekly) { log(`skip ${s.street} ${s.from} to ${s.to} ${s.blockside}: the City's rows changed since the scan`); continue; }
  const was = cur.map((r) => row(r.weekday, r.fromhour, r.tohour, weeks(r)));
  const now = [...s.proposed.map((p) => row(p.weekday, p.fromhour, p.tohour, p.weeks)), ...hol.map((r) => row(r.weekday, r.fromhour, r.tohour, weeks(r)))];
  const lr = cur.length ? '' : `, lr: '${s.side}'`;
  const why = plain(`${s.street}, ${s.from} to ${s.to}: City ${s.city_says}; tickets ${s.tickets_say} (scan ${scan._meta.since} to ${scan._meta.until}, ${s.kind.join(', ')})`);
  lines.push(`    { cnn: '${s.cnn}', side: '${s.blockside}'${lr}, was: [${was.join(', ')}], now: [${now.join(', ')}],\n      why: '${why}' },`);
}
writeFileSync(LIB, head + lines.join('\n') + (lines.length ? '\n' : '') + src.slice(END));
log(`${lines.length} fixes written from ${sides.length} high confidence sides (${byHand.size} fixed by hand)`);
