# ACHI MERIDIAN v5.0.8 — Risk Integrity / Cycle Fix

Änderungen:
- Forecast: Halving-Alter und aktuelles Marktregime getrennt. Das alte 20.10.2025-Fenster ist jetzt klar als historische Zyklus-Referenz gekennzeichnet, nicht als aktuelle Peak-Prognose.
- Day-Trade: Open Interest wird korrekt als Binance BTCUSDT Contract OI bezeichnet; kein Eindruck eines globalen BTC-Futures-OI.
- Center: Cross-Risk Engine verbindet Spot-Konzentration, 5x-Long-Kapazität, BTC-Short-Stress und Marktregime.
- Datenintegrität: LIVE / SNAPSHOT / MODEL semantisch verschärft.
- Cache: v5.0.8 Cache-Bust, Service Worker wird stillgelegt. RESET.html löscht Cache/SW, aber nicht LocalStorage-Historie/Cashflows.
- Basis: funktionierender v5.0.7 Grid Engine 1.2 Build; alle Tabs bleiben erhalten.
