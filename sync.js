'use strict';
/*
 * GitHub sync. Plain Node, no Electron, so it can be tested against a local mock server.
 *
 * The data lives as one JSON file in a private repository, written through GitHub's REST
 * API (no git install needed). Each sync downloads the file, merges it with local data,
 * and uploads the result only if something changed. The upload names the version it was
 * based on, so if another device got there first GitHub refuses it and we merge again.
 */
const C = require('./src/core.js');

const API = 'https://api.github.com';
const DEFAULT_PATH = 'kept/habits.json';
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const MAX_ATTEMPTS = 5;

class SyncError extends Error {
  /** kind: 'auth' | 'access' | 'notfound' | 'public' | 'offline' | 'ratelimit' | 'conflict' | 'format' | 'server' | 'input' */
  constructor(kind, message) { super(message); this.kind = kind; }
}

/** Accepts "owner/name", or a pasted GitHub URL, and returns "owner/name" (or null). */
function parseRepo(input) {
  let s = String(input || '').trim();
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return REPO_RE.test(s) ? s : null;
}

function cleanToken(input) {
  const t = String(input || '').trim();
  return t && t.length <= 255 && !/\s/.test(t) ? t : null;
}

function encodePath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

function createClient(opts) {
  const doFetch = opts.fetch || globalThis.fetch;
  const base = (opts.baseUrl || API).replace(/\/+$/, '');
  const repo = opts.repo;
  const token = opts.token;
  const filePath = opts.path || DEFAULT_PATH;
  const device = opts.device || 'this computer';

  async function call(method, url, body) {
    let res;
    try {
      res = await doFetch(base + url, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'kept-habit-tracker',
          'Content-Type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined
      });
    } catch (e) {
      throw new SyncError('offline', 'Could not reach GitHub. Check your connection.');
    }
    let json = null;
    const text = await res.text().catch(() => '');
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
    return { status: res.status, json, headers: res.headers };
  }

  function fail(res, what) {
    const msg = (res.json && res.json.message) || '';
    if (res.status === 401) throw new SyncError('auth', 'GitHub rejected the token. It may have expired or been revoked. Make a new one and reconnect.');
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers && res.headers.get && res.headers.get('x-ratelimit-remaining');
      if (remaining === '0' || res.status === 429 || /rate limit|abuse/i.test(msg)) throw new SyncError('ratelimit', 'GitHub is asking us to slow down. It will try again later.');
      throw new SyncError('access', 'The token is not allowed to ' + what + '. Give it Contents: read and write on this repository.');
    }
    if (res.status === 404) throw new SyncError('notfound', 'GitHub cannot find that repository, or the token has no access to it. Check the name and the token\'s repository access.');
    if (res.status >= 500) throw new SyncError('server', 'GitHub had a problem (' + res.status + '). It will try again later.');
    throw new SyncError('server', 'GitHub answered with an unexpected error (' + res.status + (msg ? ': ' + msg : '') + ').');
  }

  /** Checks the repo exists, is private, and that we may write to it. */
  async function verify() {
    const res = await call('GET', '/repos/' + repo);
    if (res.status !== 200 || !res.json) fail(res, 'read this repository');
    if (!res.json.private) {
      throw new SyncError('public', 'This repository is public, so anyone could read your habits and notes. Make it private on GitHub (Settings, then Danger Zone), or use a different repository.');
    }
    if (res.json.permissions && res.json.permissions.push === false) {
      throw new SyncError('access', 'The token can read this repository but not write to it. Give it Contents: read and write.');
    }
    return { defaultBranch: res.json.default_branch };
  }

  /** Returns { sha, doc } for the file, or { sha: null, doc: null } when it does not exist yet. */
  async function pull() {
    const res = await call('GET', '/repos/' + repo + '/contents/' + encodePath(filePath));
    if (res.status === 404) {
      // 404 means either "no such file" or "no such repository". Tell them apart.
      const r = await call('GET', '/repos/' + repo);
      if (r.status === 200) return { sha: null, doc: null };
      fail(r, 'read this repository');
    }
    if (res.status !== 200 || !res.json) fail(res, 'read the data file');
    if (Array.isArray(res.json) || res.json.type !== 'file') throw new SyncError('format', 'The path ' + filePath + ' in that repository is a folder, not a file.');
    let b64 = res.json.content;
    if (!b64 || res.json.encoding !== 'base64') { // larger than 1 MB: GitHub returns it through the blobs API instead
      const blob = await call('GET', '/repos/' + repo + '/git/blobs/' + res.json.sha);
      if (blob.status !== 200 || !blob.json) fail(blob, 'read the data file');
      b64 = blob.json.content;
    }
    let parsed;
    try { parsed = JSON.parse(Buffer.from(String(b64).replace(/\n/g, ''), 'base64').toString('utf8')); }
    catch (e) { throw new SyncError('format', 'The data file in the repository is not valid JSON, so syncing was stopped to avoid overwriting it. Fix or delete ' + filePath + ' and try again.'); }
    return { sha: res.json.sha, doc: parsed };
  }

  async function push(data, sha) {
    const content = Buffer.from(JSON.stringify(C.syncDoc(data)), 'utf8').toString('base64');
    const body = { message: 'Sync from ' + device, content };
    if (sha) body.sha = sha;
    const res = await call('PUT', '/repos/' + repo + '/contents/' + encodePath(filePath), body);
    if (res.status === 200 || res.status === 201) return true;
    if (res.status === 409 || res.status === 422) return false; // someone else wrote first, or the file appeared since we looked
    fail(res, 'write the data file');
    return false;
  }

  /**
   * Merges local data with the repository and uploads the result if it differs.
   * Resolves { data, pushed, pulled } where `data` is the merged data (settings untouched).
   */
  async function sync(local) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const remote = await pull();
      const remoteData = remote.doc ? C.migrate(remote.doc) : null;
      const merged = remoteData ? C.merge(local, remoteData) : local;
      const pulled = C.canonical(merged) !== C.canonical(local);
      if (remoteData && C.canonical(merged) === C.canonical(remoteData)) return { data: merged, pushed: false, pulled };
      if (await push(merged, remote.sha)) return { data: merged, pushed: true, pulled };
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 350)); // lost a race: wait a moment, then merge again
    }
    throw new SyncError('conflict', 'Another device kept changing the data at the same moment. It will try again shortly.');
  }

  return { verify, pull, push, sync };
}

module.exports = { createClient, SyncError, parseRepo, cleanToken, DEFAULT_PATH, API };
