'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, Notification, nativeTheme, nativeImage, session, safeStorage, net } = require('electron');
const C = require('./src/core.js');
const { createStore } = require('./storage.js');
const reminders = require('./reminders.js');
const GitHubSync = require('./sync.js');
const { createSyncConfig } = require('./syncstore.js');

const APP_NAME = 'Kept';          // the one place the display name lives in the main process
const OLD_DATA_FOLDER = 'Daily Chain'; // earlier name, migrated on first launch
const MAX_FILE = 10 * 1024 * 1024;
const ICON = path.join(__dirname, 'build', 'icon.png');

// The data folder is fixed before anything else, because the single-instance lock lives inside it.
if (process.env.KEPT_DATA_DIR) app.setPath('userData', process.env.KEPT_DATA_DIR);
else app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

/** Copies data from the old "Daily Chain" folder the first time the renamed app runs. The old folder is left alone. */
function migrateOldData(dir) {
  try {
    if (fs.existsSync(path.join(dir, 'habits.json'))) return;
    const old = path.join(app.getPath('appData'), OLD_DATA_FOLDER);
    if (process.env.KEPT_DATA_DIR || !fs.existsSync(path.join(old, 'habits.json'))) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(old, 'habits.json'), path.join(dir, 'habits.json'));
    const backups = path.join(old, 'backups');
    if (fs.existsSync(backups)) fs.cpSync(backups, path.join(dir, 'backups'), { recursive: true });
  } catch (e) { /* a failed copy must not stop the app from starting */ }
}

function start() {
  migrateOldData(app.getPath('userData'));
  const store = createStore(app.getPath('userData'));
  const reminderState = store.readState();

  /* ---------- sync settings: the token lives here and never goes to the page ---------- */
  const syncCfg = createSyncConfig(app.getPath('userData'), {
    available() {
      try {
        if (!safeStorage.isEncryptionAvailable()) return false;
        const backend = safeStorage.getSelectedStorageBackend ? safeStorage.getSelectedStorageBackend() : '';
        return backend !== 'basic_text' && backend !== 'unknown'; // those mean "no real keyring"
      } catch (e) { return false; }
    },
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'))
  });
  // Tests may point sync at a local mock server. Nothing else is accepted.
  const apiOverride = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(process.env.KEPT_GITHUB_API || '') ? process.env.KEPT_GITHUB_API : undefined;
  let syncChain = Promise.resolve();

  function syncStatus() {
    const cfg = syncCfg.load();
    if (!cfg) return { configured: false };
    return { configured: true, repo: cfg.repo, secure: cfg.secure, lastSync: cfg.lastSync, needsToken: !cfg.token };
  }
  function makeClient(cfg) {
    return GitHubSync.createClient({ repo: cfg.repo, token: cfg.token, path: cfg.path, device: os.hostname(), fetch: net.fetch.bind(net), baseUrl: apiOverride });
  }
  function failure(e) {
    if (e instanceof GitHubSync.SyncError) return { ok: false, kind: e.kind, error: e.message };
    console.error(e);
    return { ok: false, kind: 'server', error: 'Syncing failed unexpectedly.' };
  }
  async function runSync(raw) {
    const cfg = syncCfg.load();
    if (!cfg) return { ok: false, kind: 'input', error: 'Sync is not set up.' };
    if (!cfg.token) return { ok: false, kind: 'auth', error: 'The saved token can no longer be read. Disconnect and connect again with a new token.' };
    try {
      const result = await makeClient(cfg).sync(C.migrate(raw));
      syncCfg.touch(Date.now());
      return { ok: true, data: result.data, pushed: result.pushed, pulled: result.pulled, status: syncStatus() };
    } catch (e) { return failure(e); }
  }
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
      title: APP_NAME,
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
        tray.setToolTip(APP_NAME);
        tray.setContextMenu(Menu.buildFromTemplate([
          { label: 'Show ' + APP_NAME, click: showWindow },
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
      const n = new Notification({ title: APP_NAME, body: reminders.message(names), icon: ICON });
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
      title: 'Export ' + APP_NAME + ' data',
      defaultPath: path.join(app.getPath('documents'), 'kept-' + stamp + '.json'),
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
      defaultPath: path.join(app.getPath('documents'), 'kept-' + C.todayKey() + '.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false };
    try { fs.writeFileSync(r.filePath, csv); return { ok: true, path: r.filePath }; }
    catch (e) { return { ok: false, error: 'Could not write that file: ' + e.message }; }
  });

  ipcMain.handle('data:import', async (event) => {
    if (!fromOurWindow(event)) return { canceled: true };
    const r = await dialog.showOpenDialog(win, {
      title: 'Import ' + APP_NAME + ' data',
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
    } catch (e) { return { error: 'That file could not be read as ' + APP_NAME + ' data.' }; }
  });

  ipcMain.handle('app:open-folder', (event) => { if (fromOurWindow(event)) shell.openPath(store.dir); });
  ipcMain.handle('app:info', (event) => (fromOurWindow(event) ? { version: app.getVersion(), path: store.file } : {}));

  ipcMain.handle('sync:status', (event) => (fromOurWindow(event) ? syncStatus() : { configured: false }));

  ipcMain.handle('sync:connect', async (event, repoInput, tokenInput) => {
    if (!fromOurWindow(event)) return { ok: false, error: 'Rejected.' };
    const repo = GitHubSync.parseRepo(repoInput);
    const token = GitHubSync.cleanToken(tokenInput);
    if (!repo) return { ok: false, error: 'Enter the repository as owner/name, for example sam/kept-data.' };
    if (!token) return { ok: false, error: 'Paste your GitHub token. It should have no spaces.' };
    try {
      await GitHubSync.createClient({ repo, token, fetch: net.fetch.bind(net), baseUrl: apiOverride }).verify();
    } catch (e) { return failure(e); }
    const { secure } = syncCfg.save(repo, token);
    return { ok: true, status: Object.assign(syncStatus(), { secure }) };
  });

  ipcMain.handle('sync:disconnect', (event) => {
    if (fromOurWindow(event)) syncCfg.clear();
    return syncStatus();
  });

  // One sync at a time, in order. The page merges whatever comes back with any edits made meanwhile.
  ipcMain.handle('sync:run', (event, data) => {
    if (!fromOurWindow(event) || !data || typeof data !== 'object') return { ok: false, kind: 'input', error: 'Rejected.' };
    const job = syncChain.then(() => runSync(data));
    syncChain = job.catch(() => {});
    return job;
  });

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
