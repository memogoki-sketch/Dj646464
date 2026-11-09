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
    panelTable: $('panel-table'), panelMatches: $('panel-matches'), panelTv: $('panel-tv'),
    lb: $('lightbox'), lbImg: $('lb-img'), lbTitle: $('lb-title'), lbMeta: $('lb-meta'), lbOpen: $('lb-open'),
  };

  const state = { sport: 'all', q: '', view: 'cards', items: [], updatedAt: null, live: null, mode: 'news', tableId: null, channel: null, shown: PAGE, loaded: false, lbList: [], lbIndex: 0 };

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
      async live() {
        const res = await fetch('/api/live');
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

    // Live-Daten (Tabelle, Spiele): Abruf direkt aus der App, letzter Stand bleibt für den Offline-Start gespeichert.
    let liveResult = { tables: [], matches: [], status: [] };
    let liveAt = null;
    try {
      const saved = JSON.parse(store('fbLiveCache') || 'null');
      if (saved && Array.isArray(saved.tables) && Array.isArray(saved.matches)) { liveResult = saved; liveAt = saved.fetchedAt || null; }
    } catch (e) { /* ohne Cache starten */ }
    let liveRunning = null;

    function refreshLive() {
      if (liveRunning) return liveRunning;
      liveRunning = (async () => {
        const c = loadCfg();
        liveResult = await FB.live.loadLive(c.live, io, liveResult);
        liveAt = new Date().toISOString();
        store('fbLiveCache', JSON.stringify(Object.assign({}, liveResult, { fetchedAt: liveAt })));
        window.dispatchEvent(new Event('fb-live-updated'));
      })().finally(() => { liveRunning = null; });
      return liveRunning;
    }

    const liveStale = !liveAt || Date.now() - Date.parse(liveAt) > 2 * 60000;
    if (liveStale) refreshLive().catch(() => {});
    setInterval(() => { if (!document.hidden) refreshLive().catch(() => {}); }, 2 * 60000);

    return {
      async news() { return { items: cache.items, updatedAt: cache.updatedAt, refreshing: Boolean(running) }; },
      async live() {
        const c = loadCfg();
        const read = (p) => window.AndroidBridge.readAsset(p);
        const view = FB.live.buildView({ fixturesText: read('www/fixtures.json'), standingsText: read('www/standings.json'), tvText: read('www/tv.json') }, liveResult);
        return Object.assign(view, {
          updatedAt: liveAt, refreshing: Boolean(liveRunning), status: liveResult.status || [],
          configured: Boolean(c.live && ((c.live.tables || []).length || (c.live.matches || []).length)),
        });
      },
      async status() { return { updatedAt: cache.updatedAt, sources: cache.status.concat(liveResult.status || []) }; },
      async refresh() { await Promise.all([refresh(), refreshLive()]); },
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
      if (state.mode === 'news') btn.append(el('span', { class: 'count', text: String(counts[key]) }));
      btn.addEventListener('click', () => { state.sport = key; state.shown = PAGE; store('fbSport', key); render(); });
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

  function renderNews() {
    const list = filtered();

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

  // ---------- Bereiche: Spiele, Tabelle, TV-Sender ----------

  function pickSport(list) { return state.sport === 'all' ? list : list.filter((x) => x.sport === state.sport); }

  function fmtDay(s) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(s + 'T12:00:00'));
    const t = Date.parse(s);
    return Number.isNaN(t) ? s : absFmt.format(new Date(t));
  }

  function channelBadge(ch) {
    const access = ch.free === true ? 'frei' : ch.free === false ? 'Abo' : '';
    const badge = el('span', { class: 'ch ' + ch.type, title: (ch.type === 'stream' ? 'Stream' : 'Fernsehen') + (access ? ' · ' + access : '') });
    badge.append((ch.type === 'stream' ? '▶ ' : '📺 ') + ch.name);
    if (access) badge.append(el('small', { class: ch.free ? 'free' : 'paid', text: access }));
    return badge;
  }

  function channelRow(list, cls) { return el('div', { class: 'ch-row ' + (cls || '') }, list.map(channelBadge)); }

  function hasChannel(f, name) { return (f.tvChannels || []).some((c) => c.name === name); }

  function matchItem(f, opts) {
    const live = f.status === 'live';
    const sport = SPORTS[f.sport] || { icon: '' };
    let right;
    if (live || f.status === 'finished') right = el('span', { class: 'fx-score' + (live ? ' liveScore' : ''), text: f.homeScore + ':' + f.awayScore });
    else if (f.status === 'postponed') right = el('span', { class: 'tag-warn', text: 'verschoben' });
    else if (opts.highlight) right = el('span', { class: 'fx-when', text: relativeTime(f.date) });
    else right = el('span');

    const meta = el('span', { class: 'fx-meta' });
    if (live) meta.append(el('span', { class: 'lv' }, [el('i'), 'LIVE' + (f.clock ? ' ' + f.clock : '')]), ' ');
    meta.append([sport.icon, f.competition, dayFmt.format(new Date(f.date)), f.venue].filter(Boolean).join(' · '));

    const li = el('li', { class: [opts.highlight ? 'next' : '', live ? 'is-live' : ''].join(' ').trim() }, [
      el('span', { class: 'fx-teams', text: f.home + ' – ' + f.away }), right, meta,
    ]);
    if (f.tvChannels && f.tvChannels.length) li.append(channelRow(f.tvChannels, 'fx-tv'));
    else if (opts.showNoTv && f.status !== 'finished') li.append(el('span', { class: 'fx-meta fx-tv', text: 'Sender nicht hinterlegt' }));
    return li;
  }

  function fillMatchList(ul, list, opts) {
    ul.replaceChildren();
    if (!list.length) { ul.append(el('li', { class: 'fx-none', text: 'Keine Einträge' })); return; }
    list.forEach((f, idx) => ul.append(matchItem(f, { highlight: Boolean(opts.highlightFirst) && idx === 0 && f.status !== 'live', showNoTv: opts.showNoTv })));
  }

  function boxList(title, list, opts) {
    const ul = el('ul', { class: 'match-list' });
    fillMatchList(ul, list, opts || {});
    return el('div', { class: 'box' }, [el('h3', { text: title }), ul]);
  }

  function chipBar(label, options, current, onPick) {
    const bar = el('div', { class: 'chips' }, [el('span', { class: 'lbl', text: label })]);
    options.forEach((o) => {
      const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(o.value === current), text: o.label });
      b.addEventListener('click', () => onPick(o.value));
      bar.append(b);
    });
    return bar;
  }

  function channelNames(list) {
    const names = [];
    list.forEach((x) => (x.channels || x.tvChannels || []).forEach((c) => { if (names.indexOf(c.name) === -1) names.push(c.name); }));
    return names;
  }

  function emptyHint(d, what, file) {
    const failed = (d.status || []).filter((s) => !s.ok);
    const msg = !d.configured ? 'Es ist keine Live-Quelle eingerichtet.'
      : !d.updatedAt ? 'Die Live-Daten werden gerade geladen …'
        : failed.length ? 'Die Live-Quelle ist nicht erreichbar (Details unter „Quellenstatus“).'
          : 'Die Live-Quelle liefert aktuell keine Daten.';
    return el('div', { class: 'box' + (failed.length ? ' warn' : '') }, [
      el('strong', { text: 'Keine ' + what + ' vorhanden. ' }),
      msg + ' Du kannst sie auch selbst in ' + file + ' eintragen (siehe README).',
    ]);
  }

  // Kleiner Block auf der Nachrichten-Seite: nächste Spiele und letzte Ergebnisse
  function renderFixturesBlock() {
    const d = state.live;
    if (!d || state.mode !== 'news') { els.fixtures.hidden = true; return; }
    const m = d.matches;
    const up = pickSport(m.live.concat(m.upcoming)).slice(0, 6);
    const res = pickSport(m.results).slice(0, 6);
    els.fixtures.hidden = !(up.length || res.length);
    fillMatchList(els.fxUpcoming, up, { highlightFirst: true });
    fillMatchList(els.fxResults, res, {});
  }

  function renderMatchesPanel() {
    const root = els.panelMatches;
    root.replaceChildren();
    const d = state.live;
    if (!d) { root.append(el('p', { class: 'empty', text: 'Lade …' })); return; }
    const m = d.matches;
    const names = channelNames(pickSport(m.live.concat(m.upcoming)));
    if (state.channel && names.indexOf(state.channel) === -1) state.channel = null;
    if (names.length) {
      const opts = [{ value: null, label: 'Alle' }].concat(names.map((n) => ({ value: n, label: n })));
      root.append(chipBar('Sender:', opts, state.channel, (v) => { state.channel = v; renderMatchesPanel(); }));
    }
    const byCh = (l) => (state.channel ? l.filter((f) => hasChannel(f, state.channel)) : l);
    const live = byCh(pickSport(m.live));
    const up = byCh(pickSport(m.upcoming)).slice(0, 25);
    const res = byCh(pickSport(m.results)).slice(0, 15);

    if (live.length) root.append(boxList('Läuft gerade', live, {}));
    root.append(boxList('Nächste Spiele', up, { highlightFirst: !live.length, showNoTv: true }));
    root.append(boxList('Letzte Ergebnisse', res, {}));
    if (!live.length && !up.length && !res.length && !state.channel) root.append(emptyHint(d, 'Spiele', 'fixtures.json'));
    root.append(el('p', { class: 'panel-note', text: 'Live-Stand: ' + (d.updatedAt ? relativeTime(d.updatedAt) : 'noch nicht geladen') + '. Eigene Spiele und Sender trägst du in fixtures.json ein, Sender je Wettbewerb in tv.json.' }));
  }

  function renderTablePanel() {
    const root = els.panelTable;
    root.replaceChildren();
    const d = state.live;
    if (!d) { root.append(el('p', { class: 'empty', text: 'Lade …' })); return; }
    const tables = pickSport(d.tables);
    if (!tables.length) { root.append(emptyHint(d, 'Tabellen', 'standings.json')); return; }
    const t = tables.filter((x) => x.id === state.tableId)[0] || tables[0];
    if (tables.length > 1) {
      root.append(chipBar('Tabelle:', tables.map((x) => ({ value: x.id, label: x.name })), t.id, (v) => { state.tableId = v; renderTablePanel(); }));
    }

    const rows = t.rows;
    const any = (fn) => rows.some(fn);
    const cols = [
      { h: 'Sp', get: (r) => r.played, show: any((r) => r.played !== null) },
      { h: 'S', get: (r) => r.won, show: any((r) => r.won !== null) },
      { h: 'U', get: (r) => r.drawn, show: any((r) => r.drawn !== null) },
      { h: 'N', get: (r) => r.lost, show: any((r) => r.lost !== null) },
      { h: t.goalsLabel || 'Tore', get: (r) => (r.gf !== null && r.ga !== null ? r.gf + ':' + r.ga : null), show: any((r) => r.gf !== null && r.ga !== null), opt: true },
      { h: 'Diff', get: (r) => (r.gd === null ? null : (r.gd > 0 ? '+' + r.gd : String(r.gd))), show: any((r) => r.gd !== null), opt: true },
      { h: 'Pkt', get: (r) => r.points, show: any((r) => r.points !== null), cls: 'pts' },
    ].filter((c) => c.show);

    const src = el('span', { class: 'src' + (t.stale ? ' stale' : '') });
    if (t.source === 'live' && !t.stale) {
      src.append(el('span', { class: 'lv' }, [el('i'), 'LIVE']), ' ' + t.sourceName + ' · aktualisiert ' + relativeTime(t.updatedAt));
    } else if (t.stale) {
      src.append('⚠ Live-Quelle nicht erreichbar · letzter Stand ' + relativeTime(t.updatedAt));
    } else {
      src.append('✎ ' + t.sourceName + (t.updatedAt ? ' · Stand ' + fmtDay(t.updatedAt) : ''));
    }

    const thead = el('tr', {}, [el('th', { text: '#' }), el('th', { class: 'team', text: 'Team' })].concat(cols.map((c) => el('th', { class: c.opt ? 'opt' : '', text: c.h }))));
    const tbody = el('tbody');
    rows.forEach((r) => {
      const team = el('td', { class: 'team' });
      if (r.logo) {
        const img = el('img', { class: 'logo', src: r.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
        img.addEventListener('error', () => img.remove());
        team.append(img);
      }
      team.append(r.team);
      const tr = el('tr', { class: FB.live.isFener(r.team) ? 'me' : '' }, [el('td', { class: 'pos', text: String(r.rank) }), team]);
      cols.forEach((c) => {
        const v = c.get(r);
        tr.append(el('td', { class: [c.cls || '', c.opt ? 'opt' : ''].join(' ').trim(), text: v === null || v === undefined ? '–' : String(v) }));
      });
      tbody.append(tr);
    });

    const legend = [];
    if (cols.some((c) => c.h === 'Sp')) legend.push('Sp = Spiele');
    if (cols.some((c) => c.h === 'S')) legend.push('S = Siege');
    if (cols.some((c) => c.h === 'U')) legend.push('U = Unentschieden');
    if (cols.some((c) => c.h === 'N')) legend.push('N = Niederlagen');
    root.append(el('div', { class: 'box' }, [
      el('div', { class: 'tbl-head' }, [el('h3', { text: t.name }), src]),
      el('div', { class: 'tbl-wrap' }, [el('table', { class: 'tbl' }, [el('thead', {}, [thead]), tbody])]),
    ]));
    root.append(el('p', { class: 'panel-note', text: legend.join(' · ') + ' · Fenerbahçe ist hervorgehoben.' }));
  }

  function ageWarn(asOf) {
    if (!asOf) return false;
    const t = Date.parse(asOf.length === 7 ? asOf + '-01' : asOf);
    return !Number.isNaN(t) && Date.now() - t > 150 * 86400000;
  }

  function renderTvPanel() {
    const root = els.panelTv;
    root.replaceChildren();
    const d = state.live;
    if (!d) { root.append(el('p', { class: 'empty', text: 'Lade …' })); return; }
    const comps = d.tv.competitions.filter((c) => state.sport === 'all' || !c.sport || c.sport === state.sport);
    const note = [d.tv.note, d.tv.updatedAt ? 'Stand der Sammlung: ' + fmtDay(d.tv.updatedAt) + '.' : ''].filter(Boolean).join(' ');
    if (note) root.append(el('p', { class: 'panel-note', text: note }));
    if (!comps.length) {
      root.append(el('div', { class: 'box', text: 'Für diese Auswahl ist noch kein Sender hinterlegt. Du kannst Einträge in tv.json ergänzen (siehe README).' }));
      return;
    }
    const names = channelNames(comps);
    if (state.channel && names.indexOf(state.channel) === -1) state.channel = null;
    if (names.length) {
      const opts = [{ value: null, label: 'Alle' }].concat(names.map((n) => ({ value: n, label: n })));
      root.append(chipBar('Sender:', opts, state.channel, (v) => { state.channel = v; renderTvPanel(); }));
    }
    const shown = state.channel ? comps.filter((c) => c.channels.some((ch) => ch.name === state.channel)) : comps;
    const grid = el('div', { class: 'tv-grid' });
    shown.forEach((c) => {
      const sport = SPORTS[c.sport] || { icon: '🏅' };
      const old = ageWarn(c.asOf);
      const foot = el('div', { class: 'foot-line' });
      const left = el('span', {});
      left.append('Stand: ' + (c.asOf || 'unbekannt'));
      if (old) left.append(' ', el('span', { class: 'old-tag', text: '· älter, bitte prüfen' }));
      foot.append(left);
      if (/^https?:\/\//i.test(c.source)) foot.append(el('a', { href: c.source, target: '_blank', rel: 'noopener noreferrer', text: 'Quelle ↗' }));
      const card = el('div', { class: 'tv-card' + (old ? ' old' : '') }, [
        el('h3', { text: sport.icon + ' ' + c.name }),
        channelRow(c.channels),
      ]);
      if (c.note) card.append(el('p', { class: 'note', text: c.note }));
      card.append(foot);
      grid.append(card);
    });
    root.append(grid);

    if (state.channel) {
      const next = pickSport(d.matches.live.concat(d.matches.upcoming)).filter((f) => hasChannel(f, state.channel)).slice(0, 10);
      root.append(boxList('Nächste Spiele auf ' + state.channel, next, { highlightFirst: true }));
    }
  }

  function renderModes() {
    document.querySelectorAll('.mode').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
      if (b.dataset.mode === 'matches') b.classList.toggle('has-live', Boolean(state.live && state.live.matches.live.length));
    });
  }

  function render() {
    document.body.dataset.mode = state.mode;
    renderTabs();
    renderTicker();
    renderModes();
    const news = state.mode === 'news';
    const stamp = news ? state.updatedAt : (state.live && state.live.updatedAt);
    els.updated.textContent = stamp ? 'Stand: ' + relativeTime(stamp) : (state.loaded ? '' : 'Lade …');
    els.panelTable.hidden = state.mode !== 'table';
    els.panelMatches.hidden = state.mode !== 'matches';
    els.panelTv.hidden = state.mode !== 'tv';
    if (news) {
      renderNews();
    } else {
      els.hero.hidden = true;
      els.grid.hidden = true;
      els.gallery.hidden = true;
      els.empty.hidden = true;
      els.more.hidden = true;
    }
    renderFixturesBlock();
    if (state.mode === 'table') renderTablePanel();
    else if (state.mode === 'matches') renderMatchesPanel();
    else if (state.mode === 'tv') renderTvPanel();
  }

  let liveTimer = null;
  async function loadLive() {
    clearTimeout(liveTimer);
    let delay = 120000;
    try {
      state.live = await Data.live();
      const errs = state.live.errors || [];
      if (errs.length) {
        els.notice.hidden = false;
        els.notice.dataset.kind = 'data';
        els.notice.textContent = 'Hinweis zu deinen Dateien: ' + errs.slice(0, 3).join(' | ');
      } else if (els.notice.dataset.kind === 'data') {
        els.notice.hidden = true;
        els.notice.dataset.kind = '';
      }
      render();
      if (!state.live.updatedAt || state.live.refreshing) delay = 4000;
      else if (state.live.matches.live.length) delay = 45000;
    } catch (e) { /* Live-Daten sind optional, Nachrichten funktionieren weiter */ }
    liveTimer = setTimeout(loadLive, delay);
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
      await Promise.all([load(), loadLive()]);
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
      li.append(s.name + ': ' + (s.ok ? s.count + (/^(tabelle|spiele):/.test(s.id || '') ? ' Einträge' : ' Artikel') : s.error));
      return li;
    });
    els.statusList.replaceChildren(...(rows.length ? rows : [el('li', { text: 'Noch keine Daten.' })]));
    els.statusDialog.showModal();
  });

  document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    state.channel = null;
    store('fbMode', state.mode);
    render();
    window.scrollTo(0, 0);
  }));

  window.addEventListener('fb-data-updated', load);
  window.addEventListener('fb-live-updated', loadLive);

  (function init() {
    buildSplash();
    const savedView = store('fbView');
    if (['cards', 'list', 'gallery'].includes(savedView)) state.view = savedView;
    const savedSport = store('fbSport');
    if (savedSport === 'all' || SPORTS[savedSport]) state.sport = savedSport;
    const savedMode = store('fbMode');
    if (['news', 'table', 'matches', 'tv'].includes(savedMode)) state.mode = savedMode;
    render();
    load();
    loadLive();
    setInterval(load, 2 * 60 * 1000);
  })();
}());
