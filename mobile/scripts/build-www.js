'use strict';
/*
 * Builds mobile/www (what the Android app loads) from the same sources as the desktop app.
 * Nothing is bundled or minified: the files are copied as they are, plus the phone-only ones.
 * The page is derived from src/index.html, so the two cannot drift apart; every rewrite is
 * checked, and the build fails loudly if the desktop page changes shape.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(__dirname, '..', 'www');
const MOBILE = path.resolve(__dirname, '..');

const COPY = [
  ['src/core.js', 'core.js'], ['reminders.js', 'reminders.js'], ['sync.js', 'sync.js'],
  ['src/store.js', 'store.js'], ['src/app.js', 'app.js'], ['src/styles.css', 'styles.css'],
  ['mobile/adapter/plan.js', 'plan.js'], ['mobile/adapter/store-android.js', 'store-android.js'],
  ['mobile/web/native.js', 'native.js'], ['mobile/web/mobile.css', 'mobile.css']
];

function replaceOnce(text, from, to, what) {
  const i = text.indexOf(from);
  if (i === -1 || text.indexOf(from, i + 1) !== -1) throw new Error('build-www: expected exactly one ' + what + ' in src/index.html');
  return text.slice(0, i) + to + text.slice(i + from.length);
}

function page() {
  let h = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
  // The phone talks to GitHub straight from the page, so the policy must allow exactly that host.
  h = replaceOnce(h, "img-src 'self' data:;", "img-src 'self' data:; connect-src https://api.github.com;", 'img-src rule');
  h = replaceOnce(h, 'width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover', 'viewport tag');
  h = replaceOnce(h, '<link rel="stylesheet" href="styles.css">', '<link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="mobile.css">', 'stylesheet link');
  h = replaceOnce(h, '<script src="core.js"></script>\n  <script src="store.js"></script>',
    ['core.js', 'reminders.js', 'sync.js', 'plan.js', 'store-android.js', 'native.js', 'store.js'].map((f) => '<script src="' + f + '"></script>').join('\n  '), 'script block');
  return h;
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
  for (const [from, to] of COPY) fs.copyFileSync(path.join(ROOT, from), path.join(OUT, to));
  for (const f of fs.readdirSync(path.join(ROOT, 'src/fonts'))) fs.copyFileSync(path.join(ROOT, 'src/fonts', f), path.join(OUT, 'fonts', f));
  fs.writeFileSync(path.join(OUT, 'index.html'), page());
  return OUT;
}

if (require.main === module) console.log('built ' + path.relative(process.cwd(), build()));
module.exports = { build, page, OUT };
