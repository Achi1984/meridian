# MERIDIAN V3

## Was neu ist
- Sauberes Datenmodell: Menge, Snapshot-Wert, Snapshot-Kurs, Quelle und Zeitstempel je Position.
- Live-Kurs = Menge × CoinGecko-Kurs; bei fehlendem Live-Kurs bleibt der bestätigte Snapshot aktiv.
- Pionex wird separat als gebundenes Kapital ausgewiesen, nicht als Spot-BTC.
- Dynamische Asset- und Börsen-Donuts.
- Top-5 und Portfolio-24h werden aus den aktuellen Werten neu berechnet.
- Preisquelle pro Position in den Depot-Details.
- Live-Abdeckung als Kennzahl.
- Portfolio-Verlauf wird ab V3 lokal im Browser aufgezeichnet (localStorage).
- Service Worker / Cache auf V3 angehoben.

## GitHub Pages Update
Im bestehenden Repository `meridian` alle Dateien aus diesem Paket hochladen und bestehende Dateien ersetzen.
GitHub Pages veröffentlicht den main-Branch automatisch neu.
