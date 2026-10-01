// sw.js run in a bare VM with an in-memory Cache Storage: which requests it answers from cache, what the
// install / activate steps keep, and the offline fallback to the app shell.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://curb.guide';

// Minimal Response / Cache Storage: enough for the handlers, keyed by pathname.
const res = (body, status = 200) => ({ body, status, ok: status >= 200 && status < 300, type: 'basic', clone() { return res(body, status); } });
const key = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname;
function worker({ online = true, net = (path) => res('net ' + path), stores = {} } = {}) {
  const handlers = {}, fetched = [];
  const cacheOf = (name) => (stores[name] ||= new Map());
  const caches = {
    open: async (name) => {
      const m = cacheOf(name);
      return {
        match: async (r) => m.get(key(r)),
        put: async (r, v) => { m.set(key(r), v); },
        addAll: async (list) => { for (const p of list) m.set(key(p), res('shell ' + key(p))); },
      };
    },
    keys: async () => Object.keys(stores),
    delete: async (name) => delete stores[name],
  };
  const g = {
    self: { addEventListener: (t, fn) => { handlers[t] = fn; }, skipWaiting() {}, clients: { claim: async () => {} } },
    caches, URL, location: { origin: ORIGIN }, Response: { error: () => ({ type: 'error', status: 0, ok: false }) },
    setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a),  // late-bound: fake timers apply
    fetch: async (r) => { fetched.push(key(r)); if (!online) throw new TypeError('Failed to fetch'); return net(key(r)); },
  };
  vm.createContext(g);
  vm.runInContext(SW, g);
  const lifecycle = async (type) => { let p; handlers[type]({ waitUntil: (x) => { p = x; } }); await p; };
  // Resolves to the response the worker answered with, or 'network' when it let the browser handle it.
  const request = async (path, method = 'GET', mode = 'navigate') => {
    let answered = null;
    handlers.fetch({ request: { url: new URL(path, ORIGIN).href, method, mode }, respondWith: (p) => { answered = p; }, waitUntil() {} });
    return answered ? await answered : 'network';
  };
  return { stores, fetched, lifecycle, request, set online(v) { online = v; } };
}

describe('sw.js', () => {
  it('leaves /b/ block pages to the network, so "Next sweeps" dates and retired-block 404s are never stale', async () => {
    const w = worker();
    await w.lifecycle('install');
    expect(await w.request('/b/8753101')).toBe('network');
    expect(await w.request('/b/8753101')).toBe('network');
    expect([...Object.values(w.stores)].some((m) => [...m.keys()].some((k) => k.startsWith('/b/')))).toBe(false);
  });

  it('still leaves API, map tiles and non-GETs to the network', async () => {
    const w = worker();
    for (const p of ['/api/config', '/basemap/parchment/15/1/2.png']) expect(await w.request(p)).toBe('network');
    expect(await w.request('/', 'POST')).toBe('network');
  });

  it('activate purges older caches, and with them the /b/ and /n/ pages v3 cached', async () => {
    const stores = { 'curb-v3': new Map([['/b/123', res('Sep 1 page')], ['/n/presidio', res('retired hood')], ['/', res('old shell')]]) };
    const w = worker({ stores });
    await w.lifecycle('install');
    await w.lifecycle('activate');
    expect(Object.keys(stores)).toHaveLength(1);
    expect(Object.keys(stores)[0]).not.toBe('curb-v3');
    expect([...Object.values(stores)[0].keys()]).toEqual(['/', '/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png']);
  });

  it('pages are network first: the first load after a deploy is the new build, the cached shell when offline', async () => {
    const w = worker();
    await w.lifecycle('install');
    expect((await w.request('/')).body).toBe('net /');           // not the 'shell /' cached at install
    w.online = false;
    expect((await w.request('/')).body).toBe('net /');           // offline: the copy the last visit cached
    expect((await w.request('/n/mission')).body).toBe('net /');  // never cached → the shell
    expect((await w.request('/?b=870000')).body).toBe('net /');  // a deep link offline still opens the app
  });

  it('data files are network first too, so a monthly data refresh reaches returning visitors', async () => {
    const w = worker({ stores: { 'curb-v5': new Map([['/data/overview.json', res('old data')]]) } });
    expect((await w.request('/data/overview.json', 'GET', 'cors')).body).toBe('net /data/overview.json');
    w.online = false;
    expect((await w.request('/data/overview.json', 'GET', 'cors')).body).toBe('net /data/overview.json');
  });

  it('a slow network falls back to the cached page after 3 s instead of hanging', async () => {
    vi.useFakeTimers();
    const w = worker({ net: () => new Promise(() => {}), stores: { 'curb-v5': new Map([['/', res('cached /')]]) } });
    const p = w.request('/');
    await vi.advanceTimersByTimeAsync(3000);
    expect((await p).body).toBe('cached /');
  });

  it('icons and scripts stay stale-while-revalidate: cached copy first, refreshed in the background', async () => {
    const w = worker();
    await w.lifecycle('install');
    expect((await w.request('/icons/icon-192.png', 'GET', 'no-cors')).body).toBe('shell /icons/icon-192.png');
    await new Promise((r) => setTimeout(r, 0)); // the background refresh lands
    expect((await w.request('/icons/icon-192.png', 'GET', 'no-cors')).body).toBe('net /icons/icon-192.png');
  });

  it('a script or icon with no cached copy and no network fails cleanly, never the app shell HTML', async () => {
    const w = worker({ online: false });
    await w.lifecycle('install');
    const r = await w.request('/lib/sweep-core.js?v=4', 'GET', 'no-cors');
    expect(r.type).toBe('error');
    expect(r.body).toBeUndefined();
    // a page load offline still gets the cached shell
    expect((await w.request('/', 'GET', 'navigate')).body).toBe('shell /');
  });
});
afterEach(() => { vi.useRealTimers(); });
