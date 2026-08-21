# ACHI MERIDIAN v4.8.2 — Bitpanda Valuation Fix

Fehler gefunden und behoben:
- FET verwendete den falschen CoinGecko-API-Identifier. Korrekt: `fetch-ai`.
- VSN verwendete den falschen Vision-Identifier. Korrekt für Bitpanda Vision: `vision-3`.
- Dadurch wurden FET und VSN im Bitpanda-Gesamtwert praktisch nicht bzw. falsch bewertet.
- Fehlende API-Kurse werden künftig nicht mehr still mit 0 USD angesetzt.
- Falls FET/VSN vorübergehend keinen Live-Quote liefern, verwendet MERIDIAN den letzten Bitpanda-Snapshot und markiert die Quelle als SNAPSHOT/MIXED.
- Grün pulsierendes LIVE wird nur angezeigt, wenn tatsächlich ein Live-Quote vorhanden ist.

# ACHI MERIDIAN v4.8.1 — LIVE Pulse

Grün pulsierender Punkt + LIVE = Wert wird aus dem Live-Kursfeed berechnet.
Gelbes SNAPSHOT = manuell aus einem Screenshot übernommener Stand und nicht live.

# ACHI MERIDIAN v4.8 — Pionex + Layout Fix

- Pionex Hauptkonto ($119,75 Snapshot) ist jetzt in Börse/Wallet und im Gesamtportfolio enthalten.
- Verwahrstellen: Bitpanda, OKX, Ledger, Pionex.
- Pionex Futures Risk mit beiden aktuellen BTC/USDT Moon Bots aktualisiert.
- Gesamt-Bot-P&L: -141,95 USDT
- Dynamische Margin: 148,51 USDT
- Nächste Liquidation: 81.474,9 USDT / 3,87 %
- Top-5-Layout neu aufgebaut: breitere Asset-Spalte, keine unschönen Umbrüche, klarere Abstände.
- Wallet-, Performance- und Pionex-Karten mit konsistenten Abständen.
- Coin-Logos und Live-Kursberechnung bleiben erhalten.

Pionex-Hauptkonto ist ein Snapshot aus dem Screenshot. Bitpanda, OKX und Ledger werden weiterhin aus Menge × Live-Kurs berechnet.
