#!/usr/bin/env node
// The readable pages next to the public city maps, GENERATED (never hand-edit them):
//   <id>/about.html  (/<id>/about)  How the rule works in that city, in plain words: the City's rule, when it applies,
//                                    the fine and towing, the holidays, where the data comes from (each source with its
//                                    license and fetch date, and the agency's own page) and the way to the map. One per
//                                    public city (scripts/cities/public.mjs), from data/<id>/city.json and segments.json.
//   cities.html      (/cities)       Every city CURB maps: a map of North America with a pin per city
//                                    (basemap/north-america.svg, scripts/cities/hub-map.mjs), the cities by state or province
//                                    with what each covers, when its data was built and its sources, the cities in
//                                    progress, and the form to request a city (POST /api/city-request).
// Both take the About page's styles (about.html), as the Boston pages do, and site.js's nav and footer (a city page's
// body names its city, so site.js shows that city's links). Also writes their rewrites in vercel.json.
// Run after configs.mjs and city-page.mjs: node scripts/cities/city-pages.mjs
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PUBLIC, IN_PROGRESS, ruleTerm, sweepsIn, seoWords, jsonLd } from './public.mjs';
import { project, W as MAP_W, H as MAP_H } from './hub-map.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(ROOT + f, 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Number(n).toLocaleString('en-US');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const day = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const longDay = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const ver = (f) => createHash('sha1').update(fs.readFileSync(ROOT + f)).digest('hex').slice(0, 8);
// A source's link a person can open: its page, else its address
const linkOf = (s) => (typeof s.page === 'string' && /^https:/.test(s.page) ? s.page : typeof s.url === 'string' && /^https?:/.test(s.url) ? s.url : '');
const WINTER_MONTHS = (1 << 10) | (1 << 11) | 1 | 2 | 4 | 8;   // November to April
const slug = (s) => 'in-' + String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---- each public city's facts, from its build ----------------------------------------------------------------------------
export function cityFacts(id) {
  const c = read(`data/${id}/city.json`), seg = read(`data/${id}/segments.json`);
  let sides = 0, nonWinter = 0, flagged = 0, winterish = false;
  for (const b of seg.b) {
    sides += b.d.length;
    for (const [, , rules] of b.d) for (const r of rules) {
      if (r[5] & 4) { winterish = true; continue; }          // a side-switching winter rule (Madison, Milwaukee)
      nonWinter++;
      if (r[5] & 1) flagged++;                               // runs on holidays too
      if (r[5] & 8 || (r[4] && !(r[4] & ~WINTER_MONTHS))) winterish = true;   // a rule only in winter (Chicago's overnight ban)
    }
  }
  const term = ruleTerm(c), sweeps = sweepsIn(c);
  const covers = [cap(term), ...(winterish || c.winter ? ['Winter rules'] : [])];
  return { id, c, name: c.name, region: c.region || '', blocks: seg.b.length, sides, generated: String(seg._meta.generated).slice(0, 10),
    term, sweeps, covers, nonWinter, flagged, path: '/' + id, about: `/${id}/about` };
}

// San Francisco's entry on the hub: its own data (DataSF, live) and pages
const SF = { id: 'sf', name: 'San Francisco', region: 'California', path: '/', about: '/about', center: [37.7749, -122.4194],
  covers: ['Street sweeping', 'Ticket times', 'Permits, meters and loading zones'], live: true,
  sources: [
    { name: 'Street Sweeping Schedule (DataSF)', url: 'https://data.sf.gov/d/yhqp-riqs', license: 'ODC PDDL' },
    { name: 'Parking Citations (DataSF), and SFMTA records request #26-5453', url: 'https://data.sf.gov/d/ab4h-6ztd', license: 'ODC PDDL' },
    { name: 'Residential parking permit areas (DataSF)', url: 'https://data.sf.gov/d/hi6h-neyh', license: 'ODC PDDL' },
    { name: 'Parking meters (DataSF)', url: 'https://data.sf.gov/d/8vzz-qzz9', license: 'ODC PDDL' },
  ] };

