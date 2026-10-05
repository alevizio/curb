// /b/<cnn> — server-rendered page for one block (vercel.json rewrites here).
// Social bots don't execute JS, so the OG meta and the card itself are rendered
// server-side; humans get a signage-styled summary + a deep link into the live map.
//
// Everything comes from baked files (data/schedules.json via scripts/build-schedules.mjs, plus the
// enforcement + DPW route files) — no DataSF call at request time, so a DataSF outage or host move
// can't take the pages down (Sep 2026: 18 days of every /b/ page 302ing home). An unknown cnn is a
// real 404; any internal failure is a 503 + Retry-After + no-store, which crawlers retry instead of
// reading as "this page is gone".
import { createRequire } from 'node:module';
import '../lib/sweep-core.js'; // side effect: SF time core on globalThis
const require = createRequire(import.meta.url);
const { sfTodayParts, sfWallToInstant, sweepSuspended, sweepDayWords, HOLIDAY_DOW } = globalThis;

const FINE = 105; // current SF street-cleaning fine (2026), same as the /n/ pages
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYLBL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORD = ['1st', '2nd', '3rd', '4th', '5th'];
const monFirst = (d) => (d === HOLIDAY_DOW ? 7 : (d + 6) % 7); // the app's day chips run Mon → Sun; the holiday schedule last
// A baked row with dow 7 is the side's posted holiday schedule ("HOLIDAYS 4 TO 6AM", DataSF weekday 'Holiday'):
// it sweeps on minor holidays only, while the weekday rows stop (lib/sweep-core.js sweepSuspended).
const isHol = (r) => r[1] === HOLIDAY_DOW;
const weekly = (rows) => rows.filter((r) => !isHol(r));
const ruleOf = (dow) => ({ weekday: dow === HOLIDAY_DOW ? 'Holiday' : DAYLBL[dow] });

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// JSON-LD safe inside <script>: \u-escape the delimiters (same as build-hood-pages.mjs)
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const h12 = (h) => h % 12 || 12;
const ap = (h) => (h % 24 >= 12 ? 'pm' : 'am');
const win = (f, t) => (ap(f) === ap(t) ? `${h12(f)} to ${h12(t)}${ap(t)}` : `${h12(f)}${ap(f)} to ${h12(t)}${ap(t)}`);
const fmtMin = m => { let h = Math.floor(m / 60), mm = m % 60; const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}:${String(mm).padStart(2, '0')}${a}`; };
const weeksOf = (mask) => ORD.filter((_, i) => (mask >> i) & 1);
const andList = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
// "Pine St" → "Pine" for titles (the street type is noise once the street is named)
const shortSt = (s) => s.replace(/\s+(St|Ave|Blvd|Dr|Way|Ter|Ct|Pl|Ln|Aly|Rd|Cir|Plz|Hwy|Pkwy)$/, '');
// consecutive runs of 3+ days collapse to a range ("Mon–Fri"); dows arrive Mon-first
function dayRuns(dows, names, sep) {
  const out = [];
  for (let i = 0; i < dows.length;) {
    let j = i;
    while (j + 1 < dows.length && monFirst(dows[j + 1]) === monFirst(dows[j]) + 1) j++;
    if (j - i >= 2) out.push(names[dows[i]] + sep + names[dows[j]]);
    else for (let k = i; k <= j; k++) out.push(names[dows[k]]);
    i = j + 1;
  }
  return out;
}
// DataSF sometimes splits one side's weekly sweep over two rows (weeks 1,3,5 + weeks 2,4): OR the week
// flags per side/day/window so the page never states the same sweep twice.
function normRows(rows) {
  const m = new Map();
  for (const [side, dow, from, to, mask] of rows) { const k = [side, dow, from, to].join('|'); m.set(k, (m.get(k) || 0) | mask); }
  return [...m].map(([k, mask]) => { const [side, dow, from, to] = k.split('|'); return [side, +dow, +from, +to, mask]; });
}
// rows → [{ dows, from, to, mask, side }] with identical windows merged (across days, and sides unless bySide)
function windows(rows, bySide) {
  const m = new Map();
  for (const [side, dow, from, to, mask] of normRows(rows)) {
    const k = [bySide ? side : '', from, to, mask].join('|');
    const w = m.get(k) || m.set(k, { dows: [], from, to, mask, side }).get(k);
    if (!w.dows.includes(dow)) w.dows.push(dow);
  }
  return [...m.values()].map((w) => ({ ...w, dows: w.dows.sort((a, b) => monFirst(a) - monFirst(b)) }))
    .sort((a, b) => monFirst(a.dows[0]) - monFirst(b.dows[0]) || a.from - b.from);
}

const place = ([street, a, b]) => (a && b ? `${street} between ${a} and ${b}` : a ? `${street} at ${a}` : street);
const label = (e) => place(e) + (e[7] ? `, ${e[7]}` : '');
// "2900 to 2949 " — the block's house numbers as the app's sheet shows them ('' if none baked): drivers
// know the number they parked at, not the cross streets
const nums = (r) => (r && r.length ? (r[0] === r[1] ? `${r[0]} ` : `${r[0]} to ${r[1]} `) : '');

// Under 60 chars (Google cuts ~60): keep the keyword + "SF", shed words before meaning.
const ABBR = { north: 'N', south: 'S', east: 'E', west: 'W', northeast: 'NE', northwest: 'NW', southeast: 'SE', southwest: 'SW' };
export function titleFor(e) {
  const [street, a, b, , , , , tag] = e;
  const span = a && b ? `${shortSt(a)}/${shortSt(b)}` : a ? `at ${shortSt(a)}` : '';
  const par = (t) => { const inner = [span, t].filter(Boolean).join(', '); return inner ? ` (${inner})` : ''; };
  const short = tag.replace(/\b(north|south)?(east|west)?\b/g, (m) => ABBR[m] || m);
  const tries = [];
  for (const kw of [' Street Cleaning', ' Sweeping', '']) for (const t of [tag, short]) tries.push(`${street}${kw}${par(t)}, SF | CURB`);
  const fit = tries.find((t) => t.length < 60);
  if (fit) return fit;
  // long ramp/boulevard names: clip the cross streets, never the tag that tells twins apart
  const end = `…${short ? `, ${short}` : ''}), SF | CURB`;
  return `${street} (${span.slice(0, Math.max(0, 59 - street.length - 2 - end.length)).trimEnd().replace(/\s*\/$/, '')}${end}`;
}

// Next n sweep dates across all rows, SF calendar days (same rules as nextSweep: nth-weekday flags, weekday
// rows stopped on every holiday, the holiday schedule (dow 7) only on minor holidays, today only while its
// window hasn't ended). A sweep starting before 6 AM is listed by the night before ({ night: true },
// lib/sweep-core.js sweepDayWords), the night people think in: a Tue 12 to 2 AM sweep is "Mon night, Oct 5".
// A date with both kinds lists both, night first. { hol: true } = swept by the holiday schedule that date.
function nextDates(rows, n = 3) {
  const now = new Date(), t0 = sfTodayParts(), base = Date.UTC(t0.y, t0.mo - 1, t0.da), out = [];
  for (let i = 0; i < 150 && out.length < n; i++) {
    const d = new Date(base + i * 864e5), dow = d.getUTCDay(), occ = Math.ceil(d.getUTCDate() / 7);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
    const hit = rows.filter(([, rd, from, to, mask]) => {
      if (rd !== HOLIDAY_DOW && (rd !== dow || !((mask >> (occ - 1)) & 1))) return false;
      if (sweepSuspended(ruleOf(rd), iso)) return false;
      if (i > 0) return true;
      const start = sfWallToInstant(y, mo, da, from);
      let end = sfWallToInstant(y, mo, da, to);
      if (+end <= +start) end = new Date(+start + 36e5);
      return now < end;
    });
    const words = hit.map((r) => ({ ...sweepDayWords(y, mo, da, r[2], r[3]), hol: isHol(r) }));
    const night = words.find((w) => w.night), day = words.find((w) => !w.night);
    if (night) out.push({ ...night.nightOf, night: true, hol: night.hol });
    if (day) out.push({ dow, mo, da, hol: day.hol });
  }
  return out.slice(0, n);
}

// "the east side every Tuesday 11am–1pm and the west side the 2nd and 4th Friday of the month …"
function sweptPhrase(rows) {
  const bySide = new Map();
  for (const w of windows(rows, true)) {
    const days = dayRuns(w.dows, DAYS, ' through ');
    const plural = andList(days.map((d) => (d.includes(' through ') ? d : d + 's')));
    const when = w.dows.length === 1
      ? (w.mask === 31 ? `every ${days[0]}` : `the ${andList(weeksOf(w.mask))} ${days[0]} of the month`)
      : (w.mask === 31 ? plural : `${plural} in the ${andList(weeksOf(w.mask))} weeks of the month`);
    const p = bySide.get(w.side) || bySide.set(w.side, []).get(w.side);
    p.push(`${when} ${win(w.from, w.to)}`);
  }
  // sides with the exact same schedule read as one ("on both sides")
  const same = new Map();
  for (const [side, ps] of bySide) { const k = ps.join(' and '); (same.get(k) || same.set(k, []).get(k)).push(side); }
  return andList([...same].map(([k, sides]) => {
    const named = sides.filter(Boolean).map((s) => s.toLowerCase());
    const who = !named.length ? '' : named.length === 2 && sides.length === 2 ? 'on both sides ' : `on the ${andList(named)} side${named.length > 1 ? 's' : ''} `;
    return who + k;
  }));
}

// "On city holidays the regular sweeps stop and the east side is swept 4 to 6am instead (…)." from the dow 7
// rows; '' for a block without a posted holiday schedule.
function holidayPhrase(rows) {
  const by = new Map();
  for (const w of windows(rows.filter(isHol), true)) { const k = win(w.from, w.to); (by.get(k) || by.set(k, []).get(k)).push(w.side); }
  if (!by.size) return '';
  const sides = new Set(rows.map((r) => r[0]));
  const parts = [...by].map(([k, ss], i) => {
    const named = ss.filter(Boolean).map((s) => s.toLowerCase());
    const who = !named.length ? 'it' : named.length === 2 && sides.size === 2 ? 'both sides' : `the ${andList(named)} side${named.length > 1 ? 's' : ''}`;
    return `${who}${i ? '' : named.length > 1 ? ' are swept' : ' is swept'} ${k}`;
  });
  return `On city holidays the regular sweeps stop and ${andList(parts)} instead (nothing is swept on New Year’s Day, Thanksgiving and Christmas).`;
}

// "Mon, Thu 8–10am (1st & 3rd wks)" — every weekly window once, for the meta description (the holiday
// schedule stays out of it, so descriptions and the /n/ block lists read as before)
export const schedShort = (rows) => windows(weekly(rows), false)
  .map((w) => `${dayRuns(w.dows, DAYLBL, ' to ').join(', ')} ${win(w.from, w.to)}${w.mask === 31 ? '' : ` (${weeksOf(w.mask).join(' & ')} wks)`}`).join('; ');

// One ticket line for the whole block (enforcement.json is per cnn × weekday, not per side).
function ticketLine(enf, rows) {
  const days = [...new Set(rows.map((r) => r[1]))].sort((a, b) => monFirst(a) - monFirst(b)).filter((d) => enf && enf[d]);
  if (!days.length) return null;
  const e = days.map((d) => ({ d, n: enf[d][0], avg: enf[d][1], lo: enf[d][2] }));
  const n = e.reduce((s, x) => s + x.n, 0);
  const lo = Math.min(...e.map((x) => x.avg)), hi = Math.max(...e.map((x) => x.avg));
  let when;
  if (e.length === 1) when = `~${fmtMin(e[0].avg)} (earliest ${fmtMin(e[0].lo)})`;
  else if (e.length <= 3 && hi - lo > 15) when = andList(e.map((x) => `~${fmtMin(x.avg)} on ${DAYS[x.d]}s`)); // days differ
  else when = lo === hi ? `~${fmtMin(lo)}` : `between ${fmtMin(lo)} and ${fmtMin(hi)}`;
  return { when, n, short: `~${fmtMin(lo)}` };
}

export function loadData() {
  return {
    S: require('../data/schedules.json'),
    ENF: require('../data/enforcement.json'),
    R: require('../data/routes.json'),
  };
}

// seconds until the next SF midnight — the page's "next sweeps" line is only true for today
function secsToSfMidnight() {
  const p = sfTodayParts();
  const d = new Date(Date.UTC(p.y, p.mo - 1, p.da) + 864e5);
  return Math.max(300, Math.round((+sfWallToInstant(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0) - Date.now()) / 1000));
}

const STYLE = `:root{--paper:#F2ECDF;--ink:#17150F;--ink-soft:#4A4536;--red:#E0322E;--red-text:#C22A26;
--sign-red:#C42127;--sign-white:#FFFDF6;--shadow:5px 5px 0 var(--ink)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--paper);color:var(--ink);font-family:'Hanken Grotesk',sans-serif;
display:grid;place-items:center;min-height:100dvh;padding:22px 16px}
.card{width:min(480px,100%);background:var(--sign-white);border:3px solid var(--ink);border-radius:18px;
box-shadow:var(--shadow);padding:22px}
.top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.logo{display:inline-block;font-family:'Anton',sans-serif;font-size:20px;background:var(--ink);color:var(--paper);
padding:6px 11px;border-radius:10px;text-decoration:none}.logo span{color:var(--red)}
.site{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:13px;font-weight:800}
.site a,.crumb a,.adj a,.more a{color:var(--ink);text-underline-offset:3px}
.crumb{font-size:12.5px;font-weight:700;color:var(--ink-soft);margin-top:14px}
h1{font-family:'Anton',sans-serif;font-size:27px;line-height:1.05;text-transform:uppercase;margin:6px 0 10px}
.lede{font-size:14.5px;font-weight:600;line-height:1.5;color:var(--ink-soft);margin-bottom:14px}
.lede b{color:var(--ink)}
.hol{font-size:12.5px;font-weight:700;color:var(--ink-soft);margin:-8px 0 14px}
.hol a{color:var(--ink);text-underline-offset:3px}
.row{display:flex;gap:12px;align-items:center;border-top:2px solid var(--ink);padding:12px 0}
.badge{flex:none;width:70px;text-align:center;background:var(--sign-white);color:var(--sign-red);
border:2px solid var(--sign-red);border-radius:8px;padding:6px 2px 5px}
.badge .d{font-family:'Anton',sans-serif;font-size:17px;line-height:1}
.badge .d.hd{font-size:14px;line-height:17px}
.badge .t{font-size:9px;font-weight:800;margin-top:1px}
.badge .sc{font-size:6.5px;font-weight:800;letter-spacing:.06em;margin-top:2px;opacity:.9}
.meta .nm{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft)}
.facts{border-top:2px solid var(--ink);padding-top:12px;font-size:13.5px;font-weight:700;line-height:1.55}
.facts .enf{color:var(--red-text)}
.cta{display:block;text-align:center;margin-top:16px;font-weight:800;font-size:15px;text-decoration:none;
border:2.5px solid var(--ink);border-radius:12px;padding:14px;background:var(--ink);color:var(--paper);box-shadow:var(--shadow)}
.adj{margin-top:18px;font-size:13px;font-weight:700;line-height:1.5}
.adj h2{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-soft);margin-bottom:4px}
.adj a{display:block;padding:5px 0}
.more{margin-top:10px;font-size:13px;font-weight:800}
.fine{font-size:11px;font-weight:600;color:var(--ink-soft);margin-top:14px;line-height:1.5;text-align:center}`;

const HEAD_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Hanken+Grotesk:wght@600;700;800&display=swap" rel="stylesheet">`;
const SITE_NAV = `<nav class="site" aria-label="Pages"><a href="/">Map</a><a href="/n/">Neighborhoods</a><a href="/tickets">Tickets</a><a href="/about">About</a></nav>`;

