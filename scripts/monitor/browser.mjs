// Nightly real-browser check of curb.guide (headless Chrome, phone-sized), run by monitor.yml.
// Walks the core user path and returns { name, status, detail } results like smoke.mjs:
//   map loads → basemap tiles render → curb lines draw at street zoom → ONE tap on "use my location"
//   finds you → tapping a block opens its sheet → no script errors along the way.
// It never taps "Sweep alerts" (that would create a real push subscription in production).
//
//   node scripts/monitor/browser.mjs [--out results.json] [--shots dir]
// Env: MONITOR_SITE (default https://curb.guide), CHROME_PATH (default: macOS Chrome / google-chrome).
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const SITE = process.env.MONITOR_SITE || 'https://curb.guide';
const CHROME = process.env.CHROME_PATH
  || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find(existsSync);
const HERE = { latitude: 37.7596, longitude: -122.4148, accuracy: 20 }; // Mission, a dense swept area
const TAP = [37.7597, -122.4216];                                       // Valencia St at 19th

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

const results = [];
const ok = (name, detail = '') => results.push({ name, status: 'ok', detail });
const fail = (name, detail) => results.push({ name, status: 'fail', detail });
const errors = [];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  const origin = new URL(SITE).origin;
  await browser.defaultBrowserContext().overridePermissions(origin, ['geolocation']);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setGeolocation(HERE);
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && (u.startsWith(origin) || u.includes('data.sf.gov')) && !u.includes('/_vercel/')) errors.push(`HTTP ${r.status()} ${u.split('?')[0]}`);
  });
  const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png` }).catch(() => {});
  const waitFor = (fn, ms, ...a) => page.waitForFunction(fn, { timeout: ms, polling: 250 }, ...a).then(() => true, () => false);

  await page.goto(SITE + '/', { waitUntil: 'load', timeout: 45000 });
  // A first-time visitor sees the welcome card; dismiss it the way a person would.
  if (await waitFor(() => { const b = document.getElementById('welcomeGo'); return b && b.offsetParent; }, 8000)) await page.click('#welcomeGo');

  (await waitFor(() => document.querySelectorAll('.leaflet-tile-loaded').length >= 8, 25000))
    ? ok('browser: basemap renders')
    : fail('browser: basemap renders', 'fewer than 8 map tiles loaded within 25s');

  await page.evaluate(() => map.setView([37.7596, -122.4148], 17, { animate: false }));
  const lines = await waitFor(() => document.querySelectorAll('.leaflet-overlay-pane path').length > 100, 30000);
  const n = await page.evaluate(() => document.querySelectorAll('.leaflet-overlay-pane path').length);
  lines ? ok('browser: curb lines draw', `${n} curb lines at street zoom`) : fail('browser: curb lines draw', `only ${n} curb lines after 30s (DataSF or rendering is failing)`);
  await shot('1-map');

  // ONE tap must find you (the "needs two taps" bug). Start far away so a move is unambiguous.
  await page.evaluate(() => map.setView([37.79, -122.46], 15, { animate: false }));
  await page.click('#locate');
  const found = await waitFor((lat, lng) => {
    const c = map.getCenter();
    return Math.abs(c.lat - lat) < 0.003 && Math.abs(c.lng - lng) < 0.003;
  }, 15000, HERE.latitude, HERE.longitude);
  found ? ok('browser: location works on first tap') : fail('browser: location works on first tap', 'the map did not move to the user within 15s of ONE tap on "use my location"');
  await shot('2-locate');

  // Tap a block → its parking sheet opens.
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s) s.classList.remove('open'); });
  await page.evaluate((ll) => map.setView(ll, 17, { animate: false }), TAP);
  await waitFor(() => document.querySelectorAll('.leaflet-overlay-pane path').length > 100, 20000);
  const pt = await page.evaluate((ll) => { const p = map.latLngToContainerPoint(ll); const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, TAP);
  await page.mouse.click(pt.x, pt.y);
  (await waitFor(() => document.getElementById('sheet')?.classList.contains('open'), 10000))
    ? ok('browser: tapping a block opens its sheet')
    : fail('browser: tapping a block opens its sheet', 'no parking sheet within 10s of tapping Valencia St');
  await shot('3-sheet');
} catch (e) {
  fail('browser: run', `crashed: ${e.message}`);
} finally {
  await browser.close();
}
errors.length ? fail('browser: no script or network errors', [...new Set(errors)].slice(0, 8).join(' · ')) : ok('browser: no script or network errors');

for (const r of results) console.log(`${r.status === 'ok' ? '✅' : '❌'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
