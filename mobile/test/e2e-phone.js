'use strict';
/*
 * Runs the real built phone page (mobile/www) in Chromium at phone size, with a stand-in for
 * Capacitor's native plugins (files kept in localStorage so a reload behaves like restarting the
 * app) and requests to api.github.com answered by the local mock GitHub.
 *
 *   node mobile/scripts/build-www.js && NODE_PATH=/opt/npm-tools/node_modules node mobile/test/e2e-phone.js
 *
 * It cannot prove the Android shell works (that needs a device), but it does prove the page, its
 * content-security policy, the adapter and sync work together on a phone-sized touch screen.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { start } = require('../../test/mock-github.js');

const WWW = path.join(__dirname, '..', 'www');
const SHOTS = process.env.SHOTS || path.join(__dirname, '..', '..', 'shots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };

function serve() {
  const server = http.createServer((req, res) => {
    const p = path.join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
    if (!p.startsWith(WWW) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: 'http://127.0.0.1:' + server.address().port + '/' })));
}

/* Runs in the page before anything else: a Capacitor look-alike. */
function fakeCapacitor() {
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const fsKey = (o) => 'fakefs:' + o.directory + ':' + o.path;
  const log = (name, entry) => { const l = get('fake:log:' + name) || []; l.push(entry); put('fake:log:' + name, l); };
  const plugins = {
    Filesystem: {
      async readFile(o) { const v = localStorage.getItem(fsKey(o)); if (v === null) throw new Error('File does not exist'); return { data: v }; },
      async writeFile(o) { localStorage.setItem(fsKey(o), o.data); return { uri: 'file:///' + o.path }; },
      async deleteFile(o) { if (localStorage.getItem(fsKey(o)) === null) throw new Error('File does not exist'); localStorage.removeItem(fsKey(o)); },
      async readdir(o) {
        const pre = fsKey(o) + '/';
        const names = Object.keys(localStorage).filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length));
        if (!names.length) throw new Error('Folder does not exist');
        return { files: names.map((name) => ({ name, type: 'file' })) };
      },
      async getUri(o) { return { uri: 'content://kept/' + o.path }; }
    },
    LocalNotifications: {
      async checkPermissions() { return { display: localStorage.getItem('fake:perm') || 'granted' }; },
      async requestPermissions() { return { display: localStorage.getItem('fake:perm') || 'granted' }; },
      async cancel(o) { const ids = o.notifications.map((n) => n.id); put('fake:notifs', (get('fake:notifs') || []).filter((n) => !ids.includes(n.id))); },
      async schedule(o) { put('fake:notifs', (get('fake:notifs') || []).concat(o.notifications)); return { notifications: [] }; }
    },
    Share: { async share(o) { log('share', o); return {}; } },
    App: {
      async addListener(name, fn) { (window.__appListeners = window.__appListeners || {})[name] = fn; return { remove() {} }; },
      async getInfo() { return { version: '2.2.0' }; },
      exitApp() { log('exit', 1); }
    },
    SystemBars: { async setStyle(o) { log('bars', o.style); } }
  };
  window.Capacitor = { isNativePlatform: () => true, registerPlugin: (n) => plugins[n] };
}

const steps = [];
const step = (name) => { steps.push(name); console.log('  ok ' + name); };

async function phone(browser, base, mock, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(fakeCapacitor);
  const problems = [];
  // GitHub is only reachable through the mock, and only with the headers a browser is allowed to send.
  await ctx.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const h = req.headers();
    problems.push(...['user-agent-override', 'x-github-api-version'].filter((n) => h[n]).map((n) => 'unexpected header ' + n));
    const r = await fetch(mock.url + new URL(req.url()).pathname + new URL(req.url()).search, { method: req.method(), headers: { authorization: h.authorization || '', 'content-type': 'application/json' }, body: req.method() === 'GET' ? undefined : req.postData() });
    await route.fulfill({ status: r.status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: await r.text() });
  });
  await ctx.route((u) => !/^(http:\/\/127\.0\.0\.1|https:\/\/api\.github\.com)/.test(u.href), (r) => r.abort());
  const page = await ctx.newPage();
  page.on('console', (m) => { if (/content security policy|refused to/i.test(m.text())) problems.push(label + ' CSP: ' + m.text()); });
  page.on('pageerror', (e) => problems.push(label + ' page error: ' + e.message));
  await page.goto(base);
  await page.waitForSelector('#add');
  return { ctx, page, problems };
}

