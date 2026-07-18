/* 868 VIBEZ v2 — service worker */
const CACHE = '868vibez2-v1';
const ASSETS = [
  './', './index.html', './styles.css',
  './db.js', './engine.js', './shell.js', './library.js', './player.js', './radio.js', './dj.js',
  './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-192-maskable.png', './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png',
  './icons/splash-cover.jpg', './icons/vinyl-art.jpg',
];
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()).catch(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never intercept cross-origin (radio streams die if proxied) or non-GET
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