// ---- the page frame, like the Boston pages: the About page's styles, site.js's nav and footer ----------------------------
const about = fs.readFileSync(ROOT + 'about.html', 'utf8');
const aboutStyle = /<style>([\s\S]*?)<\/style>/.exec(about)[1];
const EXTRA = `
  .k{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft)}
  .sec{padding-top:clamp(44px,7vh,76px)}
  .sec h2{font-family:'Anton',sans-serif;font-size:clamp(30px,4.6vw,48px);text-transform:uppercase;line-height:.96;margin:6px 0 0}
  .lede{margin-top:12px;color:var(--ink-soft);font-weight:600;max-width:46em}
  .lede b{color:var(--ink)}
  .lede a,.qa p a,.note a{color:var(--ink);font-weight:800;text-underline-offset:3px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:8px}
  .stat{border:3px solid var(--ink);border-radius:14px;background:var(--sign);box-shadow:5px 5px 0 var(--ink);padding:14px 16px}
  .stat b{display:block;font-family:'Anton',sans-serif;font-size:clamp(26px,4vw,38px);line-height:1;overflow-wrap:anywhere}
  .stat span{display:block;margin-top:6px;font-size:13.5px;font-weight:700;color:var(--ink-soft);line-height:1.35}
  .tbl{width:100%;border-collapse:collapse;margin-top:22px;font-size:14.5px}
  .tbl th{text-align:left;font-size:11.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-soft);padding:0 10px 8px 0}
  .tbl td{padding:11px 10px 11px 0;border-top:2px solid rgba(23,21,15,.2);vertical-align:top;font-weight:600;color:var(--ink-soft)}
  .tbl td b{color:var(--ink);font-weight:800}
  .tbl tr.past td{opacity:.45}
  .tbl tr.next td{background:rgba(31,158,90,.12)}
  .tbl tr.next td:first-child b::after{content:'next';margin-left:8px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;background:var(--green);color:#fff;border-radius:999px;padding:2px 7px;vertical-align:1px}
  .note{margin-top:14px;font-size:13.5px;font-weight:600;color:var(--ink-soft);max-width:52em}
  .srcs .src .sh{overflow-wrap:anywhere}
  .srcs .src p .lic{display:block;font-size:12.5px;font-weight:700;color:var(--ink-soft);margin-top:2px}
  .crumbs{font-size:13px;font-weight:700;color:var(--ink-soft);display:flex;flex-wrap:wrap;gap:6px}
  .crumbs a{color:var(--ink-soft);text-underline-offset:3px}
  .attrib{margin-top:26px;font-size:12px;font-weight:600;color:var(--ink-soft)}
`;

function page({ path, title, description, image, body, ld, city = null, script = '', style = '' }) {
  return `<!DOCTYPE html>
<!-- GENERATED by scripts/cities/city-pages.mjs. Do not edit: change the script (or the city's data) and rerun it. -->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="https://curb.guide${path}">
<script type="application/ld+json">
${jsonLd(ld)}
</script>
<meta property="og:type" content="website">
<meta property="og:site_name" content="CURB">
<meta property="og:title" content="${esc(title.replace(/ \| CURB$/, ''))}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="https://curb.guide${path}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${image}">
<link rel="icon" type="image/svg+xml" href="/icons/favicon.svg">
<link rel="icon" sizes="any" href="/favicon.ico">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Hanken+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css?v=${ver('site.css')}">
<script src="/site.js?v=${ver('site.js')}" defer></script>
<style>${aboutStyle}</style>
<style>${EXTRA}</style>${style ? `\n<style>${style}</style>` : ''}
</head>
<body${city ? ` data-city="${esc(city.id)}" data-city-name="${esc(city.name)}"${city.data ? ` data-city-data="${esc(city.data)}"` : ''}` : ''}>

<!-- nav injected by /site.js -->

<main>
${body}
</main>
${script}
</body>
</html>
`;
}

// ---- /<id>/about ----------------------------------------------------------------------------------------------------------
const TOW = { yes: 'and the car can be towed', sometimes: 'and on some streets the car can be towed', no: 'with no tow' };
function holidayLine(f) {
  if (!f.sweeps || !f.nonWinter) return '';
  if (!f.flagged) return `${cap(f.term)} stops on these holidays, and CURB's colors and alerts skip them.`;
  if (f.flagged === f.nonWinter) return 'CURB keeps the rules on these days too, to be safe. The posted sign has the final word.';
  return 'Most rules stop on these holidays. Rules that run anyway, like some overnight ones, stay on: CURB\'s colors and alerts already know which.';
}
// the City's open data for the footer: city.json's portal, else the first source a person can read
const readable = (u) => typeof u === 'string' && /^https:/.test(u) && !/\/rest\/services\/|FeatureServer|MapServer|\/resource\/|\/api\/|\.(json|csv|zip|pdf)(\?|$)/i.test(u);
const portalOf = (c) => c.portal || (c.sources || []).flatMap((x) => [x.page, x.url]).find(readable) || c.scheduleUrl || '';

