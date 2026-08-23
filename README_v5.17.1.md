# ACHI MERIDIAN v5.17.1 — DETAILS FIX

Fix:
- DYNAMIC RECOVERY „DETAILS ÖFFNEN“ bleibt jetzt geöffnet.
- Ursache war der sekündliche LIVE-Re-Render: das native <details>-Element wurde nach dem Tap neu erzeugt und fiel sofort wieder auf „geschlossen“ zurück.
- Der Open-State wird nun vor jedem Re-Render gelesen und beim Neuaufbau wiederhergestellt.
- Keine Änderung an SSOT, Risk Gate, Recovery-Modell oder Trading-Logik.
