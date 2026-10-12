'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSyncConfig } = require('../syncstore.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kept-sync-'));
const fakeKeyring = { available: () => true, encrypt: (s) => 'ENC:' + Buffer.from(s).reverse().toString('base64'), decrypt: (e) => Buffer.from(e.slice(4), 'base64').reverse().toString() };
const noKeyring = { available: () => false };

test('with a keyring the token is encrypted on disk and read back', () => {
  const c = createSyncConfig(tmp(), fakeKeyring);
  assert.equal(c.load(), null);
  assert.deepEqual(c.save('me/habits', 'github_pat_SECRET'), { secure: true });
  assert.ok(!fs.readFileSync(c.file, 'utf8').includes('github_pat_SECRET'), 'the token is not in the file as text');
  const cfg = c.load();
  assert.equal(cfg.repo, 'me/habits');
  assert.equal(cfg.token, 'github_pat_SECRET');
  assert.equal(cfg.secure, true);
  assert.equal(fs.statSync(c.file).mode & 0o777, 0o600);
});

test('without a keyring the token is kept in a private file and flagged as not secure', () => {
  const c = createSyncConfig(tmp(), noKeyring);
  assert.deepEqual(c.save('me/habits', 'tok'), { secure: false });
  const cfg = c.load();
  assert.equal(cfg.token, 'tok');
  assert.equal(cfg.secure, false);
  assert.equal(fs.statSync(c.file).mode & 0o777, 0o600);
});

test('an unreadable token is reported as missing instead of crashing', () => {
  const dir = tmp();
  createSyncConfig(dir, fakeKeyring).save('me/habits', 'tok');
  const broken = createSyncConfig(dir, { available: () => true, decrypt: () => { throw new Error('keyring changed'); } });
  const cfg = broken.load();
  assert.equal(cfg.repo, 'me/habits');
  assert.equal(cfg.token, null);
});

test('last sync time is remembered, a damaged file reads as not connected, clear disconnects', () => {
  const dir = tmp();
  const c = createSyncConfig(dir, noKeyring);
  c.save('me/habits', 'tok');
  c.touch(1234567);
  assert.equal(c.load().lastSync, 1234567);
  fs.writeFileSync(c.file, 'garbage');
  assert.equal(c.load(), null);
  c.save('me/habits', 'tok');
  c.clear();
  assert.equal(c.load(), null);
  c.clear(); // clearing twice is fine
});
