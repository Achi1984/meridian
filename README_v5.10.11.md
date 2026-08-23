# ACHI MERIDIAN v5.10.11 — SSOT HARDENING

- BotStateManager: nur ACTIVE Pionex Bots in Risk/Decision; CLOSED strikt ausgeschlossen.
- Liq.-Puffer werden aus Live-Kurs + Liquidationspreis kanonisch berechnet; Snapshotwerte sind nur Fallback.
- Stale-Data-Guard markiert Snapshotabweichungen ab 0,25 Prozentpunkten.
- RiskPlanStore: pro Asset genau ein Risk Plan. Opportunity Scanner, Multi-Asset Matrix und Entry Confluence lesen dieselbe Quelle.
- Live 4H Risk Plan gewinnt; Modell-Snapshot wird nur als FALLBACK angezeigt.
- BTC-L20 trennt POSITION / ADD / NEW CAPITAL explizit.
- Alte hart codierte Liq.-Puffer in Bot-Beschreibung entfernt.
