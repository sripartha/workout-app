# Lift Log — tap-only workout logger (PWA for iPhone)

A static, offline-first Progressive Web App. Plain HTML/CSS/JS, **no build step, no dependencies, no CDN**.
At the gym every action is a tap, chip or slider; typing is only for setup.

## Files

| Path | What |
|---|---|
| `index.html` | App shell + iOS meta (apple-mobile-web-app-capable, apple-touch-icon, `viewport-fit=cover`) |
| `app.js` | All app logic (IndexedDB storage, views, charts, export/import, sync) |
| `styles.css` | Dark, one-handed, big-target UI with `env(safe-area-inset-*)` for notch/home bar |
| `sw.js` | Service worker: precaches the shell, cache-first, fully offline |
| `manifest.webmanifest`, `icons/` | Web app manifest + 180/192/512/maskable icons |
| `sync/Code.gs` | Optional Google Apps Script web app for Google Sheet sync |
| `SPEC.md` | Gherkin acceptance spec (scenario IDs used by the tests) |
| `tests/e2e.js` | Playwright acceptance suite (iPhone viewport 390×844) |
| `tests/seed.e2e.js` | Imports a seed backup (default `/workspace/catalog/liftlog-seed.json`) and checks the unset-base flow |
| `tests/exhistory.e2e.js` | 2.5.9 exercise history, machine tile grid + recency order, Upper-Back Row 10-6 + Nautilus Leverage Incline catalog |
| `tests/journal.e2e.js` | 2.5.7 activity log: entries, screen, Restore this, storage, retention, export, move/undo regressions |
| `tests/apps-script.test.js` | Runs `sync/Code.gs` against a fake Spreadsheet |
| `screenshots/` | Screenshots from the test run |

Only these need hosting: `index.html app.js styles.css sw.js manifest.webmanifest icons/`.

## Using it

0. **First run** opens a 3-step **Setup** (nothing is pre-loaded; the Push/Pull/Leg/Core/Cardio days start empty, the schedule is kept):
   1. units + optional **home gym** (e.g. Lakeway);
   2. **exercises per day**: tap suggestion chips or type several, one per line;
   3. **machines** per exercise: free name (near-duplicates fine, e.g. two "Hammer Strength"), optional **gym tag** (home gym listed first,
      e.g. San Jose), optional **location note** ("back wall, by the windows"), **base weight** (barbell 45, 0 for stacks/dumbbells),
      optional photo, **coaching cues**, and a **starting weight (+ optional reps)** that becomes the first "last time".
      Exercise-level cues too. Everything stays editable in Setup › Exercises.
1. **Today**: shows today's planned template from the weekly schedule (Mon Push w/ coach, Tue Legs solo, Wed Pull w/ coach,
   Thu Push solo, Fri Legs w/ coach, Sat Pull solo, Sun rest). On solo days it offers **Repeat Monday's Push** etc.,
   which loads that session's exercises in order with its machine + weight×reps as targets. A **backup reminder** appears when the
   last export or successful sync was more than 7 days ago.
2. **Session**: exercises of the template; coach/solo toggle; ✓ badges for done exercises.
3. **Exercise** (one per full screen, tab bar hidden, screen kept awake via the Wake Lock API where supported):
   * Fine print: your cues (exercise + machine) and the machine's gym · location.
   * Before choosing a machine: a **Last machine used** card (machine, total weight × reps, difficulty, date) with "Use …"; every machine
     card shows its own last result. Picking a different machine keeps **Previous machine: …** visible for reference.
   * Weight chips (5 lb steps) pick the **added** weight; the screen shows **55 added + 45 base = 100 lb**. Totals are what history,
     charts, last-time, CSV and Sheet use (added and base are stored too).
   * Reps slider 1–15 (default 12). **Difficulty slider 1–5** (default 3): 1 ridiculously easy · 2 easier than average (consider
     going up) · 3 as expected · 4 too hard · 5 barely possible. If last time was 1–2 on that machine you get a **try going up** hint
     with a one-tap +5 chip. Quick note chips.
   * Bottom bar: **💭 Thoughts (optional)** box (saved with the session, shown in History), **Set 1 / Set 2 / Set 3**, **All 3 sets**
     and **▶ Start set N**.
