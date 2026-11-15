'use strict';
// Reine Logik für Kennung (User-Agent), Stream-Format und externe Player (ohne Electron, testbar mit node).

const UA_MAP = {
  vlc: 'VLC/3.0.20 LibVLC/3.0.20',
  dj64: 'DJ64/1.5',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  kodi: 'Kodi/20.2 (Windows NT 10.0; Win64; x64)',
  smarters: 'IPTVSmartersPro',
  okhttp: 'okhttp/4.12.0'
};
const CYCLE = ['vlc', 'dj64', 'chrome'];

/**
 * Kennungen in Probierreihenfolge: [{ key, ua }].
 * VLC/DJ64/Chrome: gewählte (oder zuletzt erfolgreiche) zuerst, danach die anderen beiden.
 * Kodi/Smarters/okhttp/Eigene: genau diese eine Kennung.
 */
function uaCandidates(mode, custom, learned) {
  if (mode === 'custom') return [{ key: 'custom', ua: String(custom || '').trim() || UA_MAP.vlc }];
  if (!CYCLE.includes(mode)) {
    return UA_MAP[mode] ? [{ key: mode, ua: UA_MAP[mode] }] : [{ key: 'vlc', ua: UA_MAP.vlc }];
  }
  const first = CYCLE.includes(learned) ? learned : mode;
  return [first, ...CYCLE.filter((k) => k !== first)].map((k) => ({ key: k, ua: UA_MAP[k] }));
}

const LIVE_RE = /^(https?:\/\/.+?\/live\/[^/]+\/[^/]+\/\d+)\.\w+(.*)$/;

/** fmt: 0 = wie in der Liste, 1 = TS, 2 = HLS (m3u8). Nur Xtream-Live-Adressen. */
function rewriteLiveUrl(url, fmt) {
  if (!fmt) return url;
  const m = LIVE_RE.exec(url);
  if (!m) return url;
  return `${m[1]}.${fmt === 2 ? 'm3u8' : 'ts'}${m[2]}`;
}

function vlcPaths(env) {
  const out = [];
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.LOCALAPPDATA && env.LOCALAPPDATA + '\\Programs']) {
    if (base) out.push(base + '\\VideoLAN\\VLC\\vlc.exe');
  }
  out.push('C:\\Program Files\\VideoLAN\\VLC\\vlc.exe', 'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe');
  return [...new Set(out)];
}

function vlcArgs({ url, title, ua, ref }) {
  const a = [url];
  if (title) a.push('--meta-title=' + title);
  if (ua) a.push('--http-user-agent=' + ua);
  if (ref) a.push('--http-referrer=' + ref);
  return a;
}

module.exports = { UA_MAP, CYCLE, uaCandidates, rewriteLiveUrl, vlcPaths, vlcArgs };
