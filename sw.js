const CACHE = '868vibez-v26';
const ASSETS = [
  './home.html', './', './index.html',
  './app.css', './ui-upgrade.css',
  './engine.js', './app-ui.js', './ui-upgrade.js',
  './phase1.js', './phase2.js', './phase3.js',
  './phase4.js', './phase5.js', './phase6.js',
  './phase7.js', './phase8.js', './phase9.js',
  './phase10.js', './phase11.js', './phase12.js',
  './phase13.js', './phase14.js', './phase15.js',
  './phase16.js', './phase17.js', './phase18.js', './phase19.js',
  './phase20.js', './phase21.js', './phase22.js', './phase23.js',
  './phase24.js', './phase25.js', './phase26.js',
  './analysis-worker.js',
  './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-192-maskable.png', './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png',
  './icons/splash-cover.jpg', './icons/vinyl-art.jpg'
];
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()).catch(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  // Phase 18: never intercept cross-origin requests (live radio streams,
  // archive.org MP3s, sample MP4s). Proxying an infinite icecast stream
  // through respondWith() can stall or kill playback on some devices.
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});
