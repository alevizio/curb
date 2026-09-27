// Headless regression check for "use my location" in index.html — the "needs two taps" family of bugs —
// in a browser AND under the iOS app's bridge (the current build's shim from ContentView.swift, plus the
// App Store build 6 shim from git, which the live page must keep working with until build 7 ships).
//
//   npx serve . -l 3200 &  node scripts/check-locate.mjs --site http://localhost:3200   (exit 1 on any failure)
//
// Deterministic: DataSF is intercepted with a synthetic street grid (80 m blocks, curb sides both ways; a
// curb-free "park" square; nothing outside SF), and geolocation / the native bridge are faked per scenario.
// Needs puppeteer-core (monitor.yml installs it: npm i --no-save puppeteer-core) and Chrome.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { userScripts } from '../ios/user-scripts.mjs';

const args = process.argv.slice(2);
const SITE = (args.includes('--site') ? args[args.indexOf('--site') + 1] : process.env.SITE) || 'http://localhost:3200';
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const CHROME = process.env.CHROME_PATH
  || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find(existsSync);
const ROOT = new URL('..', import.meta.url);
const APP_NOW = userScripts(readFileSync(new URL('ios/CURB/ContentView.swift', ROOT), 'utf8'));
// 54032e4 = last commit whose bridge is App Store build 6 (1.0.1): per-request timeout as the native
// deadline, a one-shot Best-accuracy requestLocation, curbLocOK-based permissions, the locateFail override.
const APP_BUILD6 = userScripts(execFileSync('git', ['-C', new URL('.', ROOT).pathname, 'show', '54032e4:ios/CURB/ContentView.swift'], { encoding: 'utf8' }));

const MISSION = [37.7596, -122.4148], MARINA = [37.8030, -122.4360], SUNSET = [37.7530, -122.4900];
const PARK = [37.7694, -122.4862];            // synthetic curb-free square, ±250 m
const NYC = [40.7128, -74.0060];

/* ---------- synthetic DataSF ---------- */
const DLAT = 0.00072, DLNG = 0.00091;          // ≈ 80 m blocks
const inSF = (lat, lng) => lat > 37.70 && lat < 37.84 && lng > -122.53 && lng < -122.35;
const inPark = (lat, lng) => Math.abs(lat - PARK[0]) < 0.00225 && Math.abs(lng - PARK[1]) < 0.00285;
function gridRows(w, s, e, n) {
  const rows = [];
  for (let i = Math.floor(s / DLAT); i <= Math.ceil(n / DLAT); i++) {
    for (let j = Math.floor(w / DLNG); j <= Math.ceil(e / DLNG); j++) {
      const lat = i * DLAT, lng = j * DLNG;
      for (const dir of [1, 2]) {
        const lat2 = dir === 1 ? lat : lat + DLAT, lng2 = dir === 1 ? lng + DLNG : lng;
        const mlat = (lat + lat2) / 2, mlng = (lng + lng2) / 2;
        if (!inSF(mlat, mlng) || inPark(mlat, mlng)) continue;
        const cnn = `${dir}${String(i).padStart(6, '0')}${String(j + 200000).padStart(6, '0')}`;
        const sides = dir === 1 ? [['North', 'L'], ['South', 'R']] : [['East', 'R'], ['West', 'L']];
        for (const [blockside, lr] of sides) rows.push({
          cnn, corridor: `Grid ${mlat.toFixed(5)} ${mlng.toFixed(5)}`, limits: 'A St - B St', blockside, cnnrightleft: lr,
          weekday: 'Mon', fromhour: '8', tohour: '10', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0',
          line: { type: 'LineString', coordinates: [[lng, lat], [lng2, lat2]] },
        });
      }
    }
  }
  return rows;
}
function rowsForCnn(cnn) {
  const dir = +cnn[0], i = +cnn.slice(1, 7), j = +cnn.slice(7) - 200000;
  const lat = i * DLAT, lng = j * DLNG;
  return gridRows(lng - DLNG / 4, lat - DLAT / 4, lng + DLNG / 4, lat + DLAT / 4).filter((r) => r.cnn === cnn);
}
function sweepResponse(url) {
  const where = url.searchParams.get('$where') || '';
  const sel = url.searchParams.get('$select') || '';
  const poly = where.match(/POLYGON\(\(([^)]*)\)\)/);
  if (poly) {
    const pts = poly[1].split(',').map((p) => p.trim().split(/\s+/).map(Number));
    const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    const rows = gridRows(Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats));
    return /count\(\*\)/.test(sel) ? [{ count: String(rows.length) }] : rows.slice(0, 2500);
  }
  const cnn = where.match(/cnn='(\d+)'/);
  if (cnn) return rowsForCnn(cnn[1]).slice(0, 1);
  if (/corridor\) like/.test(where)) return gridRows(SUNSET[1] - 0.0003, SUNSET[0] - 0.0003, SUNSET[1] + 0.0003, SUNSET[0] + 0.0003).slice(0, 1);
  return [];
}

