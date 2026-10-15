# Kept

A minimalist habit tracker for your Linux desktop and your Android phone. Your data lives on your device, with optional sync through a private GitHub repository. No account with us, no server of ours.

*(Kept was called Daily Chain. Your habits are copied across automatically the first time you open it, and the old folder is left untouched.)*

## Install

**AppImage** (any distro, nothing to install):

```
chmod +x "Kept-2.2.0.AppImage"
./"Kept-2.2.0.AppImage"
```

On Ubuntu 22.04 and newer AppImages need FUSE 2: `sudo apt install libfuse2` (on 24.04 the package is `libfuse2t64`). Without it, run `./"Kept-2.2.0.AppImage" --appimage-extract-and-run`.

**Debian, Ubuntu, Mint, Pop!_OS** (adds a menu entry and icon):

```
sudo apt install ./kept_2.2.0_amd64.deb
```

If you installed the old Daily Chain package, remove it: `sudo apt remove daily-chain`.

## Android app

The phone app is the same interface as the desktop app: schedules, counts, notes, stats, daily reminders, GitHub sync, export and import. Your habits live in the app's private storage on the phone. Reminders and sync work as described below.

### Get the APK

**Easiest: let GitHub build it.** Put this folder in a **private** repository on GitHub (the same kind you use for sync, or a different one), open the **Actions** tab, choose **Build Android APK**, then **Run workflow**. After about 5 to 10 minutes download `kept-apk` from the run's **Artifacts**, unzip it and you have `app-release.apk`. It also runs on every push to `main`.

**Or build it yourself.** You need Node 22, JDK 21 and the Android SDK (Android Studio installs the last two):

```
cd mobile
npm install
npm run apk            # writes android/app/build/outputs/apk/release/app-release.apk
```

You can also open `mobile/android` in Android Studio after `npm run web` and press Run.

### Install it

Copy the APK to the phone (USB, a cloud drive, or `adb install app-release.apk`) and open it. Android will ask you to allow installing apps from that source (Files, Chrome or whichever app you opened it from). It is a normal install, no developer mode needed. Needs Android 7.0 or newer.

### The signing key (read this before sharing the APK)

An APK has to be signed, and a new build only installs over the old one, keeping your habits, if it is signed with the same key. So the project ships one: `mobile/signing/kept.keystore`, password `kept-app`. That is fine for an app you build for yourself from a private repository. **Anyone who has that file can sign an app that Android treats as an update to yours**, so do not publish this repository or the APK for other people. For that, make your own key and tell the build about it:

```
keytool -genkeypair -keystore my.keystore -alias kept -keyalg RSA -keysize 2048 -validity 36500
export KEPT_KEYSTORE=$PWD/my.keystore KEPT_KEYSTORE_PASSWORD=... KEPT_KEY_ALIAS=kept KEPT_KEY_PASSWORD=...
```

(on GitHub, put the four `KEPT_*` values in repository secrets and pass them to the build step as environment variables). Keep a backup of that key: lose it and updates will not install over what is on your phone, and the only way across is export, uninstall, install, import.

### On the phone

- **Reminders.** A phone cannot run code at 20:00 just to check what is still open, so Kept schedules the next 14 days of notifications ahead of time and plans again whenever you change something or open the app. Today's reminder is skipped if everything is already done. Later days list what is due that day, assuming nothing is done yet. Android asks for notification permission the first time you turn reminders on. Kept uses ordinary alarms, so a reminder can arrive a few minutes late, and some phone makers (Xiaomi, Huawei, Samsung's "sleeping apps") stop apps from running at all: if reminders do not arrive, set Kept to "unrestricted" or "don't optimise" in the phone's battery settings.
- **Sync.** Same as the computer: a private repository and a fine-grained token with *Contents: read and write*. The phone talks to GitHub directly. Use the same repository on the phone and the computer and they stay in step. Sync runs when you open the app, after you change something, and from **sync now**.
- **Your token** is saved in the app's private storage, which other apps cannot read. Unlike on the desktop it is not additionally encrypted with the Android keystore, so anyone who can unlock the phone and root it could read it. It is excluded from Android's backups. If the phone is lost, delete the token on GitHub.
- **Export** opens the Android share sheet, so you can send the file to Drive, email or Files. **Import** picks a `.json` file.
- **Back button** closes a dialog, then goes back to *today*, then leaves the app.
- If you see "Kept could not reach this phone's storage", the phone's *Android System WebView* is too old: update it in the Play Store.

