/*
 * Starts the phone side of Kept. Capacitor's own script (injected by the Android shell) provides
 * window.Capacitor; without a bundler, each native plugin is reached through registerPlugin.
 * This file runs before store.js, which picks up window.DCNative.
 */
(function () {
  'use strict';
  var cap = window.Capacitor;

  function banner(text) {
    document.addEventListener('DOMContentLoaded', function () {
      var p = document.createElement('p');
      p.className = 'hint';
      p.style.cssText = 'padding:12px 16px;margin:0;border-bottom:1px solid currentColor';
      p.textContent = text;
      document.body.prepend(p);
    });
  }

  if (!cap || typeof cap.registerPlugin !== 'function' || !cap.isNativePlatform || !cap.isNativePlatform()) {
    banner('Kept could not reach this phone\'s storage. Update "Android System WebView" in the Play Store, then reopen the app. Nothing you enter here is synced.');
    return;
  }

  var plugins = {};
  ['Filesystem', 'LocalNotifications', 'Share', 'App', 'SystemBars'].forEach(function (n) { plugins[n] = cap.registerPlugin(n); });

  window.DCNative = window.DCCreateAndroidStore({
    core: window.DCCore,
    sync: window.DCSync,
    plan: window.DCPlan,
    plugins: plugins,
    fetch: window.fetch.bind(window),
    deviceName: 'phone'
  });

  /* Status bar icons follow the app's theme, not just the phone's. DARK means light icons on a dark page. */
  function syncBars() {
    var t = document.documentElement.getAttribute('data-theme');
    var dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    try { plugins.SystemBars.setStyle({ style: dark ? 'DARK' : 'LIGHT' }); } catch (e) { /* cosmetic */ }
  }
  document.addEventListener('DOMContentLoaded', function () {
    syncBars();
    new MutationObserver(syncBars).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncBars);
  });
})();
