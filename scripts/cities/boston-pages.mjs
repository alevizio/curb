#!/usr/bin/env node
// The Boston preview's two pages next to the map, GENERATED (never hand-edit them):
//   boston/about.html  (/boston/about)  How CURB works in Boston: the three moves, Boston's rules, its sweeping holidays
//                                       (lib/city-boston.js) and where the data comes from (data/boston/report.json).
//   boston/fixes.html  (/boston/fixes)  Every fix made to the City's data on the way to the map (data/boston/fixes.json,
//                                       scripts/cities/boston-fixes.mjs), each with a small map.
// Both take the About page's styles (about.html) so they look like the rest of the site, and the shared nav and footer
// (site.js, which switches to Boston's links under /boston; ?v=2 so a copy the service worker kept from before that
// switch isn't what a returning visitor gets first). Run after scripts/cities/boston.mjs:
//   node scripts/cities/boston-pages.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../lib/sweep-core.js';
import '../../lib/city-boston.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(ROOT + f, 'utf8'));
const fixes = read('data/boston/fixes.json'), report = read('data/boston/report.json');
const BOS = globalThis.BOS;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Number(n).toLocaleString('en-US');
const pct = (a, b) => Math.round((100 * a) / b) + '%';
const limits = (l) => (l ? l.replace(' - ', ' to ') : 'no cross streets');

// The About page's own styles: the Boston pages keep its type, cards and spacing.
const about = fs.readFileSync(ROOT + 'about.html', 'utf8');
const aboutStyle = /<style>([\s\S]*?)<\/style>/.exec(about)[1];

const EXTRA = `
  .sign .s-tow{display:inline-block;margin-top:9px;background:var(--sign-red);color:var(--sign);font-family:'Anton',sans-serif;
    font-size:15px;letter-spacing:.08em;padding:3px 10px 2px;border-radius:5px}
  .sign.red .s-what{margin-top:4px}
  .k{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft)}
  .sec{padding-top:clamp(44px,7vh,76px)}
  .sec h2{font-family:'Anton',sans-serif;font-size:clamp(30px,4.6vw,48px);text-transform:uppercase;line-height:.96;margin:6px 0 0}
  .lede{margin-top:12px;color:var(--ink-soft);font-weight:600;max-width:46em}
  .lede b{color:var(--ink)}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:26px}
  .stat{border:3px solid var(--ink);border-radius:14px;background:var(--sign);box-shadow:5px 5px 0 var(--ink);padding:14px 16px}
  .stat b{display:block;font-family:'Anton',sans-serif;font-size:clamp(28px,4vw,40px);line-height:1}
  .stat span{display:block;margin-top:6px;font-size:13.5px;font-weight:700;color:var(--ink-soft);line-height:1.35}
  .fixgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;margin-top:26px}
  .fix{border:3px solid var(--ink);border-radius:14px;background:var(--sign);box-shadow:5px 5px 0 var(--ink);overflow:hidden;display:flex;flex-direction:column}
  .mini{height:210px;background:#EDE6D6;border-bottom:3px solid var(--ink)}
  .fix .cap{padding:12px 14px 14px;font-size:14px;font-weight:600;color:var(--ink-soft);line-height:1.4;flex:1;display:flex;flex-direction:column;gap:6px}
  .fix .cap b{color:var(--ink);font-weight:800}
  .fix .cap .tag{align-self:flex-start;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;border-radius:999px;padding:3px 9px;background:var(--ink);color:var(--paper)}
  .fix .cap a{margin-top:auto;color:var(--ink);font-weight:800;text-underline-offset:3px}
  .key{display:flex;gap:18px;flex-wrap:wrap;margin-top:16px;font-size:13.5px;font-weight:700}
  .key i{display:inline-block;width:26px;height:0;border-top:4px solid;vertical-align:4px;margin-right:7px}
  .key .was i{border-color:var(--red);border-top-style:dashed}
  .key .now i{border-color:var(--green);border-top-width:5px}
  .tbl{width:100%;border-collapse:collapse;margin-top:22px;font-size:14.5px}
  .tbl th{text-align:left;font-size:11.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-soft);padding:0 10px 8px 0}
  .tbl td{padding:11px 10px 11px 0;border-top:2px solid rgba(23,21,15,.2);vertical-align:top;font-weight:600;color:var(--ink-soft)}
  .tbl td b{color:var(--ink);font-weight:800}
  .tbl td s{color:var(--red-text)}
  .tbl a{color:var(--ink);font-weight:800;text-underline-offset:3px}
  .tbl tr.past td{opacity:.45}
  .tbl tr.next td{background:rgba(31,158,90,.12)}
  .tbl tr.next td:first-child b::after{content:'next';margin-left:8px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;background:var(--green);color:#fff;border-radius:999px;padding:2px 7px;vertical-align:1px}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .chips span{border:2px solid var(--ink);border-radius:999px;padding:4px 11px;font-size:13px;font-weight:700;background:var(--sign)}
  .chips s{color:var(--red-text);text-decoration-thickness:2px}
  .attrib{margin-top:26px;font-size:12px;font-weight:600;color:var(--ink-soft)}
  @media (max-width:560px){.tbl .why{display:none}}
`;