export function aboutPage(f) {
  const { c, name, term, sweeps } = f, words = c.words || {};
  const Term = cap(term), url = `https://curb.guide${f.about}`;
  const fine = c.fine ? `A ticket is ${c.fine}${TOW[c.tow] ? ', ' + TOW[c.tow] : ''}.` : `CURB doesn't have the amount of a ticket here yet${c.tow === 'yes' ? ', but the car can be towed' : ''}.`;
  const owner = /\bCounty\b/.test(name) ? 'County' : 'City';
  const holidays = Object.entries(c.holidays || {}).sort(([a], [b]) => a.localeCompare(b));
  const holidayRows = holidays.map(([iso, n]) => `<tr data-iso="${iso}"><td><b>${esc(n)}</b></td><td>${esc(longDay(iso))}</td></tr>`).join('\n        ');
  const sources = (c.sources || []).map((s) => {
    const href = linkOf(s);
    const when = [s.fetched ? `fetched ${day(s.fetched)}` : '', s.edited ? `last edited ${day(s.edited)}` : ''].filter(Boolean).join(', ');
    return `<div class="src"><div class="sh">${esc(s.name)}</div><p>${href ? `<a href="${esc(href)}" rel="noopener">Open the source&nbsp;↗</a>` : ''}`
      + `<span class="lic">License: ${esc(s.license || 'not stated')}${when ? ` · ${esc(when)}` : ''}</span></p></div>`;
  }).join('\n      ');
  const remind = sweeps
    ? `Yes. Tap your curb on the map, then <b>Sweep alerts</b>: a push the evening before and 30 minutes before it starts, on ${esc(name)} time, or put it in your calendar. An overnight sweep gets one alert around 9 PM the evening before. On iPhone, add the map to your Home Screen first.`
    : `Yes. Tap your curb on the map, then turn on alerts: a push around 9 PM on the nights your side closes, on ${esc(name)} time, or put them in your calendar. On iPhone, add the map to your Home Screen first.`;
  const seo = seoWords(c);
  const long = `${name} ${Term}: Rules, Fines and Holidays | CURB`;
  const title = long.length <= 60 ? long : `${name} ${Term} Rules | CURB`;
  const description = `How ${term} works in ${name}, in plain words: the rule, the fine${c.tow && c.tow !== 'no' ? ' and towing' : ''}, the holidays and where CURB's map gets its data.`;
  const ld = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'CURB', item: 'https://curb.guide/' },
    { '@type': 'ListItem', position: 2, name: 'Cities', item: 'https://curb.guide/cities' },
    { '@type': 'ListItem', position: 3, name: `${name} map`, item: `https://curb.guide${f.path}` },
    { '@type': 'ListItem', position: 4, name: `How ${term} works in ${name}`, item: url },
  ] };
  const line = holidayLine(f);
  const body = `  <section class="wrap hero" style="grid-template-columns:1fr">
    <div>
      <nav class="crumbs rise d1" aria-label="Breadcrumb"><a href="/cities">Cities</a><span aria-hidden="true">›</span><span>${esc(name)}${f.region ? ', ' + esc(f.region) : ''}</span></nav>
      <h1 class="rise d1" style="margin-top:12px">${esc(Term)} in ${esc(name)}<span class="dot">.</span></h1>
      <p class="sub rise d2" style="max-width:40em">${esc(words.rule || seo.description)}</p>
      <div class="ctas rise d3">
        <a class="btn" href="${f.path}">Open the map →</a>
        <a class="btn ghost" href="#rules">The rules</a>
      </div>
    </div>
  </section>

  <section class="wrap">
    <div class="stats">
      <div class="stat"><b>${num(f.blocks)}</b><span>blocks on the map</span></div>
      <div class="stat"><b>${num(f.sides)}</b><span>curb sides with a rule</span></div>
      <div class="stat"><b>${esc(c.fine || 'A ticket')}</b><span>${c.fine ? 'a ticket' : 'amount not published'}${c.tow === 'yes' ? ', and a tow' : c.tow === 'sometimes' ? ', sometimes a tow' : ', no tow'}</span></div>
      <div class="stat"><b>${esc(day(f.generated))}</b><span>when the map's data was built</span></div>
    </div>
  </section>

  <section class="wrap faq" id="rules">
    <div class="k">How it works in ${esc(name)}</div>
    <h2>The rules, in plain words.</h2>
    <div class="steps" style="margin-top:26px">
      <div class="qa">
        <h3>How does ${esc(term)} work in ${esc(name)}?</h3>
        <p>${esc(words.rule || '')}</p>
      </div>
      <div class="qa">
        <h3>When does it apply?</h3>
        <p>${esc(words.afterpass || '')}</p>
      </div>
      <div class="qa">
        <h3>What does a ticket cost?</h3>
        <p>${esc(fine)}${c.fineNote ? ' ' + esc(c.fineNote) + '.' : ''}${c.fineSource ? ` <a href="${esc(c.fineSource)}" rel="noopener">The ${owner}'s page&nbsp;↗</a>` : ''}</p>
      </div>
      <div class="qa">
        <h3>Can CURB remind me?</h3>
        <p>${remind}</p>
      </div>
      <div class="qa">
        <h3>Is CURB free?</h3>
        <p>Yes. Free, with no account and no ads, and open source on <a href="https://github.com/alevizio/curb" rel="noopener">GitHub</a>. CURB started in San Francisco; the ${esc(name)} map is built on the ${owner}'s open data.</p>
      </div>
    </div>
  </section>

  <section class="wrap sec" id="holidays">
    <div class="k">Holidays</div>
    <h2>The ${owner}'s holidays.</h2>
    ${line ? `<p class="lede">${esc(line)}</p>` : ''}
    <table class="tbl" id="holtbl">
      <thead><tr><th>Holiday</th><th>Date</th></tr></thead>
      <tbody>
        ${holidayRows}
      </tbody>
    </table>
    ${c.holidaysMissing ? `<p class="note">The ${owner} hasn't posted next year's days yet.</p>` : ''}
    ${c.holidaysSource ? `<p class="note">From the ${owner}'s list: <a href="${esc(c.holidaysSource)}" rel="noopener">${esc(c.agency || 'the ' + owner)}&nbsp;↗</a></p>` : ''}
  </section>

  <section class="wrap data" id="data">
    <div class="k">The receipts</div>
    <h2>Where the data comes from</h2>
    <p class="dlede">${esc(words.dataNotes || '')} <b>The posted sign always wins</b>: temporary signs and holidays override everything here.</p>
    <div class="srcs">
      ${sources}
    </div>
    ${c.scheduleUrl ? `<p class="note">The ${owner}'s own page on it: <a href="${esc(c.scheduleUrl)}" rel="noopener">${esc(c.agency || name)}&nbsp;↗</a></p>` : ''}
    <div class="ctas" style="margin-top:26px"><a class="btn" href="${f.path}">Open the ${esc(name)} map →</a><a class="btn ghost" href="/cities">Every city</a></div>
    <p class="attrib">Maps © OpenStreetMap contributors, © Protomaps.</p>
  </section>`;
  // past holidays fade, the next one is marked (the page is static; the date is the reader's, in the city)
  const script = `<script>
