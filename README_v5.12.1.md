# ACHI MERIDIAN v5.12.1 — Capital Release & SSOT Position Fix

Änderungen:
- CAPITAL RELEASE ENGINE 1.0
  - <8% BTC-S30: NEW CAPITAL $0 / BLOCKED
  - 8–12%: RECOVERY LOCK
  - 12–15%: WATCH LOCK
  - >=15%: Entry Engine darf nur prüfen, sofern kein anderer DANGER/CRITICAL High-Leverage-Bot aktiv ist
  - ADD auf bestehende Bots weiterhin erst ab SAFE >=30% + Health >=70 + kein Risk-Block
- Cross-Risk:
  - "5x Long Capacity" heißt jetzt THEORETICAL 5X CAPACITY
  - separates NEW RISK CAPACITY Feld
  - Short Stress verständlich als 98/100 CRITICAL
- Dual BTC Hedge:
  - keine irreführende Hedge-Ratio mehr
  - SHORT/LONG EXPOSURE als x-Faktor
  - NET BTC EXPOSURE und SHORT/LONG DOMINANCE
  - Hebel und Bot-ID dynamisch aus SSOT
- BTC-L5 SL/Invalidation:
  - keine alte 20x-Bezeichnung mehr
  - Positionsbasis aus aktivem Pionex Break-even/Creation
  - R:R wird aus der aktuellen Positionsbasis neu berechnet
  - SL/TP bleiben klar als MODEL gekennzeichnet
- Opportunity Scanner:
  - zusätzliches PORTFOLIO GATE: RISK BLOCK / RISK OPEN
- Bestehende v5.12 Lifecycle-Logik bleibt erhalten.

Keine automatische Order-Ausführung.
