'use strict';

/* =====================================================================
   DJ64 für Windows – Oberfläche und Programmlogik
   ===================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errMsg = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

/* ---------------- Einstellungen (localStorage) ---------------- */

// Profile (Kunden): diese Schlüssel gelten je Profil (Profil 0 ohne Präfix, sonst p<id>_).
const PK = new Set(['url', 'server', 'user', 'pass', 'epg', 'fav', 'hidden', 'recent', 'last', 'resume']);
let PID = (() => {
  try { return Number(JSON.parse(localStorage.getItem('dj64.profile'))) || 0; } catch (e) { return 0; }
})();
const pk = (k) => (PID && PK.has(k) ? 'p' + PID + '_' + k : k);

const S = {
  get(k, d) {
    try {
      const v = localStorage.getItem('dj64.' + pk(k));
      return v === null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('dj64.' + pk(k), JSON.stringify(v));
    } catch (e) { /* voll oder gesperrt */ }
  },
  del(k) {
    try {
      localStorage.removeItem('dj64.' + pk(k));
    } catch (e) { /* egal */ }
  }
};

/* ---------------- Icons ---------------- */

const ICONS = {
  live: 'M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2zM10,16.5v-9l6,4.5 -6,4.5z',
  movie: 'M18,4l2,4h-3l-2,-4h-2l2,4h-3l-2,-4H8l2,4H7L5,4H4c-1.1,0 -1.99,0.9 -1.99,2L2,18c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V4h-4z',
  series: 'M4,6H2v14c0,1.1 0.9,2 2,2h14v-2H4V6zM20,2H8C6.9,2 6,2.9 6,4v12c0,1.1 0.9,2 2,2h12c1.1,0 2,-0.9 2,-2V4C22,2.9 21.1,2 20,2zM12,14.5v-9l6,4.5 -6,4.5z',
  settings: 'M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94 0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6 3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z',
  heart: 'M12,21.35l-1.45,-1.32C5.4,15.36 2,12.28 2,8.5 2,5.42 4.42,3 7.5,3c1.74,0 3.41,0.81 4.5,2.09C13.09,3.81 14.76,3 16.5,3 19.58,3 22,5.42 22,8.5c0,3.78 -3.4,6.86 -8.55,11.54L12,21.35z',
  user: 'M12,12c2.21,0 4,-1.79 4,-4s-1.79,-4 -4,-4 -4,1.79 -4,4 1.79,4 4,4zM12,14c-2.67,0 -8,1.34 -8,4v2h16v-2c0,-2.66 -5.33,-4 -8,-4z',
  search: 'M15.5,14h-0.79l-0.28,-0.27C15.41,12.59 16,11.11 16,9.5 16,5.91 13.09,3 9.5,3S3,5.91 3,9.5 5.91,16 9.5,16c1.61,0 3.09,-0.59 4.23,-1.57l0.27,0.28v0.79l5,4.99L20.49,19l-4.99,-5zM9.5,14C7.01,14 5,11.99 5,9.5S7.01,5 9.5,5 14,7.01 14,9.5 11.99,14 9.5,14z',
  refresh: 'M17.65,6.35C16.2,4.9 14.21,4 12,4c-4.42,0 -7.99,3.58 -7.99,8s3.57,8 7.99,8c3.73,0 6.84,-2.55 7.73,-6h-2.08c-0.82,2.33 -3.04,4 -5.65,4 -3.31,0 -6,-2.69 -6,-6s2.69,-6 6,-6c1.66,0 3.14,0.69 4.22,1.78L13,11h7V4l-2.35,2.35z',
  wifi: 'M1,9l2,2c4.97,-4.97 13.03,-4.97 18,0l2,-2C16.93,2.93 7.08,2.93 1,9zM9,17l3,3 3,-3c-1.65,-1.66 -4.34,-1.66 -6,0zM5,13l2,2c2.76,-2.76 7.24,-2.76 10,0l2,-2C15.14,9.14 8.87,9.14 5,13z',
  folder: 'M10,4H4C2.9,4 2.01,4.9 2.01,6L2,18c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V8c0,-1.1 -0.9,-2 -2,-2h-8l-2,-2z',
  trash: 'M6,19c0,1.1 0.9,2 2,2h8c1.1,0 2,-0.9 2,-2V7H6v12zM19,4h-3.5l-1,-1h-5l-1,1H5v2h14V4z',
  text: 'M9,4v3h5v12h3V7h5V4H9zM3,12h3v7h3v-7h3V9H3v3z',
  image: 'M21,19V5c0,-1.1 -0.9,-2 -2,-2H5c-1.1,0 -2,0.9 -2,2v14c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2zM8.5,13.5l2.5,3.01L14.5,12l4.5,6H5l3.5,-4.5z',
  calendar: 'M19,3h-1V1h-2v2H8V1H6v2H5C3.89,3 3.01,3.9 3.01,5L3,19c0,1.1 0.89,2 2,2h14c1.1,0 2,-0.9 2,-2V5C21,3.9 20.1,3 19,3zM19,19H5V8h14V19z',
  info: 'M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2zM13,17h-2v-6h2V17zM13,9h-2V7h2V9z',
  tune: 'M3,17v2h6v-2H3zM3,5v2h10V5H3zM13,21v-2h8v-2h-8v-2h-2v6h2zM7,9v2H3v2h4v2h2V9H7zM21,13v-2H11v2h10zM15,9h2V7h4V5h-4V3h-2v6z',
  home: 'M10,20v-6h4v6h5v-8h3L12,3 2,12h3v8z',
  play: 'M8,5v14l11,-7z',
  pause: 'M6,19h4V5H6v14zM14,5v14h4V5h-4z',
  back: 'M20,11H7.83l5.59,-5.59L12,4l-8,8 8,8 1.41,-1.41L7.83,13H20v-2z',
  fullscreen: 'M7,14H5v5h5v-2H7v-3zM5,10h2V7h3V5H5v5zM17,17h-3v2h5v-5h-2v3zM14,5v2h3v3h2V5h-5z',
  volume: 'M3,9v6h4l5,5V4L7,9H3zM16.5,12c0,-1.77 -1.02,-3.29 -2.5,-4.03v8.05c1.48,-0.73 2.5,-2.25 2.5,-4.02z',
  mute: 'M16.5,12c0,-1.77 -1.02,-3.29 -2.5,-4.03v2.21l2.45,2.45c0.03,-0.2 0.05,-0.41 0.05,-0.63zM19,12c0,0.94 -0.2,1.82 -0.54,2.64l1.51,1.51C20.63,14.91 21,13.5 21,12c0,-4.28 -2.99,-7.86 -7,-8.77v2.06c2.89,0.86 5,3.54 5,6.71zM4.27,3L3,4.27 7.73,9H3v6h4l5,5v-6.73l4.25,4.25c-0.67,0.52 -1.42,0.93 -2.25,1.18v2.06c1.38,-0.31 2.63,-0.95 3.69,-1.81L19.73,21 21,19.73l-9,-9L4.27,3zM12,4L9.91,6.09 12,8.18V4z',
  replay: 'M12,5V1L7,6l5,5V7c3.31,0 6,2.69 6,6s-2.69,6 -6,6 -6,-2.69 -6,-6H4c0,4.42 3.58,8 8,8s8,-3.58 8,-8 -3.58,-8 -8,-8z',
  aspect: 'M19,12h-2v3h-3v2h5v-5zM7,9h3V7H5v5h2V9zM21,3H3c-1.1,0 -2,0.9 -2,2v14c0,1.1 0.9,2 2,2h18c1.1,0 2,-0.9 2,-2V5c0,-1.1 -0.9,-2 -2,-2zM21,19.01H3V4.99h18v14.02z',
  next: 'M6,18l8.5,-6L6,6v12zM16,6v12h2V6h-2z',
  lock: 'M18,8h-1V6c0,-2.76 -2.24,-5 -5,-5S7,3.24 7,6v2H6c-1.1,0 -2,0.9 -2,2v10c0,1.1 0.9,2 2,2h12c1.1,0 2,-0.9 2,-2V10c0,-1.1 -0.9,-2 -2,-2zM12,17c-1.1,0 -2,-0.9 -2,-2s0.9,-2 2,-2 2,0.9 2,2 -0.9,2 -2,2zM15.1,8H8.9V6c0,-1.71 1.39,-3.1 3.1,-3.1 1.71,0 3.1,1.39 3.1,3.1v2z',
  sun: 'M6.76,4.84l-1.8,-1.79 -1.41,1.41 1.79,1.79 1.42,-1.41zM4,10.5H1v2h3v-2zM13,0.55h-2V3.5h2V0.55zM20.45,4.46l-1.41,-1.41 -1.79,1.79 1.41,1.41 1.79,-1.79zM17.24,18.16l1.79,1.8 1.41,-1.41 -1.8,-1.79 -1.4,1.4zM20,10.5v2h3v-2h-3zM12,5.5c-3.31,0 -6,2.69 -6,6s2.69,6 6,6 6,-2.69 6,-6 -2.69,-6 -6,-6zM11,22.45h2V19.5h-2v2.95zM3.55,18.54l1.41,1.41 1.79,-1.8 -1.41,-1.41 -1.79,1.8z'
};
const ic = (n, style = '') =>
  `<svg class="ic" viewBox="0 0 24 24" ${style ? `style="${style}"` : ''}><path d="${ICONS[n]}"/></svg>`;
const ibtn = (icon, act, title) =>
  `<button class="ibtn" data-act="${act}" title="${esc(title)}">${ic(icon)}</button>`;

/* ---------------- Zustand ---------------- */

