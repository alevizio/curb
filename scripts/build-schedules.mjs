#!/usr/bin/env node
// Bake every currently swept block's schedule into data/schedules.json, so the /b/<cnn> pages
// (api/block.js) and the /n/ block lists never call DataSF at request time — a DataSF outage or
// host move (Sep 2026: 18 days of /b/ pages 302ing home) can no longer take the pages down.
//
//   data/schedules.json = { _meta, hoods: [[name, slug, hasPage], ...], b: { <cnn>: entry } }
//   entry = [street, from, to, hoodIdx, rows, prev, next, tag, modified, range]
//     street/from/to  cleaned DataSF text ('' = no usable cross street)
//     hoodIdx         index into hoods (-1 = outside every neighborhood polygon)
//     rows            [[side, dow, fromH, toH, weeksMask, holidays], ...]  side '' = no blockside;
//                     dow = JS getDay; weeksMask bit i = week i+1; holidays 1 = sweeps through most
//     prev/next       adjacent swept block on the same street (shared endpoint), '' if none
//     tag             label (side, roadway, address range…) that tells apart blocks sharing
//                     street + cross streets ('' if unique)
//     modified        YYYY-MM-DD this entry last changed (carried over from the previous file) —
//                     the real <lastmod> for sitemap-blocks.xml
//     range           [lo, hi] house numbers on the block (EAS addresses), [] if none
//
// Street text is cleaned here, once: "09th Ave" zero padding, "Start: 01-99 Block" placeholders,
// the same street at both ends, and cross streets with their first letters clipped ("ission Bay
// Blvd") repaired against every street name in the dataset.
//
// Run: npm run build:schedules   (Node 18+, no deps; after build:stats — reads data/stats.json)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { toHood, hoodAt } from './build-hood-maps.mjs';
import { slug, pagedHoods } from '../lib/hoods.js';

const ROOT = new URL('../', import.meta.url);
const SWEEP = 'https://data.sf.gov/resource/yhqp-riqs.json';
const ADDR = 'https://data.sf.gov/resource/3mea-di5p.json'; // EAS addresses, cnn keys match SWEEP
const PAGE = 10000;
const DAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const log = (...a) => console.error('[schedules]', ...a);

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const unpad = (s) => s.replace(/\b0+(\d+(?:st|nd|rd|th))\b/gi, '$1'); // "09th Ave" → "9th Ave"
const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
export const cleanStreet = (s) => unpad(squash(s));

// Split DataSF `limits` ("Pine St  -  California St") into its two raw ends.
export function splitLimits(limits) {
  const l = squash(limits);
  if (/^b?lock of \d+ - \d+$/i.test(l)) return ['', '']; // "Block Of 701 - 749": an address range, no streets
  const parts = l.split(/\s+-\s+/);
  return [parts[0] || '', parts[1] || ''];
}

// Every well-formed street name in the dataset (corridors + cross streets that aren't clipped).
export function knownNames(rows) {
  const k = new Set();
  for (const r of rows) {
    k.add(cleanStreet(r.corridor));
    for (const p of splitLimits(r.limits)) {
      const c = unpad(squash(p.split('\\')[0]));
      if (/^[A-Z0-9]/.test(c) && /[a-z]/.test(c) && !/^(start|end):/i.test(c)) k.add(c);
    }
  }
  k.delete('');
  return k;
}

// One cross street: '' for placeholders, first street of a "A \ B \ C" corner, zero padding off,
// ALL CAPS re-cased, and clipped leading letters restored from a known name — preferring names
// already used on this street (context), then names sharing a first word with one ("erry St" on
// Berry Extension St is Berry St, not Perry St), then the smallest repair.
export function cleanEnd(raw, known, context = new Set()) {
  let p = squash(raw);
  if (!p || /^(start|end):/i.test(p) || /^e?nd$/i.test(p)) return '';
  p = unpad(squash(p.split('\\')[0]));
  const caps = !/[a-z]/.test(p);
  if (caps) p = titleCase(p);
  if (known.has(p)) return p;
  if (!/^[a-z]/.test(p) && !caps) return p;
  const lp = p.toLowerCase();
  const kin = new Set([...context].map((n) => n.split(' ')[0]));
  let best = null;
  for (const k of known) {
    for (let d = 1; d <= 3 && d < k.length; d++) {
      const tail = k.slice(d).toLowerCase();
      if (lp !== tail && !lp.startsWith(tail + ' ')) continue;
      const score = (context.has(k) ? 0 : kin.has(k.split(' ')[0]) ? 5 : 10) + d;
      if (!best || score < best.score) best = { score, fixed: k + p.slice(tail.length) };
    }
  }
  return best ? best.fixed : p;
}

