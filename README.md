# ACHI MERIDIAN v5.11.0 — EXECUTION ENGINE

Aktueller Build: Execution Engine 1.0 auf SSOT-Basis. Keine Auto-Ausführung; manuelle Handlungsempfehlungen mit Zielpuffer und Recheck.

# ACHI MERIDIAN v5.6.1 — UI POLISH

Design-Pass auf Basis v5.6.0:
- Forecast Confidence als kompakte horizontale Status-Kapsel mit Progressline
- mehr Raum für TIME × STRUCTURE × EXIT
- Asset-Rail mit weichem rechten Fade statt hart abgeschnittenem Tab
- kleine iPhone-Abstände weiter optimiert
- bestehende Logik und Opportunity-Scanner-Verhalten unverändert
- neues ACHI MERIDIAN Logo bleibt Standard

## v5.9.1 — Single BTC Short / Margin Update
- zweiter BTC-Short-Bot entfernt (im Gewinn geschlossen)
- nur noch 1 offener BTC/USDT Futures Moon Short 30x
- Investment 52 USDT + Dynamic Margin 210,09 USDT = 262,09 USDT gebundenes Bot-Kapital
- Liq. 85.202,5 USDT / Puffer 11,24% → DANGER
- Break-even 71.409,4 USDT
- Grid +8,48 USDT / Trend-PnL -95,50 USDT / Gesamt -87,02 USDT
- zentrale Aktion: BTC SHORT ABSICHERN / NICHT ERHÖHEN
- Critical-Bot-Zähler auf 0; Danger-Bot-Zähler auf 1


## v5.10.4 — Dynamic Liquidation Guard
- Dynamic buffer formula for LONG and SHORT positions.
- Risk bands: CRITICAL <8%, DANGER 8–<15%, TIGHT 15–<30%, SAFE ≥30%.
- Closed bots excluded.
- Priority is derived from the smallest live liquidation buffer.
- Exact exchange liquidation price is the source of truth.
- BTC-S30 and ETH-S30 liquidation-price inputs remain intentionally unset until a current Pionex snapshot is supplied; no fabricated live value.


## v5.10.4 — Pionex Snapshot Sync
Active bots: BTC-S30, BTC-L20, HBAR-L5, XRP-L5. ETH-S30 is not treated as verified active because it is not present in the supplied screenshots.
- BTC-S30: Pionex Liq buffer 4.36% → CRITICAL; liq 80204.1
- BTC-L20: Pionex Liq buffer 9.76% → DANGER; liq 69341.9
- XRP-L5: Pionex Liq buffer 43.01% → SAFE; liq 0.8483
- HBAR-L5: Pionex Liq buffer 25.61% → TIGHT; liq 0.05853
