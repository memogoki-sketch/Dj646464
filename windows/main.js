'use strict';
const { app, BrowserWindow, ipcMain, Menu, safeStorage, session, shell } = require('electron');
const { spawn, execFile } = require('child_process');
const logic = require('./engine-logic.js');
const { Worker } = require('worker_threads');
const xtream = require('./xtream.js');
const { parseEpgBuffer } = require('./epg.js');
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

function request1(url, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(new Error('Ungültige Adresse'));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { headers: Object.assign({ 'User-Agent': 'DJ64/1.4' }, headers), timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        resolve(request1(new URL(res.headers.location, u).toString(), headers, redirects + 1));
        return;
      }
      if (res.statusCode === 304) {
        res.resume();
        resolve({ status: 304, headers: res.headers, buf: null });
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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
  });
}

// Manche Anbieter sperren unbekannte Programme (z. B. mit seltsamen Codes wie 884).
// Darum: erst als VLC melden, bei HTTP-Fehlern die anderen Kennungen probieren und die passende merken.
// Gewählte Kennung (Einstellungen): bei VLC/DJ64/Chrome wird durchprobiert und die passende gemerkt,
// bei Kodi/Smarters/okhttp/Eigene gilt genau diese Kennung.
const uaSel = { mode: 'vlc', custom: '', learned: '' };
const uaList = () => logic.uaCandidates(uaSel.mode, uaSel.custom, uaSel.learned);
async function request(url, headers = {}) {
  url = String(url).replace(/\s+/g, '');
  if (headers['User-Agent']) return request1(url, headers);
  let last = null;
  const cands = uaList();
  for (let k = 0; k < cands.length; k++) {
    try {
      const r = await request1(url, Object.assign({}, headers, { 'User-Agent': cands[k].ua }));
      if (k > 0 && logic.CYCLE.includes(uaSel.mode)) uaSel.learned = cands[k].key;
      return r;
    } catch (e) {
      last = e;
      if (!/^HTTP \d+/.test(e.message || '')) throw e;
    }
  }
  const code = (last.message.match(/\d+/) || [''])[0];
  throw new Error(`${last.message} – der Anbieter lehnt die Anfrage ab (Konto abgelaufen, zu viele gleichzeitige Verbindungen, IP gesperrt oder falsche Zugangsdaten${code ? ', Code ' + code : ''})`);
}

async function getBuffer(url) {
  return (await request(url)).buf;
}

function maybeGunzip(buf) {
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
  return buf;
}

// ---------------------------------------------------------------- EPG (Zwischenspeicher + Worker)

const EPG_FRESH_MS = 6 * 3600e3;

function parseInWorker(raw, opts) {
  return new Promise((resolve, reject) => {
    let w;
    try {
      w = new Worker(path.join(__dirname, 'epg-worker.js'));
    } catch (e) {
      // Notlösung: im Hauptprozess parsen
      try {
        let b = raw;
        if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b);
        resolve(parseEpgBuffer(b, Date.now(), opts));
      } catch (err) {
        reject(err);
      }
      return;
    }
    w.once('message', (m) => {
      w.terminate();
      if (m.ok) resolve(m.res); else reject(new Error(m.error));
    });
    w.once('error', (e) => { w.terminate(); reject(e); });
    w.postMessage({ raw: new Uint8Array(raw), now: Date.now(), opts });
  });
}

async function epgLoad(url, opts) {
  opts = opts || {};
  const pid = Number(opts.pid) || 0;
  const file = path.join(app.getPath('userData'), `epg_${pid}.bin`);
  const metaFile = file + '.json';
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) { meta = {}; }
  const have = fs.existsSync(file) && meta.url === url;
  let raw = null;
  if (have && Date.now() - (meta.t || 0) < EPG_FRESH_MS) {
    raw = fs.readFileSync(file);
  } else {
    try {
      const h = {};
      if (have && meta.etag) h['If-None-Match'] = meta.etag;
      if (have && meta.lastMod) h['If-Modified-Since'] = meta.lastMod;
      const r = await request(url, h);
      if (r.status === 304 && have) {
        raw = fs.readFileSync(file);
        meta.t = Date.now();
      } else {
        raw = r.buf;
        meta = { url, etag: r.headers.etag || '', lastMod: r.headers['last-modified'] || '', t: Date.now() };
        try { fs.writeFileSync(file, raw); } catch (e) { /* egal */ }
      }
      try { fs.writeFileSync(metaFile, JSON.stringify(meta)); } catch (e) { /* egal */ }
    } catch (e) {
      if (have) raw = fs.readFileSync(file); // Netzfehler: alten Zwischenspeicher nutzen
      else throw e;
    }
  }
  return parseInWorker(raw, { ids: opts.ids, names: opts.names, arch: opts.arch });
}

