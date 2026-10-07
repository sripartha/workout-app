/* Lift Log — tap-only workout logger PWA. Plain JS, no build step, no dependencies. */
'use strict';
(function () {
const APP_VERSION = '2.5.5';
const LB_PER_KG = 2.20462;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmtD = s => pd(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtDLong = s => pd(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const dowName = s => DOW[pd(s).getDay()];
/* Day being logged on the Today screen. In-memory only (never persisted), so every app launch starts on today. */
let workDate = null;
const activeDate = () => (workDate && workDate < todayStr() ? workDate : todayStr());
/* Past-date guard (2.5.5): opening an exercise / tapping a Set button on a day that isn't today asks first.
   "Keep" remembers the date until the day selection changes or the app relaunches (in-memory only). */
let pastOk = null, guardSeen = null, PG = null;
function setWorkDate(d) { const nd = d && d < todayStr() ? d : null; if (nd !== workDate) pastOk = null; workDate = nd; }
const daysAgo = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return ymd(d); };
const dayWord = date => date === todayStr() ? 'Today' : date === daysAgo(1) ? 'Yesterday' : fmtD(date);
const dayWordLc = date => date === todayStr() ? 'today' : date === daysAgo(1) ? 'yesterday' : 'on ' + fmtD(date);
const round1 = v => Math.round(v * 10) / 10;
const mmss = s => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
const DAY_MS = 864e5;
let lastTs = 0; const nowTs = () => (lastTs = Math.max(Date.now(), lastTs + 1)); // strictly increasing entry timestamps
const DIFF = { 1: 'Ridiculously easy', 2: 'Easier than average — consider going up', 3: 'As expected', 4: 'Too hard', 5: 'Barely possible' };
const DIFF_SHORT = { 1: 'ridiculously easy', 2: 'easier than average', 3: 'as expected', 4: 'too hard', 5: 'barely possible' };
const WRAP_DIFF = { 1: 'Very easy', 2: 'Easy', 3: 'As expected', 4: 'Hard', 5: 'Brutal' };
const WRAP_ENERGY = { 1: 'Exhausted', 2: 'Low', 3: 'Normal', 4: 'Good', 5: 'Great' };
const WRAP_CHIPS = ['great session', 'felt strong', 'PR today', 'tired', 'bad sleep', 'short on time', 'shoulder sore', 'skipped exercises'];
const NOTE_CHIPS = ['form check', 'increase next time', 'decrease next time', 'pain / tweak', 'low energy', 'great pump', 'required spotting'];
const BASE_CHIPS_LB = [0, 10, 15, 20, 25, 30, 35, 45], BASE_CHIPS_KG = [0, 5, 7.5, 10, 12.5, 15, 20];
// Suggestions shown as tap-to-add chips in first-run setup (nothing is pre-loaded).
const SUGGEST = {
  push: ['Chest Press', 'Bench Press', 'Incline Press', 'Shoulder Press', 'Lateral Raise', 'Triceps Pushdown', 'Pec Deck', 'Dips'],
  pull: ['Lat Pulldown', 'Seated Row', 'Bent-Over Row', 'Pull-Up', 'Face Pull', 'Biceps Curl', 'Rear Delt Fly'],
  legs: ['Squat', 'Leg Press', 'Romanian Deadlift', 'Leg Extension', 'Leg Curl', 'Calf Raise', 'Hip Thrust'],
  core: ['Cable Crunch', 'Hanging Leg Raise', 'Ab Crunch Machine', 'Russian Twist', 'Ab Wheel Rollout', 'Plank'],
  cardio: ['Treadmill', 'Stationary Bike', 'Elliptical', 'Rower', 'Stair Climber', 'Outdoor Run']
};

/* ---------------- Storage (IndexedDB, localStorage fallback) ---------------- */
const DB = {
  db: null,
  open() {
    return new Promise(res => {
      if (!('indexedDB' in window)) return res(null);
      let req;
      try { req = indexedDB.open('liftlog', 1); } catch (e) { return res(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
      };
      req.onsuccess = () => { DB.db = req.result; res(DB.db); };
      req.onerror = () => res(null);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      if (!DB.db) return rej(new Error('no db'));
      const t = DB.db.transaction(store, mode); const s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error || new Error('IndexedDB error'));
      t.onabort = () => rej(t.error || new Error('IndexedDB transaction aborted'));
    });
  },
  get(store, k) { return DB.tx(store, 'readonly', s => s.get(k)); },
  put(store, k, v) { return DB.tx(store, 'readwrite', s => s.put(v, k)); },
  del(store, k) { return DB.tx(store, 'readwrite', s => s.delete(k)); },
  clear(store) { return DB.tx(store, 'readwrite', s => s.clear()); },
  keys(store) { return DB.tx(store, 'readonly', s => s.getAllKeys()); }
};
const memPhotos = new Map(); // fallback when IndexedDB is unavailable
// Photos are stored as {type, buf: ArrayBuffer}: some WebKit/iOS builds cannot store Blob objects in IndexedDB.
async function photoGet(id) {
  const v = DB.db ? await DB.get('photos', id) : memPhotos.get(id);
  if (!v) return null; if (v instanceof Blob) return v;
  return new Blob([v.buf], { type: v.type || 'image/jpeg' });
}
async function photoPut(id, blob) {
  const rec = { type: blob.type || 'image/jpeg', buf: await blob.arrayBuffer() };
  if (DB.db) return DB.put('photos', id, rec); memPhotos.set(id, rec);
}
async function photoDel(id) { if (DB.db) return DB.del('photos', id); memPhotos.delete(id); }
async function photoKeys() { if (DB.db) return DB.keys('photos'); return [...memPhotos.keys()]; }

let S = null; // app state
let persistChain = Promise.resolve();
function persist() {
  const json = JSON.stringify(S); // write-through: every tap is saved immediately
  // Always mirror to localStorage first so a failed/evicted IDB write cannot strand the only copy.
  try { localStorage.setItem('liftlog', json); } catch (e) {}
  if (!DB.db) return;
  // Serialize IDB writes so an older in-flight put cannot overwrite a newer state.
  persistChain = persistChain.then(() => DB.put('kv', 'state', json)).catch(err => console.warn('idb persist failed', err));
}
function stateRichness(s) {
  if (!s) return -1;
  const entries = (s.sessions || []).reduce((n, x) => n + (x.entries || []).length, 0);
  const machines = Object.values(s.exercises || {}).reduce((n, e) => n + ((e.machines || []).length), 0);
  const sessions = (s.sessions || []).length;
  // Lexicographic: entries matter most, then phone machines, then session shells.
  return entries * 1e9 + machines * 1e3 + sessions;
}
async function loadState() {
  await DB.open();
  let idbRaw = null, lsRaw = null;
  if (DB.db) { try { idbRaw = await DB.get('kv', 'state'); } catch (e) {} }
  try { lsRaw = localStorage.getItem('liftlog'); } catch (e) {}
  const parse = raw => { try { return raw ? migrate(JSON.parse(raw)) : null; } catch (e) { console.warn('bad state', e); return null; } };
  const a = parse(idbRaw), b = parse(lsRaw);
  if (a && b) {
    // Prefer the richer copy if one store was clobbered (empty/older).
    return stateRichness(b) > stateRichness(a) ? b : a;
  }
  if (a) return a; if (b) return b;
  return seed();
}

/* ---------------- Initial (empty) state ---------------- */
function seed() {
  const T = (id, name, kind = 'strength') => ({ id, name, kind, exIds: [] });
  return migrate({
    v: 2, created: Date.now(), setupDone: false, lastExport: null,
    settings: { unit: 'lb', stepLb: 5, stepKg: 2.5, defaultReps: 12, distUnit: 'mi', homeGym: '' },
    exercises: {},
    templates: [T('push', 'Push'), T('pull', 'Pull'), T('legs', 'Legs'), T('core', 'Core'), T('cardio', 'Cardio', 'cardio')],
    schedule: { 0: { t: null, m: 'solo' }, 1: { t: 'push', m: 'coach' }, 2: { t: 'legs', m: 'solo' }, 3: { t: 'pull', m: 'coach' },
      4: { t: 'push', m: 'solo' }, 5: { t: 'legs', m: 'coach' }, 6: { t: 'pull', m: 'solo' } },
    sessions: [], advice: []
  });
}
const TPL_RENAME = { 'push day': 'Push', 'pull day': 'Pull', 'leg day': 'Legs', 'legs day': 'Legs' };
const rpeToDiff = r => r <= 2 ? 1 : r <= 4 ? 2 : r <= 7 ? 3 : r <= 8 ? 4 : 5;
function migrate(s) {
  s.v = 2; s.created = s.created || Date.now();
  s.settings = Object.assign({ unit: 'lb', stepLb: 5, stepKg: 2.5, defaultReps: 12, distUnit: 'mi', homeGym: '' }, s.settings || {});
  s.exercises = s.exercises || {}; s.templates = s.templates || []; s.sessions = s.sessions || []; s.advice = s.advice || [];
  if (s.setupDone === undefined) s.setupDone = Object.keys(s.exercises).length > 0;
  s.schedule = s.schedule || {};
  for (let i = 0; i < 7; i++) if (!s.schedule[i]) s.schedule[i] = { t: null, m: 'solo' };
  Object.values(s.exercises).forEach(e => {
    e.machines = e.machines || []; e.pinned = e.pinned || ''; e.cues = e.cues || '';
    e.machines.forEach(m => { m.base = (m.base === null || m.base === '') && e.kind !== 'cardio' ? null : +m.base || 0; m.caution = m.caution || ''; m.bu = m.bu || 'lb'; m.gym = m.gym || ''; m.loc = m.loc || ''; m.cues = m.cues || ''; });
  });
  s.sessions.forEach(x => {
    x.entries = x.entries || []; x.exIds = x.exIds || []; x.thoughts = x.thoughts || {};
    x.entries.forEach(e => {
      if (e.diff == null && e.rpe != null) e.diff = rpeToDiff(e.rpe);
      delete e.rpe;
      if (e.kind === 'set' && e.add == null) { e.add = e.w; e.base = 0; }
      if (e.kind === 'set' && e.base === undefined) e.base = 0;
    });
  });
  s.sync = Object.assign({ url: '', token: '', dirty: [], deleted: [], last: null, err: '', lastAttempt: null, sesHash: {} }, s.sync || {});
  s.sync.sesHash = s.sync.sesHash || {};
  // 2.5.2: template names "Push Day"/"Pull Day"/"Leg Day" → "Push"/"Pull"/"Legs" (name only; ids, schedule and sessions unchanged). One time.
  s.migrated = s.migrated || {};
  if (!s.migrated.tplNames252) {
    const renamed = new Set();
    s.templates.forEach(t => { const n = TPL_RENAME[String(t.name || '').trim().toLowerCase()]; if (n) { t.name = n; renamed.add(t.id); } });
    if (renamed.size) { const d = new Set(s.sync.dirty); s.sessions.forEach(x => { if (renamed.has(x.tid)) x.entries.forEach(e => d.add(e.id)); }); s.sync.dirty = [...d]; } // sheet rows pick up the new name
    s.migrated.tplNames252 = true;
  }
  // 2.5.4: gym tag "Austin" → "Lakeway" (Crunch Lakeway) on every machine (catalog + phone-added) and the home gym. One time.
  // Sessions reference machines by id, so history is untouched; ranking stays the same because home + tags change together.
  if (!s.migrated.gymLakeway254) {
    const isAustin = g => String(g == null ? '' : g).trim().toLowerCase() === 'austin';
    const moved = new Set();
    Object.values(s.exercises).forEach(e => (e.machines || []).forEach(m => { if (isAustin(m.gym)) { m.gym = 'Lakeway'; moved.add(m.id); } }));
    if (isAustin(s.settings.homeGym)) s.settings.homeGym = 'Lakeway';
    if (moved.size) { const d = new Set(s.sync.dirty); s.sessions.forEach(x => x.entries.forEach(e => { if (moved.has(e.mId)) d.add(e.id); })); s.sync.dirty = [...d]; } // sheet "gym" column follows
    s.migrated.gymLakeway254 = true;
  }
  if (s.lastAppliedCatalogVersion == null) s.lastAppliedCatalogVersion = 0;
  if (s.lastAppVersion == null) s.lastAppVersion = '';
  return s;
}

/* ---------------- Model helpers ---------------- */
const tplById = id => S.templates.find(t => t.id === id);
const exById = id => S.exercises[id];
const sesById = id => S.sessions.find(s => s.id === id);
const machById = (ex, mid) => ex && ex.machines.find(m => m.id === mid);
const exName = id => (exById(id) || { name: '(deleted exercise)' }).name;
const machName = (exId, mid) => { const m = machById(exById(exId), mid); return m ? m.name : '(deleted)'; };
const shortTpl = t => t ? t.name.replace(/ Day$/, '') : 'Rest';
const unit = () => S.settings.unit;
const step = () => unit() === 'kg' ? S.settings.stepKg : S.settings.stepLb;
const conv = (w, from, to) => from === to ? w : (to === 'kg' ? w / LB_PER_KG : w * LB_PER_KG);
const dispW = e => round1(conv(e.w, e.u || 'lb', unit()));           // total weight in display unit
const baseOf = m => m ? round1(conv(+m.base || 0, m.bu || 'lb', unit())) : 0;
// base === null means "not set yet" (e.g. imported machines: the coach records plate weight only). Math treats it as 0;
// sets logged meanwhile keep base null and get their totals filled in once the base is entered (setMachineBase).
const noBase = m => !!m && m.base === null;
function setMachineBase(ex, m, b) {
  const was = m.base; m.base = b; m.bu = unit();
  if (was === null && b !== null) {
    const ids = [];
    S.sessions.forEach(s => s.entries.forEach(e => { if (e.exId === ex.id && e.mId === m.id && e.kind === 'set' && e.base === null) {
      e.base = round1(conv(b, unit(), e.u || 'lb')); e.w = round1((e.add || 0) + e.base); ids.push(e.id); } }));
    if (ids.length) markDirty(ids);
  }
  Object.keys(P).forEach(k => { if (P[k] && P[k].mId === m.id && P[k].base !== undefined) { P[k].base = baseOf(m); P[k].noBase = noBase(m); } });
}
const fmtW = v => String(round1(v));
const fmtTotal = v => v === 0 ? 'BW' : `${round1(v)} ${unit()}`;
const snap = v => { const st = step(); return Math.max(0, round1(Math.round(v / st) * st)); };
function machineForDraft(p) {
  const d = P[p]; if (!d || !d.mId) return null;
  if (p === 'me' && typeof ME !== 'undefined' && ME) return { id: ME.key, weightChips: ME.weightChips, chipBu: ME.chipBu || 'lb', name: ME.name };
  if (curEx) return machById(exById(curEx.exId), d.mId);
  // entry editor: draft key ed — machine from open sheet context not always available
  return null;
}
function weightChipList(p) {
  const m = machineForDraft(p);
  if (m && Array.isArray(m.weightChips) && m.weightChips.length) {
    const from = m.chipBu || 'lb';
    return m.weightChips.map(c => round1(conv(+c, from, unit())));
  }
  const st = step(); const max = unit() === 'kg' ? 300 : 650; const out = [];
  for (let i = 0; i * st <= max + 1e-9; i++) out.push(round1(i * st));
  return out;
}
function snapToChips(v, chips) {
  if (!chips || !chips.length) return snap(v);
  let best = chips[0], bd = Math.abs(chips[0] - v);
  chips.forEach(c => { const d = Math.abs(c - v); if (d < bd) { bd = d; best = c; } });
  return best;
}
function stepChip(v, chips, dir) {
  if (!chips || !chips.length) {
    const st = step(); let n = snap(v + dir * st); if (n === v) n = round1(v + dir * st);
    return clamp(n, 0, unit() === 'kg' ? 300 : 650);
  }
  // find nearest index, then move
  let i = 0, bd = Infinity;
  chips.forEach((c, idx) => { const d = Math.abs(c - v); if (d < bd) { bd = d; i = idx; } });
  if (Math.abs(chips[i] - v) < 1e-6) i = clamp(i + dir, 0, chips.length - 1);
  else i = dir > 0 ? chips.findIndex(c => c > v + 1e-9) : (() => { let j = -1; chips.forEach((c, idx) => { if (c < v - 1e-9) j = idx; }); return j; })();
  if (i < 0) i = dir > 0 ? chips.length - 1 : 0;
  return chips[clamp(i, 0, chips.length - 1)];
}

const sortedSessions = () => S.sessions.slice().sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
const setsOf = (ses, exId, mId) => ses.entries.filter(e => e.kind === 'set' && e.exId === exId && (!mId || e.mId === mId)).sort((a, b) => a.set - b.set);
const cardioOf = (ses, exId) => ses.entries.filter(e => e.kind === 'cardio' && e.exId === exId);
const e1rm = (w, r) => r <= 1 ? w : w * (1 + r / 30);
const homeGym = () => (S.settings.homeGym || '').trim();
const gymRank = m => { const h = homeGym().toLowerCase(), g = (m.gym || '').trim().toLowerCase(); return !g || g === h ? (g === h && h ? 0 : 1) : 2; };
const sortedMachines = ex => ex.machines.map((m, i) => ({ m, i })).sort((a, b) => gymRank(a.m) - gymRank(b.m) || a.i - b.i).map(x => x.m);
const knownGyms = () => { const g = new Set(); if (homeGym()) g.add(homeGym()); Object.values(S.exercises).forEach(e => e.machines.forEach(m => { if (m.gym) g.add(m.gym.trim()); })); return [...g]; };
const nextSetNo = (ses, exId, mId) => { const have = setsOf(ses, exId, mId).map(s => s.set); const f = [1, 2, 3].find(n => !have.includes(n)); return f || Math.max(...have) + 1; };

/* ---------------- Sync change tracking ---------------- */
function markDirty(ids) { if (syncing) ids.forEach(i => syncRedirty.add(i)); const d = new Set(S.sync.dirty); ids.forEach(i => d.add(i)); S.sync.dirty = [...d]; S.sync.deleted = S.sync.deleted.filter(i => !d.has(i)); scheduleSync(); }
function markDeleted(ids) { if (syncing) ids.forEach(i => syncRedirty.add(i)); const x = new Set(S.sync.deleted); ids.forEach(i => x.add(i)); S.sync.deleted = [...x]; S.sync.dirty = S.sync.dirty.filter(i => !x.has(i)); scheduleSync(); }
const markSessionDirty = ses => markDirty(ses.entries.map(e => e.id));
const markExDirty = exId => markDirty(S.sessions.flatMap(s => s.entries.filter(e => e.exId === exId).map(e => e.id)));

/* Last result for exercise (+machine). Includes the machine's setup "starting weight" when there is no history yet. */
function lastFor(exId, mId, exclude, upto) {
  // Ordered by SESSION DATE (not entry time), so backdated sets slot in correctly.
  // When viewing a session, only that day or earlier counts as "last".
  if (upto == null && exclude) { const xs = sesById(exclude); if (xs) upto = xs.date; }
  for (const s of sortedSessions()) {
    if (s.id === exclude) continue;
    if (upto && s.date > upto) continue;
    const ents = s.entries.filter(e => e.exId === exId && (!mId || e.mId === mId));
    if (ents.length) return { ses: s, date: s.date, ents: ents.slice().sort((a, b) => (a.set || 0) - (b.set || 0) || a.ts - b.ts), seed: false };
  }
  const m = mId && machById(exById(exId), mId);
  if (m && m.start) return { ses: null, date: m.start.date, ents: [{ kind: 'set', w: m.start.w, u: m.start.u, reps: m.start.reps, add: null, diff: null, mId }], seed: true };
  return null;
}
const lastEnt = l => l && l.ents[l.ents.length - 1];
/* Machine used most recently for this exercise (any session), else the most recently set-up starting weight. */
function recentMachine(ex, upto) {
  let best = null;
  S.sessions.forEach(s => (upto && s.date > upto) ? null : s.entries.forEach(e => { if (e.exId === ex.id && machById(ex, e.mId)) { const k = s.date + '|' + String(e.ts).padStart(15, '0'); if (!best || k > best.k) best = { k, mId: e.mId }; } }));
  if (best) return machById(ex, best.mId);
  const seeded = ex.machines.filter(m => m.start).sort((a, b) => (b.start.ts || 0) - (a.start.ts || 0));
  return seeded[0] || null;
}

function todaySetsHTML(ses, ex) {
  const sets = setsOf(ses, ex.id).slice().sort((a, b) => a.ts - b.ts || a.set - b.set); // chronological across machines
  if (!sets.length) return '';
  const groups = []; sets.forEach(e => { let g = groups.find(x => x.mId === e.mId); if (!g) groups.push(g = { mId: e.mId, sets: [] }); g.sets.push(e); });
  const multi = groups.length > 1; // one chip row per machine (named) only when the day's sets span machines
  // One compact row of tappable chips (wraps for many sets) so the exercise screen fits without scrolling.
  return `<div class="today-sets ts-compact" data-testid="today-sets">
    <div class="row"><span class="sub mach-label grow">${esc(dayWord(ses.date))} · ${sets.length} set${sets.length === 1 ? '' : 's'}</span>
      <span class="fine">tap to edit</span></div>
    ${groups.map(g => `${multi ? `<div class="ts-gm">${esc(machName(ex.id, g.mId))}</div>` : ''}<div class="ts-chips">${g.sets.map(e => `<button class="tschip today-set" data-a="edit-entry" data-sid="${ses.id}" data-id="${e.id}" data-testid="today-set" aria-label="Set ${e.set}, ${fmtW(dispW(e))} by ${e.reps}, ${esc(machName(ex.id, e.mId))}">
      <b>S${e.set}</b>${fmtW(dispW(e))}×${e.reps}</button>`).join('')}</div>`).join('')}
  </div>`;
}
function todaySetsSiblings(ses, exId) {
  return ses.entries.filter(x => x.kind === 'set' && x.exId === exId).sort((a, b) => a.ts - b.ts || a.set - b.set);
}
function pastBanner(date) {
  if (!date || date >= todayStr()) return '';
  return `<div class="pastbar" data-testid="past-banner"><span class="grow">📅 Logging for <b>${esc(fmtD(date))}</b></span>
    <button class="chip sm" data-a="date-today" data-testid="back-today">Back to today</button></div>`;
}
function compactSets(ents) {
  const out = [];
  ents.forEach(e => {
    const k = `${fmtW(dispW(e))}×${e.reps || '?'}`;
    const last = out[out.length - 1];
    if (last && last.k === k) last.n++; else out.push({ k, n: 1 });
  });
  return out.map(o => o.n > 1 ? `${o.k} ×${o.n}` : o.k).join(', ');
}
const cardioSummary = e => `${e.dur} min${e.dist ? ` · ${round1(e.dist)} ${e.du || S.settings.distUnit}` : ''}${e.level ? ` · L${e.level}` : ''}`;
const diffTxt = d => d ? `difficulty ${d} (${DIFF_SHORT[d]})` : '';
function lastLine(l, withDate = true) {
  const e = lastEnt(l); if (!e) return '';
  if (e.kind === 'cardio') return `${cardioSummary(e)}${e.diff ? ' · d' + e.diff : ''}${withDate ? ' · ' + fmtD(l.date) : ''}`;
  return `${fmtTotal(dispW(e))}${e.base === null ? ' + base?' : ''}${e.reps ? ' × ' + e.reps : ''}${e.diff ? ' · d' + e.diff : ''}${withDate ? ' · ' + fmtD(l.date) : ''}${l.seed ? ' · starting weight' : ''}`;
}

/* ---------------- Routing ---------------- */
const route = () => (location.hash || '#/today').slice(2).split('/');
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
window.addEventListener('hashchange', () => { closeSheet(); guardSeen = null; render(); window.scrollTo(0, 0); });

/* ---------------- UI primitives (pickers keep their state in P[prefix]) ---------------- */
const P = {};
function seg(action, options, cur, extra = '') {
  return `<div class="seg">${options.map(([v, l]) => `<button data-a="${action}" data-v="${esc(v)}" ${extra} class="${String(v) === String(cur) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
// Weight picker: big controls = WORKING/ADDED weight (plates or stack pin). Base is a quiet locked line.
const baseUnlocked = new Set(); // machine ids unlocked for base edit this session
function baseLineHTML(p) {
  const d = P[p]; if (!d || !d.mId) return '';
  if (d.noBase) {
    return `<div class="baseline" data-testid="base-line"><button class="linkbtn fine" data-a="ask-base" data-m="${d.mId}" data-testid="set-base">Set base</button><span class="bquiet"> · bar/sled/carriage (rarely changes)</span></div>`;
  }
  const unlocked = baseUnlocked.has(d.mId);
  if (unlocked) {
    return `<div class="baseline" data-testid="base-line"><button class="linkbtn fine" data-a="ask-base" data-m="${d.mId}">Base: ${fmtW(d.base)} ${unit()} — tap to change</button>
      <button class="chip sm baselock" data-a="lock-base" data-m="${d.mId}" data-testid="lock-base" aria-label="Lock base">🔒 Lock</button></div>`;
  }
  return `<div class="baseline base-locked" data-testid="base-line"><span class="bquiet">🔒 Base ${fmtW(d.base)} ${unit()}</span>
    <button class="chip sm baselock" data-a="unlock-base" data-m="${d.mId}" data-testid="unlock-base" aria-label="Unlock base to edit">Unlock</button></div>`;
}
function weightPicker(p, compact = false) {
  const v = P[p].add; const list = weightChipList(p);
  const chips = list.map(xv => `<button class="chip ${Math.abs(xv - v) < 1e-6 ? 'on' : ''}" data-a="w" data-p="${p}" data-v="${xv}">${fmtW(xv)}</button>`);
  const custom = !!(machineForDraft(p) && machineForDraft(p).weightChips);
  const cls = compact ? ' wp-compact' : '';
  const showBase = p !== 'ed'; // entry sheet stays short — base lives on the log screen
  return `<div class="wpick${cls}">${showBase ? baseLineHTML(p) : ''}
  <div class="wlabel" data-testid="working-label">Working <span class="bquiet">${custom ? '(cable)' : '(plates / pin)'}</span></div>
  <div class="row"><button class="step" data-a="wstep" data-p="${p}" data-d="-1" aria-label="minus">−</button>
  <div class="grow bigval" id="wv-${p}" data-testid="weight-value">${weightBig(p)}</div>
  <button class="step" data-a="wstep" data-p="${p}" data-d="1" aria-label="plus">+</button></div>
  <div class="wscroll" data-p="${p}" data-testid="weight-chips">${chips.join('')}</div>
  <div class="total" id="wt-${p}" data-testid="weight-total">${weightTotal(p)}</div></div>`;
}
// Big number = working/added weight (what you change every set)
const weightBig = p => `${fmtW(P[p].add)}<small>${unit()}</small>`;
const weightTotal = p => { const d = P[p];
  if (d.noBase) return `Working <b>${fmtW(d.add)} ${unit()}</b> · <span data-testid="base-not-set">base not set — total filled in once set</span>`;
  const tot = round1(d.add + (d.base || 0));
  // base 0 (weight stacks) is still a set base — show working + base
  return `Total <b>${fmtW(tot)} ${unit()}</b> <span class="bquiet">(${fmtW(d.add)} working + ${fmtW(d.base || 0)} base)</span>`;
};
function repsPicker(p, lastReps, compact = false) {
  const r = P[p].reps;
  if (compact) {
    return `<div class="row reps-compact"><button class="step" data-a="rstep" data-p="${p}" data-d="-1">−</button>
      <div class="grow bigval" id="rv-${p}" data-testid="reps-value">${r}<small>reps</small></div>
      <button class="step" data-a="rstep" data-p="${p}" data-d="1">+</button>
      ${lastReps != null && lastReps !== r ? `<button class="chip sm" data-a="rset" data-p="${p}" data-v="${lastReps}" data-testid="last-reps">Last ${lastReps}</button>` : ''}</div>
      <input type="range" class="reps-hidden" min="1" max="15" step="1" value="${Math.min(15, r)}" data-i="reps" data-p="${p}" aria-label="reps">`;
  }
  return `<div class="row"><button class="step" data-a="rstep" data-p="${p}" data-d="-1">−</button>
  <div class="grow bigval" id="rv-${p}" data-testid="reps-value">${r}<small>reps</small></div>
  <button class="step" data-a="rstep" data-p="${p}" data-d="1">+</button></div>
  <input type="range" min="1" max="15" step="1" value="${Math.min(15, r)}" data-i="reps" data-p="${p}" aria-label="reps">
  <div class="ticks"><span>1</span><span>5</span><span>10</span><span>15</span></div>
  ${lastReps != null ? `<div class="row wrap" style="margin-top:8px"><span class="sub" data-testid="last-reps">Last: ${lastReps} reps</span>
    ${lastReps !== r ? `<button class="chip sm" data-a="rset" data-p="${p}" data-v="${lastReps}">Use ${lastReps}</button>` : ''}
    ${r !== S.settings.defaultReps ? `<button class="chip sm" data-a="rset" data-p="${p}" data-v="${S.settings.defaultReps}">Use ${S.settings.defaultReps}</button>` : ''}</div>` : ''}`;
}
function diffPicker(p) {
  const v = P[p].diff || 3;
  return `<div class="diffval d${v}" id="dv-${p}" data-testid="diff-value"><b>${v}</b> ${esc(DIFF[v])}</div>
  <input type="range" min="1" max="5" step="1" value="${v}" data-i="diff" data-p="${p}" aria-label="difficulty" data-testid="diff-slider">
  <div class="ticks5">${[1, 2, 3, 4, 5].map(n => `<button data-a="dset" data-p="${p}" data-v="${n}" class="${n === v ? 'on' : ''}">${n}</button>`).join('')}</div>`;
}
function notePicker(p) {
  const tags = P[p].tags || [];
  return `<div class="chips">${NOTE_CHIPS.map(t => `<button class="chip sm ${tags.includes(t) ? 'on' : ''}" data-a="tag" data-p="${p}" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
}
function cardioPicker(p) {
  const c = P[p]; const du = S.settings.distUnit;
  return `<h3>Duration</h3><div class="row"><button class="step" data-a="cstep" data-p="${p}" data-f="dur" data-d="-1">−</button>
    <div class="grow bigval" id="cv-dur-${p}" data-testid="dur-value">${c.dur}<small>min</small></div>
    <button class="step" data-a="cstep" data-p="${p}" data-f="dur" data-d="1">+</button></div>
    <input type="range" min="1" max="120" step="1" value="${c.dur}" data-i="dur" data-p="${p}" aria-label="duration">
    <div class="chips">${[10, 15, 20, 30, 45, 60].map(m => `<button class="chip sm" data-a="cset" data-p="${p}" data-f="dur" data-v="${m}">${m} min</button>`).join('')}</div>
    <h3>Distance</h3><div class="row"><button class="step" data-a="cstep" data-p="${p}" data-f="dist" data-d="-0.1">−</button>
    <div class="grow bigval" id="cv-dist-${p}" data-testid="dist-value">${(+c.dist).toFixed(1)}<small>${du}</small></div>
    <button class="step" data-a="cstep" data-p="${p}" data-f="dist" data-d="0.1">+</button></div>
    <input type="range" min="0" max="20" step="0.1" value="${c.dist}" data-i="dist" data-p="${p}" aria-label="distance">
    <h3>Level / incline (optional)</h3><div class="row"><div class="grow bigval" id="cv-level-${p}" style="font-size:28px">${c.level || '—'}</div></div>
    <input type="range" min="0" max="25" step="1" value="${c.level || 0}" data-i="level" data-p="${p}" aria-label="level">`;
}
function updateCardioUI(p) {
  const c = P[p]; const du = S.settings.distUnit;
  const a = $(`#cv-dur-${p}`); if (a) a.innerHTML = `${c.dur}<small>min</small>`;
  const b = $(`#cv-dist-${p}`); if (b) b.innerHTML = `${(+c.dist).toFixed(1)}<small>${du}</small>`;
  const l = $(`#cv-level-${p}`); if (l) l.textContent = c.level || '—';
  [['dur', c.dur], ['dist', c.dist], ['level', c.level || 0]].forEach(([f, v]) => { const s = $(`input[data-i="${f}"][data-p="${p}"]`); if (s && document.activeElement !== s) s.value = v; });
}
function centerChips(smooth) {
  $$('.wscroll').forEach(sc => {
    const on = sc.querySelector('.chip.on'); if (!on) return;
    const left = on.offsetLeft - sc.clientWidth / 2 + on.offsetWidth / 2;
    if (smooth && sc.scrollTo) sc.scrollTo({ left, behavior: 'smooth' }); else sc.scrollLeft = left;
  });
}
function updateWeightUI(p) {
  const v = P[p].add; const sc = $(`.wscroll[data-p="${p}"]`);
  if (sc) $$('.chip', sc).forEach(c => c.classList.toggle('on', Math.abs(+c.dataset.v - v) < 1e-6));
  const el = $(`#wv-${p}`); if (el) el.innerHTML = weightBig(p);
  const t = $(`#wt-${p}`); if (t) t.innerHTML = weightTotal(p);
  centerChips(true); updateSetbarLabel();
}
function updateRepsUI(p) {
  const el = $(`#rv-${p}`); if (el) el.innerHTML = `${P[p].reps}<small>reps</small>`;
  const sl = $(`input[data-i="reps"][data-p="${p}"]`); if (sl) sl.value = Math.min(15, P[p].reps);
  updateSetbarLabel();
}
function updateDiffUI(p) {
  const v = P[p].diff; const el = $(`#dv-${p}`); if (el) { el.className = `diffval d${v}`; el.innerHTML = `<b>${v}</b> ${esc(DIFF[v])}`; }
  const sl = $(`input[data-i="diff"][data-p="${p}"]`); if (sl && document.activeElement !== sl) sl.value = v;
  $$(`.ticks5 button[data-p="${p}"]`).forEach(b => b.classList.toggle('on', +b.dataset.v === v));
}

/* ---------------- Sheets, toast, viewer ---------------- */
let sheetResolve = null;
function openSheet(html) { $('#sheet-root').innerHTML = `<div class="sheet-bg" data-a="sheet-bg"><div class="sheet" role="dialog">${html}</div></div>`; }
function closeSheet(val) { $('#sheet-root').innerHTML = ''; if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(val); } }
function askText(title, value = '', placeholder = '') {
  return new Promise(res => {
    openSheet(`<h2>${esc(title)}</h2><input class="field" id="ask-input" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="120" autocomplete="off">
      <div style="height:12px"></div><button class="btn pri" data-a="ask-ok">Save</button><button class="btn ghost" data-a="sheet-cancel">Cancel</button>`);
    sheetResolve = res;
    const inp = $('#ask-input'); inp.focus();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') $('[data-a="ask-ok"]').click(); });
  });
}
function confirmSheet(title, msg, ok = 'Delete', cls = 'bad') {
  return new Promise(res => {
    openSheet(`<h2>${esc(title)}</h2><p class="sub">${esc(msg)}</p><button class="btn ${cls}" data-a="confirm-ok">${esc(ok)}</button><button class="btn ghost" data-a="sheet-cancel">Cancel</button>`);
    sheetResolve = res;
  });
}
let toastTimer = null, toastUndo = null;
function toast(msg, undo) {
  const t = $('#toast'); if (!t) return; toastUndo = undo || null;
  t.innerHTML = `<span data-testid="toast-msg">${esc(msg)}</span>${undo ? '<button data-a="toast-undo" data-testid="toast-undo">UNDO</button>' : ''}`;
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; toastUndo = null; }, undo ? 5000 : 2200);
}
async function openPhoto(photoId) {
  const blob = await photoGet(photoId); if (!blob) return toast('Photo not found');
  const url = URL.createObjectURL(blob);
  const v = document.createElement('div'); v.className = 'viewer'; v.dataset.testid = 'photo-viewer';
  v.innerHTML = `<img src="${url}" alt="Machine photo"><span class="x">Tap to close</span>`;
  v.addEventListener('click', () => { URL.revokeObjectURL(url); v.remove(); });
  document.body.appendChild(v);
}

/* ---------------- File helpers, export ---------------- */
function pickFile(accept, capture) {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.className = 'hidden-file';
    if (capture) i.setAttribute('capture', capture);
    i.addEventListener('change', () => { res(i.files && i.files[0]); i.remove(); });
    document.body.appendChild(i); i.click();
  });
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
async function shareOrDownload(blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title, text: title }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  download(blob, name); return 'downloaded';
}
function resizeImage(file, max = 1600, q = 0.82) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight; const sc = Math.min(1, max / Math.max(w, h));
      w = Math.round(w * sc); h = Math.round(h * sc);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error('encode failed')), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read image')); };
    img.src = url;
  });
}
const blobToDataURL = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
function dataURLToBlob(d) {
  const [head, b64] = d.split(','); const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}
