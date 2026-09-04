# MERIDIAN — Next Session Handoff

> Read `MERIDIAN_CONTEXT.md` and `MERIDIAN_DECISIONS.md` before acting on this handoff.

## Current release track

- Baseline engine: `6.2.0`
- Baseline ruleset: `6.2-SIGNAL-V1`
- Main remains the live source and Baseline/Paper execution is unchanged.
- Active research branch: `research/adaptive-evidence-v774`
- Draft PR: #30
- Adaptive Evidence remains research-only and is not connected to Paper execution.

## Latest completed research — v7.74 Adaptive Evidence

The first full Adaptive Evidence calibration pipeline is complete:

- reliability-weighted soft evidence with no fixed context bonus,
- portfolio-independent A_CURRENT normalized-R cohorts,
- one signal per symbol per 4h,
- full 14-day horizon / right-censoring guard,
- strict post-signal candle replay,
- expanding train-before-test walk-forward,
- Market Capture / Opportunity Cost,
- canonical market-source adapter tied to the `cloud-backtest.js` candidate constructor,
- Binance public-data fallback for geo-blocked runners,
- one master cohort so 30d / 60d / 90d share the same sampling phase,
- dedicated GitHub Actions evidence workflow and reproducible artifact.

Release Safety passed after the source-adapter test correction. The dedicated 12-asset research workflow also completed successfully.

## Definitive live evidence

GitHub Actions run:

- run id: `33911834647`
- source commit: `37e569f5d03ea579126017f10fabe5f2d69eeb6b`
- artifact id: `9951674418`
- artifact SHA-256: `9c2066fa4d5ef2da6bbd342d553f08b306c3f6e64323cf9d47ddc0b1db2010c4`

Assets: BTC, ETH, SOL, XRP, ADA, SUI, HBAR, AVAX, NEAR, DOT, FET, INJ.

| Window | Cohort | Avg R | OOS selected | Selected Avg R | PF | Coverage | Capture |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30d | 2,160 | -0.403R | 0 | — | 0 | 0.0% | 0.0% |
| 60d | 4,320 | -0.314R | 3 | -1.133R | 0 | 0.1% | 0.0% |
| 90d | 6,480 | -0.270R | 397 | -0.203R | 0.711 | 7.7% | 8.4% |

Master 90d cohort:

- avg -0.2697R
- median -1.1296R
- total -1747.3782R
- LONG avg -0.3006R
- SHORT avg -0.2440R

**Conclusion:** Adaptive Evidence V1 fails the signal-edge promotion gate. It is valuable infrastructure and negative evidence, but it is not Challenger V3.2.

Preserved summary: `research/adaptive-evidence-live-v774.md`.

## Interpretation rules from this checkpoint

1. Do not lower TRADE/CAUTION thresholds simply to increase trade count.
2. Do not promote Adaptive Evidence V1.
3. Do not convert large negative marginal buckets directly into hard filters.
4. The broad 4h-sampled universe is itself negative under A_CURRENT.
5. A negative skipped-opportunity metric means avoided losses exceeded missed winners; it does not prove profitable selection.
6. The current marginal aggregator can double-count correlated base-rate effects because side, regime, momentum, MTF etc. overlap.
7. The recurring `LONG | NORMAL volatility` positive marginal in 30d/60d did not generalize strongly to 90d and must not become a fixed bonus.

## Next recommended work — highest priority

### Priority 1 — Context Interaction / Hierarchical Evidence Lab

Build a new research-only checkpoint, preferably on a new named branch after v7.74 is clean, that tests a **small predefined interaction set** rather than unrestricted combinations:

- side × regime × MTF alignment
- side × regime × momentum
- side × regime × volatility
- asset × side × regime
- side × MTF alignment × momentum
- volume × volatility only when sample sizes permit

Core methodological improvement: estimate conditional/residual edge relative to broader parent/base-rate cohorts so correlated marginal evidence is not counted repeatedly.

Required guards:

- strong minimum sample requirements,
- shrinkage toward parent/base rate,
- cross-window stability,
- strict training data before test data,
- no right-censored outcomes,
- no portfolio gates during signal calibration,
- bounded/predefined interaction search to reduce overfitting.

### Priority 2 — OOS comparison against v7.74 marginals

The new interaction model must beat the current v7.74 selector out of sample on more than one metric:

- avgR / expectancy
- PF
- trade count / coverage
- Market Capture
- missed-winner R
- avoided-loser R
- opportunity cost
- side × regime stability

Do not claim success from one isolated window.

### Priority 3 — Challenger V3.2 portfolio replay only after signal edge

Only when a revised model demonstrates repeatable positive OOS signal-level edge should Challenger V3.2 portfolio replay be implemented. Preserve Challenger V2 and Baseline as controls.

### Priority 4 — Regime V2

Recompute directional evidence after final side selection. Test independently.

### Priority 5 — Exit integration / Hybrid

Only after entry/scoring edge is validated. Do not mix entry and exit changes prematurely.

## Known bot findings that must not be forgotten

1. Baseline 6.2 remains frozen.
2. Shadow V1 is the hard-filter / low-DD control, not an assumed winner.
3. Challenger V2 remains the strongest existing Challenger control but still depends on Baseline READY.
4. Challenger V3/V3.1 were rejected.
5. Adaptive Evidence V1 is now also a non-promotable signal-model checkpoint.
6. Regime V1 retains the side-rescoring methodological weakness.
7. More evidence must not automatically mean more hard gates.
8. Trade frequency, opportunity cost, avoided losers and missed winners remain mandatory.
9. Fixed context bonuses are not durable evidence.
10. Training evidence must strictly predate evaluation.
11. Full configured outcome horizon is required for calibration.

## Promotion gate

No automatic promotion. Require adequate samples, positive OOS expectancy/PF, acceptable drawdown after later portfolio replay, sufficient coverage, manageable opportunity cost, cross-window/regime stability and explicit human approval.

## Save-progress rule

Do not leave meaningful MERIDIAN work only in chat. Save every substantial implementation/research checkpoint to GitHub with descriptive commits. Keep experimental work on named research branches until deliberately reviewed/merged.

## New-chat startup instruction

**“Open `Achi1984/meridian` and read `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md` first. Treat them as canonical MERIDIAN project memory. Verify `main`, active research branches and the latest evidence before changing anything. Do not change Baseline 6.2.”**
