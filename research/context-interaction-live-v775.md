# MERIDIAN v7.75 — Context Interaction Live Evidence

## Status

**Research-only negative evidence checkpoint. No promotion. No Paper/live execution change.**

v7.75 tested hierarchical residual interactions against the v7.74 marginal Adaptive Evidence selector on the exact same 12-asset master cohort and leakage-safe expanding out-of-sample slices.

## Provenance

- GitHub Actions workflow: `MERIDIAN Context Interaction Research`
- Run id: `33912789463`
- Source commit: `ce1c7c54553c7b721ab0f70f2991de320a7209cc`
- Artifact id: `9952013237`
- Artifact SHA-256: `de7ee85ae8e2d9461562d756eda6ba0b9194762702a3e6b3c6c1866b1d260d58`
- Assets: BTC, ETH, SOL, XRP, ADA, SUI, HBAR, AVAX, NEAR, DOT, FET, INJ
- Outcome horizon: 14 days
- Same master 4h sampling phase as v7.74
- Portfolio-independent signal calibration; no portfolio gates

## OOS comparison

| Window | Selector | Selected | Avg R | PF | Coverage | Market Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 30d | v7.74 Marginal | 0 | — | 0 | 0.0% | 0.0% |
| 30d | v7.75 Interaction | 113 | -0.657R | 0.324 | 6.5% | 5.0% |
| 60d | v7.74 Marginal | 3 | -1.133R | 0 | 0.1% | 0.0% |
| 60d | v7.75 Interaction | 977 | -0.377R | 0.531 | 28.3% | 27.6% |
| 90d | v7.74 Marginal | 397 | -0.203R | 0.711 | 7.7% | 8.4% |
| 90d | v7.75 Interaction | 978 | -0.300R | 0.604 | 18.9% | 19.1% |

The interaction model materially recovered opportunity coverage, but **selected expectancy and PF stayed negative in all windows**. In 90d it increased coverage by about 11.2 percentage points while degrading selected avgR by about -0.098R and PF by -0.107 versus v7.74.

## Residual interaction findings

One interaction is notable for appearing positively across all three full-window attribution tables:

- `SIDE_REGIME_VOLATILITY · LONG|BULL|NORMAL vs LONG|BULL`
  - 30d residual: +0.159R, child n=53, reliability 49.1%
  - 60d residual: +0.146R, child n=68, reliability 56.7%
  - 90d residual: +0.121R, child n=196, reliability 80.0%

This is interesting evidence, but it is **not sufficient for promotion** because the combined OOS selector remains negative and the full-window attribution itself is not a standalone out-of-sample proof for that family.

Other strong 90d positive residuals include:

- `SHORT|LOW volume|NORMAL volatility`: +0.296R, n=231, reliability 100%
- `SHORT|BEAR|NORMAL volatility`: +0.181R, n=246, reliability 80%
- `LONG|TRANSITION|NORMAL volatility`: +0.145R, n=107, reliability 100%
- `ADAUSDT|SHORT|BEAR`: +0.114R, n=169, reliability 100%

Strong negative residuals include `SHORT|TRANSITION|MTF0`, `SHORT|MTF2|NEUTRAL momentum`, BTC LONG in BULL and `SHORT|MTF1|STRONG momentum`.

## Interpretation

1. Hierarchical/base-rate centering solved one methodological problem but **did not create profitable OOS selection**.
2. More coverage is not automatically better; v7.75 recovered many opportunities but most of the selected set still had negative expectancy.
3. Do not lower residual thresholds or simply keep the highest-looking full-window interactions.
4. The combined evaluator still mixes several overlapping interaction families. A signal can receive evidence from multiple correlated interaction specifications, so residual evidence can still be duplicated across families.
5. The next clean attribution step is **interaction-family ablation**: evaluate each predefined interaction family independently OOS on the same cohort, then test small predeclared combinations only if individual families demonstrate repeatable edge.
6. Special attention should be paid to the side × regime × volatility family because `LONG|BULL|NORMAL` is the clearest repeated positive residual pattern, but it must earn that status in OOS family-level tests.

## Decision

v7.75 remains a research checkpoint and is **not Challenger V3.2**. Next: Interaction Family Attribution / Ablation Lab. No Paper integration and no threshold tuning to rescue the current combined selector.
