(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.FB = root.FB || {}; root.FB.fixtures = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SPORT_KEYS = ['futbol', 'basketbol', 'voleybol', 'diger'];

  // Prüft einen Eintrag und liefert entweder ein bereinigtes Objekt oder eine Fehlermeldung.
  function normalizeFixture(raw, index) {
    const where = 'Eintrag ' + (index + 1);
    if (!raw || typeof raw !== 'object') return { error: where + ': kein Objekt' };
    if (!SPORT_KEYS.includes(raw.sport)) return { error: where + ': sport muss ' + SPORT_KEYS.join(', ') + ' sein' };
    if (!raw.home || !raw.away) return { error: where + ': home und away sind Pflicht' };
    const time = Date.parse(raw.date);
    if (Number.isNaN(time)) return { error: where + ': date ungültig (Beispiel: 2026-11-01T18:00:00+03:00)' };

    const hasHome = raw.homeScore !== null && raw.homeScore !== undefined && raw.homeScore !== '';
    const hasAway = raw.awayScore !== null && raw.awayScore !== undefined && raw.awayScore !== '';
    if (hasHome !== hasAway) return { error: where + ': homeScore und awayScore müssen beide gesetzt oder beide leer sein' };
    const homeScore = hasHome ? Number(raw.homeScore) : null;
    const awayScore = hasAway ? Number(raw.awayScore) : null;
    if (hasHome && (!Number.isFinite(homeScore) || !Number.isFinite(awayScore))) return { error: where + ': Ergebnis ist keine Zahl' };

    return {
      fixture: {
        sport: raw.sport,
        competition: String(raw.competition || ''),
        home: String(raw.home),
        away: String(raw.away),
        date: new Date(time).toISOString(),
        venue: String(raw.venue || ''),
        homeScore,
        awayScore,
      },
    };
  }

  function splitFixtures(rawList, now) {
    if (now === undefined) now = Date.now();
    const errors = [];
    const valid = [];
    rawList.forEach((raw, i) => {
      const r = normalizeFixture(raw, i);
      if (r.error) errors.push(r.error); else valid.push(r.fixture);
    });

    const finished = valid.filter((f) => f.homeScore !== null);
    const open = valid.filter((f) => f.homeScore === null);
    // Spiele ohne Ergebnis bleiben bis 3 Stunden nach Anpfiff als "anstehend" sichtbar (laufendes Spiel).
    const upcoming = open.filter((f) => Date.parse(f.date) >= now - 3 * 3600000)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const results = finished.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    return { upcoming, results, errors };
  }

  // Nimmt den Text von fixtures.json entgegen (Server und App nutzen dieselbe Logik).
  function parseFixturesText(text, now) {
    if (!text || !String(text).trim()) return { upcoming: [], results: [], errors: [] };
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return { upcoming: [], results: [], errors: ['fixtures.json ist kein gültiges JSON: ' + err.message] };
    }
    const list = Array.isArray(data) ? data : data && data.fixtures;
    if (!Array.isArray(list)) return { upcoming: [], results: [], errors: ['fixtures.json: Liste "fixtures" fehlt'] };
    return splitFixtures(list, now);
  }

  return { normalizeFixture, splitFixtures, parseFixturesText };
});