## What it does

- **Three kinds of schedule.** Every day, chosen weekdays (a Mon/Wed/Fri habit never breaks a streak on a Tuesday), or "N times a week" (streak counted in weeks).
- **Yes/no or counted habits.** "Drink water, 8 glasses" fills in as you tap + or press `+`.
- **Streaks you can trust.** Today is never counted as a miss until it is over. Days before a habit existed are not counted against it.
- **Backfill.** Step back to any earlier day and fix a check-in.
- **Notes.** One note per day. Recent notes show up under stats.
- **Stats.** Per habit: current and best streak, 30 and 90 day rate, days done, a weekday breakdown and a 26 week heatmap. An overview for all habits.
- **Reminders.** An optional daily desktop notification at a time you pick, only if something is still open. Turn on "keep running in tray" and it works with the window closed.
- **Sync.** Keep several computers in step through a private GitHub repository (below).
- **Your data.** Export JSON or CSV, import JSON, open the data folder. Archive habits instead of deleting them.
- **Light, dark or follow the system.** Week starts on Monday or Sunday.

## Sync with GitHub

Kept can keep your habits identical on every computer you use, with nothing but a private GitHub repository. It writes one small JSON file there. It does not need `git` installed.

### Set it up (about two minutes)

1. **Create a private repository** on GitHub, for example `kept-data`. Tick "Add a README file" so it is not empty. It must be **private**. Kept refuses to sync to a public repository, because your notes would be readable by everyone.
2. **Create a token that can only touch that repository.** On GitHub: Settings, then Developer settings, then Personal access tokens, then Fine-grained tokens, then Generate new token.
   - Repository access: **Only select repositories**, and pick your `kept-data` repository.
   - Permissions, then Repository permissions: **Contents: Read and write**. Nothing else is needed.
   - Pick an expiry you are comfortable with (you can make a new token later and reconnect).
3. In Kept open **settings**, find **sync**, paste the repository (`you/kept-data`, or the full URL) and the token, and press **connect**.
4. On your other computer, install Kept, and do step 3 with the same repository and a token (the same one or a new one).

That is all. The word next to "kept" at the top shows what is happening: `syncing…`, `synced`, `offline`, or `sync problem` (click it to see why).

### When it syncs

A few seconds after you change something, when you open the window, every few minutes while it is open, and when your connection comes back. You can also press **sync now**. Everything is saved on your computer first, so Kept works with no internet and catches up later.

### Using two computers at once and editing offline

Every check-in, note and habit remembers when it last changed. When two computers have different versions, Kept keeps the **newer** change for each item separately. So check-ins you make on your laptop on a plane and different check-ins on your desktop are both kept. If you change the very same thing on both, the later change wins. Deleting a habit on one computer deletes it on the others.

Because "later" comes from each computer's clock, keep your clocks roughly right (automatic time on).

### What goes to GitHub, and what does not

- **Synced:** habits, check-ins, notes, and which habits you deleted.
- **Not synced:** theme, week start, reminders and tray settings. These stay per computer. Your token is never uploaded.
- The file is `kept/habits.json`. Each sync that changed something is a commit named `Sync from <computer name>`, so you can see the history and restore an older version from GitHub if you ever need to.
- The file is **not encrypted**. Anyone who can read your repository (you, and GitHub itself) can read your habits and notes. Do not put anything in a note you would not want stored there.

### Where your token is kept

On your computer only, never in the window's page. If your desktop has a keyring (GNOME Keyring, KDE Wallet and similar) the token is encrypted with it. If not, Kept says so in settings and keeps the token in a file that only your user can read (`~/.config/Kept/sync.json`). **Disconnect** removes it. You can also revoke the token on GitHub at any time.

### If something goes wrong

| What you see | What it means |
|---|---|
| GitHub rejected the token | Expired or revoked. Make a new token, disconnect, connect again. |
| The token is not allowed to write | Give the token **Contents: Read and write** on that repository. |
| Cannot find that repository | Wrong name, or the token was not given access to that repository. |
| This repository is public | Make it private (repository Settings, Danger Zone), or use another one. |
| The data file ... is not valid JSON | Someone edited `kept/habits.json` by hand. Kept stops rather than overwrite it. Fix or delete the file on GitHub. |
| Could not reach GitHub | You are offline. Nothing is lost; it retries every minute. |

