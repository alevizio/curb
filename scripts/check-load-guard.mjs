// Regression check, run by .github/workflows/verify.yml. The page needs two scripts before its own: Leaflet
// and the time core (lib/sweep-core.js). A dropped request for either used to leave a dead map and no
// message. Real browser, four runs: each script failing once (the retry must rescue the page, with no error
// and no message) and each failing for good (the message must show, and its button reloads).
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const SITE = process.argv[2] || 'http://localhost:3077';
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const LIBS = { leaflet: (u) => /leaflet(\.min)?\.js/.test(u), 'time core': (u) => u.includes('/lib/sweep-core.js') };

const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
let failures = 0;
const check = (name, cond, detail = '') => { if (!cond) failures++; console.log(`${cond ? '✅' : '❌'} ${name}${!cond && detail ? ' — ' + detail : ''}`); };

async function run(lib, failTimes) {
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = []; let asked = 0, reloads = -1;
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('framenavigated', (f) => { if (f === p.mainFrame()) reloads++; });
  await p.setBypassServiceWorker(true);   // a controlling worker would answer the time core from its cache, unseen here
  await p.setRequestInterception(true);
  p.on('request', (r) => {
    if (r.url().includes('/api/client-error')) return r.respond({ status: 204 });   // never write to a real log
    if (LIBS[lib](r.url()) && asked++ < failTimes) return r.abort('failed');
    r.continue();
  });
  await p.goto(SITE + '/', { waitUntil: 'load' });
  const state = () => p.evaluate(() => ({
    msg: document.getElementById('loadFail').classList.contains('open'),
    visible: document.getElementById('loadFail').getBoundingClientRect().height > 0,
    focused: document.activeElement === document.getElementById('loadFailGo'),
    inert: !!document.querySelector('.top')?.closest('[inert]'),
    hint: document.getElementById('hint').getBoundingClientRect().height > 0,
    L: typeof window.L, core: typeof window.nextSweep,
    map: (() => { try { return typeof map !== 'undefined'; } catch { return false; } })(),   // a failed start leaves `map` uninitialized
  }));
  const s = await state();
  let reloaded = false;
  if (s.msg) {
    const before = reloads;
    await Promise.all([p.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => {}), p.click('#loadFailGo')]);
    reloaded = reloads > before;
  }
  const after = await state();
  await p.close();
  return { s, after, errors, asked, reloaded };
}

for (const lib of Object.keys(LIBS)) {
  const once = await run(lib, 1);
  check(`${lib} fails once: the retry loads it, the app starts, no message`,
    once.asked === 2 && !once.s.msg && once.s.L === 'object' && once.s.core === 'function' && once.s.map && !once.errors.length,
    JSON.stringify({ asked: once.asked, ...once.s, errors: once.errors }));
  // Fails on the first load (script tag + retry), loads on the reload the button triggers.
  const gone = await run(lib, 2);
  check(`${lib} fails for good: the message shows, focused, with the page behind it inert`, gone.s.msg && gone.s.visible && gone.s.focused && gone.s.inert && !gone.s.hint, JSON.stringify(gone.s));
  check(`${lib}: "Try again" reloads into a working app`, gone.reloaded && !gone.after.msg && gone.after.map, JSON.stringify({ reloaded: gone.reloaded, ...gone.after }));
}
{
  const ok = await run('leaflet', 0);
  check('nothing fails: no retry, no message, no error', ok.asked === 1 && !ok.s.msg && ok.s.map && !ok.errors.length, JSON.stringify({ asked: ok.asked, ...ok.s, errors: ok.errors }));
}
await b.close();
if (failures) process.exitCode = 1;