/* ---------- page harness ---------- */
const results = [];
let browser;

// Runs in the page before any of its scripts. mode: 'browser' | 'app' | 'app6'.
function preload(cfg) {
  try { localStorage.setItem('curbOnboarded', '1'); localStorage.setItem('curbFirstSheet', '1'); if (cfg.curbLocOK) localStorage.setItem('curbLocOK', '1'); } catch (_) {}
  window.__reports = [];
  window.__geo = { calls: [] };
  window.__remap = cfg.remap || {};             // exact setTimeout delays to shorten (the page's own guards)
  const st = window.setTimeout;
  window.setTimeout = function (fn, ms, ...a) { return st.call(this, fn, (window.__remap[ms] ?? ms), ...a); };
  if (cfg.mode === 'browser') {
    const fake = {
      getCurrentPosition(ok, err, opts) { const c = { ok, err, opts }; window.__geo.calls.push(c); window.__geoAuto && window.__geoAuto(c); },
      watchPosition() { return 0; }, clearWatch() {},
    };
    if (cfg.noGeo) { try { Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined }); } catch (_) {} }
    else Object.defineProperty(navigator, 'geolocation', { configurable: true, value: fake });
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => (d && d.name === 'geolocation' ? Promise.resolve({ name: 'geolocation', state: cfg.perm || 'granted', onchange: null }) : q(d));
  } else {
    // Fake native side. Location requests are logged; __nativeGeo(msg) (set per scenario) answers them.
    window.__nat = { requests: [], status: cfg.status || 'granted' };
    window.webkit = { messageHandlers: {
      curbLocation: { postMessage(m) {
        if (m.type === 'status') { st(() => window.__curbNativeGeoStatus && window.__curbNativeGeoStatus(window.__nat.status), 5); return; }
        window.__nat.requests.push(m); window.__nativeGeo && window.__nativeGeo(m);
      } },
      curbShare: { postMessage() {} }, curbPush: { postMessage() {} },
    } };
  }
}

