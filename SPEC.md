# Workout Logger PWA — Behaviour Spec (Gherkin)

Acceptance checklist for the app. Scenario IDs (e.g. `S1.1`) are referenced by the
automated Playwright suite in `tests/e2e.js`, which prints PASS/FAIL per scenario.

Design rule for everything below: **at the gym every action is a tap, chip or slider**.
Typing is only allowed in setup (adding/renaming exercises, machines, cues, templates) and
for the optional Thoughts box. The shipped app contains **no demo exercises**; the tests
create demo data through the first-run setup UI.

v2 changes: difficulty 1-5 replaces RPE (F7, F17), Thoughts box (F18), last-machine card (F19),
base weight (F20), gyms/locations/rename (F21), coaching cues (F22), locked in-set mode (F23),
screen wake lock (F24), empty start + first-run setup (F25), backup reminder (F26).
v2.1: end-of-workout wrap-up (F27).

---

## Feature 1: Workout day templates

```gherkin
Feature: Workout day templates
  Background:
    Given the app is opened for the first time

  Scenario: S1.1 Empty day templates exist (tested as S25.1)
    Then I see templates "Push Day", "Pull Day", "Leg Day", "Core" and "Cardio"
    And every template is empty: no exercises are pre-seeded

  Scenario: S1.2 Templates are editable in setup
    Given I open Settings > Templates > "Push Day"
    When I add an exercise, remove an exercise, or reorder exercises
    Then the Push Day exercise list reflects the change
    And starting a Push Day session shows the edited list
```

## Feature 2: Weekly schedule and suggestion

```gherkin
Feature: Weekly schedule
  Scenario: S2.1 Default schedule
    Then Monday is "Push Day" with coach, Thursday is "Push Day" solo
    And Wednesday is "Pull Day" with coach, Saturday is "Pull Day" solo
    And Friday is "Leg Day" with coach, Tuesday is "Leg Day" solo
    And Core and Cardio are not scheduled
    And the schedule can be edited in Settings

  Scenario: S2.2 Today's template is suggested on open
    Given today is Monday
    When I open the app
    Then the Today screen suggests "Push Day" "with coach"

  Scenario: S2.3 Solo repeat day offers the latest session of that template
    Given I logged a "Push Day" session on Monday
    And today is Thursday
    When I open the app
    Then I see "Repeat Monday's Push Day"
    When I tap it
    Then a solo session starts with Monday's exercises in Monday's order
    And each exercise shows Monday's machine and weight x reps as the target

  Scenario: S2.4 Session can be marked coach or solo
    Given a session is open
    When I tap "Solo" or "With coach"
    Then the session is saved with that mode and history shows it
```

## Feature 3: Logging flow (template -> exercise -> machine -> last values)

```gherkin
Feature: Logging a strength exercise
  Scenario: S3.1 Template filters exercises
    When I start "Push Day"
    Then I only see Push Day's exercises

  Scenario: S3.2 Machine / equipment variant; starting weight seeds "last time"
    When I tap "Chest Press" then the machine card "Hammer Strength"
    Then that machine is selected
    And with no history yet I see "Starting weight on Hammer Strength: 50 lb x 12" (from setup)

  Scenario: S3.2b Add a machine variant from the exercise screen
    When I tap "+ New machine" and type "Matrix" (one-time setup typing) and Save
    Then I return to the Chest Press screen and "Matrix" is in the picker
    And its starting weight defaults to the exercise's latest total (80 lb)

  Scenario: S3.3 Last weight and reps per exercise+machine
    Given I previously logged Chest Press on "Hammer Strength" at 50 lb x 12
    And Chest Press on "Life Fitness" at 80 lb x 10
    When I pick "Hammer Strength"
    Then I see "Last on Hammer Strength: 50 lb x 12" with the date
    When I pick "Life Fitness"
    Then I see its own last result (80 lb x 9) with the date
    And reps reset to the default 12
```

## Feature 4: Weight picker (no typing)

