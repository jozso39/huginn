// Huginn's service worker. It exists so browsers offer "Install app"; it caches
// nothing on purpose — an inbox must always show what is live — and only passes
// page loads through to the network. Push notifications will hang off it later.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request));
  }
});
