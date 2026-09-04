# MERIDIAN v7.75 — Context Interaction / Hierarchical Evidence Lab

## Status

Research-only successor to the negative v7.74 Adaptive Evidence calibration. No Baseline 6.2, Paper/live execution, sizing, risk, exit or server behavior is changed.

## Why this exists

The real v7.74 12-asset run showed that the broad 4h-sampled universe and the current marginal Adaptive Evidence selector remain negative out of sample. Simply lowering thresholds would hide the problem rather than solve it.

The v7.74 evaluator also combines correlated marginal evidence such as side, side×regime, side×momentum and side×MTF. A common negative base rate can therefore be counted repeatedly.

v7.75 tests a different hypothesis: **does a specific context add residual edge relative to its broader parent context?**

## Predefined interaction set

`context-interaction-evidence.js` deliberately limits the search space to:

- side × regime × MTF alignment
- side × regime × momentum
- side × regime × volatility
- asset × side × regime
- side × MTF alignment × momentum
- side × volume × volatility

No unrestricted combinatorial feature search is allowed in V1.

## Hierarchical residual method

For each child interaction, the lab computes:

1. child cohort avgR,
2. broader parent cohort avgR,
3. raw residual = child avgR − parent avgR,
4. sample-size shrinkage toward zero,
5. reliability from child sample size, parent sample size and cross-window residual-sign agreement,
6. final bounded residual edge.

Example: if `LONG|RANGE` averages -0.40R and `LONG|RANGE|MTF3` also averages -0.40R, the child gets approximately zero residual evidence rather than receiving another negative weight for information already present in the parent.

If the child averages +0.20R while its parent averages -0.40R, the child can earn positive residual evidence — but only after minimum samples, shrinkage and stability checks.

## Initial guards

- minimum child samples: 48
- minimum parent samples: 96
- shrinkage samples: 72
- minimum reliable sample target: 72
- minimum stable windows: 3
- minimum reliability for evaluation: 0.45
- residual edge cap: ±1.25R

These values are research controls, not trading thresholds. They must not be tuned against one favorable historical window.

## Initial tests

The first tests verify:

- the interaction set is explicit and bounded,
- a child matching a negative parent base rate produces near-zero residual evidence,
- a genuinely better child can show positive residual edge relative to a negative parent,
- fragmented small buckets remain ineligible/neutral,
- the evaluator consumes only eligible reliable residual components.

## Next step

Connect this module to the existing v7.74 cohort rows with leakage-safe expanding walk-forward training, then compare v7.75 OOS selection directly against v7.74 on the same 12-asset master cohort.

Required comparison metrics: selected avgR, PF, coverage, Market Capture, missed-winner R, avoided-loser R, opportunity cost and side×regime stability.

**No Challenger V3.2 portfolio replay until signal-level OOS edge becomes positive and repeatable.**
