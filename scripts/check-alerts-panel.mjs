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
// so when notifications are off, iPhone Safari pointing at the app, and Android Chrome (only there, never in the
// Android app) pointing at the Play beta. The little car: the app's auto-saved car on the map (on its side, a tap
// opens it, Clear removes it, a park while the page slept shows on return), a "Share where I parked" link
// (?car=1) putting the car on its side, and the sheet's Share where I parked / Share this block texts.
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

// The app's auto-park bridge (1.0.6): answers like AutoParkBridge (status / prepare → { notifications, location, token,
// car? }, clear → { ok }), after the real autoParkScript from ContentView.swift. window.__parkStatus is what it answers.
function installAutoPark(car) {
  window.__parkPosts = [];
  window.__parkStatus = { notifications: 'authorized', location: 'whenInUse', token: true, ...(car ? { car } : {}) };
  window.webkit.messageHandlers.curbAutoPark = { postMessage: (m) => {
    window.__parkPosts.push(JSON.parse(JSON.stringify(m)));
    if (m.op === 'shortcuts') return;
    if (m.op === 'clear') delete window.__parkStatus.car;
    const r = m.op === 'clear' ? { ok: true } : JSON.parse(JSON.stringify(window.__parkStatus));
    setTimeout(() => window.__curbAutoParkResult(m.id, r), 20);
  } };
}

