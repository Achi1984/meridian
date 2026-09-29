# Quarter-Hour Boundary Imbalance — Individual-Trades quoteQty Diagnostic V1

Status: **DIAGNOSTIC ONLY — NO DATA GATE AUTHORIZATION**  
Execution impact: **false**  
Signal / return / position / PnL calculations: **forbidden**

## Trigger

Frozen Data V1.1 PR #343 passed parser-invariant tests but both real-data canaries failed the predeclared invariant `quoteQty ~= price * qty`.

Observed fail-closed examples:

- BTCUSDT / 2025-01 / trade 5794628446: price `94850.0`, qty `138.855`, source quoteQty `1.3170396`, while price*qty is approximately `13,170,396.75`.
- SOLUSDT / 2025-07 / trade 2483570582: price `198.97`, qty `64467.85`, source quoteQty `1.2827168`, while price*qty is approximately `12,827,168.1145`.

The discrepancy is near a factor of 10,000,000 in both examples. That observation is **not** sufficient to redefine source semantics or relax Data V1.1.

## Purpose

Independently determine whether the official monthly USD-M `trades` archives have a systematic quoteQty scaling/representation issue and which quantity reconciles with official 1-minute kline quote volume.

For exactly the two frozen canary months, the diagnostic:

- verifies official archive CHECKSUMs;
- scans all individual trades;
- validates monotone timestamps and strictly increasing trade IDs;
- validates `isBuyerMaker` syntax but never converts it into directional order flow;
- counts literal `quoteQty ~= price*qty` matches;
- counts matches after multiplying source quoteQty by exactly `1e7`;
- records a rounded-log10 scale histogram and bounded mismatch examples;
- sums base qty, source quoteQty, derived price*qty and source quoteQty*1e7;
- independently scans official 1m klines;
- compares row count, base volume and each quote-notional interpretation to the kline totals.

## Interpretation rule

This diagnostic cannot turn Data V1.1 green.

After results are frozen:

- if source quoteQty is demonstrably mis-scaled while `price*qty` reconciles with kline quote volume and trade row/base-volume completeness also reconciles, any revised rule must be introduced only in a **separately versioned successor protocol frozen before new canaries**;
- if neither interpretation reconciles, the individual-trades source remains unsuitable for the intended completeness gate;
- no tolerance may be widened merely because a canary failed.

No directional imbalance, forward return, signal relationship, position, strategy PnL, Paper promotion or live action is authorized.
