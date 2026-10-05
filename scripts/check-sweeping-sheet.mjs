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

// Holidays (street-cleaning tickets, Oct 2025 to Sep 2026; lib/sweep-core.js sweepSuspended): the evening before
// Indigenous Peoples Day (Sun 10/11 2026, 8 PM PDT) regular sweeps are off, and a side with a posted holiday
// schedule (DataSF weekday 'Holiday') is swept at its hours. SHOTS_DIR=<dir> saves each sheet as a 390 px PNG.
async function holidaySheet(center, cnn, side, shot, t = Date.UTC(2026, 9, 12, 3, 0)) {
  const pg = await b.newPage();
  await pg.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.evaluateOnNewDocument((t) => {
    const R = Date, off = t - R.now();
    class F extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } }
    globalThis.Date = F;
    try { localStorage.setItem('curbFirstSheet', '1'); } catch (_) {}
  }, t);
  await pg.goto(SITE + '/', { waitUntil: 'load' });
  await pg.waitForFunction(() => { const x = document.getElementById('welcomeGo'); return x && x.offsetParent; }, { timeout: 8000 }).then(() => pg.click('#welcomeGo'), () => {});
  await pg.waitForFunction(() => typeof map !== 'undefined');
  await pg.evaluate((c) => map.setView(c, 17, { animate: false }), center);
  await pg.waitForFunction((n) => typeof segCacheAll !== 'undefined' && segCacheAll.some((x) => String(x.group.cnn) === n), { timeout: 30000 }, cnn);
  const out = await pg.evaluate(async (n, sd) => {
    const hit = segCacheAll.find((x) => String(x.group.cnn) === n && new RegExp('^' + sd + '$', 'i').test(x.side.blockside || ''));
    window.onAlertTap = (spot) => { window.__spot = spot; };
    openSheet(hit.group, hit.side.key);
    await new Promise((r) => setTimeout(r, 400));
    const q = (s) => document.querySelector(s), t = (s) => q(s)?.textContent.replace(/\s+/g, ' ').trim();
    q('#alertBtn')?.click();
    const tip = document.createElement('div'); tip.innerHTML = previewHtml(hit.group, hit.side);
    return {
      head: t('#sheetBody .verdict .head'), sched: t('#sheetBody .asched'), holrow: t('#sheetBody .holrow') || null,
      card: q('#sheetBody .holcard') ? [t('#sheetBody .holcard .hh'), t('#sheetBody .holcard .hs')] : null,
      other: [...document.querySelectorAll('#sheetBody .srow')].map((e) => [e.querySelector('.nx')?.textContent, e.querySelector('.holsign')?.textContent || null]),
      tipSide: tip.querySelector('.tip-side')?.textContent, tipNext: tip.querySelector('.tip-next')?.textContent,
      spotSweep: window.__spot?.nextSweepISO, spotRules: (window.__spot?.rules || []).map((r) => r.weekday + ' ' + r.fromhour + '-' + r.tohour),
      dayFilterMon: (() => { const keep = dayFilter; dayFilter = 1; const n = hit.side.rows.filter((r) => normDay(r.weekday) === dayFilter).length; dayFilter = keep; return n; })(),
    };
  }, cnn, side);
  if (shot && process.env.SHOTS_DIR) await pg.screenshot({ path: `${process.env.SHOTS_DIR}/${shot}` });
  await pg.close();
  return { ...out, errors: errs };
}
// (a) Columbus Ave, Lombard to Taylor (cnn 4301000): the Southwest side is swept Mon/Wed/Fri/Sat 4 to 6 AM and
// posts HOLIDAYS 4 TO 6AM; the Northeast side (Tue/Thu/Sun) has no holiday schedule
const hol = await holidaySheet([37.80314, -122.41430], '4301000', 'southwest', 'sheet-holiday-row.png');
console.log(JSON.stringify(hol));
const okHol = hol.head === 'Sun night' && hol.sched === 'Mon 4 to 6 AM · holiday schedule · tonight' && hol.holrow === null
  && hol.card && hol.card[0] === 'Holiday schedule' && hol.card[1].startsWith('Indigenous Peoples Day · Sun night 10/11. Regular sweeps are off')
  && hol.other.length === 1 && hol.other[0][0] === 'Mon night 10/12 · tomorrow night' && hol.other[0][1] === null
  && /HOLIDAYS 4AM to 6AM/.test(hol.tipSide || '') && hol.tipNext === 'Sun night 10/11 → Mon 4 to 6 AM · tonight'
  && hol.spotSweep === '2026-10-12T11:00:00.000Z' && hol.spotRules.includes('Holiday 4-6') && hol.dayFilterMon === 1 && !hol.errors.length;
console.log(okHol ? '✅ holiday schedule: the eve of Indigenous Peoples Day sweeps Mon 4 to 6 AM, says so, and arms it' : '❌ holiday schedule: the side\'s Holiday row is not its next sweep, or the sheet does not say so');
if (!okHol) process.exitCode = 1;
// (b) 4th St, King to Berry (cnn 269000), Southwest side Mon/Wed/Fri 12 to 2 AM, no holiday schedule: tonight is off
const reg = await holidaySheet([37.77606, -122.39370], '269000', 'southwest', 'sheet-no-holiday-row.png');
console.log(JSON.stringify(reg));
const okReg = reg.head === 'Tue night' && /^Wed 12 to 2 AM · every week · in 2 days$/.test(reg.sched || '') && reg.holrow === null
  && reg.card && reg.card[0] === 'No street sweeping' && reg.card[1] === 'Indigenous Peoples Day · Sun night 10/11 → Mon 12 to 2 AM. Leave your car where it is.'
  && reg.other.length === 1 && reg.other[0][0] === 'Mon night 10/12 · tomorrow night' && reg.spotSweep === '2026-10-14T07:00:00.000Z' && !reg.errors.length;
