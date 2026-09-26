# MERIDIAN — ETH Funding Carry V2 later holdout evidence

Status: ECONOMICALLY POSITIVE / GATE FAIL / NO PAPER SHADOW  
Valid holdout run: GitHub Actions 36269841817  
Artifact: 10915256319  
Artifact SHA256: `e0bfb50d895a366a8fde3152242e7346d5e61f7d422fdafb2ee68c0f660b2a71`

## Frozen holdout

Warm-up: 2023-12-01  
Evaluation: 2024-01-01 → 2026-06-01  
Instrument: ETHUSDT  
Policy: exact transferred BTC Funding Carry V2 economics, unchanged.

## Result

- 4 completed non-overlapping cycles
- 4/4 profitable
- aggregate net P&L: +$1,401.72
- dollar PF: 99
- max closed-equity drawdown: $0
- funding income minus modeled costs before basis P&L: +$1,394.08
- +8 bps friction stress: +$1,369.72, PF 99
- 2024: 3 cycles, +$968.49
- 2025: 1 cycle, +$433.23
- complete spot/perpetual 4h coverage
- complete funding coverage, maximum funding gap 8h

## Gate decision

Passed:
- aggregate net
- PF
- profitable-cycle share
- funding pays costs
- drawdown
- calendar breadth
- friction stress
- data adequacy

Failed:
- sample: 4 completed cycles < required 8
- concentration: largest profitable cycle = 52.07% of positive P&L > 40% maximum

Therefore:
- `holdoutPass = false`
- no ETH Funding Carry V2 Paper shadow
- no threshold/date/sample/concentration rule is relaxed after observing the result

## Decision

The ETH carry mechanism remains economically promising across both the older and later periods, but under the frozen protocol it is still not sufficiently independent/broad for promotion.

No ETH Paper bot is created from this result. BTC Funding Carry V2 remains manage-only.
