// Baton service worker: app-shell cache + web push.
const CACHE = 'baton-v10';
const SHELL = ['/', '/style.css?v=8', '/app.js?v=10', '/theme.js?v=3', '/palettes.css?v=1', '/studio.css?v=3', '/studio.js?v=3', '/vendor/marked.js', '/vendor/purify.js', '/icon.svg', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // network-first so updates land immediately; fall back to cache offline
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Baton', body: e.data?.text() }; }
  e.waitUntil((async () => {
    // A focused desktop Baton tab shows its own bottom-right card — skip the duplicate OS notification.
    if (await focusedTabShowsCards()) return;
    await self.registration.showNotification(d.title || 'Baton', {
      body: d.body || '',
      tag: d.tag,
      renotify: Boolean(d.tag),
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: d.url || '/#/' },
    });
  })());
});

async function focusedTabShowsCards() {
  const all = await self.clients.matchAll({ type: 'window' });
  const tab = all.find((c) => c.focused && c.visibilityState === 'visible');
  if (!tab) return false;
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 400);
    ch.port1.onmessage = (m) => { clearTimeout(timer); resolve(Boolean(m.data?.cards)); };
    tab.postMessage({ type: 'desk-cards?' }, [ch.port2]);
  });
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/#/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        await c.focus();
        c.postMessage({ type: 'navigate', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
