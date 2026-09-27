// Headless check of the "Sweep alerts" sheet in index.html, run against a LOCAL static server — never
// production (all /api/save-subscription calls are intercepted and answered here; push is faked).
// Covers: tie-break on the earliest next sweep, the spot's rules[], "✓ Alerts on" keyed on the curb
// (not the sweep instant) + the off switch, the "alerts are on for <other block>" note, legacy-key
// migration, the reverse-ghost guard, debounced/reverted style saves, the night-sweep copy, and the
// native iOS bridge (boolean or {ok,status,message} results, save-failed vs denied, off).
//
//   npx -y serve . -l 3210 &   node scripts/check-alerts-ui.mjs http://localhost:3210
// Needs puppeteer-core (like scripts/monitor/browser.mjs) and Chrome (CHROME_PATH or the default).
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] || 'http://localhost:3210';
const CHROME = process.env.CHROME_PATH
  || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find(existsSync);
let failures = 0;
const check = (name, cond, detail = '') => { if (!cond) failures++; console.log(`${cond ? '✅' : '❌'} ${name}${!cond && detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Installed before any page script. Web: a granted permission + a fake service worker / push
// subscription. Native: the bridge the shipped iOS app injects (ContentView.swift pushScript), with
// window.webkit faked so each message resolves with window.__nativeMode as the app's message.
function installFakes(native) {
  window.__reports = [];
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint', options: {}, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p256', auth: 'auth-secret' } }; } };
  if (native) {
    window.__nativeMode = 'saved'; window.__nativePosts = []; window.__nativeLog = []; window.__nativeDelay = 30;
    window.webkit = { messageHandlers: { curbPush: { postMessage: (m) => {
      window.__nativePosts.push(JSON.parse(JSON.stringify(m))); window.__nativeLog.push('post:' + (m.test ? 'test' : 'save'));
      const [ok, msg] = m.test ? [true, 'test-sent'] : [window.__nativeMode === 'saved', window.__nativeMode];
      setTimeout(() => { window.__nativeLog.push('answer:' + msg); window.__curbNativePushResult(ok, msg); }, window.__nativeDelay);
    } } } };
    (function () {
      if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.curbPush) return;
      window.__curbNativePush = true;
      var resolveFn = null;
      window.__curbNativePushResult = function (ok, msg) { if (resolveFn) resolveFn({ ok: ok, message: msg }); resolveFn = null; };
      window.__curbRequestPush = function (spot) {
        return new Promise(function (resolve) { resolveFn = resolve; window.webkit.messageHandlers.curbPush.postMessage({ spot: spot || null }); })
          .then(function (r) { return !!(r && r.ok); });
      };
      window.__curbTestPush = function (opts) { window.webkit.messageHandlers.curbPush.postMessage({ test: true, opts: opts || {} }); };
    })();
  } else {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    Notification.requestPermission = async () => 'granted';
    const reg = { pushManager: { getSubscription: async () => sub, subscribe: async () => sub } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg), register: async () => reg } });
  }
  try { localStorage.setItem('curbOnboarded', '1'); } catch (_) { /* ignore */ }
}

// Three synthetic blocks, days picked relative to today (SF) so both of A's days are >24h out (same
// rank): A lists its LATER day first, like Kansas St West in DataSF. N is a 2 AM night sweep.
function buildBlocks() {
  const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], t = todaySF();
  const early = D[(t + 3) % 7], late = D[(t + 5) % 7];
  const wk = { week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' };
  const ln = (lng) => ({ type: 'LineString', coordinates: [[lng, 37.765], [lng, 37.764]] });
  const A = { cnn: '7735000', corridor: 'Kansas St', limits: '16th St - 17th St', blockside: 'West', cnnrightleft: 'L', fromhour: '9', tohour: '11', ...wk, line: ln(-122.4035) };
  const B = { cnn: '5910000', corridor: 'Fulton St', limits: '6th Ave - 7th Ave', blockside: 'South', cnnrightleft: 'R', fromhour: '10', tohour: '12', weekday: early, ...wk, line: ln(-122.4635) };
  const N = { cnn: '9130000', corridor: 'Mission St', limits: '20th St - 21st St', blockside: 'East', cnnrightleft: 'R', fromhour: '2', tohour: '4', weekday: early, ...wk, line: ln(-122.4190) };
  drawSegments([{ ...A, weekday: late }, { ...A, weekday: early }, B, N]);
  window.__g = {};
  for (const x of segCache) window.__g[x.group.cnn] = x;
  return { early, late };
}

async function openPage(native, ctl) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  page.__posts = [];
  page.on('pageerror', (e) => check(`no page errors (${native ? 'native' : 'web'})`, false, e.message));
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p === '/api/save-subscription') {
      page.__posts.push({ method: r.method(), body: JSON.parse(r.postData() || '{}') });
      return r.respond({ status: ctl.status, contentType: 'application/json', body: JSON.stringify(ctl.status === 200 ? { ok: true } : { error: 'boom' }) });
    }
    if (p.startsWith('/api/')) return r.respond({ status: 204, body: '' });
    return r.continue();
  });
  await page.evaluateOnNewDocument(installFakes, native);
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => typeof drawSegments === 'function' && typeof segLayer !== 'undefined' && typeof map !== 'undefined', { timeout: 20000 });
  await page.evaluate(() => { window.curbReport = (k, d) => window.__reports.push([k, d]); });
  const days = await page.evaluate(buildBlocks);
  return { page, days };
}
const open = (page, cnn) => page.evaluate((c) => { const x = window.__g[c]; openSheet(x.group, x.side.key); }, cnn);
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => '');
const hidden = (page, sel) => page.$eval(sel, (e) => e.hidden);
const toast = (page) => text(page, '#toast');
const ls = (page, k) => page.evaluate((key) => localStorage.getItem(key), k);
// DOM click: the sheet opens at a 46dvh peek, so the alert controls can sit below the fold.
const tap = (page, sel) => page.$eval(sel, (e) => e.click());

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  // ---------------- web push ----------------
  const ctl = { status: 200 };
  const { page, days } = await openPage(false, ctl);
  await open(page, '7735000');
  check('tie-break: a Tue+Fri side names the EARLIEST next sweep', (await text(page, '.verdict .head')).startsWith(days.early), `head="${await text(page, '.verdict .head')}", want ${days.early}`);
  check('data notes explain night sweeps', (await text(page, '.noted p')).includes('move it tonight'));

  await tap(page, '#alertBtn');
  await page.waitForFunction(() => document.getElementById('alertBtn').textContent.includes('Alerts on'), { timeout: 5000 }).catch(() => {});
  const arm = page.__posts.at(-1)?.body.spot || {};
  check('arming posts every rule of the side + the soonest as `rule`', arm.rules?.length === 2 && arm.rule?.weekday === days.early && arm.cnn === '7735000' && arm.sideKey === 'West', JSON.stringify({ rules: arm.rules?.map((r) => r.weekday), rule: arm.rule?.weekday }));
  check('button reads "✓ Alerts on"', (await text(page, '#alertBtn')) === '✓ Alerts on');
  check('saved-alert key is the curb, not the sweep instant', JSON.parse(await ls(page, 'curbAlert') || '{}').cnn === '7735000' && !(await ls(page, 'curbAlertKey')));

  // Intensity then Voice within the debounce → ONE save carrying both.
  const n0 = page.__posts.length;
  await tap(page, '#alertCfg summary');
  await tap(page, '[data-k="curbAlertLevel"] button[data-v="intense"]');
  await tap(page, '[data-k="curbAlertVoice"] button[data-v="drill"]');
  await sleep(1100);
  const saves = page.__posts.slice(n0);
  check('style taps coalesce into one save with both dials', saves.length === 1 && saves[0].body.spot.level === 'intense' && saves[0].body.spot.voice === 'drill', `${saves.length} saves`);

  // A save that fails snaps the dials back and says so.
  ctl.status = 500;
  await tap(page, '[data-k="curbAlertLevel"] button[data-v="light"]');
  await sleep(1100);
  ctl.status = 200;
  check('failed style save reverts the dial', (await ls(page, 'curbAlertLevel')) === 'intense' && await page.$eval('[data-k="curbAlertLevel"] button[data-v="intense"]', (b) => b.getAttribute('aria-pressed') === 'true'));
  check('…and tells the user + reports it', (await toast(page)).includes("Couldn't save your alert style") && (await page.evaluate(() => window.__reports.some(([k]) => k === 'push-save-failed'))));

  // Another block shows where alerts are; arming it visibly moves them.
  await open(page, '5910000');
  check('other block: note says alerts are on for Kansas St', !(await hidden(page, '#alertNote')) && (await text(page, '#alertNote')).includes('Alerts are on for Kansas St (West)'));
  await tap(page, '#alertBtn');
  await page.waitForFunction(() => document.getElementById('alertBtn').textContent.includes('Alerts on'), { timeout: 5000 }).catch(() => {});
  check('arming it replaces the old block (toast + note gone)', (await toast(page)).includes("Kansas St won't alert anymore") && (await hidden(page, '#alertNote')));

  // "✓ Alerts on" → off switch → DELETE proven by the subscription.
  await tap(page, '#alertBtn');
  check('tapping "✓ Alerts on" offers turn-off', !(await hidden(page, '#alertOff')));
  await tap(page, '#alertOffYes');
  await page.waitForFunction(() => !document.getElementById('alertBtn').textContent.includes('Alerts on'), { timeout: 5000 }).catch(() => {});
  const del = page.__posts.at(-1);
  check('turn-off sends DELETE with the subscription (endpoint + keys)', del.method === 'DELETE' && del.body.subscription?.keys?.auth === 'auth-secret');
  check('…and the sheet reads off', (await text(page, '#alertBtn')).includes('Sweep alerts') && !(await ls(page, 'curbAlert')) && (await toast(page)).includes('Alerts off for Fulton St'));

  // Legacy corridor|limits|blockside|ISO key: still "on", and silently re-armed with the full rules.
  await page.evaluate(() => { localStorage.removeItem('curbAlert'); localStorage.setItem('curbAlertKey', 'Kansas St|16th St - 17th St|West|2026-01-01T00:00:00.000Z'); });
  const n1 = page.__posts.length;
  await open(page, '7735000');
  await sleep(400);
  check('legacy key migrates: button stays "✓ Alerts on"', (await text(page, '#alertBtn')) === '✓ Alerts on');
  check('…and a silent re-arm sends the side\'s rules', page.__posts.slice(n1).some((p) => p.method === 'POST' && p.body.spot.rules?.length === 2));

  // Reverse ghost: past the server's 120-day watch age the button must not claim "on".
  await page.evaluate(() => { const a = JSON.parse(localStorage.getItem('curbAlert')); a.armedAt = Date.now() - 121 * 864e5; localStorage.setItem('curbAlert', JSON.stringify(a)); });
  await open(page, '7735000');
  check('a lapsed watch reads off (no false "on")', (await text(page, '#alertBtn')).includes('Sweep alerts'));

  // Night sweep: no eve/morn anchors, the toast promises the 9 PM push.
  await open(page, '9130000');
  await tap(page, '#alertBtn');
  await page.waitForFunction(() => document.getElementById('alertBtn').textContent.includes('Alerts on'), { timeout: 5000 }).catch(() => {});
  const ns = page.__posts.at(-1).body.spot;
  check('night sweep: spot carries no eve/morning anchors', !ns.eveningISO && !ns.morningISO);
  check('night sweep: toast promises the ~9 PM push', (await toast(page)).includes('~9 PM the night before'));
  await page.close();

  // ---------------- native iOS bridge ----------------
  const nat = await openPage(true, ctl);
  const np = nat.page;
  await open(np, '7735000');
  await np.evaluate(() => { window.__nativeMode = 'save-failed'; });
  await tap(np, '#alertBtn');
  await sleep(400);
  check('iOS save failure: "Couldn\'t save, try again." (not the Settings hint)', (await toast(np)) === "Couldn't save, try again." && (await text(np, '#alertBtn')).includes('Sweep alerts'));
  check('…reported as push-save-failed', await np.evaluate(() => window.__reports.some(([k, d]) => k === 'push-save-failed' && d === 'ios save-failed')));
  await np.evaluate(() => { window.__nativeMode = 'denied-settings'; });
  await tap(np, '#alertBtn');
  await sleep(400);
  check('iOS denied: points at Settings', (await toast(np)).includes('Allow notifications for CURB in Settings'));
  await np.evaluate(() => { window.__nativeMode = 'saved'; });
  await tap(np, '#alertBtn');
  await sleep(400);
  check('iOS saved: "✓ Alerts on" + rules posted through the bridge', (await text(np, '#alertBtn')) === '✓ Alerts on' && (await np.evaluate(() => window.__nativePosts.at(-1).spot.rules.length)) === 2);
  // "Send me a test" right after a style change: the app tracks ONE pending call, so a test posted while
  // the style save is in flight would answer it "test-sent" and drop it. The test must wait its turn.
  await np.evaluate(() => { window.__nativeDelay = 300; window.__nativeLog.length = 0; });
  await tap(np, '[data-k="curbAlertVoice"] button[data-v="deadpan"]');
  await sleep(750); // past the 600 ms style debounce: the save is in flight for 300 ms
  await tap(np, '#testPushBtn');
  await sleep(1000);
  const nlog = await np.evaluate(() => window.__nativeLog.join(' '));
  check('iOS: a test tapped mid-save waits for the save\'s answer', nlog === 'post:save answer:saved post:test answer:test-sent' && (await ls(np, 'curbAlertVoice')) === 'deadpan', nlog);
  await np.evaluate(() => { window.__nativeDelay = 30; });
  await tap(np, '#alertBtn');
  await tap(np, '#alertOffYes');
  await sleep(400);
  check('iOS turn-off posts {spot:{off:true}} through the shipped bridge', await np.evaluate(() => window.__nativePosts.at(-1).spot?.off === true) && (await text(np, '#alertBtn')).includes('Sweep alerts'));
  // A newer app build may resolve an object instead of a boolean.
  await np.evaluate(() => { window.__curbRequestPush = async () => ({ ok: false, status: 429, message: 'save-failed:429' }); });
  await tap(np, '#alertBtn');
  await sleep(300);
  check('iOS {ok,status,message} result is understood', (await toast(np)) === "Couldn't save, try again." && await np.evaluate(() => window.__reports.some(([, d]) => d === 'ios save-failed:429')));
  // A first arm waits on the iOS permission prompt: an answer 25 s later must still count. Page timers
  // >= 1 s run 100x faster here (the app's 25 s → 250 ms vs the page's cap) so the check stays quick.
  await np.evaluate(() => {
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => st(fn, ms >= 1000 ? ms / 100 : ms, ...a);
    window.__curbRequestPush = () => new Promise((resolve) => st(() => resolve(true), 250));
    window.__reports.length = 0;
  });
  await tap(np, '#alertBtn');
  await sleep(900);
  check('iOS: a slow permission prompt (answered after 25 s) still arms, no false failure', (await text(np, '#alertBtn')) === '✓ Alerts on' && await np.evaluate(() => !window.__reports.length));
  await np.close();
} catch (e) {
  check('run', false, e.stack || e.message);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
