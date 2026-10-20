// Headless check of curb.guide's first visit (index.html firstVisitCity, owner 2026-10-20) on a phone screen: the page asks
// for the location once, right away; inside a public city's bounds it opens that city's map, in San Francisco it stays
// (centered on the visitor), outside every map it stays and offers the cities page; a later visit, a refusal, a crawler, an
// automated browser and the iPhone app are never sent anywhere. Also the locate button: outside San Francisco but inside a
// public city, its toast offers that city's map.
// Usage: node scripts/check-first-visit.mjs [site]   (default http://localhost:3077, `npm run dev`)
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const SITE = process.argv[2] || 'http://localhost:3077';
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const PLACES = { chicago: { latitude: 41.8818, longitude: -87.6278, accuracy: 30 }, hoboken: { latitude: 40.744, longitude: -74.0305, accuracy: 30 },
  sf: { latitude: 37.7596, longitude: -122.4148, accuracy: 20 }, miami: { latitude: 25.7617, longitude: -80.1918, accuracy: 40 },
  boston: { latitude: 42.3601, longitude: -71.0589, accuracy: 20 }, oakland: { latitude: 37.8044, longitude: -122.2712, accuracy: 25 } };

const fails = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const origin = new URL(SITE).origin;

// One fresh visitor (a new browser context: empty storage), at a place, answering the prompt `answer`.
async function visit({ at, answer = 'allow', person = true, seen = false, app = false, path = '/' }) {
  const ctx = await b.createBrowserContext();
  if (answer === 'allow') await ctx.overridePermissions(origin, ['geolocation']);
  const p = await ctx.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  // count the page's own location requests, answer them like the browser would (a refusal: code 1)
  await p.evaluateOnNewDocument((cfg) => {
    if (cfg.person) { Object.defineProperty(navigator, 'webdriver', { get: () => false }); }
    try { localStorage.setItem('curbIosHintShown', '1'); } catch (_) {}   // the iPhone install card would cover the map
    if (cfg.seen) { try { localStorage.setItem('curbOnboarded', '1'); } catch (_) {} }
    if (cfg.app) window.__curbNativeGeoInstalled = true;
    const g = navigator.geolocation, real = g.getCurrentPosition.bind(g);
    g.getCurrentPosition = (ok, no, opts) => {
      (window.__asked = window.__asked || []).push(opts || {});
      if (cfg.answer === 'deny') { setTimeout(() => no && no({ code: 1, message: 'User denied Geolocation' }), 50); return; }
      real(ok, no, opts);
    };
  }, { person, seen, app, answer });
  if (person) await p.setUserAgent(PHONE);
  if (at) await p.setGeolocation(PLACES[at]);
  // the city pages' data is big (Chicago's is 20 MB): a check of where the visit lands doesn't need it
  await p.setRequestInterception(true);
  p.on('request', (r) => (/\/data\/[a-z-]+\/segments\.json/.test(r.url()) ? r.respond({ status: 200, contentType: 'application/json', body: '{"b":[]}' }) : r.continue()));
  await p.goto(SITE + path, { waitUntil: 'load', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 3500));
  // a visit that opens a city is a second page load: read once it has settled (on a slow runner it may still be loading)
  let out = null;
  for (let i = 0; i < 10 && !out; i++) {
    try {
      await p.waitForFunction(() => document.readyState === 'complete', { timeout: 10000 });
      out = await p.evaluate(() => ({ path: location.pathname, asked: (window.__asked || []).filter((o) => !o.curbSilent).length,
        toast: document.getElementById('toast')?.classList.contains('show') ? document.getElementById('toast').textContent : '',
        link: document.querySelector('#toast a')?.getAttribute('href') || '', stored: (() => { try { return localStorage.getItem('curbCityAsk'); } catch (_) { return 'x'; } })(),
        center: window.map ? [map.getCenter().lat, map.getCenter().lng] : null }));
    } catch (e) { if (!/context|navigat|detached/i.test(String(e && e.message))) throw e; await new Promise((r) => setTimeout(r, 1000)); }
  }
  return { p, ctx, out: out || {}, errors };
}

