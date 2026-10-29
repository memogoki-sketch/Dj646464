# Fenerbahçe News

Nachrichten, Bilder, Spielplan und Ergebnisse zu Fenerbahçe aus allen Sportarten (Fußball, Basketball, Volleyball und weitere) an einem Ort, für Windows und Android.

Design by DjErgin64

## Windows (3 Schritte)

1. ZIP entpacken, z. B. nach `C:\fenerbahce-news`.
2. **`Start.bat`** doppelklicken. Ist Node.js nicht installiert, wird es über Windows (winget) installiert. Danach `Start.bat` noch einmal starten.
3. Die App öffnet sich in einem eigenen Fenster (Microsoft Edge im App-Modus) mit der Start-Animation.

| Datei | Wirkung |
|---|---|
| `Desktop-Verknuepfung-erstellen.bat` | legt ein Symbol „Fenerbahce News“ auf dem Desktop an |
| `Autostart-einrichten.bat` | Server startet künftig unsichtbar mit Windows |
| `Beenden.bat` | stoppt den Server |
| `server.log` | Protokoll des Hintergrund-Servers |

Der Server läuft im Hintergrund weiter, auch wenn du das Fenster schließt. Erneut öffnen: `Start.bat` oder die Desktop-Verknüpfung.

## Android (APK)

**Wichtig:** Die fertige `.apk` konnte ich nicht selbst bauen, weil dafür das Android SDK nötig ist. Das Projekt im Ordner `android/` ist vollständig; die APK entsteht auf einem der beiden Wege unten. Die App braucht keinen PC und keinen Server: Sie lädt die Nachrichten selbst und speichert die letzten Artikel für den Offline-Start.

### Weg A: GitHub baut die APK (ohne Android Studio)

1. Auf github.com ein kostenloses Konto anlegen und ein neues, privates Repository erstellen.
2. Den entpackten Ordner dort hochladen. Der versteckte Ordner `.github` muss mit, deshalb nicht per Browser-Upload, sondern mit GitHub Desktop oder Git:
   ```
   git init
   git add .
   git commit -m "Fenerbahce News"
   git branch -M main
   git remote add origin https://github.com/DEIN-NAME/DEIN-REPO.git
   git push -u origin main
   ```
3. Im Repository den Reiter **Actions** öffnen, **APK bauen** wählen und **Run workflow** drücken (läuft auch automatisch bei jedem Push).
4. Nach etwa 5 Minuten den Lauf öffnen und unten unter **Artifacts** `Fenerbahce-News-APK` herunterladen. Darin liegt `app-debug.apk`.

### Weg B: Android Studio

1. Android Studio installieren (lädt das SDK selbst herunter).
2. Den Ordner `android` öffnen, warten bis die Synchronisierung fertig ist.
3. **Build → Build Bundle(s) / APK(s) → Build APK(s)**. Die Datei liegt in `android/app/build/outputs/apk/debug/`.

### APK auf dem Handy installieren

APK aufs Handy übertragen (USB, Cloud, Mail) und öffnen. Android fragt einmalig, ob die Installation aus dieser Quelle erlaubt sein soll. Die APK ist mit dem Debug-Schlüssel signiert und für den privaten Gebrauch gedacht, nicht für den Play Store.

### Sofort-Lösung ohne APK

Auf dem PC `Start.bat` ausführen, am Handy im selben WLAN `http://<IP-des-PCs>:3000` im Browser öffnen und im Browser-Menü „Zum Startbildschirm hinzufügen“ wählen. (IP unter Windows: `ipconfig`.)

### Nach Änderungen

Wenn du `sources.json`, `fixtures.json` oder Dateien in `public/` änderst, vor dem erneuten Bauen `node tools/sync-android.js` ausführen (der GitHub-Workflow macht das automatisch).

## Quellen und Bilder

`sources.json` enthält 21 Feeds:

- **Suchfeeds** (Google News und Bing News, je Sportart, Türkisch und Englisch). Bing liefert Vorschaubilder mit.
- **Zeitungs-Feeds** (Hürriyet, Sabah, NTV, TRT Haber, Anadolu Ajansı, Milliyet, Fotomaç, Daily Sabah). Bei allgemeinen Sport-Feeds behält `filter` nur Artikel über Fenerbahçe.

