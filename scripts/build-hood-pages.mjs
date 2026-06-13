#!/usr/bin/env node
// Generate the neighborhood street-cleaning SEO pages from data/stats.json.
//   n/<slug>.html   — one editorial page per SF neighborhood
//   n/index.html    — the directory of all neighborhoods
// Plus refreshed <url> entries in sitemap.xml.
//
// Each page targets "street cleaning in <hood>" long-tail queries with REAL stats
// (volume, fines, when tickets actually happen, heaviest streets, 5yr surge) — not a
// fabricated single schedule (schedules are per-block; the page links to the map for that).
// Uses stats.json.hoodDetail when present (build:stats), and degrades to citywide
// histograms if an older stats.json is in place.
//
// Run: npm run build:hoodpages   (Node 18+, no deps)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const stats = JSON.parse(readFileSync(new URL('data/stats.json', ROOT), 'utf8'));

const MIN_TICKETS = 1500;   // editorial floor — below this a hood page is too thin to be useful
const FINE = 105;           // current SF street-cleaning fine (2026)
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const slug = (h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Safe to embed in <script type="application/ld+json">: \u-escape the HTML/script delimiters so a
// neighborhood/street name containing < > & (or a literal </script>) can't break out of the element.
const jsonLd = (obj) => JSON.stringify(obj)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
// FAQ answers carry a raw hood name + *emphasis* markers: mdBold() escapes for HTML then bolds;
// plain() strips the markers for the JSON-LD answer text (which jsonLd() then re-escapes safely).
const mdBold = (s) => esc(s).replace(/\*([^*]+)\*/g, '<b>$1</b>');
const plain = (s) => s.replace(/\*/g, '');
const titleCaseHood = (h) => h; // EAS nhood values are already display-cased
const num = (n) => n.toLocaleString('en-US');
const money = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'k' : '$' + n;
const fmtHour = (h) => { const ap = h >= 12 ? 'pm' : 'am'; let hh = h % 12; if (hh === 0) hh = 12; return hh + ap; };
const fmtMin = (m) => { let h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? 'pm' : 'am'; h = h % 12; if (h === 0) h = 12; return h + ':' + String(mm).padStart(2, '0') + ap; };

const detail = stats.hoodDetail || {};
const cityHours = stats.sweepHour || [];   // [{h,n}]
const cityDows = stats.sweepDow || [];     // [{d,n}]
const surgeBy = Object.fromEntries((stats.hoodSurge?.rows || []).map((r) => [r.hood, r]));

// argmax helpers over an array-of-24 / array-of-7 (hoodDetail) OR [{h/d,n}] (citywide)
const peakFromArr = (arr) => arr.reduce((best, n, i) => (n > best.n ? { i, n } : best), { i: 0, n: -1 });
const peakFromList = (list, key) => list.reduce((best, r) => (+r.n > best.n ? { i: +r[key], n: +r.n } : best), { i: 0, n: -1 });

// pick + rank the hoods
const all = (stats.hoods || []).filter((h) => h.n >= MIN_TICKETS && slug(h.hood));
all.forEach((h, i) => (h.rank = i + 1));
const hoods = all; // already sorted desc by n in stats.json

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--paper:#F2ECDF;--ink:#17150F;--ink-soft:#4A4536;--green:#1F9E5A;--amber:#E08A1E;--red:#C1121F;--meter:#2F5BD0;
  --green-text:#157A44;--amber-text:#8F5A06;--red-text:#C1121F;--sign:#FFFDF6;--shadow:5px 5px 0 var(--ink)}
html{scroll-behavior:smooth}
body{background:var(--paper);color:var(--ink);font-family:'Hanken Grotesk',sans-serif;font-size:17px;line-height:1.55;-webkit-font-smoothing:antialiased}
::selection{background:var(--ink);color:var(--paper)}
:focus-visible{outline:3px solid var(--meter);outline-offset:2px}
.wrap{max-width:1080px;margin:0 auto;padding:0 clamp(20px,4.5vw,48px)}
a{color:inherit}
header{padding:calc(40px + env(safe-area-inset-top)) 0 0}
.mast{display:flex;align-items:center;gap:14px}
.logo{display:inline-flex;align-items:center;text-decoration:none}
.logo .clogo{height:54px;width:auto;flex:none;display:block}
.topnav{display:flex;gap:4px;margin-left:auto}
.topnav a{padding:9px 13px;border-radius:10px;font-weight:800;font-size:14.5px;text-decoration:none;color:var(--ink);border:2.5px solid transparent}
.topnav a:hover{border-color:var(--ink)}
.topnav a[aria-current="page"]{background:var(--ink);color:var(--paper)}
.btn{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:16px;text-decoration:none;border:2.5px solid var(--ink);border-radius:13px;padding:14px 22px;background:var(--ink);color:var(--paper);box-shadow:var(--shadow);transition:transform .12s}
.btn:hover{transform:translateY(-1px)}.btn:active{transform:translate(2px,2px);box-shadow:none}
.btn.ghost{background:transparent;color:var(--ink)}
.mast .btn{margin-left:auto;padding:11px 16px;font-size:14px}
@media (max-width:680px){.topnav{display:none}.mast .btn{margin-left:auto}}
main{padding-bottom:60px}
.crumb{font-size:13px;font-weight:700;color:var(--ink-soft);margin-top:30px}
.crumb a{text-decoration:none;display:inline-block;padding:6px 2px}.crumb a:hover{text-decoration:underline}
.hero{padding:clamp(28px,6vh,56px) 0 clamp(16px,3vh,28px)}
.kicker{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft)}
h1{font-family:'Anton',sans-serif;font-size:clamp(34px,7vw,72px);line-height:.96;text-transform:uppercase;margin:8px 0 4px}
h1 b{color:var(--red-text)}
.sub{font-size:clamp(17px,2vw,20px);font-weight:600;color:var(--ink-soft);max-width:40em;margin-top:14px}
.sub b{color:var(--ink)}
section{padding:clamp(26px,5vh,44px) 0 0}
.sec-k{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft)}
h2{font-family:'Anton',sans-serif;font-size:clamp(24px,4.2vw,38px);line-height:.98;text-transform:uppercase;margin:6px 0 10px}
h2 b{color:var(--red-text)}
.lede{font-weight:600;color:var(--ink-soft);max-width:46em}
.lede b{color:var(--ink)}
.statrow{display:flex;gap:14px;flex-wrap:wrap;margin-top:18px}
.stat{flex:1 1 150px;border:2.5px solid var(--ink);border-radius:14px;background:var(--sign);box-shadow:3px 3px 0 var(--ink);padding:14px 16px}
.stat .v{font-family:'Anton',sans-serif;font-size:clamp(24px,3.4vw,34px);line-height:1}
.stat .v.red{color:var(--red-text)}.stat .v.green{color:var(--green-text)}.stat .v.amber{color:var(--amber-text)}
.stat .l{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-soft);margin-top:5px}
.panel{border:3px solid var(--ink);border-radius:18px;background:var(--sign);box-shadow:var(--shadow);padding:clamp(16px,3vw,26px);margin-top:18px}
.bars{display:grid;gap:8px;margin-top:6px}
.bar{display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:10px;font-weight:700;font-size:14px}
.bar .track{height:16px;background:rgba(23,21,15,.1);border-radius:8px;overflow:hidden}
.bar .fill{height:100%;background:var(--amber);border-radius:8px}
.bar .fill.peak{background:var(--red)}
.bar .n{font-variant-numeric:tabular-nums;color:var(--ink-soft);font-size:13px}
.bar .pk{margin-left:6px;font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--red-text)}
ul.streets{list-style:none;margin-top:6px;display:grid;gap:8px}
ul.streets li{display:flex;justify-content:space-between;gap:12px;border-bottom:1.5px dashed rgba(23,21,15,.2);padding-bottom:7px;font-weight:700}
ul.streets li .n{color:var(--ink-soft);font-variant-numeric:tabular-nums}
.faq{margin-top:10px}
.faq details{border:2.5px solid var(--ink);border-radius:13px;background:var(--sign);box-shadow:3px 3px 0 var(--ink);padding:14px 18px;margin-top:12px}
.faq summary{font-family:'Anton',sans-serif;font-size:19px;text-transform:uppercase;cursor:pointer;letter-spacing:.01em}
.faq p{margin-top:10px;font-weight:500;color:var(--ink-soft)}.faq p b{color:var(--ink)}
.cta{margin-top:26px;display:flex;gap:12px;flex-wrap:wrap}
.hoodgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:18px}
.hoodgrid a{display:block;border:2.5px solid var(--ink);border-radius:13px;background:var(--sign);box-shadow:3px 3px 0 var(--ink);padding:13px 16px;text-decoration:none;transition:transform .1s}
.hoodgrid a:hover{transform:translateY(-1px)}
.hoodgrid .hn{font-family:'Anton',sans-serif;font-size:19px;text-transform:uppercase;line-height:1}
.hoodgrid .hs{font-size:12.5px;font-weight:700;color:var(--ink-soft);margin-top:4px}
footer{border-top:3px solid var(--ink);margin-top:50px;padding:26px 0 calc(34px + env(safe-area-inset-bottom))}
.foot{display:flex;flex-wrap:wrap;gap:14px 22px;align-items:baseline}
.foot .mark{font-family:'Anton',sans-serif;font-size:22px}.foot .mark span{color:var(--red-text)}
.foot a{font-weight:700;color:var(--ink-soft);text-decoration:none}.foot a:hover{color:var(--ink);text-decoration:underline}
.foot .fine{flex-basis:100%;font-size:12.5px;font-weight:600;color:var(--ink-soft);line-height:1.55;margin-top:4px}
.foot .fine a{color:var(--ink-soft);text-decoration:underline}
`;

const HEAD_COMMON = (title, desc, canonical, jsonld) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="CURB">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="https://curb.guide/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="https://curb.guide/og.png">
<meta name="theme-color" content="#C1121F">
<script type="application/ld+json">
${jsonld}
</script>
<link rel="icon" type="image/svg+xml" href="/icons/favicon.svg">
<link rel="icon" sizes="any" href="/favicon.ico">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Hanken+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>`;