function page({ path, title, description, body, extraHead = '', script = '' }) {
  return `<!DOCTYPE html>
<!-- GENERATED by scripts/cities/boston-pages.mjs. Do not edit: change the script (or its data) and rerun it. -->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="robots" content="noindex">
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="https://curb.guide${path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CURB">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="https://curb.guide${path}">
<meta property="og:image" content="https://curb.guide/og-boston.png?v=1">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="CURB Boston: a Boston street cleaning sign and the words Know where to park in Boston">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://curb.guide/og-boston.png?v=1">
<link rel="icon" type="image/svg+xml" href="/icons/favicon.svg">
<link rel="icon" sizes="any" href="/favicon.ico">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Hanken+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css">
<script src="/site.js?v=2" defer></script>${extraHead}
<style>${aboutStyle}</style>
<style>${EXTRA}</style>
</head>
<body>

<!-- nav injected by /site.js -->

<main>
${body}
</main>
${script}
</body>
</html>
`;
}

// ---------- /boston/about -------------------------------------------------------------------------------------------

const s = report.schedule, c = report.curbLab, f = fixes.summary;
const holidayRows = Object.entries(BOS.HOLIDAYS).map(([iso, name]) => {
  const d = new Date(iso + 'T12:00:00Z');
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `<tr data-iso="${iso}"><td><b>${esc(name)}</b></td><td>${esc(day)}</td></tr>`;
}).join('\n        ');

