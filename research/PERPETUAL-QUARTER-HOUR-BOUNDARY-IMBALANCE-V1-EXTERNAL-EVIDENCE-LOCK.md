# Quarter-Hour Boundary Imbalance V1 — External Evidence Lock 2026-09-29

Status: **EXTERNAL-EVIDENCE PREWORK ONLY**  
Own-data signal/PnL observed: **false**  
Execution impact: **false**

## Purpose

Prepare the strategy-design decision set **before** MERIDIAN inspects any directional signal, forward return, position or PnL from its own 2025-01..2026-08 Binance data.

This document does not authorize a strategy backtest. It locks what the external evidence says and what remains unresolved.

## Primary source

Chan Kim and Peter Reinhard Hansen, *The Quarter-Hour Effect: Periodic Algorithmic Trading and Return Predictability in Cryptocurrency Futures*, arXiv:2607.09426v2, 2026-08-24.

Source:
https://arxiv.org/abs/2607.09426

Study setting:
- Binance USDT-margined perpetual futures;
- BTC, ETH, XRP, SOL, DOGE, ADA;
- sample: 2021-01-01 through 2024-10-31;
- trade-level timestamps, price, quantity and `isBuyerMaker`;
- 10-second calendar-time aggregation.

## Externally defined order-flow variable

Trade direction:
- buyer-initiated: `isBuyerMaker = false`;
- seller-initiated: `isBuyerMaker = true`.

For trade k:
- `D_k = +1` for buyer-initiated;
- `D_k = -1` for seller-initiated;
- `V_k` = trade size.

Net signed flow:

`OF_t = sum(V_k * D_k)`

Volume-normalized imbalance:

`OI_t = OF_t / sum(V_k)`

Therefore:
- `OI_t in [-1, 1]`;
- positive OI means net aggressive buying;
- negative OI means net aggressive selling.

## Clock-time condition

The study identifies the **first 10 seconds** of quarter-hour minutes as the peak activity window.

Quarter-hour origins:
- minute 00
- minute 15
- minute 30
- minute 45

The effect is not treated as generic every-minute order flow.

## Direction

External evidence supports a **continuation** interpretation at medium horizons:

- positive quarter-hour opening imbalance -> higher subsequent return;
- negative quarter-hour opening imbalance -> lower subsequent return.

The predictive relation is reported as stronger at the quarter-hour frequency than at ordinary, 1-minute or 5-minute openings.

MERIDIAN must therefore not flip the sign to contrarian/reversal merely because an in-sample result later looks better.

## Horizon evidence

The paper estimates direct forward-return regressions at:

30s, 1m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h and 24h.

The medium-horizon quarter-hour evidence is concentrated around **4h / 8h / 12h**.

Raw-order-imbalance CFE table reported in the paper:

| Contract | 4h | 8h | 12h |
|---|---:|---:|---:|
| BTC | +3.85 bp | +5.56 bp | +6.40 bp |
| ETH | +2.76 bp | +4.69 bp | +5.40 bp |
| XRP | +2.69 bp | +6.20 bp | +7.78 bp |
| SOL | +3.29 bp | +2.42 bp | +6.73 bp |
| DOGE | +5.03 bp | +8.50 bp | +11.34 bp |
| ADA | +2.08 bp | +5.40 bp | +5.10 bp |

These are predictive-regression slopes per unit of OI, **not trading-strategy returns**.

## Horizon decision matrix for later preregistration

### 4h

Pros:
- shortest medium horizon;
- lowest holding overlap;
- earlier realization of the documented effect.

Cons:
- cross-asset evidence is weaker than later horizons;
- ADA is not statistically strong in the reported table;
- still requires careful cost/turnover translation.

### 8h

Pros:
- stronger medium-horizon evidence for BTC/ETH/XRP/DOGE/ADA;
- lower expected turnover per independent holding window than 4h.

Cons:
- SOL is weak in the reported table;
- overlapping quarter-hour signals remain a major portfolio-construction issue.

### 12h

Pros:
- largest reported raw-OI point estimate for BTC, ETH, XRP, SOL and DOGE among 4/8/12h;
- five of six contracts show statistically meaningful evidence in the reported table;
- lower independent-holding turnover than 4h/8h.

