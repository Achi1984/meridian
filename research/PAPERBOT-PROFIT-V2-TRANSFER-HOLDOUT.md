# Paper Bot Profit Agent V2 — Independent Transfer Holdout Protocol

Status: **FROZEN BEFORE RESULT**  
Research only: **true**  
Execution impact: **false**  
Discovery leader: `UP_REGIME_DONCHIAN_V2`

## Purpose

Test whether the V2 discovery leader generalizes to a completely different traded-asset universe without changing any signal, risk, cost or gate parameter.

The original discovery universe is:
`BTC ETH SOL XRP HBAR LINK AVAX SUI`

The holdout trade universe is frozen as:
`BNB DOGE ADA DOT LTC BCH TRX XLM`

BTC is loaded **only as the common market-regime filter** and is excluded from holdout trading/PnL. This avoids reusing BTC as a traded discovery asset while preserving the exact frozen BTC regime rule.

## Selection rule

The transfer universe was selected before the holdout result from established, independently traded Binance USDT crypto assets with long daily histories and no overlap with the V2 discovery trade universe. Stablecoins are excluded.

No asset may be removed after observing its holdout result.

## Frozen strategy parameters — unchanged

- LONG only
- daily bars
- 55-day breakout entry
- 20-day exit
- evaluation every 7 days
- 60-day realized-vol estimate
- 10% annualized target vol
- 2x per-asset research leverage cap
- 8 bps turnover cost
- persistent-UP required for both BTC filter and traded asset:
  - close above trailing 200-day SMA
  - current trailing 30-day return > 0
  - immediately preceding 30-day return > 0
- failure of the filter closes exposure at the next evaluation
- no shorts, martingale, averaging down or pyramiding

## Holdout gate — unchanged

- at least 24 evaluation periods
- net compounded return > 0
- Profit Factor >= 1.15
- max closed-equity drawdown <= 25%
- at least 3 of 5 chronological windows positive
- at least 4 positive traded assets
- no single positive traded asset contributes > 50% of positive PnL

## Decision rules

- If the transfer holdout passes all gates: status becomes `HOLDOUT_PASS_PAPER_SHADOW_ONLY`.
- If it fails any gate: status becomes `HOLDOUT_FAIL_RESEARCH_REDESIGN`.
- No parameter, cost, asset list or gate may be changed after result inspection.
- A holdout pass does **not** authorize live trading. The next stage is paper-shadow/forward observation only.

## Data integrity

The runner uses public Binance daily klines with the same primary/fallback endpoints as V1/V2 discovery. Every traded asset must have at least 500 completed daily bars. BTC must also satisfy the source gate as the market filter.

No synthetic backfill is permitted.
