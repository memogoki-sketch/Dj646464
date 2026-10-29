'use strict';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFeed } = require('../public/shared/rss');
const { classify } = require('../public/shared/classify');
const engine = require('../public/shared/engine');
const { splitFixtures } = require('../public/shared/fixtures');
const { loadFixturesFile } = require('../lib/fixtures');
const { getText, decodeBuffer } = require('../lib/http');

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log(`ok   ${name}`); },
    (err) => { console.error(`FAIL ${name}\n     ${err.stack || err.message}`); process.exitCode = 1; },
  );
}

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test</title>
<item>
  <title><![CDATA[Fenerbahçe Beko'da Larkin sağlık kontrolünden geçti - Fotomaç]]></title>
  <link>https://example.com/a</link>
  <pubDate>Sat, 18 Jul 2026 10:00:00 GMT</pubDate>
  <description>&lt;a href="x"&gt;Larkin&lt;/a&gt; &amp;amp; takım</description>
  <source url="https://fotomac.com.tr">Fotomaç</source>
</item>
<item>
  <title>Fenerbahçe Opet Sultanlar Ligi maçını kazandı - Hürriyet</title>
  <link>https://example.com/b</link>
  <pubDate>Fri, 17 Jul 2026 10:00:00 GMT</pubDate>
  <media:content url="https://img.example.com/b.jpg" />
  <source url="https://hurriyet.com.tr">Hürriyet</source>
</item>
<item><title>Ohne Link</title></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
  <title>Fenerbahçe hentbol takımı galip</title>
  <link rel="alternate" href="https://example.com/c"/>
  <updated>2026-07-16T08:00:00Z</updated>
  <summary>Kısa özet</summary>
</entry></feed>`;

const BING = `<?xml version="1.0" encoding="utf-8" ?>
<rss version="2.0" xmlns:News="https://www.bing.com/news/search?q=x&amp;format=rss"><channel><title>Fenerbahçe</title>
<item>
  <title>Fenerbahçe Beko yeni transferi açıkladı</title>
  <link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=1&amp;url=https%3a%2f%2fwww.example.com%2fhaber%2fbeko-transfer&amp;c=1&amp;mkt=tr-tr</link>
  <description>Kısa özet metni</description>
  <pubDate>Sat, 18 Jul 2026 12:00:00 GMT</pubDate>
  <News:Source>Example Spor</News:Source>
  <News:Image>http://www.bing.com/th?id=ON.ABC&amp;pid=News</News:Image>
</item></channel></rss>`;

function serve(handler) {
  const srv = http.createServer(handler).listen(0);
  return new Promise((r) => srv.once('listening', () => r({ srv, port: srv.address().port })));
}

(async () => {
  await test('RSS: Items, CDATA, Entities, Quelle', () => {
    const items = parseFeed(RSS);
    assert.strictEqual(items.length, 2, 'Eintrag ohne Link muss verworfen werden');
    assert.strictEqual(items[0].title, "Fenerbahçe Beko'da Larkin sağlık kontrolünden geçti - Fotomaç");
    assert.strictEqual(items[0].sourceName, 'Fotomaç');
    assert.strictEqual(items[0].summary, 'Larkin & takım');
    assert.strictEqual(items[0].publishedAt, '2026-07-18T10:00:00.000Z');
    assert.strictEqual(items[1].image, 'https://img.example.com/b.jpg');
  });

  await test('Atom wird erkannt', () => {
    const items = parseFeed(ATOM);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].link, 'https://example.com/c');
    assert.strictEqual(items[0].publishedAt, '2026-07-16T08:00:00.000Z');
  });

  await test('Leere/ungültige Eingabe liefert []', () => {
    assert.deepStrictEqual(parseFeed(''), []);
    assert.deepStrictEqual(parseFeed(null), []);
    assert.deepStrictEqual(parseFeed('<html>kein feed</html>'), []);
  });

  await test('Bing News: Bild, Quelle und echter Link', () => {
    const [raw] = parseFeed(BING);
    assert.strictEqual(raw.image, 'http://www.bing.com/th?id=ON.ABC&pid=News');
    assert.strictEqual(raw.sourceName, 'Example Spor');
    assert.strictEqual(engine.unwrapLink(raw.link), 'https://www.example.com/haber/beko-transfer');
    assert.strictEqual(engine.unwrapLink('https://example.com/x'), 'https://example.com/x');
    assert.strictEqual(engine.safeImageUrl(raw.image), 'https://www.bing.com/th?id=ON.ABC&pid=News', 'http wird zu https');
  });

  await test('Bild-URLs: nur http(s), relative werden aufgelöst', () => {
    assert.strictEqual(engine.safeImageUrl('javascript:alert(1)'), '');
    assert.strictEqual(engine.safeImageUrl('data:image/png;base64,AAAA'), '');
    assert.strictEqual(engine.safeImageUrl('/img/a.jpg', 'https://example.com/x/y'), 'https://example.com/img/a.jpg');
    assert.strictEqual(engine.safeImageUrl(''), '');
  });

  await test('Titel: Quellen-Suffix wird entfernt', () => {
    assert.strictEqual(engine.cleanTitle('Foo bar - Fotomaç', 'Fotomaç'), 'Foo bar');
    assert.strictEqual(engine.cleanTitle('Foo - Bar baz', 'Fotomaç'), 'Foo - Bar baz');
  });

  await test('Klassifizierung nach Sportart', () => {
    const c = (title, hint) => classify({ title, summary: '' }, hint);
    assert.strictEqual(c('Fenerbahçe Opet Sultanlar Ligi maçını kazandı', 'auto'), 'voleybol');
    assert.strictEqual(c('Fenerbahçe Beko Euroleague maçına çıkıyor', 'auto'), 'basketbol');
    assert.strictEqual(c('Fenerbahçe hentbol takımı galip', 'auto'), 'diger');
    assert.strictEqual(c('Tedesco derbi öncesi konuştu', 'auto'), 'futbol');
    assert.strictEqual(c('Irgendein unklarer Titel', 'auto'), 'futbol');
    assert.strictEqual(c('Irgendein unklarer Titel', 'basketbol'), 'basketbol');
    assert.strictEqual(c('FENERBAHÇE VOLEYBOL TAKIMI', 'auto'), 'voleybol');
    assert.notStrictEqual(c('Fenerbahce profile update', 'auto'), 'voleybol');
    assert.strictEqual(c('Fenerbahce wins basketball thriller', 'auto'), 'basketbol');
  });

  await test('og:image wird gefunden (beide Attribut-Reihenfolgen, relativ, Entities)', () => {
    const base = 'https://example.com/news/1';
    assert.strictEqual(engine.extractOgImage('<head><meta property="og:image" content="https://cdn.example.com/a.jpg?x=1&amp;y=2"></head>', base), 'https://cdn.example.com/a.jpg?x=1&y=2');
    assert.strictEqual(engine.extractOgImage('<meta content="/p/b.jpg" property="og:image"/>', base), 'https://example.com/p/b.jpg');
    assert.strictEqual(engine.extractOgImage('<meta name="twitter:image" content="https://cdn.example.com/t.jpg">', base), 'https://cdn.example.com/t.jpg');
    assert.strictEqual(engine.extractOgImage('<html><head><title>x</title></head></html>', base), '');
  });

  await test('Zeichensatz: iso-8859-9 und UTF-8 werden korrekt gelesen', () => {
    const latin5 = Buffer.from([0x46, 0x65, 0x6e, 0x65, 0x72, 0x62, 0x61, 0x68, 0xe7, 0x65]); // "Fenerbahçe" in ISO-8859-9
    assert.strictEqual(decodeBuffer(latin5, 'text/xml; charset=iso-8859-9'), 'Fenerbahçe');
    assert.strictEqual(decodeBuffer(Buffer.from('Fenerbahçe'), 'text/xml'), 'Fenerbahçe');
    assert.strictEqual(decodeBuffer(Buffer.concat([Buffer.from('<?xml version="1.0" encoding="windows-1254"?>'), latin5]), null).endsWith('Fenerbahçe'), true);
  });

  await test('loadAll: Duplikate, Filter, defekte Quelle, Sortierung, Bing-Zusammenführung', async () => {
    const feedB = RSS.replace('https://example.com/a', 'https://example.com/a2'); // gleicher Titel
    const sportFeed = `<rss><channel>
      <item><title>Galatasaray kazandı</title><link>https://example.com/g</link><pubDate>Sat, 18 Jul 2026 11:00:00 GMT</pubDate></item>
      <item><title>FENERBAHÇE kampa girdi</title><link>https://example.com/f</link><pubDate>Sat, 18 Jul 2026 11:30:00 GMT</pubDate></item>
    </channel></rss>`;
    // Google-News-Eintrag zum selben Artikel wie der Bing-Eintrag
    const gnSame = `<rss><channel><item><title>Fenerbahçe Beko yeni transferi açıkladı - Example Spor</title>
      <link>https://news.google.com/rss/articles/CBMi123</link><pubDate>Sat, 18 Jul 2026 11:55:00 GMT</pubDate>
      <source url="https://www.example.com">Example Spor</source></item></channel></rss>`;
    const { srv, port } = await serve((req, res) => {
      const feeds = { '/a': RSS, '/b': feedB, '/sport': sportFeed, '/bing': BING, '/gn': gnSame };
      if (feeds[req.url]) { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(feeds[req.url]); }
      res.writeHead(500); res.end('boom');
    });
    try {
      const u = (p) => `http://127.0.0.1:${port}${p}`;
      const cfg = {
        maxAgeDays: 100000,
        maxItemsPerSource: 40,
        sources: [
          { id: 'a', name: 'A', sport: 'auto', url: u('/a') },
          { id: 'b', name: 'B', sport: 'auto', url: u('/b') },
          { id: 'sport', name: 'Sport', sport: 'auto', filter: ['fenerbahce'], url: u('/sport') },
          { id: 'gn', name: 'GN', sport: 'auto', url: u('/gn') },
          { id: 'bing', name: 'Bing', sport: 'auto', url: u('/bing') },
          { id: 'off', name: 'Aus', sport: 'auto', enabled: false, url: u('/a') },
          { id: 'bad', name: 'Bad', sport: 'auto', url: u('/bad') },
        ],
      };
      const { items, status } = await engine.loadAll(cfg, { getText });
      const titles = items.map((i) => i.title);
      assert.ok(!titles.includes('Galatasaray kazandı'), 'Filter muss fremde Artikel entfernen');
      assert.ok(titles.includes('FENERBAHÇE kampa girdi'), 'Filter ist unabhängig von Groß-/Kleinschreibung und ç');
      assert.strictEqual(items.filter((i) => i.title.includes('Larkin')).length, 1, 'Duplikat muss zusammengeführt werden');
      for (let i = 1; i < items.length; i++) assert.ok(Date.parse(items[i - 1].publishedAt) >= Date.parse(items[i].publishedAt), 'neueste zuerst');

      const beko = items.find((i) => i.title.includes('yeni transferi'));
      assert.strictEqual(beko.link, 'https://www.example.com/haber/beko-transfer', 'direkter Link statt Google-Weiterleitung');
      assert.strictEqual(beko.image, 'https://www.bing.com/th?id=ON.ABC&pid=News', 'Bing-Bild wird übernommen');

      assert.strictEqual(status.length, 6, 'deaktivierte Quelle wird nicht geladen');
      assert.strictEqual(status.find((s) => s.id === 'bad').ok, false);
      assert.match(status.find((s) => s.id === 'bad').error, /HTTP 500/);
      assert.strictEqual(status.find((s) => s.id === 'a').ok, true);
    } finally { srv.close(); }
  });

  await test('Bildsuche: og:image nachladen, Cache, Limit, Google-Links überspringen', async () => {
    let hits = 0;
    const { srv, port } = await serve((req, res) => {
      hits++;
      if (req.url === '/with') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<head><meta property="og:image" content="https://cdn.example.com/p.jpg"></head>'); }
      if (req.url === '/without') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<head></head>'); }
      res.writeHead(404); res.end();
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      const mk = (p) => ({ title: p, link: base + p, image: '' });
      const items = [mk('/with'), mk('/without'), mk('/missing'), { title: 'g', link: 'https://news.google.com/rss/articles/x', image: '' }, { title: 'has', link: base + '/has', image: 'https://x/y.jpg' }];
      const cache = new Map();
      const found = await engine.enrichImages(items, { getText }, { limit: 10, cache });
      assert.strictEqual(found, 1);
      assert.strictEqual(items[0].image, 'https://cdn.example.com/p.jpg');
      assert.strictEqual(items[1].image, '');
      assert.strictEqual(hits, 3, 'Google-Link und Eintrag mit Bild dürfen nicht abgerufen werden');

      // Zweiter Lauf: alles aus dem Cache, keine neuen Anfragen
      const again = [mk('/with')];
      assert.strictEqual(await engine.enrichImages(again, { getText }, { cache }), 1);
      assert.strictEqual(again[0].image, 'https://cdn.example.com/p.jpg');
      assert.strictEqual(hits, 3);

      // Limit
      const many = [mk('/m1'), mk('/m2'), mk('/m3')];
      await engine.enrichImages(many, { getText }, { limit: 2, cache: new Map() });
      assert.strictEqual(hits, 5);
    } finally { srv.close(); }
  });

  await test('getText: maxBytes lädt nur den Anfang', async () => {
    const big = '<head><meta property="og:image" content="https://a/b.jpg"></head>' + 'x'.repeat(2_000_000);
    const { srv, port } = await serve((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(big); });
    try {
      const text = await getText(`http://127.0.0.1:${port}/`, { maxBytes: 100000 });
      assert.ok(text.length < 1_000_000, 'Abbruch nach maxBytes');
      assert.ok(text.includes('og:image'));
    } finally { srv.close(); }
  });

  await test('Spiele: anstehend/Ergebnisse trennen, ungültige Einträge melden', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    const r = splitFixtures([
      { sport: 'futbol', home: 'A', away: 'B', date: '2026-11-03T18:00:00+03:00' },
      { sport: 'futbol', home: 'A', away: 'C', date: '2026-11-02T18:00:00+03:00' },
      { sport: 'basketbol', home: 'D', away: 'E', date: '2026-10-20T18:00:00+03:00', homeScore: 70, awayScore: '75' },
      { sport: 'voleybol', home: 'F', away: 'G', date: '2026-10-25T18:00:00+03:00', homeScore: 3, awayScore: 1 },
      { sport: 'futbol', home: 'X', away: 'Y', date: '2026-10-01T18:00:00+03:00' },
      { sport: 'golf', home: 'A', away: 'B', date: '2026-11-03T18:00:00Z' },
      { sport: 'futbol', home: 'A', away: 'B', date: 'kaputt' },
      { sport: 'futbol', home: 'A', away: 'B', date: '2026-11-03T18:00:00Z', homeScore: 1 },
    ], now);
    assert.deepStrictEqual(r.upcoming.map((f) => f.away), ['C', 'B']);
    assert.deepStrictEqual(r.results.map((f) => f.home), ['F', 'D']);
    assert.strictEqual(r.results[1].awayScore, 75);
    assert.strictEqual(r.errors.length, 3);
  });

  await test('Spiele: fehlende/kaputte Datei bricht nichts', () => {
    assert.deepStrictEqual(loadFixturesFile('/nicht/vorhanden.json'), { upcoming: [], results: [], errors: [] });
    const f = path.join(os.tmpdir(), `fx-${process.pid}.json`);
    fs.writeFileSync(f, '{kaputt');
    try { assert.strictEqual(loadFixturesFile(f).errors.length, 1); } finally { fs.unlinkSync(f); }
  });

  await test('sources.json: gültig, eindeutige IDs, nur https, Sportarten bekannt', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sources.json'), 'utf8'));
    const ids = cfg.sources.map((s) => s.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'doppelte IDs');
    for (const s of cfg.sources) {
      assert.match(s.url, /^https:\/\//, s.id);
      assert.ok(['auto', 'futbol', 'basketbol', 'voleybol', 'diger'].includes(s.sport), s.id);
      new URL(s.url);
    }
    assert.ok(cfg.sources.length >= 15);
  });

  console.log(`\n${passed} Tests bestanden`);
})();