const THEMES = [
  { name: 'DJ64 Blau-Gelb', accent: '#FFD400', bg: ['#0B1F4B', '#14307A', '#0B1F4B'] },
  { name: 'Mitternacht Violett', accent: '#B388FF', bg: ['#120B2E', '#2A1560', '#120B2E'] },
  { name: 'Dunkel Grün', accent: '#00E5A0', bg: ['#08201C', '#0F3D35', '#08201C'] },
  { name: 'Rubin Rot', accent: '#FF5A6E', bg: ['#2A0912', '#5C1424', '#2A0912'] },
  { name: 'Sonnenuntergang', accent: '#FF9A3D', bg: ['#2A1206', '#6A2E12', '#2A1206'] },
  { name: 'Ozean Cyan', accent: '#2DD4F0', bg: ['#04202B', '#0B4A5E', '#04202B'] },
  { name: 'Schwarz (OLED)', accent: '#7CF29A', bg: ['#000000', '#0B0B0D', '#000000'] },
  { name: 'Graphit Gold', accent: '#FFB300', bg: ['#16171B', '#2C2F38', '#16171B'] }
];
const FONTS = [
  { name: 'Modern', css: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif' },
  { name: 'Kompakt', css: 'Bahnschrift, "Segoe UI Semibold", "Arial Narrow", sans-serif' },
  { name: 'Klassisch', css: 'Arial, Helvetica, sans-serif' }
];
const SCALES = [{ name: 'Klein', v: 0.85 }, { name: 'Normal', v: 1 }, { name: 'Groß', v: 1.2 }, { name: 'Sehr groß', v: 1.4 }];
const RESIZES = ['Anpassen (Original-Format)', 'Gestreckt (Vollbild)', 'Zoom (Ränder abschneiden)'];
const FIT = ['contain', 'fill', 'cover'];
const SEEKS = [5, 10, 20, 30, 60];
const KIND_NAME = { live: 'Live-TV', movie: 'Filme', series: 'Serien' };

const state = {
  channels: [],
  counts: { live: 0, movie: 0, series: 0 },
  headerEpg: '',
  epg: null,
  screen: 'home',
  full: false,
  kind: 'live',
  cat: 0,
  query: '',
  cats: [],
  items: [],
  sel: 0,
  zone: 'cats',
  play: null,
  winFull: false,
  index: null,
  byUrl: null,
  sorted: {},
  folder: null,
  catLocked: false,
  unlockUntil: 0,
  wasUnlocked: false
};

/* ---------------- Zugangsdaten ---------------- */

function xtreamBase() {
  const s = String(S.get('server', '')).trim().replace(/\/+$/, '');
  const u = String(S.get('user', '')).trim();
  if (!s || !u) return null;
  return s.includes('://') ? s : 'http://' + s;
}
const usesXtream = () => xtreamBase() !== null;
function playlistUrl() {
  const b = xtreamBase();
  if (b) {
    return `${b}/get.php?username=${encodeURIComponent(String(S.get('user', '')).trim())}&password=${encodeURIComponent(String(S.get('pass', '')))}&type=m3u_plus&output=ts`;
  }
  return String(S.get('url', '')).trim();
}
function epgUrl() {
  const manual = String(S.get('epg', '')).trim();
  if (manual) return manual;
  const b = xtreamBase();
  if (b) return `${b}/xmltv.php?username=${encodeURIComponent(String(S.get('user', '')).trim())}&password=${encodeURIComponent(String(S.get('pass', '')))}`;
  return state.headerEpg;
}

/* ---------------- M3U ---------------- */

const SERIES_WORDS = ['serie', 'staffel', 'season', 'dizi', 'tv show'];
const MOVIE_WORDS = ['film', 'movie', 'vod', 'kino', 'cinema', 'sinema'];
const EP_TEST = /\bS\d{1,2}[ ._-]?E\d{1,3}\b|\b\d{1,2}x\d{2,3}\b/i;
const EP_RE = /^(.*?)[\s._\-–:|]*[\[(]?\b(?:S(\d{1,2})[ ._-]?E(\d{1,3})|(\d{1,2})x(\d{2,3}))\b/i;

function classify(url, group, name) {
  const u = url.toLowerCase();
  const g = group.toLowerCase();
  const path = u.split('?')[0];
  if (u.includes('/series/')) return 'series';
  if (u.includes('/movie/')) return 'movie';
  if (u.includes('/live/')) return 'live';
  if (name && EP_TEST.test(name)) return 'series';
  if (SERIES_WORDS.some((w) => g.includes(w))) return 'series';
  if (MOVIE_WORDS.some((w) => g.includes(w))) return 'movie';
  if (/\.(mp4|mkv|avi|mov|m4v)$/.test(path)) return 'movie';
  return 'live';
}

/** Zerlegt "Titel S01E02 – Name" in Serientitel, Staffel, Folge. */
function parseEpisode(name) {
  const m = EP_RE.exec(name);
  if (!m || !m[1].trim()) return null;
  return { sTitle: m[1].trim(), season: +(m[2] || m[4]), ep: +(m[3] || m[5]) };
}

function attr(line, name) {
  const re = /([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[1].toLowerCase() === name) return m[2];
  }
  return '';
}

function parseM3u(text) {
  const channels = [];
  let name = null;
  let group = '';
  let tvgId = '';
  let logo = '';
  let epg = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^﻿/, '');
    if (!line) continue;
    const up = line.slice(0, 8).toUpperCase();
    if (up.startsWith('#EXTM3U')) {
      epg = (attr(line, 'url-tvg') || attr(line, 'x-tvg-url')).split(',')[0];
    } else if (up.startsWith('#EXTINF')) {
      const lastQuote = line.lastIndexOf('"');
      const comma = line.indexOf(',', lastQuote >= 0 ? lastQuote : 0);
      name = comma >= 0 ? line.slice(comma + 1).trim() : '';
      group = attr(line, 'group-title');
      tvgId = attr(line, 'tvg-id');
      logo = attr(line, 'tvg-logo');
    } else if (up.startsWith('#EXTGRP')) {
      group = line.slice(line.indexOf(':') + 1).trim();
    } else if (!line.startsWith('#')) {
      const nm = name || line;
      const kind = classify(line, group, nm);
      const ch = { name: nm, url: line, group, kind, tvgId, logo };
      if (kind === 'series') {
        const e = parseEpisode(nm);
        if (e) Object.assign(ch, e);
      }
      channels.push(ch);
      name = null;
      group = '';
      tvgId = '';
      logo = '';
    }
  }
  return { channels, epg };
}

function setPlaylist(pl) {
  state.channels = pl.channels;
  state.headerEpg = pl.epg;
  const c = { live: 0, movie: 0, series: 0 };
  const idx = { live: [], movie: [], series: [] };
  const byUrl = new Map();
  for (const ch of pl.channels) {
    c[ch.kind]++;
    idx[ch.kind].push(ch);
    byUrl.set(ch.url, ch);
  }
  state.counts = c;
  state.index = idx;   // einmal nach Art sortiert, spart Filtern bei jedem Aufbau
  state.byUrl = byUrl;
  state.sorted = {};
  lockCache.clear();
}

const groupOf = (c) => c.group || 'Ohne Kategorie';
let favCache = null;
const favSet = () => favCache || (favCache = new Set(S.get('fav', [])));
const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
const sortMode = () => S.get('sort', 1); // 0 = Original, 1 = A–Z

function sortedKind(kind) {
  const key = kind + sortMode();
  if (!state.sorted[key]) {
    const list = (state.index && state.index[kind]) || [];
    state.sorted[key] = kind !== 'live' && sortMode() === 1 ? list.slice().sort((a, b) => collator.compare(a.name, b.name)) : list;
  }
  return state.sorted[key];
}

function visibleOfKind(kind) {
  const hidden = S.get('hidden', []);
  const list = sortedKind(kind);
  if (!hidden.length) return list;
  const h = new Set(hidden);
  return list.filter((c) => !h.has(groupOf(c)));
}

/* ---------------- Jugendschutz ---------------- */

const ADULT_RE = /\bxxx\b|adult|\b18\s?\+|\+\s?18|erotik|porn|\bsex|erwachsene|nsfw|ab 18|fsk ?18|playboy|hustler|dorcel|brazzers|yetişkin/i;
const lockCache = new Map();
const parentalOn = () => !!S.get('pc.on', false) && !!S.get('pc.hash', '');
const pcAuto = () => S.get('pc.auto', true);
const unlocked = () => Date.now() < (state.unlockUntil || 0);

function lockedGroup(g) {
  if (!parentalOn()) return false;
  let v = lockCache.get(g);
  if (v === undefined) {
    v = S.get('pc.manual', []).includes(g) || (pcAuto() && ADULT_RE.test(g));
    lockCache.set(g, v);
  }
  return v;
}
const isBlocked = (c) => parentalOn() && !unlocked() && (lockedGroup(groupOf(c)) || (pcAuto() && ADULT_RE.test(c.name)));
const pcChanged = () => lockCache.clear();

function sha256(str) {
  const bytes = new TextEncoder().encode(str);
  const K = [];
  for (let n = 2, c = 0; c < 64; n++) {
    let p = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; }
    if (p) { K[c++] = (Math.pow(n, 1 / 3) * 4294967296) | 0; }
  }
  const H = [];
  for (let n = 2, c = 0; c < 8; n++) {
    let p = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; }
    if (p) { H[c++] = (Math.pow(n, 1 / 2) * 4294967296) | 0; }
  }
  const l = bytes.length;
  const total = (((l + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 4, l * 8, false);
  const w = new Array(64);
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
const pinHash = (pin) => sha256('dj64' + pin);

function unlockNow() {
  state.unlockUntil = Date.now() + 30 * 60e3;
  state.wasUnlocked = true;
}

function pinWaitSec() {
  return Math.max(0, Math.ceil((S.get('pc.lockUntil', 0) - Date.now()) / 1000));
}

/** Fragt die PIN ab und ruft bei Erfolg onOk auf (nach dem Schließen des Dialogs). */
function askPin(title, onOk) {
  if (!parentalOn()) { onOk(); return; }
  const body = el('div');
  body.innerHTML = '<label>PIN</label><input type="password" id="pin" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="PIN eingeben"><div class="small" id="pinmsg" style="margin-top:.6rem;min-height:1.3rem"></div>';
  const inp = $('#pin', body);
  inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, ''); });
  openModal({
    title,
    body,
    buttons: [
      { label: 'Abbrechen' },
      {
        label: 'OK',
        primary: true,
        onClick: (m) => {
          const msg = $('#pinmsg', m);
          const wait = pinWaitSec();
          if (wait > 0) { msg.textContent = `Zu viele Versuche. Bitte ${wait} Sekunden warten.`; return false; }
          if (pinHash(inp.value) === S.get('pc.hash', '')) {
            S.set('pc.fail', 0);
            setTimeout(onOk, 0);
            return undefined;
          }
          const fails = S.get('pc.fail', 0) + 1;
          if (fails >= 5) {
            S.set('pc.fail', 0);
            S.set('pc.lockUntil', Date.now() + 60e3);
            msg.textContent = 'Falsche PIN. Eingabe 60 Sekunden gesperrt.';
          } else {
            S.set('pc.fail', fails);
            msg.textContent = `Falsche PIN (${fails}/5).`;
          }
          inp.value = '';
          inp.focus();
          return false;
        }
      }
    ]
  });
}
const askUnlock = (cb) => askPin('PIN eingeben', () => { unlockNow(); if (cb) cb(); });
/** Schützt den Zugriff (z. B. Einstellungen), wenn gewünscht. */
function gate(cb) {
  if (parentalOn() && S.get('pc.setlock', false) && !unlocked()) askUnlock(cb);
  else cb();
}

function setPinDialog(onOk) {
  const body = el('div');
  body.innerHTML = '<label>Neue PIN (4 bis 6 Ziffern)</label><input type="password" id="pin1" inputmode="numeric" maxlength="6" autocomplete="off"><label>PIN wiederholen</label><input type="password" id="pin2" inputmode="numeric" maxlength="6" autocomplete="off"><div class="small" id="pinmsg" style="margin-top:.6rem;min-height:1.3rem"></div>';
  body.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, ''); }));
  openModal({
    title: 'PIN festlegen',
    body,
    buttons: [
      { label: 'Abbrechen' },
      {
        label: 'Speichern',
        primary: true,
        onClick: (m) => {
          const a = $('#pin1', m).value;
          const b = $('#pin2', m).value;
          const msg = $('#pinmsg', m);
          if (!/^\d{4,6}$/.test(a)) { msg.textContent = 'Die PIN braucht 4 bis 6 Ziffern.'; return false; }
          if (a !== b) { msg.textContent = 'Die beiden Eingaben sind verschieden.'; return false; }
          S.set('pc.hash', pinHash(a));
          S.set('pc.on', true);
          S.set('pc.fail', 0);
          pcChanged();
          setTimeout(() => { if (onOk) onOk(); }, 0);
          return undefined;
        }
      }
    ]
  });
}

function showParental() {
  askPin('Jugendschutz', () => parentalMenu());
}

function parentalMenu() {
  const on = parentalOn();
  const rows = () => {
    const r = [{
      label: 'Jugendschutz', value: onOff(parentalOn()),
      pick: (back) => {
        if (!parentalOn()) setPinDialog(() => parentalMenu());
        else askPin('Jugendschutz ausschalten', () => { S.set('pc.on', false); S.del('pc.hash'); pcChanged(); state.unlockUntil = 0; toast('Jugendschutz aus', 2000); parentalMenu(); });
        void back;
      }
    }];
    if (parentalOn()) {
      r.push(
        { label: 'PIN ändern', value: '', pick: () => setPinDialog(() => toast('PIN geändert', 2000)) },
        { label: 'Erwachsenen-Kategorien automatisch sperren', value: onOff(pcAuto()), pick: (back) => { S.set('pc.auto', !pcAuto()); pcChanged(); back(); } },
        {
          label: 'Kategorien manuell sperren', value: S.get('pc.manual', []).length + ' gesperrt',
          pick: (back) => {
            const all = [...new Set(state.channels.map(groupOf))].sort((a, b) => collator.compare(a, b));
            if (!all.length) { toast('Zuerst die Playlist laden', 2500); back(); return; }
            const man = new Set(S.get('pc.manual', []));
            multiDialog('Gesperrte Kategorien', all, all.map((g) => man.has(g)), (checked) => {
              S.set('pc.manual', all.filter((_, i) => checked[i]));
              pcChanged();
              toast('Gespeichert', 2000);
              parentalMenu();
            }, { allLabel: 'Keine sperren', allValue: false });
          }
        },
        { label: 'Gesperrte Kategorien ausblenden', value: onOff(S.get('pc.hide', false)), pick: (back) => { S.set('pc.hide', !S.get('pc.hide', false)); back(); } },
        { label: 'Einstellungen mit PIN schützen', value: onOff(S.get('pc.setlock', false)), pick: (back) => { S.set('pc.setlock', !S.get('pc.setlock', false)); back(); } },
        unlocked()
          ? { label: 'Jetzt sperren', value: '', pick: () => { state.unlockUntil = 0; toast('Gesperrt', 2000); afterLockChange(); } }
          : { label: 'Jetzt entsperren (30 Minuten)', value: '', pick: () => { unlockNow(); toast('Entsperrt für 30 Minuten', 2500); } }
      );
    }
    return r;
  };
  void on;
  menuDialog('Jugendschutz', rows);
}

/** Nach dem Sperren: laufende gesperrte Wiedergabe beenden, Liste neu aufbauen. */
function afterLockChange() {
  if (state.full && cur && isBlocked(cur)) { exitFull(); stopStream(); }
  if (state.screen === 'browse') showBrowse(state.kind, 0, state.query);
}

function lockWatch() {
  if (state.wasUnlocked && !unlocked()) {
    state.wasUnlocked = false;
    afterLockChange();
    if (state.screen === 'settings') renderHome();
  }
}

/* ---------------- Serien-Ordner und Zuletzt gesehen ---------------- */

function folderize(items) {
  const map = new Map();
  const out = [];
  for (const c of items) {
    if (c.sTitle === undefined) { out.push(c); continue; }
    const key = groupOf(c) + '\u0001' + c.sTitle.toLowerCase();
    let f = map.get(key);
    if (!f) {
      f = { folder: true, name: c.sTitle, title: c.sTitle, group: c.group, kind: 'series', logo: c.logo, url: 'folder:' + key, eps: [], seas: new Set() };
      map.set(key, f);
      out.push(f);
    }
    f.eps.push(c);
    f.seas.add(c.season);
  }
  for (const f of map.values()) {
    f.eps.sort((a, b) => a.season - b.season || a.ep - b.ep || collator.compare(a.name, b.name));
    f.seasons = f.seas.size;
    if (!f.logo) f.logo = (f.eps.find((e) => e.logo) || {}).logo || '';
  }
  return out;
}

function pushRecent(ch) {
  if (!ch || ch.folder) return;
  const r = S.get('recent', []).filter((u) => u !== ch.url);
  r.unshift(ch.url);
  S.set('recent', r.slice(0, 30));
}
function recentItems(kind) {
  const hidden = new Set(S.get('hidden', []));
  return S.get('recent', []).map((u) => state.byUrl && state.byUrl.get(u)).filter((c) => c && c.kind === kind && !hidden.has(groupOf(c)) && !isBlocked(c));
}

/* ---------------- EPG ---------------- */

const normName = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function epgList(ch) {
  const e = state.epg;
  if (!e) return null;
  if (ch._ek === e) return ch._el;
  const r = epgLookup(ch, e);
  ch._ek = e;
  ch._el = r;
  return r;
}

function epgLookup(ch, e) {
  if (ch.tvgId && e.channels[ch.tvgId]) return e.channels[ch.tvgId];
  const variants = [ch.name, ch.name.replace(/^[^:]*:\s*/, ''), ch.name.replace(/\b(hd|fhd|uhd|4k|sd|raw)\b/gi, '')];
  for (const v of variants) {
    const id = e.names[normName(v)];
    if (id && e.channels[id]) return e.channels[id];
  }
  return null;
}

function upcoming(ch, now, n) {
  const l = epgList(ch);
  if (!l) return { cur: null, next: [] };
  const cur = l.find((p) => p[0] <= now && now < p[1]) || null;
  const after = cur ? cur[1] : now;
  return { cur, next: l.filter((p) => p[0] >= after).slice(0, n) };
}

const hm = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