If you import a JSON file while sync is on, it is **added** to your habits instead of replacing them, because a replacement would just be undone by the next sync.

## Keyboard

| Key | Action |
|---|---|
| `←` `→` | previous / next day |
| `t` | jump to today |
| `↑` `↓` (or `k` `j`) | move between habits |
| `space` | check or uncheck the focused habit |
| `+` `−` | change a count |
| `e` | edit the focused habit |
| `n` | add a habit |
| `1` `2` `3` | today, stats, settings |
| `?` | show shortcuts |
| `esc` | leave a text field |

## Where your data lives

```
~/.config/Kept/habits.json     your data (readable JSON)
~/.config/Kept/backups/        one backup a day, plus one before every import (newest 14 kept)
~/.config/Kept/sync.json       sync settings (only if you connected GitHub)
```

Writes are atomic, so a crash or power cut cannot leave a half-written file. If the data file is ever damaged, Kept keeps the damaged copy aside, restores the newest backup and tells you.

**Moving from the earlier web version:** in the web app choose Account, then Export my data. In Kept choose settings, then import json.

## Good to know

- **Tray icon.** It needs a desktop that shows tray icons. GNOME needs the "AppIndicator" extension. If there is no tray, closing the window simply quits the app.
- **Notifications** use your desktop's notification service.
- Reminders only fire while the app is running. A reminder more than three hours late (for example the app started at midnight) is skipped.

## Build from source

Needs Node 22 or newer. (The phone app has its own steps, above.)

```
npm install
npm start                # run it
npm test                 # unit tests: schedules, streaks, stats, import, merging, sync, backups, reminders, phone storage
npm run dist             # builds dist/*.AppImage and dist/*.deb (about 2 minutes)
```

Before publishing builds, change `author`, `homepage` and `appId` in `package.json`.

**End-to-end tests** run the real app on a virtual display (`xvfb`):

```
npm run test:e2e         # two "computers" syncing through a built-in mock of GitHub
```

The phone page is tested the same way in a phone-sized Chromium (`npm run test:phone`, needs Playwright), with the Android plugins replaced by stand-ins. It checks layout, touch targets, the content-security policy, the back button, reminders, two phones syncing and export. It cannot test the Android shell itself; that needs a real phone.

The mock lives in `test/mock-github.js`, so no real GitHub account or network is used by any test.

**Renaming the app again.** The display name is `APP_NAME` in `main.js`, `productName` and `name` in `package.json`, the `<title>` and brand text in `src/index.html`, and the default sync file path in `sync.js`. If you change the name, add the old data folder name to `OLD_DATA_FOLDER` in `main.js` so existing data is carried over.

## How it is put together

```
main.js          window, saving, import/export, reminders, tray, sync wiring (Electron main process)
preload.js       the small, fixed set of functions the page may call
storage.js       atomic file writes, backups, damaged-file recovery
syncstore.js     where the GitHub repository and token are kept
sync.js          GitHub client: pull, merge, push, retry when another computer wins a race
reminders.js     when to remind
src/core.js      all the rules: schedules, streaks, stats, validation, merging (no UI, fully tested)
src/app.js       the interface
src/styles.css   the monochrome design, light and dark

mobile/                       the Android app (Capacitor shell around the same src/ files)
mobile/adapter/store-android.js   what main.js and preload.js do on the desktop: files, backups, sync, reminders, export
mobile/adapter/plan.js            which notifications to schedule for the next 14 days
mobile/web/                       phone-only start-up code and styles
mobile/scripts/build-www.js       copies the shared files into mobile/www and adapts the page
mobile/android/                   the Android project (icons, theme, backup rules, signing)
.github/workflows/build-apk.yml   builds the APK on GitHub
```

**Security.** The window loads only local files and cannot touch Node, the file system or the network. It can only call the functions in `preload.js`. A strict Content-Security-Policy blocks all network access and inline code, navigation and pop-ups are denied, and every permission request is refused. All GitHub traffic happens in the main process and the token never reaches the page. Data loaded from disk, from an import file, or from GitHub is validated and cleaned before use.

**On the phone** the same rules apply with one difference: the GitHub requests are made by the page itself (the Android web view has no separate main process), so the policy allows exactly one network host, `api.github.com`, and still blocks inline code and everything else. The adapter keeps the token inside itself and never hands it to the interface. The Android backup rules leave it out of cloud backups and phone-to-phone transfers.

The font, IBM Plex Mono, is bundled and licensed under the SIL Open Font License.
