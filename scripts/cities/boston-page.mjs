#!/usr/bin/env node
// Builds boston.html (the Boston preview at curb.guide/boston) from index.html, so Boston gets San Francisco's
// map, sheet and fixes as they are, with only the parts below swapped. Each edit must match exactly where it
// expects to (the build fails otherwise), and the list doubles as the map of what is still tied to SF
// (docs/multi-city/README.md, "Tied to San Francisco"). Boston's data: scripts/cities/boston.mjs. Its time and
// data helpers: lib/city-boston.js.
//
// Not on the Boston page yet: ticket times, sweeper GPS, truck routes, block and neighborhood pages, permit-area
// browsing. Sweep alerts run on the shared sender: each spot carries its city (lib/cities.js).
//
// Run after index.html or data/boston/ changes: node scripts/cities/boston-page.mjs

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = fs.readFileSync(ROOT + 'index.html', 'utf8');
const data = JSON.parse(fs.readFileSync(ROOT + 'data/boston/segments.json', 'utf8'));

// Blocks swept per weekday, for the day-chip heads-up (index.html DAY_BLOCKS is SF's).
const perDay = [0, 1, 2, 3, 4, 5, 6].map((d) => data.b.filter((b) => b.d.some(([, , rules]) => rules.some((r) => r[0] === d))).length);
// The welcome card's neighborhood list, like SF's: each link frames the neighborhood's blocks (2nd to 98th percentile,
// so one stray block can't stretch it). "Multiple", "DCR" (state roads) and two one-off labels aren't neighborhoods.
const NOT_HOODS = new Set(['Multiple', 'DCR', 'Boston', 'Dorchester']);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const hoods = Object.entries(data.b.reduce((m, b) => { if (b.h && !NOT_HOODS.has(b.h)) (m[b.h] ||= []).push(...b.g); return m; }, {}))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, pts]) => {
    const sorted = (k) => pts.map((p) => p[k]).sort((a, b) => a - b), at = (v, q) => v[Math.floor(q * (v.length - 1))];
    const lo = sorted(0), la = sorted(1);
    return { name, bbox: [at(lo, 0.02), at(la, 0.02), at(lo, 0.98), at(la, 0.98)].map((v) => v.toFixed(4)).join(',') };
  });

