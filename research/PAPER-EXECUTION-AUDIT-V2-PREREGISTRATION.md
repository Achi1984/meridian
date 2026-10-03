# MERIDIAN Paper Execution Audit V2 — Frozen Contract

Status: PREREGISTERED — NO V2 LEDGER RESULT INSPECTED

## Purpose
Audit the current Paper execution/accounting path independently of strategy alpha. This audit may diagnose execution quality; it must not change signals, entries, exits, sizing, risk limits, promotion state, exchange connectivity, or live behavior.

## Lineage and separation
- Base: main at 134371032eb9554e74930caf6f2ff33f37edd5d0.
- V1 evidence in PR #93 is historical audit evidence only and is not treated as a current-runtime result.
- R29 draft PR #103 documents replay corrections/limitations but is not merged and must not be silently imported.
- Current production research and Low-Volatility V2 prospective shadow remain untouched.
- executionImpact=false; autoPromotion=false; liveAuthorized=false.

## Required evidence before a verdict
V2 must use one immutable current Paper ledger export plus immutable market-data inputs sufficient to replay every eligible trade. The implementation must record source identifiers, collection cutoff, hashes/digests, row counts, and completeness. Missing authenticated/private ledger access, missing candles, missing entry/SL/quantity, timestamp ambiguity, or material source gaps cannot be converted into PASS.

## Cohorts
Report separately by ruleset/bot family, asset, LONG/SHORT, exit reason, UTC day/week, and correlated opening bundle. Do not pool incompatible historical rulesets into a single headline metric.

## Execution reconstruction
For every eligible closed trade reconstruct:
1. intended entry, initial stop, targets, quantity and initial risk R;
2. booked opening fee and closing fee exactly once;
3. configured slippage exactly once per fill;
4. realized gross and net PnL and realized R;
5. first post-entry eligible candle;
6. whether SL/TP was touched and whether both were touched in the same bar;
7. gap-through stop fills at the worse candle open for both LONG and SHORT;
8. ledger fill versus conservative candle-replay fill;
9. maximum favorable/adverse excursion when candle coverage permits.

Trades whose entry occurs inside a candle must not use pre-entry extrema from that candle. If sub-candle ordering cannot be established, classify the trade/candle as ambiguous and use the predeclared conservative convention; report ambiguity separately.

## Integrity checks
Fail closed on duplicate trade IDs, impossible timestamps, non-positive entry/quantity, invalid side, stop on the wrong side at entry, non-finite PnL/R, missing close for a closed trade, or inconsistent fee accounting.

## Primary diagnostics
- count and share of stop exits worse than -1.00R, -1.10R and -1.25R net;
- median / p90 / worst stop overrun in R;
- ledger-vs-replay fill delta in bps and R;
- fee/slippage contribution in R;
- same-bar SL/TP ambiguity rate;
- gap-through count and impact;
- same-symbol/same-side re-entry within 15m, 1h and 6h;
- same-direction multi-asset opening bundles within 5m and 15m;
- near-simultaneous closing clusters within 5m and 15m;
- coverage: eligible, replayed, excluded and reason-coded rows.

## Decision
PASS is allowed only if all integrity checks pass, >=95% of otherwise eligible closed trades have complete replay coverage, no unexplained accounting mismatch remains, and the p90 net stop loss is <=1.25R.

If integrity is valid but coverage is <95%, or required private/current evidence is unavailable, decision = PAPER_EXECUTION_V2_INCONCLUSIVE.

If an integrity check fails, an unexplained accounting mismatch remains, or p90 net stop loss exceeds 1.25R, decision = PAPER_EXECUTION_V2_FAIL.

PASS means only: execution/accounting audit gate passed for the audited immutable cohort. It does not prove strategy profitability and does not authorize live trading.

## Anti-tuning
Thresholds and conventions above are frozen before V2 evidence inspection. No excluding losing assets, rulesets, periods, gaps, ambiguous bars, or high-cost trades after results. Any material rule change requires Paper Execution Audit V3 preregistration before re-evaluation.
