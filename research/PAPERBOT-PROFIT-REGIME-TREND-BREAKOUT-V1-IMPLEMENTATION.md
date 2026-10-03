# Regime-Gated Trend / Breakout V1 — Deterministic Implementation Contract

Status: **IMPLEMENTED FOR REVIEW — HISTORICAL DISCOVERY RUN BLOCKED**  
Preregistration: `PAPER-PROFIT-REGIME-TREND-BREAKOUT-V1`  
Execution impact: **false**  
Paper/live authorization: **false**

## Purpose

Implement the already-frozen Stage-B regime-gated trend/breakout hypothesis without changing ADX/SMA thresholds, 55/20 channels, universe, volatility sizing, leverage cap, costs, split rule or acceptance gate.

Pull-request CI runs only deterministic synthetic invariants. It must not collect the fixed historical source package or inspect candidate PnL.

A later documentation-only authorization commit on `research/regime-trend-breakout-v1-run` is required before the first historical Discovery run.

## Frozen source contract

- Binance Spot public completed 1D OHLCV.
- Universe: BTC, ETH, SOL, XRP, HBAR, LINK, AVAX, SUI.
- Fixed source window: **2021-08-08T00:00:00Z through 2026-09-30T23:59:59.999Z**.
- Primary endpoint: `api.binance.com/api/v3/klines`.
- Fallback endpoint: `data-api.binance.vision/api/v3/klines`.
- No account/private data.
- No synthetic price history.
- Source rows are packaged once and SHA-256 hashed by the result runner.

The common-timestamp 70/30 split is frozen before any candidate return evaluation. Discovery uses only rows through the frozen Discovery boundary. The full dataset and Holdout return path are not evaluated unless Discovery passes every Stage-B gate.

## Signal implementation

At each completed daily close:

- ADX uses Wilder smoothing with period 14.
- LONG regime requires ADX >=25 and close > SMA(200).
- SHORT regime requires ADX >=25 and close < SMA(200).
- Flat → LONG only when the completed close is above the highest high of the **prior** 55 completed bars.
- Flat → SHORT only when the completed close is below the lowest low of the **prior** 55 completed bars.
- LONG exits when close is below the lowest low of the prior 20 bars or LONG regime eligibility is lost.
- SHORT exits when close is above the highest high of the prior 20 bars or SHORT regime eligibility is lost.
- Exit bars do not reverse directly into the opposite side; a new entry requires a later completed bar.
- Current-bar high/low never enters the channel used for that bar's decision.

## Return / sizing timing

The position held from the prior completed close earns the next close-to-close return. Only after that mark-to-market is the newly completed bar used to choose the next target. This prevents current-close information from earning the return that produced it.

Per active market:

- realized volatility = standard deviation of the prior 60 completed daily log returns, annualized by sqrt(365);
- volatility scale = min(2, 10% / realized annual volatility);
- each active normalized position receives 1/N of the portfolio before its volatility scale;
- therefore total gross research exposure is bounded by 2x;
- no pyramiding, martingale, averaging-down or loss-based leverage escalation.

Turnover cost is charged on absolute target-weight change:
- 8 bps baseline;
- 16 bps mandatory stress;
- identical signals and sizing in both runs.

## Stage-B gate

Discovery and, only if authorized by a full Discovery pass, Holdout independently require:

- >=30 evaluation periods;
- net compounded return >0 at 8 bps;
- Profit Factor >=1.15;
- max drawdown <=20%;
- >=4/5 positive chronological windows;
- >=5/8 positive assets;
- positive-PnL concentration <=35%;
- 16-bps stress compounded return >0;
- provenance confirmed;
- holdout untouched before authorization.

A Discovery pass produces only `REGIME_TREND_BREAKOUT_V1_DISCOVERY_PASS_HOLDOUT_REQUIRED`. It does not authorize Paper or live execution.

## Historical-run authorization

This implementation PR must not run historical candidate PnL.

After exact-head CI and review, the dedicated run branch may add one authorization file naming the exact implementation commit and authorizing only the frozen Discovery evaluation. If Discovery fails, Holdout must remain untouched and the ruleset is frozen as failed. Any redesign requires a new ruleset/preregistration.
