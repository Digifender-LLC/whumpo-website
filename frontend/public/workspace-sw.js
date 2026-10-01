// Cache only this fixed public offline screen. Auth, APIs, app HTML and bundles stay on the network.
const CACHE_PREFIX = 'whumpo-dashboard-offline-';
const CACHE = CACHE_PREFIX + '__OFFLINE_VERSION__';
// Cloudflare canonicalizes HTML files to extensionless URLs; install refuses redirects.
const OFFLINE = '/pwa/offline';
const ASSETS = new Map([
  [OFFLINE, 'text/html'],
  ['/pwa/offline.css', 'text/css'],
  ['/pwa/offline.js', 'javascript'],
  ['/brand/whumpo-mark-96.png', 'image/png'],
]);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const responses = await Promise.all([...ASSETS].map(async ([path, type]) => {
      const response = await fetch(new Request(new URL(path, self.location.origin), {cache: 'reload', credentials: 'omit'}));
      if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes(type)) throw Error('Offline screen unavailable');
      return [path, response];
    }));
    const cache = await caches.open(CACHE);
    await Promise.all(responses.map(([path, response]) => cache.put(path, response)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    // Only future requests are controlled; never reload the page or discard an active draft.
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const workspace = url.pathname === '/workspace' || url.pathname.startsWith('/workspace/');
  if (request.mode === 'navigate' && workspace) {
    event.respondWith(fetch(request).catch(async () => {
      const saved = await (await caches.open(CACHE)).match(OFFLINE);
      return saved || new Response('Whumpo needs a connection. Reconnect and try again.', {status: 503, headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'}});
    }));
  } else if (!url.search && ASSETS.has(url.pathname)) {
    event.respondWith((async () => (await (await caches.open(CACHE)).match(url.pathname)) || fetch(request))());
  }
});
