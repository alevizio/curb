// sw.js run in a bare VM with an in-memory Cache Storage: which requests it answers from cache, what the
// install / activate steps keep, and the offline fallback to the app shell.
import { describe, it, expect } from 'vitest';
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
    caches, URL, location: { origin: ORIGIN },
    fetch: async (r) => { fetched.push(key(r)); if (!online) throw new TypeError('Failed to fetch'); return net(key(r)); },
  };
  vm.createContext(g);
  vm.runInContext(SW, g);
  const lifecycle = async (type) => { let p; handlers[type]({ waitUntil: (x) => { p = x; } }); await p; };
  // Resolves to the response the worker answered with, or 'network' when it let the browser handle it.
  const request = async (path, method = 'GET') => {
    let answered = null;
    handlers.fetch({ request: { url: new URL(path, ORIGIN).href, method, mode: 'navigate' }, respondWith: (p) => { answered = p; } });
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

  it('keeps the app shell fast and offline-safe: cache first, refreshed in the background, shell when offline', async () => {
    const w = worker();
    await w.lifecycle('install');
    expect((await w.request('/')).body).toBe('shell /');
    await new Promise((r) => setTimeout(r, 0)); // the background refresh lands
    expect((await w.request('/')).body).toBe('net /');
    w.online = false;
    expect((await w.request('/n/mission')).body).toBe('net /'); // never cached → the shell
  });
});
