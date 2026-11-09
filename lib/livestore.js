'use strict';

const fs = require('fs');
const path = require('path');
const live = require('../public/shared/live');
const { getText } = require('./http');

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return ''; }
}

// Hält die Live-Ergebnisse (Tabellen, Spiele) im Speicher und kombiniert sie bei jeder Anfrage mit den Dateien.
// Dateien (fixtures.json, standings.json, tv.json) werden pro Anfrage neu gelesen: Änderungen wirken sofort.
function createLiveStore(opts) {
  const root = opts.root;
  const liveCfg = opts.liveCfg || {};
  const files = {
    fixtures: opts.fixturesFile || path.join(root, 'fixtures.json'),
    standings: opts.standingsFile || path.join(root, 'standings.json'),
    tv: opts.tvFile || path.join(root, 'tv.json'),
  };
  const io = opts.io || { getText };
  const state = { result: { tables: [], matches: [], status: [] }, fetchedAt: null, refreshing: null };

  async function refresh() {
    if (state.refreshing) return state.refreshing;
    state.refreshing = (async () => {
      try {
        const result = await live.loadLive(liveCfg, io, state.result);
        state.result = result;
        state.fetchedAt = new Date().toISOString();
        const ok = result.status.filter((s) => s.ok).length;
        console.log(`[${state.fetchedAt}] Live-Daten: ${result.tables.length} Tabellen, ${result.matches.length} Spiele, ${ok}/${result.status.length} Abrufe OK`);
      } catch (err) {
        console.error('Live-Aktualisierung fehlgeschlagen:', err.message);
      } finally {
        state.refreshing = null;
      }
    })();
    return state.refreshing;
  }

  function view(now) {
    const v = live.buildView({
      fixturesText: readText(files.fixtures),
      standingsText: readText(files.standings),
      tvText: readText(files.tv),
    }, state.result, now);
    return Object.assign(v, {
      updatedAt: state.fetchedAt,
      refreshing: Boolean(state.refreshing),
      status: state.result.status,
      configured: Boolean((liveCfg.tables && liveCfg.tables.length) || (liveCfg.matches && liveCfg.matches.length)),
    });
  }

  return { refresh, view, state };
}

module.exports = { createLiveStore };
