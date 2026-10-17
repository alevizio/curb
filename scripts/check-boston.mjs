// Headless check of the Boston preview (boston.html, built by scripts/cities/boston-page.mjs) on a phone screen:
// the page loads with no errors, the citywide overview draws each block's real line, the data comes with its fixes
// (data/boston/fixes.json), street zoom draws curb sides from data/boston/, a block opens its sheet with Boston's season
// line, an address search opens the right side of the street, a location outside Boston (allowed on curb.guide for the
// SF map) never flies the map off Boston, and the pages next to the map (/boston/about, /boston/fixes) load.
// Views change with animate:false: Leaflet drops a setView issued during another zoom animation.
// Usage: node scripts/check-boston.mjs [site] [--shots dir]   (default site http://localhost:3077, `npm run dev`)
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const args = process.argv.slice(2);
const SITE = args.find((a) => /^https?:/.test(a)) || 'http://localhost:3077';
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) => existsSync(p));

const fails = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  const errors = [], bad = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    pg.on('response', (r) => { const u = r.url(); if (r.status() >= 400 && !/\/basemap\/|_vercel|favicon|api\/client-error|\/config\.js$/.test(u)) bad.push(r.status() + ' ' + u); });
    pg.on('request', (r) => { if (/data\.sf\.gov|open-meteo\.com\/v1\/forecast\?latitude=37/.test(r.url())) bad.push('SF request ' + r.url()); });
  };
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  watch(p);
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('curbOnboarded', '1'); } catch (_) {} });

  await p.goto(SITE + '/boston', { waitUntil: 'load' });
  check(await p.evaluate(() => !!window.BOS && sfParts(new Date(Date.UTC(2026, 9, 16, 16))).h === 12), 'Boston time core: 16:00 UTC is noon in Boston');

  // one real tap on a street at the opening view (the zoomed out overview) zooms in AND opens that block
  const tapAt = async (ll) => { const pt = await p.evaluate((ll) => { const q = map.latLngToContainerPoint(ll), r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; }, ll); await p.mouse.click(pt.x, pt.y); };
  const marlborough = await p.evaluate(async () => { const m = BOS.midpoint(BOS.findAddress(await BOS.load(), 120, 'Marlborough St').block.g); return [m[1], m[0]]; });
  check(await p.evaluate(() => ovMode), 'opens on the citywide overview');
  await tapAt(marlborough);
  await p.waitForFunction(() => document.getElementById('sheet').classList.contains('open'), { timeout: 15000, polling: 250 }).catch(() => {});
  const tapped = await p.evaluate(() => document.querySelector('#sheetBody .where')?.innerText || '');
  check(/Marlborough St/.test(tapped), `one tap on Marlborough St from the opening view opens it (${tapped.replace(/\s+/g, ' ').trim() || 'no sheet'})`);
  await p.evaluate(() => document.getElementById('sheetClose').click());

  // the welcome card lists Boston's neighborhoods, like SF's, and a link frames the map in place
  const hoodCount = await p.evaluate(() => { showWelcome(); return document.querySelectorAll('.whoods a[data-bbox]').length; });
  const bbox = await p.evaluate(() => { const a = [...document.querySelectorAll('.whoods a[data-bbox]')].find((x) => x.textContent === 'Back Bay');
    a.click(); return a.dataset.bbox.split(',').map(Number); });
  await new Promise((r) => setTimeout(r, 1500));
  const framed = await p.evaluate(([w, s, e, n]) => { const c = map.getCenter();
    return !document.getElementById('welcome').classList.contains('open') && c.lng > w && c.lng < e && c.lat > s && c.lat < n; }, bbox);
  check(hoodCount >= 15 && framed, `the welcome card lists ${hoodCount} neighborhoods, and Back Bay frames the map`);
  await p.evaluate(() => map.setView(BOS.CENTER, 13, { animate: false }));
  await p.waitForFunction(() => typeof OVR !== 'undefined' && OVR && OVR.length > 5000 && map.hasLayer(overviewLayer), { timeout: 30000, polling: 250 }).catch(() => {});
  check(await p.evaluate(() => typeof OVR !== 'undefined' && !!OVR && OVR.length > 5000 && map.hasLayer(overviewLayer)), 'citywide overview drawn from data/boston/segments.json');
  // ...with each block's real line, not a straight one between its ends (a curving block strayed up to ~170 m)
  const curvy = await p.evaluate(() => { const e = ovrLines.find((x) => x.b.g.length > 10); return e ? e.ln.getLatLngs().length : 0; });
  check(curvy > 10, `the opening view draws each block's real line (${curvy} points on a curving block)`);

  // the fixes to the City's data (scripts/cities/boston-fixes.mjs, data/boston/fixes.json): blocks on pedestrian streets
  // or with no street under them are left off, and wrong street names come fixed
  const fx = await p.evaluate(async () => { const B = await BOS.load(), F = await (await fetch('/data/boston/fixes.json')).json();
    const ids = new Set(B.map((x) => String(x.c)));
    return { gone: F.hidden.every((h) => !ids.has(String(h.c))), hidden: F.hidden.length, ped: F.hidden.filter((h) => h.kind === 'pedestrian').map((h) => h.s),
      jersey: B.some((x) => x.s === 'Jersey St'), yawkey: B.some((x) => x.s === 'Yawkey Way'), names: F.names.length }; });
  check(fx.gone && fx.hidden >= 10 && fx.ped.includes('Winter St'), `the ${fx.hidden} blocks the fixes leave off (pedestrian streets like Winter St) are not on the map`);
  check(fx.jersey && !fx.yawkey && fx.names >= 10, `street names come fixed: Yawkey Way shows as Jersey St (${fx.names} names)`);

  // like SF's: the welcome's How it works and the menu open Boston's own pages, and shared links show Boston's card
  const links = await p.evaluate(() => ({ about: document.querySelector('.wabout')?.getAttribute('href'),
    menu: [...document.querySelectorAll('#infoMenu a.im-item')].map((a) => a.getAttribute('href')).filter(Boolean), card: document.querySelector('meta[property="og:image"]')?.content }));
  check(links.about === '/boston/about' && ['/boston/about#holidays', '/boston/fixes', '/boston/about'].every((h) => links.menu.includes(h))
    && !links.menu.some((h) => /^\/(about|holidays|tickets|n\/)$/.test(h)), `the welcome and the menu open Boston's pages (${links.menu.join(', ')})`);
  check(/og-boston\.png/.test(links.card || ''), 'shared links show the Boston card');
  await p.evaluate(() => { document.getElementById('infoBtn').click(); document.getElementById('imHoods').click(); });
  check(await p.evaluate(() => document.getElementById('welcome').classList.contains('open') && !!document.querySelector('.whoods a[data-bbox]')),
    'the menu\'s Neighborhoods opens the neighborhood list');
  await p.evaluate(() => markOnboarded());
  if (SHOTS) await p.screenshot({ path: SHOTS + '/1-overview.png' });

  // street zoom on the South End: curb sides drawn from the static file
  await p.evaluate(() => map.setView([42.3416, -71.0742], 17, { animate: false }));
  await p.waitForFunction(() => !ovMode && segCache.length > 20, { timeout: 30000, polling: 250 }).catch(() => {});
  const n = await p.evaluate(() => segCache.length);
  check(n > 20, `street zoom draws curb sides (${n})`);
  if (SHOTS) await p.screenshot({ path: SHOTS + '/2-street.png' });

  // tap a curb side: the sheet says Boston things
  const opened = await p.evaluate(() => { const o = segCache.find((x) => x.side.ns); if (!o) return null; openSheet(o.group, o.side.key); return o.group.corridor; });
  await new Promise((r) => setTimeout(r, 600));
  const sheet = await p.evaluate(() => document.getElementById('sheetBody').innerText);
  check(!!opened && /Swept (April to November|March to December|all year)/.test(sheet), `sheet for ${opened} shows the season line`);
  check(!/SFMTA|DataSF|Ticketed/.test(sheet), 'sheet never mentions SF data');
  check(!!(await p.$('#alertBtn')), 'the sheet offers Sweep alerts');
  if (SHOTS) await p.screenshot({ path: SHOTS + '/3-sheet.png' });

  // calendar link carries Boston's time zone
  const gcal = await p.evaluate(() => { let u = ''; const o = window.open; window.open = (x) => { u = x; }; try { const s = segCache.find((x) => x.side.ns); if (s) openGoogleCal('Test St', 'A to B', s.side.ns); } finally { window.open = o; } return u; });
  check(/ctz=America\/New_York/.test(gcal), 'Google Calendar link uses America/New_York');

  // address search → the block and the side with that number
  await p.evaluate(() => { document.getElementById('sheetClose').click(); document.getElementById('q').value = '120 Marlborough St'; doSearch(); });
  await p.waitForFunction(() => document.getElementById('sheet').classList.contains('open'), { timeout: 30000, polling: 250 }).catch(() => {});
  const where = await p.evaluate(() => document.querySelector('#sheetBody .where')?.innerText || '');
  check(/Marlborough St/.test(where), `address search opens Marlborough St (${where.replace(/\s+/g, ' ').trim()})`);
  const pin = await p.evaluate(async () => { const g = BOS.findAddress(await BOS.load(), 120, 'Marlborough St').block.g;
    const away = ([lo, la]) => map.distance(youMarker.getLatLng(), [la, lo]);
    return Math.round(Math.min(away(g[0]), away(g[g.length - 1]))); });
  check(pin > 60, `the address pin sits mid-block, ${pin} m from the nearer end`);
  if (SHOTS) await p.screenshot({ path: SHOTS + '/4-address.png' });

  // layers from the Curb Lab
  await p.evaluate(() => { document.getElementById('sheetClose').click(); map.setView([42.3503, -71.0810], 17, { animate: false }); });
  await new Promise((r) => setTimeout(r, 1500));
  // while the curb file loads (4.4 MB the first time, held here until all the taps are in), a layer switched off stays
  // off, and one switched on, off and on again draws once
  const race = await p.evaluate(async () => {
    if (BCURBS) return null;
    const real = BOS.curbs; let go; const gate = new Promise((r) => { go = r; });
    BOS.curbs = () => gate.then(real);
    const paid = document.getElementById('meterToggle'), stop = document.getElementById('stopToggle');
    paid.click(); paid.click(); stop.click(); stop.click(); stop.click();
    go(); await bosCurbs(); await new Promise((r) => setTimeout(r, 300));
    BOS.curbs = real;
    const out = { paid: meterLayer.getLayers().length, stop: stopLayer.getLayers().length, zones: bosIn(BCURBS.nostop, map.getBounds()).length };
    stop.click();
    return out;
  });
  check(race && race.paid === 0 && race.zones > 0 && race.stop === race.zones, `layer taps while the curb file loads: off stays off, on draws once (${JSON.stringify(race)})`);
  await p.evaluate(() => { document.getElementById('meterToggle').click(); document.getElementById('rppToggle').click(); });
  await new Promise((r) => setTimeout(r, 2500));
  const lay = await p.evaluate(() => ({ meters: meterLayer.getLayers().length, rpp: rppLayer.getLayers().length }));
  check(lay.meters > 0, `paid parking dots drawn (${lay.meters})`);
  if (SHOTS) await p.screenshot({ path: SHOTS + '/5-layers.png' });

  // the other Curb Lab layers: time limits, snow emergency, no stopping, loading and accessible, all in the legend
  await p.evaluate(() => map.setView([42.3500, -71.0790], 16, { animate: false }));
  await new Promise((r) => setTimeout(r, 1500));
  await p.evaluate(() => ['limitToggle', 'snowToggle', 'stopToggle', 'loadToggle'].forEach((id) => document.getElementById(id).click()));
  await new Promise((r) => setTimeout(r, 3000));
  const more = await p.evaluate(() => ({ limit: limitLayer.getLayers().length, snow: snowLayer.getLayers().length, stop: stopLayer.getLayers().length,
    load: loadLayer.getLayers().length, permit: rppLayer.getLayers().length, legend: document.querySelectorAll('#ovlLeg [data-ovl]').length }));
  check(Object.values(more).every((n) => n > 0) && more.legend === 6, `all six curb layers draw, with a legend row each (${JSON.stringify(more)})`);
  if (SHOTS) await p.screenshot({ path: SHOTS + '/6-all-layers.png' });

  // a side with posted rules lists them in its sheet (data/boston/rules.json)
  const posted = await p.evaluate(async () => {
    const R = await BOS.rules(), has = (k, layer) => R.s[k].some((i) => R.t[i][0] === layer);
    const key = Object.keys(R.s).find((k) => has(k, 'nostop') && has(k, 'snow')), [cnn, lr] = key.split('|');
    const b = (await BOS.load()).find((x) => String(x.c) === cnn);
    document.getElementById('sheetClose').click(); openCurb(cnn, b.d.find((d) => d[0] === lr)[1]);
    return key;
  });
  await p.waitForFunction(() => { const l = document.getElementById('curbRules'); return l && !l.hidden; }, { timeout: 15000, polling: 250 }).catch(() => {});
  const lines = await p.evaluate(() => [...document.querySelectorAll('#curbRules .crule')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  check(lines.some((t) => /^No (stopping|parking)/.test(t)) && lines.some((t) => /^Snow emergency/.test(t)), `a side's sheet lists its posted rules (${posted}: ${lines.join(' | ')})`);
  if (SHOTS) await p.screenshot({ path: SHOTS + '/7-posted-rules.png' });

  // location already allowed on curb.guide (from the SF map, say) by someone in San Francisco: Boston stays on Boston
  const cnn = await p.evaluate(async () => BOS.findAddress(await BOS.load(), 120, 'Marlborough St').block.c);
  await b.defaultBrowserContext().overridePermissions(SITE, ['geolocation']);
  const g = await b.newPage();
  await g.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  watch(g);
  await g.evaluateOnNewDocument(() => { try { localStorage.setItem('curbOnboarded', '1'); } catch (_) {} });
  const nearBoston = () => g.evaluate(() => map.getCenter().distanceTo([42.3603, -71.0580]) < 30000);   // City Hall
  await g.setGeolocation({ latitude: 37.7749, longitude: -122.4194, accuracy: 20 });
  await g.goto(SITE + '/boston', { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 4000));
  check(await nearBoston(), 'opened in San Francisco with location allowed, the map stays on Boston');
  await g.evaluate(() => document.getElementById('locate').click());
  await g.waitForFunction(() => /outside Boston/.test(document.getElementById('toast').textContent), { timeout: 15000, polling: 250 }).catch(() => {});
  check(await nearBoston() && await g.evaluate(() => /outside Boston/.test(document.getElementById('toast').textContent)), 'the locate button in San Francisco says so and keeps Boston on screen');
  // someone in Back Bay still lands on their block
  await g.setGeolocation({ latitude: 42.3503, longitude: -71.0810, accuracy: 20 });
  await g.reload({ waitUntil: 'load' });
  await g.waitForFunction(() => map.getCenter().distanceTo([42.3503, -71.0810]) < 50, { timeout: 15000, polling: 250 }).catch(() => {});
  check(await g.evaluate(() => map.getCenter().distanceTo([42.3503, -71.0810]) < 50), 'opened in Back Bay, the map centers on you');
  // a shared block link (/boston?b=) centers on the middle of the block
  await g.goto(`${SITE}/boston?b=${cnn}`, { waitUntil: 'load' });
  await g.waitForFunction(() => document.getElementById('sheet').classList.contains('open'), { timeout: 30000, polling: 250 }).catch(() => {});
  const linked = await g.evaluate(async (c) => { const l = (await BOS.load()).find((x) => String(x.c) === String(c)).g;
    const away = ([lo, la]) => map.getCenter().distanceTo([la, lo]);
    return Math.round(Math.min(away(l[0]), away(l[l.length - 1]))); }, cnn);
  check(linked > 60, `a shared block link centers mid-block, ${linked} m from the nearer end`);

  // Sweep alerts on a Boston curb (web push faked, the save intercepted): the saved spot names the city, carries the
  // season and is timed in Boston; the panel resolves it from the Boston data and sends an SF curb to its own map
  const al = await b.newPage();
  await al.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  watch(al);
  const posts = [];
  await al.setRequestInterception(true);
  al.on('request', (r) => {
    const u = new URL(r.url()), mine = u.origin === new URL(SITE).origin;
    if (mine && u.pathname === '/api/save-subscription') { posts.push({ method: r.method(), body: JSON.parse(r.postData() || '{}') }); return r.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    if (mine && u.pathname.startsWith('/api/')) return r.respond({ status: 204, body: '' });
    return r.continue();
  });
  await al.evaluateOnNewDocument(() => {
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/boston-check', options: {}, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } }; } };
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    Notification.requestPermission = async () => 'granted';
    const reg = { pushManager: { getSubscription: async () => sub, subscribe: async () => sub } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg), register: async () => reg } });
    try { localStorage.setItem('curbOnboarded', '1'); localStorage.setItem('curbFirstSheet', '1'); } catch (_) {}
  });
  await al.goto(SITE + '/boston', { waitUntil: 'load' });
  await al.evaluate(() => { document.getElementById('q').value = '120 Marlborough St'; doSearch(); });
  await al.waitForFunction(() => document.getElementById('alertBtn'), { timeout: 30000, polling: 250 }).catch(() => {});
  await al.evaluate(() => document.getElementById('alertBtn').click());
  await al.waitForFunction(() => /Alerts on/.test(document.getElementById('alertBtn')?.textContent || ''), { timeout: 15000, polling: 250 }).catch(() => {});
  const saved = posts.find((x) => x.method === 'POST'), mine = await al.evaluate(() => sheetSpot && sheetSpot.nextSweepISO);
  const sp = saved && saved.body.spot;
  check(!!sp && sp.city === 'boston' && sp.multi === 1 && sp.rules.length > 0 && sp.rules.every((r) => Array.isArray(r.months)) && sp.nextSweepISO === mine,
    `arming alerts saves a Boston spot with its season, timed by the page (${sp ? sp.corridor + ' ' + sp.nextSweepISO + ' months ' + JSON.stringify(sp.rules[0].months) : 'no save'})`);
  check(await al.evaluate(() => /Alerts on/.test(document.getElementById('alertBtn').textContent)), 'the sheet then says alerts are on');
  // an SF curb saved on this device shows in the Boston panel as "In San Francisco", sent to its own map
  await al.evaluate(() => { const m = JSON.parse(localStorage.getItem('curbAlert') || '{}');
    m['7735000|West'] = { cnn: '7735000', sideKey: 'West', corridor: 'Kansas St', limits: '16th St - 17th St', blockside: 'West', level: 'normal', voice: 'cheeky', armedAt: Date.now(), v: 2 };
    localStorage.setItem('curbAlert', JSON.stringify(m)); openAlertsPanel(); });
  await al.waitForFunction(() => [...document.querySelectorAll('.ap-row .ap-next')].some((x) => /Next sweep/.test(x.textContent)), { timeout: 15000, polling: 250 }).catch(() => {});
  const rows = await al.evaluate(() => [...document.querySelectorAll('.ap-row')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  check(rows.length === 2 && rows.some((t) => /Marlborough St/.test(t) && /Next sweep/.test(t)) && rows.some((t) => /Kansas St/.test(t) && /In San Francisco/.test(t) && /Open the San Francisco map/.test(t)),
    `the alerts panel shows the Boston curb's next sweep and sends the SF one to its map (${rows.join(' | ')})`);

  // desktop: a line on the opening view (the overview) shows the curb tooltip on hover, and a paid parking dot opens
  // its popup (not the block under it)
  const d = await b.newPage();
  await d.setViewport({ width: 1440, height: 900 });
  watch(d);
  await d.evaluateOnNewDocument(() => { try { localStorage.setItem('curbOnboarded', '1'); localStorage.setItem('curbFirstSheet', '1'); } catch (_) {} });
  await d.goto(SITE + '/boston', { waitUntil: 'load' });
  await d.waitForFunction(() => typeof OVR !== 'undefined' && OVR && OVR.length > 5000 && ovMode, { timeout: 30000, polling: 250 }).catch(() => {});
  // a straight block, so the middle of its two ends is on its line
  const ovAt = await d.evaluate(() => { const o = OVR.find((x) => x.g.length === 2 && map.getBounds().pad(-0.2).contains(x.a) && map.getBounds().pad(-0.2).contains(x.z));
    const q = map.latLngToContainerPoint([(o.a[0] + o.z[0]) / 2, (o.a[1] + o.z[1]) / 2]), r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; });
  await d.mouse.move(ovAt.x - 20, ovAt.y - 20); await d.mouse.move(ovAt.x, ovAt.y, { steps: 6 });
  await d.waitForFunction(() => document.querySelector('.leaflet-tooltip.curbtip'), { timeout: 5000, polling: 100 }).catch(() => {});
  const hover = await d.evaluate(() => document.querySelector('.leaflet-tooltip.curbtip')?.innerText.replace(/\s+/g, ' ').trim() || '');
  check(/sweeps/i.test(hover), `hovering a line on the opening view shows its curb tooltip (${hover.slice(0, 70) || 'none'})`);
  // ...and a line the legend hides shows none: Clear, Soon and Now off leave only the gray lines
  const legend = (on) => d.evaluate((on) => ['green', 'amber', 'red'].forEach((k) => { const c = document.querySelector(`.legend2 .lst[data-st="${k}"]`); if (c.classList.contains('on') !== on) c.click(); }), on);
  await legend(false);
  await new Promise((r) => setTimeout(r, 1500));
  const hidAt = await d.evaluate(() => {
    const r = document.getElementById('map').getBoundingClientRect(), inner = map.getBounds().pad(-0.2), shown = ovrLines.filter((e) => e.ln.options.opacity > 0);
    const near = (pt) => shown.some(({ b }) => b.g.some((ll, i) => { if (!i) return false; const a = map.latLngToContainerPoint(b.g[i - 1]), z = map.latLngToContainerPoint(ll), dx = z.x - a.x, dy = z.y - a.y, l2 = dx * dx + dy * dy;
      const u = l2 ? Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2)) : 0; return Math.hypot(pt.x - a.x - u * dx, pt.y - a.y - u * dy) < 12; }));
    for (const { b: o, ln } of ovrLines) { if (ln.options.opacity || o.g.length !== 2 || !inner.contains(o.a) || !inner.contains(o.z)) continue;
      const q = map.latLngToContainerPoint([(o.a[0] + o.z[0]) / 2, (o.a[1] + o.z[1]) / 2]); if (!near(q)) return { x: r.left + q.x, y: r.top + q.y }; }
    return null; });
  if (hidAt) { await d.mouse.move(hidAt.x - 20, hidAt.y - 20); await d.mouse.move(hidAt.x, hidAt.y, { steps: 6 }); await new Promise((r) => setTimeout(r, 120)); await d.mouse.move(hidAt.x + 1, hidAt.y); }
  await new Promise((r) => setTimeout(r, 500));
  const hidTip = await d.evaluate(() => document.querySelector('.leaflet-tooltip.curbtip')?.innerText.replace(/\s+/g, ' ').trim() || '');
  check(hidAt && !hidTip, `a line the legend hides shows no tooltip (${hidAt ? hidTip.slice(0, 60) || 'none' : 'no hidden line found'})`);
  await legend(true);
  await d.mouse.move(5, 450);
  // switched on from the opening view, a layer zooms in to the street view and draws (downtown on a laptop, z16 used to
  // keep the zoomed out view, and the layer drew nothing)
  await d.evaluate(() => document.getElementById('meterToggle').click());
  await d.waitForFunction(() => !ovMode && meterLayer.getLayers().length > 0, { timeout: 15000, polling: 250 }).catch(() => {});
  const fromOpen = await d.evaluate(() => ({ zoom: map.getZoom(), street: !ovMode, dots: meterLayer.getLayers().length }));
  check(fromOpen.street && fromOpen.dots > 0, `paid parking switched on from the opening view zooms in and draws (${JSON.stringify(fromOpen)})`);
  await d.evaluate(() => map.setView([42.3497, -71.0760], 17, { animate: false }));
  await new Promise((r) => setTimeout(r, 2500));
  // a status chip redraws the sweep lines; the dots stay over them, so a click still reaches the dot
  await d.evaluate(() => { const c = document.querySelector('.legend2 .lst[data-st="green"]'); c.click(); c.click(); });
  await new Promise((r) => setTimeout(r, 800));
  const dotAt = await d.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(), l = meterLayer.getLayers().find((x) => map.getBounds().pad(-0.15).contains(x.getLatLng()));
    if (!l) return null; const q = map.latLngToContainerPoint(l.getLatLng()); return { x: r.left + q.x, y: r.top + q.y }; });
  if (dotAt) await d.mouse.click(dotAt.x, dotAt.y);
  await new Promise((r) => setTimeout(r, 1000));
  const pop = await d.evaluate(() => document.querySelector('.leaflet-popup-content')?.innerText.replace(/\s+/g, ' ').trim() || '');
  check(/paid parking/i.test(pop) && !(await d.evaluate(() => document.getElementById('sheet').classList.contains('open'))),
    `after a status chip, a click on a paid parking dot opens its popup, not the block (${pop.slice(0, 70) || 'none'})`);

  // the pages next to the map: How it works (with the holidays) and Map fixes, with Boston's nav and every small map drawn
  const pg = await b.newPage();
  watch(pg);
  for (const [path, want] of [['/boston/about', /Days the sweepers skip/i], ['/boston/fixes', /Map fixes/i]]) {
    const res = await pg.goto(SITE + path, { waitUntil: 'networkidle0' });
    const info = await pg.evaluate(() => ({ text: document.body.innerText, logo: document.querySelector('.sn-logo')?.getAttribute('href'), ios: !!document.querySelector('.sn-cta.sn-ghost') }));
    check(res.status() === 200 && want.test(info.text) && info.logo === '/boston' && !info.ios, `${path} loads, with Boston's nav`);
  }
  await pg.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } });
  await new Promise((r) => setTimeout(r, 1500));
  const minis = await pg.evaluate(() => ({ all: document.querySelectorAll('.mini[data-lines]').length, drawn: document.querySelectorAll('.mini.leaflet-container').length }));
  check(minis.all >= 15 && minis.drawn === minis.all, `every fix on /boston/fixes draws its map (${minis.drawn} of ${minis.all})`);
  // the page to share: the City's questions answered, with the fixes before and after (pictures in boston/img/)
  const notes = await pg.goto(SITE + '/boston/notes', { waitUntil: 'networkidle0' });
  const pics = await pg.evaluate(async () => {
    for (const i of document.images) i.loading = 'eager';
    await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
    return { all: document.images.length, shown: [...document.images].filter((i) => i.naturalWidth > 0).length, asks: document.querySelectorAll('.ask').length,
      logo: document.querySelector('.sn-logo')?.getAttribute('href') };
  });
  check(notes.status() === 200 && pics.logo === '/boston' && pics.asks >= 8 && pics.all >= 10 && pics.shown === pics.all,
    `/boston/notes loads with Boston's nav, ${pics.asks} answers and every picture (${pics.shown} of ${pics.all})`);

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  check(!bad.length, 'no failed or SF requests' + (bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''));
} finally { await b.close(); }
if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1); }
console.log('\nBoston preview OK');
