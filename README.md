# ACHI MERIDIAN v5.1.4 — DAYTRADE Hotfix

Fix:
- `Can't find variable: stateLabel` im DAYTRADE-Modul behoben.
- `stateLabel` wird innerhalb von `dayTrade()` definiert.
- Layout-Geometrie des zuletzt freigegebenen Screens bleibt unverändert.
- Bottom Navigation unverändert.
- Versionsanzeige nutzt nach erfolgreichem Datenladen `data.json`.
- Alte JS-Alias-Dateien enthalten ebenfalls den Hotfix, um stale HTML-Referenzen abzufangen.


## v5.1.6 — Trigger Watch
Built directly on the frozen v5.1.5 stable base.

New:
- Trigger Watch 1.0 in Command Center
- BTC breakout/confirmation watch
- Day-Trade gate status
- HBAR/XRP distance to preferred FIB entry zone
- Best current Coin-M scanner candidate
- Decision Engine label 1.1

Safety:
- stable v5.1.5 CSS is reused unchanged
- no header or bottom-nav CSS changes
- no Pionex auto-sync changes
- no automatic order execution
