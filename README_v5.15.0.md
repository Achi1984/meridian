# ACHI MERIDIAN v5.15.0 — Dynamic Recovery & Unlock

Neu:
- echte Recovery-Zustandsmaschine:
  CRITICAL <8% → RECOVERY 8–12% → STABILIZE 12–15% → SAFE ≥15%
- automatische Anpassung des nächsten Recovery-Ziels
- Phase Progress innerhalb der aktuellen Recovery-Stufe
- Dynamic Unlock:
  SAFE hebt nur den Liquidations-Risk-Block auf
  Capital und Entry werden danach separat neu geprüft
- Recovery Command bleibt direkt unter ACTION CENTER
- keine automatische Order-Ausführung

Sicherheitslogik:
- Risk Gate bleibt dominant
- neues Kapital bleibt bei aktivem Recovery-Risk blockiert
- SAFE ist kein automatisches Entry-Signal
- Reduce-/Margin-Werte bleiben Modell-Äquivalente
