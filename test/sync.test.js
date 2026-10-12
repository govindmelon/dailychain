'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const S = require('../sync.js');
const { start } = require('./mock-github.js');

const TODAY = '2026-10-12';
const REPO = 'me/habits';

async function withServer(fn, options) {
  const mock = await start(0, options);
  try { await fn(mock); } finally { await mock.close(); }
}
const client = (mock, extra) => S.createClient(Object.assign({ baseUrl: mock.url, repo: REPO, token: 'test-token', device: 'test' }, extra));
function device() { const d = C.defaultData(); return d; }
function copy(d) { return C.migrate(JSON.parse(JSON.stringify(d)), TODAY); }

test('repo and token input is tidied or refused', () => {
  assert.equal(S.parseRepo('me/habits'), 'me/habits');
  assert.equal(S.parseRepo('  https://github.com/me/habits.git  '), 'me/habits');
  assert.equal(S.parseRepo('https://github.com/me/habits/'), 'me/habits');
  assert.equal(S.parseRepo('me'), null);
  assert.equal(S.parseRepo('me/habits/extra'), null);
  assert.equal(S.parseRepo('me/ha bits'), null);
  assert.equal(S.parseRepo(''), null);
  assert.equal(S.cleanToken(' github_pat_abc '), 'github_pat_abc');
  assert.equal(S.cleanToken('has space'), null);
  assert.equal(S.cleanToken(''), null);
  assert.equal(S.cleanToken('x'.repeat(300)), null);
});

test('verify accepts a private repo the token can write to', async () => {
  await withServer(async (m) => { assert.deepEqual(await client(m).verify(), { defaultBranch: 'main' }); });
});

test('verify refuses a public repo, a read-only token, a bad token and a missing repo', async () => {
  await withServer(async (m) => {
    await assert.rejects(client(m).verify(), (e) => e.kind === 'public' && /private/.test(e.message));
  }, { repos: { 'me/habits': { private: false, push: true } } });
  await withServer(async (m) => {
    await assert.rejects(client(m).verify(), (e) => e.kind === 'access');
  }, { repos: { 'me/habits': { private: true, push: false } } });
  await withServer(async (m) => {
    await assert.rejects(client(m, { token: 'wrong' }).verify(), (e) => e.kind === 'auth');
    await assert.rejects(client(m, { repo: 'me/other' }).verify(), (e) => e.kind === 'notfound');
  });
});

test('the first sync creates the file, and a second device receives everything', async () => {
  await withServer(async (m) => {
    C.setClock(() => 1000);
    const a = device();
    const id = C.addHabit(a, { name: 'Read' }, TODAY);
    C.setClock(() => 2000); C.setValue(a, id, TODAY, 1); C.setNote(a, TODAY, 'good day');
    const r1 = await client(m).sync(a);
    assert.equal(r1.pushed, true);
    assert.equal(m.state.putCount, 1);
    assert.equal(m.read(REPO, S.DEFAULT_PATH).habits[0].name, 'Read');
    assert.equal(m.read(REPO, S.DEFAULT_PATH).settings, undefined, 'settings are not uploaded');

    const b = device();
    const r2 = await client(m).sync(b);
    assert.equal(r2.pulled, true);
    assert.equal(r2.pushed, false, 'nothing new to upload');
    assert.equal(C.value(r2.data, id, TODAY), 1);
    assert.equal(r2.data.notes[TODAY], 'good day');
    C.setClock(null);
  });
});

test('syncing with nothing changed does not upload or make a commit', async () => {
  await withServer(async (m) => {
    const a = device(); C.addHabit(a, { name: 'Read' }, TODAY);
    const first = await client(m).sync(a);
    const again = await client(m).sync(first.data);
    assert.equal(again.pushed, false);
    assert.equal(again.pulled, false);
    assert.equal(m.state.putCount, 1);
    assert.equal(m.state.commits[0], 'Sync from test');
  });
});

test('two devices that edit separately end up identical after syncing', async () => {
  await withServer(async (m) => {
    C.setClock(() => 1000);
    let a = device();
    const id = C.addHabit(a, { name: 'Read' }, '2026-10-01');
    a = (await client(m).sync(a)).data;
    let b = (await client(m).sync(device())).data;
    C.setClock(() => 2000); C.setValue(a, id, '2026-10-10', 1);
    C.setClock(() => 2001); C.setValue(b, id, '2026-10-11', 1); C.updateHabit(b, id, { name: 'Read books' });
    const afterA = await client(m).sync(a);
    const afterB = await client(m).sync(b);
    const finalA = await client(m).sync(afterA.data);
    assert.equal(C.canonical(finalA.data), C.canonical(afterB.data));
    assert.equal(C.value(finalA.data, id, '2026-10-10'), 1);
    assert.equal(C.value(finalA.data, id, '2026-10-11'), 1);
    assert.equal(finalA.data.habits[0].name, 'Read books');
    assert.equal(C.canonical(C.migrate(m.read(REPO, S.DEFAULT_PATH))), C.canonical(finalA.data));
    C.setClock(null);
  });
});