console.log(okReg ? '✅ no holiday schedule: tonight\'s 12 to 2 AM sweep is off, and the card says so' : '❌ no holiday schedule: a regular night sweep still shows on the holiday, or the card is wrong');
if (!okReg) process.exitCode = 1;
// (c) The holiday morning, once the holiday sweep is over: Mission St, Cesar Chavez to Precita (cnn 9129000), Northwest
// side, Mon 6 to 8 AM plus HOLIDAYS 5 TO 7AM, at Mon 10/12 7:30 AM. The card must not offer the finished 5 to 7 window
// as coming ("this side is swept at its posted holiday hours"); it says regular sweeps are off and that one is over.
const done = await holidaySheet([37.74747, -122.41867], '9129000', 'northwest', 'sheet-holiday-done.png', Date.UTC(2026, 9, 12, 14, 30));
console.log(JSON.stringify(done));
const okDone = done.card && done.card[0] === 'Regular sweeps off'
  && done.card[1] === "Indigenous Peoples Day · today. This side's holiday sweep is over. Leave your car where it is."
  && /^HOLIDAYS 5 TO 7AM ?on city holidays, when regular sweeps stop$/.test(done.holrow || '') && !done.errors.length;
console.log(okDone ? '✅ holiday morning: once the holiday sweep is over, the card says regular sweeps are off, not that it is coming' : '❌ holiday morning: the card still offers a holiday sweep that has ended');
if (!okDone) process.exitCode = 1;

// The day filter is a visibility lens (CLAUDE.md), and a side's holiday schedule counts on the weekday its next
// sweep falls, within the coming week. The evening before Indigenous Peoples Day (Sun 10/11 2026, 8 PM PDT) the MON
// chip must show (a) at street level Ellis St, Hyde to Larkin (cnn 5177000) South side, Tue/Thu/Sun 6 to 8 AM plus
// HOLIDAYS 6 TO 8AM, swept Monday morning by its holiday schedule, and (b) in the citywide overview every
// holiday-schedule block in amber (Monday 4 to 8 AM, under 24 hours away), not green "clear" off its Monday row.
{
  const pg = await b.newPage();
  await pg.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.evaluateOnNewDocument((t) => {
    const R = Date, off = t - R.now();
    class F extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } }
    globalThis.Date = F;
    try { localStorage.setItem('curbFirstSheet', '1'); } catch (_) {}
  }, Date.UTC(2026, 9, 12, 3, 0));
  await pg.goto(SITE + '/', { waitUntil: 'load' });
  await pg.waitForFunction(() => { const x = document.getElementById('welcomeGo'); return x && x.offsetParent; }, { timeout: 8000 }).then(() => pg.click('#welcomeGo'), () => {});
  await pg.waitForFunction(() => typeof map !== 'undefined');
  await pg.evaluate(() => map.setView([37.78435, -122.41690], 17, { animate: false }));
  await pg.waitForFunction(() => typeof segCacheAll !== 'undefined' && segCacheAll.some((x) => String(x.group.cnn) === '5177000'), { timeout: 30000 });
  const street = await pg.evaluate(() => {
    setDayFilter(1);
    return segCache.filter((x) => String(x.group.cnn) === '5177000').map((x) => x.side.blockside).sort();
  });
  // citywide: zoom out with the chip still on, then style every block that carries a holiday schedule
  await pg.evaluate(() => map.setView([37.7599, -122.4370], 12, { animate: false }));
  await pg.waitForFunction(() => ovMode && typeof OVR !== 'undefined' && OVR && ovrLines && ovrKey && ovrKey.startsWith('1|'), { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  const city = await pg.evaluate(() => {
    const amber = getCSS('--amber'), out = { blocks: 0, hidden: 0, amber: 0, other: 0 };
    for (const blk of OVR) {
      if (!blk.rules.some(isHolidayRow)) continue;
      out.blocks++;
      const st = overviewStyle(blk, 2);
      if (!st) out.hidden++; else if (st.color === amber) out.amber++; else out.other++;
    }
    out.chip = document.querySelector('.dchip.on')?.textContent;
    return out;
  });
  await new Promise((r) => setTimeout(r, 4500));   // let the day chip's toast fade before the picture
  if (process.env.SHOTS_DIR) await pg.screenshot({ path: `${process.env.SHOTS_DIR}/sheet-dayfilter-monday.png` });
  await pg.close();
  console.log(JSON.stringify({ street, city, errors: errs }));
  const okDay = street.join() === 'North,South' && city.chip === 'Mon' && city.blocks >= 530 && city.hidden === 0 && city.other === 0
    && city.amber === city.blocks && !errs.length;
  console.log(okDay ? '✅ day filter: the MON chip on the eve of a holiday shows the holiday-schedule curbs it sweeps' : '❌ day filter: the MON chip hides or clears curbs swept Monday by their holiday schedule');
  if (!okDay) process.exitCode = 1;
}
await b.close();