async function open(name, cfg = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.__ctx = ctx;
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = new URL(req.url());
    if (u.hostname === 'data.sf.gov') {
      const body = u.pathname.includes('yhqp-riqs') ? sweepResponse(u) : [];
      const delay = u.pathname.includes('yhqp-riqs') ? (cfg.dataDelay || 0) : 0;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }).catch(() => {});
    }
    if (u.hostname.includes('fonts.g') || u.pathname.startsWith('/_vercel/') || u.pathname === '/sw.js' || u.pathname.startsWith('/api/')) return req.respond({ status: 404, body: '' }).catch(() => {});
    return req.continue().catch(() => {});
  });
  await page.evaluateOnNewDocument(preload, { mode: 'browser', ...cfg });
  if (cfg.mode === 'app' || cfg.mode === 'app6') {
    const js = cfg.mode === 'app' ? APP_NOW : APP_BUILD6;
    await page.evaluateOnNewDocument(js.nativeLocationScript);
    // WKWebView's atDocumentStart runs after <html> exists; Chrome's new-document hook runs before it.
    await page.evaluateOnNewDocument(`(function () { var run = function () {${js.appChromeScript}\n};
      if (document.documentElement) run(); else new MutationObserver(function (_, o) { if (document.documentElement) { o.disconnect(); run(); } }).observe(document, { childList: true }); })();`);
  }
  await page.goto(SITE + (cfg.path || '/'), { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof curbReport === 'function', { timeout: 20000 });
  await page.evaluate(() => { window.curbReport = (k, d) => window.__reports.push([k, d]); });
  return page;
}
const waitFor = (page, fn, ms, ...a) => page.waitForFunction(fn, { timeout: ms, polling: 100 }, ...a).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toastText = (page) => page.evaluate(() => { const t = document.getElementById('toast'); return t.classList.contains('show') ? t.textContent : ''; });
async function viewAt(page, [lat, lng], z) {
  await page.evaluate((lat, lng, z) => map.setView([lat, lng], z, { animate: false }), lat, lng, z);
  // (typeof guard: lets the check run against pages from before segBounds existed, to show what it catches)
  return waitFor(page, (lat, lng) => (typeof segBounds === 'undefined' || (segBounds && segBounds.contains([lat, lng]))) && segCache.length > 0, 15000, lat, lng);
}
// The opened sheet's block, parsed from the synthetic corridor name, and its distance from `pt` in metres.
async function sheetBlock(page, pt) {
  const s = await page.evaluate(() => {
    const open = document.getElementById('sheet').classList.contains('open');
    const m = open && (document.getElementById('sheetBody').textContent.match(/Grid (-?[\d.]+) (-?[\d.]+)/) || null);
    return m ? [+m[1], +m[2]] : null;
  });
  if (!s || !pt) return { open: !!s, d: Infinity };
  const dy = (s[0] - pt[0]) * 111320, dx = (s[1] - pt[1]) * 111320 * Math.cos(pt[0] * Math.PI / 180);
  return { open: true, d: Math.hypot(dx, dy) };
}
const centerNear = (page, [lat, lng], tol = 0.002) => page.evaluate((lat, lng, tol) => { const c = map.getCenter(); return Math.abs(c.lat - lat) < tol && Math.abs(c.lng - lng) < tol; }, lat, lng, tol);
const tapLocate = (page) => page.click('#locate');
const tapMapAt = async (page, [lat, lng]) => {
  const pt = await page.evaluate((lat, lng) => { const p = map.latLngToContainerPoint([lat, lng]); const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, lat, lng);
  await page.mouse.click(pt.x, pt.y);
};
// Answer the browser fake's Nth user-initiated getCurrentPosition call (the launch auto-locate is curbSilent).
const answer = (page, n, pos) => page.evaluate((n, pos) => {
  const c = window.__geo.calls.filter((x) => !x.opts.curbSilent)[n];
  if (pos.code) c.err({ code: pos.code, message: pos.message || '' });
  else c.ok({ coords: { latitude: pos.lat, longitude: pos.lng, accuracy: pos.acc ?? 15 }, timestamp: Date.now() });
}, n, pos);
const autoAnswer = (page, pos, delay = 0) => page.evaluate((pos, delay) => {
  window.__geoAuto = (c) => !c.opts.curbSilent && setTimeout(() => (pos.code ? c.err({ code: pos.code, message: '' }) : c.ok({ coords: { latitude: pos.lat, longitude: pos.lng, accuracy: pos.acc ?? 15 }, timestamp: Date.now() })), delay);
}, pos, delay);

async function scenario(name, cfg, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  let page;
  try {
    page = await open(name, cfg);
    const out = await fn(page);
    const errs = page.__errors.filter((e) => !/ResizeObserver/.test(e));
    if (errs.length) results.push({ name, ok: false, detail: `page errors: ${errs.join(' | ')}` });
    else results.push({ name, ok: !!(out && out.ok), detail: (out && out.detail) || '' });
  } catch (e) {
    results.push({ name, ok: false, detail: `crashed: ${e.message}` });
  } finally {
    if (page) await page.__ctx.close().catch(() => {});
  }
  const r = results[results.length - 1];
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${name}${r.detail ? ' — ' + r.detail : ''}`);
}

/* ---------- scenarios ---------- */
browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  // P0-3: data for another neighbourhood is on screen; one tap must open YOUR block, not the nearest stale one.
  await scenario('one tap from a stale neighbourhood opens your block', {}, async (page) => {
    if (!(await viewAt(page, MARINA, 17))) return { detail: 'Marina data never drew' };
    await autoAnswer(page, { lat: MISSION[0], lng: MISSION[1] });
    await tapLocate(page);
    await waitFor(page, () => document.getElementById('sheet').classList.contains('open'), 8000);
    await sleep(300);
    const b = await sheetBlock(page, MISSION);
    return { ok: b.open && b.d < 80, detail: b.open ? `opened a block ${Math.round(b.d)} m from you` : 'no sheet' };
  });

  // P1-4: from the default overview with slow DataSF (2 × 2.5 s round trips), the first tap still opens the
  // sheet — and #locate stays busy until it does, so there's no silent gap inviting a second tap.
  await scenario('slow data: first tap still opens the sheet, button busy until then', { dataDelay: 2500 }, async (page) => {
    await sleep(600);
    await autoAnswer(page, { lat: MISSION[0], lng: MISSION[1] });
    await tapLocate(page);
    await sleep(3200);  // past the old ~2.9 s give-up point
    const busyMid = await page.evaluate(() => document.getElementById('locate').classList.contains('loading'));
    const opened = await waitFor(page, () => document.getElementById('sheet').classList.contains('open'), 9000);
    const b = await sheetBlock(page, MISSION);
    const busyAfter = await page.evaluate(() => document.getElementById('locate').classList.contains('loading'));
    return { ok: opened && b.d < 80 && busyMid && !busyAfter, detail: `opened=${opened} d=${Math.round(b.d)}m busyWhileLoading=${busyMid} busyAfter=${busyAfter}` };
  });

  // Deep link (?b=cnn) shares the wait-for-data helper: must survive slow data too.
  await scenario('deep link opens its block on slow data', { dataDelay: 2500, path: '/?b=1' + String(Math.floor(MISSION[0] / DLAT)).padStart(6, '0') + String(Math.floor(MISSION[1] / DLNG) + 200000).padStart(6, '0') }, async (page) => {
    const opened = await waitFor(page, () => document.getElementById('sheet').classList.contains('open'), 14000);
    const b = await sheetBlock(page, MISSION);
    return { ok: opened && b.d < 120, detail: `opened=${opened} d=${Math.round(b.d)}m` };
  });

  // Browser deadlines: granted → 9 s; a possible permission prompt (Chrome counts it inside timeout) → 30 s.
  for (const perm of ['granted', 'prompt']) {
    await scenario(`browser timeout with permission '${perm}'`, { perm }, async (page) => {
      await sleep(300);
      await tapLocate(page);
      const t = await page.evaluate(() => window.__geo.calls.at(-1).opts.timeout);
      const want = perm === 'granted' ? 9000 : 30000;
      return { ok: t === want, detail: `timeout ${t}` };
    });
  }

  // P0-1 guard: a fix that lands after the hang guard fired still counts when the user did nothing…
  await scenario('late fix after the failsafe is placed if the user did nothing', { remap: { 12000: 800 } }, async (page) => {
    await viewAt(page, MISSION, 16);
    await tapLocate(page);
    const failed = await waitFor(page, () => /Couldn't get a fix/.test(document.getElementById('toast').textContent), 4000);
    await answer(page, 0, { lat: MISSION[0] + 0.002, lng: MISSION[1] });
    const moved = await waitFor(page, (lat, lng) => { const c = map.getCenter(); return Math.abs(c.lat - lat) < 0.001 && Math.abs(c.lng - lng) < 0.001; }, 5000, MISSION[0] + 0.002, MISSION[1]);
    const toast = await toastText(page);
    const rep = await page.evaluate(() => window.__reports.find((r) => r[0] === 'locate-failed'));
    return { ok: failed && moved && /Found you/.test(toast) && rep && /failsafe/.test(rep[1]), detail: `failsafeToast=${failed} placed=${moved} toast="${toast}" report=${JSON.stringify(rep)}` };
  });

  // …but never yanks the view once the user has tapped the map, or searched, in the meantime.
  await scenario('late fix after the user tapped the map is dropped', { remap: { 12000: 800 } }, async (page) => {
    await viewAt(page, MISSION, 17);
    await tapLocate(page);
    await waitFor(page, () => /Couldn't get a fix/.test(document.getElementById('toast').textContent), 4000);
    const tap = [MISSION[0] + 0.0003, MISSION[1] + 0.0004];
    await tapMapAt(page, tap);
    await waitFor(page, () => document.getElementById('sheet').classList.contains('open'), 5000);
    const before = await sheetBlock(page, tap);
    await answer(page, 0, { lat: MARINA[0], lng: MARINA[1] });
    await sleep(2500);
    const after = await sheetBlock(page, tap);
    const stayed = await centerNear(page, tap, 0.003);
    return { ok: before.open && after.open && after.d < 80 && stayed, detail: `stayed=${stayed} sheetStillTapped=${after.d < 80}` };
  });
  await scenario('late fix after the user searched is dropped', { remap: { 12000: 800 } }, async (page) => {
    await viewAt(page, MISSION, 16);
    await tapLocate(page);
    await waitFor(page, () => /Couldn't get a fix/.test(document.getElementById('toast').textContent), 4000);
    await page.type('#q', 'Grid');
    await page.keyboard.press('Enter');
    await waitFor(page, (lat, lng) => { const c = map.getCenter(); return Math.abs(c.lat - lat) < 0.002 && Math.abs(c.lng - lng) < 0.002; }, 5000, SUNSET[0], SUNSET[1]);
    await answer(page, 0, { lat: MISSION[0], lng: MISSION[1] });
    await sleep(2000);
    const stayed = await centerNear(page, SUNSET);
    return { ok: stayed, detail: `map stayed on the search result: ${stayed}` };
  });
  await scenario('late fix after the user panned is dropped', { remap: { 12000: 800 } }, async (page) => {
    await viewAt(page, MISSION, 16);
    await tapLocate(page);
    await waitFor(page, () => /Couldn't get a fix/.test(document.getElementById('toast').textContent), 4000);
    const c = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 80, c.y + 60, { steps: 8 }); await page.mouse.up();
    await sleep(400);
    const before = await page.evaluate(() => map.getCenter());
    await answer(page, 0, { lat: MARINA[0], lng: MARINA[1] });
    await sleep(2000);
    const stayed = await centerNear(page, [before.lat, before.lng], 0.001);
    const sheet = (await sheetBlock(page)).open;
    return { ok: stayed && !sheet, detail: `stayed=${stayed} sheet=${sheet}` };
  });
  // Also while still spinning (the longer deadlines make this likelier): the fix must not override a map tap.
  await scenario('fix arriving after a map tap during the wait is dropped', {}, async (page) => {
    await viewAt(page, MISSION, 17);
    await tapLocate(page);
    const tap = [MISSION[0] - 0.0003, MISSION[1] + 0.0002];
    await tapMapAt(page, tap);
    await waitFor(page, () => document.getElementById('sheet').classList.contains('open'), 5000);
    await answer(page, 0, { lat: MARINA[0], lng: MARINA[1] });
    await sleep(2000);
    const b = await sheetBlock(page, tap);
    return { ok: (await centerNear(page, tap, 0.003)) && b.d < 80, detail: `sheet ${Math.round(b.d)} m from the tap` };
  });

  // One retry on TIMEOUT with a coarse, same-maximumAge request before failing.
  await scenario('timeout retries once with a coarse fix', {}, async (page) => {
    await viewAt(page, MISSION, 16);
    await tapLocate(page);
    await answer(page, 0, { code: 3 });
    const retry = await page.evaluate(() => { const c = window.__geo.calls.filter((x) => !x.opts.curbSilent)[1]; return c && c.opts; });
    await answer(page, 1, { lat: MISSION[0], lng: MISSION[1], acc: 40 });
    const opened = await waitFor(page, () => document.getElementById('sheet').classList.contains('open'), 5000);
    return { ok: retry && retry.enableHighAccuracy === false && retry.maximumAge === 30000 && opened, detail: `retry=${JSON.stringify(retry)} opened=${opened}` };
  });

  // P1-5: copy per error code, reported to the error log.
  const COPY = [
    [1, /blocked for this site.*site settings/], [2, /Can't find your location/], [3, /Couldn't get a fix in time/],
  ];
  for (const [code, re] of COPY) {
    await scenario(`browser error copy for code ${code}`, {}, async (page) => {
      await sleep(300);
      await tapLocate(page);
      await answer(page, 0, { code, message: 'x' });
      if (code !== 1) await answer(page, 1, { code, message: 'x' });  // the one retry fails too
      await sleep(200);
      const t = await toastText(page);
      const rep = await page.evaluate(() => window.__reports.find((r) => r[0] === 'locate-failed'));
      return { ok: re.test(t) && rep && rep[1].startsWith('code ' + code), detail: `"${t}" report=${JSON.stringify(rep)}` };
    });
  }
  await scenario('no geolocation API: says so', { noGeo: true }, async (page) => {
    await sleep(300);
    await tapLocate(page);
    const t = await toastText(page);
    return { ok: /can't share your location/.test(t), detail: `"${t}"` };
  });

  // P1-7: a coarse fix shows a ring, frames it, opens no sheet and says it's approximate.
  await scenario('coarse fix: accuracy ring, no sheet, approximate toast', {}, async (page) => {
    await viewAt(page, MISSION, 17);
    await autoAnswer(page, { lat: MISSION[0], lng: MISSION[1], acc: 2000 });
    await tapLocate(page);
    await sleep(2500);
    const s = await page.evaluate(() => ({ ring: !!document.querySelector('path.acc-ring'), z: map.getZoom(), open: document.getElementById('sheet').classList.contains('open') }));
    const t = await toastText(page);
    return { ok: s.ring && !s.open && s.z < 15 && /approximate \(±2\.0 km\)/.test(t), detail: `${JSON.stringify(s)} "${t}"` };
  });

  // P0-3 cap: fresh data covers the point but no curb within 80 m → say so, don't open a far block.
  await scenario('no curb within 80 m: toast instead of a far block', {}, async (page) => {
    await autoAnswer(page, { lat: PARK[0], lng: PARK[1] });
    await tapLocate(page);
    const toasted = await waitFor(page, () => /No swept curb within 80 m/.test(document.getElementById('toast').textContent), 8000);
    const open = (await sheetBlock(page)).open;
    return { ok: toasted && !open, detail: `toast=${toasted} sheet=${open}` };
  });
  await scenario('outside SF: coverage toast, no sheet', {}, async (page) => {
    await autoAnswer(page, { lat: NYC[0], lng: NYC[1] });
    await tapLocate(page);
    const toasted = await waitFor(page, () => /CURB covers San Francisco/.test(document.getElementById('toast').textContent), 8000);
    return { ok: toasted && !(await sheetBlock(page)).open, detail: `toast=${toasted}` };
  });

  /* ---- iOS app, App Store build 6 bridge (must keep working until build 7 ships) ---- */
  // Build 6 uses the page's timeout as its native deadline and a one-shot Best fix that takes ~10 s.
  // Modelled at 1/10 speed: fix after 1 s, deadline = timeout/10. With 9 s it timed out (the two-tap bug).
  const build6 = (fixMs) => `window.__nativeGeo = (m) => {
    let done = false; const t = (m.options.timeout || 10000) / 10;
    const reply = (r) => { if (!done) { done = true; window.__curbNativeLocationResult(m.id, r); } };
    setTimeout(() => reply({ ok: false, code: 3, message: 'Location timed out.' }), t);
    setTimeout(() => reply({ ok: true, latitude: ${MISSION[0]}, longitude: ${MISSION[1]}, accuracy: 12, timestamp: Date.now() }), ${fixMs});
  };`;
  await scenario('app build 6: first tap works with a ~10 s native fix', { mode: 'app6', curbLocOK: true }, async (page) => {
    await page.evaluate(build6(1000));
    await tapLocate(page);
    const opts = await page.evaluate(() => window.__nat.requests.at(-1).options);
    const opened = await waitFor(page, () => document.getElementById('sheet').classList.contains('open'), 8000);
    const b = await sheetBlock(page, MISSION);
    return { ok: opts.timeout === 15000 && opened && b.d < 80, detail: `timeout=${opts.timeout} opened=${opened}` };
  });
  await scenario('app build 6: failures show per-code copy, not the blanket Settings toast', { mode: 'app6' }, async (page) => {
    await page.evaluate(() => { window.__nativeGeo = (m) => setTimeout(() => window.__curbNativeLocationResult(m.id, { ok: false, code: 3, message: 'Location timed out.' }), 20); });
    await sleep(800);  // past build 6's DOMContentLoaded + 500 ms locateFail override
    await tapLocate(page);
    await sleep(600);
    const t = await toastText(page);
    return { ok: /Couldn't get a fix in time/.test(t) && !/allow CURB in Settings/.test(t), detail: `"${t}"` };
  });
  await scenario('app build 6: denied copy points at Settings › CURB', { mode: 'app6' }, async (page) => {
    await page.evaluate(() => { window.__nativeGeo = (m) => setTimeout(() => window.__curbNativeLocationResult(m.id, { ok: false, code: 1, message: 'off' }), 20); });
    await sleep(800);
    await tapLocate(page);
    await sleep(300);
    const t = await toastText(page);
    return { ok: /Settings › CURB › Location/.test(t), detail: `"${t}"` };
  });

  /* ---- iOS app, this build's bridge (build 7) ---- */
  await scenario('app: launch auto-locate stays quiet when native says notDetermined', { mode: 'app', status: 'prompt', curbLocOK: true }, async (page) => {
    await sleep(1500);
    const n = await page.evaluate(() => window.__nat.requests.length);
    return { ok: n === 0, detail: `${n} location requests at launch` };
  });
  await scenario('app: launch auto-locate is silent + 15 s when granted', { mode: 'app', status: 'granted' }, async (page) => {
    await waitFor(page, () => window.__nat.requests.length > 0, 3000);
    const o = await page.evaluate(() => window.__nat.requests[0] && window.__nat.requests[0].options);
    return { ok: o && o.curbSilent === true && o.timeout === 15000, detail: JSON.stringify(o) };
  });
  await scenario('app: a late launch fix does not yank the map after the user panned', { mode: 'app', status: 'granted' }, async (page) => {
    await waitFor(page, () => window.__nat.requests.length > 0, 3000);
    const id = await page.evaluate(() => window.__nat.requests[0].id);
    await viewAt(page, MARINA, 16);
    const c = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 60, c.y + 40, { steps: 6 }); await page.mouse.up();
    await sleep(300);
    const before = await page.evaluate(() => map.getCenter());
    await page.evaluate((id, lat, lng) => window.__curbNativeLocationResult(id, { ok: true, latitude: lat, longitude: lng, accuracy: 10 }), id, MISSION[0], MISSION[1]);
    await sleep(1500);
    const stayed = await centerNear(page, [before.lat, before.lng], 0.001);
    return { ok: stayed, detail: `stayed=${stayed}` };
  });
  await scenario('app: reduced-accuracy fix says Precise Location is off', { mode: 'app', status: 'granted' }, async (page) => {
    await page.evaluate((lat, lng) => { window.__nativeGeo = (m) => { if (m.options.curbSilent) return; setTimeout(() => window.__curbNativeLocationResult(m.id, { ok: true, latitude: lat, longitude: lng, accuracy: 4800, reduced: true }), 50); }; }, MISSION[0], MISSION[1]);
    await tapLocate(page);
    await sleep(1500);
    const t = await toastText(page);
    const ring = await page.evaluate(() => !!document.querySelector('path.acc-ring'));
    return { ok: ring && /Precise Location is off for CURB/.test(t), detail: `ring=${ring} "${t}"` };
  });
  await scenario('app: hang guard waits out the native prompt grace (timeout + 55 s)', { mode: 'app', status: 'prompt' }, async (page) => {
    await page.evaluate(() => { window.__armed = []; const st = window.setTimeout; window.setTimeout = function (f, ms, ...a) { window.__armed.push(ms); return st.call(this, f, ms, ...a); }; window.__nativeGeo = () => {}; });
    await tapLocate(page);
    await sleep(100);
    const armed = await page.evaluate(() => window.__armed);
    const t = await page.evaluate(() => window.__nat.requests.at(-1).options.timeout);
    return { ok: t === 15000 && armed.includes(70000) && !armed.some((ms) => ms > 1000 && ms < 65000 && ms !== 10000), detail: `timeout=${t} timers=${armed.join(',')}` };
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
