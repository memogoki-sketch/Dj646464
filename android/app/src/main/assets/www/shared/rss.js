(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.FB = root.FB || {}; root.FB.rss = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Kleiner, abhängigkeitsfreier Parser für RSS 2.0 und Atom (läuft in Node und im Browser).

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  function safeFromCodePoint(cp) {
    try { return String.fromCodePoint(cp); } catch (e) { return ''; }
  }

  function decodeEntities(str) {
    return String(str)
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
      .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m));
  }

  function stripCdata(str) {
    const m = str.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
    return m ? m[1] : null;
  }

  // Entfernt HTML-Tags aus einem Text und decodiert Entities.
  function htmlToText(html) {
    if (!html) return '';
    let text = html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    text = decodeEntities(text);
    return text.replace(/\s+/g, ' ').trim();
  }

  function getTagContent(block, tag) {
    const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i');
    const m = block.match(re);
    if (!m) return '';
    const raw = m[1];
    const cdata = stripCdata(raw);
    return cdata !== null ? cdata.trim() : decodeEntities(raw).trim();
  }

  function getTagWithAttrs(block, tag) {
    const re = new RegExp('<' + tag + '((?:\\s[^>]*)?)>([\\s\\S]*?)</' + tag + '>', 'i');
    const m = block.match(re);
    if (!m) return null;
    const attrs = {};
    m[1].replace(/([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g, (_, k, v) => { attrs[k] = decodeEntities(v); return ''; });
    const cdata = stripCdata(m[2]);
    return { attrs, text: cdata !== null ? cdata.trim() : decodeEntities(m[2]).trim() };
  }

  function getAtomLink(block) {
    const re = /<link\b([^>]*?)\/?>/gi;
    let m;
    let fallback = '';
    while ((m = re.exec(block))) {
      const href = (m[1].match(/href\s*=\s*"([^"]*)"/i) || [])[1];
      if (!href) continue;
      const rel = (m[1].match(/rel\s*=\s*"([^"]*)"/i) || [])[1];
      if (!rel || rel === 'alternate') return decodeEntities(href);
      fallback = fallback || decodeEntities(href);
    }
    return fallback;
  }

  function findImage(block, descriptionHtml) {
    // Bing News: <News:Image>
    const bing = getTagContent(block, 'News:Image');
    if (/^https?:\/\//i.test(bing)) return bing;
    let m = block.match(/<media:(?:content|thumbnail)\b[^>]*\burl\s*=\s*"([^"]+)"/i);
    if (m) return decodeEntities(m[1]);
    m = block.match(/<enclosure\b[^>]*\btype\s*=\s*"image\/[^"]*"[^>]*\burl\s*=\s*"([^"]+)"/i)
      || block.match(/<enclosure\b[^>]*\burl\s*=\s*"([^"]+)"[^>]*\btype\s*=\s*"image\/[^"]*"/i);
    if (m) return decodeEntities(m[1]);
    if (descriptionHtml) {
      m = descriptionHtml.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
      if (m) return decodeEntities(m[1]);
    }
    return '';
  }

  function parseDate(value) {
    if (!value) return null;
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  function parseFeed(xml) {
    if (typeof xml !== 'string' || !xml.trim()) return [];
    const items = [];

    const rssBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    for (const block of rssBlocks) {
      const title = htmlToText(getTagContent(block, 'title'));
      const link = getTagContent(block, 'link') || (getTagWithAttrs(block, 'guid') || {}).text || '';
      const descRaw = getTagContent(block, 'description') || getTagContent(block, 'content:encoded');
      const src = getTagWithAttrs(block, 'source');
      const bingSource = getTagContent(block, 'News:Source');
      items.push({
        title,
        link: link.trim(),
        summary: htmlToText(descRaw),
        image: findImage(block, descRaw),
        publishedAt: parseDate(getTagContent(block, 'pubDate') || getTagContent(block, 'dc:date')),
        sourceName: src ? src.text : bingSource,
        sourceUrl: src ? (src.attrs.url || '') : '',
      });
    }

    if (!rssBlocks.length) {
      const atomBlocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
      for (const block of atomBlocks) {
        const descRaw = getTagContent(block, 'summary') || getTagContent(block, 'content');
        items.push({
          title: htmlToText(getTagContent(block, 'title')),
          link: getAtomLink(block),
          summary: htmlToText(descRaw),
          image: findImage(block, descRaw),
          publishedAt: parseDate(getTagContent(block, 'published') || getTagContent(block, 'updated')),
          sourceName: '',
          sourceUrl: '',
        });
      }
    }

    return items.filter((i) => i.title && i.link);
  }

  return { parseFeed, htmlToText, decodeEntities };
});
