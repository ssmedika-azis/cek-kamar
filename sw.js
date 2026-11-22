const CACHE_NAME = 'cek-kamar-v6.9';
const ASSETS = [
  './',
  './index.html',
  './app.js?v=6.8',
  './manifest.json',
  './192x192.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('supabase.co')) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// Menangani pesan notifikasi dari halaman utama agar tetap bunyi & bergetar saat di luar aplikasi
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SHOW_ALERT') {
    event.waitUntil(
      self.registration.showNotification(data.title || 'Notifikasi Cek Kamar', {
        body: data.body || 'Ada pembaruan tugas kamar.',
        icon: './192x192.png',
        badge: './192x192.png',
        vibrate: [400, 150, 400, 150, 400],
        tag: data.tag || 'cek-kamar-alert',
        renotify: true,
        requireInteraction: true,
        silent: false,
        data: { url: data.url || './' }
      })
    );
  }
});

// Menangani Web Push saat aplikasi tertutup sepenuhnya
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Cek Kesiapan Kamar',
    body: 'Ada tugas / permintaan kamar baru masuk.',
    url: './'
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = Object.assign(payload, parsed);
    }
  } catch (e) {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './192x192.png',
      badge: './192x192.png',
      vibrate: [450, 150, 450, 150, 450],
      tag: 'cek-kamar-push-' + Date.now(),
      renotify: true,
      requireInteraction: true,
      silent: false,
      data: { url: payload.url || './' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
