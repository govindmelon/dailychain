'use strict';
/* File storage for the desktop app. Plain Node, no Electron, so it can be tested on its own. */
const fs = require('node:fs');
const path = require('node:path');

const KEEP_BACKUPS = 14;

function createStore(dir) {
  const file = path.join(dir, 'habits.json');
  const backupDir = path.join(dir, 'backups');
  const stateFile = path.join(dir, 'state.json');

  function ensure(p) { fs.mkdirSync(p || dir, { recursive: true }); }

  function listBackups() {
    try {
      return fs.readdirSync(backupDir).filter((n) => /^habits-.*\.json$/.test(n)).sort().map((n) => path.join(backupDir, n));
    } catch (e) { return []; }
  }

  /** Copies the current data file into backups/. Keeps the newest KEEP_BACKUPS. */
  function pad(n, w) { return String(n).padStart(w || 2, '0'); }
  function localDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function snapshot(label, dateKey) {
    if (!fs.existsSync(file)) return null;
    ensure(backupDir);
    const d = new Date();
    // Named by local date, so "one backup per day" and the file names agree about what a day is.
    const stamp = (dateKey || localDate(d)) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + pad(d.getMilliseconds(), 3);
    const dest = path.join(backupDir, 'habits-' + stamp + (label ? '-' + label : '') + '.json');
    fs.copyFileSync(file, dest);
    const all = listBackups();
    all.slice(0, Math.max(0, all.length - KEEP_BACKUPS)).forEach((p) => { try { fs.unlinkSync(p); } catch (e) { /* already gone */ } });
    return dest;
  }

  /** One backup per calendar day, taken the first time the app starts that day. */
  function dailyBackup(todayKey) {
    if (!fs.existsSync(file)) return null;
    const have = listBackups().some((p) => path.basename(p).startsWith('habits-' + todayKey + '-'));
    return have ? null : snapshot('daily', todayKey);
  }

  /** Returns { data, notice? }. A damaged file is kept aside and the newest backup is tried. */
  function load() {
    ensure();
    if (!fs.existsSync(file)) return { data: null };
    try {
      return { data: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (e) {
      const aside = path.join(dir, 'habits.damaged-' + Date.now() + '.json');
      try { fs.renameSync(file, aside); } catch (err) { /* leave it */ }
      const backups = listBackups().reverse();
      for (const b of backups) {
        try {
          const data = JSON.parse(fs.readFileSync(b, 'utf8'));
          return { data, notice: 'Your data file was damaged, so the latest backup was restored. The damaged file was kept as ' + path.basename(aside) + '.' };
        } catch (err) { /* try the next one */ }
      }
      return { data: null, notice: 'Your data file was damaged and could not be read. It was kept as ' + path.basename(aside) + '.' };
    }
  }

  /** Writes to a temporary file first, then renames, so a crash cannot leave half a file. */
  function save(data) {
    ensure();
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function readState() {
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {}; } catch (e) { return {}; }
  }
  function writeState(state) {
    try { ensure(); fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 }); } catch (e) { /* not critical */ }
  }

  return { dir, file, backupDir, load, save, snapshot, dailyBackup, listBackups, readState, writeState };
}

module.exports = { createStore, KEEP_BACKUPS };