const NAV = (current) => `
<header class="wrap">
  <div class="mast">
    <a class="logo" href="/" aria-label="CURB — open the map"><img class="clogo" src="/icons/logo.svg" alt="" aria-hidden="true"></a>
    <nav class="topnav" aria-label="Pages">
      <a href="/"${current === 'map' ? ' aria-current="page"' : ''}>Map</a>
      <a href="/n/"${current === 'hoods' ? ' aria-current="page"' : ''}>Neighborhoods</a>
      <a href="/tickets">Tickets</a>
      <a href="/about">About</a>
    </nav>
    <a class="btn" href="/">Open the map →</a>
  </div>
</header>`;

const FOOTER = `
<footer><div class="wrap foot">
  <span class="mark">CURB<span>.</span></span>
  <a href="/">Open the map</a>
  <a href="/n/">All neighborhoods</a>
  <a href="/tickets">The ticket economy</a>
  <a href="/about">About CURB</a>
  <a href="https://data.sfgov.org" rel="noopener">Data: DataSF</a>
  <a href="/privacy">Privacy</a>
  <span class="fine">Schedules are set block by block — the <b>posted sign is always the source of truth</b>, and temporary signs &amp; holidays override everything here. Ticket figures are historical guidance from public SFMTA citation records (last ~2 years), never a guarantee. Free and open source (MIT). No accounts, no ads, no cookies — only anonymous page counts. Made in San Francisco.</span>
</div></footer>
</body>
</html>`;