async function loadEpg(verbose) {
  const pid = PID;
  const url = epgUrl();
  if (!url) {
    state.epg = null;
    if (verbose) toast('Keine EPG-Adresse vorhanden', 3000);
    return;
  }
  if (verbose) toast('EPG wird geladen …', 0);
  try {
    const res = await window.api.loadEpg(url);
    if (pid !== PID) return;
    state.epg = res;
    const n = Object.keys(state.epg.channels).length;
    toast(`EPG geladen: ${n} Sender`, 2500);
    if (state.screen === 'browse') {
      refreshRows();
      const ch = state.items[state.sel];
      if (ch) updatePane(ch);
    }
  } catch (e) {
    toast('EPG-Fehler: ' + errMsg(e), 4000);
  }
}

/* ---------------- Wetter (Open-Meteo, ohne Schlüssel) ---------------- */

const WCODES = {
  0: ['Klar', 'sun'], 1: ['Überwiegend klar', 'sun'], 2: ['Teils bewölkt', 'partly'], 3: ['Bedeckt', 'cloud'],
  45: ['Nebel', 'fog'], 48: ['Reifnebel', 'fog'],
  51: ['Leichter Nieselregen', 'rain'], 53: ['Nieselregen', 'rain'], 55: ['Starker Nieselregen', 'rain'],
  56: ['Gefrierender Niesel', 'rain'], 57: ['Gefrierender Niesel', 'rain'],
  61: ['Leichter Regen', 'rain'], 63: ['Regen', 'rain'], 65: ['Starker Regen', 'rain'],
  66: ['Gefrierender Regen', 'rain'], 67: ['Gefrierender Regen', 'rain'],
  71: ['Leichter Schneefall', 'snow'], 73: ['Schneefall', 'snow'], 75: ['Starker Schneefall', 'snow'], 77: ['Schneegriesel', 'snow'],
  80: ['Leichte Regenschauer', 'rain'], 81: ['Regenschauer', 'rain'], 82: ['Heftige Regenschauer', 'rain'],
  85: ['Schneeschauer', 'snow'], 86: ['Starke Schneeschauer', 'snow'],
  95: ['Gewitter', 'storm'], 96: ['Gewitter mit Hagel', 'storm'], 99: ['Schweres Gewitter', 'storm']
};
const CLOUD = 'M19.35,10.04C18.67,6.59 15.64,4 12,4 9.11,4 6.6,5.64 5.35,8.04 2.34,8.36 0,10.91 0,14c0,3.31 2.69,6 6,6h13c2.76,0 5,-2.24 5,-5 0,-2.64 -2.05,-4.78 -4.65,-4.96z';
const wInfo = (code) => WCODES[code] || ['Wetter', 'cloud'];

function wIcon(kind, px) {
  const wrap = (inner) => `<svg class="ic" viewBox="0 0 24 24" style="width:${px}px;height:${px}px">${inner}</svg>`;
  const cloud = (fill, tr) => `<path transform="${tr}" fill="${fill}" d="${CLOUD}"/>`;
  const sun = (tr) => `<path transform="${tr}" fill="#FFC83D" d="${ICONS.sun}"/>`;
  switch (kind) {
    case 'sun': return wrap(sun(''));
    case 'partly': return wrap(sun('translate(-1.5 -2) scale(.72)') + cloud('#EAF1FF', 'translate(4.5 5.5) scale(.8)'));
    case 'fog': return wrap(cloud('#C9D3E6', 'translate(1.5 0) scale(.85)') + '<path d="M3,17h18M5,20.5h14" stroke="#C9D3E6" stroke-width="1.8" stroke-linecap="round" fill="none"/>');
    case 'rain': return wrap(cloud('#C9D6EC', 'translate(1.5 -1) scale(.85)') + '<path d="M8,16.5l-1.2,3.2M12.5,16.5l-1.2,3.2M17,16.5l-1.2,3.2" stroke="#5EC8FF" stroke-width="1.9" stroke-linecap="round" fill="none"/>');
    case 'snow': return wrap(cloud('#D5DFF0', 'translate(1.5 -1) scale(.85)') + '<g fill="#fff"><circle cx="7.5" cy="18" r="1.3"/><circle cx="12" cy="20.2" r="1.3"/><circle cx="16.5" cy="18" r="1.3"/></g>');
    case 'storm': return wrap(cloud('#AEB9CF', 'translate(1.5 -1) scale(.85)') + '<path d="M12.8,13.5l-3.3,5h2.6l-1.2,4.2 4.4,-5.8h-2.7z" fill="#FFD43B"/>');
    default: return wrap(cloud('#DDE6F5', 'translate(1 2.5) scale(.95)'));
  }
}

const wxLoc = () => S.get('wx', null);
const wxName = () => (wxLoc() ? wxLoc().name : 'Ort wählen');

function weatherTileHtml() {
  const l = wxLoc();
  const w = state.weather;
  if (!l) return `${wIcon('partly', 46)}<div><div class="tname" style="text-align:left">Wetter</div><div class="tsub" style="text-align:left">Ort wählen</div></div>`;
  if (!w || !w.current) {
    return `${wIcon('cloud', 46)}<div><div class="tname" style="text-align:left">${esc(l.name)}</div><div class="tsub" style="text-align:left">${state.weatherErr ? 'Keine Daten' : 'Wird geladen …'}</div></div>`;
  }
  const [d, k] = wInfo(w.current.weather_code);
  return `${wIcon(k, 46)}<div><div class="tname" style="text-align:left">${Math.round(w.current.temperature_2m)}° · ${esc(l.name)}</div><div class="tsub" style="text-align:left">${esc(d)}</div></div>`;
}

function updateWeatherUI() {
  const t = $('#wx-tile');
  if (t) t.innerHTML = weatherTileHtml();
}

