# MERIDIAN V3.2 – Stability Release

Build: `2026-08-21-2030`

## Wichtigste Änderungen
- Version + Build-ID sichtbar im Header und unter Settings.
- `version.json` für echten Build-/Cache-Check.
- Button **Update erzwingen** löscht Service Worker + Cache und lädt den aktuellen Build neu.
- `index.html`, `data.json` und `version.json` werden vom Service Worker nicht dauerhaft gecacht.
- Live-API-Diagnose: `online · X Assets` oder `nicht erreichbar · Snapshot aktiv`.
- Live-Asset-Zähler: z. B. `16/16`.
- Portfolio-Verlauf ist nie leer:
  - erster Start erzeugt zwei reale Startpunkte mit gleichem Portfoliowert
  - danach werden echte Live-/Refresh-Werte gespeichert
  - bei unverändertem Wert erscheint eine saubere horizontale Linie.
- iPhone Safe-Area nochmals robuster gemacht.
- App-Version: 3.2.0

## GitHub
Alle Dateien aus diesem Paket über das bestehende `meridian` Repository hochladen und überschreiben.
Danach GitHub Pages neu deployen lassen.