async function buildExport() {
  const photos = {};
  for (const k of await photoKeys()) { const b = await photoGet(k); if (b) photos[k] = await blobToDataURL(b); }
  const state = JSON.parse(JSON.stringify(S)); state.sync = Object.assign({}, state.sync, { token: '' }); // never export the secret
  return { app: 'liftlog', schema: 2, version: APP_VERSION, exportedAt: new Date().toISOString(), state, photos };
}
const CSV_COLS = ['date', 'template', 'mode', 'exercise', 'machine', 'gym', 'type', 'set', 'weight', 'added_weight', 'base_weight', 'unit', 'reps', 'difficulty',
  'set_seconds', 'duration_min', 'distance', 'distance_unit', 'level', 'tags', 'note', 'thoughts'];
function entryRow(s, e) {
  const m = machById(exById(e.exId), e.mId);
  return { date: s.date, template: (tplById(s.tid) || {}).name || '', mode: s.mode, exercise: exName(e.exId), machine: machName(e.exId, e.mId), gym: m ? m.gym : '', type: e.kind,
    set: e.set || '', weight: e.kind === 'set' ? (e.base === null ? '' : e.w) : '', added_weight: e.kind === 'set' ? e.add : '', base_weight: e.kind === 'set' ? (e.base === null ? '' : (e.base || 0)) : '', unit: e.kind === 'set' ? (e.u || 'lb') : '',
    reps: e.reps || '', difficulty: e.diff || '', set_seconds: e.secs || '', duration_min: e.dur || '', distance: e.dist || '', distance_unit: e.kind === 'cardio' ? (e.du || '') : '', level: e.level || '',
    tags: (e.tags || []).join('; '), note: e.note || '', thoughts: (s.thoughts || {})[e.exId] || '',
    session_id: s.id, exercise_id: e.exId, machine_id: e.mId || '', template_id: s.tid || '', ts: e.ts || '' }; // ids: sheet only (restore), not in CSV
}
function buildCSV() {
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const rows = [CSV_COLS.join(',')];
  sortedSessions().slice().reverse().forEach(s => s.entries.slice().sort((a, b) => a.ts - b.ts).forEach(e => { const r = entryRow(s, e); rows.push(CSV_COLS.map(c => q(r[c])).join(',')); }));
  return rows.join('\n');
}
/* ---------------- Session summary + wrap-up (end-of-workout reflection) ---------------- */
// Duration: first logged entry -> wrap-up time (when finishing the same day) or last entry; the wrap-up can correct it.
function autoDurMin(s) {
  const ts = s.entries.map(e => e.ts).filter(Boolean).sort((a, b) => a - b); if (!ts.length) return 0;
  const last = s.entries.find(e => e.ts === ts[ts.length - 1]); let end = ts[ts.length - 1] + ((last && last.secs) || 0) * 1000;
  if (s.date === todayStr() && Date.now() - end < 3 * 36e5) end = Math.max(end, Date.now());
  return Math.max(0, Math.round((end - ts[0]) / 6e4));
}
function sessionSummary(s) {
  const sets = s.entries.filter(e => e.kind === 'set'), cardio = s.entries.filter(e => e.kind === 'cardio');
  return { exercises: new Set(s.entries.map(e => e.exId)).size, sets: sets.length, cardioMin: cardio.reduce((a, e) => a + (e.dur || 0), 0),
    volume: Math.round(sets.reduce((a, e) => a + dispW(e) * (e.reps || 0), 0)), unit: unit(),
    durMin: s.wrap && s.wrap.durMin != null ? s.wrap.durMin : autoDurMin(s), mode: s.mode };
}
const fmtNum = n => Math.round(n).toLocaleString('en-US');
const summaryLine = sm => [`${sm.exercises} exercise${sm.exercises === 1 ? '' : 's'}`, `${sm.sets} set${sm.sets === 1 ? '' : 's'}`,
  sm.volume ? `${fmtNum(sm.volume)} ${sm.unit} volume` : '', sm.cardioMin ? `${sm.cardioMin} min cardio` : '', `${sm.durMin} min`, sm.mode === 'coach' ? 'with coach' : 'solo'].filter(Boolean).join(' · ');
