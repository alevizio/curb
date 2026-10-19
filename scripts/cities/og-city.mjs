#!/usr/bin/env node
// Each city's share card (og-<id>.png, 1200x630) from Boston's (og/template-boston.html): the city's name, and the
// sign of its most common posted rule (data/<id>/segments.json), so the card never shows another city's sign.
// Rendered with headless Chrome, like og/render.sh. Run: node scripts/cities/og-city.mjs [id ...] (default: every city in
// lib/city-configs.js)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../../lib/sweep-core.js';
import '../../lib/city-configs.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const template = fs.readFileSync(ROOT + 'og/template-boston.html', 'utf8');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const ORD = ['1ST', '2ND', '3RD', '4TH', '5TH'], MON = ['JAN', 'FEB', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUG', 'SEPT', 'OCT', 'NOV', 'DEC'];
// A rule's hour (8, "9:30") as the clock reads it: 12-hour hour and minutes, and whether it's morning
function clock(v) {
  const h = globalThis.toHours(v), hr = Math.floor(h) % 24, mi = Math.round((h - Math.floor(h)) * 60);
  return { hr, mi, h12: `${(hr % 12) || 12}${mi ? ':' + String(mi).padStart(2, '0') : ''}`, am: hr < 12 };
}
// "8 A.M." / "12 NOON" / "11:30 A.M.", the way signs print hours
function signHour(v) {
  const { hr, mi, h12, am } = clock(v);
  if (hr === 12 && !mi) return '12 <small>NOON</small>';
  if (hr === 0 && !mi) return '12 <small>MIDNIGHT</small>';
  return `${h12} <small>${am ? 'A.M.' : 'P.M.'}</small>`;
}
// "1ST", "1ST &amp; 3RD", "1ST, 2ND &amp; 3RD": the weeks of a monthly rule
function nthWords(weeks) {
  const nth = [0, 1, 2, 3, 4].filter((i) => weeks & (1 << i)).map((i) => ORD[i]);
  return nth.slice(0, -1).join(', ') + (nth.length > 1 ? ' &amp; ' : '') + nth[nth.length - 1];
}

// The sign's season line: "APRIL TO NOV", "NOV TO MARCH", "ODD MONTHS"; '' for all year
function seasonSign(mask) {
  const m = [...Array(12).keys()].filter((i) => mask & (1 << i));
  if (!mask || m.length === 12) return '';
  if (mask === 1365) return 'ODD MONTHS';
  if (mask === 2730) return 'EVEN MONTHS';
  const start = m.find((i) => !m.includes((i + 11) % 12));
  const run = [];
  for (let i = start; start != null && m.includes(i) && run.length < 12; i = (i + 1) % 12) run.push(i);
  return run.length === m.length ? `${MON[start]} TO ${MON[run[run.length - 1]]}` : m.map((i) => MON[i]).join(', ');
}

// The plate's lines stay on one line: past what fits (Boston's own lines), the type shrinks instead of wrapping.
const fit = (text, fits, px, spaced) => (text.length <= fits ? ''
  : ` style="white-space:nowrap;font-size:${(px * fits / text.length).toFixed(1)}px${spaced ? ';letter-spacing:.06em' : ''}"`);

