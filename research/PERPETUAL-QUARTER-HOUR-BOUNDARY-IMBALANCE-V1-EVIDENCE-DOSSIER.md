# Quarter-Hour Boundary Imbalance V1 — External Evidence Dossier

Status: **PRE-PROTOCOL EVIDENCE ONLY**  
Canonical base: `41b1f6e43b3e2a35e8d8d259c124e347e1bd2455`  
Own Data-V1 signal observed: **false**  
Own forward returns observed: **false**  
Own PnL observed: **false**  
Execution impact: **false**

## Purpose

Prepare the strategy preregistration decision **before** MERIDIAN looks at any Quarter-Hour signal/return relationship.

This dossier may narrow choices using external evidence. It must not use MERIDIAN's 2025-01..2026-08 Data V1 corpus to choose a horizon, threshold, side, asset, or cost model.

## Primary source

Chan Kim and Peter Reinhard Hansen, *The Quarter-Hour Effect: Periodic Algorithmic Trading and Return Predictability in Cryptocurrency Futures*, arXiv:2607.09426.

Source:
- https://arxiv.org/abs/2607.09426

Independent facts relevant to preregistration:

- six Binance USDT-margined perpetuals: BTC, ETH, XRP, SOL, DOGE, ADA;
- periodic activity is strongest at quarter-hour openings;
- the opening window studied is the first **10 seconds** after the quarter-hour boundary;
- aggressive-trade direction is inferred from Binance's buyer-maker field;
- buyer initiated: buyer-maker = false;
- seller initiated: buyer-maker = true;
- signed order flow is the quantity-weighted sum of trade direction;
- normalized order imbalance is signed order flow divided by total traded quantity;
- normalized OI is therefore bounded approximately in [-1,+1];
- the medium-horizon association is **continuation**, not reversal: higher opening OI predicts higher subsequent return;
- predictive content is reported over roughly **4 to 12 hours**;
- the relation is weaker at generic/finer clock-time frequencies;
- robustness checks retain the medium-horizon result when funding-settlement openings are excluded and when top-of-hour observations are removed.

The source is hypothesis evidence. It is not proof that MERIDIAN's future implementation is profitable net of costs.

## Important distinction: opening return versus opening order imbalance

The paper's very short quarter-hour opening-return predictability is too small to justify a standalone taker strategy.

The source explicitly discusses the predictable first-10-second return component as economically small relative to taker fees.

Therefore MERIDIAN must **not** create a first-10-second return-chasing strategy from this paper.

The selected hypothesis is instead:

> direction of aggressive trade imbalance in the first 10 seconds of a quarter-hour boundary may contain information about medium-horizon subsequent return.

## Horizon evidence

The primary paper evaluates a broad horizon grid and reports that the quarter-hour conditional forecast effect turns positive at medium horizons and commonly peaks around **8–12 hours**.

The main evidence relevant to 4h / 8h / 12h:

- positive medium-horizon effect across the six contracts;
- four of six contracts reach conventional 95% significance at each of the 4h, 8h and 12h horizons in the main discussion;
- several remaining cells are significant at 90%;
- SOL at 8h is the notable main-table insignificant cell;
- decomposition indicates the contribution associated with the public quarter-hour signal rises with horizon:
  - around 20% at 4h;
  - around 55% at 8h;
  - around 65% at 12h.

Interpretation for preregistration:

- **4h**: shortest exposure/cost-amortization window, but more of the predictive variation is still attributed to lagged-flow persistence;
- **8h**: operationally attractive because it is one standard funding interval and sits near the empirical peak zone, but has the notable SOL 8h weak cell;
- **12h**: strongest external case for a signal-dominated medium-horizon effect, but longer market exposure and potentially more funding/slippage uncertainty.

No MERIDIAN data may be used to pick between these.

## Secondary caution source

Edson Pindza, *Microstructure alpha: hierarchical learning and cross-asset transfer in cryptocurrency markets*, Frontiers in Blockchain 9 (2026), DOI 10.3389/fbloc.2026.1811716.

Source:
- https://www.frontiersin.org/journals/blockchain/articles/10.3389/fbloc.2026.1811716/full

Relevant constraints:

- over three million minute-level observations;
- six cryptocurrencies across Binance spot and perpetual markets;
- purged / leakage-controlled validation;
- genuine but weak microstructure information;
- flexible ML overfits badly under proper controls;
- cross-asset transfer is weak;
- no tested 5-minute strategy survives realistic standard exchange fees;
- high turnover overwhelms modest forecast information.

MERIDIAN implication:

- no complex ML or feature-search stage before a simple preregistered baseline;
- no assumption that a signal calibrated on one asset transfers to another;
- cost and turnover gates must be first-class;
- the longer 4–12h horizon is preferable to high-frequency rebalancing from a feasibility standpoint.