// [from, to] for one block, with the street itself and repeated ends dropped.
export function cleanLimits(street, limits, known, context) {
  let [a, b] = splitLimits(limits).map((p) => cleanEnd(p, known, context));
  if (a === street) a = '';
  if (b === street || b === a) b = '';
  if (!a && b) [a, b] = [b, ''];
  return [a, b];
}

const SIDE = { north: 'North', south: 'South', east: 'East', west: 'West', northeast: 'Northeast', northwest: 'Northwest', southeast: 'Southeast', southwest: 'Southwest' };
const sideName = (s) => SIDE[String(s || '').toLowerCase()] || '';
export const sideLabel = (sides) => sides.length ? sides.join(' & ').toLowerCase() + (sides.length > 1 ? ' sides' : ' side') : '';

// Adjacent block at each end of every block: another block of the same street sharing an endpoint
// (twin cnns on the same centerline — x101/x201 — are the same stretch, not a neighbor). Prefers the
// same carriageway family (x1xx ↔ x1xx), then the lowest cnn.
export function neighbors(blocks) {
  const key = (p) => p[0].toFixed(5) + ',' + p[1].toFixed(5);
  const at = new Map();
  for (const b of blocks) {
    if (!b.ends) continue;
    b.seg = b.ends.map(key).sort().join('|');
    for (const e of b.ends) {
      const k = b.street + '|' + key(e);
      (at.get(k) || at.set(k, []).get(k)).push(b);
    }
  }
  const fam = (c) => Math.floor((+c % 1000) / 100);
  const out = new Map();
  for (const b of blocks) {
    if (!b.ends) { out.set(b.cnn, ['', '']); continue; }
    out.set(b.cnn, b.ends.map((e) => {
      const cands = (at.get(b.street + '|' + key(e)) || []).filter((o) => o.seg !== b.seg);
      cands.sort((x, y) => (fam(x.cnn) !== fam(b.cnn)) - (fam(y.cnn) !== fam(b.cnn)) || +x.cnn - +y.cnn);
      return cands.length ? cands[0].cnn : '';
    }));
  }
  return out;
}

