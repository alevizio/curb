#!/usr/bin/env node
// Generate holidays.html (/holidays): the days San Francisco does not enforce street sweeping.
// Every date, weekday, name and night-route flag comes from the holiday tables in lib/sweep-core.js
// (HOL_DAY, HOL_NIGHT, HOL_NAMES): the same tables nextSweep(), the map and the /b/ pages use, so the page
// can't say something the app doesn't do. scripts/build-holidays-page.test.mjs fails when the committed
// page differs from a fresh build. Never hand-edit holidays.html; change this file or the tables and run:
//   npm run build:holidays
// The next holiday and the muted past dates are worked out in the browser at view time (PAGE_JS), so a
// cached copy never goes stale; without JavaScript the full list still shows.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../lib/sweep-core.js'; // side effect: HOL_DAY / HOL_NIGHT / HOL_NAMES on globalThis

const { HOL_DAY, HOL_NIGHT, HOL_NAMES } = globalThis;

export const SFMTA_URL = 'https://www.sfmta.com/getting-around/drive-park/holiday-enforcement-schedule';
// The last date SFMTA had posted when the table was checked (see the comment above HOL_DAY in
// lib/sweep-core.js). Later dates are derived by SFMTA's rule; move this when SFMTA posts more.
export const POSTED_THROUGH = '2027-01-01';
// Holidays with a fixed calendar date. A table date with one of these names on another day is the
// weekday the city observes it on (Sat → the Friday before, Sun → the Monday after).
const FIXED = { "New Year's Day": '01-01', Juneteenth: '06-19', 'Independence Day': '07-04', 'Veterans Day': '11-11', Christmas: '12-25' };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const andList = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

/** The table as rows, oldest first. Throws if the tables disagree, so a bad edit fails the build. */
export function holidayRows() {
  for (const iso of HOL_NIGHT) if (!HOL_DAY.has(iso)) throw new Error(`HOL_NIGHT ${iso} is not in HOL_DAY`);
  return [...HOL_DAY].sort().map((iso) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`bad holiday date ${iso}`);
    const name = HOL_NAMES[iso];
    if (!name) throw new Error(`HOL_NAMES has no name for ${iso}`);
    const [y, mo, da] = iso.split('-').map(Number);
    const dow = new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
    const observed = name in FIXED && iso.slice(5) !== FIXED[name];
    return { iso, y, mo, da, dow, name, night: HOL_NIGHT.has(iso), observed };
  });
}

// Runs in the browser: today's date in San Francisco, past rows muted, the next holiday (or today's)
// highlighted and spelled out in the card above the list, which stays hidden without JavaScript.
export const PAGE_JS = `(function () {
  var rows = document.querySelectorAll('tr[data-date]'), p = {};
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
  } catch (e) { return; }
  var today = p.year + '-' + p.month + '-' + p.day, next = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute('data-date') < today) rows[i].classList.add('is-past');
    else if (!next) next = rows[i];
  }
  if (!next) return;
  var iso = next.getAttribute('data-date'), isToday = iso === today;
  var at = function (s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); };
  var days = Math.round((at(iso) - at(today)) / 864e5), d = new Date(at(iso));
  var DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var set = function (id, text) { document.getElementById(id).textContent = text; };
  next.classList.add(isToday ? 'is-today' : 'is-next');
  if (isToday) next.setAttribute('aria-current', 'date');
  set('nxK', isToday ? 'Today' : 'Next sweeping holiday');
  set('nxName', next.getAttribute('data-name'));
  set('nxMon', MONTH[d.getUTCMonth()].slice(0, 3));
  set('nxDay', String(d.getUTCDate()));
  set('nxDow', DAY[d.getUTCDay()].slice(0, 3));
  set('nxWhen', DAY[d.getUTCDay()] + ', ' + MONTH[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear() + ' · ' +
    (isToday ? 'today' : days === 1 ? 'tomorrow' : 'in\\u00a0' + days + '\\u00a0days'));
  set('nxNight', next.getAttribute('data-night') === '1'
    ? 'No street sweeping at all, overnight and 7-day routes included.'
    : 'No daytime sweeping. Overnight and 7-day routes still sweep.');
  document.getElementById('next').hidden = false;
})();`;

