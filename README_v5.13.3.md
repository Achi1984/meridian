# ACHI MERIDIAN v5.13.3 — CENTER Fix

Der Screenshot aus v5.13.2 hat den verbliebenen Fehler eindeutig gezeigt.

Root Cause:
`entryIntelFactors()` enthielt weiterhin einen ausführbaren Aufruf
`multiAssetRiskPlan(sym)`. Diese Funktion existiert im ausgelieferten Bundle
überhaupt nicht. Der erste Hotfix hatte daher die falsche Aufrufstelle adressiert.

Fix:
- den verbliebenen Aufruf vollständig entfernt
- R:R wird direkt aus dem bereits kanonischen Fibonacci/Grid-Objekt berechnet
- keine ausführbare Referenz auf `multiAssetRiskPlan` mehr im Bundle
- JavaScript Syntaxcheck bestanden
- Cache auf v5.13.3 angehoben
- Risk-/Capital-Release-/Bot-Logik unverändert