// Small signage page for the 404 and 503 answers (noindex — neither is content).
const plainPage = (title, msg) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} | CURB</title><meta name="robots" content="noindex">
<link rel="icon" href="/icons/icon-192.png">
${HEAD_FONTS}
<style>${STYLE}</style></head><body>
<main class="card"><div class="top"><a class="logo" href="/">CURB<span>.</span></a>${SITE_NAV}</div>
<h1 style="margin-top:14px">${esc(title)}</h1><p class="lede">${msg}</p>
<a class="cta" href="/">Open the live map →</a></main></body></html>`;

/** Pure render: { status, headers, body } for one cnn against the loaded data. */
export function renderBlock(cnn, { S, ENF, R }) {
  const e = /^\d{1,9}$/.test(cnn) ? S.b[cnn] : null;
  if (!e) {
    return { status: 404, headers: { 'Cache-Control': 'public, s-maxage=86400' },
      body: plainPage('Block not found', 'We don’t have a street-cleaning schedule for this block. It may no longer be swept, or the link is mistyped. Find it on the map, or browse <a href="/n/">street cleaning by neighborhood</a>.') };
  }
  const [street, , , hoodIdx, rows, prevCnn, nextCnn, tag, , range] = e;
  const hood = hoodIdx >= 0 ? S.hoods[hoodIdx] : null;       // [name, slug, hasPage]
  const hoodUrl = hood && hood[2] ? `/n/${hood[1]}` : null;
  const pageUrl = `https://curb.guide/b/${cnn}`;
  const title = titleFor(e);
  const h1 = nums(range) + label(e);
  const tl = ticketLine(ENF[cnn], weekly(rows));
  const rnum = R.blocks && R.blocks[cnn];
  const route = rnum != null ? (R.routeNames && R.routeNames[rnum]) || `Route ${rnum}` : null;
  const dates = nextDates(rows);

  const where = `${h1}${hood ? `, in the ${hood[0]} neighborhood of San Francisco,` : ', San Francisco,'}`;
  const hasHol = rows.some(isHol), holSentence = holidayPhrase(rows);
  const lede = `${esc(where)} is swept ${esc(weekly(rows).length ? sweptPhrase(weekly(rows)) : 'only on city holidays')}.` +
    (holSentence ? ` ${esc(holSentence)}` : '') +
    (dates.length ? ` Next sweep${dates.length > 1 ? 's' : ''}: ${andList(dates.map((d) => `<b>${DAYLBL[d.dow]}${d.night ? ' night' : ''}, ${MON[d.mo - 1]} ${d.da}</b>${d.hol ? ' (holiday schedule)' : ''}`))}.` : '');

  const norm = normRows(rows);
  const rowHtml = windows(rows, false).flatMap((w) => w.dows.map((dow) => {
    const sides = [...new Set(norm.filter((r) => r[1] === dow && r[2] === w.from && r[3] === w.to && r[4] === w.mask).map((r) => r[0]).filter(Boolean))];
    const who = sides.length ? `${sides.join(' & ')} side${sides.length > 1 ? 's' : ''} · ` : '';
    // the holiday schedule reads like its posted sign, "HOLIDAYS 4 TO 6AM"
    const wk = dow === HOLIDAY_DOW ? 'city holidays' : w.mask === 31 ? 'every week' : `${weeksOf(w.mask).join(' & ')} weeks`;
    return { dow, html: `<div class="row">
      <div class="badge"><div class="d${dow === HOLIDAY_DOW ? ' hd' : ''}">${dow === HOLIDAY_DOW ? 'HOLIDAYS' : DAYLBL[dow].toUpperCase()}</div><div class="t">${win(w.from, w.to).toUpperCase()}</div><div class="sc">STREET CLEANING</div></div>
      <div class="meta"><div class="nm">${esc(who + wk)}</div></div>
    </div>` };
  })).sort((x, y) => monFirst(x.dow) - monFirst(y.dow)).map((x) => x.html).join('');

  const adjLink = (c, dir) => (c && S.b[c] ? `<a href="/b/${c}">${dir === 'prev' ? '← ' : ''}${esc(label(S.b[c]))}${dir === 'next' ? ' →' : ''}</a>` : '');
  const adj = adjLink(prevCnn, 'prev') + adjLink(nextCnn, 'next');

  // description names the street + every sweep window; shed the fine, then the neighborhood, then
  // the ticket time until it fits a SERP (~160)
  const tick = tl ? ` Tickets usually land ${tl.short}.` : '', fine = ` $${FINE} fine.`;
  const sched = schedShort(rows);
  const lead = (h) => `Street cleaning on ${nums(range)}${place(e)}${tag ? ` (${tag})` : ''}${h && hood ? `, ${hood[0]}` : ''}, SF: ${sched}.`;
  const desc = [lead(1) + tick + fine, lead(1) + tick, lead(0) + tick + fine, lead(0) + tick, lead(0)].find((d) => d.length <= 160) ||
    lead(0).slice(0, 150).replace(/[;,]?\s*\S*$/, '') + ' + more.';

  const crumbs = [['CURB', 'https://curb.guide/'], hoodUrl ? [hood[0], `https://curb.guide${hoodUrl}`] : ['Neighborhoods', 'https://curb.guide/n/'], [street, null]];
  const ld = jsonLd({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: crumbs.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, ...(item ? { item } : {}) })) });

  const body = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CURB">
