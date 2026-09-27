// The page's side of the iOS push bridge (index.html: the __curbNativePushResult wrapper, nativePush,
// nativeTest, nativeDenied, reArm) run in a bare VM against BOTH app builds' pushScript: build 7's from
// ContentView.swift (one-object callback + __curbRequestPushDetail) and App Store build 6's (two-argument
// callback + boolean __curbRequestPush), so a future bridge change that the page misreads fails here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { userScripts } from './user-scripts.mjs';

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
const REARM = slice('function reArm(spot){', '\n}\n');

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
