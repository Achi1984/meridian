# MERIDIAN — Funding Carry V2 repeatability audit evidence

Status: SAMPLE GATE FAILED / NO NEW PAPER ENTRY / POLICY UNCHANGED  
Valid evidence run: GitHub Actions 36267180791  
Artifact: 10913593342  
Artifact SHA256: `b77d75a57cec2f6667f1bf7da68dcf7b0bf0286e3c0a7169b78fe592446063a6`

## Data QA

The final valid audit uses official Binance Vision archives matching the production venue:
- BTCUSDT spot 4h
- BTCUSDT USD-M perpetual 4h
- BTCUSDT USD-M fundingRate

Funding coverage: 5,205 settlements from 2021-12-01 through 2026-08-31, maximum gap 8h.
Spot/perpetual coverage is complete for the frozen audit window ending 2026-09-01.

Earlier OKX and exact-timestamp-join runs produced no completed cycles and are not strategy evidence. The final run maps official funding timestamps to their containing 4h bar because some archive timestamps differ from the bar boundary by 1 ms.

## Frozen result

Completed non-overlapping cycles: **6**  
Profitable cycles: **6 / 6 (100%)**  
Aggregate net P&L: **+$1,639.82**  
Dollar PF: **99** (no losing closed cycle in sample)  
Maximum closed-equity drawdown: **$0**  
Funding income minus modeled fees/slippage before basis P&L: **+$1,386.15**  
+8 bps extra friction stress: **+$1,591.82**, PF 99  
Maximum positive-cycle concentration: **37.32%**  
Calendar years with closed cycles: **4**, all four net positive

Calendar results:
- 2022: 1 cycle, +$12.61
- 2023: 1 cycle, +$281.96
- 2024: 3 cycles, +$1,009.78
- 2025: 1 cycle, +$335.47

Cycle details:
1. 2022-01-01 → 2022-01-31, FORWARD_NET_CARRY_NEGATIVE, +$12.61
2. 2023-02-03 → 2023-03-24, BASIS_CHANGE, +$281.96
3. 2023-11-16 → 2024-02-14, MAX_HOLD_90D, +$364.68
4. 2024-02-15 → 2024-05-15, MAX_HOLD_90D, +$612.03
5. 2024-06-15 → 2024-07-21, FORWARD_NET_CARRY_NEGATIVE, +$33.07
6. 2024-11-10 → 2025-02-08, MAX_HOLD_90D, +$335.47

## Predeclared gate

Passed:
- aggregate net P&L
- dollar PF
- profitable-cycle share
- funding pays modeled costs without relying on basis P&L
- drawdown
- calendar breadth
- concentration
- +8 bps friction stress
- data adequacy

Failed:
- **sample: 6 completed cycles < predeclared minimum 8**

Therefore:
- `auditPass = false`
- V2 may not be called historically repeatable under the frozen audit rule.
- The 8-cycle minimum is not reduced after observing the favorable six-cycle sample.

## Decision

Funding Carry V2 is not promoted and must not open a new Paper cycle under this audit result.

If a frozen V2 Paper cycle is already active, it is managed to its existing exit rule and then sealed. If it is waiting for entry, new automatic entry is disabled.

The code and evidence remain valuable because every economic/stress gate passed; however, the favorable six-cycle result is insufficient under the predeclared sample requirement. A future successor must obtain genuinely new evidence rather than lowering the sample threshold post hoc.
