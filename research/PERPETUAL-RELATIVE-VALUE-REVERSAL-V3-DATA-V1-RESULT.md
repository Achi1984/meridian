# Perpetual Relative-Value Reversal V3 Data Foundation V1 — Frozen Result

Workflow run: **36604075885**  
Artifact: **11050542632**  
Artifact ZIP SHA-256: `18300dc1e139f0d90489fb1e3ecdc21fcc23317188f3934684d74c171704433e`  
Foundation JSON SHA-256: `370ba7d3a3477629abe83432b632c77c8d690628e6549d5d264c6c8065973a08`

This records the first untouched result of `PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-DATA-V1-FROZEN`.

## Frozen scope

Candidate universe: 20 assets

- SAND
- MANA
- ALGO
- EOS
- ZEC
- IOTA
- ZIL
- COMP
- SNX
- KSM
- 1INCH
- CHZ
- RUNE
- SUSHI
- DYDX
- APE
- ARB
- SUI
- WLD
- SEI

Market benchmark:
- BTCUSDT Binance USD-M daily trade klines

Audit interval:
- 2024-01 through 2026-08
- 32 completed calendar months

## Result

**FOUNDATION_PASS**

- fully qualified candidate assets: **19/20**
- preregistered minimum: **15/20**
- BTC benchmark: **32/32 months PASS**
- unexpected transport errors: **0**
- strategy PnL calculated: **false**
- beta calculated: **false**
- residual returns calculated: **false**
- reversal ranks calculated: **false**
- synthetic backfill used: **false**

## Qualified assets

SAND, MANA, ALGO, ZEC, IOTA, ZIL, COMP, SNX, KSM, 1INCH, CHZ, RUNE, SUSHI, DYDX, APE, ARB, SUI, WLD, SEI.

## Failed frozen candidate

EOS:
- complete core months: **16/32**
- failed months: **2025-05 through 2026-08**
- qualified: **false**

EOS remains represented in the frozen foundation evidence and is not replaced.

## Gate decision

The frozen gate required:
- all 20 candidates represented;
- BTC benchmark complete;
- zero unexpected transport errors;
- >=15/20 candidates fully data-ready;
- no strategy calculations.

All foundation requirements pass.

**Decision: FOUNDATION_PASS**

This authorizes only a separately frozen Relative-Value / Beta-Neutral Reversal V3 strategy protocol.

It does not authorize:
- beta selection;
- residual-return formation;
- reversal rankings;
- strategy PnL;
- Paper shadow;
- live execution.

## Anti-overfitting status

- candidate universe unchanged after coverage;
- EOS not replaced;
- BTC benchmark unchanged;
- audit interval unchanged;
- no synthetic repair;
- no strategy statistic calculated.

The next allowed step is to preregister the exact V3 beta estimation, residual-return formation, portfolio neutrality, funding/cost model and independent validation gates before first V3 PnL.
