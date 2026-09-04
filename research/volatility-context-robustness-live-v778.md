# MERIDIAN v7.78 — Volatility Context Robustness Evidence

Research-only. No Paper/live execution impact.

## Provenance

- branch: `research/volatility-context-robustness-v778`
- workflow run: `33913958818`
- source commit: `12eac512489f505b9c9da48a5c2a1724224522d3`
- artifact: `9952447125`
- artifact SHA-256: `ffd1d1b20078bbdde85b5b5b2b287a5df1b6f39be9e32b8e44efb52d1dc8bbde`

## Predeclared context

`LONG|TRANSITION|NORMAL`

This test deliberately removed the v7.77 family-selection layer and asked a stricter question: does the raw context itself have a stable positive base rate across the same 90-day historical sample?

## Result

Overall fixed-context sample:
- n = 107
- avgR = **-0.043R**
- totalR = **-4.6022R**
- win rate = 43.93%
- PF = **0.93**
- robustness gate = **FAIL**

Temporal buckets:
- T1: 47, avg -0.3221R, PF 0.566
- T2: 24, avg -0.0989R, PF 0.845
- T3: 21, avg +0.2673R, PF 1.562
- T4: 3, avg +0.4834R, PF 2.298
- T5: 2, avg +0.0869R, PF 1.157
- T6: 10, avg +0.5674R, PF 2.708

4/6 temporal buckets were positive, but the two largest/earliest buckets were negative enough to make the full sample negative.

Leave-one-asset-out:
- only 2/9 adequate cases remained positive (excluding NEAR or SUI)
- excluding INJ worsened the sample to -0.2276R / PF 0.674
- excluding ADA remained negative at -0.0922R / PF 0.855

## Interpretation

The v7.77 positive OOS family-selection result does **not** imply that `LONG|TRANSITION|NORMAL` is a standalone stable edge. Its raw context base rate is negative across the full same-sample history and is sensitive to time/asset composition.

The recent temporal buckets are encouraging but cannot be promoted because they were observed after hypothesis discovery. Treat them as a prospective hypothesis only.

## Decision

- no fixed context bonus
- no hard gate
- no Challenger V3.2 replay
- no threshold rescue
- next step should be a **prospective locked holdout** beginning after the v7.78 research cutoff, with the context and methodology frozen before future outcomes mature