const STYLE = `
  :root{
    --paper:#F2ECDF; --ink:#17150F; --ink-soft:#4A4536;
    --green:#1F9E5A; --amber:#E08A1E; --red:#C1121F; --meter:#2F5BD0;
    --green-text:#157A44; --amber-text:#8F5A06; --red-text:#C1121F;
    --green-tint:rgba(31,158,90,.11); --rule:rgba(23,21,15,.13);
    --sign:#FFFDF6; --shadow:5px 5px 0 var(--ink);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{min-height:100%;overflow-x:clip;-webkit-overflow-scrolling:touch}
  body{background:var(--paper);color:var(--ink);font-family:'Hanken Grotesk',sans-serif;
    font-size:17px;line-height:1.55;-webkit-font-smoothing:antialiased}
  ::selection{background:var(--ink);color:var(--paper)}
  :focus-visible{outline:3px solid var(--meter);outline-offset:2px}
  .wrap{max-width:1080px;margin:0 auto;padding:0 clamp(20px,4.5vw,48px)}
  a{color:inherit;text-underline-offset:3px}

  .hero{display:flex;flex-wrap:wrap;align-items:center;gap:28px clamp(28px,5vw,64px);
    padding:clamp(40px,8vh,80px) 0 clamp(8px,2vh,16px)}
  .hero-tx{flex:1 1 440px;min-width:0}
  .kicker,.sec-k{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft)}
  h1{font-family:'Anton',sans-serif;text-transform:uppercase;line-height:.92;letter-spacing:.005em;
    font-size:clamp(46px,7.6vw,92px);margin-top:12px}
  h1 .dot{color:var(--red)}
  .sub{font-size:clamp(17px,2vw,20px);font-weight:600;color:var(--ink-soft);max-width:32em;margin-top:18px}
  .sub b{color:var(--ink)}

  /* the next holiday: the app's green holiday card, as a sign */
  .next{flex:0 1 410px;display:flex;gap:16px;align-items:center;background:var(--sign);
    border:3px solid var(--green-text);border-radius:18px;box-shadow:var(--shadow);padding:18px}
  .cal{flex:none;width:82px;text-align:center;border:2.5px solid var(--green-text);border-radius:12px;
    overflow:hidden;color:var(--green-text);background:var(--sign)}
  .cal span{display:block}
  .cal .m{background:var(--green-text);color:var(--sign);font-weight:800;font-size:12px;letter-spacing:.14em;
    text-transform:uppercase;padding:4px 0 3px}
  .cal .d{font-family:'Anton',sans-serif;font-size:40px;line-height:1;padding:7px 0 1px}
  .cal .w{font-weight:800;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding-bottom:7px}
  .nx{min-width:0}
  .nx-k{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--green-text)}
  .nx-name{font-family:'Anton',sans-serif;font-weight:400;font-size:clamp(23px,3vw,29px);line-height:1;
    text-transform:uppercase;margin:4px 0 6px}
  .nx-when{font-weight:800;font-size:14.5px;line-height:1.35}
  .nx-night{font-weight:600;font-size:13.5px;color:var(--ink-soft);margin-top:5px;line-height:1.45}

  section{padding:clamp(34px,6vh,56px) 0 0}
  h2{font-family:'Anton',sans-serif;font-weight:400;font-size:clamp(26px,4.4vw,42px);line-height:.98;
    text-transform:uppercase;margin:6px 0 8px}
  .lede{font-weight:600;color:var(--ink-soft);max-width:46em}
  .lede b{color:var(--ink)}
  .lede a{color:var(--ink);font-weight:800}

  .means{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;margin-top:18px}
  .mean{border:2.5px solid var(--ink);border-radius:14px;background:var(--sign);box-shadow:3px 3px 0 var(--ink);padding:16px}
  .mean h3{display:flex;align-items:center;gap:9px;font-family:'Anton',sans-serif;font-weight:400;font-size:19px;
    line-height:1.05;text-transform:uppercase;margin-bottom:8px}
  .mean h3::before{content:'';flex:none;width:12px;height:12px;border-radius:3px;background:var(--c,var(--ink))}
  .mean.day{--c:var(--green)} .mean.night{--c:var(--amber)} .mean.sign{--c:var(--red)}
  .mean p{font-size:14px;font-weight:600;color:var(--ink-soft);line-height:1.5}
  .mean p b{color:var(--ink)}
  .mean p a{color:var(--ink);font-weight:800}

  .years{display:grid;gap:clamp(26px,4vh,38px);margin-top:24px;max-width:820px}
  .yr h3{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;font-family:'Anton',sans-serif;font-weight:400;
    font-size:clamp(30px,4.6vw,40px);line-height:1}
  .rule-chip{font-family:'Hanken Grotesk',sans-serif;font-size:11px;font-weight:800;letter-spacing:.08em;
    text-transform:uppercase;color:var(--amber-text);background:#F4E7C9;border:2px solid var(--ink);border-radius:999px;padding:3px 10px}
  .tbl{margin-top:12px;border:3px solid var(--ink);border-radius:16px;background:var(--sign);box-shadow:var(--shadow);overflow:hidden}
  table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:15px;line-height:1.35}
  .c-d{width:30%} .c-x{width:30%}
  th{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);
    text-align:left;vertical-align:bottom;padding:12px 14px 9px;border-bottom:2.5px solid var(--ink)}
  td{padding:11px 14px;border-top:1.5px solid var(--rule);vertical-align:top;font-weight:700}
  tbody tr:first-child td{border-top:0}
  td.hd{white-space:nowrap;font-weight:800}
  td.hx{white-space:nowrap;font-weight:800;font-size:14px}
  td.hx.on{color:var(--amber-text)}
  td.hx.off{color:var(--green-text)}
  .obs{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
    color:var(--ink-soft);border:1.5px solid rgba(23,21,15,.3);border-radius:999px;padding:0 7px;margin-left:5px;vertical-align:1px}
  tr.is-past td,tr.is-past td.hx{color:rgba(23,21,15,.42)}
  tr.is-past .obs{color:inherit;border-color:rgba(23,21,15,.18)}
  tr.is-next td,tr.is-today td{background:var(--green-tint)}
  tr.is-next td.hd::after,tr.is-today td.hd::after{content:'Next';display:block;width:max-content;margin-top:5px;
    font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--sign);
    background:var(--green-text);border-radius:999px;padding:1px 8px}
  tr.is-today td.hd::after{content:'Today'}
  .note{font-size:13px;font-weight:600;color:var(--ink-soft);margin-top:14px;line-height:1.55;max-width:46em}
  .note b{color:var(--ink)}
  .note a{color:var(--ink);font-weight:800}

  .cta-band{margin-top:clamp(40px,7vh,64px);background:var(--ink);color:var(--paper);border-radius:20px;
    box-shadow:var(--shadow);padding:clamp(24px,4vw,40px);display:flex;gap:18px;align-items:center;flex-wrap:wrap}
  .cta-band h2{color:var(--paper);margin:0}
  .cta-band p{flex-basis:100%;font-weight:600;color:rgba(242,236,223,.8);font-size:14.5px;max-width:46em}
  .cta-band p a{color:var(--paper);font-weight:800}
  .btn{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:16px;text-decoration:none;
    border:2.5px solid var(--red);border-radius:13px;padding:14px 22px;background:var(--red);color:var(--paper);transition:transform .12s}
  .btn:hover{transform:translateY(-1px)} .btn:active{transform:translate(2px,2px)}

  @media (max-width:480px){
    .next{padding:14px;gap:13px}
    .cal{width:70px} .cal .d{font-size:34px}
    th,td{padding-left:10px;padding-right:10px}
    table{font-size:14px}
  }`;

