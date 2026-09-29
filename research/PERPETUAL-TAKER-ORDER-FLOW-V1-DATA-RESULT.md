# Perpetual Taker Order Flow V1 — Frozen Data Foundation Result

Workflow run: **36608261159**  
Artifact: **11051444813**  
Artifact ZIP SHA-256: `bc29019e9477878642ddfd03a79173ae91a667c277bd36564715a1c52bc84205`

Ruleset: `PERPETUAL-TAKER-ORDER-FLOW-V1-DATA-FROZEN`

## Frozen scope

- interval: 2023-01 through 2026-08
- required months per asset: 44
- source: Binance Vision public USD-M monthly archives
- data: 1h perpetual trade klines + realized funding
- candidates: BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, LTC, BCH, AVAX

## Result

- candidates: **12**
- qualified end-to-end: **12/12**
- failed assets: **0**
- unexpected transport errors: **0**
- hourly taker fields audited: **PASS**
- funding continuity audited: **PASS**
- taker imbalance calculated: **false**
- order-flow score calculated: **false**
- return predictability calculated: **false**
- strategy PnL calculated: **false**
- synthetic backfill used: **false**

**Decision: FOUNDATION_PASS_STRATEGY_PREREGISTRATION_ALLOWED**

The complete 12-asset universe is frozen for the first Taker Order Flow strategy test. No asset was selected or removed based on a signal or PnL.

A PASS authorizes only strategy preregistration. It does not authorize Paper or live execution.
