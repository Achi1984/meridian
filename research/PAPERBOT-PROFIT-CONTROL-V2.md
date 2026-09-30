# MERIDIAN v10 r90 — Paper Profit Research Control V2 · Stage A

Status: **FROZEN RESEARCH CONTROL / STAGE A**
Base terminal: **10.0-r89**
Execution impact: **false**
Paper-bot parameter changes: **false**
Live/Pionex/OKX mutation: **forbidden**
Auto-promotion: **forbidden**

## Objective

Maximize out-of-sample Paper research profit **net of fees, slippage and strategy costs**, subject to predeclared risk, drawdown, concentration, breadth and stability gates.

Stage A does not authorize candidate backtests, parameter tuning, Paper promotion or live execution. It freezes the control plane and evidence separation before new result inspection.

## Evidence separation

The following evidence lanes must never be collapsed into one leaderboard:

- **RUNTIME / FORWARD** — current deployed Paper telemetry captured from the read-only observer.
- **HISTORICAL / DISCOVERY** — candidate development evidence.
- **HISTORICAL / HOLDOUT** — untouched validation evidence.
- **DATA QUALITY** — source/provenance gates such as Data V1.3; no signal/PnL inference.

A runtime snapshot is evidence of current state, not proof of strategy superiority.

## Frozen candidate families

Candidate families allowed for the next preregistration step:

1. Volatility-managed time-series momentum.
2. Regime-gated trend / breakout.
3. Delta-neutral funding carry baseline.
4. Range/grid only when a separately validated range regime is present.

Explicitly excluded as the default profit-maximization path:

- uncapped martingale;
- loss-chasing DCA;
- leverage escalation after losses;
- any rescue of previously failed candidates by relaxing observed-result gates.

## Anti-overfitting contract

Before any new candidate result is inspected:

- discovery and holdout windows must be fixed;
- costs/slippage model must be fixed;
- candidate parameter search space must be fixed;
- max drawdown gate must be fixed;
- concentration gate must be fixed;
- minimum breadth/sample gate must be fixed;
- promotion rule must be fixed.

No threshold may be relaxed after seeing candidate or holdout results. No single asset/window may authorize promotion.

## Stage A required evidence

1. Capture a fresh deployed Paper observer snapshot using the existing read-only observer contract.
2. Verify: publicReadOnly=true, executionImpact=false, paperTrading=true, liveTrading=false, fresh generatedAt.
3. Preserve lifecycle/sample context for every reported lineage.
4. Keep historical Profit Special Agent results immutable.
5. Mark the legacy v8 WATCH/WATCH+ scorer as deprecated/non-authoritative.
6. Keep Data V1.3 as a separate strategy-neutral dependency; it must not block unrelated runtime capture.

## Decision boundary requiring user approval

The next stage must not begin result evaluation until the **numeric** research acceptance gates are explicitly approved and committed:

- maximum allowed drawdown;
- maximum concentration;
- minimum sample/breadth requirement;
- cost/slippage assumptions if changed from an already-frozen candidate;
- any leverage cap change from existing research limits.

These are governance/risk decisions, not implementation details.

## Stage A completion decision

Stage A passes only when:

- the control document is merged from current main;
- legacy scorer deprecation is present without behavior change;
- the r90 observer capture tool is reproducible and read-only;
- Release Safety is green;
- no Paper/live trading parameter or execution path changed.

PASS label:

`PAPER_PROFIT_CONTROL_V2_STAGE_A_PASS_NUMERIC_GATES_REQUIRED`

No PASS label authorizes Paper or live promotion.
