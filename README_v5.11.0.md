# ACHI MERIDIAN v5.11.0 — EXECUTION ENGINE 1.0

Neu:
- SSOT-basierter manueller Execution Plan: RISK → ACTION → TARGET → RECHECK
- Priorität #1 aus den aktiven Pionex-Bots
- CRITICAL/DANGER/TIGHT/SAFE werden in konkrete manuelle Handlungsklassen übersetzt
- Ziel-Liquidationspuffer: >8% Minimum, >12% bevorzugt bei Critical
- Modell-Reduktionsband statt fixer blind berechneter Positionsgröße
- Entry Gate bleibt blockiert, solange vorgelagertes Bot-Risiko aktiv ist
- Live / Break-even / Liquidation werden nebeneinander angezeigt
- Liquidation wird ausdrücklich nicht als Stop-Loss verwendet
- Nach jeder manuellen Änderung ist ein erneuter Pionex-/Live-Buffer-Check erforderlich
- Execution Engine ist in CENTER und GRID sichtbar
- Keine automatische Order-Ausführung

Wichtig:
Das Reduktionsband ist eine Modellregel. Es prognostiziert nicht den exakten neuen
Liquidationspreis, weil dieser von Pionex-Margin- und Positionsparametern abhängt.
Die Engine verlangt deshalb nach jeder Änderung einen Live-Recheck.
