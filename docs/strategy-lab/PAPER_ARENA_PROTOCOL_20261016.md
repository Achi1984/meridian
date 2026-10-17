# Paper Arena — isolated diagnostic protocol, 16 October 2026

## Scope and authorization

The owner requested on **2026-10-16 at 22:35:21 Europe/Vienna**: “Bring die Strategien in insere paperbotarena und bewise deren stragien. Nutze deine Agents”. This protocol implements that request as an isolated offline **PAPER_SIMULATION**, with agent review. Virtual fills are accounting events in a diagnostic simulation; they are not runtime paper orders, a connected trading account, publisher activation or live orders.

No credentials, publisher, workflow, runtime order gate, frozen research reference or CV2 authorization flag is changed. The source campaign remains an inert historical draft. This protocol grants no lifecycle promotion, accepted research result or live authority.

## Frozen experimental cells

All cells use the fixed universe **BTC, ETH, SOL, XRP, HBAR, LINK, AVAX, SUI**. The original lane is quoted in USDT, with **10,000 USDT nominal** per independent account. The pre-results source amendment below additionally declares a separate USD lane, with **10,000 USD nominal** per independent account. Each lane is spot-only and unlevered (1×). Quote currency is explicit throughout all outputs; neither lane is a EUR balance, an FX conversion or a claim that USD equals USDT. Accounts must never be combined into one deployable portfolio or counted as additional evidence through duplication. This fixed current universe has unresolved survivorship bias; the diagnostic replay does not establish a historical point-in-time investable universe.

| Cell | Rules |
|---|---|
| H1-B | Eight fixed equal sleeves, new entries target one eighth of post-cost account equity at that entry decision; existing holdings retain their quantities. If drifted incumbents leave insufficient cash, scale new entries down proportionally to available cash; never borrow or sell an incumbent solely to restore a sleeve weight. A completed daily close must be strictly above its 200-close SMA and its trailing 90-day close return must be positive. Eligible sleeves are long; unavailable or ineligible sleeves stay cash. Signals execute no earlier than the following daily open. A completed close at or below SMA200 exits at the following open. |
| H1-E | H1-B with one additional entry condition: the completed close's distance above SMA200 (`close / SMA200 - 1`) must exceed the frozen baseline round-trip buffer `0.0016` (16 basis points). Positive 90-day momentum remains separately required. No other signal, exit or sizing change. |
| H7-B | At each Saturday 00:00 UTC decision, using only bars closed by that boundary, select up to three eligible assets with the lowest trailing 30-return volatility. Eligibility is completed close strictly above SMA200. Allocate 25% of account equity to each selected asset, leaving at least 25% cash at that decision. Daily close at or below SMA200 exits at the following open. |
| H7-R | H7-B with rank retention: an eligible incumbent ranked fourth can remain; replace an incumbent ranked fifth or worse using the best unheld eligible asset. Never exceed three holdings. No other signal, exit or sizing change. |
| H9 | **BLOCKED_DATA**: dated-futures basis convergence is visible as a blocked research family. No virtual fills or substituted perpetual-funding results. |

Trailing 90-day returns require 91 closes. Thirty-return volatility requires 31 closes; compute the population standard deviation of the 30 completed close-to-close log returns. SMA200 requires 200 completed closes. Use deterministic symbol-order tie-breaking. Rank retention does not waive daily eligibility exits. The 25% holding and minimum cash constraints apply at allocation decisions; subsequent mark-to-market drift is explicitly permitted and displayed, rather than falsely represented as a continuous portfolio cap.

There are **four new experimental implementation cells**, including both baselines and both changes. Every cell and subsequent manual variation must remain visible in the trial ledger. Historical cumulative usage, authorized remaining budget and complete prior variant coverage remain **UNKNOWN_UNRECONCILED**. Four new cells do not establish capacity under the old campaign ceiling.

## Costs and accounting

Baseline transaction cost is **8 basis points per fill**; stress is **16 basis points per fill**, for both purchases and sales, including terminal liquidation where performed. These are declared diagnostic assumptions, **not verified venue fees, spread, slippage or executable market-impact evidence**. H1-E retains its frozen baseline entry buffer under both cost scenarios: stress changes charged costs, not its strategy rule. The buffer is a design filter, not evidence that 90-day return or SMA distance forecasts recoverable transaction costs.

Track cash, base-asset quantities, marked equity, individual virtual fills and all charged costs. Use full-account daily-close equity for drawdown, including unrealized PnL. This daily-close metric does not capture an intraday or open-to-close trough. Cash sleeves earn zero assumed yield. No leverage multiplier, borrowing, short exposure, staking yield, funding credit or FX gain is inferred. Report any terminal liquidation separately from strategy-directed exits. Never fabricate an executable price from a missing candle or value an unavailable holding at zero.

## Data, freeze and causality

Inputs are caller-supplied offline UTC daily candles, with at most **2,500 bars per asset**, for all eight symbols on a full common daily calendar. Require explicit open and close times, positive finite OHLC prices with consistent bounds, and unique, strictly increasing timestamps. Reject malformed, missing or asynchronous rows instead of silently dropping, sorting, interpolating or forward-filling them. Require adequate warmup before any signal.

Before replay, record the exact rules/source version and hashes, source receipts, candle dataset hashes, ingestion/as-known timestamps where available, supplied interval, and execution assumptions. Receipts identify provenance; they do not independently certify historical availability or authenticity. Acquisition is separate from this offline simulator. No embedded network lookup or implicit data substitution is allowed.

