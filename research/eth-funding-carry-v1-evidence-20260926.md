# MERIDIAN — ETH Funding Carry V1 evidence

Status: ECONOMIC PASS / DATA-ADEQUACY FAIL / NO PAPER SHADOW  
Final evidence run: GitHub Actions 36268096118  
Artifact: 10914741141  
Artifact SHA256: `73aaed31adc04c4ed08a9025ee368085b69cea584515bca7926ea5c0776a313c`

## Frozen result — 2020-02-01 to 2024-01-01

- 10 completed non-overlapping cycles
- 10/10 profitable
- aggregate net P&L +$9,124.07
- dollar PF 99 (no losing closed cycle)
- maximum closed-equity DD $0
- funding income minus modeled costs before basis P&L +$8,802.72
- +8 bps friction stress +$9,044.07, PF 99
- maximum positive-cycle concentration 29.24%
- 4 calendar years with closed cycles; all 4 net positive

Year results:
- 2020: 3 cycles, +$2,372.16
- 2021: 5 cycles, +$6,204.02
- 2022: 1 cycle, +$126.03
- 2023: 1 cycle, +$421.86

Every economic/stress gate passed.

## Data-adequacy failure

The official Binance Vision ETHUSDT spot 4h series is missing exactly:
- 2020-02-19T12:00:00Z

The lower-timeframe recovery rule was executed exactly as predeclared after the first invalid run:
- official 1h archive loaded: yes
- exact 4h reconstruction from 4 contiguous 1h bars: impossible
- official 1m archive loaded: yes
- exact 4h reconstruction from 240 contiguous 1m bars: impossible

No interpolation or substitute venue data was used.

Swap 4h coverage is complete and funding coverage is complete with 8h maximum gap.

Therefore:
- dataAdequacy = false
- validationPass = false

## Decision

The favorable economics do not override the data gate.

ETH Funding Carry V1 is not promoted to Paper. No thresholds, dates, costs or execution rules are altered from this result.

The next admissible step is a separately predeclared, temporally disjoint validation period with complete data.
