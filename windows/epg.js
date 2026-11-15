'use strict';
// XMLTV-Parser in Stücken (läuft im Worker-Thread, damit Fenster und Eingaben nicht hängen).

const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => entities[m]).replace(/<!\[CDATA\[|\]\]>/g, '');
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function xmltvTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/.exec((s || '').trim());
  if (!m) return null;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  let off = null;
  if (m[7]) {
    const sign = m[7][0] === '-' ? -1 : 1;
    off = sign * ((+m[7].slice(1, 3)) * 60 + (+m[7].slice(3, 5)));
    t -= off * 60000;
  }
  return { t, off };
}

/**
 * opts: { ids: [tvg-ids], names: [normierte Namen] }  -> nur diese Sender behalten (leer = alle)
 *       { arch: { ids: [...], names: [...] } }        -> nur für diese Sender auch vergangene Sendungen (bis 7 Tage)
 * Ergebnis: { channels: { id: [[start, stop, titel, beschreibung]] }, names: { name: id }, tz: Minuten }
 */
function parseEpgBuffer(buf, now, opts) {
  opts = opts || {};
  const idSet = new Set(opts.ids || []);
  const nameSet = new Set(opts.names || []);
  const filter = idSet.size > 0 || nameSet.size > 0;
  const archIds = new Set((opts.arch && opts.arch.ids) || []);
  const archNames = new Set((opts.arch && opts.arch.names) || []);
  const nearFrom = now - 2 * 3600e3;
  const archFrom = now - 7 * 86400e3;
  const to = now + 2 * 86400e3;
  const descTo = now + 24 * 3600e3;

  const names = {};
  const channels = {};
  const wanted = new Set();
  const archOk = new Set();
  const tzCount = new Map();
  const chRe = /<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g;
  const prRe = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g;

  const parseChunk = (xml) => {
    let m;
    chRe.lastIndex = 0;
    while ((m = chRe.exec(xml))) {
      const id = decode(m[1]);
      const keys = [];
      const dn = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g;
      let d;
      while ((d = dn.exec(m[2]))) {
        const key = norm(decode(d[1]));
        if (key) keys.push(key);
      }
      if (!filter || idSet.has(id) || keys.some((k) => nameSet.has(k))) {
        wanted.add(id);
        for (const k of keys) if (!(k in names)) names[k] = id;
        if (archIds.has(id) || keys.some((k) => archNames.has(k))) archOk.add(id);
      }
    }
    prRe.lastIndex = 0;
    while ((m = prRe.exec(xml))) {
      const attrs = m[1];
      const ch = (/channel="([^"]*)"/.exec(attrs) || [])[1];
      if (!ch) continue;
      const id = decode(ch);
      if (filter && !wanted.has(id)) continue;
      const st = xmltvTime((/start="([^"]*)"/.exec(attrs) || [])[1]);
      const sp = xmltvTime((/stop="([^"]*)"/.exec(attrs) || [])[1]);
      if (!st || !sp) continue;
      const start = st.t;
      const stop = sp.t;
      const from = archOk.has(id) ? archFrom : nearFrom;
      if (stop <= from || start >= to) continue;
      const t = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
      if (!t) continue;
      let desc = '';
      if (start >= nearFrom && start < descTo) {
        const dsc = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
        if (dsc) desc = decode(dsc[1]).trim().slice(0, 500);
      }
      if (st.off !== null) tzCount.set(st.off, (tzCount.get(st.off) || 0) + 1);
      (channels[id] || (channels[id] = [])).push([start, stop, decode(t[1]).trim(), desc]);
    }
  };

  const CH = 16 * 1024 * 1024;
  let off = 0;
  while (off < buf.length) {
    let end = Math.min(buf.length, off + CH);
    if (end < buf.length) {
      const k = buf.lastIndexOf('</programme>', end - 1);
      if (k >= off) end = k + 12;
      else {
        const n = buf.indexOf('</programme>', end);
        end = n < 0 ? buf.length : n + 12;
      }
    }
    parseChunk(buf.toString('utf8', off, end));
    off = end;
  }
  for (const id of Object.keys(channels)) channels[id].sort((a, b) => a[0] - b[0]);
  let tz = null;
  let best = 0;
  for (const [o, c] of tzCount) if (c > best) { best = c; tz = o; }
  return { channels, names, tz };
}

module.exports = { parseEpgBuffer, norm };
