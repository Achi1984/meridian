# Frozen LowVol V2 forward-Paper integration feasibility — 9 November 2026

## Disposition

**Feasible as a separately scoped derivatives-Paper project; not a small bot
integration and not ready to launch.** The smallest safe packet here is this
source-backed handoff. It adds no code, acquires no data, starts no campaign,
reruns no historical result, and changes no authorization or frozen artifact.
It does not delay or modify #1309, #1311, or #1313.

The frozen V2 result is
`HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY`. It is evidence for the frozen
12-asset USD-M perpetual strategy only. It is not BTC spot evidence and cannot
be transferred to H7 or a simplified/modified strategy. The failed TSMOM V2
discovery and Regime Trend Breakout V1 holdout are out of scope and must not be
revived as shortcuts.

## Frozen strategy and observation contract

| Item | Repository-backed contract |
| --- | --- |
| Identity and frozen result | `research/LOW-VOLATILITY-RANK-WEIGHTED-V2-HOLDOUT-EVIDENCE.md`; ruleset `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`; Holdout decision `HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY`. It permits prospective Paper review only, not Paper deployment, leverage escalation, or capital allocation. |
| Universe and native product | Exactly BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, LTC, BCH, and AVAX. The prospective collector forms symbols as `<asset>USDT`; this is the USDⓈ-M/USDT-margined perpetual product, with USDT—not native USD—as its quote/margin accounting unit. It is neither BTC/EUR spot nor BTC/USD. |
| Signal and warmup | At each Saturday 00:00 UTC anchor, compute `-sqrt(sum(r_i²))` from exactly 672 hourly close-to-close log returns (673 consecutive hourly closes, the preceding 28 days). The implementation's source-row window is from `t - 673h` through `t - 1h`; incomplete, duplicated, or gapped input must not be papered over. |
| Portfolio | Rank all 12 signals using average ranks; center at 6.5 and divide by the sum of absolute centered ranks. All 12 names remain in the cross-section. The target is continuous, dollar-neutral, and gross 1.0; it is not a two-name basket. Degenerate cross-sections fail closed. |
| Holding and accounting | One Saturday-to-Saturday week; open-to-open price return and exact funding events in `(t, t + 7d]`. Funding contribution is `-weight * funding_sum`. Turnover is absolute target-weight change; the historical engine charges the initial opening and a mandatory terminal close. No stop, take-profit, DCA, martingale, regime filter, asset selection, or leverage multiplier is part of the frozen rules. |
| Existing forward evidence | `research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-SHADOW-IMPLEMENTATION.md` and `research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-START-EVIDENCE.md` specify shadow-only monitoring from the predeclared 10 October 2026 boundary and a fixed first-12-week/84-day gate ending 2 January 2027. That is not an operational Paper account or authorization. The shadow implementation/start records differ on the 12h/Saturday versus 36h/Sunday collection contract; `docs/strategy-lab/LOWVOL_RECEIPT_VERIFICATION_20261014.md` leaves the older text reconciliation and independent authority provenance open. Preserve both records; do not silently choose, rewrite, restart, or backfill the evidence. |

The V2 implementation is in
[`research/low_volatility_rank_weighted_v2.py`](../../research/low_volatility_rank_weighted_v2.py);
its frozen feature parent is
[`research/cross_sectional_low_volatility_v1.py`](../../research/cross_sectional_low_volatility_v1.py).
The prospective shadow engine is
[`research/low_volatility_rank_weighted_v2_prospective.py`](../../research/low_volatility_rank_weighted_v2_prospective.py).
The corresponding Python tests are
[`test/test_low_volatility_rank_weighted_v2.py`](../../test/test_low_volatility_rank_weighted_v2.py)
and
[`test/test_low_volatility_rank_weighted_v2_prospective.py`](../../test/test_low_volatility_rank_weighted_v2_prospective.py).

## Collector and evidence gaps

[`scripts/collect-low-volatility-rank-weighted-v2-prospective.py`](../../scripts/collect-low-volatility-rank-weighted-v2-prospective.py)
collects official public Binance Vision monthly/daily USD-M hourly klines and
funding-rate archives for the fixed 12 symbols. It validates hourly continuity,
retains source receipts/hashes, and validates recent funding coverage. It uses
no account, order, balance, or position endpoint. It does **not** supply
execution-time bid/ask quotes, depth, simulated fills, or margin/account
valuations. Thus it is a useful source collector and shadow input, not a Paper
execution adapter.

The existing open #1083 packet specifically records that later scheduled
observations failed before ledger persistence; its fixture work exercises
collector planning/loading and the funding branch, but does not fix upstream
archive 404s or restore missed prospective observations. Do not duplicate its
fixture work, alter the collector schedule/window, or treat a successful source
probe as a completed outcome. The separate timing/provenance issue above also
remains a prerequisite for relying on that forward ledger.

## Reuse boundary: what exists and what does not

| Existing module | Reusable part | Why it is not the V2 Paper account |
| --- | --- | --- |
| `research/low_volatility_rank_weighted_v2.py` and its V1 parent | Frozen feature, rank weights, funding, turnover, and research cost calculations. | Historical/shadow evaluator, not an account ledger or fill simulator. Keep frozen source blobs and outputs unchanged. |
| `scripts/collect-low-volatility-rank-weighted-v2-prospective.py` | Public archive parsing, continuity checks, funding rows, and hashed receipts. | No real-time executable quotes, depth, fills, margin, or account state. |
| `paper-position-accounting.js` | A small generic long/short mark-to-market calculation. | Number-based single-position helper; no 12-leg target portfolio, exchange contract rules, funding ledger, margin, or durable replay. |
| `scripts/spot-paper-pilot/core.mjs` and `scripts/spot-paper-pilot/journal.mjs` | Reference patterns for quote validation, adverse-side spot fills, bounded event journaling, readback, and restart checks. | Bound to one BTC/EUR Kraken spot strategy and its spot/cost/position model; no shorts, futures funding, or portfolio margin. Do not reuse its fee constants or journal schema as V2's. |
| `scripts/paper-capital-challenge/{policy,guard,history-store}.mjs` | Reference for exact-currency validation, fail-closed replay, and checkpoint/tip durability design. | A disabled BTC/USD spot challenge, not the USDT-margined 12-perpetual account. Its store persists guard observations only and has a 256-observation limit; it is not a trading ledger or drop-in derivative persistence layer. |