**Ehrlicher Hinweis:** Ich konnte keinen dieser Feeds live abrufen, weil meine Arbeitsumgebung keinen Zugriff darauf hat. Die Adressen der Zeitungs-Feeds stammen aus meinem Wissen und sind nicht bestätigt. Unter **Quellenstatus** (Footer) siehst du sofort, welche Quelle funktioniert. Defekte Einträge löschst du oder setzt `"enabled": false`.

Bilder kommen aus drei Wegen: Bild im Feed, Bild aus dem Bing-Eintrag zum selben Artikel und das Vorschaubild (`og:image`) der Artikelseite. Fehlt ein Bild, zeigt die App ein Vereinsfarben-Muster mit Sport-Symbol. Google-News-Links liefern von sich aus kein Bild.

Neue Feeds ergänzt du so (danach Server neu starten, in der App neu bauen):

```json
{ "id": "mein-feed", "name": "Name", "sport": "auto", "type": "rss", "filter": ["fenerbahce"], "url": "https://…/rss.xml" }
```

`sport`: `futbol`, `basketbol`, `voleybol`, `diger` oder `auto` (Erkennung per Stichwort, Listen in `public/shared/classify.js`).

## Bedienung

- **Ansichten:** Karten (mit großen Top-Meldungen), Liste und Bildergalerie mit Großansicht (Pfeiltasten zum Blättern).
- **Laufband** mit den neuesten Schlagzeilen, **NEU**-Markierung für Meldungen der letzten 3 Stunden, gelesene Artikel werden abgeblendet.
- **Start-Animation** in Vereinsfarben (Klick überspringt sie). Das Vereinswappen ist bewusst nicht nachgezeichnet.

## Spielplan und Ergebnisse

Dafür gibt es keine kostenlose, verlässliche Datenquelle. Du pflegst die Spiele in `fixtures.json` (Vorlage: `fixtures.example.json`):

```json
{ "fixtures": [
  { "sport": "futbol", "competition": "Süper Lig", "home": "Fenerbahçe", "away": "Gegner",
    "date": "2026-11-01T18:00:00+03:00", "venue": "Stadion" },
  { "sport": "basketbol", "home": "Gegner", "away": "Fenerbahçe",
    "date": "2026-10-20T20:00:00+03:00", "homeScore": 80, "awayScore": 85 }
] }
```

Ohne `homeScore`/`awayScore` steht das Spiel unter „Nächste Spiele“, mit Ergebnis unter „Letzte Ergebnisse“. Unter Windows wirken Änderungen sofort; in der Android-App erst nach neuem Bauen.

## Aufbau

```
public/            Oberfläche (HTML/CSS/JS), gemeinsam für Windows und Android
public/shared/     Nachrichten-Logik (RSS lesen, Sportart erkennen, Bilder suchen), läuft in Node und im Browser
server.js, lib/    Windows-Server
android/           Android-Studio-Projekt (WebView-App ohne Fremdbibliotheken)
tools/             Hilfsskripte
test/test.js       Tests (npm test)
```

Schnittstellen des Servers: `GET /api/news`, `GET /api/fixtures`, `GET /api/status`, `POST /api/refresh`.

## Fehlerbehebung

- **Keine Nachrichten:** „Quellenstatus“ öffnen. Der PC bzw. das Handy muss die Feed-Hosts erreichen (Firewall/Proxy prüfen).
- **Seite lädt nicht (Windows):** `server.log` ansehen. Ist Port 3000 belegt, `set PORT=8080` vor `node server.js` setzen und den Wert in `Start.bat` anpassen.
- **`Start.bat` meldet nach der Node.js-Installation weiter „nicht gefunden“:** Fenster schließen und `Start.bat` neu starten.
- **GitHub-Lauf schlägt fehl:** Den Schritt „APK bauen“ im Lauf öffnen und die Fehlermeldung an mich schicken.

## Hinweise

Die App zeigt Titel, Kurztext und Bild-Verweise und verlinkt auf die Originalartikel. Die Nutzungsbedingungen der Quellen gelten weiterhin.
