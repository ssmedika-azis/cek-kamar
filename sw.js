const CACHE_NAME = 'cek-kamar-v7.0';
const CORE_ASSETS = [
  './',
  './index.html',
  './app.js?v=8.0',
  './manifest.json',
  './192x192.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
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
  const url = new URL(event.request.url);
  if (url.hostname.includes('supabase.co')) return;

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

// Menerima Background Web Push saat aplikasi ditutup / layar HP terkunci
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Cek Kesiapan Kamar',
    body: 'Ada tugas / pembaruan status kamar baru.',
    url: './',
    tag: 'cek-kamar-push-' + Date.now()
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
      tag: payload.tag,
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [300, 100, 300, 100, 500],
      data: { url: payload.url || './' }
    })
  );
});

// Pesan langsung dari halaman foreground ke Service Worker
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SHOW_ALERT') {
    event.waitUntil(
      self.registration.showNotification(data.title || 'Cek Kesiapan Kamar', {
        body: data.body || '',
        icon: './192x192.png',
        badge: './192x192.png',
        tag: data.tag || 'cek-kamar-alert',
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: [300, 100, 300, 100, 500],
        data: { url: data.url || './' }
      })
    );
  }
});

// Membuka atau memfokuskan tab aplikasi saat notifikasi diketuk
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