The active work is intentionally orthogonal: #1309 is paired-paper horizon/
fee-scenario evidence; #1311 is a BTC/EUR 5-minute trend challenger; #1313 is
an isolated BTC/USD spot ledger/guard bridge. None implements the V2 product,
universe, funding, or account. Do not modify their files or copy their
spot-specific fee assumptions into this integration.

## Minimum technical scope and relative effort

1. **Small, isolated target-weight adapter — S, optional and independently
   reviewable.** A pure function may wrap the frozen V1 feature and V2 rank
   weighting without modifying either frozen engine:

   ```text
   computeLowVolV2Targets({ decisionAt, hourlyByAsset })
     -> { ruleset, decisionAt, targets: [{ asset, weight }], grossExposure, netExposure }
   ```

   `decisionAt` must be a Saturday 00:00 UTC anchor. `hourlyByAsset` must have
   exactly the 12 frozen assets and exactly 673 ordered, unique, fully closed,
   contiguous hourly source rows per asset, ending at `decisionAt - 1h`. The
   adapter returns all 12 signed weights only when gross is 1 and net is 0
   within the frozen tolerance; missing/extra assets, stale or open bars,
   duplicates, gaps, non-finite prices, bad anchor, and degenerate ranks fail
   closed. It does not consume forward returns/funding, produce orders, choose
   fills/costs, persist state, or authorize execution.

   Focused tests for that adapter would compare its weights against the frozen
   engine on deterministic fixtures, verify the full-universe/gross/net and tie
   invariants, and reject each invalid-input case above. These tests are not
   added here: an isolated target calculator would not itself connect a bot or
   satisfy Paper accounting/readiness.

2. **Perpetual market/execution model — M/L.** A separate adapter needs fresh,
   timestamped public data for all 12 native USDT perpetuals; frozen closed
   hourly signal bars; executable bid/ask (and preferably depth) for each
   simulated rebalance; funding settlements and current interval/contract
   metadata; and a declared mark/valuation source. It must model both long and
   short fills, partial/rejected/stale legs, bid/ask crossing, explicit adverse
   slippage, funding cash flows, and exposure/margin treatment, with no network
   order or account-mutation path. A funding-only archive and candle open do not
   establish executable fills.

3. **Costs — M.** The frozen research engine uses 10 bps baseline and 20 bps
   stress **one-way per unit of turnover**. Those are historical model
   assumptions, not verified account fees or a derivative fee schedule.
   Separately preregister explicit public venue taker-fee assumptions (account
   tier unknown), bid/ask execution, and adverse slippage; report each
   separately and avoid charging spread/slippage twice. Do not copy the BTC/EUR
   20-bps spot fee or BTC/USD challenge assumptions as perpetual fees.

4. **Durable account and deterministic replay — L.** Persist versioned campaign,
   strategy/config and source identities; ordered rebalance decisions; target
   weights; quote/mark and funding receipts; each simulated fill; cash and
   per-contract positions; fee/slippage/funding accruals; equity/margin
   valuations; and terminal/open-position state. Exact retries must be
   idempotent and conflicting IDs, chronology violations, missing legs,
   stale sources, and unresolved commits must fail closed. Restart must replay
   the complete journal and verify an expected tip retained independently of
   the journal, with atomic write/readback and an explicit recovery operator
   path. Existing spot/guard stores are design references only, not an account
   implementation.

5. **Paper host/report and review — M/L.** Add only after the above contracts:
   isolated identity and disabled-by-default host wiring; append-only dated
   receipts; activity, exposure, turnover, fees, funding, slippage, gross/net,
   equity/drawdown, data-gap, and restart reporting; and a separately reviewed
   admission. No real orders, live credentials, or auto-promotion.

## Activity and acceptance window

Use the strategy's weekly Saturday cadence, not a faster signal or artificial
order generation. A reasonable *new Paper* acceptance window is 12 consecutive,
fully completed Saturday-to-Saturday observations (84 days), matching the
existing preregistered weekly unit—not a claim that the current shadow ledger
is valid or complete. Freeze a new Paper start only after separate authorization;
do not inherit a missed shadow cutoff or call backfilled data prospective.

Record, without a forced minimum number of fills: eligible weekly decisions,
actual target changes, submitted simulated legs, completed/partial/rejected
legs, position-side transitions, long/short exposure-time by asset, gross/net
exposure, turnover, costs/funding, and skipped weeks with reasons. A week with
no target change is a valid observation, not a reason to manufacture trades.
Distinguish insufficient source/operational coverage from performance failure.
Do not apply the BTC/EUR challenger’s 24-hour round-trip threshold to this
weekly multi-asset strategy.

## Recommendation

Publish this as the single bounded feasibility/handoff packet. Do not code an
account connector or launch a Paper campaign in this change. If the owner wants
an incremental implementation next, review and test only the optional pure
target adapter first; treat the full Paper bot as a separate, explicitly
authorized project after resolving the collector/evidence timing and
provenance questions and specifying the derivative account/cost/recovery
contract. The frozen V2 result remains research evidence, not a launch decision.
