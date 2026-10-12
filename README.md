# Kept

A minimalist habit tracker for your Linux desktop. Your data lives on your computer, with optional sync through a private GitHub repository. No account with us, no server of ours.

*(Kept was called Daily Chain. Your habits are copied across automatically the first time you open it, and the old folder is left untouched.)*

## Install

**AppImage** (any distro, nothing to install):

```
chmod +x "Kept-2.1.0.AppImage"
./"Kept-2.1.0.AppImage"
```

On Ubuntu 22.04 and newer AppImages need FUSE 2: `sudo apt install libfuse2` (on 24.04 the package is `libfuse2t64`). Without it, run `./"Kept-2.1.0.AppImage" --appimage-extract-and-run`.

**Debian, Ubuntu, Mint, Pop!_OS** (adds a menu entry and icon):

```
sudo apt install ./kept_2.1.0_amd64.deb
```

If you installed the old Daily Chain package, remove it: `sudo apt remove daily-chain`.

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

Needs Node 22 or newer.

```
npm install
npm start                # run it
npm test                 # unit tests: schedules, streaks, stats, import, merging, sync, backups, reminders
npm run dist             # builds dist/*.AppImage and dist/*.deb (about 2 minutes)
```

Before publishing builds, change `author`, `homepage` and `appId` in `package.json`.

**End-to-end tests** run the real app on a virtual display (`xvfb`):

```
npm run test:e2e         # two "computers" syncing through a built-in mock of GitHub
```

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
```

**Security.** The window loads only local files and cannot touch Node, the file system or the network. It can only call the functions in `preload.js`. A strict Content-Security-Policy blocks all network access and inline code, navigation and pop-ups are denied, and every permission request is refused. All GitHub traffic happens in the main process and the token never reaches the page. Data loaded from disk, from an import file, or from GitHub is validated and cleaned before use.

The font, IBM Plex Mono, is bundled and licensed under the SIL Open Font License.
