// CURB service worker — app-shell cache + Web Push.
const CACHE = 'curb-v1';
const SHELL = ['/', 'index.html', 'manifest.json',
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

// Network-first for same-origin GETs, fall back to cached shell when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return; // let map tiles / DataSF hit network
  e.respondWith(
    fetch(e.request).catch(() =>
      caches.match(e.request).then(r => r || caches.match('/')))
  );
});

// Push payload shape: { title, body, url, tag }
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
    requireInteraction: true,
    data: { url: p.url || '/' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { if (c.navigate) c.navigate(url); return c.focus(); }
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
