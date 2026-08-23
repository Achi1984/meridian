# ACHI MERIDIAN v5.13.2 — CENTER Hotfix

Behoben:
- CENTER-Modulfehler `Can't find variable: multiAssetRiskPlan`.
- Ursache: Entry Intelligence wurde in v5.13.1 in CENTER eingebunden, während `multiAssetRiskPlan()` nur im GRID-Render-Scope definiert war.
- Entry Intelligence besitzt jetzt einen CENTER-sicheren Plan-Adapter.
- GRID bleibt unverändert.
- Risk-, SSOT-, Bot- und Capital-Release-Logik unverändert.
- Cache-Version auf v5.13.2 erhöht.

Fallback:
Wenn die kanonische GRID-Planfunktion im CENTER-Scope nicht verfügbar ist, wird für die reine Entry-Intelligence-Anzeige ein klar als Model-Fallback behandelbarer 4H-Plan aus den vorhandenen Live-Klines abgeleitet.
