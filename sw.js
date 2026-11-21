const CACHE_NAME = 'cek-kamar-v6.8';

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

// v6.8: Pesan dari halaman (aplikasi di latar) → tampilkan notifikasi sistem
// dengan getar + nada default Android, meski AudioContext/suara bicara
// tidak jalan di latar. Renotify = true membuat nada berbunyi ulang tiap pesan.
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type !== 'SHOW_ALERT') return;
  const payload = {
    body: msg.body || '',
    icon: './192x192.png',
    badge: './192x192.png',
    vibrate: msg.vibrate || [300, 120, 300, 120, 300],
    tag: msg.tag || 'bg-alert',
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: { url: msg.url || './' }
  };
  if (event.waitUntil) {
    event.waitUntil(
      self.registration.showNotification(msg.title || 'Notifikasi Cek Kamar', payload).catch(() => {})
    );
  } else {
    self.registration.showNotification(msg.title || 'Notifikasi Cek Kamar', payload).catch(() => {});
  }
});

// v6.8: Web Push — notifikasi masuk walau aplikasi benar-benar tertutup.
// Dipicu oleh Supabase Edge Function saat ada laporan/permintaan baru.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Notifikasi Cek Kamar';
  const options = {
    body: payload.body || 'Ada permintaan kamar baru.',
    icon: './192x192.png',
    badge: './192x192.png',
    vibrate: payload.vibrate || [350, 120, 350, 120, 350],
    tag: payload.tag || 'push-alert',
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: { url: payload.url || './', unitId: payload.unitId || null }
  };
  event.waitUntil(
    self.registration.showNotification(title, options).catch(() => {})
  );
});

// Ketuk notifikasi persistent / push → fokus / buka aplikasi
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => 'focus' in c);
      if (existing) {
        existing.postMessage({ type: 'OPEN_NOTIF', data });
        return existing.focus();
      }
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