const aboutBody = `  <section class="wrap hero">
    <div>
      <h1 class="rise d1">Know where<br>to park in<br>Boston<span class="dot">.</span></h1>
      <p class="sub rise d2">Boston street sweeping, block by block: every swept curb colored by its <b>next sweep</b>, with an
        alert before it comes. Free, no account. <b>A preview</b> of CURB, built on the City of Boston's open data.</p>
      <div class="ctas rise d3">
        <a class="btn" href="/boston">Open the map →</a>
        <a class="btn ghost" href="#how">How it works</a>
      </div>
    </div>

    <div class="post rise d2" role="img" aria-label="A Boston street cleaning sign reading No Parking, Street Cleaning, 2nd and 4th Monday, 8 AM to 12 noon, April 1 to November 30, Tow Zone; and a CURB plate reading: park until Monday 8 AM">
      <div class="rail r1"></div><div class="rail r2"></div>
      <div class="sign red">
        <div class="s-no">NO PARKING</div>
        <div class="s-what">STREET CLEANING</div>
        <div class="s-days">2ND &amp; 4TH MONDAY</div>
        <div class="s-time">8 <small>A.M.</small> <span class="to">to</span> 12 <small>NOON</small></div>
        <div class="s-sub">APRIL 1 TO NOV 30</div>
        <div class="s-tow">TOW ZONE</div>
      </div>
      <div class="plate">
        <div class="t">Park until <em>Mon 8 am</em></div>
        <div class="s">curb.guide/boston</div>
      </div>
    </div>
  </section>

  <section class="wrap how" id="how">
    <div class="k">How it works</div>
    <h2>Three moves. No tickets.</h2>
    <div class="steps">
      <div class="step">
        <div class="n">01</div>
        <div>
          <h3>Open the map</h3>
          <p>Every swept curb in Boston, colored by what's coming:
            <span class="swatches" aria-hidden="true"><i style="background:var(--green)"></i><i style="background:var(--amber)"></i><i style="background:var(--red)"></i></span>
            <b>green</b> is clear, <b>amber</b> sweeps within a day, <b>red</b> means move it. Resident permit, paid parking,
            loading, time limits, snow emergency and no stopping curbs are one tap away in Layers.</p>
        </div>
      </div>
      <div class="step">
        <div class="n">02</div>
        <div>
          <h3>Tap where you parked</h3>
          <p>Get the verdict for that exact side of the street: the next sweep, which weeks of the month, the season,
            and <b>the signs the City's Curb Lab read on that curb</b>: resident permit, meters, loading, no stopping.</p>
        </div>
      </div>
      <div class="step">
        <div class="n">03</div>
        <div>
          <h3>Get pinged first</h3>
          <p>One tap sets a <b>push alert</b> the evening before your block is swept and 30 minutes before it starts,
            or drops the sweep into your calendar. On iPhone, add the map to your Home Screen first.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="wrap faq" id="rules">
    <div class="k">Boston's rules</div>
    <h2>The fine print, in plain words.</h2>
    <div class="steps" style="margin-top:26px">
      <div class="qa">
        <h3>When are Boston streets swept?</h3>
        <p>Most neighborhoods are swept <b>April 1 to November 30</b>, on a set weekday and set weeks of the month: the
          1st and 3rd, the 2nd and 4th, or every week. The North End is swept March to December, and some downtown streets
          all year. Every block has its own schedule: tap it on the map.</p>
      </div>
      <div class="qa">
        <h3>Why is one side of my street a different color?</h3>
        <p>Many streets sweep the side with <b>odd house numbers</b> on some weeks and the <b>even side</b> on others.
          CURB colors each side by its own weeks, so the side you parked on is the one that counts.</p>
      </div>
      <div class="qa">
        <h3>What about overnight sweeping?</h3>
        <p>Downtown and other busy streets are swept <b>overnight</b>, most from 12:01 to 7 AM. Overnight sweeping keeps
          going on holidays, and its alert comes once, around 9 PM the evening before.</p>
      </div>
      <div class="qa">
        <h3>What does a ticket cost?</h3>
        <p>During daytime sweeping, usually <b>a $40 ticket, and your car can be towed</b>. Overnight sweeping is usually a
          $90 ticket. The posted sign on your block is always the final word.</p>
      </div>
      <div class="qa">
        <h3>Is CURB free?</h3>
        <p>Yes. <b>Free, with no account and no ads</b>, and open source on
          <a href="https://github.com/alevizio/curb" rel="noopener">GitHub</a>. The Boston map is a preview, built on
          the City's open data; CURB started in San Francisco.</p>
      </div>
    </div>
  </section>

  <section class="wrap sec" id="holidays">
    <div class="k">Sweeping holidays</div>
    <h2>Days the sweepers skip.</h2>
    <p class="lede">On City of Boston holidays <b>daytime street sweeping is canceled</b>. <b>Overnight sweeping runs as
      usual.</b> Evacuation Day and Bunker Hill Day are regular sweeping days. CURB's colors and alerts already count
      these days.</p>
    <table class="tbl" id="holtbl">
      <thead><tr><th>Holiday</th><th>Date</th></tr></thead>
      <tbody>
        ${holidayRows}
      </tbody>
    </table>
  </section>

  <section class="wrap data" id="data">
    <div class="k">The receipts</div>
    <h2>Where the data comes from</h2>
    <p class="dlede">Three public sources from the City of Boston, joined block by block. <b>The posted sign always wins</b>:
      temporary signs and holidays override everything here.</p>
    <div class="srcs">
      <div class="src"><div class="sh">Sweeping schedules</div><p>Public Works' street sweeping schedule on Analyze Boston:
        a street, two cross streets and a side per row. CURB placed <b>${num(s.matched)} of its ${num(s.rows)} rows</b>
        (${pct(s.matched, s.rows)}) on the map, ${num(s.blocks)} blocks and ${num(s.blockSides)} curb sides.
        <a href="https://data.boston.gov/dataset/street-sweeping-schedules" rel="noopener">Dataset ↗</a></p></div>
      <div class="src"><div class="sh">Street centerlines</div><p>The City's street segments (SAM): the line of every block,
        its cross streets and which side has the odd house numbers.
        <a href="https://data.boston.gov/dataset/boston-street-segments-sam-system" rel="noopener">Dataset ↗</a></p></div>
      <div class="src"><div class="sh">Curb signs</div><p>The Curb Lab's curb zones, read from sign photos (beta):
        ${num(c.zones)} zones, for the paid, permit, loading, time limit, snow emergency and no stopping layers. Where they
        have a street cleaning sign, it agrees with the schedule on ${num(c.signAgreesWithSchedule)} of
        ${num(c.scheduleSidesWithASign)} curb sides. <a href="https://www.boston.gov/curb-lab" rel="noopener">Curb Lab ↗</a></p></div>
    </div>
    <div class="method">
      <div class="mk">Map fixes</div>
      <h3>We checked every block against the map.</h3>
      <p><b>${pct(f.nearStreets, f.blocks)} of block lines</b> sit within 4 m of the streets the map is drawn from. The
        zoomed out view now draws each block's real line (${num(f.shortcuts.over10m)} used to cut corners),
        <b>${num(f.hidden)} blocks</b> are left off because they are pedestrian streets or have no street under them, and
        <b>${num(f.renamed)} street names</b> are corrected.</p>
      <p><a class="btn ghost" href="/boston/fixes" style="margin-top:8px">See every fix →</a></p>
    </div>
  </section>`;

