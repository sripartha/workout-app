/**
 * Lift Log -> Google Sheet sync (Google Apps Script web app)
 *
 * Paste this whole file into Extensions > Apps Script of your Google Sheet,
 * change TOKEN below to your own long random secret, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * Put the /exec URL and the same TOKEN into Lift Log > Setup > Sync.
 * After pasting a newer version: Deploy > Manage deployments > Edit > Version: New version.
 *
 * POST body (JSON, sent as text/plain to avoid a CORS preflight):
 *   { token, app: "liftlog",
 *     upserts: [ {id, date, template, ...CSV columns} ], deletes: [id, ...],              -> "Log" tab (one row per set/cardio entry)
 *     sessions: [ {session_id, date, template, mode, duration_min, ...} ], sessionDeletes: [session_id, ...],  -> "Sessions" tab
 *     journal: [ {id, time, day, local_time, action, summary, records, before, after, app_version, ref, ts} ],     -> "Activity Log" tab
 *     wantAdvice: true }
 * Response: { ok: true, upserted, deleted, sessionsUpserted, sessionsDeleted, journalUpserted, advice: [ {exercise, machine, note, date} ] }
 * The "Activity Log" tab (app 2.5.7+) is append-only: rows are upserted by entry id and never deleted by the app.
 * (The existing "Log" tab keeps holding one row per set; the activity log uses its own tab so set rows are never mixed up.)
 *
 * Restore (read everything back, same token):
 *   POST { token, action: "export" }          -> { ok: true, sets: [ {id, date, ...} ], sessions: [ {session_id, ...} ] }
 *   GET  ?token=...&action=export             -> same JSON (handy for testing in a browser)
 * GET ?token=...&action=advice  -> { ok: true, advice: [...] }
 * GET ?token=...                -> { ok: true, app, rows }   (connection check)
 */
var TOKEN = 'CHANGE-ME-to-a-long-random-secret';   // must match the token in the app
var LOG_SHEET = 'Log';
var SESSIONS_SHEET = 'Sessions';
var ADVICE_SHEET = 'Advice';
var ACTIVITY_SHEET = 'Activity Log';
var COLUMNS = ['id', 'date', 'template', 'mode', 'exercise', 'machine', 'gym', 'type', 'set', 'weight', 'added_weight', 'base_weight', 'unit', 'reps',
  'difficulty', 'set_seconds', 'duration_min', 'distance', 'distance_unit', 'level', 'tags', 'note', 'thoughts',
  'session_id', 'exercise_id', 'machine_id', 'template_id', 'ts', 'updated_at'];   // *_id + ts let "Restore from Google Sheet" rebuild the phone exactly
var SESSION_COLUMNS = ['date', 'template', 'mode', 'duration_min', 'exercises', 'sets', 'volume', 'unit', 'session_difficulty', 'energy', 'chips',
  'thoughts', 'session_id', 'template_id', 'updated_at'];
var ADVICE_COLUMNS = ['exercise', 'machine', 'note', 'date'];
var ACTIVITY_COLUMNS = ['id', 'time', 'day', 'local_time', 'action', 'summary', 'records', 'before', 'after', 'app_version', 'ref', 'ts'];

