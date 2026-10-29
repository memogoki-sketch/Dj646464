'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const engine = require('./public/shared/engine');
const { SPORTS } = require('./public/shared/classify');
const { getText } = require('./lib/http');
const { loadFixturesFile } = require('./lib/fixtures');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const FIXTURES_FILE = process.env.FIXTURES_FILE || path.join(__dirname, 'fixtures.json');
const SOURCES_FILE = process.env.SOURCES_FILE || path.join(__dirname, 'sources.json');
const cfg = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
const io = { getText };

const cache = { items: [], status: [], updatedAt: null, refreshing: null };
const imageCache = new Map();

async function refresh() {
  if (cache.refreshing) return cache.refreshing;
  cache.refreshing = (async () => {
    try {
      const { items, status } = await engine.loadAll(cfg, io);
      engine.applyImageCache(items, imageCache);
      // Nur überschreiben, wenn überhaupt etwas geladen wurde, sonst alte Daten behalten.
      if (items.length || !cache.items.length) cache.items = items;
      cache.status = status;
      cache.updatedAt = new Date().toISOString();
      const ok = status.filter((s) => s.ok).length;
      console.log(`[${cache.updatedAt}] ${cache.items.length} Artikel, ${ok}/${status.length} Quellen OK`);

      // Vorschaubilder im Hintergrund nachladen; die Einträge werden dabei direkt ergänzt.
      const target = cache.items;
      engine.enrichImages(target, io, { limit: cfg.enrich.limit, concurrency: cfg.enrich.concurrency, cache: imageCache })
        .then((n) => { if (n) console.log(`  ${n} Vorschaubilder ergänzt`); })
        .catch((err) => console.error('Bildsuche fehlgeschlagen:', err.message));
    } catch (err) {
      console.error('Aktualisierung fehlgeschlagen:', err.message);
    } finally {
      cache.refreshing = null;
    }
  })();
  return cache.refreshing;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function handleApi(req, res, url) {
  if (url.pathname === '/api/news') {
    const sport = url.searchParams.get('sport');
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);

    let items = cache.items;
    if (sport && sport !== 'all') items = items.filter((i) => i.sport === sport);
    if (q) items = items.filter((i) => `${i.title} ${i.summary} ${i.source}`.toLowerCase().includes(q));

    const counts = { all: cache.items.length };
    for (const key of Object.keys(SPORTS)) counts[key] = cache.items.filter((i) => i.sport === key).length;

    return sendJson(res, 200, {
      updatedAt: cache.updatedAt,
      refreshing: Boolean(cache.refreshing),
      counts,
      total: items.length,
      items: items.slice(0, limit),
    });
  }
  if (url.pathname === '/api/fixtures') {
    // Datei wird bei jeder Anfrage neu gelesen: Änderungen wirken ohne Neustart.
    const sport = url.searchParams.get('sport');
    const data = loadFixturesFile(FIXTURES_FILE);
    const pick = (list) => (sport && sport !== 'all' ? list.filter((f) => f.sport === sport) : list);
    return sendJson(res, 200, {
      upcoming: pick(data.upcoming).slice(0, 30),
      results: pick(data.results).slice(0, 30),
      errors: data.errors,
    });
  }
  if (url.pathname === '/api/sports') return sendJson(res, 200, SPORTS);
  if (url.pathname === '/api/status') return sendJson(res, 200, { updatedAt: cache.updatedAt, sources: cache.status });
  if (url.pathname === '/api/refresh' && req.method === 'POST') {
    refresh();
    return sendJson(res, 202, { started: true });
  }
  return sendJson(res, 404, { error: 'Nicht gefunden' });
}

function serveStatic(req, res, url) {
  let rel;
  try { rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end('Ungültige Adresse'); }
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); return res.end('Verboten');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

if (require.main === module) {
  refresh();
  setInterval(refresh, cfg.refreshMinutes * 60000).unref();
  server.listen(PORT, HOST, () => console.log(`Fenerbahçe News läuft auf http://localhost:${PORT}`));
}

module.exports = { server, refresh, cache };
