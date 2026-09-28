# Paper Bot Profit Discovery V2 — Frozen Result

Workflow run: **36482867145**  
Artifact: **10997935246**  
Artifact SHA-256: `3a93a952919e78c515735655980c4741371460f023b22f55b54142aacb20ca37`

This file records the first untouched result of `PAPERBOT-PROFIT-SPECIAL-AGENT-V2-FROZEN`. The V2 protocol and implementation were committed before this run.

| Candidate | Periods | Net return | PnL | PF | Max DD | Positive windows | Positive assets | Positive-PnL concentration | Gate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Asymmetric Donchian V2 | 240 | -47.71% | -$4,771.33 | 0.980 | 69.10% | 2/5 | 4 | 51.5% | FAIL |
| UP-Regime Donchian V2 | 35 | +11.93% | +$1,193.18 | 2.334 | 2.80% | 4/5 | 6 | 49.4% | PASS |

## Frozen decision

**DISCOVERY_LEADER_ONLY: UP_REGIME_DONCHIAN_V2.**

UP-Regime Donchian V2 is the first Profit Special Agent candidate to clear the pre-committed profit/risk/stability/breadth gate. It is a **discovery leader only**, not a validated strategy and not eligible for live promotion.

Asymmetric Donchian V2 is rejected. Its negative compounded return, PF below 1, 69.10% max drawdown, weak chronological stability and >50% positive-PnL concentration fail multiple frozen gates.

## Data note

BTC, ETH, SOL, XRP, HBAR, LINK and AVAX loaded 1,879 daily bars. SUI loaded 1,244 daily bars because less public history is available. The runner required at least 500 bars per asset and did not backfill synthetic history.

## Next allowed step

Freeze an **independent holdout** before inspecting its result. The discovery parameters are immutable:
- daily bars
- long-only
- 55-day breakout entry / 20-day exit
- weekly evaluation
- 60-day realized-vol estimate
- 10% annualized target vol
- 2x research leverage cap
- 8 bps turnover cost
- both BTC and asset must be in persistent-UP state:
  - close above trailing 200-day SMA
  - current trailing 30-day return > 0
  - immediately preceding 30-day return > 0

The holdout must not tune these values, remove losing assets, lower modeled costs, or use discovery performance to choose the test interval.

Research only. No live execution impact. No auto-promotion.
