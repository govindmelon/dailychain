'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, Notification, nativeTheme, nativeImage, session } = require('electron');
const C = require('./src/core.js');
const { createStore } = require('./storage.js');
const reminders = require('./reminders.js');

const MAX_FILE = 10 * 1024 * 1024;
const ICON = path.join(__dirname, 'build', 'icon.png');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  if (process.env.DAILY_CHAIN_DATA_DIR) app.setPath('userData', process.env.DAILY_CHAIN_DATA_DIR);
  const store = createStore(app.getPath('userData'));
  const reminderState = store.readState();
  let win = null;
  let tray = null;
  let current = null;     // the latest saved data, used for theme, tray and reminders
  let quitting = false;

  /* ---------- window ---------- */
  function showWindow() {
    if (!win) { createWindow(); return; }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 480, height: 760, minWidth: 360, minHeight: 480,
      show: false,
      title: 'Daily Chain',
      icon: ICON,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0C0C0C' : '#FAFAFA',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        webSecurity: true
      }
    });
    win.once('ready-to-show', () => win.show());
    win.loadFile(path.join(__dirname, 'src', 'index.html'));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('close', (e) => {
      if (!quitting && tray && current && current.settings.tray) { e.preventDefault(); win.hide(); }
    });
    win.on('closed', () => { win = null; });
  }

  function fromOurWindow(event) {
    return !!win && event.sender === win.webContents;
  }

  /* ---------- tray and theme, driven by the saved settings ---------- */
  function applySettings() {
    if (!current) return;
    nativeTheme.themeSource = current.settings.theme;
    if (current.settings.tray && !tray) {
      try {
        tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 24, height: 24 }));
        tray.setToolTip('Daily Chain');
        tray.setContextMenu(Menu.buildFromTemplate([
          { label: 'Show Daily Chain', click: showWindow },
          { type: 'separator' },
          { label: 'Quit', click: () => { quitting = true; app.quit(); } }
        ]));
        tray.on('click', showWindow);
      } catch (e) { tray = null; /* this desktop has no tray: closing the window quits instead */ }
    } else if (!current.settings.tray && tray) {
      tray.destroy();
      tray = null;
    }
  }

  function remember(data) {
    current = C.migrate(data);
    applySettings();
    return current;
  }

  /* ---------- reminders ---------- */
  function tickReminders() {
    if (!current) return;
    const names = reminders.check(current, new Date(), reminderState);
    store.writeState(reminderState);
    if (names && Notification.isSupported()) {
      const n = new Notification({ title: 'Daily Chain', body: reminders.message(names), icon: ICON });
      n.on('click', showWindow);
      n.show();
    }
  }

  /* ---------- IPC ---------- */
  ipcMain.handle('data:load', (event) => {
    if (!fromOurWindow(event)) return { data: null };
    const result = store.load();
    remember(result.data);
    return result;
  });

  ipcMain.handle('data:save', (event, data) => {
    if (!fromOurWindow(event) || !data || typeof data !== 'object') return { ok: false, error: 'Rejected.' };
    try { store.save(remember(data)); return { ok: true }; }
    catch (e) { return { ok: false, error: 'Could not write your data file: ' + e.message }; }
  });

  ipcMain.on('data:save-sync', (event, data) => {
    let ok = false;
    try { if (fromOurWindow(event) && data && typeof data === 'object') { store.save(remember(data)); ok = true; } } catch (e) { /* reported by the next normal save */ }
    event.returnValue = ok;
  });

  ipcMain.handle('data:export-json', async (event, data) => {
    if (!fromOurWindow(event)) return { ok: false };
    const stamp = C.todayKey();
    const r = await dialog.showSaveDialog(win, {
      title: 'Export Daily Chain data',
      defaultPath: path.join(app.getPath('documents'), 'daily-chain-' + stamp + '.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false };
    try { fs.writeFileSync(r.filePath, JSON.stringify(C.migrate(data), null, 2)); return { ok: true, path: r.filePath }; }
    catch (e) { return { ok: false, error: 'Could not write that file: ' + e.message }; }
  });

  ipcMain.handle('data:export-csv', async (event, csv) => {
    if (!fromOurWindow(event) || typeof csv !== 'string' || csv.length > MAX_FILE) return { ok: false };
    const r = await dialog.showSaveDialog(win, {
      title: 'Export check-ins as CSV',
      defaultPath: path.join(app.getPath('documents'), 'daily-chain-' + C.todayKey() + '.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false };
    try { fs.writeFileSync(r.filePath, csv); return { ok: true, path: r.filePath }; }
    catch (e) { return { ok: false, error: 'Could not write that file: ' + e.message }; }
  });

  ipcMain.handle('data:import', async (event) => {
    if (!fromOurWindow(event)) return { canceled: true };
    const r = await dialog.showOpenDialog(win, {
      title: 'Import Daily Chain data',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePaths.length) return { canceled: true };
    try {
      const file = r.filePaths[0];
      if (fs.statSync(file).size > MAX_FILE) return { error: 'That file is too large.' };
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      store.snapshot('before-import');
      return { data: parsed };
    } catch (e) { return { error: 'That file could not be read as Daily Chain data.' }; }
  });

  ipcMain.handle('app:open-folder', (event) => { if (fromOurWindow(event)) shell.openPath(store.dir); });
  ipcMain.handle('app:info', (event) => (fromOurWindow(event) ? { version: app.getVersion(), path: store.file } : {}));

  /* ---------- app lifecycle ---------- */
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!(tray && current && current.settings.tray)) app.quit(); });
  app.on('activate', () => { if (!win) createWindow(); });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(false));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [{ role: 'quit' }] },
      { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] }
    ]));
    try { store.dailyBackup(C.todayKey()); } catch (e) { /* a missing backup must not stop the app */ }
    createWindow();
    setInterval(tickReminders, 30 * 1000);
  });
}
