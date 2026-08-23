# ACHI MERIDIAN v5.10.9 — Decision SSOT

CENTER, GRID, Bot Priority Queue und Entry Gate greifen jetzt auf dieselbe Decision-Quelle zu.

- ACTIVE Pionex Bots sind die Bot-Single-Source-of-Truth.
- Live-Kurse berechnen Liquidationspuffer dynamisch neu.
- Pionex-Snapshot ist Fallback.
- CLOSED Bots werden aus der aktiven Risk-/Decision-Logik ausgeschlossen.
- Priorität: Liquidationsrisiko → bestehende Position → Hedge → neuer Entry.
- FUTURES RISK wird dynamisch aus CRITICAL/DANGER abgeleitet.
- Keine Auto-Ausführung.
