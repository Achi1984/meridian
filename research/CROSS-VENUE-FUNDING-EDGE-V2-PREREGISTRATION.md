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
- `fundingCoverageEnd`: latest authoritative funding timestamp covered by fully published source archives from **both** venues at the source-contract commit;
- `markCoverageEnd`: latest confirmed 1h mark-candle OPEN timestamp covered by authoritative mark history from **both** venues at the source-contract commit;
- `coverageEnd = min(fundingCoverageEnd, markCoverageEnd)`;
- decision-window end: the latest common on-grid scheduled settlement `t` for which **`t + 26 hours <= coverageEnd`**;
- after the source-contract PR merges, raw start, `fundingCoverageEnd`, `markCoverageEnd`, `coverageEnd` and the derived decision-window end are immutable inside V2.

The 26-hour reserve is structural: entry may occur at the first complete 1h mark OPEN after `t` (up to `t+1h`), the maximum holding horizon is 24 hours from actual entry, and final execution occurs at the first complete 1h mark OPEN strictly after the exit-decision timestamp (requiring coverage through `t+26h`).

No incomplete future archive may be assumed. No end boundary may be selected from PnL, entries, exits or strategy outcomes.

## Authoritative raw funding

All authoritative venue funding records inside raw coverage are retained with their exact raw timestamps and rates.

No interpolation, forward fill, synthetic settlement, timestamp deletion or timestamp relocation is allowed.

A raw settlement is **on-grid** only when it matches that venue's frozen scheduled settlement grid within ±1 second. Only on-grid settlements may be canonicalized to the corresponding scheduled timestamp.

The V2 funding schedule is frozen independently for each venue as **8-hour settlements at 00:00 / 08:00 / 16:00 UTC, tolerance ±1 second**.

The V2 ruleset never auto-adapts this grid. A provider interval change, extra settlement on another cadence, or any other deviation from the frozen 8h grid is an integrity event and places that venue in `DATA_DEGRADED`. Such a record remains in authoritative raw provenance but does not create a new common decision timestamp.

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

A **degradation episode** begins at the first observable `DATA_DEGRADED` event and ends only after the Recovery rule below has been satisfied.

If degradation becomes observable while no position is open:

- entries are blocked until Recovery;
- the episode alone does not make the run INCONCLUSIVE.

If degradation becomes observable while a position is open:

- new entries are already blocked;
- the affected run/stage becomes **INCONCLUSIVE immediately for research purposes**;
- no exit price, basis realization or post-detection funding path is modeled for that affected position;
- later mark candles, later off-grid settlements, later recovery and apparent historical prices cannot convert the episode back into usable economic evidence.

This rule deliberately refuses to infer venue executability from mark/index history during a degradation episode. It also removes any need to decide whether an episode completed before `coverageEnd`: an open position at degradation onset is already sufficient to make the affected run/stage INCONCLUSIVE.

This rule prevents a source anomaly or venue outage from being converted into guessed economics.

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

Before that implementation PR may authorize a V2 source audit, it must prove at minimum:

1. open position + missing scheduled settlement + no later off-grid settlement + complete confirmed marks => `INCONCLUSIVE`;
2. open position + missing scheduled settlement + later off-grid settlement in the same degradation episode => `INCONCLUSIVE`;
3. no open position at degradation detection => entry lock only, not automatically `INCONCLUSIVE`;
4. no implementation path may assign an economically valid exit, basis realization or post-detection funding path to a position that was open when degradation began;
5. decision timestamp exactly `coverageEnd - 26h` is admissible when otherwise common/on-grid, while any decision timestamp greater than `coverageEnd - 26h` is excluded;
6. a synthetic provider change to a 4h funding interval causes `DATA_DEGRADED`, blocks entries and never creates new common decision timestamps from that 4h cadence;
7. strict numeric parsing rejects null / blank / boolean source scalars instead of coercing them to zero;
8. the collector itself refuses to execute source collection whenever the V2 stage lock does not explicitly authorize `sourceAudit:true`.

If V2 reuses logic from `research/cross-venue-funding-edge-v1.js`, its coercive numeric validation must first be replaced with strict numeric handling and tested. Binance/OKX source parsers must likewise reject blank or non-numeric cells rather than silently coercing them with `Number()`.

No V2 source audit or strategy PnL is authorized by this preregistration.
