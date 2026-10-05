// The page's side of the iOS push bridge (index.html: the __curbNativePushResult wrapper, nativePush,
// nativeTest, nativeDenied, reArm) run in a bare VM against BOTH app builds' pushScript: build 7's from
// ContentView.swift (one-object callback + __curbRequestPushDetail) and App Store build 6's (two-argument
// callback + boolean __curbRequestPush), so a future bridge change that the page misreads fails here.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { userScripts } from './user-scripts.mjs';

// An in-memory Upstash for the multi-watch checks at the end (the page's Turn off through the real endpoint).
Object.assign(process.env, { KV_REST_API_URL: 'https://fake.upstash.io', KV_REST_API_TOKEN: 'fake' });
const mem = {};
vi.mock('@upstash/redis', () => ({
  Redis: class {
    async hget(k, f) { return mem[k] && mem[k][f]; }
    async hmget(k, ...fs) { return fs.map((f) => (mem[k] && f in mem[k] ? mem[k][f] : null)); }
    async hset(k, obj) { (mem[k] || (mem[k] = {})); Object.assign(mem[k], obj); }
    async hsetnx(k, f, v) { if (mem[k] && f in mem[k]) return 0; (mem[k] || (mem[k] = {}))[f] = v; return 1; }
    async hexists(k, f) { return mem[k] && f in mem[k] ? 1 : 0; }
    async set() { return 'OK'; }
    async eval(script, [k], [f, expected, next]) { if (!(mem[k] && mem[k][f] === expected)) return 0; mem[k][f] = next; return 1; }
  },
}));
const TOKEN = 'ab'.repeat(32);

const PAGE = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const BUILD7 = userScripts(readFileSync(new URL('./CURB/ContentView.swift', import.meta.url), 'utf8')).pushScript;
// App Store build 6 (1.0.1): pushScript as shipped (git show 54032e4:ios/CURB/ContentView.swift).
const BUILD6 = `(function () {
  if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.curbPush) return;
  window.__curbNativePush = true;
  var resolveFn = null;
  window.__curbNativePushResult = function (ok, msg) {
    if (resolveFn) resolveFn({ ok: ok, message: msg });
    resolveFn = null;
  };
  window.__curbRequestPush = function (spot) {
    return new Promise(function (resolve) {
      resolveFn = resolve;
      window.webkit.messageHandlers.curbPush.postMessage({ spot: spot || null });
    }).then(function (r) { return !!(r && r.ok); });
  };
  window.__curbTestPush = function (opts) {
    window.webkit.messageHandlers.curbPush.postMessage({ test: true, opts: opts || {} });
  };
})();`;

const slice = (from, to) => {
  const a = PAGE.indexOf(from), b = PAGE.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`index.html no longer contains ${JSON.stringify(from)}`);
  return PAGE.slice(a, b + to.length);
};
const BRIDGE = slice("let _nativeMsg=''", 'const nativeDenied=m=>/^denied/.test(m);');
const REARM = slice('let _webQ=Promise.resolve();', '\n}\n');   // the web queue, the Turn-off counter and reArm

// A page with the app's pushScript injected at document start, then the page's own bridge code. Native
// answers each post the way that build's Swift does: build 7 resolve(ok, reason, message ?? reason,
// status) → one object; build 6 resolve(ok, msg) → two arguments.
function app(build) {
  const posts = [], log = [];
  const g = { setTimeout, clearTimeout, console };
  g.window = g;
  g.answer = { reason: 'saved' };
  g.webkit = { messageHandlers: { curbPush: { postMessage(m) {
    posts.push(m); log.push(m.test ? 'post:test' : 'post:save');
    const a = m.test ? { reason: 'test-sent' } : g.answer;
    const ok = a.reason === 'saved' || a.reason === 'test-sent';
    setTimeout(() => {
      log.push('answer:' + a.reason);
      if (build === 7) g.__curbNativePushResult({ ok, reason: a.reason, message: String(a.message ?? a.reason).slice(0, 300), status: a.status || 0 });
      else g.__curbNativePushResult(ok, a.message ?? a.reason);
    }, 5);
  } } } };
  // reArm sends only while its side is on (alertSpotMatches, from the saved-alert helpers): on unless a test says
  g.on = true; g.alertSpotMatches = () => g.on; g.alertId = (s) => String(s.cnn) + '|' + String(s.sideKey || '');
  vm.createContext(g);
  vm.runInContext(build === 7 ? BUILD7 : BUILD6, g);
  vm.runInContext(BRIDGE + '\n' + REARM, g);
  const run = (src) => vm.runInContext(src, g);
  return {
    g, posts, log,
    push: async (answer, spot = { corridor: 'Valencia St' }) => { g.answer = answer; g.spot = spot; return run('nativePush(spot)'); },
    denied: (m) => run('nativeDenied')(m),
    reArm: async (answer) => { g.answer = answer; return run("reArm({corridor:'Valencia St'})"); },
    run,
  };
}

