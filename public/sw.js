// Noéé : service worker. L'interface marche hors ligne, les données restent à jour.
const VERSION = 'noee-v4';
const BASE = new URL('./', self.location).pathname;
const COQUILLE = [
  '', 'vendre/', 'division/', 'admin/', 'installer/',
  'assets/css/noee.css',
  'assets/js/config.js', 'assets/js/ui.js', 'assets/js/api.js', 'assets/js/dvf-core.js', 'assets/js/estimate.js',
  'assets/js/division-calc.js', 'assets/js/croquis.js', 'assets/js/programme.js', 'assets/js/leads.js', 'assets/js/page-vendre.js', 'assets/js/page-division.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/turf.min.js',
  'vendor/fonts/archivo-latin-wdth-normal.woff2', 'icons/icon-192.png',
].map((p) => BASE + p);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // API publiques et tuiles : réseau direct
  const statique = url.pathname.includes('/vendor/') || url.pathname.includes('/icons/');
  if (statique) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { const cp = res.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); return res; })));
    return;
  }
  // Pages, scripts et données : réseau d'abord, cache si hors ligne
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const cp = res.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match(BASE)))
  );
});
