# MERIDIAN — Next Session Handoff

> Read `MERIDIAN_CONTEXT.md` and `MERIDIAN_DECISIONS.md` before acting on this handoff.

## Current release track

- Baseline engine: `6.2.0`
- Baseline ruleset: `6.2-SIGNAL-V1`
- Main remains the live source and Baseline/Paper execution is unchanged.
- v7.74 branch: `research/adaptive-evidence-v774`, draft PR #30.
- Active successor research branch: `research/context-interaction-v775`, draft PR #31 based on v7.74.
- All v7.74/v7.75 work is research-only and disconnected from Paper execution.

## v7.74 Adaptive Evidence result

The real 12-asset v7.74 calibration failed the signal-edge gate:

- 30d: 2,160 signals, avg -0.403R; OOS selected 0
- 60d: 4,320 signals, avg -0.314R; OOS selected 3 at -1.133R / PF 0
- 90d: 6,480 signals, avg -0.270R; OOS selected 397 at -0.203R / PF 0.711

Preserved in `research/adaptive-evidence-live-v774.md`.

## v7.75 Context Interaction / Hierarchical Evidence

Implemented:

- predefined bounded interaction set,
- hierarchical residual edge versus broader parent cohort,
- child + parent sample guards,
- shrinkage toward zero,
- cross-window residual-sign reliability,
- expanding train-before-test interaction walk-forward,
- direct same-cohort OOS comparison versus v7.74,
- reproducible 12-asset GitHub Actions workflow.

Predefined families:

- side × regime × MTF
- side × regime × momentum
- side × regime × volatility
- asset × side × regime
- side × MTF × momentum
- side × volume × volatility

### Definitive v7.75 live evidence

Workflow run `33912789463`, source commit `ce1c7c54553c7b721ab0f70f2991de320a7209cc`, artifact `9952013237`, SHA-256 `de7ee85ae8e2d9461562d756eda6ba0b9194762702a3e6b3c6c1866b1d260d58`.

| Window | Selector | Selected | Avg R | PF | Coverage | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 30d | v7.74 Marginal | 0 | — | 0 | 0.0% | 0.0% |
| 30d | v7.75 Interaction | 113 | -0.657R | 0.324 | 6.5% | 5.0% |
| 60d | v7.74 Marginal | 3 | -1.133R | 0 | 0.1% | 0.0% |
| 60d | v7.75 Interaction | 977 | -0.377R | 0.531 | 28.3% | 27.6% |
| 90d | v7.74 Marginal | 397 | -0.203R | 0.711 | 7.7% | 8.4% |
| 90d | v7.75 Interaction | 978 | -0.300R | 0.604 | 18.9% | 19.1% |

**Conclusion:** Hierarchical residuals increase coverage substantially but the combined interaction selector remains negative OOS in every window. v7.75 is not Challenger V3.2 and must not be promoted.

A repeated attribution pattern worth investigating is `LONG|BULL|NORMAL volatility` versus `LONG|BULL`: residual +0.159R (30d), +0.146R (60d), +0.121R (90d). This remains hypothesis evidence only, not a fixed bonus.

Durable report: `research/context-interaction-live-v775.md`.

## Next recommended work — highest priority

### Priority 1 — Interaction Family Attribution / Ablation Lab

Do not tune the combined v7.75 thresholds. Instead evaluate each predefined interaction family **independently out of sample** on the identical master cohort and folds.

Questions to answer:

- Which interaction family, if any, has positive OOS avgR and PF?
- Does that family remain positive in more than one time window?
- How much coverage and Market Capture does it retain?
- Are gains concentrated in one asset/regime or broadly repeatable?
- Does side × regime × volatility, especially the repeated LONG/BULL/NORMAL pattern, survive true family-level OOS testing?

### Priority 2 — Small predeclared combinations only after family evidence

If individual families show edge, test only a few predeclared combinations. Do not search arbitrary combinations after seeing results.

### Priority 3 — Challenger V3.2 portfolio replay only after positive signal-level OOS evidence

No portfolio replay or Paper integration until the revised model passes signal-level calibration with useful coverage.

### Priority 4 — Regime V2, then later Exit/Hybrid

Keep separate research axes until independently validated.

## Method rules that remain mandatory

1. Baseline 6.2 stays frozen.
2. No Paper/live execution changes.
3. Training strictly predates test data.
4. Full configured outcome horizon required.
5. Portfolio gates excluded from signal calibration.
6. Trade frequency, Market Capture, missed winners, avoided losers and opportunity cost remain mandatory.
7. More evidence does not automatically become more hard gates.
8. Full-window attribution is not OOS proof.
9. Do not lower thresholds merely to rescue a negative model.

## Save-progress rule

Do not leave meaningful MERIDIAN work only in chat. Save every substantial implementation/research checkpoint to GitHub with descriptive commits and preserve negative results as first-class evidence.

## New-chat startup instruction

**“Open `Achi1984/meridian` and read `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md`. Check active research branches/PRs and latest evidence. Keep Baseline 6.2 frozen and continue from the highest-priority handoff.”**
