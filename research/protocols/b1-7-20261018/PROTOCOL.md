# B1-7 frozen protocol R2 — synthetic implementation draft

**Protocol ID:** `MERIDIAN-B1-7-PROTOCOL-R2-20261018`
**Raw protocol.json SHA-256:** `44284c22c22443520043c8450edbc8819b95a9f37ca985cfca05f4f9317ff9eb`
**Status:** source and synthetic tests only; owner execution decision pending
**Input base:** `1c7b6dccd886f57e866c7d359c091b1e72a193ea`
**R1:** `MERIDIAN-B1-7-DESIGN-R1`, response comment `6249442046`, `REVISION_REQUIRED`. Its eight determinism issues are resolved in the authoritative R2 text and encoded here.
**R2:** `MERIDIAN-B1-7-DESIGN-R2`, request comment `6249480669`, response comment `6249482850`: `GREEN_LIGHT` for deterministic SOURCE+SYNTHETIC preparation only. This is not approval for a real-data run, 44-path budget, thresholds, costs, no-stop policy, Paper, Live, or runtime/flag changes.

The machine-readable parameters are in [`protocol.json`](./protocol.json). Its raw-file SHA-256 and the final implementation SHA-256 are recorded in [`EXECUTION_REQUEST.md`](./EXECUTION_REQUEST.md) when frozen. The engine emits the protocol hash and binds it with implementation, input, variant, scenario, and segment identities in deterministic IDs. The implementation hash is caller-supplied identity; the engine does not inspect its own source.

## Scope and authority

`scripts/research/b1-7/engine.mjs` accepts caller-supplied in-memory OHLC arrays. The engine has no network, database, filesystem discovery, CSV loader, CLI, autorun, credential, or trading-adapter interface. No captured price file is read to calculate a feature, return, or PnL in this preparation task. Only the already-recorded normalized-file hashes are copied as provenance. The engine must not be executed against those captured series as a smoke test.

This source packet is **not** authorization to run historical research, to claim a holdout, or to enable Paper/Live trading. All seven authorization flags remain false. A no-stop rule is research-only; trade CRV is explicitly `UNDEFINED_NO_FINITE_STOP` with a null value, not a fabricated stop or a zero CRV.

## Frozen population and timing

The exact ordered universe is XBTUSD, ETHUSD, SOLUSD, XRPUSD, LINKUSD, AVAXUSD, SUIUSD. HBARUSD is omitted solely because of common-history coverage, not performance. The earlier eight-asset acquisition reached only 448 common rows against the 955-row target; this is a coverage failure, not evidence of strategy performance.

Require 955 strictly daily synchronized rows for all seven assets, 2024-02-19 through 2026-09-30. Rows are interval-open UTC timestamps in exact `YYYY-MM-DDT00:00:00Z` form. No coercion, reordering, gap repair, forward-fill, substitution, partial batch, or silent row/variant expansion is allowed. Validate finite positive OHLC, OHLC ranges, finite nonnegative volume, and nonnegative integer trades. Close is used for features; open and close for accounting; high/low, volume, and trades are validation-only/ignored by the model.

| Rows | Date range | Length | Use |
| --- | --- | ---: | --- |
| Warmup | 2024-02-19–2025-04-03 | 410 | Feature history only |
| Development | 2025-04-04–2025-09-30 | 180 | Calibration and frozen controls |
| Diagnostic | 2025-10-01–2026-09-30 | 365 | Historical diagnostic, **not holdout** |

Each scored segment starts independently with USD 10,000 cash and no holdings or pending orders. Causal feature history carries over the segment boundary; holdings and accounting do not. Each segment liquidates independently on its last close. A close at row `t` is only available after that interval; decisions use no later row and fill at a subsequent open.

## Features and fixed variants

All calculations use IEEE-754 binary64, fixed asset order and deterministic row order. Let `b[t]` be the arithmetic mean of the seven simple close returns. For window `n`, `sigma[n,t]` is sample standard deviation of the last `n` values of `b`, using denominator `n-1`, annualized by `sqrt(365)`. `m[n,t]` is the median of the last 365 `sigma` values including current `t`. Exposure is `clip(m/sigma, floor, 1)`. Non-finite values or `sigma <= 1e-12` invalidate the whole batch.

Exactly five variants are scored, in this order:

1. Primary: `n=30`, floor `0.25`.
2. Neighbor: `n=20`, floor `0.25`.
3. Neighbor: `n=45`, floor `0.25`.
4. Neighbor: `n=30`, floor `0.20`.
5. Neighbor: `n=30`, floor `0.35`.

The first valid 45-day median is at close 410 (zero-based index 409, 2025-04-03); it has no warmup slack. Never add variants or replace the primary with a neighbor.

## Decisions, fills, costs and accounting

The initial segment decision uses the previous completed close and is scheduled for the first segment open. Thereafter each Sunday close creates one target-weight instruction for Monday open. Compare raw exposure to the last accepted exposure using exactly `Math.abs(raw-lastAccepted) >= 0.10` in binary64, with no epsilon. The initial target is accepted, and accepted target state updates when the decision is made, not when the delayed fill occurs. Every weekly instruction equalizes seven weights to `acceptedExposure / 7`, even if the target band did not change.

Three fixed scenarios apply to candidate and full-basket paths:

