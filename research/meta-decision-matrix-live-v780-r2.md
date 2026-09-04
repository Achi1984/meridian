# MERIDIAN v7.80 R2 — Meta Decision Matrix Evidence

Research-only. Baseline 6.2 / Paper execution unchanged.

## Provenance

- branch: `research/meta-allocator-v780-design`
- workflow run: `33915359505`
- source commit: `5e7c01ecf7c45cc7d68419f3419e722b79fff38e`
- artifact: `9952953366`
- artifact digest: `sha256:de8ef10df1e70d05362f8a24a73fc1a0ba7264a6bc9cf8471c3467ba56d9fd09`
- assets: BTC, ETH, SOL, XRP, ADA, SUI, HBAR, AVAX, NEAR, DOT, FET, INJ
- source outcome: A_CURRENT / Baseline-side normalized R over the existing 14-day research horizon

Regime side conflict is therefore tested as an opportunity-quality / risk signal. This report does **not** claim what P&L the alternate Regime side would have produced.

## 30d

Overall: 2,160 signals · avg **-0.394R** · PF **0.521**.

| Supportive bots | n | Avg R | PF |
| --- | ---: | ---: | ---: |
| 0 | 744 | -0.501R | 0.432 |
| 1 | 872 | -0.372R | 0.539 |
| 2 | 61 | -0.271R | 0.628 |
| 3 | 231 | -0.313R | 0.600 |
| 4 | 252 | -0.252R | 0.664 |

Side conflict: 312 signals, -0.414R / PF 0.493. No side conflict: 1,848, -0.390R / PF 0.526.

Hard disagreement: 476 signals, -0.418R / PF 0.499. No hard disagreement: 1,684, -0.387R / PF 0.527.

## 60d

Overall: 4,320 signals · avg **-0.313R** · PF **0.593**.

| Supportive bots | n | Avg R | PF |
| --- | ---: | ---: | ---: |
| 0 | 1,479 | -0.360R | 0.548 |
| 1 | 1,690 | -0.321R | 0.584 |
| 2 | 151 | -0.353R | 0.546 |
| 3 | 503 | -0.212R | 0.705 |
| 4 | 497 | -0.235R | 0.676 |

Side conflict: 581 signals, -0.304R / PF 0.599. No side conflict: 3,739, -0.314R / PF 0.593.

Hard disagreement: 1,047 signals, -0.325R / PF 0.582. No hard disagreement: 3,273, -0.309R / PF 0.597.

## 90d

Overall: 6,480 signals · avg **-0.269R** · PF **0.638**.

| Supportive bots | n | Avg R | PF |
| --- | ---: | ---: | ---: |
| 0 | 2,160 | -0.305R | 0.600 |
| 1 | 2,636 | -0.256R | 0.651 |
| 2 | 222 | -0.392R | 0.511 |
| 3 | 704 | -0.191R | 0.730 |
| 4 | 758 | -0.247R | 0.662 |

Side conflict: 830 signals, -0.257R / PF 0.649. No side conflict: 5,650, -0.271R / PF 0.636.

Hard disagreement: 1,534 signals, -0.273R / PF 0.634. No hard disagreement: 4,946, -0.268R / PF 0.639.

## Interpretation

1. **Naive bot vote count is not an edge.** Every support-count class remains negative in every tested window.
2. More agreement is **not monotonic**. Four supportive bots are not consistently better than three; support=2 is particularly weak in 60d/90d.
3. `SUPPORT_3` is the least-negative class in 60d and 90d, but still negative and therefore not allocatable evidence.
4. Baseline-vs-Regime side conflict is not a reliable universal risk-off signal in this broad universe; its result is very close to the no-conflict cohort and even slightly less negative over 60d/90d.
5. Hard disagreement is only marginally worse and not stable enough to justify a risk rule.
6. The broad 4h candidate universe remains structurally negative, consistent with v7.74/v7.75 findings. A Meta Allocator should therefore be tested **conditional on an actually executable opportunity universe**, not across every sampled candidate.

## Decision

- no FULL/REDUCED/EXPLORATORY/SKIP routing policy yet
- no vote-count bonus
- no conflict hard gate
- no risk sizing change
- keep Meta Allocator as attribution infrastructure

## Next predeclared test

v7.80 R3 should evaluate the same matrix **within executable opportunity universes**, without changing model thresholds:

- `BASELINE_READY`: source signal is READY
- `ANY_SUPPORT`: at least one bot says TRADE/CAUTION
- `REGIME_ONLY`: Baseline is not READY while Regime is supportive

Within those universes, compare predeclared classes such as Shadow support, Challenger TRADE vs CAUTION/SKIP, Regime agreement/conflict, and 3-vs-4 support. Use chronological folds and require cross-fold/window stability before any allocator policy is considered.
