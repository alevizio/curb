#!/usr/bin/env node
// Builds boston.html (the Boston preview at curb.guide/boston) from index.html, so Boston gets San Francisco's
// map, sheet and fixes as they are, with only the parts below swapped. Each edit must match exactly where it
// expects to (the build fails otherwise), and the list doubles as the map of what is still tied to SF
// (docs/multi-city/README.md, "Tied to San Francisco"). Boston's data: scripts/cities/boston.mjs. Its time and
// data helpers: lib/city-boston.js.
//
// Not on the Boston page yet: sweep alerts (the push sender runs on SF time; a saved spot needs a city first),
// ticket times, sweeper GPS, truck routes, block and neighborhood pages, permit-area browsing.
//
// Run after index.html or data/boston/ changes: node scripts/cities/boston-page.mjs

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = fs.readFileSync(ROOT + 'index.html', 'utf8');
const data = JSON.parse(fs.readFileSync(ROOT + 'data/boston/segments.json', 'utf8'));

// Blocks swept per weekday, for the day-chip heads-up (index.html DAY_BLOCKS is SF's).
const perDay = [0, 1, 2, 3, 4, 5, 6].map((d) => data.b.filter((b) => b.d.some(([, , rules]) => rules.some((r) => r[0] === d))).length);

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
  // ---- body: words and menus ---------------------------------------------------------------------
  ['h1', /<h1 class="srh">[^<]*<\/h1>/, '<h1 class="srh">Boston street cleaning map: sweeping schedules by block (a CURB preview)</h1>'],
  ['map label', '<main id="map" aria-label="San Francisco parking map">', '<main id="map" aria-label="Boston parking map">'],
  ['no alerts in the menu', '<button class="im-item" id="imAlerts" role="menuitem">', '<button class="im-item" id="imAlerts" role="menuitem" style="display:none">'],
  ['SF pages → Boston data sources', /<a class="im-item" href="\/n\/" role="menuitem">[\s\S]*?<a class="im-item" href="\/tickets" role="menuitem">[\s\S]*?<\/a>/,
    `<a class="im-item" href="https://github.com/alevizio/curb/blob/main/docs/multi-city/boston.md" target="_blank" rel="noopener" role="menuitem">
          <span class="im-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14"/><path d="M4 19h16M8 7h8M8 11h8M8 15h5"/></svg></span>
          <span class="im-tx"><b>Boston data</b><small>Where this preview's rules come from</small></span>
        </a>`],
  ['menu footer link', '<a href="https://datasf.org" target="_blank" rel="noopener">SF open data</a>', '<a href="https://data.boston.gov" target="_blank" rel="noopener">Boston open data</a>'],
  ['menu footer', 'Built on SF open data (DataSF). The posted sign is always the final word.', 'Built on Boston open data and the City\'s Curb Lab. The posted sign is always the final word.'],
  ['permit tile', '<span class="tl">Permit zones</span>', '<span class="tl">Resident permit</span>'],
  ['loading tile', '<span class="prev"><b style="background:#E0A21E"></b><b style="background:#FFFDF6"></b><b style="background:#C1121F"></b></span><span class="tl">Loading zones</span>',
    '<span class="prev"><b style="background:#E0A21E"></b><b style="background:#FFFDF6"></b><b style="background:#2F6FB5"></b></span><span class="tl">Loading &amp; accessible</span>'],
  ['meter tile', '<span class="tl">Meters</span>', '<span class="tl">Paid parking</span>'],
  ['no truck routes', '<button class="ltile" id="routeToggle" aria-pressed="false">', '<button class="ltile" id="routeToggle" aria-pressed="false" style="display:none">'],
  ['no permit areas', '<div class="lp-sec">Permit areas</div>\n    <div class="arearow">', '<div class="lp-sec" style="display:none">Permit areas</div>\n    <div class="arearow" style="display:none">'],
  ['welcome', /<p>Every curb in SF, colored by[\s\S]*?<\/p>/,
    '<p>Every swept curb in Boston, colored by its <b>next street sweep</b>. Tap where you parked for the rules. <b>A preview</b>, built on the City\'s open data.</p>'],
  ['no SF neighborhoods', /\s*<!-- hoods:start[\s\S]*?<!-- hoods:end -->/, ''],
  ['welcome footer', /<p class="wfoot">[\s\S]*?<\/p>/,
    '<p class="wfoot">Free, no account. Built on <a href="https://data.boston.gov" target="_blank" rel="noopener">Boston\'s open data</a>. The posted sign always wins.</p>'],
  // ---- scripts: Boston's time core and data --------------------------------------------------------
  ['load lib/city-boston.js', '<script src="/lib/sweep-core.js?v=7"></script>', '<script src="/lib/sweep-core.js?v=7"></script>\n<script src="/lib/city-boston.js?v=3"></script>'],
  ['retry it like the time core', "if(!window.nextSweep)again('script[src^=\"/lib/sweep-core.js\"]');}",
    "if(!window.nextSweep)again('script[src^=\"/lib/sweep-core.js\"]');\nif(window.nextSweep&&!window.BOS)again('script[src^=\"/lib/city-boston.js\"]');}"],
  ['fail without it', 'if(!window.L||!window.nextSweep){', 'if(!window.L||!window.nextSweep||!window.BOS){'],
  ['basemap tiles', "const SELF_BASEMAP='/basemap/parchment/{z}/{x}/{y}.png';", "const SELF_BASEMAP='/basemap/boston/{z}/{x}/{y}.png';"],
  ['start in Boston', '.setView([37.7749,-122.4194],15);', '.setView(BOS.CENTER,BOS.ZOOM);'],
  ['basemap: Boston tiles stop at z16', 'maxNativeZoom:17,maxZoom:20,bounds:[[37.20,-123.10],[38.30,-121.60]],', 'maxNativeZoom:16,maxZoom:20,bounds:BOS.TILE_BOUNDS,'],
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
  if(data.length>SEG_CAP){enterOverviewMode(false);return;}  // same cap as SF: a wide z15 window stays on the overview
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
}
let bosRanges=false;
`],
  ['overview from the same file', /async function ensureOverview\(\)\{[\s\S]*?return OVR;\n\}/, `async function ensureOverview(){
  if(OVR)return OVR;
  OVR=BOS.overview(await BOS.load());
  return OVR;
}`],
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
  for(const k of ['paid','permit','accessible','loading'])c[k].forEach(z=>{
    let w=180,s=90,e=-180,n=-90; z.g.forEach(([lo,la])=>{if(lo<w)w=lo;if(lo>e)e=lo;if(la<s)s=la;if(la>n)n=la;});
    z.bb=[w,s,e,n]; z.ll=z.g.map(([lo,la])=>[la,lo]);
  });
  return BCURBS=c;
}
function bosIn(list,b){const w=b.getWest(),s=b.getSouth(),e=b.getEast(),n=b.getNorth();return list.filter(z=>z.bb[2]>=w&&z.bb[0]<=e&&z.bb[3]>=s&&z.bb[1]<=n);}
// the zone of a layer nearest to a curb side's midpoint, within m meters (zones sit on their own side of the street)
function bosNear(list,mid,m){
  let best=null,bd=m*m; const pad=0.0005;
  list.forEach(z=>{ if(mid[1]<z.bb[0]-pad||mid[1]>z.bb[2]+pad||mid[0]<z.bb[1]-pad||mid[0]>z.bb[3]+pad)return;
    const d=distSqToLineMeters(mid[0],mid[1],z.ll); if(d<bd){bd=d;best=z;} });
  return best;
}
const fmtMax=m=>m?(m%60?m+' min':(m/60)+' hr')+' max':'';
async function loadRpp(poly, my){
  try{
    const c=await bosCurbs(); if(my!==fetchTok)return;
    rppLayer.clearLayers(); rppCache=[];
    bosIn(c.permit,map.getBounds().pad(0.15)).forEach(z=>{
      L.polyline(z.ll,{color:getCSS('--meter'),weight:rppWeight(),opacity:.14,lineCap:'round',interactive:false}).addTo(rppLayer);
      rppCache.push({latlngs:z.ll, area:'', hrlimit:z.max?Math.round(z.max/60):null, when:z.when});
    });
  }catch(e){}
}
`],
  ['permit hover line', "${rpp?`<div class=\"tip-rpp\">Permit Zone ${rpp.area}${rpp.hrlimit?' · '+rpp.hrlimit+'hr limit':''} · holders exempt</div>`:''}",
    "${rpp?`<div class=\"tip-rpp\">Resident permit${rpp.hrlimit?' · others '+rpp.hrlimit+' hr':''}</div>`:''}"],
  ['permit toggle words', "if(rppOn)toast('Permit zones (RPP) shaded blue. Tap a block for area & hours.');",
    "if(rppOn)toast('Resident permit curbs shaded blue, from the City\\'s Curb Lab (beta, read from sign photos). Tap a block for the hours.');"],
  ['Boston permit chip', /function renderRpp\(rp\)\{[\s\S]*?\n\}\nasync function loadRppBlock\(latlngs,mid,cnn\)\{[\s\S]*?\n\}\n(?=async function loadMeterBlock)/, `function renderRpp(rp){
  const slot=document.getElementById('rppSlot'); if(!slot)return;
  if(!rp){slot.style.display='none';return;}
  slot.style.display='inline-flex';
  slot.innerHTML=\`<span class="adisc" style="background:var(--meter)">P</span><span class="rpptxt"><b>Resident permit</b>\${rp.hrlimit?' · others '+rp.hrlimit+' hr':''}\${rp.when?' · '+rp.when:''}</span>\`;
  slot.title="Resident permit parking, from the City's Curb Lab (beta)";
  slot.removeAttribute('role'); slot.removeAttribute('tabindex'); slot.onclick=null; slot.onkeydown=null;
}
async function loadRppBlock(latlngs,mid,cnn){
  const key=cnn+'|'+(mid?mid.join(','):'');
  if(key in rppBlockCache){renderRpp(rppBlockCache[key]);return;}
  try{
    const z=mid&&bosNear((await bosCurbs()).permit,mid,9);
    const rp=z?{area:'',hrlimit:z.max?Math.round(z.max/60):null,when:z.when}:null;
    rppBlockCache[key]=rp; renderRpp(rp);
  }catch(e){renderRpp(null);}
}
`],
  ['Boston meter badge', /async function loadMeterBlock\(latlngs,cnn\)\{[\s\S]*?\n\}\n(?=function refreshToday)/, `async function loadMeterBlock(latlngs,cnn){
  const slot=document.getElementById('headMeter'); if(!slot)return;
  slot.style.display='none';
  if(!latlngs||!latlngs.length)return;
  try{
    const z=bosNear((await bosCurbs()).paid,latlngs[Math.floor(latlngs.length/2)],9);
    if(!z)return;
    slot.innerHTML=METER_ICON+(z.rate?'$'+(+z.rate).toFixed(2).replace(/\\.00$/,'')+'/hr':'Metered');
    slot.title='Paid parking'+(z.max?' · '+fmtMax(z.max):'')+(z.when?' · '+z.when:'')+". From the City's Curb Lab (beta).";
    slot.style.display='inline-flex';
  }catch(e){}
}
`],
  ['Boston paid parking dots', /async function drawMeters\(\)\{[\s\S]*?\n\}\n/, `async function drawMeters(){
  let c; try{ c=await bosCurbs(); }catch(e){ toast('Paid parking data unavailable right now.'); return; }
  meterLayer.clearLayers();
  if(ovMode||map.getZoom()<MIN_ZOOM_DATA)return;
  const z=map.getZoom(), mr=z>=18?4:z>=17?3.5:z>=16?3:2.5;
  bosIn(c.paid,map.getBounds()).forEach(p=>{
    L.circleMarker(p.ll[Math.floor(p.ll.length/2)],{renderer:meterRenderer,radius:mr,color:'#17150F',weight:1,fillColor:getCSS('--gray'),fillOpacity:.85})
      .bindPopup(\`<div class="lp-h">Paid parking</div><div class="lp-m">\${p.rate?'$'+(+p.rate).toFixed(2)+' an hour':'Metered'}\${p.max?' · '+fmtMax(p.max):''}</div><div class="lp-s">\${p.when||''}</div><div class="lp-s">City Curb Lab data (beta). The posted sign is the source of truth.</div>\`,{className:'loadpop',maxWidth:240})
      .addTo(meterLayer);
  });
}
`],
  ['Boston loading and accessible curbs', /async function drawLoadZones\(\)\{[\s\S]*?\n\}\n/, `async function drawLoadZones(){
  let c; try{ c=await bosCurbs(); }catch(e){ toast('Loading zones unavailable right now.'); return; }
  loadLayer.clearLayers();
  if(ovMode||map.getZoom()<MIN_ZOOM_DATA)return;
  const b=map.getBounds(), ww=map.getZoom()>=17?4:3;
  const draw=(z,fill,head,sub)=>{
    L.polyline(z.ll,{color:'#17150F',weight:ww+3,opacity:.85,lineCap:'round',interactive:false}).addTo(loadLayer);
    L.polyline(z.ll,{color:fill,weight:ww,opacity:1,lineCap:'round'})
      .bindPopup(\`<div class="lp-h">\${head}</div><div class="lp-m">\${sub}</div><div class="lp-s">\${z.when||''}</div><div class="lp-s" style="margin-top:5px">City Curb Lab data (beta). The posted sign is the source of truth.</div>\`,{className:'loadpop',maxWidth:250})
      .addTo(loadLayer);
  };
  bosIn(c.loading,b).forEach(z=>draw(z,z.who==='commercial'?'#E0A21E':'#FFFDF6','Loading zone',z.who==='commercial'?'Commercial vehicles':'Passenger pick-up and drop-off'));
  bosIn(c.accessible,b).forEach(z=>draw(z,'#2F6FB5','Accessible parking','Disability placard or plate'));
}
`],
  ['loading toggle words', "toast('Loading zones: dots = metered curbs (🟡 commercial · ⚪ passenger · 🔴 truck · 🟢 short-term · 🟠 bus). White curb lines = passenger loading, school zones included. Tap anything for hours.');",
    "toast('Loading and accessible curbs from the City\\'s Curb Lab (beta): yellow = commercial loading, white = passenger, blue = accessible. Tap one for hours.');"],
  ['meter toggle words', "toast('Metered curbs shown as grey dots. Check the meter for hours & rates.');",
    "toast('Paid parking shown as grey dots, from the City\\'s Curb Lab (beta). Tap one for the rate and hours.');"],
  ['Boston legend rows', /function renderOvlLegend\(\)\{[\s\S]*?\n\}\n(?=\(function initLayersPanel)/, `function renderOvlLegend(){
  const el=document.getElementById('ovlLeg');
  let h='';
  if(rppOn)h+=\`<div class="lov"><button class="lst on" data-ovl="rpp" data-tip="Tap to hide resident permit curbs"><i style="background:var(--meter);height:8px"></i>Resident permit</button></div>\`;
  if(loadOn)h+=\`<div class="lov"><button class="lst on" data-ovl="load" data-tip="Tap to hide loading and accessible curbs"><i class="dots"><b style="background:#E0A21E"></b><b style="background:#FFFDF6"></b><b style="background:#2F6FB5"></b></i>Loading &amp; accessible</button></div>\`;
  if(meterOn)h+=\`<div class="lov"><button class="lst on" data-ovl="meter" data-tip="Tap to hide paid parking"><i class="mdot"></i>Paid parking</button></div>\`;
  el.innerHTML=h;
  el.querySelectorAll('[data-ovl]').forEach(b=>{b.onclick=()=>
    document.getElementById({rpp:'rppToggle',load:'loadToggle',meter:'meterToggle'}[b.dataset.ovl]).click();});
}
`],
  ['no SF permit-area list', "buildAreaDrop(document.getElementById('areaDropPanel'),'Browse an area…');", ''],
  ['no SF permit-area fetch', /  \(async\(\)=>\{\n    try\{\n      const r=await fetch\(RPP\+`\?\$select=rpparea1,count\(\*\) as n[\s\S]*?\}\)\(\);\n/, ''],
  // ---- the block sheet ----------------------------------------------------------------------------
  ['season and fine instead of the SF re-park rule',
    "${_soon?`<div class=\"afterpass\">Once the sweeper has passed, you can re-park here, even before the posted window ends. <a href=\"https://www.sfmta.com/getting-around/drive-park/how-avoid-parking-tickets\" target=\"_blank\" rel=\"noopener\">SFMTA rule ↗</a></div>`:''}",
    "<div class=\"afterpass\">${BOS.seasonText(_ar&&_ar.months)?'Swept '+BOS.seasonText(_ar.months)+'. ':'Swept all year. '}${_ar&&_ar.tow==='1'?'Usually a $40 ticket, and your car can be towed.':_ar&&BOS.overnight(_ar)?'Overnight sweeping: usually a $90 ticket.':'Usually a $90 ticket.'}</div>"],
  ['no alert button', "${canRemind?`<button class=\"btn ${alertOn?'on':''}\" id=\"alertBtn\">${alertOn?'✓ Alerts on':ICONS.bell+' Sweep alerts'}</button>`:''}", ''],
  ['no alert off switch', /\s*<div class="calchoice" id="alertOff" hidden>[\s\S]*?<div class="alertnote" id="alertNote" hidden><\/div>/, ''],
  ['no alert style', /\$\{canRemind\?`<details class="alertcfg" id="alertCfg">[\s\S]*?<\/details>`:''\}/, ''],
  ['no alert handlers', /    \/\/ "✓ Alerts on" offers the off switch[\s\S]*?    refreshWatch\(spot\);\n/, ''],
  ['first-sheet tip', /const tip="That's this curb's verdict\.[^\n]*\n/, 'const tip="That\'s this curb\'s verdict. Calendar adds its next sweep to your phone.";\n'],
  ['data notes', /<p>\$\{ae\?'"Ticketed" times[\s\S]*?Schedules live from DataSF\.<\/p>/,
    "<p>Sweeping schedules come from Boston Public Works' street sweeping schedule (Analyze Boston), placed on each block by CURB from the street names, cross streets and odd or even side. The season, the holidays (daytime sweeping stops on City holidays, overnight sweeping keeps going) and the fines follow the City's published rules. Paid, resident permit, loading and accessible curbs come from the City's Curb Lab, read from sign photos, and are still a beta. Calendar reminders fire about 30 min before. Sweep alerts are not on for Boston yet.</p>"],
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
