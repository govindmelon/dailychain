'use strict';
/*
 * A small stand-in for the parts of the GitHub REST API that sync uses:
 *   GET  /repos/:owner/:repo
 *   GET  /repos/:owner/:repo/contents/*path
 *   PUT  /repos/:owner/:repo/contents/*path    (checks the sha like GitHub does)
 *   GET  /repos/:owner/:repo/git/blobs/:sha
 * Runs standalone (node test/mock-github.js <port>) or from tests via start().
 */
const http = require('node:http');
const crypto = require('node:crypto');

function sha1(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }

function start(port, options = {}) {
  const state = {
    token: options.token || 'test-token',
    repos: options.repos || { 'me/habits': { private: true, push: true } },
    files: {},        // 'owner/repo:path' -> { sha, buf }
    commits: [],      // messages, newest last
    putCount: 0,
    failNext: [],     // statuses to return from the next requests, in order
    smallLimit: options.smallLimit || 1024 * 1024
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (status, obj, headers) => { res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, headers)); res.end(JSON.stringify(obj)); };
      if (state.failNext.length) { const s = state.failNext.shift(); return send(s, { message: 'forced failure ' + s }); }
      const auth = req.headers.authorization || '';
      if (auth !== 'Bearer ' + state.token) return send(401, { message: 'Bad credentials' });

      const url = new URL(req.url, 'http://x');
      const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
      if (!m) return send(404, { message: 'Not Found' });
      const name = m[1] + '/' + m[2];
      const repo = state.repos[name];
      if (!repo) return send(404, { message: 'Not Found' });
      const rest = m[3] || '';

      if (rest === '' && req.method === 'GET') {
        return send(200, { full_name: name, private: repo.private, default_branch: 'main', permissions: { push: repo.push, pull: true } });
      }
      const blob = rest.match(/^\/git\/blobs\/([0-9a-f]+)$/);
      if (blob && req.method === 'GET') {
        const f = Object.entries(state.files).find(([, v]) => v.sha === blob[1]);
        if (!f) return send(404, { message: 'Not Found' });
        return send(200, { sha: blob[1], encoding: 'base64', content: f[1].buf.toString('base64') });
      }
      const c = rest.match(/^\/contents\/(.+)$/);
      if (c) {
        const p = c[1].split('/').map(decodeURIComponent).join('/');
        const key = name + ':' + p;
        const file = state.files[key];
        if (req.method === 'GET') {
          if (!file) return send(404, { message: 'Not Found' });
          const big = file.buf.length > state.smallLimit;
          return send(200, { type: 'file', name: p.split('/').pop(), path: p, sha: file.sha, size: file.buf.length,
            encoding: big ? 'none' : 'base64', content: big ? '' : file.buf.toString('base64') });
        }
        if (req.method === 'PUT') {
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return send(400, { message: 'Bad JSON' }); }
          if (state.beforePut) { const hook = state.beforePut; state.beforePut = null; hook(); } // lets a test make another device win the race
          const current = state.files[key];
          if (!repo.push) return send(403, { message: 'Resource not accessible by personal access token' });
          if (current && !body.sha) return send(422, { message: 'Invalid request. "sha" wasn\'t supplied.' });
          if (current && body.sha !== current.sha) return send(409, { message: p + ' does not match ' + body.sha });
          if (!current && body.sha) return send(422, { message: 'Invalid request. file does not exist.' });
          const buf = Buffer.from(body.content, 'base64');
          const sha = sha1(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf]));
          state.files[key] = { sha, buf };
          state.commits.push(body.message);
          state.putCount++;
          return send(current ? 200 : 201, { content: { sha, path: p }, commit: { message: body.message } });
        }
      }
      return send(404, { message: 'Not Found' });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({
      state, port: server.address().port, url: 'http://127.0.0.1:' + server.address().port,
      read(repo, p) { const f = state.files[repo + ':' + p]; return f ? JSON.parse(f.buf.toString('utf8')) : null; },
      write(repo, p, text) { const buf = Buffer.from(text); state.files[repo + ':' + p] = { sha: sha1(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])), buf }; },
      close() { return new Promise((r) => server.close(r)); }
    }));
  });
}

module.exports = { start };

if (require.main === module) {
  start(Number(process.argv[2]) || 4400).then((m) => console.log('mock github on ' + m.url + ' (token: test-token, repo: me/habits)'));
}
