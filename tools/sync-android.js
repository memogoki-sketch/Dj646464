'use strict';

// Kopiert die Oberfläche (public/), die Quellen und den Spielplan in die Android-App.
// Nach Änderungen an public/, sources.json oder fixtures.json einmal ausführen: node tools/sync-android.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'www');

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(path.join(root, 'public'), dest, { recursive: true });
for (const f of ['sources.json', 'fixtures.json']) {
  fs.copyFileSync(path.join(root, f), path.join(dest, f));
}
console.log('Android-Assets aktualisiert:', path.relative(root, dest));
