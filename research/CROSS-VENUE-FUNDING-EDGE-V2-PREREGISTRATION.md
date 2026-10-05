# Cross-Venue Funding Edge V2 — Frozen Preregistration

Status: **PREREGISTERED BEFORE V2 SOURCE RESULT / PNL INSPECTION**  
Ruleset: `CROSS-VENUE-FUNDING-EDGE-V2`  
Execution impact: `false`  
Auto-promotion: `false`

## Why V2 exists

V1 was closed as `CROSS_VENUE_V1_SOURCE_FAIL` before any strategy PnL because its frozen source contract could not represent a real authoritative OKX off-grid funding settlement and the associated >8h interval without changing V1 after source inspection.

V2 is a new ruleset. It is not an amendment or rescue of V1.

The economic hypothesis, costs, risk limits and success gates remain unchanged from V1. V2 changes only the pre-result source/integrity semantics needed to handle venue outages and irregular authoritative settlements without inventing or deleting data.

## Hypothesis and venue pair

A delta-neutral perpetual pair may capture persistent funding-rate dispersion after executable fees, slippage, funding, basis movement and operational buffers.

Frozen venue pair:

- Binance USD-M `BTCUSDT` perpetual
- OKX `BTC-USDT-SWAP` USDT-margined perpetual

No venue substitution is permitted after the V2 source contract is frozen.

## Source window rule

The V2 source implementation must be frozen in a separate reviewed source-contract PR before any V2 source audit or strategy PnL.

The source-contract PR must freeze exact timestamps using this predeclared rule:

- raw start: `2022-03-01T00:00:00.000Z`;
- raw coverage end: latest common on-grid funding settlement already contained in fully published authoritative source archives from both venues at the source-contract commit;
- decision-window end: latest common on-grid settlement at least **24 hours before** raw coverage end, so a maximum-horizon position can close without requiring unpublished/future funding data;
- after the source-contract PR merges, these timestamps are immutable inside V2.

No incomplete future archive may be assumed. No end boundary may be selected from PnL or strategy outcomes.

## Authoritative raw funding

All authoritative venue funding records inside raw coverage are retained with their exact raw timestamps and rates.

No interpolation, forward fill, synthetic settlement, timestamp deletion or timestamp relocation is allowed.

A raw settlement is **on-grid** only when it is within ±1 second of its nearest exact UTC hour. Only on-grid settlements may be canonicalized to that hour.

An off-grid settlement remains in raw provenance but is never converted into a common signal/decision timestamp.

## Generic integrity state

The source layer distinguishes source provenance from strategy eligibility.

A venue enters `DATA_DEGRADED` when any of the following becomes observable:

1. an expected scheduled funding settlement is absent beyond the ±1 second tolerance;
2. the gap between authoritative settlements exceeds 8 hours + 1 second;
3. an authoritative off-grid settlement appears;
4. required mark/funding source provenance, archive completeness or deterministic parsing fails.

Rules while degraded:

- no new position may open;
- missing funding is never synthesized;
- off-grid funding never contributes to the three-spread entry signal;
- the anomaly is retained in the source receipt/integrity event ledger.

For a missing expected scheduled settlement, degradation is considered observable immediately after the allowed ±1 second tolerance at that scheduled timestamp.

## Existing positions during degradation

If degradation is observable while a position is open:

- new entries are already blocked;
- the position exits at the first complete 1h mark OPEN strictly after the degradation-detection timestamp;
- authoritative on-grid settlements that occurred after entry and before that exit are accounted exactly once under the normal funding rule.

If an off-grid settlement occurs while a position is still open **without a prior observable missing scheduled settlement that already forced exit**, V2 does not estimate that settlement from hourly marks. The affected run/stage becomes **INCONCLUSIVE** and may not progress.

This rule prevents a source anomaly from being converted into guessed economics.

## Recovery

After a degradation event, entry eligibility returns only after **three consecutive common on-grid scheduled settlements** occur with no new integrity event between them.

Those three settlements may populate the existing three-spread persistence signal; the off-grid event itself never may.

## Common decisions and chronological split

A common decision timestamp exists only when both venues have authoritative on-grid settlements canonicalized to the same scheduled UTC timestamp.

The 60% / 20% / 20% chronological Discovery / Validation / Holdout split is computed once from **all common canonical decision timestamps inside the frozen V2 decision window**.

Integrity state may block trading, but it does not remove otherwise valid common timestamps from split construction. Split boundaries are frozen before strategy PnL.

## Signal, execution and economics

V2 retains the V1 economic rules unchanged:

- latest three completed common 8h funding spreads must have the same non-zero sign;
- conservative projected 24h spread = `3 × min(abs(last three common spreads))`;
- positive spread => LONG Binance / SHORT OKX;
- negative spread => LONG OKX / SHORT Binance;
- one BTC pair position maximum; no pyramiding or averaging;
- entry at first complete 1h mark OPEN strictly after the decision timestamp;
- 10,000 USDT notional per leg; 20,000 USDT research capital;
- Binance taker fee 5.0 bps/fill;
- OKX taker fee 5.0 bps/fill;
- baseline adverse slippage 3.0 bps/fill;
- stress adverse slippage 6.0 bps/fill;
- operational/rebalancing contingency 5.0 bps of one-leg notional per completed cycle;
- baseline round-trip cost 37.00 USDT;
- stress round-trip cost 49.00 USDT;
- entry hurdle strictly greater than 55.50 USDT;
- remaining close cost 16.00 USDT; 1.50× close buffer 24.00 USDT;
- basis-risk limit -100 USDT on one-leg notional;
- maximum holding horizon 24 hours.

Funding and basis PnL remain independently accounted per venue. No forced convergence assumption is permitted.

## Frozen gates

Each authorized split must satisfy all of:

- positive net PnL after all costs;
- Profit Factor >= 1.20;
- positive expectancy;
- max drawdown <= 8%;
- >=4/5 positive chronological windows;
- positive result under 2x baseline slippage;
- no single calendar month >35% of total positive monthly PnL;
- no unresolved accounting/data error;
- >=100 closed funding settlements;
- >=20 completed position cycles.

No threshold, venue pair, horizon, cost model, recovery count, outage semantics or gate may change after first V2 PnL inspection.

## Stage isolation

V2 is currently **PREREGISTERED only**.

- Source Audit: disabled
- Discovery: disabled
- Validation: disabled
- Holdout: disabled
- Paper: disabled
- Live: disabled

The next allowed step is a separate implementation/source-contract PR that freezes exact source boundaries, deterministic integrity-event construction, receipts and regression tests. That PR requires cross-model review on its exact HEAD-SHA.

No V2 source audit or strategy PnL is authorized by this preregistration.
