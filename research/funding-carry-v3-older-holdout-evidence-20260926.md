# MERIDIAN — Funding Carry V3 older holdout evidence

Status: ECONOMIC PASS / DATA-ADEQUACY FAIL / NO V3 PAPER SHADOW  
Final evidence run: GitHub Actions 36267787671

## Frozen holdout

Evaluation: 2020-01-01 → 2021-12-01  
Required funding warm-up: 2019-12-01 → 2020-01-01  
Strategy: exact Funding Carry V2 production economics, unchanged.

## Closed-cycle result

- 7 completed non-overlapping cycles
- 6/7 profitable = 85.71%
- aggregate net P&L: +$4,198.15
- dollar PF: 33.26
- maximum closed-equity drawdown: $130.15
- funding income minus modeled costs before basis P&L: +$4,771.31
- +8 bps per-cycle friction stress: +$4,142.15, PF 30.98
- maximum positive-cycle concentration: 35.68%
- 2020: 3 cycles, +$966.96
- 2021: 4 cycles, +$3,231.19

Economic/stress gates passed:
- sample
- aggregate net
- PF
- profitable share
- funding pays costs
- drawdown
- both-year breadth
- concentration
- friction stress

## Data-adequacy failure

The predeclared gate also required complete official source coverage, including the 2019-12 funding warm-up.

Binance Vision available to the runner did not provide the 2019-12 BTCUSDT USD-M 4h/funding archives. Official Binance USD-M REST fallback requests for the missing warm-up returned HTTP 451 on the GitHub runner.

The spot archive also contained one missing 4h bar on 2020-02-19. An official Binance Vision 1h daily archive backfill recovered four 4h bars from that day but did not produce a completely reproducible 4h evaluation series.

Therefore dataAdequacy = false.

## Decision

The favorable P&L cannot override the predeclared data gate.

- Funding Carry V2 remains manage-only / retired for new entries.
- Funding Carry V3 is NOT created.
- The sample/economic evidence remains supportive research, not promotion evidence.
- No dates, warm-up requirement, gate, cost, basis threshold, funding threshold or exit rule may be relaxed from this result.

The carry promotion path is closed under this protocol.
