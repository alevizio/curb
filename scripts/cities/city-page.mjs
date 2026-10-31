#!/usr/bin/env node
// Builds each city's page (<id>.html, served at curb.guide/<id>) from index.html, for every city built by
// docs/multi-city/city-build.md (data/<id>/city.json + segments.json). The same checked edits as Boston's page
// (scripts/cities/boston-page.mjs), with the city's names, data and words filled in; Boston's own extras (the Curb
// Lab layers, its pages next to the map) are left out. Each edit must match exactly where it expects to (the build
// fails otherwise). Time and data come from lib/city.js with the city's entry in lib/city-configs.js.
//
// Not on these pages yet: meters, permits and other layers, ticket times, block and neighborhood pages, the iPhone
// app (alerts come from a Home Screen web app, as in Boston). The basemap is the parchment style drawn live from the
// city's vector file (scripts/cities/basemap-city.mjs), not PNG tiles.
//
// A public city (scripts/cities/public.mjs) is indexed: a real title and description from its facts, a canonical URL, its
// share card and a small JSON-LD block, and its welcome card and menu link to its readable page (/<id>/about,
// scripts/cities/city-pages.mjs). Every other city stays a preview: noindex and "(preview)" in its title.
//
// Also writes manifest-<id>.json and the page's rewrite in vercel.json (/<id> → /<id>.html).
// Run after a city's data changes: node scripts/cities/configs.mjs && node scripts/cities/city-page.mjs [id ...]
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import '../../lib/city-configs.js';
import { isPublic, seoWords, jsonLd } from './public.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = fs.readFileSync(ROOT + 'index.html', 'utf8');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const js = (s) => JSON.stringify(String(s ?? ''));   // a JS string literal
const tpl = (s) => esc(s).replace(/`/g, '&#96;').replace(/\$\{/g, '$&#123;');   // inside the page's template strings
// The scripts' ?v= follows their content: the service worker serves a cached copy of the same URL first, which would
// miss a city added since (or lib/city.js's last change).
const ver = (f) => createHash('sha1').update(fs.readFileSync(ROOT + f)).digest('hex').slice(0, 8);
const CONFIGS_V = ver('lib/city-configs.js'), CITY_V = ver('lib/city.js'), FR_V = ver('lib/i18n-fr.js'), WINTER_V = ver('lib/winter-ui.js');
// The basemap (scripts/cities/basemap-city.mjs): the parchment style, drawn live by MapLibre from the city's one vector file.
const BASEMAPS = fs.existsSync(ROOT + 'basemap/cities/index.json') ? JSON.parse(fs.readFileSync(ROOT + 'basemap/cities/index.json', 'utf8')) : {};
const STYLE_V = fs.existsSync(ROOT + 'basemap/cities/style.json') ? ver('basemap/cities/style.json') : '';
const MAPLIBRE = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.js';
const PMTILES = 'https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/dist/pmtiles.js';
const MAPLIBRE_LEAFLET = 'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js';

function cityPage(id) {
  const c = JSON.parse(fs.readFileSync(`${ROOT}data/${id}/city.json`, 'utf8'));
  const data = JSON.parse(fs.readFileSync(`${ROOT}data/${id}/segments.json`, 'utf8'));
  // "<City> open data" links to a page a person can read: city.json's portal, else the first source with a page (not an
  // API address like a FeatureServer), else the City's sweeping page
  const readable = (u) => typeof u === 'string' && /^https:/.test(u) && !/\/rest\/services\/|FeatureServer|MapServer|\/resource\/|\/api\/|\.(json|csv|zip|pdf)(\?|$)/i.test(u);
  const name = c.name, url = 'https://curb.guide/' + id,
    portal = c.portal || (c.sources || []).flatMap((x) => [x.page, x.url]).find(readable) || c.scheduleUrl || '';
  const words = c.words || {};
  const bm = BASEMAPS[id];   // its vector basemap, if built
  const pub = isPublic(id);   // a public city (scripts/cities/public.mjs), else a preview
  // A city that offers French (city.json languages + words_fr): lib/i18n-fr.js translates the page, and the ⓘ menu
  // switches language. The city's own sentences go in as phrases, the way the page composes them.
  const french = (c.languages || []).includes('fr') && c.words_fr;
  const frWords = french ? [[words.rule, c.words_fr.rule], [' Tap where you parked for the rules.', ' Touchez la bordure où vous êtes stationné pour voir les règles.'],
    ...(pub ? [[' Built on the City\'s open data.', ' Fait avec les données ouvertes de la Ville.']] : []),
    [words.afterpass, c.words_fr.afterpass], [words.dataNotes, c.words_fr.dataNotes]].filter(([en, f]) => en && f) : [];
  // A city with a winter rule (city.json `winter`: Madison) gets lib/winter-ui.js: the plate under the day chips, tonight's
  // sides on the map and in the sheet, and alerts that can be on before the City turns the rule on (design A, 2026-10-18).
  const winter = !!c.winter;
  // Blocks swept per weekday, for the day-chip heads-up (weekly rules by weekday; listed dates by their weekday). A winter
  // rule (flag 4) is not a sweep: it closes a side every other night.
  const perDay = [0, 1, 2, 3, 4, 5, 6].map((d) => data.b.filter((b) => b.d.some(([, , rules]) => rules.some((r) => !(r[5] & 4) && (
    r[0] === d || (r[0] === -1 && Array.isArray(r[6]) && r[6].some((iso) => new Date(iso + 'T12:00:00Z').getUTCDay() === d)))))).length);
  // The welcome card's neighborhood list: city.json's, else framed from the blocks' neighborhoods (2nd to 98th percentile)
  // when most blocks name one (a list of the few a partial layer covers would read as the whole city).
  let hoods = c.neighborhoods || null;
  if (!hoods && data.b.filter((b) => b.h).length < 0.8 * data.b.length) hoods = [];
  if (!hoods) {
    const by = data.b.reduce((m, b) => { if (b.h) (m[b.h] ||= []).push(...b.g); return m; }, {});
    hoods = Object.entries(by).filter(([, pts]) => pts.length >= 20).sort(([a], [b]) => a.localeCompare(b)).map(([n, pts]) => {
      const sorted = (k) => pts.map((p) => p[k]).sort((a, b) => a - b), at = (v, q) => v[Math.floor(q * (v.length - 1))];
      const lo = sorted(0), la = sorted(1);
      return { name: n, bbox: [at(lo, 0.02), at(la, 0.02), at(lo, 0.98), at(la, 0.98)].map((v) => v.toFixed(4)).join(',') };
    });
  }
  // An example address for the search hint: a numbered block of the street with the most blocks.
  const count = data.b.reduce((m, b) => (b.n ? m.set(b.s, (m.get(b.s) || 0) + 1) : m), new Map());
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  const ex = top ? data.b.find((b) => b.s === top[0] && b.n) : null;
  const example = ex ? `${ex.n[0] % 2 ? ex.n[0] : ex.n[0] + 1} ${ex.s}` : (data.b[0] && data.b[0].s) || 'Main St';
  const rule = words.rule || `Every swept curb in ${name}, colored by its next street sweep.`;
  // What the map is about: street sweeping (every city so far) or another rule (Milwaukee: "night parking", city.json
  // words.what), for the title, descriptions, share text and the words for an empty area. A city with no sweeping has no day
  // chips: they filter sweeps by weekday.
  const what = words.what || 'street sweeping', sweeps = what === 'street sweeping';
  const What = what.replace(/\b\w/g, (ch) => ch.toUpperCase()), Cap = what.charAt(0).toUpperCase() + what.slice(1);
  const noRule = sweeps ? 'No street-sweeping schedule here' : `No ${what} rule here`;
  // A public city: indexed, with its own title, description and JSON-LD; a preview says so.
  const seo = seoWords(c), mapWord = pub ? 'map' : 'preview';
  const ld = { '@context': 'https://schema.org', '@type': 'WebApplication', name: `CURB ${name}`, url,
    applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any (web browser)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, isAccessibleForFree: true,
    description: seo.description, image: `https://curb.guide/og-${id}.png?v=1`,
    areaServed: { '@type': 'City', name: c.region ? `${name}, ${c.region}` : name },
    publisher: { '@type': 'Organization', name: 'CURB', url: 'https://curb.guide/' } };

  // What a map without sweeping shows of each curb (Milwaukee: tonight's side), or the city's own words for it (Toronto:
  // words.tagline, "snow routes and ...")
  const shows = words.tagline || "tonight's side of every curb", showsShort = words.tagline || "tonight's side";
  const alertsWord = words.tagline ? 'with alerts' : 'with an alert the night your side closes';
  // A city with no parking rules that are not sweeps (flag 32: Toronto's North York night ban): its alerts keep the flag,
  // and the page says "no parking" where it would say swept
  const bans = data.b.some((b) => b.d.some(([, , rules]) => rules.some((r) => r[5] & 32))), flagMask = bans ? 61 : 29;
  // The credit line a City asks for (Toronto: its Open Government Licence), in the menu and the welcome card
  const credit = c.credit || '';

  const edits = [
    // ---- head --------------------------------------------------------------------------------------
    ['title + noindex', '<title>SF Street Cleaning Map: When Tickets Actually Land | CURB</title>', pub ? `<title>${esc(seo.title)}</title>`
      : `<title>${esc(name)} ${sweeps ? 'Street Cleaning' : esc(What)} Map (preview) | CURB</title>\n<meta name="robots" content="noindex">`],
    ['description', /<meta name="description" content="[^"]*">/, pub ? `<meta name="description" content="${esc(seo.description)}">`
      : `<meta name="description" content="${esc(name)} ${sweeps ? 'street sweeping, block by block: every swept curb colored by its next sweep' : `${esc(what)}, block by block: ${esc(shows)}`}, from the City's open data. A CURB preview.">`],
    ['canonical', '<link rel="canonical" href="https://curb.guide/">', `<link rel="canonical" href="${url}">`],
    ['no SF app schema', /<script type="application\/ld\+json">[\s\S]*?<\/script>\n/, pub ? `<script type="application/ld+json">\n${jsonLd(ld)}\n</script>\n` : ''],
    // Safari's App Store banner offers the San Francisco app: not on a city's page (its links are hidden below too)
    ['no SF app banner', '<meta name="apple-itunes-app" content="app-id=6780998238">\n', ''],
    ['card titles', 'Know where to park in SF', `Know where to park in ${esc(name)}`, 2],
    ['card description', '<meta property="og:description" content="Street parking rules block by block: sweeping schedules, permit zones & move-your-car alerts. From SF open data.">',
      `<meta property="og:description" content="${sweeps ? 'Street sweeping block by block, with alerts before the sweeper comes' : `${esc(Cap)} block by block, ${alertsWord}`}. From ${esc(name)} open data.">`],
    ['card description (X)', '<meta name="twitter:description" content="Street parking rules block by block: sweeping schedules, permit zones & move-your-car alerts.">',
      `<meta name="twitter:description" content="${esc(name)} ${sweeps ? 'street sweeping block by block, with alerts before the sweeper comes' : `${esc(what)} block by block, ${alertsWord}`}.">`],
    ['card url', '<meta property="og:url" content="https://curb.guide/">', `<meta property="og:url" content="${url}">`],
    ['card image', '<meta property="og:image" content="https://curb.guide/og.png?v=3">', `<meta property="og:image" content="https://curb.guide/og-${id}.png?v=1">`],
    ['card image words', '<meta property="og:image:alt" content="CURB: SF street parking map with green, amber and red curb lines showing sweeping status">',
      `<meta property="og:image:alt" content="CURB ${esc(name)}: Know where to park in ${esc(name)}">`],
    ['card image (X)', '<meta name="twitter:image" content="https://curb.guide/og.png?v=3">', `<meta name="twitter:image" content="https://curb.guide/og-${id}.png?v=1">`],
    ['card image words (X)', '<meta name="twitter:image:alt" content="CURB: SF street parking map with colored curb lines">',
      `<meta name="twitter:image:alt" content="CURB ${esc(name)}: Know where to park in ${esc(name)}">`],
    ['info button words', 'data-tip="Alerts, guide, tickets &amp; about"', 'data-tip="Alerts, guide &amp; about"'],
    // ---- body: words and menus ---------------------------------------------------------------------
    ['h1', /<h1 class="srh">[^<]*<\/h1>/, pub ? `<h1 class="srh">${esc(name)} ${esc(seo.term)} map: ${sweeps ? 'the next sweep' : esc(showsShort)} on every block, with alerts</h1>`
      : `<h1 class="srh">${esc(name)} ${sweeps ? 'street cleaning map: sweeping schedules' : `${esc(what)} map: ${esc(showsShort)}`} by block (a CURB preview)</h1>`],
    ['map label', '<main id="map" aria-label="San Francisco parking map">', `<main id="map" aria-label="${esc(name)} parking map">`],
    // SF's three pages: here the neighborhood list (in the welcome card), when the city has one
    ['SF pages → neighborhoods', /<a class="im-item" href="\/n\/" role="menuitem">[\s\S]*?<a class="im-item" href="\/tickets" role="menuitem">[\s\S]*?<\/a>/,
      hoods.length ? `<button class="im-item" id="imHoods" role="menuitem">
          <span class="im-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg></span>
          <span class="im-tx"><b>Neighborhoods</b><small>${sweeps ? 'Street cleaning' : esc(Cap)} by ${esc(name)} neighborhood</small></span>
        </button>` : ''],
    ['menu footer link', '<a href="https://datasf.org" target="_blank" rel="noopener">SF open data</a>', `<a href="${esc(portal)}" target="_blank" rel="noopener">${esc(name)} open data</a>`],
    ['menu footer', 'Built on SF open data (DataSF). The posted sign is always the final word.',
      `${credit ? esc(credit) : `Built on ${esc(name)} open data.`} The posted sign is always the final word.`],
    // no layers yet: SF's four tiles and its permit areas are hidden (their handlers are SF code)
    ['no permit tile', '<button class="ltile" id="rppToggle" aria-pressed="false">', '<button class="ltile" id="rppToggle" aria-pressed="false" style="display:none">'],
    ['no loading tile', '<button class="ltile" id="loadToggle" aria-pressed="false">', '<button class="ltile" id="loadToggle" aria-pressed="false" style="display:none">'],
    ['no meter tile', '<button class="ltile" id="meterToggle" aria-pressed="false">', '<button class="ltile" id="meterToggle" aria-pressed="false" style="display:none">'],
    ['no truck routes', '<button class="ltile" id="routeToggle" aria-pressed="false">', '<button class="ltile" id="routeToggle" aria-pressed="false" style="display:none">'],
    ['no layer tiles heading', '<div class="lp-sec">Map details</div>', '<div class="lp-sec" style="display:none">Map details</div>'],
    ['no permit areas', '<div class="lp-sec">Permit areas</div>\n    <div class="arearow">', '<div class="lp-sec" style="display:none">Permit areas</div>\n    <div class="arearow" style="display:none">'],
    ['welcome', /<p>Every curb in SF, colored by[\s\S]*?<\/p>/, pub ? `<p>${esc(rule)} Tap where you parked for the rules. Built on the City's open data.</p>`
      : `<p>${esc(rule)} Tap where you parked for the rules. <b>A preview</b>, built on the City's open data.</p>`],
    ['neighborhoods', /<!-- hoods:start[\s\S]*?<!-- hoods:end -->/, hoods.length ? `<nav class="whoods" aria-label="${sweeps ? 'Street cleaning' : esc(Cap)} by neighborhood"><p>${sweeps ? 'Street cleaning' : esc(Cap)} by neighborhood</p><ul>`
      + hoods.map((h) => `<li><a href="/${id}?bbox=${h.bbox}" data-bbox="${h.bbox}">${esc(h.name)}</a></li>`).join('') + '</ul></nav>' : ''],
    ['neighborhood links frame the map', "  if(!EMBED&&!onboarded())setTimeout(()=>{try{localStorage.setItem('curbOnboarded','1');}catch(_){}},0);\n})();\n", `  if(!EMBED&&!onboarded())setTimeout(()=>{try{localStorage.setItem('curbOnboarded','1');}catch(_){}},0);
})();
${hoods.length ? `document.getElementById('imHoods').onclick=()=>{ closeInfoMenu(); showWelcome(); document.querySelector('.whoods')?.scrollIntoView({block:'nearest'}); };
document.querySelector('.whoods')?.addEventListener('click',e=>{
  const a=e.target.closest('a[data-bbox]'); if(!a)return;
  e.preventDefault(); markOnboarded(); userPicked();
  const [w,s,ea,n]=a.dataset.bbox.split(',').map(Number); map.fitBounds([[s,w],[n,ea]],{padding:[18,18]});
});
` : ''}`],
    ['welcome footer', /<p class="wfoot">[\s\S]*?<\/p>/,
      credit ? `<p class="wfoot">Free, no account. <a href="${esc(c.creditUrl || portal)}" target="_blank" rel="noopener">${esc(credit.replace(/\.$/, ''))}</a>. The posted sign always wins.</p>`
        : `<p class="wfoot">Free, no account. Built on <a href="${esc(portal)}" target="_blank" rel="noopener">${esc(name)}'s open data</a>. The posted sign always wins.</p>`],
    // ---- scripts: the city's time core and data (lib/city.js) -----------------------------------------
    ['load the city', '<script src="/lib/sweep-core.js?v=8"></script>',
      `<script src="/lib/sweep-core.js?v=8"></script>\n<script>window.CURB_CITY=${js(id)};</script>\n<script src="/lib/city-configs.js?v=${CONFIGS_V}"></script>\n<script src="/lib/city.js?v=${CITY_V}"></script>`
      + (winter ? `\n<script src="/lib/winter-ui.js?v=${WINTER_V}"></script>` : '')
      + (french ? `\n<script src="/lib/i18n-fr.js?v=${FR_V}"></script>\n<script>window.CURB_FR&&CURB_FR.startI18n(${JSON.stringify(frWords).replace(/</g, '\\u003c')});</script>` : '')],
    ['the language item', '        <button class="im-item" id="imAlerts" role="menuitem">', (french ? `        <button class="im-item" id="imLang" role="menuitem" data-no-i18n>
          <span class="im-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/></svg></span>
          <span class="im-tx"><b>Français</b><small>Voir la carte en français</small></span>
        </button>
` : '') + '        <button class="im-item" id="imAlerts" role="menuitem">'],
    ['retry it like the time core', "if(!window.nextSweep)again('script[src^=\"/lib/sweep-core.js\"]');}",
      "if(!window.nextSweep)again('script[src^=\"/lib/sweep-core.js\"]');\nif(window.nextSweep&&!window.CITY_CONFIGS)again('script[src^=\"/lib/city-configs.js\"]');\nif(window.nextSweep&&!window.PLACE)again('script[src^=\"/lib/city.js\"]');}"],
    ['fail without it', 'if(!window.L||!window.nextSweep){', 'if(!window.L||!window.nextSweep||!window.PLACE){'],
    // ---- basemap: no PNG tiles (thousands of files a city) and never CARTO (its keyless tiles say "API KEY REQUIRED") --
    ['basemap: no raster tiles', "const SELF_BASEMAP='/basemap/parchment/{z}/{x}/{y}.png';", "const SELF_BASEMAP='';  // this city has no PNG tiles: addCityBasemap draws its vector file"],
    ['basemap: drawn live', '(async function initBasemap(){\n  if(SELF_BASEMAP){ addSelfBasemap(); return; } // self-hosted parchment raster ($0)',
      `// The city's basemap: the parchment style SF's tiles are baked from (basemap/cities/style.json), drawn live by MapLibre
// from the city's one vector file (scripts/cities/basemap-city.mjs). It loads after the curbs; without WebGL or the
// libraries the map keeps its paper and the curbs.
const CITY_BASEMAP=${js(bm ? `/basemap/cities/${id}.pmtiles?v=${bm.build}${bm.rev ? '-' + bm.rev : ''}` : '')};
function addCityBasemap(){
  const load=(src)=>new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>no(new Error('could not load '+src));document.head.appendChild(s);});
  return load(${js(MAPLIBRE)})
    .then(()=>Promise.all([load(${js(PMTILES)}),load(${js(MAPLIBRE_LEAFLET)}),fetch('/basemap/cities/style.json?v=${STYLE_V}').then(r=>r.json())]))
    .then(([,,style])=>{
      const protocol=new pmtiles.Protocol();maplibregl.addProtocol('pmtiles',protocol.tile);
      style.sources.protomaps.url='pmtiles://'+new URL(CITY_BASEMAP,location.href).href;
      L.maplibreGL({style,interactive:false,attribution:'&copy; OpenStreetMap &copy; Protomaps'}).addTo(map);
    }).catch(e=>console.warn('basemap:',e&&e.message));
}
(async function initBasemap(){
  if(CITY_BASEMAP)addCityBasemap();
  return; // never the Google/CARTO path below`],
    ['basemap origins', '<link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossorigin>', '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>'],
    ['basemap origins, 2', '<link rel="preconnect" href="https://a.basemaps.cartocdn.com">', '<link rel="preconnect" href="https://protomaps.github.io" crossorigin>'],
    ['start in the city', '.setView([37.7749,-122.4194],15);', '.setView(PLACE.CENTER,PLACE.ZOOM);'],
    ['blocks from the static file', /async function loadViewport\(\)\{[\s\S]*?\n\}\n(?=\n\/\* ---------- citywide overview)/, `async function loadViewport(){
  const z=map.getZoom(), hint=document.getElementById('hint');
  if(z<MIN_ZOOM_DATA){enterOverviewMode(true);return;}
  const b=map.getBounds().pad(0.15);
  const my=++fetchTok;
  // The city's blocks are one static file (docs/multi-city/city-build.md), filtered here instead of a DataSF query.
  let blocks;
  try{ blocks=await PLACE.load(); }
  catch(e){ if(my===fetchTok){ toast("Couldn't load the curbs. Pan and try again."); curbReport('data-load', String((e&&e.message)||e)); } return; }
  if(my!==fetchTok)return;
  if(!placeRanges){ placeRanges=true; blocks.forEach(x=>{ if(x.n)rangeCache[x.c]={lo:x.n[0],hi:x.n[1]}; }); }
  const data=PLACE.rowsIn(blocks,b.getWest(),b.getSouth(),b.getEast(),b.getNorth());
  if(placeSides(data)>SEG_CAP){enterOverviewMode(false);return;}  // SF's cap, in curb sides: a wide z15 window stays on the overview
  ovMode=false;
  if(map.hasLayer(overviewLayer)){ovrDrawTok++;map.removeLayer(overviewLayer);}
  hint.style.opacity='0';hint.style.visibility='hidden';
  lastRows=data; segBounds=b;
  if(!data.length&&!noCovToasted){noCovToasted=true; toast(${js(`${noRule}. This ${mapWord} covers ${name}.`)});}
  drawSegments(data);
  tryPendingOpen();
}
let placeRanges=false;
// SF's cap counts rows, about one per curb side there; a city with several rules a side counts sides.
const placeSides=rows=>new Set(rows.map(r=>r.cnn+r.cnnrightleft)).size;
`],
    ['overview from the same file', /async function ensureOverview\(\)\{[\s\S]*?return OVR;\n\}/, `async function ensureOverview(){
  if(OVR)return OVR;
  OVR=PLACE.overview(await PLACE.load());
  return OVR;
}`],
    ['overview draws real lines', 'L.polyline([b.a,b.z],{renderer:overviewRenderer,', 'L.polyline(b.g,{renderer:overviewRenderer,'],
    ['house numbers from the file', /async function fillRange\(cnn\)\{[\s\S]*?\n\}\n/, `async function fillRange(cnn){
  const el=document.getElementById('rangeSlot');
  if(el&&cnn&&rangeCache[cnn])el.textContent=fmtRange(cnn);
}
`],
    ['no SF ticket, sweeper or route files', /loadEnforcement\(\);[^\n]*\nloadSweeps\(\);[^\n]*\nloadRoutes\(\);[^\n]*\n/, ''],
    ['no SF meter or permit lookups in the sheet', '  loadMeterBlock(active.latlngs, group.cnn);\n  loadRppBlock(active.latlngs, active.mid, group.cnn);\n', ''],
    ['no SF permit-area list', "buildAreaDrop(document.getElementById('areaDropPanel'),'Browse an area…');", ''],
    ['no SF permit-area fetch', /  \(async\(\)=>\{\n    try\{\n      const r=await fetch\(RPP\+`\?\$select=rpparea1,count\(\*\) as n[\s\S]*?\}\)\(\);\n/, ''],
    // ---- rules on listed dates (Chicago, Saint Paul, Norfolk…): the next date where SF shows the weekday ---------
    ['a listed date in the badge', "function dayTag(r){return isHolidayRow(r)?'HOLIDAYS':",
      "function dayTag(r){if(Array.isArray(r.dates)){const n=nextSweep(r);return n?(MONLBL[n.mo-1]+' '+n.da).toUpperCase():'NO MORE DATES';}return isHolidayRow(r)?'HOLIDAYS':"],
    ['no week boxes for listed dates', "${allW||hol?'':`<div class=\"weeks\">${wkHtml}</div>`}", "${allW||hol||r.dates?'':`<div class=\"weeks\">${wkHtml}</div>`}"],
    ['the dates after the next one', "${ns.holiday?'holiday schedule':freqLabel(_aw)}", "${ns.holiday?'holiday schedule':_ar.dates?datesAfter(_ar,ns):freqLabel(_aw)}"],
    ['dates after: words', 'function freqLabel(weeks){', `// the city's date today ("YYYY-MM-DD"): an alert carries a listed rule's dates from today on, a year of them fits
function todayISO(){const p=sfTodayParts();return p.y+'-'+String(p.mo).padStart(2,'0')+'-'+String(p.da).padStart(2,'0');}
// a rule on listed dates: the dates after this one ("then Nov 2 and Nov 16"), or that it is the last
function datesAfter(r,ns){const iso=ns.y+'-'+String(ns.mo).padStart(2,'0')+'-'+String(ns.da).padStart(2,'0');
  const later=r.dates.filter(d=>d>iso).slice(0,2).map(d=>MONLBL[+d.slice(5,7)-1]+' '+(+d.slice(8,10)));
  return later.length?'then '+later.join(' and '):'the last date posted';}
function freqLabel(weeks){`],
    ['alerts carry dates and the holiday flag', "holidays:r.holidays||'0',...(r.months?{months:r.months}:{})});",
      `holidays:r.holidays||'0',...(r.months?{months:r.months}:{}),...(r.dates?{dates:r.dates.filter(d=>d>=todayISO())}:{}),...(r.flags&${flagMask}?{flags:r.flags&${flagMask}}:{})});`],
    // ---- the block sheet ----------------------------------------------------------------------------
    ['season and fine instead of the SF re-park rule',
      "${_soon?`<div class=\"afterpass\">Once the sweeper has passed, you can re-park here, even before the posted window ends. <a href=\"https://www.sfmta.com/getting-around/drive-park/how-avoid-parking-tickets\" target=\"_blank\" rel=\"noopener\">SFMTA rule ↗</a></div>`:''}",
      (bans ? '<div class="afterpass">' : "<div class=\"afterpass\">${PLACE.seasonText(_ar&&_ar.months)?'Swept '+PLACE.seasonText(_ar.months)+'. ':''}") + tpl(words.afterpass || (c.fine ? `Usually a ${c.fine} ticket.` : '')) + '</div>'],
    ['data notes', /<p>\$\{ae\?'"Ticketed" times[\s\S]*?Schedules live from DataSF\.<\/p>/,
      `<p>${tpl(words.dataNotes || `Sweeping schedules come from ${name}'s open data.`)} ${words.alerts ? tpl(words.alerts) : `${sweeps ? 'Sweep alerts' : 'Alerts'} and calendar reminders run on ${tpl(name)} time: ${sweeps ? 'an overnight sweep gets' : 'a night your side closes gets'} one alert around 9 PM the evening before.`}</p>`],
    // ---- sweep alerts: the shared sender, each spot with its city (lib/cities.js) --------------------------------
    ['this page is the city', "const CITY='sf', WATCH_AGES={boston:165*864e5}, CITY_NAME={sf:'San Francisco',boston:'Boston'}, CITY_PAGE={sf:'/',boston:'/boston'};",
      `const CITY=${js(id)}, WATCH_AGES={boston:165*864e5,[${js(id)}]:165*864e5}, CITY_NAME={sf:'San Francisco',boston:'Boston',[${js(id)}]:${js(name)}}, CITY_PAGE={sf:'/',boston:'/boston',[${js(id)}]:${js('/' + id)}};`],
    // ---- block ids: a city's own ids can carry letters and dashes (San Diego "SS-018818"), SF's are digits ------------
    ['alert curbs: the city\'s ids', "const cnns=[...new Set(list.map(a=>a.cnn).filter(c=>/^\\d{1,12}$/.test(c)))];",
      "const cnns=[...new Set(list.map(a=>String(a.cnn||'')).filter(c=>/^[A-Za-z0-9_.:-]{1,40}$/.test(c)))];"],
    ['show on map: the city\'s ids', "if(!/^\\d{1,12}$/.test(a.cnn))return;", "if(!/^[A-Za-z0-9_.:-]{1,40}$/.test(String(a.cnn||'')))return;"],
    ['shared links: the city\'s ids', "const m=location.search.match(/[?&]b=(\\d+)/); if(!m)return;\n  openCurb(m[1],QS.get('side')||'');",
      "const b=QS.get('b'); if(!b||!/^[A-Za-z0-9_.:-]{1,40}$/.test(b))return;\n  openCurb(b,QS.get('side')||'');"],
    ['alert curbs from the file', /  const where=`cnn in\(\$\{cnns\.map[\s\S]*?const rows=await r\.json\(\), now=new Date\(\), out=\{\};/,
      '  const rows=(await PLACE.load()).filter(b=>cnns.includes(String(b.c))).flatMap(PLACE.rowsOf), now=new Date(), out={};'],
    ['no SF ticket file for the alerts panel', "    await loadEnforcement();  // the ticket-time tip rides in each spot, as from a sheet\n", ''],
    ['iPhone: Home Screen alerts', '<p style="font-size:13.5px;color:var(--ink-soft);line-height:1.45">The free CURB app for iPhone turns on alerts with one tap.</p>\n    <a class="btn ios-get" id="iosGet" href="https://apps.apple.com/app/id6780998238" target="_blank" rel="noopener">Get the free iPhone app</a>\n    <a class="ios-play" id="iosPlay" href="/android">Android beta: join on Google Play</a>\n    <p class="ios-or">Or add this site to your Home Screen:</p>',
      '<a class="btn ios-get" id="iosGet" href="https://apps.apple.com/app/id6780998238" hidden>Get the free iPhone app</a>\n    <p class="ios-or">Add this map to your Home Screen to get alerts on iPhone:</p>'],
    ['iPhone panel card: Home Screen', "Alerts need the app</b><p>Safari on iPhone can't show CURB's alerts. Get the free app, or add this site to your Home Screen.</p><a class=\"btn ios-get\" href=\"https://apps.apple.com/app/id6780998238\" target=\"_blank\" rel=\"noopener\">Get the free iPhone app</a><a class=\"ios-play\" href=\"/android\">Android beta: join on Google Play</a></div>`;",
      "Add CURB to your Home Screen</b><p>Safari on iPhone shows alerts only from a Home Screen web app: tap Share, then Add to Home Screen, and turn alerts on from there.</p></div>`;"],
    ['web app', '<link rel="manifest" href="manifest.json">', `<link rel="manifest" href="manifest-${id}.json">`],
    ['report: city link', "(group.cnn?'  ·  curb.guide/b/'+group.cnn:'')", `(group.cnn?'  ·  curb.guide/${id}?b='+group.cnn:'')`],
    ['report: say the city', "const _repBlock = (group.corridor||'')", `const _repBlock = ${js(name + ': ')}+(group.corridor||'')`],
    ['calendar place name', "group.corridor||'SF'", `group.corridor||${js(name)}`, 2],
    ['share: city link', "const url=location.origin+'/b/'+group.cnn+(active.blockside?'?side='+encodeURIComponent(active.blockside):'');",
      `const url=location.origin+'/${id}?b='+group.cnn+(active.blockside?'&side='+encodeURIComponent(active.blockside):'');`],
    ['share: a listed date', "sweeps ${isHolidayRow(r0)?'on holidays':DAYLBL[normDay(r0.weekday)]||r0.weekday}",
      "sweeps ${isHolidayRow(r0)?'on holidays':r0.dates?dayTag(r0).toLowerCase():DAYLBL[normDay(r0.weekday)]||r0.weekday}"],
    ['calendar time zone', "'&ctz=America/Los_Angeles'", `'&ctz=${c.tz}'`],
    ['calendar id', "'PRODID:-//CURB//SF Sweeping//EN'", `'PRODID:-//CURB//${name.replace(/[^A-Za-z ]/g, '')} Sweeping//EN'`],
    // ---- links, search, locate ------------------------------------------------------------------------
    ['open a block from the file', /async function openCurb\(cnn,side\)\{[\s\S]*?\n\}\n/, `async function openCurb(cnn,side){
  try{
    const b=(await PLACE.load()).find(x=>String(x.c)===String(cnn)); if(!b)return;
    const mid=PLACE.midpoint(b.g);
    map.setView([mid[1],mid[0]],17);
    openWhenLoaded(mid[1],mid[0],cnn,700,side);
  }catch(_){}
}
`],
    ['the little car from the file', /async function carRows\(cnn\)\{[\s\S]*?\n\}\n/,
      'async function carRows(cnn){\n  return (await PLACE.load()).filter(b=>String(b.c)===String(cnn)).flatMap(PLACE.rowsOf);\n}\n'],
    ['the little car: the city\'s ids', "if(QS.get('car')!=='1'||!b||!/^\\d{1,12}$/.test(b))return;", "if(QS.get('car')!=='1'||!b||!/^[A-Za-z0-9_.:-]{1,40}$/.test(b))return;"],
    ['outside the city', "'No street-sweeping data here. CURB covers San Francisco.'", js(`${noRule}. This ${mapWord} covers ${name}.`)],
    ['the city is the city', 'L.latLngBounds([[37.685,-122.56],[37.84,-122.34]])', 'L.latLngBounds(PLACE.BOUNDS)'],
    ['outside words', "You're outside San Francisco, and this map only covers San Francisco.", `You're outside ${name}, and this ${mapWord} only covers ${name}.`],
    ['one tap opens a block', "map.on('click',e=>{ userPicked(); if(ovMode){map.flyTo(e.latlng,17,{duration:.6});return;} placeYou(e.latlng.lat,e.latlng.lng,false);});",
      "map.on('click',e=>{ userPicked(); placeYou(e.latlng.lat,e.latlng.lng,ovMode);});"
      + `\nconst ovSide=o=>{ const by={}; let side=null; (o.rules||[]).forEach(r=>{(by[sideKeyOf(r)]=by[sideKeyOf(r)]||[]).push(r);});
  for(const k in by){ const {best,bestRow}=sideNext(by[k]); if(best&&(!side||+best.start<+side.ns.start))side={key:k,blockside:by[k][0].blockside,rows:by[k],row:bestRow,ns:best,mid:o.a}; }
  return side; };
if(CAN_HOVER){
  let ovTip=null, ovOn=null, ovT=0;
  const hideOvTip=()=>{ if(ovTip){map.removeLayer(ovTip);ovTip=null;ovOn=null;} };
  map.on('mousemove',e=>{
    if(!ovMode||!ovrLines){hideOvTip();return;}
    const t=Date.now(); if(t-ovT<40)return; ovT=t;
    const p=e.containerPoint, sw=map.containerPointToLatLng([p.x-8,p.y+8]), ne=map.containerPointToLatLng([p.x+8,p.y-8]);
    let best=null, bd=64;
    for(const {b:o,ln} of ovrLines){ const q=o.bb; if(!ln.options.opacity||q[2]<sw.lng||q[0]>ne.lng||q[3]<sw.lat||q[1]>ne.lat)continue;
      for(let i=1;i<o.g.length;i++){ const a=map.latLngToContainerPoint(o.g[i-1]), z=map.latLngToContainerPoint(o.g[i]), dx=z.x-a.x, dy=z.y-a.y, l2=dx*dx+dy*dy;
        const u=l2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2)):0, d=(p.x-a.x-u*dx)**2+(p.y-a.y-u*dy)**2;
        if(d<bd){bd=d;best=o;} } }
    const side=best&&ovSide(best); if(!side){hideOvTip();return;}
    if(!ovTip)ovTip=L.tooltip({direction:'top',offset:[0,-12],opacity:1,className:'curbtip'}).setLatLng(e.latlng).addTo(map);
    ovTip.setLatLng(e.latlng);
    if(ovOn!==best){ ovOn=best; const r0=best.rules[0]; ovTip.setContent(previewHtml({cnn:r0.cnn,corridor:r0.corridor,limits:r0.limits},side));
      const el=ovTip.getElement(); if(el){el.classList.remove('now','soon','ok');el.classList.add(verdictClass(side.ns));} }
  });
  map.on('mouseout movestart zoomstart',hideOvTip);
}`],
    ['street list from the file', /async function ensureCorridors\(\)\{[\s\S]*?\n\}\n/, `async function ensureCorridors(){
  if(corridors)return;
  try{ corridors=PLACE.streets(await PLACE.load()); }catch(_){corridors=null;}
}
`],
    ['no match words', 'No matching SF street. Try an address like “214 Steiner St”.', `No matching ${name} street. Try an address like “${example}”.`],
    ['suggestions: city addresses', /async function updateSug\(\)\{[\s\S]*?\n\}\n(?=document\.getElementById\('q'\)\.addEventListener\('keydown')/, `async function updateSug(){
  const v=document.getElementById('q').value.trim();
  if(v.length<2){hideSug();return;}
  await ensureCorridors();
  const items=[], m=v.match(/^(\\d{1,5})\\s+(.+)$/);
  if(m){ try{ const hit=PLACE.findAddress(await PLACE.load(),m[1],m[2]);
    if(hit){ const mid=hit.at;
      items.push({t:m[1]+' '+hit.block.s,kind:'addr',d:{latitude:mid[1],longitude:mid[0],cnn:hit.block.c,side:hit.side}}); } }catch(_){} }
  if(v===document.getElementById('q').value.trim()){  // drop stale async results
    const q=PLACE.streetKey(m?m[2]:v);
    (corridors||[]).filter(c=>PLACE.streetKey(c).includes(q)).slice(0,items.length?3:6).forEach(c=>items.push({t:c,kind:'street'}));
    sugItems=items; sugIdx=-1;
    renderSug(!items.length&&v.length>=3&&corridors!==null);
  }
}
`],
    ['an address opens its side', "if(it.kind==='addr'&&it.d&&it.d.latitude){placeYou(+it.d.latitude,+it.d.longitude,true,it.d.cnn);}",
      "if(it.kind==='addr'&&it.d&&it.d.latitude){placeYou(+it.d.latitude,+it.d.longitude,true,it.d.cnn);if(it.d.side&&pendingOpen)pendingOpen.sideHint=it.d.side;}"],
    ['search the file', /async function doSearch\(\)\{[\s\S]*?\n\}\n(?=\n\/\* ---------- misc)/, `async function doSearch(){
  const v=document.getElementById('q').value.trim(); if(v.length<2)return;
  track('search_used');
  userPicked();
  let blocks; try{ blocks=await PLACE.load(); }catch(e){ toast('Search failed. Try again.'); return; }
  const m=v.match(/^(\\d{1,5})\\s+(.+)$/);
  if(m){ const hit=PLACE.findAddress(blocks,m[1],m[2]);
    if(hit){ const mid=hit.at;
      document.getElementById('q').value=m[1]+' '+hit.block.s;
      placeYou(mid[1],mid[0],true,hit.block.c); if(hit.side&&pendingOpen)pendingOpen.sideHint=hit.side; return; } }
  const q=PLACE.streetKey(m?m[2]:v), exact=blocks.filter(b=>PLACE.streetKey(b.s)===q);
  const pool=exact.length?exact:blocks.filter(b=>PLACE.streetKey(b.s).includes(q));
  if(!pool.length){toast('No ${sweeps ? 'swept ' : ''}street matched "'+v+'".');return;}
  const all=pool.filter(b=>b.s===pool[0].s);
  map.flyToBounds(L.latLngBounds(all.flatMap(b=>b.g.map(([lo,la])=>[la,lo]))),{maxZoom:17,padding:[40,40],duration:.8});
}
`],
    ['weather', 'latitude=37.7749&longitude=-122.4194', `latitude=${c.center[0]}&longitude=${c.center[1]}`],
    ['blocks per weekday', /const DAY_BLOCKS=\[[^\]]*\];/, `const DAY_BLOCKS=${JSON.stringify(perDay)};`],
    ['day heads-up words', /function dayHeadsUp\(v\)\{[\s\S]*?\n\}\n/, `function dayHeadsUp(v){
  const n=DAY_BLOCKS[v]; if(n==null||!n)return;
  const approx=n>=1000?Math.round(n/100)*100:n;
  toast(\`~\${approx.toLocaleString()} ${name.replace(/[`$\\]/g, '')} blocks are swept on \${FULLDAY[v]}s. The colored ones are the blocks to move off.\`);
}
`],
    ['no iPhone app prompt', '(function maybeIosHint(){', '(function maybeIosHint(){ return;  // the iPhone app is San Francisco only'],
    ['no App Store links', "const rate=document.getElementById('imRate'), get=document.getElementById('imGet');", 'const rate=null, get=null;  // the iPhone app is San Francisco only'],
    ['share words', "text:'Free SF street-parking map: every block colored by its next street sweep, plus when tickets actually land.',url:'https://curb.guide'",
      `text:${js(sweeps ? `${name} street sweeping, block by block: every swept curb colored by its next sweep.` : `${name} ${what}, block by block: ${shows}.`)},url:${js(url)}`],
  ];

  // a city whose rules are no parking, not sweeps (Toronto): the welcome card's key says so
  if (bans) edits.push(['welcome key: no parking', '<i style="background:var(--amber)"></i>sweeps soon</span>', '<i style="background:var(--amber)"></i>no parking soon</span>']);
  // a declared rule (Toronto's snow routes): the toast when its alerts turn on says what they do
  if (winter && c.winter.declared) edits.push(['declared: the alerts toast', 'function armedToast(spot){', 'function armedToast(spot){\n  if(window.WINTER){const t=WINTER.armedToast(spot);if(t)return toast(t);}']);
  if (!sweeps || perDay.every((n) => !n)) edits.push(['no day chips without sweeping', '<div class="dayrow" aria-label="Filter by sweep day">', '<div class="dayrow" aria-label="Filter by sweep day" style="display:none">']);
  // A public city has its own readable page (scripts/cities/city-pages.mjs): the welcome card and the menu's About open it
  if (pub) edits.push(
    ['welcome: the city\'s how it works', '<a class="wabout" href="/about">How it works →</a>', `<a class="wabout" href="/${id}/about">How it works →</a>`],
    ['About: the city\'s page', '<a class="im-item" href="/about" role="menuitem">', `<a class="im-item" href="/${id}/about" role="menuitem">`],
    ['About: the city\'s words', '<b>About CURB</b><small>What it does &amp; data sources</small>', `<b>About CURB</b><small>${esc(name)}'s rules &amp; data sources</small>`],
  );
  // ---- winter alternate side parking (lib/winter-ui.js): hooks where the page decides colors, the sheet and alerts ----
  if (winter) edits.push(
    ['winter: map status', 'rows.forEach(r=>{const ns=nextSweep(r);const st=statusFor(ns);', 'rows.forEach(r=>{const ns=nextSweep(r);const st=window.WINTER?WINTER.statusFor(r,ns):statusFor(ns);'],
    ['winter: dashed until enforced', "const vis=L.polyline(ll,{color,weight:5,opacity:.95,lineCap:'round'}).on('click',click).addTo(segLayer);",
      "const vis=L.polyline(ll,{color,weight:5,opacity:.95,lineCap:'round',...(window.WINTER&&WINTER.lineStyle(s.rows,rank))}).on('click',click).addTo(segLayer);"],
    ['winter: citywide lines', '  if(dayFilter!=null){rules=rules.filter(r=>sweepsOnDay(r,dayFilter));if(!rules.length)return null;}',
      '  if(dayFilter!=null){rules=rules.filter(r=>sweepsOnDay(r,dayFilter));if(!rules.length)return null;}\n  if(window.WINTER){const w=WINTER.ovStyle(rules,ow);if(w!==undefined)return w;}'],
    ['winter: hover card', 'function previewHtml(group, side){', 'function previewHtml(group, side){\n  if(window.WINTER){const w=WINTER.tip(group,side);if(w)return w;}'],
    ['winter: arm a night not yet enforced', '  const {armNs,armRow,sweepingNow}=armFor(active,now);',
      '  const {armNs,armRow,sweepingNow}=(window.WINTER&&WINTER.arm(active,now))||armFor(active,now);\n  const WS=window.WINTER?WINTER.sheet(group,active):null;'],
    ['winter: the verdict', '  else{head=sweepWords(ns,now).head;}  // "Tue 9AM", or "Mon night" for a sweep starting before 6 AM',
      '  else{head=sweepWords(ns,now).head;}  // "Tue 9AM", or "Mon night" for a sweep starting before 6 AM\n  if(WS&&WS.head){vClass=WS.vClass;kicker=WS.kicker;head=WS.head;}'],
    ['winter: the schedule line', '  const aSched=ns?', '  const aSched=WS&&WS.sched!=null?WS.sched:ns?'],
    ['winter: tonight\'s sides', '  const sidesBlock=others.length?', '  const sidesBlock=WS&&WS.sides!=null?WS.sides:others.length?'],
    ['winter: the note', '    ${aSched}\n    ${_holRow}', "    ${aSched}\n    ${WS&&WS.note?WS.note:''}\n    ${_holRow}"],
    ['winter: no calendar before it starts', '${canRemind?`<button class="btn alt" id="calBtn">', '${canRemind&&!(WS&&WS.noCal)?`<button class="btn alt" id="calBtn">'],
    ['winter: calendar button may be absent', "    document.getElementById('calBtn').onclick=()=>{", "    if(document.getElementById('calBtn'))document.getElementById('calBtn').onclick=()=>{"],
    ['winter: calendar title', "'SUMMARY:🧹 Move car: street sweeping ('+street+')'", "'SUMMARY:'+((window.WINTER&&WINTER.calTitle(street))||'🧹 Move car: street sweeping ('+street+')')"],
    ['winter: calendar words', "'DESCRIPTION:Street sweeping starts now. Move your car. Block: '+block",
      "'DESCRIPTION:'+((window.WINTER&&WINTER.calDesc())||'Street sweeping starts now. Move your car.')+' Block: '+block"],
    ['winter: Google calendar title', "'&text='+encodeURIComponent('🧹 Move car: street sweeping ('+street+')')",
      "'&text='+encodeURIComponent((window.WINTER&&WINTER.calTitle(street))||'🧹 Move car: street sweeping ('+street+')')"],
    ['winter: Google calendar words', "'&details='+encodeURIComponent('Street sweeping starts. Move your car.\\nBlock: '+block)",
      "'&details='+encodeURIComponent(((window.WINTER&&WINTER.calDesc())||'Street sweeping starts. Move your car.')+'\\nBlock: '+block)"],
    ['winter: alerts panel arms it too', '    const {armNs,armRow}=armFor(side,now);', '    const {armNs,armRow}=(window.WINTER&&WINTER.arm(side,now))||armFor(side,now);'],
    ['winter: alerts panel keeps the rows', '    out[alertId(a)]={armNs,spot:alertSpotFor(', '    out[alertId(a)]={armNs,rows:mine,spot:alertSpotFor('],
    ['winter: alerts panel line', '  else if(x&&x.armNs){const rp=relPhrase(x.armNs);', '  else if(x&&window.WINTER&&(when=WINTER.apNext(x,level))){}\n  else if(x&&x.armNs){const rp=relPhrase(x.armNs);'],
    ['winter: the plate', '    <button class="dchip" data-day="0">Sun</button>\n  </div>\n</div>',
      '    <button class="dchip" data-day="0">Sun</button>\n  </div>\n  <div class="wplate" id="wPlate" hidden></div>\n</div>'],
  );

  let out = src;
  for (const [what, find, rep, count = 1] of edits) {
    const n = typeof find === 'string' ? out.split(find).length - 1 : (out.match(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g')) || []).length;
    if (n !== count) throw new Error(`city-page ${id}: "${what}" matched ${n} times, expected ${count}. index.html changed: update scripts/cities/city-page.mjs.`);
    out = typeof find === 'string' ? out.split(find).join(rep) : out.replace(find, () => rep);
  }
  const banner = `<!-- GENERATED by scripts/cities/city-page.mjs from index.html and data/${id}/. Do not edit: change index.html, the edits there or the city's data. -->\n`;
  out = out.replace('<!DOCTYPE html>\n', '<!DOCTYPE html>\n' + banner);
  fs.writeFileSync(`${ROOT}${id}.html`, out);
  // the city's Home Screen web app (iPhone alerts)
  const manifest = JSON.parse(fs.readFileSync(ROOT + 'manifest-boston.json', 'utf8'));
  Object.assign(manifest, { name: pub ? `CURB ${name}` : `CURB ${name} (preview)`, short_name: `CURB ${name}`.slice(0, 12),
    description: pub ? `${name} ${seo.term}, block by block, from the City's open data.` : `${name} ${what}, block by block. A preview on the City's open data.`,
    start_url: `/${id}`, scope: '/', id: `/${id}` });
  fs.writeFileSync(`${ROOT}manifest-${id}.json`, JSON.stringify(manifest, null, 2) + '\n');
  // curb.guide/<id> serves the page: its rewrite in vercel.json, next to Boston's
  const vercel = JSON.parse(fs.readFileSync(ROOT + 'vercel.json', 'utf8'));
  if (!vercel.rewrites.some((r) => r.source === '/' + id)) {
    const at = vercel.rewrites.findIndex((r) => r.source === '/tickets');
    vercel.rewrites.splice(at < 0 ? vercel.rewrites.length : at, 0, { source: '/' + id, destination: `/${id}.html` });
    fs.writeFileSync(ROOT + 'vercel.json', JSON.stringify(vercel, null, 2) + '\n');
  }
  return { id, edits: edits.length, kb: Math.round(out.length / 1024), blocks: data.b.length, hoods: hoods.length };
}

const all = Object.keys(globalThis.CITY_CONFIGS);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : all;
for (const id of ids) {
  if (!all.includes(id)) throw new Error(`${id} is not in lib/city-configs.js: run node scripts/cities/configs.mjs first`);
  const r = cityPage(id);
  console.error(`[city-page] wrote ${id}.html (${r.edits} edits, ${r.kb} KB, ${r.blocks} blocks, ${r.hoods} neighborhoods), manifest-${id}.json and its route`);
}