## Additional methodological cautions

Recent 2026 microstructure literature also reinforces these principles:

- apparent short-horizon order-flow effects can reverse as the sample expands;
- predictive order-flow imbalance must be distinguished from contemporaneous mechanical price impact;
- backtest-to-live gaps can dominate small theoretical edges.

These are treated as design cautions, not parameter sources.

## Protocol choices already externally justified

The following may be considered **candidate fixed elements** after Data V1 PASS because they do not depend on MERIDIAN's own outcome data:

### Venue / universe

- Binance USD-M perpetuals
- BTCUSDT
- ETHUSDT
- XRPUSDT
- SOLUSDT
- DOGEUSDT
- ADAUSDT

Reason: exact six-contract universe of the primary source and exact universe already frozen for Data V1.

### Event clock

Quarter-hour UTC boundaries:
- minute 00
- minute 15
- minute 30
- minute 45

### Observation window

First **10 seconds** after the boundary.

### Trade direction

For every aggregate trade:
- buyer-maker = false => +1 aggressive buy
- buyer-maker = true => -1 aggressive sell

### Candidate signal

For event t:

`OF_t = sum(quantity_k * direction_k)`

`OI_t = OF_t / sum(quantity_k)`

No price-return term belongs in the signal.

### Candidate direction

**Continuation**:
- positive OI -> long hypothesis;
- negative OI -> short hypothesis.

This direction is externally motivated and must not be flipped after seeing MERIDIAN data.

## Choices deliberately NOT frozen yet

The following remain unresolved until Data V1 quality is canonical, but they must be resolved **before first strategy PnL**:

### Holding horizon

Allowed decision set from external evidence only:
- 4h
- 8h
- 12h

No data-driven winner selection is allowed.

Preferred preregistration candidates based only on literature:

- primary candidate: **8h**
- robustness horizon: **12h**
- diagnostic secondary: **4h**

This is not yet a frozen trading rule.

### Signal activation

Open question:
- trade every non-zero OI event; or
- require an absolute OI threshold.

Risk:
a threshold selected from MERIDIAN data would be direct overfitting.

Preferred anti-overfitting approach:
- first protocol should avoid an optimized threshold;
- use a simple externally defined / distribution-free transformation or a single preregistered threshold;
- if a threshold is used, justify it before observing return relationships.

### Overlapping positions

Quarter-hour signals occur every 15 minutes while the candidate holding period is hours.

The protocol must define one of these **before PnL**:
- independent event sleeves;
- aggregate/net concurrent signals;
- one active position per asset;
- fixed rebalance schedule.

This is a material economic choice and cannot be left to implementation convenience.

### Position sizing

Must be frozen before PnL.

Default research preference:
- fixed gross-risk allocation;
- no confidence sizing from observed return fit;
- cap per asset and portfolio gross exposure;
- no leverage optimization from the development result.

### Funding

Realized funding events inside the exact holding interval must be included.

Funding cannot be approximated away because 8h/12h horizons can cross one or more settlement events.

### Transaction costs

The first protocol must contain:
- explicit taker/maker assumption;
- fees;
- slippage;
- stress cost.

Because the signal is triggered after observing first-10-second trades, same-boundary fills before signal completion are impossible.

Entry must therefore occur **after** the observation window using an explicitly executable convention.

## Required anti-leakage invariants for future protocol

Before first PnL:

1. all signal trades must have timestamp within [boundary, boundary+10s);
2. no price after the signal cutoff may enter OI;
3. entry timestamp must be strictly after signal cutoff;
4. holding return cannot influence event eligibility;
5. funding only from the realized post-entry holding interval;
6. asset inclusion cannot depend on future return;
7. no threshold/horizon may be selected after looking at development PnL;
8. temporal validation/holdout data remain inaccessible until authorized;
9. each asset must preserve independent evidence so cross-asset aggregation cannot hide a failed market;
10. costs are frozen before first PnL.

## Proposed decision sequence after Data V1 PASS

1. freeze exact signal formula and event eligibility;
2. freeze one primary holding horizon from external evidence;
3. freeze overlap/netting rule;
4. freeze entry/exit timestamps;
5. freeze fees/slippage/funding;
6. freeze development and untouched validation/holdout intervals;
7. freeze pass/fail gates;
8. build invariant tests;
9. merge canonical protocol;
10. only then calculate first strategy PnL.

## Research integrity boundary

The current Data V1 full run may tell us whether data are complete and structurally usable.

It may **not** tell us:
- whether OI is positive or negative on average;
- which assets have stronger predictive OI;
- whether 4h/8h/12h performs best;
- what threshold works;
- what side contributes more;
- any strategy return.

If Data V1 output ever contains those values, it is a leakage failure and strategy preregistration must stop.

No Paper/live authorization is created by this dossier.
