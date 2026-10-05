// Regression check (owner report 2026-09-30), run by .github/workflows/verify.yml. Real browser, clock frozen at Wed 2026-09-30 8:49 AM PDT (Delmar St West side is being swept, 8 to 10 AM):
// open the block and check the alert + calendar buttons exist and arm NEXT Wednesday's sweep. Then a midnight block
// (4th St, Tue 12 to 2 AM) the evening before, after 9 PM, mid-sweep and at 12:30 AM: the sheet, tooltip and toast
// word it by the night, and the toast names the night its 9 PM push lands on. Last, the first-sheet tip's alert timing.
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
// The sheet must keep saying "Sweeping now" AND offer both buttons, armed for next Wednesday 8 AM PDT.
const ok = res.head === 'Sweeping now' && res.alertBtn && res.calBtn && res.spotSweep === '2026-10-07T15:00:00.000Z'
  && res.note === ', next sweep Wed 10/7' && !errors.length;
console.log(ok ? '✅ sweeping now: alert + calendar arm the next sweep' : '❌ sweeping now: buttons missing or armed for the wrong sweep');
if (!ok) process.exitCode = 1;

// Owner decision 2026-10-05: a sweep starting after midnight reads by the night people think in. 4th St, King
// to Berry (cnn 269000): NorthEast side Tue + Thu 12 to 2 AM, SouthWest side Mon, Wed, Fri 12 to 2 AM.
async function nightSheet(target, ne) {
  const pg = await b.newPage();
  await pg.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.evaluateOnNewDocument((t) => {
    const R = Date, off = t - R.now();
    class F extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } }
    globalThis.Date = F;
  }, target);
  await pg.goto(SITE + '/', { waitUntil: 'load' });
  await pg.waitForFunction(() => { const x = document.getElementById('welcomeGo'); return x && x.offsetParent; }, { timeout: 8000 }).then(() => pg.click('#welcomeGo'), () => {});
  await pg.waitForFunction(() => typeof map !== 'undefined');
  await pg.evaluate(() => map.setView([37.77606, -122.39370], 17, { animate: false }));
  await pg.waitForFunction(() => typeof segCacheAll !== 'undefined' && segCacheAll.some((x) => String(x.group.cnn) === '269000'), { timeout: 30000 });
  const out = await pg.evaluate(async (side) => {
    const hit = segCacheAll.find((x) => String(x.group.cnn) === '269000' && new RegExp(side, 'i').test(x.side.blockside || ''));
    window.onAlertTap = (spot) => { window.__spot = spot; };
    openSheet(hit.group, hit.side.key);
    await new Promise((r) => setTimeout(r, 400));
    const q = (s) => document.querySelector(s);
    q('#alertBtn')?.click();
    const tip = document.createElement('div'); tip.innerHTML = previewHtml(hit.group, hit.side);
    if (window.__spot) armedToast(window.__spot, null);   // the toast a real arm shows (the subscribe is skipped)
    return {
      head: q('#sheetBody .verdict .head')?.textContent, sched: q('#sheetBody .asched')?.textContent,
      other: [...document.querySelectorAll('#sheetBody .srow .nx')].map((e) => e.textContent),
      tipHead: tip.querySelector('.tip-head')?.textContent, tipNext: tip.querySelector('.tip-next')?.textContent,
      note: sheetArmNote, spotSweep: window.__spot?.nextSweepISO, toast: q('#toast')?.textContent,
    };
  }, ne ? 'northeast' : 'southwest');
  await pg.close();
  return { ...out, errors: errs };
}
// the toast names the block by DataSF's corridor ("04th St" today): compare the rest
const blockless = (t) => String(t || '').replace(/^Sweep alert set for [^,.]+/, 'Sweep alert set for <block>');
// Mon 10/5 8 PM PDT, NorthEast side: tonight's sweep is Tue 12 AM; the other side's is Wed 12 AM (tomorrow night)
const eve = await nightSheet(Date.UTC(2026, 9, 6, 3, 0), true);
console.log(JSON.stringify(eve));
const okEve = eve.head === 'Mon night' && /^Tue 12 to 2 AM · .* · tonight$/.test(eve.sched || '')
  && eve.other.length === 1 && eve.other[0] === 'Tue night 10/6 · tomorrow night'
  && eve.tipHead === 'Mon night' && eve.tipNext === 'Mon night 10/5 → Tue 12 to 2 AM · tonight'
  && eve.spotSweep === '2026-10-06T07:00:00.000Z' && blockless(eve.toast) === "Sweep alert set for <block>. We'll ping you ~9 PM tonight to move it."
  && !eve.errors.length;