(function(){
  var t=new Date().toLocaleDateString('en-CA',{timeZone:${JSON.stringify(c.tz)}}), next=null;
  document.querySelectorAll('#holtbl tr[data-iso]').forEach(function(r){
    if(r.dataset.iso<t)r.classList.add('past'); else if(!next){next=r;r.classList.add('next');}
  });
})();
</script>`;
  return page({ path: f.about, title, description, image: `https://curb.guide/og-${f.id}.png?v=1`, body, ld, script,
    city: { id: f.id, name, data: portalOf(c) } });
}

// ---- /cities --------------------------------------------------------------------------------------------------------------
const HUB_CSS = `
  .hero .k{margin-bottom:12px}
  .namap{position:relative;margin-top:8px;border:3px solid var(--ink);border-radius:16px;box-shadow:5px 5px 0 var(--ink);background:#E3D8C2}
  .namap img{display:block;width:100%;height:auto;border-radius:13px}
  .pin{position:absolute;display:flex;align-items:center;gap:6px;transform:translate(-8px,-8px);text-decoration:none;color:var(--ink);z-index:2;white-space:nowrap}
  .pin i{flex:none;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--sign);border:3px solid var(--ink);box-shadow:2px 2px 0 var(--ink)}
  .pin.home i{background:var(--red)}
  .pin span,.pinmany span{font-size:12px;font-weight:800;line-height:1.2;background:rgba(253,250,242,.94);border-radius:6px;padding:2px 6px;box-shadow:0 0 0 1.5px rgba(23,21,15,.25)}
  .pin.nolbl span,.pinmany.nolbl span{display:none}
  .pin:hover span,.pin:focus-visible span,.pinmany:hover span,.pinmany:focus-visible span{display:inline;box-shadow:0 0 0 2px var(--ink)}
  .pin:focus-visible,.pinmany:focus-visible{outline:none}
  .pin:focus-visible i,.pinmany:focus-visible b{outline:3px solid var(--meter);outline-offset:2px}
  .pinmany{position:absolute;display:flex;align-items:center;gap:6px;transform:translate(-13px,-13px);border:0;background:none;padding:0;cursor:pointer;color:var(--ink);font:inherit;z-index:3;white-space:nowrap}
  .pinmany b{flex:none;min-width:26px;height:26px;padding:0 6px;border-radius:13px;corner-shape:round;display:grid;place-items:center;background:var(--ink);color:var(--paper);
    font-family:'Anton',sans-serif;font-weight:400;font-size:14px;line-height:1;border:2px solid var(--sign);box-shadow:2px 2px 0 rgba(23,21,15,.35)}
  .pinpop{position:absolute;z-index:6;background:var(--sign);border:2.5px solid var(--ink);border-radius:13px;box-shadow:4px 4px 0 var(--ink);padding:6px;min-width:190px;max-width:calc(100% - 16px)}
  .pinpop ul{list-style:none;margin:0;padding:0}
  .pinpop a{display:flex;align-items:center;min-height:40px;padding:6px 10px;border-radius:8px;font-weight:800;font-size:14.5px;color:var(--ink);text-decoration:none}
  .pinpop a:hover,.pinpop a:focus-visible{background:rgba(23,21,15,.07)}
  .pinpop .x{position:absolute;top:4px;right:4px;width:30px;height:30px;border:0;background:none;font-size:20px;font-weight:800;cursor:pointer;color:var(--ink-soft)}
  .pinpop .t{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-soft);padding:6px 36px 4px 10px}
  .mapnote{margin-top:12px;font-size:12px;font-weight:600;color:var(--ink-soft)}
  .jump{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
  .jump a{font-size:13px;font-weight:800;color:var(--ink);text-decoration:none;border:2px solid var(--ink);border-radius:999px;padding:6px 12px;background:var(--sign);min-height:36px;display:inline-flex;align-items:center}
  .jump a:hover{background:var(--ink);color:var(--paper)}
  .region{margin-top:34px;scroll-margin-top:90px}
  .region h3{font-family:'Anton',sans-serif;font-weight:400;font-size:clamp(22px,2.8vw,28px);text-transform:uppercase;line-height:1;padding-bottom:10px;border-bottom:3px solid var(--ink)}
  .cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));gap:16px;margin-top:16px}
  .ccard{border:3px solid var(--ink);border-radius:14px;background:var(--sign);box-shadow:4px 4px 0 var(--ink);padding:13px 15px 12px;display:flex;flex-direction:column;gap:8px;scroll-margin-top:90px}
  .chead{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px}
  .ccard h4{font-family:'Anton',sans-serif;font-weight:400;font-size:23px;text-transform:uppercase;line-height:1}
  .ccard h4 a{color:inherit;text-decoration:none}
  .ccard h4 a:hover{text-decoration:underline;text-underline-offset:4px}
  .go{display:inline-flex;align-items:center;min-height:38px;padding:7px 13px;border:2.5px solid var(--ink);border-radius:11px;background:var(--ink);color:var(--paper);
    font-weight:800;font-size:13.5px;text-decoration:none;box-shadow:3px 3px 0 rgba(23,21,15,.25);white-space:nowrap}
  .go:active{transform:translate(2px,2px);box-shadow:none}
  .tags{display:flex;flex-wrap:wrap;gap:6px}
  .tags span{font-size:12px;font-weight:800;border:2px solid var(--ink);border-radius:999px;padding:2px 9px;background:var(--paper)}
  .upd{font-size:13px;font-weight:700;color:var(--ink-soft)}
  .upd a{color:var(--ink);font-weight:800;text-underline-offset:3px}
  .ccard details{font-size:13.5px;font-weight:600;color:var(--ink-soft)}
  .ccard summary{cursor:pointer;font-weight:800;color:var(--ink);padding:3px 0;min-height:28px}
  .ccard details ul{margin:4px 0 2px;padding-left:18px;display:grid;gap:6px}
  .ccard details a{color:var(--ink);font-weight:800;text-underline-offset:3px}
  .nextlist{list-style:none;margin:22px 0 0;padding:0;display:grid;gap:0;max-width:52em}
  .nextlist li{display:grid;grid-template-columns:minmax(0,12em) minmax(0,1fr);gap:14px;padding:14px 0;border-top:2px solid rgba(23,21,15,.2);font-weight:600;color:var(--ink-soft)}
  .nextlist li:last-child{border-bottom:2px solid rgba(23,21,15,.2)}
  .nextlist b{color:var(--ink);font-weight:800}
  @media (max-width:560px){.nextlist li{grid-template-columns:minmax(0,1fr);gap:2px}}
  .reqform{margin-top:24px;border:3px solid var(--ink);border-radius:16px;background:var(--sign);box-shadow:5px 5px 0 var(--ink);padding:clamp(18px,3vw,28px);display:grid;gap:18px;max-width:640px}
  .frow{display:grid;gap:7px;border:0;margin:0;padding:0;min-width:0}
  .frow label,.frow legend{font-weight:800;font-size:15px;color:var(--ink);padding:0}
  .frow .opt,.frow .req{font-size:12px;font-weight:700;color:var(--ink-soft);margin-left:4px}
  .frow input[type=text],.frow input[type=url],.frow input[type=email]{width:100%;font:inherit;font-size:16px;font-weight:600;color:var(--ink);background:var(--paper);
    border:2.5px solid var(--ink);border-radius:11px;padding:11px 13px;min-height:48px}
  .frow input:focus-visible{outline:3px solid var(--meter);outline-offset:2px}
  .frow input[aria-invalid=true]{border-color:var(--red)}
  .opts{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
  .opts label{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:15px;border:2.5px solid var(--ink);border-radius:999px;padding:9px 15px;cursor:pointer;background:var(--paper);min-height:44px}
  .opts label:has(input:checked){background:var(--ink);color:var(--paper)}
  .opts input{accent-color:var(--ink);width:16px;height:16px;margin:0}
  .fhint{font-size:13px;font-weight:600;color:var(--ink-soft)}
  .ferr{font-size:13px;font-weight:800;color:var(--red-text)}
  .ferr:empty{display:none}
  .hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
  .reqform .btn{justify-self:start;cursor:pointer;font-family:inherit}
  .reqform .btn[disabled]{opacity:.6;cursor:wait}
  .fnote{font-size:13px;font-weight:600;color:var(--ink-soft);line-height:1.45}
  .fnote a{color:var(--ink);font-weight:800;text-underline-offset:3px}
  .fmsg{font-weight:800;font-size:15px;border-radius:11px;padding:12px 14px}
  .fmsg:empty{display:none}
  .fmsg.ok{background:rgba(31,158,90,.14);color:var(--green-text);border:2px solid var(--green)}
  .fmsg.bad{background:rgba(193,18,31,.07);color:var(--red-text);border:2px solid var(--red)}
`;

