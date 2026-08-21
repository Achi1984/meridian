# MERIDIAN V3.9 – Server History Forecast

Build `2026-08-21-2200`

## Kernänderung
Der FORECAST lädt historische Kursdaten NICHT mehr direkt aus Safari/PWA.
GitHub Actions erzeugt `history.json`; GitHub Pages liefert sie same-origin aus.

## Forecast 2.0
- bis zu 2000 Tageskerzen je Coin
- 90T Swing für lokale Lage
- 180T Swing als Basis für FIB-Extensions
- Daily RSI14
- 30T Relative Strength vs BTC
- Local Top-Risk
- FIB 1.272 / 1.618 / 2.0 / 2.618
- historische Peak-Erkennung BTC
- beobachteter Coin-vs.-BTC Peak-Lag
- Klassen-Offset nur als Fallback
- nächstes zukünftiges Macro-Cycle-Window
- Confidence nach Datenmenge und Modellqualität

## GitHub Action
Im ZIP liegt:
`.github/workflows/update-market-history.yml`

Die Action läuft:
- automatisch nach Push auf main (außer reinen history.json-Updates)
- täglich um 02:17 UTC
- manuell via Actions > Update MERIDIAN market history > Run workflow

Sie aktualisiert `history.json` und committed die Datei automatisch.

Für einfachen iPhone-Zugriff liegt zusätzlich eine Kopie `update-market-history.yml`
im Hauptverzeichnis. GitHub führt aber nur die Datei unter `.github/workflows/` aus.
