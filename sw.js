const CACHE_NAME = 'cek-kamar-v6.7';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Strategi network-first: ambil versi terbaru ke jaringan,
  // fallback ke cache hanya saat offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// v6.7: Ketuk notifikasi persistent → fokus / buka aplikasi
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      if (data.url) return self.clients.openWindow(data.url);
    })
  );
});

// Periodic sync (jika browser mendukung): minta halaman cek ulang permintaan
self.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'cek-kamar-sync') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      list.forEach((c) => c.postMessage({ type: 'PERIODIC_RECHECK' }));
    })
  );
});