function card(id) {
  const c = JSON.parse(fs.readFileSync(`${ROOT}data/${id}/city.json`, 'utf8'));
  const data = JSON.parse(fs.readFileSync(`${ROOT}data/${id}/segments.json`, 'utf8'));
  // The sign: the most common window (hours, weeks, season), counted once per side however many weekdays it runs, so a
  // nightly arterial (seven rules) can't outweigh a residential 1st & 3rd; then its most common weekday, or DAILY. A
  // winter rule (flag 4, Madison's alternate side parking) is no posted sweeping sign: left out.
  const tally = new Map(), dows = new Map(), dateDays = [0, 0, 0, 0, 0, 0, 0];
  for (const b of data.b) for (const [, , rules] of b.d) {
    const bySide = new Map();
    for (const r of rules) {
      if (r[5] & 4) continue;
      const k = JSON.stringify(r[0] === -1 ? [-1, r[1], r[2], 0, 0, r[5]] : [0, r[1], r[2], r[3], r[4], r[5]]);
      if (!bySide.has(k)) bySide.set(k, new Set());
      bySide.get(k).add(r[0]);
      if (r[0] === -1 && Array.isArray(r[6])) for (const iso of r[6]) dateDays[new Date(iso + 'T12:00:00Z').getUTCDay()]++;
    }
    for (const [k, set] of bySide) {
      tally.set(k, (tally.get(k) || 0) + 1);
      const days = set.size === 7 ? ['DAILY'] : set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d)) ? ['MON TO FRI'] : [...set];
      const m = dows.get(k) || new Map();
      for (const d of days) m.set(d, (m.get(d) || 0) + 1);
      dows.set(k, m);
    }
  }
  // A city whose every rule switches sides (Milwaukee's night parking) has no sweeping sign: its card says alternate side
  // nights, and the plate says tonight's side.
  const what = (c.words && c.words.what) || 'street sweeping', sweeps = what === 'street sweeping';
  const alt = !tally.size && data.b.flatMap((b) => b.d.flatMap(([, , rules]) => rules)).find((r) => r[5] & 4);
  if (!tally.size && !alt) throw new Error(`og-city ${id}: no rule to put on the card`);
  const top = alt ? null : [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const [kind, from, to, weeks, months, flags] = alt ? alt.slice(0, 6) : JSON.parse(top);
  // a weekday (0-6), DAILY or MON TO FRI, or -1 for listed dates
  const dow = alt || kind === -1 ? -1 : [...dows.get(top).entries()].sort((a, b) => b[1] - a[1])[0][0];
  const days = alt ? 'ODD &amp; EVEN DATES' : dow === -1 ? 'ON POSTED DATES' : typeof dow === 'string' ? dow : weeks === 31 ? 'EVERY ' + DAYS[dow] : nthWords(weeks) + ' ' + DAYS[dow];
  const season = alt ? (c.winter && c.winter.permit ? 'NIGHT PERMIT NEEDED' : '') : seasonSign(months);
  const plateDow = dow === -1 ? dateDays.indexOf(Math.max(...dateDays)) : typeof dow === 'string' ? 1 : dow;
  const plateDay = DAYS[plateDow].slice(0, 1) + DAYS[plateDow].slice(1, 3).toLowerCase();
  const start = clock(from), plateTime = `${start.h12} ${start.am ? 'am' : 'pm'}`;
  const plate = alt ? 'Odd side <em>tonight</em>' : `Park until <em>${esc(plateDay)} ${plateTime}</em>`;
  const name = c.name, size = name.length <= 8 ? 80 : name.length <= 12 ? 72 : 62;
  let out = template
    .replace(/<!-- Boston share card[\s\S]*?-->\n/, `<!-- GENERATED by scripts/cities/og-city.mjs from og/template-boston.html: the ${esc(name)} card (og-${id}.png). -->\n`)
    .replace('<h1 style="font-size:80px">Know where to<br>park in Boston<span class="hl">.</span></h1>',
      `<h1 style="font-size:${size}px">Know where to<br>park in ${esc(name)}<span class="hl">.</span></h1>`)
    .replace('<p class="sub">Boston street sweeping, block by block: every curb by its next sweep, with alerts.</p>',
      `<p class="sub">${esc(name)} ${sweeps ? 'street sweeping, block by block: every curb by its next sweep' : `${esc(what)}, block by block: tonight's side of every curb`}, with alerts.</p>`)
    .replace('<u>curb<i>.</i>guide/boston</u> · <b>from Boston open data</b>', `<u>curb<i>.</i>guide/${id}</u> · <b>from ${esc(name)} open data</b>`)
    .replace(/aria-label="A Boston street cleaning sign[^"]*"/, `aria-label="A ${esc(name)} ${sweeps ? 'street cleaning' : 'parking'} sign and a CURB plate"`)
    .replace('<div class="s-what">STREET CLEANING</div>', `<div class="s-what">${alt ? 'ALTERNATE SIDE' : 'STREET CLEANING'}</div>`)
    .replace('<div class="s-days">2ND &amp; 4TH MONDAY</div>', `<div class="s-days">${days}</div>`)
    .replace('<div class="s-time">8 <small>A.M.</small> <span class="to">to</span> 12 <small>NOON</small></div>',
      `<div class="s-time">${signHour(from)} <span class="to">to</span> ${signHour(to)}</div>`)
    .replace('<div class="s-sub">APRIL 1 TO NOV 30</div>', season ? `<div class="s-sub">${season}</div>` : '')
    .replace('<div class="s-tow">TOW ZONE</div>', flags & 2 ? '<div class="s-tow">TOW ZONE</div>' : '')
    .replace('<div class="t">Park until <em>Mon 8 am</em></div>', `<div class="t"${fit(plate.replace(/<[^>]+>/g, ''), 19, 19)}>${plate}</div>`)
    .replace('<div class="s">curb.guide/boston</div>', `<div class="s"${fit(`curb.guide/${id}`, 17, 11, true)}>curb.guide/${id}</div>`);
  if (/Boston/.test(out.replace(/template-boston/g, ''))) throw new Error(`og-city ${id}: the card still says Boston`);
  const tmp = `${ROOT}og/.card-${id}.html`;
  fs.writeFileSync(tmp, out);
  try {
    execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', '--window-size=1200,630', '--force-device-scale-factor=1',
      '--virtual-time-budget=8000', `--screenshot=${ROOT}og-${id}.png`, `file://${tmp}`], { stdio: 'ignore' });
  } finally { fs.rmSync(tmp, { force: true }); }
  return `${days} ${from}-${to}${season ? ' ' + season : ''}`;
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(globalThis.CITY_CONFIGS);
for (const id of ids) console.error(`[og-city] og-${id}.png: ${card(id)}`);