function secret_() {
  var p = PropertiesService.getScriptProperties().getProperty('TOKEN'); // optional override
  return p || TOKEN;
}
function tokenOk_(t) { var s = secret_(); return !!t && t === s && s.indexOf('CHANGE-ME') !== 0; }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function sheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Header row; appends any missing columns (e.g. after an app update). Values are always written by header name. */
function header_(sh, columns) {
  var n = Math.max(1, sh.getLastColumn ? sh.getLastColumn() : columns.length);
  var h = sh.getRange(1, 1, 1, n).getValues()[0].map(function (x) { return String(x || '').trim(); });
  while (h.length && !h[h.length - 1]) h.pop();
  var missing = columns.filter(function (c) { return h.indexOf(c) === -1; });
  if (missing.length) { sh.getRange(1, h.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold'); h = h.concat(missing); }
  return h;
}

/** Keep id columns as plain text so Sheets never turns an id into a number or date. */
function textIdCols_(sh, header) {
  if (!sh.getMaxRows) return;
  header.forEach(function (h, j) { if (h === 'id' || /_id$/.test(h)) sh.getRange(1, j + 1, sh.getMaxRows(), 1).setNumberFormat('@'); });
}

/** Upsert rows into a tab by the id column `idCol`, then delete rows whose id is in `dels`. Returns [upserted, deleted]. */
function upsertTab_(name, columns, idCol, rows, dels) {
  rows = rows || []; dels = (dels || []).map(String);
  if (!rows.length && !dels.length) return [0, 0];
  var sh = sheet_(name, columns);
  var header = header_(sh, columns);
  var ic = header.indexOf(idCol);                 // 0-based column of the id
  textIdCols_(sh, header);
  var readIds = function () {
    var lr = sh.getLastRow();
    return lr > 1 ? sh.getRange(2, ic + 1, lr - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  };
  var rowOf = {};
  readIds().forEach(function (id, i) { if (id) rowOf[id] = i + 2; });
  var now = new Date(), appends = [], appendIdx = {}, up = 0, del = 0;
  rows.forEach(function (r) {
    if (!r || !r[idCol]) return;
    var id = String(r[idCol]);
    var values = header.map(function (c) { return c === 'updated_at' ? now : (r[c] === undefined || r[c] === null ? '' : r[c]); });
    if (rowOf[id]) sh.getRange(rowOf[id], 1, 1, header.length).setValues([values]);
    else if (appendIdx[id] !== undefined) appends[appendIdx[id]] = values;   // same id twice in one request: keep the last
    else { appendIdx[id] = appends.length; appends.push(values); }
    up++;
  });
  if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, header.length).setValues(appends);
  if (dels.length) {
    var hit = [];
    readIds().forEach(function (id, i) { if (dels.indexOf(id) !== -1) hit.push(i + 2); });
    hit.sort(function (a, b) { return b - a; }).forEach(function (rn) { sh.deleteRow(rn); del++; });
  }
  return [up, del];
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad JSON' }); }
  if (!body || !tokenOk_(body.token)) return json_({ ok: false, error: 'Bad token' });
  if (body.action === 'export') return json_(export_());

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var log, ses, act;
  try {
    log = upsertTab_(LOG_SHEET, COLUMNS, 'id', body.upserts, body.deletes);
    ses = upsertTab_(SESSIONS_SHEET, SESSION_COLUMNS, 'session_id', body.sessions, body.sessionDeletes);
    act = upsertTab_(ACTIVITY_SHEET, ACTIVITY_COLUMNS, 'id', body.journal, []);   // append-only: never deletes
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true, upserted: log[0], deleted: log[1], sessionsUpserted: ses[0], sessionsDeleted: ses[1], journalUpserted: act[0],
    advice: body.wantAdvice ? readAdvice_() : [] });
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!tokenOk_(p.token)) return json_({ ok: false, error: 'Bad token' });
  if (p.action === 'advice') return json_({ ok: true, advice: readAdvice_() });
  if (p.action === 'export') return json_(export_());
  return json_({ ok: true, app: 'liftlog-sync', rows: Math.max(0, sheet_(LOG_SHEET, COLUMNS).getLastRow() - 1) });
}

/** All rows of a tab as objects keyed by header. Dates come back as yyyy-MM-dd (the "date" column) or ISO text. */
function readTab_(name, idCol) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var nc = sh.getLastColumn();
  var all = sh.getRange(1, 1, sh.getLastRow(), nc).getValues();
  var head = all[0].map(function (x) { return String(x || '').trim(); });
  var tz = Session.getScriptTimeZone();
  var out = [];
  for (var i = 1; i < all.length; i++) {
    var o = {};
    head.forEach(function (h, j) {
      if (!h) return;
      var v = all[i][j];
      if (Object.prototype.toString.call(v) === '[object Date]') v = h === 'date' ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
      o[h] = v;
    });
    if (o[idCol] !== '' && o[idCol] != null) { o[idCol] = String(o[idCol]); out.push(o); }
  }
  return out;
}
function export_() {
  return { ok: true, app: 'liftlog-sync', sets: readTab_(LOG_SHEET, 'id'), sessions: readTab_(SESSIONS_SHEET, 'session_id') };
}

/** Advice tab: columns exercise | machine (optional) | note | date. One row per advice note. */
function readAdvice_() {
  var sh = sheet_(ADVICE_SHEET, ADVICE_COLUMNS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, last - 1, 4).getValues().filter(function (r) { return r[0] && r[2]; }).map(function (r) {
    var d = r[3];
    return {
      exercise: String(r[0]).trim(),
      machine: r[1] ? String(r[1]).trim() : '',
      note: String(r[2]).trim(),
      date: Object.prototype.toString.call(d) === '[object Date]' ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(d || '')
    };
  });
}

/** Optional: run once from the editor to create the tabs with headers. */
function setup() {
  sheet_(LOG_SHEET, COLUMNS);
  sheet_(SESSIONS_SHEET, SESSION_COLUMNS);
  sheet_(ADVICE_SHEET, ADVICE_COLUMNS);
  sheet_(ACTIVITY_SHEET, ACTIVITY_COLUMNS);
}