test('a deletion on one device reaches the other and does not come back', async () => {
  await withServer(async (m) => {
    C.setClock(() => 1000);
    let a = device();
    const keep = C.addHabit(a, { name: 'Keep' }, TODAY), gone = C.addHabit(a, { name: 'Gone' }, TODAY);
    a = (await client(m).sync(a)).data;
    let b = (await client(m).sync(device())).data;
    C.setClock(() => 2000); C.removeHabit(a, gone);
    a = (await client(m).sync(a)).data;
    b = (await client(m).sync(b)).data;
    assert.deepEqual(b.habits.map((h) => h.id), [keep]);
    b = (await client(m).sync(b)).data;
    a = (await client(m).sync(a)).data;
    assert.deepEqual(a.habits.map((h) => h.id), [keep]);
    C.setClock(null);
  });
});

test('losing a race to another device is handled by merging again', async () => {
  await withServer(async (m) => {
    C.setClock(() => 1000);
    let a = device();
    const id = C.addHabit(a, { name: 'Read' }, '2026-10-01');
    a = (await client(m).sync(a)).data;
    const other = copy(a);
    C.setClock(() => 3000); C.setValue(other, id, '2026-10-09', 1);
    C.setClock(() => 2000); C.setValue(a, id, '2026-10-10', 1);
    // Right before our upload lands, another device uploads its own change.
    m.state.beforePut = () => m.write(REPO, S.DEFAULT_PATH, JSON.stringify(C.syncDoc(other)));
    const r = await client(m).sync(a);
    assert.equal(r.pushed, true);
    assert.equal(C.value(r.data, id, '2026-10-09'), 1, 'the other device\'s change was kept');
    assert.equal(C.value(r.data, id, '2026-10-10'), 1, 'and ours was kept too');
    const stored = C.migrate(m.read(REPO, S.DEFAULT_PATH));
    assert.equal(C.canonical(stored), C.canonical(r.data));
    C.setClock(null);
  });
});

test('data older than the sync format (no timestamps) is merged, not overwritten', async () => {
  await withServer(async (m) => {
    m.write(REPO, S.DEFAULT_PATH, JSON.stringify({ version: 2, habits: [{ id: 'h1', name: 'Old habit', created: '2026-09-01' }], log: { h1: { '2026-10-01': 1 } } }));
    const a = device(); C.addHabit(a, { name: 'New habit' }, TODAY);
    const r = await client(m).sync(a);
    assert.deepEqual(r.data.habits.map((h) => h.name).sort(), ['New habit', 'Old habit']);
    assert.equal(C.value(r.data, 'h1', '2026-10-01'), 1);
  });
});

test('a data file bigger than 1 MB is read through the blobs endpoint', async () => {
  await withServer(async (m) => {
    const big = device();
    const id = C.addHabit(big, { name: 'Read' }, '2026-01-01');
    for (let i = 0; i < 40; i++) C.setValue(big, id, C.addDays('2026-01-01', i), 1);
    m.write(REPO, S.DEFAULT_PATH, JSON.stringify(C.syncDoc(big)));
    const r = await client(m).sync(device());
    assert.equal(r.data.habits[0].name, 'Read');
    assert.equal(C.totalDone(r.data, r.data.habits[0]), 40);
  }, { smallLimit: 100 }); // pretend anything over 100 bytes counts as "large"
});

test('a damaged remote file stops the sync and is left untouched', async () => {
  await withServer(async (m) => {
    m.write(REPO, S.DEFAULT_PATH, '{ not json');
    const a = device(); C.addHabit(a, { name: 'Read' }, TODAY);
    await assert.rejects(client(m).sync(a), (e) => e.kind === 'format');
    assert.equal(m.state.putCount, 0);
    assert.equal(m.state.files[REPO + ':' + S.DEFAULT_PATH].buf.toString(), '{ not json');
  });
});

test('network and server problems are reported with a clear kind', async () => {
  const a = device();
  const dead = S.createClient({ baseUrl: 'http://127.0.0.1:9', repo: REPO, token: 't' });
  await assert.rejects(dead.sync(a), (e) => e.kind === 'offline');
  await withServer(async (m) => {
    m.state.failNext = [429];
    await assert.rejects(client(m).sync(a), (e) => e.kind === 'ratelimit');
    m.state.failNext = [503];
    await assert.rejects(client(m).sync(a), (e) => e.kind === 'server');
    await assert.rejects(client(m, { token: 'wrong' }).sync(a), (e) => e.kind === 'auth');
  });
});

test('a read-only token fails clearly when it tries to write', async () => {
  await withServer(async (m) => {
    const a = device(); C.addHabit(a, { name: 'Read' }, TODAY);
    await assert.rejects(client(m).sync(a), (e) => e.kind === 'access' && /Contents/.test(e.message));
  }, { repos: { 'me/habits': { private: true, push: false } } });
});