Cons:
- SOL remains statistically weaker;
- a signal every 15 minutes with a 12h holding period would create large overlap if translated naively into trades;
- regression evidence still does not specify a practical position-stacking rule.

## External-evidence preference

If DATA V1 passes without revealing a structural data limitation, the evidence-only design preference is:

**PRIMARY HORIZON CANDIDATE: 12 HOURS**

This preference is made before MERIDIAN observes its own signal/return relationship or PnL.

The 4h and 8h horizons may later be used only as **predeclared robustness diagnostics**, not as parameter alternatives from which MERIDIAN selects the best PnL after seeing results.

Any departure from 12h must be justified by a data-integrity/execution-geometry constraint discovered before PnL, not by performance.

## Funding robustness

The primary paper reports that the medium-horizon result is qualitatively similar after excluding the three quarter-hour openings coinciding with fixed perpetual funding settlements:

- 00:00 UTC
- 08:00 UTC
- 16:00 UTC

Therefore funding-time coincidence is not a sufficient explanation for the documented effect.

MERIDIAN still must include realized funding in any later perpetual-futures strategy economics.

## Second source — economic feasibility caution

Edson Pindza, *Microstructure alpha: hierarchical learning and cross-asset transfer in cryptocurrency markets*, Frontiers in Blockchain 9 (2026), DOI 10.3389/fbloc.2026.1811716.

Source:
https://doi.org/10.3389/fbloc.2026.1811716

Relevant findings:
- six cryptocurrencies across Binance spot and perpetual futures;
- leakage-controlled minute-level microstructure prediction;
- genuine but weak predictive information;
- flexible gradient-boosted models overfit under purged walk-forward validation;
- no tested trading strategy survives realistic standard retail fees;
- asset-level heterogeneity is material.

Implication for MERIDIAN:
- do not use model complexity as a rescue mechanism;
- use a parsimonious rule;
- require explicit cost stress;
- require breadth across assets and time;
- require purged/blocked temporal validation.

## Rejected nearby hypothesis

Nadav A. Kitron and Jonathan M. Wengrowicz, *Short-horizon mean reversion in cryptocurrency markets: a matched cross-market measurement*, arXiv:2608.21888.

Source:
https://arxiv.org/abs/2608.21888

The study reports:
- strong 15-minute directional reversal;
- concentration after aggressive-taker-flow moves;
- gross edge peaking near **1.3 bp per trade**;
- benchmark round-trip cost of **5 bp**.

MERIDIAN therefore keeps this family rejected as the next candidate:
- statistically interesting;
- economically below the cited benchmark cost;
- no reason to spend current research budget optimizing it.

## Critical translation problem — regression != trading rule

The primary paper establishes a predictive association. It does **not** define a directly executable medium-horizon portfolio.

A naive implementation would create a new signal every 15 minutes and hold for 12 hours, causing up to 48 overlapping cohorts per asset.

That portfolio-construction choice is not licensed by the external evidence.

Therefore the later preregistration must freeze **one** overlap-handling rule before PnL.

Candidate classes to evaluate conceptually before coding:
1. one active position per asset; newest event may not stack;
2. cohort stacking with fixed total-risk normalization;
3. time-bucket aggregation into one net target exposure.

No class may be selected after comparing PnL.

## What is already externally locked

If DATA V1 passes, the later protocol should preserve unless a pre-PnL engineering impossibility is documented:
- universe: BTC, ETH, XRP, SOL, DOGE, ADA;
- venue family: Binance USD-M perpetual;
- event: exact quarter-hour boundary;
- measurement window: first 10 seconds;
- order-flow sign from `isBuyerMaker`;
- OI normalized by total trade volume;
- direction: continuation, not reversal;
- primary horizon candidate: 12h;
- 4h/8h only as predeclared robustness diagnostics;
- realized funding included in strategy economics;
- costs evaluated explicitly;
- no model-complexity rescue.

## Still deliberately unresolved

The following remain blocked until DATA V1 is canonical, but must be decided before first PnL:
- exact entry price convention after the 10-second signal window;
- overlap/stacking rule;
- continuous OI sizing versus sign-only signal;
- threshold versus always-on exposure;
- per-asset versus pooled normalization;
- total gross/net exposure;
- turnover-cost assumptions and stress costs;
- development / validation / holdout boundaries;
- pass/fail promotion gates.

No directional MERIDIAN data may be inspected to choose among these.