const SESSION_COLS = ['date', 'template', 'mode', 'duration_min', 'exercises', 'sets', 'volume', 'unit', 'session_difficulty', 'energy', 'chips', 'thoughts', 'session_id'];
function sessionRow(s) {
  const sm = sessionSummary(s), w = s.wrap || {};
  return { date: s.date, template: (tplById(s.tid) || {}).name || '', mode: s.mode, duration_min: sm.durMin, exercises: sm.exercises, sets: sm.sets, volume: sm.volume, unit: sm.unit,
    session_difficulty: w.diff || '', energy: w.energy || '', chips: (w.tags || []).join('; '), thoughts: w.thoughts || '', session_id: s.id, template_id: s.tid || '' };
}
const rowSessions = () => S.sessions.filter(s => s.entries.length || s.wrap);
function buildSessionsCSV() {
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return [SESSION_COLS.join(','), ...sortedSessions().slice().reverse().filter(s => s.entries.length || s.wrap).map(s => { const r = sessionRow(s); return SESSION_COLS.map(c => q(r[c])).join(','); })].join('\n');
}
// Sessions tab sync: send a session row whenever its content differs from what was last synced (no manual dirty tracking needed).
function pendingSessions() {
  const h = S.sync.sesHash || {}; const ups = [], live = new Set();
  rowSessions().forEach(s => { live.add(s.id); const r = sessionRow(s); const k = JSON.stringify(r); if (h[s.id] !== k) ups.push({ row: r, k }); });
  return { ups, dels: Object.keys(h).filter(id => !live.has(id)) };
}
async function exportJSON(how) {
  const data = await buildExport(); const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const name = `liftlog-backup-${todayStr()}.json`;
  let r;
  if (how === 'download') { download(blob, name); r = 'downloaded'; }
  else r = await shareOrDownload(blob, name, how === 'crunchbot' ? 'Lift Log workouts for CrunchBot' : 'Lift Log backup');
  if (r === 'cancelled') return;
  S.lastExport = Date.now(); persist(); render();
  toast(r === 'shared' ? 'Shared' : 'Backup downloaded');
}
const SNAP_KEY = 'import-snaps';
const SNAP_MAX = 3;
let memSnaps = []; // fallback when IndexedDB is unavailable
let importSnapCount = 0;
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function loadImportSnaps() {
  if (DB.db) {
    try { const v = await DB.get('kv', SNAP_KEY); if (Array.isArray(v)) return v; } catch (e) {}
  }
  return memSnaps.slice();
}
async function saveImportSnaps(list) {
  importSnapCount = list.length;
  if (DB.db) {
    try { await DB.put('kv', SNAP_KEY, list); memSnaps = []; return; } catch (e) { console.warn('snap save failed', e); }
  }
  memSnaps = list;
}
async function refreshSnapCount() {
  try { importSnapCount = (await loadImportSnaps()).length; } catch (e) { importSnapCount = 0; }
}
async function saveImportSnapshot(label, opts = {}) {
  const photos = {};
  if (!opts.skipPhotos) {
    for (const k of await photoKeys()) {
      try { const b = await photoGet(k); if (b) photos[k] = await blobToDataURL(b); } catch (e) {}
    }
  }
  const snap = {
    id: uid(), at: Date.now(), label: label || 'before import', kind: opts.kind || 'import',
    state: JSON.parse(JSON.stringify(S)), photos
  };
  const list = await loadImportSnaps();
  list.unshift(snap);
  await saveImportSnaps(list.slice(0, SNAP_MAX));
}
async function applyPhotos(map, clearFirst) {
  if (clearFirst) { try { if (DB.db) await DB.clear('photos'); else memPhotos.clear(); } catch (e) {} }
  for (const [k, d] of Object.entries(map || {})) {
    try { await photoPut(k, dataURLToBlob(d)); } catch (e) { console.warn('photo import failed', k); }
  }
}
function findExByIncoming(phoneEx, fileEx) {
  if (phoneEx[fileEx.id]) return phoneEx[fileEx.id];
  const n = normName(fileEx.name);
  return Object.values(phoneEx).find(e => normName(e.name) === n) || null;
}
function findMachByIncoming(phoneMs, fileM) {
  const byId = phoneMs.find(m => m.id === fileM.id);
  if (byId) return byId;
  const n = normName(fileM.name);
  return phoneMs.find(m => normName(m.name) === n) || null;
}
function cloneMachine(m) {
  const out = {
    id: m.id, name: m.name, base: m.base === null || m.base === '' ? null : +m.base || 0,
    bu: m.bu || 'lb', gym: m.gym || '', loc: m.loc || '', cues: m.cues || '', caution: m.caution || '',
    photoId: m.photoId || undefined, start: m.start || undefined
  };
  if (Array.isArray(m.weightChips) && m.weightChips.length) { out.weightChips = m.weightChips.slice(); out.chipBu = m.chipBu || 'lb'; }
  return out;
}
function applyCatalogFields(phoneM, fileM, ex) {
  phoneM.name = fileM.name;
  phoneM.gym = fileM.gym || '';
  phoneM.loc = fileM.loc || '';
  phoneM.cues = fileM.cues || '';
  phoneM.caution = fileM.caution || '';
  if (fileM.photoId) phoneM.photoId = fileM.photoId;
  if (Array.isArray(fileM.weightChips) && fileM.weightChips.length) {
    phoneM.weightChips = fileM.weightChips.slice();
    phoneM.chipBu = fileM.chipBu || 'lb';
  }
  // BASE RULE: file "not set" (null) keeps the phone value; a number from the file wins.
  const fileBase = (fileM.base === null || fileM.base === '') ? null : +fileM.base;
  if (fileBase === null || Number.isNaN(fileBase)) return; // keep phone base
  if (phoneM.base === null) setMachineBase(ex, phoneM, fileBase);
  else { phoneM.base = fileBase; phoneM.bu = fileM.bu || phoneM.bu || 'lb'; }
}
function mergeCatalog(fileState) {
  // HARD GUARANTEE: catalog merge never clears workouts / sync / settings.
  const keepSessions = S.sessions;
  const keepAdvice = S.advice;
  const keepSync = S.sync;
  const keepSettings = S.settings;
  const keepLastExport = S.lastExport;
  const incoming = migrate(JSON.parse(JSON.stringify(fileState))); // normalize bases/cautions without touching phone S yet
  let addedEx = 0, addedM = 0, updatedM = 0;
  const exIdMap = {}; // file exercise id -> phone exercise id
  Object.values(incoming.exercises || {}).forEach(fileEx => {
    let phoneEx = findExByIncoming(S.exercises, fileEx);
    if (!phoneEx) {
      phoneEx = {
        id: fileEx.id, name: fileEx.name, kind: fileEx.kind || 'strength',
        machines: (fileEx.machines || []).map(cloneMachine),
        pinned: fileEx.pinned || '', cues: fileEx.cues || ''
      };
      S.exercises[phoneEx.id] = phoneEx;
      addedEx++; addedM += phoneEx.machines.length;
      exIdMap[fileEx.id] = phoneEx.id;
      return;
    }
    exIdMap[fileEx.id] = phoneEx.id;
    // update exercise catalog fields (name/cues/pinned) but never wipe a phone pinned caution with empty
    phoneEx.name = fileEx.name || phoneEx.name;
    if (fileEx.kind) phoneEx.kind = fileEx.kind;
    if (fileEx.cues) phoneEx.cues = fileEx.cues;
    if (fileEx.pinned) phoneEx.pinned = fileEx.pinned;
    (fileEx.machines || []).forEach(fileM => {
      const phoneM = findMachByIncoming(phoneEx.machines, fileM);
      if (!phoneM) {
        phoneEx.machines.push(cloneMachine(fileM));
        addedM++;
        return;
      }
      applyCatalogFields(phoneM, fileM, phoneEx);
      updatedM++;
    });
  });
  // Templates: add new templates; for existing ones, append missing exercise ids (never remove)
  (incoming.templates || []).forEach(ft => {
    let pt = S.templates.find(t => t.id === ft.id) || S.templates.find(t => normName(t.name) === normName(ft.name));
    const mappedIds = (ft.exIds || []).map(eid => exIdMap[eid] || eid).filter(eid => S.exercises[eid]);
    if (!pt) {
      S.templates.push({ id: ft.id, name: ft.name, kind: ft.kind || 'strength', exIds: mappedIds });
      return;
    }
    mappedIds.forEach(eid => { if (!pt.exIds.includes(eid)) pt.exIds.push(eid); });
  });
  // Schedule: fill empty days from the file, never overwrite a phone assignment
  Object.keys(incoming.schedule || {}).forEach(d => {
    const cur = S.schedule[d];
    if (cur && !cur.t && incoming.schedule[d] && incoming.schedule[d].t) S.schedule[d] = Object.assign({}, incoming.schedule[d]);
  });
  S.setupDone = true;
  S.sessions = keepSessions;
  S.advice = keepAdvice;
  S.sync = keepSync;
  S.settings = keepSettings;
  S.lastExport = keepLastExport;
  return { addedEx, addedM, updatedM };
}
function importModeSheet(obj) {
  const st = obj.state || {};
  const nSes = (st.sessions || []).length;
  const nEx = Object.keys(st.exercises || {}).length;
  const nM = Object.values(st.exercises || {}).reduce((a, e) => a + (e.machines || []).length, 0);
  const nPh = Object.keys(obj.photos || {}).length;
  const when = obj.exportedAt ? obj.exportedAt.slice(0, 10) : '?';
  const looksCatalog = nSes === 0;
  return new Promise(res => {
    openSheet(`<h2>Import file</h2>
      <p class="sub">${esc(when)} · ${nEx} exercises · ${nM} machines · ${nSes} session${nSes === 1 ? '' : 's'} · ${nPh} photo${nPh === 1 ? '' : 's'}.
      ${looksCatalog ? ' Looks like a machine catalog (no workouts).' : ' This file includes workout history.'}</p>
      <button class="btn pri" data-a="import-choose" data-mode="merge" data-testid="import-merge">Update machines (keeps your workouts)</button>
      <div class="sub" style="margin:6px 0 14px">Recommended. Adds &amp; updates machines, locations, bases and photos. Never deletes your logged sets.</div>
      <button class="btn ghost" data-a="import-choose" data-mode="full" data-testid="import-full">Full restore (replaces everything)</button>
      <div class="sub" style="margin:6px 0 14px">Wipes workouts, settings and photos on this phone, then loads the file.</div>
      <button class="btn ghost" data-a="sheet-cancel" data-testid="import-cancel">Cancel</button>`);
    sheetResolve = res;
  });
}
async function importJSON(file) {
  if (!file) return;
  let obj; try { obj = JSON.parse(await file.text()); } catch (e) { return toast('Not a valid JSON file'); }
  if (!obj || obj.app !== 'liftlog' || !obj.state) return toast('Not a Lift Log backup');
  const mode = await importModeSheet(obj);
  if (!mode) return;
  if (mode === 'full') {
    const n = (obj.state.sessions || []).length;
    if (!await confirmSheet('Full restore?', `This replaces everything on this phone with the backup from ${obj.exportedAt ? obj.exportedAt.slice(0, 10) : '?'} (${n} sessions, ${Object.keys(obj.photos || {}).length} photos). A safety snapshot is saved first so you can undo.`, 'Replace and restore', 'bad')) return;
  }
  await saveImportSnapshot(mode === 'merge' ? 'before update machines' : 'before full restore');
  if (mode === 'merge') {
    await applyPhotos(obj.photos || {}, false);
    const r = mergeCatalog(obj.state);
    if (obj.catalogVersion) S.lastAppliedCatalogVersion = +obj.catalogVersion;
    persist(); await refreshSnapCount(); go('#/today');
    toast(`Updated machines (+${r.addedM} new, ${r.updatedM} updated)`);
    return;
  }
  // Full restore — photos first so state never points at missing photos
  await applyPhotos(obj.photos || {}, true);
  const keepSync = S.sync;
  S = migrate(obj.state); S.setupDone = true;
  if (!S.sync.token && keepSync.token && (!S.sync.url || S.sync.url === keepSync.url)) { S.sync.url = keepSync.url; S.sync.token = keepSync.token; }
  persist(); await refreshSnapCount(); go('#/today');
  toast(`Restored ${(obj.state.sessions || []).length} sessions`);
}
async function undoLastImport(opts = {}) {
  const quiet = !!opts.quiet;
  const list = await loadImportSnaps();
  if (!list.length) return toast('Nothing to undo');
  const snap = list[0];
  const when = new Date(snap.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const isCatalog = snap.kind === 'catalog' || /catalog update/i.test(snap.label || '');
  if (!quiet) {
    const msg = isCatalog
      ? `Undoes the last machine-catalog update from ${when}. Your logged workouts are kept.`
      : `Restores the phone to how it was ${when} (${snap.label || 'snapshot'}). Workouts logged after that snapshot would be replaced.`;
    if (!await confirmSheet('Undo last import?', msg, 'Undo import', 'bad')) return;
  }
  list.shift();
  if (isCatalog) {
    // Catalog undo must NEVER wipe sessions or phone-added machines logged after the auto-merge.
    const keepSessions = S.sessions, keepAdvice = S.advice, keepSync = S.sync, keepSettings = S.settings, keepLastExport = S.lastExport;
    const keepExercises = S.exercises;
    if (Object.keys(snap.photos || {}).length) await applyPhotos(snap.photos, false);
    S = migrate(snap.state);
    S.sessions = keepSessions; S.advice = keepAdvice; S.sync = keepSync; S.settings = keepSettings; S.lastExport = keepLastExport;
    // Re-attach any phone-only exercises/machines that the snapshot predates.
    Object.values(keepExercises || {}).forEach(ex => {
      if (!S.exercises[ex.id]) { S.exercises[ex.id] = ex; return; }
      (ex.machines || []).forEach(m => {
        if (!S.exercises[ex.id].machines.find(x => x.id === m.id)) S.exercises[ex.id].machines.push(m);
      });
    });
  } else {
    await applyPhotos(snap.photos || {}, true);
    S = migrate(snap.state);
  }
  S.setupDone = !!S.setupDone || Object.keys(S.exercises).length > 0;
  if (snap.catalogVersion) S.lastAppliedCatalogVersion = snap.catalogVersion;
  persist(); await saveImportSnaps(list); go('#/today');
  if (!quiet) toast(isCatalog ? 'Catalog update undone (workouts kept)' : 'Import undone');
}

/* ---------------- Auto catalog sync (published catalog.json) ---------------- */
let catalogCheckInFlight = false;
const CATALOG_URL = 'catalog.json';

async function fetchPublishedCatalog() {
  const url = `${CATALOG_URL}?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error('catalog HTTP ' + res.status);
  const obj = await res.json();
  if (!obj || obj.app !== 'liftlog' || !obj.state) throw new Error('not a liftlog catalog');
  return obj;
}

async function applyPublishedCatalog(obj, { reason } = {}) {
  const ver = +obj.catalogVersion || 0;
  if (!ver) return false;
  // Lightweight catalog snapshot (no photos) — undo keeps workouts (see undoLastImport).
  await saveImportSnapshot(reason === 'auto' ? 'before catalog update' : 'before update machines', { kind: 'catalog', skipPhotos: true });
  const list = await loadImportSnaps();
  if (list[0]) { list[0].catalogVersion = ver; await saveImportSnaps(list); }
  await applyPhotos(obj.photos || {}, false);
  const keptSessions = S.sessions;
  const keptAdvice = S.advice;
  const sessionCount = S.sessions.length;
  const entryCount = S.sessions.reduce((n, s) => n + (s.entries || []).length, 0);
  const r = mergeCatalog(obj.state);
  // Belt-and-suspenders: never allow a catalog apply to leave fewer workouts than before.
  if (S.sessions.length < sessionCount || S.sessions.reduce((n, s) => n + (s.entries || []).length, 0) < entryCount) {
    console.error('catalog merge tried to drop sessions — restored pre-merge workouts');
    S.sessions = keptSessions;
    S.advice = keptAdvice;
  }
  S.lastAppliedCatalogVersion = ver;
  S.setupDone = true;
  persist(); await refreshSnapCount();
  return r;
}

async function checkCatalogUpdate() {
  if (catalogCheckInFlight) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  catalogCheckInFlight = true;
  try {
    const obj = await fetchPublishedCatalog();
    const ver = +obj.catalogVersion || 0;
    const applied = +S.lastAppliedCatalogVersion || 0;
    if (!ver || ver <= applied) return { skipped: true, ver, applied };
    const r = await applyPublishedCatalog(obj, { reason: 'auto' });
    render();
    // CRITICAL: never pass an Undo callback here. Pre-2.4.6 toast Undo restored a pre-merge
    // snapshot and wiped any workouts / phone machines logged after the catalog update.
    toast('Machines updated');
    return { updated: true, ver, ...r };
  } catch (e) {
    // Offline / 404 / parse error: skip silently
    return { error: String(e && e.message || e) };
  } finally {
    catalogCheckInFlight = false;
  }
}
async function importAdvice(file) {
  if (!file) return;
  let arr; try { arr = JSON.parse(await file.text()); } catch (e) { return toast('Not a valid JSON file'); }
  if (arr && !Array.isArray(arr) && Array.isArray(arr.advice)) arr = arr.advice;
  if (!Array.isArray(arr)) return toast('Expected a JSON array of advice');
  const added = mergeAdvice(arr, 'file');
  const names = new Set(Object.values(S.exercises).map(e => e.name.toLowerCase()));
  const matched = arr.filter(a => a && names.has(String(a.exercise || '').trim().toLowerCase())).length;
  persist(); render(); toast(`Imported ${added} advice note${added === 1 ? '' : 's'} (${matched} match your exercises)`);
}
function adviceKey(a) { return [a.exercise, a.machine || '', a.note, a.date || ''].map(x => String(x || '').trim().toLowerCase()).join('|'); }
function mergeAdvice(arr, source) {
  let added = 0; const have = new Set(S.advice.map(adviceKey));
  arr.forEach(a => {
    if (!a || !a.exercise || !a.note) return;
    const item = { id: uid(), exercise: String(a.exercise).trim(), machine: a.machine ? String(a.machine).trim() : '', note: String(a.note).trim(), date: a.date ? String(a.date).slice(0, 10) : '', source, dismissed: false };
    const k = adviceKey(item); if (have.has(k)) return; have.add(k); S.advice.push(item); added++;
  });
  return added;
}
function needsBackup() {
  if (!S.sessions.some(s => s.entries.length)) return null;
  const ref = Math.max(S.lastExport || 0, S.sync.last || 0, S.created || 0);
  const days = Math.floor((Date.now() - ref) / DAY_MS);
  return Date.now() - ref > 7 * DAY_MS ? { days, never: !S.lastExport && !S.sync.last } : null;
}

/* ---------------- Sync to Google Sheet (Apps Script web app) ---------------- */
let syncing = false, syncTimer = null, retryDelay = 30000, syncAgain = false;
const syncRedirty = new Set(); // ids changed while a push was in flight: keep them queued
/* Push now (e.g. wrap-up saved). Offline → stays queued and goes out when the phone is back online. */
function syncSoon() {
  if (!S.sync.url || !S.sync.token) return false;
  if (!navigator.onLine) { S.sync.err = 'offline — queued'; persist(); return false; }
  syncNow(); return true;
}
function scheduleSync(delay = 4000) {
  if (!S.sync.url || !S.sync.token) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), delay);
}
async function syncNow(opts = {}) {
  const sy = S.sync; if (!sy.url || !sy.token) return;
  if (syncing) { syncAgain = true; return; }
  if (!navigator.onLine && !opts.force) { sy.err = 'offline — will retry'; return; }
  syncing = true; syncAgain = false; syncRedirty.clear();
  const dirty = sy.dirty.slice(), deleted = sy.deleted.slice();
  const index = {}; S.sessions.forEach(s => s.entries.forEach(e => { index[e.id] = [s, e]; }));
  const upserts = dirty.filter(id => index[id]).map(id => Object.assign({ id }, entryRow(index[id][0], index[id][1])));
  const ps = pendingSessions();
  sy.lastAttempt = Date.now();
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; const to = setTimeout(() => ctl && ctl.abort(), 20000);
    const payload = JSON.stringify({ token: sy.token, app: 'liftlog', upserts, deletes: deleted, sessions: ps.ups.map(u => u.row), sessionDeletes: ps.dels, wantAdvice: true });
    // keepalive lets a small push survive the app being backgrounded; if cut off, the queue is re-sent later (upserts are idempotent)
    const res = await fetch(sy.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctl && ctl.signal,
      keepalive: !!opts.hidden && payload.length < 60000, body: payload });
    clearTimeout(to);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const out = await res.json();
    if (!out || !out.ok) throw new Error((out && out.error) || 'Sync rejected');
    const d = new Set(dirty), x = new Set(deleted);
    sy.dirty = sy.dirty.filter(i => !d.has(i) || syncRedirty.has(i)); sy.deleted = sy.deleted.filter(i => !x.has(i) || syncRedirty.has(i));
    // only mark session rows synced when the script understood them (an older Code.gs without a Sessions tab ignores them)
    if (typeof out.sessionsUpserted === 'number') { sy.note = ''; ps.ups.forEach(u => { sy.sesHash[u.row.session_id] = u.k; }); ps.dels.forEach(id => { delete sy.sesHash[id]; }); }
    else if (ps.ups.length || ps.dels.length) sy.note = 'Update Code.gs to sync the Sessions tab';
    sy.last = Date.now(); sy.err = ''; retryDelay = 30000;
    if (Array.isArray(out.advice)) mergeAdvice(out.advice, 'sheet');
    persist();
    const more = typeof out.sessionsUpserted === 'number' && (pendingSessions().ups.length || pendingSessions().dels.length);
    if (sy.dirty.length || sy.deleted.length || more) scheduleSync(1000);
  } catch (e) {
    sy.err = (e && e.name === 'AbortError') ? 'timed out' : String(e && e.message || e);
    persist(); clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), retryDelay); retryDelay = Math.min(retryDelay * 2, 600000);
  } finally {
    syncing = false; syncRedirty.clear();
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
    const el = $('#sync-status'); if (el) el.innerHTML = syncStatusHTML();
  }
}
/* ---- Restore from Google Sheet: pull all rows (needs Code.gs ≥2.5.2) and MERGE by id. Local data always wins. ---- */
async function fetchSheetRows() {
  const sy = S.sync; let out = null;
  try {
    const res = await fetch(sy.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', body: JSON.stringify({ token: sy.token, app: 'liftlog', action: 'export' }) });
    if (res.ok) out = await res.json();
  } catch (e) { out = null; }
  if (!out || !Array.isArray(out.sets)) {
    const res = await fetch(sy.url + (sy.url.includes('?') ? '&' : '?') + 'action=export&token=' + encodeURIComponent(sy.token), { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    out = await res.json();
  }
  if (!out || !out.ok) throw new Error((out && out.error) || 'Sheet said no');
  if (!Array.isArray(out.sets)) throw new Error('Update Code.gs in your sheet (needs the Restore version)');
  return out;
}
function mergeSheetRows(data) {
  const r = { sets: 0, sessions: 0, wraps: 0, kept: 0, skipped: 0 };
  const have = new Set(); S.sessions.forEach(s => s.entries.forEach(e => have.add(e.id)));
  const gone = new Set(S.sync.deleted || []);
  const str = v => v == null ? '' : String(v).trim();
  const num = v => v === '' || v == null || isNaN(+v) ? null : +v;
  const day = v => { const d = str(v).slice(0, 10); return /^\d{4}-\d\d-\d\d$/.test(d) ? d : null; };
  const split = v => str(v) ? str(v).split(/;\s*/).filter(Boolean) : [];
  const tplFor = (id, name) => {
    if (id && tplById(id)) return id;
    const nm = TPL_RENAME[str(name).toLowerCase()] || str(name); if (!nm) return null;
    let t = S.templates.find(x => normName(x.name) === normName(nm));
    if (!t) { t = { id: id || uid(), name: nm, kind: 'strength', exIds: [] }; S.templates.push(t); }
    return t.id;
  };
  const exFor = row => {
    if (row.exercise_id && exById(str(row.exercise_id))) return exById(str(row.exercise_id));
    const nm = str(row.exercise) || 'Exercise';
    const all = Object.values(S.exercises).filter(e => normName(e.name) === normName(nm));
    return all.find(e => !e.archived) || all[0] || createExercise(nm, row.type === 'cardio' ? 'cardio' : 'strength');
  };
  const machFor = (ex, row) => {
    if (row.machine_id && machById(ex, str(row.machine_id))) return machById(ex, str(row.machine_id));
    const nm = str(row.machine);
    let m = nm ? ex.machines.find(x => normName(x.name) === normName(nm)) : ex.machines[0];
    if (!m) { m = { id: str(row.machine_id) || uid(), name: nm || 'Machine', base: str(row.base_weight) === '' ? null : +row.base_weight || 0, bu: str(row.unit) || 'lb', gym: /^austin$/i.test(str(row.gym)) ? 'Lakeway' : str(row.gym), loc: '', cues: '', caution: '' }; ex.machines.push(m); }
    return m;
  };
  const created = new Set();
  const sessionFor = (sid, date, tid, mode) => {
    let s = sid && sesById(sid);
    if (!s) s = S.sessions.find(x => x.date === date && x.tid === tid);
    if (!s) { s = { id: sid || uid(), date, tid, mode: mode === 'coach' ? 'coach' : 'solo', repeatFrom: null, exIds: [], entries: [], thoughts: {}, created: Date.now() }; S.sessions.push(s); created.add(s.id); }
    return s;
  };
  (data.sets || []).forEach((row, i) => {
    const id = str(row.id); const date = day(row.date);
    if (!id || !date) { r.skipped++; return; }
    if (have.has(id) || gone.has(id)) { r.kept++; return; }
    const ex = exFor(row); const m = machFor(ex, row);
    const s = sessionFor(str(row.session_id), date, tplFor(str(row.template_id), row.template), str(row.mode));
    const kind = row.type === 'cardio' ? 'cardio' : 'set';
    const e = { id, kind, exId: ex.id, mId: m.id, diff: num(row.difficulty), tags: split(row.tags), note: str(row.note), ts: num(row.ts) || (pd(date).getTime() + 12 * 36e5 + i) };
    if (kind === 'set') {
      const base = str(row.base_weight) === '' ? null : +row.base_weight || 0;
      const add = num(row.added_weight) != null ? num(row.added_weight) : (num(row.weight) || 0) - (base || 0);
      Object.assign(e, { set: num(row.set) || nextSetNo(s, ex.id, m.id), add, base, w: base === null ? add : (num(row.weight) != null ? num(row.weight) : add + base), u: str(row.unit) || 'lb', reps: num(row.reps) || 0 });
      if (num(row.set_seconds)) e.secs = num(row.set_seconds);
    } else Object.assign(e, { dur: num(row.duration_min) || 0, dist: num(row.distance) || 0, du: str(row.distance_unit) || S.settings.distUnit, level: num(row.level) || 0 });
    s.entries.push(e); have.add(id); r.sets++;
    if (!s.exIds.includes(ex.id)) s.exIds.push(ex.id);
    if (str(row.thoughts) && !(s.thoughts || {})[ex.id]) s.thoughts[ex.id] = str(row.thoughts);
  });
  (data.sessions || []).forEach(row => {
    const sid = str(row.session_id); const date = day(row.date); if (!sid || !date) return;
    const hasWrap = row.session_difficulty !== '' && row.session_difficulty != null || row.energy !== '' && row.energy != null || str(row.chips) || str(row.thoughts);
    let s = sesById(sid) || S.sessions.find(x => x.date === date && x.tid === tplFor(str(row.template_id), row.template));
    if (!s) { if (!hasWrap) return; s = sessionFor(sid, date, tplFor(str(row.template_id), row.template), str(row.mode)); }
    if (hasWrap && !s.wrap) { s.wrap = { diff: num(row.session_difficulty) || 3, energy: num(row.energy) || 3, tags: split(row.chips), thoughts: str(row.thoughts), durMin: num(row.duration_min), ts: Date.now() }; r.wraps++; }
  });
  r.sessions = created.size;
  return r;
}
function syncStatusHTML() {
  const sy = S.sync; if (!sy.url || !sy.token) return 'Not set up';
  const ps = pendingSessions(); const pending = sy.dirty.length + sy.deleted.length + ps.ups.length + ps.dels.length;
  return `${sy.last ? 'Last synced ' + new Date(sy.last).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never synced'} · ${pending} pending${sy.note && !sy.err ? ` · ${esc(sy.note)}` : ''}${sy.err ? ` · <span style="color:var(--bad)">${esc(sy.err)}</span>` : ''}`;
}
window.addEventListener('online', () => scheduleSync(500));
window.addEventListener('pagehide', () => { if (S) persist(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { if (S) { persist(); if (S.sync.dirty.length || S.sync.deleted.length || pendingSessions().ups.length) syncNow({ hidden: true }); } }
  else {
    if (wakeWanted) setWake(true); // the OS drops wake locks when the page is hidden
    if (S) checkCatalogUpdate();
    checkForUpdate();
  }
});

/* ---------------- Screen wake lock ---------------- */
let wakeSentinel = null, wakeWanted = false, wakePending = false;
async function setWake(want) {
  wakeWanted = want;
  if (!want) { const s = wakeSentinel; wakeSentinel = null; if (s) { try { await s.release(); } catch (e) {} } return; }
  if (wakeSentinel || wakePending || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function' || document.visibilityState !== 'visible') return;
  wakePending = true;
  try {
    const s = await navigator.wakeLock.request('screen');
    if (!wakeWanted) { s.release().catch(() => {}); }
    else { wakeSentinel = s; s.addEventListener && s.addEventListener('release', () => { if (wakeSentinel === s) wakeSentinel = null; }); }
  } catch (e) { wakeSentinel = null; /* unsupported / denied: degrade silently */ }
  finally { wakePending = false; }
}

/* ---------------- Session actions ---------------- */
function newSessionLike(src, date) { // same template, given day; reused when switching / moving sets between days
  const t = tplById(src.tid);
  const exIds = t ? t.exIds.filter(id => exById(id) && !exById(id).archived) : (src.exIds || []).slice();
  const ses = { id: uid(), date, tid: src.tid, mode: src.mode || 'solo', repeatFrom: null, exIds, entries: [], thoughts: {}, created: Date.now() };
  S.sessions.push(ses); return ses;
}
const sessionOn = (src, date) => S.sessions.find(x => x.date === date && x.tid === src.tid && x !== src) || null;
const sesEmpty = s => !s.entries.length && !s.wrap && !Object.values(s.thoughts || {}).some(v => String(v || '').trim());
function pastGuardSes() {
  if (!curEx) return null; const s = sesById(curEx.sid);
  return s && s.date < todayStr() && pastOk !== s.date ? s : null;
}
function openPastGuard(ses, act) {
  PG = { sid: ses.id, exId: curEx.exId, date: ses.date, act };
  openSheet(`<div class="pastguard" data-testid="past-guard"><div class="pg-ico">📅</div>
    <h2 data-testid="past-guard-msg">You're logging for ${esc(fmtD(ses.date))} — not today.</h2>
    <div class="sub">Today is ${esc(fmtD(todayStr()))}.</div>
    <button class="btn pri" data-a="pg-today" data-testid="pg-today">Switch to today</button>
    <button class="btn" data-a="pg-keep" data-testid="pg-keep">Keep ${esc(fmtD(ses.date))}</button></div>`);
}
function switchToToday(sid, exId) {
  const src = sesById(sid); setWorkDate(null); if (!src) return go('#/today');
  const t = sessionOn(src, todayStr()) || newSessionLike(src, todayStr());
  if (!t.exIds.includes(exId)) t.exIds.push(exId);
  const k0 = draftKey(sid, exId), k1 = draftKey(t.id, exId); // carry the weight/reps/machine you were on
  if (P[k0] && !P[k1]) P[k1] = JSON.parse(JSON.stringify(P[k0]));
  persist(); go(`#/s/${t.id}/e/${exId}`); toast('Logging for today');
}
function startSession(tid, mode, repeatFrom) {
  const date = activeDate(); // sessions are keyed by date + template
  let ses = S.sessions.find(s => s.date === date && s.tid === tid);
  if (ses) { if (mode && ses.mode !== mode) { ses.mode = mode; markSessionDirty(ses); } persist(); return go(`#/s/${ses.id}`); }
  const t = tplById(tid); let exIds = t.exIds.filter(id => exById(id) && !exById(id).archived);
  if (repeatFrom) {
    const src = sesById(repeatFrom); const order = [];
    src.entries.slice().sort((a, b) => a.ts - b.ts).forEach(e => { if (!order.includes(e.exId) && exById(e.exId) && !exById(e.exId).archived) order.push(e.exId); });
    exIds = order.concat(exIds.filter(id => !order.includes(id)));
  }
  ses = { id: uid(), date, tid, mode: mode || 'solo', repeatFrom: repeatFrom || null, exIds, entries: [], thoughts: {}, created: Date.now() };
  S.sessions.push(ses); persist();
  go(`#/s/${ses.id}`);
}
function repeatTarget(ses, exId) {
  if (!ses.repeatFrom) return null; const src = sesById(ses.repeatFrom); if (!src) return null;
  const ents = src.entries.filter(e => e.exId === exId).sort((a, b) => a.ts - b.ts); if (!ents.length) return null;
  const last = ents[ents.length - 1];
  return { src, mId: last.mId, ents: ents.filter(e => e.mId === last.mId).sort((a, b) => (a.set || 0) - (b.set || 0)) };
}
const prevSoloSource = (tid, date) => sortedSessions().find(s => s.tid === tid && s.date < date && s.entries.length);

/* ---------------- View: Today ---------------- */
function dateSwitcher(date) {
  const t0 = todayStr(), y = daysAgo(1); const earlier = date < y;
  return `<div class="datebar" data-testid="datebar">
    <button class="chip sm ${date === t0 ? 'on' : ''}" data-a="pick-date" data-d="${t0}" data-testid="date-today">Today</button>
    <button class="chip sm ${date === y ? 'on' : ''}" data-a="pick-date" data-d="${y}" data-testid="date-yesterday">Yesterday</button>
    <button class="chip sm ${earlier ? 'on' : ''}" data-a="date-earlier" data-testid="date-earlier">${earlier ? esc(fmtD(date)) + ' ▾' : 'Earlier…'}</button></div>`;
}
function openEarlierSheet() {
  const sel = activeDate();
  const days = [...Array(14)].map((_, i) => daysAgo(13 - i)); // oldest → today, 2 rows of 7
  const cells = days.map(ds => { const n = S.sessions.filter(s => s.date === ds).reduce((a, s) => a + s.entries.length, 0); const dd = pd(ds);
    return `<button class="dcell ${ds === sel ? 'on' : ''} ${n ? 'has' : ''}" data-a="pick-date" data-d="${ds}" data-testid="day-${ds}"><span>${DOW[dd.getDay()].slice(0, 3)}</span><b>${dd.getDate()}</b><i>${n ? '●' : ''}</i></button>`; }).join('');
  openSheet(`<h2>Log for which day?</h2><div class="sub" style="margin-bottom:10px">Last 14 days · ● has entries</div>
    <div class="dgrid" data-testid="day-grid">${cells}</div>
    <div style="height:12px"></div><button class="btn ghost" data-a="sheet-cancel">Cancel</button>`);
}
function viewToday() {
  const date = activeDate(); const d = pd(date); const isPast = date !== todayStr(); const sch = S.schedule[d.getDay()]; const t = sch.t && tplById(sch.t);
  const todays = S.sessions.filter(s => s.date === date);
  const nb = needsBackup();
  const reminder = nb ? `<div class="card warn" data-testid="backup-reminder"><b>💾 ${nb.never ? `No backup in ${nb.days} days` : `Last backup ${nb.days} days ago`}</b>
    <div class="sub" style="margin:4px 0 10px">Your log lives only on this phone. Save a copy (Files, iCloud, email) or set up sync.</div>
    <div class="row"><button class="btn sm pri" data-a="share-json">Share backup</button><button class="btn sm" data-a="export-json">Download</button></div></div>` : '';
  let hero = '';
  if (t) {
    const prev = sch.m === 'solo' ? prevSoloSource(t.id, date) : null;
    const existing = todays.find(s => s.tid === t.id);
    const nEx = t.exIds.filter(id => exById(id) && !exById(id).archived).length;
    hero = `<div class="card hero" data-testid="suggest"><div class="sub">${isPast ? esc(fmtD(date)) + "'s plan" : "Today's plan"} · ${esc(DOW[d.getDay()])}</div><h1 style="margin:2px 0 6px">${esc(t.name)}</h1>
      <div class="row" style="margin-bottom:14px"><span class="pill ${sch.m}">${sch.m === 'coach' ? 'With coach' : 'Solo'}</span>
      ${prev && !existing ? `<span class="sub">repeat day</span>` : ''}${!nEx ? '<span class="sub">no exercises yet</span>' : ''}</div>
      ${existing ? `<a class="btn pri" href="#/s/${existing.id}">Continue ${esc(t.name)} · ${existing.entries.length} logged</a>` :
        prev ? `<button class="btn pri" data-a="repeat" data-sid="${prev.id}" data-t="${t.id}" data-testid="repeat">Repeat ${esc(dowName(prev.date))}'s ${esc(t.name)}</button>
                <div class="sub" style="text-align:center;margin:6px 0 4px">${esc(fmtD(prev.date))} · ${prev.mode === 'coach' ? 'with coach' : 'solo'} · ${(n => `${n} exercise${n === 1 ? '' : 's'}`)(new Set(prev.entries.map(e => e.exId)).size)}</div>
                <button class="btn" data-a="start" data-t="${t.id}" data-m="${sch.m}">Open fresh ${esc(t.name)}</button>` :
        nEx ? `<button class="btn pri" data-a="start" data-t="${t.id}" data-m="${sch.m}" data-testid="start-suggested">Open ${esc(t.name)}</button>`
            : `<a class="btn pri" href="#/setup/days">Add exercises to ${esc(t.name)}</a>`}</div>`;
  } else {
    hero = `<div class="card hero" data-testid="suggest"><div class="sub">${isPast ? esc(fmtD(date)) + "'s plan" : "Today's plan"} · ${esc(DOW[d.getDay()])}</div><h1 style="margin:2px 0 6px">Rest day</h1><div class="sub">Nothing scheduled. Pick any workout below.</div></div>`;
  }
  const others = todays.filter(s => !t || s.tid !== t.id);
  const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const week = [...Array(7)].map((_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); const ds = ymd(x); const sc = S.schedule[x.getDay()];
    const done = S.sessions.some(s => s.date === ds && s.entries.length);
    return `<div class="${ds === todayStr() ? 'today' : ''} ${ds === date && isPast ? 'sel' : ''} ${done ? 'done' : ''}">${DOW[x.getDay()].slice(0, 3)}<b>${esc(shortTpl(sc.t && tplById(sc.t)))}</b>${sc.t ? (sc.m === 'coach' ? 'coach' : 'solo') : '&nbsp;'}</div>`; }).join('');
  return `${dateSwitcher(date)}${pastBanner(date)}
    ${isPast ? '' : `<div class="sub" style="margin-top:6px">${esc(fmtDLong(date))}</div>`}
    <div id="update-slot"></div>${isPast ? '' : reminder}
    ${hero}
    ${others.map(s => `<a class="li" href="#/s/${s.id}"><div><div class="t">Continue ${esc((tplById(s.tid) || {}).name)}</div><div class="s">${s.entries.length} entries logged ${esc(dayWordLc(date))}</div></div></a>`).join('')}
    <h3>This week</h3><div class="week">${week}</div>
    <h3>Other workouts</h3>
    <div class="list">${S.templates.map(x => `<button class="li" data-a="start" data-t="${x.id}" data-m="${sch.t === x.id ? sch.m : 'solo'}" data-testid="tpl-${x.id}"><div><div class="t">${esc(x.name)}</div><div class="s">${(n => n === 0 ? 'No exercises yet — add in Setup' : n === 1 ? '1 exercise' : n + ' exercises')(x.exIds.filter(id => exById(id) && !exById(id).archived).length)}</div></div></button>`).join('')}</div>`;
}

/* ---------------- View: Session ---------------- */
function viewSession(sid) {
  const ses = sesById(sid); if (!ses) return `<div class="empty">Session not found. <a href="#/today">Back</a></div>`;
  const t = tplById(ses.tid) || { name: 'Workout' }; const src = ses.repeatFrom && sesById(ses.repeatFrom);
  const rows = ses.exIds.filter(exById).map(exId => {
    const ex = exById(exId); let badge = '<span class="badge">—</span>', sub = '';
    if (ex.kind === 'cardio') {
      const c = cardioOf(ses, exId);
      if (c.length) { badge = `<span class="badge done">✓ ${c.reduce((a, e) => a + e.dur, 0)} min</span>`; sub = `${esc(dayWord(ses.date))}: ${c.map(cardioSummary).join(', ')}`; }
      else { const l = lastFor(exId, null, ses.id); sub = l ? `Last: ${lastLine(l)}` : 'No history yet'; }
    } else {
      const sets = setsOf(ses, exId);
      if (sets.length) {
        badge = `<span class="badge ${sets.length >= 3 ? 'done' : 'part'}">${sets.length >= 3 ? '✓ ' : ''}${sets.length} set${sets.length > 1 ? 's' : ''}</span>`;
        const ordered = sets.slice().sort((a, b) => a.ts - b.ts || a.set - b.set);
        const mNames = [...new Set(ordered.map(e => machName(exId, e.mId)))];
        sub = `${esc(dayWord(ses.date))}: ${compactSets(ordered)}${mNames.length ? ' · ' + mNames.map(esc).join(', ') : ''}`;
      } else {
        const tg = repeatTarget(ses, exId);
        if (tg) sub = `Target: ${esc(machName(exId, tg.mId))} · ${compactSets(tg.ents)}`;
        else { const m = recentMachine(ex, ses.date); const l = m && lastFor(exId, m.id, ses.id); sub = l ? `Last: ${esc(m.name)} · ${esc(lastLine(l))}` : 'No history yet'; }
      }
    }
    return `<a class="li" href="#/s/${ses.id}/e/${exId}" data-testid="ex-row" data-ex="${exId}"><div class="grow"><div class="t">${esc(ex.name)}${ex.pinned ? ' ⚠️' : ''}</div><div class="s">${sub}</div></div>${badge}</a>`;
  }).join('');
  return `<div class="top"><a class="back" href="#/today">‹ ${ses.date === todayStr() ? 'Today' : 'Day'}</a></div>${pastBanner(ses.date)}
    <h1>${esc(t.name)}</h1><div class="sub">${esc(fmtDLong(ses.date))}${src ? ` · repeating ${esc(fmtD(src.date))}` : ''}</div>
    <div style="margin:14px 0" data-testid="mode">${seg('mode', [['coach', 'With coach'], ['solo', 'Solo']], ses.mode, `data-sid="${ses.id}"`)}</div>
    <div class="list">${rows || '<div class="empty">No exercises in this template yet. Add some in Setup, or below.</div>'}</div>
    <button class="btn ghost" data-a="add-ex-session" data-sid="${ses.id}">＋ Add exercise to this session</button>
    <button class="btn pri" data-a="finish" data-sid="${ses.id}" data-testid="finish">Done for today</button>`;
}

/* ---------------- View: Workout wrap-up ---------------- */
let W = null, wrapReturn = '#/today';
function scalePicker(key, labels, testid) {
  const v = W[key];
  return `<div class="diffval d${key === 'energy' ? 6 - v : v}" id="sv-${key}" data-testid="${testid}-value"><b>${v}</b> ${esc(labels[v])}</div>
  <input type="range" min="1" max="5" step="1" value="${v}" data-i="wscale" data-k="${key}" aria-label="${key}" data-testid="${testid}-slider">
  <div class="ticks5">${[1, 2, 3, 4, 5].map(n => `<button data-a="wscale" data-k="${key}" data-v="${n}" class="${n === v ? 'on' : ''}">${n}</button>`).join('')}</div>`;
}
function updateScaleUI(key) {
  const labels = key === 'diff' ? WRAP_DIFF : WRAP_ENERGY; const v = W[key]; const el = $(`#sv-${key}`);
  if (el) { el.className = `diffval d${key === 'energy' ? 6 - v : v}`; el.innerHTML = `<b>${v}</b> ${esc(labels[v])}`; }
  const sl = $(`input[data-i="wscale"][data-k="${key}"]`); if (sl && document.activeElement !== sl) sl.value = v;
  $$(`.ticks5 button[data-k="${key}"]`).forEach(b => b.classList.toggle('on', +b.dataset.v === v));
}
function viewWrap(sid) {
  const s = sesById(sid); if (!s) return `<div class="empty">Session not found. <a href="#/today">Back</a></div>`;
  if (!W || W.sid !== sid) { const w = s.wrap || {}; W = { sid, diff: w.diff || 3, energy: w.energy || 3, tags: (w.tags || []).slice(), thoughts: w.thoughts || '', durMin: w.durMin != null ? w.durMin : autoDurMin(s) }; }
  const sm = Object.assign(sessionSummary(s), { durMin: W.durMin });
  const per = groupEntries(s).map(g => `${esc(exName(g.e[0].exId))}: ${g.e[0].kind === 'cardio' ? g.e.map(cardioSummary).join(', ') : compactSets(g.e)}`).join('<br>');
  return `<div class="top"><a class="back" href="${wrapReturn.startsWith('#/h/') ? wrapReturn : `#/s/${s.id}`}">‹ Back</a></div>
    <h1>Workout wrap-up</h1><div class="sub">${esc((tplById(s.tid) || {}).name || 'Workout')} · ${esc(fmtDLong(s.date))}</div>
    <div class="card" data-testid="wrap-summary"><div class="wsum">
      <div><b>${sm.exercises}</b><span>exercise${sm.exercises === 1 ? '' : 's'}</span></div><div><b>${sm.sets}</b><span>set${sm.sets === 1 ? '' : 's'}</span></div>
      <div><b>${fmtNum(sm.volume)}</b><span>${sm.unit} volume</span></div><div><b>${s.mode === 'coach' ? 'Coach' : 'Solo'}</b><span>session</span></div></div>
      <div class="row" style="margin-top:12px"><span class="sub grow">Duration</span>
        <button class="step sm" data-a="wdur" data-d="-5" aria-label="minus 5 min">−</button><b class="wdur" data-testid="wrap-duration">${W.durMin} min</b><button class="step sm" data-a="wdur" data-d="5" aria-label="plus 5 min">+</button></div>
      ${sm.cardioMin ? `<div class="fine">+ ${sm.cardioMin} min cardio</div>` : ''}
      ${per ? `<div class="fine" style="margin-top:8px">${per}</div>` : ''}</div>
    <h3>Overall session difficulty</h3>${scalePicker('diff', WRAP_DIFF, 'wrap-diff')}
    <h3>Energy level</h3>${scalePicker('energy', WRAP_ENERGY, 'wrap-energy')}
    <h3>Quick tags</h3><div class="chips" data-testid="wrap-chips">${WRAP_CHIPS.map(t => `<button class="chip sm ${W.tags.includes(t) ? 'on' : ''}" data-a="wtag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <h3>Thoughts about today (optional)</h3><textarea class="thoughts" rows="3" data-i="wrap-thoughts" data-testid="wrap-thoughts" placeholder="How did it go? Anything to remember next time?">${esc(W.thoughts)}</textarea>
    <div style="height:12px"></div><button class="btn pri" data-a="wrap-save" data-testid="wrap-save">${s.wrap ? 'Save changes' : 'Save wrap-up'}</button>
    <button class="btn ghost" data-a="wrap-skip" data-testid="wrap-skip">${s.wrap ? 'Cancel' : 'Skip for now'}</button>`;
}
const wrapLine = w => [w.diff ? `difficulty ${w.diff} (${WRAP_DIFF[w.diff].toLowerCase()})` : '', w.energy ? `energy ${w.energy} (${WRAP_ENERGY[w.energy].toLowerCase()})` : '', ...(w.tags || [])].filter(Boolean).join(' · ');

/* ---------------- Base weight prompt (machines imported without a base) ---------------- */
const baseLater = new Set();   // machines whose inline reminder was dismissed this app run ("base not set — tap to add" stays)
let BS = null;
function baseSheetHTML() {
  const ex = exById(BS.exId), m = machById(ex, BS.mId); const kg = unit() === 'kg'; const bases = kg ? BASE_CHIPS_KG : BASE_CHIPS_LB;
  const st = kg ? 2.5 : 5, max = kg ? 90 : 200; const all = []; for (let v = 0; v <= max + 1e-9; v = round1(v + st)) all.push(v);
  const on = v => BS.v !== null && Math.abs(BS.v - v) < 1e-6;
  const isOther = BS.other || (BS.v !== null && !bases.some(b => Math.abs(b - BS.v) < 1e-6));
  return `<h2>Base weight for ${esc(m.name)}</h2>
    <div class="sub">Plate numbers (what your coach writes down) are the <b>added</b> weight. The base is the bar / sled / carriage
      weight; 0 for weight stacks and dumbbells. You can change it any time.</div>
    <div class="bigval" style="font-size:34px;margin:10px 0" data-testid="bs-value">${BS.v === null ? 'Not set' : `${fmtW(BS.v)}<small>${unit()}</small>`}</div>
    <div class="chips" data-testid="bs-chips">${bases.map(b => `<button class="chip ${on(b) && !isOther ? 'on' : ''}" data-a="bs-chip" data-v="${b}">${fmtW(b)}</button>`).join('')}
      <button class="chip ${isOther ? 'on' : ''}" data-a="bs-other" data-testid="bs-other">Other…</button></div>
    ${isOther ? `<div class="wscroll" data-p="bs" data-testid="bs-scroll">${all.map(v => `<button class="chip ${on(v) ? 'on' : ''}" data-a="bs-chip" data-o="1" data-v="${v}">${fmtW(v)}</button>`).join('')}</div>` : ''}
    <div style="height:12px"></div>${BS.v !== null ? `<button class="btn pri" data-a="bs-save" data-testid="bs-save">Save base ${fmtW(BS.v)} ${unit()}</button>` : ''}
    <button class="btn ghost" data-a="bs-later" data-testid="bs-later">Not sure / later</button>`;
}
function openBaseSheet(exId, mId) { const m = machById(exById(exId), mId); if (!m) return; BS = { exId, mId, v: noBase(m) ? null : baseOf(m), other: false }; showBaseSheet(); }
function showBaseSheet() {
  openSheet(baseSheetHTML());
  const sc = $('#sheet-root .wscroll'); if (sc) { const c = sc.querySelector('.chip.on') || sc.querySelector('.chip'); sc.scrollLeft = c.offsetLeft - sc.clientWidth / 2 + c.offsetWidth / 2; }
}
// Base reminder: keep quiet — the weight picker's "Set base" line is enough (no big card on the set screen).
const baseReminder = m => '';

/* ---------------- View: Exercise (one exercise per full screen) ---------------- */
let curEx = null;        // {sid, exId}
let pendingDone = null;  // set finished in locked mode, awaiting confirmation
let lock = null;         // active locked set
const draftKey = (sid, exId) => `ex-${sid}-${exId}`;
function initDraft(ses, ex, mId) {
  const p = draftKey(ses.id, ex.id); const old = P[p]; const m = machById(ex, mId);
  if (old && old.mId === mId) { if (ex.kind !== 'cardio') { old.base = baseOf(m); old.noBase = noBase(m); } return p; }
  const d = { mId, diff: 3, tags: [] };
  if (ex.kind === 'cardio') {
    const today = cardioOf(ses, ex.id).filter(e => e.mId === mId); const l = lastFor(ex.id, mId, ses.id);
    const ref = today[today.length - 1] || (l && !l.seed && lastEnt(l));
    d.dur = ref ? ref.dur : 20; d.dist = ref ? round1(ref.dist || 0) : 0; d.level = ref ? (ref.level || 0) : 0;
  } else {
    d.base = baseOf(m); d.noBase = noBase(m);
    const today = setsOf(ses, ex.id, mId); const l = lastFor(ex.id, mId, ses.id); const tg = repeatTarget(ses, ex.id);
    const ref = today[today.length - 1] || (tg && tg.mId === mId && tg.ents[tg.ents.length - 1]) || lastEnt(l);
    {
      const raw = ref ? Math.max(0, (ref.base === null ? round1(conv(ref.add || 0, ref.u || 'lb', unit())) : dispW(ref)) - d.base) : 0;
      const mchips = m && m.weightChips && m.weightChips.length ? m.weightChips.map(c => round1(conv(+c, m.chipBu || 'lb', unit()))) : null;
      d.add = mchips ? snapToChips(raw, mchips) : snap(raw);
    }
    d.reps = today.length ? today[today.length - 1].reps : S.settings.defaultReps;
  }
  P[p] = d; return p;
}
function cuesHTML(ex, m) {
  const c = [ex.cues, m && m.cues].filter(Boolean).join(' · ');
  return c ? `<div class="fine" data-testid="cues">🧠 Cues: ${esc(c)}</div>` : '';
}
const machFine = m => [m.gym ? `📍${m.gym}` : '', m.loc].filter(Boolean).map(esc).join(' · ');
function headsUp(ses, ex) {
  const parts = [];
  if (ex.pinned) parts.push(`<div class="card" style="border-color:#7a5a12;background:#2a2210" data-testid="pinned"><div class="row"><b>⚠️ Caution (pinned)</b>
    <button class="chip sm right" data-a="unpin" data-ex="${ex.id}">Unpin</button></div><div style="margin-top:6px;font-size:17px">${esc(ex.pinned)}</div></div>`);
  const l = lastFor(ex.id, null, ses.id);
  if (l && !l.seed) {
    const maxD = Math.max(0, ...l.ents.map(e => e.diff || 0));
    const notes = [...new Set([(l.ses.thoughts || {})[ex.id], ...l.ents.map(e => e.note)].map(n => (n || '').trim()).filter(Boolean))];
    const tags = [...new Set(l.ents.flatMap(e => e.tags || []))];
    if (maxD >= 4 || notes.length || tags.length) {
      parts.push(`<div class="card" style="border-color:#7a2f2f;background:#2a1414" data-testid="headsup"><b>Heads up — last time (${esc(fmtD(l.date))})</b>
        <div style="margin-top:8px;font-size:16px;display:flex;flex-wrap:wrap;gap:6px">${maxD >= 4 ? `<span class="pill" style="background:#5a1f1f;color:#ffb3b3">difficulty ${maxD} · ${esc(DIFF_SHORT[maxD])}</span>` : ''}
        ${tags.map(t => `<span class="pill">${esc(t)}</span>`).join('')}</div>
        ${notes.map(n => `<div class="row" style="margin-top:8px"><span class="grow" style="font-size:17px">“${esc(n)}”</span>${ex.pinned === n ? '' : `<button class="chip sm" data-a="pin-note" data-ex="${ex.id}" data-v="${esc(n)}">📌 Pin</button>`}</div>`).join('')}</div>`);
    }
  }
  return parts.join('');
}
function adviceFor(ex, mId) {
  const m = machById(ex, mId); const n = s => String(s || '').trim().toLowerCase();
  const list = S.advice.filter(a => !a.dismissed && n(a.exercise) === n(ex.name) && (!a.machine || (m && n(a.machine) === n(m.name))));
  if (!list.length) return '';
  return `<div data-testid="advice" style="margin:8px 0">${list.map(a => `<div class="row" style="font-size:12px;color:var(--mut);padding:4px 0"><span class="grow"><b>Advice</b>${a.date ? ` (${esc(a.date)})` : ''}${a.machine ? ` · ${esc(a.machine)}` : ''}: ${esc(a.note)}</span>
    <button class="chip sm" data-a="dismiss-advice" data-id="${a.id}" style="min-height:34px">Dismiss</button></div>`).join('')}</div>`;
}
function machineGrid(ses, ex, mId, mode = 'grid') {
  const cards = sortedMachines(ex).map(x => {
    const todayN = ses ? setsOf(ses, ex.id, x.id).length : 0;
    const l = lastFor(ex.id, x.id, ses ? ses.id : null);
    const lastTxt = todayN ? `${ses.date === todayStr() ? 'today' : 'this day'}: ${compactSets(setsOf(ses, ex.id, x.id))}` : (l ? lastLine(l) : 'no history yet');
    return `<button class="mcard ${x.id === mId ? 'on' : ''}" data-a="mach" data-m="${x.id}" data-testid="mcard">
      <span class="mn">${esc(x.name)}</span><span class="ml" data-testid="mcard-last">${esc(lastTxt)}</span>
      ${machFine(x) ? `<span class="mf">${machFine(x)}</span>` : ''}${x.caution ? `<span class="mf mcaut" data-testid="mcard-caution">⚠️ ${esc(x.caution)}</span>` : ''}</button>`; }).join('');
  const add = `<button class="mcard add" data-a="new-mach" data-ex="${ex.id}"><span class="mn">＋ New</span><span class="ml">machine</span></button>`;
  if (mode === 'strip') return `<div class="mstrip" data-testid="machines">${cards}${add}</div>`;
  return `<div class="mgrid" data-testid="machines">${cards}${add}</div>`;
}
function viewExercise(sid, exId) {
  const ses = sesById(sid); const ex = exById(exId); if (!ses || !ex) return `<div class="empty">Not found. <a href="#/today">Back</a></div>`;
  curEx = { sid, exId };
  if (pendingDone && pendingDone.sid === sid && pendingDone.exId === exId) return viewConfirm(ses, ex);
  let p = P[draftKey(sid, exId)] ? draftKey(sid, exId) : null;
  let mId = p ? P[p].mId : null;
  if (!mId) {
    if (ex.machines.length === 1) mId = ex.machines[0].id;
    else { const todays = ses.entries.filter(e => e.exId === exId); if (todays.length) mId = todays[todays.length - 1].mId; }
  }
  if (mId && !machById(ex, mId)) mId = null;
  if (mId) p = initDraft(ses, ex, mId);
  const m = machById(ex, mId);
  const recent = recentMachine(ex, ses.date); const recentL = recent && lastFor(ex.id, recent.id, null, ses.date);
  const tg = repeatTarget(ses, exId);
  let body = '';
  if (!m) {
    body = todaySetsHTML(ses, ex)
      + (recent && recentL ? `<div class="card lastm" data-testid="last-machine"><div class="sub">Last machine used</div>
        <div class="lm-name">${esc(recent.name)}</div><div class="lm-val">${esc(lastLine(recentL, false))}</div>
        <div class="sub">${esc(fmtD(recentL.date))}${lastEnt(recentL).diff ? ' · ' + esc(DIFF_SHORT[lastEnt(recentL).diff]) : ''}</div>
        ${machFine(recent) ? `<div class="fine">${machFine(recent)}</div>` : ''}
        <button class="btn pri" style="margin-top:12px" data-a="mach" data-m="${recent.id}" data-testid="use-last-machine">Use ${esc(recent.name)}</button></div>`
      : ex.machines.length ? '' : `<div class="empty">No machines yet — add one (name, base weight, location…).</div>`)
      + (tg && tg.mId !== (recent && recent.id) ? `<div class="target">🎯 Repeat target (${esc(dowName(tg.src.date))}): ${esc(machName(exId, tg.mId))} <b>${compactSets(tg.ents)}</b></div>` : '')
      + `<h3>${recent ? 'Or pick a machine' : 'Pick a machine'}</h3>${machineGrid(ses, ex, null)}`;
  } else if (ex.kind === 'cardio') {
    const l = lastFor(exId, mId, sid); const today = cardioOf(ses, exId);
    body = `${ex.machines.length > 1 ? machineGrid(ses, ex, mId) : ''}
      ${l && !l.seed ? `<div class="last" data-testid="last"><span class="sub">Last time</span><b>${cardioSummary(lastEnt(l))}</b><span class="sub">${esc(fmtD(l.date))}${lastEnt(l).diff ? ' · difficulty ' + lastEnt(l).diff : ''}</span></div>` : '<div class="last" data-testid="last"><span class="sub">No previous entry for this activity</span></div>'}
      ${today.length ? `<h3>Logged ${esc(dayWordLc(ses.date))}</h3>${today.map(e => `<button class="entry" data-a="edit-entry" data-sid="${sid}" data-id="${e.id}" data-testid="cardio-entry"><span class="grow">${cardioSummary(e)}</span>✎</button>`).join('')}` : ''}
      ${cardioPicker(p)}<h3>Difficulty</h3>${diffPicker(p)}<h3>Quick notes</h3>${notePicker(p)}`;
  } else {
    const todayAll = setsOf(ses, exId);
    const todayHere = setsOf(ses, exId, mId);
    const l = lastFor(exId, mId, sid); const lastE = lastEnt(l);
    const goUp = lastE && lastE.diff && lastE.diff <= 2 ? `<span class="goup-inline" data-testid="go-up"><button class="chip sm" data-a="wstep" data-p="${p}" data-d="1">⬆ go up (+${step()})</button></span>` : '';
    let lastBlock;
    if (todayHere.length) {
      const lastToday = todayHere[todayHere.length - 1];
      lastBlock = `<div class="last last-prom" data-testid="last"><span class="sub">${ses.date === todayStr() ? 'Today' : esc(dayWord(ses.date))} on this machine</span>
        <b>${fmtTotal(dispW(lastToday))}${lastToday.reps ? ' × ' + lastToday.reps : ''}</b>
        <span class="sub">${compactSets(todayHere)}${lastToday.diff ? ' · d' + lastToday.diff : ''}</span>${goUp}</div>`;
    } else if (l) {
      lastBlock = `<div class="last last-prom" data-testid="last"><span class="sub">${l.seed ? 'Starting' : 'Last'} on this machine</span>
        <b>${fmtTotal(dispW(lastE))}${lastE.reps ? ' × ' + lastE.reps : ''}</b>
        <span class="sub">${esc(fmtD(l.date))}${l.seed ? '' : ' · ' + compactSets(l.ents)}${lastE.diff ? ' · d' + lastE.diff : ''}</span>
        ${goUp}</div>`;
    } else if (todayAll.length) {
      lastBlock = `<div class="last last-prom" data-testid="last"><span class="sub">No prior history on this machine — ${ses.date === todayStr() ? "today's" : "this day's"} ${todayAll.length} set${todayAll.length === 1 ? '' : 's'} ${todayAll.length === 1 ? 'is' : 'are'} listed above</span></div>`;
    } else {
      lastBlock = `<div class="last last-prom" data-testid="last"><span class="sub">No history on this machine yet</span></div>`;
    }
    // Today's sets (any machine) first so they are always editable; then last / weight / machines.
    body = `<div class="ex-log">
      ${todaySetsHTML(ses, ex)}
      ${lastBlock}
      ${tg && tg.mId === mId ? `<div class="target target-sm" data-testid="target">🎯 ${esc(dowName(tg.src.date))}: <b>${compactSets(tg.ents)}</b></div>` : ''}
      ${weightPicker(p, true)}
      ${repsPicker(p, (todayHere[todayHere.length - 1] || lastE) && (todayHere[todayHere.length - 1] || lastE).reps ? (todayHere[todayHere.length - 1] || lastE).reps : null, true)}
      <details class="more-log"><summary>Difficulty & notes</summary>
        <h3>Difficulty</h3>${diffPicker(p)}
        <h3>Quick notes</h3>${notePicker(p)}</details>
      <div class="sub mach-label">Machines</div>
      ${machineGrid(ses, ex, mId, 'strip')}
      </div>`;
  }
  return `<div class="top"><a class="back" href="#/s/${sid}">‹ ${esc((tplById(ses.tid) || {}).name || 'Session')}</a><a class="back right" style="color:var(--mut);font-size:14px" href="#/set/e/${ex.id}">Edit</a></div>
    ${pastBanner(ses.date)}<h1 class="ex-title">${esc(ex.name)}</h1>
    ${m ? `<div class="row wrap"><span class="selm">${esc(m.name)}</span>${m.photoId ? `<button class="photo-link" data-a="photo" data-id="${m.photoId}" data-testid="photo-link">📷</button>` : ''}</div>
      ${machFine(m) ? `<div class="fine" data-testid="loc">${machFine(m)}</div>` : ''}` : ''}
    ${m ? '' : cuesHTML(ex, m)}
    ${m && m.caution ? `<div class="fine mcaut-line" data-testid="m-caution">⚠️ ${esc(m.caution)}</div>` : ''}
    ${m ? '' : headsUp(ses, ex)}${m ? adviceFor(ex, mId) : ''}
    ${body}`;
}
function viewConfirm(ses, ex) {
  const pdn = pendingDone; const p = draftKey(ses.id, ex.id); const d = P[p]; const m = machById(ex, d.mId);
  return `<div class="confirm" data-testid="confirm">
    <div class="sub">${esc(ex.name)} · ${esc(m ? m.name : '')}</div>
    <h1>Set ${pdn.setNo} done ✓</h1><div class="bigval" style="font-size:30px" data-testid="confirm-time">⏱ ${mmss(pdn.secs)}</div>
    <div class="sub" style="text-align:center;margin-bottom:6px">Confirm what you did</div>
    ${weightPicker(p, true)}
    ${repsPicker(p, null, true)}
    <h3>Difficulty</h3>${diffPicker(p)}
    <h3>Quick notes</h3>${notePicker(p)}
    <div style="height:16px"></div><button class="btn pri" data-a="confirm-log" data-testid="confirm-log">Log set ${pdn.setNo}</button>
    <button class="btn ghost" data-a="confirm-discard">Discard this set</button></div>`;
}
function setbarHTML() {
  if (!curEx || pendingDone) return '';
  const ses = sesById(curEx.sid); const ex = exById(curEx.exId); const d = P[draftKey(curEx.sid, curEx.exId)];
  if (!ses || !ex) return '';
  const th = `<textarea class="thoughts thoughts-sm" data-i="thoughts" rows="1" placeholder="💭 Thoughts" data-testid="thoughts">${esc((ses.thoughts || {})[ex.id] || '')}</textarea>`;
  if (!d || !d.mId) return `<div class="setbar setbar-sm"><div class="inner">${th}</div></div>`;
  if (ex.kind === 'cardio') return `<div class="setbar setbar-sm"><div class="inner">${th}<button class="setbtn all" data-a="log-cardio" data-testid="log-cardio">Log cardio</button></div></div>`;
  const sets = setsOf(ses, ex.id, d.mId); const by = n => sets.find(s => s.set === n);
  const cur = `<span class="cur">${fmtW(round1(d.add + d.base))}×${d.reps}</span>`;
  const btn = n => { const e = by(n); return e ? `<button class="setbtn logged" data-a="edit-entry" data-sid="${ses.id}" data-id="${e.id}" data-testid="set-${n}">Set ${n} ✓<small>${fmtW(dispW(e))}×${e.reps}</small></button>`
    : `<button class="setbtn" data-a="log-set" data-n="${n}" data-testid="set-${n}">Set ${n}<small>${cur}</small></button>`; };
  const remaining = [1, 2, 3].filter(n => !by(n)); const nx = nextSetNo(ses, ex.id, d.mId);
  const all = remaining.length === 3 ? `<button class="setbtn all" data-a="log-all" data-testid="all-sets">All 3</button>`
    : remaining.length ? `<button class="setbtn all" data-a="log-all" data-testid="all-sets">Rest ${remaining.length}</button>`
    : `<button class="setbtn all" data-a="log-extra" data-testid="extra-set">＋ ${nx}</button>`;
  return `<div class="setbar setbar-sm"><div class="inner">${th}<div class="sets-row">${btn(1)}${btn(2)}${btn(3)}${all}
    <button class="setbtn start sm" data-a="lock-start" data-testid="start-set" aria-label="Timed set">▶</button></div></div></div>`;
}
function updateSetbarLabel() { if (!curEx) return; const d = P[draftKey(curEx.sid, curEx.exId)]; if (!d || d.add == null) return; $$('.setbar .cur').forEach(c => c.textContent = `${fmtW(round1(d.add + d.base))}×${d.reps}`); }
function logSets(nums, extra = {}) {
  const ses = sesById(curEx.sid); const d = P[draftKey(curEx.sid, curEx.exId)];
  const tot = round1(d.add + d.base);
  const added = nums.map((n, i) => Object.assign({ id: uid(), kind: 'set', exId: curEx.exId, mId: d.mId, set: n, w: tot, add: d.add, base: d.noBase ? null : d.base, u: unit(), reps: d.reps, diff: d.diff, tags: d.tags.slice(), note: '', ts: nowTs() }, extra));
  ses.entries.push(...added); d.tags = []; markDirty(added.map(e => e.id)); persist(); render();
  toast(nums.length > 1 ? `Logged ${nums.length} sets · ${fmtW(tot)}×${d.reps}` : `Set ${nums[0]} logged · ${fmtW(tot)}×${d.reps}`, () => {
    ses.entries = ses.entries.filter(e => !added.includes(e)); markDeleted(added.map(e => e.id)); persist(); render();
  });
}
function logCardio() {
  const ses = sesById(curEx.sid); const d = P[draftKey(curEx.sid, curEx.exId)];
  const e = { id: uid(), kind: 'cardio', exId: curEx.exId, mId: d.mId, dur: d.dur, dist: round1(d.dist), du: S.settings.distUnit, level: d.level || 0, diff: d.diff, tags: d.tags.slice(), note: '', ts: nowTs() };
  ses.entries.push(e); d.tags = []; markDirty([e.id]); persist(); render();
  toast(`Logged ${cardioSummary(e)}`, () => { ses.entries = ses.entries.filter(x => x !== e); markDeleted([e.id]); persist(); render(); });
}

/* ---------------- Locked in-set mode ---------------- */
const HOLD_MS = 300, CANCEL_MS = 1000;
function openLock() {
  const ses = sesById(curEx.sid); const ex = exById(curEx.exId); const d = P[draftKey(curEx.sid, curEx.exId)]; const m = machById(ex, d.mId);
  const setNo = nextSetNo(ses, ex.id, d.mId);
  lock = { sid: ses.id, exId: ex.id, setNo, t0: performance.now(), cleanup: [] };
  const el = document.createElement('div'); el.className = 'locked'; el.id = 'locked'; el.dataset.testid = 'locked';
  el.innerHTML = `<div class="lk-head"><div class="lk-ex">${esc(ex.name)}</div><div class="sub">${esc(m.name)} · Set ${setNo} · ${fmtTotal(round1(d.add + d.base))} × ${d.reps}</div></div>
    <button class="lk-cancel" id="lk-cancel" data-testid="lk-cancel"><span class="fill"></span><span class="lbl">Hold to cancel</span></button>
    <div class="lk-timer" id="lk-timer" data-testid="lk-timer">0:00</div>
    <div class="lk-hint">Screen locked. Hold <b>both</b> Done buttons together to finish the set.</div>
    <button class="lk-done l" id="lk-l" data-testid="done-left"><span class="fill"></span><span class="lbl">Done</span></button>
    <button class="lk-done r" id="lk-r" data-testid="done-right"><span class="fill"></span><span class="lbl">Done</span></button>`;
  document.body.appendChild(el);
  ['app', 'tabs', 'sheet-root', 'toast'].forEach(id => { const n = document.getElementById(id); if (n) { n.inert = true; n.setAttribute('aria-hidden', 'true'); } });
  const on = (t, ev, fn, opt) => { t.addEventListener(ev, fn, opt); lock.cleanup.push(() => t.removeEventListener(ev, fn, opt)); };
  // Block every default gesture: scroll, pinch-zoom, double-tap zoom, long-press menus, stray clicks.
  ['touchstart', 'touchmove', 'touchend', 'gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu'].forEach(ev => on(el, ev, e => { if (e.cancelable) e.preventDefault(); }, { passive: false }));
  on(el, 'click', e => { e.preventDefault(); e.stopPropagation(); });
  const btns = [$('#lk-l'), $('#lk-r')]; btns.forEach(b => { b._p = new Set(); b._t = 0; });
  const pressed = b => b._p.size > 0 || b._t > 0;
  let holdT = null;
  const refresh = () => {
    btns.forEach(b => b.classList.toggle('down', pressed(b)));
    const both = btns.every(pressed);
    if (both && !holdT) { el.classList.add('arming'); holdT = setTimeout(() => { holdT = null; if (lock && btns.every(pressed)) finishLock(); }, HOLD_MS); }
    else if (!both && holdT) { clearTimeout(holdT); holdT = null; el.classList.remove('arming'); }
    else if (!both) el.classList.remove('arming');
  };
  btns.forEach(b => {
    on(b, 'pointerdown', e => { b._p.add(e.pointerId); refresh(); });
    on(b, 'touchstart', e => { b._t = e.targetTouches.length; refresh(); }, { passive: false });
    on(b, 'touchend', e => { b._t = e.targetTouches.length; refresh(); }, { passive: false });
    on(b, 'touchcancel', e => { b._t = e.targetTouches.length; refresh(); }, { passive: false });
  });
  const up = e => { btns.forEach(b => b._p.delete(e.pointerId)); refresh(); };
  on(window, 'pointerup', up); on(window, 'pointercancel', up);
  const c = $('#lk-cancel'); let ct = null;
  const cDown = () => { if (ct) return; c.classList.add('down'); ct = setTimeout(() => { ct = null; cancelLock(); }, CANCEL_MS); };
  const cUp = () => { c.classList.remove('down'); clearTimeout(ct); ct = null; };
  on(c, 'pointerdown', cDown); on(c, 'pointerup', cUp); on(c, 'pointercancel', cUp); on(c, 'pointerleave', cUp);
  on(c, 'touchstart', cDown, { passive: false }); on(c, 'touchend', cUp, { passive: false });
  const tick = () => { const t = $('#lk-timer'); if (t && lock) t.textContent = mmss((performance.now() - lock.t0) / 1000); };
  const iv = setInterval(tick, 250); lock.cleanup.push(() => { clearInterval(iv); clearTimeout(holdT); clearTimeout(ct); });
  setWake(true);
}
function closeLock() {
  if (!lock) return; lock.cleanup.forEach(f => f()); const el = $('#locked'); if (el) el.remove();
  ['app', 'tabs', 'sheet-root', 'toast'].forEach(id => { const n = document.getElementById(id); if (n) { n.inert = false; n.removeAttribute('aria-hidden'); } });
  const l = lock; lock = null; return l;
}
function finishLock() { const l = closeLock(); pendingDone = { sid: l.sid, exId: l.exId, setNo: l.setNo, secs: Math.round((performance.now() - l.t0) / 1000) }; render(); window.scrollTo(0, 0); }
function cancelLock() { closeLock(); render(); toast('Set cancelled'); }

/* ---------------- View: History ---------------- */
function groupEntries(s) {
  const groups = []; s.entries.slice().sort((a, b) => a.ts - b.ts).forEach(e => { const k = e.exId + '|' + e.mId; let g = groups.find(x => x.k === k); if (!g) groups.push(g = { k, e: [] }); g.e.push(e); });
  groups.forEach(g => g.e.sort((a, b) => (a.set || 0) - (b.set || 0) || a.ts - b.ts)); return groups;
}
function backupButtons() {
  return `<h3>Share & backup</h3><button class="btn" data-a="crunchbot" data-testid="crunchbot">🤖 Send to CrunchBot</button><button class="btn ghost" data-a="export-json">Download JSON backup</button>`;
}
const entryText = e => e.kind === 'set' ? e.base === null ? `${fmtW(round1(conv(e.add || 0, e.u || 'lb', unit())))} ${unit()} + base? × ${e.reps}` : `${fmtTotal(dispW(e))}${e.base ? ` (${fmtW(round1(conv(e.add, e.u, unit())))}+${fmtW(round1(conv(e.base, e.u, unit())))})` : ''} × ${e.reps}` : cardioSummary(e);
function viewHistory() {
  const list = sortedSessions().filter(s => s.entries.length);
  if (!list.length) return `<h1>History</h1><div class="empty">No workouts logged yet.</div>${backupButtons()}`;
  let lastMonth = '';
  return `<h1>History</h1>${list.map(s => {
    const month = pd(s.date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const head = month !== lastMonth ? `<h3>${esc(month)}</h3>` : ''; lastMonth = month;
    return `${head}<a class="card" style="display:block;color:inherit;text-decoration:none" href="#/h/${s.id}" data-testid="hist-card" data-sid="${s.id}">
      <div class="row"><b>${esc(fmtD(s.date))}</b><span>${esc((tplById(s.tid) || {}).name || '')}</span><span class="pill ${s.mode} right">${s.mode === 'coach' ? 'coach' : 'solo'}</span></div>
      <div class="sub" style="margin-top:6px">${groupEntries(s).map(g => `${esc(exName(g.e[0].exId))} <span style="opacity:.7">(${esc(machName(g.e[0].exId, g.e[0].mId))})</span>: ${g.e[0].kind === 'cardio' ? g.e.map(cardioSummary).join(', ') : compactSets(g.e)}`).join('<br>')}</div>
      ${Object.values(s.thoughts || {}).filter(Boolean).length ? `<div class="fine" style="margin-top:6px">💭 ${Object.values(s.thoughts).filter(Boolean).map(esc).join(' · ')}</div>` : ''}
      ${s.wrap ? `<div class="fine" style="margin-top:6px" data-testid="hist-wrap-line">🏁 ${esc(wrapLine(s.wrap))}${s.wrap.thoughts ? ` — “${esc(s.wrap.thoughts)}”` : ''}</div>` : ''}</a>`;
  }).join('')}${backupButtons()}`;
}
function viewHistDetail(sid) {
  const s = sesById(sid); if (!s) return `<div class="empty">Session not found. <a href="#/history">Back</a></div>`;
  const shownTh = new Set();
  return `<div class="top"><a class="back" href="#/history">‹ History</a></div>
    <h1>${esc((tplById(s.tid) || {}).name || 'Workout')}</h1><div class="sub">${esc(fmtDLong(s.date))}</div>
    <div style="margin:14px 0">${seg('mode', [['coach', 'With coach'], ['solo', 'Solo']], s.mode, `data-sid="${s.id}"`)}</div>
    <div class="card wrapcard" data-testid="hist-wrap"><div class="row"><b class="grow">🏁 Wrap-up</b><button class="btn sm" data-a="open-wrap" data-sid="${s.id}" data-testid="edit-wrap">${s.wrap ? 'Edit' : 'Add wrap-up'}</button></div>
      <div class="sub" style="margin-top:6px" data-testid="hist-summary">${esc(summaryLine(sessionSummary(s)))}</div>
      ${s.wrap ? `<div style="margin-top:6px">${esc(wrapLine(s.wrap))}</div>${s.wrap.thoughts ? `<div class="thought" style="margin-top:6px">💭 ${esc(s.wrap.thoughts)}</div>` : ''}` : '<div class="fine" style="margin-top:6px">No wrap-up yet.</div>'}</div>
    ${groupEntries(s).map(g => { const exId = g.e[0].exId; const th = (s.thoughts || {})[exId]; const showTh = th && !shownTh.has(exId); if (showTh) shownTh.add(exId);
      return `<h3>${esc(exName(exId))} · ${esc(machName(exId, g.e[0].mId))}</h3>${showTh ? `<div class="thought" data-testid="hist-thoughts">💭 ${esc(th)}</div>` : ''}${g.e.map(e => `<button class="entry" data-a="edit-entry" data-sid="${s.id}" data-id="${e.id}" data-testid="hist-entry">
      <span class="n">${e.kind === 'set' ? 'Set ' + e.set : 'Cardio'}</span><span class="grow">${entryText(e)}${e.diff ? ` · d${e.diff}` : ''}${e.secs ? ` · ⏱${mmss(e.secs)}` : ''}
      ${(e.tags && e.tags.length) || e.note ? `<span class="note">${esc([...(e.tags || []), e.note].filter(Boolean).join(' · '))}</span>` : ''}</span>✎</button>`).join('')}`; }).join('') || '<div class="empty">No entries in this session.</div>'}
    ${Object.entries(s.thoughts || {}).filter(([k, v]) => v && !shownTh.has(k)).map(([k, v]) => `<h3>${esc(exName(k))}</h3><div class="thought">💭 ${esc(v)}</div>`).join('')}
    <div style="height:16px"></div><a class="btn" href="#/s/${s.id}">Open session to log more</a>
    <button class="btn bad" data-a="del-session" data-sid="${s.id}" data-testid="del-session">Delete this session</button>`;
}
function openEntrySheet(sid, id, keep) {
  const s = sesById(sid); const e = s && s.entries.find(x => x.id === id); if (!e) return;
  const p = 'ed';
  if (e.kind === 'set') {
    const base = round1(conv(e.base || 0, e.u || 'lb', unit()));
    P[p] = { base, noBase: e.base === null, add: round1(dispW(e) - base), reps: e.reps, mId: e.mId };
  } else P[p] = { dur: e.dur, dist: e.dist || 0, level: e.level || 0 };
  Object.assign(P[p], { diff: e.diff || 3, tags: (e.tags || []).slice(), sid, id });
  P[p].moveTo = null; P[p].moveScope = 'one';
  if (keep) { // unsaved edits survive a machine move / date pick
    if (e.kind === 'set') Object.assign(P[p], { add: keep.add, reps: keep.reps }); else if (keep.dur != null) Object.assign(P[p], { dur: keep.dur, dist: keep.dist, level: keep.level });
    Object.assign(P[p], { diff: keep.diff, tags: keep.tags.slice(), moveTo: keep.moveTo && keep.moveTo !== s.date ? keep.moveTo : null, moveScope: keep.moveScope || 'one' });
  }
  const dayEnts = dayEntriesOf(s, e); const nMove = P[p].moveScope === 'all' ? dayEnts.length : 1;
  const ex = exById(e.exId);
  const siblings = e.kind === 'set' ? todaySetsSiblings(s, e.exId) : [];
  const idx = siblings.findIndex(x => x.id === e.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  const canAdd = e.kind === 'set' && !next;
  const nav = e.kind === 'set' ? `<div class="entry-nav" data-testid="entry-nav">
      <button class="chip sm" data-a="entry-prev" data-sid="${sid}" data-id="${e.id}" ${prev ? '' : 'disabled'} data-testid="entry-prev">← Prev</button>
      <span class="sub">${idx + 1} of ${siblings.length} · Set ${e.set}</span>
      <button class="chip sm" data-a="entry-next" data-sid="${sid}" data-id="${e.id}" data-testid="entry-next">${canAdd ? '＋ Add…' : 'Next →'}</button>
    </div>` : '';
  openSheet(`<div class="entry-sheet" data-testid="entry-sheet">
    <div class="entry-body">
      <div class="entry-head"><h2>${esc(exName(e.exId))} · ${e.kind === 'set' ? 'Set ' + e.set : 'Cardio'}</h2>
        <div class="row entry-mrow"><button class="chip sm dpick ${P[p].moveTo ? 'on' : s.date !== todayStr() ? 'past' : ''}" data-a="entry-date" data-testid="entry-date">Date: ${esc(fmtD(P[p].moveTo || s.date))}${P[p].moveTo && nMove > 1 ? ` (all ${nMove})` : ''} ▾</button>
        ${e.kind === 'set' && ex && ex.machines.length > 1 ? `<button class="chip sm mpick" data-a="entry-mach" data-testid="entry-mach">Machine: ${esc(machName(e.exId, e.mId))} ▾</button>`
          : `<span class="sub">${esc(machName(e.exId, e.mId))}</span>`}</div></div>
      ${nav}
      ${e.kind === 'set' ? `${weightPicker(p, true)}${repsPicker(p, null, true)}` : cardioPicker(p)}
      <div class="diff-compact"><h3>Difficulty</h3>${diffPicker(p)}</div>
      <details class="more-log"><summary>Notes</summary>${notePicker(p)}</details>
    </div>
    <div class="entry-actions" data-testid="entry-actions">
      <button class="btn pri" data-a="entry-save" data-testid="entry-save">${P[p].moveTo ? `Save · move to ${esc(dayWord(P[p].moveTo))}` : 'Save'}</button>
      <button class="btn ghost" data-a="sheet-cancel" data-testid="entry-cancel">Cancel</button>
      <button class="btn bad" data-a="entry-del" data-testid="entry-del">Delete</button>
    </div></div>`);
  centerChips(false);
}
/* Move a set (or all of that day's sets on its machine) to another machine of the same exercise.
   Keeps the working weight you picked (plates/stack) and re-applies the new machine's base. Undoable. */
let MV = null;
function openMoveSheet() {
  const d = P.ed; const s = sesById(d.sid); const e = s && s.entries.find(x => x.id === d.id); if (!e || e.kind !== 'set') return;
  if (!MV || MV.id !== e.id) MV = { sid: s.id, id: e.id, scope: 'one', keep: edKeep() };
  const ex = exById(e.exId); const same = setsOf(s, e.exId, e.mId);
  const opts = sortedMachines(ex).filter(m => m.id !== e.mId).map(m => { const n = setsOf(s, ex.id, m.id).length;
    return `<button class="entry" data-a="mach-move" data-m="${m.id}" data-testid="move-to"><span class="grow"><b>${esc(m.name)}</b><span class="note">${[machFine(m), noBase(m) ? '' : 'base ' + fmtW(baseOf(m)) + ' ' + unit(), n ? `${n} set${n === 1 ? '' : 's'} ${dayWordLc(s.date)}` : ''].filter(Boolean).join(' · ')}</span></span>→</button>`; }).join('');
  openSheet(`<div data-testid="move-sheet"><h2>Move to machine</h2><div class="sub" style="margin-bottom:8px">${esc(ex.name)} · ${esc(fmtD(s.date))} · now on ${esc(machName(ex.id, e.mId))}</div>
    ${same.length > 1 ? `<div style="margin-bottom:8px" data-testid="move-scope">${seg('mvscope', [['one', 'Set ' + e.set + ' only'], ['all', `All ${same.length} sets here`]], MV.scope, '')}</div>` : ''}
    <div class="move-list">${opts || '<div class="empty">No other machines for this exercise.</div>'}</div>
    <button class="btn ghost" data-a="mach-back" data-testid="move-cancel">Cancel</button></div>`);
}
function moveSets(sid, ids, newMid) {
  const s = sesById(sid); const ents = s.entries.filter(e => ids.includes(e.id) && e.kind === 'set'); if (!ents.length) return null;
  const ex = exById(ents[0].exId); const m = machById(ex, newMid); if (!m) return null;
  const before = ents.map(e => ({ e, mId: e.mId, set: e.set, base: e.base, w: e.w, u: e.u }));
  let n = s.entries.filter(e => e.kind === 'set' && e.exId === ex.id && e.mId === newMid && !ids.includes(e.id)).reduce((a, e) => Math.max(a, e.set || 0), 0);
  ents.sort((a, b) => a.ts - b.ts || a.set - b.set).forEach(e => {
    const u = e.u || 'lb';
    const nb = noBase(m) ? null : round1(conv(baseOf(m), unit(), u));
    const add = e.add != null ? e.add : round1((e.w || 0) - (e.base || 0));
    e.add = add; e.base = nb; e.w = round1(add + (nb || 0)); e.mId = newMid; e.set = ++n;
  });
  markDirty(ents.map(e => e.id)); persist();
  return { m, ents, undo: () => { before.forEach(b => Object.assign(b.e, { mId: b.mId, set: b.set, base: b.base, w: b.w, u: b.u })); markDirty(before.map(b => b.e.id)); persist(); render(); } };
}

/* Change a set's date (2.5.5): move one entry (or all of that exercise's entries that day) to the same template's
   session on another day (created if needed). Renumbers both days, drops the old session only if nothing is left
   (no entries, wrap-up or notes). Entries keep their ids, so the sheet sync upserts them with the new session_id. Undoable. */
const edKeep = () => { const d = P.ed; return { add: d.add, reps: d.reps, dur: d.dur, dist: d.dist, level: d.level, diff: d.diff, tags: (d.tags || []).slice(), moveTo: d.moveTo || null, moveScope: d.moveScope || 'one' }; };
const dayEntriesOf = (s, e) => s.entries.filter(x => x.exId === e.exId && x.kind === e.kind).sort((a, b) => a.ts - b.ts || (a.set || 0) - (b.set || 0));
let DM = null;
function openDateSheet() {
  const d = P.ed; const s = sesById(d.sid); const e = s && s.entries.find(x => x.id === d.id); if (!e) return;
  if (!DM || DM.id !== e.id) DM = { sid: s.id, id: e.id, keep: edKeep(), earlier: false };
  const k = DM.keep; const sel = k.moveTo || s.date; const t0 = todayStr(), y = daysAgo(1); const early = sel < y;
  const same = dayEntriesOf(s, e); const unitW = e.kind === 'set' ? 'set' : 'entry';
  const chip = (ds, label, on) => `<button class="chip ${on ? 'on' : ''} ${ds === s.date ? 'cur' : ''}" data-a="dm-pick" data-d="${ds}" data-testid="dm-${ds === t0 ? 'today' : 'yesterday'}">${label}</button>`;
  const days = [...Array(14)].map((_, i) => daysAgo(13 - i));
  const grid = DM.earlier ? `<div class="dgrid" data-testid="dm-grid" style="margin-top:8px">${days.map(ds => { const dd = pd(ds); const n = S.sessions.filter(x => x.date === ds).reduce((a, x) => a + x.entries.length, 0);
    return `<button class="dcell ${ds === sel ? 'on' : ''}" data-a="dm-pick" data-d="${ds}" data-testid="dm-day-${ds}"><span>${DOW[dd.getDay()].slice(0, 3)}</span><b>${dd.getDate()}</b><i>${ds === s.date ? 'now' : n ? '●' : ''}</i></button>`; }).join('')}</div>` : '';
  openSheet(`<div data-testid="date-sheet"><h2>Move to which day?</h2><div class="sub" style="margin-bottom:8px">${esc(exName(e.exId))} · now on ${esc(fmtD(s.date))}</div>
    ${same.length > 1 ? `<div style="margin-bottom:8px" data-testid="dm-scope">${seg('dmscope', [['one', e.kind === 'set' ? 'Set ' + e.set + ' only' : 'This entry only'], ['all', `All ${same.length} ${unitW === 'set' ? 'sets' : 'entries'} here`]], k.moveScope, '')}</div>` : ''}
    <div class="chips" data-testid="dm-chips">${chip(t0, 'Today', sel === t0)}${chip(y, 'Yesterday', sel === y)}
      <button class="chip ${early ? 'on' : ''}" data-a="dm-earlier" data-testid="dm-earlier">${early ? esc(fmtD(sel)) + ' ▾' : 'Earlier…'}</button></div>
    ${grid}
    <div class="fine" style="margin:8px 0">Moves when you tap Save.</div>
    <button class="btn ghost" data-a="dm-back" data-testid="dm-back">Back</button></div>`);
}
function renumberSets(ses, exIds) {
  exIds.forEach(exId => { const by = {};
    ses.entries.filter(x => x.kind === 'set' && x.exId === exId).sort((a, b) => a.ts - b.ts || (a.set || 0) - (b.set || 0)).forEach(x => { by[x.mId] = (by[x.mId] || 0) + 1; x.set = by[x.mId]; }); });
}
function moveToDate(sid, ids, date) {
  const src = sesById(sid); if (!src || !date || date === src.date) return null;
  const ents = src.entries.filter(x => ids.includes(x.id)); if (!ents.length) return null;
  const existed = sessionOn(src, date); const dst = existed || newSessionLike(src, date);
  const exs = [...new Set(ents.map(x => x.exId))];
  const nums = [...src.entries, ...dst.entries].filter(x => x.kind === 'set' && exs.includes(x.exId)).map(x => ({ e: x, set: x.set }));
  const srcBefore = src.entries.slice(), dstExBefore = dst.exIds.slice(), srcPos = S.sessions.indexOf(src);
  src.entries = src.entries.filter(x => !ids.includes(x.id)); dst.entries.push(...ents);
  exs.forEach(x => { if (!dst.exIds.includes(x)) dst.exIds.push(x); });
  renumberSets(src, exs); renumberSets(dst, exs);
  const removed = sesEmpty(src); if (removed) S.sessions = S.sessions.filter(x => x !== src);
  const touched = () => [...new Set(ents.map(x => x.id).concat(nums.map(b => b.e.id)))];
  markDirty(touched()); persist();
  return { src, dst, ents, removed, created: !existed, undo: () => {
    dst.entries = dst.entries.filter(x => !ents.includes(x));
    src.entries = srcBefore.filter(x => ents.includes(x) || src.entries.includes(x)).concat(src.entries.filter(x => !srcBefore.includes(x)));
    if (removed && !S.sessions.includes(src)) S.sessions.splice(Math.min(srcPos, S.sessions.length), 0, src);
    nums.forEach(b => { b.e.set = b.set; });
    if (!existed && sesEmpty(dst)) S.sessions = S.sessions.filter(x => x !== dst); else dst.exIds = dstExBefore.concat(dst.exIds.filter(x => !dstExBefore.includes(x) && dst.entries.some(en => en.exId === x)));
    markDirty(touched()); persist();
    if (location.hash.includes(dst.id) && !S.sessions.includes(dst)) return go(location.hash.replace(dst.id, src.id));
    render();
  } };
}

/* ---------------- View: Progress ---------------- */
const prog = { ex: null, m: null, metric: 'top' };
function svgChart(pts, yLabel) {
  if (!pts.length) return '<div class="empty">No data yet.</div>';
  const W = 360, H = 210, L = 44, R = 14, T = 18, B = 30;
  const xs = pts.map(p => pd(p.x).getTime()); const ys = pts.map(p => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x0 === x1) { x0 -= DAY_MS; x1 += DAY_MS; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const padY = (y1 - y0) * 0.15 || Math.max(1, y1 * 0.1); y0 = Math.max(0, y0 - padY); y1 += padY;
  const sx = x => L + (x - x0) / (x1 - x0) * (W - L - R), sy = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const grid = [0, 1, 2, 3].map(i => { const v = y0 + (y1 - y0) * i / 3; return `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="#2a313b"/><text x="${L - 6}" y="${sy(v) + 4}" fill="#8d97a5" font-size="11" text-anchor="end">${Math.round(v)}</text>`; }).join('');
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L${sx(xs[xs.length - 1]).toFixed(1)},${H - B} L${sx(xs[0]).toFixed(1)},${H - B} Z`;
  const anchor = i => pts.length === 1 ? 'middle' : i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle';
  const lbl = i => `<text x="${sx(xs[i])}" y="${H - 10}" fill="#8d97a5" font-size="11" text-anchor="${anchor(i)}">${esc(pd(pts[i].x).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</text>`;
  const labels = [...new Set([0, Math.floor((pts.length - 1) / 2), pts.length - 1])].map(lbl).join('');
  const last = pts.length - 1;
  return `<div class="chart" data-testid="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)} chart">
    <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff7a1a" stop-opacity=".35"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path d="${area}" fill="url(#g)"/><path d="${line}" fill="none" stroke="#ff7a1a" stroke-width="2.5" stroke-linejoin="round"/>
    ${pts.map((p, i) => `<circle cx="${sx(xs[i])}" cy="${sy(p.y)}" r="4" fill="#0d0f12" stroke="#ff7a1a" stroke-width="2"/>`).join('')}
    <text x="${sx(xs[last])}" y="${sy(pts[last].y) - 9}" fill="#eef1f5" font-size="12" font-weight="700" text-anchor="${anchor(last)}">${round1(pts[last].y)}</text>
    ${labels}<text x="${L}" y="11" fill="#8d97a5" font-size="11">${esc(yLabel)}</text></svg></div>`;
}
function viewProgress() {
  const used = {}; S.sessions.forEach(s => s.entries.forEach(e => { (used[e.exId] = used[e.exId] || new Set()).add(e.mId); }));
  const exIds = Object.keys(used).filter(exById).sort((a, b) => exName(a).localeCompare(exName(b)));
  if (!exIds.length) return `<h1>Progress</h1><div class="empty">Log some workouts to see charts.</div>`;
  if (!prog.ex || !used[prog.ex] || !exById(prog.ex)) prog.ex = exIds[0];
  const ex = exById(prog.ex); const mids = [...used[prog.ex]].filter(m => machById(ex, m));
  if (!prog.m || !mids.includes(prog.m)) prog.m = mids[0];
  const cardio = ex.kind === 'cardio';
  if (cardio && !['dur', 'dist'].includes(prog.metric)) prog.metric = 'dur';
  if (!cardio && !['top', 'e1rm', 'vol'].includes(prog.metric)) prog.metric = 'top';
  const byDate = {};
  S.sessions.forEach(s => s.entries.forEach(e => { if (e.exId === prog.ex && e.mId === prog.m) (byDate[s.date] = byDate[s.date] || []).push(e); }));
  const pts = Object.keys(byDate).sort().map(dt => { const es = byDate[dt]; let y;
    if (prog.metric === 'top') y = Math.max(...es.map(dispW));
    else if (prog.metric === 'e1rm') y = Math.max(...es.map(e => e1rm(dispW(e), e.reps)));
    else if (prog.metric === 'vol') y = es.reduce((a, e) => a + dispW(e) * e.reps, 0);
    else if (prog.metric === 'dur') y = es.reduce((a, e) => a + e.dur, 0);
    else y = es.reduce((a, e) => a + (e.dist || 0), 0);
    return { x: dt, y: round1(y) }; });
  const addedOnly = !cardio && Object.values(byDate).some(es => es.some(e => e.kind === 'set' && e.base === null));
  const labels = { top: addedOnly ? `Top ADDED weight (${unit()}) — base not set` : `Top total weight (${unit()})`, e1rm: `Est. 1RM (${unit()})${addedOnly ? ' — added only' : ''}`, vol: `Volume (${unit()}×reps)${addedOnly ? ' — added only' : ''}`, dur: 'Duration (min)', dist: `Distance (${S.settings.distUnit})` };
  const ys = pts.map(p => p.y);
  return `<h1>Progress</h1>
    <h3>Exercise</h3><select class="field" data-i="prog-ex" aria-label="exercise" data-testid="prog-ex">${exIds.map(id => `<option value="${id}" ${id === prog.ex ? 'selected' : ''}>${esc(exName(id))}</option>`).join('')}</select>
    ${mids.length > 1 || !cardio ? `<h3>Machine</h3><div class="chips">${mids.map(m => `<button class="chip ${m === prog.m ? 'on' : ''}" data-a="prog-m" data-v="${m}">${esc(machName(prog.ex, m))}</button>`).join('')}</div>` : ''}
    <div style="margin:14px 0">${seg('prog-metric', cardio ? [['dur', 'Duration'], ['dist', 'Distance']] : [['top', 'Top weight'], ['e1rm', 'Est. 1RM'], ['vol', 'Volume']], prog.metric)}</div>
    ${svgChart(pts, labels[prog.metric])}
    <div class="stats"><div><b>${pts.length}</b><span>sessions</span></div><div><b>${ys.length ? round1(Math.max(...ys)) : '—'}</b><span>best</span></div><div><b>${ys.length > 1 ? (ys[ys.length - 1] - ys[0] >= 0 ? '+' : '') + round1(ys[ys.length - 1] - ys[0]) : '—'}</b><span>change</span></div></div>
    ${addedOnly ? `<div class="card basewarn" data-testid="chart-added-only">Showing <b>added weight only</b>: the base for ${esc(machName(prog.ex, prog.m))} isn't set.
      <button class="linkbtn" data-a="ask-base" data-ex="${prog.ex}" data-m="${prog.m}">Set base</button> and the chart switches to totals.</div>` : ''}
    ${!cardio && !addedOnly ? '<div class="sub">Weights are totals (added + base). Est. 1RM uses the Epley formula: weight × (1 + reps/30).</div>' : ''}`;
}

/* ---------------- Setup helpers ---------------- */
function createExercise(name, kind) {
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ex'; if (S.exercises[id]) id += '-' + uid().slice(-4);
  const ex = { id, name, kind, machines: kind === 'cardio' ? [{ id: uid(), name: 'Standard', base: 0, bu: unit(), gym: '', loc: '', cues: '' }] : [], pinned: '', cues: '' };
  S.exercises[id] = ex; return ex;
}
function addExerciseToTemplate(t, name) {
  name = name.trim(); if (!name) return null;
  const kind = t.kind === 'cardio' ? 'cardio' : 'strength';
  let ex = Object.values(S.exercises).find(e => !e.archived && e.name.toLowerCase() === name.toLowerCase());
  if (!ex) ex = createExercise(name, kind);
  if (!t.exIds.includes(ex.id)) t.exIds.push(ex.id);
  return ex;
}
const schedOf = tid => [1, 2, 3, 4, 5, 6, 0].filter(d => S.schedule[d].t === tid).map(d => `${DOW[d].slice(0, 3)} (${S.schedule[d].m})`).join(', ');
const machSummary = m => [noBase(m) ? 'base not set' : m.base ? `base ${fmtW(baseOf(m))} ${unit()}` : 'no base', m.caution ? '⚠️' : '', m.gym ? `📍${m.gym}` : '', m.loc, m.start ? `start ${fmtTotal(round1(conv(m.start.w, m.start.u, unit())))}${m.start.reps ? '×' + m.start.reps : ''}` : '', m.photoId ? '📷' : '', m.cues ? '🧠' : ''].filter(Boolean).map(esc).join(' · ');

/* ---------------- View: first-run setup wizard ---------------- */
function viewSetup(stepName) {
  if (!stepName) return `<div class="wz"><div class="sub">Step 1 of 3</div><h1>Welcome to Lift Log 👋</h1>
    <p class="sub">Let's set up your gym once. You only type here — at the gym everything is taps.</p>
    <h3>Units</h3>${seg('set-unit', [['lb', 'Pounds (lb)'], ['kg', 'Kilograms (kg)']], unit())}
    <h3>Home gym (optional)</h3><input class="field" data-i="home-gym" placeholder="e.g. Lakeway" value="${esc(S.settings.homeGym)}" data-testid="home-gym">
    <div class="sub" style="margin-top:6px">Machines tagged with your home gym are listed first. Tag others e.g. "San Jose".</div>
    <div style="height:20px"></div><a class="btn pri" href="#/setup/days" data-testid="wz-next">Next: exercises per day</a>
    <button class="btn ghost" data-a="wz-skip">Skip setup for now</button></div>`;
  if (stepName === 'days') return `<div class="wz"><div class="sub">Step 2 of 3</div><h1>Exercises per day</h1>
    <p class="sub">Tap suggestions or type several at once (one per line). You can change these any time.</p>
    ${S.templates.map(t => { const have = t.exIds.filter(id => exById(id) && !exById(id).archived); const haveN = new Set(have.map(id => exName(id).toLowerCase()));
      return `<div class="card" data-testid="wz-day-${t.id}"><div class="row"><h2 style="margin:0">${esc(t.name)}</h2><span class="sub right">${esc(schedOf(t.id) || 'unscheduled')}</span></div>
      <div class="chips" style="margin:10px 0">${have.map(id => `<button class="chip sm on" data-a="wz-rm" data-t="${t.id}" data-ex="${id}">${esc(exName(id))} ✕</button>`).join('') || '<span class="sub">No exercises yet</span>'}</div>
      <div class="chips">${(SUGGEST[t.id] || []).filter(n => !haveN.has(n.toLowerCase())).map(n => `<button class="chip sm add" data-a="wz-add" data-t="${t.id}" data-v="${esc(n)}">＋ ${esc(n)}</button>`).join('')}</div>
      <textarea class="field" style="margin-top:10px;min-height:64px" id="bulk-${t.id}" placeholder="Type exercises, one per line"></textarea>
      <button class="btn sm" style="margin-top:8px" data-a="wz-bulk" data-t="${t.id}">Add typed exercises</button></div>`; }).join('')}
    <div class="row"><a class="btn ghost" href="#/setup">Back</a><a class="btn pri" href="#/setup/machines" data-testid="wz-next">Next: machines</a></div></div>`;
  // machines
  const seen = new Set();
  return `<div class="wz"><div class="sub">Step 3 of 3</div><h1>Machines & starting weights</h1>
    <p class="sub">For each exercise add the machines / equipment you use — near-duplicates are fine. Base weight is the bar or sled
      (e.g. barbell 45, 0 for stacks and dumbbells). The starting weight becomes your first "last time".</p>
    ${S.templates.map(t => { const ids = t.exIds.filter(id => exById(id) && !exById(id).archived && !seen.has(id)); ids.forEach(i => seen.add(i)); if (!ids.length) return '';
      return `<h2>${esc(t.name)}</h2>${ids.map(id => { const ex = exById(id); return `<div class="card" data-testid="wz-ex" data-ex="${id}">
        <div class="row"><b style="font-size:18px">${esc(ex.name)}</b><button class="chip sm right" data-a="wz-cues" data-ex="${id}">🧠 ${ex.cues ? 'Edit cues' : 'Add cues'}</button></div>
        ${ex.cues ? `<div class="fine">Cues: ${esc(ex.cues)}</div>` : ''}
        ${sortedMachines(ex).map(m => `<button class="entry" data-a="edit-mach" data-ex="${id}" data-m="${m.id}" data-testid="wz-mach"><span class="grow"><b>${esc(m.name)}</b><span class="note">${machSummary(m)}</span></span>✎</button>`).join('')}
        <button class="btn sm ghost" style="margin-top:8px" data-a="new-mach" data-ex="${id}" data-testid="wz-add-mach">＋ Add machine</button></div>`; }).join('')}`; }).join('') || '<div class="empty">No exercises yet — go back a step.</div>'}
    <div class="row"><a class="btn ghost" href="#/setup/days">Back</a><button class="btn pri" data-a="wz-finish" data-testid="wz-finish">Finish setup</button></div></div>`;
}

/* ---------------- View: machine editor (setup) ---------------- */
let ME = null, meReturn = null;
function initME(exId, mId) {
  const ex = exById(exId); const m = mId !== 'new' && machById(ex, mId);
  ME = { exId, key: mId, isNew: !m, name: m ? m.name : '', gym: m ? m.gym : homeGym(), loc: m ? m.loc : '', cues: m ? m.cues : '', caution: m ? m.caution || '' : '', base: m ? (noBase(m) ? null : baseOf(m)) : 0,
    photoId: m ? m.photoId || null : null, origPhoto: m ? m.photoId || null : null, hasStart: m ? !!m.start : ex.kind !== 'cardio',
    startReps: m && m.start ? m.start.reps || null : null };
  // new machine: default the starting weight to the exercise's latest total on any machine (a sensible first guess)
  const rm = !m && recentMachine(ex); const prev = rm && lastEnt(lastFor(exId, rm.id));
  const startTot = m && m.start ? round1(conv(m.start.w, m.start.u, unit())) : prev && prev.kind === 'set' ? round1(dispW(prev)) : 0;
  P.me = { add: snap(Math.max(0, startTot - (ME.base || 0))), base: ME.base || 0 };
}
/* changing the base keeps the starting TOTAL the same (added weight adjusts) */
function meSetBase(b) { const tot = P.me.add + (ME.base || 0); ME.base = b; P.me.base = b || 0; P.me.add = snap(Math.max(0, tot - (b || 0))); render(); }
function viewMachineEdit(exId, mId) {
  const ex = exById(exId); if (!ex) return `<div class="empty">Exercise not found.</div>`;
  if (!ME || ME.exId !== exId || ME.key !== mId) initME(exId, mId);
  const used = !ME.isNew && S.sessions.some(s => s.entries.some(e => e.exId === exId && e.mId === mId));
  const gyms = knownGyms(); const bases = unit() === 'kg' ? BASE_CHIPS_KG : BASE_CHIPS_LB;
  return `<div class="top"><button class="back" data-a="me-cancel">‹ Cancel</button></div>
    <h1>${ME.isNew ? 'New machine' : 'Edit machine'}</h1><div class="sub">${esc(ex.name)}</div>
    <h3>Name</h3><input class="field" data-i="me-name" value="${esc(ME.name)}" placeholder="Short name, e.g. Hammer Strength" data-testid="me-name">
    ${used ? '<div class="fine">Renaming keeps all history for this machine.</div>' : ''}
    <h3>Gym</h3><div class="chips">${gyms.map(g => `<button class="chip sm ${ME.gym === g ? 'on' : ''}" data-a="me-gym" data-v="${esc(g)}">${esc(g)}${g === homeGym() ? ' 🏠' : ''}</button>`).join('')}
      <button class="chip sm ${!ME.gym ? 'on' : ''}" data-a="me-gym" data-v="">No tag</button><button class="chip sm add" data-a="me-gym-new">＋ New gym</button></div>
    <h3>Location note (optional)</h3><input class="field" data-i="me-loc" value="${esc(ME.loc)}" placeholder="e.g. back wall, by the windows" data-testid="me-loc">
    ${ex.kind !== 'cardio' ? `<h3>Base weight (bar / sled / carriage)</h3>
    <div class="row"><button class="step" data-a="me-bstep" data-d="-1">−</button><div class="grow bigval" style="font-size:34px" data-testid="me-base">${ME.base === null ? 'Not set' : `${fmtW(ME.base)}<small>${unit()}</small>`}</div><button class="step" data-a="me-bstep" data-d="1">+</button></div>
    <div class="chips">${bases.map(b => `<button class="chip sm ${ME.base !== null && Math.abs(ME.base - b) < 1e-6 ? 'on' : ''}" data-a="me-base" data-v="${b}">${b}</button>`).join('')}<button class="chip sm ${ME.base === null ? 'on' : ''}" data-a="me-base" data-v="">Not set</button></div>
    <div class="fine">0 for weight stacks and dumbbells. Weight chips then pick the <b>added</b> weight and the app shows added + base = total.</div>` : ''}
    <h3>Coaching cues for this machine (optional)</h3><textarea class="field" data-i="me-cues" placeholder="e.g. seat 4, handles mid-chest" data-testid="me-cues">${esc(ME.cues)}</textarea>
    <h3>Caution for this machine (optional)</h3><textarea class="field" data-i="me-caution" placeholder="e.g. don't force depth if the shoulder pinches" data-testid="me-caution">${esc(ME.caution || '')}</textarea>
    <h3>Photo (optional)</h3><div class="chips"><button class="chip sm" data-a="me-photo" data-cap="environment">📷 Take photo</button>
      <button class="chip sm" data-a="me-photo" data-testid="choose-photo">🖼 Choose photo</button>
      ${ME.photoId ? `<button class="chip sm" data-a="photo" data-id="${ME.photoId}" data-testid="me-photo-view">View</button><button class="chip sm" data-a="me-photo-del">Remove</button>` : ''}</div>
    ${ex.kind !== 'cardio' ? `<h3>Starting weight</h3>${seg('me-hasstart', [['yes', 'Set starting weight'], ['no', 'Skip']], ME.hasStart ? 'yes' : 'no')}
    ${ME.hasStart ? `<div class="fine" style="margin:8px 0">Shown as "last time" until you log this machine.</div>${weightPicker('me')}
      <h3>Starting reps (optional)</h3><div class="chips">${[null, 6, 8, 10, 12, 15].map(r => `<button class="chip sm ${ME.startReps === r ? 'on' : ''}" data-a="me-reps" data-v="${r == null ? '' : r}">${r == null ? 'none' : r}</button>`).join('')}</div>` : ''}` : ''}
    <div style="height:20px"></div><button class="btn pri" data-a="me-save" data-testid="me-save">Save machine</button>
    ${!ME.isNew ? `<button class="btn bad" data-a="me-del">${used ? 'Delete (has history — rename instead)' : 'Delete machine'}</button>` : ''}`;
}

/* ---------------- View: Settings ---------------- */
function viewSettings() {
  const st = S.settings; const tplOpts = cur => `<option value="">Rest</option>${S.templates.map(t => `<option value="${t.id}" ${t.id === cur ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}`;
  const days = [1, 2, 3, 4, 5, 6, 0];
  return `<h1>Setup</h1><div class="sub">Typing is only needed here. At the gym everything is taps.</div>
  <div class="row verrow" data-testid="app-version"><span class="grow">Lift Log <b>v${APP_VERSION}</b>${updateReady ? ' · <span style="color:var(--acc)">update ready</span>' : ''}</span>
    <button class="chip sm" data-a="check-update" data-testid="check-update">Check for update</button></div>
  <div style="height:10px"></div><a class="btn" href="#/setup">✨ Run setup wizard (bulk add exercises & machines)</a>
  <h2>Units</h2>${seg('set-unit', [['lb', 'Pounds (lb)'], ['kg', 'Kilograms (kg)']], st.unit)}
  <h3>Weight step</h3><div class="chips">${(st.unit === 'kg' ? [1, 2.5, 5] : [2.5, 5, 10]).map(v => `<button class="chip ${v === step() ? 'on' : ''}" data-a="set-step" data-v="${v}">${v} ${st.unit}</button>`).join('')}</div>
  <h3>Default reps</h3><div class="chips">${[8, 10, 12, 15].map(v => `<button class="chip ${v === st.defaultReps ? 'on' : ''}" data-a="set-reps" data-v="${v}">${v}</button>`).join('')}</div>
  <h3>Cardio distance</h3>${seg('set-dist', [['mi', 'Miles'], ['km', 'Kilometres']], st.distUnit)}
  <h3>Home gym</h3><input class="field" data-i="home-gym" placeholder="e.g. Lakeway" value="${esc(st.homeGym)}">
  <h2>Weekly schedule</h2>
  ${days.map(d => `<div class="mrow"><span style="width:44px;font-weight:700">${DOW[d].slice(0, 3)}</span>
    <select class="field grow" style="min-height:44px;padding:8px;width:auto" data-i="sched" data-d="${d}" aria-label="${DOW[d]} template">${tplOpts(S.schedule[d].t)}</select>
    <div style="width:150px">${seg('sched-mode', [['coach', 'Coach'], ['solo', 'Solo']], S.schedule[d].m, `data-d="${d}"`)}</div></div>`).join('')}
  <h2>Workout templates</h2><div class="list">${S.templates.map(t => `<a class="li" href="#/set/t/${t.id}"><div><div class="t">${esc(t.name)}</div><div class="s">${t.exIds.filter(id => exById(id) && !exById(id).archived).map(exName).map(esc).join(', ') || 'empty'}</div></div><span class="badge">Edit</span></a>`).join('')}</div>
  <button class="btn ghost" data-a="tpl-new">＋ New template</button>
  <h2>Exercises & machines</h2><a class="btn" href="#/set/ex">Manage exercises, machines, cues & photos</a>
  <h2>Sync to Google Sheet</h2>
  <div class="sub">Optional. Paste your Apps Script web-app URL and secret token once (see README). Logging never waits for sync; changes queue offline and push automatically.</div>
  <div style="height:8px"></div><input class="field" id="sync-url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(S.sync.url)}" autocomplete="off" autocapitalize="off" spellcheck="false">
  <div style="height:8px"></div><input class="field" id="sync-token" placeholder="Secret token" value="${esc(S.sync.token)}" autocomplete="off" autocapitalize="off" spellcheck="false" type="password">
  <div class="sub" id="sync-status" style="margin:8px 0" data-testid="sync-status">${syncStatusHTML()}</div>
  <div class="row"><button class="btn sm" data-a="sync-save">Save</button><button class="btn sm" data-a="sync-now" data-testid="sync-now">Sync now</button><button class="btn sm ghost" data-a="sync-full">Re-send all</button></div>
  <button class="btn" style="margin-top:8px" data-a="sync-restore" data-testid="sync-restore">Restore from Google Sheet</button>
  <div class="fine">Adds sets & sessions from your sheet that aren't on this phone. Never removes or changes anything here.</div>
  <h2>Advice from your assistant</h2>
  <div class="sub">${S.advice.filter(a => !a.dismissed).length} active advice notes · ${S.advice.filter(a => a.dismissed).length} dismissed</div>
  <div style="height:8px"></div><button class="btn" data-a="import-advice" data-testid="import-advice">Import advice (JSON)</button>
  ${S.advice.some(a => a.dismissed) ? '<button class="btn ghost" data-a="advice-clear">Forget dismissed advice</button>' : ''}
  <h2>Data & backup</h2>
  <div class="sub">Last backup: ${S.lastExport ? new Date(S.lastExport).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'never'}${S.sync.last ? ` · last sync ${new Date(S.sync.last).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</div>
  ${backupButtons()}
  <button class="btn ghost" data-a="export-csv" data-testid="export-csv">Download CSV (sets & cardio)</button>
  <button class="btn ghost" data-a="export-sessions-csv" data-testid="export-sessions-csv">Download sessions CSV (wrap-ups)</button>
  <button class="btn ghost" data-a="import-json" data-testid="import-json">Import machines or backup</button>
  ${importSnapCount ? `<button class="btn ghost" data-a="undo-import" data-testid="undo-import">Undo last import</button>
  <div class="sub" style="margin:4px 0 10px">Undoes the last import/catalog snapshot. Catalog undos keep your logged workouts (${importSnapCount} saved).</div>` : ''}
  <div class="sub" style="margin:10px 0">Machines update automatically from the published catalog when you open the app. Manual import is a fallback. Data is stored only on this phone (IndexedDB). Export a backup now and then.</div>
  <div class="sub" style="text-align:center;margin:20px 0">Lift Log v${APP_VERSION}</div>`;
}
function viewTplEdit(tid) {
  const t = tplById(tid); if (!t) return `<div class="empty">Template not found. <a href="#/settings">Back</a></div>`;
  const inT = t.exIds.filter(id => exById(id) && !exById(id).archived);
  const notIn = Object.values(S.exercises).filter(e => !e.archived && !inT.includes(e.id) && (t.kind === 'cardio' ? e.kind === 'cardio' : true)).sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="top"><a class="back" href="#/settings">‹ Setup</a></div>
    <h1>Edit template</h1><h3>Name</h3><input class="field" data-i="tpl-name" data-t="${t.id}" value="${esc(t.name)}">
    <h3>Exercises (in order)</h3>
    ${inT.map((id, i) => `<div class="mrow" data-testid="tpl-ex"><span class="grow">${esc(exName(id))}</span>
      <button class="icon-btn" data-a="tpl-up" data-t="${t.id}" data-ex="${id}" ${i === 0 ? 'disabled' : ''} aria-label="up">↑</button>
      <button class="icon-btn" data-a="tpl-down" data-t="${t.id}" data-ex="${id}" ${i === inT.length - 1 ? 'disabled' : ''} aria-label="down">↓</button>
      <button class="icon-btn" data-a="tpl-rm" data-t="${t.id}" data-ex="${id}" aria-label="remove" data-testid="tpl-rm">✕</button></div>`).join('') || '<div class="empty">No exercises yet.</div>'}
    <h3>Add exercise</h3><div class="chips">${notIn.map(e => `<button class="chip sm" data-a="tpl-add" data-t="${t.id}" data-ex="${e.id}">＋ ${esc(e.name)}</button>`).join('')}
    <button class="chip sm add" data-a="tpl-add-new" data-t="${t.id}" data-testid="tpl-add-new">＋ Create new exercise</button></div>
    <div style="height:24px"></div><button class="btn bad" data-a="tpl-del" data-t="${t.id}">Delete template</button>`;
}
function viewExList() {
  const all = Object.values(S.exercises).filter(e => !e.archived).sort((a, b) => a.kind.localeCompare(b.kind) * -1 || a.name.localeCompare(b.name));
  return `<div class="top"><a class="back" href="#/settings">‹ Setup</a></div><h1>Exercises</h1>
    <button class="btn ghost" data-a="ex-new">＋ New exercise</button>
    <div class="list">${all.map(e => `<a class="li" href="#/set/e/${e.id}"><div><div class="t">${esc(e.name)}${e.pinned ? ' ⚠️' : ''}</div><div class="s">${e.kind === 'cardio' ? 'Cardio · ' : ''}${sortedMachines(e).map(m => esc(m.name) + (m.photoId ? ' 📷' : '')).join(', ') || 'no machines'}</div></div></a>`).join('') || '<div class="empty">No exercises yet. Use the setup wizard.</div>'}</div>`;
}
function viewExEdit(exId) {
  const ex = exById(exId); if (!ex) return `<div class="empty">Exercise not found. <a href="#/set/ex">Back</a></div>`;
  return `<div class="top"><a class="back" href="#/set/ex">‹ Exercises</a></div>
    <h1>${esc(ex.name)}</h1>
    <h3>Name</h3><input class="field" data-i="ex-name" data-ex="${ex.id}" value="${esc(ex.name)}">
    <h3>Type</h3>${seg('ex-kind', [['strength', 'Strength'], ['cardio', 'Cardio']], ex.kind, `data-ex="${ex.id}"`)}
    <h3>Coaching cues (shown in fine print every time)</h3>
    <textarea class="field" id="cue-text" placeholder="e.g. chest up, elbows ~45°, slow lowering" data-testid="ex-cues">${esc(ex.cues)}</textarea>
    <button class="btn sm" style="margin-top:8px" data-a="ex-cues-save" data-ex="${ex.id}">Save cues</button>
    <h3>Pinned caution (shown every time until unpinned)</h3>
    <textarea class="field" id="pin-text" placeholder="e.g. Shoulder injury — keep elbows tucked">${esc(ex.pinned)}</textarea>
    <div class="row" style="margin-top:8px"><button class="btn sm" data-a="ex-pin-save" data-ex="${ex.id}">Save caution</button>${ex.pinned ? `<button class="btn sm ghost" data-a="unpin" data-ex="${ex.id}">Unpin</button>` : ''}</div>
    <h3>Machines (home gym first)</h3>
    ${sortedMachines(ex).map(m => `<button class="entry" data-a="edit-mach" data-ex="${ex.id}" data-m="${m.id}" data-testid="mach-row"><span class="grow"><b>${esc(m.name)}</b><span class="note">${machSummary(m)}</span></span>✎</button>`).join('') || '<div class="sub">No machines yet.</div>'}
    <div style="height:10px"></div><button class="btn ghost" data-a="new-mach" data-ex="${ex.id}">＋ Add machine / equipment</button>
    <div style="height:24px"></div><button class="btn bad" data-a="ex-archive" data-ex="${ex.id}">Delete exercise (keeps history)</button>`;
}

/* ---------------- Render ---------------- */
function render() {
  const r = route(); curEx = null; let html = ''; let tab = 'today';
  if (!S.setupDone && (r[0] === 'today' || r[0] === '')) { location.replace('#/setup'); return; }
  if (r[0] === 's' && r[2] === 'e') html = viewExercise(r[1], r[3]);
  else if (r[0] === 's') html = viewSession(r[1]);
  else if (r[0] === 'w') html = viewWrap(r[1]);
  else if (r[0] === 'history') { html = viewHistory(); tab = 'history'; }
  else if (r[0] === 'h') { html = viewHistDetail(r[1]); tab = 'history'; }
  else if (r[0] === 'progress') { html = viewProgress(); tab = 'progress'; }
  else if (r[0] === 'settings') { html = viewSettings(); tab = 'settings'; }
  else if (r[0] === 'setup') { html = viewSetup(r[1]); tab = 'settings'; }
  else if (r[0] === 'set' && r[1] === 't') { html = viewTplEdit(r[2]); tab = 'settings'; }
  else if (r[0] === 'set' && r[1] === 'ex') { html = viewExList(); tab = 'settings'; }
  else if (r[0] === 'set' && r[1] === 'e') { html = viewExEdit(r[2]); tab = 'settings'; }
  else if (r[0] === 'set' && r[1] === 'm') { html = viewMachineEdit(r[2], r[3]); tab = 'settings'; }
  else html = viewToday();
  if (!(r[0] === 'set' && r[1] === 'm')) { if (ME && ME.photoId && ME.photoId !== ME.origPhoto) photoDel(ME.photoId).catch(() => {}); ME = null; }
  const bar = curEx ? setbarHTML() : '';
  const app = $('#app'); app.innerHTML = html + bar; app.classList.toggle('has-bar', !!bar);
  document.body.classList.toggle('focus', !!curEx); // exercise screen = full screen, no tab bar
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  centerChips(false);
  if (updateReady) showUpdate();
  setWake(!!curEx || !!lock);
  if (curEx && !pendingDone && !lock && guardSeen !== location.hash) { // once per exercise open
    guardSeen = location.hash; const gs = pastGuardSes();
    if (gs && !$('#sheet-root').innerHTML) openPastGuard(gs, null);
  }
}

/* ---------------- Event handling ---------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a, ds = el.dataset;
  if (a === 'sheet-bg') { if (ev.target === el) closeSheet(null); return; }
  if (el.tagName === 'A') return;
  const p = ds.p; const pk = p && P[p];
  switch (a) {
    case 'sheet-cancel': return closeSheet(null);
    case 'ask-ok': return closeSheet(($('#ask-input').value || '').trim());
    case 'confirm-ok': return closeSheet(true);
    case 'toast-undo': if (toastUndo) toastUndo(); $('#toast').hidden = true; toastUndo = null; return;
    case 'update-reload': return applyUpdate();
    case 'check-update': { if (!swReg) return toast('Updates need the installed app'); toast('Checking…'); await checkForUpdate(); return toast(updateReady ? 'Update ready — tap the bar to reload' : `Up to date (v${APP_VERSION})`); }
    case 'start': return startSession(ds.t, ds.m);
    case 'pick-date': setWorkDate(ds.d); closeSheet(null); if (route()[0] !== 'today') return go('#/today'); return render();
    case 'date-today': setWorkDate(null); closeSheet(null); if (route()[0] !== 'today') return go('#/today'); return render();
    case 'date-earlier': return openEarlierSheet();
    case 'entry-mach': MV = null; return openMoveSheet();
    case 'entry-date': DM = null; return openDateSheet();
    case 'dmscope': if (DM) DM.keep.moveScope = ds.v; return openDateSheet();
    case 'dm-earlier': if (DM) DM.earlier = !DM.earlier; return openDateSheet();
    case 'dm-pick': { const dm = DM; DM = null; if (!dm) return; const s = sesById(dm.sid); dm.keep.moveTo = s && ds.d !== s.date ? ds.d : null; return openEntrySheet(dm.sid, dm.id, dm.keep); }
    case 'dm-back': { const dm = DM; DM = null; if (!dm) return closeSheet(null); return openEntrySheet(dm.sid, dm.id, dm.keep); }
    case 'mvscope': if (MV) MV.scope = ds.v; return openMoveSheet();
    case 'mach-back': { const mv = MV; MV = null; if (!mv) return closeSheet(null); return openEntrySheet(mv.sid, mv.id, mv.keep); }
    case 'mach-move': {
      const mv = MV; if (!mv) return; const s = sesById(mv.sid); const e = s && s.entries.find(x => x.id === mv.id); if (!e) return;
      const ids = mv.scope === 'all' ? setsOf(s, e.exId, e.mId).map(x => x.id) : [e.id];
      const r = moveSets(mv.sid, ids, ds.m); MV = null; if (!r) return;
      openEntrySheet(mv.sid, mv.id, mv.keep); render();
      return toast(`Moved ${r.ents.length === 1 ? 'Set → ' : r.ents.length + ' sets → '}${r.m.name}`, () => { closeSheet(null); r.undo(); });
    }
    case 'repeat': return startSession(ds.t, 'solo', ds.sid);
    case 'finish': { const s = sesById(ds.sid); syncNow(); if (!s || (!s.entries.length && !s.wrap)) { toast('Saved. Nice work!'); return go('#/today'); }
      W = null; wrapReturn = '#/today'; return go(`#/w/${s.id}`); }
    case 'open-wrap': W = null; wrapReturn = `#/h/${ds.sid}`; return go(`#/w/${ds.sid}`);
    case 'wscale': W[ds.k] = +ds.v; return updateScaleUI(ds.k);
    case 'ask-base': {
      const mid = ds.m; const ex = exById(ds.ex || (curEx && curEx.exId)); const m = machById(ex, mid);
      if (!m) return;
      if (!noBase(m) && !baseUnlocked.has(mid)) return toast('Unlock base to change it');
      return openBaseSheet(ex.id, mid);
    }
    case 'unlock-base': baseUnlocked.add(ds.m); return render();
    case 'lock-base': baseUnlocked.delete(ds.m); return render();
    case 'bs-chip': BS.v = +ds.v; BS.other = !!ds.o; return showBaseSheet();
    case 'bs-other': BS.other = true; if (BS.v === null) BS.v = unit() === 'kg' ? 20 : 45; return showBaseSheet();
    case 'bs-save': { const ex = exById(BS.exId), m = machById(ex, BS.mId); setMachineBase(ex, m, BS.v); baseUnlocked.delete(m.id); persist(); closeSheet(); toast(`Base for ${m.name}: ${fmtW(BS.v)} ${unit()}`); BS = null; return render(); }
    case 'bs-later': if (BS) baseLater.add(BS.mId); BS = null; closeSheet(); return render();
    case 'base-later': baseLater.add(ds.m); return render();
    case 'm-unpin': { const m = machById(exById(curEx.exId), ds.m); if (m) { m.caution = ''; persist(); render(); toast('Caution removed (edit it in Setup)'); } return; }
    case 'wtag': { const v = ds.v; W.tags = W.tags.includes(v) ? W.tags.filter(t => t !== v) : W.tags.concat(v); el.classList.toggle('on', W.tags.includes(v)); return; }
    case 'wdur': W.durMin = clamp(W.durMin + (+ds.d), 0, 600); { const d = $('[data-testid=wrap-duration]'); if (d) d.textContent = `${W.durMin} min`; } return;
    case 'wrap-save': { const s = sesById(W.sid); s.wrap = { diff: W.diff, energy: W.energy, tags: W.tags.slice(), thoughts: (W.thoughts || '').trim(), durMin: W.durMin, ts: Date.now() };
      markSessionDirty(s); persist(); const sent = syncSoon(); const ret = wrapReturn; W = null;
      toast((ret === '#/today' ? 'Saved. Nice work!' : 'Wrap-up saved') + (S.sync.url && S.sync.token ? (sent ? ' · syncing' : ' · will sync when online') : '')); return go(ret); }
    case 'wrap-skip': { const ret = wrapReturn; W = null; toast(ret === '#/today' ? 'Saved. Nice work!' : 'No changes'); return go(ret); }
    case 'mode': { const s = sesById(ds.sid); s.mode = ds.v; markSessionDirty(s); persist(); return render(); }
    case 'add-ex-session': {
      const s = sesById(ds.sid); const t = tplById(s.tid) || {};
      const avail = Object.values(S.exercises).filter(e => !e.archived && !s.exIds.includes(e.id)).sort((x, y) => x.name.localeCompare(y.name));
      openSheet(`<h2>Add exercise</h2><div class="chips">${avail.map(e => `<button class="chip sm" data-a="add-ex-pick" data-sid="${s.id}" data-ex="${e.id}">${esc(e.name)}</button>`).join('')}
        <button class="chip sm add" data-a="add-ex-new" data-sid="${s.id}" data-kind="${t.kind || 'strength'}">＋ New ${t.kind === 'cardio' ? 'activity' : 'exercise'}</button></div>
        <div style="height:14px"></div><button class="btn ghost" data-a="sheet-cancel">Cancel</button>`);
      return;
    }
    case 'add-ex-pick': { const s = sesById(ds.sid); s.exIds.push(ds.ex); persist(); closeSheet(); return go(`#/s/${s.id}/e/${ds.ex}`); }
    case 'add-ex-new': {
      const s = sesById(ds.sid); const kind = ds.kind; closeSheet();
      const name = await askText(kind === 'cardio' ? 'New cardio activity' : 'New exercise', '', kind === 'cardio' ? 'e.g. Assault bike' : 'e.g. Pec deck');
      if (!name) return;
      const ex = createExercise(name, kind); s.exIds.push(ex.id); const t = tplById(s.tid); if (t && !t.exIds.includes(ex.id)) t.exIds.push(ex.id);
      persist(); return go(`#/s/${s.id}/e/${ex.id}`);
    }
    case 'mach': {
      const { sid, exId } = curEx; const ses = sesById(sid); const ex = exById(exId);
      const k = draftKey(sid, exId); if (P[k] && P[k].mId !== ds.m) delete P[k];
      initDraft(ses, ex, ds.m); render(); return window.scrollTo(0, 0);
    }
    case 'new-mach': meReturn = location.hash; ME = null; return go(`#/set/m/${ds.ex}/new`);
    case 'edit-mach': meReturn = location.hash; ME = null; return go(`#/set/m/${ds.ex}/${ds.m}`);
    case 'w': pk.add = +ds.v; return updateWeightUI(p);
    case 'wstep': { pk.add = stepChip(pk.add, weightChipList(p), +ds.d); return updateWeightUI(p); }
    case 'rstep': pk.reps = clamp(pk.reps + (+ds.d), 1, 50); return updateRepsUI(p);
    case 'rset': pk.reps = +ds.v; updateRepsUI(p); el.remove(); return;
    case 'dset': pk.diff = +ds.v; return updateDiffUI(p);
    case 'tag': { const v = ds.v; pk.tags = pk.tags.includes(v) ? pk.tags.filter(t => t !== v) : pk.tags.concat(v); el.classList.toggle('on', pk.tags.includes(v)); return; }
    case 'cstep': { const f = ds.f; const lim = { dur: [1, 300], dist: [0, 100] }[f]; pk[f] = round1(clamp(round1((+pk[f]) + (+ds.d)), lim[0], lim[1])); return updateCardioUI(p); }
    case 'cset': pk[ds.f] = +ds.v; return updateCardioUI(p);
    case 'pg-keep': { const g = PG; PG = null; closeSheet(null); if (!g) return; pastOk = g.date;
      if (g.act) { const b = $(`.setbar [data-a="${g.act.a}"]${g.act.n ? `[data-n="${g.act.n}"]` : ''}`); if (b) b.click(); } return; }
    case 'pg-today': { const g = PG; PG = null; closeSheet(null); if (g) switchToToday(g.sid, g.exId); return; }
    case 'log-set': if (pastGuardSes()) return openPastGuard(pastGuardSes(), { a, n: ds.n }); return logSets([+ds.n]);
    case 'log-all': {
      if (pastGuardSes()) return openPastGuard(pastGuardSes(), { a });
      const ses = sesById(curEx.sid); const d = P[draftKey(curEx.sid, curEx.exId)];
      const have = setsOf(ses, curEx.exId, d.mId).map(s => s.set);
      const nums = [1, 2, 3].filter(n => !have.includes(n));
      if (!nums.length) return;
      const todayN = setsOf(ses, curEx.exId).length;
      if (todayN >= 3) {
        const ex = exById(curEx.exId);
        if (!await confirmSheet('Log more sets?', `You already have ${todayN} sets on ${ex ? ex.name : 'this exercise'} ${dayWordLc(ses.date)}. Add ${nums.length} more on this machine?`, 'Add sets', 'pri')) return;
      }
      return logSets(nums);
    }
    case 'log-extra': {
      if (pastGuardSes()) return openPastGuard(pastGuardSes(), { a });
      const ses = sesById(curEx.sid); const d = P[draftKey(curEx.sid, curEx.exId)];
      const n = nextSetNo(ses, curEx.exId, d.mId);
      const todayN = setsOf(ses, curEx.exId).length;
      if (todayN >= 3) {
        const ex = exById(curEx.exId);
        if (!await confirmSheet('Add another set?', `You already have ${todayN} sets on ${ex ? ex.name : 'this exercise'} ${dayWordLc(ses.date)}. Log Set ${n}?`, 'Log set', 'pri')) return;
      }
      return logSets([n]);
    }
    case 'log-cardio': if (pastGuardSes()) return openPastGuard(pastGuardSes(), { a }); return logCardio();
    case 'lock-start': if (pastGuardSes()) return openPastGuard(pastGuardSes(), { a }); return openLock();
    case 'confirm-log': { const pdn = pendingDone; pendingDone = null; return logSets([pdn.setNo], { secs: pdn.secs }); }
    case 'confirm-discard': pendingDone = null; render(); return toast('Set discarded');
    case 'edit-entry': return openEntrySheet(ds.sid, ds.id);
    case 'entry-save': {
      const d = P.ed; const s = sesById(d.sid); const e = s.entries.find(x => x.id === d.id);
      if (e.kind === 'set') { e.add = d.add; e.base = d.noBase ? null : d.base; e.w = round1(d.add + d.base); e.u = unit(); e.reps = d.reps; } else { e.dur = d.dur; e.dist = round1(d.dist); e.level = d.level || 0; }
      e.diff = d.diff; e.tags = d.tags.slice();
      markDirty([e.id]); persist(); closeSheet();
      if (d.moveTo && d.moveTo !== s.date) {
        const ids = d.moveScope === 'all' ? dayEntriesOf(s, e).map(x => x.id) : [e.id];
        const r = moveToDate(s.id, ids, d.moveTo); if (!r) { render(); return toast('Updated'); }
        if (r.removed && location.hash.includes(s.id)) go(location.hash.replace(s.id, r.dst.id)); else render();
        const what = r.ents.length === 1 ? (e.kind === 'set' ? 'set' : 'entry') : `${r.ents.length} ${e.kind === 'set' ? 'sets' : 'entries'}`;
        return toast(`Moved ${what} to ${dayWordLc(d.moveTo).replace(/^on /, '')}`, () => { closeSheet(null); r.undo(); });
      }
      render(); return toast('Updated');
    }
    case 'entry-del': {
      const d = P.ed; const s = sesById(d.sid); const idx = s.entries.findIndex(x => x.id === d.id); const [e] = s.entries.splice(idx, 1);
      markDeleted([e.id]); persist(); closeSheet(); render();
      return toast(e.kind === 'set' ? `Set ${e.set} deleted` : 'Entry deleted', () => { s.entries.splice(idx, 0, e); markDirty([e.id]); persist(); render(); });
    }
    case 'entry-prev': {
      const s = sesById(ds.sid); const cur = s.entries.find(x => x.id === ds.id); if (!cur || cur.kind !== 'set') return;
      const sibs = todaySetsSiblings(s, cur.exId);
      const i = sibs.findIndex(x => x.id === cur.id); if (i <= 0) return;
      return openEntrySheet(ds.sid, sibs[i - 1].id);
    }
    case 'entry-next': {
      const s = sesById(ds.sid); const cur = s.entries.find(x => x.id === ds.id); if (!cur || cur.kind !== 'set') return;
      const sibs = todaySetsSiblings(s, cur.exId);
      const i = sibs.findIndex(x => x.id === cur.id);
      if (i >= 0 && i < sibs.length - 1) return openEntrySheet(ds.sid, sibs[i + 1].id);
      // Last set → ask before adding another (never silent)
      const d = P.ed; if (!d) return;
      const n = nextSetNo(s, cur.exId, cur.mId);
      const tot = round1(d.add + (d.noBase ? 0 : d.base));
      if (!await confirmSheet('Add another set?', `Log Set ${n} at ${fmtW(tot)} × ${d.reps}?`, 'Log set', 'pri')) return;
      const neu = { id: uid(), kind: 'set', exId: cur.exId, mId: cur.mId, set: n, w: tot, add: d.add, base: d.noBase ? null : d.base, u: unit(), reps: d.reps, diff: d.diff, tags: (d.tags || []).slice(), note: '', ts: nowTs() };
      s.entries.push(neu); markDirty([neu.id]); persist();
      return openEntrySheet(ds.sid, neu.id);
    }
    case 'del-session': {
      const s = sesById(ds.sid);
      if (!await confirmSheet('Delete session?', `${(tplById(s.tid) || {}).name || 'Workout'} on ${fmtD(s.date)} with ${s.entries.length} entries will be removed.`)) return;
      S.sessions = S.sessions.filter(x => x !== s); markDeleted(s.entries.map(e => e.id)); persist(); toast('Session deleted'); return go('#/history');
    }
    case 'photo': return openPhoto(ds.id);
    case 'pin-note': exById(ds.ex).pinned = ds.v; persist(); render(); return toast('Pinned as caution');
    case 'unpin': exById(ds.ex).pinned = ''; persist(); return render();
    case 'dismiss-advice': { const ad = S.advice.find(x => x.id === ds.id); if (ad) ad.dismissed = true; persist(); return render(); }
    case 'advice-clear': S.advice = S.advice.filter(x => !x.dismissed); persist(); return render();
    case 'prog-m': prog.m = ds.v; return render();
    case 'prog-metric': prog.metric = ds.v; return render();
    case 'crunchbot': return exportJSON('crunchbot');
    case 'share-json': return exportJSON('share');
    case 'export-json': return exportJSON('download');
    case 'export-sessions-csv': download(new Blob([buildSessionsCSV()], { type: 'text/csv' }), `liftlog-sessions-${todayStr()}.csv`); return toast('Sessions CSV downloaded');
    case 'export-csv': download(new Blob([buildCSV()], { type: 'text/csv' }), `liftlog-${todayStr()}.csv`); return toast('CSV downloaded');
    case 'import-json': return pickFile('application/json,.json').then(importJSON);
    case 'import-choose': return closeSheet(ds.mode);
    case 'undo-import': return undoLastImport();
    case 'import-advice': return pickFile('application/json,.json').then(importAdvice);
    case 'set-unit': S.settings.unit = ds.v; Object.keys(P).forEach(k => delete P[k]); persist(); return render();
    case 'set-step': if (unit() === 'kg') S.settings.stepKg = +ds.v; else S.settings.stepLb = +ds.v; persist(); return render();
    case 'set-reps': S.settings.defaultReps = +ds.v; persist(); return render();
    case 'set-dist': S.settings.distUnit = ds.v; persist(); return render();
    case 'sched-mode': S.schedule[ds.d].m = ds.v; persist(); return render();
    // setup wizard
    case 'wz-skip': S.setupDone = true; persist(); return go('#/today');
    case 'wz-add': addExerciseToTemplate(tplById(ds.t), ds.v); persist(); return render();
    case 'wz-rm': { const t = tplById(ds.t); t.exIds = t.exIds.filter(x => x !== ds.ex); persist(); return render(); }
    case 'wz-bulk': { const t = tplById(ds.t); const lines = ($(`#bulk-${ds.t}`).value || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
      lines.forEach(n => addExerciseToTemplate(t, n)); persist(); render(); return toast(`Added ${lines.length} to ${t.name}`); }
    case 'wz-cues': case 'ex-cues-ask': { const ex = exById(ds.ex); const v = await askText(`Cues for ${ex.name}`, ex.cues, 'e.g. chest up, elbows 45°'); if (v == null) return; ex.cues = v; persist(); return render(); }
    case 'wz-finish': S.setupDone = true; persist(); toast('Setup done — have a great workout!'); return go('#/today');
    // machine editor
    case 'me-gym': ME.gym = ds.v; return render();
    case 'me-gym-new': { const g = await askText('New gym tag', '', 'e.g. San Jose'); if (g) ME.gym = g; return render(); }
    case 'me-base': return meSetBase(ds.v === '' ? null : +ds.v);
    case 'me-bstep': return meSetBase(clamp(round1((ME.base || 0) + (+ds.d) * (unit() === 'kg' ? 2.5 : 5)), 0, 200));
    case 'me-hasstart': ME.hasStart = ds.v === 'yes'; return render();
    case 'me-reps': ME.startReps = ds.v === '' ? null : +ds.v; return render();
    case 'me-photo': return pickFile('image/*', ds.cap).then(f => f && setMEPhoto(f));
    case 'me-photo-del': ME.photoId = null; return render();
    case 'me-cancel': { const ret = meReturn || `#/set/e/${ME.exId}`; return go(ret); }
    case 'me-save': return saveMachine();
    case 'me-del': {
      const ex = exById(ME.exId); const m = machById(ex, ME.key);
      if (S.sessions.some(s => s.entries.some(e => e.exId === ex.id && e.mId === m.id))) return toast('Has history — rename it instead');
      if (!await confirmSheet('Delete machine?', `"${m.name}" will be removed.`)) return;
      if (m.photoId) photoDel(m.photoId).catch(() => {}); ex.machines = ex.machines.filter(x => x !== m); persist(); ME = null; return go(meReturn || `#/set/e/${ex.id}`);
    }
    // templates & exercises
    case 'tpl-new': { const name = await askText('New template', '', 'e.g. Arms Day'); if (!name) return; const t = { id: uid(), name, kind: 'strength', exIds: [] }; S.templates.push(t); persist(); return go(`#/set/t/${t.id}`); }
    case 'tpl-up': case 'tpl-down': {
      const t = tplById(ds.t); const list = t.exIds.filter(id => exById(id) && !exById(id).archived); const i = list.indexOf(ds.ex); const j = a === 'tpl-up' ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; t.exIds = list; persist(); return render();
    }
    case 'tpl-rm': { const t = tplById(ds.t); t.exIds = t.exIds.filter(x => x !== ds.ex); persist(); return render(); }
    case 'tpl-add': { const t = tplById(ds.t); t.exIds.push(ds.ex); persist(); return render(); }
    case 'tpl-add-new': { const t = tplById(ds.t); const name = await askText('New exercise', '', 'e.g. Pec deck'); if (!name) return; addExerciseToTemplate(t, name); persist(); return render(); }
    case 'tpl-del': { const t = tplById(ds.t); if (!await confirmSheet('Delete template?', `"${t.name}" will be removed. Logged sessions are kept.`)) return;
      S.templates = S.templates.filter(x => x !== t); Object.values(S.schedule).forEach(s => { if (s.t === t.id) s.t = null; }); persist(); return go('#/settings'); }
    case 'ex-new': { const name = await askText('New exercise', '', 'e.g. Pec deck'); if (!name) return; const ex = createExercise(name, 'strength'); persist(); return go(`#/set/e/${ex.id}`); }
    case 'ex-kind': exById(ds.ex).kind = ds.v; persist(); return render();
    case 'ex-cues-save': exById(ds.ex).cues = ($('#cue-text').value || '').trim(); persist(); render(); return toast('Cues saved');
    case 'ex-pin-save': exById(ds.ex).pinned = ($('#pin-text').value || '').trim(); persist(); render(); return toast('Caution saved');
    case 'ex-archive': { const ex = exById(ds.ex); if (!await confirmSheet('Delete exercise?', `"${ex.name}" is removed from templates. Its history stays.`)) return;
      ex.archived = true; S.templates.forEach(t => { t.exIds = t.exIds.filter(x => x !== ex.id); }); persist(); return go('#/set/ex'); }
    case 'sync-save': S.sync.url = ($('#sync-url').value || '').trim(); S.sync.token = ($('#sync-token').value || '').trim(); S.sync.err = ''; persist(); toast('Sync settings saved'); render(); return syncNow();
    case 'sync-now': if (!S.sync.url) return toast('Add the sync URL first'); toast('Syncing…'); await syncNow({ force: true }); render(); return toast(S.sync.err ? 'Sync failed — will retry' : 'Synced');
    case 'sync-restore': {
      const u = ($('#sync-url') && $('#sync-url').value || S.sync.url || '').trim(), tk = ($('#sync-token') && $('#sync-token').value || S.sync.token || '').trim();
      if (!u || !tk) return toast('Enter the sheet URL and token first');
      if (!await confirmSheet('Restore from Google Sheet?', "Adds any sets and sessions from your sheet that aren't on this phone. Nothing on this phone is removed or changed.", 'Restore', 'pri')) return;
      S.sync.url = u; S.sync.token = tk; persist(); toast('Reading your sheet…');
      try { const data = await fetchSheetRows(); const r = mergeSheetRows(data); await persist(); render();
        return toast(`Restored ${r.sets} entr${r.sets === 1 ? 'y' : 'ies'} in ${r.sessions} new session${r.sessions === 1 ? '' : 's'}${r.wraps ? ` · ${r.wraps} wrap-up${r.wraps === 1 ? '' : 's'}` : ''} · ${r.kept} already here`); }
      catch (e) { return toast('Restore failed: ' + (e && e.message || e)); }
    }
    case 'sync-full': markDirty(S.sessions.flatMap(s => s.entries.map(e => e.id))); persist(); render(); return syncNow({ force: true });
  }
});
async function eraseAllData() {
  try { if (DB.db) await DB.clear('photos'); else memPhotos.clear(); } catch (e) {}
  try { await saveImportSnaps([]); } catch (e) {}
  S = seed(); persist(); Object.keys(P).forEach(k => delete P[k]);
  go('#/today');
}
async function setMEPhoto(file) {
  try {
    toast('Saving photo…');
    const blob = await resizeImage(file); const id = 'ph-' + uid();
    await photoPut(id, blob);
    if (ME.photoId && ME.photoId !== ME.origPhoto) photoDel(ME.photoId).catch(() => {});
    ME.photoId = id; render(); toast(`Photo ready (${Math.round(blob.size / 1024)} KB) — tap Save`);
  } catch (e) { toast('Could not save photo: ' + ((e && e.message) || e)); }
}
function saveMachine() {
  const ex = exById(ME.exId); const name = (ME.name || '').trim();
  if (!name) return toast('Give the machine a short name');
  let m = !ME.isNew && machById(ex, ME.key);
  if (!m) { m = { id: uid() }; ex.machines.push(m); }
  const renamed = !ME.isNew && m.name !== name;
  Object.assign(m, { name, gym: (ME.gym || '').trim(), loc: (ME.loc || '').trim(), cues: (ME.cues || '').trim(), caution: (ME.caution || '').trim(), bu: m.bu || unit() });
  if (m.base === undefined) m.base = null;
  setMachineBase(ex, m, ex.kind === 'cardio' ? 0 : ME.base);
  if (ME.origPhoto && ME.origPhoto !== ME.photoId) photoDel(ME.origPhoto).catch(() => {});
  if (ME.photoId) m.photoId = ME.photoId; else delete m.photoId;
  if (ex.kind !== 'cardio') {
    if (ME.hasStart && !(round1(P.me.add + (ME.base || 0)) === 0 && !ME.startReps)) m.start = { w: round1(P.me.add + (ME.base || 0)), u: unit(), reps: ME.startReps || null, date: (m.start && m.start.date) || todayStr(), ts: nowTs() };
    else delete m.start;
  }
  Object.keys(P).forEach(k => { if (P[k] && P[k].mId === m.id) delete P[k]; }); // re-derive drafts with the new base
  ME.origPhoto = ME.photoId; // saved: don't clean up
  if (renamed) markExDirty(ex.id);
  persist(); const ret = meReturn || `#/set/e/${ex.id}`; ME = null; toast(`Saved ${name}`); go(ret);
}
document.addEventListener('input', ev => {
  const el = ev.target; const i = el.dataset && el.dataset.i; if (!i) return; const p = el.dataset.p; const pk = p && P[p];
  if (i === 'reps') { pk.reps = +el.value; updateRepsUI(p); }
  else if (i === 'diff') { pk.diff = +el.value; updateDiffUI(p); }
  else if (i === 'wscale' && W) { W[el.dataset.k] = +el.value; updateScaleUI(el.dataset.k); }
  else if (i === 'wrap-thoughts' && W) W.thoughts = el.value;
  else if (i === 'dur' || i === 'dist' || i === 'level') { pk[i] = +el.value; updateCardioUI(p); }
  else if (i === 'thoughts' && curEx) { const s = sesById(curEx.sid); s.thoughts = s.thoughts || {}; s.thoughts[curEx.exId] = el.value; persist(); markDirty(s.entries.filter(e => e.exId === curEx.exId).map(e => e.id)); }
  else if (i === 'me-name' && ME) ME.name = el.value;
  else if (i === 'me-loc' && ME) ME.loc = el.value;
  else if (i === 'me-cues' && ME) ME.cues = el.value;
  else if (i === 'me-caution' && ME) ME.caution = el.value;
});
document.addEventListener('change', ev => {
  const el = ev.target; const i = el.dataset && el.dataset.i; if (!i) return;
  if (i === 'prog-ex') { prog.ex = el.value; prog.m = null; render(); }
  else if (i === 'sched') { S.schedule[el.dataset.d].t = el.value || null; persist(); render(); }
  else if (i === 'home-gym') { S.settings.homeGym = el.value.trim(); persist(); }
  else if (i === 'tpl-name') { const t = tplById(el.dataset.t); const v = el.value.trim(); if (v) { t.name = v; S.sessions.filter(s => s.tid === t.id).forEach(markSessionDirty); persist(); } }
  else if (i === 'ex-name') { const ex = exById(el.dataset.ex); const v = el.value.trim(); if (v) { ex.name = v; markExDirty(ex.id); persist(); } }
});

/* ---------------- Service worker & boot ---------------- */
/* Updates without clearing Safari: check on launch + every return to foreground; a waiting worker shows a small bar;
   tapping it saves state, activates the new worker and reloads. Data lives in IndexedDB/localStorage, untouched by updates. */
let updateReady = false, swReg = null, swReloading = false, swTapped = false;
function showUpdate() {
  updateReady = true;
  if ($('#update-bar')) return;
  const b = document.createElement('button'); b.id = 'update-bar'; b.className = 'updbar'; b.dataset.a = 'update-reload'; b.dataset.testid = 'update-bar';
  b.textContent = '⬆ Update ready — tap to reload'; document.body.appendChild(b);
}
function checkForUpdate() { if (swReg) return swReg.update().then(() => { if (swReg.waiting && navigator.serviceWorker.controller) showUpdate(); }).catch(() => {}); return Promise.resolve(); }
function watchWorker(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) showUpdate();
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing; if (!nw) return;
    nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(); });
  });
}
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => { swReg = reg; watchWorker(reg); checkForUpdate(); })
    .catch(e => console.warn('SW registration failed', e));
  // Only reload when the user asked (never yank the screen mid-set).
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (swTapped && !swReloading) { swReloading = true; location.reload(); } });
}
async function applyUpdate() {
  swTapped = true;
  try { await persist(); } catch (e) {}
  const w = swReg && swReg.waiting;
  if (w) { w.postMessage({ type: 'SKIP_WAITING' }); setTimeout(() => { if (!swReloading) { swReloading = true; location.reload(); } }, 3000); }
  else { swReloading = true; location.reload(); }
}
async function maybeSafetyBackup(reason) {
  // Cheap local snapshot (no photos) before anything that might reshuffle catalog/state.
  try {
    await saveImportSnapshot(reason || 'safety backup', { kind: 'safety', skipPhotos: true });
  } catch (e) { console.warn('safety backup failed', e); }
}
(async function boot() {
  S = await loadState();
  S.sessions.forEach(s => s.entries.forEach(e => { if (e.ts > lastTs) lastTs = e.ts; }));
  await refreshSnapCount();
  // On app version change: snapshot first so an upgrade path can never strand the only copy.
  if (S.lastAppVersion !== APP_VERSION) {
    if (S.lastAppVersion) await maybeSafetyBackup('before upgrade ' + S.lastAppVersion + ' → ' + APP_VERSION);
    S.lastAppVersion = APP_VERSION;
    persist();
  }
  // Auto-apply published catalog before first paint when possible (first-run setup + updates).
  await checkCatalogUpdate();
  persist();
  render(); registerSW();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
  scheduleSync(1500);
  window.__liftlog = { state: () => S, persist, syncNow, version: APP_VERSION, wake: () => ({ wanted: wakeWanted, held: !!wakeSentinel }),
    mergeCatalog, saveImportSnapshot, loadImportSnaps, refreshSnapCount, checkCatalogUpdate, undoLastImport, eraseAllData, maybeSafetyBackup };
})();
})();