const logOf = (page, name) => page.evaluate((n) => JSON.parse(localStorage.getItem('fake:log:' + n) || '[]'), name);
const notifs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('fake:notifs') || '[]'));
const view = async (page, v) => { await page.tap('#nav [data-view="' + v + '"]'); await page.waitForTimeout(80); };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const web = await serve();
  const mock = await start(0, { token: 'phone-token' });
  const browser = await chromium.launch();
  let failed = null;
  try {
    const A = await phone(browser, web.url, mock, 'A');
    const { page } = A;

    /* layout */
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, 'no sideways scrolling, got ' + overflow);
    assert.equal(await page.isVisible('#hints'), false, 'keyboard hints are hidden on a phone');
    const nav = await page.$$eval('#nav button', (bs) => bs.map((b) => b.getBoundingClientRect().height));
    assert.ok(nav.every((h) => h >= 44), 'nav buttons are at least 44px tall: ' + nav);
    step('page fits the phone and has thumb-sized navigation');

    /* a habit, checked off, survives a restart */
    await page.fill('#add', 'read');
    await page.press('#add', 'Enter');
    await page.waitForSelector('.habit');
    const box = await page.$('.habit .box');
    const bb = await box.boundingBox();
    await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2 + 12); // tapping just below the drawn square still hits it
    await page.waitForSelector('.habit.done');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'phone-today.png') });
    await page.reload();
    await page.waitForSelector('.habit.done');
    assert.ok(await page.evaluate(() => localStorage.getItem('fakefs:DATA:habits.json')), 'data is in the phone\'s file, not only on screen');
    step('add, check off (generous tap area), reload keeps it');

    /* stats and the phone back button */
    await view(page, 'stats');
    await page.screenshot({ path: path.join(SHOTS, 'phone-stats.png') });
    await page.evaluate(() => window.__appListeners.backButton());
    await page.waitForTimeout(80);
    assert.equal(await page.getAttribute('#nav [data-view="today"]', 'aria-current'), 'page');
    await page.evaluate(() => window.__appListeners.backButton());
    assert.equal((await logOf(page, 'exit')).length, 1, 'back on the first screen leaves the app');
    step('back button returns to today, then exits');

    /* reminders */
    await view(page, 'settings');
    assert.ok(await page.isVisible('[data-f="rem-on"]'), 'reminder controls are offered on a phone');
    assert.equal(await page.isVisible('[data-f="tray-on"]'), false, 'no tray option on a phone');
    await page.tap('[data-f="rem-on"]');
    await page.waitForTimeout(300);
    const n1 = await notifs(page);
    assert.ok(n1.length >= 13 && n1.length <= 14, 'two weeks of notices were planned, got ' + n1.length);
    assert.ok(n1.every((n) => n.smallIcon === 'ic_stat_kept' && n.isExactNotification === false));
    step('reminders plan two weeks of notices');

    /* theme drives the status bar */
    await page.tap('[data-f="theme-dark"]');
    await page.waitForTimeout(150);
    assert.equal((await logOf(page, 'bars')).pop(), 'DARK');
    await page.screenshot({ path: path.join(SHOTS, 'phone-settings-dark.png'), fullPage: true });
    await page.tap('[data-f="theme-light"]');
    await page.waitForTimeout(150);
    assert.equal((await logOf(page, 'bars')).pop(), 'LIGHT');
    step('status bar style follows the theme setting');

    /* sync: connect with a bad token, then a good one */
    mock.state.repos['me/habits'] = { private: true, push: true };
    await page.fill('[data-f="sync-repo"]', 'me/habits');
    await page.fill('[data-f="sync-token"]', 'wrong');
    await page.tap('[data-f="sync-connect"]');
    await page.waitForTimeout(500);
    assert.match(await page.textContent('body'), /rejected the token/i);
    await page.fill('[data-f="sync-token"]', 'phone-token');
    await page.tap('[data-f="sync-connect"]');
    await page.waitForSelector('[data-f="sync-now"]');
    await page.waitForFunction(() => !!document.body.textContent.match(/synced|up to date|just now/i), null, { timeout: 8000 }).catch(() => {});
    assert.ok(!(await page.textContent('body')).includes('phone-token'), 'the token is never shown again');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fakefs:DATA:sync.json')));
    assert.equal(stored.repo, 'me/habits');
    await page.waitForFunction(() => true);
    for (let i = 0; i < 20 && !mock.read('me/habits', 'kept/habits.json'); i++) await page.waitForTimeout(250);
    const remote = mock.read('me/habits', 'kept/habits.json');
    assert.ok(remote && remote.habits.some((h) => h.name === 'read'), 'the habit reached the repository');
    assert.ok(!remote.settings, 'settings stay on the phone');
    step('connect rejects a bad token, accepts a good one, and uploads');

    /* a second phone */
    const B = await phone(browser, web.url, mock, 'B');
    await view(B.page, 'settings');
    await B.page.fill('[data-f="sync-repo"]', 'me/habits');
    await B.page.fill('[data-f="sync-token"]', 'phone-token');
    await B.page.tap('[data-f="sync-connect"]');
    await B.page.waitForSelector('[data-f="sync-now"]');
    await view(B.page, 'today');
    await B.page.waitForFunction(() => document.querySelector('.habit .name') && /read/.test(document.body.textContent), null, { timeout: 8000 });
    await B.page.fill('#add', 'run');
    await B.page.press('#add', 'Enter');
    await B.page.waitForFunction(() => /run/.test(document.body.textContent));
    await view(B.page, 'settings');
    await B.page.tap('[data-f="sync-now"]');
    for (let i = 0; i < 30 && !(mock.read('me/habits', 'kept/habits.json') || { habits: [] }).habits.some((h) => h.name === 'run'); i++) await B.page.waitForTimeout(250);
    await view(page, 'settings');
    await page.tap('[data-f="sync-now"]');
    await view(page, 'today');
    await page.waitForFunction(() => /run/.test(document.body.textContent), null, { timeout: 8000 });
    step('a second phone pulls the first one\'s habit, adds one, and the first receives it');

    /* export */
    await view(page, 'settings');
    await page.tap('[data-f="export-json"]');
    await page.waitForTimeout(300);
    const shared = await logOf(page, 'share');
    assert.equal(shared.length, 1);
    assert.match(shared[0].files[0], /kept-\d{4}-\d{2}-\d{2}\.json$/);
    step('export opens the share sheet with a file');

    const all = [...A.problems, ...B.problems];
    assert.deepEqual(all, [], 'no CSP violations, page errors or forbidden headers');
    step('no CSP violations or page errors');
  } catch (e) { failed = e; }
  await browser.close();
  web.server.close();
  await mock.close();
  if (failed) { console.error('\nFAILED after: ' + steps[steps.length - 1] + '\n' + (failed.stack || failed)); process.exit(1); }
  console.log('\nphone e2e passed (' + steps.length + ' checks). screenshots in ' + SHOTS);
})();
