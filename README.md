# ACHI MERIDIAN v5.11.2 — Adaptive Risk Engine

Neu in v5.11.2:
- Adaptive Risk Engine 1.0 für die kritischste aktive Position
- Live-Liquidationspuffer wird in konkrete Zielzonen übersetzt: 8% MIN, 12% BEVORZUGT, 15% RECOVERY
- je Zielzone: Ziel-Liquidationspreis, benötigte Liq.-Verschiebung, Margin-Äquivalent und Reduce-Äquivalent
- Berechnung basiert auf dem bestehenden SSOT und Live-Kurs; keine zweite Datenquelle
- nach jeder manuellen Änderung ist ein Pionex-Recheck zwingend
- CENTER und GRID verwenden dieselbe Adaptive-Risk-Ausgabe

Wichtig: Margin- und Reduce-Werte sind Modell-Äquivalente. Pionex Maintenance Margin, Grid-Orders und Exchange-Mechanik können den tatsächlichen Liquidationspreis abweichend verschieben. Keine automatische Order-Ausführung.

Paket ist CLEAN: keine älteren ZIP-Versionen und keine Legacy-README-Dateien enthalten.
