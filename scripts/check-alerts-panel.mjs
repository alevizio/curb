// Headless check of the Sweep alerts panel (ⓘ menu → Sweep alerts) in index.html, run against a LOCAL static
// server, never production: every DataSF sweeping query is answered here from the synthetic rows below (the
// panel's `cnn in(...)` schedule query, the viewport, the Show on map line), every /api call is intercepted,
// and push is faked (web: a granted permission + a fake subscription; app: build 7's real pushScript from
// ContentView.swift over a fake window.webkit).
// Covers: the menu's line (none / "2 on · Normal" / "Off in iPhone Settings"), the empty state, one row per
// saved curb side with its next sweep and when it pings, soonest first, the opening check (ONE same-sweep save
// of the first curb, with the multi marker), Turn off from the panel naming its side (and leaving a sheet open
// on another side alone), a style change re-saving every curb (one save each) and snapping back when a save
// fails, Turn off all (confirm, one DELETE / {off:true} naming no side), Show on map opening that side's sheet,
// a failed schedule load, the app's denied-settings answer (status card, no reports), "Send me a test" saying
// so when notifications are off, and iPhone Safari pointing at the app.
//
//   npx -y serve . -l 3211 &   node scripts/check-alerts-panel.mjs http://localhost:3211 [--shots dir]
// Needs puppeteer-core (like scripts/monitor/browser.mjs) and Chrome (CHROME_PATH or the default).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { userScripts } from '../ios/user-scripts.mjs';

const BASE = process.argv[2] || 'http://localhost:3211';
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME_PATH
  || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find(existsSync);