// past holidays fade, the next one is marked (the page is static; the date is the reader's, in Boston)
const aboutScript = `<script>
(function(){
  var t=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'}), next=null;
  document.querySelectorAll('#holtbl tr[data-iso]').forEach(function(r){
    if(r.dataset.iso<t)r.classList.add('past'); else if(!next){next=r;r.classList.add('next');}
  });
})();
</script>`;

fs.mkdirSync(ROOT + 'boston', { recursive: true });
fs.writeFileSync(ROOT + 'boston/about.html', page({
  path: '/boston/about',
  title: 'How CURB works in Boston (preview) | CURB',
  description: 'Boston street sweeping, block by block: how the map works, Boston\'s sweeping rules and holidays, and where the data comes from.',
  body: aboutBody, script: aboutScript,
}));

// ---------- /boston/fixes -------------------------------------------------------------------------------------------

const ll = (g) => g.map(([lo, la]) => [la, lo]);
const bboxOf = (g, pad = 0.0012) => {
  const lo = g.map((p) => p[0]), la = g.map((p) => p[1]);
  return [Math.min(...lo) - pad, Math.min(...la) - pad, Math.max(...lo) + pad, Math.max(...la) + pad].map((v) => v.toFixed(4)).join(',');
};
const card = ({ lines, tag, title, text, href, link }) => `      <div class="fix">
        <div class="mini" data-lines="${esc(JSON.stringify(lines))}" role="img" aria-label="${esc(title)}"></div>
        <div class="cap"><span class="tag">${esc(tag)}</span><b>${esc(title)}</b><span>${text}</span>${href ? `<a href="${href}">${esc(link)} →</a>` : ''}</div>
      </div>`;

const overviewCards = fixes.overview.map((o) => card({
  lines: { was: ll([o.g[0], o.g[o.g.length - 1]]), now: ll(o.g) },
  tag: `${Math.round(o.off)} m off`, title: `${o.s} · ${limits(o.l)}`,
  text: `${esc(o.h)}. The straight line strayed up to ${Math.round(o.off)} m from the street.`,
  href: `/boston?b=${o.c}`, link: 'Open it on the map',
})).join('\n');
const why = {
  pedestrian: 'On the sweeping schedule, but a pedestrian street on the map: there is no curb to park at.',
  'off-map': 'The City\'s line runs where the map has no street (a stub past the end of the street, or an old alignment).',
};
const hiddenCards = (kind) => fixes.hidden.filter((h) => h.kind === kind).map((h) => {
  const walk = Math.round(h.fit.walk * 100);
  return card({
    lines: { was: ll(h.g) }, tag: kind === 'pedestrian' ? 'Pedestrian street' : 'No street here',
    title: `${h.s} · ${limits(h.l)}`,
    text: `${esc(h.h)}. ${why[kind]} ${walk ? `${walk}% of the line is on a pedestrian way.` : `Up to ${Math.round(h.fit.worst)} m from the nearest street.`}`,
    href: `/boston?bbox=${bboxOf(h.g)}`, link: 'See the spot',
  });
}).join('\n');
const keptCards = fixes.kept.map((k) => card({
  lines: { now: ll(k.g) }, tag: 'Kept', title: `${k.s} · ${limits(k.l)}`,
  text: `${esc(k.h)}. The map draws no street for cars here, but the Curb Lab's signs post ${esc(k.parking.join(', '))} parking on it.`,
  href: `/boston?b=${k.c}`, link: 'Open it on the map',
})).join('\n');
const nameRows = fixes.names.map((n) => `<tr><td><s>${esc(n.from)}</s></td><td><b>${esc(n.to)}</b></td><td class="why">${esc(n.why)}</td>`
  + `<td>${n.blocks.map((cnn, i) => `<a href="/boston?b=${cnn}">${n.blocks.length > 1 ? 'block ' + (i + 1) : 'on the map'}</a>`).join(', ')}</td></tr>`).join('\n        ');
