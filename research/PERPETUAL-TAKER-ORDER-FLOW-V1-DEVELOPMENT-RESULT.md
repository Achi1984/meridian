# Perpetual Taker Order Flow V1 — Frozen DEVELOPMENT Result

Workflow run: **36609900324**  
Commit: `88e7225eca567c516ea197c27254c82cb4775645`  
Artifact: **11053620061**  
Artifact ZIP SHA-256: `b7d77f3cee303467041efed59095e76b12dccacf897a66c570f1d54e762faa16`  
Summary pre-hash SHA-256: `81690e6d5b98c427ce4107e60d6e528e8481a3d8b6179f73e76cb3505f7ceb4b`  
Full evidence SHA-256: `fb04289d9f9f8623360dd3b652320c09e024c4386d722026e72621508be28af1`  
Markdown SHA-256: `6c19e3897c1e557b02d5b8708c883922ca55c55d43ab52dfb64bceb9f459b01e`

This freezes the first untouched DEVELOPMENT result of `PERPETUAL-TAKER-ORDER-FLOW-V1-FROZEN`.

## Integrity and holdout isolation

- raw data: 2023-01..2024-12 only
- development trade window: 2023-01-14..2024-12-28
- weekly periods: **102/102**
- eligible assets every week: **12/12**
- side count every week: **2**
- data-integrity failure: **false**
- holdout loaded: **false**
- post-development data loaded: **false**
- canonical invariant tests: **PASS**
- development-only holdout-exclusion tests: **PASS**

The frozen 2025-01-11..2026-08-29 temporal holdout remains untouched and unauthorized.

## Frozen economic result

- compounded net return: **+45.1468%**
- price-only compounded return: **+38.5141%**
- Profit Factor: **1.4351**
- annualized Sharpe: **0.8053**
- max drawdown: **23.9926%**
- positive chronological windows: **3/5**
- stress return at 13 bps turnover cost: **+35.7759%**
- cumulative funding contribution: **+4.7089%**
- modeled base-cost contribution: **-10.7200%**
- turnover: **134.0**
- long-side gross contribution: **+87.2303%**
- short-side gross contribution: **-31.8546%**
- positive-PnL assets: **5/12**
- positive-PnL concentration: **42.8046%**
- mean long FLOW: **-0.002783**
- mean short FLOW: **-0.031337**
- mean next-week long-basket return: **+1.8007%**
- mean next-week short-basket return: **+0.8072%**
- mean next-week high-flow-minus-low-flow spread: **+0.9935%**

The continuation relation is directionally visible: high-flow assets outperformed low-flow assets by roughly 0.99 percentage points in the following week on average. The frozen two-sided portfolio nevertheless failed robustness because the low-flow short basket rose on average rather than falling.

## Chronological windows

- Window 1: **-13.0837%**
- Window 2: **+37.3487%**
- Window 3: **+12.9753%**
- Window 4: **+24.0285%**
- Window 5: **-13.2286%**

## Asset attribution

- BTC: +8.8041%
- ETH: -1.0196%
- BNB: -8.3075%
- SOL: +36.9727%
- XRP: -5.5815%
- ADA: -1.3510%
- DOGE: -3.0542%
- LINK: -0.4662%
- DOT: +1.8250%
- LTC: -21.9396%
- BCH: +25.5630%
- AVAX: +13.2106%

Attribution is additive contribution accounting, not standalone compounded asset return.

## Frozen gate result

**FAIL**

Gate reasons:
- `POSITIVE_WINDOWS_LT_4`
- `SHORT_CONTRIBUTION_NOT_POSITIVE`
- `POSITIVE_ASSETS_LT_8`
- `POSITIVE_CONCENTRATION_GT_30.0`

Decision:

**DEVELOPMENT_FAIL_RESEARCH_REDESIGN**

## Interpretation

The basic weekly taker-flow continuation signal produced positive aggregate economics, positive stress economics, and a positive high-flow-minus-low-flow next-week spread. It did not satisfy MERIDIAN's preregistered robustness requirements.

This result must not be rescued inside V1 by:
- removing the short side;
- dropping losing assets;
- changing the 168-hour lookback;
- changing Saturday anchors;
- flipping the signal;
- changing the holding period;
- lowering transaction costs;
- moving the development/holdout dates;
- relaxing gates;
- opening the temporal holdout.

Any successor requires a separately frozen ruleset justified before its first PnL.

Research only. No Paper or live promotion.
