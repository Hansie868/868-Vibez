/**
 * 868 VIBEZ V2 — SERVICE WORKER
 * Offline-first PWA caching
 */
const CACHE = "868vibez-v2-1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./cover.png"
];

// Install — cache all core assets
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate — clear old caches
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache first for assets, network first for streams
self.addEventListener("fetch", e => {
  const url = e.request.url;

  // Never cache radio streams or API calls
  if (url.includes("zeno.fm") || url.includes("icecast") ||
      url.includes("allorigins") || url.includes("family981")) {
    e.respondWith(fetch(e.request).catch(() => new Response("Stream unavailable", {status: 503})));
    return;
  }

  // Cache first for app assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (!resp || resp.status !== 200 || resp.type === "opaque") return resp;
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
