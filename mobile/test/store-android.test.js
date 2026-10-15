'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/core.js');
const Sync = require('../../sync.js');
const Plan = require('../adapter/plan.js');
const create = require('../adapter/store-android.js');
const { start } = require('../../test/mock-github.js');

/* ---------- fakes for the Capacitor plugins ---------- */
function fakeFilesystem() {
  const files = new Map(); // 'DIR:path' -> text
  const key = (o) => o.directory + ':' + o.path;
  const fs = {
    files,
    failWrites: false,
    async readFile(o) { if (!files.has(key(o))) throw new Error('File does not exist'); return { data: files.get(key(o)) }; },
    async writeFile(o) { if (fs.failWrites) throw new Error('disk full'); files.set(key(o), o.data); return { uri: 'file://' + key(o) }; },
    async deleteFile(o) { if (!files.has(key(o))) throw new Error('File does not exist'); files.delete(key(o)); },
    async readdir(o) {
      const prefix = key(o) + '/';
      const names = [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map((k) => k.slice(prefix.length));
      if (!names.length) throw new Error('Folder does not exist');
      return { files: names.map((name) => ({ name, type: 'file' })) };
    },
    async getUri(o) { return { uri: 'content://kept/' + o.path }; }
  };
  return fs;
}

function fakeNotifications(permission) {
  const n = { permission: permission || 'granted', scheduled: [], cancelled: [], asked: 0, scheduleCalls: 0 };
  n.checkPermissions = async () => ({ display: n.permission });
  n.requestPermissions = async () => { n.asked++; if (n.permission === 'prompt') n.permission = n.grantOnAsk === false ? 'denied' : 'granted'; return { display: n.permission }; };
  n.cancel = async (o) => { n.cancelled.push(o.notifications.map((x) => x.id)); n.scheduled = n.scheduled.filter((s) => !o.notifications.some((x) => x.id === s.id)); };
  n.schedule = async (o) => { n.scheduleCalls++; n.scheduled.push(...o.notifications); return { notifications: o.notifications.map((x) => ({ id: x.id })) }; };
  return n;
}

const fakeShare = () => ({ shared: [], async share(o) { this.shared.push(o); return { activityType: 'x' }; } });
const fakeApp = () => ({ listeners: {}, async addListener(n, f) { this.listeners[n] = f; return { remove() {} }; }, async getInfo() { return { version: '2.2.0' }; }, exitApp() {} });

function setup(opts) {
  opts = opts || {};
  const plugins = { Filesystem: fakeFilesystem(), LocalNotifications: fakeNotifications(opts.permission), Share: fakeShare(), App: fakeApp() };
  const clock = { now: opts.now || new Date(2026, 9, 15, 9, 0, 0) };
  const store = create({ core: C, sync: Sync, plan: Plan, plugins, fetch: globalThis.fetch, now: () => clock.now, apiBase: opts.apiBase, deviceName: 'test phone' });
  return { store, plugins, fs: plugins.Filesystem, notifs: plugins.LocalNotifications, clock };
}
const sampleData = (name) => { const d = C.defaultData(); C.addHabit(d, { name: name || 'read' }, C.todayKey(new Date(2026, 9, 15))); return d; };
const tick = () => new Promise((r) => setTimeout(r, 20)); // lets the background backup and reminder planning finish

/* ---------- data ---------- */
test('first run has no data; a save is read back; the spare copy is cleaned up', async () => {
  const { store, fs } = setup();
  assert.deepEqual(await store.load(), { data: null });
  const d = sampleData();
  assert.deepEqual(await store.save(d), { ok: true });
  assert.ok(!fs.files.has('DATA:habits.json.new'), 'the spare copy is gone once the save finished');
  const back = await store.load();
  assert.equal(back.data.habits[0].name, 'read');
});

test('a spare copy left by an interrupted save wins over the older main file', async () => {
  const { store, fs } = setup();
  await store.save(sampleData('old'));
  fs.files.set('DATA:habits.json.new', JSON.stringify(sampleData('newer')));
  assert.equal((await store.load()).data.habits[0].name, 'newer');
});

test('a half-written spare is ignored and the main file is used', async () => {
  const { store, fs } = setup();
  await store.save(sampleData('whole'));
  fs.files.set('DATA:habits.json.new', '{"version":3,"habits":[{"na');
  assert.equal((await store.load()).data.habits[0].name, 'whole');
});

test('a failed write is reported, not thrown, and the next save still works', async () => {
  const { store, fs } = setup();
  fs.failWrites = true;
  const r = await store.save(sampleData());
  assert.equal(r.ok, false);
  assert.match(r.error, /disk full/);
  fs.failWrites = false;
  assert.deepEqual(await store.save(sampleData()), { ok: true });
});

test('saves are written in order even when started together', async () => {
  const { store } = setup();
  await Promise.all([store.save(sampleData('one')), store.save(sampleData('two')), store.save(sampleData('three'))]);
  assert.equal((await store.load()).data.habits[0].name, 'three');
});

test('a damaged data file is kept aside and the newest backup is restored', async () => {
  const { store, fs } = setup();
  await store.save(sampleData('safe'));
  await store._internals.snapshot('manual');
  fs.files.set('DATA:habits.json', '{"version":3,"hab');
  const r = await store.load();
  assert.equal(r.data.habits[0].name, 'safe');
  assert.match(r.notice, /damaged, so the latest backup was restored/);
  assert.ok([...fs.files.keys()].some((k) => k.startsWith('DATA:habits.damaged-')), 'the damaged file was kept');
});

test('a damaged file with no backup starts fresh and says so', async () => {
  const { store, fs } = setup();
  fs.files.set('DATA:habits.json', 'not json');
  const r = await store.load();
  assert.equal(r.data, null);
  assert.match(r.notice, /could not be read/);
});

test('one backup per day, and only the newest 14 are kept', async () => {
  const { store, fs, clock } = setup();
  await store.save(sampleData());
  await store.load(); await tick();
  await store.load(); await tick();
  const dailies = () => [...fs.files.keys()].filter((k) => k.includes('/habits-2026-10-15-'));
  assert.equal(dailies().length, 1, 'a second start on the same day adds nothing');
  for (let i = 0; i < 20; i++) { clock.now = new Date(2026, 9, 16 + i, 8, 0, 0); await store._internals.snapshot('t'); }
  assert.equal((await store._internals.backupNames()).length, 14);
});

/* ---------- export ---------- */
test('export writes to the cache folder and opens the share sheet with that file', async () => {
  const { store, fs, plugins } = setup();
  const r = await store.exportJson(sampleData());
  assert.deepEqual(r, { ok: true });
  assert.ok(fs.files.has('CACHE:kept-2026-10-15.json'));
  assert.deepEqual(plugins.Share.shared[0].files, ['content://kept/kept-2026-10-15.json']);
  assert.equal(JSON.parse(fs.files.get('CACHE:kept-2026-10-15.json')).habits[0].name, 'read');
  assert.deepEqual(await store.exportCsv('a,b\n1,2\n'), { ok: true });
  assert.ok(fs.files.has('CACHE:kept-2026-10-15.csv'));
});

test('cancelling the share sheet is not an error', async () => {
  const { store, plugins } = setup();
  plugins.Share.share = async () => { throw new Error('Share canceled'); };
  assert.deepEqual(await store.exportJson(sampleData()), { ok: false });
});

/* ---------- reminders ---------- */
const withReminder = (d, time) => { d.settings.reminder = { enabled: true, time: time || '20:00' }; return d; };

test('turning reminders on asks for permission once and schedules two weeks of notices', async () => {
  const { store, notifs } = setup({ permission: 'prompt' });
  await store.save(withReminder(sampleData()));
  assert.equal(notifs.asked, 1);
  assert.equal(notifs.scheduled.length, Plan.DAYS);
  const n = notifs.scheduled[0];
  assert.equal(n.smallIcon, 'ic_stat_kept');
  assert.equal(n.isExactNotification, false);
  assert.equal(n.schedule.allowWhileIdle, true);
  assert.equal(new Date(n.schedule.at).getHours(), 20);
});

test('an unchanged plan is not scheduled again, and a changed one replaces the old', async () => {
  const { store, notifs } = setup();
  const d = withReminder(sampleData());
  await store.save(d);
  await store.save(d);
  assert.equal(notifs.scheduleCalls, 1);
  d.settings.reminder.time = '07:15';
  await store.save(d);
  assert.equal(notifs.scheduleCalls, 2);
  assert.equal(notifs.scheduled.length, Plan.DAYS - 1, 'old ones were cancelled, not doubled (07:15 has already passed today)');
  assert.equal(new Date(notifs.scheduled[0].schedule.at).getMinutes(), 15);
  assert.equal(new Date(notifs.scheduled[0].schedule.at).getDate(), 16);
});

test('turning reminders off cancels everything', async () => {
  const { store, notifs } = setup();
  const d = withReminder(sampleData());
  await store.save(d);
  d.settings.reminder.enabled = false;
  await store.save(d);
  assert.equal(notifs.scheduled.length, 0);
});

test('denied permission schedules nothing and retries when the app is opened again', async () => {
  const { store, notifs } = setup({ permission: 'prompt' });
  notifs.grantOnAsk = false;
  const d = withReminder(sampleData());
  await store.save(d);
  assert.equal(notifs.scheduled.length, 0);
  notifs.permission = 'granted'; // the person allowed it in Android settings
  await store.save(d);
  assert.equal(notifs.scheduled.length, Plan.DAYS);
});

test('a habit that is already done today is left out of today\'s notice', async () => {
  const { store, notifs } = setup();
  const d = withReminder(sampleData());
  C.setValue(d, d.habits[0].id, '2026-10-15', 1);
  await store.save(d);
  assert.equal(notifs.scheduled.length, Plan.DAYS - 1);
  assert.ok(new Date(notifs.scheduled[0].schedule.at).getDate() === 16);
});

test('a notifications plugin that throws never breaks saving', async () => {
  const { store, notifs } = setup();
  notifs.schedule = async () => { throw new Error('boom'); };
  assert.deepEqual(await store.save(withReminder(sampleData())), { ok: true });
});

/* ---------- sync ---------- */
async function withMock(fn, options) {
  const mock = await start(0, options);
  try { await fn(mock); } finally { await mock.close(); }
}

test('connect checks the repository, stores the token privately and never returns it', async () => {
  await withMock(async (m) => {
    const { store, fs } = setup({ apiBase: m.url });
    assert.deepEqual(await store.syncStatus(), { configured: false });
    assert.equal((await store.syncConnect('nope', 'test-token')).ok, false);
    assert.equal((await store.syncConnect('me/habits', 'has space')).ok, false);
    const r = await store.syncConnect('https://github.com/me/habits', 'test-token');
    assert.equal(r.ok, true);
    assert.ok(!JSON.stringify(r).includes('test-token'), 'the token is not sent back to the page');
    assert.ok(!JSON.stringify(await store.syncStatus()).includes('test-token'));
    assert.equal(JSON.parse(fs.files.get('DATA:sync.json')).token, 'test-token');
  });
});

test('connect refuses a public repository, a wrong token and a missing repository', async () => {
  await withMock(async (m) => {
    const { store } = setup({ apiBase: m.url });
    assert.equal((await store.syncConnect('me/habits', 'test-token')).kind, 'public');
    assert.equal((await store.syncConnect('me/habits', 'wrong')).kind, 'auth');
    assert.equal((await store.syncConnect('me/other', 'test-token')).kind, 'notfound');
    assert.equal((await store.syncStatus()).configured, false);
  }, { repos: { 'me/habits': { private: false, push: true } } });
});

test('sync uploads, then merges what another device added', async () => {
  await withMock(async (m) => {
    const a = setup({ apiBase: m.url }), b = setup({ apiBase: m.url });
    await a.store.syncConnect('me/habits', 'test-token');
    await b.store.syncConnect('me/habits', 'test-token');
    const da = sampleData('from phone A');
    const ra = await a.store.syncRun(da);
    assert.equal(ra.ok, true);
    assert.equal(ra.pushed, true);
    assert.ok(m.read('me/habits', 'kept/habits.json'), 'the file exists in the repository');
    const db = sampleData('from phone B');
    const rb = await b.store.syncRun(db);
    assert.equal(rb.ok, true);
    assert.deepEqual(rb.data.habits.map((h) => h.name).sort(), ['from phone A', 'from phone B']);
    const ra2 = await a.store.syncRun(ra.data);
    assert.deepEqual(ra2.data.habits.map((h) => h.name).sort(), ['from phone A', 'from phone B']);
    assert.ok(ra2.status.lastSync > 0);
    assert.ok(!m.read('me/habits', 'kept/habits.json').settings, 'settings are not uploaded');
  });
});

test('sync problems come back as readable results, not exceptions', async () => {
  await withMock(async (m) => {
    const { store } = setup({ apiBase: m.url });
    assert.equal((await store.syncRun(sampleData())).kind, 'input', 'not set up yet');
    await store.syncConnect('me/habits', 'test-token');
    m.state.token = 'rotated';
    const r = await store.syncRun(sampleData());
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'auth');
    assert.equal((await store.syncRun(null)).ok, false);
  });
});

test('disconnecting removes the saved token', async () => {
  await withMock(async (m) => {
    const { store, fs } = setup({ apiBase: m.url });
    await store.syncConnect('me/habits', 'test-token');
    assert.deepEqual(await store.syncDisconnect(), { configured: false });
    assert.ok(!fs.files.has('DATA:sync.json'));
    assert.deepEqual(await store.syncStatus(), { configured: false });
  });
});

test('the saved connection survives an app restart', async () => {
  await withMock(async (m) => {
    const first = setup({ apiBase: m.url });
    await first.store.syncConnect('me/habits', 'test-token');
    const second = create({ core: C, sync: Sync, plan: Plan, plugins: first.plugins, fetch: globalThis.fetch, apiBase: m.url });
    const s = await second.syncStatus();
    assert.equal(s.configured, true);
    assert.equal(s.repo, 'me/habits');
    assert.equal((await second.syncRun(sampleData())).ok, true);
  });
});

test('the adapter identifies itself as the phone app', async () => {
  const { store } = setup();
  assert.equal(store.mobile, true);
  assert.equal(store.desktop, false);
  assert.equal(store.openFolder, null);
  assert.deepEqual(await store.info(), { version: '2.2.0', path: null });
});
