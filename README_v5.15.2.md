# ACHI MERIDIAN v5.15.2 — Dominant Action Fix

Fix:
- Die große PRIORITÄT-#1-Karte im ACTION CENTER liest jetzt direkt dominantActionSSOT().
- Bei CRITICAL steht oben z. B. BTC-S30 → ≥8% PUFFER statt nur „RISIKO PRÜFEN“.
- Bei 8–12% wechselt dieselbe Karte auf ≥12%.
- Bei 12–15% wechselt sie auf ≥15%.
- Ab ≥15% zeigt sie RISK UNLOCKED / Recheck.
- NEXT UNLOCK und Action Chain verwenden dieselbe SSOT-Quelle.
- DYNAMIC RECOVERY bleibt die Detailansicht derselben Entscheidung.

Unverändert:
- Kein automatisches BUY/SELL.
- SAFE ist kein automatisches Entry-Signal.
- Capital und Entry werden nach Risk Unlock separat neu geprüft.