let failures = 0;
const check = (name, cond, detail = '') => { if (!cond) failures++; console.log(`${cond ? '✅' : '❌'} ${name}${!cond && detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP7 = userScripts(readFileSync(new URL('../ios/CURB/ContentView.swift', import.meta.url), 'utf8'));

// Sweep days relative to today in SF. Which sweep comes first is read from the page's own nextSweep (AP.sides),
// never assumed: a holiday that week pushes a sweep a week out. Kansas East sweeps too but is never saved: it must
// not show. Mission is a 2 AM night sweep.
const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const sfDow = D.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date()));
const day = (k) => D[(sfDow + k) % 7];
const wk = { week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' };
const ln = (lng) => ({ type: 'LineString', coordinates: [[lng, 37.7652], [lng, 37.7641]] });
const ROWS = [
  { cnn: '7735000', corridor: 'Kansas St', limits: '16th St - 17th St', blockside: 'West', cnnrightleft: 'L', weekday: day(4), fromhour: '9', tohour: '11', ...wk, line: ln(-122.4035) },
  { cnn: '7735000', corridor: 'Kansas St', limits: '16th St - 17th St', blockside: 'East', cnnrightleft: 'R', weekday: day(3), fromhour: '12', tohour: '14', ...wk, line: ln(-122.4035) },
  { cnn: '5910000', corridor: 'Fulton St', limits: '6th Ave - 7th Ave', blockside: 'South', cnnrightleft: 'R', weekday: day(2), fromhour: '10', tohour: '12', ...wk, line: ln(-122.4635) },
  { cnn: '9130000', corridor: 'Mission St', limits: '20th St - 21st St', blockside: 'East', cnnrightleft: 'R', weekday: day(5), fromhour: '2', tohour: '4', ...wk, line: ln(-122.4190) },
];
const row = (cnn, side) => ROWS.find((r) => r.cnn === cnn && r.blockside === side);
// A saved curb side as the page stores it ('curbAlert' map entry), armed now.
const entry = (r) => ({ cnn: r.cnn, sideKey: r.blockside, corridor: r.corridor, limits: r.limits, blockside: r.blockside, level: 'normal', voice: 'cheeky', armedAt: Date.now(), v: 2 });
const seed = (page, ...rows) => page.evaluate((m) => { localStorage.setItem('curbAlert', JSON.stringify(m)); localStorage.removeItem('curbAlertLevel'); localStorage.removeItem('curbAlertVoice'); },
  Object.fromEntries(rows.map((r) => [`${r.cnn}|${r.blockside}`, entry(r)])));

function installFakes(native) {
  window.__reports = [];
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint', options: {}, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p256', auth: 'auth-secret' } }; } };
  if (native === 7) {
    // answers like build 7's Swift: ONE object {ok, reason, message, status}; a test answers __nativeTestMode
    window.__nativeMode = 'saved'; window.__nativeTestMode = 'test-sent'; window.__nativePosts = []; window.__nativeDelay = 30;
    window.webkit = { messageHandlers: { curbPush: { postMessage: (m) => {
      window.__nativePosts.push(JSON.parse(JSON.stringify(m)));
      const a = m.test ? { reason: window.__nativeTestMode } : typeof window.__nativeMode === 'string' ? { reason: window.__nativeMode } : window.__nativeMode;
      const r = { ok: a.reason === 'saved' || a.reason === 'test-sent', reason: a.reason, message: String(a.message ?? a.reason).slice(0, 300), status: a.status || 0 };
      setTimeout(() => window.__curbNativePushResult(r), window.__nativeDelay);
    } } } };
  } else {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    Notification.requestPermission = async () => 'granted';
    const reg = { pushManager: { getSubscription: async () => sub, subscribe: async () => sub } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg), register: async () => reg } });
  }
  try { localStorage.setItem('curbOnboarded', '1'); localStorage.setItem('curbIosHintShown', '1'); } catch (_) { /* ignore */ }
}

async function openPage(native, ctl, { ua } = {}) {
  const page = await browser.newPage();
  if (ua) await page.setUserAgent(ua);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: SHOTS ? 3 : 1 });
  page.__posts = []; page.__tests = []; page.__lines = []; page.__sideQueries = 0;
  page.on('pageerror', (e) => check(`no page errors (${native ? 'app' : 'web'})`, false, e.message));
  await page.setRequestInterception(true);
  const json = (r, body, status = 200) => r.respond({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname === 'data.sf.gov') {
      if (!u.pathname.endsWith('/yhqp-riqs.json')) return json(r, []);
      const sel = u.searchParams.get('$select') || '', where = u.searchParams.get('$where') || '';
      if (sel.includes('count(*)')) return json(r, [{ count: String(ROWS.length) }]);
      const many = where.match(/cnn in\(([^)]*)\)/);
      if (many) {
        page.__sideQueries++;
        if (ctl.dataFail) return json(r, { error: 'boom' }, 500);
        const ids = [...many[1].matchAll(/'(\d+)'/g)].map((x) => x[1]);
        return json(r, ROWS.filter((x) => ids.includes(x.cnn)).map(({ line, ...x }) => x));
      }
      const one = where.match(/cnn='(\d+)'/);
      if (one) { page.__lines.push(one[1]); const x = ROWS.find((y) => y.cnn === one[1]); return json(r, x ? [{ line: x.line }] : []); }
      if (where.includes('intersects(line')) return json(r, ROWS);
      return json(r, []);
    }
    if (u.origin === new URL(BASE).origin && u.pathname === '/api/save-subscription') {
      const post = { method: r.method(), body: JSON.parse(r.postData() || '{}') };
      page.__posts.push(post);
      return json(r, ctl.status === 200 ? { ok: true } : { error: 'boom' }, ctl.status);
    }
    if (u.origin === new URL(BASE).origin && u.pathname === '/api/test-notification') { page.__tests.push(JSON.parse(r.postData() || '{}')); return json(r, { ok: true }); }
    if (u.origin === new URL(BASE).origin && u.pathname.startsWith('/api/')) return r.respond({ status: 204, body: '' });
    return r.continue();
  });
  await page.evaluateOnNewDocument(installFakes, native);
  if (native === 7) await page.evaluateOnNewDocument(APP7.pushScript);
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => typeof drawSegments === 'function' && typeof openAlertsPanel === 'function', { timeout: 20000 });
  await page.evaluate(() => { window.curbReport = (k, d) => window.__reports.push([k, d]); });
  return page;
}
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const texts = (page, sel) => page.$$eval(sel, (es) => es.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
const tap = (page, sel) => page.$eval(sel, (e) => e.click());
const toast = (page) => text(page, '#toast');
const saved = async (page) => JSON.parse((await page.evaluate(() => localStorage.getItem('curbAlert'))) || '{}');
const isOpen = (page) => page.$eval('#alertsPanel', (e) => e.classList.contains('open'));
// ⓘ → Sweep alerts, then wait for the schedules and the opening check to settle
async function openPanel(page) {
  await tap(page, '#infoBtn');
  await tap(page, '#imAlerts');
  await page.waitForFunction(() => AP.loaded && AP.check !== 'checking', { timeout: 8000 }).catch(() => {});
  await sleep(150);
}
const closePanel = (page) => page.evaluate(() => closeAlertsPanel());
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const rowOff = (page, cnn, side) => tap(page, `.ap-row[data-id="${cnn}|${side}"] [data-act="off"]`);
const rowText = (page, id, sel) => text(page, `.ap-row[data-id="${id}"] ${sel}`);
// the saved sides in the order the page says they sweep (soonest first), from its own nextSweep
const soonest = (page) => page.evaluate(() => liveAlerts().map((a) => alertId(a)).filter((id) => AP.sides[id] && AP.sides[id].armNs)
  .sort((a, b) => +AP.sides[a].armNs.start - +AP.sides[b].armNs.start));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  // ---------------- web push ----------------
  const ctl = { status: 200 };
  const page = await openPage(false, ctl);
  await page.evaluate(() => localStorage.removeItem('curbAlert'));
  await tap(page, '#infoBtn');
  check('menu: Sweep alerts is the first item, "None on yet" with nothing saved', (await text(page, '#infoMenu .im-item')).startsWith('Sweep alerts') && (await text(page, '#imAlertsSub')) === 'None on yet');
  await tap(page, '#imAlerts');
  await sleep(300);
  check('panel opens, the menu closes', (await isOpen(page)) && await page.$eval('#infoMenu', (e) => e.hidden));
  check('…and the focus is inside it, on Close (a modal: Tab must not reach the map behind)', await page.evaluate(() => document.activeElement && document.activeElement.id === 'apClose'), await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
  check('empty state: how to add one, 0 of 5, no Turn off all, no save sent', (await text(page, '.ap-empty')).startsWith('No alerts on yet.') && (await text(page, '.ap-sec span:last-child')) === '0 of 5' && !(await page.$('#apAllOff')) && page.__posts.length === 0);
  check('style dials show the saved style (Normal, Cheeky) with what each means', await page.$eval('#alertsPanel [data-k="curbAlertLevel"] [data-v="normal"]', (b) => b.getAttribute('aria-pressed') === 'true') && (await texts(page, '.ap-blurb')).join('|') === 'Night before + 30 min before|Warm, funny, on your side');
  await shot(page, '1-web-empty');
  await page.keyboard.press('Escape');
  check('Esc closes it and gives the focus back to ⓘ', !(await isOpen(page)) && await page.evaluate(() => document.activeElement && document.activeElement.id === 'infoBtn'));

  // when each push lands, worded with the date from two days out (a sweep on some weeks only can be 10 days away)
  const far = await page.evaluate(() => {
    const p = sfParts(new Date(Date.now() + 10 * 864e5)), start = sfWallToInstant(p.y, p.mo, p.da, 9), a = alertAnchors(start);
    const spot = { nextSweepISO: start.toISOString(), eveningISO: a.eve.toISOString(), morningISO: a.morn && a.morn.toISOString() };
    return { normal: pingLine(spot, 'normal'), intense: pingLine(spot, 'intense'), light: pingLine(spot, 'light') };
  });
  const dd = '(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \\d{1,2}/\\d{1,2}';
  check('pings 10 days out carry their date: "Tue 10/20 8 PM and Wed 10/21 8:30 AM"', new RegExp(`^Pings you ${dd} 8 PM and ${dd} 8:30 AM$`).test(far.normal), far.normal);
  check('…a day is named once: "…, Wed 10/21 7 AM and 8:30 AM" (Intense)', new RegExp(`^Pings you ${dd} 8 PM, ${dd} 7 AM and 8:30 AM$`).test(far.intense), far.intense);
  check('…Light: just the 30 min heads-up', new RegExp(`^Pings you ${dd} 8:30 AM$`).test(far.light), far.light);

  // two saved curb sides: soonest first, each with its next sweep and when it pings
  await seed(page, row('7735000', 'West'), row('5910000', 'South'));
  await tap(page, '#infoBtn');
  check('menu line: "2 on · Normal"', (await text(page, '#imAlertsSub')) === '2 on · Normal');
  await page.evaluate(() => closeInfoMenu());
  const p0 = page.__posts.length;
  await openPanel(page);
  const order = await soonest(page);
  const ids = await page.$$eval('.ap-row', (rs) => rs.map((r) => r.dataset.id));
  check('one row per saved side, the soonest sweep first (Kansas East, not saved, is not listed)', ids.length === 2 && ids.join() === order.join() && !ids.includes('7735000|East'), `${ids} vs ${order}`);
  check('…"2 of 5"', (await text(page, '.ap-sec span:last-child')) === '2 of 5');
  const want = await page.evaluate(() => { const x = AP.sides['5910000|South']; return 'Next sweep ' + relPhrase(x.armNs).txt; });
  check('…its next sweep, worded like its sheet', (await rowText(page, '5910000|South', '.ap-next')) === want, `${await rowText(page, '5910000|South', '.ap-next')} vs ${want}`);
  const ping = await rowText(page, '5910000|South', '.ap-ping');
  check('…and when it pings (Normal: the night before + 30 min before)', /^Pings you .+ 8 PM and .+ 9:30 AM$/.test(ping), ping);
  const chk = page.__posts.slice(p0), [first] = order;
  check('opening re-saves ONE curb (the soonest) as a check, with its rules and the multi marker', chk.length === 1 && chk[0].method === 'POST' && `${chk[0].body.spot.cnn}|${chk[0].body.spot.sideKey}` === first && chk[0].body.spot.multi === 1 && chk[0].body.spot.rules?.length === 1, JSON.stringify(chk.map((p) => [p.method, p.body.spot?.cnn])) + ' want ' + first);
  check('…and says notifications are on', (await text(page, '.ap-stat')) === 'Notifications are on in this browser');
  check('Turn off all is offered from two curbs on', (await text(page, '#apAllOff')) === 'Turn off all alerts');
  await shot(page, '2-web-two-curbs');

  // Turn off one from the panel while a sheet is open on the OTHER side: only that side goes, the sheet stays on
  await page.evaluate((rows) => { drawSegments(rows); const x = segCache.find((s) => s.group.cnn === '5910000'); openSheet(x.group, x.side.key); }, ROWS);
  await rowOff(page, '7735000', 'West');
  await page.waitForFunction(() => !document.querySelector('.ap-row[data-id="7735000|West"]'), { timeout: 4000 }).catch(() => {});
  const del = page.__posts.at(-1);
  check('Turn off in the panel: DELETE naming that side', del.method === 'DELETE' && del.body.spot?.cnn === '7735000' && del.body.spot?.sideKey === 'West', JSON.stringify(del));
  check('…its row goes, the toast says so, the saved map keeps the other', (await texts(page, '.ap-row .ap-nm')).join('|') === 'Fulton St, South side' && (await toast(page)) === 'Alerts off for Kansas St.' && Object.keys(await saved(page)).join() === '5910000|South');
  check('…and the toast shows OVER the panel (its layer is above the 800 cards)', await page.evaluate(() => +getComputedStyle(document.getElementById('toast')).zIndex > +getComputedStyle(document.getElementById('alertsPanel')).zIndex && document.getElementById('toast').classList.contains('show')));
  check('…the focus stays in the panel (its row and button are gone)', await page.evaluate(() => document.getElementById('alertsPanel').contains(document.activeElement)), await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
  check('…and the sheet open on Fulton St still reads "✓ Alerts on"', (await text(page, '#alertBtn')) === '✓ Alerts on');
  check('…one curb left: no Turn off all (its row has its own)', !(await page.$('#apAllOff')));
  await closePanel(page);

  // A style change re-saves every curb, one save each, after the debounce
  await seed(page, row('7735000', 'West'), row('5910000', 'South'));
  await openPanel(page);
  const p1 = page.__posts.length;
  await tap(page, '#alertsPanel [data-k="curbAlertLevel"] [data-v="intense"]');
  await tap(page, '#alertsPanel [data-k="curbAlertVoice"] [data-v="drill"]');
  check('a dial tap shows at once (pressed + its blurb)', await page.$eval('#alertsPanel [data-k="curbAlertLevel"] [data-v="intense"]', (b) => b.getAttribute('aria-pressed') === 'true') && (await texts(page, '.ap-blurb'))[0] === 'Night before, morning of + 30 min before');
  await sleep(1200);
  const re = page.__posts.slice(p1);
  check('style: one save per curb, both carrying both dials and the multi marker', re.length === 2 && re.every((p) => p.method === 'POST' && p.body.spot.level === 'intense' && p.body.spot.voice === 'drill' && p.body.spot.multi === 1) && new Set(re.map((p) => p.body.spot.cnn)).size === 2, JSON.stringify(re.map((p) => [p.body.spot?.cnn, p.body.spot?.level, p.body.spot?.voice])));
  check('…saved and said', (await toast(page)) === 'Alert style saved for all 2 curbs.' && Object.values(await saved(page)).every((a) => a.level === 'intense' && a.voice === 'drill'));
  check('…the menu line follows', await page.evaluate(() => { paintAlertsMenu(); return document.getElementById('imAlertsSub').textContent; }) === '2 on · Intense');
  ctl.status = 500;
  await page.evaluate(() => { window.__reports.length = 0; });
  await tap(page, '#alertsPanel [data-k="curbAlertLevel"] [data-v="light"]');
  await sleep(1200);
  ctl.status = 200;
  check('a style save that fails snaps the dial back and says so (and reports it)', (await page.evaluate(() => localStorage.getItem('curbAlertLevel'))) === 'intense' && await page.$eval('#alertsPanel [data-k="curbAlertLevel"] [data-v="intense"]', (b) => b.getAttribute('aria-pressed') === 'true') && (await toast(page)) === "Couldn't save your alert style, try again." && await page.evaluate(() => window.__reports.some(([k]) => k === 'push-save-failed')));

  // Turn off all: a confirm, then ONE DELETE that names no side
  await tap(page, '#apAllOff');
  check('Turn off all asks first', (await text(page, '#apAllYes')) === 'Turn off all 2' && (await text(page, '#apAllNo')) === 'Keep them');
  await shot(page, '3-web-confirm-all');
  const p2 = page.__posts.length;
  await tap(page, '#apAllYes');
  await page.waitForFunction(() => !document.querySelector('.ap-row'), { timeout: 4000 }).catch(() => {});
  const all = page.__posts.slice(p2);
  check('…one DELETE with the subscription and no side (every watch of this browser)', all.length === 1 && all[0].method === 'DELETE' && all[0].body.subscription?.keys?.auth === 'auth-secret' && !all[0].body.spot, JSON.stringify(all));
  check('…the list empties, the saved map is gone, the toast says so', (await text(page, '.ap-empty')).startsWith('No alerts on yet.') && !(await page.evaluate(() => localStorage.getItem('curbAlert'))) && (await toast(page)) === 'All alerts off.');
  check('…and the open sheet reads off', (await text(page, '#alertBtn')).includes('Sweep alerts'));
  await closePanel(page);

  // Show on map: the panel closes, the map flies to that block and opens that side's sheet, even with the day chip
  // on the OTHER side's day and green hidden in the legend (those filters hide the saved side from the map)
  await seed(page, row('7735000', 'West'));
  await page.evaluate((east) => { document.getElementById('sheetClose').click(); setDayFilter(normDay(east)); }, row('7735000', 'East').weekday);
  await tap(page, '.legend2 .lst[data-st="green"]');
  await openPanel(page);
  await tap(page, '.ap-row [data-act="show"]');
  await page.waitForFunction(() => document.getElementById('sheet').classList.contains('open') && sheetSpot && sheetSpot.cnn === '7735000', { timeout: 8000 }).catch(() => {});
  check('Show on map: the panel closes and the block\'s line is fetched', !(await isOpen(page)) && page.__lines.includes('7735000'));
  check('…and its sheet opens on the saved side (day chip and legend filters cleared)', await page.evaluate(() => !!sheetSpot && sheetSpot.cnn === '7735000' && sheetSpot.sideKey === 'West' && dayFilter === null && statusOn.green) && (await text(page, '#alertBtn')) === '✓ Alerts on', await page.evaluate(() => JSON.stringify([sheetSpot && sheetSpot.cnn, sheetSpot && sheetSpot.sideKey, dayFilter, statusOn])));

  // The schedules can't load: the rows say so, nothing is re-saved
  ctl.dataFail = true;
  const p3 = page.__posts.length;
  await openPanel(page);
  ctl.dataFail = false;
  check('schedule load fails: the row says its alerts still work, no check save', (await text(page, '.ap-row .ap-next')) === "Couldn't load the schedule. Its alerts still work." && page.__posts.length === p3);
  await page.close();

  // ---------------- the iPhone app (build 7's real pushScript) ----------------
  const app = await openPage(7, ctl);
  await seed(app, row('5910000', 'South'), row('9130000', 'East'));
  await openPanel(app);
  check('app: "On this iPhone", the check goes through the bridge with the multi marker', (await text(app, '#apKicker')) === 'On this iPhone' && await app.evaluate(() => { const s = window.__nativePosts.at(-1).spot || {}; return s.cnn === '5910000' && s.multi === 1; }));
  check('…"Notifications are on for CURB"', (await text(app, '.ap-stat')) === 'Notifications are on for CURB');
  const night = await rowText(app, '9130000|East', '.ap-ping');
  check('a night sweep pings once, at 9 PM the evening before', /^Pings you (tonight|tomorrow|(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}\/\d{1,2}) 9 PM$/.test(night), night);
  await shot(app, '4-app-on');
  await closePanel(app);

  // Notifications off for CURB in iPhone Settings: the check says so, nothing is reported
  await app.evaluate(() => { window.__nativeMode = 'denied-settings'; window.__reports.length = 0; });
  await openPanel(app);
  check('app, denied in Settings: the card says no alert can reach this iPhone', (await text(app, '.ap-warn b.h')) === 'Notifications are off for CURB' && (await text(app, '.ap-warn p')).startsWith('No alert can reach this iPhone.'), await text(app, '.ap-warn'));
  check('…no reports', await app.evaluate(() => !window.__reports.length));
  await shot(app, '5-app-denied');
  await tap(app, '#apSettings');
  check('…the app (1.0.5) opens CURB\'s notification settings: {settings:true}, outside the save queue', await app.evaluate(() => JSON.stringify(window.__nativePosts.at(-1)) === '{"settings":true}'));
  await app.evaluate(() => { const f = window.__curbOpenSettings; delete window.__curbOpenSettings; renderAlertsPanel(); window.__keep = f; });
  check('…an app before 1.0.5 has no Open Settings button, only where to go', !(await app.$('#apSettings')) && (await text(app, '.ap-warn p')).includes('Settings → Notifications → CURB'));
  await app.evaluate(() => { window.__curbOpenSettings = window.__keep; });
  await closePanel(app);
  await tap(app, '#infoBtn');
  check('…and the menu line says "Off in iPhone Settings" in red', (await text(app, '#imAlertsSub')) === 'Off in iPhone Settings' && await app.$eval('#imAlertsSub', (e) => e.classList.contains('bad')));
  await app.evaluate(() => closeInfoMenu());

  // "Send me a test" while notifications are off: the app sends nothing, so the page says why
  await openPanel(app);
  await app.evaluate(() => { window.__nativeTestMode = 'denied-settings'; });
  await tap(app, '#apTest');
  await sleep(400);
  check('test while off in Settings: says notifications are off (no silent "sending")', (await toast(app)).startsWith('Notifications are off for CURB. Turn them on in Settings'), await toast(app));
  await app.evaluate(() => { window.__nativeTestMode = 'test-sent'; window.__nativeMode = 'saved'; });
  await tap(app, '#apTest');
  await sleep(400);
  check('…and a test that goes out keeps "Sending a test"', (await toast(app)) === 'Sending a test. Check your lock screen. 🔔' && await app.evaluate(() => window.__nativePosts.at(-1).test === true));

  // Turn off one, then all, through the bridge
  await rowOff(app, '9130000', 'East');
  await sleep(400);
  check('app Turn off: {off:true} naming that side', await app.evaluate(() => { const s = window.__nativePosts.at(-1).spot || {}; return s.off === true && s.cnn === '9130000' && s.sideKey === 'East'; }) && Object.keys(await saved(app)).join() === '5910000|South');
  await closePanel(app);
  await seed(app, row('5910000', 'South'), row('7735000', 'West'));
  await openPanel(app);
  await tap(app, '#apAllOff');
  await tap(app, '#apAllYes');
  await sleep(500);
  check('app Turn off all: one {off:true} naming no side, the list empties', await app.evaluate(() => { const s = window.__nativePosts.at(-1).spot || {}; return s.off === true && !s.cnn && !s.sideKey && !s.corridor; }) && !(await app.$('.ap-row')) && (await toast(app)) === 'All alerts off.');
  await app.close();

  // ---------------- iPhone Safari (not the app, not installed) ----------------
  const ios = await openPage(false, ctl, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' });
  await openPanel(ios);
  check('iPhone Safari: alerts need the app, with the App Store link', (await text(ios, '.ap-warn b')).startsWith('Alerts need the app') && (await ios.$eval('.ap-warn a.ios-get', (a) => a.href)).includes('apps.apple.com/app/id6780998238'));
  check('…and no test button (it could only open the install hint, under the panel)', !(await ios.$('#apTest')));
  await ios.close();
} catch (e) {
  check('run', false, e.stack || e.message);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