const crossChips = fixes.crossNames.map((x) => `<span><s>${esc(x.was)}</s> ${esc(x.to)}</span>`).join('');
const nPed = fixes.hidden.filter((h) => h.kind === 'pedestrian').length, nOff = fixes.hidden.length - nPed;

const fixesBody = `  <section class="wrap hero" style="grid-template-columns:1fr">
    <div>
      <div class="k rise d1">CURB Boston · preview</div>
      <h1 class="rise d1" style="margin-top:10px">Map fixes<span class="dot">.</span></h1>
      <p class="sub rise d2" style="max-width:38em">What we changed in the City's data on the way to the map, and why. Every
        block's line was checked against the streets the map is drawn from, and every street name against the City's
        street list.</p>
      <div class="ctas rise d3"><a class="btn" href="/boston">Open the map →</a><a class="btn ghost" href="/boston/about#data">Where the data comes from</a></div>
    </div>
  </section>

  <section class="wrap">
    <div class="stats">
      <div class="stat"><b>${num(f.blocks)}</b><span>swept blocks placed from the City's schedule</span></div>
      <div class="stat"><b>${pct(f.nearStreets, f.blocks)}</b><span>of block lines within 4 m of the map's streets</span></div>
      <div class="stat"><b>${num(f.shortcuts.over10m)}</b><span>zoomed out lines redrawn on the real street</span></div>
      <div class="stat"><b>${num(f.hidden)}</b><span>blocks left off: pedestrian streets, no street</span></div>
      <div class="stat"><b>${num(f.renamed + f.crossNames)}</b><span>street names corrected or respelled</span></div>
    </div>
  </section>

  <section class="wrap sec" id="overview">
    <div class="k">1 · The zoomed out view</div>
    <h2>Lines follow the streets now.</h2>
    <p class="lede">Zoomed out, the map drew each block as a straight line from one end to the other. Boston's blocks curve,
      so <b>${num(f.shortcuts.over10m)} lines cut 10 m or more off the street</b>, ${num(f.shortcuts.over50m)} of them over
      50 m, up to ${Math.round(f.shortcuts.max)} m. Each block now draws its real line at every zoom. The ones that strayed most:</p>
    <div class="key"><span class="was"><i></i>before: straight line</span><span class="now"><i></i>now: the block's real line</span></div>
    <div class="fixgrid">
${overviewCards}
    </div>
  </section>

  <section class="wrap sec" id="pedestrian">
    <div class="k">2 · Pedestrian streets</div>
    <h2>Off the parking map.</h2>
    <p class="lede"><b>${num(nPed)} blocks</b> on the sweeping schedule are pedestrian streets on the map: Downtown Crossing and
      Faneuil Hall Marketplace. The sweepers clean them, but there is no curb to park at, and where the Curb Lab read the
      signs, they say no stopping. They are left off the map.</p>
    <div class="key"><span class="was"><i></i>left off the map</span></div>
    <div class="fixgrid">
${hiddenCards('pedestrian')}
    </div>
  </section>
${nOff ? `
  <section class="wrap sec" id="nostreet">
    <div class="k">3 · Lines with no street under them</div>
    <h2>Where the map has no street.</h2>
    <p class="lede"><b>${num(nOff)} blocks</b> run mostly where the map has no street at all: a stub past the end of a street,
      or a piece of an old alignment. They are left off until the City's line and the street agree.</p>
    <div class="fixgrid">
${hiddenCards('off-map')}
    </div>
  </section>
` : ''}${fixes.kept.length ? `
  <section class="wrap sec" id="kept">
    <div class="k">Kept on purpose</div>
    <h2>Odd on the map, but real.</h2>
    <div class="fixgrid">
