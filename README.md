# ACHI MERIDIAN v5.25.0 — Runtime Fix

Behoben:
- GRID: verbliebene Runtime-Referenz `wp` vollständig entfernt.
- CENTER: `positionIntelligenceState()` durch die tatsächlich vorhandene SSOT-Funktion `decisionSSOT()` ersetzt.
- Watchlist Priority bleibt erhalten.
- Neuer Cache-Key und Script-Query erzwingen den aktualisierten JS-Build.

Prüfungen:
- keine `wp`-Referenz mehr
- keine `positionIntelligenceState`-Referenz mehr
- JavaScript Syntaxcheck OK
