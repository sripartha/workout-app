/* Lift Log service worker.
 * - index.html, app.js, styles.css: NETWORK-FIRST (cache: 'no-cache'), cached copy if offline/slow → updates arrive on the next launch.
 * - other shell files (icons, manifest): cache-first.
 * - catalog.json: network-only (never cached) so machine updates reach the phone.
 * - A new worker waits until the user taps "Update ready" (SKIP_WAITING message), so nothing reloads mid-set.
 * Registered with updateViaCache: 'none' so the browser always re-checks this file. Data lives in IndexedDB/localStorage, never here. */
const VERSION = 'liftlog-v2.5.9';
const SHELL = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
const NET_FIRST = /\/(index\.html|app\.js|styles\.css|sw\.js)?$/i; // "/" (start URL) counts as index.html

self.addEventListener('install', e => {
  // cache: 'reload' bypasses the HTTP cache so the new worker never precaches a stale app.js
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  // First install has nothing to replace → activate now. Replacing a pre-2.5.2 (cache-first) worker → also activate now,
  // because those pages can't send SKIP_WAITING. Otherwise wait for the user's "Update ready" tap.
  e.waitUntil(caches.keys().then(keys => {
    const legacy = keys.some(k => { const m = /^liftlog-v(\d+)\.(\d+)\.(\d+)$/.exec(k); return m && (+m[1] * 1e6 + +m[2] * 1e3 + +m[3]) < 2005002; });
    if (!self.registration.active || legacy) return self.skipWaiting();
  }));
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function networkFirst(req, cacheKey) {
  return new Promise(resolve => {
    let done = false;
    const fallback = () => caches.match(cacheKey, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'));
    const timer = setTimeout(() => { fallback().then(hit => { if (hit && !done) { done = true; resolve(hit); } }); }, 4000); // weak gym signal: don't hang
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(cacheKey, copy)); }
      clearTimeout(timer); if (!done) { done = true; resolve(res); }
    }).catch(() => { clearTimeout(timer); fallback().then(hit => { if (!done) { done = true; resolve(hit || Response.error()); } }); });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // sync calls etc. go straight to network
  if (/\/catalog\.json$/i.test(url.pathname)) {
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(() => new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  if (req.mode === 'navigate') { e.respondWith(networkFirst(new Request(url.pathname.endsWith('/') ? url.pathname + 'index.html' : req.url), 'index.html')); return; }
  if (NET_FIRST.test(url.pathname)) { const name = url.pathname.split('/').pop() || 'index.html'; e.respondWith(networkFirst(req, name)); return; }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  })));
});