${keptCards}
    </div>
  </section>
` : ''}
  <section class="wrap sec" id="names">
    <div class="k">${nOff ? 4 : 3} · Street names</div>
    <h2>Names, spelled right.</h2>
    <p class="lede">The map shows the schedule's own street names, except <b>${num(f.renamed)} that are wrong there</b>
      (${num(f.renamedBlocks)} blocks): typos, one renamed street, one in capitals. The City's street list (SAM) has the right ones.</p>
    <table class="tbl">
      <thead><tr><th>Schedule says</th><th>Map shows</th><th class="why">Why</th><th>Blocks</th></tr></thead>
      <tbody>
        ${nameRows}
      </tbody>
    </table>
    <p class="lede" style="margin-top:26px">Cross street names come from the City's street list in capitals. Written for people,
      ${num(f.crossNames)} needed care: an apostrophe s is not a capital S, and Mc names keep their second capital.</p>
    <div class="chips">${crossChips}</div>
  </section>

  <section class="wrap data" id="method">
    <div class="method">
      <div class="mk">How we checked</div>
      <h3>Every block, sampled every 3 m.</h3>
      <p>Each block's line (a City street centerline) is sampled every 3 m against the streets the map is drawn from
        (OpenStreetMap). A point counts as on a street within 7 m of a street for cars (10 m for a major road, 15 m for one
        with the block's own name). A block that is mostly on a pedestrian way, or mostly on no street at all, is left off
        the map, unless the Curb Lab's signs post parking on it. The checks run every time the Boston data is rebuilt, and
        each decision is written down with its numbers.</p>
      <p class="lim">Data notes for the City: the schedule spells ${num(f.renamed)} street names differently from the street
        list (above), and ${num(nPed)} scheduled blocks are pedestrian streets. Where the Curb Lab read a street cleaning sign,
        it gives a different day or hour than the schedule on ${num(c.signDiffers)} of ${num(c.scheduleSidesWithASign)} curb sides,
        and on ${num(c.signWeeksOnlyOtherSide)} sides its weeks are the ones the schedule gives the other side of the street.</p>
    </div>
    <p class="attrib">Maps © OpenStreetMap contributors, © Protomaps. Data: City of Boston (Analyze Boston, the Curb Lab).</p>
  </section>`;

const fixesScript = `<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
(function(){
  var TILES='/basemap/boston/{z}/{x}/{y}.png';
  function draw(el){
    var d=JSON.parse(el.dataset.lines), m=L.map(el,{zoomControl:false,attributionControl:false,dragging:false,touchZoom:false,
      scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,fadeAnimation:false,zoomAnimation:false});
    // the citywide tiles first (a lone layer's minZoom becomes the map's), then the z17 tiles of the center of town
    L.tileLayer(TILES,{minNativeZoom:8,maxNativeZoom:16,maxZoom:19}).addTo(m);
    L.tileLayer(TILES,{minZoom:17,minNativeZoom:17,maxNativeZoom:17,maxZoom:19,bounds:[[42.30,-71.11],[42.385,-71.02]],zIndex:2}).addTo(m);
    var g=[];
    if(d.was)g.push(L.polyline(d.was,{color:'#C1121F',weight:4,opacity:.95,dashArray:'8 7'}).addTo(m));
    if(d.now)g.push(L.polyline(d.now,{color:'#1F9E5A',weight:5,opacity:.95}).addTo(m));
    m.fitBounds(L.featureGroup(g).getBounds().pad(.7),{maxZoom:18});
  }
  var els=document.querySelectorAll('.mini[data-lines]');
  if(!('IntersectionObserver' in window)){els.forEach(draw);return;}
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){io.unobserve(e.target);draw(e.target);}});},{rootMargin:'300px'});
  els.forEach(function(el){io.observe(el);});
})();
</script>`;

fs.writeFileSync(ROOT + 'boston/fixes.html', page({
  path: '/boston/fixes',
  title: 'Boston map fixes (preview) | CURB',
  description: 'Every fix made to the City of Boston\'s data on the way to the CURB map: block lines checked against the streets, pedestrian streets left off, street names corrected.',
  body: fixesBody, script: fixesScript,
  extraHead: '\n<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">',
}));
console.error('[boston-pages] wrote boston/about.html and boston/fixes.html');