```gherkin
Feature: Weight chips
  Scenario: S4.1 Chips centred on last (added) weight in 5 lb steps
    Given last weight on this machine was 50 lb (base 0)
    Then a horizontal chip row shows ... 40, 45, 50, 55, 60 ...
    And 50 is pre-selected and scrolled to the centre
    And I can scroll further either way and tap any chip, or use - / + buttons

  Scenario: S4.2 kg option
    Given I set units to kg in Settings
    Then weights display in kg with kg steps (default 2.5 kg)
    And previously logged lb totals and base weights are converted for display
    (e.g. 100 lb -> 45.4 kg; base 35 lb -> 15.9 kg; "30 added + 15.9 base = 45.9 kg")
```

## Feature 5: Reps

```gherkin
Feature: Reps slider
  Scenario: S5.1 Default 12, range 1-15, last reps shown
    Then the reps slider defaults to 12 and spans 1-15
    And the last reps for this exercise+machine are shown with a one-tap "Use last" chip
```

## Feature 6: Sets

```gherkin
Feature: Logging sets
  Scenario: S6.1 Single set buttons (covered in S18.1)
    When I tap "Set 1"
    Then set 1 is logged with the selected weight, reps and difficulty and the button shows a check

  Scenario: S6.2 All 3 sets in one tap
    When I tap "All 3 sets"
    Then three identical sets are logged (total, added, base, reps, difficulty, note chips)

  Scenario: S6.3 Adjust or undo a logged set
    Given set 2 is logged
    When I tap "Set 2"
    Then an editor opens where I can change weight/reps/difficulty (taps only) and Save
    Or I can Delete (undo) the set
```

## Feature 7: Effort and notes

RPE 1-10 has been **removed**. Effort is the 1-5 difficulty slider (Feature 17); free text goes
in the Thoughts box (Feature 18).

```gherkin
Feature: Effort and notes
  Scenario: S7.1 Difficulty and quick note chips (covered in S6.2 / S17.1)
    When I set difficulty 2 and tap the note chip "form check"
    And I log a set
    Then the set stores difficulty 2 and that note
```

## Feature 8: Cardio

```gherkin
Feature: Cardio
  Scenario: S8.1 Log cardio by taps
    When I start "Cardio" and pick "Treadmill" (or bike, elliptical, rower, stair climber, run, custom)
    Then I set duration, distance and difficulty (1-5) with sliders/chips, no typing
    And they default to my last values for that activity
    When I tap "Log cardio"
    Then the cardio entry is saved

  Scenario: S8.1b Next time defaults to the last values
    Given I logged Treadmill 30 min / 2.6 mi yesterday
    When I open Treadmill today
    Then duration shows 30 and distance 2.6, and "Last time" shows them
```

## Feature 9: History

```gherkin
Feature: History
  Scenario: S9.1 Browse sessions by date
    Then History lists sessions newest first with date, template, mode, entries (totals) and thoughts

  Scenario: S9.2 Edit an entry
    When I tap an entry and change reps with the slider and Save
    Then the entry shows the new value

  Scenario: S9.3 Delete entries and sessions
    When I delete an entry, it disappears
    When I delete a session (with confirmation), it disappears from History
```

## Feature 10: Progress charts

```gherkin
Feature: Progress charts
  Scenario: S10.1 Strength chart
    Given sessions for an exercise+machine on several dates
    When I open Progress and choose it
    Then a line chart renders for Top weight, Est. 1RM (Epley) or Volume, all using total weight
  Scenario: S10.2 Cardio chart
    Then a cardio activity charts Duration or Distance over time
  And no chart library is loaded from a CDN
```

## Feature 11: Data and backup

```gherkin
Feature: Data on device and backup
  Scenario: S11.1 Persistence
    Given I log data and reload the app
    Then the data is still there (IndexedDB)

  Scenario: S11.2 Export / Import JSON round-trip
    When I tap Export JSON I get a file containing all data (including machine photos as base64)
    When I reset data and Import that file
    Then all sessions, templates, settings and photos are restored

  Scenario: S11.3 CSV export
    When I tap Export CSV I get one row per set / cardio entry with columns
      date, template, mode, exercise, machine, gym, type, set, weight (total), added_weight, base_weight,
      unit, reps, difficulty, set_seconds, duration_min, distance, distance_unit, level, tags, note, thoughts
    And the CSV contains no photo data and no RPE
```

## Feature 12: Machine photos

