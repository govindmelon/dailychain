(function () {
  'use strict';

  var C = window.DCCore;
  var Store = window.DCStore;
  var DOWN = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var MONN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  var data = C.defaultData();
  var loaded = false;
  var view = 'today';
  var day = C.todayKey();
  var followToday = true;
  var sel = 'all';
  var showOff = false;
  var notice = '';
  var msg = '';
  var info = { version: '', path: null };
  var pendingImport = null;
  var syncInfo = { configured: false };   // what the main process says about the GitHub connection (never the token)
  var syncState = '';                     // '', 'syncing', 'ok', 'offline', 'error'
  var syncError = '';
  var syncBusy = false, syncAgain = false, syncTimer = null, lastSyncTry = 0;
  var connectForm = { repo: '', token: '' };
  var syncMsg = '';
  var connecting = false;
  var confirmDisconnect = false;
  var pendingFocus = null;
  var saveTimer = null;
  var saveBlocked = false; // set when the saved data could not be loaded, so we never overwrite it with an empty state

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      e.append(c);
    }
    return e;
  }

  /* ---------- saving ---------- */
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
  }
  /** Something the person did: save it, and sync a few seconds later if sync is on. */
  function changed() {
    save();
    scheduleSync(3000);
  }
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!loaded || saveBlocked) return Promise.resolve();
    return Promise.resolve(Store.save(data)).then(function (r) {
      if (r && r.ok === false) { msg = r.error || 'Could not save your changes.'; if (view === 'settings') render(); }
    }).catch(function () { msg = 'Could not save your changes.'; });
  }
  window.addEventListener('beforeunload', function () { if (loaded && !saveBlocked && saveTimer && Store.saveSync) Store.saveSync(data); });

  /* ---------- sync ---------- */
  function syncReady() { return loaded && !saveBlocked && syncInfo.configured && !syncInfo.needsToken && !!Store.syncRun; }

  function scheduleSync(ms) {
    if (!syncReady()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, ms);
  }

  function paintSync() {
    var b = $('sync-state');
    if (!b) return;
    var text = '', warn = false;
    if (syncInfo.configured) {
      if (syncInfo.needsToken || syncState === 'error') { text = 'sync problem'; warn = true; }
      else if (syncState === 'offline') { text = 'offline'; warn = true; }
      else if (syncState === 'syncing') text = 'syncing\u2026';
      else if (syncState === 'ok') text = 'synced';
    }
    b.textContent = text;
    b.hidden = !text;
    b.className = 'sync' + (warn ? ' warn' : '');
  }

  function runSync() {
    clearTimeout(syncTimer);
    if (!syncReady()) return Promise.resolve();
    if (syncBusy) { syncAgain = true; return Promise.resolve(); }
    syncBusy = true;
    syncState = 'syncing';
    syncError = '';
    lastSyncTry = Date.now();
    paintSync();
    return flush().then(function () { return Store.syncRun(data); }).then(function (r) {
      if (r && r.ok) {
        var incoming = C.migrate(r.data);
        var merged = C.merge(data, incoming); // also keeps anything edited while the sync was running
        var gotNew = C.canonical(merged) !== C.canonical(data);
        var localOnly = C.canonical(merged) !== C.canonical(incoming);
        data = merged;
        syncInfo = r.status || syncInfo;
        syncState = 'ok';
        if (gotNew) { save(); render(); } else if (view === 'settings') render();
        if (localOnly) syncAgain = true;
      } else {
        syncState = r && r.kind === 'offline' ? 'offline' : 'error';
        syncError = (r && r.error) || 'Syncing failed.';
        if (r && r.kind === 'auth') syncInfo.needsToken = true;
        if (view === 'settings') render();
      }
    }).catch(function () {
      syncState = 'error';
      syncError = 'Syncing failed.';
    }).then(function () {
      syncBusy = false;
      paintSync();
      if (syncAgain) { syncAgain = false; scheduleSync(500); }
      else if (syncState === 'offline' || syncState === 'error') scheduleSync(60000); // try again in a minute
    });
  }

  function lastSyncText() {
    if (!syncInfo.lastSync) return 'not yet';
    var mins = Math.floor((Date.now() - syncInfo.lastSync) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    if (mins < 1440) return Math.floor(mins / 60) + ' h ago';
    return Math.floor(mins / 1440) + ' d ago';
  }

  function connect() {
    if (connecting) return;
    connecting = true;
    syncMsg = '';
    render();
    Store.syncConnect(connectForm.repo, connectForm.token).then(function (r) {
      connecting = false;
      if (r && r.ok) {
        connectForm = { repo: '', token: '' };
        syncInfo = r.status;
        syncState = '';
        syncError = '';
        syncMsg = '';
        render();
        runSync();
      } else {
        syncMsg = (r && r.error) || 'Could not connect.';
        pendingFocus = 'sync-connect';
        render();
      }
    }).catch(function () {
      connecting = false;
      syncMsg = 'Could not connect.';
      render();
    });
  }

  function disconnect() {
    Store.syncDisconnect().then(function (status) {
      syncInfo = status || { configured: false };
      syncState = '';
      syncError = '';
      confirmDisconnect = false;
      clearTimeout(syncTimer);
      paintSync();
      render();
    });
  }

  function syncSection() {
    var sec = el('section', { class: 'section' }, el('h2', { class: 'label', text: 'sync' }));
    if (!syncInfo.configured) {
      var repoIn = el('input', { type: 'text', id: 'sync-repo', 'data-f': 'sync-repo', placeholder: 'owner/repository', 'aria-label': 'github repository', autocomplete: 'off', spellcheck: 'false' });
      repoIn.value = connectForm.repo;
      var tokIn = el('input', { type: 'password', id: 'sync-token', 'data-f': 'sync-token', placeholder: 'fine-grained token', 'aria-label': 'github token', autocomplete: 'off', spellcheck: 'false' });
      tokIn.value = connectForm.token;
      repoIn.addEventListener('input', function () { connectForm.repo = repoIn.value; });
      tokIn.addEventListener('input', function () { connectForm.token = tokIn.value; });
      [repoIn, tokIn].forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); connect(); } }); });
      sec.append(
        el('p', { class: 'hint', text: 'keep your habits in step across computers with a private github repository. it holds one small json file. your token stays on this computer.' }),
        setting('repository', repoIn),
        setting('token', tokIn),
        el('div', { class: 'rowset' },
          el('span', { class: 'muted', role: 'alert', text: syncMsg }),
          el('button', { type: 'button', class: 'link', 'data-f': 'sync-connect', disabled: connecting, text: connecting ? 'connecting\u2026' : 'connect', onclick: connect })),
        el('ol', { class: 'steps' },
          el('li', { text: 'create a private repository on github' }),
          el('li', { text: 'github.com/settings/personal-access-tokens/new: choose only that repository, permission contents: read and write' }),
          el('li', { text: 'paste the repository name and the token above' })));
      return sec;
    }
    sec.append(
      setting('repository', el('span', { class: 'muted', text: syncInfo.repo })),
      setting('last synced', el('span', { class: 'muted', text: lastSyncText() })));
    if (syncInfo.needsToken) sec.append(el('p', { class: 'msg', role: 'alert', text: syncError || 'The saved token can no longer be used. Disconnect, then connect again with a new token.' }));
    else if (syncError) sec.append(el('p', { class: 'msg', role: 'alert', text: syncError }));
    if (syncInfo.secure === false) sec.append(el('p', { class: 'hint', text: 'no system keyring was found, so the token is stored in a file that only your user can read.' }));
    var row = el('div', { class: 'rowset links wrap' });
    if (!syncInfo.needsToken) row.append(el('button', { type: 'button', class: 'link', 'data-f': 'sync-now', disabled: syncBusy, text: syncBusy ? 'syncing\u2026' : 'sync now', onclick: function () { runSync(); } }));
    if (confirmDisconnect) {
      row.append(el('span', { text: 'stop syncing? your habits stay here and in the repository.' }),
        el('button', { type: 'button', class: 'link danger', 'data-f': 'disconnect-yes', text: 'disconnect', onclick: disconnect }),
        el('button', { type: 'button', class: 'link', 'data-f': 'disconnect-no', text: 'cancel', onclick: function () { confirmDisconnect = false; pendingFocus = 'disconnect'; render(); } }));
    } else {
      row.append(el('button', { type: 'button', class: 'link', 'data-f': 'disconnect', text: 'disconnect', onclick: function () { confirmDisconnect = true; pendingFocus = 'disconnect-no'; render(); } }));
    }
    sec.append(row);
    return sec;
  }

  /* ---------- formatting ---------- */
  function fmtDay(key, today) {
    var s = DOWN[C.dowMon(key)] + ' ' + (+key.slice(8)) + ' ' + MONN[+key.slice(5, 7) - 1];
    if (key.slice(0, 4) !== today.slice(0, 4)) s += ' ' + key.slice(0, 4);
    if (key === today) s += ' · today';
    else if (key === C.addDays(today, -1)) s += ' · yesterday';
    return s;
  }
  function fmtShort(key, today) {
    var s = (+key.slice(8)) + ' ' + MONN[+key.slice(5, 7) - 1];
    return key.slice(0, 4) !== today.slice(0, 4) ? s + ' ' + key.slice(0, 4) : s;
  }
  function pct(r) { return r === null ? '–' : Math.round(r * 100) + '%'; }
  function streakText(s) { return s.n ? s.n + s.unit : ''; }

  /* ---------- actions ---------- */
  function setVal(id, v) { C.setValue(data, id, day, v); changed(); render(); }
  function go(delta) {
    var today = C.todayKey();
    var next = C.addDays(day, delta);
    if (next > today) return;
    day = next;
    followToday = day === today;
    render();
  }
  function jumpToday() { day = C.todayKey(); followToday = true; render(); }
  function setView(v) { view = v; render(); }
  function setMsg(text) { msg = text; render(); }

  /* ---------- rendering ---------- */
  function applyTheme() {
    var t = data.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  function render() {
    var active = document.activeElement;
    var key = pendingFocus || (active && active.getAttribute ? active.getAttribute('data-f') : null);
    pendingFocus = null;
    applyTheme();
    var today = C.todayKey();
    if (followToday || day > today) { day = today; followToday = true; }
    Array.prototype.forEach.call(document.querySelectorAll('#nav button'), function (b) {
      if (b.getAttribute('data-view') === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    var root = $('view');
    root.textContent = '';
    if (!loaded) return;
    if (view === 'today') viewToday(root, today);
    else if (view === 'stats') viewStats(root, today);
    else viewSettings(root);
    renderHints();
    if (key) {
      var target = document.querySelector('[data-f="' + key + '"]');
      if (target) target.focus();
    }
  }

  function renderHints() {
    var h = $('hints');
    h.textContent = '';
    var items = view === 'today'
      ? [['← →', 'day'], ['space', 'check'], ['e', 'edit'], ['n', 'new'], ['?', 'help']]
      : [['1 2 3', 'views'], ['?', 'help']];
    items.forEach(function (p) { h.append(el('span', null, el('kbd', { text: p[0] }), ' ' + p[1])); });
  }

  /* ----- today ----- */
  function viewToday(root, today) {
    var ws = data.settings.weekStart;
    var hf = C.habitsFor(data, day);

    if (notice) {
      root.append(el('p', { class: 'msg' }, notice + ' ', el('button', { type: 'button', class: 'link', text: 'dismiss', onclick: function () { notice = ''; render(); } })));
    }

    root.append(el('div', { class: 'daynav' },
      el('button', { type: 'button', 'aria-label': 'previous day', 'data-f': 'prev', onclick: function () { go(-1); }, text: '‹' }),
      el('span', { class: 'date', text: fmtDay(day, today) }),
      el('button', { type: 'button', 'aria-label': 'next day', 'data-f': 'next', disabled: day >= today, onclick: function () { go(1); }, text: '›' }),
      day !== today ? el('button', { type: 'button', class: 'today-btn', 'data-f': 'today', onclick: jumpToday, text: 'back to today' }) : null));

    var done = hf.main.filter(function (h) { return C.isDone(data, h, day); }).length;
    var total = hf.main.length;
    var bar = el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i'));
    bar.firstChild.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    root.append(el('div', { class: 'progress' },
      el('div', { class: 'row' }, el('span', { text: total ? done + '/' + total + ' done' : 'nothing scheduled' }), el('span', { class: 'muted', text: total ? pct(done / total) : '' })),
      bar));

    if (!C.activeHabits(data).length) {
      root.append(el('p', { class: 'empty', text: 'no habits yet. type one below and press enter.' }));
    } else if (hf.main.length) {
      var ul = el('ul', { class: 'habits' });
      hf.main.forEach(function (h) { ul.append(habitRow(h, today, false)); });
      root.append(ul);
    }

    if (hf.off.length) {
      root.append(el('button', {
        type: 'button', class: 'group-toggle', 'data-f': 'toggle-off', 'aria-expanded': showOff ? 'true' : 'false',
        onclick: function () { showOff = !showOff; render(); },
        text: (showOff ? '− ' : '+ ') + 'not scheduled today (' + hf.off.length + ')'
      }));
      if (showOff) {
        var ul2 = el('ul', { class: 'habits' });
        hf.off.forEach(function (h) { ul2.append(habitRow(h, today, true)); });
        root.append(ul2);
      }
    }

    var add = el('input', { type: 'text', class: 'add', id: 'add', 'data-f': 'add', maxlength: '60', placeholder: 'add a habit', 'aria-label': 'add a habit' });
    add.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var name = add.value.trim();
      if (!name) return;
      if (!C.addHabit(data, { name: name }, C.todayKey())) { msg = 'You have reached the limit of ' + C.LIMITS.habits + ' habits.'; return; }
      day = C.todayKey(); followToday = true;
      pendingFocus = 'add';
      changed();
      render();
    });
    root.append(add);

    var note = el('textarea', { class: 'note', id: 'note', maxlength: String(C.LIMITS.note), placeholder: 'note for this day', 'aria-label': 'note for this day', 'data-f': 'note' });
    note.value = data.notes[day] || '';
    note.addEventListener('input', function () { C.setNote(data, day, note.value); changed(); });
    root.append(note);
  }

  function habitRow(h, today, off) {
    var ws = data.settings.weekStart;
    var v = C.value(data, h.id, day);
    var done = v >= h.target;
    var li = el('li', { class: 'habit' + (done ? ' done' : '') + (off ? ' off' : ''), 'data-id': h.id });

    li.append(el('button', {
      type: 'button', class: 'box', 'aria-pressed': done ? 'true' : 'false',
      'aria-label': h.name + (done ? ', done' : ', not done'), 'data-f': h.id + ':box',
      onclick: function () { setVal(h.id, done ? 0 : (h.kind === 'count' ? h.target : 1)); }
    }));

    var main = el('div', { class: 'main' }, el('span', { class: 'name', text: h.name }));
    var sub = [];
    if (h.schedule.type === 'weekly') { var wp = C.weekProgress(data, h, day, ws); sub.push(wp.done + '/' + wp.goal + ' this week'); }
    if (h.schedule.type === 'days') sub.push(h.schedule.days.map(function (d) { return DOWN[d]; }).join(' '));
    if (sub.length) main.append(el('span', { class: 'sub', text: sub.join(' · ') }));
    if (h.kind === 'count') {
      main.append(el('span', { class: 'sub stepper' },
        el('button', { type: 'button', 'aria-label': 'decrease ' + h.name, 'data-f': h.id + ':minus', disabled: v === 0, onclick: function () { setVal(h.id, v - 1); }, text: '−' }),
        el('span', { class: 'val', text: v + '/' + h.target + (h.unit ? ' ' + h.unit : '') }),
        el('button', { type: 'button', 'aria-label': 'increase ' + h.name, 'data-f': h.id + ':plus', onclick: function () { setVal(h.id, v + 1); }, text: '+' })));
    }
    li.append(main);

    var strip = el('div', { class: 'strip', 'aria-hidden': 'true' });
    for (var i = 6; i >= 0; i--) strip.append(el('i', { class: C.isDone(data, h, C.addDays(day, -i)) ? 'on' : '' }));
    li.append(strip);
    li.append(el('span', { class: 'streak', title: 'current streak', text: streakText(C.streak(data, h, today, ws)) }));
    li.append(el('button', { type: 'button', class: 'more', 'aria-label': 'edit ' + h.name, 'data-f': h.id + ':more', onclick: function () { openEdit(h.id); }, text: '…' }));
    return li;
  }

  /* ----- stats ----- */
  function heatmap(levelFn, titleFn, today) {
    var ws = data.settings.weekStart;
    var start = C.addDays(C.startOfWeek(today, ws), -25 * 7);
    var grid = el('div', { class: 'heat', role: 'img', 'aria-label': 'Activity over the last 26 weeks. Darker squares mean more done.' });
    function place(node, col, row) { node.style.gridColumn = String(col); node.style.gridRow = String(row); grid.append(node); }
    for (var w = 0; w < 26; w++) {
      var first = C.addDays(start, w * 7);
      if (+first.slice(8) <= 7) place(el('span', { class: 'm', text: MONN[+first.slice(5, 7) - 1] }), w + 2, 1);
    }
    var labels = { 0: 'm', 2: 'w', 4: 'f' };
    for (var r = 0; r < 7; r++) {
      var dm = C.dowMon(C.addDays(start, r));
      if (labels[dm]) place(el('span', { class: 'd', text: labels[dm] }), 1, r + 2);
    }
    for (var w2 = 0; w2 < 26; w2++) {
      for (var d = 0; d < 7; d++) {
        var key = C.addDays(start, w2 * 7 + d);
        var cls = 'c', title = '';
        if (key > today) cls += ' future';
        else { var lvl = levelFn(key); if (lvl) cls += ' l' + lvl; title = key + (titleFn ? ': ' + titleFn(key) : ''); }
        place(el('span', { class: cls, title: title }), w2 + 2, d + 2);
      }
    }
    return grid;
  }
  function fractionLevel(f) { return f === null || f === 0 ? 0 : f <= 0.34 ? 1 : f <= 0.67 ? 2 : f < 1 ? 3 : 4; }
  function fact(n, t) { return el('div', { class: 'fact' }, el('div', { class: 'n', text: n }), el('div', { class: 't', text: t })); }

  function viewStats(root, today) {
    var ws = data.settings.weekStart;
    var list = C.activeHabits(data);
    if (!list.length) { root.append(el('p', { class: 'empty', text: 'nothing to show yet. add a habit first.' })); return; }
    if (sel !== 'all' && !list.some(function (h) { return h.id === sel; })) sel = 'all';

    var picks = el('div', { class: 'picks' });
    picks.append(el('button', { type: 'button', 'aria-pressed': sel === 'all' ? 'true' : 'false', 'data-f': 'pick-all', onclick: function () { sel = 'all'; render(); }, text: 'all' }));
    list.forEach(function (h) {
      picks.append(el('button', { type: 'button', 'aria-pressed': sel === h.id ? 'true' : 'false', 'data-f': 'pick-' + h.id, onclick: function () { sel = h.id; render(); }, text: h.name }));
    });
    root.append(picks);

    if (sel === 'all') {
      var d7 = 0, d30 = 0, full = 0, k, i;
      for (i = 0; i < 30; i++) {
        k = C.addDays(today, -i);
        var n = list.filter(function (h) { return C.isDone(data, h, k); }).length;
        d30 += n; if (i < 7) d7 += n;
        if (C.dayFraction(data, k) === 1) full++;
      }
      root.append(el('div', { class: 'facts' }, fact(String(list.length), 'habits'), fact(String(d7), 'check-ins, 7 days'), fact(String(d30), 'check-ins, 30 days'), fact(String(full), 'perfect days, 30 days')));
      root.append(el('section', null, el('h2', { class: 'label', text: 'last 26 weeks' }),
        heatmap(function (k2) { return fractionLevel(C.dayFraction(data, k2)); }, function (k2) { var f = C.dayFraction(data, k2); return f === null ? 'nothing scheduled' : pct(f); }, today)));
      var noteKeys = Object.keys(data.notes).sort().reverse().slice(0, 8);
      if (noteKeys.length) {
        var ul = el('ul', { class: 'notes-list' });
        noteKeys.forEach(function (nk) {
          ul.append(el('li', null, el('span', { class: 'when', text: DOWN[C.dowMon(nk)] + ' ' + (+nk.slice(8)) + ' ' + MONN[+nk.slice(5, 7) - 1] }), el('span', { class: 'what', text: data.notes[nk] })));
        });
        root.append(el('section', null, el('h2', { class: 'label', text: 'recent notes' }), ul));
      }
      return;
    }

    var h = list.find(function (x) { return x.id === sel; });
    var s = C.streak(data, h, today, ws), b = C.bestStreak(data, h, today, ws);
    root.append(el('div', { class: 'facts' },
      fact(s.n + s.unit, 'current streak'), fact(b.n + b.unit, 'best streak'),
      fact(pct(C.rate(data, h, today, 30, ws)), 'last 30 days'), fact(pct(C.rate(data, h, today, 90, ws)), 'last 90 days'),
      fact(String(C.totalDone(data, h)), 'days done'), fact(fmtShort(h.created, today), 'since')));

    var wb = C.weekdayBreakdown(data, h, today, 90);
    var wd = el('div', { class: 'weekdays' });
    ['m', 't', 'w', 't', 'f', 's', 's'].forEach(function (lbl, idx) {
      var r = wb.due[idx] ? wb.done[idx] / wb.due[idx] : 0;
      var track = el('div', { class: 'track', title: DOWN[idx] + ': ' + (wb.due[idx] ? pct(r) : 'not scheduled') }, el('i'));
      track.firstChild.style.height = Math.round(r * 100) + '%';
      wd.append(el('div', { class: 'wd' }, track, el('span', { text: lbl })));
    });
    root.append(el('section', null, el('h2', { class: 'label', text: 'by weekday, last 90 days' }), wd));

    root.append(el('section', null, el('h2', { class: 'label', text: 'last 26 weeks' }),
      heatmap(function (k2) {
        var v = C.value(data, h.id, k2);
        if (!v) return 0;
        if (h.kind === 'check' || v >= h.target) return 4;
        return fractionLevel(Math.max(0.2, v / h.target));
      }, function (k2) { var v = C.value(data, h.id, k2); return h.kind === 'count' ? v + '/' + h.target : (v ? 'done' : 'not done'); }, today)));
  }

  /* ----- settings ----- */
  function opts(current, items, onPick, tag) {
    var box = el('div', { class: 'opts' });
    items.forEach(function (it) {
      box.append(el('button', { type: 'button', 'aria-pressed': current === it[0] ? 'true' : 'false', 'data-f': tag + '-' + it[0], onclick: function () { onPick(it[0]); }, text: it[1] }));
    });
    return box;
  }
  function setting(label, control, hint) {
    return el('div', { class: 'rowset' }, el('div', { class: 'lbl' }, el('span', { text: label }), hint ? el('span', { class: 'hint', text: hint }) : null), control);
  }

  function viewSettings(root) {
    var s = data.settings;
    var desk = !!Store.desktop;

    var look = el('section', { class: 'section' }, el('h2', { class: 'label', text: 'appearance' }),
      setting('theme', opts(s.theme, [['system', 'system'], ['light', 'light'], ['dark', 'dark']], function (v) { s.theme = v; changed(); render(); }, 'theme')),
      setting('week starts on', opts(s.weekStart, [['mon', 'mon'], ['sun', 'sun']], function (v) { s.weekStart = v; changed(); render(); }, 'ws')));
    root.append(look);

    if (desk) {
      var time = el('input', { type: 'time', value: s.reminder.time, 'aria-label': 'reminder time', 'data-f': 'reminder-time' });
      time.addEventListener('change', function () { if (C.TIME_RE.test(time.value)) { s.reminder.time = time.value; changed(); } });
      root.append(el('section', { class: 'section' }, el('h2', { class: 'label', text: 'reminders' }),
        setting('daily reminder', opts(s.reminder.enabled ? 'on' : 'off', [['off', 'off'], ['on', 'on']], function (v) { s.reminder.enabled = v === 'on'; changed(); render(); }, 'rem'), 'only if something is still open'),
        s.reminder.enabled ? setting('remind me at', time) : null,
        setting('keep running in tray', opts(s.tray ? 'on' : 'off', [['off', 'off'], ['on', 'on']], function (v) { s.tray = v === 'on'; changed(); render(); }, 'tray'), 'so reminders work when closed')));
    }

    if (desk && Store.syncConnect) root.append(syncSection());

    var dataBox = el('section', { class: 'section' }, el('h2', { class: 'label', text: 'data' }));
    var links = el('div', { class: 'rowset links wrap' },
      el('button', { type: 'button', class: 'link', 'data-f': 'export-json', text: 'export json', onclick: function () { flush().then(function () { return Store.exportJson(data); }).then(function (r) { if (r && r.ok) setMsg('exported' + (r.path ? ' to ' + r.path : '') + '.'); else if (r && r.error) setMsg(r.error); }); } }),
      el('button', { type: 'button', class: 'link', 'data-f': 'export-csv', text: 'export csv', onclick: function () { Store.exportCsv(C.toCsv(data)).then(function (r) { if (r && r.ok) setMsg('exported' + (r.path ? ' to ' + r.path : '') + '.'); else if (r && r.error) setMsg(r.error); }); } }),
      el('button', { type: 'button', class: 'link', 'data-f': 'import', text: 'import json', onclick: doImport }),
      Store.openFolder ? el('button', { type: 'button', class: 'link', 'data-f': 'open-folder', text: 'open data folder', onclick: function () { Store.openFolder(); } }) : null);
    dataBox.append(links);
    if (pendingImport) {
      var adding = syncInfo.configured; // with sync on, an import is added to what you have, because a replacement would be undone by the next sync
      dataBox.append(el('div', { class: 'rowset wrap' },
        el('span', { text: adding
          ? 'add the ' + pendingImport.habits.length + ' habits from the file to your ' + C.activeHabits(data).length + '?'
          : 'replace your ' + C.activeHabits(data).length + ' habits with ' + pendingImport.habits.length + ' from the file?' }),
        el('span', { class: 'opts' },
          el('button', { type: 'button', class: adding ? 'link' : 'link danger', 'data-f': 'import-yes', text: adding ? 'add' : 'replace', onclick: function () {
            data = adding ? C.merge(data, pendingImport) : pendingImport;
            pendingImport = null; msg = 'imported.'; changed(); render();
          } }),
          el('button', { type: 'button', class: 'link', 'data-f': 'import-no', text: 'cancel', onclick: function () { pendingImport = null; render(); } }))));
    }
    dataBox.append(el('p', { class: 'msg', role: 'status', text: msg }));
    root.append(dataBox);

    var archived = data.habits.filter(function (h) { return h.archived; }).sort(function (a, b) { return a.order - b.order; });
    if (archived.length) {
      var box = el('section', { class: 'section' }, el('h2', { class: 'label', text: 'archived' }));
      archived.forEach(function (h) {
        box.append(el('div', { class: 'rowset' }, el('span', { class: 'muted', text: h.name }),
          el('button', { type: 'button', class: 'link', 'data-f': 'restore-' + h.id, text: 'restore', onclick: function () { C.setArchived(data, h.id, false); changed(); render(); } })));
      });
      root.append(box);
    }

    root.append(el('section', { class: 'section' }, el('h2', { class: 'label', text: 'about' }),
      el('p', { class: 'mono-path', text: 'kept ' + (info.version || '') + (desk ? (syncInfo.configured ? '. your data is on this computer and in your github repository.' : '. your data stays on this computer.') : '. running in a browser: data is stored in this browser only.') }),
      info.path ? el('p', { class: 'mono-path', text: info.path }) : null));
  }

  function doImport() {
    Store.importFile().then(function (r) {
      if (!r || r.canceled) return;
      if (r.error) { msg = r.error; render(); return; }
      var incoming = C.migrate(r.data);
      if (!incoming.habits.length) { msg = 'no habits found in that file.'; pendingImport = null; render(); return; }
      pendingImport = incoming;
      msg = '';
      render();
    });
  }

  /* ----- habit editor ----- */
  function openEdit(id) {
    var h = data.habits.find(function (x) { return x.id === id; });
    if (!h) return;
    var dlg = $('edit-dialog');
    var form = $('edit-form');
    var f = { name: h.name, kind: h.kind, target: h.target, unit: h.unit, type: h.schedule.type, days: h.schedule.days.slice(), perWeek: h.schedule.perWeek };
    var confirmDelete = false;
    var err = '';

    function draw() {
      var fk = document.activeElement && form.contains(document.activeElement) ? document.activeElement.getAttribute('data-f') : null;
      form.textContent = '';
      var nameIn = el('input', { type: 'text', id: 'f-name', maxlength: '60', value: f.name, 'aria-label': 'name' });
      nameIn.addEventListener('input', function () { f.name = nameIn.value; });
      form.append(el('h2', { id: 'edit-title', text: 'edit habit' }), el('div', { class: 'field' }, nameIn));

      var kindRow = el('div', { class: 'field' }, el('span', { class: 'label', text: 'type' }),
        opts(f.kind, [['check', 'yes / no'], ['count', 'count']], function (v) { f.kind = v; draw(); }, 'kind'));
      if (f.kind === 'count') {
        var tgt = el('input', { type: 'number', min: '1', max: String(C.MAX_VALUE), value: String(f.target), 'aria-label': 'daily target' });
        tgt.addEventListener('input', function () { f.target = Number(tgt.value) || 1; });
        var unit = el('input', { type: 'text', maxlength: String(C.LIMITS.unit), value: f.unit, placeholder: 'unit, e.g. glasses', 'aria-label': 'unit' });
        unit.addEventListener('input', function () { f.unit = unit.value; });
        kindRow.append(el('div', { class: 'inline' }, el('span', { class: 'muted', text: 'target per day' }), tgt, unit));
      }
      form.append(kindRow);

      var sched = el('div', { class: 'field' }, el('span', { class: 'label', text: 'schedule' }),
        opts(f.type, [['daily', 'every day'], ['days', 'some days'], ['weekly', 'times a week']], function (v) {
          f.type = v;
          if (v === 'days' && (!f.days.length || f.days.length === 7)) f.days = [0, 1, 2, 3, 4];
          draw();
        }, 'type'));
      if (f.type === 'days') {
        var days = el('div', { class: 'days' });
        ['m', 't', 'w', 't', 'f', 's', 's'].forEach(function (lbl, idx) {
          var on = f.days.indexOf(idx) !== -1;
          days.append(el('button', { type: 'button', 'data-f': 'day-' + idx, 'aria-pressed': on ? 'true' : 'false', 'aria-label': DOWN[idx], text: lbl, onclick: function () {
            f.days = on ? f.days.filter(function (d) { return d !== idx; }) : f.days.concat(idx).sort();
            draw();
          } }));
        });
        sched.append(days);
      }
      if (f.type === 'weekly') {
        var sel2 = el('select', { 'aria-label': 'times per week' });
        for (var n = 1; n <= 6; n++) sel2.append(el('option', { value: String(n), selected: n === f.perWeek }, String(n)));
        sel2.addEventListener('change', function () { f.perWeek = Number(sel2.value); });
        sched.append(el('div', { class: 'inline' }, sel2, el('span', { class: 'muted', text: 'times per week' })));
      }
      form.append(sched);
      if (err) form.append(el('p', { class: 'msg', role: 'alert', text: err }));

      var actions = el('div', { class: 'actions' });
      if (confirmDelete) {
        actions.append(el('span', { text: 'delete forever, with all history?' }),
          el('button', { type: 'button', class: 'link danger', text: 'delete', onclick: function () { C.removeHabit(data, id); dlg.close(); changed(); render(); } }),
          el('button', { type: 'button', class: 'link', text: 'keep', onclick: function () { confirmDelete = false; draw(); } }));
      } else {
        actions.append(
          el('button', { type: 'submit', class: 'primary', text: 'save' }),
          el('button', { type: 'button', class: 'link', text: 'cancel', onclick: function () { dlg.close(); } }),
          el('span', { class: 'spacer' }),
          el('button', { type: 'button', class: 'link', 'aria-label': 'move up', text: 'up', onclick: function () { C.moveHabit(data, id, -1); changed(); render(); } }),
          el('button', { type: 'button', class: 'link', 'aria-label': 'move down', text: 'down', onclick: function () { C.moveHabit(data, id, 1); changed(); render(); } }),
          el('button', { type: 'button', class: 'link', text: 'archive', onclick: function () { C.setArchived(data, id, true); dlg.close(); changed(); render(); } }),
          el('button', { type: 'button', class: 'link danger', text: 'delete', onclick: function () { confirmDelete = true; draw(); } }));
      }
      form.append(actions);
      if (fk) { var again = form.querySelector('[data-f="' + fk + '"]'); if (again) again.focus(); }
    }

    form.onsubmit = function (e) {
      e.preventDefault();
      var name = f.name.trim();
      if (!name) { err = 'give it a name.'; draw(); return; }
      var days = f.type === 'days' && !f.days.length ? [] : f.days;
      var ok = C.updateHabit(data, id, { name: name, kind: f.kind, target: f.target, unit: f.unit, schedule: { type: f.type, days: days, perWeek: f.perWeek } });
      if (!ok) { err = 'could not save that habit.'; draw(); return; }
      dlg.close();
      changed();
      render();
    };
    dlg.addEventListener('close', function onClose() { dlg.removeEventListener('close', onClose); pendingFocus = id + ':more'; render(); });
    draw();
    dlg.showModal();
    var first = $('f-name'); if (first) { first.focus(); first.select(); }
  }

  /* ----- help ----- */
  function openHelp() {
    var body = $('help-body');
    body.textContent = '';
    var keys = [
      ['← →', 'previous and next day'], ['t', 'jump to today'], ['↑ ↓', 'move between habits'],
      ['space', 'check or uncheck'], ['+ −', 'change a count'], ['e', 'edit the focused habit'],
      ['n', 'add a habit'], ['1 2 3', 'today, stats, settings'], ['esc', 'leave a field or close']
    ];
    var dl = el('dl', { class: 'keys' });
    keys.forEach(function (k) { dl.append(el('dt', { text: k[0] }), el('dd', { text: k[1] })); });
    body.append(el('h2', { id: 'help-title', text: 'keyboard' }), dl,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'link', text: 'close', onclick: function () { $('help-dialog').close(); } })));
    $('help-dialog').showModal();
  }

  /* ---------- keyboard ---------- */
  function focusedHabitId() {
    var a = document.activeElement;
    var li = a && a.closest ? a.closest('li[data-id]') : null;
    return li ? li.getAttribute('data-id') : null;
  }
  function moveFocus(delta) {
    var boxes = Array.prototype.slice.call(document.querySelectorAll('#view .habit .box'));
    if (!boxes.length) return;
    var li = document.activeElement && document.activeElement.closest ? document.activeElement.closest('li[data-id]') : null;
    var cur = li ? boxes.indexOf(li.querySelector('.box')) : -1;
    var next = cur === -1 ? (delta > 0 ? 0 : boxes.length - 1) : Math.max(0, Math.min(boxes.length - 1, cur + delta));
    boxes[next].focus();
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    if (typing) { if (e.key === 'Escape') t.blur(); return; }
    var id;
    switch (e.key) {
      case 'ArrowLeft': case 'h': if (view === 'today') { e.preventDefault(); go(-1); } break;
      case 'ArrowRight': case 'l': if (view === 'today') { e.preventDefault(); go(1); } break;
      case 't': if (view === 'today') jumpToday(); break;
      case 'ArrowDown': case 'j': if (view === 'today') { e.preventDefault(); moveFocus(1); } break;
      case 'ArrowUp': case 'k': if (view === 'today') { e.preventDefault(); moveFocus(-1); } break;
      case '1': setView('today'); break;
      case '2': setView('stats'); break;
      case '3': setView('settings'); break;
      case 'n': e.preventDefault(); if (view !== 'today') setView('today'); var add = $('add'); if (add) add.focus(); break;
      case 'e': id = focusedHabitId(); if (id) { e.preventDefault(); openEdit(id); } break;
      case '+': case '=': case '-': case '_':
        id = focusedHabitId();
        if (id) {
          var h = data.habits.find(function (x) { return x.id === id; });
          var up = e.key === '+' || e.key === '=';
          var v = C.value(data, id, day);
          if (h && h.kind === 'count') setVal(id, v + (up ? 1 : -1));
          else if (h) setVal(id, up ? 1 : 0);
        }
        break;
      case '?': openHelp(); break;
      default: break;
    }
  });

  document.addEventListener('click', function (e) {
    if (e.target && e.target.tagName === 'DIALOG') e.target.close(); // click on the backdrop
  });
  $('nav').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-view]') : null;
    if (b) setView(b.getAttribute('data-view'));
  });

  /* ---------- lifecycle ---------- */
  function tick() { if (followToday && day !== C.todayKey()) render(); }
  setInterval(tick, 30000);
  function syncIfStale() { if (!document.hidden && syncReady() && Date.now() - lastSyncTry > 60000) scheduleSync(0); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { tick(); syncIfStale(); } });
  window.addEventListener('focus', syncIfStale);
  window.addEventListener('online', function () { scheduleSync(0); });
  setInterval(function () { if (!document.hidden && syncReady() && Date.now() - lastSyncTry > 240000) scheduleSync(0); }, 60000);
  $('sync-state').addEventListener('click', function () { setView('settings'); });

  Promise.all([Store.load(), Promise.resolve(Store.info ? Store.info() : {}), Promise.resolve(Store.syncStatus ? Store.syncStatus() : { configured: false })]).then(function (r) {
    var res = r[0] || {};
    data = C.migrate(res.data);
    notice = res.notice || '';
    info = r[1] || info;
    syncInfo = r[2] || syncInfo;
    if (syncInfo.configured && syncInfo.needsToken) { syncState = 'error'; syncError = 'The saved token can no longer be read. Disconnect, then connect again with a new token.'; }
    loaded = true;
    render();
    paintSync();
    scheduleSync(0);
  }).catch(function () {
    loaded = true;
    saveBlocked = true;
    notice = 'Your saved data could not be loaded, so changes will not be saved this session. Restart the app.';
    render();
  });
})();
