MERIDIAN v6.90 DASHBOARD HOTFIX

Root cause found in v6.89:
- index.html itself still contained hardcoded v6.88 text in the header.
- the execution-risk card itself still contained hardcoded v6.88 text.
So a correct v6.89 upload could still visibly look like v6.88.

v6.90:
- removes those stale hardcoded labels
- adds a runtime version stamp as a second safeguard
- keeps the v6.89 Cloud Backtest API integration unchanged
- Northflank v6.89 does NOT need another upload

Expected:
v6.90 · LIVE
UI 6.90
EXECUTION RISK GATE · v6.90
Backtest Lab V3.21
