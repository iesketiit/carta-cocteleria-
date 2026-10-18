// Guarda la web en el celular para que abra aunque no haya señal.
// v2: guarda también los archivos de la versión actual al instalarse, y
// cada vez que la página carga con señal guarda esa versión.
const CACHE = '403-barra-v2';

const precache = async () => {
  const c = await caches.open(CACHE);
  await c.addAll(['/', '/manifest.webmanifest', '/icon.svg']);
  try {
    const res = await fetch('/index.html', { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.clone().text();
    await c.put('/index.html', res);
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]);
    if (assets.length) await c.addAll(assets);
  } catch {
    /* sin señal al instalar: se completa en la próxima carga */
  }
};

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(precache());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase y fuentes: red directa
  // Páginas: red primero (máx. 4 s); si no hay señal, la copia guardada.
  if (req.mode === 'navigate') {
    e.respondWith(
      Promise.race([fetch(req), timeout(4000)])
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('/index.html', copy));
          }
          return res;
        })
        .catch(async () => (await caches.match('/index.html')) || (await caches.match('/')) || Response.error())
    );
    return;
  }
  // Archivos de la web: copia guardada primero (y se actualiza en segundo plano).
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || net;
    })
  );
});
