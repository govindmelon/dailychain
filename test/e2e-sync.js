'use strict';
/*
 * Two-computer sync test. Starts a mock GitHub, then runs the real app (in Electron on a virtual
 * display) several times with two separate data folders standing in for two computers.
 *
 *   node test/e2e-sync.js            needs xvfb-run and `npm install` done
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('./mock-github.js');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'e2e-token-12345';

// Asynchronous on purpose: the mock GitHub runs in this process and must keep answering while the app runs.
function launch(step, dir, mock, out) {
  return new Promise((resolve, reject) => {
    const child = spawn('xvfb-run', ['-a', '-s', '-screen 0 1280x1024x24', path.join(ROOT, 'node_modules', '.bin', 'electron'), '--no-sandbox', '--disable-gpu', path.join(__dirname, 'electron-sync-driver.js')], {
      env: Object.assign({}, process.env, { SYNC_STEP: step, KEPT_DATA_DIR: dir, KEPT_GITHUB_API: mock ? mock.url : 'http://127.0.0.1:9', SYNC_TOKEN: TOKEN, SMOKE_OUT: out })
    });
    let text = '';
    child.stdout.on('data', (d) => { text += d; });
    child.stderr.on('data', (d) => { text += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const noise = /dbus|libva|GLib|Gtk|ALSA|Fontconfig|gpu|bus\.cc|object_proxy|^\s*$/i;
      const lines = text.split('\n').filter((l) => (code === 0 ? /STEP/.test(l) : true) && !noise.test(l));
      console.log(lines.join('\n') || '(no output)');
      if (code === 0) resolve(); else reject(new Error('step ' + step + ' failed'));
    });
  });
}

(async () => {
  const out = process.env.SMOKE_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'kept-shots-'));
  fs.mkdirSync(out, { recursive: true });
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'kept-A-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'kept-B-'));
  const mock = await start(0, { token: TOKEN });
  try {
    await launch('A1', dirA, mock, out);
    assert.equal(mock.read('me/habits', 'kept/habits.json').habits.length, 1, 'A uploaded its habit');
    await launch('B1', dirB, mock, out);
    await launch('A2', dirA, mock, out);
    await launch('B2', dirB, mock, out);
    const final = mock.read('me/habits', 'kept/habits.json');
    assert.equal(final.habits.length, 1);
    assert.equal(final.habits[0].name, 'Read 20 pages');
    assert.ok(Object.keys(final.deleted).length === 1, 'the deletion is recorded in the repository');
    assert.equal(final.settings, undefined, 'settings stay on each computer');
    assert.ok(!JSON.stringify(final).includes(TOKEN), 'the token is never uploaded');
    console.log('commits made by the app:', mock.state.commits.length, '->', [...new Set(mock.state.commits)].join(' | '));
  } finally { await mock.close(); }
  // GitHub unreachable: use the data folder of computer B, which is still connected
  fs.writeFileSync(path.join(dirB, 'sync.json'), JSON.stringify({ repo: 'me/habits', plain: TOKEN, lastSync: Date.now() }), { mode: 0o600 });
  await launch('OFFLINE', dirB, null, out);
  console.log('two-computer sync test passed; screenshots in ' + out);
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
