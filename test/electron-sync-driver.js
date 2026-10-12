'use strict';
/*
 * One step of the two-computer sync test. Run by test/e2e-sync.js, once per step, each with its own
 * data folder (one folder = one computer) and the address of the mock GitHub in KEPT_GITHUB_API.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const STEP = process.env.SYNC_STEP;
const OUT = process.env.SMOKE_OUT;
const DATA = process.env.KEPT_DATA_DIR;
const errors = [];
let win;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (js) => win.webContents.executeJavaScript(js);
async function waitFor(expr, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if (await run(expr)) return true; } catch (e) { /* page not ready */ } await sleep(60); }
  throw new Error('timeout waiting for: ' + expr);
}
const click = (sel) => run(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('missing '+${JSON.stringify(sel)});e.click();return true})()`);
async function shot(name) { await sleep(200); fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
const setInput = (sel, v) => run(`(()=>{const i=document.querySelector(${JSON.stringify(sel)});i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const syncText = () => run(`document.getElementById('sync-state').hidden ? '' : document.getElementById('sync-state').textContent`);
const habitNames = () => run(`[...document.querySelectorAll('.habit .name')].map(n=>n.textContent)`);
const habitSel = (name) => `[...document.querySelectorAll('.habit')].find(l=>l.querySelector('.name').textContent===${JSON.stringify(name)})`;
const isDone = (name) => run(`${habitSel(name)}.classList.contains('done')`);
async function addHabit(name) {
  await run(`(()=>{const i=document.getElementById('add');i.value=${JSON.stringify(name)};i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await waitFor(`[...document.querySelectorAll('.habit .name')].some(n=>n.textContent===${JSON.stringify(name)})`);
}
async function openSettings() { await click('#nav [data-view="settings"]'); await waitFor(`!!document.querySelector('.section')`); }
async function openToday() { await click('#nav [data-view="today"]'); await waitFor(`!!document.getElementById('add')`); }
async function connect(repo, token) {
  await openSettings();
  await setInput('#sync-repo', repo);
  await setInput('#sync-token', token);
  await click('[data-f="sync-connect"]');
}
async function waitSynced() { await waitFor(`document.getElementById('sync-state') && document.getElementById('sync-state').textContent==='synced'`, 12000); }
const cfgFile = () => JSON.parse(fs.readFileSync(path.join(DATA, 'sync.json'), 'utf8'));

const steps = {
  // Computer A: first connection, with the mistakes people make along the way
  async A1() {
    await waitFor(`!!document.getElementById('add')`);
    await openSettings();
    await shot('s1-settings-not-connected');
    await connect('not a repo', 'x');
    await waitFor(`/owner\\/name/.test(document.body.innerText)`);
    await connect('me/habits', 'wrong-token');
    await waitFor(`/rejected the token/.test(document.body.innerText)`);
    await connect('me/missing', process.env.SYNC_TOKEN);
    await waitFor(`/cannot find that repository/.test(document.body.innerText)`);
    await connect('https://github.com/me/habits.git', process.env.SYNC_TOKEN); // a pasted URL is fine
    await waitFor(`/last synced/.test(document.body.innerText)`);
    await waitSynced();
    assert.ok(!fs.readFileSync(path.join(DATA, 'habits.json'), 'utf8').includes(process.env.SYNC_TOKEN), 'the token is not in the habit data');
    assert.equal(cfgFile().repo, 'me/habits');
    await shot('s2-settings-connected');
    await openToday();
    await addHabit('Read 20 pages');
    await run(`${habitSel('Read 20 pages')}.querySelector('.box').click()`);
    await waitFor(`document.getElementById('sync-state').textContent==='syncing…'`, 6000).catch(() => {}); // it syncs a few seconds after an edit
    await sleep(3500);
    await waitSynced();
    console.log('STEP A1 ok');
  },

  // Computer B: a different folder, same repository. It should receive A's habit, then make its own changes.
  async B1() {
    await waitFor(`!!document.getElementById('add')`);
    assert.deepEqual(await habitNames(), [], 'B starts empty');
    await connect('me/habits', process.env.SYNC_TOKEN);
    await waitFor(`/last synced/.test(document.body.innerText)`);
    await openToday();
    await waitFor(`document.querySelectorAll('.habit').length===1`, 12000);
    assert.deepEqual(await habitNames(), ['Read 20 pages']);
    assert.equal(await isDone('Read 20 pages'), true, 'A\'s check-in arrived');
    await shot('s3-device-b-after-first-sync');
    await addHabit('Walk');
    await run(`${habitSel('Read 20 pages')}.querySelector('.box').click()`); // un-check, later than A's check
    await sleep(3500);
    await waitSynced();
    console.log('STEP B1 ok');
  },

  // Computer A again, after a restart: it is still connected and picks up B's changes
  async A2() {
    await waitFor(`!!document.getElementById('add')`);
    await waitFor(`document.querySelectorAll('.habit').length===2`, 12000);
    assert.deepEqual((await habitNames()).sort(), ['Read 20 pages', 'Walk']);
    assert.equal(await isDone('Read 20 pages'), false, 'B\'s later un-check won');
    await waitSynced();
    // delete on A, then B sees it go
    await run(`${habitSel('Walk')}.querySelector('.more').click()`);
    await waitFor(`document.getElementById('edit-dialog').open`);
    await run(`[...document.querySelectorAll('#edit-form .link.danger')].find(b=>b.textContent==='delete').click()`);
    await run(`[...document.querySelectorAll('#edit-form .link.danger')].find(b=>b.textContent==='delete').click()`);
    await waitFor(`document.querySelectorAll('.habit').length===1`);
    await sleep(3500);
    await waitSynced();
    // disconnect keeps the data
    await openSettings();
    await click('[data-f="disconnect"]');
    await click('[data-f="disconnect-yes"]');
    await waitFor(`!!document.getElementById('sync-repo')`);
    await openToday();
    assert.deepEqual(await habitNames(), ['Read 20 pages']);
    assert.ok(!fs.existsSync(path.join(DATA, 'sync.json')), 'the saved token is removed on disconnect');
    console.log('STEP A2 ok');
  },

  // Computer B again: sees the deletion from A
  async B2() {
    await waitFor(`document.querySelectorAll('.habit').length===1`, 12000);
    assert.deepEqual(await habitNames(), ['Read 20 pages']);
    await waitSynced();
    await shot('s4-device-b-final');
    console.log('STEP B2 ok');
  },

  // Offline: the mock is gone. Edits are kept locally and the indicator says so.
  async OFFLINE() {
    await waitFor(`!!document.getElementById('add')`);
    await addHabit('Written while offline');
    await waitFor(`document.getElementById('sync-state').textContent==='offline'`, 15000);
    await openSettings();
    await shot('s5-offline');
    await sleep(800);
    assert.ok(fs.readFileSync(path.join(DATA, 'habits.json'), 'utf8').includes('Written while offline'), 'saved locally');
    console.log('STEP OFFLINE ok');
  }
};

app.whenReady().then(async () => {
  try {
    require('../main.js');
    for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
    assert.ok(win, 'window opened');
    win.webContents.on('console-message', (...args) => {
      const e = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0] : { level: args[1], message: args[2] };
      if (e.level === 3 || e.level === 'error') errors.push(String(e.message));
    });
    await waitFor(`document.readyState==='complete'`);
    await steps[STEP]();
    assert.deepEqual(errors, [], 'console errors: ' + errors.join(' | '));
  } catch (e) {
    console.error('STEP ' + STEP + ' FAIL', e && e.stack || e);
    try { console.error('page text at failure:\n' + await run('document.body.innerText')); } catch (err) { /* page gone */ }
    process.exitCode = 1;
  } finally {
    app.exit(process.exitCode || 0);
  }
});
