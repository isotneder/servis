const CACHE_NAME = "alpozler-servis-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./driver.html",
  "./styles.css",
  "./config.js",
  "./app.js",
  "./driver.js",
  "./logo.png",
  "./favicon-32.png",
  "./favicon-16.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./manifest.json",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(event.request);
        const destination = event.request.destination;
        if (
          destination === "document" ||
          destination === "script" ||
          destination === "style" ||
          destination === "image" ||
          reqUrl.pathname.endsWith(".webmanifest")
        ) {
          cache.put(event.request, fresh.clone());
        }
        return fresh;
      } catch (error) {
        const cached = await cache.match(event.request, { ignoreSearch: true });
        if (cached) return cached;

        if (event.request.mode === "navigate") {
          const fallback = await cache.match("./index.html");
          if (fallback) return fallback;
        }
        throw error;
      }
    })()
  );
});
