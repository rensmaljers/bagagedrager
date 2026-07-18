// Service worker: push-notificaties + offline app-shell.
// Vite hasht alle assets (immutable) — cache-first op /assets/ is daarom veilig
// zonder precache-manifest. Navigaties: network-first met cache-fallback, zodat
// de app offline (of op flaky koers-wifi) gewoon opent met de laatste shell.
const SHELL_CACHE = 'bagagedrager-shell-v1';
const ASSET_CACHE = 'bagagedrager-assets-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.add('/').catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, ASSET_CACHE];
    for (const key of await caches.keys()) {
      if (!keep.includes(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Oude gehashte bundles stapelen zich anders eeuwig op (elke deploy nieuwe hashes).
// Cap alleen /assets/ — fontbestanden hebben vaste namen en blijven in gebruik.
// Cache.keys() is insertion-order, dus de oudste (= oudste deploy) vliegt er eerst uit;
// de bundles van de huidige versie zijn het laatst toegevoegd en blijven staan.
const MAX_ASSET_ENTRIES = 24;
async function pruneAssets(cache) {
  const keys = await cache.keys();
  const assets = keys.filter((req) => new URL(req.url).pathname.startsWith('/assets/'));
  for (const req of assets.slice(0, Math.max(0, assets.length - MAX_ASSET_ENTRIES))) {
    await cache.delete(req);
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // Gehashte assets: cache-first (immutable)
  if (url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/'))) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) event.waitUntil(cache.put(event.request, res.clone()).then(() => pruneAssets(cache)));
      return res;
    })());
    return;
  }

  // Navigaties: network-first, offline-fallback naar gecachte shell
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch(event.request);
        if (res.ok) cache.put('/', res.clone());
        return res;
      } catch {
        return (await cache.match('/')) || Response.error();
      }
    })());
  }
  // Overige requests (Supabase, PCS-afbeeldingen, fonts): gewoon netwerk
});

self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Bagagedrager', {
      body: data.body || 'Vergeet je keuze niet!',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: { url: data.url || '/' },
      requireInteraction: false,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
