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

  // ---------- Live-Tabelle, Spiele, TV ----------
  const live = require('../public/shared/live');

  const ESPN_STANDINGS = { children: [{ name: 'Trendyol Süper Lig', standings: { entries: [
    { team: { displayName: 'Galatasaray', logos: [{ href: 'http://a.espncdn.com/g.png' }] }, stats: [
      { name: 'rank', value: 2 }, { name: 'gamesPlayed', value: 10 }, { name: 'wins', value: 7 }, { name: 'ties', value: 2 }, { name: 'losses', value: 1 },
      { name: 'pointsFor', value: 20 }, { name: 'pointsAgainst', value: 8 }, { name: 'pointDifferential', value: 12 }, { name: 'points', value: 23 }] },
    { team: { displayName: 'Fenerbahce', logos: [{ href: 'https://a.espncdn.com/f.png' }] }, stats: [
      { name: 'rank', value: 1 }, { name: 'gamesPlayed', value: 10 }, { name: 'wins', value: 7 }, { name: 'ties', value: 3 }, { name: 'losses', value: 0 },
      { name: 'pointsFor', value: 24 }, { name: 'pointsAgainst', value: 7 }, { name: 'points', value: 24 }] },
  ] } }] };

  const espnEvent = (id, date, state, hs, as, extra) => Object.assign({
    id, date,
    status: { displayClock: "67'", type: { name: state === 'in' ? 'STATUS_IN_PROGRESS' : state === 'post' ? 'STATUS_FULL_TIME' : 'STATUS_SCHEDULED', state, completed: state === 'post', shortDetail: 'x' } },
    competitions: [{ venue: { fullName: 'Şükrü Saracoğlu' }, competitors: [
      { homeAway: 'home', score: String(hs), team: { displayName: 'Fenerbahce' } },
      { homeAway: 'away', score: String(as), team: { displayName: 'Rizespor' } }] }],
  }, extra || {});

  await test('ESPN-Tabelle: Reihenfolge, Statistik, Tordifferenz, https-Logo', () => {
    const rows = live.parseEspnStandings(ESPN_STANDINGS);
    assert.deepStrictEqual(rows.map((r) => r.team), ['Fenerbahce', 'Galatasaray']);
    assert.strictEqual(rows[0].rank, 1);
    assert.strictEqual(rows[0].gd, 17, 'Differenz wird aus Toren berechnet, wenn sie fehlt');
    assert.strictEqual(rows[1].logo, 'https://a.espncdn.com/g.png', 'http wird zu https');
    assert.strictEqual(rows[1].drawn, 2);
    assert.deepStrictEqual(live.parseEspnStandings({}), []);
    assert.deepStrictEqual(live.parseEspnStandings(null), []);
  });

  await test('ESPN-Tabelle: ohne Platz-Angabe nach Punkten und Differenz sortiert', () => {
    const noRank = JSON.parse(JSON.stringify(ESPN_STANDINGS));
    noRank.children[0].standings.entries.forEach((e) => { e.stats = e.stats.filter((s) => s.name !== 'rank'); });
    const rows = live.parseEspnStandings(noRank);
    assert.deepStrictEqual(rows.map((r) => [r.rank, r.team]), [[1, 'Fenerbahce'], [2, 'Galatasaray']]);
  });

  await test('TheSportsDB-Tabelle wird gelesen', () => {
    const rows = live.parseSportsDbTable({ table: [
      { intRank: '2', strTeam: 'B', intPlayed: '5', intWin: '3', intDraw: '1', intLoss: '1', intGoalsFor: '9', intGoalsAgainst: '5', intGoalDifference: '4', intPoints: '10' },
      { intRank: '1', strTeam: 'A', intPlayed: '5', intWin: '4', intDraw: '1', intLoss: '0', intGoalsFor: '12', intGoalsAgainst: '3', intGoalDifference: '9', intPoints: '13', strBadge: 'http://x/y.png' },
    ] });
    assert.deepStrictEqual(rows.map((r) => r.team), ['A', 'B']);
    assert.strictEqual(rows[0].points, 13);
    assert.strictEqual(rows[0].logo, 'https://x/y.png');
    assert.deepStrictEqual(live.parseSportsDbTable({ table: null }), []);
  });

  await test('ESPN-Spiele: nur Fenerbahçe, Status, Live-Stand, Ergebnis', () => {
    const other = espnEvent('9', '2026-11-20T17:00Z', 'pre', 0, 0);
    other.competitions[0].competitors[0].team.displayName = 'Besiktas';
    other.competitions[0].competitors[1].team.displayName = 'Galatasaray';
    const json = { events: [
      espnEvent('1', '2026-11-08T17:00Z', 'in', 1, 0),
      espnEvent('2', '2026-11-01T17:00Z', 'post', 3, 1),
      espnEvent('3', '2026-11-29T17:00Z', 'pre', 0, 0),
      espnEvent('4', '2026-12-06T17:00Z', 'pre', 0, 0, { status: { type: { name: 'STATUS_POSTPONED', state: 'pre' } } }),
      other,
      { id: 'kaputt', date: 'x', competitions: [] },
    ] };
    const list = live.parseEspnScoreboard(json, { team: 'fenerbahce', sport: 'futbol', competition: 'Trendyol Süper Lig' });
    assert.strictEqual(list.length, 4, 'fremde und defekte Einträge fallen weg');
    assert.deepStrictEqual(list.map((m) => m.status), ['live', 'finished', 'scheduled', 'postponed']);
    assert.strictEqual(list[0].homeScore, 1);
    assert.strictEqual(list[0].clock, "67'");
    assert.strictEqual(list[1].awayScore, 1);
    assert.strictEqual(list[2].homeScore, null, 'geplante Spiele haben kein Ergebnis');
    assert.strictEqual(list[2].clock, '');
    assert.strictEqual(list[0].competition, 'Trendyol Süper Lig');
    assert.strictEqual(list[0].venue, 'Şükrü Saracoğlu');
  });

  const TV_TEXT = fs.readFileSync(path.join(__dirname, '..', 'tv.json'), 'utf8');

  await test('tv.json: gültig, Quellen vorhanden, Sender normalisiert', () => {
    const tv = live.parseTvText(TV_TEXT);
    assert.deepStrictEqual(tv.errors, []);
    assert.ok(tv.competitions.length >= 6);
    for (const c of tv.competitions) {
      assert.ok(c.channels.length > 0, c.id);
      assert.ok(c.asOf, c.id + ' ohne Stand');
      assert.match(c.source, /^https:\/\//, c.id + ' ohne Quelle');
    }
    const bsl = tv.competitions.find((c) => c.id === 'bsl');
    assert.deepStrictEqual(bsl.channels.map((c) => c.type), ['tv', 'stream']);
    const m = live.parseTvText('{"competitions":[{"name":"X","channels":["Eins",{"name":"Zwei","type":"stream","free":true},{"nope":1}]},{"x":1}]}');
    assert.deepStrictEqual(m.competitions[0].channels, [{ name: 'Eins', type: 'tv', free: null }, { name: 'Zwei', type: 'stream', free: true }]);
    assert.strictEqual(m.errors.length, 1);
    assert.strictEqual(live.parseTvText('{kaputt').errors.length, 1);
    assert.deepStrictEqual(live.parseTvText('').competitions, []);
  });

  await test('Sender-Zuordnung: nach Wettbewerb, Sportart, eigene Angabe, keine Fehltreffer', () => {
    const comps = live.parseTvText(TV_TEXT).competitions;
    const names = (f) => live.resolveTv(f, comps).map((c) => c.name);
    assert.deepStrictEqual(names({ sport: 'futbol', competition: 'Trendyol Süper Lig' }), ['beIN Sports']);
    assert.deepStrictEqual(names({ sport: 'futbol', competition: 'Süper Lig, 12. Spieltag' }), ['beIN Sports']);
    assert.deepStrictEqual(names({ sport: 'futbol', competition: 'Ziraat Türkiye Kupası' }), ['ATV', 'A Spor']);
    assert.deepStrictEqual(names({ sport: 'futbol', competition: 'UEFA Europa League' }), ['TRT', 'tabii']);
    assert.deepStrictEqual(names({ sport: 'basketbol', competition: 'EuroLeague' }), ['S Sport', 'S Sport Plus']);
    assert.deepStrictEqual(names({ sport: 'basketbol', competition: 'BSL Play-off' }), ['beIN Sports 5', 'TOD']);
    assert.deepStrictEqual(names({ sport: 'voleybol', competition: 'Sultanlar Ligi' }), ['TVF Voleybol TV (YouTube)']);
    assert.deepStrictEqual(names({ sport: 'voleybol', competition: 'EuroLeague' }), [], 'falsche Sportart darf nicht passen');
    assert.deepStrictEqual(names({ sport: 'basketbol', competition: 'Absl Cup' }), [], 'Wortanfang: "bsl" trifft nicht "absl"');
    assert.deepStrictEqual(names({ sport: 'diger', competition: '' }), []);
    assert.deepStrictEqual(names({ sport: 'futbol', competition: 'Süper Lig', tv: ['beIN Sports', 'Neuer Sender'] }), ['beIN Sports', 'Neuer Sender']);
    assert.strictEqual(live.resolveTv({ sport: 'futbol', competition: 'x', tv: ['beIN Sports'] }, comps)[0].free, false, 'bekannte Sender übernehmen ihre Eigenschaften');
  });

  await test('Tabellen eigener Datei: prüfen, Plätze, Differenz, Fehler melden', () => {
    const r = live.parseStandingsText(JSON.stringify({ tables: [
      { id: 'a', sport: 'basketbol', name: 'EL', goalsLabel: 'Punkte', rows: [{ team: 'X', played: 2, won: 2, lost: 0, gf: 160, ga: 140, points: 4 }, { team: 'Y', played: 2, won: 0, lost: 2, points: 2 }] },
      { sport: 'golf', name: 'Falsch', rows: [{ team: 'Q' }] },
      { sport: 'futbol', name: 'Leer', rows: [] },
      { sport: 'futbol', name: 'OhneTeam', rows: [{ played: 1 }] },
    ] }));
    assert.strictEqual(r.tables.length, 1);
    assert.strictEqual(r.errors.length, 3);
    assert.deepStrictEqual(r.tables[0].rows.map((x) => x.rank), [1, 2]);
    assert.strictEqual(r.tables[0].rows[0].gd, 20);
    assert.strictEqual(r.tables[0].rows[1].gd, null);
    assert.strictEqual(r.tables[0].goalsLabel, 'Punkte');
    assert.deepStrictEqual(live.parseStandingsText('').tables, []);
    assert.strictEqual(live.parseStandingsText('{kaputt').errors.length, 1);
    const ex = live.parseStandingsText(fs.readFileSync(path.join(__dirname, '..', 'standings.example.json'), 'utf8'));
    assert.deepStrictEqual(ex.errors, []);
    assert.strictEqual(ex.tables.length, 2);
  });

  await test('Spiele zusammenführen: Live-Stand gewinnt, Sender und Ort aus eigener Datei, keine Doppelten', () => {
    const now = Date.parse('2026-11-08T17:30:00Z');
    const fxText = JSON.stringify({ fixtures: [
      { sport: 'futbol', competition: 'Trendyol Süper Lig', home: 'Fenerbahçe', away: 'Çaykur Rizespor', date: '2026-11-08T20:00:00+03:00', venue: 'Eigener Ort', tv: 'beIN Sports 1' },
      { sport: 'basketbol', competition: 'EuroLeague', home: 'Fenerbahçe Beko', away: 'Baskonia', date: '2026-11-12T20:00:00+03:00' },
      { sport: 'voleybol', competition: 'Sultanlar Ligi', home: 'Fenerbahçe Opet', away: 'Eczacıbaşı', date: '2026-11-03T18:00:00+03:00', homeScore: 3, awayScore: 2 },
    ] });
    const liveResult = { tables: [], matches: live.parseEspnScoreboard({ events: [
      espnEvent('1', '2026-11-08T17:00Z', 'in', 1, 0),
      espnEvent('3', '2026-11-29T17:00Z', 'pre', 0, 0),
      espnEvent('2', '2026-11-01T17:00Z', 'post', 3, 1),
    ] }, { team: 'fenerbahce', sport: 'futbol', competition: 'Trendyol Süper Lig' }) };
    const v = live.buildView({ fixturesText: fxText, standingsText: '', tvText: TV_TEXT }, liveResult, now);
    assert.deepStrictEqual(v.errors, []);
    assert.strictEqual(v.matches.live.length, 1, 'Spiel aus Datei und ESPN ist dasselbe Spiel');
    const l = v.matches.live[0];
    assert.strictEqual(l.homeScore, 1);
    assert.strictEqual(l.clock, "67'");
    assert.strictEqual(l.venue, 'Eigener Ort');
    assert.deepStrictEqual(l.tvChannels.map((c) => c.name), ['beIN Sports 1'], 'eigene Sender-Angabe gewinnt');
    assert.deepStrictEqual(v.matches.upcoming.map((m) => m.away), ['Baskonia', 'Rizespor']);
    assert.deepStrictEqual(v.matches.upcoming[0].tvChannels.map((c) => c.name), ['S Sport', 'S Sport Plus']);
    assert.deepStrictEqual(v.matches.upcoming[1].tvChannels.map((c) => c.name), ['beIN Sports']);
    assert.deepStrictEqual(v.matches.results.map((m) => m.home + ':' + m.homeScore), ['Fenerbahçe Opet:3', 'Fenerbahce:3'], 'neuestes Ergebnis zuerst');
    assert.deepStrictEqual(v.matches.results[0].tvChannels.map((c) => c.name), ['TVF Voleybol TV (YouTube)']);
  });

  await test('buildView: Live-Tabelle hat Vorrang, eigene Tabelle springt ein, Sortierung nach Sportart', () => {
    const standings = JSON.stringify({ tables: [
      { id: 'tr-superlig', sport: 'futbol', name: 'Eigene Süper Lig', rows: [{ team: 'Alt' }] },
      { id: 'euroleague', sport: 'basketbol', name: 'EuroLeague', rows: [{ team: 'Fenerbahçe Beko', played: 1, won: 1, lost: 0, points: 2 }] },
    ] });
    const liveTables = [{ id: 'tr-superlig', sport: 'futbol', name: 'Trendyol Süper Lig', goalsLabel: 'Tore', rows: live.parseEspnStandings(ESPN_STANDINGS), source: 'live', stale: false }];
    const v = live.buildView({ fixturesText: '', standingsText: standings, tvText: '' }, { tables: liveTables, matches: [] });
    assert.deepStrictEqual(v.tables.map((t) => t.name), ['Trendyol Süper Lig', 'EuroLeague']);
    assert.strictEqual(v.tables[0].source, 'live');
    const down = live.buildView({ fixturesText: '', standingsText: standings, tvText: '' }, { tables: [], matches: [] });
    assert.deepStrictEqual(down.tables.map((t) => t.name), ['Eigene Süper Lig', 'EuroLeague']);
  });

  await test('loadLive: Rückfall auf zweite Quelle, Ausfall behält alte Daten (stale), Status je Abruf', async () => {
    let failEspn = false;
    const { srv, port } = await serve((req, res) => {
      const ok = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url.startsWith('/espn/apis/v2/sports/soccer/tur.1/standings')) { if (failEspn) { res.writeHead(503); return res.end('x'); } return ok(ESPN_STANDINGS); }
      if (req.url.startsWith('/espn/apis/site/v2/sports/soccer/tur.1/scoreboard')) {
        assert.match(req.url, /dates=\d{8}-\d{8}/);
        if (failEspn) { res.writeHead(503); return res.end('x'); }
        return ok({ events: [espnEvent('1', '2026-11-08T17:00Z', 'in', 2, 1)] });
      }
      if (req.url.startsWith('/sdb/lookuptable.php')) { assert.match(req.url, /l=4339&s=2026-2027/); return ok({ table: [{ intRank: '1', strTeam: 'Aus TheSportsDB', intPoints: '9' }] }); }
      res.writeHead(404); res.end();
    });
    try {
      const b = `http://127.0.0.1:${port}`;
      const cfg = {
        tables: [{ id: 't', sport: 'futbol', name: 'Liga', sources: [{ type: 'espn', league: 'tur.1', baseUrl: b + '/espn' }, { type: 'thesportsdb', league: '4339', season: '2026-2027', baseUrl: b + '/sdb' }] }],
        matches: [{ id: 'm', type: 'espn', league: 'tur.1', team: 'fenerbahce', sport: 'futbol', competition: 'Liga', baseUrl: b + '/espn' }],
      };
      const first = await live.loadLive(cfg, { getText }, null);
      assert.strictEqual(first.tables[0].sourceName, 'ESPN');
      assert.strictEqual(first.tables[0].rows[0].team, 'Fenerbahce');
      assert.strictEqual(first.matches.length, 1);
      assert.strictEqual(first.matches[0].status, 'live');
      assert.ok(first.status.every((s) => s.ok));

      failEspn = true;
      const second = await live.loadLive(cfg, { getText }, first);
      assert.strictEqual(second.tables[0].sourceName, 'TheSportsDB', 'zweite Quelle springt ein');
      assert.strictEqual(second.tables[0].rows[0].team, 'Aus TheSportsDB');
      assert.strictEqual(second.matches.length, 1, 'alte Spiele bleiben erhalten');
      const bad = second.status.filter((s) => !s.ok);
      assert.strictEqual(bad.length, 2);
      assert.match(bad[0].error, /HTTP 503/);

      const none = await live.loadLive({ tables: [{ id: 'z', sport: 'futbol', name: 'Z', sources: [{ type: 'espn', league: 'tur.1', baseUrl: b + '/espn' }] }] }, { getText }, null);
      assert.deepStrictEqual(none.tables, [], 'ohne Daten und ohne Altbestand keine Tabelle');
      const stale = await live.loadLive({ tables: [{ id: 't', sport: 'futbol', name: 'Liga', sources: [{ type: 'espn', league: 'tur.1', baseUrl: b + '/espn' }] }] }, { getText }, first);
      assert.strictEqual(stale.tables[0].stale, true, 'Ausfall: letzte Daten, als veraltet markiert');
      assert.strictEqual(stale.tables[0].rows[0].team, 'Fenerbahce');
    } finally { srv.close(); }
  });

  console.log(`\n${passed} Tests bestanden`);
})();