describe('page ↔ push bridge, build 7 (one-object callback)', () => {
  it('uses the detailed contract when the app offers it', async () => {
    const a = app(7);
    expect(typeof a.g.__curbRequestPushDetail).toBe('function');
    const spot = { corridor: 'Valencia St', rules: [{ weekday: 'Tue' }] };
    expect(await a.push({ reason: 'saved' }, spot)).toEqual({ ok: true, message: 'saved' });
    expect(a.posts).toEqual([{ spot }]);
  });

  it('a notification denial is a denial, not "couldn\'t save"', async () => {
    const a = app(7);
    for (const reason of ['denied', 'denied-settings']) {
      const r = await a.push({ reason });
      expect(r).toEqual({ ok: false, message: reason });
      expect(a.denied(r.message)).toBe(true);
      expect(await a.reArm({ reason })).toBe('denied'); // refreshWatch / saveStyleSoon send no report
    }
  });

  it('a failed save keeps its HTTP status and the server\'s words for the report', async () => {
    const a = app(7);
    const r = await a.push({ reason: 'save-failed', status: 429, message: 'slow down' });
    expect(r).toEqual({ ok: false, message: 'save-failed:429 slow down' });
    expect(a.denied(r.message)).toBe(false);
    expect((await a.push({ reason: 'save-failed', status: 503, message: 'store not configured' })).message).toBe('save-failed:503 store not configured');
    expect(await a.reArm({ reason: 'save-failed', status: 429, message: 'slow down' })).toBe('fail:save-failed:429 slow down');
  });

  it('other failures name their reason (and the iOS text when it adds something)', async () => {
    const a = app(7);
    expect((await a.push({ reason: 'registration-failed', message: 'no valid aps-environment' })).message).toBe('registration-failed no valid aps-environment');
    expect((await a.push({ reason: 'timeout' })).message).toBe('timeout');
    expect((await a.push({ reason: 'save-failed', message: 'The Internet connection appears to be offline.' })).message).toBe('save-failed The Internet connection appears to be offline.');
    expect(a.denied((await a.push({ reason: 'save-failed', status: 400, message: 'denied by server' })).message)).toBe(false);
  });

  it('a test tapped mid-save waits for the save\'s answer (the object callback wakes the queue)', async () => {
    const a = app(7);
    a.g.answer = { reason: 'saved' };
    const save = a.run("nativePush({corridor:'Valencia St'})");
    const test = a.run("nativeTest({which:'all'})");
    expect(await save).toEqual({ ok: true, message: 'saved' });
    await test;
    expect(a.log).toEqual(['post:save', 'answer:saved', 'post:test', 'answer:test-sent']);
  });
});

describe('page ↔ push bridge, build 6 (two-argument callback, boolean promise)', () => {
  it('reads the reason from the second argument', async () => {
    const a = app(6);
    expect(a.g.__curbRequestPushDetail).toBeUndefined();
    expect(await a.push({ reason: 'saved' })).toEqual({ ok: true, message: 'saved' });
    for (const reason of ['denied', 'denied-settings']) {
      const r = await a.push({ reason });
      expect(r).toEqual({ ok: false, message: reason });
      expect(a.denied(r.message)).toBe(true);
      expect(await a.reArm({ reason })).toBe('denied');
    }
    const f = await a.push({ reason: 'save-failed' });
    expect(f).toEqual({ ok: false, message: 'save-failed' });
    expect(a.denied(f.message)).toBe(false);
  });
});