<meta property="og:title" content="${esc(title.replace(/ \| CURB$/, ''))}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="https://curb.guide/api/og?cnn=${cnn}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#E0322E">
<meta name="twitter:image" content="https://curb.guide/api/og?cnn=${cnn}">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="/icons/icon-192.png">
${HEAD_FONTS}
<style>${STYLE}</style>
<script defer src="/_vercel/insights/script.js"></script></head><body>
<main class="card">
<div class="top"><a class="logo" href="/">CURB<span>.</span></a>${SITE_NAV}</div>
<nav class="crumb" aria-label="Breadcrumb"><a href="/">CURB</a> › ${hoodUrl ? `<a href="${hoodUrl}">${esc(hood[0])}</a>` : '<a href="/n/">Neighborhoods</a>'} › ${esc(street)}</nav>
<h1>${esc(h1)}</h1>
<p class="lede">${lede}</p>
${dates.length ? (hasHol ? '<p class="hol">These dates follow this block’s holiday schedule on <a href="/holidays">street sweeping holidays</a>.</p>\n'
  : '<p class="hol">These dates already skip <a href="/holidays">street sweeping holidays</a>.</p>\n') : ''}${rowHtml}
<div class="facts">
${tl ? `<div class="enf">Tickets usually land ${esc(tl.when)} · ${tl.n} tickets in 2 yrs</div>` : ''}
<div>Street-cleaning ticket: $${FINE}${route ? ` · Swept by DPW’s <b>${esc(route)}</b> sweeper route` : ''}</div>
</div>
<a class="cta" href="/?b=${cnn}">Open the live map →</a>
${adj ? `<nav class="adj" aria-label="Same street"><h2>Next door on ${esc(street)}</h2>${adj}</nav>` : ''}
${hoodUrl ? `<p class="more"><a href="${hoodUrl}">Every swept block in ${esc(hood[0])} →</a></p>` : `<p class="more"><a href="/n/">Street cleaning by neighborhood →</a></p>`}
<p class="fine">"Tickets usually" = 2 yrs of SFMTA citations on this block. The posted sign is always the source of truth. Free · no accounts · curb.guide</p>
</main></body></html>`;
  // rules change monthly at most, but "next sweeps" is only true until SF midnight
  return { status: 200, headers: { 'Cache-Control': `public, s-maxage=${secsToSfMidnight()}, stale-while-revalidate=3600` }, body };
}

export function makeHandler(load) {
  let data = null;
  return async function handler(req, res) {
    const cnn = String((req.query && req.query.cnn) || '').replace(/[^0-9]/g, '');
    let out;
    try {
      out = renderBlock(cnn, data || (data = load()));
    } catch (err) {
      console.error('block page failed:', cnn, err);
      out = { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' },
        body: plainPage('Back in a moment', 'This block page is temporarily unavailable. Please try again in a few minutes. The live map still works.') };
    }
    // A shared link names the curb side (?side=North, from the app's share button): the live map link
    // passes it on, so the map opens the side that was shared. Letters only, never echoed anywhere else.
    const side = String((req.query && req.query.side) || '');
    if (out.status === 200 && /^[A-Za-z]{1,12}$/.test(side)) {
      out = { ...out, body: out.body.replace(`href="/?b=${cnn}"`, `href="/?b=${cnn}&amp;side=${side}"`) };
    }
    res.statusCode = out.status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    res.end(out.body);
  };
}

export default makeHandler(loadData);
