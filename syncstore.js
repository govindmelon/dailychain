'use strict';
/*
 * Where the sync settings live: userData/sync.json (mode 0600).
 * The token is encrypted with the system keyring when one is available. When it is not
 * (some minimal Linux desktops have none), the token is kept in the file as plain text,
 * which only your user can read, and the app tells you so. `crypto` is passed in so this
 * can be tested without Electron.
 */
const fs = require('node:fs');
const path = require('node:path');

function createSyncConfig(dir, crypto) {
  const file = path.join(dir, 'sync.json');

  function read() {
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : null; } catch (e) { return null; }
  }
  function write(obj) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  /** { repo, path, secure, lastSync, token } or null. token is null if it can no longer be decrypted. */
  function load() {
    const j = read();
    if (!j || typeof j.repo !== 'string') return null;
    let token = null;
    try {
      if (typeof j.plain === 'string') token = j.plain;
      else if (typeof j.enc === 'string') token = crypto.decrypt(j.enc);
    } catch (e) { token = null; }
    return { repo: j.repo, path: typeof j.path === 'string' ? j.path : undefined, secure: !!j.enc, lastSync: Number(j.lastSync) || 0, token: token || null };
  }

  function save(repo, token, filePath) {
    const rec = { repo, lastSync: 0 };
    if (filePath) rec.path = filePath;
    let secure = false;
    if (crypto.available()) {
      try { rec.enc = crypto.encrypt(token); secure = true; } catch (e) { secure = false; }
    }
    if (!secure) rec.plain = token;
    write(rec);
    return { secure };
  }

  function touch(lastSync) {
    const j = read();
    if (j) { j.lastSync = lastSync; write(j); }
  }

  function clear() { try { fs.unlinkSync(file); } catch (e) { /* nothing saved */ } }

  return { file, load, save, touch, clear };
}

module.exports = { createSyncConfig };
