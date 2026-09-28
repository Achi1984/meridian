# Paper Bot Profit Discovery V1 — Frozen Result

Workflow run: **36481445167**  
Artifact: **10996942843**  
Artifact SHA-256: `b4fb36287a8ddc913da851040abd939a7c15911471ac27d539a4b19d87497096`

This file records the first untouched result of `PAPERBOT-PROFIT-SPECIAL-AGENT-V1-FROZEN`. The protocol was committed before this run.

| Candidate | Periods | Net return | PnL | PF | Max DD | Positive windows | Positive assets | Positive-PnL concentration | Gate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| TSMOM Classic | 50 | -14.74% | -$1,474.11 | 0.634 | 16.92% | 1/5 | 2 | 64.2% | FAIL |
| Persistent TSMOM V1 | 31 | -18.97% | -$1,896.78 | 0.563 | 22.10% | 1/5 | 4 | 41.9% | FAIL |
| Donchian Trend V1 | 240 | +2.75% | +$274.96 | 1.049 | 11.14% | 2/5 | 4 | 41.3% | FAIL |

## Frozen decision

**NO_CANDIDATE_PASSES.**

Donchian Trend V1 is the only positive-return candidate, but it fails the pre-committed Profit Factor and chronological-stability gates. It is therefore **not** a discovery leader and cannot advance to holdout or promotion.

TSMOM Classic and Persistent TSMOM V1 both have negative compounded return and low Profit Factor over this discovery sample.

## Next allowed step

Per the frozen protocol the next stage is **RESEARCH_REDESIGN**, not threshold relaxation. Any successor must be named and frozen before its result is inspected. The most defensible next hypothesis is regime-aware/risk-managed trend research motivated by external evidence; no V1 parameter may be rescued post hoc.

Research only. No live execution impact. No auto-promotion.