4. **Locked set mode** (▶ Start): full-screen, everything inert, a running timer and two **Done** buttons in the bottom corners.
   The set ends only when **both are held together ~0.3 s** (two thumbs); a single touch does nothing (the pressed button lights up).
   No pinch-zoom/scroll. **Hold to cancel** (1 s) in the corner aborts. Then a confirm screen lets you adjust weight, reps and
   difficulty and logs the set with its duration.
4b. **Workout wrap-up** (**Done for today**): an auto summary (exercises, sets, total volume, duration, coach/solo; duration is
   first logged set → now and can be nudged ±5 min), an **overall session difficulty** slider 1–5 (Very easy … Brutal, default 3),
   an **energy** slider 1–5 (Exhausted … Great, default 3), quick chips (great session, felt strong, PR today, tired, bad sleep,
   short on time, shoulder sore, skipped exercises) and an optional **Thoughts about today** box. **Skip for now** saves nothing;
   History › session › **Wrap-up › Edit / Add wrap-up** changes it later. History cards show it as a 🏁 line.
5. **Heads up**: if the last session of that exercise (any machine) was difficulty 4–5 or had notes/thoughts, a card at the top shows
   them. Tap **📌 Pin** to keep it as a persistent caution (or type one in Setup › Exercises); **Unpin** removes it.
6. **Cardio**: add e.g. Treadmill in setup (each gets a "Standard" machine). Duration/distance/level/difficulty by slider,
   chips and ± buttons; defaults to the last values for that activity.
7. **History**: sessions by date with thoughts; tap to edit any set (taps only), delete entries or whole sessions, change coach/solo.
8. **Progress**: per exercise + machine: top total weight, est. 1RM (Epley), volume; cardio duration/distance. Hand-rolled SVG.
9. **Setup**: units (lb/kg, step size), home gym, default reps, schedule, templates (add/remove/reorder exercises), exercises & machines
   (rename without losing history, add near-duplicates, base weight, gym, location, cues, **photo**, starting weight, delete),
   pinned cautions, sync, advice import, backup, re-run first-run setup.

### Base weight not set yet (v2.2)
A machine's base can be **not set** (machines imported from a catalog start that way, because a coach usually writes down
plate weight only). Logging never waits for it: sets are saved as **added** weight with the base unknown, shown as
"50 lb + base?" in history and as "added weight only" in charts (CSV leaves weight/base_weight blank). Set it any time, tap-only,
from the small **Base: — (tap to set)** line on the exercise screen (chips 0–45, **Other…** row up to 200 lb, **Not sure / later**)
or in the machine editor. When you set it, earlier sets on that machine get their totals filled in automatically. Changing it later
only affects new sets.

### Fine-tuning weights (v2.5.6)
* **Working weight**: two tiny circles **1** and **.5** sit beside the big **−** (step down 1 / 0.5) and beside the big **+**
  (step up 0.5 / 1), in the display unit (lb or kg): `(1)(.5) −  50 lb  + (.5)(1)`. Half-pound values (e.g. 12.5 lb) save, display,
  sync and export as-is, and the next visit pre-fills 12.5 instead of rounding to the chip step.
* **Base**: tap **Unlock** on the 🔒 base line → it becomes `(1)(.5)  Base 10 lb ✎  (.5)(1)  🔒 Lock` (tap the value for the full
  picker). Base 10 → 12: **Unlock, right-hand 1, right-hand 1, Lock**.
* **What a base change does** (same rule as the base picker): every set stores its own `add`, `base` and total `w` (= add + base) when
  it is logged. Changing a machine's base updates the machine and the live total on screen (working stays, total moves by the base
  difference); sets logged after the change use the new base. **Already-logged sets keep their stored base and total** (e.g. 50 + 10 =
  60 stays 60), so history, charts, CSV and the Sheet don't change. Only sets logged while the base was *not set* get totals filled
  in. To correct one old set, open it and adjust its weight.
