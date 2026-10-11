/*
 * Daily Chain core: pure data rules, no DOM and no Electron. Shared by the
 * interface, the main process (reminders) and the tests.
 *
 * Dates are local calendar days as 'YYYY-MM-DD' strings. All day maths goes
 * through UTC day numbers, so daylight-saving changes cannot skip or repeat a day.
 *
 * data = {
 *   version: 2,
 *   habits: [{ id, name, kind: 'check'|'count', target, unit, created, archived, order,
 *              schedule: { type: 'daily'|'days'|'weekly', days: [0..6 Mon=0], perWeek } }],
 *   log:    { [habitId]: { 'YYYY-MM-DD': number } },
 *   notes:  { 'YYYY-MM-DD': string },
 *   settings: { theme, weekStart, reminder: { enabled, time }, tray }
 * }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DCCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  var MAX_VALUE = 9999;
  var LIMITS = { habits: 200, name: 60, unit: 12, note: 500 };

  /* ---------- dates ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toDays(key) {
    var p = key.split('-');
    return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }
  function fromDays(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function addDays(key, n) { return fromDays(toDays(key) + n); }
  function diffDays(a, b) { return toDays(a) - toDays(b); }
  function isKey(s) {
    if (typeof s !== 'string' || !KEY_RE.test(s)) return false;
    return fromDays(toDays(s)) === s;
  }
  function todayKey(now) {
    var d = now || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  /** Monday = 0 ... Sunday = 6 */
  function dowMon(key) { return (new Date(toDays(key) * 86400000).getUTCDay() + 6) % 7; }
  function startOfWeek(key, weekStart) {
    var off = weekStart === 'sun' ? (dowMon(key) + 1) % 7 : dowMon(key);
    return addDays(key, -off);
  }

  /* ---------- reading ---------- */
  function defaultSettings() {
    return { theme: 'system', weekStart: 'mon', reminder: { enabled: false, time: '20:00' }, tray: false };
  }
  function defaultData() {
    return { version: 2, habits: [], log: {}, notes: {}, settings: defaultSettings() };
  }

  function value(data, id, key) {
    var m = data.log[id];
    return (m && m[key]) || 0;
  }
  function isDone(data, h, key) { return value(data, h.id, key) >= h.target; }
  function activeHabits(data) {
    return data.habits.filter(function (h) { return !h.archived; }).sort(byOrder);
  }
  function byOrder(a, b) { return a.order - b.order || (a.id < b.id ? -1 : 1); }

  /** Is the habit expected on this day? (Weekly habits are open every day.) */
  function dueOn(h, key) {
    if (key < h.created) return false;
    if (h.schedule.type === 'days') return h.schedule.days.indexOf(dowMon(key)) !== -1;
    return true;
  }

  /**
   * Habits to show for a day, split into scheduled and not scheduled. Every active habit
   * is shown on past days too, so a check-in can be backfilled; logging before the creation
   * date moves it back (see setValue).
   */
  function habitsFor(data, key) {
    var main = [], off = [];
    activeHabits(data).forEach(function (h) {
      if (h.schedule.type === 'days' && h.schedule.days.indexOf(dowMon(key)) === -1) off.push(h);
      else main.push(h);
    });
    return { main: main, off: off };
  }

  function weekDone(data, h, weekStartKey) {
    var n = 0;
    for (var i = 0; i < 7; i++) if (isDone(data, h, addDays(weekStartKey, i))) n++;
    return n;
  }
  function weekProgress(data, h, key, ws) {
    return { done: weekDone(data, h, startOfWeek(key, ws)), goal: h.schedule.perWeek };
  }

  function weekStreak(data, h, today, ws) {
    var n = 0, current = startOfWeek(today, ws), wk = current;
    for (var i = 0; i < 700; i++) {
      if (addDays(wk, 6) < h.created) break;
      if (weekDone(data, h, wk) >= h.schedule.perWeek) n++;
      else if (wk !== current) break; // the week in progress never breaks a streak
      wk = addDays(wk, -7);
    }
    return n;
  }

  /** Current streak. Unit is days, or weeks for "N per week" habits. */
  function streak(data, h, today, ws) {
    if (h.schedule.type === 'weekly') return { n: weekStreak(data, h, today, ws), unit: 'w' };
    var n = 0, k = today;
    for (var i = 0; i < 4000; i++) {
      if (k < h.created) break;
      if (dueOn(h, k)) {
        if (isDone(data, h, k)) n++;
        else if (k !== today) break; // today is not over yet
      }
      k = addDays(k, -1);
    }
    return { n: n, unit: 'd' };
  }

  function bestStreak(data, h, today, ws) {
    var best = 0, run = 0, i;
    if (h.schedule.type === 'weekly') {
      var current = startOfWeek(today, ws);
      for (var wk = startOfWeek(h.created, ws); wk <= current; wk = addDays(wk, 7)) {
        if (weekDone(data, h, wk) >= h.schedule.perWeek) { run++; if (run > best) best = run; }
        else if (wk !== current) run = 0;
      }
      return { n: best, unit: 'w' };
    }
    var span = diffDays(today, h.created);
    for (i = 0; i <= span; i++) {
      var k = addDays(h.created, i);
      if (!dueOn(h, k)) continue;
      if (isDone(data, h, k)) { run++; if (run > best) best = run; }
      else if (k !== today) run = 0;
    }
    return { n: best, unit: 'd' };
  }

  /** Share of expected days (or weeks) completed in the last windowDays days, or null when there were none. */
  function rate(data, h, today, windowDays, ws) {
    var from = addDays(today, -(windowDays - 1));
    if (from < h.created) from = h.created;
    var due = 0, done = 0, k;
    if (h.schedule.type === 'weekly') {
      var current = startOfWeek(today, ws), goal = h.schedule.perWeek;
      for (var wk = startOfWeek(from, ws); wk <= current; wk = addDays(wk, 7)) {
        var got = Math.min(weekDone(data, h, wk), goal);
        if (wk === current && got < goal) continue; // unfinished week in progress
        due += goal; done += got;
      }
      return due ? done / due : null;
    }
    for (k = from; k <= today; k = addDays(k, 1)) {
      if (!dueOn(h, k)) continue;
      var d = isDone(data, h, k);
      if (k === today && !d) continue;
      due++; if (d) done++;
    }
    return due ? done / due : null;
  }

  function totalDone(data, h) {
    var m = data.log[h.id] || {}, n = 0;
    Object.keys(m).forEach(function (k) { if (m[k] >= h.target) n++; });
    return n;
  }

  /** Per weekday (Monday first) over the last windowDays days: { due: [7], done: [7] }. */
  function weekdayBreakdown(data, h, today, windowDays) {
    var due = [0, 0, 0, 0, 0, 0, 0], done = [0, 0, 0, 0, 0, 0, 0];
    var from = addDays(today, -(windowDays - 1));
    if (from < h.created) from = h.created;
    for (var k = from; k <= today; k = addDays(k, 1)) {
      if (!dueOn(h, k)) continue;
      var d = isDone(data, h, k);
      if (k === today && !d) continue;
      var w = dowMon(k);
      due[w]++; if (d) done[w]++;
    }
    return { due: due, done: done };
  }

  /** Fraction of habits done on a day, or null when nothing was expected. Weekly habits only count when done. */
  function dayFraction(data, key) {
    var listed = 0, done = 0;
    activeHabits(data).forEach(function (h) {
      if (key < h.created) return;
      var d = isDone(data, h, key);
      if (h.schedule.type === 'weekly') { if (d) { listed++; done++; } return; }
      if (!dueOn(h, key)) return;
      listed++; if (d) done++;
    });
    return listed ? done / listed : null;
  }

  /** Names of habits still open today (used by reminders). */
  function openToday(data, key, ws) {
    var out = [];
    habitsFor(data, key).main.forEach(function (h) {
      if (isDone(data, h, key)) return;
      if (h.schedule.type === 'weekly' && weekDone(data, h, startOfWeek(key, ws)) >= h.schedule.perWeek) return;
      out.push(h.name);
    });
    return out;
  }

  /* ---------- writing ---------- */
  function newId() { return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function cleanSchedule(s) {
    var out = { type: 'daily', days: [0, 1, 2, 3, 4, 5, 6], perWeek: 3 };
    if (!s || typeof s !== 'object') return out;
    if (s.type === 'days') {
      var days = Array.isArray(s.days) ? s.days.filter(function (d, i, a) { return Number.isInteger(d) && d >= 0 && d <= 6 && a.indexOf(d) === i; }).sort() : [];
      if (days.length && days.length < 7) { out.type = 'days'; out.days = days; }
    } else if (s.type === 'weekly') {
      var n = Math.round(Number(s.perWeek));
      if (n >= 1 && n <= 6) { out.type = 'weekly'; out.perWeek = n; }
    }
    return out;
  }
  function cleanHabit(h, fallbackOrder, today) {
    if (!h || typeof h !== 'object' || typeof h.name !== 'string') return null;
    var name = h.name.trim().slice(0, LIMITS.name);
    if (!name || typeof h.id !== 'string' || !ID_RE.test(h.id)) return null;
    var kind = h.kind === 'count' ? 'count' : 'check';
    var target = kind === 'count' ? Math.min(MAX_VALUE, Math.max(1, Math.round(Number(h.target) || 1))) : 1;
    return {
      id: h.id,
      name: name,
      kind: kind,
      target: target,
      unit: kind === 'count' && typeof h.unit === 'string' ? h.unit.trim().slice(0, LIMITS.unit) : '',
      created: isKey(h.created) ? h.created : today,
      archived: !!h.archived,
      order: typeof h.order === 'number' && isFinite(h.order) ? h.order : fallbackOrder,
      schedule: cleanSchedule(h.schedule)
    };
  }

  function addHabit(data, spec, today) {
    var habit = cleanHabit({
      id: newId(), name: spec.name, kind: spec.kind, target: spec.target, unit: spec.unit,
      schedule: spec.schedule, created: today, archived: false,
      order: data.habits.reduce(function (m, h) { return Math.max(m, h.order); }, 0) + 1
    }, 1, today);
    if (!habit || data.habits.length >= LIMITS.habits) return null;
    data.habits.push(habit);
    return habit.id;
  }
  function updateHabit(data, id, spec) {
    var i = data.habits.findIndex(function (h) { return h.id === id; });
    if (i < 0) return false;
    var old = data.habits[i];
    var next = cleanHabit(Object.assign({}, old, spec, { id: old.id, created: old.created, archived: old.archived, order: old.order }), old.order, old.created);
    if (!next) return false;
    data.habits[i] = next;
    return true;
  }
  function removeHabit(data, id) {
    data.habits = data.habits.filter(function (h) { return h.id !== id; });
    delete data.log[id];
  }
  function moveHabit(data, id, dir) {
    var list = activeHabits(data);
    var i = list.findIndex(function (h) { return h.id === id; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return false;
    list.forEach(function (h, n) { h.order = n + 1; }); // renumber first so orders are unique
    var t = list[i].order; list[i].order = list[j].order; list[j].order = t;
    return true;
  }

  /** Sets a day's value (0 clears it). Logging before the creation date moves the creation date back. */
  function setValue(data, id, key, v) {
    var h = data.habits.find(function (x) { return x.id === id; });
    if (!h || !isKey(key)) return false;
    v = Math.max(0, Math.min(h.kind === 'check' ? 1 : MAX_VALUE, Math.round(Number(v) || 0)));
    var m = data.log[id] || (data.log[id] = {});
    if (v) { m[key] = v; if (key < h.created) h.created = key; } else delete m[key];
    return true;
  }
  function setNote(data, key, text) {
    if (!isKey(key)) return;
    var t = String(text || '').slice(0, LIMITS.note);
    if (t.trim()) data.notes[key] = t; else delete data.notes[key];
  }

  /* ---------- loading untrusted data ---------- */
  function convertWebExport(raw, today) {
    var doc = raw.doc, out = defaultData(), order = 0;
    Object.keys(doc.habits || {}).forEach(function (id) {
      var h = doc.habits[id];
      if (!h || h.d || typeof h.n !== 'string') return;
      var days = (doc.days && doc.days[id]) || {};
      var keys = Object.keys(days).filter(function (k) { return isKey(k) && Array.isArray(days[k]) && days[k][0]; }).sort();
      var habit = cleanHabit({ id: id, name: h.n, order: ++order, created: keys[0] || today }, order, today);
      if (!habit) return;
      out.habits.push(habit);
      out.log[id] = {};
      keys.forEach(function (k) { out.log[id][k] = 1; });
    });
    return out;
  }

  /** Turns anything parsed from disk or an import file into valid data. Never throws. */
  function migrate(raw, today) {
    today = today || todayKey();
    if (!raw || typeof raw !== 'object') return defaultData();
    if (raw.doc && typeof raw.doc === 'object' && raw.doc.habits && !Array.isArray(raw.doc.habits)) return convertWebExport(raw, today);
    var out = defaultData();
    var seen = {};
    (Array.isArray(raw.habits) ? raw.habits : []).forEach(function (h, i) {
      if (out.habits.length >= LIMITS.habits) return;
      var c = cleanHabit(h, i + 1, today);
      if (c && !seen[c.id]) { seen[c.id] = 1; out.habits.push(c); }
    });
    var log = raw.log && typeof raw.log === 'object' ? raw.log : {};
    out.habits.forEach(function (h) {
      var m = log[h.id];
      if (!m || typeof m !== 'object') return;
      var clean = {};
      Object.keys(m).forEach(function (k) {
        var v = Math.round(Number(m[k]));
        if (isKey(k) && v >= 1) clean[k] = Math.min(v, h.kind === 'check' ? 1 : MAX_VALUE);
      });
      if (Object.keys(clean).length) {
        out.log[h.id] = clean;
        var first = Object.keys(clean).sort()[0];
        if (first < h.created) h.created = first;
      }
    });
    var notes = raw.notes && typeof raw.notes === 'object' ? raw.notes : {};
    Object.keys(notes).forEach(function (k) {
      if (isKey(k) && typeof notes[k] === 'string' && notes[k].trim()) out.notes[k] = notes[k].slice(0, LIMITS.note);
    });
    var s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    if (['system', 'light', 'dark'].indexOf(s.theme) !== -1) out.settings.theme = s.theme;
    if (s.weekStart === 'sun') out.settings.weekStart = 'sun';
    if (s.reminder && typeof s.reminder === 'object') {
      out.settings.reminder.enabled = !!s.reminder.enabled;
      if (TIME_RE.test(s.reminder.time)) out.settings.reminder.time = s.reminder.time;
    }
    out.settings.tray = !!s.tray;
    return out;
  }

  /* ---------- export ---------- */
  function csvCell(v) {
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheets treating text as a formula
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(data) {
    var body = [];
    data.habits.slice().sort(byOrder).forEach(function (h) {
      var m = data.log[h.id] || {};
      Object.keys(m).forEach(function (k) { body.push([k, h.name, m[k], h.target, m[k] >= h.target ? 'yes' : 'no']); });
    });
    body.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }); // by date; habits keep their order within a day
    var rows = [['date', 'habit', 'value', 'target', 'completed']].concat(body);
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n') + '\n';
  }

  return {
    LIMITS: LIMITS, MAX_VALUE: MAX_VALUE, TIME_RE: TIME_RE,
    addDays: addDays, diffDays: diffDays, isKey: isKey, todayKey: todayKey, dowMon: dowMon, startOfWeek: startOfWeek,
    defaultData: defaultData, defaultSettings: defaultSettings, migrate: migrate,
    value: value, isDone: isDone, activeHabits: activeHabits, dueOn: dueOn, habitsFor: habitsFor,
    weekProgress: weekProgress, streak: streak, bestStreak: bestStreak, rate: rate, totalDone: totalDone,
    weekdayBreakdown: weekdayBreakdown, dayFraction: dayFraction, openToday: openToday,
    addHabit: addHabit, updateHabit: updateHabit, removeHabit: removeHabit, moveHabit: moveHabit,
    setValue: setValue, setNote: setNote, toCsv: toCsv
  };
});
