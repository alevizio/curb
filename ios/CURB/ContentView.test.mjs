// Tests for the JavaScript bridge the iOS app injects into curb.guide (the WKUserScripts in ContentView.swift):
// the geolocation/permissions shim and the push bridge, run in a bare VM with a fake window.webkit.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { userScripts } from '../user-scripts.mjs';

const SWIFT = readFileSync(new URL('./ContentView.swift', import.meta.url), 'utf8');
const PLIST = readFileSync(new URL('./Info.plist', import.meta.url), 'utf8');
const JS = userScripts(SWIFT);

// A page-like global: window === globalThis, plus the native message handlers the scripts talk to.
function page({ curbLocOK = false } = {}) {
  const posted = { curbLocation: [], curbPush: [] };
  const store = curbLocOK ? { curbLocOK: '1' } : {};
  const g = {
    navigator: { permissions: { query: async (d) => ({ name: d.name, state: 'webview-own' }) } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    webkit: { messageHandlers: {
      curbLocation: { postMessage: (m) => posted.curbLocation.push(m) },
      curbPush: { postMessage: (m) => posted.curbPush.push(m) },
    } },
    setTimeout, clearTimeout, console,
  };
  g.window = g;
  vm.createContext(g);
  return { g, posted, run: (src) => vm.runInContext(src, g) };
}

afterEach(() => { vi.useRealTimers(); });

describe('geolocation shim (nativeLocationScript)', () => {
  it('extracts the injected scripts from ContentView.swift', () => {
    expect(Object.keys(JS)).toEqual(expect.arrayContaining(['nativeLocationScript', 'appChromeScript', 'pushScript']));
  });

  it('answers permissions.query with the native status, not a stale curbLocOK grant', async () => {
    // curbLocOK=1 is left behind by any past success, including an Allow Once that has since lapsed.
    const { g, posted, run } = page({ curbLocOK: true });
    run(JS.nativeLocationScript);
    const q = g.navigator.permissions.query({ name: 'geolocation' });
    expect(posted.curbLocation).toEqual([{ type: 'status' }]);
    g.__curbNativeGeoStatus('prompt');
    expect((await q).state).toBe('prompt');
  });

  it('reports granted / denied when native says so', async () => {
    const { g, run } = page();
    run(JS.nativeLocationScript);
    for (const state of ['granted', 'denied']) {
      const q = g.navigator.permissions.query({ name: 'geolocation' });
      g.__curbNativeGeoStatus(state);
      expect((await q).state).toBe(state);
    }
  });

  it('falls back to the last known state if native never answers (launch auto-locate must not hang)', async () => {
    vi.useFakeTimers();
    const { g, run } = page({ curbLocOK: true });
    run(JS.nativeLocationScript);
    const q = g.navigator.permissions.query({ name: 'geolocation' });
    vi.advanceTimersByTime(1000);
    expect((await q).state).toBe('prompt');
  });

  it('leaves non-geolocation queries to the WebView', async () => {
    const { g, run } = page();
    run(JS.nativeLocationScript);
    expect((await g.navigator.permissions.query({ name: 'camera' })).state).toBe('webview-own');
  });

  it('forwards every option to native, including the silent launch flag', () => {
    const { g, posted, run } = page();
    run(JS.nativeLocationScript);
    const opts = { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000, curbSilent: true };
    g.navigator.geolocation.getCurrentPosition(() => {}, () => {}, opts);
    expect(posted.curbLocation).toEqual([{ id: '1', options: opts }]);
  });

  it('relays a fix with its accuracy and the reduced-accuracy flag', () => {
    const { g, run } = page();
    run(JS.nativeLocationScript);
    const ok = vi.fn();
    g.navigator.geolocation.getCurrentPosition(ok, () => {}, {});
    g.__curbNativeLocationResult('1', { ok: true, latitude: 37.76, longitude: -122.41, accuracy: 4800, reduced: true, timestamp: 1 });
    expect(ok).toHaveBeenCalledOnce();
    const p = ok.mock.calls[0][0];
    expect(p.coords).toMatchObject({ latitude: 37.76, longitude: -122.41, accuracy: 4800 });
    expect(p.curbReduced).toBe(true);
  });

  it('relays errors with their code and native message', () => {
    const { g, run } = page();
    run(JS.nativeLocationScript);
    const err = vi.fn();
    g.navigator.geolocation.getCurrentPosition(() => {}, err, {});
    g.__curbNativeLocationResult('1', { ok: false, code: 3, message: 'Location timed out.' });
    expect(err.mock.calls[0][0]).toMatchObject({ code: 3, message: 'Location timed out.', TIMEOUT: 3 });
  });

  it('a success / a denial update the fallback permission state', async () => {
    vi.useFakeTimers();
    const { g, run } = page();
    run(JS.nativeLocationScript);
    const state = async () => { const q = g.navigator.permissions.query({ name: 'geolocation' }); vi.advanceTimersByTime(1000); return (await q).state; };
    g.navigator.geolocation.getCurrentPosition(() => {}, () => {}, {});
    g.__curbNativeLocationResult('1', { ok: true, latitude: 1, longitude: 2, accuracy: 5 });
    expect(await state()).toBe('granted');
    g.navigator.geolocation.getCurrentPosition(() => {}, () => {}, {});
    g.__curbNativeLocationResult('2', { ok: false, code: 1, message: 'off' });
    expect(await state()).toBe('denied');
  });
});

describe('app chrome script', () => {
  it('no longer overrides the page\'s locate-failure copy', () => {
    // It used to swap window.locateFail for a blanket "allow CURB in Settings" toast on every failure.
    expect(JS.appChromeScript).not.toMatch(/locateFail/);
  });
});

describe('push bridge (pushScript)', () => {
  it('keeps the legacy boolean contract for __curbRequestPush', async () => {
    const { g, posted, run } = page();
    run(JS.pushScript);
    const spot = { corridor: 'Valencia St' };
    const a = g.__curbRequestPush(spot);
    expect(posted.curbPush).toEqual([{ spot }]);
    g.__curbNativePushResult({ ok: false, status: 429, message: 'slow down', reason: 'save-failed' });
    expect(await a).toBe(false);
    const b = g.__curbRequestPush(spot);
    g.__curbNativePushResult({ ok: true, status: 200, message: 'saved', reason: 'saved' });
    expect(await b).toBe(true);
  });

  it('__curbRequestPushDetail resolves {ok, status, message, reason} so a failed save is not a permission problem', async () => {
    const { g, run } = page();
    run(JS.pushScript);
    const r = g.__curbRequestPushDetail({ corridor: 'Valencia St' });
    g.__curbNativePushResult({ ok: false, status: 503, message: 'store not configured', reason: 'save-failed' });
    expect(await r).toEqual({ ok: false, status: 503, message: 'store not configured', reason: 'save-failed' });
  });

  it('never leaves the promise hanging on an empty native result', async () => {
    const { g, run } = page();
    run(JS.pushScript);
    const r = g.__curbRequestPushDetail(null);
    g.__curbNativePushResult();
    expect(await r).toMatchObject({ ok: false });
  });
});

describe('Info.plist', () => {
  it('declares the purpose string the temporary precise-location request names', () => {
    // A purpose key missing from NSLocationTemporaryUsageDescriptionDictionary means iOS silently never shows the sheet.
    const key = SWIFT.match(/precisePurposeKey = "(\w+)"/)[1];
    const dict = PLIST.match(/<key>NSLocationTemporaryUsageDescriptionDictionary<\/key>\s*<dict>([\s\S]*?)<\/dict>/)[1];
    expect(dict).toMatch(new RegExp(`<key>${key}</key>\\s*<string>[^<]{20,}</string>`));
  });
});
