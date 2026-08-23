# ACHI MERIDIAN v5.14.0 — Risk Recovery Engine

Neu:
- RISK RECOVERY ENGINE 1.0 direkt im CENTER.
- Aus einem blockierenden Liquidationspuffer wird ein gestufter Recovery-Plan.
- Stufen: 8% MINIMUM → 12% PREFERRED → 15% RECOVERY / Entry-Recheck.
- Anzeige von Ziel-Liquidation, Reduce-Äquivalent und Margin-Äquivalent.
- Recovery Progress 0–100.
- Capital Gate wird erst nach neu synchronisiertem Live-Puffer neu bewertet.
- Entry Intelligence bleibt sichtbar, aber bei aktivem Risk Block gesperrt.

Wichtig:
- Keine automatische Order-Ausführung.
- Reduce-/Margin-Werte sind Modell-Äquivalente, keine Ordergrößen.
- Nach jeder Änderung muss der neue Pionex-Liquidationspreis geprüft und MERIDIAN neu synchronisiert werden.
- Bestehende SSOT-, Risk-, Capital-Release- und Entry-Gate-Logik bleibt erhalten.
