/**
 * Fixture service worker. It only serves `/api/service-worker-data` so the
 * capture pipeline observes a genuine `workerStart` resource timing.
 */
const CACHE_NAME = 'payloadra-fixture-v1';
const HANDLED_PATH = '/api/service-worker-data';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== HANDLED_PATH) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached !== undefined) return cached;

      const response = await fetch(event.request);
      const body = await response.clone().text();
      const served = new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-served-by': 'service-worker',
        },
      });
      await cache.put(event.request, served.clone());
      return served;
    })(),
  );
});
