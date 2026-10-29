(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.FB = root.FB || {}; root.FB.classify = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Ordnet einen Artikel einer Sportart zu. Reihenfolge ist wichtig:
  // spezifische Sportarten vor "futbol", das als Standard gilt.

  const SPORTS = {
    futbol: { label: 'Fußball', icon: '⚽' },
    basketbol: { label: 'Basketball', icon: '🏀' },
    voleybol: { label: 'Volleyball', icon: '🏐' },
    diger: { label: 'Weitere Sportarten', icon: '🏅' },
  };

  // Schlüsselwörter werden gegen eine kleingeschriebene, türkisch-normalisierte Fassung geprüft.
  // Leerzeichen am Rand verhindern Teilwort-Treffer ("profile" enthält "file").
  const RULES = [
    {
      sport: 'voleybol',
      words: ['voleybol', 'volleyball', 'sultanlar ligi', 'efeler ligi', 'fenerbahce opet', 'fenerbahce medicana', 'filenin', ' cev ', 'melissa vargas', 'eda erdem', ' file '],
    },
    {
      sport: 'basketbol',
      words: ['basketbol', 'basketball', 'fenerbahce beko', 'fenerbahce alinki', 'euroleague', 'thy avrupa', 'potaya', ' bsl ', ' tbl ', ' nba ', 'kadin basketbol', 'kizilyildiz', 'sarunas', 'datome', 'larkin'],
    },
    {
      sport: 'diger',
      words: [
        'hentbol', 'handball', 'futsal', 'buz hokeyi', 'ice hockey', 'atletizm', 'athletics', 'yuzme', 'swimming', 'kurek', 'rowing', 'yelken', 'sailing',
        'espor', 'e-spor', 'esports', 'okculuk', 'archery', 'tekvando', 'taekwondo', 'boks', 'boxing', 'gures', 'wrestling', 'judo', 'jimnastik', 'gymnastics',
        'satranc', 'chess', 'tenis', 'badminton', 'ampute', 'bisiklet', 'eskrim', 'fencing', 'su topu', 'halter', 'olimpiyat', 'olympic', 'paralimpik', 'curling',
      ],
    },
    {
      sport: 'futbol',
      words: ['super lig', 'futbol', 'football', 'transfer', 'tedesco', 'mourinho', 'kartal', 'derbi', 'ziraat turkiye kupasi', 'avrupa ligi', 'sampiyonlar ligi', 'konferans ligi', 'teknik direktor', 'kadin futbol', 'sukru saracoglu', 'kadikoy', ' gol ', 'penalti', ' tff ', ' var ', 'hakem', 'ilk 11', 'maci'],
    },
  ];

  // Türkische Sonderzeichen vereinfachen, damit "Fenerbahçe"/"Fenerbahce" gleich behandelt werden.
  function normalize(text) {
    return (' ' + String(text || '')
      .replace(/İ/g, 'i')
      .replace(/I/g, 'i')
      .toLowerCase()
      .replace(/ı/g, 'i')
      .replace(/ç/g, 'c')
      .replace(/ğ/g, 'g')
      .replace(/ö/g, 'o')
      .replace(/ş/g, 's')
      .replace(/ü/g, 'u')
      .replace(/â/g, 'a')
      .replace(/î/g, 'i')
      .replace(/û/g, 'u') + ' ');
  }

  function detect(text) {
    for (const rule of RULES) {
      if (rule.words.some((w) => text.includes(w))) return rule.sport;
    }
    return null;
  }

  function classify(item, hint) {
    if (hint && hint !== 'auto' && SPORTS[hint]) {
      // Die Quelle ist bereits sportartspezifisch. Nur bei eindeutigem Gegenbeleg im Titel umordnen.
      const byTitle = detect(normalize(item.title));
      if (byTitle && byTitle !== hint && hint === 'futbol') return byTitle;
      return hint;
    }
    const text = normalize(item.title + ' ' + (item.summary || ''));
    return detect(text) || 'futbol';
  }

  return { classify, normalize, SPORTS };
});
