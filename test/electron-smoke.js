'use strict';
/*
 * Runs the real app (main.js) inside Electron and drives the interface.
 *   KEPT_DATA_DIR=<tmp> SMOKE_OUT=<dir> SMOKE_PHASE=first|second \
 *     xvfb-run -a electron --no-sandbox test/electron-smoke.js
 * The first phase builds some data and takes screenshots; the second launches again and checks the data is still there.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const OUT = process.env.SMOKE_OUT;
const DATA = process.env.KEPT_DATA_DIR;
const PHASE = process.env.SMOKE_PHASE || 'first';
const errors = [];
let win;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (js) => win.webContents.executeJavaScript(js);
async function waitFor(expr, ms = 5000) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if (await run(expr)) return true; } catch (e) { /* page not ready */ } await sleep(50); }
  throw new Error('timeout waiting for: ' + expr);
}
const click = (sel) => run(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('missing '+${JSON.stringify(sel)});e.click();return true})()`);
async function shot(name) {
  await sleep(150);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
}
async function addHabit(name) {
  await run(`(()=>{const i=document.getElementById('add');i.value=${JSON.stringify(name)};i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await waitFor(`[...document.querySelectorAll('.habit .name')].some(n=>n.textContent===${JSON.stringify(name)})||document.querySelector('.group-toggle')`);
}
const habitSel = (name) => `[...document.querySelectorAll('.habit')].find(l=>l.querySelector('.name').textContent===${JSON.stringify(name)})`;
async function openEditor(name) {
  await run(`${habitSel(name)}.querySelector('.more').click()`);
  await waitFor(`document.getElementById('edit-dialog').open`);
}

async function first() {
  await waitFor(`!!document.getElementById('add')`);
  assert.equal(await run(`document.querySelectorAll('.habit').length`), 0);
  await shot('01-empty');

  for (const n of ['Meditate 10 min', 'Read 20 pages', 'Drink water', 'Gym', 'Journal']) await addHabit(n);

  // count habit
  await openEditor('Drink water');
  await click('[data-f="kind-count"]');
  await run(`(()=>{const t=document.querySelector('#edit-form input[type=number]');t.value='8';t.dispatchEvent(new Event('input',{bubbles:true}));const u=document.querySelector('#edit-form input[placeholder^="unit"]');u.value='glasses';u.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await shot('07-editor');
  await run(`document.getElementById('edit-form').requestSubmit()`);
  await waitFor(`!document.getElementById('edit-dialog').open`);

  // weekday habit: every day but Tue/Thu off, so Mon Wed Fri
  await openEditor('Gym');
  await click('[data-f="type-days"]');
  await click('[data-f="day-1"]');
  await click('[data-f="day-3"]');
  await run(`document.getElementById('edit-form').requestSubmit()`);
  await waitFor(`!document.getElementById('edit-dialog').open`);

  // weekly habit
  await openEditor('Journal');
  await click('[data-f="type-weekly"]');
  await run(`document.getElementById('edit-form').requestSubmit()`);
  await waitFor(`!document.getElementById('edit-dialog').open`);

  // check in today, bump the counter, write a note
  await run(`${habitSel('Meditate 10 min')}.querySelector('.box').click()`);
  await run(`${habitSel('Read 20 pages')}.querySelector('.box').click()`);
  for (let i = 0; i < 5; i++) await run(`${habitSel('Drink water')}.querySelector('.stepper button:last-child').click()`);
  await run(`(()=>{const n=document.getElementById('note');n.value='Slept badly, still did everything.';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);

  // backfill the last few days so streaks and the heatmap have something to show
  for (let back = 1; back <= 6; back++) {
    await click('[data-f="prev"]');
    await waitFor(`!document.querySelector('[data-f="today"]') === false`);
    if (back !== 3) await run(`${habitSel('Meditate 10 min')}.querySelector('.box').click()`);
    if (back % 2 === 1) await run(`${habitSel('Read 20 pages')}.querySelector('.box').click()`);
  }
  await click('[data-f="today"]');
  await waitFor(`!document.querySelector('[data-f="today"]')`);

  // keyboard: arrows move between days, e opens the editor on the focused habit
  await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`);
  await waitFor(`!!document.querySelector('[data-f="today"]')`);
  await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'t',bubbles:true}))`);
  await waitFor(`!document.querySelector('[data-f="today"]')`);
  await run(`document.querySelector('.habit .box').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true}))`);
  await waitFor(`document.getElementById('edit-dialog').open`);
  await run(`document.getElementById('edit-dialog').close()`);

  await shot('02-today-light');

  await click('#nav [data-view="stats"]');
  await waitFor(`!!document.querySelector('.facts')`);
  await shot('03-stats-all');
  await click('[data-f="' + (await run(`document.querySelector('.picks button:nth-child(2)').getAttribute('data-f')`)) + '"]');
  await shot('04-stats-habit');

  await click('#nav [data-view="settings"]');
  await waitFor(`!!document.querySelector('.section')`);
  await click('[data-f="rem-on"]');
  await shot('05-settings');

  // dark theme, chosen through the app's own setting
  await click('[data-f="theme-dark"]');
  await waitFor(`document.documentElement.getAttribute('data-theme')==='dark'`);
  await shot('09-settings-dark');
  await click('#nav [data-view="today"]');
  await waitFor(`!!document.getElementById('add')`);
  await shot('06-today-dark');
  await click('#nav [data-view="stats"]');
  await waitFor(`!!document.querySelector('.facts')`);
  await shot('08-stats-dark');
  await click('#nav [data-view="settings"]');
  await waitFor(`!!document.querySelector('.section')`);
  await click('[data-f="theme-system"]');
  await waitFor(`!document.documentElement.getAttribute('data-theme')`);

  // saved to disk?
  await sleep(700);
  const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'habits.json'), 'utf8'));
  assert.equal(saved.habits.length, 5);
  assert.equal(saved.habits.find((h) => h.name === 'Drink water').target, 8);
  assert.deepEqual(saved.habits.find((h) => h.name === 'Gym').schedule.days, [0, 2, 4]);
  assert.equal(saved.habits.find((h) => h.name === 'Journal').schedule.type, 'weekly');
  assert.equal(saved.settings.reminder.enabled, true);
  const water = saved.habits.find((h) => h.name === 'Drink water');
  assert.equal(Object.values(saved.log[water.id])[0], 5);
  assert.ok(Object.keys(saved.notes).length === 1);
  console.log('SMOKE first phase ok: data saved to ' + path.join(DATA, 'habits.json'));
}

async function second() {
  await waitFor(`document.querySelectorAll('.habit').length>=3`);
  const names = await run(`[...document.querySelectorAll('.habit .name')].map(n=>n.textContent)`);
  assert.ok(names.includes('Read 20 pages') && names.includes('Meditate 10 min'), 'habits survive a restart: ' + names.join(', '));
  assert.equal(await run(`document.getElementById('note').value`), 'Slept badly, still did everything.');
  assert.match(await run(`document.querySelector('.progress').textContent`), /\d\/\d done/);
  assert.ok(fs.readdirSync(path.join(DATA, 'backups')).length >= 1, 'a daily backup exists');
  console.log('SMOKE second phase ok: data survived a restart');
}

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
    await (PHASE === 'second' ? second() : first());
    assert.deepEqual(errors, [], 'console errors: ' + errors.join(' | '));
    console.log('SMOKE no console errors');
  } catch (e) {
    console.error('SMOKE FAIL', e && e.stack || e);
    if (errors.length) console.error('console errors:', errors);
    try { console.error('page text at failure:\n' + await run('document.body.innerText')); } catch (err) { /* page gone */ }
    process.exitCode = 1;
  } finally {
    app.exit(process.exitCode || 0);
  }
});
