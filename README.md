# ACHI MERIDIAN v5.0.3 — SAFE BOOT

Diagnose:
Forecast konnte weiterhin angezeigt werden, während die anderen Views leer blieben.
Die zentrale renderAll()-Funktion renderte zuvor alle Views nacheinander; ein Fehler in nur einer View konnte dadurch alle folgenden Views blockieren.

Änderungen:
- Basis ist die originale v5.0.0 Command-Center-Version
- jeder Tab wird separat mit try/catch gerendert
- Snapshot-Inhalt wird SOFORT nach data.json angezeigt
- externe Live-APIs starten erst danach im Hintergrund
- ein API- oder Modulfehler kann die App nicht mehr komplett leer machen
- Service Worker während Recovery deaktiviert
- app.js/styles.css mit Cache-Bust
- RESET.html entfernt nur Service-Worker/CacheStorage, nicht LocalStorage

Installation:
1. komplette ZIP auf das Hosting kopieren
2. einmal RESET.html im Safari öffnen
3. danach muss oben v5.0.3 stehen