// ---- multi-watch (GitHub #11): the page's side of it, with no app update ----
// The shipped app builds the save body itself ({ token, platform, bundleId, spot }) but forwards the
// page's spot object untouched (ContentView.swift: pendingSpot = body["spot"], then "spot": spot), so a
// Turn off can name its side. Each build's bridge carries the page's object; the real endpoint then
// disarms only that side.
const SIDE_OF = slice('const sideOf=', '});');
describe('multi-watch through both bridges, no app update', () => {
  const swiftSrc = readFileSync(new URL('./CURB/ContentView.swift', import.meta.url), 'utf8');
  it('the app still forwards the page\'s spot untouched (the assumption the rest rests on)', () => {
    expect(swiftSrc).toMatch(/pendingSpot = body\["spot"\] as\? \[String: Any\]/);
    expect(swiftSrc).toMatch(/let payload: \[String: Any\] = \["token": hexToken, "platform": "ios", "bundleId": "guide\.curb\.ios", "spot": spot\]/);
  });

  for (const build of [6, 7]) {
    it(`build ${build}: Turn off posts {off:true} plus the side, and the server turns off only that watch`, async () => {
      const a = app(build);
      a.run(SIDE_OF);
      const north = { corridor: 'Crestline Dr', limits: 'Burnett Ave - Parkridge Dr', blockside: 'Northeast', cnn: '4242000', sideKey: 'Northeast' };
      const south = { ...north, blockside: 'Southwest', sideKey: 'Southwest' };
      const rule = { weekday: 'Tue', fromhour: '9', tohour: '11', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' };
      a.g.spot = north;
      expect(await a.run('nativePush({off:true,...sideOf(spot)})')).toEqual({ ok: true, message: 'saved' });
      const posted = a.posts.at(-1);
      expect(posted).toEqual({ spot: { off: true, cnn: '4242000', sideKey: 'Northeast', corridor: 'Crestline Dr', limits: 'Burnett Ave - Parkridge Dr', blockside: 'Northeast' } });

      // …through the real endpoint, the way the app sends it (JSONSerialization round trip)
      for (const k of Object.keys(mem)) delete mem[k];
      const { default: save } = await import('../api/save-ios-subscription.js');
      const send = async (spot) => { const r = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        await save({ method: 'POST', headers: {}, body: JSON.parse(JSON.stringify({ token: TOKEN, platform: 'ios', bundleId: 'guide.curb.ios', spot })) }, r); return r; };
      for (const s of [north, south]) expect((await send({ ...s, nextSweepISO: '2026-10-06T16:00:00.000Z', leadMinutes: 30, rule, rules: [rule] })).code).toBe(200);
      expect((await send(posted.spot)).body).toEqual({ ok: true, off: true });
      const rec = (f) => JSON.parse(mem['curb:apns'][f]);
      expect(rec(TOKEN).spot).toBe(null);                          // Crestline Dr, NE side: off
      expect(rec(TOKEN + '#1').spot.sideKey).toBe('Southwes');     // the SW side: still on
    });
  }
});

// ---- a silent re-arm (daily refresh, a debounced style save) must never undo a Turn off ----
// turnOffAlerts first bumps the side's Turn-off counter, then queues its call; on success it forgets the side.
const TURN_OFF = '_offSeq[alertId(spot)]=offSeq(spot)+1';
const until = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 2)); };
describe('reArm stands down for a Turn off', () => {
  const kansas = { cnn: '7735000', sideKey: 'West', corridor: 'Kansas St' };
  for (const build of [6, 7]) {
    it(`build ${build}: a re-arm queued behind a Turn off is not sent once the side is off`, async () => {
      const a = app(build);
      a.g.spot = kansas; a.g.answer = { reason: 'saved' };
      a.run(TURN_OFF);
      const off = a.run('nativePush({off:true,...spot}).then(r=>{if(r.ok)on=false;return r;})');
      const re = a.run('reArm(spot)');               // the style save's timer firing right after the tap
      expect((await off).ok).toBe(true);
      expect(await re).toBe('off');
      expect(a.posts.map((p) => Boolean(p.spot && p.spot.off))).toEqual([true]);   // only the Turn off reached the app
    });

    it(`build ${build}: a re-arm in flight when Turn off is tapped answers "off", so it is not marked armed`, async () => {
      const a = app(build);
      a.g.spot = kansas; a.g.answer = { reason: 'saved' };
      const re = a.run('reArm(spot)');
      await until(() => a.posts.length === 1);
      a.run(TURN_OFF);
      expect(await re).toBe('off');
      expect(await a.run('reArm(spot)')).toBe('ok');  // no Turn off since: a plain re-arm still lands
    });
  }

  it('web: the Turn off\'s DELETE waits for a re-arm already sent, so it lands last', async () => {
    const calls = [], pending = [];
    const g = { console, setTimeout, Promise };
    g.window = g;
    g.on = true; g.alertSpotMatches = () => g.on; g.alertId = (x) => String(x.cnn) + '|' + String(x.sideKey || '');
    g.pushSupported = () => true;
    g.navigator = { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => ({ toJSON: () => ({ endpoint: 'e' }) }) } }) } };
    g.fetch = (url, o) => { calls.push(o.method); return new Promise((res) => pending.push(() => res({ ok: true, status: 200 }))); };
    vm.createContext(g);
    vm.runInContext(REARM, g);
    g.spot = kansas;
    const re = vm.runInContext('reArm(spot)', g);
    await until(() => calls.length === 1);
    vm.runInContext(TURN_OFF, g);
    const off = vm.runInContext("webQueue(()=>fetch('/api/save-subscription',{method:'DELETE'})).then(()=>{on=false;})", g);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual(['POST']);                 // the DELETE has not gone out while the POST is pending
    pending.shift()();
    expect(await re).toBe('off');                    // overtaken by the Turn off: not marked armed
    await until(() => calls.length === 2);
    expect(calls).toEqual(['POST', 'DELETE']);
    pending.shift()();
    await off;
    expect(await vm.runInContext('reArm(spot)', g)).toBe('off');   // and once off, a late re-arm is not sent
    expect(calls).toEqual(['POST', 'DELETE']);
  });
});