try {
  let v = await visit({ at: 'chicago' });
  check(v.out.path === '/chicago', `a first visit in Chicago opens /chicago (landed on ${v.out.path})`);
  await v.ctx.close();

  v = await visit({ at: 'hoboken' });
  check(v.out.path === '/hoboken', `a first visit in Hoboken (inside New York City's box too) opens the smaller map, /hoboken (landed on ${v.out.path})`);
  await v.ctx.close();

  v = await visit({ at: 'sf' });
  const near = v.out.center && Math.abs(v.out.center[0] - PLACES.sf.latitude) < 0.01 && Math.abs(v.out.center[1] - PLACES.sf.longitude) < 0.01;
  check(v.out.path === '/' && !v.out.toast && near, `a first visit in San Francisco stays, quietly, centered on the visitor (${v.out.path}, toast "${v.out.toast}", center ${v.out.center})`);
  check(v.out.asked === 1 && v.out.stored === '1', `it asked for the location once and remembered asking (${v.out.asked} prompting asks, curbCityAsk=${v.out.stored})`);
  // the same visitor again: no second ask
  await v.p.reload({ waitUntil: 'load' }); await new Promise((r) => setTimeout(r, 2500));
  const again = await v.p.evaluate(() => (window.__asked || []).filter((o) => !o.curbSilent).length);
  check(again === 0, `a later visit never asks again (${again} prompting asks; the launch locate's silent one doesn't count)`);
  await v.ctx.close();

  v = await visit({ at: 'miami' });
  check(v.out.path === '/' && /isn't in your area yet/.test(v.out.toast) && v.out.link === '/cities',
    `outside every map it stays and offers the cities page (toast "${v.out.toast}", link ${v.out.link})`);
  await v.ctx.close();

  v = await visit({ at: 'boston' });
  check(v.out.path === '/' && /isn't in your area yet/.test(v.out.toast), `Boston stays hidden: a first visit there stays on San Francisco (${v.out.path}, "${v.out.toast}")`);
  await v.ctx.close();

  v = await visit({ at: 'chicago', answer: 'deny' });
  check(v.out.path === '/' && !v.out.toast && v.out.stored === '1', `a refusal stays on San Francisco, quietly, and isn't asked again (${v.out.path}, "${v.out.toast}")`);
  await v.ctx.close();

  v = await visit({ at: 'chicago', seen: true });
  check(v.out.path === '/' && v.out.asked === 0, `a visitor from before (curbOnboarded) is never asked (${v.out.asked} asks, ${v.out.path})`);
  await v.ctx.close();

  v = await visit({ at: 'chicago', person: false });
  check(v.out.path === '/' && v.out.asked === 0, `an automated browser or crawler is never asked or sent anywhere (${v.out.asked} asks)`);
  await v.ctx.close();

  v = await visit({ at: 'chicago', app: true });
  check(v.out.path === '/' && v.out.asked === 0, `the iPhone app (native location bridge) is never asked or sent anywhere (${v.out.asked} asks)`);
  await v.ctx.close();

  v = await visit({ at: 'chicago', path: '/?b=13065000' });
  check(v.out.path === '/' && v.out.asked === 0, `a shared block link wins over the first visit (${v.out.asked} asks)`);
  await v.ctx.close();

  // the locate button, outside San Francisco but inside a public city: the toast offers that city's map
  v = await visit({ at: 'oakland', seen: true });
  await v.p.evaluate(() => { localStorage.setItem('curbCityAsk', '1'); });
  await v.p.click('#locate');
  await v.p.waitForFunction(() => /outside San Francisco/.test(document.getElementById('toast')?.textContent || ''), { timeout: 20000, polling: 250 }).catch(() => {});
  const loc = await v.p.evaluate(() => ({ t: document.getElementById('toast').textContent, a: document.querySelector('#toast a')?.getAttribute('href'), path: location.pathname }));
  check(/You're outside San Francisco, in Oakland\./.test(loc.t) && loc.a === '/oakland' && loc.path === '/', `locate in Oakland offers its map ("${loc.t}" → ${loc.a})`);
  await v.ctx.close();

  // the zoomed out view: a pin per other map, and a tap on one opens it
  v = await visit({ at: 'sf', seen: true });
  await v.p.evaluate(() => map.setView([40.2, -95], 4, { animate: false }));
  await v.p.waitForFunction(() => document.querySelectorAll('.cpin').length > 3 && document.querySelector('.leaflet-outlines-pane path'), { timeout: 15000, polling: 250 }).catch(() => {});
  const pins = await v.p.evaluate(() => ({ n: document.querySelectorAll('.cpin').length, outlines: !!document.querySelector('.leaflet-outlines-pane path') }));
  check(pins.n > 3 && pins.outlines, `zoomed out, pins for the other maps on Natural Earth's outlines (${pins.n} pins, outlines ${pins.outlines})`);
  await v.p.evaluate(() => map.setView([39.75, -104.99], 8, { animate: false }));
  await v.p.waitForFunction(() => [...document.querySelectorAll('.cpin span')].some((s) => s.textContent === 'Denver'), { timeout: 10000, polling: 250 }).catch(() => {});
  const denver = await v.p.evaluateHandle(() => [...document.querySelectorAll('.cpin')].find((x) => x.querySelector('span')?.textContent === 'Denver'));
  if (denver.asElement()) {
    await Promise.all([v.p.waitForNavigation({ timeout: 15000 }).catch(() => {}), denver.asElement().click()]);
    check(new URL(v.p.url()).pathname === '/denver', `a tap on the Denver pin opens /denver (${new URL(v.p.url()).pathname})`);
  } else check(false, 'a Denver pin shows at zoom 8');
  check(!v.errors.length, 'no page errors' + (v.errors.length ? ': ' + v.errors.slice(0, 3).join(' | ') : ''));
  await v.ctx.close();
} finally { await b.close(); }
if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1); }
console.log('\nfirst visit OK');