A signal may use only completed bars available by its decision boundary; its virtual fill uses a later executable bar open. An open price used for execution must not also leak that bar's high, low or close into the earlier signal. Future candle changes must not alter earlier decisions or fills.

Every historical replay in this package is **DIAGNOSTIC_ONLY**, including previously unseen-to-the-operator files whose wider access history is unverified. Resplitting or renaming inspected history cannot make it a fresh holdout. Synthetic fixtures are engineering evidence only, never market performance.

## Payoff-policy compatibility

**policyCompatibility: UNRESOLVED.** The original campaign, its README and `TRADE_PLAN_CRV.md` require planned net CRV of at least 3:1. The later evidence review states that the universal framing was superseded by a strategy-specific payoff policy; newer #823 design work also needs reconciliation. The evidence contract recognizes portfolio-level no-stop models but leaves them research-only.

These experimental spot-allocation cells have no independently justified finite stop-and-target payoff plan. They therefore cannot be advertised as CRV-compliant, risk-bounded by a stop, accepted Paper readiness or an implementation of the frozen LowVol perpetual reference. This protocol neither silently overrides the old policy nor invents stops or distant targets to qualify. Isolated diagnostic virtual fills can be evaluated under the owner's current request while runtime paper activation and accepted policy compatibility remain separate unresolved steps.

## Measurement and conclusions

Before prospective observation, retain each cell's version and predeclare its observation window, data-source availability, benchmarks, review method and decision criteria. This protocol defines no financial success threshold. Until a separately frozen prospective window and independent review are completed, the conclusion is **INSUFFICIENT_FORWARD_EVIDENCE**, regardless of a favorable historical replay.

Report baseline and stress net return, marked-equity drawdown, net PnL, turnover, costs, sale-slice count (partial rebalances are not independent round-trip trades), allocation/weekly observation count, cash exposure, asset/time/regime contributions and benchmark-relative results. Include dependence-aware uncertainty and selection-risk treatment before making any validation claim. A profitable all-win sale-slice sample has an undefined profit factor with zero loss denominator; no-trade expectancy, win rate and profit factor are undefined, never PF 99 or fabricated zeros. Distinguish an engineering pass, data rejection, diagnostic outcome, operational blocker and genuine strategy failure.

H1-E versus H1-B and H7-R versus H7-B are predeclared comparisons, not post-hoc winners. Include losing, inactive and blocked cells in the report. No automatic optimization, dropped losing assets, relaxed criteria, winner promotion or live activation follows a result.

## Pre-results source-feasibility amendment

Before obtaining or inspecting any market-price outcomes for these cells, the original Binance USDT acquisition was blocked (including HTTP 451). Preserve that failed acquisition record; it is not a strategy result and must not be retried through an access-control bypass. Official Kraken instrument metadata subsequently showed all eight **USD** pairs available online, whereas the eight-symbol USDT set was unavailable there. This source choice is based on declared instrument availability, not profitable returns, losing assets or outcome optimization.

An explicit optional `--collect-kraken-usd` lane may therefore acquire **400 completed UTC daily bars per asset**, retaining raw response bodies and hashes. Exclude Kraken's current unclosed candle explicitly and record that exclusion. Reject duplicate, unordered, missing, stale, misaligned or partial completed history; do not interpolate or shorten the common window silently. Freeze the canonical input, quote currency, source receipts, engine and protocol hashes before any replay. External price acquisition remains separate from the offline replay.

The USD lane uses the same eight assets, H1/H7 rules, entry buffer and baseline/stress costs of 8/16 basis points per fill. These costs remain unverified assumptions and do not become venue-specific verified fees by changing the source. Start capital is independently **10,000 USD**, with no USDT/USD parity assumption or EUR conversion. Retain source and currency visibly when importing, displaying and exporting results.

USDT and USD source lanes are overlapping diagnostic views, **not independent confirmatory trials** or additional new alpha hypotheses. Replaying the same rules against a different source cannot create fresh Holdout evidence. Record all acquisition and replay attempts without asserting a reconciled historical trial budget. The original frozen LowVol/CV2 references and their flags remain unchanged; payoff-policy compatibility remains **UNRESOLVED**, and no paper-order or live promotion follows.

## Remaining blockers

- Complete trial/budget reconciliation and exact policy compatibility.
- Verified source receipts, as-known data availability and realistic execution costs.
- A prospectively frozen independent observation window, appropriate uncertainty assessment and independent review.
- For H9: dated-contract identity and expiry, settlement terms, synchronized executable spot/futures quotes, both-leg costs and financing, capital lockup, collateral/margin stress and emergency exit behavior. The single-leg linear CRV evaluator does not establish a two-leg payoff model.
- Runtime paper wiring and its operational review, if requested separately; offline simulation alone does not show a running Paper bot or real order activity.

## Observed acquisition limits in this implementation session

The first explicit Binance collector attempt failed before a dataset or replay was
created (`fetch failed` in the Node 20 environment). A read-only HTTP header probe
to the same official public spot endpoint returned HTTP **451**. No mirror or
jurisdiction bypass was used. An independent Kraken public instrument-metadata
query had no HBAR/USDT or SUI/USDT pair, so it cannot supply the fixed eight-asset
USDT dataset without changing the frozen universe or quote-currency assumptions.
No such substitution was performed. These are data-access limitations, not failed
strategy economics. No real-market PnL, Holdout, prospective evidence or return
claim was produced. The Arena accepts a sealed caller-provided snapshot and
recomputes all values, retaining a supplied receipt as **unverified provenance**.
