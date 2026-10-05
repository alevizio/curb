// CURB service worker — app-shell cache + Web Push.
// v4: activate purges the /b/ block pages (and retired /n/ slugs, now 301s) that v3 cached and kept serving.
// v5: pages and /data/*.json go network first (see NETWORK_FIRST), so a returning visitor's first load after a
//     deploy or a data refresh is the new one; stale-while-revalidate served the previous build until a 2nd visit.
const CACHE = 'curb-v5';
const NET_TIMEOUT_MS = 3000;  // a slow network falls back to the cached copy after this, and still refreshes it
// The time core rides with the shell: it loads before this worker controls the first visit, so without it a
// single visit left an offline reload with a dead map. Its ?v= must match index.html's tag (sw.test.mjs).
const SHELL = ['/', 'index.html', 'manifest.json', '/lib/sweep-core.js?v=5',
  'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Pages (navigations) and the data files: network first, so a deploy or data refresh shows on the next load;
// the cached copy answers when offline or when the network takes longer than NET_TIMEOUT_MS (and the
// network answer still refreshes the cache). Everything else same-origin (icons, lib, manifest):
// stale-while-revalidate. API routes, /b/ block pages + cross-origin (map tiles / DataSF) always hit the network.
const NETWORK_FIRST = (req, u) => req.mode === 'navigate' || u.pathname.startsWith('/data/');
async function networkFirst(e) {
  const req = e.request, cache = await caches.open(CACHE);
  const fresh = fetch(req).then(resp => {
    if (resp && resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
    return resp;
  });
  fresh.catch(() => {});
  if (e.waitUntil) e.waitUntil(fresh.catch(() => {}));  // a slow answer still lands in the cache
  try {
    return await Promise.race([fresh, new Promise((_, no) => setTimeout(() => no(new Error('slow')), NET_TIMEOUT_MS))]);
  } catch (_) {
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (cached) return cached;
    try { return await fresh; } catch (_) { return (req.mode === 'navigate' && await cache.match('/')) || Response.error(); }
  }
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;   // map tiles / DataSF
  if (u.pathname.startsWith('/api/')) return;  // never cache API (config key, push, share)
  if (u.pathname.startsWith('/basemap/')) return; // map tiles: browser HTTP cache only (no refetch per view)
  if (u.pathname.startsWith('/b/')) return;       // server-rendered: "Next sweeps" dates change daily, a retired block 404s
  if (NETWORK_FIRST(e.request, u)) { e.respondWith(networkFirst(e)); return; }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);
    const fresh = fetch(e.request).then(resp => {
      if (resp && resp.ok && resp.type === 'basic') cache.put(e.request, resp.clone());
      return resp;
    }).catch(() => null);
    // No copy and no network: fail the request. Only a page load falls back to the app shell (networkFirst
    // above); answering a script or an icon with that HTML made a missing file look like a broken one.
    return cached || (await fresh) || Response.error();
  })());
});

// Push payload shape: { title, body, url, tag, requireInteraction? }
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_) { p = { body: e.data && e.data.text() }; }
  const title = p.title || 'Move your car \uD83E\uDDF9';
  const opts = {
    body: p.body || 'Street sweeping starts soon on your block.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: p.tag || 'curb-sweep',
    renotify: true,
    // Only the act-now pushes (lead / tonight) stay on screen until dismissed; a sticky night-before
    // "Sweep day tomorrow" still showing on sweep day read as the wrong day. Tests never stick.
    requireInteraction: p.requireInteraction === true,
    data: { url: p.url || '/' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const base = (e.notification.data && e.notification.data.url) || '/';
  const url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'p=1';  // marker → page fires push_clicked
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { if (c.navigate) c.navigate(url); return c.focus(); }
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
