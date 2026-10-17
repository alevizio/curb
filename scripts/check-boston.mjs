// Headless check of the Boston preview (boston.html, built by scripts/cities/boston-page.mjs) on a phone screen:
// the page loads with no errors, the citywide overview draws, street zoom draws curb sides from data/boston/,
// a block opens its sheet with Boston's season line, an address search opens the right side of the street, and a
// location outside Boston (allowed on curb.guide for the SF map) never flies the map off Boston.
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

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  check(!bad.length, 'no failed or SF requests' + (bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''));
} finally { await b.close(); }
if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1); }
console.log('\nBoston preview OK');
