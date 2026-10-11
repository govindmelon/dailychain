'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

const TODAY = '2026-10-12'; // a Monday
const MON = (n) => C.addDays(TODAY, n);

function setup(spec) {
  const data = C.defaultData();
  const id = C.addHabit(data, Object.assign({ name: 'Test' }, spec), spec && spec.created || TODAY);
  const h = data.habits.find((x) => x.id === id);
  if (spec && spec.created) h.created = spec.created;
  return { data, h, id };
}
function mark(data, id, keys, v) { keys.forEach((k) => C.setValue(data, id, k, v === undefined ? 1 : v)); }

test('date maths is calendar based and survives daylight saving', () => {
  assert.equal(C.addDays('2026-03-07', 2), '2026-03-09');
  assert.equal(C.addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(C.diffDays('2026-10-12', '2026-10-05'), 7);
  assert.equal(C.dowMon('2026-10-12'), 0);
  assert.equal(C.dowMon('2026-10-18'), 6);
  assert.equal(C.startOfWeek('2026-10-14', 'mon'), '2026-10-12');
  assert.equal(C.startOfWeek('2026-10-14', 'sun'), '2026-10-11');
  assert.equal(C.startOfWeek('2026-10-11', 'mon'), '2026-10-05');
  assert.ok(C.isKey('2026-02-28'));
  assert.ok(!C.isKey('2026-02-30'));
  assert.ok(!C.isKey('26-1-1'));
  assert.equal(C.todayKey(new Date(2026, 9, 12, 23, 59)), '2026-10-12');
});

test('daily streak counts back from today, and today in progress does not break it', () => {
  const { data, h, id } = setup({ created: MON(-9) });
  mark(data, id, [MON(-2), MON(-1), TODAY]);
  assert.deepEqual(C.streak(data, h, TODAY, 'mon'), { n: 3, unit: 'd' });
  C.setValue(data, id, TODAY, 0);
  assert.deepEqual(C.streak(data, h, TODAY, 'mon'), { n: 2, unit: 'd' });
  C.setValue(data, id, MON(-1), 0);
  assert.deepEqual(C.streak(data, h, TODAY, 'mon'), { n: 0, unit: 'd' });
});

test('streak does not run past the day the habit was created', () => {
  const { data, h, id } = setup({ created: MON(-1) });
  mark(data, id, [MON(-1), TODAY]);
  assert.equal(C.streak(data, h, TODAY, 'mon').n, 2);
});

test('weekday schedule skips days that are not scheduled', () => {
  const { data, h, id } = setup({ created: MON(-7), schedule: { type: 'days', days: [0, 2, 4] } }); // Mon Wed Fri
  mark(data, id, [MON(-7), MON(-5), MON(-3), TODAY]); // Mon, Wed, Fri, Mon
  assert.equal(C.streak(data, h, TODAY, 'mon').n, 4);
  C.setValue(data, id, MON(-5), 0); // miss Wednesday
  assert.equal(C.streak(data, h, TODAY, 'mon').n, 2);
  assert.ok(!C.dueOn(h, MON(1)));
  assert.ok(C.dueOn(h, MON(2)));
});

test('weekly goal streak counts weeks, and the week in progress never breaks it', () => {
  const { data, h, id } = setup({ created: MON(-14), schedule: { type: 'weekly', perWeek: 3 } });
  mark(data, id, [MON(-14), MON(-12), MON(-10)]); // week of Sep 28: 3
  mark(data, id, [MON(-7), MON(-6), MON(-4)]);    // week of Oct 5: 3
  mark(data, id, [TODAY]);                         // this week: 1 so far
  assert.deepEqual(C.streak(data, h, TODAY, 'mon'), { n: 2, unit: 'w' });
  mark(data, id, [MON(1), MON(2)]);               // goal met this week
  assert.equal(C.streak(data, h, TODAY, 'mon').n, 3);
  C.setValue(data, id, MON(-6), 0);               // last week now falls short
  assert.equal(C.streak(data, h, TODAY, 'mon').n, 1);
  assert.deepEqual(C.weekProgress(data, h, TODAY, 'mon'), { done: 3, goal: 3 });
});

test('best streak finds the longest run, not the current one', () => {
  const { data, h, id } = setup({ created: MON(-20) });
  mark(data, id, [MON(-15), MON(-14), MON(-13), MON(-12), MON(-11), MON(-1)]);
  assert.deepEqual(C.bestStreak(data, h, TODAY, 'mon'), { n: 5, unit: 'd' });
  assert.equal(C.streak(data, h, TODAY, 'mon').n, 1);
});

test('completion rate ignores an unfinished today and days before creation', () => {
  const { data, h, id } = setup({ created: MON(-9) }); // Oct 3
  mark(data, id, [MON(-9), MON(-8), MON(-7), MON(-3), MON(-2), MON(-1)]);
  assert.equal(C.rate(data, h, TODAY, 30, 'mon'), 6 / 9);
  mark(data, id, [TODAY]);
  assert.equal(C.rate(data, h, TODAY, 30, 'mon'), 7 / 10);
  const fresh = setup({ created: TODAY });
  assert.equal(C.rate(fresh.data, fresh.h, TODAY, 30, 'mon'), null);
});

test('count habits are done at the target and clamp their values', () => {
  const { data, h, id } = setup({ kind: 'count', target: 8, unit: 'glasses' });
  C.setValue(data, id, TODAY, 7);
  assert.ok(!C.isDone(data, h, TODAY));
  C.setValue(data, id, TODAY, 8);
  assert.ok(C.isDone(data, h, TODAY));
  C.setValue(data, id, TODAY, 999999);
  assert.equal(C.value(data, id, TODAY), C.MAX_VALUE);
  C.setValue(data, id, TODAY, -4);
  assert.equal(C.value(data, id, TODAY), 0);
  const chk = setup({});
  C.setValue(chk.data, chk.id, TODAY, 5);
  assert.equal(C.value(chk.data, chk.id, TODAY), 1);
});

test('logging before the creation date moves the creation date back', () => {
  const { data, h, id } = setup({ created: TODAY });
  C.setValue(data, id, MON(-3), 1);
  assert.equal(h.created, MON(-3));
});

test('habitsFor splits scheduled and unscheduled habits and still shows new habits on past days for backfilling', () => {
  const data = C.defaultData();
  const a = C.addHabit(data, { name: 'Daily' }, MON(-30));
  const b = C.addHabit(data, { name: 'Tue only', schedule: { type: 'days', days: [1] } }, MON(-30));
  const c = C.addHabit(data, { name: 'New' }, TODAY);
  const mon = C.habitsFor(data, TODAY);
  assert.deepEqual(mon.main.map((h) => h.name), ['Daily', 'New']);
  assert.deepEqual(mon.off.map((h) => h.name), ['Tue only']);
  assert.deepEqual(C.habitsFor(data, MON(-5)).main.map((h) => h.name), ['Daily', 'New']); // backfill is possible
  assert.ok(!C.dueOn(data.habits[2], MON(-5)), 'but it was not due before it existed');
  assert.deepEqual(C.habitsFor(data, MON(1)).main.map((h) => h.name), ['Daily', 'Tue only', 'New']);
  assert.ok(a && b && c);
});

test('dayFraction and openToday', () => {
  const data = C.defaultData();
  const a = C.addHabit(data, { name: 'A' }, MON(-5));
  const b = C.addHabit(data, { name: 'B' }, MON(-5));
  const w = C.addHabit(data, { name: 'W', schedule: { type: 'weekly', perWeek: 1 } }, MON(-5));
  assert.equal(C.dayFraction(data, TODAY), 0);
  C.setValue(data, a, TODAY, 1);
  assert.equal(C.dayFraction(data, TODAY), 0.5);
  assert.deepEqual(C.openToday(data, TODAY, 'mon'), ['B', 'W']);
  C.setValue(data, w, MON(-3), 1); // weekly goal met earlier this week? no: that was last week
  assert.deepEqual(C.openToday(data, TODAY, 'mon'), ['B', 'W']);
  C.setValue(data, w, TODAY, 1);
  assert.deepEqual(C.openToday(data, TODAY, 'mon'), ['B']);
  assert.equal(C.dayFraction(data, MON(-8)), null);
  assert.ok(b);
});

test('weekday breakdown counts expected and completed days per weekday', () => {
  const { data, h, id } = setup({ created: MON(-14) }); // starts on Mon Sep 28: two full weeks, then today
  mark(data, id, [MON(-14), MON(-7)]);                  // both Mondays
  const r = C.weekdayBreakdown(data, h, TODAY, 90);
  assert.equal(r.done[0], 2);
  assert.equal(r.due[0], 2); // today's Monday is open and excluded
  assert.equal(r.due[3], 2);
});

test('moving a habit swaps it with its neighbour', () => {
  const data = C.defaultData();
  const a = C.addHabit(data, { name: 'A' }, TODAY);
  const b = C.addHabit(data, { name: 'B' }, TODAY);
  const c = C.addHabit(data, { name: 'C' }, TODAY);
  assert.ok(C.moveHabit(data, c, -1));
  assert.deepEqual(C.activeHabits(data).map((h) => h.name), ['A', 'C', 'B']);
  assert.ok(!C.moveHabit(data, a, -1));
  assert.ok(b);
});

test('updating a habit keeps its history and identity', () => {
  const { data, id } = setup({ name: 'Read' });
  C.setValue(data, id, TODAY, 1);
  assert.ok(C.updateHabit(data, id, { name: '  Read more  ', kind: 'count', target: 20, unit: 'pages' }));
  const h = data.habits[0];
  assert.equal(h.name, 'Read more');
  assert.equal(h.target, 20);
  assert.equal(h.id, id);
  assert.equal(C.value(data, id, TODAY), 1);
  assert.ok(!C.updateHabit(data, id, { name: '   ' }));
  assert.ok(!C.updateHabit(data, 'missing', { name: 'x' }));
});

test('migrate turns junk into safe defaults and cleans real data', () => {
  assert.deepEqual(C.migrate(null), C.defaultData());
  assert.deepEqual(C.migrate('nope'), C.defaultData());
  const m = C.migrate({
    habits: [
      { id: 'a1', name: '  Walk  ', kind: 'count', target: 99999999, unit: 'x'.repeat(40), created: 'bad', schedule: { type: 'days', days: [1, 1, 9, 'x', 3] } },
      { id: 'bad id!', name: 'Nope' },
      { id: 'a1', name: 'Duplicate' },
      { id: 'b2', name: '   ' },
      { id: 'c3', name: 'Weekly', schedule: { type: 'weekly', perWeek: 50 } }
    ],
    log: { a1: { '2026-10-10': 3, '2026-02-30': 1, '2026-10-11': 'x', '2026-10-09': 0 }, ghost: { '2026-10-10': 1 } },
    notes: { '2026-10-10': 'hello', 'bad': 'x', '2026-10-09': 42 },
    settings: { theme: 'neon', weekStart: 'sun', reminder: { enabled: 1, time: '25:99' }, tray: 1 }
  }, TODAY);
  assert.equal(m.habits.length, 2);
  const a = m.habits[0];
  assert.equal(a.name, 'Walk');
  assert.equal(a.target, C.MAX_VALUE);
  assert.equal(a.unit.length, 12);
  assert.deepEqual(a.schedule, { type: 'days', days: [1, 3], perWeek: 3 });
  assert.equal(a.created, '2026-10-10'); // pulled back to the first logged day
  assert.deepEqual(m.log.a1, { '2026-10-10': 3 });
  assert.equal(m.log.ghost, undefined);
  assert.deepEqual(m.habits[1].schedule.type, 'daily'); // perWeek 50 is invalid
  assert.deepEqual(m.notes, { '2026-10-10': 'hello' });
  assert.deepEqual(m.settings, { theme: 'system', weekStart: 'sun', reminder: { enabled: true, time: '20:00' }, tray: true });
});

test('migrate imports an export from the Daily Chain web app', () => {
  const m = C.migrate({
    app: 'daily-chain',
    doc: {
      habits: { h1: { n: 'Read', o: 1, t: 1, d: 0 }, h2: { n: 'Gone', o: 2, t: 2, d: 1 } },
      days: { h1: { '2026-10-10': [1, 5], '2026-10-11': [0, 6], '2026-10-12': [1, 7] } }
    }
  }, TODAY);
  assert.equal(m.habits.length, 1);
  assert.equal(m.habits[0].created, '2026-10-10');
  assert.deepEqual(m.log.h1, { '2026-10-10': 1, '2026-10-12': 1 });
});

test('csv export escapes quotes and blocks spreadsheet formulas', () => {
  const data = C.defaultData();
  const a = C.addHabit(data, { name: '=SUM(A1)' }, MON(-2));
  const b = C.addHabit(data, { name: 'Read, "slowly"', kind: 'count', target: 2 }, MON(-2));
  C.setValue(data, a, MON(-1), 1);
  C.setValue(data, b, MON(-2), 3);
  const lines = C.toCsv(data).trim().split('\n');
  assert.equal(lines[0], 'date,habit,value,target,completed');
  assert.equal(lines[1], '2026-10-10,"Read, ""slowly""",3,2,yes');
  assert.equal(lines[2], "2026-10-11,'=SUM(A1),1,1,yes");
});
