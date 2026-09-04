# MERIDIAN v7.80 — Meta Allocator / Decision Router Concept

> Design-only research checkpoint. No Paper/live execution impact. Baseline 6.2 remains frozen.

## Why this direction

Current evidence argues against creating another threshold-tuned entry scorer:
- Challenger V2 is the strongest current Challenger control but is constrained to Baseline READY.
- Shadow V1 deliberately over-filters and is useful mainly as a low-frequency / low-DD control.
- Regime V1 adapts strategy and side, but its side-specific rescoring is methodologically incomplete.
- Challenger V3/V3.1, Adaptive Evidence v7.74, combined Context Interaction v7.75 and the v7.78 fixed-context robustness test did not establish robust signal-level edge.
- The current backtest engine already provides independent ledgers and portfolio risk gates, so the next useful research layer can operate above the bots instead of inventing another raw signal score.

## Proposed bot: MERIDIAN Meta Allocator V1

The Meta Allocator does **not** generate a new technical setup. It observes the same market candidate and the decisions of existing research bots, then decides whether and how much portfolio risk should be allocated to that opportunity.

Think of it as a portfolio-level traffic controller:

1. Baseline produces the frozen reference candidate.
2. Challenger V2 reports confidence / TRADE / CAUTION / SKIP.
3. Shadow V1 reports whether the strict-control setup survives.
4. Regime V2 (once corrected) supplies side-specific regime evidence.
5. The allocator evaluates agreement, disagreement, current portfolio state and historically measured bot/context reliability.
6. Output is one of: `FULL`, `REDUCED`, `OBSERVE`, `SKIP` with an allocation weight — never a silent change to the underlying bot rules.

## Core research hypothesis

The edge may live less in an absolute confidence score and more in **relative disagreement between independent models**.

Examples to test, not hard-code:
- Baseline READY + Challenger TRADE + Shadow ELIGIBLE = strong consensus.
- Baseline READY + Challenger TRADE + Shadow BLOCK = opportunity with higher uncertainty; reduce risk rather than automatically reject.
- Regime model selects opposite side from Baseline = high-information disagreement; require side-specific rescoring before allocation.
- Challenger CAUTION but strong recent context reliability = possible reduced-risk allocation.
- All models weak / conflicting in CHOP or drawdown stress = preserve capital.

The disagreement itself becomes an observable feature.

## Inputs

### Signal-level
- Baseline side/status/technical/candidate/distanceAtr
- Challenger V2 decision/confidence/riskPct
- Shadow V1 decision/reasons/regime
- Regime V2 final side, side-specific score and regime
- MTF alignment, ADX, RSI, MACD, volume, volatility

### Bot-history / evidence-level
Use only leakage-safe history prior to the current decision:
- rolling normalized-R expectancy by bot
- PF and hit rate by bot × side × regime
- sample count and reliability/shrinkage
- recent calibration drift
- missed-winner R / avoided-loser R
- market capture / opportunity cost

### Portfolio-level
- current open risk
- number of open positions
- symbol/correlation concentration
- daily loss / current drawdown
- recent losing streak and risk budget utilization

## Output

Research output schema candidate:

```text
allocationDecision: FULL | REDUCED | OBSERVE | SKIP
allocationScore: 0..100
riskMultiplier: 0.00..1.00
selectedSide: LONG | SHORT | NONE
agreementState: CONSENSUS | PARTIAL | CONFLICT
primaryReason: ...
components: {
  baseline,
  challenger,
  shadow,
  regime,
  historicalReliability,
  portfolioState
}
```

## Important design principle

Do **not** average all scores into one opaque mega-score.

Use a small hierarchy:
1. hard safety constraints only,
2. side resolution,
3. model agreement/disagreement state,
4. leakage-safe historical reliability,
5. portfolio risk budget,
6. bounded allocation multiplier.

This preserves interpretability and avoids repeating the failed pattern of endlessly retuning a compressed confidence score.

## Suggested allocation experiment

Initial V1 should be research-only and compare four fixed policies on identical candidate timelines:

### A — Baseline control
Existing Baseline execution unchanged.

### B — Challenger control
Existing Challenger V2 behavior unchanged.

### C — Consensus Allocator
Allocate only when at least two independent models support the same final side. This is an experiment, not an assumed winner.

### D — Reliability Allocator
Use historical bot × side × regime expectancy as a soft risk multiplier. Do not hard-filter solely on recent negative expectancy.

## Risk multiplier prototype

Avoid arbitrary optimization. Start with a tiny predeclared set:
- `1.00x` = strong consensus + reliable history + healthy portfolio
- `0.50x` = partial consensus / uncertainty
- `0.25x` = exploratory low-confidence allocation
- `0.00x` = safety block or unresolved side conflict

No leverage change. Existing portfolio maximums remain authoritative.

## Mandatory evaluation

For Baseline, Challenger V2, Shadow V1, Regime V2 and Meta Allocator compare:
- total R / P&L
- avg/median R
- PF
- max drawdown
- trade count / frequency
- market capture
- missed-winner R
- avoided-loser R
- opportunity cost
- LONG/SHORT split
- regime split
- asset concentration
- agreement-state split
- walk-forward and prospective stability

A lower drawdown gained only by deleting nearly all opportunities is not sufficient.

## Strong secondary extension: Correlation / Cluster Risk

A useful portfolio extension can be built independently of signal scoring:
- classify simultaneous positions into BTC-beta / L1 / DeFi / meme / other clusters,
- estimate rolling return correlation,
- cap *cluster* risk rather than treating three highly correlated LONG positions as three independent 1% risks.

This addresses a real portfolio weakness without claiming better entry prediction.

## Why not build another Challenger V3.2 now

The current research chain has repeatedly shown that fixed/marginal confidence transformations do not yet provide robust signal-level edge. Building another entry bot now would risk another threshold-search cycle.

The Meta Allocator tests a different hypothesis: whether **selection between existing diverse models and portfolio-aware risk allocation** creates value even when no single absolute score is strongly calibrated.

## Prerequisites before implementation

1. Keep v7.79 prospective holdout locked and untouched.
2. Implement Regime V2 side-specific rescoring before using Regime as an allocator input.
3. Build Bot Decision Matrix telemetry so every candidate records all bot decisions at the same timestamp, including SKIP/WAIT outcomes.
4. Build disagreement/consensus attribution on historical research timelines.
5. Only then implement a shadow Meta Allocator ledger.

## Proposed sequence

- **v7.80** — design + Bot Decision Matrix / disagreement telemetry.
- **v7.81** — Regime V2 side-specific rescoring and independent validation.
- **v7.82** — Meta Allocator shadow ledger with fixed allocation policy A/B/C/D comparison.
- **v7.83** — correlation/cluster-risk overlay and portfolio-path replay.

No automatic promotion at any stage.
