# MERIDIAN V3.8.3 – Forecast Hotfix

Build `2026-08-21-2148`

Wichtigster Fix:
- zwei JavaScript-Funktionen hießen gleichzeitig `renderForecast`
- dadurch wurde der eigentliche Forecast-Renderer überschrieben
- Modell-Renderer heißt jetzt `renderForecastModel`
- erfolgreiche Historien-Daten können jetzt tatsächlich angezeigt werden

Zusätzlich:
- Forecast-Ladezustand wird sauber beendet
- Binance weiterhin primäre Historienquelle
- CoinGecko bleibt Fallback
- Bottom Navigation auf 6 feste Spalten korrigiert
- SETTINGS bleibt damit in derselben Navigationszeile
- bestehende Forecast-Optik unverändert
- Icons weiterhin im Hauptverzeichnis
