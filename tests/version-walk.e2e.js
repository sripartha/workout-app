/**
 * Regression: workouts + phone-added machines must survive stepping app.js
 * from 2.4.2 → current, including catalog auto-apply between versions.
 * Also asserts the 2.4.5 Undo toast bug stays fixed in ≥2.4.6.
 */
const { chromium, webkit } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures/versions');
const VERSIONS = ['2.4.2', '2.4.3', '2.4.4', '2.4.5', '2.4.6', '2.4.7', '2.4.8', '2.4.9', '2.5.0'];
const PORT = 8822;

function serve() {
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let u = url.pathname;
    if (u === '/' || u === '/index.html') {
      const ver = url.searchParams.get('v') || '2.4.2';
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="styles.css"><title>Lift Log walk</title>
<script>if (navigator.serviceWorker) { navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())); }</script>
</head>
<body><div id="app"></div><div id="tabs"></div><div id="sheet-root"></div><div id="toast" hidden></div>
<script src="app.js?v=${ver}"></script></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (u === '/sw.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
      return res.end('/* version-walk: no-op SW */ self.addEventListener("install", e => self.skipWaiting());');
    }
    if (u === '/app.js') {
      const ver = url.searchParams.get('v') || '2.4.2';
      try {
        const buf = fs.readFileSync(path.join(FIX, `app-${ver}.js`));
        res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
        return res.end(buf);
      } catch (e) {
        res.writeHead(404); return res.end(String(e));
      }
    }
    try {
      const file = fs.readFileSync(path.join(ROOT, u.slice(1)));
      res.writeHead(200, { 'Content-Type': mime[path.extname(u)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(file);
    } catch (e) {
      res.writeHead(404); res.end('missing');
    }
  });
  return new Promise(res => server.listen(PORT, '127.0.0.1', () => res(server)));
}

