# ACHI MERIDIAN v4.9.3 — LIVE STREAM

Live-Preis-Engine:
- Binance Spot WebSocket als Primärfeed
- Binance Spot REST als 15-Sekunden Health/Fallback
- CoinGecko REST als zweiter Fallback und für Icons/Assets ohne Binance-Paar
- LIVE wird nur für tatsächlich aktuelle Feed-Daten angezeigt
- nach 45 Sekunden ohne Update wird ein Kurs als STALE behandelt
- SNAPSHOT bleibt ausschließlich für statische Referenz-/Bot-/Makrodaten
- Markt, Depot und Positionswerte nutzen dieselbe Live-Preisquelle
- Portfolio wird bei Live-Ticks automatisch neu berechnet, UI maximal 1x pro Sekunde
- Feed-Health zeigt WebSocket/REST/CoinGecko-Zustand

Pionex Futures bleiben Screenshot-Snapshot vom 22.08.2026 09:12 CEST, bis eine Pionex-API angebunden ist.