console.log(okEve ? '✅ midnight sweep: reads "Mon night 10/5 → Tue 12 to 2 AM · tonight"' : '❌ midnight sweep: worded by the calendar day, not the night');
if (!okEve) process.exitCode = 1;
// Tue 10/6 1 AM PDT, NorthEast side mid-sweep: the alert arms Thu 12 AM, which the toast calls Wed night
const mid = await nightSheet(Date.UTC(2026, 9, 6, 8, 0), true);
console.log(JSON.stringify(mid));
// The 9 PM push for Thu 12 AM goes out Wed 10/7 at 9 PM, the night the note just named, not "the night before" it.
// At 1 AM people are still in Monday night, so the other side's Wed 12 AM sweep (Tuesday night) is tomorrow night.
const okMid = mid.head === 'Sweeping now' && mid.note === ', next sweep Wed night 10/7' && mid.spotSweep === '2026-10-08T07:00:00.000Z'
  && blockless(mid.toast) === "Sweep alert set for <block>, next sweep Wed night 10/7. We'll ping you ~9 PM that night to move it."
  && mid.other.length === 1 && mid.other[0] === 'Tue night 10/6 · tomorrow night' && !mid.errors.length;
console.log(okMid ? '✅ midnight sweep in progress: the alert toast names the next night and its 9 PM push' : '❌ midnight sweep in progress: wrong next-sweep note or push night');
if (!okMid) process.exitCode = 1;
// Mon 10/5 10 PM PDT: tonight's 9 PM push is already due, so the next send run delivers it (not "~9 PM")
const late = await nightSheet(Date.UTC(2026, 9, 6, 5, 0), true);
console.log(JSON.stringify(late));
const okLate = late.head === 'Mon night' && late.spotSweep === '2026-10-06T07:00:00.000Z'
  && blockless(late.toast) === "Sweep alert set for <block>. We'll ping you shortly to move it." && !late.errors.length;
console.log(okLate ? '✅ armed after 9 PM: the toast says the push comes shortly' : '❌ armed after 9 PM: the toast promises a 9 PM push that has passed');
if (!okLate) process.exitCode = 1;
// Mon 10/5 12:30 AM PDT: people are still in Sunday night, so the Tue 12 AM sweep (Monday night) is tomorrow
// night and so is its 9 PM push; the other side is being swept (Mon 12 to 2 AM).
const early = await nightSheet(Date.UTC(2026, 9, 5, 7, 30), true);
console.log(JSON.stringify(early));
const okEarly = early.head === 'Mon night' && /^Tue 12 to 2 AM · .* · tomorrow night$/.test(early.sched || '')
  && early.tipNext === 'Mon night 10/5 → Tue 12 to 2 AM · tomorrow night' && early.other[0] === 'Sweeping now · until 2AM'
  && blockless(early.toast) === "Sweep alert set for <block>. We'll ping you ~9 PM tomorrow night to move it." && !early.errors.length;
console.log(okEarly ? '✅ 12:30 AM: Monday night reads "tomorrow night"' : '❌ 12:30 AM: Monday night counted from the new date ("tonight")');
if (!okEarly) process.exitCode = 1;

// The one-time tip on someone's first block sheet: a night sweep's alert is one push around 9 PM the evening
// before (not "~30 min before the truck"), a daytime one keeps the 30 min wording.
async function firstTip(target, center, cnn, side) {
  const pg = await b.newPage();
  await pg.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await pg.evaluateOnNewDocument((t) => {
    const R = Date, off = t - R.now();
    class F extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } }
    globalThis.Date = F;
    try { localStorage.removeItem('curbFirstSheet'); } catch (_) {}
  }, target);
  await pg.goto(SITE + '/', { waitUntil: 'load' });
  await pg.waitForFunction(() => { const x = document.getElementById('welcomeGo'); return x && x.offsetParent; }, { timeout: 8000 }).then(() => pg.click('#welcomeGo'), () => {});
  await pg.waitForFunction(() => typeof map !== 'undefined');
  await pg.evaluate((c) => map.setView(c, 17, { animate: false }), center);
  await pg.waitForFunction((n) => typeof segCacheAll !== 'undefined' && segCacheAll.some((x) => String(x.group.cnn) === n), { timeout: 30000 }, cnn);
  const text = await pg.evaluate(async (n, sd) => {
    const hit = segCacheAll.find((x) => String(x.group.cnn) === n && new RegExp(sd, 'i').test(x.side.blockside || ''));
    openSheet(hit.group, hit.side.key);
    await new Promise((r) => setTimeout(r, 1200));
    return document.querySelector('#toast')?.textContent;
  }, cnn, side);
  await pg.close();
  return text;
}
const tipNight = await firstTip(Date.UTC(2026, 9, 6, 3, 0), [37.77606, -122.39370], '269000', 'northeast'); // Mon 8 PM
const tipDay = await firstTip(Date.UTC(2026, 8, 29, 19, 0), [37.76825, -122.44573], '4695000', 'west');      // Tue noon
console.log(JSON.stringify({ tipNight, tipDay }));
const okTip = tipNight === "That's this curb's verdict. 🔔 Sweep alerts pings you around 9 PM the evening before it starts."
  && tipDay === "That's this curb's verdict. 🔔 Sweep alerts pings you ~30 min before the truck.";
console.log(okTip ? '✅ first-sheet tip: night sweeps say 9 PM the evening before, day sweeps 30 min' : '❌ first-sheet tip: wrong alert timing for this sweep');
if (!okTip) process.exitCode = 1;
await b.close();