```gherkin
Feature: Optional machine photo
  Scenario: S12.1 Add a photo in setup
    Given I open the machine editor (first-run setup or Setup > Exercises > "Chest Press" > machine)
    When I tap "Take photo" (camera) or "Choose photo" (Photos)
    Then the image is resized on-device (max 1600 px, JPEG) and stored in IndexedDB

  Scenario: S12.2 Photo is hidden by default and opens full-screen
    Given "Hammer Strength" has a photo
    When I pick it on the exercise page
    Then the photo itself is not shown, only a small "Photo" link
    When I tap "Photo"
    Then the picture opens full-screen
    When I tap it
    Then it closes
```

## Feature 14: Heads-up notes and pinned cautions

```gherkin
Feature: Heads up from last time
  Scenario: S14.1 Hard or annotated last session is shown prominently (tested as S17.3)
    Given last time on Chest Press (any machine) I logged difficulty 5 and thoughts "really hard, careful with shoulder"
    When I open Chest Press
    Then a "Heads up — last time" card at the top shows "difficulty 5 · barely possible", the note chips and the thoughts

  Scenario: S14.2 Pin a note as a persistent caution
    When I tap "Pin" on that note (or type a caution in Setup > Exercises)
    Then a "Caution (pinned)" card shows at the top of Chest Press

  Scenario: S14.3 Pinned caution persists across sessions
    Given a later session
    When I open Chest Press
    Then the pinned caution is still shown

  Scenario: S14.4 Unpin
    When I tap "Unpin"
    Then the caution is no longer shown
```

## Feature 15: CrunchBot sharing and imported advice

Advice file schema: a JSON array `[{ "exercise": "Chest Press", "machine": "Hammer Strength", "note": "…", "date": "2026-10-12" }]`
(`machine` optional; exercise/machine matched case-insensitively by name).

```gherkin
Feature: Assistant hand-off
  Scenario: S15.1 Import advice and show it in fine print until dismissed
    When I import an advice JSON file in Setup
    Then matching exercise screens show "Advice (date): note" in small print
    And advice with a machine only shows on that machine
    When I tap "Dismiss"
    Then that advice no longer shows

  Scenario: S15.2 Send to CrunchBot
    When I tap "Send to CrunchBot" in History or Setup
    Then the iOS share sheet opens with the JSON export file
    And if file sharing is unsupported the file downloads instead
```

## Feature 16: Optional automatic sync to a Google Sheet

```gherkin
Feature: Google Sheet sync via Apps Script web app
  Scenario: S16.1 One-time setup and upsert by stable id
    Given I paste the Apps Script /exec URL and secret token in Setup > Sync and tap Save
    Then queued entries are POSTed with the token, one row per set/cardio entry (CSV columns + id)
    And rows carry weight (total), added_weight, base_weight, gym, difficulty, set_seconds and thoughts
    And the status shows "Last synced <time> · 0 pending"

  Scenario: S16.2 Advice tab is pulled back
    Given the Sheet's "Advice" tab has rows (exercise, machine, note, date)
    When a sync completes
    Then those notes appear as Advice on matching exercises

  Scenario: S16.3 Offline-first
    Given the phone is offline
    When I log, edit or delete sets
    Then logging is instant and changes are queued
    When the phone comes back online
    Then the queue is pushed automatically (upserts + deletes)

  Scenario: S16.4 Failures are retried
    Given the sync endpoint fails
    Then the error is shown, pending changes are kept, and sync retries with back-off / on "Sync now"

  Scenario: S16.5 Edits re-sync affected rows; photos are never synced
    When I change a session's coach/solo mode
    Then all its rows are re-sent with the new mode
    And no photo data or exported token is ever sent

  Scenario: S16.6 Sync on app open (and after "Done for today" / saving a wrap-up, when going to background)

  Scenario: S16.8 Apps Script upserts, deletes and serves advice
    Given sync/Code.gs running against a fake Spreadsheet
    Then bad tokens are rejected, rows append, re-sent ids update in place, deletes remove by id, and Advice rows are returned
    And the Sheet columns equal the app's CSV columns (+ id, updated_at)
    And an older Sheet's header gets missing columns appended; values are written by header name
```

## Feature 13: Offline PWA on iPhone