/** The whole page, from the tables. */
export function renderHolidaysPage() {
  const rows = holidayRows();
  const years = [...new Set(rows.map((r) => r.y))];
  // full years = the ones that reach Christmas; the title names those, not the lone New Year's Day after
  const full = years.filter((y) => rows.some((r) => r.y === y && r.mo === 12 && r.da === 25));
  const span = `${full[0]} to ${full[full.length - 1]}`;
  const last = rows[rows.length - 1];
  const posted = full.filter((y) => rows.every((r) => r.y !== y || r.iso <= POSTED_THROUGH));
  const derived = full.filter((y) => !posted.includes(y));
  const nightNames = [...new Set(rows.filter((r) => r.night).map((r) => r.name))];

  const title = `SF Street Sweeping Holidays ${span} | CURB`;
  const desc = `Every day San Francisco does not enforce daytime street sweeping, ${span}: the date, the holiday and whether overnight routes still sweep.`;
  const url = 'https://curb.guide/holidays';
  const ld = jsonLd({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'CURB', item: 'https://curb.guide/' },
    { '@type': 'ListItem', position: 2, name: 'Street sweeping holidays' }] });

  const sourceLine = (posted.length ? `The ${andList(posted.map(String))} dates are SFMTA's posted schedule. ` : '') +
    (derived.length ? `Dates in ${andList(derived.map(String))} follow SFMTA's rule and will be re-checked when SFMTA posts them. ` : '') +
    `Source: <a href="${SFMTA_URL}" rel="noopener">SFMTA's holiday enforcement schedule</a>.`;

  const tables = years.map((y) => {
    const list = rows.filter((r) => r.y === y);
    const byRule = list.some((r) => r.iso > POSTED_THROUGH);
    const trs = list.map((r) => `        <tr data-date="${r.iso}" data-night="${r.night ? 1 : 0}" data-name="${esc(r.name)}">` +
      `<td class="hd"><time datetime="${r.iso}">${DOW[r.dow]}, ${MON[r.mo - 1]} ${r.da}</time></td>` +
      `<td class="hn">${esc(r.name)}${r.observed ? ' <span class="obs">observed</span>' : ''}</td>` +
      `<td class="hx ${r.night ? 'off' : 'on'}">${r.night ? 'Not swept' : 'Still swept'}</td></tr>`).join('\n');
    return `    <div class="yr" id="y${y}">
      <h3>${y}${byRule ? ' <span class="rule-chip">By SFMTA\'s rule</span>' : ''}</h3>
      <div class="tbl"><table>
        <caption class="sr">Street sweeping holidays in ${y}</caption><colgroup><col class="c-d"><col><col class="c-x"></colgroup>
        <thead><tr><th scope="col">Date</th><th scope="col">Holiday</th><th scope="col">Overnight &amp; 7-day routes</th></tr></thead>
        <tbody>
${trs}
        </tbody>
      </table></div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<!-- Generated by scripts/build-holidays-page.mjs from the holiday tables in lib/sweep-core.js. Don't edit by hand: npm run build:holidays -->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CURB">
<meta property="og:title" content="San Francisco street sweeping holidays, ${span}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="https://curb.guide/og.png?v=3">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="CURB, the SF street parking map with green, amber and red curb lines showing sweeping status">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://curb.guide/og.png?v=3">
<script type="application/ld+json">${ld}</script>
<link rel="icon" type="image/svg+xml" href="/icons/favicon.svg">
<link rel="icon" sizes="any" href="/favicon.ico">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Hanken+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css">
<script src="/site.js" defer></script>
<style>${STYLE}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
</style>
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body>
<!-- nav injected by /site.js -->

<main class="wrap">
  <div class="hero">
    <div class="hero-tx">
      <div class="kicker">San Francisco · ${span}</div>
      <h1>Street sweeping holidays<span class="dot">.</span></h1>
      <p class="sub">The days San Francisco does not enforce <b>daytime street sweeping</b>, every date through ${esc(last.name)} ${last.y}. From SFMTA's holiday enforcement schedule.</p>
    </div>
    <section class="next" id="next" aria-labelledby="nxK" hidden>
      <div class="cal" aria-hidden="true"><span class="m" id="nxMon"></span><span class="d" id="nxDay"></span><span class="w" id="nxDow"></span></div>
      <div class="nx">
        <div class="nx-k" id="nxK">Next sweeping holiday</div>
        <h2 class="nx-name" id="nxName"></h2>
        <p class="nx-when" id="nxWhen"></p>
        <p class="nx-night" id="nxNight"></p>
      </div>
    </section>
  </div>

  <section aria-labelledby="means">
    <div class="sec-k">What it means</div>
    <h2 id="means">Daytime off, nights mostly on</h2>
    <div class="means">
      <div class="mean day"><h3>Daytime sweeping is off</h3>
        <p>On every date below, San Francisco does not enforce <b>daytime street sweeping</b>. The sweep isn't moved to another day: your block's next regular sweep still applies.</p></div>
      <div class="mean night"><h3>Night routes keep going</h3>
        <p>Blocks swept overnight and the <b>7-day commercial routes</b> still sweep on most holidays. They stop only on ${andList(nightNames)}. Your block's hours on the <a href="/">map</a> show which kind it is.</p></div>
      <div class="mean sign"><h3>The sign wins</h3>
        <p>The posted sign is always the source of truth. If a sign on your block says something else, follow the sign.</p></div>
    </div>
  </section>

  <section aria-labelledby="list">
    <div class="sec-k">Every date</div>
    <h2 id="list">The full list</h2>
    <p class="lede">${sourceLine}</p>
    <div class="years">
${tables}
    </div>
    <p class="note"><b>Observed</b> is the weekday the city takes off when a holiday falls on a weekend. This page covers street sweeping only. For every other parking rule on these days, check <a href="${SFMTA_URL}" rel="noopener">SFMTA's schedule</a>.</p>
  </section>

  <div class="cta-band">
    <h2>The map already skips them.</h2>
    <a class="btn" href="/">Open the map →</a>
    <p>Each block page and the map already skip holidays when they count down to your next sweep, and sweep alerts follow the same dates. Find your block on the map, or <a href="/n/">by neighborhood</a>.</p>
  </div>
</main>

<!-- footer injected by /site.js -->

<script>
${PAGE_JS}
</script>
</body>
</html>
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = renderHolidaysPage();
  writeFileSync(new URL('../holidays.html', import.meta.url), html);
  console.log(`holidays: ${holidayRows().length} dates written to holidays.html`);
}
