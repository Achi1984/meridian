# MERIDIAN v7.87 — Paperbot Deep Dive

Status: RESEARCH ONLY. No execution impact. No Pionex changes. Baseline 6.2 remains frozen.

## Current v8 PAPER snapshot (2026-09-06)

| Metric | Baseline | Challenger V2 | Delta |
|---|---:|---:|---:|
| Closed trades | 30 | 23 | -7 / 76.7% retention |
| PnL | -$854 | -$30 | +$824 |
| Profit Factor | 0.63 | 0.98 | +0.35 |
| Expectancy / trade | -$28 | -$1 | +$27 |
| Max drawdown | 11.25% | 8.96% | -2.29 pp |
| Win rate | 40.0% | 47.8% | +7.8 pp |

Headline: Challenger V2 removes ~96.5% of Baseline loss while retaining 76.7% of closed-trade frequency. It is the strongest current legacy control, but it is still not positive expectancy and PF remains below 1.00.

## Opportunity cost snapshot

- Missed winners: 62
- Avoided losers: 81
- Net counterfactual R: +6.096R
- Average excluded outcome: about +0.043R across 143 closed counterfactual outcomes

Interpretation: the Challenger filter currently avoids more losers by count, but the excluded set is net positive in R. That means the filter is still discarding too much winner magnitude. This is the key tension: observed ledger quality improves sharply, while opportunity cost remains unfavorable.

## What v7.87 telemetry adds

`research-analytics.js` now exposes a `deepDive` research object with:

- Baseline vs Challenger cohort metrics by side
- cohort metrics by regime
- cohort metrics by symbol
- PnL / expectancy / PF / win rate / trade count per cohort
- sample adequacy flag (`n >= 8`)
- descriptive temporal stability slices
- linked Challenger opportunity-cost telemetry

Caveat: temporal slices are descriptive out-of-time stability slices, not a retrained-model OOS experiment. Challenger V2 also still has the historical Baseline READY dependency.

## Decision

NO PROMOTION.

Do not tune thresholds blindly. The next decision should be driven by the new cohort telemetry: identify where Challenger's improvement comes from and where positive counterfactual R is being sacrificed. Prefer soft allocation/routing research over additional hard gates.

## Next research sequence

1. Inspect LONG vs SHORT Challenger delta vs Baseline.
2. Inspect regime x side cohorts; require adequate sample before conclusions.
3. Inspect symbol concentration and remove single-asset explanations.
4. Inspect temporal slices for sign stability.
5. Attribute the +6.096R opportunity cost by regime/reason.
6. Only after the above, evaluate a soft Meta Allocator / reliability router in shadow mode.