```gherkin
Feature: Installable offline PWA
  Scenario: S13.1 Manifest and iOS meta
    Then the page links a valid web app manifest (name, start_url, display standalone, 192/512 icons)
    And has apple-touch-icon, apple-mobile-web-app-capable and viewport-fit=cover
    And layout uses env(safe-area-inset-*) for the notch / home bar

  Scenario: S13.2 Works offline
    Given the app was loaded once and the service worker is active
    When the network is offline and I reload
    Then the app loads and works from the cache

  Scenario: S13.3 No console errors
    Then the full flow runs at 390x844 without console errors

  Scenario: S16.7 No page errors during the sync run

  Scenario: S13.4 Tap-only flow at the gym
    Then template -> exercise -> machine -> weight chip -> reps -> difficulty -> All 3 sets needs no keyboard
    (typing happens only in setup and the optional Thoughts box)
```

## Feature 17: Difficulty 1-5 (replaces RPE)

```gherkin
Feature: Difficulty slider
  Scenario: S17.1 Slider 1-5, default 3, labelled
    Then the exercise screen has a difficulty slider 1-5 (plus 1-5 tap targets) defaulting to 3
    And the labels are 1 "Ridiculously easy", 2 "Easier than average — consider going up",
        3 "As expected", 4 "Too hard", 5 "Barely possible"
    And there is no RPE control anywhere

  Scenario: S17.2 "Try going up" hint
    Given the last difficulty on Chest Press + Hammer Strength was 1 or 2
    When I select Hammer Strength
    Then a "Last time was difficulty 2 — try going up" hint shows with a one-tap "+5" chip
    And no hint shows on a machine whose last difficulty was 3-5

  Scenario: S17.3 Heads-up trigger
    Given last time's difficulty was 4-5, or it had note chips or thoughts
    When I open the exercise
    Then the Heads-up card shows the difficulty and label, chips and thoughts
```

## Feature 18: Thoughts box

```gherkin
Feature: Optional thoughts per exercise
  Scenario: S18.1 Pinned at the bottom of the exercise screen and saved with the session
    Then a "Thoughts (optional)" box is fixed at the bottom of the exercise screen above the set buttons
    When I type "really hard, careful with shoulder"
    Then it is saved with this session for this exercise (no Save button needed)

  Scenario: S18.2 Shown in history
    Then the session card in History shows the thoughts, and the session detail lists them per exercise
    And old entries show the machine's current (renamed) name
```

## Feature 19: Last machine card

```gherkin
Feature: Most recent machine before choosing one
  Scenario: S19.1 Last-machine card
    Given Chest Press was last done on "Life Fitness" at 80 lb x 9, difficulty 5, on Mon Oct 5
    When I open Chest Press (before choosing a machine)
    Then a "Last machine used" card shows Life Fitness, 80 lb x 9 · d5, the date and label, with "Use Life Fitness"

  Scenario: S19.2 Each machine card shows its own last result
    Then each machine card in the picker shows its own last total weight x reps, difficulty and date
    (or its setup starting weight, marked "starting weight")

  Scenario: S19.3 Previous machine stays visible when switching
    Given the most recent machine was Hammer Strength
    When I choose Life Fitness instead
    Then a "Previous machine: Hammer Strength — 50 lb x 12 · d2 · date" reference stays visible
```

## Feature 20: Base weight per machine

```gherkin
Feature: Base weight (bar / sled / carriage)
  Scenario: S20.1 Base set in setup (covered in S25.3)
    Then each machine has a base weight (e.g. Olympic bar 45, 0 for stacks/dumbbells), chosen by chips or -/+

  Scenario: S20.2 Chips select ADDED weight; total shown
    Given "Olympic bar" has base 45
    When I tap the 55 chip
    Then I see "55 added + 45 base = 100 lb" and the big number shows 100
    And logged sets store total 100, added 55, base 45

  Scenario: S20.3 Totals everywhere
    Then history, charts, "last time" and CSV/Sheet "weight" use the total

  Scenario: S20.4 Editing the base keeps history
    When I change Olympic bar's base from 45 to 35
    Then logged totals stay 100 and next time the default is "65 added + 35 base = 100 lb"

  Scenario: S20.5 A second barbell machine with a different base
    When I add "Smith machine" (base 15, location "Next to rack 3", cue "Bar on the 3rd hole") from the exercise screen
    Then its starting weight defaults to the latest total (85 added + 15 base = 100)
    When I choose it and tap 60
    Then I see "60 added + 15 base = 75 lb", the previous machine's (Olympic bar) last result,
    the exercise + machine cues and the location in fine print
```

