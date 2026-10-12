'use strict';
/* The only bridge between the page and the main process. The page gets these functions and nothing else. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dc', {
  desktop: true,
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  saveSync: (data) => ipcRenderer.sendSync('data:save-sync', data),
  exportJson: (data) => ipcRenderer.invoke('data:export-json', data),
  exportCsv: (csv) => ipcRenderer.invoke('data:export-csv', csv),
  importFile: () => ipcRenderer.invoke('data:import'),
  openFolder: () => ipcRenderer.invoke('app:open-folder'),
  info: () => ipcRenderer.invoke('app:info'),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  syncConnect: (repo, token) => ipcRenderer.invoke('sync:connect', repo, token),
  syncDisconnect: () => ipcRenderer.invoke('sync:disconnect'),
  syncRun: (data) => ipcRenderer.invoke('sync:run', data)
});