async function openPage(native, ctl, { ua, androidApp, autoPark, path = '/' } = {}) {
  const page = await browser.newPage();
  if (ua) await page.setUserAgent(ua);
  // the Android app's tab: the page's head script reads the flag its android-app:// referrer left
  if (androidApp) await page.evaluateOnNewDocument(() => sessionStorage.setItem('curbAndroidApp', '1'));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: SHOTS ? 3 : 1 });
  page.__posts = []; page.__tests = []; page.__lines = []; page.__carQueries = []; page.__sideQueries = 0;
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
      if (one && sel.includes('cnnrightleft')) { page.__carQueries.push(one[1]); return json(r, ROWS.filter((y) => y.cnn === one[1])); }  // the little car's block
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
  if (autoPark !== undefined) { await page.evaluateOnNewDocument(installAutoPark, autoPark); await page.evaluateOnNewDocument(APP7.autoParkScript); }
  await page.goto(BASE + path, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => typeof drawSegments === 'function' && typeof openAlertsPanel === 'function', { timeout: 20000 });
  await page.evaluate(() => { window.curbReport = (k, d) => window.__reports.push([k, d]); });
  return page;
}
// the sheet's "Your car" row and the car on the map
const carPick = (page) => page.evaluate(() => { const el = document.getElementById('carPick'), svg = CAR.marker && CAR.marker.getElement().querySelector('svg');
  return { shown: !!el && !el.hidden, n: el ? el.querySelectorAll('button').length : 0, pressed: el ? [...el.querySelectorAll('button[aria-pressed=true]')].map((b) => b.dataset.v).join() : '',
    body: svg ? svg.querySelector(':scope > rect').getAttribute('fill') : '', big: !!svg && svg.classList.contains('big'), saved: localStorage.getItem('curbCarStyle') }; });
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
  check('…and no Android beta line (not an Android phone)', !(await page.$('#apPlay')));
  check('…and no auto-park (only the iPhone app can run Shortcuts actions)', !(await page.$('.ap-auto')));
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
  check('…an app before 1.0.6 shows no auto-park', !(await app.$('.ap-auto')) && !(await app.$('.ap-car')));
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

  // ---------------- auto-save where you park (the app from 1.0.6, its real autoParkScript) ----------------
  const IPHONE = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v}_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148`;
  const fresh = await openPage(7, ctl, { autoPark: null, ua: IPHONE(27) });
  await openPanel(fresh);
  const steps27 = await text(fresh, '.ap-auto ol');
  check('auto-park, nothing saved yet: the section, its steps open, and Open Shortcuts',
    (await text(fresh, '.ap-auto summary')) === 'Set it up ▸' && await fresh.$eval('.ap-auto', (d) => d.open) && !!(await fresh.$('#apShortcuts')));
  check('…iOS 27 steps (automations live in shortcuts: +, Edit, a trigger from Automation), Bluetooth naming the car',
    steps27.startsWith('Open Shortcuts, tap +, then Edit.') && steps27.includes('Bluetooth and choose your car') && steps27.includes('Disconnected')
    && steps27.includes('Save Parking Spot') && steps27.includes('Clear Parking Spot'), steps27);
  check('the page asks the app for its car at launch, without a style', await fresh.evaluate(() => JSON.stringify(window.__parkPosts[0]) === '{"op":"status","id":"1"}'));
  check('…the panel hands the app its Alert style when it opens', await fresh.evaluate(() => JSON.stringify(window.__parkPosts.find((m) => m.level)) === '{"op":"status","id":"2","level":"normal","voice":"cheeky"}'));
  check('…no car saved, no car on the map', !(await fresh.$('.car-pin')));
  await fresh.$eval('.ap-auto', (d) => d.scrollIntoView({ block: 'center' }));
  await shot(fresh, '10-app-autopark-setup');
  await tap(fresh, '#apShortcuts');
  await sleep(200);
  check('Open Shortcuts: asks for what isn\'t decided yet (prepare, with the style), then opens Shortcuts', await fresh.evaluate(() => window.__parkPosts.slice(-2).map((m) => m.op).join() === 'prepare,shortcuts' && window.__parkPosts.at(-2).level === 'normal'));
  await fresh.evaluate(() => { window.__parkStatus.notifications = 'denied'; });
  await tap(fresh, '#apShortcuts');
  await sleep(200);
  check('…notifications off for CURB: says so instead of opening Shortcuts', (await toast(fresh)).startsWith('Notifications are off for CURB') && await fresh.evaluate(() => window.__parkPosts.at(-1).op === 'prepare'));
  await fresh.close();
  const older = await openPage(7, ctl, { autoPark: null, ua: IPHONE(26) });
  await openPanel(older);
  const steps26 = await text(older, '.ap-auto ol');
  check('…iOS 26 and earlier: the Automation tab, Disconnects, Run Immediately', steps26.startsWith('Open Shortcuts, tap Automation, then +.')
    && steps26.includes('Bluetooth and choose your car') && steps26.includes('Disconnects and Run Immediately'), steps26);
  await older.close();

  const r = row('7735000', 'West');
  const car = { corridor: r.corridor, limits: r.limits, blockside: 'West', cnn: r.cnn, sideKey: r.cnnrightleft, nextSweepISO: new Date(Date.now() + 864e5).toISOString(),
    url: '/b/7735000?side=West', covered: false, savedAt: Date.now() - 60e3 };
  const parked = await openPage(7, ctl, { autoPark: car });
  await parked.waitForSelector('.car-pin', { timeout: 8000 }).catch(() => {});
  const pin = await parked.evaluate(async () => {
    const m = CAR.marker && CAR.marker.getLatLng(); if (!m) return null;
    drawSegments(await carRows('7735000'));   // the curb sides as the map draws them
    const side = (k) => segCacheAll.find((x) => x.group.cnn === '7735000' && x.side.blockside === k).side.latlngs;
    const w = side('West');
    const deg = parseFloat(CAR.marker.getElement().querySelector('svg').style.getPropertyValue('--deg'));
    return { west: map.distance(m, lineMid(w).at), east: map.distance(m, lineMid(side('East')).at), ends: Math.min(map.distance(m, w[0]), map.distance(m, w.at(-1))), title: CAR.marker.getElement().title,
      deg, turn: ((deg - lineMid(w).deg) % 360 + 360) % 360 };
  });
  check('the app\'s saved car: a little car on the map at launch, halfway along its curb side (West, not East, not an end)',
    !!pin && pin.west < 0.5 && pin.east > 5 && pin.ends > 50 && pin.title === 'Where you parked: Kansas St', JSON.stringify(pin));
  check('…parked along the curb with traffic: West is the line\'s left side here (L), so the car faces against the way the line runs',
    !!pin && Math.abs(pin.turn - 180) < 1, JSON.stringify(pin));
  await shot(parked, '12-app-car-on-map');
  await parked.evaluate(() => CAR.marker.fire('click'));
  await parked.waitForFunction(() => document.getElementById('sheet').classList.contains('open') && sheetSpot && sheetSpot.cnn === '7735000', { timeout: 8000 }).catch(() => {});
  check('…a tap on the car opens its side', await parked.evaluate(() => !!sheetSpot && sheetSpot.cnn === '7735000' && sheetSpot.sideKey === 'West'));
  let cp = await carPick(parked);
  check('…its sheet has the "Your car" row: five cars, the bold red D pressed and on the map', cp.shown && cp.n === 5 && cp.pressed === 'd' && cp.body === 'var(--sign-red)' && !cp.big, JSON.stringify(cp));
  await tap(parked, '#carPick [data-v="e"]');
  cp = await carPick(parked);
  check('…picking E: the car on the map turns bold blue and bigger, E pressed, kept on this device', cp.shown && cp.pressed === 'e' && cp.body === 'var(--disc-blue)' && cp.big && cp.saved === 'e', JSON.stringify(cp));
  await shot(parked, '14-pick-your-car');
  await parked.evaluate(() => openSheet(segCacheAll.find((x) => x.group.cnn === '7735000' && x.side.blockside === 'East').group, 'East'));
  check('…the other side\'s sheet has no "Your car" row', !(await carPick(parked)).shown);
  await parked.evaluate(() => openSheet(segCacheAll.find((x) => x.group.cnn === '7735000' && x.side.blockside === 'West').group, 'West'));
  await parked.evaluate(() => localStorage.removeItem('curbCarStyle'));
  await openPanel(parked);
  check('auto-park, a saved spot: its row like a curb\'s (the side, its next sweep from the page\'s schedule, when it pings, when it was saved)',
    (await text(parked, '.ap-car .ap-nm')) === '🚗 Kansas St, West side' && (await text(parked, '.ap-car .ap-next')).startsWith('Next sweep')
    && (await texts(parked, '.ap-car .ap-ping')).some((t) => t.startsWith('Pings you')) && (await texts(parked, '.ap-car .ap-ping')).some((t) => t.startsWith('Saved today')),
    (await texts(parked, '.ap-car div')).join(' | '));
  check('…the steps fold under "How auto-save works"', (await text(parked, '.ap-auto summary')) === 'How auto-save works ▸' && !(await parked.$eval('.ap-auto', (d) => d.open)));
  await parked.$eval('.ap-car', (d) => d.scrollIntoView({ block: 'center' }));
  await shot(parked, '11-app-autopark-car');
  await tap(parked, '#alertsPanel [data-k="curbAlertLevel"] [data-v="intense"]');
  await sleep(900);
  check('a style change goes to the app for the car\'s next park', await parked.evaluate(() => { const m = window.__parkPosts.at(-1); return m.op === 'status' && m.level === 'intense' && m.voice === 'cheeky'; }));
  await tap(parked, '#apCarClear');
  await sleep(300);
  check('Clear: the app forgets the spot (clear), the row goes, and it says so', await parked.evaluate(() => window.__parkPosts.some((m) => m.op === 'clear')) && !(await parked.$('.ap-car'))
    && (await toast(parked)) === 'Parking spot cleared.' && await parked.$eval('.ap-auto', (d) => d.open));
  check('…and the car leaves the map', !(await parked.$('.car-pin')) && await parked.evaluate(() => !CAR.marker));
  await closePanel(parked);
  await parked.evaluate((c) => { window.__parkStatus.car = c; document.dispatchEvent(new Event('visibilitychange')); }, car);   // parked again while the page slept
  await parked.waitForSelector('.car-pin', { timeout: 8000 }).catch(() => {});
  check('parked again while the page slept: back on the page, the car is on the map', !!(await parked.$('.car-pin')));
  await openPanel(parked);
  await tap(parked, '#apCarShow');
  await parked.waitForFunction(() => document.getElementById('sheet').classList.contains('open') && sheetSpot && sheetSpot.cnn === '7735000', { timeout: 8000 }).catch(() => {});
  check('Show on map: the panel closes and the car\'s side opens', !(await isOpen(parked)) && await parked.evaluate(() => !!sheetSpot && sheetSpot.cnn === '7735000' && sheetSpot.sideKey === 'West'));
  await parked.close();

  // ---------------- a "Share where I parked" link, and the sheet's share buttons (web) ----------------
  const linked = await openPage(false, ctl, { path: '/?b=7735000&side=West&car=1' });
  await linked.waitForFunction(() => document.getElementById('sheet').classList.contains('open') && sheetSpot && sheetSpot.cnn === '7735000', { timeout: 10000 }).catch(() => {});
  await linked.waitForSelector('.car-pin', { timeout: 8000 }).catch(() => {});
  const lpin = await linked.evaluate(() => { const m = CAR.marker && CAR.marker.getLatLng(), o = segCacheAll.find((x) => x.group.cnn === '7735000' && x.side.blockside === 'West');
    return m && o ? map.distance(m, lineMid(o.side.latlngs).at) : -1; });
  check('a Share where I parked link: its side\'s sheet opens with the little car on that side', lpin >= 0 && lpin < 0.5 && await linked.evaluate(() => sheetSpot.sideKey === 'West'), String(lpin));
  cp = await carPick(linked);
  check('…a link sent before the car styles (&car=1) shows the bold red D, with the "Your car" row on that sheet', cp.shown && cp.pressed === 'd' && cp.body === 'var(--sign-red)', JSON.stringify(cp));
  await shot(linked, '13-shared-car-link');
  await linked.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared = d; } }); });
  await tap(linked, '#parkShareBtn');
  await sleep(100);
  const ps = await linked.evaluate(() => window.__shared);
  check('Share where I parked: the side, its next sweep, and a link that opens it with the car',
    !!ps && /^I parked on Kansas St \(16th St to 17th St\), West side\. Next sweep \w{3} \d+\/\d+, 9AM to 11AM\.$/.test(ps.text)
    && ps.url === new URL(BASE).origin + '/?b=7735000&side=West&car=d', JSON.stringify(ps));
  await tap(linked, '#shareBtn');
  await sleep(100);
  const bs = await linked.evaluate(() => window.__shared);
  check('…Share this block still sends the block\'s rules and its /b/ link', !!bs && bs.url.endsWith('/b/7735000?side=West') && bs.text.startsWith('Kansas St (16th St to 17th St): sweeps '), JSON.stringify(bs));
  await linked.close();
  const blue = await openPage(false, ctl, { path: '/?b=7735000&side=West&car=c' });
  await blue.waitForSelector('.car-pin', { timeout: 8000 }).catch(() => {});
  await blue.waitForFunction(() => { const el = document.getElementById('carPick'); return el && !el.hidden; }, { timeout: 8000 }).catch(() => {});
  cp = await carPick(blue);
  check('a link from someone who picked C shows their bold blue car', cp.shown && cp.pressed === 'c' && cp.body === 'var(--disc-blue)' && !cp.big, JSON.stringify(cp));
  await blue.close();

  // ---------------- iPhone Safari (not the app, not installed) ----------------
  const ios = await openPage(false, ctl, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' });
  await openPanel(ios);
  check('iPhone Safari: alerts need the app, with the App Store link', (await text(ios, '.ap-warn b')).startsWith('Alerts need the app') && (await ios.$eval('.ap-warn a.ios-get', (a) => a.href)).includes('apps.apple.com/app/id6780998238'));
  check('…and no test button (it could only open the install hint, under the panel)', !(await ios.$('#apTest')));
  check('…and no Android beta line', !(await ios.$('#apPlay')));
  await ios.close();

  // ---------------- Android Chrome, and the Android app ----------------
  const ANDROID = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  const droid = await openPage(false, ctl, { ua: ANDROID });
  await seed(droid, row('7735000', 'West'), row('5910000', 'South'));
  await openPanel(droid);
  check('Android Chrome: a line under the help to the Play beta (/android)', (await text(droid, '#apPlay')) === 'Prefer an app? CURB for Android is in beta. Join the test →'
    && await droid.$eval('#apPlay', (a) => new URL(a.href).pathname === '/android' && a.previousElementSibling.classList.contains('ap-help')));
  await droid.$eval('#apPlay', (a) => a.scrollIntoView({ block: 'end' }));
  await shot(droid, '9-android-beta-line');
  await droid.close();
  const twa = await openPage(false, ctl, { ua: ANDROID, androidApp: true });
  await openPanel(twa);
  check('…but not inside the Android app (it is the beta)', await twa.evaluate(() => window.__curbAndroidApp === true) && !(await twa.$('#apPlay')) && !!(await twa.$('.ap-help')));
  await twa.close();
} catch (e) {
  check('run', false, e.stack || e.message);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
