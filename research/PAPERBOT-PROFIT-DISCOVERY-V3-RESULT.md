# Paper Bot Profit Discovery V3 — Frozen Result

Workflow run: **36484206755**  
Artifact: **10997792449**  
Artifact SHA-256: `ebc26e749a8ebc102d3ec4ad9bf9d3057da5fb43c1e7a352228561aed1f37b65`

This file records the first untouched result of `PAPERBOT-PROFIT-SPECIAL-AGENT-V3-FROZEN`.

Strategy: `ADAPTIVE_UP_TREND_6H_V3`

| Periods | Net return | PnL | PF | Max DD | Positive windows | Positive assets | Positive-PnL concentration | Gate |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1,194 | +19.40% | +$1,939.86 | 1.175 | 7.85% | 3/5 | 7 | 32.4% | FAIL |

## Frozen decision

**DISCOVERY_FAIL_RESEARCH_REDESIGN.**

The strategy is profitable, broad and well below the drawdown/concentration caps, but it misses two pre-committed V3 requirements:
- `PF_LT_1.2`
- `POSITIVE_WINDOWS_LT_4`

The gate is not relaxed.

## Data coverage

BTC, ETH, SOL, XRP, HBAR, LINK and AVAX loaded 6,839 completed 6h bars, covering 2022-01-23 through 2026-09-28 12:00 UTC. SUI loaded 4,977 completed 6h bars from its later listing history.

## Interpretation

V3 materially increased sample density versus V2 and remained profitable after the frozen 10 bps turnover model. It also showed broad positive asset contribution and low concentration. However, its period-level Profit Factor and chronological stability do not clear the stronger V3 gate.

This is evidence that the regime-aware long-trend family remains worth researching, but **not** evidence sufficient for holdout or paper-shadow promotion.

## Next research rule

Do not tune V3 on the same discovery sample. Any V4 candidate must be separately named and frozen before its result, and should use either:
- a new non-overlapping traded-asset discovery universe, or
- a truly prospective observation period,
rather than reusing V3 data to optimize thresholds.

Research only. No live execution impact. No auto-promotion.