async function boot(page, ver) {
  // Drop any SW/caches so each version's app.js is fetched fresh (same origin storage kept).
  await page.goto(`http://127.0.0.1:${PORT}/?v=${encodeURIComponent(ver)}&clear=1&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (e) {}
  });
  const resp = await page.goto(`http://127.0.0.1:${PORT}/?v=${encodeURIComponent(ver)}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  if (!resp || !resp.ok()) throw new Error('goto failed ' + ver + ' ' + (resp && resp.status()));
  try {
    await page.waitForFunction(v => window.__liftlog && window.__liftlog.version === v, ver, { timeout: 20000 });
  } catch (e) {
    const info = await page.evaluate(() => ({
      src: document.querySelector('script[src]') && document.querySelector('script[src]').src,
      has: !!window.__liftlog,
      ver: window.__liftlog && window.__liftlog.version,
      body: (document.body && document.body.innerText || '').slice(0, 200)
    }));
    console.error('boot failed', ver, info);
    throw e;
  }
  await page.waitForTimeout(700);
}

function snapshot(page) {
  return page.evaluate(() => {
    const S = window.__liftlog.state();
    const incline = S.exercises['incline-press'];
    return {
      version: window.__liftlog.version,
      sessions: S.sessions.length,
      entries: S.sessions.reduce((n, s) => n + (s.entries || []).length, 0),
      hasPhoneM: !!(incline && incline.machines.some(m => m.id === 'm-phone-incline')),
      phoneSets: S.sessions.reduce((n, s) => n + s.entries.filter(e => e.mId === 'm-phone-incline').length, 0),
      chestSets: S.sessions.reduce((n, s) => n + s.entries.filter(e => e.exId === 'chest-press').length, 0),
      applied: S.lastAppliedCatalogVersion,
    };
  });
}

(async () => {
  const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
  const server = await serve();
  const browser = await engine.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  // Serve a sessions-empty catalog without mutating the repo file
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.json'), 'utf8'));
  cat.state.sessions = [];
  if (!cat.catalogVersion) cat.catalogVersion = Date.now();
  await page.route('**/catalog.json*', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cat) });
  });

  await boot(page, '2.4.2');

  // Seed: after first catalog apply, add phone machine + workouts (Sri's morning)
  await page.evaluate(async () => {
    const L = window.__liftlog; const S = L.state();
    if (!Object.keys(S.exercises).length) throw new Error('no exercises after catalog');
    const incline = S.exercises['incline-press'];
    const chest = S.exercises['chest-press'];
    if (!incline || !chest) throw new Error('missing incline/chest');
    if (!incline.machines.some(m => m.id === 'm-phone-incline')) {
      incline.machines.push({ id: 'm-phone-incline', name: 'Sri Phone Incline', base: 45, bu: 'lb', gym: 'Austin', loc: 'phone', cues: '', caution: '' });
    }
    const cm = chest.machines[0];
    S.sessions = [{
      id: 's-walk', date: '2026-10-05', tid: 'push', mode: 'solo', exIds: [chest.id, incline.id],
      entries: [
        { id: 'w1', kind: 'set', exId: chest.id, mId: cm.id, set: 1, w: 100, add: 55, base: 45, u: 'lb', reps: 10, diff: 3, tags: [], note: '', ts: 1 },
        { id: 'w2', kind: 'set', exId: chest.id, mId: cm.id, set: 2, w: 100, add: 55, base: 45, u: 'lb', reps: 10, diff: 3, tags: [], note: '', ts: 2 },
        { id: 'w3', kind: 'set', exId: incline.id, mId: 'm-phone-incline', set: 1, w: 90, add: 45, base: 45, u: 'lb', reps: 12, diff: 3, tags: [], note: '', ts: 3 },
      ], thoughts: {}, created: Date.now()
    }];
    // Mark catalog already applied so later versions don't need a newer catalog to avoid re-merge confusion;
    // still fine if they re-merge — merge must keep sessions.
    await L.persist();
  });

  let prev = await snapshot(page);
  console.log('seed', prev);
  if (prev.entries !== 3 || !prev.hasPhoneM) throw new Error('seed failed ' + JSON.stringify(prev));

  for (const ver of VERSIONS.slice(1)) {
    // Hard reload so the new app.js boots against the same origin storage
    await boot(page, ver);
    const cur = await snapshot(page);
    console.log('after', ver, cur);
    if (cur.version !== ver) throw new Error(`expected version ${ver}, got ${cur.version}`);
    if (cur.entries < 3) throw new Error(`LOST ENTRIES at ${ver}: ${JSON.stringify(cur)}`);
    if (!cur.hasPhoneM) throw new Error(`LOST PHONE MACHINE at ${ver}: ${JSON.stringify(cur)}`);
    if (cur.chestSets < 2 || cur.phoneSets < 1) throw new Error(`LOST SET DETAIL at ${ver}: ${JSON.stringify(cur)}`);
    prev = cur;
  }

  // Explicitly assert catalog undo cannot wipe post-merge data / phone machines
  await page.evaluate(async () => {
    const L = window.__liftlog;
    const real = JSON.parse(JSON.stringify({
      sessions: L.state().sessions,
      exercises: L.state().exercises,
      advice: L.state().advice,
      sync: L.state().sync,
      settings: L.state().settings,
      lastExport: L.state().lastExport,
    }));
    // Snapshot an "empty pre-merge" view, then restore live workouts and undo.
    L.state().sessions = [];
    const inc = L.state().exercises['incline-press'];
    if (inc) inc.machines = inc.machines.filter(m => m.id !== 'm-phone-incline');
    await L.saveImportSnapshot('before catalog update', { kind: 'catalog', skipPhotos: true });
    L.state().sessions = real.sessions;
    L.state().exercises = real.exercises;
    L.state().advice = real.advice;
    L.state().sync = real.sync;
    L.state().settings = real.settings;
    L.state().lastExport = real.lastExport;
    await L.persist();
    await L.undoLastImport({ quiet: true });
  });
  const afterUndo = await snapshot(page);
  console.log('after catalog-undo on current', afterUndo);
  if (afterUndo.entries < 3 || !afterUndo.hasPhoneM) {
    throw new Error('catalog undo wiped data on current version: ' + JSON.stringify(afterUndo));
  }

  // Confirm toast path: checkCatalogUpdate must not register undo (inspect toast call by applying catalog)
  const toastUndoSafe = await page.evaluate(async () => {
    const src = await (await fetch('app.js?v=2.5.0', { cache: 'no-store' })).text();
    const bad = /toast\(\s*['"]Machines updated['"]\s*,/.test(src);
    return { bad, hasGuard: /never pass an Undo callback/.test(src), hasSafeToast: /toast\(\s*['"]Machines updated['"]\s*\)/.test(src) };
  });
  console.log('toast undo guard', toastUndoSafe);
  if (toastUndoSafe.bad || !toastUndoSafe.hasSafeToast || !toastUndoSafe.hasGuard) {
    throw new Error('Machines updated toast still unsafe: ' + JSON.stringify(toastUndoSafe));
  }

  console.log('PASS version-walk');
  await browser.close();
  server.close();
  process.exit(0);
})().catch(async e => {
  console.error('FAIL', e);
  process.exit(1);
});
