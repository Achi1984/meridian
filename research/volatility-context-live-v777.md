# MERIDIAN v7.77 — Volatility Context Drilldown Evidence

Research-only. No Paper/live execution impact.

## Provenance

- branch: `research/volatility-context-drilldown-v777`
- workflow run: `33913672016`
- source commit: `f3ab1256c70dc25df175ad621a00c6d92ffc2143`
- artifact: `9952337288`
- artifact SHA-256: `69469cc1b8730a98a3b2404082f8f9621c38dddc90bcb470359f238f55b97ce7`

## Result

The v7.76 family-level positive OOS result for `SIDE_REGIME_VOLATILITY` was decomposed into concrete side × regime × volatility contexts.

### 30d

No selected OOS signals.

### 60d

- selected: 2
- avgR: +0.1016R
- PF: 1.186
- context: `SHORT|BEAR|NORMAL`
- both signals were INJUSDT; one active/positive fold only

Interpretation: insufficient evidence and fully asset-concentrated.

### 90d

Aggregate family selection:
- selected: 59
- avgR: +0.2765R
- totalR: +16.3106R
- win rate: 57.63%
- PF: 1.59

Context decomposition:

#### `LONG|TRANSITION|NORMAL`
- selected: 52
- avgR: +0.3247R
- PF: 1.727
- active folds: 4
- positive folds: 3
- max single-asset share: 28.85%
- assets: ADA 12, FET 15, NEAR 7, INJ 14, SOL 2, DOT 1, SUI 1

This is the only context that passed the v7.77 conservative attribution screen (n >= 8, >=2 active and positive folds, positive avgR/PF, no >50% single-asset concentration).

#### `SHORT|BEAR|NORMAL`
- selected: 7
- avgR: -0.0821R
- PF: 0.87
- active folds: 3
- positive folds: 2
- max single-asset share: 42.86%

This context does not establish edge.

## Decision

`LONG|TRANSITION|NORMAL` becomes a **predeclared research hypothesis for robustness testing**, not a fixed bonus, hard gate or Paper rule.

Do not promote. The context was discovered using the same historical sample, so post-selection bias remains. Next step is v7.78 temporal and leave-one-asset-out stress testing followed by a future holdout before any portfolio replay.
