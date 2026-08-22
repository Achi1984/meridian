# ACHI MERIDIAN v5.1.0 — FIB GRID ENGINE

Neu:
- eigener GRID-Tab für HBAR und XRP COIN-M Long Bots
- Live-Kurs + lokale 365T Historie
- automatische 120T Swing-Erkennung
- FIB 0,236 / 0,382 / 0,500 / 0,618 / 0,786
- Preferred Entry Zone = 0,618–0,500
- nächste Grid-Range = 0,786 -1,5% bis 0,382 +1%
- TP1 = Swing High, TP2 = 1,272 Extension
- dynamische Grid-Anzahl aus der Range-Breite
- TP-Latch: wenn Livepreis den Bot-TP erreicht, merkt MERIDIAN das lokal auch nach einem Retracement
- Signalstufen PREPARE / WAIT FOR RETRACE / WATCH ZONE / ARM GRID / START ZONE / RECALCULATE SWING
- START ZONE verlangt FIB-Konfluenz + Daily RSI <=60 + Risk-on-Regime
- Command Center zeigt NEXT GRID SETUPS
- Sicherheitsreferenz für Liquidation, aber bewusst kein erfundener Pionex-Liquidationspreis

Wichtig: Das Modul erzeugt Modellzonen und keine automatische Order. Der echte COIN-M Liquidationspreis hängt von Margin, Hebel und Pionex-Kontraktdetails ab.