| Scenario | Per-side cost | Delay |
| --- | ---: | --- |
| `base-85bp` | 85 bp | 0 days |
| `stress-160bp` | 160 bp | 0 days |
| `stress-160bp-delay-1d` | 160 bp | 1 day |

The delay scenario uses the same immutable target instruction, one open later; it does not calculate a new signal. Base cost is lead-reported as 80 bp published Kraken Spot Crypto Tier 1 taker reference plus assumed 5 bp friction. The independent R2 reviewer could not fetch or verify the fee page; this is not owner-specific entitlement, historical fee reconstruction, measured spread, or impact. Owner approval of this revised grid remains pending.

The open-price target-weight fill is an idealization, not a claim of pre-submitted share quantities or executable first-print liquidity. Gaps, spreads, impact, liquidity, lot/minimum sizes, leverage, shorts, interest, and funding are not modelled. Units are fractional.

At fill prices `p`, cash `K`, units `q`, target weights `w`, per-side rate `c`, and current value `V=K+sum(q*p)`, solve `E=V-c*sum(abs(w*E-q*p))` by bisection on `[0,V]`, at most 100 iterations, tolerance USD `1e-6`. Set `qNew=w*E/p` and `cashNew=(1-sum(w))*E`. Require finite positive `V`, finite nonnegative weights/units/cash, `sum(w)<=1`, and per-fill conservation `abs(cashNew+sum(qNew*p)+currentFillCost-V)<=1e-6`. The invariant uses the current fill fee, not cumulative historic fees against current `V`. Any accounting failure invalidates and stops the complete batch.

Cancel fills beyond a segment horizon without replacement. At each segment's own final close, liquidate all units at close with sale-side cost; include that terminal fee in the final daily equity and return. Drawdown is sampled on daily closes only, with initial `E0=10,000` included as a peak; it is not intraday drawdown. Emit exactly 180 development or 365 diagnostic close-to-close net returns per completed path. The first includes entry fees; a delayed first day remains cash.

## Controls, 44 paths and screening

Frozen development controls are derived once from the primary 85 bp development path:

- Mean-exposure control: arithmetic average of the primary 85 bp path's held target across all 180 development daily rows, not weekly-only targets or realized drift. The baseline initial target fills on development day one, so this baseline mean has no pre-fill days; zero before first fill applies to delayed paths.
- Risk-exposure control: `min(1, sampleSD(primary daily net returns) / sampleSD(full-basket daily net returns))`, with sample denominator `N-1`. Zero primary deviation maps to exposure zero. Non-finite values or full-basket standard deviation `<=1e-12` yield `INSUFFICIENT_EVIDENCE` and stop before diagnostic paths.

Both controls use fixed exposure and weekly costed equalization, without target band, for all three diagnostic scenarios. Full basket is 100% weekly equal-weight and costed identically; cash is zero-cost. Each output reports per-fill and cumulative cost, turnover, held exposure, concentration, quarterly returns, sampled drawdown and duration, cancellations, and daily path arrays. For each path, report mean daily close-marked realized exposure and mean/maximum absolute target-versus-realized mismatch. Include this mismatch for each diagnostic fixed-control scenario; do not refit or rescale controls on diagnostic rows.

The deterministic manifest has exactly 44 planned paths: 5 variants × 3 scenarios × 2 segments = 30; full basket × 3 scenarios × 2 segments = 6; 2 frozen controls × 3 scenarios × diagnostic only = 6; and cash × 2 segments = 2. Results remain ordered by declared variant/scenario/segment order and fixed group order. Cash has scenario-independent IDs.

Primary screen uses diagnostic 85 bp: net return positive, sampled drawdown at most 25%, return at least both frozen controls, drawdown no worse than either, and at least 20% relative drawdown reduction versus full basket. The primary-vs-control comparisons use diagnostic results only. If full-basket drawdown is `<=1e-12`, return `INSUFFICIENT_EVIDENCE`. Primary net return must also be positive at 160 bp without delay and at 160 bp plus one-day delay. At least 3 of 4 neighbors must have positive diagnostic net return at 85 bp and separately at 160 bp without delay; neighbors are not screened at 160 bp plus delay. Neighbors are sign-robustness checks, not matched-control claims. On proposed real inputs, status is `PASS`, `NO_EDGE`, `INSUFFICIENT_EVIDENCE`, or `INVALID`; PASS means a historical candidate only, never statistical significance, alpha, or holdout evidence. Synthetic fixtures always report `SYNTHETIC_ONLY_NOT_ASSESSED`, never PASS or GREEN.

## Failure and resource policy

Single process; 44 planned paths; at most 60 seconds per path and 30 minutes total; maximum serialized output 1 MiB. No retry, adaptive trial, or silent rerun. Any malformed/missing/duplicate/calendar-invalid data, source identity mismatch, invalid signal/accounting, timeout, output-size breach, or nondeterministic condition invalidates and halts the batch. Preserve completed paths as incomplete evidence, mark unstarted paths, and never rank a partial batch. Historical trial-ledger completeness remains `UNKNOWN`.

Output always carries protocol and implementation identities, canonical input-series hash, path/execution IDs, `NOT_HOLDOUT`, undefined no-stop CRV, explicit statuses, survivorship/source-authenticity/history labels, and seven false authority flags. See [`EXECUTION_REQUEST.md`](./EXECUTION_REQUEST.md) for the separate owner proposal; it grants no permission.
