/*
 * Phone storage for Kept. Plays the same part as preload.js + main.js do on the desktop:
 * data on disk, backups, export/import, GitHub sync and reminders. The page talks to it
 * through window.DCNative, exactly as it talks to window.dc on the computer.
 *
 * Everything is written to the app's private folder (Capacitor "Data" = getFilesDir()), which
 * other apps cannot read. `plugins` is { Filesystem, LocalNotifications, Share, App }; tests
 * pass fakes, the real app passes window.Capacitor.Plugins.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.DCCreateAndroidStore = factory;
})(typeof self !== 'undefined' ? self : this, function createAndroidStore(env) {
  'use strict';
  var C = env.core, Sync = env.sync, Plan = env.plan;
  var FS = env.plugins.Filesystem;
  var Notifs = env.plugins.LocalNotifications;
  var Share = env.plugins.Share;
  var AppPlugin = env.plugins.App;
  var fetchFn = env.fetch;
  var clock = env.now || function () { return new Date(); };

  var MAIN = 'habits.json';
  var SPARE = 'habits.json.new';  // the newest save, written first; see save()
  var SYNC = 'sync.json';
  var BACKUPS = 'backups';
  var KEEP_BACKUPS = 14;
  var MAX_FILE = 5 * 1024 * 1024;

  /* ---------- tiny file helpers ---------- */
  function read(path) {
    return FS.readFile({ path: path, directory: 'DATA', encoding: 'utf8' }).then(function (r) { return typeof r.data === 'string' ? r.data : ''; });
  }
  function write(path, text) {
    return FS.writeFile({ path: path, directory: 'DATA', data: text, encoding: 'utf8', recursive: true });
  }
  function remove(path) {
    return FS.deleteFile({ path: path, directory: 'DATA' }).catch(function () { /* already gone */ });
  }
  function parseOrNull(text) {
    try { var j = JSON.parse(text); return j && typeof j === 'object' ? j : null; } catch (e) { return null; }
  }
  function readJson(path) { return read(path).then(parseOrNull, function () { return null; }); }
  function pad(n, w) { return String(n).padStart(w || 2, '0'); }

  /* ---------- data: habits.json, a spare copy, and daily backups ---------- */
  /*
   * Writing a file is not atomic and rename semantics differ between devices, so a save goes to
   * the spare file first, then to the main file, then the spare is removed. Loading prefers a
   * valid spare (it can only exist if the last save did not finish) and otherwise the main file.
   * A half-written file is not valid JSON, so one of the two is always whole.
   */
  var saveChain = Promise.resolve();
  function save(data) {
    var text = JSON.stringify(data, null, 2);
    var job = saveChain.then(function () {
      return write(SPARE, text).then(function () { return write(MAIN, text); }).then(function () { return remove(SPARE); });
    }).then(function () {
      lastData = data;
      return afterSave(data).then(function () { return { ok: true }; });
    }, function (e) { return { ok: false, error: 'Could not save your data: ' + (e && e.message ? e.message : 'storage error') }; });
    saveChain = job.catch(function () {});
    return job;
  }

  function backupNames() {
    return FS.readdir({ path: BACKUPS, directory: 'DATA' }).then(function (r) {
      return (r.files || []).map(function (f) { return typeof f === 'string' ? f : f.name; })
        .filter(function (n) { return /^habits-.*\.json$/.test(n); }).sort();
    }, function () { return []; });
  }
  function snapshot(label, dateKey) {
    return read(MAIN).then(function (text) {
      if (!parseOrNull(text)) return null;
      var d = clock();
      var stamp = (dateKey || C.todayKey(d)) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + pad(d.getMilliseconds(), 3);
      var name = BACKUPS + '/habits-' + stamp + (label ? '-' + label : '') + '.json';
      return write(name, text).then(function () { return backupNames(); }).then(function (all) {
        return Promise.all(all.slice(0, Math.max(0, all.length - KEEP_BACKUPS)).map(function (n) { return remove(BACKUPS + '/' + n); }));
      }).then(function () { return name; });
    }, function () { return null; });
  }
  function dailyBackup() {
    var today = C.todayKey(clock());
    return backupNames().then(function (names) {
      var have = names.some(function (n) { return n.indexOf('habits-' + today + '-') === 0; });
      return have ? null : snapshot('daily', today);
    });
  }

  var lastData = null;
  function load() {
    return readJson(SPARE).then(function (spare) {
      if (spare) return { data: spare };
      return read(MAIN).then(function (text) {
        var main = parseOrNull(text);
        if (main) return { data: main };
        // The file exists but is damaged: keep it aside and fall back to the newest backup.
        var aside = 'habits.damaged-' + Date.now() + '.json';
        return write(aside, text).then(function () { return remove(MAIN); }).then(function () { return backupNames(); }).then(function (names) {
          var tryNext = function (i) {
            if (i < 0) return { data: null, notice: 'Your data file was damaged and could not be read. It was kept as ' + aside + '.' };
            return readJson(BACKUPS + '/' + names[i]).then(function (b) {
              return b ? { data: b, notice: 'Your data file was damaged, so the latest backup was restored. The damaged file was kept as ' + aside + '.' } : tryNext(i - 1);
            });
          };
          return tryNext(names.length - 1);
        });
      }, function () { return { data: null }; }); // no file yet: first run
    }).then(function (res) {
      if (res.data) { lastData = C.migrate(res.data); dailyBackup().catch(function () {}).then(function () { return afterSave(lastData); }).catch(function () {}); }
      return res;
    });
  }

  /* ---------- export and import ---------- */
  function shareText(name, text, title) {
    return FS.writeFile({ path: name, directory: 'CACHE', data: text, encoding: 'utf8', recursive: true })
      .then(function () { return FS.getUri({ path: name, directory: 'CACHE' }); })
      .then(function (u) { return Share.share({ title: title, dialogTitle: title, files: [u.uri] }); })
      .then(function () { return { ok: true }; }, function (e) {
        var m = e && e.message ? String(e.message) : '';
        return /cancel|dismiss/i.test(m) ? { ok: false } : { ok: false, error: 'Could not share the file: ' + m };
      });
  }
  function exportJson(data) { return shareText('kept-' + C.todayKey(clock()) + '.json', JSON.stringify(C.migrate(data), null, 2), 'Kept data'); }
  function exportCsv(csv) { return typeof csv === 'string' && csv.length <= MAX_FILE ? shareText('kept-' + C.todayKey(clock()) + '.csv', csv, 'Kept check-ins') : Promise.resolve({ ok: false }); }

  function importFile() {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json,text/plain';
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (!f) { resolve({ canceled: true }); return; }
        if (f.size > MAX_FILE) { resolve({ error: 'That file is too large.' }); return; }
        f.text().then(function (t) {
          var j = parseOrNull(t);
          if (!j) { resolve({ error: 'That file could not be read as Kept data.' }); return; }
          snapshot('before-import').then(function () { resolve({ data: j }); }, function () { resolve({ data: j }); });
        }, function () { resolve({ error: 'That file could not be read.' }); });
      });
      input.addEventListener('cancel', function () { resolve({ canceled: true }); });
      input.click();
    });
  }

  /* ---------- GitHub sync (the token never goes to the page) ---------- */
  var cfg = null; // { repo, token, lastSync } cached after the first read
  function loadCfg() {
    if (cfg !== null) return Promise.resolve(cfg || null);
    return readJson(SYNC).then(function (j) {
      cfg = j && typeof j.repo === 'string' ? { repo: j.repo, token: typeof j.token === 'string' ? j.token : null, lastSync: Number(j.lastSync) || 0 } : false;
      return cfg || null;
    });
  }
  function status() {
    return loadCfg().then(function (c) {
      return c ? { configured: true, repo: c.repo, secure: true, lastSync: c.lastSync, needsToken: !c.token } : { configured: false };
    });
  }
  function client(repo, token) {
    return Sync.createClient({ repo: repo, token: token, device: env.deviceName || 'phone', fetch: fetchFn, baseUrl: env.apiBase, apiVersion: false });
  }
  function failure(e) {
    if (e instanceof Sync.SyncError) return { ok: false, kind: e.kind, error: e.message };
    return { ok: false, kind: 'server', error: 'Syncing failed unexpectedly.' };
  }
  function connect(repoInput, tokenInput) {
    var repo = Sync.parseRepo(repoInput), token = Sync.cleanToken(tokenInput);
    if (!repo) return Promise.resolve({ ok: false, error: 'Enter the repository as owner/name, for example sam/kept-data.' });
    if (!token) return Promise.resolve({ ok: false, error: 'Paste your GitHub token. It should have no spaces.' });
    return client(repo, token).verify().then(function () {
      cfg = { repo: repo, token: token, lastSync: 0 };
      return write(SYNC, JSON.stringify(cfg));
    }).then(function () { return status(); }).then(function (s) { return { ok: true, status: s }; }, failure);
  }
  function disconnect() {
    cfg = false;
    return remove(SYNC).then(function () { return { configured: false }; });
  }
  var syncChain = Promise.resolve();
  function run(raw) {
    if (!raw || typeof raw !== 'object') return Promise.resolve({ ok: false, kind: 'input', error: 'Rejected.' });
    var job = syncChain.then(function () {
      return loadCfg().then(function (c) {
        if (!c) return { ok: false, kind: 'input', error: 'Sync is not set up.' };
        if (!c.token) return { ok: false, kind: 'auth', error: 'The saved token can no longer be read. Disconnect and connect again with a new token.' };
        return client(c.repo, c.token).sync(C.migrate(raw)).then(function (r) {
          c.lastSync = Date.now();
          return write(SYNC, JSON.stringify(c)).catch(function () {}).then(function () { return status(); }).then(function (s) {
            return { ok: true, data: r.data, pushed: r.pushed, pulled: r.pulled, status: s };
          });
        }, failure);
      });
    });
    syncChain = job.catch(function () {});
    return job;
  }

  /* ---------- reminders ---------- */
  var lastSig = null, lastEnabled = false, remChain = Promise.resolve();
  function cancelAll() {
    return Notifs.cancel({ notifications: Plan.ids.map(function (id) { return { id: id }; }) }).catch(function () {});
  }
  function reschedule(data) {
    if (!Notifs || !data) return Promise.resolve();
    var job = remChain.then(function () {
      var enabled = !!(data.settings && data.settings.reminder && data.settings.reminder.enabled);
      var items = enabled ? Plan.plan(data, clock()) : [];
      var sig = Plan.signature(items);
      if (sig === lastSig) { lastEnabled = enabled; return null; }
      var turnedOn = enabled && !lastEnabled;
      lastEnabled = enabled;
      var permission = !items.length && !turnedOn ? Promise.resolve('granted') :
        Notifs.checkPermissions().then(function (p) {
          var s = p && p.display;
          return enabled && turnedOn && (s === 'prompt' || s === 'prompt-with-rationale') ? Notifs.requestPermissions().then(function (q) { return q && q.display; }) : s;
        });
      return permission.then(function (s) {
        return cancelAll().then(function () {
          lastSig = sig;
          if (!items.length || s !== 'granted') { if (items.length) lastSig = null; return null; }
          return Notifs.schedule({
            notifications: items.map(function (n) {
              return {
                id: n.id, title: 'kept', body: n.body, smallIcon: 'ic_stat_kept',
                schedule: { at: n.at, allowWhileIdle: true },
                isExactNotification: false // an exact alarm would send the person to a settings screen; a few minutes either way is fine
              };
            })
          });
        });
      });
    }).catch(function () { lastSig = null; /* try again on the next save */ });
    remChain = job;
    return job;
  }
  function afterSave(data) { return reschedule(data); }

  /* ---------- the phone's back button and returning to the app ---------- */
  function hookApp() {
    if (!AppPlugin || typeof document === 'undefined') return;
    AppPlugin.addListener('backButton', function () {
      var dlg = document.querySelector('dialog[open]');
      if (dlg) { dlg.close(); return; }
      var cur = document.querySelector('#nav [aria-current="page"]');
      var home = document.querySelector('#nav [data-view="today"]');
      if (cur && home && cur !== home) { home.click(); return; }
      AppPlugin.exitApp();
    });
    AppPlugin.addListener('resume', function () { if (lastData) { lastSig = null; reschedule(lastData); } });
  }

  function info() {
    var v = AppPlugin && AppPlugin.getInfo ? AppPlugin.getInfo().then(function (i) { return i.version; }, function () { return ''; }) : Promise.resolve('');
    return v.then(function (version) { return { version: version, path: null }; });
  }

  hookApp();

  return {
    desktop: false, mobile: true,
    load: load, save: save, exportJson: exportJson, exportCsv: exportCsv, importFile: importFile,
    openFolder: null, info: info,
    syncStatus: status, syncConnect: connect, syncDisconnect: disconnect, syncRun: run,
    _internals: { snapshot: snapshot, backupNames: backupNames, reschedule: reschedule }
  };
});
