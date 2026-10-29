(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rss'), require('./classify'));
  else { root.FB = root.FB || {}; root.FB.engine = factory(root.FB.rss, root.FB.classify); }
})(typeof self !== 'undefined' ? self : this, function (rss, classify) {
  'use strict';

  // Nachrichten-Kern für Server (Windows) und App (Android).
  // Der Netzwerkzugriff wird von außen übergeben: io.getText(url, { timeout, maxBytes }) -> Promise<string>

  function cleanTitle(title, sourceName) {
    // Google News hängt " - Quellenname" an den Titel.
    if (sourceName && title.endsWith(' - ' + sourceName)) return title.slice(0, -(sourceName.length + 3)).trim();
    return title;
  }

  function titleKey(title) {
    return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80);
  }

  function hostOf(link) {
    try { return new URL(link).hostname.toLowerCase(); } catch (e) { return ''; }
  }

  function isGoogleNews(link) {
    return hostOf(link).endsWith('news.google.com');
  }

  // Bing-News-Links enthalten die echte Artikeladresse im Parameter "url".
  function unwrapLink(link) {
    try {
      const u = new URL(link);
      if (/(^|\.)bing\.com$/.test(u.hostname) && u.pathname.toLowerCase().includes('apiclick')) {
        const real = u.searchParams.get('url');
        if (real && /^https?:\/\//i.test(real)) return real;
      }
    } catch (e) { /* Link unverändert lassen */ }
    return link;
  }

  // Nur https-Bilder zulassen (http wird hochgestuft, Android blockiert unverschlüsselten Verkehr).
  function safeImageUrl(url, base) {
    if (!url) return '';
    try {
      const u = new URL(url, base || undefined);
      if (u.protocol === 'http:') u.protocol = 'https:';
      else if (u.protocol !== 'https:') return '';
      return u.href;
    } catch (e) { return ''; }
  }

  async function loadSource(source, cfg, io) {
    const xml = await io.getText(source.url, { timeout: 12000 });
    const maxAgeMs = cfg.maxAgeDays * 86400000;
    const now = Date.now();
    const filter = (source.filter || []).map((w) => classify.normalize(w).trim()).filter(Boolean);

    return rss.parseFeed(xml)
      .filter((raw) => {
        if (!filter.length) return true;
        const text = classify.normalize(raw.title + ' ' + raw.summary);
        return filter.some((w) => text.includes(w));
      })
      .slice(0, cfg.maxItemsPerSource)
      .map((raw) => {
        const link = unwrapLink(raw.link);
        const sourceName = raw.sourceName || source.name;
        const item = {
          title: cleanTitle(raw.title, raw.sourceName),
          link,
          summary: raw.summary && raw.summary !== raw.title ? raw.summary : '',
          image: safeImageUrl(raw.image, link),
          publishedAt: raw.publishedAt,
          source: sourceName,
          sport: 'futbol',
        };
        // Uhren-Abweichungen: Zeitpunkte in der Zukunft auf "jetzt" begrenzen.
        if (item.publishedAt && Date.parse(item.publishedAt) > now + 3600000) item.publishedAt = new Date(now).toISOString();
        item.sport = classify.classify(item, source.sport);
        return item;
      })
      .filter((i) => !i.publishedAt || now - Date.parse(i.publishedAt) <= maxAgeMs);
  }

  // Führt zwei Einträge zum selben Artikel zusammen: Bild/Zusammenfassung ergänzen, direkten Link bevorzugen.
  function mergeItems(a, b) {
    const m = Object.assign({}, a);
    if (!m.image && b.image) m.image = b.image;
    if (!m.summary && b.summary) m.summary = b.summary;
    if (isGoogleNews(m.link) && b.link && !isGoogleNews(b.link)) {
      m.link = b.link;
      m.source = b.source;
    }
    return m;
  }

  // Lädt alle aktiven Quellen parallel. Ein defekter Feed bricht nicht die gesamte Aktualisierung ab.
  async function loadAll(cfg, io) {
    const sources = cfg.sources.filter((s) => s.enabled !== false);
    const results = await Promise.allSettled(sources.map((s) => loadSource(s, cfg, io)));
    const status = sources.map((s, i) => ({
      id: s.id,
      name: s.name,
      ok: results[i].status === 'fulfilled',
      count: results[i].status === 'fulfilled' ? results[i].value.length : 0,
      error: results[i].status === 'rejected' ? String((results[i].reason && results[i].reason.message) || results[i].reason) : null,
    }));

    const seen = new Map();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const item of r.value) {
        const key = titleKey(item.title);
        seen.set(key, seen.has(key) ? mergeItems(seen.get(key), item) : item);
      }
    }

    const items = Array.from(seen.values())
      .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
    return { items, status };
  }

  function extractOgImage(html, base) {
    if (!html) return '';
    const metas = html.slice(0, 300000).match(/<meta\b[^>]*>/gi) || [];
    for (const key of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) {
      for (const tag of metas) {
        const name = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
        if (name && name.toLowerCase() === key) {
          const content = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
          if (content) return safeImageUrl(rss.decodeEntities(content.trim()), base);
        }
      }
    }
    return '';
  }

  // Übernimmt bereits bekannte Bilder aus dem Zwischenspeicher (Link -> Bild-URL).
  function applyImageCache(items, cache) {
    let n = 0;
    for (const it of items) {
      if (!it.image && cache.has(it.link)) {
        const img = cache.get(it.link);
        if (img) { it.image = img; n++; }
      }
    }
    return n;
  }

  // Sucht für Artikel ohne Bild das Vorschaubild (og:image) auf der Artikelseite.
  // Google-News-Weiterleitungen werden übersprungen, dort liegt kein Bild auf der Zielseite.
  async function enrichImages(items, io, opts) {
    opts = opts || {};
    const limit = opts.limit === undefined ? 25 : opts.limit;
    const concurrency = opts.concurrency || 4;
    const cache = opts.cache || new Map();
    let found = applyImageCache(items, cache);

    const todo = [];
    for (const it of items) {
      if (todo.length >= limit) break;
      if (it.image || !it.link || cache.has(it.link) || isGoogleNews(it.link) || !hostOf(it.link)) continue;
      todo.push(it);
    }

    let next = 0;
    async function worker() {
      while (next < todo.length) {
        const it = todo[next++];
        let img = '';
        try {
          const html = await io.getText(it.link, { timeout: 8000, maxBytes: 300000 });
          img = extractOgImage(html, it.link);
        } catch (e) { /* Seite nicht lesbar: ohne Bild weiter */ }
        cache.set(it.link, img);
        if (img) { it.image = img; found++; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    return found;
  }

  return {
    loadAll, loadSource, enrichImages, applyImageCache, extractOgImage,
    cleanTitle, titleKey, unwrapLink, safeImageUrl, mergeItems,
  };
});