// ---------------------------------------------------------------- Zugangsdaten verschlüsseln (Windows DPAPI über safeStorage)

function secretEnc(text) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return 'enc:' + safeStorage.encryptString(String(text)).toString('base64');
  } catch (e) {
    return null;
  }
}
function secretDec(text) {
  try {
    if (typeof text !== 'string' || !text.startsWith('enc:')) return null;
    return safeStorage.decryptString(Buffer.from(text.slice(4), 'base64'));
  } catch (e) {
    return null;
  }
}
ipcMain.on('secret-enc', (e, text) => { e.returnValue = secretEnc(text); });
ipcMain.on('secret-dec', (e, text) => { e.returnValue = secretDec(text); });

// ---------------------------------------------------------------- Kopfzeilen für einzelne Streams (User-Agent, Referer)

const headerRules = new Map(); // Herkunft (https://host:port) -> { ua, ref }
function originOf(u) {
  try { return new URL(u).origin; } catch (e) { return ''; }
}
function installHeaderHook() {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
    const r = headerRules.size ? headerRules.get(originOf(details.url)) : null;
    if (!r) {
      const h0 = Object.assign({}, details.requestHeaders);
      h0['User-Agent'] = uaList()[0].ua;
      cb({ requestHeaders: h0 });
      return;
    }
    const h = Object.assign({}, details.requestHeaders);
    if (r.ua) h['User-Agent'] = r.ua;
    if (r.ref) h.Referer = r.ref;
    cb({ requestHeaders: h });
  });
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

ipcMain.handle('epg-load', async (_e, url, opts) => epgLoad(url, opts));

const getJson = async (url) => JSON.parse(maybeGunzip(await getBuffer(url)).toString('utf8'));
ipcMain.handle('xtream-load', async (_e, a) => xtream.loadAll(String(a.base), String(a.user), String(a.pass), getJson));
ipcMain.handle('xtream-series', async (_e, a) => xtream.seriesInfo(String(a.base), String(a.user), String(a.pass), String(a.id), String(a.name || ''), getJson));
ipcMain.handle('set-ua', async (_e, mode, custom) => {
  uaSel.mode = String(mode || 'vlc');
  uaSel.custom = String(custom || '');
  uaSel.learned = '';
  return uaList()[0].ua;
});

function findVlc() {
  return new Promise((resolve) => {
    const hit = logic.vlcPaths(process.env).find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
    if (hit) return resolve(hit);
    if (process.platform !== 'win32') return resolve('');
    execFile('reg', ['query', 'HKLM\\SOFTWARE\\VideoLAN\\VLC', '/v', 'InstallDir'], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err) return resolve('');
      const m = /InstallDir\s+REG_SZ\s+(.+)/i.exec(String(out));
      const p = m ? path.join(m[1].trim(), 'vlc.exe') : '';
      resolve(p && fs.existsSync(p) ? p : '');
    });
  });
}

ipcMain.handle('play-external', async (_e, kind, o) => {
  const url = String((o && o.url) || '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'bad-url' };
  if (kind === 'system') {
    try { await shell.openExternal(url); return { ok: true, player: 'Windows-Standardplayer' }; } catch (e) { return { ok: false, reason: 'system' }; }
  }
  const exe = await findVlc();
  if (!exe) return { ok: false, reason: 'vlc-missing' };
  const ua = (o && o.ua) || uaList()[0].ua;
  try {
    const c = spawn(exe, logic.vlcArgs({ url, title: String(o.title || ''), ua, ref: String(o.ref || '') }), { detached: true, stdio: 'ignore', windowsHide: false });
    c.on('error', () => {});
    c.unref();
    return { ok: true, player: 'VLC' };
  } catch (e) {
    return { ok: false, reason: 'spawn' };
  }
});

ipcMain.handle('set-headers', async (_e, url, h) => {
  if (!h) { headerRules.clear(); return true; }
  const o = originOf(url);
  if (o) headerRules.set(o, { ua: String(h.ua || ''), ref: String(h.ref || '') });
  return true;
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

app.whenReady().then(() => {
  installHeaderHook();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
