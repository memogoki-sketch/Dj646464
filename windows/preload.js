'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),
  fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
  loadEpg: (url) => ipcRenderer.invoke('epg-load', url),
  cacheRead: (id) => ipcRenderer.invoke('cache-read', id),
  cacheWrite: (text, id) => ipcRenderer.invoke('cache-write', text, id),
  cacheClear: (id) => ipcRenderer.invoke('cache-clear', id),
  cacheDelete: (id) => ipcRenderer.invoke('cache-delete', id),
  getPerf: () => ipcRenderer.invoke('perf-get'),
  setHw: (on) => ipcRenderer.invoke('perf-set-hw', on),
  relaunch: () => ipcRenderer.invoke('relaunch'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('set-fullscreen', on),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen-changed', (_e, v) => cb(v))
});
