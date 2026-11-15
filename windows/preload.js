'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),
  fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
  loadEpg: (url, opts) => ipcRenderer.invoke('epg-load', url, opts),
  xtreamLoad: (a) => ipcRenderer.invoke('xtream-load', a),
  xtreamSeries: (a) => ipcRenderer.invoke('xtream-series', a),
  setHeaders: (url, h) => ipcRenderer.invoke('set-headers', url, h),
  setUa: (mode, custom) => ipcRenderer.invoke('set-ua', mode, custom),
  playExternal: (kind, o) => ipcRenderer.invoke('play-external', kind, o),
  encSync: (text) => ipcRenderer.sendSync('secret-enc', text),
  decSync: (text) => ipcRenderer.sendSync('secret-dec', text),
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