// The saved-alert map in localStorage ('curbAlert'), run against the page's own helpers.
const ALERT_STATE = slice('const WATCH_MAX_AGE=', 'return twin&&a.limits?t+\' (\'+fmtLimits(a.limits)+\')\':t;\n}');
function alertState(initial = {}) {
  const store = { ...initial };
  const g = { console };
  g.window = g;
  g.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  g.fmtLimits = (s) => String(s || '').replace(/\s+-\s+/g, ' to ');
  vm.createContext(g);
  vm.runInContext(ALERT_STATE, g);
  return { g, store, run: (src) => vm.runInContext(src, g) };
}
describe('saved alerts: a map of watched sides', () => {
  const side = (cnn, sideKey, corridor = 'Kansas St', blockside = sideKey) => ({ cnn, sideKey, corridor, limits: '16th St - 17th St', blockside });

  it('migrates the single value from before multi-watch into a one-entry map, still "on"', () => {
    const old = { cnn: '7735000', sideKey: 'West', corridor: 'Kansas St', limits: '16th St - 17th St', blockside: 'West', level: 'normal', voice: 'cheeky', armedAt: Date.now(), v: 2 };
    const s = alertState({ curbAlert: JSON.stringify(old) });
    s.g.spot = side('7735000', 'West');
    expect(s.run('alertSpotMatches(spot)')).toBe(true);
    expect(JSON.parse(s.store.curbAlert)).toEqual({ '7735000|West': old });
  });

  it('remembers several sides, forgets one on its Turn off, and all of them when the browser lost its subscription', () => {
    const s = alertState();
    s.g.a = side('1', 'North'); s.g.b = side('1', 'South'); s.g.c = side('2', 'East', 'Fulton St');
    s.run('rememberAlert(a);rememberAlert(b);rememberAlert(c)');
    expect(s.run('liveAlerts().length')).toBe(3);
    s.run('forgetAlert(b)');
    expect(Object.keys(JSON.parse(s.store.curbAlert))).toEqual(['1|North', '2|East']);
    expect(s.run('alertSpotMatches(a)')).toBe(true);
    s.run('forgetAlert()');
    expect(s.store.curbAlert).toBe(undefined);
  });

  it('is full at MAX_ALERTS (= the server\'s MAX_WATCHES) other sides, never on a side already watched', async () => {
    const { MAX_WATCHES } = await import('../api/_store.js');
    const s = alertState();
    expect(s.run('MAX_ALERTS')).toBe(MAX_WATCHES);
    for (let i = 0; i < MAX_WATCHES; i++) { s.g.x = side(String(i), 'North'); s.run('rememberAlert(x)'); }
    s.g.x = side('99', 'North'); s.g.y = side('0', 'North');
    expect(s.run('otherAlerts(x).full')).toBe(true);
    expect(s.run('otherAlerts(y).full')).toBe(false);          // its own sheet keeps "✓ Alerts on" + Turn off
    s.run('forgetAlert(y)');
    expect(s.run('otherAlerts(x).full')).toBe(false);
  });

  it('labels a watch "Crestline Dr, NE side", adding the cross streets only to tell two blocks apart', () => {
    const s = alertState();
    s.g.list = [side('1', 'Northeast', 'Crestline Dr'), side('2', 'West'), { ...side('3', 'West'), limits: '17th St - Mariposa St' }];
    expect(s.run('list.map(a=>alertLabel(a,list))')).toEqual(['Crestline Dr, NE side', 'Kansas St, West side (16th St to 17th St)', 'Kansas St, West side (17th St to Mariposa St)']);
  });
});