// Group raw DataSF rows into cleaned blocks (without hood/neighbors/modified).
export function buildBlocks(rows) {
  const known = knownNames(rows);
  const byCnn = new Map();
  for (const r of rows) {
    const cnn = String(r.cnn || '').split('.')[0];
    const dow = DAY[String(r.weekday || '').trim().toLowerCase().slice(0, 3)];
    const fromH = parseInt(r.fromhour, 10);
    // digits only: api/block.js serves nothing else, and the cnn lands unescaped in /n/ page hrefs
    if (!/^\d{1,9}$/.test(cnn) || dow === undefined || isNaN(fromH)) continue;
    let toH = parseInt(r.tohour, 10); if (isNaN(toH)) toH = fromH + 2;
    let mask = 0;
    [r.week1, r.week2, r.week3, r.week4, r.week5].forEach((w, i) => { if (String(w) === '1') mask |= 1 << i; });
    let b = byCnn.get(cnn);
    if (!b) {
      const c = r.line && r.line.coordinates;
      b = { cnn, street: cleanStreet(r.corridor), limits: r.limits || '', rows: new Map(),
        line: c && c.length >= 2 ? c : null, ends: c && c.length >= 2 ? [c[0], c[c.length - 1]] : null };
      byCnn.set(cnn, b);
    }
    const row = [sideName(r.blockside), dow, fromH, toH, mask, String(r.holidays) === '1' ? 1 : 0];
    b.rows.set(row.join('|'), row);
  }
  const blocks = [...byCnn.values()];
  // context = every cross street already spelled right on the same street
  const ctx = new Map();
  for (const b of blocks) {
    const s = ctx.get(b.street) || ctx.set(b.street, new Set([b.street])).get(b.street);
    for (const p of splitLimits(b.limits)) {
      let c = unpad(squash(p.split('\\')[0]));
      if (!/[a-z]/.test(c)) c = titleCase(c); // "NAYLOR ST" next door tells "AYLOR ST" apart from Taylor St
      if (known.has(c)) s.add(c);
    }
  }
  for (const b of blocks) {
    [b.a, b.b] = cleanLimits(b.street, b.limits, known, ctx.get(b.street));
    b.rows = [...b.rows.values()].sort((x, y) => ((x[1] + 6) % 7) - ((y[1] + 6) % 7) || x[2] - y[2] || x[0].localeCompare(y[0]));
    b.sides = [...new Set(b.rows.map((r) => r[0]).filter(Boolean))].sort();
  }
  // tags: blocks that would share a title (divided roads' two halves, repeated cross streets) get
  // the first label that tells every one apart: curb side, roadway (twin cnns of one segment),
  // address range, compass position, else a number
  const groups = new Map();
  for (const b of blocks) { const k = [b.street, b.a, b.b].join('|'); (groups.get(k) || groups.set(k, []).get(k)).push(b); }
  for (const g of groups.values()) {
    for (const b of g) b.tag = '';
    if (g.length < 2) continue;
    g.sort((x, y) => +x.cnn - +y.cnn);
    const twins = new Set(g.map((b) => Math.floor(+b.cnn / 1000))).size === 1;
    const labels = [g.map((b) => sideLabel(b.sides)), twins ? compass(g, 'roadway') : [], g.map((b) => blockRange(b.limits)), compass(g, 'part')]
      .find((ls) => ls.length && ls.every(Boolean) && new Set(ls).size === g.length) || g.map((_, i) => `part ${i + 1} of ${g.length}`);
    g.forEach((b, i) => { b.tag = labels[i]; });
  }
  return blocks;
}

// "Start: 01-99 Block" / "Block Of 701 - 749" → "1–99 block" ('' if the limits carry no range)
export function blockRange(limits) {
  const m = squash(limits).match(/(?:start|end):\s*(\d+)-(\d+) block|b?lock of (\d+) - (\d+)/i);
  return m ? `${+(m[1] || m[3])} to ${+(m[2] || m[4])} block` : '';
}

// Name each block by where its centerline sits relative to the group's: a divided road's twin
// roadways ("north roadway"), or the pieces of a loop ("west part"). '' when two share one line.
const COMPASS = ['east', 'northeast', 'north', 'northwest', 'west', 'southwest', 'south', 'southeast'];
export function compass(g, noun) {
  const mids = g.map((b) => {
    const c = b.line || b.ends || [];
    return c.length ? [c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length] : null;
  });
  if (mids.some((m) => !m)) return g.map(() => '');
  const cx = mids.reduce((s, m) => s + m[0], 0) / mids.length, cy = mids.reduce((s, m) => s + m[1], 0) / mids.length;
  return mids.map(([x, y]) => {
    const dx = (x - cx) * Math.cos((cy * Math.PI) / 180) * 111320, dy = (y - cy) * 111320; // meters
    if (Math.hypot(dx, dy) < 2) return '';
    return COMPASS[Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) / 45) % 8] + ' ' + noun;
  });
}

// House-number range per cnn: the same EAS min/max the app's block sheet shows (index.html
// loadRanges), minus address number 0: EAS's no-number placeholder, which made "0 to 2655 Balboa St".
export function parseRanges(rows) {
  const out = new Map();
  for (const r of rows) {
    const cnn = String(r.cnn || '').split('.')[0], lo = +r.lo, hi = +r.hi;
    if (/^\d{1,9}$/.test(cnn) && lo > 0 && hi >= lo) out.set(cnn, [lo, hi]);
  }
  return out;
}

// Does a block's page data match the previous bake? (hood compared by name, modified ignored.) An
// entry baked before the range field existed is compared without it, so adding the field doesn't
// move every block's lastmod.
export function samePage(old, oldHood, entry, hood, range) {
  return !!old && JSON.stringify([...old.slice(0, 3), oldHood ?? null, ...old.slice(4, 8)]) ===
    JSON.stringify([...entry.slice(0, 3), hood ?? null, ...entry.slice(4, 8)]) &&
    (old.length < 10 || JSON.stringify(old[9]) === JSON.stringify(range));
}

