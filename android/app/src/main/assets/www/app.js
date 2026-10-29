(function () {
  'use strict';

  const SPORTS = FB.classify.SPORTS;
  // In der Android-App stellt die native Hülle "AndroidBridge" bereit: dort laden wir die Feeds selbst.
  const standalone = typeof window.AndroidBridge !== 'undefined';
  const PAGE = 36;

  const $ = (id) => document.getElementById(id);
  const els = {
    splash: $('splash'), stripes: $('stripes'), splashTitle: $('splash-title'),
    tabs: $('tabs'), grid: $('grid'), hero: $('hero'), gallery: $('gallery'), empty: $('empty'), more: $('more'),
    search: $('search'), updated: $('updated'), refresh: $('refresh'), notice: $('notice'),
    ticker: $('ticker'), tickerTrack: $('ticker-track'),
    statusBtn: $('status-btn'), statusDialog: $('status-dialog'), statusList: $('status-list'),
    fixtures: $('fixtures'), fxUpcoming: $('fx-upcoming'), fxResults: $('fx-results'),
    lb: $('lightbox'), lbImg: $('lb-img'), lbTitle: $('lb-title'), lbMeta: $('lb-meta'), lbOpen: $('lb-open'),
  };

  const state = { sport: 'all', q: '', view: 'cards', items: [], updatedAt: null, fixtures: null, shown: PAGE, loaded: false, lbList: [], lbIndex: 0 };

  // ---------- Hilfsfunktionen ----------

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { /* Speicher nicht verfügbar */ }
    return null;
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of children || []) node.append(c);
    return node;
  }

  const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
  function relativeTime(iso) {
    if (!iso) return '';
    const diff = Math.round((Date.parse(iso) - Date.now()) / 1000);
    const abs = Math.abs(diff);
    if (abs < 60) return 'gerade eben';
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
  }
  const absFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  function safeHref(link) { return /^https?:\/\//i.test(link) ? link : '#'; }
  function isNew(item) { return item.publishedAt && Date.now() - Date.parse(item.publishedAt) < 3 * 3600000; }
  function sportOf(item) { return SPORTS[item.sport] || { label: '', icon: '🏅' }; }

  // Gelesene Artikel merken (nur lokal im Browser/der App).
  let visited = new Set();
  try { visited = new Set(JSON.parse(store('fbVisited') || '[]')); } catch (e) { /* leer starten */ }
  function markVisited(link) {
    visited.add(link);
    store('fbVisited', JSON.stringify(Array.from(visited).slice(-600)));
  }

  // Bild mit Platzhalter: Das Sport-Symbol bleibt sichtbar, bis das Bild geladen ist (oder fehlschlägt).
  function makeThumb(item, extraClass) {
    const sport = sportOf(item);
    const thumb = el('div', { class: 'thumb ' + (extraClass || '') }, [el('div', { class: 'ph', text: sport.icon })]);
    if (item.image) {
      const img = el('img', { src: item.image, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.addEventListener('load', () => img.classList.add('ready'));
      img.addEventListener('error', () => img.remove());
      thumb.append(img);
    }
    return thumb;
  }

  function metaText(item) {
    return [item.source, relativeTime(item.publishedAt)].filter(Boolean).join(' · ');
  }

  // ---------- Startanimation ----------

  function buildSplash() {
    if (!els.splash) return;
    let seen = false;
    try { seen = sessionStorage.getItem('fbSplash') === '1'; } catch (e) { /* ignorieren */ }
    if (seen) { els.splash.remove(); return; }

    for (let i = 0; i < 11; i++) els.stripes.append(el('i', { style: '--i:' + i }));
    let n = 0;
    for (const [word, accent] of [['FENERBAHÇE', false], ['NEWS', true]]) {
      const w = el('span', { class: 'word' + (accent ? ' accent' : ''), 'aria-hidden': 'true' });
      for (const ch of word) w.append(el('span', { class: 'l', style: '--i:' + n++, text: ch }));
      els.splashTitle.append(w);
    }

    let done = false;
    function hide() {
      if (done) return;
      done = true;
      try { sessionStorage.setItem('fbSplash', '1'); } catch (e) { /* ignorieren */ }
      els.splash.classList.add('hide');
      setTimeout(() => els.splash.remove(), 900);
    }
    els.splash.addEventListener('click', hide);
    document.addEventListener('keydown', hide, { once: true });
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(hide, reduce ? 300 : 3400);
  }

  // ---------- Datenzugriff ----------

  function makeServerData() {
    return {
      async news() {
        const res = await fetch('/api/news?limit=500');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      },
      async fixtures() {
        const res = await fetch('/api/fixtures');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      },
      async status() {
        const res = await fetch('/api/status');
        return res.json();
      },
      async refresh() { await fetch('/api/refresh', { method: 'POST' }); },
    };
  }

  function makeStandaloneData() {
    // Brücke zur Android-Hülle: Anfragen laufen nativ (kein CORS-Problem), Ergebnisse werden abgeholt.
    const pending = new Map();
    let seq = 0;
    window.__nativeDone = function (id, ok) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      const text = window.AndroidBridge.take(id);
      if (ok) p.resolve(text); else p.reject(new Error(text || 'Fehler'));
    };
    function getText(url, opts) {
      return new Promise((resolve, reject) => {
        const id = String(++seq);
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Zeitüberschreitung')); }, 70000);
        pending.set(id, { resolve, reject, timer });
        window.AndroidBridge.fetch(id, url, (opts && opts.maxBytes) || 0);
      });
    }
    const io = { getText };

    let cfg = null;
    function loadCfg() {
      if (!cfg) cfg = JSON.parse(window.AndroidBridge.readAsset('www/sources.json'));
      return cfg;
    }

    let cache = { items: [], status: [], updatedAt: null };
    try { const saved = JSON.parse(store('fbNewsCache') || 'null'); if (saved && Array.isArray(saved.items)) cache = saved; } catch (e) { /* ohne Cache starten */ }
    const imageCache = new Map();
    let running = null;

    function save() { store('fbNewsCache', JSON.stringify({ items: cache.items.slice(0, 200), status: cache.status, updatedAt: cache.updatedAt })); }

    function refresh() {
      if (running) return running;
      running = (async () => {
        const c = loadCfg();
        const { items, status } = await FB.engine.loadAll(c, io);
        FB.engine.applyImageCache(items, imageCache);
        if (items.length || !cache.items.length) cache.items = items;
        cache.status = status;
        cache.updatedAt = new Date().toISOString();
        save();
        // Vorschaubilder nachladen und danach die Anzeige aktualisieren
        FB.engine.enrichImages(cache.items, io, { limit: c.enrich.appLimit, concurrency: 3, cache: imageCache })
          .then((n) => { if (n) { save(); window.dispatchEvent(new Event('fb-data-updated')); } })
          .catch(() => {});
      })().finally(() => { running = null; });
      return running;
    }

    // Beim Start: gespeicherte Artikel sofort zeigen, frisch laden, wenn der Stand älter als 15 Minuten ist.
    const stale = !cache.updatedAt || Date.now() - Date.parse(cache.updatedAt) > 15 * 60000;
    if (stale) refresh().catch(() => {});
    setInterval(() => refresh().catch(() => {}), 15 * 60000);

    return {
      async news() { return { items: cache.items, updatedAt: cache.updatedAt, refreshing: Boolean(running) }; },
      async fixtures() { return FB.fixtures.parseFixturesText(window.AndroidBridge.readAsset('www/fixtures.json')); },
      async status() { return { updatedAt: cache.updatedAt, sources: cache.status }; },
      async refresh() { await refresh(); },
    };
  }

  const Data = standalone ? makeStandaloneData() : makeServerData();

  // ---------- Darstellung ----------

  function filtered() {
    const q = state.q.toLowerCase();
    return state.items.filter((i) => (state.sport === 'all' || i.sport === state.sport)
      && (!q || (i.title + ' ' + i.summary + ' ' + i.source).toLowerCase().includes(q)));
  }

  function renderTabs() {
    const counts = { all: state.items.length };
    for (const k of Object.keys(SPORTS)) counts[k] = state.items.filter((i) => i.sport === k).length;
    els.tabs.replaceChildren();
    const entries = [['all', { label: 'Alle', icon: '' }]].concat(Object.entries(SPORTS));
    for (const [key, info] of entries) {
      const btn = el('button', { class: 'tab', type: 'button', 'aria-pressed': String(state.sport === key) });
      btn.append((info.icon ? info.icon + ' ' : '') + info.label);
      btn.append(el('span', { class: 'count', text: String(counts[key]) }));
      btn.addEventListener('click', () => { state.sport = key; state.shown = PAGE; store('fbSport', key); render(); loadFixturesView(); });
      els.tabs.append(btn);
    }
    document.querySelectorAll('.view').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  }

  let tickerKey = '';
  function renderTicker() {
    const top = state.items.slice(0, 10);
    const key = top.map((i) => i.link).join('|');
    if (key === tickerKey) return;
    tickerKey = key;
    els.ticker.hidden = top.length === 0;
    els.tickerTrack.replaceChildren();
    // Inhalt zweimal einfügen, damit das Band nahtlos läuft (Animation verschiebt um 50 %).
    for (let copy = 0; copy < 2; copy++) {
      const half = el('span', { 'aria-hidden': copy ? 'true' : 'false' });
      for (const it of top) half.append(el('a', { href: safeHref(it.link), target: '_blank', rel: 'noopener noreferrer', text: it.title }));
      els.tickerTrack.append(half);
    }
    els.tickerTrack.style.setProperty('--dur', Math.max(40, top.length * 9) + 's');
  }

  function openLink(item) { markVisited(item.link); }

  function renderTile(item, i) {
    const sport = sportOf(item);
    const txt = el('div', { class: 'txt' }, [
      el('div', { class: 'row', style: 'display:flex;gap:8px;align-items:center' }, [
        el('span', { class: 'badge', text: sport.icon + ' ' + sport.label }),
        isNew(item) ? el('span', { class: 'new', text: 'NEU' }) : document.createTextNode(''),
      ]),
      el('h2', { text: item.title }),
      el('div', { class: 'meta', text: metaText(item) }),
    ]);
    const a = el('a', { class: 'tile' + (visited.has(item.link) ? ' visited' : ''), href: safeHref(item.link), target: '_blank', rel: 'noopener noreferrer', style: 'animation-delay:' + (i * 80) + 'ms' }, [makeThumb(item), txt]);
    a.addEventListener('click', () => openLink(item));
    return a;
  }

  function renderCard(item, i) {
    const sport = sportOf(item);
    const body = el('div', { class: 'body' }, [
      el('div', { class: 'row' }, [
        el('span', { class: 'badge', text: sport.icon + ' ' + sport.label }),
        isNew(item) ? el('span', { class: 'new', text: 'NEU' }) : document.createTextNode(''),
      ]),
      el('h2', { text: item.title }),
    ]);
    if (item.summary) body.append(el('p', { class: 'summary', text: item.summary }));
    body.append(el('div', { class: 'meta', text: metaText(item), title: item.publishedAt ? absFmt.format(new Date(item.publishedAt)) : '' }));
    const a = el('a', { class: 'card' + (visited.has(item.link) ? ' visited' : ''), href: safeHref(item.link), target: '_blank', rel: 'noopener noreferrer', style: '--i:' + i }, [makeThumb(item), body]);
    a.addEventListener('click', () => { openLink(item); a.classList.add('visited'); });
    return a;
  }

  function renderGallery(list) {
    state.lbList = list;
    els.gallery.replaceChildren(...list.slice(0, state.shown).map((item, i) => {
      const img = el('img', { src: item.image, alt: item.title, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      const btn = el('button', { type: 'button', class: 'gal-item', style: '--i:' + i, 'aria-label': item.title }, [
        img, el('span', { class: 'cap', text: item.title }),
      ]);
      img.addEventListener('error', () => btn.remove());
      btn.addEventListener('click', () => openLightbox(i));
      return btn;
    }));
  }

  function render() {
    const list = filtered();
    renderTabs();
    renderTicker();
    els.updated.textContent = state.updatedAt ? 'Stand: ' + relativeTime(state.updatedAt) : (state.loaded ? '' : 'Lade …');

    const gallery = state.view === 'gallery';
    els.grid.hidden = gallery;
    els.gallery.hidden = !gallery;
    els.hero.hidden = true;
    els.hero.replaceChildren();

    let rest = list;
    let more = false;

    if (gallery) {
      const withImg = list.filter((i) => i.image);
      renderGallery(withImg);
      more = withImg.length > state.shown;
      els.empty.hidden = withImg.length > 0 || !state.loaded;
      els.empty.textContent = list.length ? 'Zu diesen Meldungen gibt es noch keine Bilder.' : 'Keine Nachrichten gefunden.';
    } else {
      // Hero: die ersten drei Meldungen mit Bild (nur in der Kartenansicht ohne Suche)
      if (state.view === 'cards' && !state.q) {
        const heroItems = list.slice(0, 20).filter((i) => i.image).slice(0, 3);
        if (heroItems.length === 3) {
          els.hero.hidden = false;
          els.hero.replaceChildren(...heroItems.map(renderTile));
          rest = list.filter((i) => !heroItems.includes(i));
        }
      }
      els.grid.className = 'grid' + (state.view === 'list' ? ' list' : '');
      if (!state.loaded && !list.length) {
        els.grid.replaceChildren(...Array.from({ length: 8 }, () => el('div', { class: 'skeleton' })));
      } else {
        els.grid.replaceChildren(...rest.slice(0, state.shown).map(renderCard));
      }
      more = rest.length > state.shown;
      els.empty.hidden = list.length > 0 || !state.loaded;
      els.empty.textContent = 'Keine Nachrichten gefunden.';
    }
    els.more.hidden = !more;

    const noData = state.loaded && state.updatedAt && state.items.length === 0;
    if (noData) {
      els.notice.hidden = false;
      els.notice.dataset.kind = 'nodata';
      els.notice.textContent = 'Es konnten keine Nachrichten geladen werden. Der Server oder das Gerät erreicht die Quellen möglicherweise nicht (Netzwerk/Firewall). Details unter „Quellenstatus“.';
    } else if (els.notice.dataset.kind === 'nodata') {
      els.notice.hidden = true;
      els.notice.dataset.kind = '';
    }
  }

  // ---------- Spiele ----------

  function renderFixtureList(ul, list, withScore, highlightFirst) {
    ul.replaceChildren();
    if (!list.length) { ul.append(el('li', { class: 'fx-none', text: 'Keine Einträge' })); return; }
    list.forEach((f, idx) => {
      const sport = SPORTS[f.sport] || { icon: '' };
      const meta = [sport.icon, f.competition, dayFmt.format(new Date(f.date)), f.venue].filter(Boolean).join(' · ');
      const li = el('li', { class: highlightFirst && idx === 0 ? 'next' : '' }, [
        el('span', { class: 'fx-teams', text: f.home + ' – ' + f.away }),
        withScore ? el('span', { class: 'fx-score', text: f.homeScore + ':' + f.awayScore })
          : (highlightFirst && idx === 0 ? el('span', { class: 'fx-when', text: relativeTime(f.date) }) : el('span')),
        el('span', { class: 'fx-meta', text: meta }),
      ]);
      ul.append(li);
    });
  }

  function loadFixturesView() {
    const data = state.fixtures;
    if (!data) return;
    const pick = (list) => (state.sport === 'all' ? list : list.filter((f) => f.sport === state.sport));
    const up = pick(data.upcoming).slice(0, 8);
    const res = pick(data.results).slice(0, 8);
    const any = up.length || res.length || data.errors.length;
    els.fixtures.hidden = !any;
    renderFixtureList(els.fxUpcoming, up, false, true);
    renderFixtureList(els.fxResults, res, true, false);
    if (data.errors.length) {
      els.notice.hidden = false;
      els.notice.dataset.kind = 'fixtures';
      els.notice.textContent = 'fixtures.json: ' + data.errors.slice(0, 3).join(' | ');
    }
  }

  async function loadFixtures() {
    try { state.fixtures = await Data.fixtures(); loadFixturesView(); } catch (e) { /* Spiele sind optional */ }
  }

  // ---------- Bildansicht ----------

  function showLightbox() {
    const item = state.lbList[state.lbIndex];
    if (!item) return;
    els.lbImg.src = item.image;
    els.lbImg.alt = item.title;
    els.lbTitle.textContent = item.title;
    els.lbMeta.textContent = metaText(item);
    els.lbOpen.href = safeHref(item.link);
  }
  function openLightbox(i) {
    state.lbIndex = i;
    showLightbox();
    if (!els.lb.open) els.lb.showModal();
  }
  function stepLightbox(d) {
    const n = state.lbList.length;
    if (!n) return;
    state.lbIndex = (state.lbIndex + d + n) % n;
    showLightbox();
  }
  $('lb-prev').addEventListener('click', () => stepLightbox(-1));
  $('lb-next').addEventListener('click', () => stepLightbox(1));
  $('lb-close').addEventListener('click', () => els.lb.close());
  els.lbOpen.addEventListener('click', () => { const it = state.lbList[state.lbIndex]; if (it) markVisited(it.link); });
  els.lb.addEventListener('click', (e) => { if (e.target === els.lb) els.lb.close(); });
  document.addEventListener('keydown', (e) => {
    if (!els.lb.open) return;
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
  });

  // ---------- Laden und Bedienung ----------

  async function load() {
    try {
      const d = await Data.news();
      state.items = d.items || [];
      state.updatedAt = d.updatedAt;
      state.loaded = Boolean(d.updatedAt) || state.items.length > 0;
      if (els.notice.dataset.kind === 'error') { els.notice.hidden = true; els.notice.dataset.kind = ''; }
      render();
      if (!d.updatedAt || d.refreshing) setTimeout(load, 3000);
    } catch (err) {
      els.notice.hidden = false;
      els.notice.dataset.kind = 'error';
      els.notice.textContent = 'Server nicht erreichbar: ' + err.message;
    }
  }

  els.refresh.addEventListener('click', async () => {
    els.refresh.disabled = true;
    try {
      await Data.refresh();
      await new Promise((r) => setTimeout(r, standalone ? 200 : 2500));
      await load();
    } finally { els.refresh.disabled = false; }
  });

  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = els.search.value.trim(); state.shown = PAGE; render(); }, 220);
  });

  document.querySelectorAll('.view').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    state.shown = PAGE;
    store('fbView', state.view);
    render();
  }));

  els.more.addEventListener('click', () => { state.shown += PAGE; render(); });

  els.statusBtn.addEventListener('click', async () => {
    const data = await Data.status();
    const rows = (data.sources || []).map((s) => {
      const li = el('li');
      li.append(el('span', { class: s.ok ? 'ok' : 'fail', text: s.ok ? 'OK ' : 'Fehler ' }));
      li.append(s.name + ': ' + (s.ok ? s.count + ' Artikel' : s.error));
      return li;
    });
    els.statusList.replaceChildren(...(rows.length ? rows : [el('li', { text: 'Noch keine Daten.' })]));
    els.statusDialog.showModal();
  });

  window.addEventListener('fb-data-updated', load);

  (function init() {
    buildSplash();
    const savedView = store('fbView');
    if (['cards', 'list', 'gallery'].includes(savedView)) state.view = savedView;
    const savedSport = store('fbSport');
    if (savedSport === 'all' || SPORTS[savedSport]) state.sport = savedSport;
    render();
    load();
    loadFixtures();
    setInterval(load, 2 * 60 * 1000);
    setInterval(loadFixtures, 10 * 60 * 1000);
  })();
}());
