const CACHE_NAME = 'cek-kamar-ssmedika-v6.5';
const ASSETS = [
  './',
  './index.html',
  './app.js?v=6.5',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => {}))
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
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, clone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SHOW_ALARM_NOTIFICATION') {
    event.waitUntil(
      self.registration.showNotification(data.title || 'Panggilan Kamar SS Medika', {
        body: data.body || 'Ada permintaan layanan kamar yang perlu segera ditangani.',
        icon: 'https://ssmedika.co.id/wp-content/uploads/2023/08/logo-ss-medika.png',
        badge: 'https://ssmedika.co.id/wp-content/uploads/2023/08/logo-ss-medika.png',
        tag: data.tag || 'cek-kamar-alarm',
        renotify: true,
        requireInteraction: true,
        vibrate: [400, 150, 400, 150, 500],
        data: { url: './index.html' }
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