async function fetchRanges() {
  const u = new URL(ADDR);
  u.searchParams.set('$select', 'cnn,min(address_number) as lo,max(address_number) as hi');
  u.searchParams.set('$where', 'address_number > 0');
  u.searchParams.set('$group', 'cnn');
  u.searchParams.set('$order', 'cnn');
  u.searchParams.set('$limit', 50000); // ~13k cnns: one page
  const r = await fetch(u, { headers: { 'User-Agent': 'curb-schedules-build' } });
  if (!r.ok) throw new Error('fetch ranges ' + r.status);
  const rows = await r.json();
  if (rows.length >= 50000) throw new Error('ranges truncated at ' + rows.length);
  log(`  ${rows.length} cnns with addresses`);
  return parseRanges(rows);
}

async function fetchAll() {
  const rows = [];
  let last = '';
  for (;;) {
    const u = new URL(SWEEP);
    u.searchParams.set('$select', ':id,cnn,corridor,limits,blockside,weekday,fromhour,tohour,week1,week2,week3,week4,week5,holidays,line');
    u.searchParams.set('$order', ':id');
    if (last) u.searchParams.set('$where', `:id > '${last}'`); // :id cursor, not deep $offset (CLAUDE.md)
    u.searchParams.set('$limit', PAGE);
    const r = await fetch(u, { headers: { 'User-Agent': 'curb-schedules-build' } });
    if (!r.ok) throw new Error('fetch ' + r.status);
    const page = await r.json();
    rows.push(...page);
    log(`  +${page.length} rows (${rows.length})`);
    if (page.length < PAGE) break;
    last = page[page.length - 1][':id'];
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const OUT = new URL('data/schedules.json', ROOT);
  const rows = await fetchAll();
  const ranges = await fetchRanges();
  const blocks = buildBlocks(rows);

  // neighborhood per block (midpoint of its centerline), flagged when it has a /n/ page
  const gj = JSON.parse(readFileSync(new URL('data/neighborhoods.geojson', ROOT), 'utf8'));
  const polys = gj.features.map(toHood);
  const stats = JSON.parse(readFileSync(new URL('data/stats.json', ROOT), 'utf8'));
  const paged = new Set(pagedHoods(stats).map((h) => slug(h.hood)));
  const names = polys.map((h) => h.name).sort();
  const hoods = names.map((n) => [n, slug(n), paged.has(slug(n)) ? 1 : 0]);
  const hoodIdx = new Map(names.map((n, i) => [n, i]));
  const adj = neighbors(blocks);

  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  const prevHoods = prev ? prev.hoods.map((h) => h[0]) : [];
  const today = new Date().toISOString().slice(0, 10);
  const b = {};
  let changed = 0;
  for (const x of blocks.sort((p, q) => +p.cnn - +q.cnn)) {
    const e = x.ends;
    const hood = e ? hoodAt((e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2, polys) : null;
    const entry = [x.street, x.a, x.b, hood ? hoodIdx.get(hood) : -1, x.rows, ...adj.get(x.cnn), x.tag];
    const range = ranges.get(x.cnn) || [];
    // carry the previous modified date when nothing on the page's data changed
    const old = prev && prev.b[x.cnn];
    const same = samePage(old, old && prevHoods[old[3]], entry, hood, range);
    if (!same) changed++;
    b[x.cnn] = [...entry, same ? old[8] : today, range];
  }
  const out = {
    _meta: { generated: new Date().toISOString(), source: 'DataSF yhqp-riqs (street sweeping schedule) + 3mea-di5p (EAS addresses, house-number ranges)', rows: rows.length, blocks: blocks.length, changed,
      note: 'entry = [street, from, to, hoodIdx, rows[[side,dow,fromH,toH,weeksMask,holidays]], prev, next, tag, modified, range[lo,hi]]' },
    hoods,
    b,
  };
  writeFileSync(OUT, JSON.stringify(out));
  const noHood = blocks.length - Object.values(b).filter((x) => x[3] >= 0).length;
  log(`wrote data/schedules.json — ${blocks.length} blocks from ${rows.length} rows; ${changed} new/changed; ${noHood} outside every neighborhood`);
}
