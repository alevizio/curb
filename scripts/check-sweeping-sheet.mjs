// Regression check (owner report 2026-09-30), run by .github/workflows/verify.yml. Real browser, clock frozen at Wed 2026-09-30 8:49 AM PDT (Delmar St West side is being swept, 8 to 10 AM):
// open the block and check the alert + calendar buttons exist and arm NEXT Wednesday's sweep.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const SITE = process.argv[2] || 'http://localhost:3077';
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.evaluateOnNewDocument((target) => {
  const R = Date, off = target - R.now();
  class F extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } }
  globalThis.Date = F;
}, Date.UTC(2026, 8, 30, 15, 49));
await p.goto(SITE + '/', { waitUntil: 'load' });
await p.waitForFunction(() => { const x = document.getElementById('welcomeGo'); return x && x.offsetParent; }, { timeout: 8000 }).then(() => p.click('#welcomeGo'), () => {});
await p.waitForFunction(() => typeof map !== 'undefined');
await p.evaluate(() => map.setView([37.76825, -122.44573], 17, { animate: false }));
await p.waitForFunction(() => typeof segCacheAll !== 'undefined' && segCacheAll.some((x) => String(x.group.cnn) === '4695000'), { timeout: 30000 });
const res = await p.evaluate(async () => {
  const hit = segCacheAll.find((x) => String(x.group.cnn) === '4695000' && /west/i.test(x.side.blockside || ''));
  window.onAlertTap = (spot) => { window.__spot = spot; };   // capture what the button would arm (no real subscribe)
  openSheet(hit.group, hit.side.key);
  await new Promise((r) => setTimeout(r, 400));
  const q = (s) => document.querySelector(s);
  q('#alertBtn')?.click();
  return {
    head: q('#sheetBody .verdict .head')?.textContent,
    alertBtn: !!q('#alertBtn'), calBtn: !!q('#calBtn'), alertStyle: !!q('#alertCfg'),
    note: typeof sheetArmNote === 'string' ? sheetArmNote : null,
    spotSweep: window.__spot?.nextSweepISO, spotRule: window.__spot?.rule?.weekday, eve: window.__spot?.eveningISO,
  };
});

console.log(JSON.stringify({ ...res, errors }));
await b.close();
// The sheet must keep saying "Sweeping now" AND offer both buttons, armed for next Wednesday 8 AM PDT.
const ok = res.head === 'Sweeping now' && res.alertBtn && res.calBtn && res.spotSweep === '2026-10-07T15:00:00.000Z' && !errors.length;
console.log(ok ? '✅ sweeping now: alert + calendar arm the next sweep' : '❌ sweeping now: buttons missing or armed for the wrong sweep');
if (!ok) process.exitCode = 1;