const edits = [
  // ---- head --------------------------------------------------------------------------------------
  ['title + noindex', '<title>SF Street Cleaning Map: When Tickets Actually Land | CURB</title>',
    '<title>Boston Street Cleaning Map (preview) | CURB</title>\n<meta name="robots" content="noindex">'],
  ['description', /<meta name="description" content="[^"]*">/,
    '<meta name="description" content="Boston street sweeping, block by block: every swept curb colored by its next sweep, from the City\'s open data. A CURB preview.">'],
  ['canonical', '<link rel="canonical" href="https://curb.guide/">', '<link rel="canonical" href="https://curb.guide/boston">'],
  ['no SF app schema', /<script type="application\/ld\+json">[\s\S]*?<\/script>\n/, ''],
  ['card titles', 'Know where to park in SF', 'Know where to park in Boston', 2],
  ['card description', '<meta property="og:description" content="Street parking rules block by block: sweeping schedules, permit zones & move-your-car alerts. From SF open data.">',
    '<meta property="og:description" content="Street parking rules block by block: sweeping schedules, paid and permit curbs. From Boston open data.">'],
  ['card description (X)', '<meta name="twitter:description" content="Street parking rules block by block: sweeping schedules, permit zones & move-your-car alerts.">',
    '<meta name="twitter:description" content="Boston street parking rules block by block: sweeping schedules, paid and permit curbs.">'],
  ['card url', '<meta property="og:url" content="https://curb.guide/">', '<meta property="og:url" content="https://curb.guide/boston">'],
  // Boston's own card (og-boston.png, npm run og:boston from og/template-boston.html), not SF's
  ['card image', '<meta property="og:image" content="https://curb.guide/og.png?v=3">', '<meta property="og:image" content="https://curb.guide/og-boston.png?v=1">'],
  ['card image words', '<meta property="og:image:alt" content="CURB: SF street parking map with green, amber and red curb lines showing sweeping status">',
    '<meta property="og:image:alt" content="CURB Boston: a Boston street cleaning sign and the words Know where to park in Boston">'],
  ['card image (X)', '<meta name="twitter:image" content="https://curb.guide/og.png?v=3">', '<meta name="twitter:image" content="https://curb.guide/og-boston.png?v=1">'],
  ['card image words (X)', '<meta name="twitter:image:alt" content="CURB: SF street parking map with colored curb lines">',
    '<meta name="twitter:image:alt" content="CURB Boston: Know where to park in Boston">'],
  ['info button words', 'data-tip="Alerts, guide, tickets &amp; about"', 'data-tip="Alerts, guide, holidays &amp; about"'],
  // ---- body: words and menus ---------------------------------------------------------------------
  ['h1', /<h1 class="srh">[^<]*<\/h1>/, '<h1 class="srh">Boston street cleaning map: sweeping schedules by block (a CURB preview)</h1>'],
  ['map label', '<main id="map" aria-label="San Francisco parking map">', '<main id="map" aria-label="Boston parking map">'],
  ['SF pages → Boston data sources', /<a class="im-item" href="\/n\/" role="menuitem">[\s\S]*?<a class="im-item" href="\/tickets" role="menuitem">[\s\S]*?<\/a>/,
    // SF's three pages, Boston's way: the neighborhood list (in the welcome card), the holidays and the map fixes
    // (boston/about.html, boston/fixes.html: scripts/cities/boston-pages.mjs)
    `<button class="im-item" id="imHoods" role="menuitem">
          <span class="im-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg></span>
          <span class="im-tx"><b>Neighborhoods</b><small>Street cleaning by Boston neighborhood</small></span>
        </button>
        <a class="im-item" href="/boston/about#holidays" role="menuitem">
          <span class="im-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg></span>
          <span class="im-tx"><b>Sweeping holidays</b><small>Days Boston skips daytime sweeping</small></span>
        </a>
        <a class="im-item" href="/boston/fixes" role="menuitem">
          <span class="im-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14.7 6.3 3 3M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/></svg></span>
          <span class="im-tx"><b>Map fixes</b><small>What we corrected in the City's data</small></span>
        </a>`],
  ['About: Boston\'s page', '<a class="im-item" href="/about" role="menuitem">', '<a class="im-item" href="/boston/about" role="menuitem">'],
  ['About: Boston\'s words', '<b>About CURB</b><small>What it does &amp; data sources</small>', '<b>About CURB</b><small>Boston\'s rules &amp; data sources</small>'],
  ['welcome: Boston\'s how it works', '<a class="wabout" href="/about">How it works →</a>', '<a class="wabout" href="/boston/about">How it works →</a>'],
  ['menu footer link', '<a href="https://datasf.org" target="_blank" rel="noopener">SF open data</a>', '<a href="https://data.boston.gov" target="_blank" rel="noopener">Boston open data</a>'],
  ['menu footer', 'Built on SF open data (DataSF). The posted sign is always the final word.', 'Built on Boston open data and the City\'s Curb Lab. The posted sign is always the final word.'],
  ['permit tile', '<span class="tl">Permit zones</span>', '<span class="tl">Resident permit</span>'],
  ['loading tile', '<span class="prev"><b style="background:#E0A21E"></b><b style="background:#FFFDF6"></b><b style="background:#C1121F"></b></span><span class="tl">Loading zones</span>',
    '<span class="prev"><b style="background:#E0A21E"></b><b style="background:#FFFDF6"></b><b style="background:#2F6FB5"></b></span><span class="tl">Loading &amp; accessible</span>'],
  ['meter tile', '<span class="tl">Meters</span>', '<span class="tl">Paid parking</span>'],
  ['no truck routes', '<button class="ltile" id="routeToggle" aria-pressed="false">', '<button class="ltile" id="routeToggle" aria-pressed="false" style="display:none">'],
  // three more Curb Lab layers fill the grid to 3 × 2 (SF's truck routes tile stays, hidden: its handler is SF code)
  ['Boston tiles: time limits, snow emergency, no stopping', '<span class="tl">Truck routes</span></button>', `<span class="tl">Truck routes</span></button>
      <button class="ltile" id="limitToggle" aria-pressed="false"><span class="prev"><b class="ldot"></b></span><span class="tl">Time limits</span></button>
      <button class="ltile" id="snowToggle" aria-pressed="false"><span class="prev"><i class="band snow"></i></span><span class="tl">Snow emergency</span></button>
      <button class="ltile" id="stopToggle" aria-pressed="false"><span class="prev"><svg width="30" height="12" viewBox="0 0 28 12" aria-hidden="true"><line x1="1" y1="6" x2="27" y2="6" stroke="#A4277C" stroke-width="3.2" stroke-dasharray="6 3"/></svg></span><span class="tl">No stopping</span></button>`],
  ['Boston layer and posted rule styles', '  .chip.rpp .rppgo{', `  .ltile .prev b.ldot{background:#FFFDF6}
  .lst i.ldot{width:9px;height:9px;border-radius:50%;background:#FFFDF6;border:1.5px solid var(--ink);margin:0 5px}
  .ltile .band.snow{background:#4FA9C4}
  .crules{display:grid;gap:5px;margin-top:10px}
  .crule{display:flex;align-items:baseline;gap:8px;font-size:12.5px;line-height:1.35;color:var(--ink)}
  .crule i{flex:none;width:16px;height:6px;border-radius:4px;border:1px solid rgba(23,21,15,.35);transform:translateY(-1px)}
  .crule b{font-weight:800}
  .crsrc{font-size:11px;color:var(--ink-soft);margin-top:2px}
  .chip.rpp .rppgo{`],
  ['Boston layer state', 'let routeOn=false;\n', `let routeOn=false;
// Boston's other Curb Lab layers: free parking with a time limit, snow emergency curbs, no stopping and no parking
const limitLayer=L.layerGroup().addTo(map), snowLayer=L.layerGroup().addTo(map), stopLayer=L.layerGroup().addTo(map);
let limitOn=false, snowOn=false, stopOn=false;
// Every curb layer draws in its own pane, over the sweep lines: in a shared pane, a status or day chip redrew the sweep
// lines on top of the curbs' dots and lines, and a tap on one opened the block instead.
map.createPane('curbs').style.zIndex=450;
`],
  ['the overview clears them too', 'segLayer.clearLayers();rppLayer.clearLayers();loadLayer.clearLayers();meterLayer.clearLayers();routeLayer.clearLayers();',
    'segLayer.clearLayers();rppLayer.clearLayers();loadLayer.clearLayers();meterLayer.clearLayers();routeLayer.clearLayers();limitLayer.clearLayers();snowLayer.clearLayers();stopLayer.clearLayers();'],
  ['no permit areas', '<div class="lp-sec">Permit areas</div>\n    <div class="arearow">', '<div class="lp-sec" style="display:none">Permit areas</div>\n    <div class="arearow" style="display:none">'],
  ['welcome', /<p>Every curb in SF, colored by[\s\S]*?<\/p>/,
    '<p>Every swept curb in Boston, colored by its <b>next street sweep</b>. Tap where you parked for the rules. <b>A preview</b>, built on the City\'s open data.</p>'],
  ['Boston neighborhoods', /<!-- hoods:start[\s\S]*?<!-- hoods:end -->/, '<nav class="whoods" aria-label="Street cleaning by neighborhood"><p>Street cleaning by neighborhood</p><ul>'
    + hoods.map((h) => `<li><a href="/boston?bbox=${h.bbox}" data-bbox="${h.bbox}">${esc(h.name)}</a></li>`).join('') + '</ul></nav>'],
  // SF's neighborhood links open /n/ pages; Boston's frame the map in place (the href is the fallback)
  ['neighborhood links frame the map', "  if(!EMBED&&!onboarded())setTimeout(()=>{try{localStorage.setItem('curbOnboarded','1');}catch(_){}},0);\n})();\n", `  if(!EMBED&&!onboarded())setTimeout(()=>{try{localStorage.setItem('curbOnboarded','1');}catch(_){}},0);
})();
// the menu's Neighborhoods opens the welcome card at its neighborhood list
document.getElementById('imHoods').onclick=()=>{ closeInfoMenu(); showWelcome(); document.querySelector('.whoods')?.scrollIntoView({block:'nearest'}); };
document.querySelector('.whoods')?.addEventListener('click',e=>{
  const a=e.target.closest('a[data-bbox]'); if(!a)return;
  e.preventDefault(); markOnboarded(); userPicked();
  const [w,s,ea,n]=a.dataset.bbox.split(',').map(Number); map.fitBounds([[s,w],[n,ea]],{padding:[18,18]});
});
`],
  ['welcome footer', /<p class="wfoot">[\s\S]*?<\/p>/,
    '<p class="wfoot">Free, no account. Built on <a href="https://data.boston.gov" target="_blank" rel="noopener">Boston\'s open data</a>. The posted sign always wins.</p>'],
  // ---- scripts: Boston's time core and data --------------------------------------------------------
  ['load lib/city-boston.js', '<script src="/lib/sweep-core.js?v=8"></script>', '<script src="/lib/sweep-core.js?v=8"></script>\n<script src="/lib/city-boston.js?v=7"></script>'],
  ['retry it like the time core', "if(!window.nextSweep)again('script[src^=\"/lib/sweep-core.js\"]');}",
    "if(!window.nextSweep)again('script[src^=\"/lib/sweep-core.js\"]');\nif(window.nextSweep&&!window.BOS)again('script[src^=\"/lib/city-boston.js\"]');}"],
  ['fail without it', 'if(!window.L||!window.nextSweep){', 'if(!window.L||!window.nextSweep||!window.BOS){'],
  ['basemap tiles', "const SELF_BASEMAP='/basemap/parchment/{z}/{x}/{y}.png';", "const SELF_BASEMAP='/basemap/boston/{z}/{x}/{y}.png';"],
  ['start in Boston', '.setView([37.7749,-122.4194],15);', '.setView(BOS.CENTER,BOS.ZOOM);'],
  ['basemap: Boston tiles', /function addSelfBasemap\(\)\{[\s\S]*?\n\}\n/, `function addSelfBasemap(){
  const city=L.tileLayer(SELF_BASEMAP,{minNativeZoom:8,maxNativeZoom:16,maxZoom:20,bounds:BOS.TILE_BOUNDS,
    attribution:'&copy; OpenStreetMap &copy; Protomaps'}).addTo(map);
  // z17 for the center of town (BOS.CORE_BOUNDS), over the citywide tiles, which stop at z16 and stretch past it.
  // Added second: while a layer is the map's only one, its minZoom is the map's (the page would open at z17).
  L.tileLayer(SELF_BASEMAP,{minZoom:17,minNativeZoom:17,maxNativeZoom:17,maxZoom:20,bounds:BOS.CORE_BOUNDS,zIndex:2}).addTo(map);
  return city;
}
`],
  ['blocks from the static file', /async function loadViewport\(\)\{[\s\S]*?\n\}\n(?=\n\/\* ---------- citywide overview)/, `async function loadViewport(){
  const z=map.getZoom(), hint=document.getElementById('hint');
  if(z<MIN_ZOOM_DATA){enterOverviewMode(true);return;}
  const b=map.getBounds().pad(0.15);
  const my=++fetchTok;
  // Boston's blocks are one static file (scripts/cities/boston.mjs), filtered here instead of a DataSF query.
  let blocks;
  try{ blocks=await BOS.load(); }
  catch(e){ if(my===fetchTok){ toast("Couldn't load Boston's curbs. Pan and try again."); curbReport('data-load', String((e&&e.message)||e)); } return; }
  if(my!==fetchTok)return;
  if(!bosRanges){ bosRanges=true; blocks.forEach(x=>{ if(x.n)rangeCache[x.c]={lo:x.n[0],hi:x.n[1]}; }); }
  const data=BOS.rowsIn(blocks,b.getWest(),b.getSouth(),b.getEast(),b.getNorth());
  if(bosSides(data)>SEG_CAP){enterOverviewMode(false);return;}  // SF's cap, in curb sides: a wide z15 window stays on the overview
  ovMode=false;
  if(map.hasLayer(overviewLayer)){ovrDrawTok++;map.removeLayer(overviewLayer);}
  hint.style.opacity='0';hint.style.visibility='hidden';
  lastRows=data; segBounds=b;
  if(!data.length&&!noCovToasted){noCovToasted=true; toast('No street-sweeping schedule here. This preview covers Boston.');}
  drawSegments(data);
  tryPendingOpen();
  if(rppOn) loadRpp(null, my); else {rppLayer.clearLayers();rppCache=[];}
  if(loadOn) drawLoadZones(); else loadLayer.clearLayers();
  if(meterOn) drawMeters(); else meterLayer.clearLayers();
  if(limitOn) drawLimits(); else limitLayer.clearLayers();
  if(snowOn) drawSnow(); else snowLayer.clearLayers();
  if(stopOn) drawStops(); else stopLayer.clearLayers();
}
let bosRanges=false;
// SF's cap counts rows, about one per curb side there. Downtown Boston is swept every weeknight, about five rows a side,
// so in rows it stayed on the zoomed out view, every curb layer with it, until z18 on a laptop: Boston counts sides.
const bosSides=rows=>new Set(rows.map(r=>r.cnn+r.cnnrightleft)).size;
`],
  ['overview from the same file', /async function ensureOverview\(\)\{[\s\S]*?return OVR;\n\}/, `async function ensureOverview(){
  if(OVR)return OVR;
  OVR=BOS.overview(await BOS.load());
  return OVR;
}`],
  // each block's real line, not a straight one between its ends (a curving Boston block strays off the street)
  ['overview draws real lines', 'L.polyline([b.a,b.z],{renderer:overviewRenderer,', 'L.polyline(b.g,{renderer:overviewRenderer,'],
  ['house numbers from the file', /async function fillRange\(cnn\)\{[\s\S]*?\n\}\n/, `async function fillRange(cnn){
  const el=document.getElementById('rangeSlot');
  if(el&&cnn&&rangeCache[cnn])el.textContent=fmtRange(cnn);
}
`],
  ['no SF ticket, sweeper or route files', /loadEnforcement\(\);[^\n]*\nloadSweeps\(\);[^\n]*\nloadRoutes\(\);[^\n]*\n/, ''],
  // ---- Boston's curb layers (the Curb Lab's curbs.json) ----------------------------------------------
  ['Boston permit layer', /async function loadRpp\(poly, my\)\{[\s\S]*?\n\}\n(?=function nearestRpp)/, `// Boston: curb zones from the City's Curb Lab (data/boston/curbs.json), drawn for the viewport.
let BCURBS=null;
async function bosCurbs(){
  if(BCURBS)return BCURBS;
  const c=await BOS.curbs();
  for(const k of ['paid','permit','accessible','loading','limit','snow','nostop'])c[k].forEach(z=>{
    let w=180,s=90,e=-180,n=-90; z.g.forEach(([lo,la])=>{if(lo<w)w=lo;if(lo>e)e=lo;if(la<s)s=la;if(la>n)n=la;});
    z.bb=[w,s,e,n]; z.ll=z.g.map(([lo,la])=>[la,lo]);
  });
  return BCURBS=c;
}
function bosIn(list,b){const w=b.getWest(),s=b.getSouth(),e=b.getEast(),n=b.getNorth();return list.filter(z=>z.bb[2]>=w&&z.bb[0]<=e&&z.bb[3]>=s&&z.bb[1]<=n);}
const fmtMax=m=>m?(m%60?m+' min':(m/60)+' hr')+' max':'';
// One posted rule in words, {color, head, sub, when}: the map's popups and the sheet's list say it the same way.
const BOS_LOAD={commercial:['#E0A21E','Commercial loading'],passenger:['#FFFDF6','Passenger pick-up and drop-off'],rideshare:['#FFFDF6','Rideshare pick-up and drop-off'],
  valet:['#FFFDF6','Valet'],bus:['#E2731E','Bus loading'],short:['#1F9E5A','Short-term parking']};
const BOS_EXCEPT={bus:'buses',bicycle:'bicycles',commercial_vehicle:'commercial vehicles',truck:'trucks',car:'cars',motorcycle:'motorcycles',electric:'electric vehicles',rideshare:'rideshare'};
function bosRule(k,f){
  const max=fmtMax(f.max);
  if(f.when==='Every day, all day')f={...f,when:'any time'};
  if(k==='paid')return {color:getCSS('--gray'),head:'Paid parking',sub:[f.rate?'$'+(+f.rate).toFixed(2)+' an hour':'Metered',max,f.zone?'ParkBoston zone '+f.zone:''].filter(Boolean).join(' · '),when:f.when};
  if(k==='permit')return {color:getCSS('--meter'),head:'Resident permit',sub:f.only?'residents only':f.max?'others '+max.replace(' max',''):'',when:f.when};
  if(k==='accessible')return {color:'#2F6FB5',head:'Accessible parking',sub:'disability placard or plate',when:f.when};
  if(k==='loading'){const [color,head]=BOS_LOAD[f.who]||BOS_LOAD.passenger; return {color,head,sub:max,when:f.when};}
  if(k==='limit')return {color:'#FFFDF6',head:'Time limit',sub:max,when:f.when};
  if(k==='snow')return {color:'#4FA9C4',head:'Snow emergency',sub:'no parking when the City declares one',when:''};
  return {color:'#A4277C',head:f.stop?'No stopping':'No parking',when:f.when||'any time',
    sub:[f.why||'',f.except?'except '+f.except.split(',').map(u=>BOS_EXCEPT[u]||u).join(' and '):''].filter(Boolean).join(' · ')};
}
const bosPopup=(k,f)=>{const t=bosRule(k,f);return \`<div class="lp-h">\${t.head}</div>\${t.sub?\`<div class="lp-m">\${t.sub}</div>\`:''}<div class="lp-s">\${t.when||''}</div><div class="lp-s" style="margin-top:5px">City Curb Lab data (beta), read from sign photos. The posted sign is the source of truth.</div>\`;};
async function loadRpp(poly, my){
  try{
    // also switched off, or zoomed out, while the file loaded (4.4 MB the first time): neither one bumps fetchTok
    const c=await bosCurbs(); if(my!==fetchTok||!rppOn||ovMode)return;
    rppLayer.clearLayers(); rppCache=[];
    bosIn(c.permit,map.getBounds().pad(0.15)).forEach(z=>{
      L.polyline(z.ll,{pane:'curbs',color:getCSS('--meter'),weight:rppWeight(),opacity:.14,lineCap:'round',interactive:false}).addTo(rppLayer);
      rppCache.push({latlngs:z.ll, area:'', hrlimit:z.max?Math.round(z.max/60):null, only:z.only, when:z.when});
    });
  }catch(e){}
}
`],
  ['permit hover line', "${rpp?`<div class=\"tip-rpp\">Permit Zone ${rpp.area}${rpp.hrlimit?' · '+rpp.hrlimit+'hr limit':''} · holders exempt</div>`:''}",
    "${rpp?`<div class=\"tip-rpp\">Resident permit${rpp.only?' · residents only':rpp.hrlimit?' · others '+rpp.hrlimit+' hr':''}</div>`:''}"],
  ['permit toggle words', "if(rppOn)toast('Permit zones (RPP) shaded blue. Tap a block for area & hours.');",
    "if(rppOn)toast('Resident permit curbs shaded blue, from the City\\'s Curb Lab (beta, read from sign photos). Tap a block for the hours.');"],
  ['Boston permit chip', /function renderRpp\(rp\)\{[\s\S]*?\n\}\nasync function loadRppBlock\(latlngs,mid,cnn\)\{[\s\S]*?\n\}\n(?=async function loadMeterBlock)/, `function renderRpp(rp){
  const slot=document.getElementById('rppSlot'); if(!slot)return;
  if(!rp){slot.style.display='none';return;}
  const t=bosRule('permit',rp);
  slot.style.display='inline-flex';
  slot.innerHTML=\`<span class="adisc" style="background:var(--meter)">P</span><span class="rpptxt"><b>Resident permit</b>\${t.sub?' · '+t.sub:''}\${t.when?' · '+t.when:''}</span>\`;
  slot.title="Resident permit parking, from the City's Curb Lab (beta)";
  slot.removeAttribute('role'); slot.removeAttribute('tabindex'); slot.onclick=null; slot.onkeydown=null;
}
`],
  // the sheet reads the rules posted on its block side from data/boston/rules.json (matched to sides by
  // scripts/cities/boston.mjs): the meter badge, the permit chip, then one line per other rule
  ['Boston posted rules', /async function loadMeterBlock\(latlngs,cnn\)\{[\s\S]*?\n\}\n(?=function refreshToday)/, `async function loadCurbRules(cnn,side){
  const meter=document.getElementById('headMeter'), list=document.getElementById('curbRules');
  renderRpp(null); if(meter)meter.style.display='none'; if(list){list.hidden=true;list.innerHTML='';}
  const lr=side&&side.rows&&side.rows[0]&&side.rows[0].cnnrightleft; if(!cnn||!lr)return;
  let rules; try{ rules=BOS.sideRules(await BOS.rules(),cnn,lr); }catch(e){ return; }
  if(list&&document.getElementById('curbRules')!==list)return;  // another sheet opened meanwhile
  const paid=rules.find(([k])=>k==='paid'), permit=rules.find(([k])=>k==='permit');
  if(paid&&meter){
    const f=paid[1];
    meter.innerHTML=METER_ICON+(f.rate?'$'+(+f.rate).toFixed(2).replace(/\\.00$/,'')+'/hr':'Metered');
    meter.title=bosRule('paid',f).sub+(f.when?' · '+f.when:'')+". From the City's Curb Lab (beta).";
    meter.style.display='inline-flex';
  }
  if(permit)renderRpp(permit[1]);
  const rest=rules.filter(([k])=>k!=='paid'&&k!=='permit');
  if(!list||!rest.length)return;
  list.innerHTML=rest.map(([k,f])=>{const t=bosRule(k,f);
    return \`<div class="crule"><i style="background:\${t.color}"></i><span><b>\${t.head}</b>\${t.sub?' · '+t.sub:''}\${t.when?' · '+t.when:''}</span></div>\`;}).join('')
    +'<div class="crsrc">Posted signs, read from photos by the City\\'s Curb Lab (beta). The sign on the street wins.</div>';
  list.hidden=false;
}
`],
  ['the sheet has a posted rules list', '<div class="chips"><span class="chip rpp" id="rppSlot" style="display:none"></span></div>',
    '<div class="chips"><span class="chip rpp" id="rppSlot" style="display:none"></span></div>\n    <div class="crules" id="curbRules" hidden></div>'],
  ['the sheet reads them', '  loadMeterBlock(active.latlngs, group.cnn);\n  loadRppBlock(active.latlngs, active.mid, group.cnn);\n', '  loadCurbRules(group.cnn, active);\n'],
  ['Boston paid parking dots', /async function drawMeters\(\)\{[\s\S]*?\n\}\n/, `async function drawMeters(){
  const c=await bosRedraw(meterLayer,'Paid parking data',()=>meterOn); if(!c)return;
  const z=map.getZoom(), mr=z>=18?4:z>=17?3.5:z>=16?3:2.5;
  bosIn(c.paid,map.getBounds()).forEach(p=>{ const m=BOS.midpoint(p.g);
    L.circleMarker([m[1],m[0]],{pane:'curbs',radius:mr,color:'#17150F',weight:1,fillColor:getCSS('--gray'),fillOpacity:.85})
      .bindPopup(bosPopup('paid',p),{className:'loadpop',maxWidth:240}).addTo(meterLayer);
  });
}
`],
  ['Boston loading, accessible and the other curb layers', /async function drawLoadZones\(\)\{[\s\S]*?\n\}\n/, `async function drawLoadZones(){
  const c=await bosRedraw(loadLayer,'Loading zones',()=>loadOn); if(!c)return;
  const b=map.getBounds();
  bosIn(c.loading,b).forEach(z=>bosLine(loadLayer,z,'loading'));
  bosIn(c.accessible,b).forEach(z=>bosLine(loadLayer,z,'accessible'));
}
// a curb zone as a line in its rule's color, its rule as the popup: color curbs cased in ink; no stopping lighter, uncased,
// dashed when only at the posted hours
function bosLine(layer,z,k,dash){
  const ww=map.getZoom()>=17?4:3, t=bosRule(k,z), light=k==='nostop';
  if(!light)L.polyline(z.ll,{pane:'curbs',color:'#17150F',weight:ww+3,opacity:.85,lineCap:'round',interactive:false}).addTo(layer);
  L.polyline(z.ll,{pane:'curbs',color:t.color,weight:light?ww-1:ww,opacity:light?.9:1,lineCap:'round',dashArray:dash}).bindPopup(bosPopup(k,z),{className:'loadpop',maxWidth:250}).addTo(layer);
}
// a layer redraw's data: the curbs file, with the layer cleared; null when it failed (said in a toast), when zoomed out,
// or when the layer was switched off (on() false) or redrawn again while the file loaded: 4.4 MB the first time, long
// enough on a phone for a layer switched off meanwhile to draw anyway, or twice
async function bosRedraw(layer,what,on){
  const my=layer.bosTok=(layer.bosTok||0)+1;
  let c; try{ c=await bosCurbs(); }catch(e){ if(my===layer.bosTok&&on())toast(what+' unavailable right now.'); return null; }
  if(my!==layer.bosTok||!on())return null;
  layer.clearLayers();
  return ovMode||map.getZoom()<MIN_ZOOM_DATA?null:c;
}
async function drawLimits(){
  const c=await bosRedraw(limitLayer,'Time limits',()=>limitOn); if(!c)return;
  const z=map.getZoom(), mr=z>=18?4.5:z>=17?4:3.5;
  bosIn(c.limit,map.getBounds()).forEach(p=>{ const m=BOS.midpoint(p.g);
    L.circleMarker([m[1],m[0]],{pane:'curbs',radius:mr,color:'#17150F',weight:1.5,fillColor:'#FFFDF6',fillOpacity:1})
      .bindPopup(bosPopup('limit',p),{className:'loadpop',maxWidth:240}).addTo(limitLayer);
  });
}
async function drawSnow(){
  const c=await bosRedraw(snowLayer,'Snow emergency curbs',()=>snowOn); if(!c)return;
  bosIn(c.snow,map.getBounds().pad(0.15)).forEach(z=>
    L.polyline(z.ll,{pane:'curbs',color:'#4FA9C4',weight:rppWeight(),opacity:.3,lineCap:'round',interactive:false}).addTo(snowLayer));
}
async function drawStops(){
  const c=await bosRedraw(stopLayer,'No stopping curbs',()=>stopOn); if(!c)return;
  bosIn(c.nostop,map.getBounds()).forEach(z=>bosLine(stopLayer,z,'nostop',z.when?'6 5':null));
}
`],
  ['loading toggle words', "toast('Loading zones: dots = metered curbs (🟡 commercial · ⚪ passenger · 🔴 truck · 🟢 short-term · 🟠 bus). White curb lines = passenger loading, school zones included. Tap anything for hours.');",
    "toast('Loading and accessible curbs from the City\\'s Curb Lab (beta): yellow commercial, white passenger and valet, orange bus, green short-term parking, blue accessible. Tap one for hours.');"],
  ['meter toggle words', "toast('Metered curbs shown as grey dots. Check the meter for hours & rates.');",
    "toast('Paid parking shown as grey dots, from the City\\'s Curb Lab (beta). Tap one for the rate, the hours and the ParkBoston zone.');"],
  ['Boston legend rows', /function renderOvlLegend\(\)\{[\s\S]*?\n\}\n(?=\(function initLayersPanel)/, `function renderOvlLegend(){
  const el=document.getElementById('ovlLeg');
  const row=(id,what,sw,label)=>\`<div class="lov"><button class="lst on" data-ovl="\${id}" data-tip="Tap to hide \${what}">\${sw}\${label}</button></div>\`;
  let h='';
  if(rppOn)h+=row('rpp','resident permit curbs','<i style="background:var(--meter);height:8px"></i>','Resident permit');
  if(loadOn)h+=row('load','loading and accessible curbs','<i class="dots"><b style="background:#E0A21E"></b><b style="background:#FFFDF6"></b><b style="background:#E2731E"></b><b style="background:#1F9E5A"></b><b style="background:#2F6FB5"></b></i>','Loading &amp; accessible');
  if(meterOn)h+=row('meter','paid parking','<i class="mdot"></i>','Paid parking');
  if(limitOn)h+=row('limit','time limits','<i class="ldot"></i>','Time limits');
  if(snowOn)h+=row('snow','snow emergency curbs','<i style="background:#4FA9C4;height:8px"></i>','Snow emergency');
  if(stopOn)h+=row('stop','no stopping curbs','<i style="background:#A4277C"></i>','No stopping');
  el.innerHTML=h;
  el.querySelectorAll('[data-ovl]').forEach(b=>{b.onclick=()=>
    document.getElementById({rpp:'rppToggle',load:'loadToggle',meter:'meterToggle',limit:'limitToggle',snow:'snowToggle',stop:'stopToggle'}[b.dataset.ovl]).click();});
}
`],
  ['Boston layer badges', /function refreshLayerBadges\(\)\{[\s\S]*?\n\}\n/, `function refreshLayerBadges(){
  let h='';
  if(rppOn)h+='<i class="lbdot" style="background:var(--meter)"></i>';
  if(loadOn)h+='<i class="lbdot" style="background:var(--amber)"></i>';
  if(meterOn)h+='<i class="lbdot" style="background:var(--gray)"></i>';
  if(limitOn)h+='<i class="lbdot" style="background:#FFFDF6"></i>';
  if(snowOn)h+='<i class="lbdot" style="background:#4FA9C4"></i>';
  if(stopOn)h+='<i class="lbdot" style="background:#A4277C"></i>';
  if(!statusOn.green||!statusOn.amber||!statusOn.red)
    h+='<i class="lbdot" style="background:transparent;border-style:dashed"></i>';
  document.getElementById('layerBadges').innerHTML=h;
}
`],
  // the three new tiles; then, as every layer draws at street zoom, switching one on from the zoomed out overview
  // (where the preview opens) zooms in to show it: as far as the street view needs there (bosStreetZoom; a fixed z16
  // stayed on the overview downtown, so the layer never drew)
  ['Boston layer toggles', "document.getElementById('routeToggle').onclick=function(){", `function bosToggle(id,set,layer,draw,msg){
  document.getElementById(id).onclick=function(){
    const on=!this.classList.contains('on'); this.classList.toggle('on',on); this.setAttribute('aria-pressed',on);
    set(on);
    refreshLayerBadges(); renderOvlLegend();
    if(on){ this.classList.add('busy'); draw().finally(()=>this.classList.remove('busy')); toast(msg); } else layer.clearLayers();
  };
}
bosToggle('limitToggle',v=>limitOn=v,limitLayer,drawLimits,'Free parking with a time limit shown as white dots, from the City\\'s Curb Lab (beta). Tap one for the limit and hours.');
bosToggle('snowToggle',v=>snowOn=v,snowLayer,drawSnow,'Snow emergency curbs shaded teal: no parking there once the City declares a snow emergency. From the City\\'s Curb Lab (beta).');
bosToggle('stopToggle',v=>stopOn=v,stopLayer,drawStops,'No stopping and no parking curbs in magenta: solid any time, dashed at the posted hours. Tap one for details. From the City\\'s Curb Lab (beta).');
['rppToggle','loadToggle','meterToggle','limitToggle','snowToggle','stopToggle'].forEach(id=>{
  const b=document.getElementById(id), f=b.onclick;
  b.onclick=function(e){ const was=this.classList.contains('on'); f.call(this,e); if(!was&&ovMode)bosStreetZoom().then(z=>map.setView(map.getCenter(),z)); };
});
// the first zoom from z16 at which the view around the map's center is within the cap (loadViewport's view: padded 15%)
async function bosStreetZoom(){
  let blocks; try{ blocks=await BOS.load(); }catch(e){ return MIN_ZOOM_DATA+1; }
  const c=map.getCenter(), h=map.getSize().multiplyBy(.65);
  for(let z=MIN_ZOOM_DATA+1;z<18;z++){
    const p=map.project(c,z), sw=map.unproject(p.add([-h.x,h.y]),z), ne=map.unproject(p.add([h.x,-h.y]),z);
    if(bosSides(BOS.rowsIn(blocks,sw.lng,sw.lat,ne.lng,ne.lat))<=SEG_CAP)return z;
  }
  return 18;
}
document.getElementById('routeToggle').onclick=function(){`],
  ['no SF permit-area list', "buildAreaDrop(document.getElementById('areaDropPanel'),'Browse an area…');", ''],
  ['no SF permit-area fetch', /  \(async\(\)=>\{\n    try\{\n      const r=await fetch\(RPP\+`\?\$select=rpparea1,count\(\*\) as n[\s\S]*?\}\)\(\);\n/, ''],
  // ---- the block sheet ----------------------------------------------------------------------------
  ['season and fine instead of the SF re-park rule',
    "${_soon?`<div class=\"afterpass\">Once the sweeper has passed, you can re-park here, even before the posted window ends. <a href=\"https://www.sfmta.com/getting-around/drive-park/how-avoid-parking-tickets\" target=\"_blank\" rel=\"noopener\">SFMTA rule ↗</a></div>`:''}",
    "<div class=\"afterpass\">${BOS.seasonText(_ar&&_ar.months)?'Swept '+BOS.seasonText(_ar.months)+'. ':'Swept all year. '}${_ar&&_ar.tow==='1'?'Usually a $40 ticket, and your car can be towed.':_ar&&BOS.overnight(_ar)?'Overnight sweeping: usually a $90 ticket.':'Usually a $90 ticket.'}</div>"],
  ['data notes', /<p>\$\{ae\?'"Ticketed" times[\s\S]*?Schedules live from DataSF\.<\/p>/,
    "<p>Sweeping schedules come from Boston Public Works' street sweeping schedule (Analyze Boston), placed on each block by CURB from the street names, cross streets and odd or even side. The season, the holidays (daytime sweeping stops on City holidays, overnight sweeping keeps going) and the fines follow the City's published rules. Paid, resident permit, loading and accessible curbs come from the City's Curb Lab, read from sign photos, and are still a beta. Sweep alerts and calendar reminders run on Boston time: an overnight sweep gets one alert around 9 PM the evening before.</p>"],
  // ---- sweep alerts: the shared sender, each spot with its city (lib/cities.js) --------------------------------
  ['this page is Boston', "const CITY='sf',", "const CITY='boston',"],
  ['alert curbs from the file', /  const where=`cnn in\(\$\{cnns\.map[\s\S]*?const rows=await r\.json\(\), now=new Date\(\), out=\{\};/,
    '  const rows=(await BOS.load()).filter(b=>cnns.includes(String(b.c))).flatMap(BOS.rowsOf), now=new Date(), out={};'],
  ['no SF ticket file for the alerts panel', "    await loadEnforcement();  // the ticket-time tip rides in each spot, as from a sheet\n", ''],
  // iPhone: alerts come from a Home Screen web app (the CURB app is San Francisco only)
  ['iPhone: Home Screen alerts', '<p style="font-size:13.5px;color:var(--ink-soft);line-height:1.45">The free CURB app for iPhone turns on alerts with one tap.</p>\n    <a class="btn ios-get" id="iosGet" href="https://apps.apple.com/app/id6780998238" target="_blank" rel="noopener">Get the free iPhone app</a>\n    <p class="ios-or">Or add this site to your Home Screen:</p>',
    '<a class="btn ios-get" id="iosGet" href="https://apps.apple.com/app/id6780998238" hidden>Get the free iPhone app</a>\n    <p class="ios-or">Add this map to your Home Screen to get alerts on iPhone:</p>'],
  ['iPhone panel card: Home Screen', "Alerts need the app</b><p>Safari on iPhone can't show CURB's alerts. Get the free app, or add this site to your Home Screen.</p><a class=\"btn ios-get\" href=\"https://apps.apple.com/app/id6780998238\" target=\"_blank\" rel=\"noopener\">Get the free iPhone app</a></div>`;",
    "Add CURB to your Home Screen</b><p>Safari on iPhone shows alerts only from a Home Screen web app: tap Share, then Add to Home Screen, and turn alerts on from there.</p></div>`;"],
  ['Boston web app', '<link rel="manifest" href="manifest.json">', '<link rel="manifest" href="manifest-boston.json">'],
  ['report: Boston link', "(group.cnn?'  ·  curb.guide/b/'+group.cnn:'')", "(group.cnn?'  ·  curb.guide/boston?b='+group.cnn:'')"],
  ['report: say Boston', "const _repBlock = (group.corridor||'')", "const _repBlock = 'Boston: '+(group.corridor||'')"],
  ['calendar place name', "group.corridor||'SF'", "group.corridor||'Boston'", 2],
  ['share: Boston link', "const url=location.origin+'/b/'+group.cnn+(active.blockside?'?side='+encodeURIComponent(active.blockside):'');",
    "const url=location.origin+'/boston?b='+group.cnn+(active.blockside?'&side='+encodeURIComponent(active.blockside):'');"],
  ['calendar time zone', "'&ctz=America/Los_Angeles'", "'&ctz=America/New_York'"],
  ['calendar id', "'PRODID:-//CURB//SF Sweeping//EN'", "'PRODID:-//CURB//Boston Sweeping//EN'"],
  // ---- links, search, locate ------------------------------------------------------------------------
  ['open a block from the file', /async function openCurb\(cnn,side\)\{[\s\S]*?\n\}\n/, `async function openCurb(cnn,side){
  try{
    const b=(await BOS.load()).find(x=>String(x.c)===String(cnn)); if(!b)return;
    const mid=BOS.midpoint(b.g);
    map.setView([mid[1],mid[0]],17);
    openWhenLoaded(mid[1],mid[0],cnn,700,side);
  }catch(_){}
}
`],
  ['outside the city', "'No street-sweeping data here. CURB covers San Francisco.'", "'No street-sweeping schedule here. This preview covers Boston.'"],
  // location allowed on curb.guide (for the SF map) carries over to /boston: a fix outside Boston stays put
  ['the city is Boston', 'L.latLngBounds([[37.685,-122.56],[37.84,-122.34]])', 'L.latLngBounds(BOS.BOUNDS)'],
  ['outside Boston words', "You're outside San Francisco, and this map only covers San Francisco.", "You're outside Boston, and this preview only covers Boston."],
  // the preview opens on the zoomed out overview (the demo view): one tap on a street zooms in AND opens its block
  ['one tap opens a block', "map.on('click',e=>{ userPicked(); if(ovMode){map.flyTo(e.latlng,17,{duration:.6});return;} placeYou(e.latlng.lat,e.latlng.lng,false);});",
    "map.on('click',e=>{ userPicked(); placeYou(e.latlng.lat,e.latlng.lng,ovMode);});"
    // ...and on a pointer device, the overview line under the cursor gets the curb lines' tooltip (previewHtml), for its side
    // with the soonest sweep: the overview has no curb lines to hover, and the preview opens on it
    + `\nconst ovSide=o=>{ const by={}; let side=null; (o.rules||[]).forEach(r=>{(by[sideKeyOf(r)]=by[sideKeyOf(r)]||[]).push(r);});
  for(const k in by){ const {best,bestRow}=sideNext(by[k]); if(best&&(!side||+best.start<+side.ns.start))side={key:k,blockside:by[k][0].blockside,rows:by[k],row:bestRow,ns:best,mid:o.a}; }
  return side; };
if(CAN_HOVER){
  let ovTip=null, ovOn=null, ovT=0;
  const hideOvTip=()=>{ if(ovTip){map.removeLayer(ovTip);ovTip=null;ovOn=null;} };
  map.on('mousemove',e=>{
    if(!ovMode||!ovrLines){hideOvTip();return;}
    const t=Date.now(); if(t-ovT<40)return; ovT=t;
    // the nearest line within 8 px: only blocks whose box reaches the cursor, then each piece of their line; a line
    // the legend or a day chip hides (opacity 0, buildOverviewLines) has no tooltip
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
  try{ corridors=BOS.streets(await BOS.load()); }catch(_){corridors=null;}
}
`],
  ['no match words', 'No matching SF street. Try an address like “214 Steiner St”.', 'No matching Boston street. Try an address like “120 Marlborough St”.'],
  ['suggestions: Boston addresses', /async function updateSug\(\)\{[\s\S]*?\n\}\n(?=document\.getElementById\('q'\)\.addEventListener\('keydown')/, `async function updateSug(){
  const v=document.getElementById('q').value.trim();
  if(v.length<2){hideSug();return;}
  await ensureCorridors();
  const items=[], m=v.match(/^(\\d{1,5})\\s+(.+)$/);
  if(m){ try{ const hit=BOS.findAddress(await BOS.load(),m[1],m[2]);
    if(hit){ const mid=hit.at;
      items.push({t:m[1]+' '+hit.block.s,kind:'addr',d:{latitude:mid[1],longitude:mid[0],cnn:hit.block.c,side:hit.side}}); } }catch(_){} }
  if(v===document.getElementById('q').value.trim()){  // drop stale async results
    const q=(m?m[2]:v).toUpperCase();
    (corridors||[]).filter(c=>c.toUpperCase().includes(q)).slice(0,items.length?3:6).forEach(c=>items.push({t:c,kind:'street'}));
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
  let blocks; try{ blocks=await BOS.load(); }catch(e){ toast('Search failed. Try again.'); return; }
  const m=v.match(/^(\\d{1,5})\\s+(.+)$/);
  if(m){ const hit=BOS.findAddress(blocks,m[1],m[2]);
    if(hit){ const mid=hit.at;
      document.getElementById('q').value=m[1]+' '+hit.block.s;
      placeYou(mid[1],mid[0],true,hit.block.c); if(hit.side&&pendingOpen)pendingOpen.sideHint=hit.side; return; } }
  const q=(m?m[2]:v).toUpperCase(), exact=blocks.filter(b=>b.s.toUpperCase()===q);
  const pool=exact.length?exact:blocks.filter(b=>b.s.toUpperCase().includes(q));
  if(!pool.length){toast('No swept street matched "'+v+'".');return;}
  const all=pool.filter(b=>b.s===pool[0].s);
  map.flyToBounds(L.latLngBounds(all.flatMap(b=>b.g.map(([lo,la])=>[la,lo]))),{maxZoom:17,padding:[40,40],duration:.8});
}
`],
  ['Boston weather', 'latitude=37.7749&longitude=-122.4194', 'latitude=42.3601&longitude=-71.0589'],
  ['blocks per weekday', /const DAY_BLOCKS=\[[^\]]*\];/, `const DAY_BLOCKS=${JSON.stringify(perDay)};`],
  ['day heads-up words', /function dayHeadsUp\(v\)\{[\s\S]*?\n\}\n/, `function dayHeadsUp(v){
  const n=DAY_BLOCKS[v]; if(n==null)return;
  const approx=n>=1000?Math.round(n/100)*100:n;
  toast(\`~\${approx.toLocaleString()} Boston blocks are on the \${FULLDAY[v]} schedule, in season. The colored ones are the blocks to move off.\`);
}
`],
  ['no iPhone app prompt', '(function maybeIosHint(){', '(function maybeIosHint(){ return;  // the iPhone app is San Francisco only'],
  ['no App Store links', "const rate=document.getElementById('imRate'), get=document.getElementById('imGet');", 'const rate=null, get=null;  // the iPhone app is San Francisco only'],
  ['share words', "text:'Free SF street-parking map: every block colored by its next street sweep, plus when tickets actually land.',url:'https://curb.guide'",
    "text:'Boston street sweeping, block by block: every swept curb colored by its next sweep.',url:'https://curb.guide/boston'"],
];

let out = src;
for (const [name, find, rep, count = 1] of edits) {
  const n = typeof find === 'string' ? out.split(find).length - 1 : (out.match(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g')) || []).length;
  if (n !== count) throw new Error(`boston-page: "${name}" matched ${n} times, expected ${count}. index.html changed: update scripts/cities/boston-page.mjs.`);
  out = typeof find === 'string' ? out.split(find).join(rep) : out.replace(find, () => rep);
}
const banner = '<!-- GENERATED by scripts/cities/boston-page.mjs from index.html. Do not edit: change index.html or the edits there. -->\n';
out = out.replace('<!DOCTYPE html>\n', '<!DOCTYPE html>\n' + banner);
fs.writeFileSync(ROOT + 'boston.html', out);
console.error(`[boston-page] wrote boston.html (${edits.length} edits, ${Math.round(out.length / 1024)} KB)`);