async function geoSearch(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=de&format=json`;
  const j = JSON.parse(await window.api.fetchText(url));
  return (j.results || []).map((r) => ({ name: r.name, admin: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude }));
}

async function loadWeather(force) {
  const l = wxLoc();
  if (!l) { updateWeatherUI(); return; }
  const unit = S.get('wunit', 'c') === 'f' ? 'f' : 'c';
  const key = `${l.lat},${l.lon},${unit}`;
  const c = S.get('wxcache', null);
  if (!force && c && c.key === key && Date.now() - c.t < 30 * 60e3) {
    state.weather = c.d;
    state.weatherErr = '';
    updateWeatherUI();
    return;
  }
  try {
    const extra = unit === 'f' ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${l.lat}&longitude=${l.lon}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=4' + extra;
    const j = JSON.parse(await window.api.fetchText(url));
    state.weather = j;
    state.weatherErr = '';
    S.set('wxcache', { t: Date.now(), key, d: j });
  } catch (e) {
    state.weatherErr = errMsg(e);
  }
  updateWeatherUI();
}

function showWeather() {
  const l = wxLoc();
  if (!l) { showWeatherLocation(); return; }
  const w = state.weather;
  const body = el('div');
  if (!w || !w.current) {
    body.innerHTML = `<div>${state.weatherErr ? 'Wetterdaten konnten nicht geladen werden: ' + esc(state.weatherErr) : 'Wird geladen …'}</div>`;
  } else {
    const c = w.current;
    const [d, k] = wInfo(c.weather_code);
    const wu = S.get('wunit', 'c') === 'f' ? 'mph' : 'km/h';
    const days = ((w.daily && w.daily.time) || []).map((day, i) => {
      const [dd, kk] = wInfo(w.daily.weather_code[i]);
      const name = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : new Date(day + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long' });
      const rain = w.daily.precipitation_probability_max ? w.daily.precipitation_probability_max[i] : null;
      return `<div style="display:flex;align-items:center;gap:.8rem;padding:.5rem 0;border-top:1px solid rgba(255,255,255,.1)">
        <div style="width:6.5rem">${esc(name)}</div>${wIcon(kk, 30)}
        <div style="flex:1" class="small">${esc(dd)}${rain != null ? ' · ' + rain + ' %' : ''}</div>
        <div>${Math.round(w.daily.temperature_2m_min[i])}° / ${Math.round(w.daily.temperature_2m_max[i])}°</div></div>`;
    }).join('');
    body.innerHTML = `<div style="display:flex;align-items:center;gap:1.2rem;margin-bottom:.9rem">${wIcon(k, 84)}
      <div><div style="font-size:3rem;font-weight:600;line-height:1">${Math.round(c.temperature_2m)}°</div>
      <div>${esc(d)} · ${esc(l.name)}</div>
      <div class="small">Gefühlt ${Math.round(c.apparent_temperature)}° · Wind ${Math.round(c.wind_speed_10m)} ${wu} · Luftfeuchte ${c.relative_humidity_2m} %</div></div></div>${days}`;
  }
  openModal({
    title: 'Wetter',
    body,
    buttons: [
      { label: 'Ort ändern', onClick: () => { setTimeout(showWeatherLocation, 0); } },
      { label: 'Aktualisieren', onClick: () => { loadWeather(true); } },
      { label: 'Schließen', primary: true }
    ]
  });
}

function showWeatherLocation() {
  const body = el('div');
  body.innerHTML = '<label>Stadt oder Ort</label><input type="text" id="f-city" placeholder="z. B. Hamburg"><div id="city-res" style="margin-top:.6rem"></div>';
  let api = null;
  const search = async (m) => {
    const q = $('#f-city', m).value.trim();
    if (!q) return;
    const box = $('#city-res', m);
    box.textContent = 'Suche …';
    try {
      const r = await geoSearch(q);
      box.innerHTML = '';
      if (!r.length) { box.textContent = 'Nichts gefunden.'; return; }
      r.forEach((x) => {
        const b = el('button', 'opt', `<span>${esc(x.name)}</span><span class="val">${esc([x.admin, x.country].filter(Boolean).join(', '))}</span>`);
        b.addEventListener('click', () => {
          S.set('wx', { name: x.name, lat: x.lat, lon: x.lon });
          S.del('wxcache');
          state.weather = null;
          api.close();
          loadWeather(true);
          if (state.screen === 'settings') renderSettings();
          toast('Ort gespeichert: ' + x.name, 2500);
        });
        box.appendChild(b);
      });
    } catch (e) {
      box.textContent = 'Fehler: ' + errMsg(e);
    }
  };
  api = openModal({
    title: 'Ort für das Wetter',
    body,
    buttons: [{ label: 'Abbrechen' }, { label: 'Suchen', primary: true, onClick: (m) => { search(m); return false; } }]
  });
}

function showWeatherSettings() {
  menuDialog('Wetter', () => [
    { label: 'Ort', value: wxName(), pick: () => showWeatherLocation() },
    {
      label: 'Einheit', value: S.get('wunit', 'c') === 'f' ? '°F (Fahrenheit)' : '°C (Celsius)',
      pick: (back) => { S.set('wunit', S.get('wunit', 'c') === 'f' ? 'c' : 'f'); S.del('wxcache'); loadWeather(true); back(); }
    },
    { label: 'Wetter anzeigen', value: '', pick: () => showWeather() }
  ]);
}

/* ---------------- Leistung, Puffer, Startanimation ---------------- */

const PDELAYS = [0.4, 0.65, 1, 1.5];
const RETRY_CHOICES = [3, 5, 10, Infinity];
const RETRY_NAMES = ['3 Versuche', '5 Versuche', '10 Versuche', 'Unbegrenzt'];
const ANIM_NAMES = ['Voll', 'Reduziert', 'Aus'];
const INTRO_MODES = ['full', 'short', 'off'];
const INTRO_NAMES = ['Voll (5,6 Sekunden)', 'Kurz (3,5 Sekunden)', 'Aus'];

const BUF = [
  {
    name: 'Klein (geringe Verzögerung)', stall: 10,
    ts: { enableStashBuffer: false, stashInitialSize: 128 * 1024, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 3, liveBufferLatencyMinRemain: 0.5, autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 30, autoCleanupMinBackwardDuration: 15 },
    hls: { maxBufferLength: 10, maxMaxBufferLength: 30, backBufferLength: 15, liveSyncDurationCount: 2 }
  },
  {
    name: 'Normal', stall: 15,
    ts: { enableStashBuffer: true, stashInitialSize: 192 * 1024, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 8, liveBufferLatencyMinRemain: 1.5, autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 60, autoCleanupMinBackwardDuration: 30 },
    hls: { maxBufferLength: 30, maxMaxBufferLength: 120, backBufferLength: 30, liveSyncDurationCount: 3 }
  },
  {
    name: 'Groß (stabiler)', stall: 20,
    ts: { enableStashBuffer: true, stashInitialSize: 1024 * 1024, liveBufferLatencyChasing: false, autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 90, autoCleanupMinBackwardDuration: 45 },
    hls: { maxBufferLength: 60, maxMaxBufferLength: 240, backBufferLength: 60, liveSyncDurationCount: 5 }
  },
  {
    name: 'Sehr groß (schwache Leitung)', stall: 30,
    ts: { enableStashBuffer: true, stashInitialSize: 2 * 1024 * 1024, liveBufferLatencyChasing: false, autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 120, autoCleanupMinBackwardDuration: 60 },
    hls: { maxBufferLength: 120, maxMaxBufferLength: 600, backBufferLength: 90, liveSyncDurationCount: 8 }
  }
];
let bufBoost = 0;
const maxRetries = () => (RETRY_CHOICES[S.get('retries', 1)] !== undefined ? RETRY_CHOICES[S.get('retries', 1)] : 5);
const bufLevel = () => Math.min(3, Math.max(0, S.get('buf', 1)) + bufBoost);
const bufCfg = () => BUF[bufLevel()];

function menuDialog(title, rowsFn) {
  const body = el('div');
  rowsFn().forEach((r) => {
    const b = el('button', 'opt', `<span>${esc(r.label)}</span><span class="val">${esc(r.value)}</span>`);
    b.addEventListener('click', () => {
      api.close();
      r.pick(() => menuDialog(title, rowsFn));
    });
    body.appendChild(b);
  });
  const api = openModal({ title, body, buttons: [{ label: 'Schließen' }] });
  return api;
}

function pickDialog(title, labels, cur, apply, back) {
  chooseDialog(title, labels, cur, (k) => { apply(k); if (back) back(); });
}

const onOff = (v) => (v ? 'An' : 'Aus');

function restartCurrent() {
  if (cur) {
    const ch = cur;
    cur = null;
    startStream(ch);
  }
}

async function showPerf() {
  try { state.hw = (await window.api.getPerf()).hw !== false; } catch (e) { state.hw = true; }
  menuDialog('Leistung', () => [
    {
      label: 'Puffergröße', value: BUF[S.get('buf', 1)].name,
      pick: (back) => pickDialog('Puffergröße', BUF.map((b) => b.name), S.get('buf', 1), (k) => { S.set('buf', k); restartCurrent(); }, back)
    },
    { label: 'Puffer bei Stockern automatisch vergrößern', value: onOff(S.get('bufauto', true)), pick: (back) => { S.set('bufauto', !S.get('bufauto', true)); back(); } },
    {
      label: 'Wiederverbindung bei Abbruch', value: RETRY_NAMES[S.get('retries', 1)],
      pick: (back) => pickDialog('Wiederverbindungsversuche', RETRY_NAMES, S.get('retries', 1), (k) => S.set('retries', k), back)
    },
    { label: 'Live-Vorschau in der Senderliste', value: onOff(S.get('preview', true)), pick: (back) => { S.set('preview', !S.get('preview', true)); back(); } },
    {
      label: 'Verzögerung der Vorschau', value: PDELAYS[S.get('pdelay', 0)] + ' s',
      pick: (back) => pickDialog('Verzögerung der Vorschau', PDELAYS.map((d) => d + ' Sekunden'), S.get('pdelay', 0), (k) => S.set('pdelay', k), back)
    },
    { label: 'Senderlogos laden', value: onOff(S.get('logos', true)), pick: (back) => { S.set('logos', !S.get('logos', true)); back(); } },
    {
      label: 'Animationen der Oberfläche', value: ANIM_NAMES[S.get('anim', 0)],
      pick: (back) => pickDialog('Animationen', ANIM_NAMES, S.get('anim', 0), (k) => { S.set('anim', k); applyLook(); }, back)
    },
    { label: 'Programmführer automatisch laden', value: onOff(S.get('epgauto', true)), pick: (back) => { S.set('epgauto', !S.get('epgauto', true)); back(); } },
    {
      label: 'Hardware-Beschleunigung (Neustart)', value: onOff(state.hw),
      pick: async (back) => {
        await window.api.setHw(!state.hw);
        state.hw = !state.hw;
        openModal({
          title: 'Neustart nötig',
          body: 'Die Änderung wird nach einem Neustart von DJ64 wirksam.',
          buttons: [{ label: 'Später', onClick: () => { back(); } }, { label: 'Jetzt neu starten', primary: true, onClick: () => { window.api.relaunch(); } }]
        });
      }
    },
    {
      label: 'Startanimation', value: INTRO_NAMES[INTRO_MODES.indexOf(S.get('intro', 'short'))] || INTRO_NAMES[0],
      pick: (back) => pickDialog('Startanimation', INTRO_NAMES, Math.max(0, INTRO_MODES.indexOf(S.get('intro', 'short'))), (k) => S.set('intro', INTRO_MODES[k]), back)
    },
    { label: 'Startanimation jetzt ansehen', value: '', pick: () => { startIntro(null, true); } }
  ]);
}

function showThemes() {
  const body = el('div', 'theme-grid');
  THEMES.forEach((t, i) => {
    const b = el('button', 'theme-card' + (i === S.get('theme', 0) ? ' on' : ''),
      `<span class="sw" style="background:linear-gradient(135deg,${t.bg[0]},${t.bg[1]} 55%,${t.bg[2]})"></span><span class="dot" style="background:${t.accent};color:${t.accent}"></span><span class="tn">${esc(t.name)}</span>`);
    b.addEventListener('click', () => {
      S.set('theme', i);
      applyLook();
      body.querySelectorAll('.theme-card').forEach((x, j) => x.classList.toggle('on', j === i));
    });
    body.appendChild(b);
  });
  openModal({ title: 'Farbschemata', body, buttons: [{ label: 'Fertig', primary: true }] });
}

let introSkip = null;
function startIntro(done, force) {
  const mode = force && S.get('intro', 'short') === 'off' ? 'full' : S.get('intro', 'short');
  const cv = $('#intro');
  if (mode === 'off' || !window.DJ64Intro || !cv) { if (done) done(); return; }
  const th = THEMES[S.get('theme', 0)] || THEMES[0];
  cv.classList.remove('hidden');
  cv.style.opacity = '1';
  introSkip = window.DJ64Intro.run(cv, { accent: th.accent, bg: th.bg[0], mode }, () => {
    cv.classList.add('hidden');
    introSkip = null;
    if (done) done();
  });
}

/* ---------------- Profile (Kunden) ---------------- */

const profileList = () => {
  const l = S.get('profiles', null);
  return Array.isArray(l) && l.length ? l : [{ id: 0, name: 'Standard' }];
};
const profileName = () => (profileList().find((p) => p.id === PID) || { name: 'Standard' }).name;
let profileBusy = 0;

async function switchProfile(id) {
  if (id === PID) return;
  saveResume();
  PID = id;
  localStorage.setItem('dj64.profile', JSON.stringify(id));
  favCache = null;
  state.epg = null;
  state.folder = null;
  state.query = '';
  stopStream();
  setPlaylist({ channels: [], epg: '' });
  renderHome();
  const my = ++profileBusy;
  try {
    const cached = await window.api.cacheRead(id);
    if (my === profileBusy && cached) {
      setPlaylist(parseM3u(cached));
      if (state.screen === 'home') renderHome();
    }
  } catch (e) { /* kein Cache */ }
  if (my !== profileBusy) return;
  toast('Profil: ' + profileName(), 2000);
  if (playlistUrl()) refreshPlaylist();
  else showAccount();
}

function promptName(title, value, cb) {
  const body = el('div');
  body.innerHTML = `<label>Name (z. B. Kunde)</label><input type="text" id="f-pname" value="${esc(value)}" maxlength="40">`;
  openModal({
    title,
    body,
    buttons: [{ label: 'Abbrechen' }, {
      label: 'OK', primary: true,
      onClick: (m) => {
        const v = $('#f-pname', m).value.trim();
        if (!v) return false;
        cb(v);
      }
    }]
  });
}

function showProfiles() {
  menuDialog('Profile (Kunden)', () => {
    const rows = profileList().map((p) => ({
      label: (p.id === PID ? '● ' : '○ ') + p.name,
      value: p.id === PID ? 'aktiv' : '',
      pick: () => { switchProfile(p.id); }
    }));
    rows.push({
      label: '＋ Neues Profil', value: '',
      pick: () => promptName('Neues Profil', '', (name) => {
        const l = profileList();
        const id = Math.max(...l.map((p) => p.id)) + 1;
        l.push({ id, name });
        S.set('profiles', l);
        switchProfile(id);
      })
    });
    rows.push({ label: 'Zugangsdaten bearbeiten', value: profileName(), pick: () => showAccount() });
    rows.push({
      label: 'Umbenennen', value: '',
      pick: () => promptName('Profil umbenennen', profileName(), (name) => {
        S.set('profiles', profileList().map((p) => (p.id === PID ? { id: p.id, name } : p)));
        if (state.screen === 'home') renderHome(); else if (state.screen === 'settings') renderSettings();
        showProfiles();
      })
    });
    rows.push({
      label: 'Aktives Profil löschen', value: '',
      pick: () => {
        const l = profileList();
        if (l.length < 2) { toast('Das letzte Profil kann nicht gelöscht werden', 3000); return; }
        openModal({
          title: 'Profil löschen?',
          body: `Profil „${esc(profileName())}“ mit Zugangsdaten, Favoriten und Zwischenspeicher wirklich löschen?`,
          buttons: [{ label: 'Abbrechen' }, {
            label: 'Löschen', primary: true,
            onClick: async () => {
              const id = PID;
              const rest = l.filter((p) => p.id !== id);
              S.set('profiles', rest);
              await switchProfile(rest[0].id);
              const pre = id ? `dj64.p${id}_` : 'dj64.';
              for (const k of PK) { try { localStorage.removeItem(pre + k); } catch (e) { /* egal */ } }
              try { await window.api.cacheDelete(id); } catch (e) { /* egal */ }
            }
          }]
        });
      }
    });
    return rows;
  });
}

/* ---------------- Film- & Serien-Wiedergabe ---------------- */

const SEEK_CHOICES = [5, 10, 15, 30, 60, 120, 300, 600];
const seekName = (s) => (s < 60 ? s + ' Sekunden' : s / 60 + (s === 60 ? ' Minute' : ' Minuten'));
const seekBack = () => S.get('seekB', S.get('seek', 10));
const seekFwd = () => S.get('seekF', S.get('seek', 10));
const RESUME_NAMES = ['Automatisch fortsetzen', 'Nachfragen', 'Aus'];

function showVodSettings() {
  menuDialog('Film- & Serien-Wiedergabe', () => [
    { label: 'Zurückspulen (Pfeil links)', value: seekName(seekBack()), pick: (back) => pickDialog('Zurückspulen', SEEK_CHOICES.map(seekName), SEEK_CHOICES.indexOf(seekBack()), (k) => S.set('seekB', SEEK_CHOICES[k]), back) },
    { label: 'Vorspulen (Pfeil rechts)', value: seekName(seekFwd()), pick: (back) => pickDialog('Vorspulen', SEEK_CHOICES.map(seekName), SEEK_CHOICES.indexOf(seekFwd()), (k) => S.set('seekF', SEEK_CHOICES[k]), back) },
    { label: 'Schneller spulen beim Gedrückthalten', value: onOff(S.get('seekAccel', true)), pick: (back) => { S.set('seekAccel', !S.get('seekAccel', true)); back(); } },
    { label: 'Wiedergabe fortsetzen', value: RESUME_NAMES[S.get('resumeMode', 1)], pick: (back) => pickDialog('Wiedergabe fortsetzen', RESUME_NAMES, S.get('resumeMode', 1), (k) => S.set('resumeMode', k), back) },
    { label: 'Gemerkte Positionen löschen', value: Object.keys(S.get('resume', {})).length + ' gemerkt', pick: (back) => { S.del('resume'); toast('Positionen gelöscht', 2000); back(); } }
  ]);
}

// Fortsetzen: Position je Adresse merken
function saveResume() {
  const ch = cur;
  if (!ch || ch.kind === 'live') return;
  const d = video.duration;
  const t = video.currentTime;
  if (!isFinite(d) || d <= 0 || !isFinite(t) || t < 1) return;
  const r = S.get('resume', {});
  if (d - t < 60 || t / d > 0.95) delete r[ch.url];
  else r[ch.url] = [Math.floor(t), Math.floor(d), Date.now()];
  const keys = Object.keys(r);
  if (keys.length > 200) {
    keys.sort((a, b) => r[a][2] - r[b][2]);
    keys.slice(0, keys.length - 200).forEach((k) => delete r[k]);
  }
  S.set('resume', r);
}

let pendingResume = null;
function applyResume() {
  const pr = pendingResume;
  pendingResume = null;
  if (!pr || !cur || cur.kind === 'live' || !isFinite(video.duration)) return;
  const goTo = (p) => { video.currentTime = Math.min(p, video.duration - 1); osd('▶ Weiter bei ' + mmss(p), 2500); };
  if (pr.force || S.get('resumeMode', 1) === 0) { goTo(pr.pos); return; }
  video.pause();
  let decided = false;
  const url = cur.url;
  const finish = (yes) => {
    if (decided) return;
    decided = true;
    if (!cur || cur.url !== url) return;
    if (yes) goTo(pr.pos);
    else { const r = S.get('resume', {}); delete r[url]; S.set('resume', r); }
    video.play().catch(() => {});
  };
  openModal({
    title: 'Fortsetzen?',
    body: `Fortsetzen ab ${mmss(pr.pos)}?`,
    onClose: () => finish(false),
    buttons: [{ label: 'Von vorn', onClick: () => finish(false) }, { label: 'Fortsetzen', primary: true, onClick: () => finish(true) }]
  });
}

/* ---------------- Hinweise ---------------- */

let toastTimer = 0;
function toast(text, ms = 2500) {
  const t = $('#toast');
  clearTimeout(toastTimer);
  if (!text) {
    t.classList.add('hidden');
    return;
  }
  t.textContent = text;
  t.classList.remove('hidden');
  if (ms > 0) toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ---------------- Aussehen ---------------- */

function applyLook() {
  const th = THEMES[S.get('theme', 0)] || THEMES[0];
  const r = document.documentElement.style;
  r.setProperty('--accent', th.accent);
  r.setProperty('--bg1', th.bg[0]);
  r.setProperty('--bg2', th.bg[1]);
  r.setProperty('--bg3', th.bg[2]);
  r.setProperty('--font', (FONTS[S.get('font', 0)] || FONTS[0]).css);
  r.fontSize = 16 * (S.get('scale', 1)) + 'px';
  const bg = $('#bg');
  const data = S.get('bgdata', '');
  if (data) {
    bg.style.backgroundImage = `url("${data}")`;
    bg.classList.add('image');
  } else {
    bg.style.backgroundImage = '';
    bg.classList.remove('image');
  }
  $('#video').style.objectFit = FIT[S.get('resize', 0)] || 'contain';
  document.body.dataset.anim = String(S.get('anim', 0));
}

/* =====================================================================
   Dialoge
   ===================================================================== */

let modals = [];

function openModal({ title, body, buttons, onClose }) {
  const bg = el('div', 'modal-bg');
  const m = el('div', 'modal');
  m.appendChild(el('h2', '', esc(title)));
  const mb = el('div', 'mbody');
  if (typeof body === 'string') mb.innerHTML = body;
  else mb.appendChild(body);
  m.appendChild(mb);
  const foot = el('div', 'mfoot');
  const api = {
    bg,
    m,
    close() {
      if (api.closed) return;
      api.closed = true;
      bg.remove();
      modals = modals.filter((x) => x !== api);
      focusHome();
      if (onClose) onClose();
    }
  };
  let primaryBtn = null;
  (buttons || []).forEach((b) => {
    const bt = el('button', 'btn' + (b.primary ? ' primary' : ''), esc(b.label));
    bt.addEventListener('click', () => {
      const keep = b.onClick ? b.onClick(m, api) : undefined;
      if (keep !== false) api.close();
    });
    if (b.primary) primaryBtn = bt;
    foot.appendChild(bt);
  });
  api.primary = primaryBtn;
  m.appendChild(foot);
  bg.appendChild(m);
  bg.addEventListener('mousedown', (e) => {
    if (e.target === bg) api.close();
  });
  $('#modal-root').appendChild(bg);
  modals.push(api);
  const first = m.querySelector('input, .opt.on, .opt') || primaryBtn || foot.querySelector('button');
  if (first) first.focus();
  return api;
}

function chooseDialog(title, labels, current, onPick, valueFor) {
  const body = el('div');
  labels.forEach((l, i) => {
    const b = el('button', 'opt' + (i === current ? ' on' : ''), `<span class="dot"></span><span>${esc(l)}</span>`);
    b.addEventListener('click', () => {
      onPick(i);
      api.close();
    });
    body.appendChild(b);
  });
  const api = openModal({ title, body, buttons: [{ label: 'Abbrechen' }] });
  return api;
}

function multiDialog(title, labels, checked, onSave, extra) {
  const body = el('div');
  const state2 = checked.slice();
  labels.forEach((l, i) => {
    const b = el('button', 'opt' + (state2[i] ? ' on' : ''), `<span class="box"></span><span>${esc(l)}</span>`);
    b.addEventListener('click', () => {
      state2[i] = !state2[i];
      b.classList.toggle('on', state2[i]);
    });
    body.appendChild(b);
  });
  const buttons = [
    { label: 'Abbrechen' },
    {
      label: (extra && extra.allLabel) || 'Alle zeigen',
      onClick: () => {
        onSave(labels.map(() => (extra && extra.allValue !== undefined ? extra.allValue : true)));
      }
    },
    { label: 'Speichern', primary: true, onClick: () => onSave(state2) }
  ];
  return openModal({ title, body, buttons });
}

function focusables(root) {
  return [...root.querySelectorAll('button, input, select')].filter((b) => !b.disabled && b.offsetParent !== null);
}

/** Pfeiltasten bewegen den Fokus zum nächsten Bedienelement in dieser Richtung. */
function moveFocus(root, key) {
  const items = focusables(root).filter((b) => b.tagName === 'BUTTON');
  const cur = document.activeElement;
  if (!items.includes(cur)) {
    if (items[0]) items[0].focus();
    return;
  }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let best = null;
  let bd = Infinity;
  for (const it of items) {
    if (it === cur) continue;
    const q = it.getBoundingClientRect();
    const dx = q.left + q.width / 2 - cx;
    const dy = q.top + q.height / 2 - cy;
    let prim;
    let sec;
    if (key === 'ArrowRight') { prim = dx; sec = Math.abs(dy); }
    else if (key === 'ArrowLeft') { prim = -dx; sec = Math.abs(dy); }
    else if (key === 'ArrowDown') { prim = dy; sec = Math.abs(dx); }
    else { prim = -dy; sec = Math.abs(dx); }
    if (prim < 8) continue;
    const dist = prim + sec * 2.2;
    if (dist < bd) {
      bd = dist;
      best = it;
    }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: 'nearest' });
  }
}

function focusHome() {
  if (modals.length || state.full) return;
  const root = $('#' + state.screen);
  if (!root || state.screen === 'browse') return;
  const f = root.querySelector('[data-act="live"], [data-focus]');
  if (f) f.focus();
}

/* =====================================================================
   Virtuelle Liste
   ===================================================================== */

class VList {
  constructor(host, rowH, build, rowClass) {
    this.host = host;
    this.rowH = rowH;
    this.build = build;
    this.rowClass = rowClass || '';
    this.items = [];
    this.sel = -1;
    host.classList.add('vlist');
    this.space = el('div', 'vspace');
    host.appendChild(this.space);
    host.addEventListener('scroll', () => this.render());
    new ResizeObserver(() => this.render(true)).observe(host);
    const idx = (e) => {
      const r = e.target.closest('.vrow');
      return r ? +r.dataset.i : -1;
    };
    host.addEventListener('click', (e) => { const i = idx(e); if (i >= 0 && this.onClick) this.onClick(i); });
    host.addEventListener('dblclick', (e) => { const i = idx(e); if (i >= 0 && this.onDbl) this.onDbl(i); });
    host.addEventListener('contextmenu', (e) => { const i = idx(e); if (i >= 0 && this.onCtx) { e.preventDefault(); this.onCtx(i); } });
  }

  setItems(items, keepScroll) {
    this.items = items;
    this.space.style.height = items.length * this.rowH + 'px';
    if (!keepScroll) this.host.scrollTop = 0;
    this.render(true);
  }

  render(force) {
    const top = this.host.scrollTop;
    const h = this.host.clientHeight || 600;
    const a = Math.max(0, Math.floor(top / this.rowH) - 4);
    const b = Math.min(this.items.length, Math.ceil((top + h) / this.rowH) + 4);
    if (!force && a === this.a && b === this.b) return;
    this.a = a;
    this.b = b;
    const frag = document.createDocumentFragment();
    for (let i = a; i < b; i++) {
      const r = el('div', 'vrow ' + this.rowClass + (i === this.sel ? ' sel' : ''));
      r.style.top = i * this.rowH + 'px';
      r.style.height = this.rowH + 'px';
      r.dataset.i = i;
      r.innerHTML = this.build(this.items[i], i);
      frag.appendChild(r);
    }
    this.space.replaceChildren(frag);
  }

  select(i, scroll = true) {
    this.sel = i;
    if (scroll && i >= 0) {
      const top = i * this.rowH;
      const h = this.host.clientHeight;
      if (top < this.host.scrollTop) this.host.scrollTop = top;
      else if (top + this.rowH > this.host.scrollTop + h) this.host.scrollTop = top + this.rowH - h;
    }
    this.render(true);
  }
}

document.addEventListener('error', (e) => {
  if (e.target && e.target.tagName === 'IMG') e.target.classList.add('none');
}, true);

/* =====================================================================
   Bildschirme
   ===================================================================== */

const SCREENS = ['home', 'browse', 'settings'];
function showScreen(name) {
  state.screen = name;
  SCREENS.forEach((s) => $('#' + s).classList.toggle('hidden', s !== name));
}

function rerender() {
  if (state.screen === 'home') renderHome();
  else if (state.screen === 'browse') showBrowse(state.kind, state.cat, state.query);
  else renderSettings();
}

/* ---------------- Startseite ---------------- */

let clockTimer = 0;
function tickClock() {
  const c = $('#clock');
  const d = $('#date');
  if (!c || !d) return;
  const now = new Date();
  c.textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  d.textContent = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function network() {
  return navigator.onLine ? 'Online' : 'Offline';
}

function renderHome() {
  showScreen('home');
  stopStream();
  const n = state.counts;
  const src = usesXtream() ? 'Xtream' : playlistUrl() ? 'M3U' : 'keine Playlist';
  $('#home').innerHTML = `
    <div class="topbar">
      <div class="grow"><div id="clock"></div><div id="date"></div></div>
      <button class="pchip" data-act="profile" title="Profile (Kunden)">● ${esc(profileName())}</button>
      ${ibtn('search', 'search', 'Suchen (Strg+F)')}
      ${ibtn('heart', 'favs', 'Favoriten')}
      ${ibtn('user', 'profile', 'Profile (Kunden)')}
      ${ibtn('refresh', 'refresh', 'Playlist aktualisieren')}
      ${ibtn('fullscreen', 'winfull', 'Vollbild (F11)')}
    </div>
    <div class="home-grid">
      <button class="tile big live" data-act="live">${ic('live')}<div class="tname">Live-TV</div><div class="tsub">${n.live} Sender</div></button>
      <div class="home-right">
        <div class="home-top">
          <button class="tile big movies" data-act="movie">${ic('movie')}<div class="tname">Filme</div><div class="tsub">${n.movie} Titel</div></button>
          <button class="tile big series" data-act="series">${ic('series')}<div class="tname">Serien</div><div class="tsub">${n.series} Folgen</div></button>
        </div>
        <div class="home-bot">
          <button class="tile row" data-act="favs">${ic('heart')}<div class="tname">Favoriten</div></button>
          <button class="tile row" data-act="settings">${ic('settings')}<div class="tname">Einstellungen</div></button>
          <button class="tile row" data-act="weather" id="wx-tile">${weatherTileHtml()}</button>
        </div>
      </div>
    </div>
    <div class="footline">${state.channels.length} Einträge  ·  ${network()}  ·  ${src}  ·  Tasten: Pfeile, Enter, Esc, F11 Vollbild, Strg+F Suche</div>`;
  tickClock();
  clearInterval(clockTimer);
  clockTimer = setInterval(tickClock, 15000);
  const f = $('#home [data-act="live"]');
  if (f && !modals.length) f.focus();
}

/* ---------------- Liste mit Kategorien ---------------- */

let catList = null;
let chanList = null;
let previewTimer = 0;

function buildCats() {
  const kind = state.kind;
  const items = visibleOfKind(kind);
  const favs = favSet();
  const counts = new Map();
  const seen = new Set();
  let nAll = 0;
  let nFav = 0;
  const hide = S.get('pc.hide', false);
  for (const c of items) {
    if (isBlocked(c)) { if (!counts.has(groupOf(c))) counts.set(groupOf(c), 0); continue; }
    const g = groupOf(c);
    let unit = 1;
    if (kind === 'series' && c.sTitle !== undefined) {
      const key = g + '\u0001' + c.sTitle.toLowerCase();
      if (seen.has(key)) unit = 0; else seen.add(key);
    }
    counts.set(g, (counts.get(g) || 0) + unit);
    nAll += unit;
    if (favs.has(c.url)) nFav++;
  }
  let groups = [...counts.keys()];
  if (sortMode() === 1) {
    groups.sort((a, b) => {
      const la = lockedGroup(a) || ADULT_RE.test(a);
      const lb = lockedGroup(b) || ADULT_RE.test(b);
      return la !== lb ? (la ? 1 : -1) : collator.compare(a, b);
    });
  }
  const cats = [
    { label: `Alle (${nAll})`, type: 'all' },
    { label: `★ Favoriten (${nFav})`, type: 'fav' },
    { label: `⏱ Zuletzt gesehen (${recentItems(kind).length})`, type: 'recent' }
  ];
  for (const g of groups) {
    const locked = lockedGroup(g) && !unlocked();
    if (locked && hide) continue;
    cats.push({ label: locked ? `🔒 ${g}` : `${g} (${counts.get(g) || 0})`, type: 'group', group: g, locked });
  }
  return cats;
}

function chanRow(c, i) {
  const fav = favSet().has(c.url);
  let sub = c.group;
  let name = c.name;
  if (c.folder) {
    name = c.title;
    sub = `${c.eps.length} ${c.eps.length === 1 ? 'Folge' : 'Folgen'} · ${c.seasons} ${c.seasons === 1 ? 'Staffel' : 'Staffeln'}`;
  } else if (state.folder && c.sTitle !== undefined) {
    sub = `Staffel ${c.season} · Folge ${c.ep}`;
  } else if (c.kind === 'live' && state.epg) {
    const { cur } = upcoming(c, Date.now(), 0);
    if (cur) sub = cur[2];
  }
  const logo = c.logo && S.get('logos', true)
    ? `<img class="logo" src="${esc(c.logo)}" loading="lazy" referrerpolicy="no-referrer">`
    : '<div class="logo none"></div>';
  return `<div class="num">${i + 1}</div>${logo}<div class="txt"><div class="nm">${fav ? '★ ' : ''}${c.folder ? '📁 ' : ''}${esc(name)}</div><div class="sb">${esc(sub)}</div></div>`;
}

function refreshRows() {
  if (chanList) chanList.render(true);
}

function showBrowse(kind, cat = 0, query = '', opts = {}) {
  showScreen('browse');
  state.kind = kind;
  state.cat = cat;
  state.query = query;
  state.folder = null;
  const live = kind === 'live';
  if (!live || !S.get('preview', true)) stopStream();
  clearTimeout(previewTimer);

  const root = $('#browse');
  root.innerHTML = `
    <div class="head">
      <h1 id="bh">${esc(KIND_NAME[kind])}${query ? ` · Suche: ${esc(query)}` : ''}</h1>
      ${ibtn('search', 'search', 'Suchen (Strg+F)')}
      ${ibtn('settings', 'settings', 'Einstellungen')}
      ${ibtn('fullscreen', 'winfull', 'Vollbild (F11)')}
      ${ibtn('home', 'home', 'Startseite (Esc)')}
    </div>
    <div class="browse-body ${live ? 'live' : 'vod'}">
      <div class="panel" id="p-cats"></div>
      <div class="panel" id="p-list"></div>
      ${live ? `<div class="panel pane" id="p-pane">
        <div id="slot"></div>
        <div class="pname" id="pn"></div><div class="ptime" id="pt"></div>
        <div class="pbar"><div id="pb"></div></div>
        <div class="pdesc" id="pd"></div><div class="pnext" id="px"></div>
      </div>` : ''}
    </div>
    <div class="hint">Enter oder Doppelklick = Abspielen / Ordner öffnen  ·  F oder Rechtsklick = Favorit  ·  Esc = zurück</div>`;

  state.cats = buildCats();
  const hasAny = visibleOfKind(kind).length > 0;
  if (!state.channels.length || !hasAny) {
    $('#p-list').innerHTML = `<div class="empty">Hier ist noch nichts. Trage unter Einstellungen → Zugangsdaten deine Playlist ein.</div>`;
    return;
  }

  catList = new VList($('#p-cats'), 46, (c) => `<div class="txt"><div class="nm">${esc(c.label)}</div></div>`, 'cat');
  chanList = new VList($('#p-list'), live ? 60 : 52, chanRow);
  catList.setItems(state.cats);
  state.cat = Math.min(cat, state.cats.length - 1);
  catList.select(state.cat);

  catList.onClick = (i) => { selectCat(i); enterCat(); };
  chanList.onClick = (i) => { setZone('list'); selectItem(i, false); };
  chanList.onDbl = (i) => { playFull(i); };
  chanList.onCtx = (i) => { toggleFav(state.items[i]); };

  const slot = $('#slot');
  if (slot) new ResizeObserver(() => placePlayer()).observe(slot);

  fillItems(opts.sel ?? 0);
  setZone(opts.zone || 'cats');
  if (live && opts.zone === 'list') schedulePreview();
  else if (live && cur) placePlayer();
}

function fillItems(sel = 0) {
  const kind = state.kind;
  const base = visibleOfKind(kind);
  const q = state.query.trim().toLowerCase();
  const cat = state.cats[state.cat];
  const free = (c) => !isBlocked(c);
  let items;
  state.catLocked = false;
  if (state.folder) items = state.folder.eps.filter(free);
  else if (q) items = base.filter((c) => free(c) && c.name.toLowerCase().includes(q));
  else if (!cat || cat.type === 'all') items = base.filter(free);
  else if (cat.type === 'fav') {
    const f = favSet();
    items = base.filter((c) => f.has(c.url) && free(c));
  } else if (cat.type === 'recent') items = recentItems(kind);
  else if (cat.locked) { items = []; state.catLocked = true; } else items = base.filter((c) => groupOf(c) === cat.group && free(c));
  if (kind === 'series' && !state.folder && !q && (!cat || cat.type === 'all' || cat.type === 'group')) items = folderize(items);
  state.items = items;
  const host = $('#p-list');
  if (host) {
    if (state.catLocked) host.dataset.msg = '🔒 Gesperrt – Enter drücken und PIN eingeben';
    else if (!items.length) host.dataset.msg = 'Hier ist nichts.';
    else delete host.dataset.msg;
  }
  const bh = $('#bh');
  if (bh) bh.textContent = KIND_NAME[kind] + (state.query ? ` · Suche: ${state.query}` : '') + (state.folder ? ` · ${state.folder.title}` : '');
  chanList.setItems(items);
  state.sel = Math.max(0, Math.min(sel, items.length - 1));
  chanList.select(items.length ? state.sel : -1);
  updatePane(items[state.sel]);
}

function openFolder(f, index) {
  state.folder = f;
  state.folderBack = { sel: index };
  fillItems(0);
  setZone('list');
}

function closeFolder() {
  const back = state.folderBack ? state.folderBack.sel : 0;
  state.folder = null;
  fillItems(back);
}

/** Enter/Klick auf eine kategorie: gesperrte erst nach PIN öffnen. */
function enterCat() {
  const cat = state.cats[state.cat];
  if (cat && cat.locked) {
    askUnlock(() => {
      state.cats = buildCats();
      const i = state.cats.findIndex((c) => c.type === 'group' && c.group === cat.group);
      state.cat = i >= 0 ? i : 0;
      catList.setItems(state.cats, true);
      catList.select(state.cat);
      fillItems(0);
      setZone('list');
    });
    return;
  }
  setZone('list');
}

function selectCat(i) {
  state.folder = null;
  state.cat = Math.max(0, Math.min(i, state.cats.length - 1));
  catList.select(state.cat);
  fillItems(0);
}

function selectItem(i, scroll = true) {
  if (!state.items.length) return;
  state.sel = Math.max(0, Math.min(i, state.items.length - 1));
  chanList.select(state.sel, scroll);
  updatePane(state.items[state.sel]);
  if (state.kind === 'live') schedulePreview();
}

function setZone(z) {
  state.zone = z;
  const pc = $('#p-cats');
  const pl = $('#p-list');
  if (pc) pc.classList.toggle('active', z === 'cats');
  if (pl) pl.classList.toggle('active', z === 'list');
  if (z === 'list' && state.kind === 'live' && state.screen === 'browse') schedulePreview();
}

function toggleFav(ch) {
  if (!ch || ch.folder) return;
  const f = new Set(favSet());
  let on;
  if (f.has(ch.url)) { f.delete(ch.url); on = false; } else { f.add(ch.url); on = true; }
  S.set('fav', [...f]);
  favCache = null;
  toast(on ? '★ Favorit gespeichert' : 'Favorit entfernt', 1500);
  if (state.screen === 'browse' && chanList) {
    state.cats = buildCats();
    catList.setItems(state.cats, true);
    catList.select(state.cat, false);
    if (state.cats[state.cat] && state.cats[state.cat].type === 'fav') fillItems(state.sel);
    else chanList.render(true);
  }
}

function updatePane(ch) {
  const pn = $('#pn');
  if (!pn) return;
  const pt = $('#pt');
  const pb = $('#pb');
  const pd = $('#pd');
  const px = $('#px');
  if (!ch) { pn.textContent = pt.textContent = pd.textContent = px.textContent = ''; pb.style.width = '0'; return; }
  pn.textContent = ch.name;
  if (!state.epg) {
    pt.textContent = 'Kein Programmführer geladen';
    pb.style.width = '0';
    pd.textContent = '';
    px.textContent = '';
    return;
  }
  const now = Date.now();
  const { cur, next } = upcoming(ch, now, 3);
  if (cur) {
    pt.textContent = `${hm(cur[0])} – ${hm(cur[1])}   ${cur[2]}`;
    pb.style.width = Math.max(0, Math.min(100, ((now - cur[0]) / Math.max(1, cur[1] - cur[0])) * 100)) + '%';
    pd.textContent = cur[3];
  } else {
    pt.textContent = 'Keine Sendungsinfo';
    pb.style.width = '0';
    pd.textContent = '';
  }
  px.textContent = next.map((p) => `${hm(p[0])}   ${p[2]}`).join('\n');
}

function schedulePreview() {
  clearTimeout(previewTimer);
  if (!S.get('preview', true)) return;
  previewTimer = setTimeout(() => {
    if (state.screen !== 'browse' || state.kind !== 'live' || state.full || state.zone !== 'list') return;
    const ch = state.items[state.sel];
    if (ch && !ch.folder && !isBlocked(ch)) startStream(ch);
  }, PDELAYS[S.get('pdelay', 0)] * 1000);
}

function showSearch(kind) {
  const k = kind || (state.screen === 'browse' ? state.kind : 'live');
  const body = el('div');
  body.innerHTML = `
    <label>Suchbegriff</label>
    <input type="text" id="q" placeholder="Name eingeben" value="${esc(state.screen === 'browse' ? state.query : '')}">
    <label>Bereich</label>
    <select id="qk" style="width:100%;padding:.55rem;border-radius:.5rem;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.22);font-size:1rem">
      ${['live', 'movie', 'series'].map((x) => `<option value="${x}" ${x === k ? 'selected' : ''}>${KIND_NAME[x]}</option>`).join('')}
    </select>`;
  openModal({
    title: 'Suchen',
    body,
    buttons: [
      { label: 'Abbrechen' },
      { label: 'Suchen', primary: true, onClick: (m) => { const q = $('#q', m).value.trim(); const kk = $('#qk', m).value; setTimeout(() => showBrowse(kk, 0, q, { zone: 'list' }), 0); } }
    ]
  });
}

/* ---------------- Einstellungen ---------------- */

function renderSettings() {
  showScreen('settings');
  stopStream();
  const t = (icon, title, sub, act) =>
    `<button class="tile" data-act="${act}">${ic(icon)}<div class="tname">${esc(title)}</div>${sub ? `<div class="tsub">${esc(sub)}</div>` : ''}</button>`;
  $('#settings').innerHTML = `
    <div class="head"><h1>Einstellungen</h1>${ibtn('fullscreen', 'winfull', 'Vollbild (F11)')}${ibtn('home', 'home', 'Startseite (Esc)')}</div>
    <div class="settings-grid">
      ${t('user', 'Profile (Kunden)', profileName(), 'profile')}
      ${t('user', 'Zugangsdaten', usesXtream() ? 'Xtream' : 'M3U-Wiedergabeliste', 'account')}
      ${t('refresh', 'Playlist aktualisieren', '', 'refresh')}
      ${t('folder', 'Kategorien verwalten', 'Ausblenden und einblenden', 'cats')}
      ${t('calendar', 'Programmführer (EPG)', state.epg ? Object.keys(state.epg.channels).length + ' Sender' : 'nicht geladen', 'epg')}
      ${t('tune', 'Player', 'Ton · Format', 'player')}
      ${t('play', 'Film- & Serien-Wiedergabe', 'Spulen · Pause · Fortsetzen', 'vod')}
      ${t('text', 'Darstellung', 'Größe · Schrift · Farbe', 'look')}
      ${t('image', 'Hintergrundbild', '', 'bg')}
      ${t('tune', 'Leistung', 'Puffer · Vorschau · Animation', 'perf')}
      ${t('image', 'Farbschemata', THEMES[S.get('theme', 0)].name, 'themes')}
      ${t('sun', 'Wetter', wxName(), 'weatherset')}
      ${t('play', 'Startanimation', 'Film-Intro', 'introset')}
      ${t('lock', 'Jugendschutz', parentalOn() ? 'PIN aktiv' : 'Aus', 'parental')}
      ${t('folder', 'Sortierung', sortMode() === 1 ? 'A–Z, Serien als Ordner' : 'Original', 'sortset')}
      ${t('trash', 'Cache leeren', '', 'cache')}
      ${t('info', 'Info und Tasten', 'Version 1.3', 'info')}
    </div>`;
  const f = $('#settings [data-act="account"]');
  if (f && !modals.length) f.focus();
}

function showAccount() {
  const body = el('div');
  body.innerHTML = `
    <div class="small">Xtream-Zugang (Server, Benutzername, Passwort)</div>
    <label>Server-URL</label><input type="text" id="f-server" placeholder="http://server.de:8080" value="${esc(S.get('server', ''))}">
    <label>Benutzername</label><input type="text" id="f-user" value="${esc(S.get('user', ''))}">
    <label>Passwort</label><input type="password" id="f-pass" value="${esc(S.get('pass', ''))}">
    <label><input type="checkbox" id="f-show"> Passwort anzeigen</label>
    <div class="small" style="margin-top:1rem">oder M3U-Wiedergabeliste (wird genutzt, wenn Server oder Benutzer leer ist)</div>
    <label>M3U-Adresse</label><input type="text" id="f-m3u" placeholder="http://…/playlist.m3u" value="${esc(S.get('url', ''))}">`;
  const api = openModal({
    title: 'Zugangsdaten',
    body,
    buttons: [
      { label: 'Abbrechen' },
      {
        label: 'Speichern', primary: true,
        onClick: (m) => {
          S.set('server', $('#f-server', m).value.trim());
          S.set('user', $('#f-user', m).value.trim());
          S.set('pass', $('#f-pass', m).value);
          S.set('url', $('#f-m3u', m).value.trim());
          if (playlistUrl()) refreshPlaylist();
          else toast('Keine Zugangsdaten eingetragen', 3000);
        }
      }
    ]
  });
  $('#f-show', api.m).addEventListener('change', (e) => { $('#f-pass', api.m).type = e.target.checked ? 'text' : 'password'; });
}

function showCats() {
  if (!state.channels.length) { toast('Zuerst die Playlist laden', 2500); return; }
  const all = [...new Set(state.channels.map(groupOf))].sort((a, b) => a.localeCompare(b, 'de'));
  const hidden = new Set(S.get('hidden', []));
  multiDialog('Sichtbare Kategorien', all, all.map((g) => !hidden.has(g)), (checked) => {
    S.set('hidden', all.filter((_, i) => !checked[i]));
    toast('Kategorien gespeichert', 2000);
  });
}

function showEpgDialog() {
  const auto = epgUrl();
  const body = el('div');
  body.innerHTML = `
    <div class="small">EPG-Adresse (XMLTV, auch .gz). Leer lassen, dann nutzt die App automatisch die Adresse aus der Playlist oder dem Xtream-Zugang.</div>
    <div style="margin:.7rem 0">Aktuell: ${auto ? 'gefunden' : 'keine'}${state.epg ? ` · ${Object.keys(state.epg.channels).length} Sender mit Programm` : ''}</div>
    <input type="text" id="f-epg" placeholder="leer = automatisch" value="${esc(S.get('epg', ''))}">`;
  openModal({
    title: 'Programmführer (EPG)',
    body,
    buttons: [
      { label: 'Abbrechen' },
      { label: 'Speichern und laden', primary: true, onClick: (m) => { S.set('epg', $('#f-epg', m).value.trim()); loadEpg(true); } }
    ]
  });
}

function showPlayerSettings() {
  const vols = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
  menuDialog('Player', () => [
    { label: 'Film- & Serien-Wiedergabe', value: 'Spulen · Fortsetzen', pick: () => showVodSettings() },
    { label: 'Standard-Lautstärke', value: S.get('volume', 100) + ' %', pick: (back) => pickDialog('Standard-Lautstärke', vols.map((v) => v + ' %'), vols.indexOf(S.get('volume', 100)), (k) => { S.set('volume', vols[k]); $('#video').volume = vols[k] / 100; }, back) },
    { label: 'Bildschirmformat', value: RESIZES[S.get('resize', 0)], pick: (back) => pickDialog('Bildschirmformat', RESIZES, S.get('resize', 0), (k) => { S.set('resize', k); applyLook(); }, back) }
  ]);
}

function showLook() {
  const body = el('div');
  const rows = [
    [`Größe der Darstellung: ${SCALES.find((s) => s.v === S.get('scale', 1))?.name || 'Normal'}`, () => chooseDialog('Größe der Darstellung', SCALES.map((s) => s.name), Math.max(0, SCALES.findIndex((s) => s.v === S.get('scale', 1))), (k) => { S.set('scale', SCALES[k].v); applyLook(); showLook(); })],
    [`Schriftstil: ${FONTS[S.get('font', 0)].name}`, () => chooseDialog('Schriftstil', FONTS.map((f) => f.name), S.get('font', 0), (k) => { S.set('font', k); applyLook(); showLook(); })],
    [`Farbschema: ${THEMES[S.get('theme', 0)].name}`, () => chooseDialog('Farbschema', THEMES.map((t) => t.name), S.get('theme', 0), (k) => { S.set('theme', k); applyLook(); showLook(); })]
  ];
  rows.forEach(([label, fn]) => {
    const b = el('button', 'opt', esc(label));
    b.addEventListener('click', () => { api.close(); fn(); });
    body.appendChild(b);
  });
  const api = openModal({ title: 'Darstellung', body, buttons: [{ label: 'Schließen' }] });
}

/* ---------------- Hintergrundbild ---------------- */

function showBgMenu() {
  const body = el('div');
  const entries = [
    ['Bild aus Datei wählen', pickBgFile],
    ['Bild von Internet-Adresse laden', bgFromUrl],
    ['Standard-Hintergrund wiederherstellen', () => { S.del('bgdata'); applyLook(); toast('Standard-Hintergrund aktiv', 2000); }]
  ];
  entries.forEach(([l, fn]) => {
    const b = el('button', 'opt', esc(l));
    b.addEventListener('click', () => { api.close(); fn(); });
    body.appendChild(b);
  });
  const api = openModal({ title: 'Hintergrundbild', body, buttons: [{ label: 'Schließen' }] });
}

function setBackgroundFromSrc(src) {
  const img = new Image();
  img.onload = () => {
    const W = 1920;
    const H = 1080;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const k = Math.max(W / img.width, H / img.height);
    const w = img.width * k;
    const h = img.height * k;
    g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    const data = c.toDataURL('image/jpeg', 0.85);
    S.set('bgdata', data);
    if (S.get('bgdata', '') !== data) toast('Bild ist zu groß zum Speichern', 4000);
    else toast('Hintergrundbild gesetzt', 2500);
    applyLook();
  };
  img.onerror = () => toast('Das Bild konnte nicht gelesen werden', 4000);
  img.src = src;
}

function pickBgFile() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.addEventListener('change', () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setBackgroundFromSrc(r.result);
    r.readAsDataURL(f);
  });
  inp.click();
}

function bgFromUrl() {
  const body = el('div');
  body.innerHTML = `<label>Internet-Adresse des Bildes</label><input type="text" id="f-bg" placeholder="https://…/bild.jpg">`;
  openModal({
    title: 'Bild laden',
    body,
    buttons: [
      { label: 'Abbrechen' },
      {
        label: 'Laden', primary: true,
        onClick: async (m) => {
          const url = $('#f-bg', m).value.trim();
          if (!url) return;
          toast('Bild wird geladen …', 0);
          try {
            const b64 = await window.api.fetchImage(url);
            setBackgroundFromSrc('data:image/jpeg;base64,' + b64);
          } catch (e) {
            toast('Bild-Fehler: ' + errMsg(e), 4000);
          }
        }
      }
    ]
  });
}

function showInfo() {
  const n = state.counts;
  let host = '';
  try { host = new URL(playlistUrl()).host; } catch (e) { host = ''; }
  openModal({
    title: 'DJ64 für Windows 1.3',
    body: `<div>Live-TV: ${n.live} &nbsp; Filme: ${n.movie} &nbsp; Serien: ${n.series}<br>Favoriten: ${favSet().size}<br>Quelle: ${usesXtream() ? 'Xtream: ' + esc(host) + ' (Benutzer ' + esc(S.get('user', '')) + ')' : host ? 'M3U: ' + esc(host) : '(keine)'}</div>
    <div class="small" style="margin-top:1rem;line-height:1.7">
      <b>In der Liste</b><br>
      Pfeile = auswählen · Links/Rechts = Kategorien/Liste · Enter = Abspielen · F = Favorit · Strg+F = Suche · Esc = zurück<br>
      <b>Beim Abspielen</b><br>
      Live: Hoch/Runter = Sender wechseln · Film/Serie: Links/Rechts = Spulen, Hoch/Runter = Lautstärke<br>
      Serien: Enter öffnet den Ordner einer Serie, Esc schließt ihn<br>
      Leertaste = Pause · M = Ton aus · A = Bildformat · I = Info · F11 = Vollbild · Esc = zurück
    </div>`,
    buttons: [{ label: 'OK', primary: true }]
  });
}

/* ---------------- Playlist laden ---------------- */

async function refreshPlaylist() {
  const url = playlistUrl();
  if (!url) { showAccount(); return; }
  const pid = PID;
  toast('Playlist wird geladen …', 0);
  try {
    const text = await window.api.fetchText(url);
    const pl = parseM3u(text);
    if (!pl.channels.length) throw new Error('Keine Einträge in der Playlist gefunden');
    await window.api.cacheWrite(text, pid);
    if (pid !== PID) return;
    setPlaylist(pl);
    toast(`${pl.channels.length} Einträge geladen`, 2500);
    if (state.screen !== 'browse' || !state.items.length) rerender();
    if (S.get('epgauto', true)) loadEpg(false);
  } catch (e) {
    if (pid !== PID) return;
    toast('Playlist-Fehler: ' + errMsg(e) + (state.channels.length ? ' (gespeicherte Liste bleibt aktiv)' : ''), 6000);
  }
}

/* =====================================================================
   Player
   ===================================================================== */

const video = $('#video');
const playerEl = $('#player');
let cur = null;           // aktuell geladener Eintrag
let mp = null;            // mpegts.js
let hls = null;           // hls.js
let loadToken = 0;
let watchdog = 0;
let retryTimer = 0;
let retries = 0;
let playedOnce = false;
let engineOrder = [];
let osdTimer = 0;
let ctlTimer = 0;

function engineOrderFor(ch) {
  const p = ch.url.split('?')[0].toLowerCase();
  if (/\.(m3u8|m3u)$/.test(p)) return ['hls', 'native'];
  if (/\.(mp4|webm|m4v|mov|mkv|avi)$/.test(p)) return ['native'];
  return ['ts', 'hls', 'native'];
}

function destroyEngine() {
  clearTimeout(watchdog);
  if (mp) {
    try { mp.pause(); mp.unload(); mp.detachMediaElement(); mp.destroy(); } catch (e) { /* egal */ }
    mp = null;
  }
  if (hls) {
    try { hls.destroy(); } catch (e) { /* egal */ }
    hls = null;
  }
  video.removeAttribute('src');
  try { video.load(); } catch (e) { /* egal */ }
}

function osd(text, ms = 2000) {
  const o = $('#osd');
  clearTimeout(osdTimer);
  if (!text) { o.classList.add('hidden'); return; }
  o.textContent = text;
  o.classList.remove('hidden');
  if (ms > 0) osdTimer = setTimeout(() => o.classList.add('hidden'), ms);
}

function startStream(ch) {
  if (cur && cur.url === ch.url && (mp || hls || video.src)) { placePlayer(); return; }
  saveResume();
  cur = ch;
  retries = 0;
  bufBoost = 0;
  pendingResume = null;
  if (ch.kind !== 'live' && S.get('resumeMode', 1) !== 2) {
    const e = S.get('resume', {})[ch.url];
    if (e && e[0] > 10) pendingResume = { pos: e[0], force: false };
  }
  loadToken++;
  clearTimeout(retryTimer);
  engineOrder = engineOrderFor(ch);
  playerEl.classList.remove('hidden');
  playerEl.classList.toggle('live-mode', ch.kind === 'live');
  placePlayer();
  osd('Lade …', 0);
  tryEngine(0, loadToken);
}

function tryEngine(i, token) {
  if (token !== loadToken || !cur) return;
  if (i >= engineOrder.length) { scheduleRetry(token); return; }
  destroyEngine();
  playedOnce = false;
  const kind = engineOrder[i];
  const fail = () => {
    if (token !== loadToken) return;
    if (playedOnce) scheduleRetry(token);
    else tryEngine(i + 1, token);
  };
  video.volume = S.get('volume', 100) / 100;
  try {
    if (kind === 'ts') {
      if (!window.mpegts || !mpegts.getFeatureList().mseLivePlayback) { fail(); return; }
      mp = mpegts.createPlayer(
        { type: 'mpegts', isLive: cur.kind === 'live', url: cur.url },
        Object.assign({ enableWorker: true }, bufCfg().ts)
      );
      mp.on(mpegts.Events.ERROR, fail);
      mp.attachMediaElement(video);
      mp.load();
      const p = mp.play();
      if (p && p.catch) p.catch(() => {});
    } else if (kind === 'hls') {
      if (!window.Hls || !Hls.isSupported()) { fail(); return; }
      hls = new Hls(Object.assign({ enableWorker: true }, bufCfg().hls));
      hls.on(Hls.Events.ERROR, (_e, d) => { if (d && d.fatal) fail(); });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      hls.loadSource(cur.url);
      hls.attachMedia(video);
    } else {
      video.src = cur.url;
      video.play().catch(() => {});
    }
  } catch (e) {
    fail();
    return;
  }
  clearTimeout(watchdog);
  watchdog = setTimeout(() => { if (!playedOnce) fail(); }, 14000);
  video.onerror = fail;
}

function scheduleRetry(token) {
  if (token !== loadToken) return;
  if (cur && cur.kind !== 'live' && isFinite(video.currentTime) && video.currentTime > 5) pendingResume = { pos: video.currentTime, force: true };
  destroyEngine();
  if (retries < maxRetries()) {
    retries++;
    osd(`Verbindung unterbrochen – neuer Versuch ${retries}/${isFinite(maxRetries()) ? maxRetries() : '∞'} …`, 0);
    retryTimer = setTimeout(() => {
      if (token !== loadToken || !cur) return;
      loadToken++;
      tryEngine(0, loadToken);
    }, 3000);
  } else {
    osd('Nicht erreichbar. Mit Esc zurück zur Liste.', 0);
  }
}

video.addEventListener('playing', () => {
  clearStall();
  const first = !playedOnce;
  playedOnce = true;
  if (first && pendingResume) applyResume();
  retries = 0;
  clearTimeout(watchdog);
  // Nach Spulen/Pufferung nur Lade-Hinweise entfernen, Spul-Rückmeldung bleibt stehen.
  if (first || (Date.now() - lastSeekAt > 2000 && /Puffer|Lade|Verbindung/.test($('#osd').textContent))) { if (state.full) showNowInfo(); else osd(null); }
});
let stallTimer = 0;
let slowTimer = 0;
function clearStall() {
  clearTimeout(stallTimer);
  clearTimeout(slowTimer);
}
video.addEventListener('waiting', () => {
  if (!playedOnce) return;
  if (Date.now() - lastSeekAt > 2000) osd('Puffer füllt sich …', 0);
  clearStall();
  // Bei wiederholtem Stocken den Puffer automatisch eine Stufe vergrößern.
  slowTimer = setTimeout(() => {
    if (S.get('bufauto', true) && bufLevel() < 3 && cur) {
      bufBoost++;
      osd('Puffer wird vergrößert: ' + bufCfg().name, 3000);
      loadToken++;
      tryEngine(0, loadToken);
    }
  }, 4000);
  // Bleibt der Puffer dauerhaft leer, wird die Verbindung erneuert.
  stallTimer = setTimeout(() => {
    if (cur) scheduleRetry(loadToken);
  }, bufCfg().stall * 1000);
});
video.addEventListener('timeupdate', updateSeekBar);
video.addEventListener('durationchange', updateSeekBar);
video.addEventListener('play', syncPlayBtn);
video.addEventListener('pause', syncPlayBtn);
function syncPauseUi() {
  const live = cur && cur.kind === 'live';
  $('#pause-ico').classList.toggle('hidden', !(state.full && video.paused && !live && playedOnce));
}
video.addEventListener('pause', () => { syncPauseUi(); if (state.full) showControls(); saveResume(); });
video.addEventListener('play', syncPauseUi);
setInterval(() => { if (!video.paused) saveResume(); }, 10000);
window.addEventListener('beforeunload', saveResume);
window.addEventListener('pagehide', saveResume);

function stopStream() {
  saveResume();
  loadToken++;
  clearTimeout(retryTimer);
  clearTimeout(previewTimer);
  destroyEngine();
  cur = null;
  playerEl.classList.add('hidden');
  playerEl.classList.remove('full');
  state.full = false;
  $('#controls').classList.add('hidden');
  osd(null);
}

function placePlayer() {
  if (state.full) return;
  const slot = $('#slot');
  if (!slot || state.screen !== 'browse' || state.kind !== 'live') return;
  const r = slot.getBoundingClientRect();
  playerEl.style.left = r.left + 'px';
  playerEl.style.top = r.top + 'px';
  playerEl.style.width = r.width + 'px';
  playerEl.style.height = r.height + 'px';
}
window.addEventListener('resize', placePlayer);

/* ---------------- Vollbild-Wiedergabe ---------------- */

function playFull(index) {
  const ch = state.items[index];
  if (!ch) return;
  if (ch.folder) { openFolder(ch, index); return; }
  if (isBlocked(ch)) { askUnlock(() => fillItems(state.sel)); return; }
  const list = state.items.filter((c) => !c.folder);
  state.sel = index;
  state.play = { list, idx: list.indexOf(ch) };
  S.set('last', ch.url);
  pushRecent(ch);
  if (chanList) chanList.select(index);
  updatePane(ch);
  clearTimeout(previewTimer);
  const same = cur && cur.url === ch.url && playedOnce;
  setFull(true);
  if (!same) startStream(ch);
  else showNowInfo();
  buildControls();
  showControls();
}

function setFull(on) {
  state.full = on;
  playerEl.classList.toggle('full', on);
  if (!on) {
    $('#controls').classList.add('hidden');
    playerEl.style.cursor = '';
    placePlayer();
  }
}

function exitFull() {
  if (!state.full) return;
  setFull(false);
  clearTimeout(ctlTimer);
  if (state.kind !== 'live') stopStream();
  else if (state.play) { const pi = state.items.indexOf(state.play.list[state.play.idx]); selectItem(pi >= 0 ? pi : state.sel); setZone('list'); }
  osd(null);
}

function zap(d) {
  const p = state.play;
  if (!p || !p.list.length) return;
  let idx = p.idx;
  let tries = p.list.length;
  do {
    idx = (idx + d + p.list.length) % p.list.length;
    tries--;
  } while (tries > 0 && isBlocked(p.list[idx]));
  if (isBlocked(p.list[idx])) return;
  p.idx = idx;
  const ch = p.list[idx];
  S.set('last', ch.url);
  pushRecent(ch);
  const si = state.items.indexOf(ch);
  if (chanList && si >= 0) { state.sel = si; chanList.select(si); }
  updatePane(ch);
  startStream(ch);
  osd(ch.name, 3000);
  buildControls();
  showControls();
}

function showNowInfo() {
  const ch = cur;
  if (!ch) return;
  let t = ch.name;
  if (ch.kind === 'live' && state.epg) {
    const { cur: c, next } = upcoming(ch, Date.now(), 1);
    if (c) t += `\nJetzt: ${hm(c[0])}–${hm(c[1])}  ${c[2]}`;
    if (next[0]) t += `\nDanach: ${hm(next[0][0])}  ${next[0][2]}`;
  }
  osd(t, 5000);
}

const mmss = (s) => {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
};

function updateSeekBar() {
  if (!state.full) return;
  const d = video.duration;
  const rng = $('#ctl-range');
  if (isFinite(d) && d > 0) {
    if (document.activeElement !== rng) rng.value = Math.round((video.currentTime / d) * 1000);
    $('#ctl-pos').textContent = mmss(video.currentTime);
    $('#ctl-dur').textContent = mmss(d);
  }
}

function syncPlayBtn() {
  const b = $('#btn-play');
  if (b) b.innerHTML = ic(video.paused ? 'play' : 'pause');
}

function buildControls() {
  const ch = cur || (state.play && state.play.list[state.play.idx]);
  if (!ch) return;
  $('#ctl-title').textContent = ch.name;
  let sub = ch.group;
  if (ch.kind === 'live' && state.epg) {
    const { cur: c } = upcoming(ch, Date.now(), 0);
    if (c) sub = `${hm(c[0])}–${hm(c[1])}  ${c[2]}`;
  }
  ctlSubBase = sub;
  $('#ctl-sub').textContent = sub;
  const live = ch.kind === 'live';
  const vol = Math.round(video.volume * 100);
  $('#ctl-buttons').innerHTML = `
    <button class="ibtn" data-ctl="back" title="Zurück zur Liste (Esc)">${ic('back')}</button>
    <button class="ibtn" data-ctl="prev" title="Voriger Sender">${ic('next', 'transform:scaleX(-1)')}</button>
    ${live ? '' : `<button class="ibtn" data-ctl="rew" title="${seekBack()} s zurück">${ic('replay')}</button>`}
    <button class="ibtn" id="btn-play" data-ctl="play" title="Pause (Leertaste)">${ic(video.paused ? 'play' : 'pause')}</button>
    ${live ? '' : `<button class="ibtn" data-ctl="fwd" title="${seekFwd()} s vor">${ic('replay', 'transform:scaleX(-1)')}</button>`}
    <button class="ibtn" data-ctl="next" title="Nächster Sender">${ic('next')}</button>
    <div class="grow"></div>
    <button class="ibtn" data-ctl="mute" title="Ton aus (M)">${ic(video.muted || vol === 0 ? 'mute' : 'volume')}</button>
    <input type="range" id="ctl-vol" min="0" max="100" value="${video.muted ? 0 : vol}">
    <button class="ibtn" data-ctl="aspect" title="Bildformat (A)">${ic('aspect')}</button>
    <button class="ibtn" data-ctl="fav" title="Favorit (F)">${ic('heart')}</button>
    <button class="ibtn" data-ctl="win" title="Vollbild (F11)">${ic('fullscreen')}</button>`;
  $('#player').classList.toggle('live-mode', live);
  updateSeekBar();
}

let ctlSubBase = '';
function updateBufInfo() {
  if (!state.full || !cur) return;
  const b = video.buffered;
  let ahead = 0;
  for (let i = 0; i < b.length; i++) {
    if (b.start(i) <= video.currentTime + 0.2 && b.end(i) >= video.currentTime) ahead = b.end(i) - video.currentTime;
  }
  $('#ctl-sub').textContent = `${ctlSubBase}${ctlSubBase ? '   ·   ' : ''}Puffer ${ahead.toFixed(0)} s`;
}

function showControls() {
  if (!state.full) return;
  $('#controls').classList.remove('hidden');
  playerEl.style.cursor = '';
  clearTimeout(ctlTimer);
  ctlTimer = setTimeout(() => {
    if (!state.full || video.paused) return;
    $('#controls').classList.add('hidden');
    playerEl.style.cursor = 'none';
  }, 3500);
}

function ctlAction(a) {
  if (a === 'back') exitFull();
  else if (a === 'prev') zap(-1);
  else if (a === 'next') zap(1);
  else if (a === 'rew') seekBy(-seekBack());
  else if (a === 'fwd') seekBy(seekFwd());
  else if (a === 'play') togglePause();
  else if (a === 'mute') toggleMute();
  else if (a === 'aspect') cycleAspect();
  else if (a === 'fav') { const ch = cur; if (ch) toggleFav(ch); }
  else if (a === 'win') window.api.toggleFullscreen();
}

let lastSeekAt = 0;
function seekBy(s) {
  if (!isFinite(video.duration)) return;
  lastSeekAt = Date.now();
  video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + s));
  osd(`${s > 0 ? '⏩ +' : '⏪ '}${s} s  ·  ${mmss(video.currentTime)} / ${mmss(video.duration)}`, 1500);
  updateSeekBar();
}
function togglePause() {
  if (video.paused) video.play().catch(() => {}); else video.pause();
  osd(video.paused ? '⏸ Pause' : '▶ Weiter', 1200);
  syncPauseUi();
}
function setVolume(v) {
  v = Math.max(0, Math.min(100, v));
  video.muted = false;
  video.volume = v / 100;
  S.set('volume', v);
  osd('🔊 ' + v + ' %', 1200);
  const r = $('#ctl-vol');
  if (r) r.value = v;
}
function toggleMute() {
  video.muted = !video.muted;
  osd(video.muted ? '🔇 Ton aus' : '🔊 Ton an', 1200);
  buildControls();
}
function cycleAspect() {
  const n = (S.get('resize', 0) + 1) % 3;
  S.set('resize', n);
  applyLook();
  osd('Format: ' + RESIZES[n], 1800);
}

/* ---------------- Ereignisse ---------------- */

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-ctl]');
  if (c) { ctlAction(c.dataset.ctl); showControls(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  const go = {
    live: () => showBrowse('live', 0),
    movie: () => showBrowse('movie', 0),
    series: () => showBrowse('series', 0),
    favs: () => showBrowse('live', 1),
    settings: () => gate(() => renderSettings()),
    home: () => renderHome(),
    search: () => showSearch(),
    account: () => gate(() => showAccount()),
    profile: () => gate(() => showProfiles()),
    vod: () => showVodSettings(),
    refresh: () => refreshPlaylist(),
    winfull: () => window.api.toggleFullscreen(),
    cats: () => showCats(),
    epg: () => showEpgDialog(),
    player: () => showPlayerSettings(),
    look: () => showLook(),
    bg: () => showBgMenu(),
    cache: async () => { await window.api.cacheClear(PID); toast('Cache geleert', 2000); if (playlistUrl()) refreshPlaylist(); },
    info: () => showInfo(),
    weather: () => showWeather(),
    weatherset: () => showWeatherSettings(),
    perf: () => showPerf(),
    themes: () => showThemes(),
    introset: () => startIntro(null, true),
    parental: () => showParental(),
    sortset: () => chooseDialog('Sortierung', ['Original (wie in der Playlist)', 'A–Z (Kategorien, Filme, Serien)'], sortMode(), (k) => { S.set('sort', k); state.sorted = {}; renderSettings(); })
  };
  if (go[act]) go[act]();
});

$('#ctl-range').addEventListener('input', (e) => {
  if (isFinite(video.duration)) video.currentTime = (e.target.value / 1000) * video.duration;
  showControls();
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'ctl-vol') setVolume(+e.target.value);
});

playerEl.addEventListener('mousemove', showControls);
let clickTimer = 0;
video.addEventListener('click', () => {
  if (!state.full) return;
  showControls();
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => { if (cur && cur.kind !== 'live') togglePause(); }, 230);
});
video.addEventListener('dblclick', () => { clearTimeout(clickTimer); if (state.full) window.api.toggleFullscreen(); else if (state.screen === 'browse') playFull(state.sel); });
playerEl.addEventListener('wheel', (e) => {
  if (!state.full) return;
  setVolume(Math.round(video.volume * 100) + (e.deltaY < 0 ? 5 : -5));
  showControls();
}, { passive: true });

window.api.onFullscreen((v) => { state.winFull = v; setTimeout(placePlayer, 100); });

function onKey(e) {
  if (e.key === 'F11') { e.preventDefault(); window.api.toggleFullscreen(); return; }

  if (introSkip) { e.preventDefault(); introSkip(); return; }

  if (modals.length) {
    const top = modals[modals.length - 1];
    if (e.key === 'Escape') { e.preventDefault(); top.close(); return; }
    const tag = e.target.tagName;
    if (e.key === 'Enter' && tag === 'INPUT' && e.target.type !== 'checkbox' && top.primary) { e.preventDefault(); top.primary.click(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (tag === 'SELECT') return;
      const f = focusables(top.m);
      const i = f.indexOf(document.activeElement);
      if (f.length) {
        e.preventDefault();
        f[(i + (e.key === 'ArrowDown' ? 1 : -1) + f.length) % f.length].focus();
      }
    }
    return;
  }

  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if ((e.ctrlKey && e.key.toLowerCase() === 'f') || e.key === '/') {
    if (!state.full) { e.preventDefault(); showSearch(); }
    return;
  }

  if (state.full) { fullKey(e); return; }

  if (state.screen === 'browse') { browseKey(e); return; }

  // Startseite und Einstellungen
  if (e.key === 'Escape' || e.key === 'Backspace') {
    e.preventDefault();
    if (state.screen === 'settings') renderHome();
    return;
  }
  if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    moveFocus($('#' + state.screen), e.key);
  }
}

function browseKey(e) {
  const list = state.zone === 'cats' ? catList : chanList;
  const count = state.zone === 'cats' ? state.cats.length : state.items.length;
  const cur2 = state.zone === 'cats' ? state.cat : state.sel;
  const move = (n) => {
    if (!count) return;
    const i = Math.max(0, Math.min(count - 1, n));
    if (state.zone === 'cats') selectCat(i); else selectItem(i);
  };
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); move(cur2 + 1); break;
    case 'ArrowUp': e.preventDefault(); move(cur2 - 1); break;
    case 'PageDown': e.preventDefault(); move(cur2 + 10); break;
    case 'PageUp': e.preventDefault(); move(cur2 - 10); break;
    case 'Home': e.preventDefault(); move(0); break;
    case 'End': e.preventDefault(); move(count - 1); break;
    case 'ArrowRight': e.preventDefault(); if (state.zone === 'cats') enterCat(); break;
    case 'ArrowLeft': e.preventDefault(); if (state.zone === 'list') setZone('cats'); break;
    case 'Enter':
      e.preventDefault();
      if (state.zone === 'cats') enterCat(); else playFull(state.sel);
      break;
    case 'f': case 'F':
      if (state.zone === 'list') toggleFav(state.items[state.sel]);
      break;
    case 'Escape': case 'Backspace':
      e.preventDefault();
      if (state.folder) closeFolder();
      else if (state.query) showBrowse(state.kind, 0, '');
      else renderHome();
      break;
    default: break;
  }
  void list;
}

let holdStart = 0;
let lastHold = 0;
function holdSeek(e, dir) {
  const base = dir > 0 ? seekFwd() : seekBack();
  const now = Date.now();
  let mult = 1;
  if (!e.repeat) {
    holdStart = now;
  } else if (S.get('seekAccel', true)) {
    if (now - lastHold < 280) return;
    const dt = now - holdStart;
    mult = dt > 3000 ? 8 : dt > 1800 ? 4 : dt > 800 ? 2 : 1;
  } else {
    return;
  }
  lastHold = now;
  seekBy(dir * base * mult);
}

function fullKey(e) {
  const live = cur && cur.kind === 'live';
  const k = e.key;
  if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); exitFull(); return; }
  if (k === 'PageUp') { e.preventDefault(); zap(1); return; }
  if (k === 'PageDown') { e.preventDefault(); zap(-1); return; }
  if (k === 'ArrowUp') { e.preventDefault(); if (live) zap(1); else setVolume(Math.round(video.volume * 100) + 5); showControls(); return; }
  if (k === 'ArrowDown') { e.preventDefault(); if (live) zap(-1); else setVolume(Math.round(video.volume * 100) - 5); showControls(); return; }
  if (k === 'ArrowLeft') { e.preventDefault(); if (!live) holdSeek(e, -1); showControls(); return; }
  if (k === 'ArrowRight') { e.preventDefault(); if (!live) holdSeek(e, 1); showControls(); return; }
  if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); togglePause(); showControls(); return; }
  if (k === 'Enter') { e.preventDefault(); if (live) { showNowInfo(); showControls(); } else { togglePause(); showControls(); } return; }
  if (k === 'm' || k === 'M') { toggleMute(); showControls(); return; }
  if (k === 'a' || k === 'A') { cycleAspect(); return; }
  if (k === 'i' || k === 'I') { showNowInfo(); showControls(); return; }
  if (k === 'f' || k === 'F') { if (cur) toggleFav(cur); return; }
  if (k === 'MediaTrackNext') zap(1);
  if (k === 'MediaTrackPrevious') zap(-1);
}

document.addEventListener('keydown', onKey);
window.addEventListener('online', () => { if (state.screen === 'home') renderHome(); });
window.addEventListener('offline', () => { if (state.screen === 'home') renderHome(); });

/* =====================================================================
   Start
   ===================================================================== */

(async function init() {
  applyLook();
  video.volume = S.get('volume', 100) / 100;
  // Zuerst sofort zeichnen und das Intro starten, danach erst Daten laden (blockiert keine Eingabe).
  renderHome();
  $('#intro').addEventListener('click', () => { if (introSkip) introSkip(); });
  startIntro(() => { if (!playlistUrl()) showAccount(); });
  setInterval(() => loadWeather(false), 10 * 60 * 1000);
  setInterval(updateBufInfo, 1000);
  setInterval(lockWatch, 10000);
  await new Promise((r) => setTimeout(r, 30));
  try {
    const cached = await window.api.cacheRead(PID);
    if (cached) {
      setPlaylist(parseM3u(cached));
      if (state.screen === 'home') renderHome();
    }
  } catch (e) { /* kein Cache */ }
  if (S.get('epgauto', true)) setTimeout(() => loadEpg(false), 300);
  setTimeout(() => loadWeather(false), 100);
  if (playlistUrl()) setTimeout(refreshPlaylist, 600);
})();
