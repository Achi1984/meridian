# Perpetual Relative-Value Reversal V3 Data V2 — Broad-Market Benchmark Result

Status: **FOUNDATION PASS — BROAD-MARKET BENCHMARK**  
Execution impact: **false**  
Strategy PnL observed: **false**

Workflow run: **36605521847**  
Head commit: `aaece42a11dd46ff7ffc485f9873c44914382993`  
Artifact: **11050766443**  
Artifact ZIP SHA-256: `91533286cb87dc2d196424c183024ad9f7aacedd87caa74aaa6a2b06f7b96eea`  
Foundation JSON SHA-256: `acf639c41f4952848c9ebf294ee5d71f1c44c9dde91f14597d0f1fe58f62e0cb`

## Frozen result

Decision: **FOUNDATION_PASS_BROAD_MARKET_BENCHMARK**

Benchmark readiness:
- BTC: 32/32 months
- ETH: 32/32 months
- BNB: 32/32 months
- SOL: 32/32 months
- XRP: 32/32 months

Failed benchmark assets: **none**

Unexpected transport errors: **0**

## Strategy-neutral invariants

All remained false:
- market-factor return calculated
- beta calculated
- residual returns calculated
- reversal ranks calculated
- portfolio weights calculated
- strategy PnL calculated
- synthetic backfill used

Inherited Data V1 candidate universe and candidate qualification were unchanged.

## Canonical inherited candidate foundation

Data V1 remains canonical and immutable:
- frozen transfer candidates: 20
- qualified: 19/20
- EOS failed and remains unreplaced

Data V2 changes no candidate result.

## Authorization boundary

This PASS authorizes only a separately frozen V3 strategy protocol.

It does not authorize:
- any market-factor weighting;
- any beta estimator;
- any residual-return signal;
- any PnL;
- Paper shadow;
- live execution.

The next step must preregister the exact benchmark-return construction, robust beta method, formation/skip/hold rules, beta-neutral sizing, costs/funding, development/transfer split and immutable gates before first V3 PnL.
