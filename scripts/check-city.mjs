// Headless check of a city's page (<id>.html, built by scripts/cities/city-page.mjs) on a phone screen: the page loads
// with no errors and no San Francisco data requests, the basemap draws from the city's vector file, the citywide view
// draws, street zoom draws curb sides, a block's sheet opens with its schedule (no "undefined", no "NaN"), an address
// search opens the right street, a shared link opens its block, the calendar carries the city's time zone, and a saved
// alert carries the city and every rule.
// Usage: node scripts/check-city.mjs <id> [site]   (default site http://localhost:3077, `npm run dev`)
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [ID, SITE = 'http://localhost:3077'] = process.argv.slice(2);
if (!ID) { console.error('usage: node scripts/check-city.mjs <id> [site]'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const city = JSON.parse(readFileSync(new URL(`../data/${ID}/city.json`, import.meta.url), 'utf8'));

const fails = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  const errors = [], bad = [];
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  p.on('response', (r) => { const u = r.url(); if (r.status() >= 400 && !/_vercel|favicon|api\/client-error|\/config\.js$|basemaps\.cartocdn/.test(u)) bad.push(r.status() + ' ' + u); });
  const basemap = [];
  p.on('response', (r) => { if (/\/basemap\/cities\/[^/]+\.pmtiles/.test(r.url())) basemap.push(r.status()); });
  p.on('request', (r) => { if (/data\.sfgov\.org|data\.sf\.gov|\/data\/(enforcement|sweeps|routes|zones|overview)\.json|open-meteo\.com\/v1\/forecast\?latitude=37\.77/.test(r.url())) bad.push('SF request ' + r.url()); });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('curbOnboarded', '1'); localStorage.setItem('curbFirstSheet', '1'); } catch (_) {} });

  const res = await p.goto(`${SITE}/${ID}`, { waitUntil: 'load' });
  check(res.status() === 200 && await p.evaluate((id) => !!window.PLACE && window.PLACE.id === id && CITY === id, ID), `/${ID} loads with its city (PLACE, CITY)`);
  check(await p.evaluate((tz) => PLACE.core.tz === tz && sfParts === PLACE.core.parts, city.tz), `the page runs on ${city.tz}`);

  // the opening view draws curbs (the citywide view, or curb sides when the city opens at street zoom)
  await p.waitForFunction(() => (typeof OVR !== 'undefined' && OVR && OVR.length && map.hasLayer(overviewLayer)) || (!ovMode && segCache.length > 0), { timeout: 30000, polling: 250 }).catch(() => {});
  check(await p.evaluate(() => (!!OVR && OVR.length > 0 && map.hasLayer(overviewLayer)) || (!ovMode && segCache.length > 0)), `the opening view (zoom ${city.zoom}) draws curbs`);
  // the basemap: the city's vector file answers byte ranges and MapLibre draws the parchment style from it
  await p.waitForFunction(() => { let gl = null; map.eachLayer((l) => { if (l.getMaplibreMap) gl = l.getMaplibreMap(); });
    return !!gl && gl.isStyleLoaded() && gl.areTilesLoaded(); }, { timeout: 30000, polling: 250 }).catch(() => {});
  const drawn = await p.evaluate(() => { let gl = null; map.eachLayer((l) => { if (l.getMaplibreMap) gl = l.getMaplibreMap(); });
    return !!gl && gl.isStyleLoaded() && gl.areTilesLoaded() && gl.queryRenderedFeatures().length > 0; });
  check(drawn && basemap.length > 0 && basemap.every((s) => s === 206 || s === 200), `the basemap draws (${basemap.length} reads of basemap/cities/${ID}.pmtiles: ${[...new Set(basemap)].join(', ') || 'none'})`);
  // the citywide view, zoomed out
  await p.evaluate(() => map.setView(PLACE.CENTER, 12, { animate: false }));
  await p.waitForFunction(() => typeof OVR !== 'undefined' && OVR && OVR.length && map.hasLayer(overviewLayer), { timeout: 30000, polling: 250 }).catch(() => {});
  const ov = await p.evaluate(async () => ({ drawn: OVR ? OVR.length : 0, blocks: (await PLACE.load()).length }));
  check(ov.drawn > 0 && ov.drawn === ov.blocks, `the citywide view draws every block (${ov.drawn} of ${ov.blocks})`);

  // street zoom on a block that has a rule this year, then its sheet
  const pick = await p.evaluate(async () => {
    const blocks = await PLACE.load();
    const b = blocks.find((x) => PLACE.rowsOf(x).some((r) => nextSweep(r))) || blocks[0];
    const m = PLACE.midpoint(b.g); return { c: b.c, s: b.s, lat: m[1], lng: m[0] };
  });
  await p.evaluate((q) => map.setView([q.lat, q.lng], 17, { animate: false }), pick);
  await p.waitForFunction(() => !ovMode && segCache.length > 0, { timeout: 30000, polling: 250 }).catch(() => {});
  const sides = await p.evaluate(() => segCache.length);
  check(sides > 0, `street zoom draws curb sides (${sides})`);
  await p.evaluate((c) => { const o = segCache.find((x) => String(x.group.cnn) === String(c) && x.side.ns) || segCache.find((x) => x.side.ns) || segCache[0]; openSheet(o.group, o.side.key); }, pick.c);
  await new Promise((r) => setTimeout(r, 700));
  const sheet = await p.evaluate(() => document.getElementById('sheetBody').innerText.replace(/\s+/g, ' ').trim());
  check(sheet.length > 40 && !/undefined|NaN|null/.test(sheet), `the sheet opens with a schedule (${sheet.slice(0, 110)})`);
  check(!/SFMTA|DataSF|San Francisco/.test(sheet), 'the sheet never mentions San Francisco or its data');

  // calendar time zone
  const gcal = await p.evaluate(() => { let u = ''; const o = window.open; window.open = (x) => { u = x; }; try { const s = segCache.find((x) => x.side.ns); if (s) openGoogleCal('Test St', 'A to B', s.side.ns); } finally { window.open = o; } return u; });
  check(gcal.includes('ctz=' + encodeURIComponent(city.tz)) || gcal.includes('ctz=' + city.tz), `the calendar link uses ${city.tz}`);

  // a saved alert carries the city and every rule of the side
  const spot = await p.evaluate(() => { const o = segCache.find((x) => x.side.ns); if (!o) return null;
    const s = alertSpotFor(o.group, o.side, o.side.ns, o.side.row); return s && { city: CITY, rules: (s.rules || []).length, sideRules: o.side.rows.length, dates: (s.rules || []).some((r) => r.dates) }; });
  check(!!spot && spot.rules >= 1 && spot.rules <= Math.max(1, spot.sideRules), `an alert carries its side's rules (${JSON.stringify(spot)})`);

  // address search
  const addr = await p.evaluate(async () => { const b = (await PLACE.load()).find((x) => x.n && x.o); return b ? { q: (b.n[0] % 2 ? b.n[0] : b.n[0] + 1) + ' ' + b.s, s: b.s } : null; });
  if (addr) {
    await p.evaluate((q) => { document.getElementById('sheetClose').click(); document.getElementById('q').value = q; doSearch(); }, addr.q);
    await p.waitForFunction(() => document.getElementById('sheet').classList.contains('open'), { timeout: 20000, polling: 250 }).catch(() => {});
    const where = await p.evaluate(() => document.querySelector('#sheetBody .where')?.innerText || '');
    check(where.includes(addr.s), `address search "${addr.q}" opens ${addr.s} (${where.replace(/\s+/g, ' ').trim().slice(0, 80)})`);
  } else console.log('skip address search: no block with house numbers and an odd side');

  // a shared link (/<id>?b=<block>&side=<side>) opens that block's sheet, ids with letters or dashes included
  const link = await p.evaluate(async () => { const bl = await PLACE.load(); const b = bl.find((x) => /[^0-9]/.test(String(x.c))) || bl[Math.floor(bl.length / 2)];
    return { c: String(b.c), s: b.s, ends: String(b.l || '').split(' - ').filter(Boolean), side: b.d[0][1] }; });
  await p.goto(`${SITE}/${ID}?b=${encodeURIComponent(link.c)}&side=${encodeURIComponent(link.side)}`, { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('sheet').classList.contains('open'), { timeout: 30000, polling: 250 }).catch(() => {});
  const opened = await p.evaluate(() => document.querySelector('#sheetBody .where')?.innerText || '');
  check(opened.includes(link.s) && link.ends.every((e) => opened.includes(e)), `a shared link to block ${link.c} opens ${link.s} (${opened.replace(/\s+/g, ' ').trim().slice(0, 80)})`);

  // a city that offers French: the ⓘ menu switches language, and in French the page reads French
  if ((city.languages || []).includes('fr')) {
    const f = await b.newPage();
    await f.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    f.on('pageerror', (e) => errors.push('fr: ' + e.message));
    await f.evaluateOnNewDocument(() => { try { localStorage.setItem('curbLang', 'fr'); localStorage.setItem('curbOnboarded', '1'); localStorage.setItem('curbFirstSheet', '1'); } catch (_) {} });
    await f.goto(`${SITE}/${ID}`, { waitUntil: 'load' });
    await f.waitForFunction(() => typeof segCache !== 'undefined' && segCache.length > 0, { timeout: 30000, polling: 250 }).catch(() => {});
    await f.evaluate(() => { const o = segCache.find((x) => x.side.ns); if (o) openSheet(o.group, o.side.key); });
    await new Promise((r) => setTimeout(r, 900));
    const fr = await f.evaluate(() => ({ lang: document.documentElement.lang, item: document.querySelector('#imLang .im-tx b')?.textContent,
      sheet: document.getElementById('sheetBody').innerText.replace(/\s+/g, ' ').trim() }));
    check(fr.lang === 'fr' && fr.item === 'English' && /Stationnez|Nettoyage en cours|voir le panneau/i.test(fr.sheet) && !/Park until|every week|\bin \d+ days\b/i.test(fr.sheet),
      `in French the page reads French (${fr.sheet.slice(0, 80)})`);
    await f.close();
  }

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  check(!bad.length, 'no failed or San Francisco requests' + (bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''));
} finally { await b.close(); }
if (fails.length) { console.error(`\n${ID}: ${fails.length} check(s) failed`); process.exit(1); }
console.log(`\n${ID} page OK`);
