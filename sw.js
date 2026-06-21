const CACHE = '868vibez-v12';
const ASSETS = [
  './home.html', './', './index.html',
  './app.css', './ui-upgrade.css',
  './engine.js', './app-ui.js', './ui-upgrade.js',
  './phase1.js', './phase2.js', './phase3.js',
  './phase4.js', './phase5.js', './phase6.js',
  './phase7.js', './phase8.js', './phase9.js',
  './phase10.js', './phase11.js', './phase12.js',
  './phase13.js', './phase14.js', './phase15.js',
  './phase16.js', './phase17.js',
  './analysis-worker.js',
  './manifest.json',
  './icons/icon-192.svg', './icons/icon-512.svg'
];
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()).catch(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => e.respondWith(
  caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
));
