'use strict';

const fs = require('fs');
const { parseFixturesText } = require('../public/shared/fixtures');

// Liest fixtures.json. Eine fehlende Datei ist kein Fehler (leere Listen).
function loadFixturesFile(file, now) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { upcoming: [], results: [], errors: [] };
    return { upcoming: [], results: [], errors: ['Datei nicht lesbar: ' + err.message] };
  }
  return parseFixturesText(text, now);
}

module.exports = { loadFixturesFile };
