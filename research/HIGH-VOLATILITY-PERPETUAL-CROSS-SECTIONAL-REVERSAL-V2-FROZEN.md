# High-Volatility Perpetual Cross-Sectional Reversal V2 — Frozen Validation Protocol

Status: **FROZEN BEFORE FIRST V2 STRATEGY PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-FROZEN`
- `PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-DATA-V1-FROZEN`
- MERIDIAN main after PR #314

## Why V2 exists

V1 produced positive net and stress returns and a positive next-week loser-minus-winner spread, but failed its frozen robustness gate because:
- Sharpe = 0.597 < 0.75;
- only 3/5 chronological windows were positive;
- the short recent-winners side contributed negatively;
- only 11/23 assets had positive attribution;
- positive-PnL concentration exceeded 20%.

V1 remains immutable and its temporal holdout was never loaded.

External evidence fixed before V2 PnL:
- Kiefer & Nowotny (2026), *Reversal in Cryptocurrency Returns*: intermediate-horizon crypto reversal is reported as stronger among higher-volatility assets and outside mega-caps.
- Zaremba et al. (2021), *Up or down? Short-term reversal, momentum, and liquidity effects in cryptocurrency markets*: crypto reversal/momentum behavior varies with liquidity and the largest, most tradeable coins behave differently.

V2 tests only the predeclared high-volatility conditioning change.

V2 does **not** claim exact replication of the external paper because MERIDIAN uses Binance USD-M perpetuals, realized funding and explicit retail-style transaction costs.

## Frozen universe

Exactly the same 23 non-mega-cap assets as V1:

- ADA
- DOGE
- LINK
- DOT
- LTC
- BCH
- AVAX
- HBAR
- TRX
- ETC
- XLM
- ATOM
- UNI
- AAVE
- FIL
- NEAR
- OP
- INJ
- APT
- CRV
- LDO
- GALA
- IMX

No asset may be added, removed or substituted after results.

ARB remains excluded so that V2 changes only the volatility conditioning relative to V1.

## Public data

Binance Vision USD-M monthly archives only:
- 1d perpetual trade klines
- fundingRate

No private API, credentials, synthetic backfill, interpolation or nearest-neighbor substitution.

## First independent validation window

V2 does not re-use V1's seen 2024 discovery window as an independent gate.

Weekly entry anchors:
- Monday 00:00 UTC
- `2025-01-06 <= t < 2026-08-31`

Final exit:
- 2026-08-31 00:00 UTC

Expected weekly periods:
- **86**

Raw discovery/validation collector must load only the minimum pre-history required for this window and must not load any data after 2026-08-31.

This is the first strategy-PnL evaluation of V2.

## Weekly price semantics

Identical to V1.

For information known at anchor t:
- the last completed daily close comes from the daily bar with `openTime = t - 1 day`;
- that close is mapped to mark timestamp t.

Execution:
- entry price = exact daily open at t;
- exit price = exact daily open at t + 7 days.

No current-day close enters a decision.

## Reversal signal — unchanged

Skip:
- exclude `[t-7d,t)`.

Formation:
- exact 8-week return from completed close known at `t-63d` to completed close known at `t-7d`.

`FORMATION_RETURN_i,t = CLOSE_i(t-7d) / CLOSE_i(t-63d) - 1`

No funding, volume, basis, OI or market-cap variable enters the ranking signal.

## High-volatility conditioning — only V2 strategy change

Use the exact same 8-week formation interval, ending before the 1-week skip.

For each otherwise valid asset at t:
- collect the **57 exact completed daily close marks** from `t-63d` through `t-7d` inclusive;
- compute 56 consecutive daily log returns;
- compute sample standard deviation `n-1`;
- annualize as `stdev × sqrt(365)`.

No skip-week prices enter the volatility estimate.

At each anchor:
1. require at least **15** assets with valid formation return, volatility and exact entry/exit opens;
2. sort those assets by annualized volatility ascending, tie-break symbol ascending;
3. define the high-volatility subset as the upper half:
   - `high_vol_count = ceil(N / 2)`;
4. rank only that high-volatility subset by formation return ascending, tie-break symbol ascending.

No absolute volatility threshold.
No volatility parameter grid.
No volatility scaling.
No inverse-volatility weighting.

## Reversal portfolio inside high-volatility subset

Preserve V1's quintile-style rule.

- side count = `floor(high_vol_count / 5)`;
- require side count >=2;
- LONG the bottom side-count recent losers;
- SHORT the top side-count recent winners.

Weights:
- LONG gross = +0.50, equal weight;
- SHORT gross = -0.50, equal weight;
- net = 0;
- gross = 1.00.

No leverage beyond 1.0 gross.
No stop loss.
No take profit.
No pyramiding.
No averaging down.
No discretionary filter.

## Holding, funding and costs — unchanged

Holding period:
- one week.

Price PnL:
- signed weight × next-week open return.

Funding:
- all realized Binance funding events in `(t,t+7d]`;
- positive funding charges longs and rewards shorts.

Base transaction cost:
- 8 bps per unit turnover.

Stress transaction cost:
- 13 bps per unit turnover.

Final stage exit:
- force all positions flat;
- charge full terminal turnover.

No rebates or fee optimization.

## Data integrity

Daily prices:
- finite positive OHLC;
- internally consistent;
- strictly increasing;
- exact daily cadence through all required formation, volatility, skip and holding spans.

Funding for selected active positions:
- finite;
- strictly increasing;
- no duplicates;
- max boundary/inter-event gap <=12h.

If fewer than 15 full-universe assets qualify before the volatility filter:
- stage fails closed.

If the high-volatility subset produces side count <2:
- stage fails closed.

If selected active funding coverage fails:
- stage fails closed.

No reconstruction.

## Metrics

Report base and stress variants.

Portfolio:
- completed weekly periods
- full eligible count by week
- high-volatility subset count by week
- side count by week
- compounded net return
- compounded price-only return
- funding contribution
- transaction-cost contribution
- Profit Factor
- annualized Sharpe using sample weekly stdev × sqrt(52)
- max drawdown
- five chronological-window returns
- turnover

Breadth:
- long-side gross contribution before costs
- short-side gross contribution before costs
- per-asset attribution
- positive-PnL asset count
- positive-PnL concentration
- long/short week count by asset

Signal diagnostics:
- mean/median volatility of high-volatility subset
- mean/median formation return of long basket
- mean/median formation return of short basket
- mean next-week long-basket price return
- mean next-week short-basket price return
- mean next-week loser-minus-winner price spread

## Frozen independent-validation gate

All must pass:

- exactly **86** completed weekly periods
- no data-integrity failure
- every week has >=15 full eligible assets
- every week has >=8 high-volatility-subset assets
- side count >=2 every week
- compounded net return >0
- compounded price-only return >0
- Profit Factor >= **1.10**
- annualized Sharpe >= **0.50**
- max drawdown <= **25%**
- >= **3 of 5** chronological windows positive
- stress compounded return >0
- long-side gross contribution >0
- short-side gross contribution >0
- >= **12 of 23** assets have positive net PnL attribution
- no single positive asset contributes > **25%** of total positive PnL
- mean next-week loser-minus-winner price spread >0

PASS => `VALIDATION_PASS_TRANSFER_REQUIRED`

FAIL => `VALIDATION_FAIL_RESEARCH_REDESIGN`

A PASS does **not** authorize Paper shadow. It authorizes only a separately frozen transfer-universe validation on new assets.

## Anti-overfitting

- this V2 protocol is committed before first V2 strategy PnL;
- V1 remains immutable;
- V1's 2024 window is not reused as an independent V2 gate;
- 8-week formation fixed;
- 1-week skip fixed;
- 1-week hold fixed;
- volatility uses the same pre-skip 8-week window;
- high-volatility subset is fixed to the upper half cross-sectionally;
- quintile-style side count fixed;
- equal weighting fixed;
- no volatility threshold grid;
- no inverse-volatility weighting;
- no 10-week rescue;
- no alternate skip/hold;
- no asset removal;
- no fee/slippage reduction;
- no losing-week exclusion;
- no validation-date movement;
- no gate relaxation;
- any redesign receives a new ruleset.

## Safety

Research only. No exchange credentials, live orders, leverage automation, liquidation model, wallet mutation or automatic promotion.


## Audit provenance note

This note is non-parametric and was added after the first observed workflow run.

At GitHub Actions run **36602801293** (commit `920d5d6667822297641d63517fb913b3e93a4508`), the executed engine, tests, runner and primary frozen protocol used the **upper-half volatility** rule. However, the branch simultaneously contained a contradictory duplicate protocol describing a lower-tercile exclusion, and the PR description also referenced that alternate rule.

The duplicate was removed and the upper-half rule was selected as canonical before the PnL output was inspected, based on simpler preregistration and direct alignment with the already-written engine/tests. Because repository-level preregistration was nevertheless ambiguous at the instant of the first observed run, the result is retained as seen research evidence but **does not qualify as a clean independent promotion gate**.

No V2 parameter is changed by this note. Any successor requires a new ruleset and fresh independent evidence.
