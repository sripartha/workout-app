# Lift Log → Google Sheet: one-time setup (about 10 minutes, easiest on a Mac)

You need: the Mac, your iPhone with Lift Log, and the Google account **sripart@gmail.com**.

## 1. Make the sheet
1. On the Mac, open **sheets.new** while signed in as **sripart@gmail.com**.
2. Name it **Lift Log** (click "Untitled spreadsheet" at the top left).

## 2. Paste the script
1. In the sheet: **Extensions › Apps Script**.
2. Select everything in the editor and delete it.
3. Open **https://sripartha.github.io/workout-app/sync/Code.gs.txt** (same file as plain text), press **⌘A** then **⌘C**, go back and press **⌘V**.
4. Find this line near the top:
   `var TOKEN = 'CHANGE-ME-to-a-long-random-secret';`
   Replace the text between the quotes with your own secret, for example `lift-blue-otter-7429-maple`.
   Write it down. You'll type it into the phone too.
5. Click **💾 Save**.
6. Optional: choose **setup** in the function menu at the top and click **▶ Run**. This creates the tabs now. They also appear on the first sync.
   Google will ask for permission: **Review permissions** → pick sripart@gmail.com → **Advanced** → **Go to Lift Log (unsafe)** → **Allow**.
   (It's your own script, so "unsafe" only means Google hasn't reviewed it.)

## 3. Turn it into a web app
1. **Deploy › New deployment** → click the ⚙️ gear → **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy** (allow access if asked).
3. Copy the **Web app URL**. It ends in **/exec**.
4. Send it to your phone: AirDrop, Notes or iMessage to yourself.

## 4. Connect the phone
1. Lift Log › **Setup** › **Sync to Google Sheet**.
2. Paste the URL, type the same secret, and tap **Save**, then **Sync now**.
3. The status should read "Last synced … · 0 pending". To send your whole history once, tap **Re-send all**.
4. In the sheet you'll see a **Log** tab (one row per set), a **Sessions** tab (one row per workout with your wrap-up), an **Activity Log** tab (one row per change, from the app's Setup › Activity log, never deleted), and an **Advice** tab.

From now on it runs by itself. Changes go up a few seconds after you log, right away when you save a wrap-up, and whenever the app goes to the background. When you're offline they wait and go up once you're back online.

## Restore (new phone, or after a reset)
Setup › Sync to Google Sheet → enter the URL and secret (they may already be there) → **Restore from Google Sheet** → **Restore**.
This only adds sets and sessions that aren't on the phone yet. It never deletes or changes anything already there, so it's safe to tap twice.

## Check it in a browser (optional)
Open `YOUR-URL?token=YOUR-SECRET&action=export`. You should see your rows as text. If it says "Bad token", the secret doesn't match.

## If you ever paste a newer Code.gs
**Deploy › Manage deployments** → ✏️ pencil → **Version: New version** → **Deploy**. The URL stays the same.

**Lift Log 2.5.7 needs this once.** Paste the new Code.gs (keep your own secret on the `TOKEN` line), then **New version** as above. Until you do, sets keep syncing, the activity log waits on the phone, and Setup › Sync shows "Update Code.gs to sync the Activity Log tab".

**Keep the secret private.** Anyone with both the URL and the secret can read and write your log.
