# PAPER EDGE V1 — DISCOVERY RUN CONTRACT

Status: **FROZEN BEFORE FIRST REAL DISCOVERY PNL INSPECTION**  
Ruleset: `PAPER-EDGE-V1`  
Execution impact: `false`  
Stage: `DISCOVERY` only

This contract freezes the final orchestration/accounting conventions required to run the already-preregistered Discovery split. It does not change the hypothesis, universe, timeframe, costs, risk limits, exits, split, or gates.

## Immutable source lock

Discovery may consume only the validated source package produced by:

- Source workflow run: `37231163461`
- Source artifact: `11313901895` / `paper-edge-v1-source`
- Source-producing `main`: `000e6864a0aabdb5053a5988a5ccc46cee2b9e0b`
- Artifact ZIP digest: `sha256:8113b45cf2cebc957416e2ef69a3bd1fc510a41441591fbec0d7b47c49cca91d`
- Canonical source receipt digest: `d05b6c2916900ffac602c11166376e33a2f606e70967d0ecc988a1201df8ad08`

The runner recomputes the canonical source receipt and fails closed on any mismatch. It must not recollect or refresh market data during Discovery.

## Frozen split

The validated common 4h timeline contains 12,594 timestamps:

- Discovery: 7,556 timestamps, `2021-01-01T00:00:00Z` through `2024-06-13T04:00:00Z`
- Validation: 2,519 timestamps, locked
- Holdout: 2,519 timestamps, locked

Only Discovery prices/funding may enter strategy PnL. Validation and Holdout remain inaccessible to strategy evaluation.

## Pre-PnL compliance corrections

The following are correctness fixes found before any real Discovery PnL was inspected:

1. Derived daily regime fields must survive prior-day context lookup. Context lookup may not strip `regime`, EMA, or other derived fields.
2. Initial-stop ATR is the ATR14 of the completed trigger bar. The entry bar is not completed at entry open and therefore cannot supply ATR without look-ahead.
3. The setup's daily regime must remain equal to the setup side through trigger evaluation and at the next-bar-open entry. A regime change invalidates the stale setup/entry.
4. Aggregate open risk is remaining downside-to-stop risk only. Break-even/profit-locked stop distance is not risk, and partial exits reduce aggregate risk by the remaining fraction.

These corrections resolve implementation defects; they do not tune a threshold or rescue an observed result.

## Orchestration conventions

- Starting research equity: USD 100,000. This is a scale normalization only.
- One active pullback setup per asset. After a three-bar trigger window expires, search resumes on the next completed 4h bar; the expiring third bar is not reused as a new pullback bar.
- Same-timestamp entries are considered in frozen universe order: BTCUSDT, ETHUSDT, SOLUSDT, using one pre-entry marked-equity snapshot.
- Entry is the next 4h open after a valid completed trigger bar.
- Open-time opposite-regime exits and gap stops occur before a funding event in that 4h bar.
- A funding event after entry and within a bar is applied before a non-gap intrabar stop/target exit in that same bar. This matches the authoritative funding timestamps near 00/08/16 UTC and removes otherwise unknowable sub-bar ordering.
- Intrabar stop/target exits are time-attributed to that completed 4h bar; the frozen price convention remains stop-first, worse-open gap stop, exact target price for TP1/TP2.
- ATR trailing updates only after completed-bar exit processing and can affect subsequent bars only.
- Any position still open at the end of Discovery is force-closed at the final Discovery bar close with normal exit costs. This prevents Validation leakage and avoids dropping unresolved risk.

## Costs and stress

Baseline and stress costs remain exactly preregistered:

- Baseline: 5 bps fee + 3 bps adverse slippage per executed fill side.
- Stress: 8 bps fee + 8 bps adverse slippage per executed fill side.

Slippage is represented as an explicit adverse cash cost per fill, consistent with the already-frozen `frozenCosts` primitive; raw signal/stop/target prices are not shifted a second time.

Stress PF is computed on the exact same frozen trade path, quantities, and fill notionals as baseline, replacing only the per-fill cost schedule. This isolates the declared transaction-cost stress and cannot change signal selection.

## Accounting and gates

- Funding uses the then-open quantity, frozen entry-price notional, and authoritative rate sign convention.
- Trade net PnL = realized price PnL + funding cash flow − all entry/exit fill costs.
- Expectancy R uses each trade's initial 0.50% risk cash as the denominator.
- Profit factor is calculated from closed-trade net PnL.
- Max drawdown is baseline marked-to-market equity sampled at each completed 4h close.
- The five chronological windows are equal partitions of Discovery timestamps; each closed trade is attributed to the bar containing its final exit.
- Positive-PnL concentration is the largest positive asset contribution divided by total positive asset contribution.
- Accounting must reconcile final flat equity to the sum of closed-trade net PnL. Any mismatch, non-finite value, source mismatch, or open terminal position fails closed.

The preregistered gate is applied unchanged. Discovery output can only be `EDGE_V1_DISCOVERY_FAIL` or `EDGE_V1_DISCOVERY_PASS_VALIDATION_REQUIRED`.

## Isolation

No Discovery result can auto-promote a bot, enable Validation/Holdout, create a Paper position, or touch live/Pionex execution. A separate post-result authorization is required before Validation, and Holdout remains locked until both earlier stages pass.
