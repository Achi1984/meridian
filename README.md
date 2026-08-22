# ACHI MERIDIAN v5.1.6 — GOLDEN BASELINE

Dieser Build ist die eingefrorene stabile Referenzbasis.

Freeze-Regeln:
- Header, vertikales Spacing und Bottom-Navigation nicht verändern.
- Neue Funktionen nur modular ergänzen.
- Ein Modulfehler darf niemals die gesamte App leeren.
- Keine alten versionierten JS/CSS-Dateien in neue Builds mitschleppen.
- Rückfallbasis bei Regressionen: diese v5.1.6 Golden Baseline.

# ACHI MERIDIAN v5.1.4 — DAYTRADE Hotfix

Fix:
- `Can't find variable: stateLabel` im DAYTRADE-Modul behoben.
- `stateLabel` wird innerhalb von `dayTrade()` definiert.
- Layout-Geometrie des zuletzt freigegebenen Screens bleibt unverändert.
- Bottom Navigation unverändert.
- Versionsanzeige nutzt nach erfolgreichem Datenladen `data.json`.
- Alte JS-Alias-Dateien enthalten ebenfalls den Hotfix, um stale HTML-Referenzen abzufangen.
