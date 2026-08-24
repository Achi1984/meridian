# ACHI MERIDIAN v5.21.5 — CENTER Runtime Fix

Behoben:
- Laufzeitfehler `Can't find variable: r` im LIVE RISK COCKPIT.
- CENTER erzeugt jetzt lokal einen gültigen Recovery-State aus `c.buffer` und `c.target`.
- Prozentwert und Balken verwenden exakt denselben `progress`-Wert.
- 8,05% in der 8–12%-Recovery-Phase ergibt rund 1%.

Keine Änderung an Trading-, Hedge-, Risk-Gate- oder Capital-Release-Logik.
