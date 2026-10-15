(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./src/core.js'));
  else root.DCReminders = factory(root.DCCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
'use strict';

const WINDOW_MINUTES = 180; // a reminder is skipped if the app starts more than this long after the set time

function pad(n) { return (n < 10 ? '0' : '') + n; }

/**
 * Decides whether to remind now. `state.last` is the day a reminder was last handled.
 * Returns the names of the open habits, or null. Marks the day handled either way,
 * so it fires at most once per day.
 */
function check(data, now, state) {
  const r = data && data.settings && data.settings.reminder;
  if (!r || !r.enabled) return null;
  const today = C.todayKey(now);
  if (state.last === today) return null;
  const [h, m] = r.time.split(':').map(Number);
  const minutesSince = now.getHours() * 60 + now.getMinutes() - (h * 60 + m);
  if (minutesSince < 0) return null; // not time yet
  state.last = today;
  if (minutesSince > WINDOW_MINUTES) return null; // too late to be useful
  const open = C.openToday(data, today, data.settings.weekStart);
  return open.length ? open : null;
}

function message(names) {
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? ' and ' + (names.length - 3) + ' more' : '';
  return (names.length === 1 ? '1 habit is' : names.length + ' habits are') + ' still open today: ' + shown + more + '.';
}

return { check, message, WINDOW_MINUTES, pad };
});
