/*
 * Storage adapter. Inside the desktop app the preload script provides window.dc
 * (files on disk through the main process). In a plain browser, which is how the
 * tests run, it falls back to localStorage so the same interface code works.
 */
(function () {
  'use strict';
  var KEY = 'dc2.data';

  function download(name, text, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  var web = {
    desktop: false,
    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        return Promise.resolve({ data: raw ? JSON.parse(raw) : null });
      } catch (e) { return Promise.resolve({ data: null, notice: 'Saved data could not be read, so you are starting fresh.' }); }
    },
    save: function (data) {
      try { localStorage.setItem(KEY, JSON.stringify(data)); return Promise.resolve({ ok: true }); }
      catch (e) { return Promise.resolve({ ok: false, error: 'Could not save to browser storage.' }); }
    },
    saveSync: function (data) { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* nothing to do */ } },
    exportJson: function (data) { download('daily-chain.json', JSON.stringify(data, null, 2), 'application/json'); return Promise.resolve({ ok: true, path: 'daily-chain.json' }); },
    exportCsv: function (csv) { download('daily-chain.csv', csv, 'text/csv'); return Promise.resolve({ ok: true, path: 'daily-chain.csv' }); },
    importFile: function () {
      return new Promise(function (resolve) {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', function () {
          var f = input.files && input.files[0];
          if (!f) { resolve({ canceled: true }); return; }
          f.text().then(function (t) {
            try { resolve({ data: JSON.parse(t) }); } catch (e) { resolve({ error: 'That file is not valid JSON.' }); }
          });
        });
        input.click();
      });
    },
    openFolder: null,
    info: function () { return Promise.resolve({ version: 'browser', path: null }); }
  };

  window.DCStore = window.dc || web;
})();
