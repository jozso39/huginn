// Huginn's service worker. It caches nothing on purpose — an inbox must always show
// what is live — and passes page loads through to the network. It exists so the app
// is installable and so Important items can arrive as notifications (Web Push).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request));
  }
});

// The server sends { title, body, url, tag, badge } (see PushMessage on the server).
self.addEventListener('push', (event) => {
  const message = event.data ? event.data.json() : {};
  const badge = Number(message.badge ?? 0);
  const shown = self.registration.showNotification(message.title || 'Huginn', {
    body: message.body || '',
    tag: message.tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: message.url || '/' },
  });
  const counted =
    'setAppBadge' in self.navigator && badge > 0
      ? self.navigator.setAppBadge(badge).catch(() => undefined)
      : Promise.resolve();

  // iOS revokes push for a worker that receives one without showing a notification.
  event.waitUntil(Promise.all([shown, counted]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.location.origin));

      if (open) {
        return open.focus().then((client) => client.navigate(url));
      }

      return self.clients.openWindow(url);
    })
  );
});