const HUB_SCRIPT = `<script>
/* The map's pins: a tap opens the city's map. Pins closer than a thumb merge into a numbered one that lists them; a pin's
   name shows where it fits. Without this script every pin still works, some on top of others. */
(function(){
  var box=document.getElementById('namap'); if(!box)return;
  var pins=[].slice.call(box.querySelectorAll('a.pin')), GAP=30, pop=null;
  function closePop(back){ if(pop){ pop.remove(); pop=null; if(back)back.focus(); } }
  function openPop(btn,list){
    closePop();
    pop=document.createElement('div'); pop.className='pinpop'; pop.setAttribute('role','dialog'); pop.setAttribute('aria-label',btn.getAttribute('aria-label'));
    var t=document.createElement('div'); t.className='t'; t.textContent=list.length+' cities here'; pop.appendChild(t);
    var x=document.createElement('button'); x.className='x'; x.type='button'; x.setAttribute('aria-label','Close'); x.textContent='×';
    x.onclick=function(){closePop(btn);}; pop.appendChild(x);
    var ul=document.createElement('ul');
    list.forEach(function(p){ var li=document.createElement('li'), a=document.createElement('a'); a.href=p.getAttribute('href'); a.textContent=p.dataset.name+' map'; li.appendChild(a); ul.appendChild(li); });
    pop.appendChild(ul); box.appendChild(pop);
    var bx=box.clientWidth, w=pop.offsetWidth;
    var left=Math.max(8,Math.min(bx-w-8,btn.offsetLeft-w/2)), top=btn.offsetTop+18;   // below the pin, past the map's edge if it must
    pop.style.left=left+'px'; pop.style.top=top+'px';
    ul.querySelector('a').focus();
  }
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&pop)closePop(box.querySelector('.pinmany[aria-expanded=true]')); });
  document.addEventListener('click',function(e){ if(pop&&!pop.contains(e.target)&&!e.target.closest('.pinmany'))closePop(); });
  function layout(){
    closePop();
    [].slice.call(box.querySelectorAll('.pinmany')).forEach(function(x){x.remove();});
    var w=box.clientWidth, h=box.clientHeight, groups=[];
    pins.forEach(function(p){
      p.hidden=false; p.classList.remove('nolbl');
      var x=parseFloat(p.style.left)/100*w, y=parseFloat(p.style.top)/100*h, g=null;
      for(var i=0;i<groups.length;i++){ var d=Math.hypot(groups[i].x-x,groups[i].y-y); if(d<GAP){g=groups[i];break;} }
      if(g)g.list.push(p); else groups.push({x:x,y:y,list:[p]});
    });
    var boxes=groups.map(function(g){return [g.x-15,g.y-15,g.x+15,g.y+15];});
    var hit=function(a,b){return a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3];};
    groups.forEach(function(g,i){
      var one=g.list.length===1, label=one?g.list[0].dataset.name:g.list[0].dataset.name+' +'+(g.list.length-1);
      var lb=[g.x+12,g.y-11,g.x+20+label.length*7.4,g.y+11], fits=lb[2]<w-4&&!boxes.some(function(b,j){return j!==i&&hit(lb,b);});
      if(fits)boxes.push(lb);
      if(one){ g.list[0].classList.toggle('nolbl',!fits); return; }
      g.list.forEach(function(p){p.hidden=true;});
      var b=document.createElement('button'); b.type='button'; b.className='pinmany'+(fits?'':' nolbl');
      b.style.left=(g.x/w*100)+'%'; b.style.top=(g.y/h*100)+'%';
      b.setAttribute('aria-label',g.list.map(function(p){return p.dataset.name;}).join(', ')); b.setAttribute('aria-expanded','false');
      b.innerHTML='<b></b><span></span>'; b.querySelector('b').textContent=g.list.length; b.querySelector('span').textContent=label;
      b.onclick=function(e){ e.stopPropagation(); var open=b.getAttribute('aria-expanded')==='true'; box.querySelectorAll('.pinmany').forEach(function(x){x.setAttribute('aria-expanded','false');});
        if(open){closePop();return;} b.setAttribute('aria-expanded','true'); openPop(b,g.list); };
      box.appendChild(b);
    });
  }
  var t=0; window.addEventListener('resize',function(){clearTimeout(t);t=setTimeout(layout,120);});
  var img=box.querySelector('img'); if(img.complete)layout(); else img.addEventListener('load',layout);
})();

/* Request a city: POST /api/city-request. The server checks everything again. */
(function(){
  var f=document.getElementById('reqform'); if(!f)return;
  var msg=document.getElementById('rq-msg'), btn=f.querySelector('button[type=submit]');
  var NAME=/^[\\p{L}\\p{M}][\\p{L}\\p{M} .,'’()-]*$/u;
  function err(id,text){ var el=document.getElementById(id), e=document.getElementById(id+'-err'); el.setAttribute('aria-invalid',text?'true':'false'); e.textContent=text||''; return !text; }
  function say(text,ok){ msg.textContent=text; msg.className='fmsg '+(ok?'ok':'bad'); }
  f.addEventListener('submit',function(e){
    e.preventDefault(); msg.textContent=''; msg.className='fmsg';
    var city=f.city.value.trim(), region=f.region.value.trim(), link=f.link.value.trim(), email=f.email.value.trim();
    var good=[
      err('rq-city',!city?'Which city?':city.length<2||city.length>60||!NAME.test(city)?'Letters and spaces only, up to 60.':''),
      err('rq-region',region&&(region.length>60||!NAME.test(region))?'Letters and spaces only, up to 60.':''),
      err('rq-link',link&&!/^https:\\/\\/[^\\s/?#]+\\.[^\\s]+$/i.test(link)?'A link that starts with https://':''),
      err('rq-email',email&&!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)?'That email doesn\\'t look right.':''),
    ].every(Boolean);
    if(!good){ f.querySelector('[aria-invalid=true]').focus(); return; }
    var pub=f.querySelector('input[name=publishes]:checked');
    btn.disabled=true;
    fetch('/api/city-request',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({city:city,region:region,publishes:pub?pub.value:'unsure',link:link,email:email,website:f.website.value})})
      .then(function(r){ return r.json().catch(function(){return {};}).then(function(d){return {r:r,d:d};}); })
      .then(function(x){
        if(x.r.ok){ f.reset(); say('Thanks. Your request is in, and it shows up on GitHub within the hour.',true); return; }
        if(x.d&&x.d.field&&document.getElementById('rq-'+x.d.field)){ err('rq-'+x.d.field,x.d.message||'Check this one.'); document.getElementById('rq-'+x.d.field).focus(); return; }
        say(x.r.status===429?'One request a minute, please. Try again soon.':(x.d&&x.d.message)||'Couldn\\'t send it. Try again.',false);
      })
      .catch(function(){ say('Couldn\\'t send it. Check your connection and try again.',false); })
      .then(function(){ btn.disabled=false; });
  });
})();
</script>`;

