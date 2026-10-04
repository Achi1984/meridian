# PAPER EDGE V1 — DISCOVERY RUN CONTRACT

Status: **FROZEN BEFORE AUTHORIZED RESULT INSPECTION**  
Ruleset: `PAPER-EDGE-V1`  
Execution impact: `false`  
Stage: `DISCOVERY` only

This contract freezes the final orchestration and correctness boundaries for the first authorized Discovery decision run. Superseded workflow runs may have executed while pre-result defects were still being audited; their PnL is not inspected, cited, or used for any decision.

## Immutable source lock

The authorized Discovery run may consume only the validated source package from:

- source workflow run: `37231163461`
- artifact: `11313901895` / `paper-edge-v1-source`
- source-producing main: `000e6864a0aabdb5053a5988a5ccc46cee2b9e0b`
- artifact ZIP digest: `sha256:8113b45cf2cebc957416e2ef69a3bd1fc510a41441591fbec0d7b47c49cca91d`
- canonical source receipt: `d05b6c2916900ffac602c11166376e33a2f606e70967d0ecc988a1201df8ad08`

The runner recomputes the current source validation/receipt and fails closed unless the canonical receipt matches this exact lock. Discovery does not recollect or refresh market history.

## Frozen split

The locked common 4h timeline contains 12,594 timestamps:

- Discovery: 7,556 timestamps, from `1609459200000` through `1718251200000`
- Validation: 2,519 timestamps, starting `1718265600000`, locked
- Holdout: 2,519 timestamps, starting `1754539200000`, locked

Any source or split mismatch fails closed. Validation and Holdout values are not passed to the Discovery PnL simulation.

## Pre-result correctness corrections

Before any authorized Discovery result is inspected, the following defects/boundaries are fixed:

1. Derived Daily fields, including `regime`, survive context lookup.
2. Initial-stop ATR14 is taken from the completed trigger bar. The not-yet-completed entry bar can never provide ATR for its own entry.
3. A setup is invalidated if its Daily regime no longer matches its side before trigger; a scheduled next-open entry is cancelled if the regime no longer matches at entry.
4. Aggregate open risk is remaining downside-to-stop risk only; partial exits reduce it and break-even/profit-locked stops do not consume loss-risk budget.
5. Authoritative funding coverage fails closed on any internal gap greater than eight hours plus a 1-second timestamp-jitter allowance. The locked source was audited pre-result: the maximum observed excess over eight hours is only 47 ms across BTC/ETH/SOL.
6. A funding timestamp at a 4h bar open applies only to a position already open before that timestamp and still present after open-time exits. A new entry at the same timestamp is excluded by the strict-after-entry rule.
7. Baseline and stress ending cash must reconcile to initial equity plus their respective closed-trade net PnL; trade IDs must be unique and all entry/final-exit times must remain inside Discovery.

These are implementation correctness fixes, not threshold tuning.

## Deterministic orchestration

- Starting research equity is USD 100,000.
- Same-timestamp entries are considered in frozen universe order BTCUSDT, ETHUSDT, SOLUSDT using one pre-entry marked-equity snapshot.
- One active pullback setup per asset is allowed. After an untriggered three-bar window expires, search resumes on the following completed bar.
- Existing opposite-regime exits and gap stops occur at bar open before new entries.
- New entries execute at the next completed 4h bar open after a valid trigger.
- Gap-through target fills already reachable at the open are processed at the frozen target price before funding.
- Funding is then booked for qualifying authoritative timestamps before non-gap intrabar high/low exits in that bar.
- Intrabar ambiguity remains STOP-first.
- TP1/TP2 and the 2 ATR trail remain exactly preregistered; trailing changes apply only after completed-bar processing.
- Any residual position is force-closed at the final Discovery bar close with normal costs so Validation prices cannot complete a Discovery trade.

## Costs, statistics and gates

Baseline costs remain 5 bps fee + 3 bps adverse slippage per executed fill side. Stress remains 8 bps + 8 bps on the identical frozen trade path and quantities.

Trade net PnL, Profit Factor, expectancy R, marked-to-market drawdown, five chronological windows, asset/side breadth and positive-PnL concentration use the frozen preregistration and accounting contract without threshold changes.

The only authorized outcomes are `EDGE_V1_DISCOVERY_FAIL` or `EDGE_V1_DISCOVERY_PASS_VALIDATION_REQUIRED`. Neither outcome enables Paper promotion, Holdout, live execution or Pionex activity.

## Authorization

Merging implementation code does not execute the decision run. The real decision run requires a dedicated branch `research/paper-edge-v1-discovery-run` created from the final reviewed main plus `PAPER-EDGE-V1-DISCOVERY-RUN-AUTHORIZATION.md` containing the exact locked source identifiers. This separates implementation review from result inspection.
