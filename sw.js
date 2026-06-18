const CACHE = '868vibez-v1';
const ASSETS = [
  './home.html',
  './', './index.html', './style.css', './app.js', './manifest.json',
  './icons/icon-192.svg', './icons/icon-512.svg',
  './phase5.css', './phase5.js',
  './phase6.css', './phase6-engine.js',
  './phase7.css', './phase7-engine.js',
  './phase8.css', './phase8-engine.js',
  './phase9.css', './phase9-engine.js',
  './audio-analysis.worker.js', './scanner.worker.js',
  './release/release-hardening.css', './release/release-hardening.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(r => r || fetch(event.request).catch(() => caches.match('./index.html')))
  );
});