export function hubPage(facts) {
  const all = [{ ...SF, generated: null }, ...facts];
  const count = all.length;
  // the pins: San Francisco first (CURB's first city), then the biggest maps, so a merged pin is named after the biggest
  const order = [all[0], ...facts.slice().sort((a, b) => b.blocks - a.blocks || a.name.localeCompare(b.name))];
  const pins = order.map((x) => {
    const center = x.id === 'sf' ? SF.center : x.c.center;
    const [px, py] = project(center[1], center[0]);
    return `<a class="pin${x.id === 'sf' ? ' home' : ''}" href="${x.path}" style="left:${(px / MAP_W * 100).toFixed(2)}%;top:${(py / MAP_H * 100).toFixed(2)}%" data-name="${esc(x.name)}" aria-label="${esc(x.name)}${x.region ? ', ' + esc(x.region) : ''}: open the map"><i></i><span>${esc(x.name)}</span></a>`;
  }).join('\n      ');
  const byRegion = all.reduce((m, x) => { (m[x.region] ||= []).push(x); return m; }, {});
  const regions = Object.keys(byRegion).sort((a, b) => a.localeCompare(b));
  const card = (x) => {
    const srcs = x.id === 'sf' ? SF.sources : x.c.sources || [];
    const list = srcs.map((s) => { const href = linkOf(s);
      return `<li>${href ? `<a href="${esc(href)}" rel="noopener">${esc(s.name)}</a>` : esc(s.name)} · License: ${esc(s.license || 'not stated')}</li>`; }).join('');
    return `<article class="ccard" id="${x.id}">
          <div class="chead"><h4><a href="${x.path}">${esc(x.name)}</a></h4><a class="go" href="${x.path}" aria-label="Open the ${esc(x.name)} map">Open the map →</a></div>
          <div class="tags">${x.covers.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
          <p class="upd">${x.live ? 'Sweeping schedules live from DataSF' : `Data built ${esc(day(x.generated))}`} · <a href="${x.about}">How it works</a></p>
          <details><summary>Sources (${srcs.length})</summary><ul>${list}</ul></details>
        </article>`;
  };
  const listHtml = regions.map((r) => `<div class="region" id="${slug(r)}">
      <h3>${esc(r)}</h3>
      <div class="cgrid">
        ${byRegion[r].sort((a, b) => (a.id === 'sf' ? -1 : b.id === 'sf' ? 1 : a.name.localeCompare(b.name))).map(card).join('\n        ')}
      </div>
    </div>`).join('\n    ');
  const next = IN_PROGRESS.filter((x) => !PUBLIC.includes(x.id));
  const title = `Street Sweeping Maps for ${count} Cities | CURB`;
  const description = `Street sweeping and parking rules for ${count} cities, block by block: San Francisco, Los Angeles, New York, Chicago, Montréal and more. Free, from each city's open data.`;
  const ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Cities on CURB', numberOfItems: count,
    itemListElement: all.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: `${x.name}${x.region ? ', ' + x.region : ''}`, url: `https://curb.guide${x.path}` })) };
  const body = `  <section class="wrap hero" style="grid-template-columns:1fr">
    <div>
      <div class="k rise d1">CURB cities</div>
      <h1 class="rise d1">Know where to park in ${count} cities<span class="dot">.</span></h1>
      <p class="sub rise d2" style="max-width:38em">Street sweeping and parking rules, block by block, built on each city's open data.
        Free, no account. Tap a pin, or find your city below. <b>The posted sign always wins.</b></p>
      <div class="ctas rise d3"><a class="btn" href="#list">Find your city</a><a class="btn ghost" href="#request">Request a city</a></div>
    </div>
  </section>

  <section class="wrap">
    <div class="namap" id="namap">
      <img src="/basemap/north-america.svg?v=${ver('basemap/north-america.svg')}" width="${MAP_W}" height="${MAP_H}" alt="A map of the United States and southern Canada with a pin on every city CURB maps.">
      ${pins}
    </div>
    <p class="mapnote">Map outlines: Natural Earth (public domain).</p>
  </section>

  <section class="wrap sec" id="list">
    <div class="k">Every city</div>
    <h2>By state and province.</h2>
    <p class="lede">Each map shows every curb with a rule, colored by what's next, with alerts before it starts. Its sources are
      under each city, and its page says how the rule works there.</p>
    <nav class="jump" aria-label="States and provinces">${regions.map((r) => `<a href="#${slug(r)}">${esc(r)}</a>`).join('')}</nav>
    ${listHtml}
  </section>
${next.length ? `
  <section class="wrap sec" id="next">
    <div class="k">In progress</div>
    <h2>Coming next.</h2>
    <ul class="nextlist">
      ${next.map((x) => `<li><b>${esc(x.name)}, ${esc(x.region)}</b><span>${esc(x.note)}</span></li>`).join('\n      ')}
    </ul>
  </section>
