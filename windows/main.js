'use strict';
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const http = require('http');
const https = require('https');

let win = null;

// Hardware-Beschleunigung lässt sich in den Leistungseinstellungen abschalten (Neustart nötig).
const perfFile = () => path.join(app.getPath('userData'), 'perf.json');
function readPerf() {
  try {
    return JSON.parse(fs.readFileSync(perfFile(), 'utf8'));
  } catch (e) {
    return { hw: true };
  }
}
if (readPerf().hw === false) app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// ---------------------------------------------------------------- Netzwerk

function getBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(new Error('Ungültige Adresse'));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { headers: { 'User-Agent': 'DJ64/1.0' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        resolve(getBuffer(new URL(res.headers.location, u).toString(), redirects + 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > 500e6) {
          req.destroy(new Error('Datei ist zu groß'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
  });
}

function maybeGunzip(buf) {
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
  return buf;
}

// ---------------------------------------------------------------- EPG

const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
function decode(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => entities[m]).replace(/<!\[CDATA\[|\]\]>/g, '');
}
function norm(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
function xmltvTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/.exec((s || '').trim());
  if (!m) return -1;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (m[7]) {
    const sign = m[7][0] === '-' ? -1 : 1;
    t -= sign * ((+m[7].slice(1, 3)) * 60 + (+m[7].slice(3, 5))) * 60000;
  }
  return t;
}

function parseEpg(xml, now) {
  const from = now - 2 * 3600e3;
  const to = now + 24 * 3600e3;
  const names = {};
  const channels = {};

  const chRe = /<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g;
  let m;
  while ((m = chRe.exec(xml))) {
    const id = decode(m[1]);
    const dn = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g;
    let d;
    while ((d = dn.exec(m[2]))) {
      const key = norm(decode(d[1]));
      if (key && !(key in names)) names[key] = id;
    }
  }

  const prRe = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g;
  while ((m = prRe.exec(xml))) {
    const attrs = m[1];
    const start = xmltvTime((/start="([^"]*)"/.exec(attrs) || [])[1]);
    const stop = xmltvTime((/stop="([^"]*)"/.exec(attrs) || [])[1]);
    if (start < 0 || stop < 0 || stop <= from || start >= to) continue;
    const ch = (/channel="([^"]*)"/.exec(attrs) || [])[1];
    if (!ch) continue;
    const t = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
    if (!t) continue;
    const dsc = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
    const id = decode(ch);
    (channels[id] || (channels[id] = [])).push([start, stop, decode(t[1]).trim(), dsc ? decode(dsc[1]).trim().slice(0, 500) : '']);
  }
  for (const id of Object.keys(channels)) channels[id].sort((a, b) => a[0] - b[0]);
  return { channels, names };
}

// ---------------------------------------------------------------- IPC

function cachePath(id) {
  const n = Number(id) || 0;
  return path.join(app.getPath('userData'), n ? `playlist_${n}.m3u` : 'playlist.m3u');
}

ipcMain.handle('fetch-text', async (_e, url) => {
  const buf = maybeGunzip(await getBuffer(url));
  return buf.toString('utf8');
});

ipcMain.handle('fetch-image', async (_e, url) => {
  const buf = await getBuffer(url);
  if (buf.length > 20e6) throw new Error('Bild ist zu groß');
  return buf.toString('base64');
});

ipcMain.handle('epg-load', async (_e, url) => {
  const buf = maybeGunzip(await getBuffer(url));
  return parseEpg(buf.toString('utf8'), Date.now());
});

ipcMain.handle('cache-read', async (_e, id) => {
  try {
    return fs.readFileSync(cachePath(id), 'utf8');
  } catch (e) {
    return '';
  }
});
ipcMain.handle('cache-write', async (_e, text, id) => {
  try {
    fs.writeFileSync(cachePath(id), text, 'utf8');
  } catch (e) {
    /* egal */
  }
  return true;
});
ipcMain.handle('cache-delete', async (_e, id) => {
  try {
    fs.unlinkSync(cachePath(id));
  } catch (e) {
    /* egal */
  }
  return true;
});
ipcMain.handle('cache-clear', async (_e, id) => {
  try {
    fs.unlinkSync(cachePath(id));
  } catch (e) {
    /* egal */
  }
  try {
    await win.webContents.session.clearCache();
  } catch (e) {
    /* egal */
  }
  return true;
});

ipcMain.handle('perf-get', async () => readPerf());
ipcMain.handle('perf-set-hw', async (_e, on) => {
  try {
    fs.writeFileSync(perfFile(), JSON.stringify({ ...readPerf(), hw: !!on }), 'utf8');
  } catch (e) {
    /* egal */
  }
  return true;
});
ipcMain.handle('relaunch', async () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('toggle-fullscreen', async () => {
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});
ipcMain.handle('set-fullscreen', async (_e, on) => {
  if (!win) return false;
  win.setFullScreen(!!on);
  return win.isFullScreen();
});

// ---------------------------------------------------------------- Fenster

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 900,
    minHeight: 540,
    backgroundColor: '#0B1F4B',
    title: 'DJ64',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Streams von beliebigen IPTV-Servern müssen ohne CORS-Sperre abspielbar sein.
      webSecurity: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false
    }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('enter-full-screen', () => win.webContents.send('fullscreen-changed', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen-changed', false));
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