## Feature 21: Machines, gyms and locations

```gherkin
Feature: Free-named machines
  Scenario: S21.1 Unlimited near-duplicates
    Then I can add "Hammer Strength" twice (e.g. one per gym); both are kept separately

  Scenario: S21.2 Rename without losing history
    When I rename "Hammer Strength" to "Hammer Strength ISO"
    Then all its logged sets still belong to it and show the new name

  Scenario: S21.3 Optional gym tag, home gym first
    Given my home gym is "Austin" and one machine is tagged "San Jose"
    Then Austin (home) machines are listed first in the picker and the San Jose one shows its tag

  Scenario: S21.4 Optional location note in fine print
    Then "Back wall, by the windows" shows in fine print on the machine card and on the exercise screen
```

## Feature 22: Coaching cues

```gherkin
Feature: Self-written coaching cues
  Scenario: S22.1 Cues per exercise and per machine
    Given Chest Press has cue "Chest up, elbows ~45°, slow lowering"
    And Hammer Strength has cue "Seat 4, handles mid-chest"
    When I open Chest Press
    Then the exercise cue shows in fine print (S22.1a)
    When I choose Hammer Strength
    Then both cues show in fine print (S22.1b)
    And cues are editable in Setup (first-run setup, exercise editor, machine editor)
```

## Feature 23: One exercise per screen and locked in-set mode

```gherkin
Feature: Locked set mode
  Scenario: S23.1 One exercise per full screen
    Then the exercise screen shows one exercise and hides the tab bar

  Scenario: S23.2 Start locks the screen
    When I tap "Start set N"
    Then a full-screen locked overlay shows; everything else is inert (clicks do nothing)
    And two Done buttons (~140x62 px) sit in the lower-left and lower-right corners

  Scenario: S23.3 A single touch does nothing
    When I hold only the left (or only the right) Done button
    Then that button lights up (visual feedback) but the set does not end

  Scenario: S23.4 Both held together ~300 ms ends the set
    When I hold both Done buttons at the same time (multi-touch)
    Then the overlay shows a filling "arming" indicator and after ~300 ms the set ends
    (Chromium: real CDP touch points; WebKit: synthetic pointer events)

  Scenario: S23.4b Touch-event path (iOS targetTouches)
    Then one finger never ends the set, a short second finger does not, two fingers held ~300 ms do

  Scenario: S23.5 Both pressed too briefly does not end the set
    When both are pressed for < 300 ms
    Then the set continues

  Scenario: S23.6 Cancel only by long-press
    When I tap the small "Hold to cancel" control briefly
    Then nothing happens
    When I hold it ~1 s
    Then the set is cancelled without logging and the screen is interactive again

  Scenario: S23.7 No pinch-zoom or scrolling while locked
    Then the overlay and buttons have touch-action: none
    And touchstart/touchmove/gesturestart are preventDefault-ed; the viewport disallows scaling

  Scenario: S23.8 Running set timer
    Then a large m:ss timer counts up while locked

  Scenario: S23.9 Confirm after Done
    Then a confirm screen shows "Set N done · ⏱ duration" with weight, reps and difficulty pickers
    When I adjust and tap "Log set"
    Then the set is logged with its duration (set_seconds)
```

## Feature 24: Screen wake lock

```gherkin
Feature: Keep the screen awake
  Scenario: S24.1 Held on the exercise screen and in locked mode
    Then navigator.wakeLock.request('screen') is held while an exercise screen or a locked set is open

  Scenario: S24.2 Released when leaving
    When I go back to the session list
    Then the wake lock is released

  Scenario: S24.3 Re-acquired after the OS drops it
    Given the OS released the lock (e.g. app backgrounded)
    When the page becomes visible again (visibilitychange)
    Then the lock is requested again

  Scenario: S24.4 Graceful degradation
    Given the browser has no Wake Lock API
    Then the exercise screen and locked mode work without errors
```

## Feature 25: Empty start and first-run setup

