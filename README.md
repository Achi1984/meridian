# ACHI MERIDIAN v5.26.0 — Unified Risk Engine + Stability Pass

Diese Version vereinheitlicht die Risikologik in CENTER und GRID.

- Unified Risk State Matrix 2.0 als zentrale Bot-Entscheidungsquelle
- Canonical Pionex Buffer bleibt SSOT; Browser-Live-Estimate nur Diagnose
- Break-even-SL neutralisiert den Bot als primären Kapitalverlust-Blocker
- Stale/Snapshot Guard: alte Werte bleiben sichtbar, blockieren aber ADD/NEW CAPITAL konservativ
- Closed Bots werden aus aktiver Risk-/Capital-Logik ausgeschlossen
- Module Isolation: Fehler in einem Teilmodul sollen nicht mehr den ganzen CENTER/GRID-Tab ausfallen lassen
- Mobile Layout Guard gegen überlappende Karten/Raster auf iPhone-Breite
- GRID Commander 3.7 / Decision Engine 2.0

Keine automatische Order-Ausführung. Nach manuellen Pionex-Änderungen Liquidationspreis/Buffer erneut verifizieren.
