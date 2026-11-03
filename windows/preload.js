'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),
  fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
  loadEpg: (url) => ipcRenderer.invoke('epg-load', url),
  cacheRead: () => ipcRenderer.invoke('cache-read'),
  cacheWrite: (text) => ipcRenderer.invoke('cache-write', text),
  cacheClear: () => ipcRenderer.invoke('cache-clear'),
  getPerf: () => ipcRenderer.invoke('perf-get'),
  setHw: (on) => ipcRenderer.invoke('perf-set-hw', on),
  relaunch: () => ipcRenderer.invoke('relaunch'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('set-fullscreen', on),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen-changed', (_e, v) => cb(v))
});
