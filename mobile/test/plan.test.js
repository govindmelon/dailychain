'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../../src/core.js');
const P = require('../adapter/plan.js');

function withReminder(time) {
  let d = C.migrate(null);
  d.settings.reminder = { enabled: true, time: time || '20:00' };
  return d;
}

test('off means nothing is planned', () => {
  const d = C.migrate(null);
  C.addHabit(d, { name: 'read' }, '2026-10-13');
  assert.deepStrictEqual(P.plan(d, new Date(2026, 9, 13, 9, 0)), []);
});

test('a daily habit gets a notice for each coming day at the chosen time', () => {
  const d = withReminder('20:30');
  C.addHabit(d, { name: 'read' }, '2026-10-13');
  const items = P.plan(d, new Date(2026, 9, 13, 9, 0));
  assert.strictEqual(items.length, P.DAYS);
  assert.strictEqual(items[0].at.getHours(), 20);
  assert.strictEqual(items[0].at.getMinutes(), 30);
  assert.strictEqual(items[0].at.getDate(), 13);
  assert.match(items[0].body, /1 habit is still open today: read/);
  assert.strictEqual(new Set(items.map((n) => n.id)).size, P.DAYS);
});

test('today is skipped when everything is done or the time has passed', () => {
  const d = withReminder('20:00');
  const h = C.addHabit(d, { name: 'read' }, '2026-10-13');
  const id = d.habits[0].id;
  C.setValue(d, id, '2026-10-13', 1);
  let items = P.plan(d, new Date(2026, 9, 13, 9, 0));
  assert.strictEqual(items[0].at.getDate(), 14); // done today, so the first notice is tomorrow
  const d2 = withReminder('20:00');
  C.addHabit(d2, { name: 'read' }, '2026-10-13');
  items = P.plan(d2, new Date(2026, 9, 13, 21, 0));
  assert.strictEqual(items[0].at.getDate(), 14);
});

test('days with nothing due are left out', () => {
  const d = withReminder('20:00');
  C.addHabit(d, { name: 'run', schedule: { type: 'days', days: [1] } }, '2026-10-13'); // Tuesdays only (Mon=0)
  const items = P.plan(d, new Date(2026, 9, 13, 9, 0)); // Tue 13 Oct 2026
  assert.deepStrictEqual(items.map((n) => n.at.getDate()), [13, 20]);
});

test('signature changes only when the plan changes', () => {
  const d = withReminder('20:00');
  C.addHabit(d, { name: 'read' }, '2026-10-13');
  const now = new Date(2026, 9, 13, 9, 0);
  const a = P.signature(P.plan(d, now));
  assert.strictEqual(a, P.signature(P.plan(d, new Date(2026, 9, 13, 9, 5))));
  d.settings.reminder.time = '21:00';
  assert.notStrictEqual(a, P.signature(P.plan(d, now)));
});