```gherkin
Feature: First-run setup
  Scenario: S25.1 Empty start
    Given the app is opened for the first time
    Then there are no exercises; Push/Pull/Leg/Core/Cardio are empty and the schedule is kept
    And "Welcome to Lift Log" setup opens (units, optional home gym)

  Scenario: S25.2 Bulk-add exercises per day
    Then each day has suggestion chips and a "one per line" box to add many exercises at once

  Scenario: S25.3 Machines with details and starting weight
    Then for each exercise I add machines with name, location note, base weight, gym tag,
    optional photo, cues and a starting weight (+ optional reps)
    And the starting weight becomes the first "last time" for that machine
    And exercise-level cues can be added here
```

## Feature 26: Backup reminder

```gherkin
Feature: Backup reminder
  Scenario: S26.0 Not shown within 7 days

  Scenario: S26.1 Shown after more than 7 days
    Given I have logged sessions and my last export or successful sync was more than 7 days ago
    Then Today shows "No backup in N days" with "Share backup" and "Download"

  Scenario: S26.2 Export clears it
    When I export a backup
    Then the reminder disappears

  Scenario: S26.3 A successful sync counts as a backup
```

## Feature 27: Workout wrap-up (end-of-workout reflection)

Session row / Sessions tab columns: `date, template, mode, duration_min, exercises, sets, volume, unit, session_difficulty,
energy, chips, thoughts, session_id` (+ `updated_at` in the Sheet). Volume = Σ total weight × reps of all sets.

```gherkin
Feature: Workout wrap-up
  Scenario: S27.1 "Done for today" opens the wrap-up with an auto summary
    Given I logged Chest Press (5 sets) in a coach session that started at 10:00
    When I tap "Done for today" at 10:47
    Then a "Workout wrap-up" screen shows: 1 exercise · 5 sets · 3,320 lb volume · Coach · 47 min
    And a per-exercise line (e.g. "Chest Press: 50×12 ×3")
    And the duration (first logged set -> now) can be corrected with -/+ 5 min

  Scenario: S27.2 Reflection inputs, saved on the session
    Then I see an "Overall session difficulty" slider 1-5 (default 3: 1 Very easy, 2 Easy, 3 As expected, 4 Hard, 5 Brutal)
    And an "Energy level" slider 1-5 (default 3: 1 Exhausted, 2 Low, 3 Normal, 4 Good, 5 Great)
    And quick-tap chips: great session, felt strong, PR today, tired, bad sleep, short on time, shoulder sore, skipped exercises
    And an optional "Thoughts about today" box (typing is fine here)
    When I set difficulty 4, energy 2, tap "tired" and "shoulder sore", type a thought and tap "Save wrap-up"
    Then the session stores { diff 4, energy 2, tags, thoughts, durMin } and I return to Today

  Scenario: S27.3 Skippable
    When I tap "Skip for now"
    Then nothing is saved and I return to Today

  Scenario: S27.4 Shown in History
    Then the History card shows "🏁 difficulty 4 (hard) · energy 2 (low) · tired · shoulder sore — “thoughts”"
    And the session detail shows a Wrap-up card with the summary line and the reflection

  Scenario: S27.5 Edit (or add) later from History
    When I tap "Edit" on the Wrap-up card, change difficulty to 5 and save
    Then I return to that History session and it shows "difficulty 5 (brutal)"
    And a session whose wrap-up was skipped shows "No wrap-up yet" with "Add wrap-up"

  Scenario: S27.6 Export
    Then the JSON backup contains the wrap-up on each session
    And Setup › "Download sessions CSV" has one row per session with the summary + wrap-up columns

  Scenario: S27.7 Sync to the Sheet's "Sessions" tab
    Given Google Sheet sync is set up
    Then every session with entries or a wrap-up is sent as one row (upserted by session_id)
    And rows without a wrap-up have blank difficulty/energy/chips/thoughts

  Scenario: S27.8 Only changed sessions are re-sent; older Code.gs is detected
    When I save a wrap-up
    Then the next sync sends just that session's row
    And a session row changes whenever its entries, mode or wrap-up change (edits / deletes re-sync it)
    Given the deployed Code.gs predates the Sessions tab (no "sessionsUpserted" in the reply)
    Then the rows stay pending and the status says "Update Code.gs to sync the Sessions tab"
```

Apps Script checks for this feature (in `tests/apps-script.test.js`, part of S16.8): the Sessions tab is created with the
columns above, upsert by session_id updates in place, deletes by session_id, a duplicate id in one request keeps the last,
the columns equal the app's session CSV columns, and session-only posts leave the Log tab alone.