function barRow(label, value, max, peak) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  // peak is marked with a TEXT cue ("busiest"), not color alone (WCAG 1.4.1), and each row carries
  // its own accessible name so the chart reads correctly without seeing the bars.
  const aria = `${label}: ${num(value)} tickets${peak ? ', busiest' : ''}`;
  const badge = peak ? ' <b class="pk">busiest</b>' : '';
  return `<div class="bar" role="listitem" aria-label="${aria}"><span aria-hidden="true">${label}</span><span class="track" aria-hidden="true"><span class="fill${peak ? ' peak' : ''}" style="width:${pct}%"></span></span><span class="n" aria-hidden="true">${num(value)}${badge}</span></div>`;
}

function renderHood(h, idx) {
  const name = titleCaseHood(h.hood);
  const sl = slug(h.hood);
  const canonical = `https://curb.guide/n/${sl}`;
  const d = detail[h.hood];

  // sweep timing — prefer per-hood histograms, else citywide
  const hoursArr = d?.hours;
  const dowsArr = d?.dows;
  const peakHour = hoursArr ? peakFromArr(hoursArr) : peakFromList(cityHours, 'h');
  const peakDow = dowsArr ? peakFromArr(dowsArr) : peakFromList(cityDows, 'd');
  // "Typical time" = the MODAL hour (most tickets), not the mean: street cleaning is bimodal in
  // commercial hoods (overnight) vs residential (morning), and a mean lands misleadingly between.
  const typical = fmtHour(peakHour.i);
  const isHoodTiming = !!hoursArr;

  // top streets in this hood (per-hood only; omit the section in fallback)
  const topStreets = d?.topStreets || [];

  const surge = surgeBy[h.hood];
  const surgePct = surge && surge.pct != null ? surge.pct : null;

  // ---- the bars ----
  const dowMax = dowsArr ? Math.max(...dowsArr) : Math.max(...cityDows.map((r) => +r.n), 1);
  const dowBars = (dowsArr
    ? dowsArr.map((n, i) => ({ i, n }))
    : cityDows.map((r) => ({ i: +r.d, n: +r.n })))
    .filter((r) => r.n > 0)
    .map((r) => barRow(DOW_SHORT[r.i], r.n, dowMax, r.i === peakDow.i)).join('');

  // Show every hour with tickets (NOT a fixed 5am–6pm window) so a hood's true peak — overnight
  // in commercial areas, morning in residential — is always visible and matches the headline.
  const hoursList = hoursArr ? hoursArr.map((n, i) => ({ i, n })) : cityHours.map((r) => ({ i: +r.h, n: +r.n }));
  const hoursWindow = hoursList.filter((r) => r.n > 0).sort((a, b) => a.i - b.i);
  const hourMax = Math.max(...hoursWindow.map((r) => r.n), 1);
  const hourBars = hoursWindow.map((r) => barRow(fmtHour(r.i), r.n, hourMax, r.i === peakHour.i)).join('');

  // ---- copy ---- (title ≤~56, desc ≤~165 so SERPs don't truncate; name stays raw — HEAD_COMMON esc()s it.
  // Tail keywords like "schedule"/"ticket data" live in the H1, description and body, not the title.)
  const title = `Street cleaning in ${name} | CURB`;
  const desc = `When is street cleaning in ${name}? Per-block schedules on a live map, plus when tickets actually hit (~${typical} on ${DOW[peakDow.i]}s) and the $${FINE} fine.`;

  // FAQ — answers carry the RAW hood name + *emphasis* markers; faqHtml renders via mdBold() (escapes
  // then bolds), the JSON-LD below renders via plain() (strips markers, keeps raw text). No "morning"
  // hardcode — the modal hour ${typical} is overnight in commercial hoods, morning in residential.
  const faqs = [
    {
      q: `When is street cleaning in ${name}?`,
      a: `Street-cleaning schedules in ${name} are set block by block — each side of each street has its own day and time, so there's no single neighborhood-wide schedule. *Open ${name} on the CURB map* to see the exact posted schedule and next sweep for any block. In practice, most ${name} street-cleaning tickets are written on *${DOW[peakDow.i]}s*, clustered around *${typical}*.`,
    },
    {
      q: `How much is a street-cleaning ticket in San Francisco?`,
      a: `As of 2026 the street-cleaning fine is *$${FINE}* citywide (many older sites still list $73–97 — those are out of date). Over the last ~2 years, ${name} drivers were issued *${num(h.n)}* street-cleaning tickets totaling about *${money(h.rev)}* in fines.`,
    },
    {
      q: `How do I avoid a street-cleaning ticket in ${name}?`,
      a: `Move your car before the posted window — most tickets here are written around ${typical} on ${DOW[peakDow.i]}s. CURB lets you tap your block, see the next sweep, and *set a free reminder (calendar or push)* ~30 minutes before, plus the night before. The posted sign always wins if it differs.`,
    },
  ];
  const faqHtml = faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${mdBold(f.a)}</p></details>`).join('\n      ');

  // related hoods: neighbors by rank (prev/next a few) — keeps internal links relevant
  const related = hoods.filter((x) => x.hood !== h.hood)
    .sort((a, b) => Math.abs(a.rank - h.rank) - Math.abs(b.rank - h.rank)).slice(0, 6);
  const relatedHtml = related.map((r) => `<a href="/n/${slug(r.hood)}"><span class="hn">${esc(r.hood)}</span><span class="hs">${num(r.n)} tickets · ${money(r.rev)}</span></a>`).join('\n    ');

  // JSON-LD: FAQPage + Dataset + BreadcrumbList (jsonLd() \u-escapes script delimiters)
  const jsonld = jsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: plain(f.a) } })),
      },
      {
        '@type': 'Dataset',
        name: `Street-cleaning citations in ${name}, San Francisco`,
        description: `Aggregated SFMTA street-cleaning citations for the ${name} neighborhood over the last ~2 years: total tickets and fines, distribution by day of week and hour, and the heaviest-ticketed streets. Derived from the public DataSF citations dataset, address-matched to neighborhoods.`,
        url: canonical,
        isBasedOn: 'https://data.sfgov.org/Transportation/SFMTA-Parking-Citations-Fines/ab4h-6ztd',
        license: 'https://opendatacommons.org/licenses/pddl/1-0/',
        creator: { '@type': 'Organization', name: 'CURB', url: 'https://curb.guide/' },
        spatialCoverage: { '@type': 'Place', name: `${name}, San Francisco, California` },
        temporalCoverage: (stats._meta?.hood_window_since || '2024-06-01').slice(0, 10) + '/..',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'CURB', item: 'https://curb.guide/' },
          { '@type': 'ListItem', position: 2, name: 'Neighborhoods', item: 'https://curb.guide/n/' },
          { '@type': 'ListItem', position: 3, name, item: canonical },
        ],
      },
    ],
  });

  const streetsSection = topStreets.length ? `
  <section>
    <div class="sec-k">Heaviest-ticketed streets</div>
    <h2>Where tickets <b>cluster</b></h2>
    <p class="lede">The ${esc(name)} streets with the most street-cleaning citations over ~2 years. High counts usually mean a busy corridor with frequent sweeping — check the exact block on the map.</p>
    <div class="panel"><ul class="streets">
      ${topStreets.map((s) => `<li><span>${esc(s.street)}</span><span class="n">${num(s.n)} tickets</span></li>`).join('\n      ')}
    </ul></div>
  </section>` : '';

  const surgeStat = surgePct != null
    ? `<div class="stat"><div class="v ${surgePct >= 0 ? 'red' : 'green'}">${surgePct >= 0 ? '+' : ''}${surgePct}%</div><div class="l">vs 5 years ago</div></div>` : '';

  const body = `
<main class="wrap">
  <nav class="crumb" aria-label="Breadcrumb"><a href="/">CURB</a> <span aria-hidden="true">›</span> <a href="/n/">Neighborhoods</a> <span aria-hidden="true">›</span> ${esc(name)}</nav>
  <div class="hero">
    <div class="kicker">San Francisco · street cleaning</div>
    <h1>Street cleaning in <b>${esc(name)}</b></h1>
    <p class="sub">Schedules here are set <b>block by block</b> — tap any block on the map for its exact posted day, time, and next sweep, then set a free reminder. Below: what the public ticket record shows about ${esc(name)}.</p>
    <div class="cta">
      <a class="btn" href="/">Open the map →</a>
      <a class="btn ghost" href="/tickets">The ticket economy →</a>
    </div>
  </div>

  <section>
    <div class="sec-k">By the numbers · last ~2 years</div>
    <h2>${esc(name)} in <b>tickets</b></h2>
    <div class="statrow">
      <div class="stat"><div class="v red">${num(h.n)}</div><div class="l">Street-cleaning tickets</div></div>
      <div class="stat"><div class="v">${money(h.rev)}</div><div class="l">In fines assessed</div></div>
      <div class="stat"><div class="v amber">~${typical}</div><div class="l">Most common ticket time</div></div>
      <div class="stat"><div class="v">#${h.rank}</div><div class="l">of ${hoods.length} hoods by volume</div></div>
      ${surgeStat}
    </div>
    <p class="lede" style="margin-top:16px">The street-cleaning fine is <b>$${FINE}</b> (2026). ${isHoodTiming ? `In ${esc(name)}, most tickets are written on <b>${DOW[peakDow.i]}s</b> around <b>${typical}</b>.` : `Citywide, most tickets are written on <b>${DOW[peakDow.i]}s</b> around <b>${typical}</b> — ${esc(name)} follows the same pattern.`}</p>
  </section>

  <section>
    <div class="sec-k">When tickets happen${isHoodTiming ? ` in ${esc(name)}` : ' (citywide)'}</div>
    <h2>By <b>day</b> &amp; <b>hour</b></h2>
    <p class="lede">Enforcement clusters at predictable times, not at random. These are the days and hours when ${isHoodTiming ? `${esc(name)} street-cleaning tickets` : 'SF street-cleaning tickets'} are actually written — your block's posted window is what counts, but the pattern shows when to be careful.</p>
    <div class="panel">
      <div class="sec-k" id="dowcap-${sl}">By day of week</div>
      <div class="bars" role="list" aria-labelledby="dowcap-${sl}">${dowBars}</div>
    </div>
    <div class="panel">
      <div class="sec-k" id="hrcap-${sl}">By hour of day</div>
      <div class="bars" role="list" aria-labelledby="hrcap-${sl}">${hourBars}</div>
    </div>
  </section>
${streetsSection}
  <section>
    <div class="sec-k">FAQ</div>
    <h2>Street cleaning in ${esc(name)}, <b>answered</b></h2>
    <div class="faq">
      ${faqHtml}
    </div>
  </section>

  <section>
    <div class="sec-k">Nearby</div>
    <h2>Other <b>neighborhoods</b></h2>
    <div class="hoodgrid">
    ${relatedHtml}
    </div>
    <p class="lede" style="margin-top:16px"><a href="/n/" style="font-weight:800">See all ${hoods.length} neighborhoods →</a></p>
  </section>
</main>`;

  return HEAD_COMMON(title, desc, canonical, jsonld) + NAV('hoods') + body + FOOTER;
}

function renderIndex() {
  const canonical = 'https://curb.guide/n/';
  const title = 'Street cleaning by SF neighborhood | CURB';
  const desc = `Street-cleaning schedules and real ticket data for ${hoods.length} San Francisco neighborhoods. Find your block's exact sweep schedule and set a free reminder.`;
  const jsonld = jsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage', '@id': canonical, name: title, url: canonical, description: desc,
        mainEntity: { '@id': canonical + '#hoods' },
      },
      {
        '@type': 'ItemList', '@id': canonical + '#hoods',
        itemListElement: hoods.map((h, i) => ({ '@type': 'ListItem', position: i + 1, name: h.hood, url: `https://curb.guide/n/${slug(h.hood)}` })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'CURB', item: 'https://curb.guide/' },
          { '@type': 'ListItem', position: 2, name: 'Neighborhoods' },
        ],
      },
    ],
  });
  const cards = hoods.map((h) => `<a href="/n/${slug(h.hood)}"><span class="hn">${esc(h.hood)}</span><span class="hs">${num(h.n)} tickets · ${money(h.rev)}</span></a>`).join('\n    ');
  const body = `
<main class="wrap">
  <nav class="crumb" aria-label="Breadcrumb"><a href="/">CURB</a> <span aria-hidden="true">›</span> Neighborhoods</nav>
  <div class="hero">
    <div class="kicker">San Francisco · street cleaning</div>
    <h1>Street cleaning by <b>neighborhood</b></h1>
    <p class="sub">Schedules are set block by block, but the <b>ticket record</b> tells a story per neighborhood. Pick yours for real numbers — or just open the map and tap your block.</p>
    <div class="cta"><a class="btn" href="/">Open the map →</a></div>
  </div>
  <section>
    <div class="sec-k">${hoods.length} neighborhoods · last ~2 years</div>
    <h2>Find <b>your</b> neighborhood</h2>
    <div class="hoodgrid">
    ${cards}
    </div>
  </section>
</main>`;
  return HEAD_COMMON(title, desc, canonical, jsonld) + NAV('hoods') + body + FOOTER;
}

