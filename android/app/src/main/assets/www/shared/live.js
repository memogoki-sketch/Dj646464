(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./classify'), require('./fixtures'));
  else { root.FB = root.FB || {}; root.FB.live = factory(root.FB.classify, root.FB.fixtures); }
})(typeof self !== 'undefined' ? self : this, function (classify, fixtures) {
  'use strict';

  // Live-Tabellen, Spiele (mit Live-Stand) und TV-Sender. Läuft in Node (Windows-Server) und im Browser (Android-App).
  // Netzwerkzugriff kommt von außen: io.getText(url, { timeout }) -> Promise<string>

  const ESPN_BASE = 'https://site.api.espn.com';
  const SDB_BASE = 'https://www.thesportsdb.com/api/v1/json/3';
  const SPORT_ORDER = ['futbol', 'basketbol', 'voleybol', 'diger'];

  // ---------- Hilfsfunktionen ----------

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function pick(v, fallback) { return v === null || v === undefined ? fallback : v; }
  function norm(s) { return classify.normalize(s).trim(); }
  function isFener(name) { return norm(name).indexOf('fenerbahce') !== -1; }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function httpsUrl(url) {
    if (!url || typeof url !== 'string') return '';
    if (/^http:\/\//i.test(url)) return 'https://' + url.slice(7);
    return /^https:\/\//i.test(url) ? url : '';
  }

  // Wort beginnt (links Wortgrenze) mit dem Suchbegriff: "bsl" trifft "bsl play-off", aber nicht "absl".
  function hasWord(haystackNorm, keyword) {
    const k = norm(keyword);
    if (!k) return false;
    return new RegExp('(^|[^a-z0-9])' + escapeRe(k)).test(haystackNorm);
  }

  // ---------- ESPN ----------

  function espnEntries(json) {
    const out = [];
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.standings && Array.isArray(node.standings.entries)) node.standings.entries.forEach((e) => out.push(e));
      (node.children || []).forEach(walk);
    })(json);
    return out;
  }

  function statMap(entry) {
    const m = {};
    (entry.stats || []).forEach((s) => {
      if (s && s.name !== undefined) m[s.name] = s.value !== undefined ? s.value : s.displayValue;
    });
    return m;
  }

  function sortRows(rows) {
    if (rows.some((r) => r.rank === null)) {
      rows.sort((a, b) => (pick(b.points, -1) - pick(a.points, -1)) || (pick(b.gd, -1e9) - pick(a.gd, -1e9)));
    } else {
      rows.sort((a, b) => a.rank - b.rank);
    }
    rows.forEach((r, i) => { if (r.rank === null) r.rank = i + 1; });
    return rows;
  }

  function parseEspnStandings(json) {
    const rows = espnEntries(json).map((e) => {
      const s = statMap(e);
      const t = e.team || {};
      const logo = t.logos && t.logos[0] ? t.logos[0].href : t.logo;
      return {
        rank: num(s.rank),
        team: t.displayName || t.name || t.shortDisplayName || '',
        logo: httpsUrl(logo),
        played: num(s.gamesPlayed),
        won: num(s.wins),
        drawn: num(s.ties !== undefined ? s.ties : s.draws),
        lost: num(s.losses),
        gf: num(s.pointsFor),
        ga: num(s.pointsAgainst),
        gd: num(s.pointDifferential),
        points: num(s.points),
      };
    }).filter((r) => r.team);
    rows.forEach((r) => { if (r.gd === null && r.gf !== null && r.ga !== null) r.gd = r.gf - r.ga; });
    return sortRows(rows);
  }

  // Spiele aus dem ESPN-Scoreboard. opts: { team, sport, competition }
  function parseEspnScoreboard(json, opts) {
    opts = opts || {};
    const teamKey = opts.team ? norm(opts.team) : '';
    const out = [];
    ((json && json.events) || []).forEach((ev) => {
      const comp = (ev.competitions || [])[0];
      if (!comp) return;
      const cs = comp.competitors || [];
      const home = cs.filter((c) => c.homeAway === 'home')[0];
      const away = cs.filter((c) => c.homeAway === 'away')[0];
      if (!home || !away) return;
      const hn = (home.team && (home.team.displayName || home.team.name)) || '';
      const an = (away.team && (away.team.displayName || away.team.name)) || '';
      if (!hn || !an) return;
      if (teamKey && norm(hn).indexOf(teamKey) === -1 && norm(an).indexOf(teamKey) === -1) return;
      const time = Date.parse(ev.date);
      if (Number.isNaN(time)) return;

      const st = ev.status || comp.status || {};
      const type = st.type || {};
      const typeName = String(type.name || '');
      let status = 'scheduled';
      if (/POSTPONED|CANCEL|SUSPENDED/i.test(typeName)) status = 'postponed';
      else if (type.state === 'in') status = 'live';
      else if (type.state === 'post' || type.completed === true) status = 'finished';

      const withScore = status === 'live' || status === 'finished';
      out.push({
        sport: opts.sport || 'futbol',
        competition: opts.competition || '',
        home: hn,
        away: an,
        date: new Date(time).toISOString(),
        venue: (comp.venue && comp.venue.fullName) || '',
        homeScore: withScore ? num(home.score) : null,
        awayScore: withScore ? num(away.score) : null,
        status,
        clock: status === 'live' ? String(st.displayClock || type.shortDetail || '') : '',
        tv: [],
        source: 'live',
      });
    });
    return out;
  }

  // ---------- TheSportsDB (Tabelle als zweite Quelle) ----------

  function parseSportsDbTable(json) {
    const list = (json && json.table) || [];
    if (!Array.isArray(list)) return [];
    const rows = list.map((r) => ({
      rank: num(r.intRank),
      team: r.strTeam || '',
      logo: httpsUrl(r.strBadge || r.strTeamBadge),
      played: num(r.intPlayed),
      won: num(r.intWin),
      drawn: num(r.intDraw),
      lost: num(r.intLoss),
      gf: num(r.intGoalsFor),
      ga: num(r.intGoalsAgainst),
      gd: num(r.intGoalDifference),
      points: num(r.intPoints),
    })).filter((r) => r.team);
    return sortRows(rows);
  }

  // ---------- Eigene Tabellen (standings.json) ----------

  function normalizeManualTable(raw, index) {
    const where = 'Tabelle ' + (index + 1);
    if (!raw || typeof raw !== 'object') return { error: where + ': kein Objekt' };
    if (SPORT_ORDER.indexOf(raw.sport) === -1) return { error: where + ': sport muss ' + SPORT_ORDER.join(', ') + ' sein' };
    if (!raw.name) return { error: where + ': name fehlt' };
    if (!Array.isArray(raw.rows) || !raw.rows.length) return { error: where + ' (' + raw.name + '): rows fehlt oder ist leer' };
    const rows = [];
    for (let i = 0; i < raw.rows.length; i++) {
      const r = raw.rows[i];
      if (!r || !r.team) return { error: where + ' (' + raw.name + '): Zeile ' + (i + 1) + ' ohne team' };
      const row = {
        rank: num(r.rank), team: String(r.team), logo: '',
        played: num(r.played), won: num(r.won), drawn: num(r.drawn), lost: num(r.lost),
        gf: num(r.gf), ga: num(r.ga), gd: num(r.gd), points: num(r.points),
      };
      if (row.gd === null && row.gf !== null && row.ga !== null) row.gd = row.gf - row.ga;
      rows.push(row);
    }
    // Reihenfolge der Datei bleibt, wenn keine Plätze angegeben sind
    if (rows.every((r) => r.rank !== null)) rows.sort((a, b) => a.rank - b.rank);
    rows.forEach((r, i) => { if (r.rank === null) r.rank = i + 1; });
    return {
      table: {
        id: String(raw.id || ('manuell-' + (index + 1))),
        sport: raw.sport,
        name: String(raw.name),
        goalsLabel: String(raw.goalsLabel || 'Tore'),
        updatedAt: raw.updatedAt ? String(raw.updatedAt) : '',
        source: 'manual',
        sourceName: String(raw.source || 'eigene Datei'),
        stale: false,
        rows,
      },
    };
  }

  function parseStandingsText(text) {
    if (!text || !String(text).trim()) return { tables: [], errors: [] };
    let data;
    try { data = JSON.parse(text); } catch (err) { return { tables: [], errors: ['standings.json ist kein gültiges JSON: ' + err.message] }; }
    const list = Array.isArray(data) ? data : data && data.tables;
    if (!Array.isArray(list)) return { tables: [], errors: ['standings.json: Liste "tables" fehlt'] };
    const tables = [];
    const errors = [];
    list.forEach((raw, i) => {
      const r = normalizeManualTable(raw, i);
      if (r.error) errors.push('standings.json: ' + r.error); else tables.push(r.table);
    });
    return { tables, errors };
  }

  // ---------- TV-Sender (tv.json) ----------

  function normChannel(c) {
    if (typeof c === 'string') return c.trim() ? { name: c.trim(), type: 'tv', free: null } : null;
    if (!c || !c.name) return null;
    return { name: String(c.name), type: c.type === 'stream' ? 'stream' : 'tv', free: typeof c.free === 'boolean' ? c.free : null };
  }

  function parseTvText(text) {
    const empty = { competitions: [], updatedAt: '', note: '', errors: [] };
    if (!text || !String(text).trim()) return empty;
    let data;
    try { data = JSON.parse(text); } catch (err) { empty.errors.push('tv.json ist kein gültiges JSON: ' + err.message); return empty; }
    const list = Array.isArray(data) ? data : data && data.competitions;
    if (!Array.isArray(list)) { empty.errors.push('tv.json: Liste "competitions" fehlt'); return empty; }
    const competitions = [];
    list.forEach((c, i) => {
      if (!c || !c.name) { empty.errors.push('tv.json: Eintrag ' + (i + 1) + ' ohne name'); return; }
      const channels = (Array.isArray(c.channels) ? c.channels : []).map(normChannel).filter(Boolean);
      competitions.push({
        id: String(c.id || ('tv-' + (i + 1))),
        sport: SPORT_ORDER.indexOf(c.sport) !== -1 ? c.sport : '',
        name: String(c.name),
        match: (Array.isArray(c.match) && c.match.length ? c.match : [c.name]).map(String),
        channels,
        note: c.note ? String(c.note) : '',
        asOf: c.asOf ? String(c.asOf) : '',
        source: c.source ? String(c.source) : '',
      });
    });
    return { competitions, updatedAt: data.updatedAt ? String(data.updatedAt) : '', note: data.note ? String(data.note) : '', errors: empty.errors };
  }

  function findCompetition(fixture, comps) {
    const h = ' ' + norm(fixture.competition || '') + ' ';
    if (!norm(fixture.competition || '')) return null;
    for (const c of comps) {
      if (c.sport && fixture.sport && c.sport !== fixture.sport) continue;
      if (c.match.some((k) => hasWord(h.trim(), k))) return c;
    }
    return null;
  }

  function findChannel(comps, name) {
    const n = norm(name);
    for (const c of comps) for (const ch of c.channels) if (norm(ch.name) === n) return ch;
    return null;
  }

  // Sender für ein Spiel: eigene Angabe im Spiel gewinnt, sonst Zuordnung nach Wettbewerb.
  function resolveTv(fixture, comps) {
    if (fixture.tv && fixture.tv.length) {
      return fixture.tv.map((n) => findChannel(comps, n) || { name: n, type: 'tv', free: null });
    }
    const c = findCompetition(fixture, comps);
    return c ? c.channels : [];
  }

  // ---------- Spiele zusammenführen ----------

  function sameMatch(a, b) {
    if (Math.abs(Date.parse(a.date) - Date.parse(b.date)) > 12 * 3600000) return false;
    const loose = (x, y) => x === y || x.indexOf(y) !== -1 || y.indexOf(x) !== -1;
    return loose(norm(a.home), norm(b.home)) && loose(norm(a.away), norm(b.away));
  }

  // Manuelle Einträge liefern Sender, Ort und Wettbewerb; Live-Daten liefern Stand, Uhrzeit und Ergebnis.
  function mergeMatches(manual, liveList) {
    const out = manual.map((m) => Object.assign({ status: m.homeScore !== null ? 'finished' : 'scheduled', clock: '', source: 'manual' }, m));
    liveList.forEach((l) => {
      const idx = out.findIndex((m) => sameMatch(m, l));
      if (idx === -1) { out.push(l); return; }
      const m = out[idx];
      out[idx] = Object.assign({}, m, {
        date: l.date, homeScore: l.homeScore, awayScore: l.awayScore, status: l.status, clock: l.clock, source: 'live',
        venue: m.venue || l.venue, competition: m.competition || l.competition, tv: m.tv,
      });
    });
    return out;
  }

  function byDateAsc(a, b) { return Date.parse(a.date) - Date.parse(b.date); }
  function byDateDesc(a, b) { return Date.parse(b.date) - Date.parse(a.date); }

  // Baut die Ansicht für die App aus den Dateien (als Text) und den Live-Ergebnissen.
  function buildView(inputs, liveResult, now) {
    now = now === undefined ? Date.now() : now;
    liveResult = liveResult || { tables: [], matches: [], status: [] };
    const errors = [];

    const fx = fixtures.parseFixturesText(inputs.fixturesText, now);
    errors.push.apply(errors, fx.errors);
    const tv = parseTvText(inputs.tvText);
    errors.push.apply(errors, tv.errors);
    const st = parseStandingsText(inputs.standingsText);
    errors.push.apply(errors, st.errors);

    const all = mergeMatches(fx.results.concat(fx.upcoming), liveResult.matches || []);
    all.forEach((m) => {
      m.tvChannels = resolveTv(m, tv.competitions);
      const comp = findCompetition(m, tv.competitions);
      m.tvCompetition = comp ? comp.name : '';
    });

    const matches = {
      live: all.filter((m) => m.status === 'live').sort(byDateAsc),
      upcoming: all.filter((m) => (m.status === 'scheduled' || m.status === 'postponed') && Date.parse(m.date) >= now - 3 * 3600000).sort(byDateAsc),
      results: all.filter((m) => m.status === 'finished' && m.homeScore !== null && m.awayScore !== null).sort(byDateDesc),
    };

    // Live-Tabellen haben Vorrang; eigene Tabellen füllen Lücken (auch wenn die Live-Quelle ausfällt)
    const liveTables = liveResult.tables || [];
    const tables = liveTables.slice();
    st.tables.forEach((t) => { if (!liveTables.some((l) => l.id === t.id)) tables.push(t); });
    tables.sort((a, b) => SPORT_ORDER.indexOf(a.sport) - SPORT_ORDER.indexOf(b.sport));

    return {
      tables,
      matches,
      tv: { competitions: tv.competitions, updatedAt: tv.updatedAt, note: tv.note },
      errors,
    };
  }

  // ---------- Live laden ----------

  function sourceLabel(src) {
    return src.type === 'espn' ? 'ESPN' : src.type === 'thesportsdb' ? 'TheSportsDB' : String(src.type);
  }

  async function getJson(io, url) {
    const text = await io.getText(url, { timeout: 12000 });
    try { return JSON.parse(text); } catch (e) { throw new Error('Antwort ist kein JSON'); }
  }

  async function fetchTableRows(src, io) {
    if (src.type === 'espn') {
      const url = (src.baseUrl || ESPN_BASE) + '/apis/v2/sports/' + (src.sportPath || 'soccer') + '/' + encodeURIComponent(src.league) + '/standings';
      return parseEspnStandings(await getJson(io, url));
    }
    if (src.type === 'thesportsdb') {
      const url = (src.baseUrl || SDB_BASE) + '/lookuptable.php?l=' + encodeURIComponent(src.league) + '&s=' + encodeURIComponent(src.season || '');
      return parseSportsDbTable(await getJson(io, url));
    }
    throw new Error('Unbekannter Quellentyp: ' + src.type);
  }

  function ymd(ms) {
    const d = new Date(ms);
    const p = (n) => (n < 10 ? '0' : '') + n;
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
  }

  async function fetchMatchList(m, io, now) {
    if (m.type !== 'espn') throw new Error('Unbekannter Quellentyp: ' + m.type);
    const from = ymd(now - (m.daysBack || 14) * 86400000);
    const to = ymd(now + (m.daysAhead || 45) * 86400000);
    const url = (m.baseUrl || ESPN_BASE) + '/apis/site/v2/sports/' + (m.sportPath || 'soccer') + '/' + encodeURIComponent(m.league) + '/scoreboard?dates=' + from + '-' + to + '&limit=400';
    return parseEspnScoreboard(await getJson(io, url), { team: m.team, sport: m.sport, competition: m.competition });
  }

  // liveCfg: { tables: [{id, sport, name, goalsLabel, sources:[{type, league, ...}]}], matches: [{id, type, league, team, sport, competition}] }
  // previous: Ergebnis des letzten Laufs. Fällt eine Quelle aus, bleiben deren letzte Daten erhalten (stale).
  async function loadLive(liveCfg, io, previous, now) {
    const cfg = liveCfg || {};
    previous = previous || { tables: [], matches: [] };
    now = now === undefined ? Date.now() : now;
    const status = [];

    const tableJobs = (cfg.tables || []).filter((t) => t.enabled !== false).map(async (t) => {
      for (const src of t.sources || []) {
        const label = sourceLabel(src);
        const entry = { id: 'tabelle:' + t.id + ':' + src.type, name: 'Tabelle ' + t.name + ' (' + label + ')' };
        try {
          const rows = await fetchTableRows(src, io);
          if (!rows.length) throw new Error('keine Daten erhalten');
          status.push(Object.assign(entry, { ok: true, count: rows.length, error: null }));
          return { id: t.id, sport: t.sport, name: t.name, goalsLabel: t.goalsLabel || 'Tore', rows, updatedAt: new Date().toISOString(), source: 'live', sourceName: label, stale: false };
        } catch (e) {
          status.push(Object.assign(entry, { ok: false, count: 0, error: String((e && e.message) || e) }));
        }
      }
      const old = (previous.tables || []).filter((x) => x.id === t.id)[0];
      return old ? Object.assign({}, old, { stale: true }) : null;
    });

    const matchJobs = (cfg.matches || []).filter((m) => m.enabled !== false).map(async (m) => {
      const entry = { id: 'spiele:' + m.id, name: 'Spiele ' + (m.competition || m.id) + ' (' + sourceLabel(m) + ')' };
      try {
        const list = await fetchMatchList(m, io, now);
        status.push(Object.assign(entry, { ok: true, count: list.length, error: null }));
        return list.map((x) => Object.assign(x, { _p: m.id }));
      } catch (e) {
        status.push(Object.assign(entry, { ok: false, count: 0, error: String((e && e.message) || e) }));
        return (previous.matches || []).filter((x) => x._p === m.id);
      }
    });

    const tables = (await Promise.all(tableJobs)).filter(Boolean);
    const matches = [].concat.apply([], await Promise.all(matchJobs));
    return { tables, matches, status };
  }

  return {
    parseEspnStandings, parseEspnScoreboard, parseSportsDbTable,
    normalizeManualTable, parseStandingsText, parseTvText,
    resolveTv, findCompetition, mergeMatches, buildView, loadLive,
    isFener,
  };
});
