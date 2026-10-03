# Regime-Gated Trend / Breakout V1 — Holdout Implementation Contract

Status: **IMPLEMENTED FOR REVIEW — HOLDOUT RUN BLOCKED**  
Discovery state: **PASS / FROZEN IN #462**  
Execution impact: **false**  
Paper/live authorization: **false**

## Purpose

Evaluate the already frozen 2025-09-21 through 2026-09-30 Holdout without changing the Discovery implementation or any strategy parameter.

The frozen Discovery evaluator and all Stage-B contracts remain byte-locked by Frozen Research Guard. This Holdout adapter imports only their public deterministic helpers and does not modify them.

## Mandatory provenance gates

Before Holdout PnL may be emitted, the runner must prove:

1. the exact source JSON SHA-256 equals `08fb30cd3c9028920637c71d86035a723be2fdc63ee25607b842dc79211cc69b`;
2. the frozen Discovery result decision is `REGIME_TREND_BREAKOUT_V1_DISCOVERY_PASS_HOLDOUT_REQUIRED`;
3. the frozen Discovery result contains `holdout:null`;
4. the 70/30 split boundaries reproduce exactly;
5. a fresh Discovery replay reproduces every frozen gate metric within deterministic floating-point tolerance;
6. the replayed Discovery gate still passes.

Any mismatch blocks Holdout evaluation.

## Exact source package

The Holdout workflow must reuse source artifact **11266308720** from Discovery workflow run **37102449505** rather than collect new market history.

Artifact digest:
`sha256:51e84ed6eb02fd8ebbb49351d5c4e1ad59555b69f571f807a6d021f6f0473b06`

The extracted source JSON is checked again against the frozen inner SHA-256 before evaluation.

## Frozen Holdout

- start: 2025-09-21T00:00:00Z
- end: 2026-09-30T00:00:00Z
- 375 common timestamps before indicator/evaluation filtering
- identical ADX/SMA/breakout/sizing/cost mechanics
- 8 bps baseline
- 16 bps stress
- identical Stage-B numeric gate

Possible decisions:
- `REGIME_TREND_BREAKOUT_V1_HOLDOUT_FAIL`
- `REGIME_TREND_BREAKOUT_V1_HOLDOUT_PASS_PAPER_SHADOW_REQUIRED`

A Holdout pass authorizes only a later Paper-shadow/forward-evidence design. It does not enable live execution or automatically change any Paper bot.

## PR isolation

Pull-request CI runs synthetic/parity invariants only. It must not download source artifact 11266308720 or evaluate Holdout PnL.

A later documentation-only authorization commit on `research/regime-trend-breakout-v1-holdout-run` is required after exact-head CI and review.
