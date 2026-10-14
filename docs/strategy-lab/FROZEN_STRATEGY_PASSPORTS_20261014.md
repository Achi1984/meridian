# Frozen strategy passports — 14 October 2026

**Scope:** exact existing rules only; no tuning, rescue, result transfer, or new registration.
**Pinned main:** [`ee7c2c7b6343fbb1564e910341b2b148c1dd94c8`](https://github.com/Achi1984/meridian/commit/ee7c2c7b6343fbb1564e910341b2b148c1dd94c8).
`UNKNOWN` means the inspected source does not define the fact; it is not a default or an approval.

## Passport 1 — LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN

| Field | Frozen source definition / recorded evidence |
|---|---|
| Identity and source | Exact ruleset `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`; canonical engine source blob `87302fdc0c1880a35e1bfd663be8191d5f6be429`; preregistration, implementation, and run lineage are linked in the [evidence review](STRATEGY_EVIDENCE_REVIEW_20261014.md). This is a USD-M perpetual long/short strategy, not campaign H7 spot. |
| Signal | At each Saturday 00:00 UTC anchor, calculate `RV28 = sqrt(sum(r_h²))` over exactly 672 preceding hourly close-to-close log returns for each of 12 fixed assets. `LOWVOL = -RV28`; larger value means lower trailing volatility. No winsorization, standardization, beta adjustment, regime filter, or asset-specific parameter. |
| Timing and portfolio | Ascending average ranks across all 12; center at 6.5; `w_i=(rank_i−6.5)/sum(abs(rank_j−6.5))`. Rebalance at public kline open at the Saturday anchor; hold for one week. Gross exposure 1.0, net 0, long gross +0.5, short gross −0.5; no leverage multiplier. |
| Universe / period | Fixed Binance USD-M perpetuals BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, LTC, BCH, AVAX. Development 48 periods (2025-02-01 through 2026-01-03); Holdout 34 periods (2026-01-03 through 2026-08-29). |
| Costs / accounting | Weekly open-to-open price returns; funding rows in `(t,t+7d]`, contribution `−weight × funding_sum`; turnover is sum of absolute weight changes, including initial open and terminal close. Frozen 10 bps one-way baseline and 20 bps stress per unit of turnover. Official public Binance Vision USD-M 1h klines and fundingRate only. |
| Historical gates and state | Development `DEVELOPMENT_PASS_HOLDOUT_REQUIRED`; Holdout `HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY`. Reports: Holdout 34 periods, +15.0184% compounded, stress +13.8589%, max DD 5.4217%. These are research-period returns, not annualized. Artifact/log boundaries and lack of independent ZIP reproduction are recorded in the evidence review. |
| Failure / kill conditions | Fail closed for missing source/features/prices/funding, incomplete asset coverage, funding gap/coverage failure, degenerate rank denominator, exposure invariant error or frozen-lineage mismatch. No strategy stop-loss, take-profit, liquidation rule, or explicit operational kill-switch is specified: **UNKNOWN / not defined by this ruleset**. |
| Risk, funding, FX, shorting | Shorting is integral: 0.5 gross short perpetual exposure. Funding is modeled from historical rates. Actual margin, collateral, liquidation, venue short limits, borrow/short availability, account-level risk cap, EUR conversion/FX, and funding/fee behavior at deployable size are **UNKNOWN / not verified**. A draft campaign’s generic 10x futures ceiling is not this strategy’s leverage setting or proof of margin feasibility. |
| Prospective status | The separately frozen shadow protocol fixes a 2026-10-10 boundary, first eligible week ending 2026-10-17, first-12-week endpoint 2027-01-02, 12 observations and 84 elapsed days. Run `38125893276` persisted the immutable 2026-10-10 boundary snapshot at evidence commit `b6b72a1`: timely, 0 completed/eligible observations, no integrity failure. Later retries of the same cutoff did not overwrite it. No eligible weekly return is reported as of 14 October; Paper/live remain false. |

**Applicable source documents:** [preregistration](https://github.com/Achi1984/meridian/blob/ee7c2c7b6343fbb1564e910341b2b148c1dd94c8/research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PREREGISTRATION.md), [implementation](https://github.com/Achi1984/meridian/blob/ee7c2c7b6343fbb1564e910341b2b148c1dd94c8/research/LOW-VOLATILITY-RANK-WEIGHTED-V2-IMPLEMENTATION.md), [prospective implementation](https://github.com/Achi1984/meridian/blob/ee7c2c7b6343fbb1564e910341b2b148c1dd94c8/research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-SHADOW-IMPLEMENTATION.md), [prospective start evidence](https://github.com/Achi1984/meridian/blob/ee7c2c7b6343fbb1564e910341b2b148c1dd94c8/research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-START-EVIDENCE.md).

## Passport 2 — CROSS-VENUE-FUNDING-SPREAD-V1-FROZEN

| Field | Frozen source definition / recorded evidence |
|---|---|
| Identity and source | Exact ruleset `CROSS-VENUE-FUNDING-SPREAD-V1-FROZEN`; source JS blob `774fc9cfbd5fd122fefd587d800231b0dfa99d9f`; frozen protocol and result are separate from V2. |
| Signal | No adaptive entry signal: static monthly funding-spread exposure, fixed direction LONG Binance USD-M perpetual / SHORT Hyperliquid perpetual. There is no forecast or timing filter. |
| Timing and sizing | For each eligible asset-month, $10,000 notional per leg; $20,000 conservative capital denominator; entry at first valid 8h close and exit at final valid 8h close of the month; fixed base quantity from each leg’s entry mark. No intramonth rotation, stop or leverage credit. |
| Universe / sample | Discovery BTC/ETH/SOL; requested interval 2023-01-01 through 2026-09-01, completed months only. Later disjoint transfer Holdout DOGE/XRP/LINK/AVAX on the same date interval. Valid/rejected counts and outcomes are in the [evidence review](STRATEGY_EVIDENCE_REVIEW_20261014.md). |
| Costs / accounting | Realized funding: Hyperliquid short `+$10,000 × funding-rate sum`; Binance long `−$10,000 × funding-rate sum`. Basis is marked from fixed entry quantity at each venue. Per fill 5 bps fee + 3 bps slippage; four fills/cycle; stress adds 5 bps/fill. No rebates, collateral yield or funding forecast. |
| Gate / outcome | Discovery passed on BTC/ETH/SOL; the later transfer Holdout failed because XRP was negative under the frozen all-assets-positive gate. Latest status: `HOLDOUT_FAIL_RESEARCH_REDESIGN`; no Paper/live promotion. |
| Failure / kill conditions | Require a valid entry/exit mark, minimum 25-day cycle, funding observation counts and gap limits, mark gap/boundary limits, monotonic unique timestamps and no synthetic reconstruction. Any invalid cycle is rejected. Stops, liquidation/venue outage response and active risk kill conditions: **UNKNOWN / not defined**. |
| Risk, FX, feasibility | Both venues and perpetual shorts are required simultaneously; basis risk is included in historical PnL. Real margin, liquidation, capital/netting between venues, EUR translation, collateral transfers, fees at account tier, market impact and executable depth: **UNKNOWN / not established**. |

**Do not promote V1 on its Discovery table alone.** The disjoint transfer result is the later decision and must remain attached to the same immutable V1 ruleset.

## Passport 3 — CROSS-VENUE-FUNDING-SPREAD-V2-FROZEN

| Field | Frozen source definition / recorded evidence |
|---|---|
| Identity and source | Exact ruleset `CROSS-VENUE-FUNDING-SPREAD-V2-FROZEN`; evaluator source JS blob `25f5210e886427ac06febf05540655719eb3894d`; V2 is a separate validation family with V1 as parent, not a continuation that erases V1’s transfer failure. |
| Signal / timing / sizing | Same static LONG Binance USD-M perpetual / SHORT Hyperliquid perpetual direction and monthly holding mechanics as V1. $10,000 notional per leg, $20,000 denominator per asset-month; first valid monthly 8h marks in / last valid marks out; fixed quantity; no leverage credit, no stop, no rotation or funding forecast. |
| Universe / sample | BNB, ADA, DOT, LTC, BCH, TRX, ETC; 2024-09-01 through 2026-09-01. 161 valid and 14 rejected asset-month cycles; 23 valid cycles per asset. |
| Costs / accounting | Same fixed-notional realized funding and basis accounting as V1. Fee 5 bps + slippage 3 bps/fill, four fills, +5 bps/fill stress; no rebate/collateral yield. |
| Gate / outcome | `VALIDATION_FAIL_RESEARCH_REDESIGN`: −0.2409% compounded return, PF 0.8659, max DD 1.0597%, stress −2.5105%, 2/5 positive windows; ADA/DOT/ETC net-negative. Workflow run `36563826168` completed successfully as a computation; its strategy gate failed. |
| Failure / kill conditions | Same data-quality rejection rules as V1 plus frozen validation thresholds (≥140 cycles, ≥20 each asset, positive return, PF≥1.15, DD≤10%, ≥4/5 windows, each asset positive, concentration≤60%, positive stress). The exact V2 gate failed; no asset exclusion, direction flip or threshold rescue. Operational stops: **UNKNOWN / not specified**. |
| Risk / feasibility gaps | Same as V1: venue, margin, FX, netting, real fills and operational resilience unverified. No Paper/live authorization. |

## Passport 4 — PAPER-PROFIT-TSMOM-V2

| Field | Frozen source definition / recorded evidence |
|---|---|
| Identity and source | Exact ruleset `PAPER-PROFIT-TSMOM-V2`; evaluator blob `5f05fcb7f58073b0cf645690803f30be1a7c0be3`; shared momentum engine blob `41ba231c8423ac0c9778c118721fe4b2dd412cba`, both checked in the pinned tree. |
| Signal | For each asset, take the signs of simple returns over 30/90/365 calendar-day lookbacks; average the three signs. Zero return contributes zero. |
| Timing / sizing | Rebalance every 30 days. Compute annualized realized volatility over 60 daily returns; per-asset leverage is `min(2x, 10% / realized_vol)`, position is average sign × leverage; equal-weight active positions across eligible assets. At least 3 active assets are required. No pyramiding, martingale or averaging down. |
| Universe / sample | BTC, ETH, SOL, XRP, HBAR, LINK, AVAX, SUI using Binance public daily spot klines. 1,246 common timestamps; chronological 70/30 split; Discovery 872 timestamps from 2023-05-03 to 2025-09-19; Holdout 374 timestamps begins 2025-09-20. |
| Costs / outcome | 8 bps baseline / 16 bps stress turnover cost. Run `36748128411`, 37 Discovery periods, −7.84%, PF 0.751, max DD 13.28%, one of five positive windows, stress −8.10%; `TSMOM_V2_DISCOVERY_FAIL`. Holdout is null/not evaluated. |
| Risk / kill / feasibility | Frozen gates require ≥30 periods, positive return, PF≥1.15, DD≤20%, ≥4/5 positive windows, ≥5/8 positive assets, concentration≤35%, positive stress, provenance and untouched Holdout. Data split failure rejects before evaluation. This uses spot source history but admits short signs and up to 2x research leverage; actual short instrument/borrow, collateral, liquidation, fees, FX and executable feasibility are **UNKNOWN**. No live kill-switch is defined. |

**Disposition:** failed exact frozen Discovery. Do not run or tune its Holdout.

## Design-only or engineering-only entries — not frozen strategy passports

### H7 — Defensive spot low volatility

The campaign sketch is weekly spot selection of up to three lowest-volatility assets based on 30 returns, gated by `close > SMA200`, with at most 25% per asset and residual cash. It has no exact frozen H7 version/hash or evidenced H7 run. The LowVol V2 rules above instead short half the gross exposure in Binance USD-M perpetuals and use a different lookback, signal-to-weight mapping and universe mechanics. Legacy “H7 Adaptive Risk Shadow” is another identity; no namesake permits transfer of evidence. H7’s exact execution rules, exits, capital and risk controls remain **UNKNOWN**. Source: unmerged PR #791 head `41b638ec567540e555eb0dc0cd45bb97e3278cba`, `LINEAGE_RECONCILIATION_20261014.md`.

### H5 — Shock-and-reclaim

The campaign proposal is a closed 5-minute shock (≥3 prior ATR14 and ≥3× prior 20-bar median volume), reclaim within three closed bars, entry after confirmation, stop beyond shock extreme +0.25 prior ATR, thesis target, max six bars, one attempt/event. This remains a campaign sketch, not a frozen ruleset or run. Supplemental PR #757 source at `5a5f67cb21b10abf30cbf46497cbe79e8e0a6f62` documents a distinct direct-entry-at-reclaim-close-or-worse / shock-open-target attempt rejected under its then-applicable net-3:1 design policy. That is not an empirical loss and not the same as an executed breakout strategy. The earlier 1.5R sketch is superseded. Stop/target, timing and exact deployable variant remain **UNKNOWN** pending a separate frozen definition; none is created here.

### X1 and P1/C1 synthetic engineering

- X1 exact identifier in PR #791 is `X1_LONG_CASH_12M_EQUAL_SLEEVES`, proposed 12-month total-return trend, monthly decisions, equal sleeves, positive-return sleeves long and others cash. PR #795’s exact head `469623cf35c363d24702a73b8bfe845d95fa0923` adds an offline input-availability/composition contract; its base is PR #768 head `7e0b9f11b0280ec781353266c6ea57ce74134da0`. Caller timestamps are assertions, not independently verified historical availability. No empirical run/PnL exists in these cited sources. X1 requires explicit approved replacement of a planned slot; no slot is identified.
- PR #791 identifies P1 as `H1.P1.DAILY.V1` and C1 as `H1.C1.NONCROSSING.V1`; both are draft-blocked and count against budget. C1 differs from P1 only by removing the prior Williams %R crossing requirement; it is not a pure SMA control. PR #768’s exact `7e0b9f11b0280ec781353266c6ea57ce74134da0` adapter is synthetic engineering only. These do not establish historical results or candidate registration.
- The PR #791 reconciliation is partial and explicitly not a canonical trial ledger. Cumulative counts, full manual/failed/discarded list, P1/C1/X1 slots and remaining capacity are **UNKNOWN / UNRECONCILED**.

## Shared unknowns and controls

- No passport defines a verified EUR conversion path or evidence that reported USD research denominators map to an actual EUR account balance.
- Research gross exposure/leverage caps are not a substitute for venue margin, liquidation, borrow, short availability, portfolio-level concentration controls, or a production kill-switch.
- A ruleset’s recorded data-cost model is not a live execution quote. Any unspecified slippage, funding, fees, taxes, FX, settlement, product access or operational control remains **UNKNOWN**.
- The draft “Meridian Strategy Lab” name is provisional and not user-approved branding. No product rename is proposed.
