// Headless check of the Boston preview (boston.html, built by scripts/cities/boston-page.mjs) on a phone screen:
// the page loads with no errors, the citywide overview draws, street zoom draws curb sides from data/boston/,
// a block opens its sheet with Boston's season line, and an address search opens the right side of the street.
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
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [], bad = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  p.on('response', (r) => { const u = r.url(); if (r.status() >= 400 && !/\/basemap\/|_vercel|favicon|api\/client-error|\/config\.js$/.test(u)) bad.push(r.status() + ' ' + u); });
  p.on('request', (r) => { if (/data\.sf\.gov|open-meteo\.com\/v1\/forecast\?latitude=37/.test(r.url())) bad.push('SF request ' + r.url()); });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('curbOnboarded', '1'); } catch (_) {} });

  await p.goto(SITE + '/boston', { waitUntil: 'load' });
  check(await p.evaluate(() => !!window.BOS && sfParts(new Date(Date.UTC(2026, 9, 16, 16))).h === 12), 'Boston time core: 16:00 UTC is noon in Boston');
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
  check(!(await p.$('#alertBtn')), 'no sweep alerts button (alerts are SF only)');
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

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  check(!bad.length, 'no failed or SF requests' + (bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''));
} finally { await b.close(); }
if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1); }
console.log('\nBoston preview OK');
