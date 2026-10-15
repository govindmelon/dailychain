/*
 * Phone reminders. A phone cannot run code at 20:00 just to check what is still open, so the
 * app schedules the next two weeks of notifications ahead of time and replans whenever the
 * data changes or the app opens. Today's notice is exact (skipped when everything is done);
 * later days list what is due on that day, assuming nothing is done yet.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../src/core.js'), require('../../reminders.js'));
  else root.DCPlan = factory(root.DCCore, root.DCReminders);
})(typeof self !== 'undefined' ? self : this, function (C, R) {
  'use strict';

  var DAYS = 14;
  var BASE_ID = 1000; // notification ids BASE_ID .. BASE_ID + DAYS - 1 belong to reminders

  /** Returns [{ id, at: Date, body }] for the days ahead. Empty when reminders are off. */
  function plan(data, now) {
    var r = data && data.settings && data.settings.reminder;
    if (!r || !r.enabled || !C.TIME_RE.test(r.time)) return [];
    var hm = r.time.split(':').map(Number);
    var ws = data.settings.weekStart;
    var out = [];
    var key = C.todayKey(now);
    for (var i = 0; i < DAYS; i++) {
      var day = C.addDays(key, i);
      var p = day.split('-').map(Number);
      var at = new Date(p[0], p[1] - 1, p[2], hm[0], hm[1], 0, 0); // local time on that day
      if (at.getTime() <= now.getTime()) continue; // already past today
      var names = C.openToday(data, day, ws);
      if (!names.length) continue;
      out.push({ id: BASE_ID + i, at: at, body: R.message(names) });
    }
    return out;
  }

  /** A string that changes only when the plan does, so the app can skip rescheduling. */
  function signature(items) {
    return items.map(function (n) { return n.id + '@' + n.at.getTime() + ':' + n.body; }).join('|');
  }

  var ids = [];
  for (var i = 0; i < DAYS; i++) ids.push(BASE_ID + i);

  return { plan: plan, signature: signature, ids: ids, DAYS: DAYS, BASE_ID: BASE_ID };
});
