# MERIDIAN PWA — GitHub Pages V2

GitHub-Pages-fertige Version von MERIDIAN.

## Veröffentlichung
1. Neues öffentliches GitHub-Repository `meridian` erstellen.
2. **Den Inhalt dieses ZIPs** in die oberste Ebene des Repositories hochladen (nicht den ZIP-Ordner selbst).
3. In GitHub: **Settings → Pages**.
4. Unter **Build and deployment**: Source = **Deploy from a branch**.
5. Branch = **main**, Folder = **/(root)** → **Save**.
6. Nach der Veröffentlichung die von GitHub angezeigte Pages-Adresse in Safari öffnen.
7. iPhone: **Teilen → Zum Home-Bildschirm**.

## Dateien, die im Repository-Root liegen müssen
`index.html`, `styles.css`, `app.js`, `data.json`, `manifest.webmanifest`, `sw.js` sowie der Ordner `icons/`.

## Hinweise
- Alle lokalen Pfade sind relativ und damit für GitHub Project Pages geeignet.
- Service Worker und Manifest sind auf Hosting unter HTTPS vorbereitet.
- Live-Kurs-Refresh nutzt CoinGecko im Browser; falls der Abruf scheitert, bleibt der Snapshot aktiv.
- Keine API-Schlüssel in dieses öffentliche Repository eintragen.
