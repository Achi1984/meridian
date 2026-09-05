# MERIDIAN v8 R10 — Depot Chart

Production-only presentation enhancement for the canonical v8 DEPOT view.

- Adds chart range controls: `4H`, `1T`, `1W`.
- `4H` is sliced client-side from the protected canonical `1d` history endpoint; `1W` uses the protected `1w` endpoint.
- Shows explicit HIGH and LOW values for the selected range and marks both extrema on the chart.
- Shows selected-range percentage change in the chart metadata row.
- Uses only `/api/private/portfolio-history`; no legacy DOM-derived portfolio data.
- Read token remains local/on-device and is sent only as the existing Bearer auth header.
- Presentation/read-only only: no order, sizing, risk, execution, research-promotion, holdings-write or `server.js` changes.
- Baseline `6.2.0 / 6.2-SIGNAL-V1` remains frozen.
