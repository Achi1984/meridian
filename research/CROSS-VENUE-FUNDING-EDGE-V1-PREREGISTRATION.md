# Cross-Venue Funding Edge V1 — Frozen Preregistration

Status: FROZEN BEFORE RESULT INSPECTION  
Ruleset: CROSS-VENUE-FUNDING-EDGE-V1  
Execution impact: false  
Auto-promotion: false

## Hypothesis
A delta-neutral perpetual pair can capture persistent funding-rate dispersion between two independent venues after executable fees, slippage, funding, basis movement and transfer/operational buffers. The edge is the spread between funding legs, not BTC direction.

## Universe and observations
BTCUSDT perpetual first. Candidate venues must expose public historical funding and mark/index prices with timestamped, reproducible source receipts. No synthetic funding. A venue is excluded if historical coverage, contract semantics, fee assumptions or timestamps cannot be independently reconciled.

## Frozen candidate construction
At each common funding decision timestamp, compare the two venue funding rates using only information available before entry. Candidate direction is long the lower-funding venue and short the higher-funding venue with equal USD delta at entry. No leverage benefit is credited. No pyramiding or averaging.

Entry requires projected conservative funding-spread income over the frozen holding horizon to exceed total modeled round-trip trading costs plus a 1.50x safety buffer. Any stale/missing funding or executable-price input fails closed.

## Costs and exits
All venue taker fees are charged on each fill unless a lower tier is independently evidenced before the run. Slippage is adverse on every fill. Funding is booked from authoritative venue records exactly once. Basis PnL is marked independently per leg. Operational/transfer costs are never silently zero when material.

Exit at the earliest of: spread no longer covers remaining exit-cost buffer, funding sign/spread reversal, basis-risk limit, data-integrity failure, or frozen maximum holding horizon. Data-integrity failure forbids new entries and forces an INCONCLUSIVE research verdict rather than fabricating economics.

## Split and gates
Common-time chronological 60% discovery / 20% validation / 20% untouched holdout. Holdout inaccessible until prior stages pass.

Each authorized split must have: positive net PnL after all costs; PF >=1.20; positive expectancy; max drawdown <=8%; >=4/5 positive chronological windows; positive result under 2x baseline slippage stress; no single month >35% of positive PnL; no unresolved accounting/data error; and enough independent funding cycles to make the result non-trivial (minimum 100 closed funding settlements and 20 completed position cycles).

No threshold, venue pair, horizon, cost model or gate may change after first PnL inspection. A failed V1 requires a newly preregistered successor.

## Decisions
CROSS_VENUE_V1_DISCOVERY_FAIL; CROSS_VENUE_V1_DISCOVERY_PASS_VALIDATION_REQUIRED; CROSS_VENUE_V1_VALIDATION_FAIL; CROSS_VENUE_V1_VALIDATION_PASS_HOLDOUT_REQUIRED; CROSS_VENUE_V1_HOLDOUT_FAIL; CROSS_VENUE_V1_HOLDOUT_PASS_PAPER_SHADOW_REQUIRED.

No result authorizes live trading.