` : ''}
  <section class="wrap sec" id="request">
    <div class="k">Request a city</div>
    <h2>Want CURB where you park?</h2>
    <p class="lede">Tell us the city. A city that publishes its street sweeping or parking schedule as open data is the
      quickest to map.</p>
    <form class="reqform" id="reqform" action="/api/city-request" method="post" novalidate>
      <div class="frow">
        <label for="rq-city">City <span class="req">required</span></label>
        <input type="text" id="rq-city" name="city" required maxlength="60" autocomplete="address-level2" aria-describedby="rq-city-err">
        <p class="ferr" id="rq-city-err"></p>
      </div>
      <div class="frow">
        <label for="rq-region">State, province or country</label>
        <input type="text" id="rq-region" name="region" maxlength="60" autocomplete="address-level1" aria-describedby="rq-region-err">
        <p class="ferr" id="rq-region-err"></p>
      </div>
      <fieldset class="frow">
        <legend>Does your city publish its street sweeping or parking schedule?</legend>
        <div class="opts">
          <label><input type="radio" name="publishes" value="yes"> Yes</label>
          <label><input type="radio" name="publishes" value="no"> No</label>
          <label><input type="radio" name="publishes" value="unsure" checked> Not sure</label>
        </div>
      </fieldset>
      <div class="frow">
        <label for="rq-link">A link to that data <span class="opt">optional</span></label>
        <input type="url" id="rq-link" name="link" maxlength="300" inputmode="url" placeholder="https://" aria-describedby="rq-link-err">
        <p class="ferr" id="rq-link-err"></p>
      </div>
      <div class="frow">
        <label for="rq-email">Your email <span class="opt">optional</span></label>
        <input type="email" id="rq-email" name="email" maxlength="254" autocomplete="email" aria-describedby="rq-email-hint rq-email-err">
        <p class="fhint" id="rq-email-hint">Only to tell you when it's live. Never published.</p>
        <p class="ferr" id="rq-email-err"></p>
      </div>
      <div class="hp" aria-hidden="true"><label for="rq-website">Leave this empty</label><input type="text" id="rq-website" name="website" tabindex="-1" autocomplete="off"></div>
      <button class="btn" type="submit">Request my city</button>
      <p class="fmsg" id="rq-msg" role="status" aria-live="polite"></p>
      <p class="fnote">Each request becomes a public issue on <a href="https://github.com/alevizio/curb/issues?q=label%3A%22city+request%22" rel="noopener">GitHub</a>
        with the city, the region, your answer and the link. Your email never does. <a href="/privacy">Privacy</a></p>
      <noscript><p class="fnote">The form needs JavaScript. Or open an issue on <a href="https://github.com/alevizio/curb/issues" rel="noopener">GitHub</a>.</p></noscript>
    </form>
  </section>`;
  return page({ path: '/cities', title, description, image: 'https://curb.guide/og.png?v=3', body, ld, script: HUB_SCRIPT, style: HUB_CSS });
}

// ---- write ----------------------------------------------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const facts = PUBLIC.map(cityFacts);
  for (const f of facts) {
    fs.mkdirSync(`${ROOT}${f.id}`, { recursive: true });
    fs.writeFileSync(`${ROOT}${f.id}/about.html`, aboutPage(f));
  }
  fs.writeFileSync(ROOT + 'cities.html', hubPage(facts));
  // their routes, next to the cities' own (scripts/cities/city-page.mjs writes /<id>)
  const vercel = read('vercel.json');
  const want = [{ source: '/cities', destination: '/cities.html' }, ...facts.map((f) => ({ source: `/${f.id}/about`, destination: `/${f.id}/about.html` }))];
  let changed = false;
  for (const r of want) if (!vercel.rewrites.some((x) => x.source === r.source)) {
    const at = vercel.rewrites.findIndex((x) => x.source === '/tickets');
    vercel.rewrites.splice(at < 0 ? vercel.rewrites.length : at, 0, r); changed = true;
  }
  if (changed) fs.writeFileSync(ROOT + 'vercel.json', JSON.stringify(vercel, null, 2) + '\n');
  console.error(`[city-pages] wrote cities.html and ${facts.length} about pages (${facts.map((f) => f.id + '/about.html').join(', ')})`);
}
