# MERIDIAN — Next Session Handoff

> Read `MERIDIAN_CONTEXT.md` and `MERIDIAN_DECISIONS.md` before acting on this handoff.

## Current release track

- Live/Main remains `v7.62 R4` UI/release with frozen Paper engine `6.2.0 / 6.2-SIGNAL-V1`.
- Baseline/Paper execution remains unchanged.
- Active prospective hypothesis branch: `research/prospective-holdout-v779`, draft PR #35.
- Active Meta Allocator branch: `research/meta-allocator-v780-design`, draft PR #36, based on v7.79.
- All v7.74–v7.80 work is research-only and disconnected from Paper execution unless explicitly stated otherwise.

## Preserved research sequence

- v7.74 Adaptive Evidence: failed signal-edge gate.
- v7.75 Context Interaction: improved coverage but remained negative OOS.
- v7.76 Interaction Family Ablation: `SIDE_REGIME_VOLATILITY` was the only family with a positive 90d OOS slice, but coverage was very small.
- v7.77 Volatility Context Drilldown: localized the apparent family effect.
- v7.78 Robustness: `LONG|TRANSITION|NORMAL` failed full-history robustness (107 signals, avg -0.043R, PF 0.93).
- v7.79 Prospective Holdout: hypothesis frozen after `2026-09-04T20:02:00Z`; wait for 30 fully matured 14-day outcomes before review.

## v7.80 Meta Allocator — implemented

Core concept: do not create another raw indicator bot. Synchronize existing model opinions on the same opportunity and test whether agreement/disagreement contains allocation or risk information.

### Decision Matrix core

`meta-decision-matrix.js` normalizes:
- Baseline
- Shadow V1
- Challenger V2
- Regime V1

Captured telemetry:
- TRADE / CAUTION / WAIT / SKIP
- direction votes and agreement
- Baseline-vs-Regime side conflict
- hard disagreement
- dispersion
- stable pattern key
- normalized-R outcome attachment

No trade routing or sizing exists.

### v7.80 R2 canonical adapter

Added:
- `meta-decision-matrix-source.js`
- `meta-decision-matrix-evidence.js`
- `scripts/meta-decision-matrix-live.mjs`
- regression tests
- `.github/workflows/meta-decision-matrix-evidence-v780.yml`

The adapter reuses canonical cloud candidate opportunities. Shadow and Challenger opinions mirror current research rules; Regime uses `regimeDecision`.

**Important outcome definition:** R2 attaches the A_CURRENT / Baseline-side normalized-R outcome. A Regime side conflict is therefore tested as a quality/risk signal for the source opportunity, not as alternate-side P&L.

## Definitive v7.80 R2 evidence

Workflow run `33915359505`, source commit `5e7c01ecf7c45cc7d68419f3419e722b79fff38e`, artifact `9952953366`, digest `sha256:de8ef10df1e70d05362f8a24a73fc1a0ba7264a6bc9cf8471c3467ba56d9fd09`.

Overall sampled universe:
- 30d: 2,160 signals, avg -0.394R, PF 0.521
- 60d: 4,320 signals, avg -0.313R, PF 0.593
- 90d: 6,480 signals, avg -0.269R, PF 0.638

Support-count result:
- all support-count cohorts remain negative in all windows
- support strength is non-monotonic
- 90d `SUPPORT_3`: 704 signals, avg -0.191R, PF 0.730
- 90d `SUPPORT_4`: 758 signals, avg -0.247R, PF 0.662
- 90d `SUPPORT_2`: 222 signals, avg -0.392R, PF 0.511

Conflict result:
- universal Baseline-vs-Regime side conflict is not a stable risk-off indicator
- hard disagreement is only marginally different and does not justify a rule

Durable report: `research/meta-decision-matrix-live-v780-r2.md`.

## Current decision

Do **not** implement a majority-vote allocator.
Do **not** turn side conflict into a hard gate.
Do **not** map matrix classes to FULL / REDUCED / EXPLORATORY / SKIP yet.
Do **not** alter existing bot thresholds to improve these results.

## Highest-priority next work — v7.80 R3

Evaluate the same matrix inside predeclared **executable opportunity universes** rather than across every sampled 4h candidate:

1. `BASELINE_READY` — source signal is READY.
2. `ANY_SUPPORT` — at least one model says TRADE/CAUTION.
3. `REGIME_ONLY` — Baseline not READY while Regime is supportive.

Within each universe, compare without tuning:
- Shadow supportive vs blocking
- Challenger TRADE vs CAUTION/SKIP
- Regime direction agreement vs side conflict
- 3-support vs 4-support

Use chronological folds and require stability across folds/windows. If no repeatable positive or materially risk-improving conditional edge exists, stop the voting/decision-matrix route rather than rescue it with thresholds.

## Later architecture if R3 validates

Only after repeatable evidence:
- Shadow Meta Allocator ledger with FULL / REDUCED / EXPLORATORY / SKIP
- Regime V2 side-specific rescoring before final allocator integration
- later cluster/correlation risk overlay for portfolio concentration

## Method rules that remain mandatory

1. Baseline 6.2 stays frozen.
2. No Paper/live execution changes during research.
3. Training strictly predates test data where learning/calibration occurs.
4. Full configured outcome horizon required.
5. Portfolio gates excluded from signal-quality attribution unless explicitly testing portfolio path.
6. Frequency, Market Capture, missed winners, avoided losers and opportunity cost remain mandatory for candidate strategies.
7. More evidence does not automatically become more hard gates.
8. Full-window attribution is not OOS proof.
9. Preserve negative results; do not lower thresholds to rescue a model.

## Save-progress rule

Do not leave meaningful MERIDIAN work only in chat. Save every substantial implementation/research checkpoint to GitHub with descriptive commits and preserve negative results as first-class evidence.

## New-chat startup instruction

**“Open `Achi1984/meridian` and read `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md`. Check active research branches/PRs and latest evidence. Keep Baseline 6.2 frozen, keep v7.79 locked, and continue Meta Allocator work from v7.80 R3 executable-universe attribution.”**