* Dumbbell machines (name contains "Dumbbell") label the weight **(per dumbbell)**: log one dumbbell, not the pair.

### Exercise history and machine tiles (v2.5.9)
* **History** (small link at the top right of every exercise screen, beside Edit) opens a **read-only** list of every logged set
  of that exercise, across all days and machines, newest first and grouped by date. Each row is small print:
  `machine (location) · S# · working + base = total × reps · difficulty · note chips`. At the top, one line per machine shows
  **best** (heaviest total, then most reps) and **last**. There are no edit controls, only **‹ Back** (your weight / reps
  draft is kept). This screen scrolls.
* **Machine tiles** on the exercise screen wrap into a compact grid (3 per row on iPhone, names up to two lines): every machine is
  visible without sideways scrolling, with the selected one highlighted and **＋ New** last. With many machines the page may scroll
  down, but never sideways. A hidden reps control that made the page 14 px too wide is also fixed.
* **Tile order**: most recently used for this exercise first (time of its latest logged set), then never-used machines in their
  usual order, **＋ New** last. A small **red dot** marks the most recently used tile. The order is worked out when the screen opens
  and stays put while you log (no reshuffling mid-exercise).
* **Machine cues** show again on the exercise screen as one small line under the location. Tap it to read the full cues.
* Catalog:
  * **Iso-Lateral Upper-Back Row** (the machine Sri logs on) is really at **10-6**, not 9-6 (there's no row machine at 9-6). It
    keeps the same id and sets, now has **base 12 lb**, and has the cue "Elbows flared and up; focus on squeezing the back". No
    other row 9 machine changed.
  * Incline Press › **Nautilus Leverage Incline Press**, Lakeway 10-10, plate-loaded, base not set yet.
  * **Base from the catalog never rewrites logged sets** (new in 2.5.9): they keep their saved add / base / total, including sets
    logged while the base was not set (shown as "+ base?"). Only entering a base on the phone fills those in, as before.

### Activity log (v2.5.7)
Setup › **🧾 Activity log**. Every data change on the phone appends one entry: time, action (set add / edit / delete, move-date,
move-machine, session create / delete, wrap-up save, base change, catalog merge, version migration, restore, import, undo), the ids
and the **full before and after value** of every record it touched (sets, sessions, machines, exercises, templates, settings,
schedule, advice). Entries are only ever appended, never edited (quick repeats on the same record, such as typing notes or tapping
the base circles, are folded into one entry for up to 20 s while it hasn't synced yet).
* **Readable list**, newest first, grouped by day, e.g. `7:12 AM · Moved Chest Press S3 from Tue, Oct 6 → Mon, Oct 5`. The day
  chips at the top filter to one day. *Before / after* opens the raw values.
* **Restore this** (on delete and move entries) puts the record back as it was before that entry: a deleted set goes back
  into its session (the session itself is re-created if it was deleted, e.g. with its wrap-up), a moved set goes back to its day
  or machine. Nothing else is removed. If a set logged since then took the same set number, the sets on that machine are
  renumbered by time so none is hidden. The restore is logged too (`restore`, with a link to the entry), and the row shows *restored ✓*.
* **Storage**: kept apart from the workout data, in IndexedDB (keys `jn:<time>:<id>`) plus a localStorage copy of the newest
  entries (~1.5 MB). If one copy is lost, the other fills it back in. If storage gets tight, the workout data is saved first.
* **Retention**: an entry is removed only when it is older than 90 days **and** outside the newest 5,000, so you always keep 90 days
  or 5,000 entries (whichever is more), and anything from the last 30 days is never removed.
* **Backups and sheet**: JSON backups include the log (`journal`). Importing a backup adds the log entries you don't have yet. Sync
  sends it to the sheet's **Activity Log** tab (see the sync section).
* **Upgrading** from 2.5.6 doesn't touch existing data. The first launch logs `App updated 2.5.6 → 2.5.7`.

**Moving sets between days: what 2.5.7 checked and fixed.**
* *Fixed*: **Undo** (after a date move, a set delete or a machine move) used to put the old set numbers back without checking for
  conflicts. If a set had been logged meanwhile and taken that number, two sets shared one number and one was hidden from the Set
  buttons (it was still saved). Undo and Restore now renumber the machine's sets by time when numbers clash.
* *Fixed*: suppose moving all of a day's sets removed that day's empty session, and you then opened the same day and workout
  again before tapping **Undo**. Undo used to create a second session for that day. It now returns the sets into the re-opened one.
  Undo also finds the moved sets wherever they are now, even if they were edited in the meantime.
* *Checked, nothing found*:
  * A session is removed only when it has no sets, no wrap-up and no notes, so a session that still holds sets is never deleted.
  * Renumbering after a move numbers each machine's sets 1…n in time order, so numbers don't collide.
  * Moving to a day that only has a different workout (e.g. Push set → a Pull day) gives the set its own Push session on that day.
    Nothing is merged or dropped.

### One-time repair of hidden sets (v2.5.8)
Date moves and Undo in 2.5.5/2.5.6 could leave sets that are saved but not shown. The first launch of 2.5.8 checks every session
once (flag `migrated.repair258`) and fixes, in this order:
1. **Two sessions for the same day and workout** (Undo brought an emptied day back after that day had been started again). They are
   merged into the session the app opens. Every set and exercise is moved over, and notes, wrap-up thoughts and tags are combined
   (the first wrap-up's ratings are kept). Nothing is dropped. The merged-away session's full record stays in the activity log.
2. **Sets whose exercise was missing from their session's exercise list**, so they weren't shown on that session screen. The
   exercise is listed again.
3. **Duplicate set numbers** on one exercise + machine (one set hidden from the Set buttons). Only groups with duplicates are
   renumbered, in the order the sets were logged. Groups without duplicates keep their numbers.

Each fix is its own activity-log entry (action `repair`) with full before/after values, e.g.
`Repaired: Chest Press on Tue, Oct 6, 2 hidden sets restored`. If anything was fixed, a one-time toast says
**Found and restored N hidden sets — see Activity log**. Data with no problems is left untouched. Sets are stored inside their
session, so a set can't point to a missing session. The checks above cover the states a move could actually leave.
When the localStorage and IndexedDB copies have the same sets and machines, the newer save now wins (a save counter), so an
IndexedDB write still in flight at relaunch can't bring back the pre-repair copy.

### Per-machine cautions
Besides the exercise-level pinned caution, each machine can carry its own caution (machine editor › *Caution for this machine*).
It shows in small print on the machine card and as a ⚠️ card when that machine is selected.

### Machine photos
Machine editor (first-run setup, or Setup › Exercises › exercise › machine) › **📷 Take photo** (camera, `capture=environment`) or **🖼 Choose photo** (Photos).
Images are resized on-device to max 1600 px JPEG (~80–300 KB) and stored in IndexedDB. The exercise page shows only a small
**📷 Photo** link; tapping it opens the picture full-screen, tap to close. Photos are in JSON backups (base64), never in CSV or sync.

### Backup, CrunchBot, advice
* **Download JSON backup** / **Import JSON backup** (Setup): full round-trip incl. photos. Import replaces data on the phone (asks first). Backups include the activity log.
* **Download CSV**: one row per set / cardio entry, no photos. Columns:
  `date, template, mode, exercise, machine, gym, type, set, weight (total), added_weight, base_weight, unit, reps, difficulty,
  set_seconds, duration_min, distance, distance_unit, level, tags, note, thoughts`.
* **Download sessions CSV** (Setup): one row per session: `date, template, mode, duration_min, exercises, sets, volume, unit,
  session_difficulty, energy, chips, thoughts, session_id`. The JSON backup includes the wrap-up on each session.
* **Backup reminder**: Today shows "No backup in N days" (Share / Download) when the last export or successful sync is > 7 days old.
* **🤖 Send to CrunchBot** (History and Setup): opens the iOS share sheet with the JSON export file (falls back to a download).
  The sync token is blanked in exports.
* **Import advice (JSON)** (Setup): a small file from the assistant. Matching exercise screens show it in fine print as
  *Advice (date): …* until you tap **Dismiss**. Schema:

```json
[
  { "exercise": "Chest Press", "machine": "Hammer Strength", "note": "Slow 3-second lowering; stay at 60 lb", "date": "2026-10-12" },
  { "exercise": "Lat Pulldown", "note": "Try the close-grip bar next time", "date": "2026-10-12" }
]
```

`exercise` (required) and `machine` (optional; omit = all machines) match by name, case-insensitive. `note` required, `date` optional
`YYYY-MM-DD`. `{ "advice": [ ... ] }` is also accepted. Duplicate notes are ignored.

## Install on iPhone

1. Host the files on an HTTPS URL (below).
2. Open the URL in **Safari** → Share → **Add to Home Screen**.
3. Always launch from the home-screen icon. On iOS, the home-screen app has **its own storage**, separate from Safari tabs,
   and is exempt from Safari's 7-day storage cleanup. Export a backup (or enable sync) now and then.

## Hosting (free, HTTPS — needed for the service worker)

* **GitHub Pages** (recommended for a stable URL): create a free GitHub account and a *public* repo (Pages on private repos needs a paid plan;
  only code is public, your workout data never leaves the phone). Upload the files, Settings › Pages › "Deploy from branch" `main` / root.
  URL: `https://<user>.github.io/<repo>/`. Updates = upload changed files.
* **Netlify Drop**: drag the folder (or `workout-app-deploy.zip`) onto https://app.netlify.com/drop. Without an account the site is password-protected
  and deleted after 1 hour unless claimed, so sign up (free) to keep it. URL `https://<name>.netlify.app`.
* **Cloudflare Pages**: free Cloudflare account → Workers & Pages › Create › Pages › Upload assets → drag the folder. URL `https://<name>.pages.dev`.

After changing app files, bump `VERSION` in `sw.js` so phones pick up the update (the app shows "New version ready — tap to reload").
Paths are relative, so the app works from a sub-path like GitHub Pages' `/<repo>/`.

## Optional: automatic sync to a Google Sheet

Short, phone-friendly steps: **[sync/SETUP.md](sync/SETUP.md)**. Setup › **Restore from Google Sheet** merges every sheet row back into the phone by id (never removes local data).

Lets your assistant read workouts without manual sending. Offline-first: every change is queued on the phone and pushed
automatically on app open, when the phone comes back online, a few seconds after logging, after **Done for today** and when the
app goes to the background. Failures are retried with back-off (30 s → 10 min). Logging never waits for sync. Photos are never synced.

**One-time setup (≈5 minutes, on a computer is easiest):**

1. Go to https://sheets.new and create a Google Sheet, e.g. "Lift Log".
2. In the Sheet: **Extensions › Apps Script**. Delete the sample code and paste the whole of `sync/Code.gs`.
3. In the pasted code change `var TOKEN = 'CHANGE-ME-…'` to your own long random secret (e.g. 30+ random letters/digits). Click **Save**.
4. Optional: choose the `setup` function in the toolbar and click **Run** to create the `Log`, `Sessions`, `Activity Log` and `Advice` tabs
   (approve the permission prompt for your own account). They are also created automatically on first sync.
5. **Deploy › New deployment** → gear icon → **Web app**. *Description*: Lift Log sync. *Execute as*: **Me**.
   *Who has access*: **Anyone** (the token protects it). Click **Deploy**, authorise, then **copy the Web app URL** (ends in `/exec`).
6. On the iPhone: Lift Log › **Setup › Sync to Google Sheet** → paste the URL and the same token → **Save**. The status line shows
   "Last synced … · 0 pending". **Re-send all** pushes your full history once.
7. If you edit `Code.gs` later: **Deploy › Manage deployments › Edit › Version: New version** (the URL stays the same).

**Sheet layout.** `Sessions` tab (new in v2.1): one row per session —
`date, template, mode, duration_min, exercises, sets, volume, unit, session_difficulty, energy, chips, thoughts, session_id, updated_at`,
upserted by `session_id` (re-sent whenever the session's sets, mode or wrap-up change; deleted with the session).
If the deployed script is older than the app, session rows stay pending and Setup › Sync says "Update Code.gs to sync the Sessions
tab": paste the new `Code.gs` and **Deploy › Manage deployments › Edit › Version: New version**. `Log` tab: one row per set/cardio entry with columns
`id, date, template, mode, exercise, machine, gym, type, set, weight, added_weight, base_weight, unit, reps, difficulty, set_seconds,
duration_min, distance, distance_unit, level, tags, note, thoughts, updated_at`
(`id` is a stable entry id: edits update the row in place, deletes remove it; renaming a machine re-sends its rows). Values are
written by header name, and missing columns are appended automatically, so a Sheet created by an older version keeps working
(after updating, paste the new `Code.gs` and deploy a **New version**). `Activity Log` tab (v2.5.7): one row per activity-log entry —
`id, time, day, local_time, action, summary, records, before, after, app_version, ref, ts` (before/after are JSON, cut at 45,000 characters
per cell; the full values stay on the phone and in JSON backups), upserted by `id` and never deleted. It is a separate tab because `Log` already
holds one row per set. Until the new `Code.gs` is deployed, log entries stay queued on the phone and Setup › Sync says "Update Code.gs to
sync the Activity Log tab". Your set rows keep syncing as before. `Advice` tab: columns
`exercise | machine | note | date` — rows typed there (by you or your assistant) are pulled down on each sync and shown as Advice.

Protocol: `POST <url>` with body (sent as `text/plain` to avoid a CORS preflight)
`{"token":"…","upserts":[{"id":"…","date":"…",…}],"deletes":["id",…],"sessions":[{"session_id":"…",…}],"sessionDeletes":["…"],"journal":[{"id":"…","summary":"…",…}],"wantAdvice":true}`
→ `{"ok":true,"upserted":n,"deleted":n,"sessionsUpserted":n,"sessionsDeleted":n,"journalUpserted":n,"advice":[…]}`.
`GET <url>?token=…&action=advice` returns the advice list.

## Tests

```bash
cd tests && npm i playwright && npx playwright install chromium webkit   # once
cd .. && NODE_PATH=tests/node_modules LL_BROWSER=chromium SHOTS=screenshots node tests/e2e.js
NODE_PATH=tests/node_modules LL_BROWSER=webkit node tests/e2e.js
node tests/apps-script.test.js
```
The e2e suite starts its own static server (port 8777), uses an iPhone viewport (390×844), starts from an empty app and builds
the demo data through the first-run setup UI, fakes the date to walk through Mon → Thu → Mon → Tue sessions, fakes
`navigator.wakeLock` to count locks, presses the two Done buttons with real CDP multi-touch (Chromium) / synthetic pointer and
touch events (WebKit), mocks the Apps Script endpoint, and simulates offline by stopping the server.

## Known limitations
* Data lives on one phone (plus whatever you export/sync).
* Sync is one-way phone → Sheet (plus Advice pulled back). Editing the Log tab in the Sheet is not pulled into the app.
* iOS may stop a background push when the app is swiped away; the queue is kept and re-sent on next open (rows are upserted by id, so no duplicates).
* "Send to CrunchBot" just opens the share sheet; you pick the destination app.
* Tested in Playwright Chromium and WebKit (Safari's engine) on Linux, not on a physical iPhone. Two-thumb Done was verified with
  real multi-touch in Chromium; Playwright's WebKit has no multi-touch API, so there it is verified with synthetic pointer/touch events.
* Screen Wake Lock needs iOS 16.4+ (and in some iOS versions only works in Safari, not in the home-screen app); without it the
  screen may dim as usual. Everything else works the same.
* Difficulty 1–5 replaced RPE; data from v1 is migrated automatically (RPE 1–2→1, 3–4→2, 5–7→3, 8→4, 9–10→5).
