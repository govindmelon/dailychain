# Daily Chain

A minimalist habit tracker for your Linux desktop. Everything stays on your computer. No account, no server, no network access.

## Install

**AppImage** (any distro, nothing to install):

```
chmod +x "Daily Chain-2.0.0.AppImage"
./"Daily Chain-2.0.0.AppImage"
```

On Ubuntu 22.04 and newer AppImages need FUSE 2: `sudo apt install libfuse2` (on 24.04 the package is `libfuse2t64`). Without it, run `./"Daily Chain-2.0.0.AppImage" --appimage-extract-and-run`.

**Debian, Ubuntu, Mint, Pop!_OS** (adds a menu entry and icon):

```
sudo apt install ./daily-chain_2.0.0_amd64.deb
```

Then open "Daily Chain" from your applications menu. To remove it: `sudo apt remove daily-chain`.

## What it does

- **Three kinds of schedule.** Every day, chosen weekdays (a Mon/Wed/Fri habit never breaks a streak on a Tuesday), or "N times a week" (streak counted in weeks).
- **Yes/no or counted habits.** "Drink water, 8 glasses" fills in as you tap + or press `+`.
- **Streaks you can trust.** Today is never counted as a miss until it is over. Days before a habit existed are not counted against it.
- **Backfill.** Step back to any earlier day and fix a check-in.
- **Notes.** One note per day. Recent notes show up under stats.
- **Stats.** Per habit: current and best streak, 30 and 90 day rate, days done, a weekday breakdown and a 26 week heatmap. An overview for all habits.
- **Reminders.** An optional daily desktop notification at a time you pick, only if something is still open. Turn on "keep running in tray" and it works with the window closed.
- **Your data.** Export JSON or CSV, import JSON, open the data folder. Archive habits instead of deleting them.
- **Light, dark or follow the system.** Week starts on Monday or Sunday.

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
~/.config/Daily Chain/habits.json     your data (readable JSON)
~/.config/Daily Chain/backups/        one backup a day, plus one before every import (newest 14 kept)
```

Writes are atomic, so a crash or power cut cannot leave a half-written file. If the data file is ever damaged, the app keeps the damaged copy aside, restores the newest backup and tells you.

**Moving from the web version:** in the web app choose Account, then Export my data. In this app choose Settings, then import json. Habits and check-ins come across as every-day habits.

## Good to know

- **Tray icon.** It needs a desktop that shows tray icons. GNOME needs the "AppIndicator" extension. If there is no tray, closing the window simply quits the app.
- **Notifications** use your desktop's notification service (any normal desktop has one).
- Reminders only fire while the app is running. A reminder that is more than three hours late (for example the app started at midnight) is skipped.
- It is a single-user, single-computer app. There is no sync between machines.

## Build from source

Needs Node 22 or newer.

```
npm install
npm start                # run it
npm test                 # 25 unit tests: schedules, streaks, stats, import, backups, reminders
npm run dist             # builds dist/*.AppImage and dist/*.deb
```

Before publishing builds, change `author`, `homepage` and `appId` in `package.json`.

An end-to-end check that launches the real app on a virtual display (`xvfb`), drives the interface, takes screenshots and relaunches to confirm data persisted:

```
export SMOKE_OUT=/tmp/shots DAILY_CHAIN_DATA_DIR=/tmp/dc-test; mkdir -p $SMOKE_OUT
SMOKE_PHASE=first  xvfb-run -a npx electron --no-sandbox test/electron-smoke.js
SMOKE_PHASE=second xvfb-run -a npx electron --no-sandbox test/electron-smoke.js
```

## How it is put together

```
main.js          window, saving, import/export, reminders, tray (Electron main process)
preload.js       the small, fixed set of functions the page may call
storage.js       atomic file writes, backups, damaged-file recovery
reminders.js     when to remind
src/core.js      all the rules: schedules, streaks, stats, validation (no UI, fully tested)
src/app.js       the interface
src/styles.css   the monochrome design, light and dark
```

**Security.** The window loads only local files. The page cannot touch Node or the file system: it can only call the functions in `preload.js`. A strict Content-Security-Policy blocks all network access and inline code, navigation and pop-ups are denied, and every permission request is refused. Data loaded from disk or from an import file is validated and cleaned before use.

The font, IBM Plex Mono, is bundled and licensed under the SIL Open Font License.
