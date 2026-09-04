# MERIDIAN v7.80 — Meta Allocator / Bot Decision Matrix

> Research-only. No Paper/live execution impact.

## Goal

Test whether the **relationship between existing bot opinions** contains more useful information than another standalone technical-confidence model.

The v7.80 unit is deliberately not yet an allocator. It is a synchronized attribution matrix that records, for the same opportunity:

- Baseline 6.2 opinion
- Shadow V1 opinion
- Challenger V2 opinion
- Regime opinion
- side chosen by each model
- model score/confidence where available
- risk proposal where available
- reasons / blocks
- market regime, volatility and future portfolio cluster metadata
- later normalized-R outcome

## Hypotheses

Predeclared questions:

1. Does full directional agreement across multiple models have better OOS expectancy than disagreement?
2. Does Baseline-vs-Regime side conflict identify poor-quality opportunities?
3. Does Shadow blocking while Challenger trades identify a distinct risk class rather than an automatic skip?
4. Are disagreement patterns regime- or asset-dependent?
5. Can a later allocator improve portfolio drawdown/opportunity capture by changing **risk allocation**, without inventing new entry indicators?

## Non-goals

v7.80 does **not**:

- route trades,
- size trades,
- change Baseline 6.2,
- change Shadow/Challenger/Regime behavior,
- create fixed agreement bonuses,
- lower thresholds,
- promote any strategy.

## Method

Use a common opportunity timestamp and attach all model opinions before evaluating outcomes. Future evaluation must use strict train-before-test or prospective cohorts. The matrix should be analyzed by pattern, side agreement, regime, asset and later cluster exposure.

Mandatory metrics include:

- sample size
- normalized avgR / PF / win rate
- Market Capture / missed winners / avoided losers when applicable
- side-conflict vs aligned cohorts
- trade frequency / coverage
- asset concentration
- regime splits
- temporal/walk-forward stability
- later portfolio max drawdown once a shadow allocator exists

## Promotion gate

There is no promotion gate in v7.80 because v7.80 has no execution behavior. A v7.82 allocator candidate may only be built after the matrix shows repeatable OOS differences between predeclared agreement/disagreement classes.

## Parallel work

The locked v7.79 prospective holdout remains unchanged and continues independently. Its hypothesis must not be edited to fit Meta Allocator findings.
