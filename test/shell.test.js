'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, KEEP_BACKUPS } = require('../storage.js');
const reminders = require('../reminders.js');
const C = require('../src/core.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dc-shell-')); }

test('save then load round trips and leaves no temp file', () => {
  const dir = tmp();
  const s = createStore(dir);
  assert.deepEqual(s.load(), { data: null });
  s.save({ version: 2, habits: [], hello: 'world' });
  assert.equal(s.load().data.hello, 'world');
  assert.ok(!fs.existsSync(s.file + '.tmp'));
  assert.equal(fs.statSync(s.file).mode & 0o777, 0o600);
});

test('a damaged file is kept aside and the newest backup is restored', () => {
  const dir = tmp();
  const s = createStore(dir);
  s.save({ marker: 'good' });
  s.snapshot('test');
  fs.writeFileSync(s.file, '{ this is not json');
  const r = s.load();
  assert.equal(r.data.marker, 'good');
  assert.match(r.notice, /damaged/);
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('habits.damaged-')));
  assert.ok(!fs.existsSync(s.file));
});

test('a damaged file with no backup starts fresh and says so', () => {
  const dir = tmp();
  const s = createStore(dir);
  fs.writeFileSync(s.file, 'garbage');
  const r = s.load();
  assert.equal(r.data, null);
  assert.match(r.notice, /could not be read/);
});

test('daily backup is taken once per day and old backups are pruned', () => {
  const dir = tmp();
  const s = createStore(dir);
  assert.equal(s.dailyBackup('2026-10-12'), null); // nothing to back up yet
  s.save({ a: 1 });
  const first = s.dailyBackup('2026-10-12');
  assert.ok(first);
  assert.equal(s.dailyBackup('2026-10-12'), null);
  for (let i = 0; i < KEEP_BACKUPS + 5; i++) { fs.writeFileSync(path.join(s.backupDir, 'habits-2020-01-' + String(10 + i).padStart(2, '0') + '.json'), '{}'); }
  s.snapshot('prune');
  assert.equal(s.listBackups().length, KEEP_BACKUPS);
});

test('state file survives a bad read', () => {
  const dir = tmp();
  const s = createStore(dir);
  assert.deepEqual(s.readState(), {});
  s.writeState({ last: '2026-10-12' });
  assert.deepEqual(s.readState(), { last: '2026-10-12' });
  fs.writeFileSync(path.join(dir, 'state.json'), 'nope');
  assert.deepEqual(s.readState(), {});
});

function withReminder(time, enabled = true) {
  const data = C.defaultData();
  data.settings.reminder = { enabled, time };
  C.addHabit(data, { name: 'Read' }, '2026-10-01');
  C.addHabit(data, { name: 'Walk' }, '2026-10-01');
  return data;
}
const at = (h, m) => new Date(2026, 9, 12, h, m);

test('reminder waits for the set time, then fires once with the open habits', () => {
  const data = withReminder('20:00');
  const state = {};
  assert.equal(reminders.check(data, at(19, 59), state), null);
  assert.deepEqual(reminders.check(data, at(20, 0), state), ['Read', 'Walk']);
  assert.equal(reminders.check(data, at(20, 1), state), null);
  assert.equal(state.last, '2026-10-12');
});

test('reminder stays quiet when everything is done, when disabled, and when the app starts far too late', () => {
  const data = withReminder('20:00');
  data.habits.forEach((h) => C.setValue(data, h.id, '2026-10-12', 1));
  assert.equal(reminders.check(data, at(20, 5), {}), null);
  assert.equal(reminders.check(withReminder('20:00', false), at(20, 5), {}), null);
  const late = {};
  assert.equal(reminders.check(withReminder('08:00'), at(23, 30), late), null);
  assert.equal(late.last, '2026-10-12'); // handled, so it will not fire again
});

test('reminder message reads naturally', () => {
  assert.equal(reminders.message(['Read']), '1 habit is still open today: Read.');
  assert.equal(reminders.message(['A', 'B', 'C', 'D', 'E']), '5 habits are still open today: A, B, C and 2 more.');
});
