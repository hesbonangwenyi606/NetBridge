const CACHE = 'netbridge-shell-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/tokens.css', '/app.js', '/pwa.js', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('netbridge-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Account and API responses always use the network and never enter the cache.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/v1')) return;
  if (event.request.mode !== 'navigate' && !SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    try { return await fetch(event.request); }
    catch {
      const cache = await caches.open(CACHE);
      const response = await cache.match(event.request.mode === 'navigate' ? '/' : url.pathname);
      return response || Response.error();
    }
  })());
});
