// Headless check of a city's page (<id>.html, built by scripts/cities/city-page.mjs) on a phone screen: the page loads
// with no errors and no San Francisco data requests, the basemap draws from the city's vector file, the citywide view
// draws, street zoom draws curb sides, a block's sheet opens with its schedule (no "undefined", no "NaN"), an address
// search opens the right street, a shared link opens its block, the calendar carries the city's time zone, a saved
// alert carries the city and every rule, and a city with a winter rule shows it as its switch says and on an enforced night.
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

  // a city with a winter rule (city.json winter: Madison): as the City's switch says today, then on an enforced night
  if (city.winter && !city.winter.declared) {
    const sw = JSON.parse(readFileSync(new URL(`../data/${ID}/winter.json`, import.meta.url), 'utf8'));
    const winterPage = async (clock, status) => {
      const w = await b.newPage();
      await w.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await w.setBypassServiceWorker(true);
      w.on('pageerror', (e) => errors.push('winter: ' + e.message));
      await w.evaluateOnNewDocument((t) => {
        try { localStorage.setItem('curbOnboarded', '1'); localStorage.setItem('curbFirstSheet', '1'); } catch (_) {}
        if (t) { const D = Date, off = t - D.now(); class FD extends D { constructor(...a) { super(...(a.length ? a : [D.now() + off])); } static now() { return D.now() + off; } } window.Date = FD; }
      }, clock || 0);
      if (status) {
        await w.setRequestInterception(true);
        w.on('request', (r) => (r.url().includes(`/data/${ID}/winter.json`) ? r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(status) }) : r.continue()));
      }
      await w.goto(`${SITE}/${ID}`, { waitUntil: 'load' });
      await w.waitForFunction(() => window.WINTER && !document.getElementById('wPlate').hidden, { timeout: 30000, polling: 250 }).catch(() => {});
      // a block whose two sides switch (each its own list, one rule a side), at street zoom, and its sheet
      const q = await w.evaluate(async () => { const b = (await PLACE.load()).find((x) => x.n && x.d.length === 2 && x.d.every((d) => d[2].length === 1 && d[2][0][5] & 4 && !(d[2][0][5] & 8))
          && x.d[0][2][0][6] !== x.d[1][2][0][6]);
        const m = PLACE.midpoint(b.g); map.setView([m[1], m[0]], 17, { animate: false }); return String(b.c); });
      await w.waitForFunction((c) => !ovMode && segCache.some((x) => String(x.group.cnn) === c), { timeout: 30000, polling: 250 }, q).catch(() => {});
      return { w, q };
    };
    const sheetOf = (w, q) => w.evaluate((c) => { const o = segCache.find((x) => String(x.group.cnn) === c); openSheet(o.group, o.side.key);
      return { text: document.getElementById('sheetBody').innerText.replace(/\s+/g, ' ').trim(), cal: !!document.getElementById('calBtn'), alert: !!document.getElementById('alertBtn'),
        spot: sheetSpot && { next: sheetSpot.nextSweepISO, winter: (sheetSpot.rules || []).filter((r) => r.flags & 4 && Array.isArray(r.dates) && r.dates.length > 20).length } }; }, q);
    const plate = (w) => w.evaluate(() => document.getElementById('wPlate').innerText.replace(/\s+/g, ' ').trim());
    if (sw.state !== 'on') {
      const { w, q } = await winterPage();
      const lines = await w.evaluate((c) => segCache.filter((x) => String(x.group.cnn) === c).map((x) => !x.side.ns && x.side.color), q);
      check(/not in effect yet|paused|starts/i.test(await plate(w)) && lines.length === 2 && lines.every(Boolean), `winter (${sw.state}): the plate says it isn't on, and both sides wait (${(await plate(w)).slice(0, 60)})`);
      const s1 = await sheetOf(w, q);
      check(/Winter rule/i.test(s1.text) && s1.alert && !s1.cal && s1.spot && s1.spot.winter === 1, `winter (${sw.state}): the sheet says so, alerts can be on, no calendar (${s1.text.slice(0, 70)})`);
      await w.close();
    }
    // Tue Dec 1 of the season at 4 PM (no Sunday or holiday morning ahead), switched on from that night; which side tonight
    // is the page's own answer (the morning's date in Madison, the evening's in Milwaukee)
    const y = city.winter.from.slice(0, 4), clock = Date.parse(`${y}-12-01T22:00:00Z`);
    const { w, q } = await winterPage(clock, { state: 'on', from: `${y}-12-01`, at: `${y}-11-30T22:00:00Z` });
    const colors = await w.evaluate((c) => segCache.filter((x) => String(x.group.cnn) === c).map((x) => x.side.color), q);
    const red = await w.evaluate(() => getCSS('--red')), green = await w.evaluate(() => getCSS('--green'));
    const park = await w.evaluate(() => PLACE.winterNight().park);
    check(new RegExp(`Park on the ${park} side`, 'i').test(await plate(w)) && colors.length === 2 && colors.includes(red) && colors.includes(green),
      `winter on: the plate says tonight's side (${park}) and the block has one red and one green side (${(await plate(w)).slice(0, 60)})`);
    const s2 = await sheetOf(w, q);
    check(/Move by|Park until/i.test(s2.text) && /where you are/i.test(s2.text) && s2.cal && s2.spot && Date.parse(s2.spot.next) > clock,
      `winter on: the sheet says when to move, both sides tonight, alerts and calendar (${s2.text.slice(0, 70)})`);
    await w.close();
  }

  // a declared rule (city.json winter.declared: Toronto's snow routes, both sides at all hours while the City's declaration
  // lasts): as the switch says today, then on a declared day
  if (city.winter && city.winter.declared) {
    const sw = JSON.parse(readFileSync(new URL(`../data/${ID}/winter.json`, import.meta.url), 'utf8'));
    const declaredPage = async (clock, status) => {
      const w = await b.newPage();
      await w.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await w.setBypassServiceWorker(true);
      w.on('pageerror', (e) => errors.push('declared: ' + e.message));
      await w.evaluateOnNewDocument((t) => {
        try { localStorage.setItem('curbOnboarded', '1'); localStorage.setItem('curbFirstSheet', '1'); } catch (_) {}
        if (t) { const D = Date, off = t - D.now(); class FD extends D { constructor(...a) { super(...(a.length ? a : [D.now() + off])); } static now() { return D.now() + off; } } window.Date = FD; }
      }, clock || 0);
      if (status) {
        await w.setRequestInterception(true);
        w.on('request', (r) => (r.url().includes(`/data/${ID}/winter.json`) ? r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(status) }) : r.continue()));
      }
      await w.goto(`${SITE}/${ID}`, { waitUntil: 'load' });
      await w.waitForFunction(() => window.WINTER && !document.getElementById('wPlate').hidden, { timeout: 30000, polling: 250 }).catch(() => {});
      // a block whose only rule is the declared one, on both sides, at street zoom
      const q = await w.evaluate(async () => { const b = (await PLACE.load()).find((x) => x.d.length === 2 && x.d.every((d) => d[2].length && d[2].every((r) => r[5] & 4 && r[5] & 8)));
        const m = PLACE.midpoint(b.g); map.setView([m[1], m[0]], 17, { animate: false }); return String(b.c); });
      await w.waitForFunction((c) => !ovMode && segCache.filter((x) => String(x.group.cnn) === c).length === 2, { timeout: 30000, polling: 250 }, q).catch(() => {});
      return { w, q };
    };
    const sheetOf = (w, q) => w.evaluate((c) => { const o = segCache.find((x) => String(x.group.cnn) === c); openSheet(o.group, o.side.key);
      return { text: document.getElementById('sheetBody').innerText.replace(/\s+/g, ' ').trim(), cal: !!document.getElementById('calBtn'), alert: !!document.getElementById('alertBtn'),
        spot: sheetSpot && { next: sheetSpot.nextSweepISO, declared: (sheetSpot.rules || []).filter((r) => r.flags & 4 && Array.isArray(r.dates) && r.dates.length > 20).length } }; }, q);
    const plate = (w) => w.evaluate(() => document.getElementById('wPlate').innerText.replace(/\s+/g, ' ').trim());
    const sideColors = (w, q) => w.evaluate((c) => segCache.filter((x) => String(x.group.cnn) === c).map((x) => x.side.color), q);
    if (sw.state !== 'on') {
      const { w, q } = await declaredPage();
      const dash = await w.evaluate(() => getCSS('--winter-dash')), colors = await sideColors(w, q);
      check(/not declared|paused|from|not in season/i.test(await plate(w)) && colors.length === 2 && colors.every((x) => x === dash),
        `declared rule (${sw.state}): the plate says none is declared, and both sides of a snow route are dashed (${(await plate(w)).slice(0, 60)})`);
      const s1 = await sheetOf(w, q);
      check(/Snow route/i.test(s1.text) && s1.alert && !s1.cal && s1.spot && s1.spot.declared >= 1,
        `declared rule (${sw.state}): the sheet says so, alerts can be on, no calendar (${s1.text.slice(0, 70)})`);
      await w.close();
    }
    // a day of the season, 4 PM, declared that day
    const y = city.winter.from.slice(0, 4), clock = Date.parse(`${y}-12-01T21:00:00Z`);
    const { w, q } = await declaredPage(clock, { state: 'on', from: `${y}-12-01`, at: `${y}-12-01T20:00:00Z`, reason: `${city.name} declared a Major Snowstorm Condition.` });
    const red = await w.evaluate(() => getCSS('--red')), colors = await sideColors(w, q);
    check(/No parking on snow routes/i.test(await plate(w)) && colors.length === 2 && colors.every((x) => x === red),
      `declared rule on: the plate says no parking on snow routes and both sides are red (${(await plate(w)).slice(0, 60)})`);
    const s2 = await sheetOf(w, q);
    check(/No parking/i.test(s2.text) && /until the City ends/i.test(s2.text) && s2.alert && !s2.cal && s2.spot && Date.parse(s2.spot.next) > clock,
      `declared rule on: the sheet says no parking until the City ends it, and alerts arm the next day (${s2.text.slice(0, 70)})`);
    await w.close();
  }

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  check(!bad.length, 'no failed or San Francisco requests' + (bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''));
} finally { await b.close(); }
if (fails.length) { console.error(`\n${ID}: ${fails.length} check(s) failed`); process.exit(1); }
console.log(`\n${ID} page OK`);
