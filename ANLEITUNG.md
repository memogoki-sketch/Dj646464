# DJ64 – eigene IPTV-App für Android TV (TCL)

Schlanker Player auf Basis von Media3/ExoPlayer. Lädt deine M3U-Playlist, zeigt die Sender als Liste und spielt sie per Fernbedienung ab.

## APK bauen (einmalig, ca. 10 Minuten)

1. **Android Studio** installieren (kostenlos, android.com/studio).
2. Ordner `DJ64` über *File → Open* öffnen und warten, bis "Gradle Sync" fertig ist.
3. Optional: In `app/src/main/java/de/dj64/tv/Config.kt` deine M3U-URL zwischen die Anführungszeichen schreiben. Sonst fragt die App beim ersten Start danach.
4. Menü *Build → Build Bundle(s) / APK(s) → Build APK(s)*.
5. Die Datei liegt danach in `app/build/outputs/apk/debug/app-debug.apk`.

## Auf den TCL installieren

1. Am TCL: *Einstellungen → Geräteeinstellungen → Info* → siebenmal auf "Build" klicken → Entwickleroptionen aktiv.
2. *Entwickleroptionen → USB-Debugging* (oder "Netzwerk-Debugging") einschalten.
3. Am PC: `adb connect IP-DES-TVS` (IP steht unter Einstellungen → Netzwerk), dann
   `adb install app-debug.apk`
4. Alternative ohne PC: APK auf einen USB-Stick kopieren und mit einem Dateimanager (z. B. "File Commander" aus dem Play Store) auf dem TV installieren. Dafür "Installation aus unbekannten Quellen" für diesen Dateimanager erlauben.
5. Die App "DJ64" erscheint in der Apps-Reihe des Startbildschirms.

## Bedienung

| Taste | Aktion |
|---|---|
| OK auf einem Sender | Sender abspielen (Vollbild) |
| Hoch / Kanal + (im Vollbild) | nächster Sender |
| Runter / Kanal – (im Vollbild) | voriger Sender |
| OK / Links / Menü / Zurück (im Vollbild) | Senderliste öffnen |
| Rechts (in der Liste) | Liste ausblenden |
| Zurück (in der Liste) | App beenden |
| Erster Listeneintrag "Playlist ändern" | neue M3U-URL eingeben |

Tipp zum Eintippen der URL: Mit der Google-TV-App auf dem Handy lässt sich die Bildschirmtastatur des TV bequem per Smartphone bedienen.

## Stabilität

- Bei Verbindungsabbruch versucht die App automatisch bis zu 5-mal neu zu verbinden.
- Die Playlist wird lokal zwischengespeichert, die App startet also auch bei kurzzeitig nicht erreichbarem Anbieter.
- Der zuletzt gesehene Sender wird gemerkt.
- LAN-Kabel statt WLAN macht die Wiedergabe deutlich zuverlässiger.

## Hinweis

Die App enthält keine Sender, sondern spielt nur die Playlist ab, die du selbst einträgst. Nutze ausschließlich Playlists von legalen Anbietern.

## Alternative ohne Android Studio: APK online bauen (GitHub, kostenlos)

1. Kostenloses Konto auf github.com erstellen und ein neues, **privates** Repository anlegen.
2. Den kompletten Inhalt des Ordners `DJ64` hochladen (*Add file → Upload files*). Der versteckte Ordner `.github` muss mit hoch, am einfachsten den ganzen Ordnerinhalt per Drag & Drop ziehen.
3. Reiter **Actions** öffnen → "DJ64 APK bauen" → **Run workflow**.
4. Nach ca. 5 Minuten die fertige Datei `DJ64-APK` (enthält `app-debug.apk`) unter "Artifacts" herunterladen.
