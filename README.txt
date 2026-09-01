MERIDIAN NORTHFLANK v6.99 — CLOUD BACKTEST WINDOW RESET VALIDATION

- Engine 6.2.0 / Baseline rules unchanged.
- Shadow V1 unchanged and remains a separate research-only ledger.
- Cloud backtest now returns researchContinuous:
  * 5 equal calendar windows
  * fresh independent 10k ledger per asset and per window
  * W1 DD/DAILY_LOSS cannot suppress W2-W5 research samples
  * BASE, Q72/66, Q75/70 variant summaries + stability score
- Research-only. No live trading. No automatic promotion.