// ---- write pages ----
mkdirSync(new URL('n/', ROOT), { recursive: true });
let written = 0;
for (let i = 0; i < hoods.length; i++) {
  const h = hoods[i];
  writeFileSync(new URL(`n/${slug(h.hood)}.html`, ROOT), renderHood(h, i));
  written++;
}
writeFileSync(new URL('n/index.html', ROOT), renderIndex());

// ---- refresh sitemap.xml ----
const today = (stats._meta?.generated || new Date().toISOString()).slice(0, 10);
const staticUrls = [
  ['https://curb.guide/', 'weekly', '1.0'],
  ['https://curb.guide/about', 'monthly', '0.8'],
  ['https://curb.guide/tickets', 'monthly', '0.8'],
  ['https://curb.guide/n/', 'weekly', '0.7'],
  ['https://curb.guide/privacy', 'yearly', '0.3'],
];
const hoodUrls = hoods.map((h) => [`https://curb.guide/n/${slug(h.hood)}`, 'monthly', '0.6']);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...hoodUrls].map(([loc, freq, pri]) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${pri}</priority>
  </url>`).join('\n')}
</urlset>
`;
writeFileSync(new URL('sitemap.xml', ROOT), sitemap);

const usingDetail = Object.keys(detail).length > 0;
console.error(`[hoodpages] wrote ${written} hood pages + index + sitemap (${5 + hoodUrls.length} urls). per-hood detail: ${usingDetail ? 'YES' : 'NO (citywide fallback)'}`);
